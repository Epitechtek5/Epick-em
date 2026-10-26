//! Étapes d'un tournoi : réglages (administrateur), lancement avec tirage aléatoire des groupes,
//! clôture avec qualification et classement par groupe.
//!
//! Toutes ces routes exigent un jeton d'accès. La consultation est ouverte à tout compte ; la
//! création, la modification, la suppression, le lancement et la clôture sont réservés aux
//! administrateurs. Les réglages des étapes sont verrouillés dès que le tournoi est `ongoing`.
//!
//! Les points d'un participant dans l'étape viennent de la fin de ses matchs (module `matches`),
//! qui clôture aussi l'étape quand le dernier match se termine. Le lancement ne génère pas
//! encore les matchs et les critères de départage (`tiebreak`) ne sont pas encore évalués : à
//! égalité de points, la clôture départage par ordre d'inscription.

use crate::auth::{AppState, Claims};
use crate::error::{ApiError, ErrorResponse};
use crate::store::{
    MatchType, Step, StepClosing, StepDefinition, StepFormat, StepInput, StepOutcome,
    StepParticipant, StepParticipantStatus, StepStart, StepStatus, StoreError, Tournament,
    TournamentParticipant, TournamentStatus,
};
use crate::tournaments::{active_participants, find_tournament, require_scoring_editable};
use crate::users::require_admin;
use actix_web::{HttpResponse, delete, get, patch, post, web};
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::collections::HashMap;
use utoipa::ToSchema;
use utoipa_actix_web::service_config::ServiceConfig;
use uuid::Uuid;

const POSITION_MAX: i32 = 100;
const GROUPS_MAX: i32 = 1_000;
const SIZE_MAX: i32 = 10_000;
const MATCHES_MAX: i32 = 1_000;
const TIEBREAK_MAX: usize = 8;
const TIEBREAK_KEY_MAX: usize = 32;

/// Routes des étapes, avec leur documentation OpenAPI.
pub fn routes(cfg: &mut ServiceConfig) {
    cfg.service(list_steps)
        .service(get_step)
        .service(create_step)
        .service(update_step)
        .service(delete_step)
        .service(step_ranking)
        .service(start_step)
        .service(close_step);
}

#[derive(Deserialize, ToSchema)]
struct CreateStepRequest {
    /// Rang de l'étape dans le tournoi, à partir de 1 ; les positions se suivent sans trou.
    #[schema(minimum = 1, maximum = 100, example = 1)]
    position: i32,
    format: StepFormat,
    match_type: MatchType,
    /// Un seul groupe pour `swiss`, `single_elim` et `double_elim`.
    #[schema(minimum = 1, maximum = 1000, example = 4)]
    group_count: i32,
    #[schema(minimum = 2, maximum = 10000, example = 8)]
    group_size: i32,
    /// Manches (`pool`) ou rondes (`swiss`) par groupe ; 1 par défaut.
    #[schema(minimum = 1, maximum = 1000)]
    matches_per_group: Option<i32>,
    /// Qualifiés par groupe, de 1 à `group_size`.
    #[schema(minimum = 1, example = 4)]
    advance_per_group: i32,
    /// Critères de départage par priorité, en minuscules et underscores (ex. `wins`) ; huit au
    /// plus, sans doublon. Ils seront évalués avec les résultats des matchs.
    #[schema(example = json!(["wins", "best_placement"]))]
    tiebreak: Option<Vec<String>>,
}

/// Champs modifiables, tous facultatifs. Le résultat complet doit rester valide.
#[derive(Deserialize, ToSchema)]
struct UpdateStepRequest {
    position: Option<i32>,
    format: Option<StepFormat>,
    match_type: Option<MatchType>,
    group_count: Option<i32>,
    group_size: Option<i32>,
    matches_per_group: Option<i32>,
    advance_per_group: Option<i32>,
    tiebreak: Option<Vec<String>>,
}

/// Participant d'un groupe, avec son rang.
#[derive(Serialize, ToSchema)]
struct RankedParticipant {
    /// Inscrit au tournoi (`tournament_participant.id`).
    participant_id: Uuid,
    points: f64,
    /// Rang dans le groupe. En cours d'étape, les égalités de points partagent le même rang ;
    /// à la clôture, le rang est définitif et sans égalité.
    rank: i32,
    status: StepParticipantStatus,
}

/// Classement d'un groupe.
#[derive(Serialize, ToSchema)]
struct GroupRanking {
    group_id: Uuid,
    /// Rang du groupe dans l'étape, à partir de 1.
    index: i32,
    participants: Vec<RankedParticipant>,
}

/// Résultat d'une clôture.
#[derive(Serialize, ToSchema)]
pub(crate) struct CloseResponse {
    /// L'étape clôturée.
    pub(crate) step: Step,
    /// L'étape suivante si elle vient de s'ouvrir avec les qualifiés.
    pub(crate) next_step: Option<Step>,
}

/// Étapes du tournoi, par position.
#[utoipa::path(
    get,
    path = "/tournaments/{id}/steps",
    tag = "steps",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Identifiant du tournoi")),
    responses(
        (status = 200, description = "Les étapes du tournoi", body = Vec<Step>),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 404, description = "Tournoi introuvable", body = ErrorResponse),
    ),
)]
#[get("/tournaments/{id}/steps")]
async fn list_steps(
    state: web::Data<AppState>,
    id: web::Path<Uuid>,
) -> Result<HttpResponse, ApiError> {
    let tournament = find_tournament(&state, id.into_inner()).await?;
    Ok(HttpResponse::Ok().json(steps_of(&state, tournament.id).await?))
}

/// Détail d'une étape.
#[utoipa::path(
    get,
    path = "/tournaments/{id}/steps/{step_id}",
    tag = "steps",
    security(("bearer" = [])),
    params(
        ("id" = Uuid, Path, description = "Identifiant du tournoi"),
        ("step_id" = Uuid, Path, description = "Identifiant de l'étape"),
    ),
    responses(
        (status = 200, description = "L'étape", body = Step),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 404, description = "Tournoi ou étape introuvable", body = ErrorResponse),
    ),
)]
#[get("/tournaments/{id}/steps/{step_id}")]
async fn get_step(
    state: web::Data<AppState>,
    path: web::Path<(Uuid, Uuid)>,
) -> Result<HttpResponse, ApiError> {
    let (tournament_id, step_id) = path.into_inner();
    Ok(HttpResponse::Ok().json(find_step(&state, tournament_id, step_id).await?))
}

/// Crée une étape `pending` (administrateur). Le chaînage des étapes (capacité du tournoi,
/// qualifiés de l'étape précédente, un seul qualifié à la fin) est vérifié au passage du
/// tournoi en `ongoing`.
#[utoipa::path(
    post,
    path = "/tournaments/{id}/steps",
    tag = "steps",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Identifiant du tournoi")),
    request_body = CreateStepRequest,
    responses(
        (status = 201, description = "Étape créée", body = Step),
        (status = 400, description = "Requête invalide", body = ErrorResponse),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 403, description = "Réservé aux administrateurs", body = ErrorResponse),
        (status = 404, description = "Tournoi introuvable", body = ErrorResponse),
        (status = 409, description = "Position déjà prise, ou tournoi en cours ou terminé", body = ErrorResponse),
    ),
)]
#[post("/tournaments/{id}/steps")]
async fn create_step(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    id: web::Path<Uuid>,
    body: web::Json<CreateStepRequest>,
) -> Result<HttpResponse, ApiError> {
    require_admin(&state, &claims).await?;
    let tournament = find_tournament(&state, id.into_inner()).await?;
    let request = body.into_inner();
    let definition = StepDefinition {
        position: request.position,
        format: request.format,
        match_type: request.match_type,
        group_count: request.group_count,
        group_size: request.group_size,
        matches_per_group: request.matches_per_group.unwrap_or(1),
        advance_per_group: request.advance_per_group,
        tiebreak: tiebreak_value(request.tiebreak.unwrap_or_default()),
    };
    let errors = check(&definition);
    if !errors.is_empty() {
        return Err(ApiError::Validation(errors));
    }
    require_scoring_editable(&tournament)?;
    let step = state
        .store
        .create_step(StepInput {
            tournament_id: tournament.id,
            definition,
        })
        .await
        .map_err(step_error)?
        .ok_or(ApiError::NotFound)?;
    Ok(HttpResponse::Created().json(step))
}

/// Modifie une étape (administrateur), tant que le tournoi n'est pas `ongoing`.
#[utoipa::path(
    patch,
    path = "/tournaments/{id}/steps/{step_id}",
    tag = "steps",
    security(("bearer" = [])),
    params(
        ("id" = Uuid, Path, description = "Identifiant du tournoi"),
        ("step_id" = Uuid, Path, description = "Identifiant de l'étape"),
    ),
    request_body = UpdateStepRequest,
    responses(
        (status = 200, description = "Étape modifiée", body = Step),
        (status = 400, description = "Requête invalide", body = ErrorResponse),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 403, description = "Réservé aux administrateurs", body = ErrorResponse),
        (status = 404, description = "Tournoi ou étape introuvable", body = ErrorResponse),
        (status = 409, description = "Position déjà prise, ou tournoi en cours ou terminé", body = ErrorResponse),
    ),
)]
#[patch("/tournaments/{id}/steps/{step_id}")]
async fn update_step(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    path: web::Path<(Uuid, Uuid)>,
    body: web::Json<UpdateStepRequest>,
) -> Result<HttpResponse, ApiError> {
    require_admin(&state, &claims).await?;
    let (tournament_id, step_id) = path.into_inner();
    let tournament = find_tournament(&state, tournament_id).await?;
    let current = find_step(&state, tournament_id, step_id).await?;
    let request = body.into_inner();
    let definition = StepDefinition {
        position: request.position.unwrap_or(current.position),
        format: request.format.unwrap_or(current.format),
        match_type: request.match_type.unwrap_or(current.match_type),
        group_count: request.group_count.unwrap_or(current.group_count),
        group_size: request.group_size.unwrap_or(current.group_size),
        matches_per_group: request
            .matches_per_group
            .unwrap_or(current.matches_per_group),
        advance_per_group: request
            .advance_per_group
            .unwrap_or(current.advance_per_group),
        tiebreak: request.tiebreak.map_or(current.tiebreak, tiebreak_value),
    };
    let errors = check(&definition);
    if !errors.is_empty() {
        return Err(ApiError::Validation(errors));
    }
    require_scoring_editable(&tournament)?;
    let step = state
        .store
        .replace_step(current.id, definition)
        .await
        .map_err(step_error)?
        .ok_or(ApiError::NotFound)?;
    Ok(HttpResponse::Ok().json(step))
}

/// Supprime une étape, ses groupes et ses participants (administrateur), tant que le tournoi
/// n'est pas `ongoing`.
#[utoipa::path(
    delete,
    path = "/tournaments/{id}/steps/{step_id}",
    tag = "steps",
    security(("bearer" = [])),
    params(
        ("id" = Uuid, Path, description = "Identifiant du tournoi"),
        ("step_id" = Uuid, Path, description = "Identifiant de l'étape"),
    ),
    responses(
        (status = 204, description = "Étape supprimée"),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 403, description = "Réservé aux administrateurs", body = ErrorResponse),
        (status = 404, description = "Tournoi ou étape introuvable", body = ErrorResponse),
        (status = 409, description = "Le tournoi est en cours ou terminé", body = ErrorResponse),
    ),
)]
#[delete("/tournaments/{id}/steps/{step_id}")]
async fn delete_step(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    path: web::Path<(Uuid, Uuid)>,
) -> Result<HttpResponse, ApiError> {
    require_admin(&state, &claims).await?;
    let (tournament_id, step_id) = path.into_inner();
    let tournament = find_tournament(&state, tournament_id).await?;
    let step = find_step(&state, tournament_id, step_id).await?;
    require_scoring_editable(&tournament)?;
    if state
        .store
        .delete_step(step.id)
        .await
        .map_err(ApiError::internal)?
    {
        Ok(HttpResponse::NoContent().finish())
    } else {
        Err(ApiError::NotFound)
    }
}

/// Classement de chaque groupe de l'étape. Vide tant que l'étape n'est pas lancée.
#[utoipa::path(
    get,
    path = "/tournaments/{id}/steps/{step_id}/ranking",
    tag = "steps",
    security(("bearer" = [])),
    params(
        ("id" = Uuid, Path, description = "Identifiant du tournoi"),
        ("step_id" = Uuid, Path, description = "Identifiant de l'étape"),
    ),
    responses(
        (status = 200, description = "Classement par groupe", body = Vec<GroupRanking>),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 404, description = "Tournoi ou étape introuvable", body = ErrorResponse),
    ),
)]
#[get("/tournaments/{id}/steps/{step_id}/ranking")]
async fn step_ranking(
    state: web::Data<AppState>,
    path: web::Path<(Uuid, Uuid)>,
) -> Result<HttpResponse, ApiError> {
    let (tournament_id, step_id) = path.into_inner();
    let step = find_step(&state, tournament_id, step_id).await?;
    let groups = state
        .store
        .list_step_groups(step.id)
        .await
        .map_err(ApiError::internal)?;
    let members = state
        .store
        .list_step_participants(step.id)
        .await
        .map_err(ApiError::internal)?;
    let ranking: Vec<GroupRanking> = groups
        .into_iter()
        .map(|group| {
            let in_group: Vec<&StepParticipant> =
                members.iter().filter(|m| m.group_id == group.id).collect();
            GroupRanking {
                group_id: group.id,
                index: group.index,
                participants: live_ranking(&in_group, step.status == StepStatus::Finished),
            }
        })
        .collect();
    Ok(HttpResponse::Ok().json(ranking))
}

/// Lance l'étape (administrateur) : tire au sort les groupes parmi les participants `in` puis
/// ouvre l'étape (`ongoing`).
///
/// L'étape 1 réunit les inscrits actifs du tournoi (ni `withdrawn` ni `disqualified`), les
/// suivantes les qualifiés de l'étape précédente. Le tournoi doit être `ongoing`, les étapes
/// précédentes `finished`, et leur chaînage valide. Il faut au moins deux participants par
/// groupe et au plus `group_count × group_size`. Le tirage répartit les participants au hasard,
/// sans règle sur les équipes. Les matchs se créent ensuite à la main (`POST .../matches`).
#[utoipa::path(
    post,
    path = "/tournaments/{id}/steps/{step_id}/start",
    tag = "steps",
    security(("bearer" = [])),
    params(
        ("id" = Uuid, Path, description = "Identifiant du tournoi"),
        ("step_id" = Uuid, Path, description = "Identifiant de l'étape"),
    ),
    responses(
        (status = 200, description = "Étape en cours", body = Step),
        (status = 400, description = "Chaînage invalide ou nombre de participants incompatible", body = ErrorResponse),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 403, description = "Réservé aux administrateurs", body = ErrorResponse),
        (status = 404, description = "Tournoi ou étape introuvable", body = ErrorResponse),
        (status = 409, description = "Tournoi non en cours, étape déjà lancée ou étapes précédentes non terminées", body = ErrorResponse),
    ),
)]
#[post("/tournaments/{id}/steps/{step_id}/start")]
async fn start_step(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    path: web::Path<(Uuid, Uuid)>,
) -> Result<HttpResponse, ApiError> {
    require_admin(&state, &claims).await?;
    let (tournament_id, step_id) = path.into_inner();
    let tournament = find_tournament(&state, tournament_id).await?;
    let step = find_step(&state, tournament_id, step_id).await?;
    if tournament.status != TournamentStatus::Ongoing || step.status != StepStatus::Pending {
        return Err(ApiError::InvalidTransition);
    }
    let steps = steps_of(&state, tournament.id).await?;
    if steps
        .iter()
        .any(|s| s.position < step.position && s.status != StepStatus::Finished)
    {
        return Err(ApiError::InvalidTransition);
    }
    let problems = chain_problems(&tournament, &steps);
    if !problems.is_empty() {
        return Err(ApiError::Validation(vec![("steps", problems.join(" "))]));
    }
    let entrants = entrants_of(&state, &tournament, &steps, &step).await?;
    if let Some(problem) = entrants_problem(&step, entrants.len()) {
        return Err(ApiError::Validation(vec![("participants", problem)]));
    }
    let started = state
        .store
        .start_step(StepStart {
            step_id: step.id,
            groups: draw_groups(entrants, step.group_count),
        })
        .await
        .map_err(step_error)?
        .ok_or(ApiError::NotFound)?;
    Ok(HttpResponse::Ok().json(started))
}

/// Clôture l'étape (administrateur) : classe chaque groupe selon les points, qualifie les
/// `advance_per_group` premiers (`qualified`) et élimine les autres (`eliminated`), puis ouvre
/// l'étape suivante avec les qualifiés, tirés au sort dans ses groupes, si elle existe et si
/// leur nombre convient. À égalité de points, l'ordre d'inscription départage ; les critères
/// `tiebreak` ne sont pas encore évalués. Le statut du tournoi ne
/// change pas : il se termine par `POST /tournaments/{id}/status`.
#[utoipa::path(
    post,
    path = "/tournaments/{id}/steps/{step_id}/close",
    tag = "steps",
    security(("bearer" = [])),
    params(
        ("id" = Uuid, Path, description = "Identifiant du tournoi"),
        ("step_id" = Uuid, Path, description = "Identifiant de l'étape"),
    ),
    responses(
        (status = 200, description = "Étape clôturée, et étape suivante si elle s'est ouverte", body = CloseResponse),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 403, description = "Réservé aux administrateurs", body = ErrorResponse),
        (status = 404, description = "Tournoi ou étape introuvable", body = ErrorResponse),
        (status = 409, description = "L'étape n'est pas en cours", body = ErrorResponse),
    ),
)]
#[post("/tournaments/{id}/steps/{step_id}/close")]
async fn close_step(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    path: web::Path<(Uuid, Uuid)>,
) -> Result<HttpResponse, ApiError> {
    require_admin(&state, &claims).await?;
    let (tournament_id, step_id) = path.into_inner();
    let tournament = find_tournament(&state, tournament_id).await?;
    let step = find_step(&state, tournament_id, step_id).await?;
    Ok(HttpResponse::Ok().json(close_step_of(&state, &tournament, &step).await?))
}

/// Clôture l'étape `ongoing` : classe chaque groupe, qualifie et élimine, puis ouvre l'étape
/// suivante si elle est prête. Sert la route de clôture et la clôture automatique quand le
/// dernier match de l'étape se termine.
pub(crate) async fn close_step_of(
    state: &AppState,
    tournament: &Tournament,
    step: &Step,
) -> Result<CloseResponse, ApiError> {
    if step.status != StepStatus::Ongoing {
        return Err(ApiError::InvalidTransition);
    }
    let groups = state
        .store
        .list_step_groups(step.id)
        .await
        .map_err(ApiError::internal)?;
    let members = state
        .store
        .list_step_participants(step.id)
        .await
        .map_err(ApiError::internal)?;
    let registered: HashMap<Uuid, String> = active_participants(state, tournament.id)
        .await?
        .into_iter()
        .map(|p: TournamentParticipant| (p.id, p.registered_at))
        .collect();

    let mut outcomes = Vec::with_capacity(members.len());
    for group in &groups {
        let in_group: Vec<&StepParticipant> =
            members.iter().filter(|m| m.group_id == group.id).collect();
        outcomes.extend(close_group(&in_group, &registered, step.advance_per_group));
    }
    let qualified: Vec<Uuid> = outcomes
        .iter()
        .filter(|o| o.status == StepParticipantStatus::Qualified)
        .map(|o| o.participant_id)
        .collect();

    // L'étape suivante s'ouvre seule quand elle est prête ; sinon elle reste `pending` et se
    // lance à la main (`start`), qui explique ce qui manque.
    let steps = steps_of(state, tournament.id).await?;
    let following = steps
        .iter()
        .filter(|s| s.position > step.position)
        .min_by_key(|s| s.position)
        .filter(|s| s.status == StepStatus::Pending)
        .filter(|s| entrants_problem(s, qualified.len()).is_none());
    let next = following.map(|next| StepStart {
        step_id: next.id,
        groups: draw_groups(qualified.clone(), next.group_count),
    });
    let opens = following.map(|s| s.id);

    let finished = state
        .store
        .close_step(StepClosing {
            step_id: step.id,
            outcomes,
            next,
        })
        .await
        .map_err(step_error)?
        .ok_or(ApiError::NotFound)?;
    let next_step = match opens {
        Some(id) => state
            .store
            .find_step(id)
            .await
            .map_err(ApiError::internal)?,
        None => None,
    };
    Ok(CloseResponse {
        step: finished,
        next_step,
    })
}

pub(crate) async fn find_step(
    state: &AppState,
    tournament_id: Uuid,
    step_id: Uuid,
) -> Result<Step, ApiError> {
    state
        .store
        .find_step(step_id)
        .await
        .map_err(ApiError::internal)?
        .filter(|step| step.tournament_id == tournament_id)
        .ok_or(ApiError::NotFound)
}

pub(crate) async fn steps_of(state: &AppState, tournament_id: Uuid) -> Result<Vec<Step>, ApiError> {
    state
        .store
        .list_steps(tournament_id)
        .await
        .map_err(ApiError::internal)
}

/// Participants à répartir dans l'étape : les inscrits actifs pour la première, les qualifiés de
/// l'étape précédente pour les suivantes.
async fn entrants_of(
    state: &AppState,
    tournament: &Tournament,
    steps: &[Step],
    step: &Step,
) -> Result<Vec<Uuid>, ApiError> {
    let previous = steps
        .iter()
        .filter(|s| s.position < step.position)
        .max_by_key(|s| s.position);
    match previous {
        None => Ok(active_participants(state, tournament.id)
            .await?
            .into_iter()
            .map(|p| p.id)
            .collect()),
        Some(previous) => Ok(state
            .store
            .list_step_participants(previous.id)
            .await
            .map_err(ApiError::internal)?
            .into_iter()
            .filter(|m| m.status == StepParticipantStatus::Qualified)
            .map(|m| m.participant_id)
            .collect()),
    }
}

/// Ce qui empêche de répartir `count` participants dans l'étape.
fn entrants_problem(step: &Step, count: usize) -> Option<String> {
    let capacity = i64::from(step.group_count) * i64::from(step.group_size);
    let minimum = i64::from(step.group_count) * 2;
    let count = i64::try_from(count).unwrap_or(i64::MAX);
    if count < minimum {
        Some(format!(
            "Il faut au moins 2 participants par groupe, soit {minimum}, il y en a {count}."
        ))
    } else if count > capacity {
        Some(format!(
            "L'étape accueille {capacity} participants au plus, il y en a {count}."
        ))
    } else {
        None
    }
}

pub(crate) fn step_error(err: StoreError) -> ApiError {
    match err {
        StoreError::StepPositionTaken => ApiError::StepPositionTaken,
        StoreError::StepState => ApiError::InvalidTransition,
        other => ApiError::internal(other),
    }
}

pub(crate) fn tiebreak_value(criteria: Vec<String>) -> serde_json::Value {
    serde_json::Value::Array(
        criteria
            .into_iter()
            .map(serde_json::Value::String)
            .collect(),
    )
}

/// Valide les réglages d'une étape, un message par champ fautif.
pub(crate) fn check(definition: &StepDefinition) -> Vec<(&'static str, String)> {
    let mut errors = Vec::new();
    let ranges = [
        ("position", definition.position, 1, POSITION_MAX),
        ("group_count", definition.group_count, 1, GROUPS_MAX),
        ("group_size", definition.group_size, 2, SIZE_MAX),
        (
            "matches_per_group",
            definition.matches_per_group,
            1,
            MATCHES_MAX,
        ),
        (
            "advance_per_group",
            definition.advance_per_group,
            1,
            definition.group_size.clamp(1, SIZE_MAX),
        ),
    ];
    for (field, value, min, max) in ranges {
        if !(min..=max).contains(&value) {
            errors.push((field, format!("Un entier de {min} à {max} est attendu.")));
        }
    }
    if definition.format != StepFormat::Pool && definition.group_count != 1 {
        errors.push((
            "group_count",
            "Les formats swiss et élimination n'ont qu'un seul groupe.".to_string(),
        ));
    }
    if i64::from(definition.group_count) * i64::from(definition.group_size) > i64::from(SIZE_MAX) {
        errors.push((
            "group_size",
            format!("Une étape accueille {SIZE_MAX} participants au plus."),
        ));
    }
    if let Some(criteria) = definition.tiebreak.as_array() {
        let keys: Vec<&str> = criteria.iter().filter_map(|c| c.as_str()).collect();
        let well_formed = |key: &&str| {
            !key.is_empty()
                && key.len() <= TIEBREAK_KEY_MAX
                && key
                    .bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
        };
        let mut distinct = keys.clone();
        distinct.sort_unstable();
        distinct.dedup();
        if keys.len() > TIEBREAK_MAX
            || !keys.iter().all(well_formed)
            || distinct.len() != keys.len()
        {
            errors.push((
                "tiebreak",
                format!(
                    "{TIEBREAK_MAX} critères distincts au plus, en minuscules, chiffres et underscores (jusqu'à {TIEBREAK_KEY_MAX} caractères)."
                ),
            ));
        }
    }
    errors
}

/// Ce qui empêche d'enchaîner les étapes du tournoi, un message par problème ; vide s'il n'y a
/// aucune étape.
///
/// Les positions se suivent à partir de 1. L'étape 1 accueille `max_participants`
/// (`group_count × group_size`), l'étape n accueille les qualifiés de l'étape n−1
/// (`group_count × advance_per_group`), et la dernière étape ne qualifie qu'un participant.
pub(crate) fn chain_problems(tournament: &Tournament, steps: &[Step]) -> Vec<String> {
    let mut problems = Vec::new();
    if steps.is_empty() {
        return problems;
    }
    let mut ordered: Vec<&Step> = steps.iter().collect();
    ordered.sort_by_key(|s| s.position);
    for (index, step) in ordered.iter().enumerate() {
        let expected = i32::try_from(index + 1).unwrap_or(i32::MAX);
        if step.position != expected {
            problems.push(format!(
                "Les positions des étapes doivent se suivre à partir de 1 : {expected} attendue, {} trouvée.",
                step.position
            ));
            break;
        }
    }
    let capacity = |step: &Step| i64::from(step.group_count) * i64::from(step.group_size);
    let qualified = |step: &Step| i64::from(step.group_count) * i64::from(step.advance_per_group);
    if let Some(first) = ordered.first()
        && capacity(first) != i64::from(tournament.max_participants)
    {
        problems.push(format!(
            "L'étape {} accueille {} participants, le tournoi en attend {}.",
            first.position,
            capacity(first),
            tournament.max_participants
        ));
    }
    for pair in ordered.windows(2) {
        if capacity(pair[1]) != qualified(pair[0]) {
            problems.push(format!(
                "L'étape {} qualifie {} participants, l'étape {} en accueille {}.",
                pair[0].position,
                qualified(pair[0]),
                pair[1].position,
                capacity(pair[1])
            ));
        }
    }
    if let Some(closing) = ordered.last()
        && qualified(closing) != 1
    {
        problems.push(format!(
            "La dernière étape ({}) doit qualifier un seul participant, elle en qualifie {}.",
            closing.position,
            qualified(closing)
        ));
    }
    problems
}

/// Répartit les participants au hasard dans `group_count` groupes, à tour de rôle : les tailles
/// diffèrent d'un participant au plus.
pub(crate) fn draw_groups(mut ids: Vec<Uuid>, group_count: i32) -> Vec<Vec<Uuid>> {
    let count = usize::try_from(group_count).unwrap_or(1).max(1);
    // Une clé aléatoire par participant : mélange uniforme sans dépendance supplémentaire.
    ids.sort_by_cached_key(|_| Uuid::new_v4());
    let mut groups = vec![Vec::new(); count];
    for (index, id) in ids.into_iter().enumerate() {
        groups[index % count].push(id);
    }
    groups
}

/// Rang définitif d'un groupe à la clôture : points décroissants puis ordre d'inscription.
/// Les `advance_per_group` premiers sont qualifiés.
fn close_group(
    members: &[&StepParticipant],
    registered: &HashMap<Uuid, String>,
    advance_per_group: i32,
) -> Vec<StepOutcome> {
    let mut ordered: Vec<&StepParticipant> = members.to_vec();
    ordered.sort_by(|a, b| {
        b.points
            .total_cmp(&a.points)
            .then_with(|| {
                registered
                    .get(&a.participant_id)
                    .cmp(&registered.get(&b.participant_id))
            })
            .then_with(|| a.participant_id.cmp(&b.participant_id))
    });
    ordered
        .into_iter()
        .zip(1i32..)
        .map(|(member, rank)| StepOutcome {
            participant_id: member.participant_id,
            final_rank: rank,
            status: if rank <= advance_per_group {
                StepParticipantStatus::Qualified
            } else {
                StepParticipantStatus::Eliminated
            },
        })
        .collect()
}

/// Classement d'un groupe : celui enregistré une fois l'étape clôturée, sinon les points
/// décroissants avec des égalités qui partagent le même rang.
fn live_ranking(members: &[&StepParticipant], finished: bool) -> Vec<RankedParticipant> {
    let mut ordered: Vec<&StepParticipant> = members.to_vec();
    ordered.sort_by(|a, b| {
        if finished {
            a.final_rank
                .cmp(&b.final_rank)
                .then_with(|| a.participant_id.cmp(&b.participant_id))
        } else {
            b.points
                .total_cmp(&a.points)
                .then_with(|| a.participant_id.cmp(&b.participant_id))
        }
    });
    let mut ranked: Vec<RankedParticipant> = Vec::with_capacity(ordered.len());
    for (index, member) in ordered.iter().enumerate() {
        let rank = match (finished, member.final_rank) {
            (true, Some(rank)) => rank,
            _ => match index.checked_sub(1).map(|previous| ordered[previous]) {
                Some(previous) if previous.points.total_cmp(&member.points) == Ordering::Equal => {
                    ranked[index - 1].rank
                }
                _ => i32::try_from(index + 1).unwrap_or(i32::MAX),
            },
        };
        ranked.push(RankedParticipant {
            participant_id: member.participant_id,
            points: member.points,
            rank,
            status: member.status,
        });
    }
    ranked
}

#[cfg(test)]
mod tests {
    use super::*;

    fn step(position: i32, groups: i32, size: i32, advance: i32) -> Step {
        Step {
            id: Uuid::new_v4(),
            tournament_id: Uuid::nil(),
            position,
            format: StepFormat::Pool,
            match_type: MatchType::Ffa,
            group_count: groups,
            group_size: size,
            matches_per_group: 1,
            advance_per_group: advance,
            tiebreak: serde_json::json!([]),
            status: StepStatus::Pending,
            created_at: String::new(),
            updated_at: String::new(),
        }
    }

    fn tournament(max_participants: i32) -> Tournament {
        use crate::store::{ParticipantType, TeamScoringMode};
        Tournament {
            id: Uuid::nil(),
            game_id: Uuid::nil(),
            name: "T".into(),
            description: None,
            start_date: String::new(),
            end_date: String::new(),
            registration_open_at: None,
            registration_close_at: None,
            participant_type: ParticipantType::Solo,
            team_size: None,
            max_participants,
            team_scoring_mode: TeamScoringMode::None,
            team_scoring_n: None,
            status: TournamentStatus::Draft,
            created_at: String::new(),
            updated_at: String::new(),
        }
    }

    fn member(points: f64) -> StepParticipant {
        StepParticipant {
            step_id: Uuid::nil(),
            participant_id: Uuid::new_v4(),
            group_id: Uuid::nil(),
            points,
            final_rank: None,
            status: StepParticipantStatus::In,
        }
    }

    #[test]
    fn a_tft_chain_is_valid() {
        // 32 joueurs : 4 groupes de 8 dont 4 passent, puis 2 groupes de 8 dont 4 passent, puis la
        // finale de 8 dont 1 gagne.
        let steps = [step(1, 4, 8, 4), step(2, 2, 8, 4), step(3, 1, 8, 1)];
        assert_eq!(
            chain_problems(&tournament(32), &steps),
            Vec::<String>::new()
        );
    }

    #[test]
    fn a_chain_reports_every_break() {
        let steps = [step(1, 4, 8, 4), step(3, 3, 8, 4)];
        let problems = chain_problems(&tournament(30), &steps);
        // Positions, capacité du tournoi, étape 1 vers 3, dernière étape.
        assert_eq!(problems.len(), 4, "{problems:?}");
        assert!(chain_problems(&tournament(30), &[]).is_empty());
    }

    #[test]
    fn the_draw_deals_every_participant_once_in_balanced_groups() {
        let ids: Vec<Uuid> = (0..10).map(|_| Uuid::new_v4()).collect();
        let groups = draw_groups(ids.clone(), 3);
        let sizes: Vec<usize> = groups.iter().map(Vec::len).collect();
        assert_eq!(sizes, [4, 3, 3]);
        let mut dealt: Vec<Uuid> = groups.into_iter().flatten().collect();
        dealt.sort();
        let mut expected = ids;
        expected.sort();
        assert_eq!(dealt, expected);
    }

    #[test]
    fn closing_a_group_ranks_by_points_then_registration_order() {
        let (a, b, c, d) = (member(5.0), member(9.0), member(5.0), member(1.0));
        let registered = HashMap::from([
            (a.participant_id, "2026-01-02".to_string()),
            (b.participant_id, "2026-01-03".to_string()),
            (c.participant_id, "2026-01-01".to_string()),
            (d.participant_id, "2026-01-04".to_string()),
        ]);
        let outcomes = close_group(&[&a, &b, &c, &d], &registered, 2);
        let order: Vec<Uuid> = outcomes.iter().map(|o| o.participant_id).collect();
        assert_eq!(
            order,
            [
                b.participant_id,
                c.participant_id,
                a.participant_id,
                d.participant_id
            ]
        );
        let statuses: Vec<StepParticipantStatus> = outcomes.iter().map(|o| o.status).collect();
        assert_eq!(
            statuses,
            [
                StepParticipantStatus::Qualified,
                StepParticipantStatus::Qualified,
                StepParticipantStatus::Eliminated,
                StepParticipantStatus::Eliminated,
            ]
        );
    }

    #[test]
    fn a_live_ranking_shares_the_rank_between_ties() {
        let (a, b, c) = (member(9.0), member(5.0), member(5.0));
        let ranks: Vec<i32> = live_ranking(&[&a, &b, &c], false)
            .iter()
            .map(|r| r.rank)
            .collect();
        assert_eq!(ranks, [1, 2, 2]);
    }

    #[test]
    fn step_settings_are_checked_field_by_field() {
        let valid = StepDefinition {
            position: 1,
            format: StepFormat::Swiss,
            match_type: MatchType::Duel,
            group_count: 1,
            group_size: 8,
            matches_per_group: 3,
            advance_per_group: 4,
            tiebreak: serde_json::json!(["wins", "best_placement"]),
        };
        assert!(check(&valid).is_empty());
        let fields = |definition: StepDefinition| -> Vec<&'static str> {
            check(&definition)
                .into_iter()
                .map(|(field, _)| field)
                .collect()
        };
        assert_eq!(
            fields(StepDefinition {
                advance_per_group: 9,
                ..valid.clone()
            }),
            ["advance_per_group"]
        );
        assert_eq!(
            fields(StepDefinition {
                group_count: 2,
                ..valid.clone()
            }),
            ["group_count"]
        );
        assert_eq!(
            fields(StepDefinition {
                tiebreak: serde_json::json!(["Wins", "wins"]),
                ..valid.clone()
            }),
            ["tiebreak"]
        );
        assert_eq!(
            fields(StepDefinition {
                tiebreak: serde_json::json!(["wins", "wins"]),
                ..valid
            }),
            ["tiebreak"]
        );
    }
}
