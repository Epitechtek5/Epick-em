//! Schéma des événements métier et des messages temps réel (ADR-002).
//!
//! - Un [`Event`] est publié dans le **flux** Redis (`Streams`) par api-public ou par la
//!   synchronisation ; api-internal le consomme dans un groupe de consommateurs, avec
//!   acquittement : un redémarrage ne perd rien. Chaque événement porte un identifiant unique.
//!   Les traitements recalculent à partir de l'état : rejouer un événement ne change rien.
//! - Un [`LiveMessage`] est **diffusé** (Pub/Sub, éphémère) à toutes les instances d'api-public,
//!   qui le relaient aux clients WebSocket abonnés à son [`topic`](LiveMessage::topic). Il ne
//!   porte que de quoi savoir quoi relire : le client relit l'API.
//!
//! Le format JSON est un contrat : un champ s'ajoute, il ne se renomme pas.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

/// Événement métier, versionné par son schéma.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Event {
    /// Identifiant unique : un doublon se reconnaît.
    pub id: Uuid,
    /// Instant de l'événement, en millisecondes Unix.
    pub occurred_at: i64,
    #[serde(flatten)]
    pub kind: EventKind,
}

impl Event {
    pub fn new(id: Uuid, occurred_at: i64, kind: EventKind) -> Self {
        Event {
            id,
            occurred_at,
            kind,
        }
    }

    /// Tournoi concerné.
    pub fn tournament_id(&self) -> Uuid {
        match &self.kind {
            EventKind::TournamentChanged { tournament_id, .. }
            | EventKind::TournamentDeleted { tournament_id } => *tournament_id,
        }
    }
}

/// Origine d'un changement.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChangeCause {
    /// Écriture par l'API (administrateur) : résultat, statut, étape, correction…
    Api,
    /// Nouvel instantané d'une source externe (start.gg…).
    ExternalSync,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum EventKind {
    /// Les données d'un tournoi ont changé (résultats, matchs, étapes, statut…) ; `match_id`
    /// quand un seul match est en cause. Déclenche la résolution des pronostics.
    TournamentChanged {
        tournament_id: Uuid,
        match_id: Option<Uuid>,
        cause: ChangeCause,
    },
    /// Le tournoi a été supprimé.
    TournamentDeleted { tournament_id: Uuid },
}

/// Message temps réel, relayé aux clients abonnés à son sujet.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LiveMessage {
    /// Sujet : [`topics::tournament`] ou [`topics::LEADERBOARD`].
    pub topic: String,
    /// Nature du changement, ex. `tournament.updated`, `leaderboard.updated`.
    pub event: String,
    /// Identifiants utiles pour relire l'API.
    pub data: Value,
}

impl LiveMessage {
    pub fn new(topic: impl Into<String>, event: impl Into<String>, data: Value) -> Self {
        LiveMessage {
            topic: topic.into(),
            event: event.into(),
            data,
        }
    }
}

/// Noms des messages temps réel.
pub mod live {
    /// Données du tournoi modifiées : `{ tournament_id, match_id?, cause }`.
    pub const TOURNAMENT_UPDATED: &str = "tournament.updated";
    /// Tournoi supprimé : `{ tournament_id }`.
    pub const TOURNAMENT_DELETED: &str = "tournament.deleted";
    /// Un pronostic a été posé, changé ou retiré sur un match : `{ tournament_id, match_id }`.
    pub const PREDICTIONS_UPDATED: &str = "predictions.updated";
    /// Points des pronostics recalculés : `{ tournament_id }`.
    pub const LEADERBOARD_UPDATED: &str = "leaderboard.updated";
}

/// Sujets auxquels un client s'abonne.
pub mod topics {
    use uuid::Uuid;

    /// Classement général des spectateurs.
    pub const LEADERBOARD: &str = "leaderboard";

    /// Tout ce qui concerne un tournoi : matchs, résultats, pronostics, classement.
    pub fn tournament(id: Uuid) -> String {
        format!("tournament:{id}")
    }

    /// Le sujet est-il valide ?
    pub fn is_valid(topic: &str) -> bool {
        topic == LEADERBOARD
            || topic
                .strip_prefix("tournament:")
                .is_some_and(|id| id.parse::<Uuid>().is_ok())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn events_have_a_stable_json_shape() {
        let (id, tournament, game) = (Uuid::nil(), Uuid::max(), Uuid::nil());
        let event = Event::new(
            id,
            42,
            EventKind::TournamentChanged {
                tournament_id: tournament,
                match_id: Some(game),
                cause: ChangeCause::ExternalSync,
            },
        );
        let value = serde_json::to_value(&event).unwrap();
        assert_eq!(
            value,
            json!({
                "id": id, "occurred_at": 42, "type": "tournament_changed",
                "tournament_id": tournament, "match_id": game, "cause": "external_sync",
            })
        );
        assert_eq!(serde_json::from_value::<Event>(value).unwrap(), event);
        assert_eq!(event.tournament_id(), tournament);
    }

    #[test]
    fn topics_are_validated() {
        let id = Uuid::new_v4();
        assert!(topics::is_valid(&topics::tournament(id)));
        assert!(topics::is_valid(topics::LEADERBOARD));
        assert!(!topics::is_valid("tournament:abc"));
        assert!(!topics::is_valid("users"));
    }
}
