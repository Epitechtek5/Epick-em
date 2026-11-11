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
    /// Rang du match dans sa ronde, pour les matchs générés.
    pub number: Option<i32>,
    /// Emplacement (1 ou 2) du vainqueur dans le match suivant.
    pub next_slot: Option<i32>,
    /// Match où va le perdant, en double élimination.
    pub loser_next_match_id: Option<Uuid>,
    pub loser_next_slot: Option<i32>,
    /// Série au meilleur de 1, 3 ou 5 manches ; `round` reste la ronde de compétition.
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
    /// Emplacement (1 ou 2) dans le match, pour les tableaux.
    pub slot: Option<i32>,
    /// Manches gagnées dans une série (BO3, BO5).
    pub games_won: Option<i32>,
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
    pub games_won: Option<i32>,
    /// Emplacement dans le match ; conservé tel quel quand il est absent.
    pub slot: Option<i32>,
}

/// Participant placé dans un match (vainqueur ou perdant qui avance).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Placement {
    pub match_id: Uuid,
    pub participant_id: Uuid,
    pub slot: Option<i32>,
}

/// Clôture d'un match, en une seule opération : les résultats de chaque participant, le
/// participants placés dans les matchs suivants (`placements`), les matchs annulés par la
/// progression (manche de « reset » inutile) et le total de points de chaque participant dans
/// l'étape.
#[derive(Debug, Clone)]
pub struct MatchFinish {
    pub match_id: Uuid,
    pub scores: Vec<MatchScore>,
    pub placements: Vec<Placement>,
    pub cancel: Vec<Uuid>,
    pub step_points: Vec<(Uuid, f64)>,
}

/// Match d'une étape tel qu'un fichier le décrit. Les horodatages sont en RFC 3339 UTC.
#[derive(Debug, Clone)]
pub struct MatchImport {
    pub group_id: Option<Uuid>,
    pub round: Option<i32>,
    pub bracket: Option<Bracket>,
    /// Rang, dans la liste importée, du match où va le vainqueur.
    pub next: Option<usize>,
    pub next_slot: Option<i32>,
    /// Rang, dans la liste importée, du match où va le perdant.
    pub loser_next: Option<usize>,
    pub loser_next_slot: Option<i32>,
    pub number: Option<i32>,
    pub best_of: i32,
    pub scheduled_at: Option<String>,
    pub started_at: Option<String>,
    pub ended_at: Option<String>,
    pub status: MatchStatus,
    pub participants: Vec<MatchScore>,
}

/// Match produit par la génération automatique. `next` et `loser_next` désignent (rang dans la
/// liste générée, emplacement 1 ou 2).
#[derive(Debug, Clone)]
pub struct GeneratedMatch {
    pub group_id: Uuid,
    pub round: i32,
    pub number: i32,
    pub bracket: Option<Bracket>,
    pub best_of: i32,
    /// Inscrits déjà placés, avec leur emplacement.
    pub participants: Vec<(Uuid, Option<i32>)>,
    pub next: Option<(usize, i32)>,
    pub loser_next: Option<(usize, i32)>,
    /// Match exempt (bye) : il se termine aussitôt, son unique participant gagne et marque
    /// `bye_points`.
    pub bye_points: Option<f64>,
}

/// Génération de matchs d'une étape, en une seule opération.
#[derive(Debug, Clone)]
pub struct Generation {
    pub step_id: Uuid,
    pub game_id: Uuid,
    pub matches: Vec<GeneratedMatch>,
    /// Total de points de l'étape à enregistrer (points des byes).
    pub step_points: Vec<(Uuid, f64)>,
    /// Refuse de générer si l'étape a déjà des matchs ; sinon (ronde suivante) refuse si une des
    /// rondes générées existe déjà.
    pub initial: bool,
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
