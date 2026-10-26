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

/// Équipe globale à créer ou à mettre à jour (par jeu et nom) depuis un fichier d'import, avec
/// tous ses membres, anciens compris.
#[derive(Debug, Clone)]
pub struct TeamImport {
    pub game_id: Uuid,
    pub name: String,
    pub tag: Option<String>,
    pub picture_url: Option<String>,
    pub owner_id: Uuid,
    pub members: Vec<MemberImport>,
}

/// Appartenance importée : horodatages RFC 3339 en UTC à six décimales, `joined_at` valant
/// l'instant présent s'il est absent.
#[derive(Debug, Clone)]
pub struct MemberImport {
    pub user_id: Uuid,
    pub role: TeamRole,
    pub joined_at: Option<String>,
    pub left_at: Option<String>,
}

/// Instant présent au format des horodatages de l'API (`2026-10-26T14:03:09.123456Z`), pour le
/// store en mémoire ; PostgreSQL produit le même format.
pub(super) fn now_rfc3339() -> String {
    let since_epoch = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let secs = since_epoch.as_secs();
    let (days, rest) = (secs / 86_400, secs % 86_400);
    // Date civile depuis le nombre de jours écoulés depuis 1970 (algorithme de H. Hinnant).
    let z = days as i64 + 719_468;
    let era = z.div_euclid(146_097);
    let day_of_era = z.rem_euclid(146_097);
    let year_of_era =
        (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_index = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_index + 2) / 5 + 1;
    let month = if month_index < 10 {
        month_index + 3
    } else {
        month_index - 9
    };
    let year = year_of_era + era * 400 + i64::from(month <= 2);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{:06}Z",
        rest / 3600,
        rest % 3600 / 60,
        rest % 60,
        since_epoch.subsec_micros()
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timestamp_has_the_postgres_shape() {
        let now = now_rfc3339();
        assert_eq!(now.len(), 27, "{now}");
        assert!(now.starts_with("20") && now.ends_with('Z'), "{now}");
        assert_eq!(&now[10..11], "T");
    }
}
