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

/// Match d'un jeu, dans une étape de tournoi (jamais hors tournoi).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct Match {
    pub id: Uuid,
    pub game_id: Uuid,
    /// Étape du match.
    pub step_id: Uuid,
    /// Groupe de l'étape.
    pub group_id: Option<Uuid>,
    /// N° de manche (`pool`), de ronde (`swiss`) ou de tour (élimination), à partir de 1.
    pub round: Option<i32>,
    /// Tableau, en double élimination.
    pub bracket: Option<Bracket>,
    /// Match où va le vainqueur, en élimination.
    pub next_match_id: Option<Uuid>,
    /// Longueur de la série : 1, 3 ou 5 parties. `round` reste la ronde du tournoi.
    #[schema(minimum = 1, maximum = 5, example = 1)]
    pub best_of: i32,
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

/// Match à créer dans un groupe d'étape, avec ses participants éventuels (en élimination, les
/// matchs suivants se remplissent par propagation du vainqueur).
#[derive(Debug, Clone)]
pub struct MatchInput {
    pub game_id: Uuid,
    pub step_id: Uuid,
    pub group_id: Uuid,
    pub round: Option<i32>,
    pub bracket: Option<Bracket>,
    pub next_match_id: Option<Uuid>,
    pub best_of: i32,
    pub scheduled_at: Option<String>,
    pub participants: Vec<Uuid>,
}

/// Modification partielle d'un match : seuls les champs renseignés changent ; `Some(None)`
/// efface une valeur facultative. `participants` remplace la liste (les statistiques des
/// participants conservés sont gardées).
#[derive(Debug, Default, Clone)]
pub struct MatchUpdate {
    pub round: Option<Option<i32>>,
    pub bracket: Option<Option<Bracket>>,
    pub next_match_id: Option<Option<Uuid>>,
    pub best_of: Option<i32>,
    pub scheduled_at: Option<Option<String>>,
    pub participants: Option<Vec<Uuid>>,
}

/// Résultat d'un participant : ses statistiques et ce qui en est déduit.
#[derive(Debug, Clone, PartialEq)]
pub struct MatchScore {
    pub participant_id: Uuid,
    pub stats: serde_json::Value,
    pub points: f64,
    pub rank: Option<i32>,
    pub result: Option<MatchResult>,
}

/// Clôture d'un match, en une seule opération : les résultats de chaque participant, le
/// vainqueur placé dans le match suivant (`advance` : match, inscrit) et le total de points de
/// chaque participant dans l'étape. Quand la série se joue en parties, `game` est la dernière
/// partie, terminée dans la même opération.
#[derive(Debug, Clone)]
pub struct MatchFinish {
    pub match_id: Uuid,
    pub scores: Vec<MatchScore>,
    pub advance: Option<(Uuid, Uuid)>,
    pub step_points: Vec<(Uuid, f64)>,
    pub game: Option<GameFinish>,
}

/// Résultats d'un participant dans une partie.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct MatchGameParticipant {
    /// Inscrit au tournoi (`tournament_participant.id`).
    pub participant_id: Uuid,
    /// Valeurs par clé de statistique, comme `MatchParticipant.stats` (même structure
    /// `total`/`players` pour une équipe), avec en plus les statistiques `select` du participant.
    #[schema(value_type = Object, example = json!({"kills": 7, "character": "jett"}))]
    pub stats: serde_json::Value,
    /// Calculés à partir des seules statistiques numériques et du barème du tournoi.
    pub points: f64,
    pub rank: Option<i32>,
    pub result: Option<MatchResult>,
}

/// Partie d'un match, numérotée à partir de 1.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct MatchGame {
    pub id: Uuid,
    pub match_id: Uuid,
    /// N° de la partie dans la série, à partir de 1.
    pub number: i32,
    /// `ongoing` ou `finished` (`scheduled` et `cancelled` ne servent qu'aux imports).
    pub status: MatchStatus,
    /// Statistiques de portée `match` : carte, MVP... par clé de statistique.
    #[schema(value_type = Object, example = json!({"map": "ascent", "mvp": "7c0d5c0e-0000-4000-8000-000000000000"}))]
    pub attributes: serde_json::Value,
    pub started_at: Option<String>,
    pub ended_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub participants: Vec<MatchGameParticipant>,
}

/// Partie à terminer, avec les résultats définitifs de ses participants.
#[derive(Debug, Clone)]
pub struct GameFinish {
    pub game_id: Uuid,
    pub scores: Vec<MatchScore>,
}

/// Enregistrement des résultats d'une partie en cours : ses attributs (si renseignés) et ceux
/// des participants listés.
#[derive(Debug, Clone)]
pub struct GameScores {
    pub game_id: Uuid,
    pub attributes: Option<serde_json::Value>,
    pub scores: Vec<MatchScore>,
}

/// Partie telle qu'un fichier la décrit.
#[derive(Debug, Clone)]
pub struct GameImport {
    pub status: MatchStatus,
    pub attributes: serde_json::Value,
    pub started_at: Option<String>,
    pub ended_at: Option<String>,
    pub participants: Vec<MatchScore>,
}

/// Match d'une étape tel qu'un fichier le décrit. Les horodatages sont en RFC 3339 UTC.
#[derive(Debug, Clone)]
pub struct MatchImport {
    pub group_id: Option<Uuid>,
    pub round: Option<i32>,
    pub bracket: Option<Bracket>,
    /// Rang, dans la liste importée, du match où va le vainqueur.
    pub next: Option<usize>,
    pub best_of: i32,
    pub scheduled_at: Option<String>,
    pub started_at: Option<String>,
    pub ended_at: Option<String>,
    pub status: MatchStatus,
    pub participants: Vec<MatchScore>,
    /// Parties de la série, dans l'ordre (la n-ième est la partie n° n).
    pub games: Vec<GameImport>,
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
