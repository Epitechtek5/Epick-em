//! Événements d'inscription et de pointage, à destination du moteur de notifications (#141).
//!
//! Le moteur n'existe pas encore : les handlers publient ici des [`TournamentEvent`] vers un
//! [`EventSink`], qui ne fait rien par défaut. Le moteur n'aura qu'à fournir son implémentation
//! (`AppState::with_events`) ; les tests utilisent [`MemoryEvents`].

use std::sync::Mutex;
use uuid::Uuid;

/// Ce qui s'est passé pour un inscrit.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EventKind {
    /// Inscription acceptée d'office.
    Registered,
    /// Inscription en attente d'approbation.
    PendingApproval,
    Approved,
    Rejected,
    /// Placé sur liste d'attente (capacité atteinte).
    Waitlisted,
    /// Promu de la liste d'attente.
    Promoted,
    CheckedIn,
    /// Marqué absent à la clôture du pointage.
    Absent,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TournamentEvent {
    pub kind: EventKind,
    pub tournament_id: Uuid,
    pub participant_id: Uuid,
    /// Joueur concerné ; `None` pour une équipe (voir `tournament_team_id`).
    pub user_id: Option<Uuid>,
    pub tournament_team_id: Option<Uuid>,
}

/// Destination des événements ; ne doit ni bloquer ni échouer.
pub trait EventSink: Send + Sync {
    fn publish(&self, event: TournamentEvent);
}

/// Par défaut : les événements sont ignorés.
pub struct NoopEvents;

impl EventSink for NoopEvents {
    fn publish(&self, _event: TournamentEvent) {}
}

/// Conserve les événements en mémoire, pour les tests.
#[derive(Default)]
pub struct MemoryEvents {
    events: Mutex<Vec<TournamentEvent>>,
}

impl MemoryEvents {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn events(&self) -> Vec<TournamentEvent> {
        self.events
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }
}

impl EventSink for MemoryEvents {
    fn publish(&self, event: TournamentEvent) {
        self.events
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .push(event);
    }
}
