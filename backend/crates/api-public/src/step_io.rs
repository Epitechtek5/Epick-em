//! Étapes d'un tournoi (`step`, `step_group` et `step_participant`), sous-niveau du fichier des
//! tournois (voir [`crate::tournament_io`]).
//!
//! Le niveau des tournois les traite comme des valeurs opaques ; ce module est le seul à connaître
//! leur structure : un tableau de
//! `{ "position", "format", "match_type", "group_count", "group_size", "matches_per_group",
//!   "advance_per_group", "tiebreak", "status", "groups": [{ "index", "participants": [{ "user" |
//!   "team", "points", "final_rank", "status" }] }], "matches": [] }`.
//!
//! Un participant d'étape désigne un inscrit du tournoi comme le fichier du tournoi : par son nom
//! d'utilisateur (`user`) s'il joue à titre individuel, par le rang de son équipe dans `teams`
//! (`team`) si l'équipe est inscrite seule. Les groupes n'existent que pour une étape lancée.
//!
//! Règle de composition : les matchs d'une étape sont des valeurs opaques pour ce niveau. Il ne
//! connaît ni leur contenu ni leur structure : leur validation, leur lecture et leur écriture sont
//! déléguées à un [`StepMatches`] (par défaut [`StoreMatches`], voir [`crate::match_io`]), et il
//! se contente de les embarquer dans l'étape en leur donnant de quoi désigner les inscrits.
//!
//! Importer remplace toutes les étapes du tournoi. Une étape lancée est reconstituée par les
//! mêmes opérations que sur l'API (création, lancement, points, clôture), si bien qu'un fichier
//! exporté se réimporte sans perte (hors horodatages).

use crate::match_io::StoreMatches;
use crate::steps::{check, tiebreak_value};
use crate::store::{
    AuthStore, MatchType, StepClosing, StepDefinition, StepFormat, StepInput, StepOutcome,
    StepParticipantStatus, StepStart, StepStatus, StoreError,
};
use crate::tournament_io::{FileScope, TournamentChild};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use utoipa::ToSchema;
use uuid::Uuid;

/// Nombre maximal de problèmes détaillés dans un message d'erreur.
const MAX_REPORTED_ERRORS: usize = 10;

/// Comment le fichier désigne un inscrit : par son nom d'utilisateur (`user`) ou par le rang de
/// son équipe inscrite seule (`team`).
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum Who {
    /// Nom d'utilisateur en minuscules.
    User(String),
    /// Rang (à partir de 0) dans `teams`.
    Team(usize),
}

impl std::fmt::Display for Who {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Who::User(name) => write!(f, "« {name} »"),
            Who::Team(rank) => write!(f, "l'équipe {rank}"),
        }
    }
}

/// Désigne un inscrit à partir des clés `user` et `team` d'un élément du fichier.
pub fn designate(user: Option<&str>, team: Option<usize>) -> Result<Who, String> {
    match (user, team) {
        (Some(name), None) if !name.trim().is_empty() => Ok(Who::User(name.trim().to_lowercase())),
        (None, Some(rank)) => Ok(Who::Team(rank)),
        _ => Err("un participant désigne un `user` ou une `team`, pas les deux".to_string()),
    }
}

/// Désignation d'un inscrit dans un fichier exporté (`user` en casse d'origine ou `team`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Designation {
    pub user: Option<String>,
    pub team: Option<usize>,
}

/// Ce que le fichier déclare d'une étape, pour valider ses matchs : leurs participants sont ceux
/// de ses groupes.
#[derive(Debug, Clone)]
pub struct StepScope {
    pub status: StepStatus,
    pub format: StepFormat,
    pub match_type: MatchType,
    pub group_size: i32,
    /// Participants de chaque groupe, par rang de groupe.
    pub groups: HashMap<i32, HashSet<Who>>,
}

/// Import et export des matchs d'une étape.
#[async_trait]
pub trait StepMatches: Send + Sync {
    /// Matchs de l'étape, tels qu'ils s'embarquent dans le fichier, dans un ordre stable.
    /// `designations` désigne chaque inscrit du tournoi.
    async fn export(
        &self,
        step_id: Uuid,
        designations: &HashMap<Uuid, Designation>,
    ) -> Result<Vec<Value>, StoreError>;

    /// Message d'erreur si `items` est invalide pour cette étape d'un tournoi de ce jeu. Appelée
    /// avant toute écriture.
    async fn validate(
        &self,
        game_id: Uuid,
        scope: &StepScope,
        items: &[Value],
    ) -> Result<Option<String>, StoreError>;

    /// Remplace les matchs de l'étape (déjà lancée, ses groupes existent) par `items`, déjà
    /// validés. `participants` donne l'identifiant de chaque inscrit du tournoi.
    async fn import(
        &self,
        step_id: Uuid,
        game_id: Uuid,
        participants: &HashMap<Who, Uuid>,
        items: Vec<Value>,
    ) -> Result<(), StoreError>;
}

/// Quand les matchs ne sont pas branchés : rien à exporter, rien d'accepté.
pub struct NoMatches;

#[async_trait]
impl StepMatches for NoMatches {
    async fn export(
        &self,
        _: Uuid,
        _: &HashMap<Uuid, Designation>,
    ) -> Result<Vec<Value>, StoreError> {
        Ok(Vec::new())
    }

    async fn validate(
        &self,
        _: Uuid,
        _: &StepScope,
        items: &[Value],
    ) -> Result<Option<String>, StoreError> {
        Ok((!items.is_empty()).then(|| "les matchs ne sont pas pris en charge".to_string()))
    }

    async fn import(
        &self,
        _: Uuid,
        _: Uuid,
        _: &HashMap<Who, Uuid>,
        _: Vec<Value>,
    ) -> Result<(), StoreError> {
        Ok(())
    }
}

/// Étapes lues et écrites dans la base, pour le fichier des tournois.
pub struct StoreSteps {
    store: Arc<dyn AuthStore>,
    matches: Arc<dyn StepMatches>,
}

impl StoreSteps {
    pub fn new(store: Arc<dyn AuthStore>) -> Self {
        StoreSteps {
            matches: Arc::new(StoreMatches(store.clone())),
            store,
        }
    }

    /// Branche le sous-niveau qui importe et exporte les matchs des étapes (par défaut
    /// [`StoreMatches`], celui de la base).
    pub fn with_matches(mut self, matches: Arc<dyn StepMatches>) -> Self {
        self.matches = matches;
        self
    }
}

/// Étape telle qu'elle s'embarque dans le fichier d'un tournoi.
#[derive(Debug, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub(crate) struct StepItem {
    position: i32,
    format: StepFormat,
    match_type: MatchType,
    group_count: i32,
    group_size: i32,
    /// 1 s'il est absent.
    #[serde(default)]
    matches_per_group: Option<i32>,
    advance_per_group: i32,
    #[serde(default)]
    tiebreak: Vec<String>,
    /// `pending` s'il est absent.
    #[serde(default)]
    status: Option<StepStatus>,
    /// Vide tant que l'étape n'est pas lancée.
    #[serde(default)]
    groups: Vec<GroupItem>,
    /// Matchs de l'étape, opaques pour ce niveau.
    #[serde(default)]
    #[schema(value_type = Vec<Object>)]
    matches: Vec<Value>,
}

#[derive(Debug, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub(crate) struct GroupItem {
    /// Rang du groupe, de 1 au nombre de groupes.
    index: i32,
    participants: Vec<StepParticipantItem>,
}

#[derive(Debug, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub(crate) struct StepParticipantItem {
    /// Nom d'utilisateur de l'inscrit qui joue à titre individuel.
    #[serde(default)]
    user: Option<String>,
    /// Rang (à partir de 0) dans `teams` de l'équipe inscrite seule.
    #[serde(default)]
    team: Option<usize>,
    /// 0 s'il est absent.
    #[serde(default)]
    points: Option<f64>,
    /// Rang dans le groupe, renseigné quand l'étape est `finished`.
    #[serde(default)]
    final_rank: Option<i32>,
    /// `in` s'il est absent.
    #[serde(default)]
    status: Option<StepParticipantStatus>,
}

impl StepParticipantItem {
    fn who(&self) -> Result<Who, String> {
        designate(self.user.as_deref(), self.team)
    }
}

fn parse(items: &[Value]) -> Result<Vec<StepItem>, String> {
    items
        .iter()
        .enumerate()
        .map(|(index, value)| {
            serde_json::from_value(value.clone())
                .map_err(|e| format!("étape {} invalide ({e}).", index + 1))
        })
        .collect()
}

fn other(detail: impl std::fmt::Display) -> StoreError {
    StoreError::Other(detail.to_string())
}

fn definition(step: &StepItem) -> StepDefinition {
    StepDefinition {
        position: step.position,
        format: step.format,
        match_type: step.match_type,
        group_count: step.group_count,
        group_size: step.group_size,
        matches_per_group: step.matches_per_group.unwrap_or(1),
        advance_per_group: step.advance_per_group,
        tiebreak: tiebreak_value(step.tiebreak.clone()),
    }
}

/// Ce qui ne va pas dans une étape, un message par problème.
fn step_problems(step: &StepItem, scope: &FileScope) -> Vec<String> {
    let mut reasons: Vec<String> = check(&definition(step))
        .into_iter()
        .map(|(field, message)| format!("{field} : {message}"))
        .collect();
    let status = step.status.unwrap_or(StepStatus::Pending);
    if status == StepStatus::Pending {
        if !step.groups.is_empty() {
            reasons.push("groups : une étape `pending` n'a pas de groupes.".into());
        }
        return reasons;
    }
    let mut indexes: Vec<i32> = step.groups.iter().map(|g| g.index).collect();
    indexes.sort_unstable();
    let expected: Vec<i32> = (1..=step.group_count.max(0)).collect();
    if indexes != expected {
        reasons.push(format!(
            "groups : une étape lancée a {} groupes, numérotés de 1 à {}.",
            step.group_count, step.group_count
        ));
    }
    let mut seen = HashSet::new();
    for group in &step.groups {
        let size = group.participants.len();
        if i32::try_from(size).unwrap_or(i32::MAX) > step.group_size {
            reasons.push(format!(
                "groups : le groupe {} compte {size} participants, {} au plus.",
                group.index, step.group_size
            ));
        }
        let mut ranks = Vec::with_capacity(size);
        for participant in &group.participants {
            match participant.who() {
                Err(problem) => reasons.push(format!("groups : {problem}.")),
                Ok(who) => {
                    let known = match &who {
                        Who::User(name) => scope.users.contains(name),
                        Who::Team(rank) => scope.teams.contains(rank),
                    };
                    if !known {
                        reasons.push(format!("groups : {who} n'est pas un inscrit du tournoi."));
                    } else if !seen.insert(who.clone()) {
                        reasons.push(format!("groups : {who} apparaît plusieurs fois."));
                    }
                }
            }
            if !participant.points.is_none_or(f64::is_finite) {
                reasons.push("groups : `points` doit être un nombre fini.".into());
            }
            let participant_status = participant.status.unwrap_or(StepParticipantStatus::In);
            match status {
                StepStatus::Ongoing => {
                    if participant_status != StepParticipantStatus::In
                        || participant.final_rank.is_some()
                    {
                        reasons.push(
                            "groups : dans une étape `ongoing`, les participants sont `in` et sans `final_rank`."
                                .into(),
                        );
                    }
                }
                _ => {
                    let qualified = participant_status == StepParticipantStatus::Qualified;
                    match participant.final_rank {
                        None => reasons.push(
                            "groups : dans une étape `finished`, `final_rank` est obligatoire."
                                .into(),
                        ),
                        Some(rank) => {
                            ranks.push(rank);
                            if participant_status == StepParticipantStatus::In
                                || qualified != (rank <= step.advance_per_group)
                            {
                                reasons.push(format!(
                                    "groups : le rang {rank} est `{}` alors que {} participants passent.",
                                    participant_status.as_str(),
                                    step.advance_per_group
                                ));
                            }
                        }
                    }
                }
            }
        }
        if status == StepStatus::Finished {
            ranks.sort_unstable();
            let expected: Vec<i32> = (1..=i32::try_from(size).unwrap_or(i32::MAX)).collect();
            if ranks.len() == size && ranks != expected {
                reasons.push(format!(
                    "groups : les rangs du groupe {} doivent aller de 1 à {size}, sans doublon.",
                    group.index
                ));
            }
        }
    }
    reasons
}

impl StoreSteps {
    /// Inscrits du tournoi, par nom d'utilisateur en minuscules ou par rang d'équipe.
    async fn participants_by(
        &self,
        tournament_id: Uuid,
        team_ids: &[Uuid],
    ) -> Result<HashMap<Who, Uuid>, StoreError> {
        let mut by = HashMap::new();
        for participant in self
            .store
            .list_participants(tournament_id, i64::MAX, 0)
            .await?
        {
            match (participant.user_id, participant.tournament_team_id) {
                (Some(user_id), _) => {
                    let profile = self
                        .store
                        .find_profile(user_id)
                        .await?
                        .ok_or_else(|| other(format!("compte {user_id} introuvable")))?;
                    by.insert(Who::User(profile.username.to_lowercase()), participant.id);
                }
                (None, Some(team_id)) => {
                    if let Some(rank) = team_ids.iter().position(|id| *id == team_id) {
                        by.insert(Who::Team(rank), participant.id);
                    }
                }
                (None, None) => {}
            }
        }
        Ok(by)
    }
}

#[async_trait]
impl TournamentChild for StoreSteps {
    async fn export(&self, tournament_id: Uuid) -> Result<Vec<(Uuid, Value)>, StoreError> {
        self.export_in(tournament_id, &[]).await
    }

    async fn validate(&self, game_id: Uuid, items: &[Value]) -> Result<Option<String>, StoreError> {
        self.validate_in(game_id, items, &FileScope::default())
            .await
    }

    async fn import(
        &self,
        tournament_id: Uuid,
        items: Vec<Value>,
    ) -> Result<Vec<Uuid>, StoreError> {
        self.import_in(tournament_id, items, &[]).await
    }

    async fn export_in(
        &self,
        tournament_id: Uuid,
        team_order: &[Uuid],
    ) -> Result<Vec<(Uuid, Value)>, StoreError> {
        // Les inscrits par identifiant, désignés comme dans le fichier du tournoi.
        let mut who_is: HashMap<Uuid, Who> = HashMap::new();
        for (who, id) in self.participants_by(tournament_id, team_order).await? {
            who_is.insert(id, who);
        }
        let usernames = self.usernames(tournament_id).await?;
        let designations: HashMap<Uuid, Designation> = who_is
            .iter()
            .map(|(id, who)| {
                let designation = match who {
                    Who::User(_) => Designation {
                        user: usernames.get(id).cloned(),
                        team: None,
                    },
                    Who::Team(rank) => Designation {
                        user: None,
                        team: Some(*rank),
                    },
                };
                (*id, designation)
            })
            .collect();
        let mut exported = Vec::new();
        for step in self.store.list_steps(tournament_id).await? {
            let groups = self.store.list_step_groups(step.id).await?;
            let members = self.store.list_step_participants(step.id).await?;
            let mut group_items = Vec::with_capacity(groups.len());
            for group in &groups {
                let mut participants: Vec<StepParticipantItem> = Vec::new();
                for member in members.iter().filter(|m| m.group_id == group.id) {
                    let (user, team) = match who_is.get(&member.participant_id) {
                        Some(Who::User(_)) => {
                            (usernames.get(&member.participant_id).cloned(), None)
                        }
                        Some(Who::Team(rank)) => (None, Some(*rank)),
                        None => {
                            return Err(other(format!(
                                "inscrit {} de l'étape {} introuvable",
                                member.participant_id, step.position
                            )));
                        }
                    };
                    participants.push(StepParticipantItem {
                        user,
                        team,
                        points: Some(member.points),
                        final_rank: member.final_rank,
                        status: Some(member.status),
                    });
                }
                // Ordre indépendant des identifiants : deux exports du même contenu sont identiques.
                participants.sort_by(|a, b| {
                    (a.user.as_ref().map(|u| u.to_lowercase()), a.team)
                        .cmp(&(b.user.as_ref().map(|u| u.to_lowercase()), b.team))
                });
                group_items.push(GroupItem {
                    index: group.index,
                    participants,
                });
            }
            let matches = self.matches.export(step.id, &designations).await?;
            let item = StepItem {
                position: step.position,
                format: step.format,
                match_type: step.match_type,
                group_count: step.group_count,
                group_size: step.group_size,
                matches_per_group: Some(step.matches_per_group),
                advance_per_group: step.advance_per_group,
                tiebreak: step
                    .tiebreak
                    .as_array()
                    .map(|keys| {
                        keys.iter()
                            .filter_map(|k| k.as_str().map(str::to_string))
                            .collect()
                    })
                    .unwrap_or_default(),
                status: Some(step.status),
                groups: group_items,
                matches,
            };
            exported.push((step.id, serde_json::to_value(item).map_err(other)?));
        }
        Ok(exported)
    }

    async fn validate_in(
        &self,
        game_id: Uuid,
        items: &[Value],
        scope: &FileScope,
    ) -> Result<Option<String>, StoreError> {
        let steps = match parse(items) {
            Ok(steps) => steps,
            Err(problem) => return Ok(Some(problem)),
        };
        let mut problems = Vec::new();
        let mut positions = HashSet::new();
        for (index, step) in steps.iter().enumerate() {
            let mut reasons = step_problems(step, scope);
            if !positions.insert(step.position) {
                reasons.push(format!(
                    "position : {} apparaît plusieurs fois.",
                    step.position
                ));
            }
            let status = step.status.unwrap_or(StepStatus::Pending);
            if status != StepStatus::Pending
                && steps.iter().any(|earlier| {
                    earlier.position < step.position
                        && earlier.status.unwrap_or(StepStatus::Pending) != StepStatus::Finished
                })
            {
                reasons.push(
                    "status : une étape lancée suppose les étapes précédentes `finished`.".into(),
                );
            }
            // Les participants d'une étape sont les qualifiés de la précédente.
            if status != StepStatus::Pending
                && let Some(previous) = steps
                    .iter()
                    .filter(|earlier| earlier.position < step.position)
                    .max_by_key(|earlier| earlier.position)
                && previous.status == Some(StepStatus::Finished)
            {
                let qualified: HashSet<Who> = previous
                    .groups
                    .iter()
                    .flat_map(|g| &g.participants)
                    .filter(|p| p.status == Some(StepParticipantStatus::Qualified))
                    .filter_map(|p| p.who().ok())
                    .collect();
                for who in step
                    .groups
                    .iter()
                    .flat_map(|g| &g.participants)
                    .filter_map(|p| p.who().ok())
                {
                    if !qualified.contains(&who) {
                        reasons.push(format!(
                            "groups : {who} n'est pas qualifié à l'étape {}.",
                            previous.position
                        ));
                    }
                }
            }
            let scope = StepScope {
                status,
                format: step.format,
                match_type: step.match_type,
                group_size: step.group_size,
                groups: step
                    .groups
                    .iter()
                    .map(|group| {
                        let members = group
                            .participants
                            .iter()
                            .filter_map(|p| p.who().ok())
                            .collect();
                        (group.index, members)
                    })
                    .collect(),
            };
            if let Some(problem) = self
                .matches
                .validate(game_id, &scope, &step.matches)
                .await?
            {
                reasons.push(format!("matches : {problem}"));
            }
            if !reasons.is_empty() {
                problems.push(format!("étape {} : {}", index + 1, reasons.join(" ")));
            }
        }
        problems.truncate(MAX_REPORTED_ERRORS);
        Ok((!problems.is_empty()).then(|| problems.join(" ")))
    }

    async fn import_in(
        &self,
        tournament_id: Uuid,
        items: Vec<Value>,
        team_ids: &[Uuid],
    ) -> Result<Vec<Uuid>, StoreError> {
        let mut steps = parse(&items).map_err(StoreError::Other)?;
        steps.sort_by_key(|step| step.position);
        let participants = self.participants_by(tournament_id, team_ids).await?;
        let game_id = self
            .store
            .find_tournament(tournament_id)
            .await?
            .ok_or_else(|| other(format!("tournoi {tournament_id} introuvable")))?
            .game_id;
        // Les étapes sont remplacées : on retire les anciennes avant d'écrire les nouvelles.
        for old in self.store.list_steps(tournament_id).await? {
            self.store.delete_step(old.id).await?;
        }
        let mut ids = Vec::with_capacity(steps.len());
        for step in steps {
            let created = self
                .store
                .create_step(StepInput {
                    tournament_id,
                    definition: definition(&step),
                })
                .await?
                .ok_or_else(|| other(format!("tournoi {tournament_id} introuvable")))?;
            let status = step.status.unwrap_or(StepStatus::Pending);
            if status != StepStatus::Pending {
                let mut groups = step.groups;
                groups.sort_by_key(|group| group.index);
                let mut resolved: Vec<Vec<(Uuid, &StepParticipantItem)>> = Vec::new();
                for group in &groups {
                    let mut in_group = Vec::with_capacity(group.participants.len());
                    for participant in &group.participants {
                        let who = participant.who().map_err(other)?;
                        let id = participants
                            .get(&who)
                            .copied()
                            .ok_or_else(|| other(format!("inscrit {who} introuvable")))?;
                        in_group.push((id, participant));
                    }
                    resolved.push(in_group);
                }
                self.store
                    .start_step(StepStart {
                        step_id: created.id,
                        groups: resolved
                            .iter()
                            .map(|group| group.iter().map(|(id, _)| *id).collect())
                            .collect(),
                    })
                    .await?;
                let mut outcomes = Vec::new();
                for (id, participant) in resolved.iter().flatten() {
                    if let Some(points) = participant.points.filter(|p| *p != 0.0) {
                        self.store.set_step_points(created.id, *id, points).await?;
                    }
                    if let Some(final_rank) = participant.final_rank {
                        outcomes.push(StepOutcome {
                            participant_id: *id,
                            final_rank,
                            status: participant.status.unwrap_or(StepParticipantStatus::In),
                        });
                    }
                }
                if status == StepStatus::Finished {
                    self.store
                        .close_step(StepClosing {
                            step_id: created.id,
                            outcomes,
                            next: None,
                        })
                        .await?;
                }
            }
            self.matches
                .import(created.id, game_id, &participants, step.matches)
                .await?;
            ids.push(created.id);
        }
        Ok(ids)
    }
}

impl StoreSteps {
    /// Nom d'utilisateur de chaque inscrit qui joue à titre individuel, par identifiant d'inscrit.
    async fn usernames(&self, tournament_id: Uuid) -> Result<HashMap<Uuid, String>, StoreError> {
        let mut names = HashMap::new();
        for participant in self
            .store
            .list_participants(tournament_id, i64::MAX, 0)
            .await?
        {
            if let Some(user_id) = participant.user_id {
                let profile = self
                    .store
                    .find_profile(user_id)
                    .await?
                    .ok_or_else(|| other(format!("compte {user_id} introuvable")))?;
                names.insert(participant.id, profile.username);
            }
        }
        Ok(names)
    }
}
