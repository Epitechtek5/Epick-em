//! Types des invitations (tables `invitations` et `invitation_events`).
//!
//! Une invitation vise une équipe globale, une équipe de tournoi ou un tournoi. Elle s'adresse à
//! un compte (`recipient_id`) ou se partage par lien : seule l'empreinte du jeton du lien est
//! stockée. Cycle de vie : `pending` → `accepted`, `declined`, `revoked` ou `expired`.

use serde::{Deserialize, Serialize};
use std::str::FromStr;
use std::time::Duration;
use utoipa::ToSchema;
use uuid::Uuid;

use super::tournaments::text_enum;
use super::{StoreError, TeamRole};

text_enum! {
    /// Ressource à laquelle l'invitation donne accès.
    InvitationType, "type d'invitation", {
        Team => "team",
        TournamentTeam => "tournament_team",
        Tournament => "tournament",
    }
}

text_enum! {
    /// Statut d'une invitation ; seul `pending` peut encore changer.
    InvitationStatus, "statut d'invitation", {
        Pending => "pending",
        Accepted => "accepted",
        Declined => "declined",
        Revoked => "revoked",
        Expired => "expired",
    }
}

text_enum! {
    /// Fait tracé dans l'historique d'une invitation.
    InvitationEventKind, "événement d'invitation", {
        Created => "created",
        Accepted => "accepted",
        Declined => "declined",
        Revoked => "revoked",
        Expired => "expired",
    }
}

/// Invitation, sans jamais l'empreinte ni la valeur du jeton de son lien.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct Invitation {
    pub id: Uuid,
    #[serde(rename = "type")]
    pub kind: InvitationType,
    /// Équipe, équipe de tournoi ou tournoi visé selon `type`.
    pub resource_id: Uuid,
    pub inviter_id: Uuid,
    /// Compte invité ; `null` pour une invitation par lien.
    pub recipient_id: Option<Uuid>,
    /// Rôle attribué (`member` ou `substitute`) pour une équipe ou une équipe de tournoi.
    pub role: Option<TeamRole>,
    pub status: InvitationStatus,
    /// `true` pour une invitation par lien partageable.
    pub is_link: bool,
    /// Nombre maximal d'acceptations d'un lien ; `null` pour une invitation à un compte ou un
    /// lien sans limite.
    pub max_uses: Option<i32>,
    /// Nombre d'acceptations déjà enregistrées.
    pub uses: i32,
    /// Horodatages RFC 3339 en UTC.
    pub expires_at: String,
    pub created_at: String,
    pub updated_at: String,
    /// Instant où l'invitation a quitté le statut `pending`.
    pub responded_at: Option<String>,
}

/// Invitation à créer.
#[derive(Debug, Clone)]
pub struct InvitationInput {
    pub kind: InvitationType,
    pub resource_id: Uuid,
    pub inviter_id: Uuid,
    pub recipient_id: Option<Uuid>,
    pub role: Option<TeamRole>,
    /// Empreinte du jeton du lien ; renseignée si et seulement si `recipient_id` ne l'est pas.
    pub token_hash: Option<String>,
    pub max_uses: Option<i32>,
    pub ttl: Duration,
}

/// Ligne de l'historique d'une invitation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct InvitationEvent {
    pub kind: InvitationEventKind,
    /// Auteur du fait ; `null` pour une expiration.
    pub actor_id: Option<Uuid>,
    pub created_at: String,
}

/// Réponse à une invitation, appliquée en une seule opération atomique.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InvitationAction {
    /// Le compte `actor` accepte : son adhésion ou son inscription est créée.
    Accept,
    Decline,
    Revoke,
}

/// Critères de la liste des invitations.
#[derive(Debug, Default, Clone)]
pub struct InvitationFilter {
    pub recipient_id: Option<Uuid>,
    pub inviter_id: Option<Uuid>,
    pub status: Option<InvitationStatus>,
    pub kind: Option<InvitationType>,
    pub limit: i64,
    pub offset: i64,
}

/// Le tournoi accepte-t-il des inscriptions à l'instant `now` (statut `registration` et fenêtre
/// d'inscription) ? Les horodatages sont normalisés : ils se comparent comme des chaînes.
pub(crate) fn registration_open(
    status: super::TournamentStatus,
    open_at: Option<&str>,
    close_at: Option<&str>,
    now: &str,
) -> bool {
    status == super::TournamentStatus::Registration
        && open_at.is_none_or(|open| now >= open)
        && close_at.is_none_or(|close| now <= close)
}

/// Rôle lu dans les métadonnées d'une invitation.
pub(crate) fn role_of(metadata: &serde_json::Value) -> Result<Option<TeamRole>, StoreError> {
    metadata
        .get("role")
        .and_then(|role| role.as_str())
        .map(str::parse)
        .transpose()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::TournamentStatus;

    #[test]
    fn registration_window() {
        let open = Some("2026-01-01T00:00:00.000000Z");
        let close = Some("2026-02-01T00:00:00.000000Z");
        let now = "2026-01-15T00:00:00.000000Z";
        assert!(registration_open(
            TournamentStatus::Registration,
            open,
            close,
            now
        ));
        assert!(!registration_open(
            TournamentStatus::Draft,
            open,
            close,
            now
        ));
        assert!(!registration_open(
            TournamentStatus::Registration,
            close,
            None,
            now
        ));
        assert!(!registration_open(
            TournamentStatus::Registration,
            None,
            open,
            now
        ));
    }

    #[test]
    fn role_comes_from_metadata() {
        let metadata = serde_json::json!({"role": "substitute"});
        assert_eq!(role_of(&metadata).unwrap(), Some(TeamRole::Substitute));
        assert_eq!(role_of(&serde_json::json!({})).unwrap(), None);
        assert!(role_of(&serde_json::json!({"role": "boss"})).is_err());
    }
}
