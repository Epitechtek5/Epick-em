//! Matchs d'une étape (`match` et `match_participant`), sous-niveau du fichier des étapes (voir
//! [`crate::step_io`]).
//!
//! Le niveau des étapes les traite comme des valeurs opaques ; ce module est le seul à connaître
//! leur structure : un tableau de
//! `{ "group", "round", "bracket", "next", "scheduled_at", "started_at", "ended_at", "status",
//!   "participants": [{ "user" | "team", "stats", "points", "rank", "result" }] }`.
//!
//! Le groupe est désigné par son rang dans l'étape, le match suivant (`next`) par son rang (à
//! partir de 0) dans le tableau des matchs de la même étape, et un participant comme dans le
//! fichier des étapes : `user` (nom d'utilisateur) ou `team` (rang dans `teams`). `stats` est le
//! JSON de `match_participant.stats`. Les matchs voyagent avec leur étape : le niveau des
//! tournois, lui, refuse un tableau `matches` non vide ([`InSteps`]).
//!
//! Importer remplace tous les matchs de l'étape. Les points absents du fichier sont calculés
//! d'après le barème du tournoi, déjà écrit ; ceux du fichier sont conservés tels quels, si bien
//! qu'un fichier exporté se réimporte sans perte (hors horodatages de création).

use crate::matches::{ROUND_MAX, capacity_of, parse_stats, playable_problem, points_of, settle};
use crate::step_io::{Designation, StepMatches, StepScope, Who, designate};
use crate::store::{
    AuthStore, Bracket, MatchImport, MatchParticipant, MatchResult, MatchScore, MatchStatus,
    StatType, StepFormat, StepStatus, StoreError,
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
    #[serde(default)]
    round: Option<i32>,
    #[serde(default)]
    bracket: Option<Bracket>,
    /// Rang (à partir de 0), dans les matchs de l'étape, du match où va le vainqueur.
    #[serde(default)]
    next: Option<usize>,
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
fn problems(
    matches: &[MatchItem],
    scope: &StepScope,
    known: &HashMap<String, StatType>,
) -> Vec<String> {
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
        if matches!(status, MatchStatus::Ongoing | MatchStatus::Finished)
            && let Some(problem) = playable_problem(scope.match_type, scope.group_size, count)
        {
            reasons.push(format!("participants : {problem}"));
        }
        let mut seen = HashSet::new();
        let mut members = Vec::with_capacity(count);
        for participant in &item.participants {
            match participant.who() {
                Err(problem) => reasons.push(format!("participants : {problem}.")),
                Ok(who) => {
                    if allowed.as_ref().is_some_and(|set| !set.contains(&who)) {
                        reasons.push(format!("participants : {who} n'est pas dans ce groupe."));
                    } else if !seen.insert(who.clone()) {
                        reasons.push(format!("participants : {who} apparaît plusieurs fois."));
                    }
                }
            }
            if !participant.points.is_none_or(f64::is_finite) {
                reasons.push("participants : `points` doit être un nombre fini.".into());
            }
            if let Some(rank) = participant.rank
                && !(1..=i32::try_from(count).unwrap_or(i32::MAX)).contains(&rank)
            {
                reasons.push(format!(
                    "participants : le rang {rank} doit aller de 1 à {count}."
                ));
            }
            if let Err(problem) = parse_stats(&participant.stats(), known) {
                reasons.push(format!("participants : stats : {problem}"));
            }
            members.push(MatchParticipant {
                match_id: Uuid::nil(),
                participant_id: Uuid::new_v4(),
                stats: participant.stats(),
                points: participant.points.unwrap_or(0.0),
                rank: participant.rank,
                result: participant.result,
            });
        }
        if status == MatchStatus::Finished
            && let Err(problem) = settle(&members)
        {
            reasons.push(format!("participants : {problem}"));
        }
        if !reasons.is_empty() {
            out.push(format!("match {label} : {}", reasons.join(" ")));
        }
    }
    out.truncate(MAX_REPORTED_ERRORS);
    out
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
        let mut entries = Vec::new();
        for found in store.list_matches(step_id, None, None).await? {
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
                bracket: found.bracket,
                next: None,
                scheduled_at: found.scheduled_at.clone(),
                started_at: found.started_at.clone(),
                ended_at: found.ended_at.clone(),
                status: Some(found.status),
                participants,
            };
            entries.push((found.id, found.next_match_id, item));
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
            .map(|(_, next, mut item)| {
                item.next = next.and_then(|id| position.get(&id).copied());
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
        let known: HashMap<String, StatType> = self
            .0
            .list_game_stats(game_id)
            .await?
            .unwrap_or_default()
            .into_iter()
            .map(|s| (s.key, s.kind))
            .collect();
        let found = problems(&matches, scope, &known);
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
        let known: HashMap<String, StatType> =
            stats.iter().map(|s| (s.key.clone(), s.kind)).collect();

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
                    None => points_of(&parse_stats(&value, &known).map_err(other)?, &rules, &stats),
                };
                scores.push(MatchScore {
                    participant_id,
                    stats: value,
                    points,
                    rank: participant.rank,
                    result: participant.result,
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
                    })
                    .collect();
                scores = settle(&members).map_err(other)?;
            }
            let normalized = |value: &Option<String>| {
                value
                    .as_deref()
                    .map(|v| normalize_timestamp(v).unwrap_or_else(|| v.to_string()))
            };
            imports.push(MatchImport {
                group_id: item.group.and_then(|index| groups.get(&index).copied()),
                round: item.round,
                bracket: item.bracket,
                next: item.next,
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
    use crate::store::MatchType;
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
        }
    }

    fn known() -> HashMap<String, StatType> {
        HashMap::from([
            ("kills".to_string(), StatType::Flat),
            ("accuracy".to_string(), StatType::Percent),
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
