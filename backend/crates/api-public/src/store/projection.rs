//! Tournoi importé d'une source externe, tel qu'il se reporte dans le modèle local
//! ([`super::AuthStore::project_external`]).
//!
//! Chaque élément porte son identifiant chez la source : à chaque synchronisation, ce qui existe
//! déjà est mis à jour sur place (mêmes identifiants locaux), ce qui est nouveau est créé et ce
//! qui a disparu de la source est supprimé.

use super::{
    Bracket, MatchResult, MatchStatus, ParticipantStatus, StepDefinition, StepParticipantStatus,
    StepStatus, TournamentStatus,
};

#[derive(Debug, Clone, PartialEq)]
pub struct Projection {
    pub status: TournamentStatus,
    pub participants: Vec<ProjectedParticipant>,
    pub steps: Vec<ProjectedStep>,
}

/// Inscrit « importé » : il n'a pas de compte local, seulement son nom chez la source.
#[derive(Debug, Clone, PartialEq)]
pub struct ProjectedParticipant {
    pub external_id: String,
    pub display_name: String,
    pub status: ParticipantStatus,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ProjectedStep {
    pub external_id: String,
    pub definition: StepDefinition,
    pub status: StepStatus,
    pub groups: Vec<ProjectedGroup>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ProjectedGroup {
    pub external_id: String,
    pub members: Vec<ProjectedMember>,
    pub matches: Vec<ProjectedMatch>,
}

/// Inscrit d'un groupe ; `participant` est l'identifiant de l'inscrit chez la source.
#[derive(Debug, Clone, PartialEq)]
pub struct ProjectedMember {
    pub participant: String,
    pub points: f64,
    pub final_rank: Option<i32>,
    pub status: StepParticipantStatus,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ProjectedMatch {
    pub external_id: String,
    pub round: Option<i32>,
    pub bracket: Option<Bracket>,
    pub status: MatchStatus,
    pub started_at: Option<String>,
    pub ended_at: Option<String>,
    pub entries: Vec<ProjectedEntry>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ProjectedEntry {
    pub participant: String,
    pub stats: serde_json::Value,
    pub points: f64,
    pub rank: Option<i32>,
    pub result: Option<MatchResult>,
}
