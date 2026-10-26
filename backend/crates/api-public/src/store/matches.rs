//! Types des matchs (tables `match` et `match_participant`).

use serde::{Deserialize, Serialize};
use std::str::FromStr;
use utoipa::ToSchema;
use uuid::Uuid;

use super::StoreError;
use super::tournaments::text_enum;

text_enum! {
    /// Cycle de vie d'un match.
    MatchStatus, "statut de match", {
        Scheduled => "scheduled",
        Ongoing => "ongoing",
        Finished => "finished",
        Cancelled => "cancelled",
    }
}

text_enum! {
    /// Tableau d'un match en double élimination.
    Bracket, "tableau de match", {
        Winners => "winners",
        Losers => "losers",
        GrandFinal => "grand_final",
    }
}

text_enum! {
    /// Issue d'un participant dans un match.
    MatchResult, "résultat de match", { Win => "win", Loss => "loss", Draw => "draw" }
}

/// Match d'un jeu, dans un groupe d'étape ou hors tournoi.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct Match {
    pub id: Uuid,
    pub game_id: Uuid,
    /// Étape du match, `null` hors tournoi.
    pub step_id: Option<Uuid>,
    /// Groupe de l'étape.
    pub group_id: Option<Uuid>,
    /// N° de manche (`pool`), de ronde (`swiss`) ou de tour (élimination), à partir de 1.
    pub round: Option<i32>,
    /// Tableau, en double élimination.
    pub bracket: Option<Bracket>,
    /// Match où va le vainqueur, en élimination.
    pub next_match_id: Option<Uuid>,
    /// Horodatages RFC 3339 en UTC.
    pub scheduled_at: Option<String>,
    pub started_at: Option<String>,
    pub ended_at: Option<String>,
    pub status: MatchStatus,
    pub created_at: String,
    pub updated_at: String,
}

/// Participant d'un match avec ses statistiques et ses points.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct MatchParticipant {
    pub match_id: Uuid,
    /// Inscrit au tournoi (`tournament_participant.id`).
    pub participant_id: Uuid,
    /// Valeurs par clé de statistique, ex. `{"placement": 2, "kills": 7}` ; pour une équipe,
    /// `{"total": {...}, "players": {"<user_id>": {...}}}`.
    #[schema(value_type = Object, example = json!({"placement": 2, "kills": 7}))]
    pub stats: serde_json::Value,
    /// Calculés à partir de `stats` et du barème du tournoi.
    pub points: f64,
    pub rank: Option<i32>,
    pub result: Option<MatchResult>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn enums_round_trip_through_their_database_text() {
        for status in ["scheduled", "ongoing", "finished", "cancelled"] {
            assert_eq!(status.parse::<MatchStatus>().unwrap().as_str(), status);
        }
        for bracket in ["winners", "losers", "grand_final"] {
            assert_eq!(bracket.parse::<Bracket>().unwrap().as_str(), bracket);
        }
        for result in ["win", "loss", "draw"] {
            assert_eq!(result.parse::<MatchResult>().unwrap().as_str(), result);
        }
        assert!("postponed".parse::<MatchStatus>().is_err());
    }

    #[test]
    fn enums_serialize_like_the_database() {
        assert_eq!(
            serde_json::to_string(&Bracket::GrandFinal).unwrap(),
            "\"grand_final\""
        );
    }
}
