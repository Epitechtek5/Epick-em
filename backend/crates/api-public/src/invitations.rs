//! Moteur d'invitations générique : équipes globales, équipes de tournoi et tournois.
//!
//! Une invitation s'adresse à un compte ou se partage par lien. Le lien porte un jeton aléatoire
//! (jamais stocké en clair), expirant, révocable et à usage limité (une seule acceptation par
//! défaut). Les droits sont revérifiés côté serveur : seul le propriétaire d'une équipe (ou
//! d'une équipe de tournoi) invite dans celle-ci, seul un administrateur invite à un tournoi,
//! seul l'invité répond, et une invitation étrangère reste introuvable (aucune fuite).
//!
//! L'acceptation crée l'adhésion ou l'inscription dans la même transaction que le changement de
//! statut ([`AuthStore::respond_invitation`]). Les notifications partent ensuite en tâche de fond
//! vers un [`InvitationNotifier`] : leur échec ne touche jamais l'invitation.

use crate::auth::{AppState, Claims, hash_token, new_token};
use crate::error::{ApiError, ErrorResponse};
use crate::store::{
    Invitation, InvitationAction, InvitationEvent, InvitationEventKind, InvitationFilter,
    InvitationInput, InvitationStatus, InvitationType, ParticipantType, StoreError, TeamRole,
    TournamentStatus, now_rfc3339,
};
use crate::teams::{Pagination, require_assignable, require_owner};
use crate::tournaments::{active_participants, find_tournament, is_admin};
use actix_web::{HttpResponse, get, post, web};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::time::Duration;
use utoipa::{IntoParams, ToSchema};
use utoipa_actix_web::service_config::ServiceConfig;
use uuid::Uuid;

const HOUR: Duration = Duration::from_secs(3600);
/// Durée de validité par défaut d'une invitation.
pub const DEFAULT_TTL: Duration = Duration::from_secs(7 * 24 * 3600);
/// Durée de validité maximale qu'un appelant peut demander.
pub const MAX_TTL: Duration = Duration::from_secs(30 * 24 * 3600);
/// Nombre maximal d'acceptations d'un lien.
const MAX_USES_LIMIT: i32 = 1000;
/// Intervalle de la purge des invitations échues.
const EXPIRY_SWEEP: Duration = Duration::from_secs(300);

/// Durées de validité des invitations (configurables, voir `INVITATION_*_TTL_HOURS`).
#[derive(Debug, Clone, Copy)]
pub struct InvitationTtl {
    pub default: Duration,
    pub max: Duration,
}

impl Default for InvitationTtl {
    fn default() -> Self {
        InvitationTtl {
            default: DEFAULT_TTL,
            max: MAX_TTL,
        }
    }
}

/// Fait publié à chaque événement du cycle de vie d'une invitation, une fois la transaction
/// validée. Le moteur de notifications (e-mail localisé, push) s'y branche.
#[derive(Debug, Clone)]
pub struct InvitationNotification {
    pub kind: InvitationEventKind,
    pub invitation: Invitation,
    /// Auteur du fait ; `None` pour une expiration.
    pub actor_id: Option<Uuid>,
}

/// Destinataire des événements d'invitation. Appelé en tâche de fond : une erreur est
/// journalisée, jamais renvoyée à l'appelant de l'API.
#[async_trait]
pub trait InvitationNotifier: Send + Sync {
    async fn notify(&self, notification: InvitationNotification) -> Result<(), String>;
}

/// Ignore les événements (par défaut, tant que le moteur de notifications n'est pas branché).
pub struct NoopInvitationNotifier;

#[async_trait]
impl InvitationNotifier for NoopInvitationNotifier {
    async fn notify(&self, _: InvitationNotification) -> Result<(), String> {
        Ok(())
    }
}

/// Garde les événements en mémoire, pour les tests.
#[derive(Default)]
pub struct MemoryInvitationNotifier {
    pub sent: Mutex<Vec<InvitationNotification>>,
}

impl MemoryInvitationNotifier {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn kinds(&self) -> Vec<InvitationEventKind> {
        self.sent
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .iter()
            .map(|n| n.kind)
            .collect()
    }
}

#[async_trait]
impl InvitationNotifier for MemoryInvitationNotifier {
    async fn notify(&self, notification: InvitationNotification) -> Result<(), String> {
        self.sent
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .push(notification);
        Ok(())
    }
}

/// Publie l'événement sans attendre ni propager d'échec.
fn publish(
    state: &AppState,
    kind: InvitationEventKind,
    invitation: &Invitation,
    actor: Option<Uuid>,
) {
    let notifier = state.invitation_notifier.clone();
    let notification = InvitationNotification {
        kind,
        invitation: invitation.clone(),
        actor_id: actor,
    };
    actix_web::rt::spawn(async move {
        if let Err(err) = notifier.notify(notification).await {
            eprintln!("api-public : notification d'invitation : {err}");
        }
    });
}

/// Fait expirer les invitations échues et publie leurs événements.
pub(crate) async fn expire_due(state: &AppState) -> Result<(), ApiError> {
    let expired = state
        .store
        .expire_invitations()
        .await
        .map_err(ApiError::internal)?;
    for invitation in &expired {
        publish(state, InvitationEventKind::Expired, invitation, None);
    }
    Ok(())
}

/// Tâche de fond qui purge régulièrement les invitations échues (à lancer au démarrage).
pub fn spawn_expiry_task(state: AppState) {
    actix_web::rt::spawn(async move {
        loop {
            if let Err(err) = expire_due(&state).await {
                eprintln!("api-public : expiration des invitations : {err}");
            }
            actix_web::rt::time::sleep(EXPIRY_SWEEP).await;
        }
    });
}

/// Routes des invitations, avec leur documentation OpenAPI.
pub fn routes(cfg: &mut ServiceConfig) {
    cfg.service(list_invitations)
        .service(create_invitation)
        .service(get_invitation)
        .service(list_events)
        .service(accept_invitation)
        .service(decline_invitation)
        .service(revoke_invitation)
        .service(resolve_link)
        .service(accept_link);
}

#[derive(Deserialize, ToSchema)]
struct CreateInvitationRequest {
    /// Ressource visée : `team`, `tournament_team` ou `tournament`.
    #[serde(rename = "type")]
    kind: InvitationType,
    /// Équipe, équipe de tournoi ou tournoi selon `type`.
    resource_id: Uuid,
    /// Compte invité. Absent : une invitation par lien est créée et son jeton renvoyé une seule
    /// fois.
    recipient_id: Option<Uuid>,
    /// `member` (par défaut) ou `substitute` pour une équipe ; `owner` n'est pas attribuable.
    /// Interdit pour un tournoi.
    role: Option<TeamRole>,
    /// Acceptations maximales d'un lien (1 par défaut, jusqu'à 1000). Réservé aux liens.
    #[schema(minimum = 1, maximum = 1000)]
    max_uses: Option<i32>,
    /// Validité en heures (celle par défaut du serveur si absente, plafonnée).
    #[schema(minimum = 1)]
    expires_in_hours: Option<i64>,
}

/// Invitation créée ; `token` et `link` n'existent que pour un lien et ne sont montrés qu'ici.
#[derive(Serialize, ToSchema)]
struct CreatedInvitation {
    #[serde(flatten)]
    invitation: Invitation,
    /// Jeton secret du lien, à ne partager qu'avec les invités : il n'est pas récupérable.
    token: Option<String>,
    /// Lien partageable `{origine publique}/invite/{jeton}`.
    link: Option<String>,
}

#[derive(Deserialize, ToSchema, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum Direction {
    /// Invitations reçues.
    Incoming,
    /// Invitations envoyées.
    Outgoing,
}

#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
struct ListQuery {
    /// `incoming` (par défaut) ou `outgoing`.
    direction: Option<Direction>,
    status: Option<InvitationStatus>,
    #[serde(rename = "type")]
    kind: Option<InvitationType>,
    /// Nombre d'invitations renvoyées (1 à 100, 50 par défaut).
    limit: Option<i64>,
    /// Nombre d'invitations ignorées (0 par défaut).
    offset: Option<i64>,
}

#[derive(Serialize, ToSchema)]
struct InvitationPage {
    items: Vec<Invitation>,
    /// Nombre total d'invitations correspondant aux filtres.
    total: i64,
    limit: i64,
    offset: i64,
}

/// Ce que révèle un lien à son porteur authentifié : rien de privé.
#[derive(Serialize, ToSchema)]
struct InvitationLinkPreview {
    #[serde(rename = "type")]
    kind: InvitationType,
    /// Nom de l'équipe, de l'équipe de tournoi ou du tournoi.
    resource_name: String,
    inviter_username: String,
    role: Option<TeamRole>,
    expires_at: String,
}

/// Adhésion ou inscription obtenue en acceptant un lien.
#[derive(Serialize, ToSchema)]
struct AcceptedLink {
    invitation_id: Uuid,
    #[serde(rename = "type")]
    kind: InvitationType,
    resource_id: Uuid,
    role: Option<TeamRole>,
}

/// Crée une invitation à un compte, ou un lien partageable.
///
/// Équipe ou équipe de tournoi : réservé au propriétaire. Tournoi (solo, avant son ouverture ou
/// pendant les inscriptions) : réservé aux administrateurs.
#[utoipa::path(
    post,
    path = "/invitations",
    tag = "invitations",
    security(("bearer" = [])),
    request_body = CreateInvitationRequest,
    responses(
        (status = 201, description = "Invitation créée", body = CreatedInvitation),
        (status = 400, description = "Requête invalide, rôle `owner`, invité introuvable ou ressource incompatible", body = ErrorResponse),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 403, description = "Droit d'inviter refusé sur cette ressource", body = ErrorResponse),
        (status = 404, description = "Ressource introuvable", body = ErrorResponse),
        (status = 409, description = "Invitation déjà en attente, déjà membre ou inscrit, ou ressource verrouillée", body = ErrorResponse),
    ),
)]
#[post("/invitations")]
async fn create_invitation(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    body: web::Json<CreateInvitationRequest>,
) -> Result<HttpResponse, ApiError> {
    let request = body.into_inner();
    let ttl = requested_ttl(&state, request.expires_in_hours)?;
    if request.recipient_id.is_some() && request.max_uses.is_some() {
        return Err(ApiError::Validation(vec![(
            "max_uses",
            "La limite d'usage ne concerne que les liens.".into(),
        )]));
    }
    if request
        .max_uses
        .is_some_and(|n| !(1..=MAX_USES_LIMIT).contains(&n))
    {
        return Err(ApiError::Validation(vec![(
            "max_uses",
            format!("La limite d'usage doit être comprise entre 1 et {MAX_USES_LIMIT}."),
        )]));
    }
    if let Some(recipient) = request.recipient_id {
        if recipient == claims.sub {
            return Err(ApiError::Validation(vec![(
                "recipient_id",
                "Vous ne pouvez pas vous inviter vous-même.".into(),
            )]));
        }
        if state
            .store
            .find_user_by_id(recipient)
            .await
            .map_err(ApiError::internal)?
            .is_none()
        {
            return Err(ApiError::Validation(vec![(
                "recipient_id",
                "Compte introuvable.".into(),
            )]));
        }
    }
    let role = authorize_creation(&state, &claims, &request).await?;
    let token = request.recipient_id.is_none().then(new_token);
    let invitation = state
        .store
        .create_invitation(InvitationInput {
            kind: request.kind,
            resource_id: request.resource_id,
            inviter_id: claims.sub,
            recipient_id: request.recipient_id,
            role,
            token_hash: token.as_deref().map(hash_token),
            max_uses: token.as_ref().map(|_| request.max_uses.unwrap_or(1)),
            ttl,
        })
        .await
        .map_err(invitation_error)?;
    publish(
        &state,
        InvitationEventKind::Created,
        &invitation,
        Some(claims.sub),
    );
    let link = token
        .as_ref()
        .map(|token| format!("{}/invite/{token}", state.public_url.trim_end_matches('/')));
    Ok(HttpResponse::Created().json(CreatedInvitation {
        invitation,
        token,
        link,
    }))
}

/// Invitations reçues ou envoyées, paginées et filtrables par statut et par type.
#[utoipa::path(
    get,
    path = "/invitations",
    tag = "invitations",
    security(("bearer" = [])),
    params(ListQuery),
    responses(
        (status = 200, description = "Invitations, les plus récentes d'abord", body = InvitationPage),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
    ),
)]
#[get("/invitations")]
async fn list_invitations(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    query: web::Query<ListQuery>,
) -> Result<HttpResponse, ApiError> {
    expire_due(&state).await?;
    let query = query.into_inner();
    let (limit, offset) = Pagination::new(query.limit, query.offset).bounds();
    let mut filter = InvitationFilter {
        status: query.status,
        kind: query.kind,
        limit,
        offset,
        ..InvitationFilter::default()
    };
    match query.direction.unwrap_or(Direction::Incoming) {
        Direction::Incoming => filter.recipient_id = Some(claims.sub),
        Direction::Outgoing => filter.inviter_id = Some(claims.sub),
    }
    let (items, total) = state
        .store
        .list_invitations(filter)
        .await
        .map_err(ApiError::internal)?;
    Ok(HttpResponse::Ok().json(InvitationPage {
        items,
        total,
        limit,
        offset,
    }))
}

/// Détail d'une invitation, pour l'invitant, l'invité et les administrateurs.
#[utoipa::path(
    get,
    path = "/invitations/{id}",
    tag = "invitations",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Identifiant de l'invitation")),
    responses(
        (status = 200, description = "L'invitation", body = Invitation),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 404, description = "Invitation introuvable ou étrangère à l'appelant", body = ErrorResponse),
    ),
)]
#[get("/invitations/{id}")]
async fn get_invitation(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    id: web::Path<Uuid>,
) -> Result<HttpResponse, ApiError> {
    expire_due(&state).await?;
    let invitation = visible_invitation(&state, &claims, id.into_inner()).await?;
    Ok(HttpResponse::Ok().json(invitation))
}

/// Historique de l'invitation : création et chaque changement de statut.
#[utoipa::path(
    get,
    path = "/invitations/{id}/events",
    tag = "invitations",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Identifiant de l'invitation")),
    responses(
        (status = 200, description = "Événements, du plus ancien au plus récent", body = Vec<InvitationEvent>),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 404, description = "Invitation introuvable ou étrangère à l'appelant", body = ErrorResponse),
    ),
)]
#[get("/invitations/{id}/events")]
async fn list_events(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    id: web::Path<Uuid>,
) -> Result<HttpResponse, ApiError> {
    expire_due(&state).await?;
    let invitation = visible_invitation(&state, &claims, id.into_inner()).await?;
    let events = state
        .store
        .list_invitation_events(invitation.id)
        .await
        .map_err(ApiError::internal)?;
    Ok(HttpResponse::Ok().json(events))
}

/// Accepte l'invitation (invité uniquement) : l'adhésion ou l'inscription est créée, après
/// revalidation des règles de la ressource, dans la même transaction.
#[utoipa::path(
    post,
    path = "/invitations/{id}/accept",
    tag = "invitations",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Identifiant de l'invitation")),
    responses(
        (status = 200, description = "Invitation acceptée", body = Invitation),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 404, description = "Invitation introuvable ou adressée à un autre compte", body = ErrorResponse),
        (status = 409, description = "Invitation plus en attente, ressource indisponible, déjà membre ou inscrit, tournoi complet ou inscriptions fermées", body = ErrorResponse),
        (status = 410, description = "Invitation expirée", body = ErrorResponse),
    ),
)]
#[post("/invitations/{id}/accept")]
async fn accept_invitation(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    id: web::Path<Uuid>,
) -> Result<HttpResponse, ApiError> {
    respond_as_recipient(&state, &claims, id.into_inner(), InvitationAction::Accept).await
}

/// Refuse l'invitation (invité uniquement).
#[utoipa::path(
    post,
    path = "/invitations/{id}/decline",
    tag = "invitations",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Identifiant de l'invitation")),
    responses(
        (status = 200, description = "Invitation refusée", body = Invitation),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 404, description = "Invitation introuvable ou adressée à un autre compte", body = ErrorResponse),
        (status = 409, description = "Invitation plus en attente", body = ErrorResponse),
        (status = 410, description = "Invitation expirée", body = ErrorResponse),
    ),
)]
#[post("/invitations/{id}/decline")]
async fn decline_invitation(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    id: web::Path<Uuid>,
) -> Result<HttpResponse, ApiError> {
    respond_as_recipient(&state, &claims, id.into_inner(), InvitationAction::Decline).await
}

/// Révoque l'invitation (invitant ou administrateur) ; son lien cesse aussitôt de fonctionner.
#[utoipa::path(
    post,
    path = "/invitations/{id}/revoke",
    tag = "invitations",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Identifiant de l'invitation")),
    responses(
        (status = 200, description = "Invitation révoquée", body = Invitation),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 403, description = "Réservé à l'invitant", body = ErrorResponse),
        (status = 404, description = "Invitation introuvable ou étrangère à l'appelant", body = ErrorResponse),
        (status = 409, description = "Invitation plus en attente", body = ErrorResponse),
        (status = 410, description = "Invitation expirée", body = ErrorResponse),
    ),
)]
#[post("/invitations/{id}/revoke")]
async fn revoke_invitation(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    id: web::Path<Uuid>,
) -> Result<HttpResponse, ApiError> {
    let invitation = visible_invitation(&state, &claims, id.into_inner()).await?;
    if invitation.inviter_id != claims.sub && !is_admin(&state, &claims).await? {
        return Err(ApiError::Forbidden);
    }
    let invitation = respond(&state, invitation.id, claims.sub, InvitationAction::Revoke).await?;
    Ok(HttpResponse::Ok().json(invitation))
}

/// Résout un lien d'invitation pour un compte connecté : type, nom de la ressource et invitant,
/// sans rien de privé. Un lien inconnu, expiré, révoqué ou épuisé répond toujours 404.
#[utoipa::path(
    get,
    path = "/invitation-links/{token}",
    tag = "invitations",
    security(("bearer" = [])),
    params(("token" = String, Path, description = "Jeton du lien")),
    responses(
        (status = 200, description = "Aperçu de l'invitation", body = InvitationLinkPreview),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 404, description = "Lien invalide, expiré, révoqué ou épuisé", body = ErrorResponse),
    ),
)]
#[get("/invitation-links/{token}")]
async fn resolve_link(
    state: web::Data<AppState>,
    token: web::Path<String>,
) -> Result<HttpResponse, ApiError> {
    expire_due(&state).await?;
    let invitation = usable_link(&state, &token).await?;
    let resource_name = resource_name(&state, &invitation)
        .await?
        .ok_or(ApiError::NotFound)?;
    let inviter = state
        .store
        .find_profile(invitation.inviter_id)
        .await
        .map_err(ApiError::internal)?
        .ok_or(ApiError::NotFound)?;
    Ok(HttpResponse::Ok().json(InvitationLinkPreview {
        kind: invitation.kind,
        resource_name,
        inviter_username: inviter.username,
        role: invitation.role,
        expires_at: invitation.expires_at,
    }))
}

/// Rejoint la ressource en acceptant un lien valide. Le lien est à usage limité : une fois
/// `max_uses` acceptations atteintes, il est épuisé.
#[utoipa::path(
    post,
    path = "/invitation-links/{token}/accept",
    tag = "invitations",
    security(("bearer" = [])),
    params(("token" = String, Path, description = "Jeton du lien")),
    responses(
        (status = 200, description = "Lien accepté", body = AcceptedLink),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 404, description = "Lien invalide, expiré, révoqué ou épuisé", body = ErrorResponse),
        (status = 409, description = "Ressource indisponible, déjà membre ou inscrit, tournoi complet ou inscriptions fermées", body = ErrorResponse),
    ),
)]
#[post("/invitation-links/{token}/accept")]
async fn accept_link(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    token: web::Path<String>,
) -> Result<HttpResponse, ApiError> {
    let invitation = usable_link(&state, &token).await?;
    let result = respond(&state, invitation.id, claims.sub, InvitationAction::Accept).await;
    let accepted = match result {
        // Un lien devenu inutilisable entre-temps ne se distingue pas d'un lien inconnu.
        Err(ApiError::InvitationNotPending | ApiError::InvitationExpired) => {
            return Err(ApiError::NotFound);
        }
        other => other?,
    };
    Ok(HttpResponse::Ok().json(AcceptedLink {
        invitation_id: accepted.id,
        kind: accepted.kind,
        resource_id: accepted.resource_id,
        role: accepted.role,
    }))
}

/// Durée de validité demandée, dans les bornes du serveur.
fn requested_ttl(state: &AppState, hours: Option<i64>) -> Result<Duration, ApiError> {
    let Some(hours) = hours else {
        return Ok(state.invitation_ttl.default);
    };
    let max_hours = i64::try_from(state.invitation_ttl.max.as_secs() / 3600).unwrap_or(i64::MAX);
    if !(1..=max_hours).contains(&hours) {
        return Err(ApiError::Validation(vec![(
            "expires_in_hours",
            format!("La validité doit être comprise entre 1 et {max_hours} heures."),
        )]));
    }
    Ok(HOUR * u32::try_from(hours).unwrap_or(u32::MAX))
}

/// Vérifie le droit d'inviter sur la ressource et sa cohérence ; renvoie le rôle à attribuer.
async fn authorize_creation(
    state: &AppState,
    claims: &Claims,
    request: &CreateInvitationRequest,
) -> Result<Option<TeamRole>, ApiError> {
    let store = &state.store;
    match request.kind {
        InvitationType::Team => {
            let team = store
                .find_team(request.resource_id)
                .await
                .map_err(ApiError::internal)?
                .ok_or(ApiError::NotFound)?;
            require_owner(claims, team.owner_id)?;
            let role = request.role.unwrap_or(TeamRole::Member);
            require_assignable(role)?;
            if let Some(recipient) = request.recipient_id {
                let members = store
                    .list_team_members(team.id)
                    .await
                    .map_err(ApiError::internal)?
                    .unwrap_or_default();
                if members
                    .iter()
                    .any(|m| m.user_id == recipient && m.left_at.is_none())
                {
                    return Err(ApiError::AlreadyTeamMember);
                }
            }
            Ok(Some(role))
        }
        InvitationType::TournamentTeam => {
            let team = store
                .find_tournament_team(request.resource_id)
                .await
                .map_err(ApiError::internal)?
                .ok_or(ApiError::NotFound)?;
            require_owner(claims, team.owner_id)?;
            let tournament = find_tournament(state, team.tournament_id).await?;
            if !matches!(
                tournament.status,
                TournamentStatus::Draft | TournamentStatus::Registration
            ) {
                return Err(ApiError::TournamentLocked);
            }
            let role = request.role.unwrap_or(TeamRole::Member);
            require_assignable(role)?;
            if let Some(recipient) = request.recipient_id {
                let members = store
                    .list_tournament_team_members(team.id)
                    .await
                    .map_err(ApiError::internal)?
                    .unwrap_or_default();
                if members.iter().any(|m| m.user_id == recipient) {
                    return Err(ApiError::PlayerAlreadyRegistered);
                }
            }
            Ok(Some(role))
        }
        InvitationType::Tournament => {
            let tournament = find_tournament(state, request.resource_id).await?;
            if !is_admin(state, claims).await? {
                return Err(ApiError::Forbidden);
            }
            if request.role.is_some() {
                return Err(ApiError::Validation(vec![(
                    "role",
                    "Une invitation à un tournoi n'a pas de rôle.".into(),
                )]));
            }
            if tournament.participant_type != ParticipantType::Solo {
                return Err(ApiError::Validation(vec![(
                    "resource_id",
                    "Seuls les tournois solo se rejoignent par invitation ; invitez dans l'équipe."
                        .into(),
                )]));
            }
            if !matches!(
                tournament.status,
                TournamentStatus::Draft | TournamentStatus::Registration
            ) {
                return Err(ApiError::RegistrationClosed);
            }
            if let Some(recipient) = request.recipient_id
                && active_participants(state, tournament.id)
                    .await?
                    .iter()
                    .any(|p| p.user_id == Some(recipient))
            {
                return Err(ApiError::AlreadyRegistered);
            }
            Ok(None)
        }
    }
}

/// L'invitation, si l'appelant en est l'invitant, l'invité ou un administrateur ; sinon elle
/// reste introuvable.
async fn visible_invitation(
    state: &AppState,
    claims: &Claims,
    id: Uuid,
) -> Result<Invitation, ApiError> {
    let invitation = state
        .store
        .find_invitation(id)
        .await
        .map_err(ApiError::internal)?
        .ok_or(ApiError::NotFound)?;
    let party = invitation.inviter_id == claims.sub || invitation.recipient_id == Some(claims.sub);
    if party || is_admin(state, claims).await? {
        Ok(invitation)
    } else {
        Err(ApiError::NotFound)
    }
}

async fn respond_as_recipient(
    state: &AppState,
    claims: &Claims,
    id: Uuid,
    action: InvitationAction,
) -> Result<HttpResponse, ApiError> {
    let invitation = state
        .store
        .find_invitation(id)
        .await
        .map_err(ApiError::internal)?
        // Seul l'invité répond : une invitation étrangère, ou par lien, reste introuvable.
        .filter(|i| i.recipient_id == Some(claims.sub))
        .ok_or(ApiError::NotFound)?;
    let invitation = respond(state, invitation.id, claims.sub, action).await?;
    Ok(HttpResponse::Ok().json(invitation))
}

async fn respond(
    state: &AppState,
    id: Uuid,
    actor: Uuid,
    action: InvitationAction,
) -> Result<Invitation, ApiError> {
    let result = state.store.respond_invitation(id, actor, action).await;
    if matches!(result, Err(StoreError::InvitationExpired)) {
        // L'expiration vient d'être enregistrée : l'annoncer.
        expire_due(state).await?;
        if let Ok(Some(invitation)) = state.store.find_invitation(id).await {
            publish(state, InvitationEventKind::Expired, &invitation, None);
        }
    }
    let invitation = result
        .map_err(invitation_error)?
        .ok_or(ApiError::NotFound)?;
    let kind = match action {
        InvitationAction::Accept => InvitationEventKind::Accepted,
        InvitationAction::Decline => InvitationEventKind::Declined,
        InvitationAction::Revoke => InvitationEventKind::Revoked,
    };
    publish(state, kind, &invitation, Some(actor));
    Ok(invitation)
}

/// Invitation par lien, encore utilisable ; tout autre cas est un 404 uniforme.
async fn usable_link(state: &AppState, token: &str) -> Result<Invitation, ApiError> {
    let invitation = state
        .store
        .find_invitation_by_token(&hash_token(token))
        .await
        .map_err(ApiError::internal)?
        .filter(|i| i.is_link)
        .ok_or(ApiError::NotFound)?;
    let exhausted = invitation
        .max_uses
        .is_some_and(|max| invitation.uses >= max);
    if invitation.status != InvitationStatus::Pending
        || exhausted
        || invitation.expires_at <= now_rfc3339()
    {
        return Err(ApiError::NotFound);
    }
    Ok(invitation)
}

async fn resource_name(
    state: &AppState,
    invitation: &Invitation,
) -> Result<Option<String>, ApiError> {
    let id = invitation.resource_id;
    let store = &state.store;
    Ok(match invitation.kind {
        InvitationType::Team => store
            .find_team(id)
            .await
            .map_err(ApiError::internal)?
            .map(|t| t.name),
        InvitationType::TournamentTeam => store
            .find_tournament_team(id)
            .await
            .map_err(ApiError::internal)?
            .map(|t| t.name),
        InvitationType::Tournament => store
            .find_tournament(id)
            .await
            .map_err(ApiError::internal)?
            .map(|t| t.name),
    })
}

fn invitation_error(err: StoreError) -> ApiError {
    match err {
        StoreError::InvitationDuplicate => ApiError::InvitationDuplicate,
        StoreError::InvitationNotPending => ApiError::InvitationNotPending,
        StoreError::InvitationExpired => ApiError::InvitationExpired,
        StoreError::InvitationUnavailable => ApiError::InvitationUnavailable,
        StoreError::AlreadyTeamMember => ApiError::AlreadyTeamMember,
        StoreError::PlayerAlreadyRegistered => ApiError::PlayerAlreadyRegistered,
        StoreError::AlreadyParticipant => ApiError::AlreadyRegistered,
        StoreError::TournamentFull => ApiError::TournamentFull,
        other => ApiError::internal(other),
    }
}
