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
    Bracket, GameImport, MatchImport, MatchResult, MatchSchedule, MatchScore, MatchStatus,
    ParticipantImport, ParticipantStatus, StepDefinition, StepParticipantStatus, StepStatus,
    StoreError, TeamRole, TournamentImport,
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
    /// Réponses aux champs d'inscription du tournoi.
    pub responses: serde_json::Value,
}

impl ParticipantPlan {
    /// L'inscrit à écrire, son équipe étant résolue dans `team_ids` (identifiants des équipes du
    /// tournoi, dans l'ordre du plan).
    pub fn into_import(self, team_ids: &[Uuid]) -> ParticipantImport {
        ParticipantImport {
            user_id: self.user_id,
            tournament_team_id: self.team.and_then(|rank| team_ids.get(rank).copied()),
            status: self.status,
            registered_at: self.registered_at,
            responses: self.responses,
        }
    }

    /// Comment les étapes et les matchs du plan désignent cet inscrit.
    pub fn entrant(&self) -> Option<Entrant> {
        match (self.user_id, self.team) {
            (Some(user_id), _) => Some(Entrant::User(user_id)),
            (None, Some(rank)) => Some(Entrant::Team(rank)),
            (None, None) => None,
        }
    }
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
    /// Emplacement (1 ou 2) dans le match.
    pub slot: Option<i32>,
    /// Manches gagnées dans une série.
    pub games_won: Option<i32>,
}

impl EntryPlan {
    fn into_score(
        self,
        resolve: &impl Fn(&Entrant) -> Result<Uuid, StoreError>,
    ) -> Result<MatchScore, StoreError> {
        Ok(MatchScore {
            participant_id: resolve(&self.who)?,
            stats: self.stats,
            points: self.points,
            rank: self.rank,
            result: self.result,
            games_won: self.games_won,
            slot: self.slot,
        })
    }
}

/// Partie d'une série.
#[derive(Debug, Clone)]
pub struct GamePlan {
    pub status: MatchStatus,
    /// Attributs de la partie ; les clés de `participant_attributes` y sont ajoutées à
    /// l'écriture.
    pub attributes: serde_json::Value,
    /// Attributs qui désignent un participant du match (MVP...) : clé et inscrit, dont
    /// l'identifiant n'est connu qu'à l'écriture.
    pub participant_attributes: Vec<(String, Entrant)>,
    pub started_at: Option<String>,
    pub ended_at: Option<String>,
    pub participants: Vec<EntryPlan>,
}

#[derive(Debug, Clone)]
pub struct MatchPlan {
    /// Planification (lieu, poste, durée...) exportée avec le match.
    pub schedule: Option<MatchSchedule>,
    /// Rang (à partir de 1) du groupe de l'étape.
    pub group: Option<i32>,
    pub round: Option<i32>,
    /// Rang du match dans sa ronde.
    pub number: Option<i32>,
    pub bracket: Option<Bracket>,
    /// Longueur de la série (1, 3 ou 5).
    pub best_of: i32,
    /// Rang, dans les matchs de l'étape, du match où va le vainqueur.
    pub next: Option<usize>,
    pub next_slot: Option<i32>,
    /// Rang, dans les matchs de l'étape, du match où va le perdant.
    pub loser_next: Option<usize>,
    pub loser_next_slot: Option<i32>,
    pub scheduled_at: Option<String>,
    pub started_at: Option<String>,
    pub ended_at: Option<String>,
    pub status: MatchStatus,
    pub participants: Vec<EntryPlan>,
    /// Parties de la série, dans l'ordre.
    pub games: Vec<GamePlan>,
}

impl MatchPlan {
    /// Le match à écrire : `group_id` est son groupe, `resolve` donne l'identifiant de chaque
    /// inscrit.
    pub fn into_import(
        self,
        group_id: Option<Uuid>,
        resolve: &impl Fn(&Entrant) -> Result<Uuid, StoreError>,
    ) -> Result<MatchImport, StoreError> {
        let participants = self
            .participants
            .into_iter()
            .map(|entry| entry.into_score(resolve))
            .collect::<Result<_, _>>()?;
        let mut games = Vec::with_capacity(self.games.len());
        for game in self.games {
            let mut attributes = match game.attributes {
                serde_json::Value::Object(map) => map,
                _ => serde_json::Map::new(),
            };
            for (key, who) in &game.participant_attributes {
                attributes.insert(
                    key.clone(),
                    serde_json::Value::String(resolve(who)?.to_string()),
                );
            }
            games.push(GameImport {
                status: game.status,
                attributes: serde_json::Value::Object(attributes),
                started_at: game.started_at,
                ended_at: game.ended_at,
                participants: game
                    .participants
                    .into_iter()
                    .map(|entry| entry.into_score(resolve))
                    .collect::<Result<_, _>>()?,
            });
        }
        Ok(MatchImport {
            schedule: self.schedule,
            group_id,
            round: self.round,
            bracket: self.bracket,
            next: self.next,
            next_slot: self.next_slot,
            loser_next: self.loser_next,
            loser_next_slot: self.loser_next_slot,
            number: self.number,
            best_of: self.best_of,
            scheduled_at: self.scheduled_at,
            started_at: self.started_at,
            ended_at: self.ended_at,
            status: self.status,
            participants,
            games,
        })
    }
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
    /// État attendu du tournoi ([`super::AuthStore::tournament_digest`]) au moment de l'aperçu,
    /// revérifié dans la transaction qui applique le plan ; `None` : le tournoi ne doit pas
    /// exister.
    pub expected: Option<String>,
}

/// Tout ce qu'un import écrit.
#[derive(Debug, Clone, Default)]
pub struct ImportPlan {
    pub tournaments: Vec<TournamentPlan>,
}
