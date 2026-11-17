//! Matchs d'une étape (`match` et `match_participant`), sous-niveau du fichier des étapes (voir
//! [`crate::step_io`]).
//!
//! Le niveau des étapes les traite comme des valeurs opaques ; ce module est le seul à connaître
//! leur structure : un tableau de
//! `{ "group", "round", "number", "bracket", "best_of", "next", "next_slot", "loser_next",
//!   "loser_next_slot", "scheduled_at", "started_at", "ended_at", "status",
//!   "participants": [{ "user" | "team", "stats", "points", "rank", "result", "slot",
//!   "games_won" }],
//!   "games": [{ "status", "attributes", "started_at", "ended_at", "participants": [...] }] }`.
//!
//! `best_of` (1, 3 ou 5, 1 s'il est absent) et `games` (les parties de la série, dans l'ordre :
//! la n-ième est la partie n° n) sont facultatifs : un fichier antérieur aux parties s'importe
//! tel quel. Les participants d'une partie se désignent comme ceux du match ; dans
//! `attributes`, un MVP désigné par un participant du match s'écrit `{ "user": "<nom>" }` ou
//! `{ "team": <rang> }` plutôt que par identifiant, pour survivre à la copie d'un environnement
//! à l'autre.
//!
//! `best_of` (1, 3 ou 5, 1 s'il est absent) et `games` (les parties de la série, dans l'ordre :
//! la n-ième est la partie n° n) sont facultatifs : un fichier antérieur aux parties s'importe
//! tel quel, et une série terminée sans ses parties donne les manches gagnées (`games_won`) de
//! chaque participant. Les participants d'une partie se désignent comme ceux du match ; dans
//! `attributes`, un MVP désigné par un participant du match s'écrit `{ "user": "<nom>" }` ou
//! `{ "team": <rang> }` plutôt que par identifiant, pour survivre à la copie d'un environnement
//! à l'autre.
//!
//! Le groupe est désigné par son rang dans l'étape, le match suivant (`next`) et celui du perdant
//! (`loser_next`) par leur rang (à partir de 0) dans le tableau des matchs de la même étape, et un participant comme dans le
//! fichier des étapes : `user` (nom d'utilisateur) ou `team` (rang dans `teams`). `stats` est le
//! JSON de `match_participant.stats`. Les matchs voyagent avec leur étape : le niveau des
//! tournois, lui, refuse un tableau `matches` non vide ([`InSteps`]).
//!
//! Importer remplace tous les matchs de l'étape. Les points absents du fichier sont calculés
//! d'après le barème du tournoi, déjà écrit ; ceux du fichier sont conservés tels quels, si bien
//! qu'un fichier exporté se réimporte sans perte (hors horodatages de création).

use crate::match_games::{aggregate, is_decided};
use crate::matches::{
    BEST_OF, ROUND_MAX, StatSchema, capacity_of, playable_problem, players_of, points_of, settle,
};
use crate::step_io::{Designation, StepMatches, StepScope, Who, designate};
use crate::store::{
    AuthStore, Bracket, GameImport, MatchGame, MatchGameParticipant, MatchImport, MatchParticipant,
    MatchResult, MatchScore, MatchStatus, StepFormat, StepStatus, StoreError,
};
use crate::team_io::normalize_timestamp;
use crate::tournament_io::TournamentChild;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use utoipa::ToSchema;
use uuid::Uuid;

/// Nombre maximal de problèmes détaillés dans un message d'erreur.
const MAX_REPORTED_ERRORS: usize = 10;

/// Matchs lus et écrits dans la base, pour le fichier des étapes.
pub struct StoreMatches(pub Arc<dyn AuthStore>);

/// Niveau « tournoi » des matchs : ils se déclarent dans leur étape, pas à côté.
pub struct InSteps;

#[async_trait]
impl TournamentChild for InSteps {
    async fn export(&self, _: Uuid) -> Result<Vec<(Uuid, Value)>, StoreError> {
        Ok(Vec::new())
    }

    async fn validate(&self, _: Uuid, items: &[Value]) -> Result<Option<String>, StoreError> {
        Ok((!items.is_empty())
            .then(|| "les matchs se déclarent dans leur étape (`steps[].matches`)".to_string()))
    }

    async fn import(&self, _: Uuid, _: Vec<Value>) -> Result<Vec<Uuid>, StoreError> {
        Ok(Vec::new())
    }
}

/// Match tel qu'il s'embarque dans le fichier d'une étape.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub(crate) struct MatchItem {
    /// Rang du groupe dans l'étape, à partir de 1.
    #[serde(default)]
    group: Option<i32>,
    /// Ronde de compétition (à ne pas confondre avec les manches d'une série).
    #[serde(default)]
    round: Option<i32>,
    /// Rang du match dans sa ronde, pour les matchs générés.
    #[serde(default)]
    number: Option<i32>,
    #[serde(default)]
    bracket: Option<Bracket>,
    /// Longueur de la série : 1, 3 ou 5 parties ; 1 s'il est absent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    best_of: Option<i32>,
    /// Rang (à partir de 0), dans les matchs de l'étape, du match où va le vainqueur.
    #[serde(default)]
    next: Option<usize>,
    /// Emplacement (1 ou 2) du vainqueur dans le match suivant.
    #[serde(default)]
    next_slot: Option<i32>,
    /// Rang (à partir de 0) du match où va le perdant, en double élimination.
    #[serde(default)]
    loser_next: Option<usize>,
    #[serde(default)]
    loser_next_slot: Option<i32>,
    /// Horodatages RFC 3339 en UTC (suffixe `Z`).
    #[serde(default)]
    scheduled_at: Option<String>,
    #[serde(default)]
    started_at: Option<String>,
    #[serde(default)]
    ended_at: Option<String>,
    /// `scheduled` s'il est absent.
    #[serde(default)]
    status: Option<MatchStatus>,
    #[serde(default)]
    participants: Vec<MatchParticipantItem>,
    /// Parties de la série, dans l'ordre.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    games: Vec<GameItem>,
}

/// Partie d'une série telle qu'elle s'embarque dans le fichier d'un match.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub(crate) struct GameItem {
    /// `ongoing` s'il est absent ; `scheduled` et `cancelled` ne s'importent pas.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    status: Option<MatchStatus>,
    /// Attributs de la partie par clé de statistique de portée `match` (carte, MVP...).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<Object>)]
    attributes: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    started_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    ended_at: Option<String>,
    #[serde(default)]
    participants: Vec<MatchParticipantItem>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub(crate) struct MatchParticipantItem {
    /// Nom d'utilisateur de l'inscrit qui joue à titre individuel.
    #[serde(default)]
    user: Option<String>,
    /// Rang (à partir de 0) dans `teams` de l'équipe inscrite seule.
    #[serde(default)]
    team: Option<usize>,
    /// Valeur de chaque statistique du jeu par clé ; `{}` s'il est absent.
    #[serde(default)]
    #[schema(value_type = Option<Object>)]
    stats: Option<Value>,
    /// Calculés d'après le barème du tournoi s'ils sont absents.
    #[serde(default)]
    points: Option<f64>,
    #[serde(default)]
    rank: Option<i32>,
    #[serde(default)]
    result: Option<MatchResult>,
    /// Emplacement (1 ou 2) dans le match.
    #[serde(default)]
    slot: Option<i32>,
    /// Manches gagnées dans une série.
    #[serde(default)]
    games_won: Option<i32>,
}

impl MatchParticipantItem {
    fn who(&self) -> Result<Who, String> {
        designate(self.user.as_deref(), self.team)
    }

    fn stats(&self) -> Value {
        self.stats.clone().unwrap_or_else(|| serde_json::json!({}))
    }
}

fn parse(items: &[Value]) -> Result<Vec<MatchItem>, String> {
    items
        .iter()
        .enumerate()
        .map(|(index, value)| {
            serde_json::from_value(value.clone())
                .map_err(|e| format!("match {} invalide ({e}).", index + 1))
        })
        .collect()
}

fn other(detail: impl std::fmt::Display) -> StoreError {
    StoreError::Other(detail.to_string())
}

/// Ce qui ne va pas dans les matchs d'une étape, un message par problème.
fn problems(matches: &[MatchItem], scope: &StepScope, schema: &StatSchema) -> Vec<String> {
    if matches.is_empty() {
        return Vec::new();
    }
    if scope.status == StepStatus::Pending {
        return vec!["une étape `pending` n'a pas de groupes, donc pas de matchs.".to_string()];
    }
    let everyone: HashSet<&Who> = scope.groups.values().flatten().collect();
    let eliminating = matches!(
        scope.format,
        StepFormat::SingleElim | StepFormat::DoubleElim
    );
    let mut out = Vec::new();
    for (index, item) in matches.iter().enumerate() {
        let mut reasons = Vec::new();
        let label = index + 1;
        let allowed = match item.group {
            Some(group) => match scope.groups.get(&group) {
                Some(members) => Some(members.iter().collect::<HashSet<&Who>>()),
                None => {
                    reasons.push(format!("group : le groupe {group} n'existe pas."));
                    None
                }
            },
            None => Some(everyone.clone()),
        };
        if let Some(round) = item.round
            && !(1..=ROUND_MAX).contains(&round)
        {
            reasons.push(format!("round : un entier de 1 à {ROUND_MAX} est attendu."));
        }
        if item.bracket.is_some() && scope.format != StepFormat::DoubleElim {
            reasons.push("bracket : seulement en double élimination.".into());
        }
        if let Some(number) = item.number
            && number < 1
        {
            reasons.push("number : un entier à partir de 1 est attendu.".into());
        }
        for (field, slot) in [
            ("next_slot", item.next_slot),
            ("loser_next_slot", item.loser_next_slot),
        ] {
            if slot.is_some_and(|s| !matches!(s, 1 | 2)) {
                reasons.push(format!("{field} : 1 ou 2 est attendu."));
            }
        }
        if let Some(next) = item.loser_next {
            if !eliminating {
                reasons.push("loser_next : le perdant ne se propage qu'en élimination.".into());
            } else if next >= matches.len() || next == index {
                reasons.push(format!("loser_next : le match {} est invalide.", next + 1));
            }
        }
        if let Some(next) = item.next {
            if !eliminating {
                reasons.push("next : le vainqueur ne se propage qu'en élimination.".into());
            } else if next >= matches.len() {
                reasons.push(format!("next : le match {} n'existe pas.", next + 1));
            } else if loops(matches, index) {
                reasons.push("next : le match suivant forme une boucle.".into());
            }
        }
        let status = item.status.unwrap_or(MatchStatus::Scheduled);
        let times: Vec<Option<String>> = [&item.scheduled_at, &item.started_at, &item.ended_at]
            .into_iter()
            .map(|value| value.as_deref().and_then(normalize_timestamp))
            .collect();
        for (field, raw, normalized) in [
            ("scheduled_at", &item.scheduled_at, &times[0]),
            ("started_at", &item.started_at, &times[1]),
            ("ended_at", &item.ended_at, &times[2]),
        ] {
            if raw.is_some() && normalized.is_none() {
                reasons.push(format!(
                    "{field} : un horodatage RFC 3339 en UTC (suffixe Z) est attendu."
                ));
            }
        }
        if let (Some(started), Some(ended)) = (&times[1], &times[2])
            && ended < started
        {
            reasons.push("ended_at : le match finit avant d'avoir commencé.".into());
        }
        if status == MatchStatus::Scheduled
            && (item.started_at.is_some() || item.ended_at.is_some())
        {
            reasons.push("status : un match `scheduled` n'a ni début ni fin.".into());
        }
        if status == MatchStatus::Ongoing && item.ended_at.is_some() {
            reasons.push("status : un match `ongoing` n'a pas de fin.".into());
        }

        let count = item.participants.len();
        if count > capacity_of(scope.match_type, scope.group_size) {
            reasons.push(format!(
                "participants : {count} participants, {} au plus.",
                capacity_of(scope.match_type, scope.group_size)
            ));
        }
        // Un match exempt (bye) : un seul participant, terminé, qui gagne.
        let bye = status == MatchStatus::Finished
            && count == 1
            && item.participants[0].result == Some(MatchResult::Win);
        if !bye
            && matches!(status, MatchStatus::Ongoing | MatchStatus::Finished)
            && let Some(problem) = playable_problem(scope.match_type, scope.group_size, count)
        {
            reasons.push(format!("participants : {problem}"));
        }
        let mut seen = HashSet::new();
        // Identifiant provisoire de chaque participant, commun au match et à ses parties.
        let mut placeholders: HashMap<Who, Uuid> = HashMap::new();
        let mut members = Vec::with_capacity(count);
        for participant in &item.participants {
            let mut placeholder = Uuid::new_v4();
            match participant.who() {
                Err(problem) => reasons.push(format!("participants : {problem}.")),
                Ok(who) => {
                    if allowed.as_ref().is_some_and(|set| !set.contains(&who)) {
                        reasons.push(format!("participants : {who} n'est pas dans ce groupe."));
                    } else if !seen.insert(who.clone()) {
                        reasons.push(format!("participants : {who} apparaît plusieurs fois."));
                    } else {
                        placeholders.insert(who.clone(), placeholder);
                    }
                    placeholder = placeholders.get(&who).copied().unwrap_or(placeholder);
                }
            }
            if !participant.points.is_none_or(f64::is_finite) {
                reasons.push("participants : `points` doit être un nombre fini.".into());
            }
            if participant.slot.is_some_and(|s| !matches!(s, 1 | 2)) {
                reasons.push("participants : `slot` vaut 1 ou 2.".into());
            }
            if participant.games_won.is_some_and(|g| g < 0) {
                reasons.push("participants : `games_won` est positif.".into());
            }
            if let Some(rank) = participant.rank
                && !(1..=i32::try_from(count).unwrap_or(i32::MAX)).contains(&rank)
            {
                reasons.push(format!(
                    "participants : le rang {rank} doit aller de 1 à {count}."
                ));
            }
            if let Err(problem) = schema.parse(&participant.stats()) {
                reasons.push(format!("participants : stats : {problem}"));
            }
            members.push(MatchParticipant {
                match_id: Uuid::nil(),
                participant_id: placeholder,
                stats: participant.stats(),
                points: participant.points.unwrap_or(0.0),
                rank: participant.rank,
                result: participant.result,
                slot: participant.slot,
                games_won: participant.games_won,
            });
        }
        let settled = if status == MatchStatus::Finished {
            match settle(&members) {
                Ok(scores) => Some(scores),
                Err(problem) => {
                    reasons.push(format!("participants : {problem}"));
                    None
                }
            }
        } else {
            None
        };
        let (game_reasons, games) = game_problems(item, status, &placeholders, scope, schema);
        let games_valid = game_reasons.is_empty();
        reasons.extend(game_reasons);
        if games_valid && !games.is_empty() {
            reasons.extend(series_problems(
                item.best_of.unwrap_or(1),
                status,
                &games,
                settled.as_deref(),
                &placeholders,
            ));
        }
        if !reasons.is_empty() {
            out.push(format!("match {label} : {}", reasons.join(" ")));
        }
    }
    out.truncate(MAX_REPORTED_ERRORS);
    out
}

/// Ce qui ne va pas dans la série d'un match : longueur, statut, participants et attributs des
/// parties. `members` donne l'identifiant provisoire de chaque participant du match. Rend aussi
/// les parties, leurs résultats déduits, pour contrôler la série ([`series_problems`]).
fn game_problems(
    item: &MatchItem,
    status: MatchStatus,
    members: &HashMap<Who, Uuid>,
    scope: &StepScope,
    schema: &StatSchema,
) -> (Vec<String>, Vec<MatchGame>) {
    let mut reasons = Vec::new();
    let mut games = Vec::new();
    let best_of = item.best_of.unwrap_or(1);
    if !BEST_OF.contains(&best_of) {
        reasons.push("best_of : la série compte 1, 3 ou 5 parties.".to_string());
    }
    if item.games.is_empty() {
        // Sans ses parties, une série terminée donne les manches gagnées de chacun.
        if status == MatchStatus::Finished
            && best_of > 1
            && item.participants.iter().any(|p| p.games_won.is_none())
        {
            reasons.push(format!(
                "games : un match terminé en série de {best_of} a ses parties, ou les manches gagnées (`games_won`) de chaque participant."
            ));
        }
        return (reasons, games);
    }
    if item.games.len() > usize::try_from(best_of).unwrap_or(1) {
        reasons.push(format!(
            "games : {} parties pour une série de {best_of}.",
            item.games.len()
        ));
    }
    if status == MatchStatus::Scheduled {
        reasons.push("games : un match `scheduled` n'a pas de parties.".to_string());
    }
    let last = item.games.len() - 1;
    for (index, game) in item.games.iter().enumerate() {
        let label = format!("games {}", index + 1);
        let game_status = game.status.unwrap_or(MatchStatus::Ongoing);
        if !matches!(game_status, MatchStatus::Ongoing | MatchStatus::Finished) {
            reasons.push(format!("{label} : `ongoing` ou `finished` seulement."));
        }
        if game_status == MatchStatus::Ongoing && index != last {
            reasons.push(format!(
                "{label} : seule la dernière partie peut être en cours."
            ));
        }
        if game_status == MatchStatus::Ongoing && status == MatchStatus::Finished {
            reasons.push(format!(
                "{label} : un match terminé n'a pas de partie en cours."
            ));
        }
        for (field, value) in [
            ("started_at", &game.started_at),
            ("ended_at", &game.ended_at),
        ] {
            if value
                .as_deref()
                .is_some_and(|v| normalize_timestamp(v).is_none())
            {
                reasons.push(format!(
                    "{label} : {field} : un horodatage RFC 3339 en UTC (suffixe Z) est attendu."
                ));
            }
        }
        let mut seen = HashSet::new();
        let mut players = HashSet::new();
        let mut ranked = Vec::new();
        for participant in &game.participants {
            let mut placeholder = Uuid::new_v4();
            match participant.who() {
                Err(problem) => reasons.push(format!("{label} : participants : {problem}.")),
                Ok(who) => {
                    if let Some(id) = members.get(&who) {
                        placeholder = *id;
                        if !seen.insert(who.clone()) {
                            reasons.push(format!(
                                "{label} : participants : {who} apparaît plusieurs fois."
                            ));
                        }
                    } else {
                        reasons.push(format!(
                            "{label} : participants : {who} ne joue pas ce match."
                        ));
                    }
                    // Un joueur ne se désigne (MVP) que s'il est membre de l'équipe qu'il
                    // détaille.
                    if let Who::Team(rank) = &who {
                        let roster = scope.team_players.get(rank);
                        players.extend(
                            players_of(&participant.stats())
                                .into_iter()
                                .filter(|player| roster.is_some_and(|r| r.contains(player))),
                        );
                    }
                }
            }
            if !participant.points.is_none_or(f64::is_finite) {
                reasons.push(format!(
                    "{label} : participants : `points` doit être un nombre fini."
                ));
            }
            if let Some(rank) = participant.rank
                && !(1..=i32::try_from(item.participants.len()).unwrap_or(i32::MAX)).contains(&rank)
            {
                reasons.push(format!(
                    "{label} : participants : le rang {rank} doit aller de 1 au nombre de participants."
                ));
            }
            if let Err(problem) = schema.parse(&participant.stats()) {
                reasons.push(format!("{label} : participants : stats : {problem}"));
            }
            ranked.push(MatchParticipant {
                match_id: Uuid::nil(),
                participant_id: placeholder,
                stats: participant.stats(),
                points: participant.points.unwrap_or(0.0),
                rank: participant.rank,
                result: participant.result,
                games_won: None,
                slot: None,
            });
        }
        let mut settled = Vec::new();
        if game_status == MatchStatus::Finished {
            // Une partie terminée réunit tous les participants du match : les absents ne
            // pourraient plus y être ajoutés.
            let mut missing: Vec<String> = members
                .keys()
                .filter(|who| !seen.contains(*who))
                .map(ToString::to_string)
                .collect();
            missing.sort();
            if game.participants.is_empty() {
                reasons.push(format!("{label} : une partie terminée a ses participants."));
            } else if !missing.is_empty() {
                reasons.push(format!(
                    "{label} : participants : une partie terminée réunit tous les participants du match ; absents : {}.",
                    missing.join(", ")
                ));
            } else {
                match settle(&ranked) {
                    Ok(scores) => settled = scores,
                    Err(problem) => reasons.push(format!("{label} : participants : {problem}")),
                }
            }
        }
        games.push(MatchGame {
            id: Uuid::new_v4(),
            match_id: Uuid::nil(),
            number: i32::try_from(index + 1).unwrap_or(i32::MAX),
            status: game_status,
            attributes: Value::Null,
            started_at: None,
            ended_at: None,
            created_at: String::new(),
            updated_at: String::new(),
            participants: settled
                .into_iter()
                .map(|score| MatchGameParticipant {
                    participant_id: score.participant_id,
                    stats: score.stats,
                    points: score.points,
                    rank: score.rank,
                    result: score.result,
                })
                .collect(),
        });
        if let Some(attributes) = &game.attributes {
            let resolved = resolve_attributes(attributes, &|who| members.get(who).copied());
            match resolved {
                Err(problem) => reasons.push(format!("{label} : attributes : {problem}")),
                Ok(resolved) => {
                    let designated: HashSet<Uuid> =
                        members.values().copied().chain(players).collect();
                    if let Err(problem) = schema.check_attributes(&resolved, &designated) {
                        reasons.push(format!("{label} : attributes : {problem}"));
                    }
                }
            }
        }
    }
    (reasons, games)
}

/// Ce qui oppose le résultat d'un match à celui de ses parties (déjà valides) : comme en
/// direct, la série se termine dès qu'elle est décidée, et le vainqueur du match est celui des
/// parties. `settled` donne les résultats du match s'il est terminé.
fn series_problems(
    best_of: i32,
    status: MatchStatus,
    games: &[MatchGame],
    settled: Option<&[MatchScore]>,
    members: &HashMap<Who, Uuid>,
) -> Vec<String> {
    let decided = is_decided(best_of, games);
    if status != MatchStatus::Finished {
        return if decided {
            vec![
                "games : les parties terminées décident déjà la série : le match est `finished`."
                    .to_string(),
            ]
        } else {
            Vec::new()
        };
    }
    if !decided {
        return vec![format!(
            "games : les parties terminées ne décident pas la série de {best_of} (majorité des parties ou série complète)."
        )];
    }
    let Some(settled) = settled else {
        return Vec::new();
    };
    let ids: Vec<Uuid> = members.values().copied().collect();
    let Ok(expected) = settle(&aggregate(games, &ids, &HashMap::new())) else {
        return Vec::new();
    };
    let mut reasons: Vec<String> = members
        .iter()
        .filter_map(|(who, id)| {
            let wanted = expected.iter().find(|s| s.participant_id == *id)?.result?;
            let declared = settled.iter().find(|s| s.participant_id == *id)?.result?;
            (wanted != declared).then(|| {
                format!(
                    "participants : le résultat de {who} (`{}`) contredit ses parties (`{}` d'après les parties gagnées).",
                    declared.as_str(),
                    wanted.as_str()
                )
            })
        })
        .collect();
    reasons.sort();
    reasons
}

/// Remplace dans les attributs d'une partie chaque participant désigné par `{ "user": .. }` ou
/// `{ "team": .. }` par son identifiant (`resolve`) ; les autres valeurs ne changent pas.
fn resolve_attributes(
    attributes: &Value,
    resolve: &dyn Fn(&Who) -> Option<Uuid>,
) -> Result<Value, String> {
    let Some(object) = attributes.as_object() else {
        return Err("`attributes` doit être un objet.".to_string());
    };
    let mut resolved = serde_json::Map::new();
    for (key, value) in object {
        let value = match value {
            Value::Object(marker) => {
                if let Some(extra) = marker
                    .keys()
                    .find(|k| !matches!(k.as_str(), "user" | "team"))
                {
                    return Err(format!("« {key} » : clé « {extra} » inattendue."));
                }
                let who = designate(
                    marker.get("user").and_then(Value::as_str),
                    marker
                        .get("team")
                        .and_then(Value::as_u64)
                        .and_then(|t| usize::try_from(t).ok()),
                )
                .map_err(|e| format!("« {key} » : {e}."))?;
                let id = resolve(&who)
                    .ok_or_else(|| format!("« {key} » : {who} ne joue pas ce match."))?;
                Value::String(id.to_string())
            }
            other => other.clone(),
        };
        resolved.insert(key.clone(), value);
    }
    Ok(Value::Object(resolved))
}

/// Contraire de [`resolve_attributes`] : un participant du match désigné par son identifiant
/// devient `{ "user": .. }` ou `{ "team": .. }`.
fn designate_attributes(
    attributes: &Value,
    designations: &HashMap<Uuid, Designation>,
    members: &HashSet<Uuid>,
) -> Value {
    let Some(object) = attributes.as_object() else {
        return attributes.clone();
    };
    Value::Object(
        object
            .iter()
            .map(|(key, value)| {
                let marker = value
                    .as_str()
                    .and_then(|v| v.parse::<Uuid>().ok())
                    .filter(|id| members.contains(id))
                    .and_then(|id| designations.get(&id))
                    .map(|who| match (&who.user, who.team) {
                        (Some(user), _) => serde_json::json!({ "user": user }),
                        (None, Some(team)) => serde_json::json!({ "team": team }),
                        (None, None) => value.clone(),
                    });
                (key.clone(), marker.unwrap_or_else(|| value.clone()))
            })
            .collect(),
    )
}

/// Le match suivant de `start` ramène-t-il à `start` ?
fn loops(matches: &[MatchItem], start: usize) -> bool {
    let mut cursor = matches[start].next;
    for _ in 0..matches.len() {
        match cursor {
            Some(index) if index == start => return true,
            Some(index) => cursor = matches.get(index).and_then(|m| m.next),
            None => return false,
        }
    }
    true
}

#[async_trait]
impl StepMatches for StoreMatches {
    async fn export(
        &self,
        step_id: Uuid,
        designations: &HashMap<Uuid, Designation>,
    ) -> Result<Vec<Value>, StoreError> {
        let store = &self.0;
        let groups: HashMap<Uuid, i32> = store
            .list_step_groups(step_id)
            .await?
            .into_iter()
            .map(|g| (g.id, g.index))
            .collect();
        let mut members: HashMap<Uuid, Vec<MatchParticipant>> = HashMap::new();
        for member in store.list_step_match_participants(step_id).await? {
            members.entry(member.match_id).or_default().push(member);
        }
        let mut games: HashMap<Uuid, Vec<MatchGame>> = HashMap::new();
        for game in store.list_step_match_games(step_id).await? {
            games.entry(game.match_id).or_default().push(game);
        }
        let mut entries = Vec::new();
        for found in store.list_matches(step_id, None, None).await? {
            let member_ids: HashSet<Uuid> = members
                .get(&found.id)
                .map(|list| list.iter().map(|m| m.participant_id).collect())
                .unwrap_or_default();
            let mut game_items = Vec::new();
            for game in games.remove(&found.id).unwrap_or_default() {
                let mut game_participants = Vec::new();
                for member in game.participants {
                    let who = designations.get(&member.participant_id).ok_or_else(|| {
                        other(format!(
                            "inscrit {} du match {} introuvable",
                            member.participant_id, found.id
                        ))
                    })?;
                    game_participants.push(MatchParticipantItem {
                        user: who.user.clone(),
                        team: who.team,
                        stats: Some(member.stats),
                        points: Some(member.points),
                        rank: member.rank,
                        result: member.result,
                        games_won: None,
                        slot: None,
                    });
                }
                game_participants.sort_by(|a, b| {
                    (a.user.as_ref().map(|u| u.to_lowercase()), a.team)
                        .cmp(&(b.user.as_ref().map(|u| u.to_lowercase()), b.team))
                });
                let attributes = designate_attributes(&game.attributes, designations, &member_ids);
                game_items.push(GameItem {
                    status: Some(game.status),
                    attributes: attributes
                        .as_object()
                        .is_none_or(|o| !o.is_empty())
                        .then_some(attributes),
                    started_at: game.started_at,
                    ended_at: game.ended_at,
                    participants: game_participants,
                });
            }
            let mut participants = Vec::new();
            for member in members.remove(&found.id).unwrap_or_default() {
                let who = designations.get(&member.participant_id).ok_or_else(|| {
                    other(format!(
                        "inscrit {} du match {} introuvable",
                        member.participant_id, found.id
                    ))
                })?;
                participants.push(MatchParticipantItem {
                    user: who.user.clone(),
                    team: who.team,
                    stats: Some(member.stats),
                    points: Some(member.points),
                    rank: member.rank,
                    result: member.result,
                    slot: member.slot,
                    games_won: member.games_won,
                });
            }
            // Ordre indépendant des identifiants : deux exports du même contenu sont identiques.
            participants.sort_by(|a, b| {
                (a.user.as_ref().map(|u| u.to_lowercase()), a.team)
                    .cmp(&(b.user.as_ref().map(|u| u.to_lowercase()), b.team))
            });
            let item = MatchItem {
                group: found.group_id.and_then(|id| groups.get(&id).copied()),
                round: found.round,
                number: found.number,
                bracket: found.bracket,
                best_of: (found.best_of != 1).then_some(found.best_of),
                next: None,
                next_slot: found.next_slot,
                loser_next: None,
                loser_next_slot: found.loser_next_slot,
                scheduled_at: found.scheduled_at.clone(),
                started_at: found.started_at.clone(),
                ended_at: found.ended_at.clone(),
                status: Some(found.status),
                participants,
                games: game_items,
            };
            entries.push((
                found.id,
                (found.next_match_id, found.loser_next_match_id),
                item,
            ));
        }
        entries.sort_by_cached_key(|(_, _, item)| {
            let who: Vec<(Option<String>, Option<usize>)> = item
                .participants
                .iter()
                .map(|p| (p.user.as_ref().map(|u| u.to_lowercase()), p.team))
                .collect();
            (
                item.group,
                item.round,
                item.bracket.map(Bracket::as_str),
                item.number,
                item.scheduled_at.clone(),
                item.status.map(MatchStatus::as_str),
                who,
            )
        });
        let position: HashMap<Uuid, usize> = entries
            .iter()
            .enumerate()
            .map(|(index, (id, _, _))| (*id, index))
            .collect();
        entries
            .into_iter()
            .map(|(_, (next, loser_next), mut item)| {
                item.next = next.and_then(|id| position.get(&id).copied());
                item.loser_next = loser_next.and_then(|id| position.get(&id).copied());
                serde_json::to_value(item).map_err(other)
            })
            .collect()
    }

    async fn validate(
        &self,
        game_id: Uuid,
        scope: &StepScope,
        items: &[Value],
    ) -> Result<Option<String>, StoreError> {
        let matches = match parse(items) {
            Ok(matches) => matches,
            Err(problem) => return Ok(Some(problem)),
        };
        if matches.is_empty() {
            return Ok(None);
        }
        let schema = StatSchema::new(&self.0.list_game_stats(game_id).await?.unwrap_or_default());
        let found = problems(&matches, scope, &schema);
        Ok((!found.is_empty()).then(|| found.join(" ")))
    }

    async fn import(
        &self,
        step_id: Uuid,
        game_id: Uuid,
        participants: &HashMap<Who, Uuid>,
        items: Vec<Value>,
    ) -> Result<(), StoreError> {
        let matches = parse(&items).map_err(StoreError::Other)?;
        let store = &self.0;
        let step = store
            .find_step(step_id)
            .await?
            .ok_or_else(|| other(format!("étape {step_id} introuvable")))?;
        let groups: HashMap<i32, Uuid> = store
            .list_step_groups(step_id)
            .await?
            .into_iter()
            .map(|g| (g.index, g.id))
            .collect();
        let stats = store.list_game_stats(game_id).await?.unwrap_or_default();
        let rules = store.list_scoring_rules(step.tournament_id).await?;
        let schema = StatSchema::new(&stats);

        let mut imports = Vec::with_capacity(matches.len());
        for item in matches {
            let status = item.status.unwrap_or(MatchStatus::Scheduled);
            let mut scores = Vec::with_capacity(item.participants.len());
            for participant in &item.participants {
                let who = participant.who().map_err(other)?;
                let participant_id = participants
                    .get(&who)
                    .copied()
                    .ok_or_else(|| other(format!("inscrit {who} introuvable")))?;
                let value = participant.stats();
                let points = match participant.points {
                    Some(points) => points,
                    None => points_of(&schema.parse(&value).map_err(other)?, &rules, &stats),
                };
                scores.push(MatchScore {
                    participant_id,
                    stats: value,
                    points,
                    rank: participant.rank,
                    result: participant.result,
                    games_won: participant.games_won,
                    slot: participant.slot,
                });
            }
            if status == MatchStatus::Finished {
                // Les rangs et résultats absents d'un match terminé se déduisent des points.
                let members: Vec<MatchParticipant> = scores
                    .iter()
                    .map(|s| MatchParticipant {
                        match_id: Uuid::nil(),
                        participant_id: s.participant_id,
                        stats: s.stats.clone(),
                        points: s.points,
                        rank: s.rank,
                        result: s.result,
                        slot: s.slot,
                        games_won: s.games_won,
                    })
                    .collect();
                scores = settle(&members).map_err(other)?;
            }
            let normalized = |value: &Option<String>| {
                value
                    .as_deref()
                    .map(|v| normalize_timestamp(v).unwrap_or_else(|| v.to_string()))
            };
            let mut games = Vec::with_capacity(item.games.len());
            for game in &item.games {
                let mut game_scores = Vec::with_capacity(game.participants.len());
                for participant in &game.participants {
                    let who = participant.who().map_err(other)?;
                    let participant_id = participants
                        .get(&who)
                        .copied()
                        .ok_or_else(|| other(format!("inscrit {who} introuvable")))?;
                    let value = participant.stats();
                    let points = match participant.points {
                        Some(points) => points,
                        None => points_of(&schema.parse(&value).map_err(other)?, &rules, &stats),
                    };
                    game_scores.push(MatchScore {
                        participant_id,
                        stats: value,
                        points,
                        rank: participant.rank,
                        result: participant.result,
                        games_won: None,
                        slot: None,
                    });
                }
                let game_status = game.status.unwrap_or(MatchStatus::Ongoing);
                if game_status == MatchStatus::Finished {
                    let members: Vec<MatchParticipant> = game_scores
                        .iter()
                        .map(|s| MatchParticipant {
                            match_id: Uuid::nil(),
                            participant_id: s.participant_id,
                            stats: s.stats.clone(),
                            points: s.points,
                            rank: s.rank,
                            result: s.result,
                            games_won: None,
                            slot: None,
                        })
                        .collect();
                    game_scores = settle(&members).map_err(other)?;
                }
                let attributes = match &game.attributes {
                    Some(attributes) => {
                        resolve_attributes(attributes, &|who| participants.get(who).copied())
                            .map_err(other)?
                    }
                    None => serde_json::json!({}),
                };
                let normalized = |value: &Option<String>| {
                    value
                        .as_deref()
                        .map(|v| normalize_timestamp(v).unwrap_or_else(|| v.to_string()))
                };
                games.push(GameImport {
                    status: game_status,
                    attributes,
                    started_at: normalized(&game.started_at),
                    ended_at: normalized(&game.ended_at),
                    participants: game_scores,
                });
            }
            imports.push(MatchImport {
                group_id: item.group.and_then(|index| groups.get(&index).copied()),
                round: item.round,
                bracket: item.bracket,
                next: item.next,
                next_slot: item.next_slot,
                loser_next: item.loser_next,
                loser_next_slot: item.loser_next_slot,
                number: item.number,
                best_of: item.best_of.unwrap_or(1),
                games,
                scheduled_at: normalized(&item.scheduled_at),
                started_at: normalized(&item.started_at),
                ended_at: normalized(&item.ended_at),
                status,
                participants: scores,
            });
        }
        if store
            .replace_step_matches(step_id, game_id, imports)
            .await?
        {
            Ok(())
        } else {
            Err(other(format!("étape {step_id} introuvable")))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::{MatchType, Stat, StatOption, StatScope, StatType};
    use serde_json::json;

    fn scope(match_type: MatchType, format: StepFormat) -> StepScope {
        let group = |names: &[&str]| -> HashSet<Who> {
            names.iter().map(|n| Who::User((*n).to_string())).collect()
        };
        StepScope {
            status: StepStatus::Ongoing,
            format,
            match_type,
            group_size: 4,
            groups: HashMap::from([(1, group(&["ann", "bob", "cat"])), (2, group(&["dan"]))]),
            team_players: HashMap::new(),
        }
    }

    fn known() -> StatSchema {
        let stat = |key: &str, kind, scope, options: &[&str]| Stat {
            id: Uuid::new_v4(),
            name: key.to_string(),
            key: key.to_string(),
            kind,
            scope,
            options: options
                .iter()
                .map(|o| StatOption {
                    key: (*o).to_string(),
                    label: (*o).to_string(),
                })
                .collect(),
        };
        StatSchema::new(&[
            stat("kills", StatType::Flat, StatScope::Participant, &[]),
            stat("accuracy", StatType::Percent, StatScope::Participant, &[]),
            stat(
                "character",
                StatType::Select,
                StatScope::Participant,
                &["jett", "omen"],
            ),
            stat(
                "map",
                StatType::Select,
                StatScope::Match,
                &["ascent", "bind"],
            ),
            stat("mvp", StatType::Mvp, StatScope::Match, &[]),
        ])
    }

    fn item(value: Value) -> MatchItem {
        serde_json::from_value(value).unwrap()
    }

    fn problems_of(scope: &StepScope, items: Vec<Value>) -> String {
        let items: Vec<MatchItem> = items.into_iter().map(item).collect();
        problems(&items, scope, &known()).join(" ")
    }

    #[test]
    fn a_valid_file_has_no_problem() {
        let pool = scope(MatchType::Ffa, StepFormat::Pool);
        let finished = json!({
            "group": 1, "round": 1, "status": "finished",
            "scheduled_at": "2026-11-14T18:00:00Z",
            "started_at": "2026-11-14T18:05:00Z", "ended_at": "2026-11-14T18:40:00Z",
            "participants": [
                { "user": "ann", "stats": { "kills": 3 }, "points": 4.5, "rank": 1, "result": "win" },
                { "user": "bob", "stats": { "kills": 1 }, "points": 1.5, "rank": 2, "result": "loss" },
            ],
        });
        assert_eq!(
            problems_of(&pool, vec![finished, json!({ "group": 2 })]),
            ""
        );
    }

    #[test]
    fn matches_need_a_launched_step_and_an_existing_group() {
        let mut pending = scope(MatchType::Ffa, StepFormat::Pool);
        pending.status = StepStatus::Pending;
        assert!(problems_of(&pending, vec![json!({ "group": 1 })]).contains("pending"));
        assert_eq!(problems_of(&pending, vec![]), "");
        let pool = scope(MatchType::Ffa, StepFormat::Pool);
        assert!(problems_of(&pool, vec![json!({ "group": 3 })]).contains("group"));
        assert!(
            problems_of(
                &pool,
                vec![json!({ "group": 1, "participants": [{ "user": "dan" }] })]
            )
            .contains("n'est pas dans ce groupe")
        );
    }

    #[test]
    fn participants_follow_the_match_type() {
        let duel = scope(MatchType::Duel, StepFormat::Pool);
        let three = json!([{ "user": "ann" }, { "user": "bob" }, { "user": "cat" }]);
        assert!(
            problems_of(&duel, vec![json!({ "group": 1, "participants": three })])
                .contains("2 au plus")
        );
        let one = json!([{ "user": "ann", "stats": { "kills": 1 } }]);
        assert!(
            problems_of(
                &duel,
                vec![json!({ "group": 1, "status": "finished", "participants": one })]
            )
            .contains("exactement 2")
        );
        // Une seule personne attend son adversaire tant que le match n'est pas lancé.
        assert_eq!(
            problems_of(&duel, vec![json!({ "group": 1, "participants": one })]),
            ""
        );
        let twice = json!([{ "user": "ann" }, { "user": "ANN" }]);
        assert!(
            problems_of(&duel, vec![json!({ "group": 1, "participants": twice })])
                .contains("plusieurs fois")
        );
        let both = json!([{ "user": "ann", "team": 0 }]);
        assert!(
            problems_of(&duel, vec![json!({ "group": 1, "participants": both })])
                .contains("pas les deux")
        );
    }

    #[test]
    fn stats_and_ranks_are_checked() {
        let pool = scope(MatchType::Ffa, StepFormat::Pool);
        for (participants, expected) in [
            (
                json!([{ "user": "ann", "stats": { "deaths": 1 } }]),
                "stats",
            ),
            (
                json!([{ "user": "ann", "stats": { "accuracy": 120 } }]),
                "stats",
            ),
            (
                json!([{ "user": "ann", "points": null, "rank": 2 }]),
                "rang",
            ),
            (
                json!([{ "user": "ann", "result": "win", "rank": 0 }]),
                "rang",
            ),
        ] {
            let found = problems_of(
                &pool,
                vec![json!({ "group": 1, "participants": participants })],
            );
            assert!(found.contains(expected), "{found}");
        }
        // Un match terminé a des résultats pour tous, et des rangs pour tous ou aucun.
        let blank = json!([{ "user": "ann" }, { "user": "bob" }]);
        assert!(
            problems_of(
                &pool,
                vec![json!({ "group": 1, "status": "finished", "participants": blank })]
            )
            .contains("Ni statistiques ni rang")
        );
        let partial = json!([
            { "user": "ann", "stats": { "kills": 1 }, "rank": 1 },
            { "user": "bob", "stats": { "kills": 1 } },
        ]);
        let found = problems_of(
            &pool,
            vec![json!({ "group": 1, "status": "finished", "participants": partial })],
        );
        assert!(found.contains("rang, ou aucun"), "{found}");
    }

    #[test]
    fn the_bracket_follows_the_format() {
        let pool = scope(MatchType::Duel, StepFormat::Pool);
        let wrong = vec![
            json!({ "group": 1, "bracket": "winners" }),
            json!({ "group": 1, "next": 0 }),
        ];
        let found = problems_of(&pool, wrong);
        assert!(
            found.contains("bracket") && found.contains("next"),
            "{found}"
        );

        let double = scope(MatchType::Duel, StepFormat::DoubleElim);
        let chain = vec![
            json!({ "group": 1, "bracket": "winners", "next": 1 }),
            json!({ "group": 1, "bracket": "grand_final" }),
        ];
        assert_eq!(problems_of(&double, chain), "");
        let single = scope(MatchType::Duel, StepFormat::SingleElim);
        for (items, expected) in [
            (vec![json!({ "group": 1, "next": 5 })], "n'existe pas"),
            (vec![json!({ "group": 1, "next": 0 })], "boucle"),
            (
                vec![
                    json!({ "group": 1, "next": 1 }),
                    json!({ "group": 1, "next": 0 }),
                ],
                "boucle",
            ),
        ] {
            assert!(problems_of(&single, items).contains(expected), "{expected}");
        }
    }

    #[test]
    fn dates_and_status_are_consistent() {
        let pool = scope(MatchType::Ffa, StepFormat::Pool);
        for (value, expected) in [
            (
                json!({ "group": 1, "scheduled_at": "demain" }),
                "scheduled_at",
            ),
            (
                json!({ "group": 1, "status": "finished", "started_at": "2026-11-14T19:00:00Z",
                        "ended_at": "2026-11-14T18:00:00Z" }),
                "avant d'avoir commencé",
            ),
            (
                json!({ "group": 1, "started_at": "2026-11-14T18:00:00Z" }),
                "scheduled",
            ),
            (
                json!({ "group": 1, "status": "ongoing", "ended_at": "2026-11-14T18:00:00Z" }),
                "ongoing",
            ),
            (json!({ "group": 1, "round": 0 }), "round"),
        ] {
            let found = problems_of(&pool, vec![value]);
            assert!(found.contains(expected), "{expected}: {found}");
        }
    }

    /// Partie terminée d'un duel ann/bob gagnée par `winner`.
    fn duel_game(winner: &str) -> Value {
        let loser = if winner == "ann" { "bob" } else { "ann" };
        json!({ "status": "finished", "participants": [
            { "user": winner, "stats": { "kills": 3 }, "rank": 1 },
            { "user": loser, "stats": { "kills": 1 }, "rank": 2 },
        ] })
    }

    fn series_match(status: &str, winner: Option<&str>, games: Vec<Value>) -> Value {
        let participants = match winner {
            Some(winner) => {
                let loser = if winner == "ann" { "bob" } else { "ann" };
                json!([
                    { "user": winner, "stats": { "kills": 6 }, "rank": 1 },
                    { "user": loser, "stats": { "kills": 2 }, "rank": 2 },
                ])
            }
            None => json!([{ "user": "ann" }, { "user": "bob" }]),
        };
        json!({ "group": 1, "best_of": 3, "status": status,
                "participants": participants, "games": games })
    }

    #[test]
    fn an_imported_series_agrees_with_its_games() {
        let duel = scope(MatchType::Duel, StepFormat::Pool);
        let won = vec![duel_game("ann"), duel_game("ann")];
        assert_eq!(
            problems_of(
                &duel,
                vec![series_match("finished", Some("ann"), won.clone())]
            ),
            ""
        );
        // Ann gagne deux parties : le match ne peut pas annoncer Bob vainqueur.
        let found = problems_of(
            &duel,
            vec![series_match("finished", Some("bob"), won.clone())],
        );
        assert!(found.contains("contredit ses parties"), "{found}");
        // Une partie terminée ne décide pas un BO3.
        let found = problems_of(
            &duel,
            vec![series_match(
                "finished",
                Some("ann"),
                vec![duel_game("ann")],
            )],
        );
        assert!(found.contains("ne décident pas"), "{found}");
        // Une série décidée ne laisse pas le match en cours.
        let found = problems_of(&duel, vec![series_match("ongoing", None, won)]);
        assert!(found.contains("décident déjà"), "{found}");
    }

    #[test]
    fn a_finished_game_has_every_participant_of_the_match() {
        let duel = scope(MatchType::Duel, StepFormat::Pool);
        let alone = json!({ "status": "finished", "participants": [
            { "user": "ann", "stats": { "kills": 3 }, "rank": 1 },
        ] });
        let found = problems_of(&duel, vec![series_match("ongoing", None, vec![alone])]);
        assert!(found.contains("absents"), "{found}");
    }

    #[test]
    fn an_mvp_player_belongs_to_the_team_he_details() {
        let member = Uuid::new_v4();
        let stranger = Uuid::new_v4();
        let mut teams = scope(MatchType::Duel, StepFormat::Pool);
        teams.groups = HashMap::from([(1, HashSet::from([Who::Team(0), Who::Team(1)]))]);
        teams.team_players = HashMap::from([(0, HashSet::from([member]))]);
        let with_mvp = |mvp: Uuid| {
            let stats = json!({ "total": { "kills": 2 },
                "players": { member.to_string(): { "kills": 1 }, stranger.to_string(): { "kills": 1 } } });
            json!({ "group": 1, "best_of": 3, "status": "ongoing",
                "participants": [{ "team": 0 }, { "team": 1 }],
                "games": [{ "attributes": { "mvp": mvp.to_string() },
                            "participants": [{ "team": 0, "stats": stats }, { "team": 1 }] }] })
        };
        assert_eq!(problems_of(&teams, vec![with_mvp(member)]), "");
        let found = problems_of(&teams, vec![with_mvp(stranger)]);
        assert!(found.contains("attributes"), "{found}");
    }

    #[test]
    fn unknown_keys_are_refused_and_loops_detected() {
        assert!(parse(&[json!({ "group": 1, "winner": "ann" })]).is_err());
        assert_eq!(parse(&[json!({})]).unwrap().len(), 1);
        let chain: Vec<MatchItem> = [Some(1), Some(2), None]
            .into_iter()
            .map(|next| item(json!({ "next": next })))
            .collect();
        assert!(!loops(&chain, 0));
    }
}
