//! Types des tournois (tables `tournaments`, `tournament_participant` et `scoring_rule`).

use serde::{Deserialize, Serialize};
use std::str::FromStr;
use utoipa::ToSchema;
use uuid::Uuid;

use super::StoreError;

/// Définit une énumération stockée en texte dans PostgreSQL, avec `as_str` et `FromStr`.
macro_rules! text_enum {
    ($(#[$meta:meta])* $name:ident, $label:literal, { $($variant:ident => $text:literal),+ $(,)? }) => {
        $(#[$meta])*
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
        #[serde(rename_all = "snake_case")]
        pub enum $name {
            $($variant),+
        }

        impl $name {
            pub fn as_str(self) -> &'static str {
                match self {
                    $($name::$variant => $text),+
                }
            }
        }

        impl FromStr for $name {
            type Err = StoreError;

            fn from_str(value: &str) -> Result<Self, Self::Err> {
                match value {
                    $($text => Ok($name::$variant),)+
                    other => Err(StoreError::Other(format!("{} inconnu : {other}", $label))),
                }
            }
        }
    };
}

text_enum! {
    /// Qui s'inscrit : des joueurs un par un, ou des équipes.
    ParticipantType, "type de participant", { Solo => "solo", Team => "team" }
}

text_enum! {
    /// Agrégation des scores des joueurs d'une équipe pour le classement des équipes.
    TeamScoringMode, "mode de score d'équipe", {
        None => "none",
        Sum => "sum",
        Best => "best",
        TopN => "top_n",
    }
}

text_enum! {
    /// Cycle de vie d'un tournoi ; le barème et les étapes sont verrouillés dès `Ongoing`.
    TournamentStatus, "statut de tournoi", {
        Draft => "draft",
        Registration => "registration",
        Ongoing => "ongoing",
        Finished => "finished",
        Cancelled => "cancelled",
    }
}

text_enum! {
    /// Situation d'un inscrit dans le tournoi.
    ParticipantStatus, "statut de participant", {
        Registered => "registered",
        CheckedIn => "checked_in",
        Disqualified => "disqualified",
        Withdrawn => "withdrawn",
    }
}

text_enum! {
    /// Conversion de la valeur d'une statistique en points.
    ScoringMode, "mode de barème", { Linear => "linear", Table => "table" }
}

/// Tournoi d'un jeu.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct Tournament {
    pub id: Uuid,
    pub game_id: Uuid,
    #[schema(example = "TFT Open")]
    pub name: String,
    pub description: Option<String>,
    /// Horodatages RFC 3339 en UTC.
    pub start_date: String,
    pub end_date: String,
    pub registration_open_at: Option<String>,
    pub registration_close_at: Option<String>,
    pub participant_type: ParticipantType,
    /// Joueurs par équipe, renseigné si et seulement si `participant_type` vaut `team`.
    pub team_size: Option<i32>,
    /// Égal à `group_count × group_size` de l'étape 1.
    pub max_participants: i32,
    pub team_scoring_mode: TeamScoringMode,
    /// Nombre de meilleurs scores retenus, renseigné si et seulement si le mode vaut `top_n`.
    pub team_scoring_n: Option<i32>,
    pub status: TournamentStatus,
    pub created_at: String,
    pub updated_at: String,
}

/// Tournoi à créer ; il démarre toujours au statut `draft`.
#[derive(Debug, Clone)]
pub struct TournamentInput {
    pub game_id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub start_date: String,
    pub end_date: String,
    pub registration_open_at: Option<String>,
    pub registration_close_at: Option<String>,
    pub participant_type: ParticipantType,
    pub team_size: Option<i32>,
    pub max_participants: i32,
    pub team_scoring_mode: TeamScoringMode,
    pub team_scoring_n: Option<i32>,
}

/// Inscrit à un tournoi : un joueur (`user_id`), une équipe de tournoi (`tournament_team_id`), ou
/// un joueur qui marque pour son équipe (les deux).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct TournamentParticipant {
    pub id: Uuid,
    pub tournament_id: Uuid,
    pub user_id: Option<Uuid>,
    pub tournament_team_id: Option<Uuid>,
    pub status: ParticipantStatus,
    /// Horodatage RFC 3339 en UTC.
    pub registered_at: String,
}

/// Barème d'une statistique : `linear` donne `valeur × coefficient`, `table` associe une valeur
/// à des points (ex. `{"1": 8, "2": 7}`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct ScoringRule {
    pub id: Uuid,
    pub tournament_id: Uuid,
    pub stat_id: Uuid,
    pub mode: ScoringMode,
    /// Renseigné si et seulement si `mode` vaut `linear`.
    pub coefficient: Option<f64>,
    /// Renseigné si et seulement si `mode` vaut `table`.
    #[schema(value_type = Option<Object>, example = json!({"1": 8, "2": 7}))]
    pub points_table: Option<serde_json::Value>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn enums_round_trip_through_their_database_text() {
        for status in ["draft", "registration", "ongoing", "finished", "cancelled"] {
            assert_eq!(status.parse::<TournamentStatus>().unwrap().as_str(), status);
        }
        for mode in ["none", "sum", "best", "top_n"] {
            assert_eq!(mode.parse::<TeamScoringMode>().unwrap().as_str(), mode);
        }
        for status in ["registered", "checked_in", "disqualified", "withdrawn"] {
            assert_eq!(
                status.parse::<ParticipantStatus>().unwrap().as_str(),
                status
            );
        }
        assert!("duo".parse::<ParticipantType>().is_err());
    }

    #[test]
    fn enums_serialize_like_the_database() {
        assert_eq!(
            serde_json::to_string(&TeamScoringMode::TopN).unwrap(),
            "\"top_n\""
        );
        assert_eq!(
            serde_json::to_string(&ParticipantStatus::CheckedIn).unwrap(),
            "\"checked_in\""
        );
    }
}
