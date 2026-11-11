//! [`SyncStore`] en mémoire, pour les tests et le développement.

use super::{ChangeEvent, NewSource, SourceRecord, StoreError, Success, SyncStore};
use crate::model::{Capabilities, SyncCursor};
use async_trait::async_trait;
use std::sync::Mutex;
use uuid::Uuid;

#[derive(Default)]
struct State {
    sources: Vec<(SourceRecord, Option<i64>)>,
    events: Vec<(i64, Uuid, ChangeEvent, bool)>,
}

#[derive(Default)]
pub struct MemorySyncStore {
    state: Mutex<State>,
}

impl MemorySyncStore {
    pub fn new() -> Self {
        Self::default()
    }

    fn state(&self) -> std::sync::MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }
}

fn free(lease: Option<i64>, now: i64) -> bool {
    lease.is_none_or(|until| until <= now)
}

#[async_trait]
impl SyncStore for MemorySyncStore {
    async fn register(
        &self,
        source: NewSource,
        now: i64,
    ) -> Result<(SourceRecord, bool), StoreError> {
        let mut state = self.state();
        let reference = &source.reference;
        if let Some((existing, _)) = state.sources.iter().find(|(s, _)| {
            s.provider == reference.provider && s.external_id == reference.external_id
        }) {
            if source.tournament_id.is_some() && existing.tournament_id != source.tournament_id {
                return Err(StoreError::Conflict);
            }
            return Ok((existing.clone(), false));
        }
        if source.tournament_id.is_some()
            && state
                .sources
                .iter()
                .any(|(s, _)| s.tournament_id == source.tournament_id)
        {
            return Err(StoreError::Conflict);
        }
        let record = SourceRecord {
            id: Uuid::new_v4(),
            provider: source.reference.provider.clone(),
            external_id: source.reference.external_id.clone(),
            reference: source.reference,
            event_ids: source.event_ids,
            tournament_id: source.tournament_id,
            capabilities: Capabilities::default(),
            snapshot: None,
            cursor: SyncCursor::default(),
            last_attempt_at: None,
            last_success_at: None,
            last_error: None,
            consecutive_failures: 0,
            next_sync_at: now,
        };
        state.sources.push((record.clone(), None));
        Ok((record, true))
    }

    async fn find(&self, id: Uuid) -> Result<Option<SourceRecord>, StoreError> {
        Ok(self
            .state()
            .sources
            .iter()
            .find(|(s, _)| s.id == id)
            .map(|(s, _)| s.clone()))
    }

    async fn find_by_tournament(
        &self,
        tournament_id: Uuid,
    ) -> Result<Option<SourceRecord>, StoreError> {
        Ok(self
            .state()
            .sources
            .iter()
            .find(|(s, _)| s.tournament_id == Some(tournament_id))
            .map(|(s, _)| s.clone()))
    }

    async fn list(&self) -> Result<Vec<SourceRecord>, StoreError> {
        Ok(self
            .state()
            .sources
            .iter()
            .map(|(s, _)| s.clone())
            .collect())
    }

    async fn claim_due(
        &self,
        now: i64,
        limit: u32,
        lease_secs: i64,
    ) -> Result<Vec<SourceRecord>, StoreError> {
        let mut state = self.state();
        let mut claimed = Vec::new();
        for (source, lease) in state.sources.iter_mut() {
            if claimed.len() as u32 >= limit {
                break;
            }
            if source.next_sync_at <= now && free(*lease, now) {
                *lease = Some(now + lease_secs);
                claimed.push(source.clone());
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
        let mut state = self.state();
        Ok(state
            .sources
            .iter_mut()
            .find(|(s, lease)| s.id == id && free(*lease, now))
            .map(|(s, lease)| {
                *lease = Some(now + lease_secs);
                s.clone()
            }))
    }

    async fn save_success(
        &self,
        id: Uuid,
        success: Success,
        changes: &[ChangeEvent],
    ) -> Result<(), StoreError> {
        let mut state = self.state();
        let Some((source, lease)) = state.sources.iter_mut().find(|(s, _)| s.id == id) else {
            return Ok(());
        };
        source.snapshot = Some(success.snapshot);
        source.capabilities = success.capabilities;
        source.cursor = success.cursor;
        source.last_attempt_at = Some(success.now);
        source.last_success_at = Some(success.now);
        source.last_error = None;
        source.consecutive_failures = 0;
        source.next_sync_at = success.next_sync_at;
        *lease = None;
        let first = state.events.len() as i64 + 1;
        for (event_id, change) in (first..).zip(changes) {
            state.events.push((event_id, id, change.clone(), false));
        }
        Ok(())
    }

    async fn save_failure(
        &self,
        id: Uuid,
        error: &str,
        now: i64,
        next_sync_at: i64,
    ) -> Result<(), StoreError> {
        if let Some((source, lease)) = self.state().sources.iter_mut().find(|(s, _)| s.id == id) {
            source.last_attempt_at = Some(now);
            source.last_error = Some(error.to_string());
            source.consecutive_failures += 1;
            source.next_sync_at = next_sync_at;
            *lease = None;
        }
        Ok(())
    }

    async fn pending_changes(
        &self,
        limit: u32,
    ) -> Result<Vec<(i64, Uuid, ChangeEvent)>, StoreError> {
        Ok(self
            .state()
            .events
            .iter()
            .filter(|(.., processed)| !processed)
            .take(limit as usize)
            .map(|(id, source, change, _)| (*id, *source, change.clone()))
            .collect())
    }

    async fn mark_processed(&self, ids: &[i64]) -> Result<(), StoreError> {
        for event in self.state().events.iter_mut() {
            if ids.contains(&event.0) {
                event.3 = true;
            }
        }
        Ok(())
    }

    async fn delete(&self, id: Uuid) -> Result<bool, StoreError> {
        let mut state = self.state();
        let before = state.sources.len();
        state.sources.retain(|(s, _)| s.id != id);
        state.events.retain(|(_, source, ..)| *source != id);
        Ok(state.sources.len() != before)
    }
}
