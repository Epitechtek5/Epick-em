//! Pronostics de match et Pick'em (tables `prediction`, `pickem_question`, `pickem_answer` et
//! `pickem_resolution`).
//!
//! Ce sont des données des spectateurs : elles vivent en base, y compris pour un tournoi importé
//! dont les matchs et les inscrits sont dans Redis. `match_id` et les inscrits choisis n'ont donc
//! pas de clé étrangère ; leur existence est vérifiée par l'API au travers du store, et la
//! résolution rend sans objet (`void`) un pronostic dont le match a disparu.

use async_trait::async_trait;
use domain::pickem::Outcome;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::str::FromStr;
use utoipa::ToSchema;
use uuid::Uuid;

use super::StoreError;
use super::tournaments::text_enum;

text_enum! {
    /// Issue d'un pronostic ou d'une réponse de Pick'em.
    PickOutcome, "issue de pronostic", {
        Pending => "pending",
        Correct => "correct",
        Partial => "partial",
        Incorrect => "incorrect",
        Void => "void",
    }
}

impl From<Outcome> for PickOutcome {
    fn from(outcome: Outcome) -> Self {
        match outcome {
            Outcome::Pending => PickOutcome::Pending,
            Outcome::Correct => PickOutcome::Correct,
            Outcome::Partial => PickOutcome::Partial,
            Outcome::Incorrect => PickOutcome::Incorrect,
            Outcome::Void => PickOutcome::Void,
        }
    }
}

text_enum! {
    /// Modèle d'une question de Pick'em. Voir `docs/pickem.md` pour en ajouter un.
    QuestionKind, "modèle de question", {
        TournamentWinner => "tournament_winner",
        TopScorer => "top_scorer",
        StepQualifiers => "step_qualifiers",
    }
}

/// Pronostic d'un spectateur sur un match : le vainqueur d'un duel (`winner_id`) ou le
/// classement d'un FFA (`ranking`, du premier au dernier pronostiqué), jamais les deux.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct Prediction {
    pub id: Uuid,
    pub user_id: Uuid,
    pub tournament_id: Uuid,
    pub match_id: Uuid,
    /// Inscrit pronostiqué vainqueur (`tournament_participant.id`), en duel.
    pub winner_id: Option<Uuid>,
    /// Inscrits dans l'ordre pronostiqué, en FFA.
    pub ranking: Option<Vec<Uuid>>,
    pub outcome: PickOutcome,
    /// Points gagnés ; 0 tant que le match n'est pas résolu.
    pub points: f64,
    /// Horodatages RFC 3339 en UTC.
    pub created_at: String,
    pub updated_at: String,
}

/// Pronostic à créer ou à remplacer (un seul par spectateur et par match).
#[derive(Debug, Clone)]
pub struct PredictionInput {
    pub user_id: Uuid,
    pub tournament_id: Uuid,
    pub match_id: Uuid,
    pub winner_id: Option<Uuid>,
    pub ranking: Option<Vec<Uuid>>,
}

/// Question de Pick'em d'un tournoi.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct Question {
    pub id: Uuid,
    pub tournament_id: Uuid,
    pub kind: QuestionKind,
    /// Réglages du modèle, ex. `{"step_id": "…"}` pour `step_qualifiers`.
    #[schema(value_type = Object)]
    pub params: Value,
    /// Points d'une réponse entièrement juste.
    pub points: i32,
    /// Fin des réponses, RFC 3339 en UTC.
    pub locks_at: String,
    pub created_at: String,
}

#[derive(Debug, Clone)]
pub struct QuestionInput {
    pub tournament_id: Uuid,
    pub kind: QuestionKind,
    pub params: Value,
    pub points: i32,
    pub locks_at: String,
}

/// Modification partielle d'une question : seuls les champs renseignés changent.
#[derive(Debug, Default, Clone)]
pub struct QuestionUpdate {
    pub points: Option<i32>,
    pub locks_at: Option<String>,
}

/// Réponse d'un spectateur à une question.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct Answer {
    pub id: Uuid,
    pub question_id: Uuid,
    pub tournament_id: Uuid,
    pub user_id: Uuid,
    /// `{"participant_id": "…"}` ou `{"participant_ids": ["…"]}` selon le modèle.
    #[schema(value_type = Object)]
    pub answer: Value,
    pub outcome: PickOutcome,
    pub points: f64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone)]
pub struct AnswerInput {
    pub question_id: Uuid,
    pub tournament_id: Uuid,
    pub user_id: Uuid,
    pub answer: Value,
}

/// Issue calculée d'un pronostic ou d'une réponse.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Resolved {
    pub id: Uuid,
    pub outcome: PickOutcome,
    pub points: f64,
}

/// Ligne d'un classement des spectateurs.
#[derive(Debug, Clone, PartialEq)]
pub struct LeaderboardEntry {
    /// Rang : les ex æquo partagent le même, le suivant est sauté (1, 2, 2, 4).
    pub rank: i64,
    pub user_id: Uuid,
    pub points: f64,
    /// Pronostics et réponses justes, même en partie.
    pub correct: i64,
    /// Pronostics et réponses tranchés (hors `pending` et `void`).
    pub resolved: i64,
}

/// Persistance des pronostics et du Pick'em.
#[async_trait]
pub trait PickemStore: Send + Sync {
    /// Crée ou remplace le pronostic du spectateur sur ce match ; l'issue repasse `pending`.
    async fn upsert_prediction(&self, input: PredictionInput) -> Result<Prediction, StoreError>;

    async fn find_prediction(
        &self,
        user_id: Uuid,
        match_id: Uuid,
    ) -> Result<Option<Prediction>, StoreError>;

    /// Supprime le pronostic ; `false` s'il n'existait pas.
    async fn delete_prediction(&self, user_id: Uuid, match_id: Uuid) -> Result<bool, StoreError>;

    /// Pronostics d'un match, par date de création.
    async fn list_match_predictions(&self, match_id: Uuid) -> Result<Vec<Prediction>, StoreError>;

    /// Pronostics d'un spectateur, éventuellement d'un seul tournoi, du plus récent au plus
    /// ancien.
    async fn list_user_predictions(
        &self,
        user_id: Uuid,
        tournament_id: Option<Uuid>,
    ) -> Result<Vec<Prediction>, StoreError>;

    /// Tous les pronostics d'un tournoi (pour la résolution).
    async fn list_tournament_predictions(
        &self,
        tournament_id: Uuid,
    ) -> Result<Vec<Prediction>, StoreError>;

    async fn create_question(&self, input: QuestionInput) -> Result<Question, StoreError>;

    async fn find_question(&self, id: Uuid) -> Result<Option<Question>, StoreError>;

    /// Questions du tournoi, par date de fin des réponses puis de création.
    async fn list_questions(&self, tournament_id: Uuid) -> Result<Vec<Question>, StoreError>;

    /// Applique `update` ; `None` si la question n'existe pas.
    async fn update_question(
        &self,
        id: Uuid,
        update: QuestionUpdate,
    ) -> Result<Option<Question>, StoreError>;

    /// Supprime la question et ses réponses ; `false` si elle n'existait pas.
    async fn delete_question(&self, id: Uuid) -> Result<bool, StoreError>;

    /// Crée ou remplace la réponse du spectateur à cette question ; l'issue repasse `pending`.
    async fn upsert_answer(&self, input: AnswerInput) -> Result<Answer, StoreError>;

    /// Réponses d'un spectateur aux questions d'un tournoi.
    async fn list_user_answers(
        &self,
        user_id: Uuid,
        tournament_id: Uuid,
    ) -> Result<Vec<Answer>, StoreError>;

    /// Toutes les réponses aux questions d'un tournoi (pour la résolution).
    async fn list_tournament_answers(&self, tournament_id: Uuid)
    -> Result<Vec<Answer>, StoreError>;

    /// Enregistre les issues calculées (seules celles qui changent sont écrites) et la date de
    /// résolution du tournoi, en une seule opération. `settled` : plus rien ne changera. Renvoie
    /// le nombre de pronostics et de réponses modifiés.
    async fn save_resolution(
        &self,
        tournament_id: Uuid,
        predictions: Vec<Resolved>,
        answers: Vec<Resolved>,
        settled: bool,
    ) -> Result<u64, StoreError>;

    /// Tournois qui ont des pronostics ou des questions et ne sont pas réglés, les moins
    /// récemment résolus d'abord.
    async fn tournaments_to_resolve(&self, limit: i64) -> Result<Vec<Uuid>, StoreError>;

    /// Classement des spectateurs par points, d'un tournoi ou de tous (`None`), `limit` à partir
    /// de `offset`.
    async fn leaderboard(
        &self,
        tournament_id: Option<Uuid>,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<LeaderboardEntry>, StoreError>;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn enums_round_trip_through_their_database_text() {
        for outcome in ["pending", "correct", "partial", "incorrect", "void"] {
            assert_eq!(outcome.parse::<PickOutcome>().unwrap().as_str(), outcome);
            assert_eq!(
                PickOutcome::from(Outcome::parse(outcome).unwrap()).as_str(),
                outcome
            );
        }
        for kind in ["tournament_winner", "top_scorer", "step_qualifiers"] {
            assert_eq!(kind.parse::<QuestionKind>().unwrap().as_str(), kind);
        }
        assert!("first_blood".parse::<QuestionKind>().is_err());
    }
}
