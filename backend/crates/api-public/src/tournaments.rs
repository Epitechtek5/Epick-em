//! Tournois : CRUD (administrateur), barème, inscriptions solo / équipe, check-in, changements
//! de statut et classements.
//!
//! Toutes ces routes exigent un jeton d'accès (`guard::route_policy`) ; la consultation sans jeton
//! passe par `/public/...` ([`crate::public_api`]). La consultation est ouverte à tout compte,
//! sauf pour un tournoi `invitation_only`, introuvable pour qui n'y a aucun lien. La création est
//! réservée aux administrateurs globaux ; la modification, le barème et les changements de
//! statut le sont au propriétaire et aux administrateurs du tournoi
//! ([`tournament_access`](crate::tournament_access)). Un joueur s'inscrit, se désinscrit
//! et pointe lui-même (le propriétaire de l'équipe le fait pour une équipe).
//!
//! Le barème et les paramètres de capacité sont verrouillés dès que le tournoi est `ongoing`.

use crate::auth::{AppState, Claims};
use crate::error::{ApiError, ErrorResponse};
use crate::events::{EventKind, TournamentEvent};
use crate::ranking::{rank, team_points};
use crate::store::{
    ParticipantInput, ParticipantStatus, ParticipantType, ScoringMode, ScoringRule,
    ScoringRuleDefinition, ScoringRuleInput, StoreError, TeamRole, TeamScoringMode, Tournament,
    TournamentInput, TournamentParticipant, TournamentSettings, TournamentStatus, TournamentUpdate,
    now_rfc3339,
};
use crate::team_io::normalize_timestamp;
use crate::teams::Pagination;
use crate::tournament_access::{access_of, require_manage, require_owner, require_visible};
use crate::tournament_settings::{
    SettingsRequest, UpdateSettingsRequest, check_settings, legacy_team_size_errors,
    validate_responses,
};
use crate::users::require_admin;
use actix_web::{HttpResponse, delete, get, patch, post, web};
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use utoipa::{IntoParams, ToSchema};
use utoipa_actix_web::service_config::ServiceConfig;
use uuid::Uuid;

const NAME_MAX: usize = 128;
const DESCRIPTION_MAX: usize = 4000;
const MAX_PARTICIPANTS_LIMIT: i32 = 10_000;
const TEAM_SCORING_LIMIT: i32 = 100;

/// Routes des tournois, avec leur documentation OpenAPI.
pub fn routes(cfg: &mut ServiceConfig) {
    // `/tournaments/export` et `/tournaments/import` avant `/tournaments/{id}`.
    cfg.service(crate::tournament_io::export_tournaments)
        .service(crate::tournament_io::import_tournaments)
        .service(list_tournaments)
        .service(get_tournament)
        .service(create_tournament)
        .service(update_tournament)
        .service(delete_tournament)
        .service(set_status)
        .service(approve_participant)
        .service(reject_participant)
        .service(promote_waiting_list)
        .service(close_check_in)
        .service(list_scoring_rules)
        .service(create_scoring_rule)
        .service(update_scoring_rule)
        .service(delete_scoring_rule)
        .service(list_participants)
        .service(register)
        .service(update_participant)
        .service(remove_participant)
        .service(check_in)
        .service(player_ranking)
        .service(team_ranking);
}

/// Distingue un champ absent (`None`) d'un champ à `null` (`Some(None)`).
pub(crate) fn nullable<'de, T, D>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    T: Deserialize<'de>,
    D: Deserializer<'de>,
{
    Option::<T>::deserialize(deserializer).map(Some)
}

#[derive(Deserialize, ToSchema)]
struct CreateTournamentRequest {
    /// Jeu du tournoi.
    game_id: Uuid,
    #[schema(min_length = 1, max_length = 128, example = "TFT Open")]
    name: String,
    description: Option<String>,
    /// Horodatages RFC 3339 en UTC (suffixe `Z`).
    #[schema(example = "2026-11-14T18:00:00Z")]
    start_date: String,
    #[schema(example = "2026-11-15T22:00:00Z")]
    end_date: String,
    registration_open_at: Option<String>,
    registration_close_at: Option<String>,
    participant_type: ParticipantType,
    /// Nombre maximum d'inscrits (joueurs en `solo`, équipes en `team`).
    #[schema(minimum = 1, maximum = 10000, example = 32)]
    max_participants: i32,
    /// `none` par défaut.
    team_scoring_mode: Option<TeamScoringMode>,
    /// Nombre de meilleurs scores retenus : obligatoire avec `top_n`, interdit sinon.
    team_scoring_n: Option<i32>,
    /// Configuration : mode, lieu, visibilité, règles, titulaires et remplaçants par équipe,
    /// inscriptions, pointage.
    #[serde(flatten)]
    settings: SettingsRequest,
}

/// Champs modifiables, tous facultatifs ; `null` efface une valeur facultative. Le type de
/// participant ne se change pas.
#[derive(Deserialize, ToSchema)]
struct UpdateTournamentRequest {
    #[schema(min_length = 1, max_length = 128)]
    name: Option<String>,
    #[serde(default, deserialize_with = "nullable")]
    #[schema(value_type = Option<String>)]
    description: Option<Option<String>>,
    start_date: Option<String>,
    end_date: Option<String>,
    #[serde(default, deserialize_with = "nullable")]
    #[schema(value_type = Option<String>)]
    registration_open_at: Option<Option<String>>,
    #[serde(default, deserialize_with = "nullable")]
    #[schema(value_type = Option<String>)]
    registration_close_at: Option<Option<String>>,
    max_participants: Option<i32>,
    team_scoring_mode: Option<TeamScoringMode>,
    #[serde(default, deserialize_with = "nullable")]
    #[schema(value_type = Option<i32>)]
    team_scoring_n: Option<Option<i32>>,
    /// Configuration (voir la création). La composition des équipes et le pointage se
    /// verrouillent dès `ongoing`.
    #[serde(flatten)]
    settings: UpdateSettingsRequest,
}

#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
struct TournamentsQuery {
    /// Ne renvoie que les tournois de ce jeu.
    game_id: Option<Uuid>,
    status: Option<TournamentStatus>,
    limit: Option<i64>,
    offset: Option<i64>,
}

#[derive(Deserialize, ToSchema)]
struct StatusRequest {
    status: TournamentStatus,
}

/// Règle de barème : `linear` (`coefficient`) ou `table` (`points_table`).
#[derive(Deserialize, ToSchema)]
struct CreateScoringRuleRequest {
    /// Statistique convertie en points ; elle doit être liée au jeu du tournoi.
    stat_id: Uuid,
    mode: ScoringMode,
    /// Points par unité de la statistique, obligatoire avec `linear`.
    coefficient: Option<f64>,
    /// Objet valeur vers points, obligatoire avec `table`.
    #[schema(value_type = Option<Object>, example = json!({"1": 8, "2": 7}))]
    points_table: Option<Value>,
}

/// Remplace la façon de calculer les points d'une règle (la statistique ne change pas).
#[derive(Deserialize, ToSchema)]
struct UpdateScoringRuleRequest {
    mode: ScoringMode,
    coefficient: Option<f64>,
    #[schema(value_type = Option<Object>)]
    points_table: Option<Value>,
}

/// Inscription : un joueur (`user_id`, l'appelant par défaut), une équipe de tournoi
/// (`tournament_team_id`) ou un joueur qui marque pour son équipe (les deux).
#[derive(Deserialize, ToSchema)]
struct RegisterRequest {
    /// Joueur inscrit ; seul un administrateur peut en désigner un autre que lui. Interdit
    /// pour un tournoi par équipes.
    user_id: Option<Uuid>,
    /// Équipe du tournoi : obligatoire pour un tournoi par équipes, facultative en solo.
    tournament_team_id: Option<Uuid>,
    /// Réponses aux champs d'inscription du tournoi (`registration_fields`), par clé.
    #[schema(value_type = Option<Object>, example = json!({"ingame_name": "Faker"}))]
    responses: Option<Value>,
}

#[derive(Deserialize, ToSchema)]
struct ParticipantStatusRequest {
    status: ParticipantStatus,
}

/// Rang d'un joueur ; les ex æquo partagent le même rang.
#[derive(Serialize, ToSchema)]
pub(crate) struct PlayerRank {
    pub(crate) rank: u32,
    pub(crate) participant_id: Uuid,
    pub(crate) user_id: Uuid,
    /// Équipe pour laquelle le joueur marque, le cas échéant.
    pub(crate) tournament_team_id: Option<Uuid>,
    pub(crate) points: f64,
}

/// Rang d'une équipe ; les ex æquo partagent le même rang.
#[derive(Serialize, ToSchema)]
pub(crate) struct TeamRank {
    pub(crate) rank: u32,
    pub(crate) tournament_team_id: Uuid,
    pub(crate) name: String,
    pub(crate) points: f64,
}

/// Liste des tournois.
#[utoipa::path(
    get,
    path = "/tournaments",
    tag = "tournaments",
    security(("bearer" = [])),
    params(TournamentsQuery),
    responses(
        (status = 200, description = "Tournois, par date de début", body = Vec<Tournament>),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
    ),
)]
#[get("/tournaments")]
async fn list_tournaments(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    query: web::Query<TournamentsQuery>,
) -> Result<HttpResponse, ApiError> {
    let (limit, offset) = Pagination::new(query.limit, query.offset).bounds();
    // Les tournois privés auxquels l'appelant n'a aucun lien n'apparaissent pas : on filtre
    // avant de paginer pour que les pages restent pleines.
    let all = state
        .store
        .list_tournaments(query.game_id, query.status, false, i64::MAX, 0)
        .await
        .map_err(ApiError::internal)?;
    let mut tournaments = Vec::new();
    for tournament in all {
        if require_visible(&state, &claims, &tournament).await.is_ok() {
            tournaments.push(tournament);
        }
    }
    let tournaments: Vec<Tournament> = tournaments
        .into_iter()
        .skip(usize::try_from(offset).unwrap_or(0))
        .take(usize::try_from(limit).unwrap_or(0))
        .collect();
    Ok(HttpResponse::Ok().json(tournaments))
}

/// Détail d'un tournoi.
#[utoipa::path(
    get,
    path = "/tournaments/{id}",
    tag = "tournaments",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Identifiant du tournoi")),
    responses(
        (status = 200, description = "Le tournoi", body = Tournament),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 404, description = "Tournoi introuvable", body = ErrorResponse),
    ),
)]
#[get("/tournaments/{id}")]
async fn get_tournament(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    id: web::Path<Uuid>,
) -> Result<HttpResponse, ApiError> {
    let tournament = visible_tournament(&state, &claims, id.into_inner()).await?;
    Ok(HttpResponse::Ok().json(settle_if_due(&state, tournament).await?))
}

/// Crée un tournoi au statut `draft` (administrateur).
#[utoipa::path(
    post,
    path = "/tournaments",
    tag = "tournaments",
    security(("bearer" = [])),
    request_body = CreateTournamentRequest,
    responses(
        (status = 201, description = "Tournoi créé", body = Tournament),
        (status = 400, description = "Requête invalide ou jeu introuvable", body = ErrorResponse),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 403, description = "Réservé aux administrateurs", body = ErrorResponse),
        (status = 409, description = "Nom déjà pris pour ce jeu", body = ErrorResponse),
    ),
)]
#[post("/tournaments")]
async fn create_tournament(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    body: web::Json<CreateTournamentRequest>,
) -> Result<HttpResponse, ApiError> {
    require_admin(&state, &claims).await?;
    let request = body.into_inner();
    let request_team_size = request.settings.team_size;
    let mut input = TournamentInput {
        game_id: request.game_id,
        name: request.name,
        description: request.description,
        start_date: request.start_date,
        end_date: request.end_date,
        registration_open_at: request.registration_open_at,
        registration_close_at: request.registration_close_at,
        participant_type: request.participant_type,
        max_participants: request.max_participants,
        team_scoring_mode: request.team_scoring_mode.unwrap_or(TeamScoringMode::None),
        team_scoring_n: request.team_scoring_n,
        settings: request.settings.into_settings(request.participant_type),
        // Le créateur devient l'unique propriétaire.
        owner_id: Some(claims.sub),
        is_template: false,
    };
    let mut errors = legacy_team_size_errors(request_team_size, input.participant_type);
    errors.extend(check(&mut input));
    if !errors.is_empty() {
        return Err(ApiError::Validation(errors));
    }
    if state
        .store
        .find_game(input.game_id)
        .await
        .map_err(ApiError::internal)?
        .is_none()
    {
        return Err(ApiError::Validation(vec![(
            "game_id",
            "Jeu introuvable.".to_string(),
        )]));
    }
    let tournament = state
        .store
        .create_tournament(input)
        .await
        .map_err(tournament_error)?;
    Ok(HttpResponse::Created().json(tournament))
}

/// Modifie un tournoi (administrateur). Dès `ongoing`, la capacité et le mode de score
/// d'équipe sont verrouillés.
#[utoipa::path(
    patch,
    path = "/tournaments/{id}",
    tag = "tournaments",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Identifiant du tournoi")),
    request_body = UpdateTournamentRequest,
    responses(
        (status = 200, description = "Tournoi modifié", body = Tournament),
        (status = 400, description = "Requête invalide", body = ErrorResponse),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 403, description = "Réservé aux administrateurs", body = ErrorResponse),
        (status = 404, description = "Tournoi introuvable", body = ErrorResponse),
        (status = 409, description = "Nom déjà pris pour ce jeu, ou paramètres verrouillés parce que le tournoi est en cours", body = ErrorResponse),
    ),
)]
#[patch("/tournaments/{id}")]
async fn update_tournament(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    id: web::Path<Uuid>,
    body: web::Json<UpdateTournamentRequest>,
) -> Result<HttpResponse, ApiError> {
    let current = find_tournament(&state, id.into_inner()).await?;
    require_manage(&state, &claims, &current).await?;
    let request = body.into_inner();
    let locked = matches!(
        current.status,
        TournamentStatus::Ongoing | TournamentStatus::Finished
    );
    let touches_capacity = request.max_participants.is_some()
        || request.team_scoring_mode.is_some()
        || request.team_scoring_n.is_some()
        || request.settings.touches_team_composition();
    if locked && touches_capacity {
        return Err(ApiError::TournamentLocked);
    }
    if request.settings.touches_check_in() && (locked || current.check_in_settled_at.is_some()) {
        return Err(ApiError::TournamentLocked);
    }
    let team_size_given = request.settings.team_size;
    let settings_given = !request.settings.is_empty();
    let merged_settings = request.settings.merge(current.settings.clone());
    let mut merged = TournamentInput {
        game_id: current.game_id,
        name: request.name.clone().unwrap_or(current.name),
        description: request.description.clone().unwrap_or(current.description),
        start_date: request.start_date.clone().unwrap_or(current.start_date),
        end_date: request.end_date.clone().unwrap_or(current.end_date),
        registration_open_at: request
            .registration_open_at
            .clone()
            .unwrap_or(current.registration_open_at),
        registration_close_at: request
            .registration_close_at
            .clone()
            .unwrap_or(current.registration_close_at),
        participant_type: current.participant_type,
        max_participants: request.max_participants.unwrap_or(current.max_participants),
        team_scoring_mode: request
            .team_scoring_mode
            .unwrap_or(current.team_scoring_mode),
        team_scoring_n: request.team_scoring_n.unwrap_or(current.team_scoring_n),
        settings: merged_settings,
        owner_id: current.owner_id,
        is_template: current.is_template,
    };
    let mut errors = legacy_team_size_errors(team_size_given, current.participant_type);
    errors.extend(check(&mut merged));
    if errors.is_empty() && request.max_participants.is_some() {
        let registered = active_participants(&state, current.id).await?.len();
        if usize::try_from(merged.max_participants).unwrap_or(0) < registered {
            errors.push((
                "max_participants",
                format!("{registered} participants sont déjà inscrits."),
            ));
        }
    }
    if errors.is_empty() && settings_given {
        errors.extend(check_team_fit(&state, &current.id, &merged).await?);
    }
    if !errors.is_empty() {
        return Err(ApiError::Validation(errors));
    }
    let update = TournamentUpdate {
        name: request.name.map(|_| merged.name.clone()),
        description: request.description.map(|_| merged.description.clone()),
        start_date: request.start_date.map(|_| merged.start_date.clone()),
        end_date: request.end_date.map(|_| merged.end_date.clone()),
        registration_open_at: request
            .registration_open_at
            .map(|_| merged.registration_open_at.clone()),
        registration_close_at: request
            .registration_close_at
            .map(|_| merged.registration_close_at.clone()),
        max_participants: request.max_participants.map(|_| merged.max_participants),
        team_scoring_mode: request.team_scoring_mode.map(|_| merged.team_scoring_mode),
        team_scoring_n: request.team_scoring_n.map(|_| merged.team_scoring_n),
        settings: settings_given.then(|| merged.settings.clone()),
    };
    let tournament = state
        .store
        .update_tournament(current.id, update)
        .await
        .map_err(tournament_error)?
        .ok_or(ApiError::NotFound)?;
    Ok(HttpResponse::Ok().json(tournament))
}

/// Supprime un tournoi, ses équipes, son barème et ses inscriptions (administrateur). Un
/// tournoi en cours ne se supprime pas.
#[utoipa::path(
    delete,
    path = "/tournaments/{id}",
    tag = "tournaments",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Identifiant du tournoi")),
    responses(
        (status = 204, description = "Tournoi supprimé"),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 403, description = "Réservé aux administrateurs", body = ErrorResponse),
        (status = 404, description = "Tournoi introuvable", body = ErrorResponse),
        (status = 409, description = "Le tournoi est en cours", body = ErrorResponse),
    ),
)]
#[delete("/tournaments/{id}")]
async fn delete_tournament(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    id: web::Path<Uuid>,
) -> Result<HttpResponse, ApiError> {
    let tournament = find_tournament(&state, id.into_inner()).await?;
    require_owner(&state, &claims, &tournament).await?;
    if tournament.status == TournamentStatus::Ongoing {
        return Err(ApiError::TournamentLocked);
    }
    if state
        .store
        .delete_tournament(tournament.id)
        .await
        .map_err(ApiError::internal)?
    {
        Ok(HttpResponse::NoContent().finish())
    } else {
        Err(ApiError::NotFound)
    }
}

/// Change le statut du tournoi (administrateur).
///
/// Transitions : `draft` → `registration`, `registration` → `ongoing`, `ongoing` →
/// `finished`, et `draft`, `registration` ou `ongoing` → `cancelled`. Le passage en `ongoing`
/// exige au moins deux inscrits actifs (ni `withdrawn` ni `disqualified`) et, pour un tournoi
/// par équipes, un nombre de titulaires entre `team_min_starters` et `team_max_starters` (et pas
/// plus de `team_max_substitutes` remplaçants) dans chaque équipe inscrite. La clôture du
/// pointage est alors traitée (absents marqués, liste d'attente promue). Le
/// chaînage des étapes, s'il y en a, doit être valide (voir `POST /tournaments/{id}/steps`).
#[utoipa::path(
    post,
    path = "/tournaments/{id}/status",
    tag = "tournaments",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Identifiant du tournoi")),
    request_body = StatusRequest,
    responses(
        (status = 200, description = "Tournoi au nouveau statut", body = Tournament),
        (status = 400, description = "Conditions du passage en cours non remplies", body = ErrorResponse),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 403, description = "Réservé aux administrateurs", body = ErrorResponse),
        (status = 404, description = "Tournoi introuvable", body = ErrorResponse),
        (status = 409, description = "Transition impossible depuis le statut actuel", body = ErrorResponse),
    ),
)]
#[post("/tournaments/{id}/status")]
async fn set_status(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    id: web::Path<Uuid>,
    body: web::Json<StatusRequest>,
) -> Result<HttpResponse, ApiError> {
    let tournament = find_tournament(&state, id.into_inner()).await?;
    require_manage(&state, &claims, &tournament).await?;
    let target = body.status;
    if tournament.is_template || !transition_allowed(tournament.status, target) {
        return Err(ApiError::InvalidTransition);
    }
    // Les absents du pointage sont marqués avant de compter les inscrits.
    let tournament = settle_if_due(&state, tournament).await?;
    if target == TournamentStatus::Ongoing {
        let problems = start_problems(&state, &tournament).await?;
        if !problems.is_empty() {
            return Err(ApiError::Validation(vec![("status", problems.join(" "))]));
        }
    }
    let tournament = state
        .store
        .set_tournament_status(tournament.id, target)
        .await
        .map_err(ApiError::internal)?
        .ok_or(ApiError::NotFound)?;
    Ok(HttpResponse::Ok().json(tournament))
}

/// Barème du tournoi, par statistique.
#[utoipa::path(
    get,
    path = "/tournaments/{id}/scoring-rules",
    tag = "tournaments",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Identifiant du tournoi")),
    responses(
        (status = 200, description = "Règles du barème", body = Vec<ScoringRule>),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 404, description = "Tournoi introuvable", body = ErrorResponse),
    ),
)]
#[get("/tournaments/{id}/scoring-rules")]
async fn list_scoring_rules(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    id: web::Path<Uuid>,
) -> Result<HttpResponse, ApiError> {
    let tournament = visible_tournament(&state, &claims, id.into_inner()).await?;
    let rules = state
        .store
        .list_scoring_rules(tournament.id)
        .await
        .map_err(ApiError::internal)?;
    Ok(HttpResponse::Ok().json(rules))
}

/// Ajoute une règle au barème (administrateur). Verrouillé dès `ongoing`.
#[utoipa::path(
    post,
    path = "/tournaments/{id}/scoring-rules",
    tag = "tournaments",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Identifiant du tournoi")),
    request_body = CreateScoringRuleRequest,
    responses(
        (status = 201, description = "Règle ajoutée", body = ScoringRule),
        (status = 400, description = "Requête invalide ou statistique non liée au jeu du tournoi", body = ErrorResponse),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 403, description = "Réservé aux administrateurs", body = ErrorResponse),
        (status = 404, description = "Tournoi introuvable", body = ErrorResponse),
        (status = 409, description = "Statistique déjà dans le barème, ou barème verrouillé", body = ErrorResponse),
    ),
)]
#[post("/tournaments/{id}/scoring-rules")]
async fn create_scoring_rule(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    id: web::Path<Uuid>,
    body: web::Json<CreateScoringRuleRequest>,
) -> Result<HttpResponse, ApiError> {
    let tournament = find_tournament(&state, id.into_inner()).await?;
    require_manage(&state, &claims, &tournament).await?;
    require_scoring_editable(&tournament)?;
    let CreateScoringRuleRequest {
        stat_id,
        mode,
        coefficient,
        points_table,
    } = body.into_inner();
    let definition = definition(mode, coefficient, points_table)?;
    let rule = state
        .store
        .create_scoring_rule(ScoringRuleInput {
            tournament_id: tournament.id,
            stat_id,
            definition,
        })
        .await
        .map_err(tournament_error)?
        .ok_or_else(|| {
            ApiError::Validation(vec![(
                "stat_id",
                "Statistique introuvable ou non liée au jeu du tournoi.".to_string(),
            )])
        })?;
    Ok(HttpResponse::Created().json(rule))
}

/// Remplace le calcul des points d'une règle (administrateur). Verrouillé dès `ongoing`.
#[utoipa::path(
    patch,
    path = "/tournaments/{id}/scoring-rules/{rule_id}",
    tag = "tournaments",
    security(("bearer" = [])),
    params(
        ("id" = Uuid, Path, description = "Identifiant du tournoi"),
        ("rule_id" = Uuid, Path, description = "Identifiant de la règle"),
    ),
    request_body = UpdateScoringRuleRequest,
    responses(
        (status = 200, description = "Règle modifiée", body = ScoringRule),
        (status = 400, description = "Requête invalide", body = ErrorResponse),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 403, description = "Réservé aux administrateurs", body = ErrorResponse),
        (status = 404, description = "Tournoi ou règle introuvable", body = ErrorResponse),
        (status = 409, description = "Barème verrouillé", body = ErrorResponse),
    ),
)]
#[patch("/tournaments/{id}/scoring-rules/{rule_id}")]
async fn update_scoring_rule(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    path: web::Path<(Uuid, Uuid)>,
    body: web::Json<UpdateScoringRuleRequest>,
) -> Result<HttpResponse, ApiError> {
    let (tournament_id, rule_id) = path.into_inner();
    let tournament = find_tournament(&state, tournament_id).await?;
    require_manage(&state, &claims, &tournament).await?;
    let rule = find_rule(&state, tournament.id, rule_id).await?;
    require_scoring_editable(&tournament)?;
    let UpdateScoringRuleRequest {
        mode,
        coefficient,
        points_table,
    } = body.into_inner();
    let rule = state
        .store
        .replace_scoring_rule(rule.id, definition(mode, coefficient, points_table)?)
        .await
        .map_err(ApiError::internal)?
        .ok_or(ApiError::NotFound)?;
    Ok(HttpResponse::Ok().json(rule))
}

/// Retire une règle du barème (administrateur). Verrouillé dès `ongoing`.
#[utoipa::path(
    delete,
    path = "/tournaments/{id}/scoring-rules/{rule_id}",
    tag = "tournaments",
    security(("bearer" = [])),
    params(
        ("id" = Uuid, Path, description = "Identifiant du tournoi"),
        ("rule_id" = Uuid, Path, description = "Identifiant de la règle"),
    ),
    responses(
        (status = 204, description = "Règle retirée"),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 403, description = "Réservé aux administrateurs", body = ErrorResponse),
        (status = 404, description = "Tournoi ou règle introuvable", body = ErrorResponse),
        (status = 409, description = "Barème verrouillé", body = ErrorResponse),
    ),
)]
#[delete("/tournaments/{id}/scoring-rules/{rule_id}")]
async fn delete_scoring_rule(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    path: web::Path<(Uuid, Uuid)>,
) -> Result<HttpResponse, ApiError> {
    let (tournament_id, rule_id) = path.into_inner();
    let tournament = find_tournament(&state, tournament_id).await?;
    require_manage(&state, &claims, &tournament).await?;
    let rule = find_rule(&state, tournament.id, rule_id).await?;
    require_scoring_editable(&tournament)?;
    if state
        .store
        .delete_scoring_rule(rule.id)
        .await
        .map_err(ApiError::internal)?
    {
        Ok(HttpResponse::NoContent().finish())
    } else {
        Err(ApiError::NotFound)
    }
}

/// Inscrits du tournoi, par date d'inscription.
#[utoipa::path(
    get,
    path = "/tournaments/{id}/participants",
    tag = "tournaments",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Identifiant du tournoi"), Pagination),
    responses(
        (status = 200, description = "Inscrits", body = Vec<TournamentParticipant>),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 404, description = "Tournoi introuvable", body = ErrorResponse),
    ),
)]
#[get("/tournaments/{id}/participants")]
async fn list_participants(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    id: web::Path<Uuid>,
    page: web::Query<Pagination>,
) -> Result<HttpResponse, ApiError> {
    let tournament = visible_tournament(&state, &claims, id.into_inner()).await?;
    let access = access_of(&state, &claims, &tournament).await?;
    let tournament = settle_if_due(&state, tournament).await?;
    let (limit, offset) = page.bounds();
    let mut participants = state
        .store
        .list_participants(tournament.id, limit, offset)
        .await
        .map_err(ApiError::internal)?;
    // Les réponses aux champs d'inscription ne sont lisibles que par l'équipe organisatrice
    // et par l'inscrit lui-même.
    if !access.can_referee() {
        for participant in &mut participants {
            if participant.user_id != Some(claims.sub) {
                participant.responses = crate::store::no_responses();
            }
        }
    }
    Ok(HttpResponse::Ok().json(participants))
}

/// Inscrit un joueur ou une équipe.
///
/// Le tournoi doit être au statut `registration`, dans sa fenêtre d'inscription. En solo, le
/// joueur s'inscrit seul, ou pour une équipe du tournoi dont il est membre. Dans un tournoi
/// par équipes, le propriétaire inscrit son équipe, dont le nombre de titulaires doit être
/// compris entre `team_min_starters` et `team_max_starters` et le nombre de remplaçants ne pas
/// dépasser `team_max_substitutes`.
///
/// Le statut initial vaut `pending` si les inscriptions sont soumises à approbation
/// (`registration_policy` = `approval_required`), `registered` sinon, ou `waitlisted` quand la
/// capacité est atteinte et que la liste d'attente est activée ; sans liste d'attente, une
/// inscription au-delà de la capacité est refusée (409). Les `responses` sont validées contre
/// les `registration_fields` du tournoi.
#[utoipa::path(
    post,
    path = "/tournaments/{id}/participants",
    tag = "tournaments",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Identifiant du tournoi")),
    request_body = RegisterRequest,
    responses(
        (status = 201, description = "Inscription enregistrée", body = TournamentParticipant),
        (status = 400, description = "Requête incohérente avec le type du tournoi, équipe invalide ou compte introuvable", body = ErrorResponse),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 403, description = "Inscrire un autre joueur ou une équipe d'autrui", body = ErrorResponse),
        (status = 404, description = "Tournoi introuvable", body = ErrorResponse),
        (status = 409, description = "Inscriptions fermées, déjà inscrit ou tournoi complet", body = ErrorResponse),
    ),
)]
#[post("/tournaments/{id}/participants")]
async fn register(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    id: web::Path<Uuid>,
    body: web::Json<RegisterRequest>,
) -> Result<HttpResponse, ApiError> {
    let tournament = visible_tournament(&state, &claims, id.into_inner()).await?;
    let RegisterRequest {
        user_id,
        tournament_team_id,
        responses,
    } = body.into_inner();
    let responses = validate_responses(&tournament.settings.registration_fields, responses)
        .map_err(ApiError::Validation)?;
    // Un organisateur inscrit n'importe qui ; les autres ne s'inscrivent que pour eux.
    let admin = access_of(&state, &claims, &tournament).await?.can_manage();
    let input = match tournament.participant_type {
        ParticipantType::Solo => {
            let user_id = user_id.unwrap_or(claims.sub);
            if user_id != claims.sub && !admin {
                return Err(ApiError::Forbidden);
            }
            if state
                .store
                .find_user_by_id(user_id)
                .await
                .map_err(ApiError::internal)?
                .is_none()
            {
                return Err(ApiError::Validation(vec![(
                    "user_id",
                    "Compte introuvable.".to_string(),
                )]));
            }
            if let Some(team_id) = tournament_team_id {
                let team = find_team_of(&state, &tournament, team_id).await?;
                let members = state
                    .store
                    .list_tournament_team_members(team.id)
                    .await
                    .map_err(ApiError::internal)?
                    .unwrap_or_default();
                if !members.iter().any(|member| member.user_id == user_id) {
                    return Err(ApiError::Validation(vec![(
                        "tournament_team_id",
                        "Le joueur n'est pas membre de cette équipe.".to_string(),
                    )]));
                }
            }
            ParticipantInput {
                tournament_id: tournament.id,
                user_id: Some(user_id),
                tournament_team_id,
                responses,
            }
        }
        ParticipantType::Team => {
            if user_id.is_some() {
                return Err(ApiError::Validation(vec![(
                    "user_id",
                    "Un tournoi par équipes inscrit des équipes, pas des joueurs.".to_string(),
                )]));
            }
            let team_id = tournament_team_id.ok_or_else(|| {
                ApiError::Validation(vec![(
                    "tournament_team_id",
                    "L'équipe est obligatoire dans un tournoi par équipes.".to_string(),
                )])
            })?;
            let team = find_team_of(&state, &tournament, team_id).await?;
            if team.owner_id != claims.sub && !admin {
                return Err(ApiError::Forbidden);
            }
            let problems = team_composition_problems(&state, &tournament, team.id).await?;
            if !problems.is_empty() {
                return Err(ApiError::Validation(vec![(
                    "tournament_team_id",
                    problems.join(" "),
                )]));
            }
            ParticipantInput {
                tournament_id: tournament.id,
                user_id: None,
                tournament_team_id: Some(team.id),
                responses,
            }
        }
    };
    require_registration_open(&tournament)?;
    let participant = state
        .store
        .add_participant(input)
        .await
        .map_err(tournament_error)?
        .ok_or(ApiError::NotFound)?;
    let kind = match participant.status {
        ParticipantStatus::Pending => EventKind::PendingApproval,
        ParticipantStatus::Waitlisted => EventKind::Waitlisted,
        _ => EventKind::Registered,
    };
    emit(&state, kind, &participant);
    Ok(HttpResponse::Created().json(participant))
}

/// Change le statut d'un inscrit. Un administrateur fixe n'importe quel statut (disqualification,
/// correction) ; l'inscrit ou le propriétaire de son équipe peut seulement se retirer
/// (`withdrawn`).
#[utoipa::path(
    patch,
    path = "/tournaments/{id}/participants/{participant_id}",
    tag = "tournaments",
    security(("bearer" = [])),
    params(
        ("id" = Uuid, Path, description = "Identifiant du tournoi"),
        ("participant_id" = Uuid, Path, description = "Identifiant de l'inscription"),
    ),
    request_body = ParticipantStatusRequest,
    responses(
        (status = 200, description = "Inscription modifiée", body = TournamentParticipant),
        (status = 400, description = "Requête invalide", body = ErrorResponse),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 403, description = "Réservé à l'administrateur, ou à l'inscrit pour se retirer", body = ErrorResponse),
        (status = 404, description = "Tournoi ou inscription introuvable", body = ErrorResponse),
    ),
)]
#[patch("/tournaments/{id}/participants/{participant_id}")]
async fn update_participant(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    path: web::Path<(Uuid, Uuid)>,
    body: web::Json<ParticipantStatusRequest>,
) -> Result<HttpResponse, ApiError> {
    let (tournament_id, participant_id) = path.into_inner();
    let tournament = visible_tournament(&state, &claims, tournament_id).await?;
    let participant = find_participant(&state, tournament.id, participant_id).await?;
    let status = body.status;
    if !access_of(&state, &claims, &tournament).await?.can_manage() {
        if status != ParticipantStatus::Withdrawn {
            return Err(ApiError::Forbidden);
        }
        require_actor(&state, &claims, &participant).await?;
    }
    let participant = state
        .store
        .set_participant_status(participant.id, status)
        .await
        .map_err(ApiError::internal)?
        .ok_or(ApiError::NotFound)?;
    release_seat(&state, &tournament, &participant).await?;
    Ok(HttpResponse::Ok().json(participant))
}

/// Retire une inscription (l'inscrit, le propriétaire de son équipe ou un administrateur).
/// Impossible une fois le tournoi `ongoing` : l'inscrit se retire alors avec le statut
/// `withdrawn`.
#[utoipa::path(
    delete,
    path = "/tournaments/{id}/participants/{participant_id}",
    tag = "tournaments",
    security(("bearer" = [])),
    params(
        ("id" = Uuid, Path, description = "Identifiant du tournoi"),
        ("participant_id" = Uuid, Path, description = "Identifiant de l'inscription"),
    ),
    responses(
        (status = 204, description = "Inscription retirée"),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 403, description = "Réservé à l'inscrit, au propriétaire de son équipe ou à un administrateur", body = ErrorResponse),
        (status = 404, description = "Tournoi ou inscription introuvable", body = ErrorResponse),
        (status = 409, description = "Le tournoi est en cours ou terminé", body = ErrorResponse),
    ),
)]
#[delete("/tournaments/{id}/participants/{participant_id}")]
async fn remove_participant(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    path: web::Path<(Uuid, Uuid)>,
) -> Result<HttpResponse, ApiError> {
    let (tournament_id, participant_id) = path.into_inner();
    let tournament = visible_tournament(&state, &claims, tournament_id).await?;
    let participant = find_participant(&state, tournament.id, participant_id).await?;
    if !access_of(&state, &claims, &tournament).await?.can_manage() {
        require_actor(&state, &claims, &participant).await?;
    }
    if !matches!(
        tournament.status,
        TournamentStatus::Draft | TournamentStatus::Registration
    ) {
        return Err(ApiError::TournamentLocked);
    }
    if state
        .store
        .delete_participant(participant.id)
        .await
        .map_err(ApiError::internal)?
    {
        release_seat(&state, &tournament, &participant).await?;
        Ok(HttpResponse::NoContent().finish())
    } else {
        Err(ApiError::NotFound)
    }
}

/// Pointe un inscrit (l'inscrit, le propriétaire de son équipe, un arbitre ou un administrateur),
/// tant que le tournoi est au statut `registration` et dans la fenêtre de pointage
/// (`check_in_open_at` / `check_in_close_at`, appliquée côté serveur). Sans effet s'il est déjà
/// pointé ; seuls les inscrits au statut `registered` peuvent pointer.
#[utoipa::path(
    post,
    path = "/tournaments/{id}/participants/{participant_id}/check-in",
    tag = "tournaments",
    security(("bearer" = [])),
    params(
        ("id" = Uuid, Path, description = "Identifiant du tournoi"),
        ("participant_id" = Uuid, Path, description = "Identifiant de l'inscription"),
    ),
    responses(
        (status = 200, description = "Inscrit pointé (`checked_in`)", body = TournamentParticipant),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 403, description = "Réservé à l'inscrit, au propriétaire de son équipe ou à un administrateur", body = ErrorResponse),
        (status = 404, description = "Tournoi ou inscription introuvable", body = ErrorResponse),
        (status = 409, description = "Inscriptions fermées, ou inscrit retiré ou disqualifié", body = ErrorResponse),
    ),
)]
#[post("/tournaments/{id}/participants/{participant_id}/check-in")]
async fn check_in(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    path: web::Path<(Uuid, Uuid)>,
) -> Result<HttpResponse, ApiError> {
    let (tournament_id, participant_id) = path.into_inner();
    let tournament = visible_tournament(&state, &claims, tournament_id).await?;
    let tournament = settle_if_due(&state, tournament).await?;
    let participant = find_participant(&state, tournament.id, participant_id).await?;
    let access = access_of(&state, &claims, &tournament).await?;
    if !access.can_referee() {
        require_actor(&state, &claims, &participant).await?;
    }
    if tournament.status != TournamentStatus::Registration {
        return Err(ApiError::RegistrationClosed);
    }
    require_check_in_window(&tournament)?;
    match participant.status {
        ParticipantStatus::CheckedIn => return Ok(HttpResponse::Ok().json(participant)),
        ParticipantStatus::Registered => {}
        _ => return Err(ApiError::InvalidTransition),
    }
    let participant = state
        .store
        .set_participant_status(participant.id, ParticipantStatus::CheckedIn)
        .await
        .map_err(ApiError::internal)?
        .ok_or(ApiError::NotFound)?;
    emit(&state, EventKind::CheckedIn, &participant);
    Ok(HttpResponse::Ok().json(participant))
}

/// Classement des joueurs (tournoi solo), par points décroissants. Le gagnant est le premier
/// rang. Les inscrits retirés ou disqualifiés n'y figurent pas ; un tournoi par équipes n'a
/// pas de classement de joueurs. Les points viennent des résultats des étapes (#52) : tant
/// qu'aucun n'est enregistré, tous les joueurs sont à 0.
#[utoipa::path(
    get,
    path = "/tournaments/{id}/ranking",
    tag = "tournaments",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Identifiant du tournoi")),
    responses(
        (status = 200, description = "Classement des joueurs", body = Vec<PlayerRank>),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 404, description = "Tournoi introuvable", body = ErrorResponse),
    ),
)]
#[get("/tournaments/{id}/ranking")]
async fn player_ranking(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    id: web::Path<Uuid>,
) -> Result<HttpResponse, ApiError> {
    let tournament = visible_tournament(&state, &claims, id.into_inner()).await?;
    Ok(HttpResponse::Ok().json(player_ranks(&state, &tournament).await?))
}

/// Classement des joueurs d'un tournoi solo (route publique comprise).
pub(crate) async fn player_ranks(
    state: &AppState,
    tournament: &Tournament,
) -> Result<Vec<PlayerRank>, ApiError> {
    if tournament.participant_type != ParticipantType::Solo {
        return Ok(Vec::new());
    }
    let points = state
        .store
        .participant_points(tournament.id)
        .await
        .map_err(ApiError::internal)?;
    let entries = active_participants(state, tournament.id)
        .await?
        .into_iter()
        .filter_map(|p| {
            let user_id = p.user_id?;
            let score = points.get(&p.id).copied().unwrap_or(0.0);
            Some(((p.id, user_id, p.tournament_team_id), score))
        })
        .collect();
    let ranking: Vec<PlayerRank> = rank(entries)
        .into_iter()
        .map(
            |(rank, (participant_id, user_id, tournament_team_id), points)| PlayerRank {
                rank,
                participant_id,
                user_id,
                tournament_team_id,
                points,
            },
        )
        .collect();
    Ok(ranking)
}

/// Classement des équipes, par points décroissants. Le gagnant est le premier rang.
///
/// Dans un tournoi par équipes, l'équipe marque ses propres points. En solo, les points des
/// joueurs d'une même équipe sont agrégés selon `team_scoring_mode` (`sum`, `best` ou `top_n`) ;
/// avec `none`, le classement est vide.
#[utoipa::path(
    get,
    path = "/tournaments/{id}/team-ranking",
    tag = "tournaments",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Identifiant du tournoi")),
    responses(
        (status = 200, description = "Classement des équipes", body = Vec<TeamRank>),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 404, description = "Tournoi introuvable", body = ErrorResponse),
    ),
)]
#[get("/tournaments/{id}/team-ranking")]
async fn team_ranking(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    id: web::Path<Uuid>,
) -> Result<HttpResponse, ApiError> {
    let tournament = visible_tournament(&state, &claims, id.into_inner()).await?;
    Ok(HttpResponse::Ok().json(team_ranks(&state, &tournament).await?))
}

/// Classement des équipes d'un tournoi (route publique comprise).
pub(crate) async fn team_ranks(
    state: &AppState,
    tournament: &Tournament,
) -> Result<Vec<TeamRank>, ApiError> {
    let points = state
        .store
        .participant_points(tournament.id)
        .await
        .map_err(ApiError::internal)?;
    let participants = active_participants(state, tournament.id).await?;
    let mut by_team: Vec<(Uuid, f64)> = Vec::new();
    match tournament.participant_type {
        ParticipantType::Team => {
            for p in &participants {
                if let Some(team_id) = p.tournament_team_id {
                    by_team.push((team_id, points.get(&p.id).copied().unwrap_or(0.0)));
                }
            }
        }
        ParticipantType::Solo if tournament.team_scoring_mode != TeamScoringMode::None => {
            let mut members: HashMap<Uuid, Vec<f64>> = HashMap::new();
            for p in &participants {
                if let (Some(_), Some(team_id)) = (p.user_id, p.tournament_team_id) {
                    members
                        .entry(team_id)
                        .or_default()
                        .push(points.get(&p.id).copied().unwrap_or(0.0));
                }
            }
            by_team = members
                .into_iter()
                .map(|(team_id, scores)| {
                    (
                        team_id,
                        team_points(
                            tournament.team_scoring_mode,
                            tournament.team_scoring_n,
                            &scores,
                        ),
                    )
                })
                .collect();
            // Ordre stable entre deux appels, quel que soit l'ordre du `HashMap`.
            by_team.sort_by_key(|(team_id, _)| *team_id);
        }
        ParticipantType::Solo => {}
    }
    let names: HashMap<Uuid, String> = state
        .store
        .list_tournament_teams(tournament.id, i64::MAX, 0)
        .await
        .map_err(ApiError::internal)?
        .into_iter()
        .map(|team| (team.id, team.name))
        .collect();
    let ranking: Vec<TeamRank> = rank(by_team)
        .into_iter()
        .map(|(rank, tournament_team_id, points)| TeamRank {
            rank,
            tournament_team_id,
            name: names.get(&tournament_team_id).cloned().unwrap_or_default(),
            points,
        })
        .collect();
    Ok(ranking)
}

/// Approuve une inscription `pending` (organisateur). L'inscrit devient `registered`, ou
/// `waitlisted` si le tournoi est complet et que la liste d'attente est activée ; sans liste
/// d'attente, le tournoi complet refuse l'approbation (409).
#[utoipa::path(
    post,
    path = "/tournaments/{id}/participants/{participant_id}/approve",
    tag = "tournaments",
    security(("bearer" = [])),
    params(
        ("id" = Uuid, Path, description = "Identifiant du tournoi"),
        ("participant_id" = Uuid, Path, description = "Identifiant de l'inscription"),
    ),
    responses(
        (status = 200, description = "Inscription approuvée", body = TournamentParticipant),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 403, description = "Réservé aux organisateurs du tournoi", body = ErrorResponse),
        (status = 404, description = "Tournoi ou inscription introuvable", body = ErrorResponse),
        (status = 409, description = "Inscription non `pending`, ou tournoi complet", body = ErrorResponse),
    ),
)]
#[post("/tournaments/{id}/participants/{participant_id}/approve")]
async fn approve_participant(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    path: web::Path<(Uuid, Uuid)>,
) -> Result<HttpResponse, ApiError> {
    let (tournament_id, participant_id) = path.into_inner();
    let tournament = find_tournament(&state, tournament_id).await?;
    require_manage(&state, &claims, &tournament).await?;
    let participant = find_participant(&state, tournament.id, participant_id).await?;
    require_registration_phase(&tournament)?;
    let participant = state
        .store
        .approve_participant(participant.id)
        .await
        .map_err(participant_error)?
        .ok_or(ApiError::NotFound)?;
    let kind = if participant.status == ParticipantStatus::Waitlisted {
        EventKind::Waitlisted
    } else {
        EventKind::Approved
    };
    emit(&state, kind, &participant);
    Ok(HttpResponse::Ok().json(participant))
}

/// Refuse une inscription `pending` ou `waitlisted` (organisateur).
#[utoipa::path(
    post,
    path = "/tournaments/{id}/participants/{participant_id}/reject",
    tag = "tournaments",
    security(("bearer" = [])),
    params(
        ("id" = Uuid, Path, description = "Identifiant du tournoi"),
        ("participant_id" = Uuid, Path, description = "Identifiant de l'inscription"),
    ),
    responses(
        (status = 200, description = "Inscription refusée", body = TournamentParticipant),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 403, description = "Réservé aux organisateurs du tournoi", body = ErrorResponse),
        (status = 404, description = "Tournoi ou inscription introuvable", body = ErrorResponse),
        (status = 409, description = "Inscription ni `pending` ni `waitlisted`", body = ErrorResponse),
    ),
)]
#[post("/tournaments/{id}/participants/{participant_id}/reject")]
async fn reject_participant(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    path: web::Path<(Uuid, Uuid)>,
) -> Result<HttpResponse, ApiError> {
    let (tournament_id, participant_id) = path.into_inner();
    let tournament = find_tournament(&state, tournament_id).await?;
    require_manage(&state, &claims, &tournament).await?;
    let participant = find_participant(&state, tournament.id, participant_id).await?;
    require_registration_phase(&tournament)?;
    let participant = state
        .store
        .reject_participant(participant.id)
        .await
        .map_err(participant_error)?
        .ok_or(ApiError::NotFound)?;
    emit(&state, EventKind::Rejected, &participant);
    Ok(HttpResponse::Ok().json(participant))
}

/// Promeut la liste d'attente (organisateur) : les inscrits `waitlisted` passent `registered`,
/// dans l'ordre d'inscription, tant qu'il reste des places. Renvoie les inscrits promus.
#[utoipa::path(
    post,
    path = "/tournaments/{id}/waiting-list/promote",
    tag = "tournaments",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Identifiant du tournoi")),
    responses(
        (status = 200, description = "Inscrits promus, dans l'ordre", body = Vec<TournamentParticipant>),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 403, description = "Réservé aux organisateurs du tournoi", body = ErrorResponse),
        (status = 404, description = "Tournoi introuvable", body = ErrorResponse),
        (status = 409, description = "Le tournoi n'est pas en phase d'inscription", body = ErrorResponse),
    ),
)]
#[post("/tournaments/{id}/waiting-list/promote")]
async fn promote_waiting_list(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    id: web::Path<Uuid>,
) -> Result<HttpResponse, ApiError> {
    let tournament = find_tournament(&state, id.into_inner()).await?;
    require_manage(&state, &claims, &tournament).await?;
    require_registration_phase(&tournament)?;
    Ok(HttpResponse::Ok().json(promote_and_emit(&state, tournament.id).await?))
}

/// Clôture le pointage maintenant (organisateur), sans attendre `check_in_close_at` : les
/// inscrits `registered` qui n'ont pas pointé deviennent `absent`, puis la liste d'attente est
/// promue dans la limite de la capacité. Sans effet si la clôture a déjà été traitée. Renvoie le
/// tournoi.
#[utoipa::path(
    post,
    path = "/tournaments/{id}/check-in/close",
    tag = "tournaments",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Identifiant du tournoi")),
    responses(
        (status = 200, description = "Tournoi, pointage clôturé", body = Tournament),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 403, description = "Réservé aux organisateurs du tournoi", body = ErrorResponse),
        (status = 404, description = "Tournoi introuvable", body = ErrorResponse),
        (status = 409, description = "Le tournoi n'est pas en phase d'inscription", body = ErrorResponse),
    ),
)]
#[post("/tournaments/{id}/check-in/close")]
async fn close_check_in(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    id: web::Path<Uuid>,
) -> Result<HttpResponse, ApiError> {
    let tournament = find_tournament(&state, id.into_inner()).await?;
    require_manage(&state, &claims, &tournament).await?;
    require_registration_phase(&tournament)?;
    if tournament.check_in_settled_at.is_none()
        && let Some(settlement) = state
            .store
            .settle_check_in(tournament.id)
            .await
            .map_err(ApiError::internal)?
    {
        for participant in &settlement.absent {
            emit(&state, EventKind::Absent, participant);
        }
        for participant in &settlement.promoted {
            emit(&state, EventKind::Promoted, participant);
        }
    }
    Ok(HttpResponse::Ok().json(find_tournament(&state, tournament.id).await?))
}

fn require_registration_phase(tournament: &Tournament) -> Result<(), ApiError> {
    if tournament.status == TournamentStatus::Registration {
        Ok(())
    } else {
        Err(ApiError::RegistrationClosed)
    }
}

fn participant_error(err: StoreError) -> ApiError {
    match err {
        StoreError::ParticipantState => ApiError::InvalidParticipantState,
        StoreError::TournamentFull => ApiError::TournamentFull,
        other => ApiError::internal(other),
    }
}

pub(crate) async fn find_tournament(state: &AppState, id: Uuid) -> Result<Tournament, ApiError> {
    state
        .store
        .find_tournament(id)
        .await
        .map_err(ApiError::internal)?
        .ok_or(ApiError::NotFound)
}

async fn find_rule(
    state: &AppState,
    tournament_id: Uuid,
    rule_id: Uuid,
) -> Result<ScoringRule, ApiError> {
    state
        .store
        .find_scoring_rule(rule_id)
        .await
        .map_err(ApiError::internal)?
        .filter(|rule| rule.tournament_id == tournament_id)
        .ok_or(ApiError::NotFound)
}

async fn find_participant(
    state: &AppState,
    tournament_id: Uuid,
    participant_id: Uuid,
) -> Result<TournamentParticipant, ApiError> {
    state
        .store
        .find_participant(participant_id)
        .await
        .map_err(ApiError::internal)?
        .filter(|p| p.tournament_id == tournament_id)
        .ok_or(ApiError::NotFound)
}

/// Équipe de tournoi appartenant bien à ce tournoi ; sinon une erreur de validation.
async fn find_team_of(
    state: &AppState,
    tournament: &Tournament,
    team_id: Uuid,
) -> Result<crate::store::TournamentTeam, ApiError> {
    state
        .store
        .find_tournament_team(team_id)
        .await
        .map_err(ApiError::internal)?
        .filter(|team| team.tournament_id == tournament.id)
        .ok_or_else(|| {
            ApiError::Validation(vec![(
                "tournament_team_id",
                "Équipe introuvable dans ce tournoi.".to_string(),
            )])
        })
}

/// Titulaires (propriétaire et membres) et remplaçants d'une équipe de tournoi.
async fn team_counts(state: &AppState, team_id: Uuid) -> Result<(usize, usize), ApiError> {
    let members = state
        .store
        .list_tournament_team_members(team_id)
        .await
        .map_err(ApiError::internal)?
        .unwrap_or_default();
    let substitutes = members
        .iter()
        .filter(|member| member.role == TeamRole::Substitute)
        .count();
    Ok((members.len() - substitutes, substitutes))
}

/// Ce qui empêche l'équipe de s'inscrire : titulaires hors de la fourchette, trop de
/// remplaçants.
pub(crate) async fn team_composition_problems(
    state: &AppState,
    tournament: &Tournament,
    team_id: Uuid,
) -> Result<Vec<String>, ApiError> {
    composition_problems(state, &tournament.settings, team_id).await
}

async fn composition_problems(
    state: &AppState,
    settings: &TournamentSettings,
    team_id: Uuid,
) -> Result<Vec<String>, ApiError> {
    let (starters, substitutes) = team_counts(state, team_id).await?;
    let mut problems = Vec::new();
    let (min, max) = (
        settings.team_min_starters.unwrap_or(0),
        settings.team_max_starters.unwrap_or(0),
    );
    let count = i64::try_from(starters).unwrap_or(i64::MAX);
    if count < i64::from(min) || count > i64::from(max) {
        problems.push(if min == max {
            format!("L'équipe compte {starters} titulaires, {min} sont attendus.")
        } else {
            format!("L'équipe compte {starters} titulaires, entre {min} et {max} sont attendus.")
        });
    }
    if let Some(limit) = settings.team_max_substitutes
        && i64::try_from(substitutes).unwrap_or(i64::MAX) > i64::from(limit)
    {
        problems.push(format!(
            "L'équipe compte {substitutes} remplaçants, {limit} au plus sont permis."
        ));
    }
    Ok(problems)
}

/// Les équipes déjà inscrites doivent respecter la nouvelle composition.
async fn check_team_fit(
    state: &AppState,
    tournament_id: &Uuid,
    merged: &TournamentInput,
) -> Result<Vec<(&'static str, String)>, ApiError> {
    if merged.participant_type != ParticipantType::Team {
        return Ok(Vec::new());
    }
    let mut errors = Vec::new();
    for team_id in active_participants(state, *tournament_id)
        .await?
        .iter()
        .filter_map(|p| p.tournament_team_id)
    {
        for problem in composition_problems(state, &merged.settings, team_id).await? {
            errors.push((
                "team_min_starters",
                format!("L'équipe {team_id} inscrite ne respecte plus la composition : {problem}"),
            ));
        }
    }
    Ok(errors)
}

/// Inscrits en lice : `registered` ou `checked_in` (ni en attente, ni refusés, ni sur liste
/// d'attente, ni absents, retirés ou disqualifiés).
pub(crate) async fn active_participants(
    state: &AppState,
    tournament_id: Uuid,
) -> Result<Vec<TournamentParticipant>, ApiError> {
    Ok(state
        .store
        .list_participants(tournament_id, i64::MAX, 0)
        .await
        .map_err(ApiError::internal)?
        .into_iter()
        .filter(|p| {
            matches!(
                p.status,
                ParticipantStatus::Registered | ParticipantStatus::CheckedIn
            )
        })
        .collect())
}

/// L'inscrit lui-même, ou le propriétaire de l'équipe inscrite.
async fn require_actor(
    state: &AppState,
    claims: &Claims,
    participant: &TournamentParticipant,
) -> Result<(), ApiError> {
    if participant.user_id == Some(claims.sub) {
        return Ok(());
    }
    if participant.user_id.is_none()
        && let Some(team_id) = participant.tournament_team_id
    {
        let team = state
            .store
            .find_tournament_team(team_id)
            .await
            .map_err(ApiError::internal)?;
        if team.is_some_and(|team| team.owner_id == claims.sub) {
            return Ok(());
        }
    }
    Err(ApiError::Forbidden)
}

pub(crate) fn require_scoring_editable(tournament: &Tournament) -> Result<(), ApiError> {
    if matches!(
        tournament.status,
        TournamentStatus::Draft | TournamentStatus::Registration
    ) {
        Ok(())
    } else {
        Err(ApiError::TournamentLocked)
    }
}

/// Les inscriptions exigent le statut `registration` et la fenêtre d'inscription, si elle est
/// définie. Les horodatages sont normalisés : ils se comparent comme des chaînes.
fn require_registration_open(tournament: &Tournament) -> Result<(), ApiError> {
    if tournament.status != TournamentStatus::Registration {
        return Err(ApiError::RegistrationClosed);
    }
    let now = now_rfc3339();
    let before_opening = tournament
        .registration_open_at
        .as_ref()
        .is_some_and(|open| now < *open);
    let after_closing = tournament
        .registration_close_at
        .as_ref()
        .is_some_and(|close| now > *close);
    if before_opening || after_closing {
        Err(ApiError::RegistrationClosed)
    } else {
        Ok(())
    }
}

/// Le tournoi, à condition que le compte du jeton puisse le voir (sinon `404`).
pub(crate) async fn visible_tournament(
    state: &AppState,
    claims: &Claims,
    id: Uuid,
) -> Result<Tournament, ApiError> {
    let tournament = find_tournament(state, id).await?;
    require_visible(state, claims, &tournament).await?;
    Ok(tournament)
}

/// Publie l'événement vers le moteur de notifications.
pub(crate) fn emit(state: &AppState, kind: EventKind, participant: &TournamentParticipant) {
    state.events.publish(TournamentEvent {
        kind,
        tournament_id: participant.tournament_id,
        participant_id: participant.id,
        user_id: participant.user_id,
        tournament_team_id: participant.tournament_team_id,
    });
}

/// La fenêtre de pointage, si elle est définie, doit être ouverte. Les horodatages sont
/// normalisés : ils se comparent comme des chaînes.
fn require_check_in_window(tournament: &Tournament) -> Result<(), ApiError> {
    let now = now_rfc3339();
    let settings = &tournament.settings;
    let before = settings
        .check_in_open_at
        .as_ref()
        .is_some_and(|open| now < *open);
    let after = settings
        .check_in_close_at
        .as_ref()
        .is_some_and(|close| now > *close);
    if before || after {
        Err(ApiError::CheckInClosed)
    } else {
        Ok(())
    }
}

/// `true` quand la fenêtre de pointage est close et n'a pas encore été traitée.
fn check_in_due(tournament: &Tournament) -> bool {
    tournament.check_in_settled_at.is_none()
        && matches!(
            tournament.status,
            TournamentStatus::Registration | TournamentStatus::Ongoing
        )
        && tournament
            .settings
            .check_in_close_at
            .as_ref()
            .is_some_and(|close| now_rfc3339() > *close)
}

/// Traite la clôture du pointage si elle est échue : les inscrits qui n'ont pas pointé
/// deviennent `absent` et la liste d'attente est promue dans la limite de la capacité. Le
/// traitement est paresseux (déclenché par les lectures et actions du tournoi) et exécuté une
/// seule fois par le store ; renvoie le tournoi à jour.
pub(crate) async fn settle_if_due(
    state: &AppState,
    tournament: Tournament,
) -> Result<Tournament, ApiError> {
    if !check_in_due(&tournament) {
        return Ok(tournament);
    }
    if let Some(settlement) = state
        .store
        .settle_check_in(tournament.id)
        .await
        .map_err(ApiError::internal)?
    {
        for participant in &settlement.absent {
            emit(state, EventKind::Absent, participant);
        }
        for participant in &settlement.promoted {
            emit(state, EventKind::Promoted, participant);
        }
    }
    find_tournament(state, tournament.id).await
}

/// Une place libérée (retrait, suppression, disqualification) profite à la liste d'attente ;
/// la promotion est bornée par la capacité, elle ne fait rien s'il n'y a pas de place.
async fn release_seat(
    state: &AppState,
    tournament: &Tournament,
    _participant: &TournamentParticipant,
) -> Result<(), ApiError> {
    if tournament.settings.waiting_list_enabled
        && matches!(
            tournament.status,
            TournamentStatus::Registration | TournamentStatus::Draft
        )
    {
        promote_and_emit(state, tournament.id).await?;
    }
    Ok(())
}

pub(crate) async fn promote_and_emit(
    state: &AppState,
    tournament_id: Uuid,
) -> Result<Vec<TournamentParticipant>, ApiError> {
    let promoted = state
        .store
        .promote_waitlist(tournament_id)
        .await
        .map_err(ApiError::internal)?;
    for participant in &promoted {
        emit(state, EventKind::Promoted, participant);
    }
    Ok(promoted)
}

fn transition_allowed(from: TournamentStatus, to: TournamentStatus) -> bool {
    use TournamentStatus::*;
    matches!(
        (from, to),
        (Draft, Registration)
            | (Registration, Ongoing)
            | (Ongoing, Finished)
            | (Draft | Registration | Ongoing, Cancelled)
    )
}

/// Ce qui empêche le passage en `ongoing`, un message par problème.
async fn start_problems(
    state: &AppState,
    tournament: &Tournament,
) -> Result<Vec<String>, ApiError> {
    let mut problems = Vec::new();
    problems.extend(crate::steps::chain_problems(
        tournament,
        &crate::steps::steps_of(state, tournament.id).await?,
    ));
    let participants = active_participants(state, tournament.id).await?;
    if participants.len() < 2 {
        problems.push(format!(
            "Il faut au moins 2 inscrits actifs, il y en a {}.",
            participants.len()
        ));
    }
    if tournament.participant_type == ParticipantType::Team {
        for team_id in participants.iter().filter_map(|p| p.tournament_team_id) {
            for problem in team_composition_problems(state, tournament, team_id).await? {
                problems.push(format!("Équipe {team_id} : {problem}"));
            }
        }
    }
    Ok(problems)
}

/// Valide et normalise un barème : `linear` demande un coefficient fini, `table` un objet non
/// vide de valeurs numériques vers des points numériques.
fn definition(
    mode: ScoringMode,
    coefficient: Option<f64>,
    points_table: Option<Value>,
) -> Result<ScoringRuleDefinition, ApiError> {
    definition_checked(mode, coefficient, points_table).map_err(ApiError::Validation)
}

/// Comme [`definition`], avec les erreurs par champ plutôt qu'une [`ApiError`].
pub(crate) fn definition_checked(
    mode: ScoringMode,
    coefficient: Option<f64>,
    points_table: Option<Value>,
) -> Result<ScoringRuleDefinition, Vec<(&'static str, String)>> {
    let mut errors = Vec::new();
    match mode {
        ScoringMode::Linear => {
            if !coefficient.is_some_and(f64::is_finite) {
                errors.push((
                    "coefficient",
                    "Le coefficient est obligatoire (nombre) avec le mode `linear`.".to_string(),
                ));
            }
            if points_table.is_some() {
                errors.push((
                    "points_table",
                    "`points_table` n'a de sens qu'avec le mode `table`.".to_string(),
                ));
            }
        }
        ScoringMode::Table => {
            if coefficient.is_some() {
                errors.push((
                    "coefficient",
                    "`coefficient` n'a de sens qu'avec le mode `linear`.".to_string(),
                ));
            }
            let valid = points_table
                .as_ref()
                .and_then(Value::as_object)
                .is_some_and(|table| {
                    !table.is_empty()
                        && table.iter().all(|(value, points)| {
                            value.parse::<f64>().is_ok_and(f64::is_finite)
                                && points.as_f64().is_some_and(f64::is_finite)
                        })
                });
            if !valid {
                errors.push((
                    "points_table",
                    "`points_table` doit être un objet non vide `{ valeur: points }` de nombres (ex. `{\"1\": 8, \"2\": 7}`).".to_string(),
                ));
            }
        }
    }
    if errors.is_empty() {
        Ok(ScoringRuleDefinition {
            mode,
            coefficient,
            points_table,
        })
    } else {
        Err(errors)
    }
}

/// Nettoie les champs d'un tournoi (noms, dates normalisées) et renvoie les erreurs par champ.
pub(crate) fn check(input: &mut TournamentInput) -> Vec<(&'static str, String)> {
    let mut errors = Vec::new();
    input.name = input.name.trim().to_string();
    if !(1..=NAME_MAX).contains(&input.name.chars().count()) {
        errors.push((
            "name",
            format!("Le nom doit contenir entre 1 et {NAME_MAX} caractères."),
        ));
    }
    input.description = input
        .description
        .take()
        .map(|d| d.trim().to_string())
        .filter(|d| !d.is_empty());
    if input
        .description
        .as_ref()
        .is_some_and(|d| d.chars().count() > DESCRIPTION_MAX)
    {
        errors.push((
            "description",
            format!("La description dépasse {DESCRIPTION_MAX} caractères."),
        ));
    }
    let mut date = |field: &'static str, value: &mut String| match normalize_timestamp(value) {
        Some(normalized) => *value = normalized,
        None => errors.push((field, DATE_HELP.to_string())),
    };
    date("start_date", &mut input.start_date);
    date("end_date", &mut input.end_date);
    let mut optional = |field: &'static str, value: &mut Option<String>| {
        if let Some(text) = value {
            match normalize_timestamp(text) {
                Some(normalized) => *text = normalized,
                None => errors.push((field, DATE_HELP.to_string())),
            }
        }
    };
    optional("registration_open_at", &mut input.registration_open_at);
    optional("registration_close_at", &mut input.registration_close_at);
    if errors.is_empty() {
        if input.end_date < input.start_date {
            errors.push((
                "end_date",
                "La fin ne peut pas précéder le début.".to_string(),
            ));
        }
        if let (Some(open), Some(close)) =
            (&input.registration_open_at, &input.registration_close_at)
            && close < open
        {
            errors.push((
                "registration_close_at",
                "La clôture des inscriptions ne peut pas précéder leur ouverture.".to_string(),
            ));
        }
    }
    if !(1..=MAX_PARTICIPANTS_LIMIT).contains(&input.max_participants) {
        errors.push((
            "max_participants",
            format!("Le maximum doit être compris entre 1 et {MAX_PARTICIPANTS_LIMIT}."),
        ));
    }
    errors.extend(check_settings(&mut input.settings, input.participant_type));
    match (input.team_scoring_mode, input.team_scoring_n) {
        (TeamScoringMode::TopN, Some(n)) if (1..=TEAM_SCORING_LIMIT).contains(&n) => {}
        (TeamScoringMode::TopN, _) => errors.push((
            "team_scoring_n",
            format!(
                "`team_scoring_n` est obligatoire (1 à {TEAM_SCORING_LIMIT}) avec le mode `top_n`."
            ),
        )),
        (_, Some(_)) => errors.push((
            "team_scoring_n",
            "`team_scoring_n` n'a de sens qu'avec le mode `top_n`.".to_string(),
        )),
        (_, None) => {}
    }
    errors
}

const DATE_HELP: &str = "Date RFC 3339 en UTC attendue (ex. 2026-11-14T18:00:00Z).";

fn tournament_error(err: StoreError) -> ApiError {
    match err {
        StoreError::ScoringRuleTaken => ApiError::ScoringRuleTaken,
        StoreError::AlreadyParticipant => ApiError::AlreadyRegistered,
        StoreError::TournamentFull => ApiError::TournamentFull,
        StoreError::TournamentNameTaken => ApiError::TournamentNameTaken,
        other => ApiError::internal(other),
    }
}
