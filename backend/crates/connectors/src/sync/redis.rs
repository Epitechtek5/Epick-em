//! [`SyncStore`] dont tout l'état de synchronisation vit dans Redis.
//!
//! PostgreSQL ne garde que le **lien** d'une source (`external_sources`, changelog
//! `0017-external-sources`) : son identité chez le fournisseur, les épreuves importées et le
//! tournoi local qui la représente. Ces lectures passent par le cache ([`CachedDb`]) et ne
//! touchent la base qu'à l'enregistrement, à la suppression ou quand l'entrée a expiré.
//!
//! Tout ce que la source fournit reste dans Redis, sans expiration :
//!
//! - `{préfixe}:state:{id}` : dernier instantané, capacités, curseur, état de fraîcheur et
//!   échéance de la prochaine synchronisation ([`State`]) ;
//! - `{préfixe}:lease:{id}` : échéance du bail de la synchronisation en cours (prise atomique,
//!   et la clé expire d'elle-même si son détenteur meurt) ;
//! - `{préfixe}:events` (et son compteur `{préfixe}:events:seq`) : boîte d'envoi des
//!   changements de résultats, triée par numéro d'ordre.
//!
//! L'instantané, ses événements et la libération du bail sont écrits par un seul script Lua :
//! ils aboutissent ensemble, et seulement si la synchronisation tient toujours le bail. Une
//! source dont l'état a disparu de Redis (base vidée, éviction) est simplement due : la
//! prochaine synchronisation refait un instantané complet.

use super::{ChangeEvent, NewSource, SourceRecord, StoreError, Success, SyncStore};
use crate::model::{Capabilities, ExternalTournament, ExternalTournamentRef, SyncCursor};
use async_trait::async_trait;
use infra::{CachedDb, Ttl};
use redis::aio::ConnectionManager;
use redis::{AsyncCommands, Script};
use serde::{Deserialize, Serialize};
use sqlx::types::Json;
use uuid::Uuid;

const UNIQUE_VIOLATION: &str = "23505";

/// Durée de vie en cache des liens lus en base (invalidés à chaque écriture).
const LINK_TTL: Ttl = Ttl::from_hours(1);

const LINK_COLUMNS: &str = "id, provider, external_id, reference, event_ids, tournament_id";

/// Ce que PostgreSQL garde d'une source.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct Link {
    id: Uuid,
    provider: String,
    external_id: String,
    reference: ExternalTournamentRef,
    event_ids: Vec<String>,
    tournament_id: Option<Uuid>,
}

type LinkRow = (
    Uuid,
    String,
    String,
    Json<ExternalTournamentRef>,
    Vec<String>,
    Option<Uuid>,
);

fn link(row: LinkRow) -> Link {
    Link {
        id: row.0,
        provider: row.1,
        external_id: row.2,
        reference: row.3.0,
        event_ids: row.4,
        tournament_id: row.5,
    }
}

/// État de synchronisation d'une source, dans Redis. Absent, il vaut l'état d'une source jamais
/// synchronisée et due immédiatement.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
struct State {
    capabilities: Capabilities,
    snapshot: Option<ExternalTournament>,
    cursor: SyncCursor,
    last_attempt_at: Option<i64>,
    last_success_at: Option<i64>,
    last_error: Option<String>,
    consecutive_failures: u32,
    next_sync_at: i64,
}

fn record(link: Link, state: State) -> SourceRecord {
    SourceRecord {
        id: link.id,
        provider: link.provider,
        external_id: link.external_id,
        reference: link.reference,
        event_ids: link.event_ids,
        tournament_id: link.tournament_id,
        capabilities: state.capabilities,
        snapshot: state.snapshot,
        cursor: state.cursor,
        last_attempt_at: state.last_attempt_at,
        last_success_at: state.last_success_at,
        last_error: state.last_error,
        consecutive_failures: state.consecutive_failures,
        next_sync_at: state.next_sync_at,
    }
}

/// Événement en attente, tel que rangé dans `{préfixe}:events`.
#[derive(Deserialize)]
struct Pending {
    id: i64,
    source: Uuid,
    change: ChangeEvent,
}

/// Prend le bail s'il est libre ou échu à `now` (ARGV[1]) jusqu'à `lease_until` (ARGV[2]) ;
/// la clé expire au bout de ARGV[3] secondes, pour qu'un bail orphelin ne bloque pas la source.
const CLAIM: &str = r"
local held = redis.call('GET', KEYS[1])
if held and tonumber(held) > tonumber(ARGV[1]) then return 0 end
redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
return 1
";

/// Écrit l'état (ARGV[2]) et les événements (ARGV[4..]) de la source ARGV[3], et relâche le
/// bail, seulement si le bail vaut toujours ARGV[1]. Les événements sont rangés tels quels :
/// leur JSON n'est pas relu par Lua, il ne peut donc pas être altéré.
const SAVE: &str = r#"
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[2], ARGV[2])
for i = 4, #ARGV do
  local id = redis.call('INCR', KEYS[4])
  redis.call('ZADD', KEYS[3], id,
    '{"id":' .. id .. ',"source":"' .. ARGV[3] .. '","change":' .. ARGV[i] .. '}')
end
redis.call('DEL', KEYS[1])
return 1
"#;

/// Retire de la boîte d'envoi les événements de la source ARGV[1].
const FORGET_EVENTS: &str = r#"
local needle = '"source":"' .. ARGV[1] .. '"'
local removed = 0
for _, member in ipairs(redis.call('ZRANGE', KEYS[1], 0, -1)) do
  if string.find(member, needle, 1, true) then
    redis.call('ZREM', KEYS[1], member)
    removed = removed + 1
  end
end
return removed
"#;

pub struct RedisSyncStore {
    db: CachedDb,
    redis: ConnectionManager,
    prefix: String,
}

impl RedisSyncStore {
    /// `db` : base et cache des liens ; `redis` : état de synchronisation.
    pub fn new(db: CachedDb, redis: ConnectionManager) -> Self {
        Self::with_prefix(db, redis, "sync")
    }

    /// Range les clés sous un autre préfixe (tests qui partagent une instance Redis).
    pub fn with_prefix(db: CachedDb, redis: ConnectionManager, prefix: &str) -> Self {
        RedisSyncStore {
            db,
            redis,
            prefix: prefix.to_string(),
        }
    }

    fn key(&self, kind: &str, id: impl std::fmt::Display) -> String {
        format!("{}:{kind}:{id}", self.prefix)
    }

    fn links_key(&self) -> String {
        format!("{}:links", self.prefix)
    }

    fn events_key(&self) -> String {
        format!("{}:events", self.prefix)
    }

    fn redis(&self) -> ConnectionManager {
        self.redis.clone()
    }

    async fn links(&self) -> Result<Vec<Link>, StoreError> {
        Ok(self
            .db
            .read(&self.links_key(), LINK_TTL, |pool| async move {
                Ok(sqlx::query_as::<_, LinkRow>(&format!(
                    "SELECT {LINK_COLUMNS} FROM external_sources ORDER BY created_at, id"
                ))
                .fetch_all(&pool)
                .await?
                .into_iter()
                .map(link)
                .collect::<Vec<_>>())
            })
            .await?)
    }

    async fn link(&self, id: Uuid) -> Result<Option<Link>, StoreError> {
        Ok(self
            .db
            .read_optional(&self.key("link", id), LINK_TTL, |pool| async move {
                Ok(sqlx::query_as::<_, LinkRow>(&format!(
                    "SELECT {LINK_COLUMNS} FROM external_sources WHERE id = $1"
                ))
                .bind(id)
                .fetch_optional(&pool)
                .await?
                .map(link))
            })
            .await?)
    }

    /// Invalide les liens en cache touchés par une écriture.
    async fn forget_links(&self, id: Uuid, tournament_id: Option<Uuid>) {
        let mut keys = vec![self.links_key(), self.key("link", id)];
        if let Some(tournament_id) = tournament_id {
            keys.push(self.key("link:tournament", tournament_id));
        }
        let keys: Vec<&str> = keys.iter().map(String::as_str).collect();
        self.db.invalidate(&keys).await;
    }

    async fn state(&self, id: Uuid) -> Result<State, StoreError> {
        let bytes: Option<Vec<u8>> = self
            .redis()
            .get(self.key("state", id))
            .await
            .map_err(redis_error)?;
        Ok(parse_state(bytes))
    }

    async fn states(&self, ids: &[Uuid]) -> Result<Vec<State>, StoreError> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        let keys: Vec<String> = ids.iter().map(|id| self.key("state", id)).collect();
        let values: Vec<Option<Vec<u8>>> = self.redis().mget(keys).await.map_err(redis_error)?;
        Ok(values.into_iter().map(parse_state).collect())
    }

    async fn try_claim(&self, id: Uuid, now: i64, lease_secs: i64) -> Result<bool, StoreError> {
        let taken: i32 = Script::new(CLAIM)
            .key(self.key("lease", id))
            .arg(now)
            .arg(now + lease_secs)
            .arg(lease_secs.max(1))
            .invoke_async(&mut self.redis())
            .await
            .map_err(redis_error)?;
        Ok(taken == 1)
    }

    /// Écrit `state` et `changes` si la synchronisation tient encore le bail `lease_until`.
    async fn save(
        &self,
        id: Uuid,
        lease_until: i64,
        state: &State,
        changes: &[ChangeEvent],
    ) -> Result<(), StoreError> {
        let save = Script::new(SAVE);
        let mut script = save.prepare_invoke();
        script
            .key(self.key("lease", id))
            .key(self.key("state", id))
            .key(self.events_key())
            .key(format!("{}:seq", self.events_key()))
            .arg(lease_until)
            .arg(to_json(state)?)
            .arg(id.to_string());
        for change in changes {
            script.arg(to_json(change)?);
        }
        let owned: i32 = script
            .invoke_async(&mut self.redis())
            .await
            .map_err(redis_error)?;
        if owned == 1 {
            Ok(())
        } else {
            Err(StoreError::LeaseLost)
        }
    }
}

fn parse_state(bytes: Option<Vec<u8>>) -> State {
    // Un état illisible (format changé) vaut un état absent : la source sera resynchronisée.
    bytes
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

fn to_json<T: Serialize>(value: &T) -> Result<String, StoreError> {
    serde_json::to_string(value).map_err(|err| StoreError::Other(err.to_string()))
}

fn redis_error(err: redis::RedisError) -> StoreError {
    StoreError::Other(format!("redis : {err}"))
}

#[async_trait]
impl SyncStore for RedisSyncStore {
    async fn register(
        &self,
        source: NewSource,
        now: i64,
    ) -> Result<(SourceRecord, bool), StoreError> {
        let reference = &source.reference;
        let inserted = sqlx::query_as::<_, LinkRow>(&format!(
            "INSERT INTO external_sources \
               (provider, external_id, reference, event_ids, tournament_id) \
             VALUES ($1, $2, $3, $4, $5) \
             ON CONFLICT (provider, external_id) DO NOTHING RETURNING {LINK_COLUMNS}"
        ))
        .bind(&reference.provider)
        .bind(&reference.external_id)
        .bind(Json(reference))
        .bind(&source.event_ids)
        .bind(source.tournament_id)
        .fetch_optional(self.db.pool())
        .await
        .map_err(|err| match &err {
            sqlx::Error::Database(db) if db.code().as_deref() == Some(UNIQUE_VIOLATION) => {
                StoreError::Conflict
            }
            _ => err.into(),
        })?;
        if let Some(row) = inserted {
            let link = link(row);
            self.forget_links(link.id, link.tournament_id).await;
            let state = State {
                next_sync_at: now,
                ..State::default()
            };
            let _: () = self
                .redis()
                .set(self.key("state", link.id), to_json(&state)?)
                .await
                .map_err(redis_error)?;
            return Ok((record(link, state), true));
        }
        let existing = sqlx::query_as::<_, LinkRow>(&format!(
            "SELECT {LINK_COLUMNS} FROM external_sources WHERE provider = $1 AND external_id = $2"
        ))
        .bind(&reference.provider)
        .bind(&reference.external_id)
        .fetch_one(self.db.pool())
        .await
        .map(link)?;
        if source.tournament_id.is_some() && existing.tournament_id != source.tournament_id {
            return Err(StoreError::Conflict);
        }
        let state = self.state(existing.id).await?;
        Ok((record(existing, state), false))
    }

    async fn delete(&self, id: Uuid) -> Result<bool, StoreError> {
        let removed = sqlx::query_scalar::<_, Option<Uuid>>(
            "DELETE FROM external_sources WHERE id = $1 RETURNING tournament_id",
        )
        .bind(id)
        .fetch_optional(self.db.pool())
        .await?;
        let Some(tournament_id) = removed else {
            return Ok(false);
        };
        self.forget_links(id, tournament_id).await;
        let _: () = self
            .redis()
            .del(&[self.key("state", id), self.key("lease", id)])
            .await
            .map_err(redis_error)?;
        let _: i64 = Script::new(FORGET_EVENTS)
            .key(self.events_key())
            .arg(id.to_string())
            .invoke_async(&mut self.redis())
            .await
            .map_err(redis_error)?;
        Ok(true)
    }

    async fn find(&self, id: Uuid) -> Result<Option<SourceRecord>, StoreError> {
        let Some(link) = self.link(id).await? else {
            return Ok(None);
        };
        let state = self.state(id).await?;
        Ok(Some(record(link, state)))
    }

    async fn find_by_tournament(
        &self,
        tournament_id: Uuid,
    ) -> Result<Option<SourceRecord>, StoreError> {
        // L'absence est mise en cache elle aussi : chaque écriture sur un tournoi demande s'il
        // est importé. L'enregistrement d'une source invalide cette entrée.
        let source: Option<Uuid> = self
            .db
            .read(
                &self.key("link:tournament", tournament_id),
                LINK_TTL,
                |pool| async move {
                    sqlx::query_scalar("SELECT id FROM external_sources WHERE tournament_id = $1")
                        .bind(tournament_id)
                        .fetch_optional(&pool)
                        .await
                },
            )
            .await?;
        match source {
            Some(id) => self.find(id).await,
            None => Ok(None),
        }
    }

    async fn list(&self) -> Result<Vec<SourceRecord>, StoreError> {
        let links = self.links().await?;
        let ids: Vec<Uuid> = links.iter().map(|l| l.id).collect();
        let states = self.states(&ids).await?;
        Ok(links
            .into_iter()
            .zip(states)
            .map(|(l, s)| record(l, s))
            .collect())
    }

    async fn claim_due(
        &self,
        now: i64,
        limit: u32,
        lease_secs: i64,
    ) -> Result<Vec<SourceRecord>, StoreError> {
        let mut due: Vec<SourceRecord> = self
            .list()
            .await?
            .into_iter()
            .filter(|r| r.next_sync_at <= now)
            .collect();
        due.sort_by_key(|r| r.next_sync_at);
        let mut claimed = Vec::new();
        for record in due {
            if claimed.len() >= limit as usize {
                break;
            }
            // Prise atomique : deux planificateurs ne prennent jamais la même source.
            if self.try_claim(record.id, now, lease_secs).await? {
                claimed.push(record);
            }
        }
        Ok(claimed)
    }

    async fn claim(
        &self,
        id: Uuid,
        now: i64,
        lease_secs: i64,
    ) -> Result<Option<SourceRecord>, StoreError> {
        let Some(link) = self.link(id).await? else {
            return Ok(None);
        };
        if !self.try_claim(id, now, lease_secs).await? {
            return Ok(None);
        }
        let state = self.state(id).await?;
        Ok(Some(record(link, state)))
    }

    async fn save_success(
        &self,
        id: Uuid,
        lease_until: i64,
        success: Success,
        changes: &[ChangeEvent],
    ) -> Result<(), StoreError> {
        let state = State {
            capabilities: success.capabilities,
            snapshot: Some(success.snapshot),
            cursor: success.cursor,
            last_attempt_at: Some(success.now),
            last_success_at: Some(success.now),
            last_error: None,
            consecutive_failures: 0,
            next_sync_at: success.next_sync_at,
        };
        self.save(id, lease_until, &state, changes).await
    }

    async fn save_failure(
        &self,
        id: Uuid,
        lease_until: i64,
        error: &str,
        now: i64,
        next_sync_at: i64,
    ) -> Result<(), StoreError> {
        // Le bail garantit qu'aucune autre synchronisation n'écrit cet état entre-temps.
        let mut state = self.state(id).await?;
        state.last_attempt_at = Some(now);
        state.last_error = Some(error.chars().take(1000).collect());
        state.consecutive_failures = state.consecutive_failures.saturating_add(1);
        state.next_sync_at = next_sync_at;
        self.save(id, lease_until, &state, &[]).await
    }

    async fn pending_changes(
        &self,
        limit: u32,
    ) -> Result<Vec<(i64, Uuid, ChangeEvent)>, StoreError> {
        if limit == 0 {
            return Ok(Vec::new());
        }
        let members: Vec<String> = self
            .redis()
            .zrange(self.events_key(), 0, limit as isize - 1)
            .await
            .map_err(redis_error)?;
        members
            .iter()
            .map(|member| {
                let pending: Pending = serde_json::from_str(member)
                    .map_err(|err| StoreError::Other(err.to_string()))?;
                Ok((pending.id, pending.source, pending.change))
            })
            .collect()
    }

    async fn mark_processed(&self, ids: &[i64]) -> Result<(), StoreError> {
        if ids.is_empty() {
            return Ok(());
        }
        let mut pipe = redis::pipe();
        for id in ids {
            pipe.zrembyscore(self.events_key(), id, id).ignore();
        }
        let _: () = pipe
            .query_async(&mut self.redis())
            .await
            .map_err(redis_error)?;
        Ok(())
    }
}
