//! Pronostics et Pick'em en mémoire, pour [`MemoryStore`](super::MemoryStore).

use async_trait::async_trait;
use std::collections::{HashMap, HashSet};
use std::sync::Mutex;
use uuid::Uuid;

use super::pickem::{
    Answer, AnswerInput, LeaderboardEntry, PickOutcome, PickemStore, Prediction, PredictionInput,
    Question, QuestionInput, QuestionUpdate, Resolved,
};
use super::{MemoryStore, StoreError, now_rfc3339};

#[derive(Default)]
struct State {
    predictions: Vec<Prediction>,
    questions: Vec<Question>,
    answers: Vec<Answer>,
    /// Tournoi → (ordre de résolution, réglé).
    resolutions: HashMap<Uuid, (u64, bool)>,
    resolution_clock: u64,
}

#[derive(Default)]
pub(super) struct PickemMemory {
    state: Mutex<State>,
}

impl PickemMemory {
    fn state(&self) -> std::sync::MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }
}

#[async_trait]
impl PickemStore for MemoryStore {
    async fn upsert_prediction(&self, input: PredictionInput) -> Result<Prediction, StoreError> {
        self.with_prediction_gate(input.match_id, || {
            let mut state = self.pickem.state();
            let now = now_rfc3339();
            if let Some(found) = state
                .predictions
                .iter_mut()
                .find(|p| p.user_id == input.user_id && p.match_id == input.match_id)
            {
                found.winner_id = input.winner_id;
                found.ranking = input.ranking;
                found.outcome = PickOutcome::Pending;
                found.points = 0.0;
                found.updated_at = now;
                return Ok(found.clone());
            }
            let prediction = Prediction {
                id: Uuid::new_v4(),
                user_id: input.user_id,
                tournament_id: input.tournament_id,
                match_id: input.match_id,
                winner_id: input.winner_id,
                ranking: input.ranking,
                outcome: PickOutcome::Pending,
                points: 0.0,
                created_at: now.clone(),
                updated_at: now,
            };
            state.predictions.push(prediction.clone());
            Ok(prediction)
        })
    }

    async fn find_prediction(
        &self,
        user_id: Uuid,
        match_id: Uuid,
    ) -> Result<Option<Prediction>, StoreError> {
        Ok(self
            .pickem
            .state()
            .predictions
            .iter()
            .find(|p| p.user_id == user_id && p.match_id == match_id)
            .cloned())
    }

    async fn delete_prediction(&self, user_id: Uuid, match_id: Uuid) -> Result<bool, StoreError> {
        self.with_prediction_gate(match_id, || {
            let mut state = self.pickem.state();
            let before = state.predictions.len();
            state
                .predictions
                .retain(|p| !(p.user_id == user_id && p.match_id == match_id));
            Ok(state.predictions.len() != before)
        })
    }

    async fn list_match_predictions(&self, match_id: Uuid) -> Result<Vec<Prediction>, StoreError> {
        Ok(self
            .pickem
            .state()
            .predictions
            .iter()
            .filter(|p| p.match_id == match_id)
            .cloned()
            .collect())
    }

    async fn list_user_predictions(
        &self,
        user_id: Uuid,
        tournament_id: Option<Uuid>,
    ) -> Result<Vec<Prediction>, StoreError> {
        let mut found: Vec<Prediction> = self
            .pickem
            .state()
            .predictions
            .iter()
            .filter(|p| p.user_id == user_id && tournament_id.is_none_or(|t| p.tournament_id == t))
            .cloned()
            .collect();
        found.reverse();
        Ok(found)
    }

    async fn list_tournament_predictions(
        &self,
        tournament_id: Uuid,
    ) -> Result<Vec<Prediction>, StoreError> {
        Ok(self
            .pickem
            .state()
            .predictions
            .iter()
            .filter(|p| p.tournament_id == tournament_id)
            .cloned()
            .collect())
    }

    async fn create_question(&self, input: QuestionInput) -> Result<Question, StoreError> {
        let question = Question {
            id: Uuid::new_v4(),
            tournament_id: input.tournament_id,
            kind: input.kind,
            params: input.params,
            points: input.points,
            opens_at: input.opens_at,
            locks_at: input.locks_at,
            created_at: now_rfc3339(),
        };
        self.pickem.state().questions.push(question.clone());
        Ok(question)
    }

    async fn find_question(&self, id: Uuid) -> Result<Option<Question>, StoreError> {
        Ok(self
            .pickem
            .state()
            .questions
            .iter()
            .find(|q| q.id == id)
            .cloned())
    }

    async fn list_questions(&self, tournament_id: Uuid) -> Result<Vec<Question>, StoreError> {
        let mut found: Vec<Question> = self
            .pickem
            .state()
            .questions
            .iter()
            .filter(|q| q.tournament_id == tournament_id)
            .cloned()
            .collect();
        found.sort_by(|a, b| a.locks_at.cmp(&b.locks_at));
        Ok(found)
    }

    async fn update_question(
        &self,
        id: Uuid,
        update: QuestionUpdate,
    ) -> Result<Option<Question>, StoreError> {
        let mut state = self.pickem.state();
        let Some(question) = state.questions.iter_mut().find(|q| q.id == id) else {
            return Ok(None);
        };
        if question.opens_at <= now_rfc3339() {
            return Err(StoreError::PickemLocked);
        }
        if let Some(points) = update.points {
            question.points = points;
        }
        if let Some(locks_at) = update.locks_at {
            question.locks_at = locks_at;
        }
        Ok(Some(question.clone()))
    }

    async fn delete_question(&self, id: Uuid) -> Result<bool, StoreError> {
        let mut state = self.pickem.state();
        if state
            .questions
            .iter()
            .any(|q| q.id == id && q.opens_at <= now_rfc3339())
        {
            return Err(StoreError::PickemLocked);
        }
        let before = state.questions.len();
        state.questions.retain(|q| q.id != id);
        state.answers.retain(|a| a.question_id != id);
        Ok(state.questions.len() != before)
    }

    async fn upsert_answer(&self, input: AnswerInput) -> Result<Answer, StoreError> {
        self.with_pickem_gate(input.tournament_id, || {
            let mut state = self.pickem.state();
            let now = now_rfc3339();
            if !state
                .questions
                .iter()
                .any(|q| q.id == input.question_id && q.opens_at <= now && now < q.locks_at)
            {
                return Err(StoreError::PickemLocked);
            }
            if let Some(found) = state
                .answers
                .iter_mut()
                .find(|a| a.user_id == input.user_id && a.question_id == input.question_id)
            {
                found.answer = input.answer;
                found.outcome = PickOutcome::Pending;
                found.points = 0.0;
                found.updated_at = now;
                return Ok(found.clone());
            }
            let answer = Answer {
                id: Uuid::new_v4(),
                question_id: input.question_id,
                tournament_id: input.tournament_id,
                user_id: input.user_id,
                answer: input.answer,
                outcome: PickOutcome::Pending,
                points: 0.0,
                created_at: now.clone(),
                updated_at: now,
            };
            state.answers.push(answer.clone());
            Ok(answer)
        })
    }

    async fn list_user_answers(
        &self,
        user_id: Uuid,
        tournament_id: Uuid,
    ) -> Result<Vec<Answer>, StoreError> {
        Ok(self
            .pickem
            .state()
            .answers
            .iter()
            .filter(|a| a.user_id == user_id && a.tournament_id == tournament_id)
            .cloned()
            .collect())
    }

    async fn list_tournament_answers(
        &self,
        tournament_id: Uuid,
    ) -> Result<Vec<Answer>, StoreError> {
        Ok(self
            .pickem
            .state()
            .answers
            .iter()
            .filter(|a| a.tournament_id == tournament_id)
            .cloned()
            .collect())
    }

    async fn save_resolution(
        &self,
        tournament_id: Uuid,
        predictions: Vec<Resolved>,
        answers: Vec<Resolved>,
        settled: bool,
    ) -> Result<(), StoreError> {
        self.save_resolution_now(tournament_id, predictions, answers, settled)
    }

    async fn tournaments_to_resolve(&self, limit: i64) -> Result<Vec<Uuid>, StoreError> {
        let state = self.pickem.state();
        let mut seen = HashSet::new();
        let mut found: Vec<(u64, Uuid)> = state
            .predictions
            .iter()
            .map(|p| p.tournament_id)
            .chain(state.questions.iter().map(|q| q.tournament_id))
            .filter(|id| seen.insert(*id))
            .map(|id| {
                (
                    state.resolutions.get(&id).map_or(0, |(clock, _)| *clock),
                    id,
                )
            })
            .collect();
        found.sort_by_key(|(clock, _)| *clock);
        Ok(found
            .into_iter()
            .take(usize::try_from(limit).unwrap_or(0))
            .map(|(_, id)| id)
            .collect())
    }

    async fn leaderboard(
        &self,
        tournament_id: Option<Uuid>,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<LeaderboardEntry>, StoreError> {
        let state = self.pickem.state();
        let rows = state
            .predictions
            .iter()
            .filter(|p| tournament_id.is_none_or(|t| p.tournament_id == t))
            .map(|p| (p.user_id, p.outcome, p.points))
            .chain(
                state
                    .answers
                    .iter()
                    .filter(|a| tournament_id.is_none_or(|t| a.tournament_id == t))
                    .map(|a| (a.user_id, a.outcome, a.points)),
            );
        let mut totals: HashMap<Uuid, (f64, i64, i64)> = HashMap::new();
        for (user_id, outcome, points) in rows {
            let entry = totals.entry(user_id).or_default();
            entry.0 += points;
            if matches!(outcome, PickOutcome::Correct | PickOutcome::Partial) {
                entry.1 += 1;
            }
            if !matches!(outcome, PickOutcome::Pending | PickOutcome::Void) {
                entry.2 += 1;
            }
        }
        let mut sorted: Vec<(Uuid, (f64, i64, i64))> = totals.into_iter().collect();
        sorted.sort_by(|a, b| b.1.0.total_cmp(&a.1.0).then(a.0.cmp(&b.0)));
        let mut entries: Vec<LeaderboardEntry> = Vec::with_capacity(sorted.len());
        for (index, (user_id, (points, correct, resolved))) in sorted.into_iter().enumerate() {
            let rank = match entries.last() {
                Some(previous) if previous.points == points => previous.rank,
                _ => index as i64 + 1,
            };
            entries.push(LeaderboardEntry {
                rank,
                user_id,
                points,
                correct,
                resolved,
            });
        }
        Ok(entries
            .into_iter()
            .skip(usize::try_from(offset).unwrap_or(0))
            .take(usize::try_from(limit).unwrap_or(0))
            .collect())
    }
}

impl super::MemoryStore {
    pub(super) fn save_resolution_now(
        &self,
        tournament_id: Uuid,
        predictions: Vec<Resolved>,
        answers: Vec<Resolved>,
        settled: bool,
    ) -> Result<(), StoreError> {
        let mut state = self.pickem.state();
        let now = now_rfc3339();
        for resolved in predictions {
            if let Some(p) = state.predictions.iter_mut().find(|p| p.id == resolved.id)
                && (p.outcome != resolved.outcome || p.points != resolved.points)
            {
                p.outcome = resolved.outcome;
                p.points = resolved.points;
                p.updated_at = now.clone();
            }
        }
        for resolved in answers {
            if let Some(a) = state.answers.iter_mut().find(|a| a.id == resolved.id)
                && (a.outcome != resolved.outcome || a.points != resolved.points)
            {
                a.outcome = resolved.outcome;
                a.points = resolved.points;
                a.updated_at = now.clone();
            }
        }
        state.resolution_clock += 1;
        let clock = state.resolution_clock;
        state.resolutions.insert(tournament_id, (clock, settled));
        Ok(())
    }
}
