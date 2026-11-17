//! Pick'em d'un tournoi : questions posées par un administrateur à partir de modèles, réponses
//! des spectateurs jusqu'à la fermeture de chaque question (`locks_at`, horloge du serveur).
//!
//! Le constructeur ne propose que les modèles **résolubles** avec les données du tournoi
//! (ADR-003) : `top_scorer` exige un barème, donc un tournoi local ; `step_qualifiers` une étape
//! pas encore terminée qui qualifie des participants. Les questions et les réponses sont des
//! données d'Epick'em : elles s'écrivent aussi sur un tournoi importé.
//!
//! Les points sont attribués par la résolution ([`resolution`](crate::resolution)).

fn write_error(err: crate::store::StoreError) -> ApiError {
    match err {
        crate::store::StoreError::PredictionLocked => ApiError::PredictionLocked,
        crate::store::StoreError::PickemLocked => ApiError::PickemLocked,
        other => ApiError::internal(other),
    }
}

use crate::auth::{AppState, Claims};
use crate::error::{ApiError, ErrorResponse};
use crate::external::is_external;
use crate::resolution::{expected_qualifiers, step_param};
use crate::store::{
    Answer, AnswerInput, Question, QuestionInput, QuestionKind, QuestionUpdate, StepStatus,
    Tournament, TournamentStatus, now_rfc3339,
};
use crate::team_io::normalize_timestamp;
use crate::tournaments::find_tournament;
use crate::users::require_admin;
use actix_web::{HttpResponse, delete, get, patch, post, put, web};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::{HashMap, HashSet};
use utoipa::ToSchema;
use utoipa_actix_web::service_config::ServiceConfig;
use uuid::Uuid;

const POINTS_MAX: i32 = 100;
/// Inscrits lus pour vérifier une réponse (au-delà du plafond d'un tournoi).
const PARTICIPANTS_LIMIT: i64 = 20_000;

/// Routes du Pick'em, avec leur documentation OpenAPI.
pub fn routes(cfg: &mut ServiceConfig) {
    cfg.service(get_pickem)
        .service(list_templates)
        .service(create_question)
        .service(update_question)
        .service(delete_question)
        .service(answer_question);
}

/// Points par défaut d'une question de ce modèle.
fn default_points(kind: QuestionKind) -> i32 {
    match kind {
        QuestionKind::TournamentWinner => 30,
        QuestionKind::TopScorer | QuestionKind::StepQualifiers => 20,
    }
}

/// Étape qu'une question `step_qualifiers` peut viser.
#[derive(Serialize, ToSchema, Clone)]
struct EligibleStep {
    step_id: Uuid,
    position: i32,
    /// Qualifiés à pronostiquer (`advance_per_group × group_count`).
    expected: usize,
}

/// Modèle de question et sa disponibilité pour ce tournoi.
#[derive(Serialize, ToSchema)]
struct Template {
    kind: QuestionKind,
    default_points: i32,
    available: bool,
    /// Pourquoi le modèle n'est pas proposé.
    reason: Option<String>,
    /// Étapes possibles, pour `step_qualifiers`.
    steps: Vec<EligibleStep>,
}

/// Question avec sa fermeture et ma réponse.
#[derive(Serialize, ToSchema)]
struct QuestionView {
    #[serde(flatten)]
    #[schema(inline)]
    question: Question,
    /// Les réponses sont fermées.
    locked: bool,
    /// Nombre d'inscrits à choisir : 1, ou les qualifiés attendus pour `step_qualifiers`.
    expected: usize,
    my_answer: Option<Answer>,
}

#[derive(Deserialize, ToSchema)]
struct CreateQuestionRequest {
    kind: QuestionKind,
    /// Opening time; defaults to now. Questions become immutable when answers open.
    opens_at: Option<String>,
    /// `{"step_id": "…"}` pour `step_qualifiers`, rien pour les autres modèles.
    #[schema(value_type = Option<Object>)]
    params: Option<Value>,
    /// Points d'une réponse entièrement juste (1 à 100) ; par défaut ceux du modèle.
    #[schema(minimum = 1, maximum = 100)]
    points: Option<i32>,
    /// Fermeture des réponses, RFC 3339 en UTC, dans le futur ; par défaut le début du tournoi.
    #[schema(example = "2026-11-20T18:00:00Z")]
    locks_at: Option<String>,
}

#[derive(Deserialize, ToSchema)]
struct UpdateQuestionRequest {
    #[schema(minimum = 1, maximum = 100)]
    points: Option<i32>,
    locks_at: Option<String>,
}

/// Réponse : un inscrit (`tournament_winner`, `top_scorer`) ou plusieurs (`step_qualifiers`).
#[derive(Deserialize, ToSchema)]
struct AnswerRequest {
    participant_id: Option<Uuid>,
    participant_ids: Option<Vec<Uuid>>,
}

fn locked(question: &Question, tournament: &Tournament, now: &str) -> bool {
    question.locks_at.as_str() <= now
        || matches!(
            tournament.status,
            TournamentStatus::Finished | TournamentStatus::Cancelled
        )
}

async fn templates(state: &AppState, tournament: &Tournament) -> Result<Vec<Template>, ApiError> {
    let over = matches!(
        tournament.status,
        TournamentStatus::Finished | TournamentStatus::Cancelled
    );
    let over_reason = || Some("Le tournoi est terminé.".to_string());

    let external = is_external(state, tournament.id).await?;
    let rules = state
        .store
        .list_scoring_rules(tournament.id)
        .await
        .map_err(write_error)?;
    let top_scorer_reason = if over {
        over_reason()
    } else if external {
        Some("Les points ne sont pas fournis par la source du tournoi importé.".into())
    } else if rules.is_empty() {
        Some("Le tournoi n'a pas de barème : personne ne marque de points.".into())
    } else {
        None
    };

    let steps: Vec<EligibleStep> = state
        .store
        .list_steps(tournament.id)
        .await
        .map_err(write_error)?
        .into_iter()
        .filter(|s| s.status != StepStatus::Finished && expected_qualifiers(s) > 0)
        .map(|s| EligibleStep {
            step_id: s.id,
            position: s.position,
            expected: expected_qualifiers(&s),
        })
        .collect();
    let steps_reason = if over {
        over_reason()
    } else if steps.is_empty() {
        Some("Aucune étape à venir ne qualifie de participants.".into())
    } else {
        None
    };

    let template = |kind, reason: Option<String>, steps| Template {
        kind,
        default_points: default_points(kind),
        available: reason.is_none(),
        reason,
        steps,
    };
    Ok(vec![
        template(
            QuestionKind::TournamentWinner,
            if over { over_reason() } else { None },
            Vec::new(),
        ),
        template(QuestionKind::TopScorer, top_scorer_reason, Vec::new()),
        template(QuestionKind::StepQualifiers, steps_reason, steps),
    ])
}

async fn find_question(
    state: &AppState,
    tournament_id: Uuid,
    question_id: Uuid,
) -> Result<Question, ApiError> {
    state
        .store
        .pickem()
        .find_question(question_id)
        .await
        .map_err(write_error)?
        .filter(|q| q.tournament_id == tournament_id)
        .ok_or(ApiError::NotFound)
}

/// Nombre d'inscrits à choisir pour répondre.
async fn expected_of(state: &AppState, question: &Question) -> Result<usize, ApiError> {
    if question.kind != QuestionKind::StepQualifiers {
        return Ok(1);
    }
    let step = match step_param(&question.params) {
        Some(id) => state.store.find_step(id).await.map_err(write_error)?,
        None => None,
    };
    Ok(step.map(|s| expected_qualifiers(&s)).unwrap_or(1))
}

fn validate_points(points: Option<i32>) -> Result<(), ApiError> {
    match points {
        Some(p) if !(1..=POINTS_MAX).contains(&p) => Err(ApiError::Validation(vec![(
            "points",
            format!("Les points vont de 1 à {POINTS_MAX}."),
        )])),
        _ => Ok(()),
    }
}

fn validate_locks_at(value: &str, now: &str) -> Result<String, ApiError> {
    let normalized = normalize_timestamp(value).ok_or_else(|| {
        ApiError::Validation(vec![(
            "locks_at",
            "Horodatage RFC 3339 en UTC attendu (suffixe Z).".into(),
        )])
    })?;
    if normalized.as_str() <= now {
        return Err(ApiError::Validation(vec![(
            "locks_at",
            "La fermeture des réponses doit être dans le futur.".into(),
        )]));
    }
    Ok(normalized)
}

/// Pick'em du tournoi : ses questions, leur fermeture et mes réponses.
#[utoipa::path(
    get,
    path = "/tournaments/{id}/pickem",
    tag = "pickem",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Identifiant du tournoi")),
    responses(
        (status = 200, description = "Questions du Pick'em", body = Vec<QuestionView>),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 404, description = "Tournoi introuvable", body = ErrorResponse),
    ),
)]
#[get("/tournaments/{id}/pickem")]
async fn get_pickem(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    id: web::Path<Uuid>,
) -> Result<HttpResponse, ApiError> {
    let tournament = find_tournament(&state, *id).await?;
    let pickem = state.store.pickem();
    let questions = pickem
        .list_questions(tournament.id)
        .await
        .map_err(write_error)?;
    let mut answers: HashMap<Uuid, Answer> = pickem
        .list_user_answers(claims.sub, tournament.id)
        .await
        .map_err(write_error)?
        .into_iter()
        .map(|a| (a.question_id, a))
        .collect();
    let now = now_rfc3339();
    let mut views = Vec::with_capacity(questions.len());
    for question in questions {
        views.push(QuestionView {
            locked: question.opens_at > now || locked(&question, &tournament, &now),
            expected: expected_of(&state, &question).await?,
            my_answer: answers.remove(&question.id),
            question,
        });
    }
    Ok(HttpResponse::Ok().json(views))
}

/// Modèles de question et leur disponibilité pour ce tournoi (administrateur).
#[utoipa::path(
    get,
    path = "/tournaments/{id}/pickem/templates",
    tag = "pickem",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Identifiant du tournoi")),
    responses(
        (status = 200, description = "Modèles de question", body = Vec<Template>),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 403, description = "Réservé aux administrateurs", body = ErrorResponse),
        (status = 404, description = "Tournoi introuvable", body = ErrorResponse),
    ),
)]
#[get("/tournaments/{id}/pickem/templates")]
async fn list_templates(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    id: web::Path<Uuid>,
) -> Result<HttpResponse, ApiError> {
    require_admin(&state, &claims).await?;
    let tournament = find_tournament(&state, *id).await?;
    Ok(HttpResponse::Ok().json(templates(&state, &tournament).await?))
}

/// Ajoute une question au Pick'em, à partir d'un modèle disponible (administrateur).
#[utoipa::path(
    post,
    path = "/tournaments/{id}/pickem/questions",
    tag = "pickem",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Identifiant du tournoi")),
    request_body = CreateQuestionRequest,
    responses(
        (status = 201, description = "Question créée", body = Question),
        (status = 400, description = "Modèle indisponible ou requête invalide", body = ErrorResponse),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 403, description = "Réservé aux administrateurs", body = ErrorResponse),
        (status = 404, description = "Tournoi introuvable", body = ErrorResponse),
    ),
)]
#[post("/tournaments/{id}/pickem/questions")]
async fn create_question(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    id: web::Path<Uuid>,
    body: web::Json<CreateQuestionRequest>,
) -> Result<HttpResponse, ApiError> {
    require_admin(&state, &claims).await?;
    let tournament = find_tournament(&state, *id).await?;
    let request = body.into_inner();
    validate_points(request.points)?;
    let template = templates(&state, &tournament)
        .await?
        .into_iter()
        .find(|t| t.kind == request.kind)
        .ok_or(ApiError::NotFound)?;
    if let Some(reason) = template.reason {
        return Err(ApiError::Validation(vec![("kind", reason)]));
    }
    let params = match request.kind {
        QuestionKind::StepQualifiers => {
            let step_id = request.params.as_ref().and_then(step_param);
            match step_id.filter(|id| template.steps.iter().any(|s| s.step_id == *id)) {
                Some(step_id) => json!({ "step_id": step_id }),
                None => {
                    return Err(ApiError::Validation(vec![(
                        "params",
                        "params.step_id doit désigner une étape proposée par le modèle.".into(),
                    )]));
                }
            }
        }
        QuestionKind::TournamentWinner | QuestionKind::TopScorer => json!({}),
    };
    let now = now_rfc3339();
    let locks_at = validate_locks_at(
        request
            .locks_at
            .as_deref()
            .unwrap_or(&tournament.start_date),
        &now,
    )?;
    let opens_at = request
        .opens_at
        .as_deref()
        .map(|value| {
            normalize_timestamp(value).ok_or_else(|| {
                ApiError::Validation(vec![("opens_at", "Invalid timestamp.".into())])
            })
        })
        .transpose()?
        .unwrap_or_else(|| now.clone());
    if opens_at >= locks_at {
        return Err(ApiError::Validation(vec![(
            "opens_at",
            "Opening must precede closing.".into(),
        )]));
    }
    let question = state
        .store
        .pickem()
        .create_question(QuestionInput {
            tournament_id: tournament.id,
            kind: request.kind,
            params,
            points: request
                .points
                .unwrap_or_else(|| default_points(request.kind)),
            opens_at,
            locks_at,
        })
        .await
        .map_err(write_error)?;
    Ok(HttpResponse::Created().json(question))
}

/// Changes points or closing time before answers open (administrator).
#[utoipa::path(
    patch,
    path = "/tournaments/{id}/pickem/questions/{question_id}",
    tag = "pickem",
    security(("bearer" = [])),
    params(
        ("id" = Uuid, Path, description = "Identifiant du tournoi"),
        ("question_id" = Uuid, Path, description = "Identifiant de la question"),
    ),
    request_body = UpdateQuestionRequest,
    responses(
        (status = 200, description = "Question modifiée", body = Question),
        (status = 400, description = "Requête invalide", body = ErrorResponse),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 403, description = "Réservé aux administrateurs", body = ErrorResponse),
        (status = 404, description = "Tournoi ou question introuvable", body = ErrorResponse),
        (status = 409, description = "Question fermée", body = ErrorResponse),
    ),
)]
#[patch("/tournaments/{id}/pickem/questions/{question_id}")]
async fn update_question(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    path: web::Path<(Uuid, Uuid)>,
    body: web::Json<UpdateQuestionRequest>,
) -> Result<HttpResponse, ApiError> {
    require_admin(&state, &claims).await?;
    let (tournament_id, question_id) = path.into_inner();
    let tournament = find_tournament(&state, tournament_id).await?;
    let question = find_question(&state, tournament_id, question_id).await?;
    let now = now_rfc3339();
    if question.opens_at <= now || locked(&question, &tournament, &now) {
        return Err(ApiError::PickemLocked);
    }
    let request = body.into_inner();
    validate_points(request.points)?;
    let locks_at = request
        .locks_at
        .as_deref()
        .map(|value| validate_locks_at(value, &now))
        .transpose()?;
    if locks_at.as_ref().is_some_and(|at| at <= &question.opens_at) {
        return Err(ApiError::Validation(vec![(
            "locks_at",
            "Closing must follow opening.".into(),
        )]));
    }
    let updated = state
        .store
        .pickem()
        .update_question(
            question_id,
            QuestionUpdate {
                points: request.points,
                locks_at,
            },
        )
        .await
        .map_err(write_error)?
        .ok_or(ApiError::NotFound)?;
    Ok(HttpResponse::Ok().json(updated))
}

/// Deletes a question before answers open (administrator).
#[utoipa::path(
    delete,
    path = "/tournaments/{id}/pickem/questions/{question_id}",
    tag = "pickem",
    security(("bearer" = [])),
    params(
        ("id" = Uuid, Path, description = "Identifiant du tournoi"),
        ("question_id" = Uuid, Path, description = "Identifiant de la question"),
    ),
    responses(
        (status = 204, description = "Question supprimée"),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 403, description = "Réservé aux administrateurs", body = ErrorResponse),
        (status = 404, description = "Tournoi ou question introuvable", body = ErrorResponse),
        (status = 409, description = "Question fermée", body = ErrorResponse),
    ),
)]
#[delete("/tournaments/{id}/pickem/questions/{question_id}")]
async fn delete_question(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    path: web::Path<(Uuid, Uuid)>,
) -> Result<HttpResponse, ApiError> {
    require_admin(&state, &claims).await?;
    let (tournament_id, question_id) = path.into_inner();
    let tournament = find_tournament(&state, tournament_id).await?;
    let question = find_question(&state, tournament_id, question_id).await?;
    if question.opens_at <= now_rfc3339() || locked(&question, &tournament, &now_rfc3339()) {
        return Err(ApiError::PickemLocked);
    }
    state
        .store
        .pickem()
        .delete_question(question_id)
        .await
        .map_err(write_error)?;
    Ok(HttpResponse::NoContent().finish())
}

/// Crée ou remplace ma réponse à une question, tant qu'elle est ouverte.
#[utoipa::path(
    put,
    path = "/tournaments/{id}/pickem/questions/{question_id}/answer",
    tag = "pickem",
    security(("bearer" = [])),
    params(
        ("id" = Uuid, Path, description = "Identifiant du tournoi"),
        ("question_id" = Uuid, Path, description = "Identifiant de la question"),
    ),
    request_body = AnswerRequest,
    responses(
        (status = 200, description = "Réponse enregistrée", body = Answer),
        (status = 400, description = "Requête invalide", body = ErrorResponse),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 404, description = "Tournoi ou question introuvable", body = ErrorResponse),
        (status = 409, description = "Question fermée", body = ErrorResponse),
    ),
)]
#[put("/tournaments/{id}/pickem/questions/{question_id}/answer")]
async fn answer_question(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    path: web::Path<(Uuid, Uuid)>,
    body: web::Json<AnswerRequest>,
) -> Result<HttpResponse, ApiError> {
    let (tournament_id, question_id) = path.into_inner();
    let tournament = find_tournament(&state, tournament_id).await?;
    let question = find_question(&state, tournament_id, question_id).await?;
    if question.opens_at > now_rfc3339() || locked(&question, &tournament, &now_rfc3339()) {
        return Err(ApiError::PickemLocked);
    }
    let request = body.into_inner();
    let picked: Vec<Uuid> = match (
        question.kind,
        request.participant_id,
        request.participant_ids,
    ) {
        (QuestionKind::StepQualifiers, None, Some(ids)) => ids,
        (QuestionKind::StepQualifiers, _, _) => {
            return Err(ApiError::Validation(vec![(
                "participant_ids",
                "Cette question attend participant_ids seul.".into(),
            )]));
        }
        (_, Some(id), None) => vec![id],
        (_, _, _) => {
            return Err(ApiError::Validation(vec![(
                "participant_id",
                "Cette question attend participant_id seul.".into(),
            )]));
        }
    };
    let field = if question.kind == QuestionKind::StepQualifiers {
        "participant_ids"
    } else {
        "participant_id"
    };
    let expected = expected_of(&state, &question).await?;
    let distinct: HashSet<&Uuid> = picked.iter().collect();
    if picked.is_empty() || distinct.len() != picked.len() || picked.len() > expected {
        return Err(ApiError::Validation(vec![(
            field,
            format!("De 1 à {expected} inscrits distincts."),
        )]));
    }
    let registered: HashSet<Uuid> = state
        .store
        .list_participants(tournament_id, PARTICIPANTS_LIMIT, 0)
        .await
        .map_err(write_error)?
        .into_iter()
        .map(|p| p.id)
        .collect();
    if !picked.iter().all(|id| registered.contains(id)) {
        return Err(ApiError::Validation(vec![(
            field,
            "Seuls les inscrits du tournoi peuvent être choisis.".into(),
        )]));
    }
    let answer = if question.kind == QuestionKind::StepQualifiers {
        json!({ "participant_ids": picked })
    } else {
        json!({ "participant_id": picked[0] })
    };
    let saved = state
        .store
        .pickem()
        .upsert_answer(AnswerInput {
            question_id,
            tournament_id,
            user_id: claims.sub,
            answer,
        })
        .await
        .map_err(write_error)?;
    Ok(HttpResponse::Ok().json(saved))
}
