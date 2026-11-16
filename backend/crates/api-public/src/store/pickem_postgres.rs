//! Pronostics et Pick'em dans PostgreSQL, pour [`PgStore`](super::PgStore).

use async_trait::async_trait;
use serde_json::Value;
use uuid::Uuid;

use super::pickem::{
    Answer, AnswerInput, LeaderboardEntry, PickemStore, Prediction, PredictionInput, Question,
    QuestionInput, QuestionUpdate, Resolved,
};
use super::postgres::ts;
use super::{PgStore, StoreError};

fn prediction_columns() -> String {
    format!(
        "id, user_id, tournament_id, match_id, winner_id, ranking::text, outcome, points, \
         {} AS created_at, {} AS updated_at",
        ts("created_at"),
        ts("updated_at")
    )
}

type PredictionRow = (
    Uuid,
    Uuid,
    Uuid,
    Uuid,
    Option<Uuid>,
    Option<String>,
    String,
    f64,
    String,
    String,
);

fn prediction(row: PredictionRow) -> Result<Prediction, StoreError> {
    let (
        id,
        user_id,
        tournament_id,
        match_id,
        winner_id,
        ranking,
        outcome,
        points,
        created,
        updated,
    ) = row;
    let ranking = ranking
        .map(|text| serde_json::from_str::<Vec<Uuid>>(&text))
        .transpose()
        .map_err(|err| StoreError::Other(format!("classement pronostiqué illisible : {err}")))?;
    Ok(Prediction {
        id,
        user_id,
        tournament_id,
        match_id,
        winner_id,
        ranking,
        outcome: outcome.parse()?,
        points,
        created_at: created,
        updated_at: updated,
    })
}

fn question_columns() -> String {
    format!(
        "id, tournament_id, kind, params::text, points, {} AS locks_at, {} AS created_at",
        ts("locks_at"),
        ts("created_at")
    )
}

type QuestionRow = (Uuid, Uuid, String, String, i32, String, String);

fn question(row: QuestionRow) -> Result<Question, StoreError> {
    let (id, tournament_id, kind, params, points, locks_at, created_at) = row;
    Ok(Question {
        id,
        tournament_id,
        kind: kind.parse()?,
        params: json(&params)?,
        points,
        locks_at,
        created_at,
    })
}

fn answer_columns() -> String {
    format!(
        "id, question_id, tournament_id, user_id, answer::text, outcome, points, \
         {} AS created_at, {} AS updated_at",
        ts("created_at"),
        ts("updated_at")
    )
}

type AnswerRow = (Uuid, Uuid, Uuid, Uuid, String, String, f64, String, String);

fn answer(row: AnswerRow) -> Result<Answer, StoreError> {
    let (id, question_id, tournament_id, user_id, value, outcome, points, created, updated) = row;
    Ok(Answer {
        id,
        question_id,
        tournament_id,
        user_id,
        answer: json(&value)?,
        outcome: outcome.parse()?,
        points,
        created_at: created,
        updated_at: updated,
    })
}

fn json(text: &str) -> Result<Value, StoreError> {
    serde_json::from_str(text).map_err(|err| StoreError::Other(format!("JSON illisible : {err}")))
}

fn ranking_text(ranking: &Option<Vec<Uuid>>) -> Option<String> {
    ranking
        .as_ref()
        .map(|r| serde_json::to_string(r).unwrap_or_else(|_| "[]".into()))
}

#[async_trait]
impl PickemStore for PgStore {
    async fn upsert_prediction(&self, input: PredictionInput) -> Result<Prediction, StoreError> {
        let row = sqlx::query_as::<_, PredictionRow>(&format!(
            "INSERT INTO prediction (user_id, tournament_id, match_id, winner_id, ranking) \
             VALUES ($1, $2, $3, $4, $5::jsonb) \
             ON CONFLICT (user_id, match_id) DO UPDATE SET winner_id = EXCLUDED.winner_id, \
             ranking = EXCLUDED.ranking, outcome = 'pending', points = 0, updated_at = now() \
             RETURNING {}",
            prediction_columns()
        ))
        .bind(input.user_id)
        .bind(input.tournament_id)
        .bind(input.match_id)
        .bind(input.winner_id)
        .bind(ranking_text(&input.ranking))
        .fetch_one(&self.pool)
        .await?;
        prediction(row)
    }

    async fn find_prediction(
        &self,
        user_id: Uuid,
        match_id: Uuid,
    ) -> Result<Option<Prediction>, StoreError> {
        sqlx::query_as::<_, PredictionRow>(&format!(
            "SELECT {} FROM prediction WHERE user_id = $1 AND match_id = $2",
            prediction_columns()
        ))
        .bind(user_id)
        .bind(match_id)
        .fetch_optional(&self.pool)
        .await?
        .map(prediction)
        .transpose()
    }

    async fn delete_prediction(&self, user_id: Uuid, match_id: Uuid) -> Result<bool, StoreError> {
        let done = sqlx::query("DELETE FROM prediction WHERE user_id = $1 AND match_id = $2")
            .bind(user_id)
            .bind(match_id)
            .execute(&self.pool)
            .await?;
        Ok(done.rows_affected() > 0)
    }

    async fn list_match_predictions(&self, match_id: Uuid) -> Result<Vec<Prediction>, StoreError> {
        sqlx::query_as::<_, PredictionRow>(&format!(
            "SELECT {} FROM prediction WHERE match_id = $1 ORDER BY created_at, id",
            prediction_columns()
        ))
        .bind(match_id)
        .fetch_all(&self.pool)
        .await?
        .into_iter()
        .map(prediction)
        .collect()
    }

    async fn list_user_predictions(
        &self,
        user_id: Uuid,
        tournament_id: Option<Uuid>,
    ) -> Result<Vec<Prediction>, StoreError> {
        sqlx::query_as::<_, PredictionRow>(&format!(
            "SELECT {} FROM prediction WHERE user_id = $1 \
             AND ($2::uuid IS NULL OR tournament_id = $2) ORDER BY created_at DESC, id",
            prediction_columns()
        ))
        .bind(user_id)
        .bind(tournament_id)
        .fetch_all(&self.pool)
        .await?
        .into_iter()
        .map(prediction)
        .collect()
    }

    async fn list_tournament_predictions(
        &self,
        tournament_id: Uuid,
    ) -> Result<Vec<Prediction>, StoreError> {
        sqlx::query_as::<_, PredictionRow>(&format!(
            "SELECT {} FROM prediction WHERE tournament_id = $1 ORDER BY created_at, id",
            prediction_columns()
        ))
        .bind(tournament_id)
        .fetch_all(&self.pool)
        .await?
        .into_iter()
        .map(prediction)
        .collect()
    }

    async fn create_question(&self, input: QuestionInput) -> Result<Question, StoreError> {
        let row = sqlx::query_as::<_, QuestionRow>(&format!(
            "INSERT INTO pickem_question (tournament_id, kind, params, points, locks_at) \
             VALUES ($1, $2, $3::jsonb, $4, $5::timestamptz) RETURNING {}",
            question_columns()
        ))
        .bind(input.tournament_id)
        .bind(input.kind.as_str())
        .bind(input.params.to_string())
        .bind(input.points)
        .bind(input.locks_at)
        .fetch_one(&self.pool)
        .await?;
        question(row)
    }

    async fn find_question(&self, id: Uuid) -> Result<Option<Question>, StoreError> {
        sqlx::query_as::<_, QuestionRow>(&format!(
            "SELECT {} FROM pickem_question WHERE id = $1",
            question_columns()
        ))
        .bind(id)
        .fetch_optional(&self.pool)
        .await?
        .map(question)
        .transpose()
    }

    async fn list_questions(&self, tournament_id: Uuid) -> Result<Vec<Question>, StoreError> {
        sqlx::query_as::<_, QuestionRow>(&format!(
            "SELECT {} FROM pickem_question WHERE tournament_id = $1 \
             ORDER BY locks_at, created_at, id",
            question_columns()
        ))
        .bind(tournament_id)
        .fetch_all(&self.pool)
        .await?
        .into_iter()
        .map(question)
        .collect()
    }

    async fn update_question(
        &self,
        id: Uuid,
        update: QuestionUpdate,
    ) -> Result<Option<Question>, StoreError> {
        sqlx::query_as::<_, QuestionRow>(&format!(
            "UPDATE pickem_question SET points = coalesce($2, points), \
             locks_at = coalesce($3::timestamptz, locks_at) WHERE id = $1 RETURNING {}",
            question_columns()
        ))
        .bind(id)
        .bind(update.points)
        .bind(update.locks_at)
        .fetch_optional(&self.pool)
        .await?
        .map(question)
        .transpose()
    }

    async fn delete_question(&self, id: Uuid) -> Result<bool, StoreError> {
        let done = sqlx::query("DELETE FROM pickem_question WHERE id = $1")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(done.rows_affected() > 0)
    }

    async fn upsert_answer(&self, input: AnswerInput) -> Result<Answer, StoreError> {
        let row = sqlx::query_as::<_, AnswerRow>(&format!(
            "INSERT INTO pickem_answer (question_id, tournament_id, user_id, answer) \
             VALUES ($1, $2, $3, $4::jsonb) \
             ON CONFLICT (question_id, user_id) DO UPDATE SET answer = EXCLUDED.answer, \
             outcome = 'pending', points = 0, updated_at = now() RETURNING {}",
            answer_columns()
        ))
        .bind(input.question_id)
        .bind(input.tournament_id)
        .bind(input.user_id)
        .bind(input.answer.to_string())
        .fetch_one(&self.pool)
        .await?;
        answer(row)
    }

    async fn list_user_answers(
        &self,
        user_id: Uuid,
        tournament_id: Uuid,
    ) -> Result<Vec<Answer>, StoreError> {
        sqlx::query_as::<_, AnswerRow>(&format!(
            "SELECT {} FROM pickem_answer WHERE user_id = $1 AND tournament_id = $2 \
             ORDER BY created_at, id",
            answer_columns()
        ))
        .bind(user_id)
        .bind(tournament_id)
        .fetch_all(&self.pool)
        .await?
        .into_iter()
        .map(answer)
        .collect()
    }

    async fn list_tournament_answers(
        &self,
        tournament_id: Uuid,
    ) -> Result<Vec<Answer>, StoreError> {
        sqlx::query_as::<_, AnswerRow>(&format!(
            "SELECT {} FROM pickem_answer WHERE tournament_id = $1 ORDER BY created_at, id",
            answer_columns()
        ))
        .bind(tournament_id)
        .fetch_all(&self.pool)
        .await?
        .into_iter()
        .map(answer)
        .collect()
    }

    async fn save_resolution(
        &self,
        tournament_id: Uuid,
        predictions: Vec<Resolved>,
        answers: Vec<Resolved>,
        settled: bool,
    ) -> Result<u64, StoreError> {
        fn columns(rows: &[Resolved]) -> (Vec<Uuid>, Vec<String>, Vec<f64>) {
            (
                rows.iter().map(|r| r.id).collect(),
                rows.iter()
                    .map(|r| r.outcome.as_str().to_string())
                    .collect(),
                rows.iter().map(|r| r.points).collect(),
            )
        }
        let mut tx = self.pool.begin().await?;
        let mut changed = 0;
        for (table, rows) in [("prediction", &predictions), ("pickem_answer", &answers)] {
            if rows.is_empty() {
                continue;
            }
            let (ids, outcomes, points) = columns(rows);
            // Seules les lignes dont l'issue change sont réécrites : une résolution rejouée ne
            // touche rien.
            changed += sqlx::query(&format!(
                "UPDATE {table} AS t SET outcome = u.outcome, points = u.points, \
                 updated_at = now() \
                 FROM unnest($1::uuid[], $2::text[], $3::float8[]) AS u(id, outcome, points) \
                 WHERE t.id = u.id AND t.tournament_id = $4 \
                 AND (t.outcome <> u.outcome OR t.points <> u.points)"
            ))
            .bind(&ids)
            .bind(&outcomes)
            .bind(&points)
            .bind(tournament_id)
            .execute(&mut *tx)
            .await?
            .rows_affected();
        }
        sqlx::query(
            "INSERT INTO pickem_resolution (tournament_id, resolved_at, settled) \
             VALUES ($1, now(), $2) ON CONFLICT (tournament_id) \
             DO UPDATE SET resolved_at = now(), settled = EXCLUDED.settled",
        )
        .bind(tournament_id)
        .bind(settled)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(changed)
    }

    async fn tournaments_to_resolve(&self, limit: i64) -> Result<Vec<Uuid>, StoreError> {
        let rows = sqlx::query_as::<_, (Uuid,)>(
            "SELECT t.id FROM ( \
               SELECT DISTINCT tournament_id AS id FROM prediction \
               UNION SELECT DISTINCT tournament_id FROM pickem_question \
             ) AS t LEFT JOIN pickem_resolution r ON r.tournament_id = t.id \
             WHERE r.settled IS NOT TRUE \
             ORDER BY r.resolved_at NULLS FIRST, t.id LIMIT $1",
        )
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows.into_iter().map(|(id,)| id).collect())
    }

    async fn leaderboard(
        &self,
        tournament_id: Option<Uuid>,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<LeaderboardEntry>, StoreError> {
        let rows = sqlx::query_as::<_, (i64, Uuid, f64, i64, i64)>(
            "WITH scores AS ( \
               SELECT user_id, outcome, points FROM prediction \
               WHERE $1::uuid IS NULL OR tournament_id = $1 \
               UNION ALL \
               SELECT user_id, outcome, points FROM pickem_answer \
               WHERE $1::uuid IS NULL OR tournament_id = $1 \
             ), totals AS ( \
               SELECT user_id, sum(points)::float8 AS points, \
                 count(*) FILTER (WHERE outcome IN ('correct', 'partial')) AS correct, \
                 count(*) FILTER (WHERE outcome NOT IN ('pending', 'void')) AS resolved \
               FROM scores GROUP BY user_id \
             ) \
             SELECT rank() OVER (ORDER BY points DESC), user_id, points, correct, resolved \
             FROM totals ORDER BY points DESC, user_id LIMIT $2 OFFSET $3",
        )
        .bind(tournament_id)
        .bind(limit)
        .bind(offset)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(
                |(rank, user_id, points, correct, resolved)| LeaderboardEntry {
                    rank,
                    user_id,
                    points,
                    correct,
                    resolved,
                },
            )
            .collect())
    }
}
