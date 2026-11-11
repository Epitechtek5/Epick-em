//! Types des étapes d'un tournoi (tables `step`, `step_group` et `step_participant`).

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
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

text_enum! {
    /// Comment les têtes de série d'une étape sont fixées au lancement.
    SeedingStrategy, "stratégie de tête de série", {
        Manual => "manual",
        Random => "random",
        Ranking => "ranking",
    }
}

text_enum! {
    /// Comment les qualifiés d'une étape sont placés dans l'étape suivante.
    QualificationPlacement, "placement des qualifiés", {
        Random => "random",
        Rank => "rank",
        GroupRank => "group_rank",
    }
}

#[allow(clippy::derivable_impls)]
impl Default for SeedingStrategy {
    fn default() -> Self {
        Self::Random
    }
}

#[allow(clippy::derivable_impls)]
impl Default for QualificationPlacement {
    fn default() -> Self {
        Self::Random
    }
}

/// Barème propre à une étape : points d'une victoire, d'une égalité, d'une défaite (`duel`) et
/// d'une place (`ffa`, `placement[0]` pour la première).
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct StepScoring {
    #[serde(default)]
    pub win: f64,
    #[serde(default)]
    pub draw: f64,
    #[serde(default)]
    pub loss: f64,
    #[serde(default)]
    pub placement: Vec<f64>,
}

fn one() -> i32 {
    1
}

/// Réglages de génération d'une étape.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct StepRules {
    /// Têtes de série au lancement : `manual` (ordre donné), `random` ou `ranking` (classement de
    /// l'étape précédente).
    #[serde(default)]
    pub seeding: SeedingStrategy,
    /// Placement des qualifiés dans l'étape suivante : `random`, `rank` (par rang puis points) ou
    /// `group_rank` (rang dans le groupe, groupes dans l'ordre).
    #[serde(default)]
    pub qualification: QualificationPlacement,
    /// Série par défaut : 1, 3 ou 5 manches gagnantes au meilleur de.
    #[serde(default = "one")]
    pub best_of: i32,
    /// Série d'une ronde précise, par numéro de ronde (« 3 » : 5).
    #[serde(default)]
    #[schema(value_type = BTreeMap<String, i32>, example = json!({"3": 5}))]
    pub best_of_by_round: BTreeMap<String, i32>,
    /// Barème de l'étape ; remplace les points issus des statistiques pour cette étape.
    #[serde(default)]
    pub scoring: Option<StepScoring>,
}

impl Default for StepRules {
    fn default() -> Self {
        Self {
            seeding: SeedingStrategy::default(),
            qualification: QualificationPlacement::default(),
            best_of: 1,
            best_of_by_round: BTreeMap::new(),
            scoring: None,
        }
    }
}

impl StepRules {
    /// Série d'une ronde : la valeur propre à la ronde, sinon celle de l'étape.
    pub fn best_of_for(&self, round: i32) -> i32 {
        self.best_of_by_round
            .get(&round.to_string())
            .copied()
            .unwrap_or(self.best_of)
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
    /// Têtes de série, qualification, séries et barème de l'étape.
    pub rules: StepRules,
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
    /// Tête de série dans l'étape (1 = meilleure), fixée au lancement.
    pub seed: Option<i32>,
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
    pub rules: StepRules,
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
    /// Inscrits par ordre de tête de série (le premier est la tête de série 1) ; vide : aucune
    /// tête de série n'est enregistrée.
    pub seeds: Vec<Uuid>,
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
