//! Étapes d'un tournoi : réglages (administrateur), lancement avec tirage aléatoire des groupes,
//! clôture avec qualification et classement par groupe.
//!
//! Toutes ces routes exigent un jeton d'accès. La consultation est ouverte à tout compte ; la
//! création, la modification, la suppression, le lancement et la clôture sont réservés aux
//! administrateurs. Les réglages des étapes sont verrouillés dès que le tournoi est `ongoing`.
//!
//! Les points d'un participant dans l'étape viennent de la fin de ses matchs (module `matches`),
//! qui clôture aussi l'étape quand le dernier match se termine. Le lancement fixe les têtes de
//! série (`rules.seeding`) et répartit les groupes en serpentin ; les matchs se génèrent ensuite
//! (module `generation`). Le classement applique les critères de départage de l'étape
//! (`head_to_head`, `game_differential`, `buchholz`), puis l'ordre d'inscription.

use crate::auth::{AppState, Claims};
use crate::error::{ApiError, ErrorResponse};
use crate::generation::{group_by_match, support_problem};
use crate::standing::rank_group;
use crate::store::{
    Match, MatchParticipant, MatchStatus, MatchType, QualificationPlacement, SeedingStrategy, Step,
    StepClosing, StepDefinition, StepFormat, StepGroup, StepInput, StepOutcome, StepParticipant,
    StepParticipantStatus, StepRules, StepStart, StepStatus, StoreError, Tournament,
    TournamentParticipant, TournamentStatus,
};
use crate::tournaments::{active_participants, find_tournament, require_scoring_editable};
use crate::users::require_admin;
use actix_web::{HttpResponse, delete, get, patch, post, web};
use serde::{Deserialize, Serialize};
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
    #[schema(example = json!(["head_to_head", "game_differential", "buchholz"]))]
    tiebreak: Option<Vec<String>>,
    /// Têtes de série, qualification, séries (BO1/3/5) et barème de l'étape.
    rules: Option<StepRules>,
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
    rules: Option<StepRules>,
}

/// Lancement : ordre des têtes de série quand `rules.seeding` vaut `manual`.
#[derive(Deserialize, ToSchema, Default)]
struct StartStepRequest {
    /// Tous les participants de l'étape, la tête de série 1 en premier.
    seed_order: Option<Vec<Uuid>>,
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
    /// Tête de série dans l'étape (1 = meilleure), fixée au lancement.
    seed: Option<i32>,
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
        rules: request.rules.unwrap_or_default(),
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
        rules: request.rules.unwrap_or(current.rules),
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
    let data = ranking_data(&state, tournament_id, &step).await?;
    let ranking: Vec<GroupRanking> = data
        .groups
        .iter()
        .map(|group| GroupRanking {
            group_id: group.id,
            index: group.index,
            participants: live_ranking(&step, group, &data),
        })
        .collect();
    Ok(HttpResponse::Ok().json(ranking))
}

/// Lance l'étape (administrateur) : fixe les têtes de série, répartit les participants dans les
/// groupes en serpentin puis ouvre l'étape (`ongoing`).
///
/// L'étape 1 réunit les inscrits actifs du tournoi (ni `withdrawn` ni `disqualified`), les
/// suivantes les qualifiés de l'étape précédente. Le tournoi doit être `ongoing`, les étapes
/// précédentes `finished`, et leur chaînage valide. Il faut au moins deux participants par
/// groupe et au plus `group_count × group_size`. Les têtes de série suivent `rules.seeding` :
/// `manual` (corps `seed_order`, tous les participants), `random`, ou `ranking` (ordre de
/// qualification de l'étape précédente, ou points du tournoi s'ils départagent les inscrits ;
/// refusé sans classement fiable). Une étape précédente configurée en `rank` ou `group_rank`
/// impose cet ordre aux qualifiés (sauf seeding `manual`). Les matchs se génèrent ensuite
/// (`POST .../generate`) ou se créent à la main (`POST .../matches`).
#[utoipa::path(
    post,
    path = "/tournaments/{id}/steps/{step_id}/start",
    tag = "steps",
    security(("bearer" = [])),
    params(
        ("id" = Uuid, Path, description = "Identifiant du tournoi"),
        ("step_id" = Uuid, Path, description = "Identifiant de l'étape"),
    ),
    request_body(content = StartStepRequest, description = "Facultatif"),
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
    body: Option<web::Json<StartStepRequest>>,
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
    let seed_order = body.and_then(|b| b.into_inner().seed_order);
    let entrants = ordered_entrants(&state, &tournament, &steps, &step, seed_order).await?;
    if let Some(problem) = entrants_problem(&step, entrants.len()) {
        return Err(ApiError::Validation(vec![("participants", problem)]));
    }
    let started = state
        .store
        .start_step(start_of(&step, entrants))
        .await
        .map_err(step_error)?
        .ok_or(ApiError::NotFound)?;
    Ok(HttpResponse::Ok().json(started))
}

/// Clôture l'étape (administrateur) : classe chaque groupe selon les points, qualifie les
/// `advance_per_group` premiers (`qualified`) et élimine les autres (`eliminated`), puis ouvre
/// l'étape suivante avec les qualifiés, tirés au sort dans ses groupes, si elle existe et si
/// leur nombre convient. À égalité de points, les critères `tiebreak` de l'étape départagent
/// (confrontation directe, différentiel de manches, Buchholz), puis l'ordre d'inscription ; les
/// qualifiés sont placés dans l'étape suivante selon `rules.qualification`. Le statut du tournoi
/// ne change pas : il se termine par `POST /tournaments/{id}/status`.
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
    let data = ranking_data(state, tournament.id, step).await?;
    let mut outcomes = Vec::with_capacity(data.members.len());
    for group in &data.groups {
        outcomes.extend(close_group(step, group, &data));
    }
    let qualified: Vec<Entrant> = outcomes
        .iter()
        .filter(|o| o.status == StepParticipantStatus::Qualified)
        .filter_map(|o| {
            let member = data
                .members
                .iter()
                .find(|m| m.participant_id == o.participant_id)?;
            let group = data.groups.iter().find(|g| g.id == member.group_id)?;
            Some(Entrant {
                id: o.participant_id,
                group_index: group.index,
                rank: o.final_rank,
                points: member.points,
            })
        })
        .collect();

    // L'étape suivante s'ouvre seule quand elle est prête ; sinon elle reste `pending` et se
    // lance à la main (`start`), qui explique ce qui manque. Une tête de série manuelle exige
    // un ordre fourni par l'administrateur : l'étape reste alors à lancer à la main.
    let steps = steps_of(state, tournament.id).await?;
    let following = steps
        .iter()
        .filter(|s| s.position > step.position)
        .min_by_key(|s| s.position)
        .filter(|s| s.status == StepStatus::Pending)
        .filter(|s| s.rules.seeding != SeedingStrategy::Manual)
        .filter(|s| entrants_problem(s, qualified.len()).is_none());
    let next = following.map(|next| {
        start_of(
            next,
            qualifier_order(
                qualified.clone(),
                step.rules.qualification,
                next.rules.seeding,
            ),
        )
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

/// Qualifié d'une étape terminée, avec de quoi l'ordonner dans l'étape suivante.
#[derive(Debug, Clone)]
pub(crate) struct Entrant {
    pub(crate) id: Uuid,
    pub(crate) group_index: i32,
    pub(crate) rank: i32,
    pub(crate) points: f64,
}

/// Ordonne les qualifiés (la tête de série 1 en premier) selon le placement de leur étape :
/// `random` mélange (sauf si l'étape suivante veut un seeding `ranking`, qui suit le rang),
/// `rank` classe par rang puis points, `group_rank` par rang puis groupe (A1, B1, C1, A2, ...).
pub(crate) fn qualifier_order(
    mut entrants: Vec<Entrant>,
    placement: QualificationPlacement,
    seeding: SeedingStrategy,
) -> Vec<Uuid> {
    let placement = match (placement, seeding) {
        (QualificationPlacement::Random, SeedingStrategy::Ranking) => QualificationPlacement::Rank,
        (placement, _) => placement,
    };
    match placement {
        QualificationPlacement::Random => {
            return shuffled(entrants.into_iter().map(|e| e.id).collect());
        }
        QualificationPlacement::Rank => entrants.sort_by(|a, b| {
            a.rank
                .cmp(&b.rank)
                .then_with(|| b.points.total_cmp(&a.points))
                .then_with(|| a.group_index.cmp(&b.group_index))
                .then_with(|| a.id.cmp(&b.id))
        }),
        QualificationPlacement::GroupRank => entrants.sort_by(|a, b| {
            a.rank
                .cmp(&b.rank)
                .then_with(|| a.group_index.cmp(&b.group_index))
                .then_with(|| a.id.cmp(&b.id))
        }),
    }
    entrants.into_iter().map(|e| e.id).collect()
}

/// Participants à répartir dans l'étape, par tête de série : les inscrits actifs pour la
/// première, les qualifiés de l'étape précédente pour les suivantes.
async fn ordered_entrants(
    state: &AppState,
    tournament: &Tournament,
    steps: &[Step],
    step: &Step,
    seed_order: Option<Vec<Uuid>>,
) -> Result<Vec<Uuid>, ApiError> {
    let previous = steps
        .iter()
        .filter(|s| s.position < step.position)
        .max_by_key(|s| s.position);
    let (ids, qualified) = match previous {
        None => {
            let ids: Vec<Uuid> = active_participants(state, tournament.id)
                .await?
                .into_iter()
                .map(|p| p.id)
                .collect();
            (ids, Vec::new())
        }
        Some(previous) => {
            let groups = state
                .store
                .list_step_groups(previous.id)
                .await
                .map_err(ApiError::internal)?;
            let qualified: Vec<Entrant> = state
                .store
                .list_step_participants(previous.id)
                .await
                .map_err(ApiError::internal)?
                .into_iter()
                .filter(|m| m.status == StepParticipantStatus::Qualified)
                .map(|m| Entrant {
                    id: m.participant_id,
                    group_index: groups
                        .iter()
                        .find(|g| g.id == m.group_id)
                        .map_or(0, |g| g.index),
                    rank: m.final_rank.unwrap_or(i32::MAX),
                    points: m.points,
                })
                .collect();
            (qualified.iter().map(|e| e.id).collect(), qualified)
        }
    };
    if step.rules.seeding == SeedingStrategy::Manual {
        return manual_order(&ids, seed_order);
    }
    match previous {
        Some(previous) => Ok(qualifier_order(
            qualified,
            previous.rules.qualification,
            step.rules.seeding,
        )),
        None if step.rules.seeding == SeedingStrategy::Ranking => {
            let points = state
                .store
                .participant_points(tournament.id)
                .await
                .map_err(ApiError::internal)?;
            ranking_order(ids, &points)
        }
        None => Ok(shuffled(ids)),
    }
}

/// L'ordre manuel donne chaque participant une seule fois.
fn manual_order(ids: &[Uuid], seed_order: Option<Vec<Uuid>>) -> Result<Vec<Uuid>, ApiError> {
    let Some(order) = seed_order else {
        return Err(ApiError::Validation(vec![(
            "seed_order",
            "Un seeding manuel exige `seed_order`, la liste des participants par tête de série."
                .to_string(),
        )]));
    };
    let mut given = order.clone();
    given.sort_unstable();
    let mut expected = ids.to_vec();
    expected.sort_unstable();
    if given != expected {
        return Err(ApiError::Validation(vec![(
            "seed_order",
            format!(
                "`seed_order` doit lister une fois chacun des {} participants de l'étape.",
                ids.len()
            ),
        )]));
    }
    Ok(order)
}

/// Classe par points du tournoi, du meilleur au moins bon ; sans écart entre les inscrits, il n'y
/// a pas de classement fiable.
fn ranking_order(ids: Vec<Uuid>, points: &HashMap<Uuid, f64>) -> Result<Vec<Uuid>, ApiError> {
    let value = |id: &Uuid| points.get(id).copied().unwrap_or(0.0);
    let distinct = ids.iter().any(|id| value(id) != value(&ids[0]));
    if !distinct {
        return Err(ApiError::Validation(vec![(
            "seeding",
            "Aucun classement fiable : les points des inscrits ne les départagent pas. \
             Utilisez un seeding `manual` ou `random`."
                .to_string(),
        )]));
    }
    let mut ids = ids;
    ids.sort_by(|a, b| value(b).total_cmp(&value(a)).then_with(|| a.cmp(b)));
    Ok(ids)
}

/// Lancement d'une étape : groupes en serpentin d'après l'ordre des têtes de série.
fn start_of(step: &Step, ordered: Vec<Uuid>) -> StepStart {
    let count = usize::try_from(step.group_count).unwrap_or(1);
    StepStart {
        step_id: step.id,
        groups: domain::seeding::snake_groups(&ordered, count),
        seeds: ordered,
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
    if let Some(problem) = support_problem(definition.format, definition.match_type) {
        errors.push(("match_type", problem));
    }
    errors.extend(check_rules(definition));
    errors
}

/// Valide les séries et le barème d'une étape.
fn check_rules(definition: &StepDefinition) -> Vec<(&'static str, String)> {
    let rules = &definition.rules;
    let mut errors = Vec::new();
    let valid_best_of = |n: i32| matches!(n, 1 | 3 | 5);
    if !valid_best_of(rules.best_of) {
        errors.push((
            "rules",
            "best_of : 1, 3 ou 5 manches est attendu.".to_string(),
        ));
    }
    for (round, best_of) in &rules.best_of_by_round {
        let round_ok = round
            .parse::<i32>()
            .is_ok_and(|r| (1..=crate::matches::ROUND_MAX).contains(&r));
        if !round_ok || !valid_best_of(*best_of) {
            errors.push((
                "rules",
                format!("best_of_by_round : « {round} » doit associer une ronde à 1, 3 ou 5."),
            ));
        }
    }
    if definition.match_type == MatchType::Ffa
        && (rules.best_of != 1 || !rules.best_of_by_round.is_empty())
    {
        errors.push((
            "rules",
            "Les séries (BO3, BO5) ne concernent que les duels.".to_string(),
        ));
    }
    if let Some(scoring) = &rules.scoring {
        let finite = [scoring.win, scoring.draw, scoring.loss]
            .iter()
            .chain(scoring.placement.iter())
            .all(|v| v.is_finite() && v.abs() <= 1_000_000_000.0);
        if !finite || scoring.placement.len() > usize::try_from(SIZE_MAX).unwrap_or(0) {
            errors.push((
                "rules",
                "scoring : des nombres finis sont attendus.".to_string(),
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

/// Mélange uniforme sans dépendance supplémentaire (une clé aléatoire par participant).
pub(crate) fn shuffled(mut ids: Vec<Uuid>) -> Vec<Uuid> {
    ids.sort_by_cached_key(|_| Uuid::new_v4());
    ids
}

/// Données nécessaires au classement des groupes d'une étape.
pub(crate) struct RankingData {
    groups: Vec<StepGroup>,
    members: Vec<StepParticipant>,
    matches: Vec<Match>,
    match_members: Vec<MatchParticipant>,
    registered: HashMap<Uuid, String>,
}

pub(crate) async fn ranking_data(
    state: &AppState,
    tournament_id: Uuid,
    step: &Step,
) -> Result<RankingData, ApiError> {
    Ok(RankingData {
        groups: state
            .store
            .list_step_groups(step.id)
            .await
            .map_err(ApiError::internal)?,
        members: state
            .store
            .list_step_participants(step.id)
            .await
            .map_err(ApiError::internal)?,
        matches: state
            .store
            .list_matches(step.id, None, Some(MatchStatus::Finished))
            .await
            .map_err(ApiError::internal)?,
        match_members: state
            .store
            .list_step_match_participants(step.id)
            .await
            .map_err(ApiError::internal)?,
        registered: active_participants(state, tournament_id)
            .await?
            .into_iter()
            .map(|p: TournamentParticipant| (p.id, p.registered_at))
            .collect(),
    })
}

/// Participants du groupe dans l'ordre du classement, avec `true` pour une égalité de rang.
fn ordered_group(step: &Step, group: &StepGroup, data: &RankingData) -> Vec<(Uuid, bool)> {
    let members: Vec<&StepParticipant> = data
        .members
        .iter()
        .filter(|m| m.group_id == group.id)
        .collect();
    let matches: Vec<&Match> = data
        .matches
        .iter()
        .filter(|m| m.group_id == Some(group.id))
        .collect();
    let by_match = group_by_match(&data.match_members);
    rank_group(step, &members, &matches, &by_match, &data.registered)
}

/// Rang définitif d'un groupe à la clôture : points, critères de départage puis ordre
/// d'inscription, sans égalité. Les `advance_per_group` premiers sont qualifiés.
fn close_group(step: &Step, group: &StepGroup, data: &RankingData) -> Vec<StepOutcome> {
    ordered_group(step, group, data)
        .into_iter()
        .zip(1i32..)
        .map(|((participant_id, _), rank)| StepOutcome {
            participant_id,
            final_rank: rank,
            status: if rank <= step.advance_per_group {
                StepParticipantStatus::Qualified
            } else {
                StepParticipantStatus::Eliminated
            },
        })
        .collect()
}

/// Classement d'un groupe : celui enregistré une fois l'étape clôturée, sinon points et départages
/// avec des égalités qui partagent le même rang.
fn live_ranking(step: &Step, group: &StepGroup, data: &RankingData) -> Vec<RankedParticipant> {
    let finished = step.status == StepStatus::Finished;
    let member_of = |id: Uuid| data.members.iter().find(|m| m.participant_id == id);
    let mut ranked: Vec<RankedParticipant> = Vec::new();
    if finished {
        let mut members: Vec<&StepParticipant> = data
            .members
            .iter()
            .filter(|m| m.group_id == group.id)
            .collect();
        members.sort_by(|a, b| {
            a.final_rank
                .cmp(&b.final_rank)
                .then_with(|| a.participant_id.cmp(&b.participant_id))
        });
        for member in members {
            ranked.push(RankedParticipant {
                participant_id: member.participant_id,
                points: member.points,
                rank: member.final_rank.unwrap_or(0),
                status: member.status,
                seed: member.seed,
            });
        }
        return ranked;
    }
    for (index, (id, tied)) in ordered_group(step, group, data).into_iter().enumerate() {
        let Some(member) = member_of(id) else {
            continue;
        };
        let rank = match ranked.last() {
            Some(previous) if tied => previous.rank,
            _ => i32::try_from(index + 1).unwrap_or(i32::MAX),
        };
        ranked.push(RankedParticipant {
            participant_id: id,
            points: member.points,
            rank,
            status: member.status,
            seed: member.seed,
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
            rules: StepRules::default(),
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
            seed: None,
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
    fn the_start_deals_every_participant_once_in_balanced_groups() {
        let ids: Vec<Uuid> = (0..10).map(|_| Uuid::new_v4()).collect();
        let start = start_of(&step(1, 3, 4, 2), shuffled(ids.clone()));
        let mut sizes: Vec<usize> = start.groups.iter().map(Vec::len).collect();
        sizes.sort_unstable();
        assert_eq!(sizes, [3, 3, 4]);
        let mut dealt: Vec<Uuid> = start.groups.into_iter().flatten().collect();
        dealt.sort();
        let mut expected = ids;
        expected.sort();
        assert_eq!(dealt, expected);
        assert_eq!(start.seeds.len(), 10);
    }

    fn data(
        group: &StepGroup,
        members: Vec<StepParticipant>,
        registered: &[(Uuid, &str)],
    ) -> RankingData {
        RankingData {
            groups: vec![group.clone()],
            members,
            matches: Vec::new(),
            match_members: Vec::new(),
            registered: registered
                .iter()
                .map(|(id, at)| (*id, (*at).to_string()))
                .collect(),
        }
    }

    fn group() -> StepGroup {
        StepGroup {
            id: Uuid::nil(),
            step_id: Uuid::nil(),
            index: 1,
        }
    }

    #[test]
    fn closing_a_group_ranks_by_points_then_registration_order() {
        let (a, b, c, d) = (member(5.0), member(9.0), member(5.0), member(1.0));
        let registered = [
            (a.participant_id, "2026-01-02"),
            (b.participant_id, "2026-01-03"),
            (c.participant_id, "2026-01-01"),
            (d.participant_id, "2026-01-04"),
        ];
        let ids = [
            a.participant_id,
            b.participant_id,
            c.participant_id,
            d.participant_id,
        ];
        let data = data(&group(), vec![a, b, c, d], &registered);
        let outcomes = close_group(&step(1, 1, 4, 2), &group(), &data);
        let order: Vec<Uuid> = outcomes.iter().map(|o| o.participant_id).collect();
        assert_eq!(order, [ids[1], ids[2], ids[0], ids[3]]);
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
        let data = data(&group(), vec![a, b, c], &[]);
        let ranks: Vec<i32> = live_ranking(&step(1, 1, 4, 2), &group(), &data)
            .iter()
            .map(|r| r.rank)
            .collect();
        assert_eq!(ranks, [1, 2, 2]);
    }

    fn entrant(group_index: i32, rank: i32, points: f64) -> Entrant {
        Entrant {
            id: Uuid::new_v4(),
            group_index,
            rank,
            points,
        }
    }

    #[test]
    fn qualifiers_follow_the_configured_placement() {
        let entrants = vec![
            entrant(1, 1, 10.0),
            entrant(2, 1, 12.0),
            entrant(1, 2, 8.0),
            entrant(2, 2, 9.0),
        ];
        let ids: Vec<Uuid> = entrants.iter().map(|e| e.id).collect();
        // Rang puis points : le meilleur de chaque groupe, du plus fort au plus faible.
        assert_eq!(
            qualifier_order(
                entrants.clone(),
                QualificationPlacement::Rank,
                SeedingStrategy::Random
            ),
            [ids[1], ids[0], ids[3], ids[2]]
        );
        // Rang puis groupe : A1, B1, A2, B2.
        assert_eq!(
            qualifier_order(
                entrants.clone(),
                QualificationPlacement::GroupRank,
                SeedingStrategy::Random
            ),
            [ids[0], ids[1], ids[2], ids[3]]
        );
        // Un seeding par classement suit le rang même sans placement configuré.
        assert_eq!(
            qualifier_order(
                entrants.clone(),
                QualificationPlacement::Random,
                SeedingStrategy::Ranking
            ),
            [ids[1], ids[0], ids[3], ids[2]]
        );
        let mut shuffled_ids = qualifier_order(
            entrants,
            QualificationPlacement::Random,
            SeedingStrategy::Random,
        );
        shuffled_ids.sort();
        let mut expected = ids;
        expected.sort();
        assert_eq!(shuffled_ids, expected);
    }

    #[test]
    fn a_manual_seed_order_must_list_everyone_once() {
        let ids: Vec<Uuid> = (0..3).map(|_| Uuid::new_v4()).collect();
        let reversed: Vec<Uuid> = ids.iter().rev().copied().collect();
        assert_eq!(
            manual_order(&ids, Some(reversed.clone())).unwrap(),
            reversed
        );
        assert!(manual_order(&ids, None).is_err());
        assert!(manual_order(&ids, Some(ids[..2].to_vec())).is_err());
        assert!(manual_order(&ids, Some(vec![ids[0], ids[0], ids[1]])).is_err());
    }

    #[test]
    fn a_ranking_seed_needs_reliable_points() {
        let ids: Vec<Uuid> = (0..3).map(|_| Uuid::new_v4()).collect();
        let flat: HashMap<Uuid, f64> = ids.iter().map(|id| (*id, 0.0)).collect();
        assert!(ranking_order(ids.clone(), &flat).is_err());
        let spread: HashMap<Uuid, f64> = ids
            .iter()
            .zip([1.0, 3.0, 2.0])
            .map(|(i, p)| (*i, p))
            .collect();
        assert_eq!(
            ranking_order(ids.clone(), &spread).unwrap(),
            [ids[1], ids[2], ids[0]]
        );
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
            rules: StepRules::default(),
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
