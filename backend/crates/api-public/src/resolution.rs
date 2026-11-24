//! Résolution des pronostics et du Pick'em d'un tournoi.
//!
//! [`resolve_tournament`] recalcule **à partir de l'état** (matchs, étapes, classement) l'issue
//! et les points de chaque pronostic et de chaque réponse, puis n'écrit que ce qui change. La
//! rejouer ne compte donc jamais deux fois les mêmes points, et une correction de résultat —
//! saisie locale ou changement venu de start.gg — se répercute à la résolution suivante.
//!
//! api-internal appelle [`resolve_pending`] à intervalle régulier (`RESOLVE_INTERVAL_SECS`). Un
//! finished tournament remains eligible for recalculation: local and external results can
//! still be corrected after completion.

use crate::store::{
    Answer, AuthStore, Match, MatchParticipant, MatchResult, MatchStatus, PickOutcome, Prediction,
    Question, QuestionKind, Resolved, Step, StepParticipantStatus, StepStatus, StoreError,
    Tournament, TournamentStatus,
};
use domain::pickem::{MatchState, Score, score_pick, score_ranking, score_set, score_winner};
use serde_json::Value;
use std::collections::HashMap;
use uuid::Uuid;

/// Bilan de la résolution d'un tournoi.
#[derive(Debug, Clone, PartialEq)]
pub struct ResolutionReport {
    pub tournament_id: Uuid,
    pub predictions: usize,
    pub answers: usize,
    /// All current results are final; later corrections are still recalculated.
    pub settled: bool,
    pub changed: usize,
    /// IDs whose prediction/answer windows are currently closed.
    pub locked: Vec<Uuid>,
}

/// État d'un match, vu par les pronostics : annulé (ou supprimé) → sans objet, terminé → rangs
/// et vainqueur, sinon en attente.
pub fn match_state(found: Option<&Match>, participants: &[MatchParticipant]) -> MatchState<Uuid> {
    let Some(found) = found else {
        return MatchState::Void;
    };
    match found.status {
        MatchStatus::Cancelled => MatchState::Void,
        MatchStatus::Finished => {
            let winners: Vec<Uuid> = participants
                .iter()
                .filter(|p| p.result == Some(MatchResult::Win))
                .map(|p| p.participant_id)
                .collect();
            MatchState::Finished {
                ranks: participants
                    .iter()
                    .map(|p| (p.participant_id, p.rank))
                    .collect(),
                winner: (winners.len() == 1).then(|| winners[0]),
            }
        }
        MatchStatus::Scheduled | MatchStatus::Ongoing => MatchState::Pending,
    }
}

/// Note un pronostic de match.
pub fn score_prediction(prediction: &Prediction, state: &MatchState<Uuid>) -> Score {
    match (&prediction.winner_id, &prediction.ranking) {
        (Some(winner), _) => score_winner(winner, state),
        (None, Some(ranking)) => score_ranking(ranking, state),
        (None, None) => Score::VOID,
    }
}

/// Ce que la résolution sait du tournoi.
pub struct TournamentFacts {
    pub tournament: Tournament,
    pub steps: Vec<Step>,
    /// Inscrits de chaque étape (participant, rang final, statut).
    pub step_participants: HashMap<Uuid, Vec<(Uuid, Option<i32>, StepParticipantStatus)>>,
    /// Points de chaque inscrit dans le tournoi.
    pub points: HashMap<Uuid, f64>,
}

/// Bonnes réponses à une question : `None` tant qu'elle n'est pas tranchée, une liste vide si
/// elle ne peut pas l'être (étape disparue, tournoi annulé…), et le nombre de réponses attendues.
pub fn question_answers(
    question: &Question,
    facts: &TournamentFacts,
) -> (Option<Vec<Uuid>>, usize) {
    let tournament_over = facts.tournament.status == TournamentStatus::Finished;
    if facts.tournament.status == TournamentStatus::Cancelled {
        return (Some(Vec::new()), 1);
    }
    match question.kind {
        QuestionKind::TournamentWinner => {
            let last = facts.steps.iter().max_by_key(|s| s.position);
            let winners: Vec<Uuid> = last
                .filter(|s| s.status == StepStatus::Finished)
                .and_then(|s| facts.step_participants.get(&s.id))
                .map(|participants| {
                    participants
                        .iter()
                        .filter(|(_, rank, _)| *rank == Some(1))
                        .map(|(id, _, _)| *id)
                        .collect()
                })
                .unwrap_or_default();
            if !winners.is_empty() {
                (Some(winners), 1)
            } else if tournament_over {
                (Some(Vec::new()), 1)
            } else {
                (None, 1)
            }
        }
        QuestionKind::TopScorer => {
            if !tournament_over {
                return (None, 1);
            }
            let entries: Vec<(Uuid, f64)> = facts.points.iter().map(|(k, v)| (*k, *v)).collect();
            // Sans aucun point marqué, il n'y a pas de meilleur marqueur.
            let leaders = if entries.iter().any(|(_, p)| *p > 0.0) {
                domain::pickem::leaders(&entries)
            } else {
                Vec::new()
            };
            (Some(leaders), 1)
        }
        QuestionKind::StepQualifiers => {
            let step =
                step_param(&question.params).and_then(|id| facts.steps.iter().find(|s| s.id == id));
            let Some(step) = step else {
                return (Some(Vec::new()), 1);
            };
            let expected = expected_qualifiers(step);
            if step.status != StepStatus::Finished {
                return (
                    if tournament_over {
                        Some(Vec::new())
                    } else {
                        None
                    },
                    expected,
                );
            }
            let qualified = facts
                .step_participants
                .get(&step.id)
                .map(|participants| {
                    participants
                        .iter()
                        .filter(|(_, _, status)| *status == StepParticipantStatus::Qualified)
                        .map(|(id, _, _)| *id)
                        .collect()
                })
                .unwrap_or_default();
            (Some(qualified), expected)
        }
    }
}

/// Qualifiés attendus d'une étape : `advance_per_group` dans chaque groupe.
pub fn expected_qualifiers(step: &Step) -> usize {
    usize::try_from(step.advance_per_group.max(0) * step.group_count.max(0)).unwrap_or(0)
}

/// Étape visée par une question `step_qualifiers` (`params.step_id`).
pub fn step_param(params: &Value) -> Option<Uuid> {
    params.get("step_id")?.as_str()?.parse().ok()
}

/// Inscrit choisi dans une réponse à choix unique (`{"participant_id": …}`).
pub fn answer_pick(answer: &Value) -> Option<Uuid> {
    answer.get("participant_id")?.as_str()?.parse().ok()
}

/// Inscrits choisis dans une réponse à choix multiple (`{"participant_ids": […]}`).
pub fn answer_set(answer: &Value) -> Option<Vec<Uuid>> {
    answer
        .get("participant_ids")?
        .as_array()?
        .iter()
        .map(|v| v.as_str().and_then(|s| s.parse().ok()))
        .collect()
}

/// Note une réponse de Pick'em.
pub fn score_answer(answer: &Answer, question: &Question, facts: &TournamentFacts) -> Score {
    let (answers, expected) = question_answers(question, facts);
    let points = f64::from(question.points);
    match question.kind {
        QuestionKind::TournamentWinner | QuestionKind::TopScorer => {
            match answer_pick(&answer.answer) {
                Some(pick) => score_pick(&pick, answers.as_deref(), points),
                None => Score::VOID,
            }
        }
        QuestionKind::StepQualifiers => match answer_set(&answer.answer) {
            Some(picks) => score_set(&picks, answers.as_deref(), expected, points),
            None => Score::VOID,
        },
    }
}

async fn facts(
    store: &dyn AuthStore,
    tournament: Tournament,
) -> Result<TournamentFacts, StoreError> {
    let steps = store.list_steps(tournament.id).await?;
    let mut step_participants = HashMap::new();
    for step in &steps {
        let participants = store
            .list_step_participants(step.id)
            .await?
            .into_iter()
            .map(|p| (p.participant_id, p.final_rank, p.status))
            .collect();
        step_participants.insert(step.id, participants);
    }
    let points = store.participant_points(tournament.id).await?;
    Ok(TournamentFacts {
        tournament,
        steps,
        step_participants,
        points,
    })
}

fn resolved(id: Uuid, score: Score) -> Resolved {
    Resolved {
        id,
        outcome: PickOutcome::from(score.outcome),
        points: score.points,
    }
}

/// Résout les pronostics et les réponses du tournoi ; `None` s'il n'existe plus.
pub async fn resolve_tournament(
    store: &dyn AuthStore,
    tournament_id: Uuid,
) -> Result<Option<ResolutionReport>, StoreError> {
    let Some(tournament) = store.find_tournament(tournament_id).await? else {
        return Ok(None);
    };
    let pickem = store.pickem();
    let predictions = pickem.list_tournament_predictions(tournament_id).await?;
    let answers = pickem.list_tournament_answers(tournament_id).await?;
    let questions: HashMap<Uuid, Question> = pickem
        .list_questions(tournament_id)
        .await?
        .into_iter()
        .map(|q| (q.id, q))
        .collect();
    let imported = store.imports().summary(tournament_id).await.is_some();
    // Local corrections replace several matches and standings atomically. Resolve
    // from one coherent snapshot and reject publication if it has since changed.
    let snapshot = if imported {
        None
    } else {
        Some(store.competition_snapshot(tournament_id).await?)
    };
    let revision = snapshot.as_ref().map(|s| s.revision()).transpose()?;
    let projection = snapshot.map(crate::store::MemoryStore::from_competition);
    let source: &dyn AuthStore = projection.as_ref().map_or(store, |s| s as &dyn AuthStore);
    let tournament = source
        .find_tournament(tournament_id)
        .await?
        .unwrap_or(tournament);
    let facts = facts(source, tournament).await?;

    // Matchs et participants de toutes les étapes, lus une fois par étape.
    let mut matches: HashMap<Uuid, Match> = HashMap::new();
    let mut participants: HashMap<Uuid, Vec<MatchParticipant>> = HashMap::new();
    if !predictions.is_empty() {
        for step in &facts.steps {
            for found in source.list_matches(step.id, None, None).await? {
                matches.insert(found.id, found);
            }
            for participant in source.list_step_match_participants(step.id).await? {
                participants
                    .entry(participant.match_id)
                    .or_default()
                    .push(participant);
            }
        }
    }

    let mut all_final = true;
    let resolved_predictions: Vec<Resolved> = predictions
        .iter()
        .map(|prediction| {
            let state = match_state(
                matches.get(&prediction.match_id),
                participants
                    .get(&prediction.match_id)
                    .map(Vec::as_slice)
                    .unwrap_or_default(),
            );
            let score = score_prediction(prediction, &state);
            all_final &= score.outcome.is_final();
            resolved(prediction.id, score)
        })
        .collect();
    let resolved_answers: Vec<Resolved> = answers
        .iter()
        .filter_map(|answer| {
            let question = questions.get(&answer.question_id)?;
            let score = score_answer(answer, question, &facts);
            all_final &= score.outcome.is_final();
            Some(resolved(answer.id, score))
        })
        .collect();
    // Une question sans réponse n'empêche pas de régler le tournoi : il n'y a rien à noter.

    let over = matches!(
        facts.tournament.status,
        TournamentStatus::Finished | TournamentStatus::Cancelled
    );
    let settled = over && all_final && !imported;
    let changed = resolved_predictions
        .iter()
        .zip(&predictions)
        .filter(|(r, p)| r.outcome != p.outcome || r.points != p.points)
        .count()
        + resolved_answers
            .iter()
            .filter(|r| {
                answers
                    .iter()
                    .any(|a| a.id == r.id && (a.outcome != r.outcome || a.points != r.points))
            })
            .count();
    let now = crate::store::now_rfc3339();
    let mut locked: Vec<Uuid> = matches
        .values()
        .filter(|m| crate::predictions::is_locked(m, &facts.tournament, &now))
        .map(|m| m.id)
        .chain(
            questions
                .values()
                .filter(|q| q.locks_at <= now || over)
                .map(|q| q.id),
        )
        .collect();
    for match_id in matches.keys() {
        if store.match_prediction_locked(*match_id).await? {
            locked.push(*match_id);
        }
    }
    if store.tournament_pickem_locked(tournament_id).await? {
        locked.extend(questions.keys().copied());
    }
    locked.sort_unstable();
    locked.dedup();
    let report = ResolutionReport {
        tournament_id,
        predictions: resolved_predictions.len(),
        answers: resolved_answers.len(),
        settled,
        changed,
        locked,
    };
    if let Some(revision) = revision {
        store
            .commit_competition_resolution(
                tournament_id,
                revision,
                resolved_predictions,
                resolved_answers,
                settled,
            )
            .await?;
    } else {
        pickem
            .save_resolution(
                tournament_id,
                resolved_predictions,
                resolved_answers,
                settled,
            )
            .await?;
    }
    Ok(Some(report))
}

/// Résout jusqu'à `limit` tournois non réglés, les moins récemment résolus d'abord. Une erreur
/// sur un tournoi n'empêche pas de traiter les suivants.
pub async fn resolve_pending(
    store: &dyn AuthStore,
    limit: i64,
) -> Result<Vec<Result<ResolutionReport, (Uuid, StoreError)>>, StoreError> {
    let mut reports = Vec::new();
    for tournament_id in store.pickem().tournaments_to_resolve(limit).await? {
        match resolve_tournament(store, tournament_id).await {
            Ok(Some(report)) => reports.push(Ok(report)),
            Ok(None) => {}
            Err(err) => reports.push(Err((tournament_id, err))),
        }
    }
    Ok(reports)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn a_match(status: MatchStatus) -> Match {
        Match {
            id: Uuid::nil(),
            game_id: Uuid::nil(),
            step_id: Uuid::nil(),
            group_id: None,
            round: None,
            bracket: None,
            next_match_id: None,
            number: None,
            next_slot: None,
            loser_next_match_id: None,
            loser_next_slot: None,
            best_of: 1,
            scheduled_at: None,
            started_at: None,
            ended_at: None,
            status,
            created_at: String::new(),
            updated_at: String::new(),
        }
    }

    fn participant(id: Uuid, rank: i32, result: MatchResult) -> MatchParticipant {
        MatchParticipant {
            match_id: Uuid::nil(),
            slot: None,
            games_won: None,
            participant_id: id,
            stats: Value::Null,
            points: 0.0,
            rank: Some(rank),
            result: Some(result),
        }
    }

    #[test]
    fn match_states() {
        let (a, b) = (Uuid::new_v4(), Uuid::new_v4());
        let parts = [
            participant(a, 1, MatchResult::Win),
            participant(b, 2, MatchResult::Loss),
        ];
        assert_eq!(match_state(None, &parts), MatchState::Void);
        assert_eq!(
            match_state(Some(&a_match(MatchStatus::Cancelled)), &parts),
            MatchState::Void
        );
        assert_eq!(
            match_state(Some(&a_match(MatchStatus::Ongoing)), &parts),
            MatchState::Pending
        );
        assert_eq!(
            match_state(Some(&a_match(MatchStatus::Finished)), &parts),
            MatchState::Finished {
                ranks: vec![(a, Some(1)), (b, Some(2))],
                winner: Some(a)
            }
        );
        let draw = [
            participant(a, 1, MatchResult::Draw),
            participant(b, 1, MatchResult::Draw),
        ];
        assert!(matches!(
            match_state(Some(&a_match(MatchStatus::Finished)), &draw),
            MatchState::Finished { winner: None, .. }
        ));
    }

    #[test]
    fn answers_are_parsed_leniently() {
        let id = Uuid::new_v4();
        assert_eq!(
            answer_pick(&serde_json::json!({"participant_id": id.to_string()})),
            Some(id)
        );
        assert_eq!(answer_pick(&serde_json::json!({"participant_id": 3})), None);
        assert_eq!(
            answer_set(&serde_json::json!({"participant_ids": [id.to_string()]})),
            Some(vec![id])
        );
        assert_eq!(
            answer_set(&serde_json::json!({"participant_ids": ["x"]})),
            None
        );
    }
}
