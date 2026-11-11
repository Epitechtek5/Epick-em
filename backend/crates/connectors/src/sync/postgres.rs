//! [`SyncStore`] sur PostgreSQL (changelog `0017-external-sources`).

use super::{ChangeEvent, NewSource, SourceRecord, StoreError, Success, SyncStore};
use crate::model::SyncCursor;
use async_trait::async_trait;
use sqlx::PgPool;
use sqlx::types::Json;
use uuid::Uuid;

const UNIQUE_VIOLATION: &str = "23505";

const COLUMNS: &str = "id, provider, external_id, reference, event_ids, tournament_id, \
    capabilities, snapshot, cursor, \
    extract(epoch from last_attempt_at)::bigint, extract(epoch from last_success_at)::bigint, \
    last_error, consecutive_failures, extract(epoch from next_sync_at)::bigint";

type Row = (
    Uuid,
    String,
    String,
    Json<crate::model::ExternalTournamentRef>,
    Vec<String>,
    Option<Uuid>,
    Json<crate::model::Capabilities>,
    Option<Json<crate::model::ExternalTournament>>,
    Option<i64>,
    Option<i64>,
    Option<i64>,
    Option<String>,
    i32,
    i64,
);

fn record(row: Row) -> SourceRecord {
    SourceRecord {
        id: row.0,
        provider: row.1,
        external_id: row.2,
        reference: row.3.0,
        event_ids: row.4,
        tournament_id: row.5,
        capabilities: row.6.0,
        snapshot: row.7.map(|s| s.0),
        cursor: SyncCursor {
            updated_after: row.8,
        },
        last_attempt_at: row.9,
        last_success_at: row.10,
        last_error: row.11,
        consecutive_failures: u32::try_from(row.12).unwrap_or(0),
        next_sync_at: row.13,
    }
}

pub struct PgSyncStore {
    pool: PgPool,
}

impl PgSyncStore {
    pub fn new(pool: PgPool) -> Self {
        PgSyncStore { pool }
    }
}

#[async_trait]
impl SyncStore for PgSyncStore {
    async fn register(
        &self,
        source: NewSource,
        now: i64,
    ) -> Result<(SourceRecord, bool), StoreError> {
        let reference = &source.reference;
        let inserted = sqlx::query_as::<_, Row>(&format!(
            "INSERT INTO external_sources \
               (provider, external_id, reference, event_ids, tournament_id, next_sync_at) \
             VALUES ($1, $2, $3, $4, $5, to_timestamp($6)) \
             ON CONFLICT (provider, external_id) DO NOTHING RETURNING {COLUMNS}"
        ))
        .bind(&reference.provider)
        .bind(&reference.external_id)
        .bind(Json(reference))
        .bind(&source.event_ids)
        .bind(source.tournament_id)
        .bind(now as f64)
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| match &err {
            sqlx::Error::Database(db) if db.code().as_deref() == Some(UNIQUE_VIOLATION) => {
                StoreError::Conflict
            }
            _ => err.into(),
        })?;
        if let Some(row) = inserted {
            return Ok((record(row), true));
        }
        let existing = sqlx::query_as::<_, Row>(&format!(
            "SELECT {COLUMNS} FROM external_sources WHERE provider = $1 AND external_id = $2"
        ))
        .bind(&reference.provider)
        .bind(&reference.external_id)
        .fetch_one(&self.pool)
        .await
        .map(record)?;
        if source.tournament_id.is_some() && existing.tournament_id != source.tournament_id {
            return Err(StoreError::Conflict);
        }
        Ok((existing, false))
    }

    async fn delete(&self, id: Uuid) -> Result<bool, StoreError> {
        // Les événements suivent (ON DELETE CASCADE).
        Ok(sqlx::query("DELETE FROM external_sources WHERE id = $1")
            .bind(id)
            .execute(&self.pool)
            .await?
            .rows_affected()
            > 0)
    }

    async fn find(&self, id: Uuid) -> Result<Option<SourceRecord>, StoreError> {
        Ok(sqlx::query_as::<_, Row>(&format!(
            "SELECT {COLUMNS} FROM external_sources WHERE id = $1"
        ))
        .bind(id)
        .fetch_optional(&self.pool)
        .await?
        .map(record))
    }

    async fn find_by_tournament(
        &self,
        tournament_id: Uuid,
    ) -> Result<Option<SourceRecord>, StoreError> {
        Ok(sqlx::query_as::<_, Row>(&format!(
            "SELECT {COLUMNS} FROM external_sources WHERE tournament_id = $1"
        ))
        .bind(tournament_id)
        .fetch_optional(&self.pool)
        .await?
        .map(record))
    }

    async fn list(&self) -> Result<Vec<SourceRecord>, StoreError> {
        Ok(sqlx::query_as::<_, Row>(&format!(
            "SELECT {COLUMNS} FROM external_sources ORDER BY created_at, id"
        ))
        .fetch_all(&self.pool)
        .await?
        .into_iter()
        .map(record)
        .collect())
    }

    async fn claim_due(
        &self,
        now: i64,
        limit: u32,
        lease_secs: i64,
    ) -> Result<Vec<SourceRecord>, StoreError> {
        // SKIP LOCKED : deux planificateurs ne prennent jamais la même source.
        Ok(sqlx::query_as::<_, Row>(&format!(
            "UPDATE external_sources SET lease_until = to_timestamp($1) + $3 * interval '1 second' \
             WHERE id IN ( \
               SELECT id FROM external_sources \
               WHERE next_sync_at <= to_timestamp($1) \
                 AND (lease_until IS NULL OR lease_until <= to_timestamp($1)) \
               ORDER BY next_sync_at LIMIT $2 FOR UPDATE SKIP LOCKED) \
             RETURNING {COLUMNS}"
        ))
        .bind(now as f64)
        .bind(i64::from(limit))
        .bind(lease_secs as f64)
        .fetch_all(&self.pool)
        .await?
        .into_iter()
        .map(record)
        .collect())
    }

    async fn claim(
        &self,
        id: Uuid,
        now: i64,
        lease_secs: i64,
    ) -> Result<Option<SourceRecord>, StoreError> {
        Ok(sqlx::query_as::<_, Row>(&format!(
            "UPDATE external_sources SET lease_until = to_timestamp($2) + $3 * interval '1 second' \
             WHERE id = $1 AND (lease_until IS NULL OR lease_until <= to_timestamp($2)) \
             RETURNING {COLUMNS}"
        ))
        .bind(id)
        .bind(now as f64)
        .bind(lease_secs as f64)
        .fetch_optional(&self.pool)
        .await?
        .map(record))
    }

    async fn save_success(
        &self,
        id: Uuid,
        success: Success,
        changes: &[ChangeEvent],
    ) -> Result<(), StoreError> {
        let mut tx = self.pool.begin().await?;
        sqlx::query(
            "UPDATE external_sources SET snapshot = $2, capabilities = $3, cursor = $4, \
               last_attempt_at = to_timestamp($5), last_success_at = to_timestamp($5), \
               last_error = NULL, consecutive_failures = 0, \
               next_sync_at = to_timestamp($6), lease_until = NULL \
             WHERE id = $1",
        )
        .bind(id)
        .bind(Json(&success.snapshot))
        .bind(Json(&success.capabilities))
        .bind(success.cursor.updated_after)
        .bind(success.now as f64)
        .bind(success.next_sync_at as f64)
        .execute(&mut *tx)
        .await?;
        for change in changes {
            sqlx::query(
                "INSERT INTO external_sync_events (source_id, kind, event_id, match_id, payload) \
                 VALUES ($1, $2, $3, $4, $5)",
            )
            .bind(id)
            .bind(change.kind.as_str())
            .bind(&change.event_id)
            .bind(&change.match_id)
            .bind(Json(&change.payload))
            .execute(&mut *tx)
            .await?;
        }
        tx.commit().await?;
        Ok(())
    }

    async fn save_failure(
        &self,
        id: Uuid,
        error: &str,
        now: i64,
        next_sync_at: i64,
    ) -> Result<(), StoreError> {
        sqlx::query(
            "UPDATE external_sources SET last_attempt_at = to_timestamp($3), last_error = $2, \
               consecutive_failures = consecutive_failures + 1, \
               next_sync_at = to_timestamp($4), lease_until = NULL \
             WHERE id = $1",
        )
        .bind(id)
        .bind(error.chars().take(1000).collect::<String>())
        .bind(now as f64)
        .bind(next_sync_at as f64)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn pending_changes(
        &self,
        limit: u32,
    ) -> Result<Vec<(i64, Uuid, ChangeEvent)>, StoreError> {
        let rows = sqlx::query_as::<
            _,
            (
                i64,
                Uuid,
                String,
                Option<String>,
                Option<String>,
                Json<serde_json::Value>,
            ),
        >(
            "SELECT id, source_id, kind, event_id, match_id, payload FROM external_sync_events \
             WHERE processed_at IS NULL ORDER BY id LIMIT $1",
        )
        .bind(i64::from(limit))
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter()
            .map(|(id, source, kind, event_id, match_id, payload)| {
                let kind = serde_json::from_value(serde_json::Value::String(kind))
                    .map_err(|err| StoreError::Other(err.to_string()))?;
                Ok((
                    id,
                    source,
                    ChangeEvent {
                        kind,
                        event_id,
                        match_id,
                        payload: payload.0,
                    },
                ))
            })
            .collect()
    }

    async fn mark_processed(&self, ids: &[i64]) -> Result<(), StoreError> {
        sqlx::query(
            "UPDATE external_sync_events SET processed_at = now() \
             WHERE id = ANY($1) AND processed_at IS NULL",
        )
        .bind(ids)
        .execute(&self.pool)
        .await?;
        Ok(())
    }
}
