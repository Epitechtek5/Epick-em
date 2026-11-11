//! Synchronisation commune à toutes les sources : enregistrement d'un tournoi externe,
//! instantanés, curseurs, état de fraîcheur, et événements de changement de résultat.
//!
//! - **Identité :** une source est unique par `(fournisseur, identifiant externe)` : importer
//!   deux fois le même tournoi renvoie l'enregistrement existant ;
//! - **une seule synchronisation à la fois** par source : un bail (`lease`) est pris en base
//!   avant d'appeler la source, et relâché à la fin ;
//! - **incrémental** quand la source le permet (curseur persistant), sinon instantané complet ;
//!   le résultat est fusionné dans le dernier instantané réussi ([`apply_delta`]) ;
//! - **panne :** l'instantané précédent est conservé et reste servi ; l'échec est daté et la
//!   prochaine tentative est repoussée (backoff) ; la reprise est automatique ;
//! - **résultats :** chaque match terminé, corrigé ou rouvert chez la source produit un
//!   [`ChangeEvent`] enregistré dans la même transaction que l'instantané (boîte d'envoi
//!   `external_sync_events`) : les recalculs en aval les consomment exactement une fois, comme
//!   une saisie interne (ADR-002). Rejouer la même synchronisation ne produit aucun événement.

mod memory;
mod postgres;

pub use self::memory::MemorySyncStore;
pub use self::postgres::PgSyncStore;

use crate::connector::{ConnectorError, TournamentConnector};
use crate::model::{
    Capabilities, CompetitionState, ExternalDelta, ExternalMatch, ExternalTournament,
    ExternalTournamentRef, MatchState, SyncCursor,
};
use crate::registry::ConnectorRegistry;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::fmt;
use std::sync::Arc;
use uuid::Uuid;

/// Tournoi externe enregistré.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SourceRecord {
    pub id: Uuid,
    pub provider: String,
    pub external_id: String,
    pub reference: ExternalTournamentRef,
    /// Épreuves importées.
    pub event_ids: Vec<String>,
    /// Tournoi local en lecture seule qui représente la source, s'il existe.
    pub tournament_id: Option<Uuid>,
    /// Capacités effectivement fournies par la source pour ce tournoi.
    pub capabilities: Capabilities,
    /// Dernier instantané réussi.
    pub snapshot: Option<ExternalTournament>,
    pub cursor: SyncCursor,
    /// Secondes Unix.
    pub last_attempt_at: Option<i64>,
    pub last_success_at: Option<i64>,
    pub last_error: Option<String>,
    pub consecutive_failures: u32,
    pub next_sync_at: i64,
}

impl SourceRecord {
    /// Les données affichées viennent d'un instantané plus ancien que la dernière tentative.
    pub fn is_stale(&self) -> bool {
        self.last_error.is_some()
    }
}

/// Nouvelle source à enregistrer.
#[derive(Debug, Clone)]
pub struct NewSource {
    pub reference: ExternalTournamentRef,
    pub event_ids: Vec<String>,
    pub tournament_id: Option<Uuid>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChangeKind {
    /// Match terminé chez la source.
    MatchCompleted,
    /// Résultat d'un match terminé modifié chez la source.
    ResultCorrected,
    /// Match terminé repassé en attente ou en cours chez la source.
    MatchReopened,
    StandingsChanged,
    TournamentStateChanged,
}

impl ChangeKind {
    pub fn as_str(self) -> &'static str {
        match self {
            ChangeKind::MatchCompleted => "match_completed",
            ChangeKind::ResultCorrected => "result_corrected",
            ChangeKind::MatchReopened => "match_reopened",
            ChangeKind::StandingsChanged => "standings_changed",
            ChangeKind::TournamentStateChanged => "tournament_state_changed",
        }
    }
}

/// Changement détecté, à appliquer par les recalculs en aval.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ChangeEvent {
    pub kind: ChangeKind,
    pub event_id: Option<String>,
    pub match_id: Option<String>,
    pub payload: Value,
}

#[derive(Debug)]
pub enum StoreError {
    /// La source est déjà liée à un autre tournoi local, ou le tournoi local à une autre source.
    Conflict,
    Other(String),
}

impl fmt::Display for StoreError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            StoreError::Conflict => f.write_str("source ou tournoi local déjà lié"),
            StoreError::Other(detail) => f.write_str(detail),
        }
    }
}

impl std::error::Error for StoreError {}

impl From<sqlx::Error> for StoreError {
    fn from(err: sqlx::Error) -> Self {
        StoreError::Other(err.to_string())
    }
}

/// Persistance des sources.
#[async_trait]
pub trait SyncStore: Send + Sync {
    /// Enregistre la source, ou renvoie celle qui existe déjà pour `(fournisseur, id)` avec
    /// `false`.
    async fn register(
        &self,
        source: NewSource,
        now: i64,
    ) -> Result<(SourceRecord, bool), StoreError>;

    async fn find(&self, id: Uuid) -> Result<Option<SourceRecord>, StoreError>;

    async fn find_by_tournament(
        &self,
        tournament_id: Uuid,
    ) -> Result<Option<SourceRecord>, StoreError>;

    async fn list(&self) -> Result<Vec<SourceRecord>, StoreError>;

    /// Prend le bail des sources dues (au plus `limit`) pour `lease_secs` secondes ; une source
    /// déjà en cours de synchronisation est ignorée.
    async fn claim_due(
        &self,
        now: i64,
        limit: u32,
        lease_secs: i64,
    ) -> Result<Vec<SourceRecord>, StoreError>;

    /// Prend le bail d'une source précise (synchronisation manuelle) ; `None` si elle est déjà
    /// en cours ou n'existe pas.
    async fn claim(
        &self,
        id: Uuid,
        now: i64,
        lease_secs: i64,
    ) -> Result<Option<SourceRecord>, StoreError>;

    /// Enregistre une synchronisation réussie et ses événements, en une transaction, et relâche
    /// le bail.
    async fn save_success(
        &self,
        id: Uuid,
        success: Success,
        changes: &[ChangeEvent],
    ) -> Result<(), StoreError>;

    /// Enregistre un échec (l'instantané est conservé) et relâche le bail.
    async fn save_failure(
        &self,
        id: Uuid,
        error: &str,
        now: i64,
        next_sync_at: i64,
    ) -> Result<(), StoreError>;

    /// Événements non traités, dans l'ordre.
    async fn pending_changes(
        &self,
        limit: u32,
    ) -> Result<Vec<(i64, Uuid, ChangeEvent)>, StoreError>;

    async fn mark_processed(&self, ids: &[i64]) -> Result<(), StoreError>;

    /// Oublie la source et ses événements ; `false` si elle n'existe pas.
    async fn delete(&self, id: Uuid) -> Result<bool, StoreError>;
}

/// Résultat d'une synchronisation réussie.
#[derive(Debug, Clone)]
pub struct Success {
    pub snapshot: ExternalTournament,
    pub capabilities: Capabilities,
    pub cursor: SyncCursor,
    pub now: i64,
    pub next_sync_at: i64,
}

/// Cadence de synchronisation.
#[derive(Debug, Clone)]
pub struct SyncPolicy {
    /// Tournoi en cours.
    pub active_every: i64,
    /// Tournoi à venir.
    pub upcoming_every: i64,
    /// Tournoi terminé (corrections tardives).
    pub completed_every: i64,
    /// Premier report après un échec, doublé à chaque échec consécutif.
    pub retry_base: i64,
    pub retry_max: i64,
    pub lease_secs: i64,
}

impl Default for SyncPolicy {
    fn default() -> Self {
        SyncPolicy {
            active_every: 120,
            upcoming_every: 30 * 60,
            completed_every: 6 * 60 * 60,
            retry_base: 60,
            retry_max: 60 * 60,
            lease_secs: 10 * 60,
        }
    }
}

impl SyncPolicy {
    pub fn next_after_success(&self, state: CompetitionState, now: i64) -> i64 {
        now + match state {
            CompetitionState::Active => self.active_every,
            CompetitionState::Created => self.upcoming_every,
            CompetitionState::Completed => self.completed_every,
        }
    }

    pub fn next_after_failure(&self, failures: u32, now: i64) -> i64 {
        let factor = 1i64 << failures.min(20);
        now + self.retry_base.saturating_mul(factor).min(self.retry_max)
    }
}

#[derive(Debug)]
pub enum SyncError {
    UnknownProvider(String),
    Connector(ConnectorError),
    Store(StoreError),
    /// Une synchronisation de cette source est déjà en cours.
    Busy,
    NotFound,
}

impl fmt::Display for SyncError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            SyncError::UnknownProvider(id) => write!(f, "source inconnue : {id}"),
            SyncError::Connector(err) => err.fmt(f),
            SyncError::Store(err) => err.fmt(f),
            SyncError::Busy => f.write_str("synchronisation déjà en cours"),
            SyncError::NotFound => f.write_str("source introuvable"),
        }
    }
}

impl std::error::Error for SyncError {}

impl From<StoreError> for SyncError {
    fn from(err: StoreError) -> Self {
        SyncError::Store(err)
    }
}

/// Bilan d'une synchronisation.
#[derive(Debug, Clone, PartialEq)]
pub struct SyncReport {
    pub source_id: Uuid,
    pub ok: bool,
    pub changes: usize,
    pub error: Option<String>,
}

/// Fusionne `delta` dans `previous` et liste les changements de résultats.
pub fn apply_delta(
    previous: Option<&ExternalTournament>,
    delta: ExternalDelta,
) -> Result<(ExternalTournament, Vec<ChangeEvent>), ConnectorError> {
    let next = match (delta, previous) {
        (ExternalDelta::Full { tournament }, _) => tournament,
        (ExternalDelta::Partial { .. }, None) => {
            return Err(ConnectorError::Unavailable(
                "synchronisation incrémentale sans instantané".into(),
            ));
        }
        (
            ExternalDelta::Partial {
                state,
                matches,
                standings,
            },
            Some(previous),
        ) => {
            let mut next = previous.clone();
            next.state = state;
            for (event_id, updated) in matches {
                let Some(event) = next
                    .events
                    .iter_mut()
                    .find(|e| e.reference.external_id == event_id)
                else {
                    continue;
                };
                match event
                    .matches
                    .iter_mut()
                    .find(|m| m.external_id == updated.external_id)
                {
                    Some(existing) => *existing = updated,
                    None => event.matches.push(updated),
                }
            }
            for (event_id, table) in standings {
                if let Some(event) = next
                    .events
                    .iter_mut()
                    .find(|e| e.reference.external_id == event_id)
                {
                    event.standings = table;
                }
            }
            next
        }
    };
    let changes = diff(previous, &next);
    Ok((next, changes))
}

fn match_change(
    event_id: &str,
    before: Option<&ExternalMatch>,
    after: &ExternalMatch,
) -> Option<ChangeEvent> {
    let completed = |m: &ExternalMatch| m.state == MatchState::Completed;
    let kind = match before {
        None if completed(after) => ChangeKind::MatchCompleted,
        None => return None,
        Some(before) if before.outcome() == after.outcome() => return None,
        Some(before) => match (completed(before), completed(after)) {
            (true, true) => ChangeKind::ResultCorrected,
            (true, false) => ChangeKind::MatchReopened,
            (false, true) => ChangeKind::MatchCompleted,
            // Score en cours qui bouge : pas un résultat.
            (false, false) => return None,
        },
    };
    Some(ChangeEvent {
        kind,
        event_id: Some(event_id.to_string()),
        match_id: Some(after.external_id.clone()),
        payload: json!({
            "previous": before.map(|m| json!({
                "state": m.state, "winner": m.winner_entrant_id, "slots": m.slots, "forfeit": m.forfeit,
            })),
            "current": {
                "state": after.state, "winner": after.winner_entrant_id,
                "slots": after.slots, "forfeit": after.forfeit,
            },
        }),
    })
}

/// Changements de résultats entre deux instantanés.
pub fn diff(previous: Option<&ExternalTournament>, next: &ExternalTournament) -> Vec<ChangeEvent> {
    let mut changes = Vec::new();
    if let Some(previous) = previous
        && previous.state != next.state
    {
        changes.push(ChangeEvent {
            kind: ChangeKind::TournamentStateChanged,
            event_id: None,
            match_id: None,
            payload: json!({ "previous": previous.state, "current": next.state }),
        });
    }
    for event in &next.events {
        let id = &event.reference.external_id;
        let before =
            previous.and_then(|p| p.events.iter().find(|e| &e.reference.external_id == id));
        for m in &event.matches {
            let old =
                before.and_then(|b| b.matches.iter().find(|o| o.external_id == m.external_id));
            changes.extend(match_change(id, old, m));
        }
        if before.is_some_and(|b| b.standings != event.standings)
            || (before.is_none() && previous.is_some() && !event.standings.is_empty())
        {
            changes.push(ChangeEvent {
                kind: ChangeKind::StandingsChanged,
                event_id: Some(id.clone()),
                match_id: None,
                payload: json!({ "standings": event.standings }),
            });
        }
    }
    changes
}

/// Import et synchronisation des tournois externes, pour toutes les sources du registre.
#[derive(Clone)]
pub struct SyncService {
    registry: ConnectorRegistry,
    store: Arc<dyn SyncStore>,
    policy: SyncPolicy,
}

impl SyncService {
    pub fn new(registry: ConnectorRegistry, store: Arc<dyn SyncStore>, policy: SyncPolicy) -> Self {
        SyncService {
            registry,
            store,
            policy,
        }
    }

    pub fn registry(&self) -> &ConnectorRegistry {
        &self.registry
    }

    pub fn store(&self) -> &Arc<dyn SyncStore> {
        &self.store
    }

    fn connector(&self, provider: &str) -> Result<Arc<dyn TournamentConnector>, SyncError> {
        self.registry
            .get(provider)
            .ok_or_else(|| SyncError::UnknownProvider(provider.to_string()))
    }

    /// Enregistre la source (idempotent) et fait son premier instantané. Renvoie la source et
    /// `true` si elle vient d'être créée. Un échec du premier instantané laisse la source
    /// enregistrée, en erreur : la synchronisation planifiée reprendra.
    pub async fn import(
        &self,
        source: NewSource,
        now: i64,
    ) -> Result<(SourceRecord, bool), SyncError> {
        self.connector(&source.reference.provider)?;
        let (record, created) = self.store.register(source, now).await?;
        if !created {
            return Ok((record, false));
        }
        let report = self.sync_one(record.id, now).await?;
        let record = self
            .store
            .find(record.id)
            .await?
            .ok_or(SyncError::NotFound)?;
        match report.error {
            None => Ok((record, true)),
            Some(_) => Err(SyncError::Connector(
                record
                    .last_error
                    .clone()
                    .map(ConnectorError::Unavailable)
                    .unwrap_or(ConnectorError::NotFound),
            )),
        }
    }

    /// Synchronise une source maintenant ; [`SyncError::Busy`] si elle l'est déjà.
    pub async fn sync_one(&self, id: Uuid, now: i64) -> Result<SyncReport, SyncError> {
        let record = self
            .store
            .claim(id, now, self.policy.lease_secs)
            .await?
            .ok_or(SyncError::Busy)?;
        Ok(self.run(record, now).await)
    }

    /// Synchronise les sources dues ; appelé périodiquement par api-internal.
    pub async fn run_due(&self, now: i64, limit: u32) -> Result<Vec<SyncReport>, SyncError> {
        let due = self
            .store
            .claim_due(now, limit, self.policy.lease_secs)
            .await?;
        let mut reports = Vec::with_capacity(due.len());
        for record in due {
            reports.push(self.run(record, now).await);
        }
        Ok(reports)
    }

    async fn run(&self, record: SourceRecord, now: i64) -> SyncReport {
        let outcome = self.attempt(&record, now).await;
        let saved = match &outcome {
            Ok((success, changes)) => {
                self.store
                    .save_success(record.id, success.clone(), changes)
                    .await
            }
            Err(err) => {
                let next = self
                    .policy
                    .next_after_failure(record.consecutive_failures, now);
                self.store
                    .save_failure(record.id, &err.to_string(), now, next)
                    .await
            }
        };
        match (outcome, saved) {
            (Ok((_, changes)), Ok(())) => SyncReport {
                source_id: record.id,
                ok: true,
                changes: changes.len(),
                error: None,
            },
            (Err(err), _) => SyncReport {
                source_id: record.id,
                ok: false,
                changes: 0,
                error: Some(err.to_string()),
            },
            (Ok(_), Err(err)) => SyncReport {
                source_id: record.id,
                ok: false,
                changes: 0,
                error: Some(err.to_string()),
            },
        }
    }

    async fn attempt(
        &self,
        record: &SourceRecord,
        now: i64,
    ) -> Result<(Success, Vec<ChangeEvent>), SyncError> {
        let connector = self.connector(&record.provider)?;
        // Sans instantané, le curseur ne vaut rien : instantané complet.
        let cursor = match &record.snapshot {
            Some(_) => record.cursor,
            None => SyncCursor::default(),
        };
        let delta = connector
            .fetch_updates(&record.reference, &record.event_ids, cursor)
            .await
            .map_err(SyncError::Connector)?;
        let (snapshot, changes) =
            apply_delta(record.snapshot.as_ref(), delta).map_err(SyncError::Connector)?;
        let success = Success {
            capabilities: Capabilities::observed(&snapshot, connector.capabilities()),
            cursor: SyncCursor {
                // Le début de cette synchronisation : rien de plus récent n'a pu être manqué.
                updated_after: Some(now),
            },
            next_sync_at: self.policy.next_after_success(snapshot.state, now),
            now,
            snapshot,
        };
        Ok((success, changes))
    }
}

#[cfg(test)]
mod tests;
