//! Plan d'import d'un fichier de tournois, entièrement résolu et prêt à être écrit.
//!
//! Le plan ne contient aucun identifiant de ligne à créer : les équipes, les étapes et les matchs
//! se désignent par leur rang dans le fichier, et les inscrits par un [`Entrant`] (le compte du
//! joueur, ou le rang de l'équipe inscrite seule). Le store les résout au fil de l'écriture, ce
//! qui lui permet d'écrire tout le plan en **une seule transaction**
//! ([`AuthStore::apply_import`](super::AuthStore::apply_import)).
//!
//! Tout ce qui se déduit des résultats (points, rangs, résultats, progression des vainqueurs,
//! totaux et classement d'étape) est calculé avant, par les mêmes fonctions que l'API : le store
//! n'écrit que ce que le plan lui donne.

use super::{
    Bracket, MatchResult, MatchStatus, ParticipantStatus, StepDefinition, StepParticipantStatus,
    StepStatus, TeamRole, TournamentImport,
};
use uuid::Uuid;

/// Un inscrit du tournoi tel que le plan le désigne.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Entrant {
    /// Joueur qui participe à titre individuel (son compte).
    User(Uuid),
    /// Équipe inscrite seule, par son rang dans les équipes du tournoi.
    Team(usize),
}

#[derive(Debug, Clone)]
pub struct TeamPlan {
    /// Équipe globale copiée, s'il y en a une.
    pub origin: Option<Uuid>,
    pub name: String,
    pub tag: Option<String>,
    pub picture_url: Option<String>,
    pub owner_id: Uuid,
    pub members: Vec<(Uuid, TeamRole)>,
}

#[derive(Debug, Clone)]
pub struct ParticipantPlan {
    pub user_id: Option<Uuid>,
    /// Rang de l'équipe dans `teams`.
    pub team: Option<usize>,
    pub status: ParticipantStatus,
    pub registered_at: Option<String>,
}

/// Participant d'un groupe d'étape.
#[derive(Debug, Clone)]
pub struct MemberPlan {
    pub who: Entrant,
    /// Tête de série dans l'étape.
    pub seed: Option<i32>,
    pub points: f64,
    pub final_rank: Option<i32>,
    pub status: StepParticipantStatus,
}

/// Résultat d'un participant dans un match.
#[derive(Debug, Clone)]
pub struct EntryPlan {
    pub who: Entrant,
    pub stats: serde_json::Value,
    pub points: f64,
    pub rank: Option<i32>,
    pub result: Option<MatchResult>,
}

#[derive(Debug, Clone)]
pub struct MatchPlan {
    /// Rang (à partir de 1) du groupe de l'étape.
    pub group: Option<i32>,
    pub round: Option<i32>,
    pub bracket: Option<Bracket>,
    /// Rang, dans les matchs de l'étape, du match où va le vainqueur.
    pub next: Option<usize>,
    pub scheduled_at: Option<String>,
    pub started_at: Option<String>,
    pub ended_at: Option<String>,
    pub status: MatchStatus,
    pub participants: Vec<EntryPlan>,
}

#[derive(Debug, Clone)]
pub struct StepPlan {
    pub definition: StepDefinition,
    pub status: StepStatus,
    /// Un tableau de participants par groupe ; vide tant que l'étape est `pending`.
    pub groups: Vec<Vec<MemberPlan>>,
    pub matches: Vec<MatchPlan>,
}

#[derive(Debug, Clone)]
pub struct TournamentPlan {
    pub import: TournamentImport,
    pub teams: Vec<TeamPlan>,
    pub participants: Vec<ParticipantPlan>,
    pub steps: Vec<StepPlan>,
}

/// Tout ce qu'un import écrit.
#[derive(Debug, Clone, Default)]
pub struct ImportPlan {
    pub tournaments: Vec<TournamentPlan>,
}
