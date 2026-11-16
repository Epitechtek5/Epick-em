//! Rôles propres à un tournoi : administrateurs et arbitres désignés par le propriétaire,
//! transfert de propriété, invitations (tournois `invitation_only`) et journal d'audit.
//!
//! Ces rôles sont indépendants du rôle global du compte. Le propriétaire (`owner_id`, assigné au
//! créateur) et les administrateurs globaux désignent et révoquent ; un administrateur de
//! tournoi gère le tournoi mais ne peut pas se donner ni donner de droits (pas d'escalade), et
//! seul le transfert de propriété change de propriétaire : un tournoi garde donc toujours son
//! unique propriétaire.

use crate::auth::{AppState, Claims};
use crate::error::{ApiError, ErrorResponse};
use crate::store::{Invitation, RoleAssignment, RoleAuditEntry, TournamentRole};
use crate::tournament_access::{require_manage, require_owner};
use crate::tournaments::find_tournament;
use actix_web::{HttpResponse, delete, get, post, put, web};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use utoipa_actix_web::service_config::ServiceConfig;
use uuid::Uuid;

pub fn routes(cfg: &mut ServiceConfig) {
    cfg.service(list_roles)
        .service(assign_role)
        .service(revoke_role)
        .service(transfer_ownership)
        .service(role_audit)
        .service(list_invitations)
        .service(invite)
        .service(uninvite);
}

/// Propriétaire et rôles délégués d'un tournoi.
#[derive(Serialize, ToSchema)]
struct Roles {
    /// Unique propriétaire ; `null` pour un ancien tournoi sans créateur connu.
    owner_id: Option<Uuid>,
    roles: Vec<RoleAssignment>,
}

#[derive(Deserialize, ToSchema)]
struct RoleRequest {
    role: TournamentRole,
}

#[derive(Deserialize, ToSchema)]
struct TransferRequest {
    /// Nouveau propriétaire.
    user_id: Uuid,
}

/// Propriétaire, administrateurs et arbitres du tournoi (organisateurs).
#[utoipa::path(
    get,
    path = "/tournaments/{id}/roles",
    tag = "tournament-roles",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Identifiant du tournoi")),
    responses(
        (status = 200, description = "Propriétaire et rôles délégués", body = Roles),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 403, description = "Réservé aux organisateurs du tournoi", body = ErrorResponse),
        (status = 404, description = "Tournoi introuvable", body = ErrorResponse),
    ),
)]
#[get("/tournaments/{id}/roles")]
async fn list_roles(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    id: web::Path<Uuid>,
) -> Result<HttpResponse, ApiError> {
    let tournament = find_tournament(&state, id.into_inner()).await?;
    require_manage(&state, &claims, &tournament).await?;
    let roles = state
        .store
        .list_tournament_roles(tournament.id)
        .await
        .map_err(ApiError::internal)?;
    Ok(HttpResponse::Ok().json(Roles {
        owner_id: tournament.owner_id,
        roles,
    }))
}

/// Désigne (ou change) l'administrateur ou l'arbitre d'un tournoi (propriétaire). Le
/// propriétaire ne reçoit pas de rôle délégué.
#[utoipa::path(
    put,
    path = "/tournaments/{id}/roles/{user_id}",
    tag = "tournament-roles",
    security(("bearer" = [])),
    params(
        ("id" = Uuid, Path, description = "Identifiant du tournoi"),
        ("user_id" = Uuid, Path, description = "Identifiant du compte"),
    ),
    request_body = RoleRequest,
    responses(
        (status = 200, description = "Rôle attribué", body = RoleAssignment),
        (status = 400, description = "Compte introuvable ou propriétaire du tournoi", body = ErrorResponse),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 403, description = "Réservé au propriétaire du tournoi", body = ErrorResponse),
        (status = 404, description = "Tournoi introuvable", body = ErrorResponse),
    ),
)]
#[put("/tournaments/{id}/roles/{user_id}")]
async fn assign_role(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    path: web::Path<(Uuid, Uuid)>,
    body: web::Json<RoleRequest>,
) -> Result<HttpResponse, ApiError> {
    let (tournament_id, user_id) = path.into_inner();
    let tournament = find_tournament(&state, tournament_id).await?;
    require_owner(&state, &claims, &tournament).await?;
    if tournament.owner_id == Some(user_id) {
        return Err(ApiError::Validation(vec![(
            "user_id",
            "Le propriétaire du tournoi n'a pas de rôle délégué.".to_string(),
        )]));
    }
    let assignment = state
        .store
        .assign_tournament_role(tournament.id, user_id, body.role, claims.sub)
        .await
        .map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::Validation(vec![("user_id", "Compte introuvable.".into())]))?;
    Ok(HttpResponse::Ok().json(assignment))
}

/// Retire le rôle d'un compte sur le tournoi (propriétaire).
#[utoipa::path(
    delete,
    path = "/tournaments/{id}/roles/{user_id}",
    tag = "tournament-roles",
    security(("bearer" = [])),
    params(
        ("id" = Uuid, Path, description = "Identifiant du tournoi"),
        ("user_id" = Uuid, Path, description = "Identifiant du compte"),
    ),
    responses(
        (status = 204, description = "Rôle retiré"),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 403, description = "Réservé au propriétaire du tournoi", body = ErrorResponse),
        (status = 404, description = "Tournoi introuvable ou compte sans rôle", body = ErrorResponse),
    ),
)]
#[delete("/tournaments/{id}/roles/{user_id}")]
async fn revoke_role(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    path: web::Path<(Uuid, Uuid)>,
) -> Result<HttpResponse, ApiError> {
    let (tournament_id, user_id) = path.into_inner();
    let tournament = find_tournament(&state, tournament_id).await?;
    require_owner(&state, &claims, &tournament).await?;
    if state
        .store
        .revoke_tournament_role(tournament.id, user_id, claims.sub)
        .await
        .map_err(ApiError::internal)?
    {
        Ok(HttpResponse::NoContent().finish())
    } else {
        Err(ApiError::NotFound)
    }
}

/// Transfère la propriété du tournoi (propriétaire ou administrateur global). L'ancien
/// propriétaire devient administrateur du tournoi ; le nouveau perd son éventuel rôle délégué.
/// L'opération est atomique : si le propriétaire a changé entre-temps, elle échoue (409).
#[utoipa::path(
    post,
    path = "/tournaments/{id}/transfer-ownership",
    tag = "tournament-roles",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Identifiant du tournoi")),
    request_body = TransferRequest,
    responses(
        (status = 200, description = "Tournoi transféré", body = Roles),
        (status = 400, description = "Compte introuvable ou déjà propriétaire", body = ErrorResponse),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 403, description = "Réservé au propriétaire du tournoi", body = ErrorResponse),
        (status = 404, description = "Tournoi introuvable", body = ErrorResponse),
        (status = 409, description = "Le propriétaire a changé entre-temps", body = ErrorResponse),
    ),
)]
#[post("/tournaments/{id}/transfer-ownership")]
async fn transfer_ownership(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    id: web::Path<Uuid>,
    body: web::Json<TransferRequest>,
) -> Result<HttpResponse, ApiError> {
    let tournament = find_tournament(&state, id.into_inner()).await?;
    require_owner(&state, &claims, &tournament).await?;
    let new_owner = body.user_id;
    if tournament.owner_id == Some(new_owner) {
        return Err(ApiError::Validation(vec![(
            "user_id",
            "Ce compte est déjà propriétaire du tournoi.".to_string(),
        )]));
    }
    if state
        .store
        .find_user_by_id(new_owner)
        .await
        .map_err(ApiError::internal)?
        .is_none()
    {
        return Err(ApiError::Validation(vec![(
            "user_id",
            "Compte introuvable.".to_string(),
        )]));
    }
    if !state
        .store
        .transfer_tournament_ownership(tournament.id, tournament.owner_id, new_owner, claims.sub)
        .await
        .map_err(ApiError::internal)?
    {
        return Err(ApiError::OwnershipChanged);
    }
    let roles = state
        .store
        .list_tournament_roles(tournament.id)
        .await
        .map_err(ApiError::internal)?;
    Ok(HttpResponse::Ok().json(Roles {
        owner_id: Some(new_owner),
        roles,
    }))
}

/// Journal des attributions, révocations et transferts de rôles (organisateurs).
#[utoipa::path(
    get,
    path = "/tournaments/{id}/role-audit",
    tag = "tournament-roles",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Identifiant du tournoi")),
    responses(
        (status = 200, description = "Entrées du journal, de la plus ancienne à la plus récente", body = Vec<RoleAuditEntry>),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 403, description = "Réservé aux organisateurs du tournoi", body = ErrorResponse),
        (status = 404, description = "Tournoi introuvable", body = ErrorResponse),
    ),
)]
#[get("/tournaments/{id}/role-audit")]
async fn role_audit(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    id: web::Path<Uuid>,
) -> Result<HttpResponse, ApiError> {
    let tournament = find_tournament(&state, id.into_inner()).await?;
    require_manage(&state, &claims, &tournament).await?;
    let entries = state
        .store
        .list_role_audit(tournament.id)
        .await
        .map_err(ApiError::internal)?;
    Ok(HttpResponse::Ok().json(entries))
}

/// Comptes invités à un tournoi `invitation_only` (organisateurs).
#[utoipa::path(
    get,
    path = "/tournaments/{id}/invitations",
    tag = "tournament-roles",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Identifiant du tournoi")),
    responses(
        (status = 200, description = "Invitations", body = Vec<Invitation>),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 403, description = "Réservé aux organisateurs du tournoi", body = ErrorResponse),
        (status = 404, description = "Tournoi introuvable", body = ErrorResponse),
    ),
)]
#[get("/tournaments/{id}/invitations")]
async fn list_invitations(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    id: web::Path<Uuid>,
) -> Result<HttpResponse, ApiError> {
    let tournament = find_tournament(&state, id.into_inner()).await?;
    require_manage(&state, &claims, &tournament).await?;
    let invitations = state
        .store
        .list_invitations(tournament.id)
        .await
        .map_err(ApiError::internal)?;
    Ok(HttpResponse::Ok().json(invitations))
}

/// Invite un compte : il voit alors le tournoi privé et peut s'y inscrire (organisateurs).
/// Sans effet si le compte est déjà invité.
#[utoipa::path(
    put,
    path = "/tournaments/{id}/invitations/{user_id}",
    tag = "tournament-roles",
    security(("bearer" = [])),
    params(
        ("id" = Uuid, Path, description = "Identifiant du tournoi"),
        ("user_id" = Uuid, Path, description = "Identifiant du compte"),
    ),
    responses(
        (status = 200, description = "Invitation", body = Invitation),
        (status = 400, description = "Compte introuvable", body = ErrorResponse),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 403, description = "Réservé aux organisateurs du tournoi", body = ErrorResponse),
        (status = 404, description = "Tournoi introuvable", body = ErrorResponse),
    ),
)]
#[put("/tournaments/{id}/invitations/{user_id}")]
async fn invite(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    path: web::Path<(Uuid, Uuid)>,
) -> Result<HttpResponse, ApiError> {
    let (tournament_id, user_id) = path.into_inner();
    let tournament = find_tournament(&state, tournament_id).await?;
    require_manage(&state, &claims, &tournament).await?;
    let invitation = state
        .store
        .add_invitation(tournament.id, user_id, claims.sub)
        .await
        .map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::Validation(vec![("user_id", "Compte introuvable.".into())]))?;
    Ok(HttpResponse::Ok().json(invitation))
}

/// Retire une invitation (organisateurs).
#[utoipa::path(
    delete,
    path = "/tournaments/{id}/invitations/{user_id}",
    tag = "tournament-roles",
    security(("bearer" = [])),
    params(
        ("id" = Uuid, Path, description = "Identifiant du tournoi"),
        ("user_id" = Uuid, Path, description = "Identifiant du compte"),
    ),
    responses(
        (status = 204, description = "Invitation retirée"),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 403, description = "Réservé aux organisateurs du tournoi", body = ErrorResponse),
        (status = 404, description = "Tournoi ou invitation introuvable", body = ErrorResponse),
    ),
)]
#[delete("/tournaments/{id}/invitations/{user_id}")]
async fn uninvite(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    path: web::Path<(Uuid, Uuid)>,
) -> Result<HttpResponse, ApiError> {
    let (tournament_id, user_id) = path.into_inner();
    let tournament = find_tournament(&state, tournament_id).await?;
    require_manage(&state, &claims, &tournament).await?;
    if state
        .store
        .remove_invitation(tournament.id, user_id)
        .await
        .map_err(ApiError::internal)?
    {
        Ok(HttpResponse::NoContent().finish())
    } else {
        Err(ApiError::NotFound)
    }
}
