//! Types des étapes d'un tournoi (tables `step`, `step_group` et `step_participant`).

use serde::{Deserialize, Serialize};
use std::str::FromStr;
use utoipa::ToSchema;
use uuid::Uuid;

use super::StoreError;
use super::tournaments::text_enum;

text_enum! {
    /// Organisation des matchs d'une étape.
    StepFormat, "format d'étape", {
        Pool => "pool",
        Swiss => "swiss",
        SingleElim => "single_elim",
        DoubleElim => "double_elim",
    }
}

text_enum! {
    /// Un match oppose deux participants (`duel`) ou tous ceux du groupe (`ffa`).
    MatchType, "type de match", { Duel => "duel", Ffa => "ffa" }
}

text_enum! {
    /// Cycle de vie d'une étape ; elle est verrouillée dès `Ongoing`.
    StepStatus, "statut d'étape", {
        Pending => "pending",
        Ongoing => "ongoing",
        Finished => "finished",
    }
}

text_enum! {
    /// Issue d'un participant dans l'étape.
    StepParticipantStatus, "statut de participant d'étape", {
        In => "in",
        Qualified => "qualified",
        Eliminated => "eliminated",
    }
}

/// Étape d'un tournoi. `pool` + `ffa` + `advance_per_group = group_size / 2` donne le format TFT.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct Step {
    pub id: Uuid,
    pub tournament_id: Uuid,
    /// Rang de l'étape dans le tournoi, à partir de 1.
    pub position: i32,
    pub format: StepFormat,
    pub match_type: MatchType,
    /// Un seul groupe pour `swiss`, `single_elim` et `double_elim`.
    pub group_count: i32,
    pub group_size: i32,
    /// Nombre de manches (`pool`) ou de rondes (`swiss`) par groupe.
    pub matches_per_group: i32,
    /// Participants qualifiés par groupe, au plus `group_size`.
    pub advance_per_group: i32,
    /// Critères de départage, par ordre de priorité.
    #[schema(value_type = Vec<String>, example = json!(["wins", "best_placement"]))]
    pub tiebreak: serde_json::Value,
    pub status: StepStatus,
    /// Horodatages RFC 3339 en UTC.
    pub created_at: String,
    pub updated_at: String,
}

/// Groupe d'une étape.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct StepGroup {
    pub id: Uuid,
    pub step_id: Uuid,
    /// Rang du groupe dans l'étape, à partir de 1.
    pub index: i32,
}

/// Participant d'une étape, dans son groupe.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct StepParticipant {
    pub step_id: Uuid,
    /// Inscrit au tournoi (`tournament_participant.id`).
    pub participant_id: Uuid,
    pub group_id: Uuid,
    /// Total de points de l'étape.
    pub points: f64,
    /// Rang dans le groupe, renseigné à la clôture de l'étape.
    pub final_rank: Option<i32>,
    pub status: StepParticipantStatus,
}

/// Réglages d'une étape, communs à la création et au remplacement.
#[derive(Debug, Clone, PartialEq)]
pub struct StepDefinition {
    pub position: i32,
    pub format: StepFormat,
    pub match_type: MatchType,
    pub group_count: i32,
    pub group_size: i32,
    pub matches_per_group: i32,
    pub advance_per_group: i32,
    pub tiebreak: serde_json::Value,
}

/// Étape à créer ; elle démarre toujours au statut `pending`.
#[derive(Debug, Clone)]
pub struct StepInput {
    pub tournament_id: Uuid,
    pub definition: StepDefinition,
}

/// Lancement d'une étape : un tableau d'inscrits par groupe, dans l'ordre des groupes (le
/// premier devient le groupe 1).
#[derive(Debug, Clone)]
pub struct StepStart {
    pub step_id: Uuid,
    pub groups: Vec<Vec<Uuid>>,
}

/// Issue d'un participant à la clôture de son étape.
#[derive(Debug, Clone)]
pub struct StepOutcome {
    pub participant_id: Uuid,
    pub final_rank: i32,
    pub status: StepParticipantStatus,
}

/// Clôture d'une étape : l'issue de chaque participant et, s'il y en a une, l'étape suivante à
/// lancer dans la même opération.
#[derive(Debug, Clone)]
pub struct StepClosing {
    pub step_id: Uuid,
    pub outcomes: Vec<StepOutcome>,
    pub next: Option<StepStart>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn enums_round_trip_through_their_database_text() {
        for format in ["pool", "swiss", "single_elim", "double_elim"] {
            assert_eq!(format.parse::<StepFormat>().unwrap().as_str(), format);
        }
        for status in ["pending", "ongoing", "finished"] {
            assert_eq!(status.parse::<StepStatus>().unwrap().as_str(), status);
        }
        for status in ["in", "qualified", "eliminated"] {
            assert_eq!(
                status.parse::<StepParticipantStatus>().unwrap().as_str(),
                status
            );
        }
        assert!("triple_elim".parse::<StepFormat>().is_err());
    }

    #[test]
    fn enums_serialize_like_the_database() {
        assert_eq!(
            serde_json::to_string(&StepFormat::SingleElim).unwrap(),
            "\"single_elim\""
        );
        assert_eq!(serde_json::to_string(&MatchType::Ffa).unwrap(), "\"ffa\"");
    }
}
