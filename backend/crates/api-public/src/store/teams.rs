//! Types des équipes (tables `teams`, `team_member`, `tournament_teams` et
//! `tournament_team_member`).

use serde::{Deserialize, Serialize};
use std::str::FromStr;
use utoipa::ToSchema;
use uuid::Uuid;

use super::StoreError;

/// Rôle d'un membre dans une équipe. Chaque équipe a exactement un `Owner`, le seul à pouvoir la
/// modifier ou la supprimer.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum TeamRole {
    Owner,
    Member,
    Substitute,
}

impl TeamRole {
    pub fn as_str(self) -> &'static str {
        match self {
            TeamRole::Owner => "owner",
            TeamRole::Member => "member",
            TeamRole::Substitute => "substitute",
        }
    }
}

impl FromStr for TeamRole {
    type Err = StoreError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "owner" => Ok(TeamRole::Owner),
            "member" => Ok(TeamRole::Member),
            "substitute" => Ok(TeamRole::Substitute),
            other => Err(StoreError::Other(format!(
                "rôle d'équipe inconnu : {other}"
            ))),
        }
    }
}

/// Équipe globale : liée à un jeu, elle existe au-delà d'un tournoi.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct Team {
    pub id: Uuid,
    pub game_id: Uuid,
    #[schema(example = "Karmine Corp")]
    pub name: String,
    #[schema(example = "KC")]
    pub tag: Option<String>,
    /// URL de la photo de profil.
    pub picture_url: Option<String>,
    /// Compte propriétaire, seul autorisé à modifier ou supprimer l'équipe.
    pub owner_id: Uuid,
    /// Horodatage RFC 3339 en UTC.
    pub created_at: String,
    pub updated_at: String,
}

/// Équipe globale à créer ; le propriétaire en devient le premier membre (`owner`).
#[derive(Debug, Clone)]
pub struct TeamInput {
    pub game_id: Uuid,
    pub name: String,
    pub tag: Option<String>,
    pub picture_url: Option<String>,
    pub owner_id: Uuid,
}

/// Modification partielle d'une équipe : seuls les champs renseignés changent ; `Some(None)`
/// efface une valeur facultative.
#[derive(Debug, Default, Clone)]
pub struct TeamUpdate {
    pub name: Option<String>,
    pub tag: Option<Option<String>>,
    pub picture_url: Option<Option<String>>,
}

/// Appartenance d'un compte à une équipe globale ; un départ garde la ligne (`left_at`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct TeamMember {
    pub user_id: Uuid,
    pub role: TeamRole,
    /// Horodatage RFC 3339 en UTC.
    pub joined_at: String,
    /// Renseigné quand le membre a quitté l'équipe.
    pub left_at: Option<String>,
}

/// Équipe créée pour un seul tournoi. Copie indépendante : modifier l'équipe globale d'origine
/// (`team_id`) ne la modifie pas, et inversement.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct TournamentTeam {
    pub id: Uuid,
    pub tournament_id: Uuid,
    /// Équipe globale copiée ; `null` si créée de zéro ou si l'équipe globale a été supprimée.
    pub team_id: Option<Uuid>,
    pub name: String,
    pub tag: Option<String>,
    pub picture_url: Option<String>,
    pub owner_id: Uuid,
    /// Horodatage RFC 3339 en UTC.
    pub created_at: String,
}

/// Équipe de tournoi à créer, avec ses membres (le propriétaire en fait partie, `owner`).
#[derive(Debug, Clone)]
pub struct TournamentTeamInput {
    pub tournament_id: Uuid,
    pub team_id: Option<Uuid>,
    pub name: String,
    pub tag: Option<String>,
    pub picture_url: Option<String>,
    pub owner_id: Uuid,
    pub members: Vec<(Uuid, TeamRole)>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct TournamentTeamMember {
    pub user_id: Uuid,
    pub role: TeamRole,
}
