//! Duplication de tournois et modèles réutilisables.
//!
//! Un doublon ou un modèle ne recopie que la **configuration** : réglages, champs d'inscription,
//! barème et définition des étapes. Ni inscrits, ni équipes, ni résultats, ni état de
//! fonctionnement : le résultat est toujours un tournoi `draft`, sans pointage traité. Créer un
//! tournoi (par doublon ou depuis un modèle) reste réservé aux administrateurs globaux, comme
//! la création ordinaire ; le créateur en devient le propriétaire.

use crate::auth::{AppState, Claims};
use crate::error::{ApiError, ErrorResponse};
use crate::store::{
    ScoringRuleInput, StepDefinition, StepInput, StoreError, Tournament, TournamentInput,
};
use crate::tournament_access::require_manage;
use crate::tournaments::{check, find_tournament};
use crate::users::require_admin;
use actix_web::{HttpResponse, delete, get, post, web};
use serde::Deserialize;
use utoipa::ToSchema;
use utoipa_actix_web::service_config::ServiceConfig;
use uuid::Uuid;

pub fn routes(cfg: &mut ServiceConfig) {
    cfg.service(duplicate_tournament)
        .service(save_as_template)
        .service(list_templates)
        .service(get_template)
        .service(delete_template)
        .service(create_from_template);
}

/// Nom du nouveau tournoi ou modèle, et dates facultatives (celles de la source par défaut).
#[derive(Deserialize, ToSchema)]
struct CopyRequest {
    #[schema(min_length = 1, max_length = 128, example = "TFT Open #2")]
    name: String,
    /// RFC 3339 en UTC.
    start_date: Option<String>,
    end_date: Option<String>,
}

/// Duplique un tournoi (administrateur global) : configuration, barème et étapes, au statut
/// `draft`, sans inscrits ni résultats.
#[utoipa::path(
    post,
    path = "/tournaments/{id}/duplicate",
    tag = "tournament-templates",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Identifiant du tournoi à dupliquer")),
    request_body = CopyRequest,
    responses(
        (status = 201, description = "Nouveau tournoi", body = Tournament),
        (status = 400, description = "Requête invalide", body = ErrorResponse),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 403, description = "Réservé aux administrateurs", body = ErrorResponse),
        (status = 404, description = "Tournoi introuvable", body = ErrorResponse),
        (status = 409, description = "Nom déjà pris pour ce jeu", body = ErrorResponse),
    ),
)]
#[post("/tournaments/{id}/duplicate")]
async fn duplicate_tournament(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    id: web::Path<Uuid>,
    body: web::Json<CopyRequest>,
) -> Result<HttpResponse, ApiError> {
    require_admin(&state, &claims).await?;
    let source = find_tournament(&state, id.into_inner()).await?;
    let copy = copy_configuration(&state, &claims, &source, body.into_inner(), false).await?;
    Ok(HttpResponse::Created().json(copy))
}

/// Enregistre la configuration d'un tournoi comme modèle réutilisable (administrateur global).
#[utoipa::path(
    post,
    path = "/tournaments/{id}/templates",
    tag = "tournament-templates",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Identifiant du tournoi source")),
    request_body = CopyRequest,
    responses(
        (status = 201, description = "Modèle créé (`is_template` vrai)", body = Tournament),
        (status = 400, description = "Requête invalide", body = ErrorResponse),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 403, description = "Réservé aux administrateurs", body = ErrorResponse),
        (status = 404, description = "Tournoi introuvable", body = ErrorResponse),
        (status = 409, description = "Nom déjà pris pour ce jeu", body = ErrorResponse),
    ),
)]
#[post("/tournaments/{id}/templates")]
async fn save_as_template(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    id: web::Path<Uuid>,
    body: web::Json<CopyRequest>,
) -> Result<HttpResponse, ApiError> {
    require_admin(&state, &claims).await?;
    let source = find_tournament(&state, id.into_inner()).await?;
    let template = copy_configuration(&state, &claims, &source, body.into_inner(), true).await?;
    Ok(HttpResponse::Created().json(template))
}

/// Modèles de tournoi (administrateur global).
#[utoipa::path(
    get,
    path = "/tournament-templates",
    tag = "tournament-templates",
    security(("bearer" = [])),
    responses(
        (status = 200, description = "Modèles, par date de début", body = Vec<Tournament>),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 403, description = "Réservé aux administrateurs", body = ErrorResponse),
    ),
)]
#[get("/tournament-templates")]
async fn list_templates(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
) -> Result<HttpResponse, ApiError> {
    require_admin(&state, &claims).await?;
    let templates = state
        .store
        .list_tournaments(None, None, true, i64::MAX, 0)
        .await
        .map_err(ApiError::internal)?;
    Ok(HttpResponse::Ok().json(templates))
}

/// Détail d'un modèle (administrateur global).
#[utoipa::path(
    get,
    path = "/tournament-templates/{id}",
    tag = "tournament-templates",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Identifiant du modèle")),
    responses(
        (status = 200, description = "Le modèle", body = Tournament),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 403, description = "Réservé aux administrateurs", body = ErrorResponse),
        (status = 404, description = "Modèle introuvable", body = ErrorResponse),
    ),
)]
#[get("/tournament-templates/{id}")]
async fn get_template(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    id: web::Path<Uuid>,
) -> Result<HttpResponse, ApiError> {
    require_admin(&state, &claims).await?;
    Ok(HttpResponse::Ok().json(find_template(&state, id.into_inner()).await?))
}

/// Supprime un modèle (administrateur global).
#[utoipa::path(
    delete,
    path = "/tournament-templates/{id}",
    tag = "tournament-templates",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Identifiant du modèle")),
    responses(
        (status = 204, description = "Modèle supprimé"),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 403, description = "Réservé aux administrateurs", body = ErrorResponse),
        (status = 404, description = "Modèle introuvable", body = ErrorResponse),
    ),
)]
#[delete("/tournament-templates/{id}")]
async fn delete_template(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    id: web::Path<Uuid>,
) -> Result<HttpResponse, ApiError> {
    require_admin(&state, &claims).await?;
    let template = find_template(&state, id.into_inner()).await?;
    if state
        .store
        .delete_tournament(template.id)
        .await
        .map_err(ApiError::internal)?
    {
        Ok(HttpResponse::NoContent().finish())
    } else {
        Err(ApiError::NotFound)
    }
}

/// Crée un tournoi `draft` depuis un modèle (administrateur global).
#[utoipa::path(
    post,
    path = "/tournament-templates/{id}/tournaments",
    tag = "tournament-templates",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Identifiant du modèle")),
    request_body = CopyRequest,
    responses(
        (status = 201, description = "Nouveau tournoi", body = Tournament),
        (status = 400, description = "Requête invalide", body = ErrorResponse),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 403, description = "Réservé aux administrateurs", body = ErrorResponse),
        (status = 404, description = "Modèle introuvable", body = ErrorResponse),
        (status = 409, description = "Nom déjà pris pour ce jeu", body = ErrorResponse),
    ),
)]
#[post("/tournament-templates/{id}/tournaments")]
async fn create_from_template(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    id: web::Path<Uuid>,
    body: web::Json<CopyRequest>,
) -> Result<HttpResponse, ApiError> {
    require_admin(&state, &claims).await?;
    let template = find_template(&state, id.into_inner()).await?;
    let tournament =
        copy_configuration(&state, &claims, &template, body.into_inner(), false).await?;
    Ok(HttpResponse::Created().json(tournament))
}

async fn find_template(state: &AppState, id: Uuid) -> Result<Tournament, ApiError> {
    find_tournament(state, id)
        .await
        .ok()
        .filter(|t| t.is_template)
        .ok_or(ApiError::NotFound)
}

/// Crée un tournoi (ou un modèle) `draft` avec la configuration de `source`, son barème et la
/// définition de ses étapes ; rien d'autre n'est recopié.
async fn copy_configuration(
    state: &AppState,
    claims: &Claims,
    source: &Tournament,
    request: CopyRequest,
    as_template: bool,
) -> Result<Tournament, ApiError> {
    if !source.is_template {
        require_manage(state, claims, source).await?;
    }
    let mut input = TournamentInput {
        game_id: source.game_id,
        name: request.name,
        description: source.description.clone(),
        start_date: request
            .start_date
            .unwrap_or_else(|| source.start_date.clone()),
        end_date: request.end_date.unwrap_or_else(|| source.end_date.clone()),
        registration_open_at: source.registration_open_at.clone(),
        registration_close_at: source.registration_close_at.clone(),
        participant_type: source.participant_type,
        max_participants: source.max_participants,
        team_scoring_mode: source.team_scoring_mode,
        team_scoring_n: source.team_scoring_n,
        settings: source.settings.clone(),
        owner_id: Some(claims.sub),
        is_template: as_template,
    };
    let errors = check(&mut input);
    if !errors.is_empty() {
        return Err(ApiError::Validation(errors));
    }
    let copy = state
        .store
        .create_tournament(input)
        .await
        .map_err(|err| match err {
            StoreError::TournamentNameTaken => ApiError::TournamentNameTaken,
            other => ApiError::internal(other),
        })?;
    let result = copy_children(state, source, &copy).await;
    if let Err(err) = result {
        // Pas de copie à moitié faite.
        let _ = state.store.delete_tournament(copy.id).await;
        return Err(err);
    }
    Ok(copy)
}

async fn copy_children(
    state: &AppState,
    source: &Tournament,
    copy: &Tournament,
) -> Result<(), ApiError> {
    for rule in state
        .store
        .list_scoring_rules(source.id)
        .await
        .map_err(ApiError::internal)?
    {
        state
            .store
            .create_scoring_rule(ScoringRuleInput {
                tournament_id: copy.id,
                stat_id: rule.stat_id,
                definition: crate::store::ScoringRuleDefinition {
                    mode: rule.mode,
                    coefficient: rule.coefficient,
                    points_table: rule.points_table,
                },
            })
            .await
            .map_err(ApiError::internal)?;
    }
    for step in state
        .store
        .list_steps(source.id)
        .await
        .map_err(ApiError::internal)?
    {
        state
            .store
            .create_step(StepInput {
                tournament_id: copy.id,
                definition: StepDefinition {
                    position: step.position,
                    format: step.format,
                    match_type: step.match_type,
                    group_count: step.group_count,
                    group_size: step.group_size,
                    matches_per_group: step.matches_per_group,
                    advance_per_group: step.advance_per_group,
                    tiebreak: step.tiebreak,
                },
            })
            .await
            .map_err(ApiError::internal)?;
    }
    Ok(())
}
