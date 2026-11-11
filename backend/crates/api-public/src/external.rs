//! Tournois externes (ADR-003) : recherche et résolution d'URL dans les sources configurées
//! (start.gg…), import d'un tournoi en lecture seule, état de synchronisation et
//! resynchronisation à la demande. Réservé aux administrateurs, sauf `GET
//! /tournaments/{id}/source` (attribution de la source, ouverte à tout compte).
//!
//! Un tournoi importé est **géré par sa source** : le middleware [`protect_external`] refuse
//! toute écriture sur lui (`409 externally_managed`) — réglages, inscriptions, équipes, étapes,
//! matchs et import de fichier. Il se supprime par `DELETE /external-tournaments/{id}`.
//!
//! La synchronisation elle-même (planification, curseurs, reprise, événements de résultat) est
//! dans la crate `connectors` ; api-internal la lance périodiquement.

use crate::auth::{AppState, Claims};
use crate::error::{ApiError, ErrorResponse};
use crate::store::{
    ParticipantType, StoreError, TeamScoringMode, TournamentInput, unix_to_rfc3339,
};
use crate::users::require_admin;
use actix_web::body::BoxBody;
use actix_web::dev::{ServiceRequest, ServiceResponse};
use actix_web::http::Method;
use actix_web::middleware::Next;
use actix_web::{Error, HttpResponse, ResponseError, delete, get, post, web};
use connectors::model::{Capabilities, ExternalEventRef, ExternalTournamentRef};
use connectors::sync::{NewSource, SourceRecord, SyncError};
use connectors::{ConnectorError, TournamentConnector};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use utoipa::{IntoParams, ToSchema};
use utoipa_actix_web::service_config::ServiceConfig;
use uuid::Uuid;

const NAME_MAX: usize = 128;
const QUERY_MIN: usize = 2;
const QUERY_MAX: usize = 100;
const EVENTS_MAX: usize = 20;
const MAX_PARTICIPANTS_LIMIT: u32 = 10_000;

/// Routes des tournois externes, avec leur documentation OpenAPI.
pub fn routes(cfg: &mut ServiceConfig) {
    cfg.service(list_connectors)
        .service(search)
        .service(resolve)
        .service(list_sources)
        .service(get_source)
        .service(import)
        .service(sync_now)
        .service(remove)
        .service(tournament_source);
}

/// Secondes Unix de l'instant présent.
fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or_default()
}

fn timestamp(secs: i64) -> String {
    unix_to_rfc3339(secs, 0)
}

/// Erreur d'un connecteur, vue par le client. Le détail technique (jeton refusé, réponse
/// illisible…) est journalisé, jamais renvoyé.
fn connector_error(err: ConnectorError) -> ApiError {
    match err {
        ConnectorError::InvalidUrl(why) => {
            ApiError::Validation(vec![("url", format!("URL non reconnue : {why}."))])
        }
        ConnectorError::NotFound => ApiError::NotFound,
        ConnectorError::Unsupported(what) => ApiError::Validation(vec![(
            "provider",
            format!("Cette source ne permet pas : {what}."),
        )]),
        other => {
            eprintln!("api-public : source externe indisponible : {other}");
            ApiError::ExternalUnavailable
        }
    }
}

fn sync_error(err: SyncError) -> ApiError {
    match err {
        SyncError::UnknownProvider(_) => ApiError::Validation(vec![(
            "provider",
            "Source inconnue ou non configurée.".to_string(),
        )]),
        SyncError::Connector(err) => connector_error(err),
        SyncError::Store(connectors::sync::StoreError::Conflict) => ApiError::AlreadyImported,
        SyncError::Store(err) => ApiError::internal(err),
        SyncError::Busy => ApiError::SyncInProgress,
        SyncError::NotFound => ApiError::NotFound,
    }
}

fn store_error(err: connectors::sync::StoreError) -> ApiError {
    ApiError::internal(err)
}

fn connector(state: &AppState, provider: &str) -> Result<Arc<dyn TournamentConnector>, ApiError> {
    state
        .sync
        .registry()
        .get(provider)
        .ok_or(ApiError::NotFound)
}

/// Source configurée.
#[derive(Serialize, ToSchema)]
struct ConnectorInfo {
    #[schema(example = "startgg")]
    id: &'static str,
    #[schema(example = "start.gg")]
    display_name: &'static str,
    /// Ce que la source sait fournir (`search`, `url_resolution`, `phases`, `groups`,
    /// `matches`, `games`, `characters`, `stages`, `seeds`, `standings`, `incremental_sync`).
    #[schema(value_type = Object)]
    capabilities: Capabilities,
}

/// Liste les sources configurées sur ce serveur (administrateur).
#[utoipa::path(
    get,
    path = "/connectors",
    tag = "external-tournaments",
    security(("bearer" = [])),
    responses(
        (status = 200, description = "Sources configurées", body = [ConnectorInfo]),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 403, description = "Réservé aux administrateurs", body = ErrorResponse),
    ),
)]
#[get("/connectors")]
async fn list_connectors(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
) -> Result<HttpResponse, ApiError> {
    require_admin(&state, &claims).await?;
    let connectors: Vec<ConnectorInfo> = state
        .sync
        .registry()
        .all()
        .iter()
        .map(|c| ConnectorInfo {
            id: c.id(),
            display_name: c.display_name(),
            capabilities: c.capabilities(),
        })
        .collect();
    Ok(HttpResponse::Ok().json(connectors))
}

#[derive(Deserialize, IntoParams)]
struct SearchQuery {
    /// Texte recherché dans le nom des tournois (2 à 100 caractères).
    #[serde(default)]
    q: String,
}

/// Tournoi trouvé chez une source (documentation : le modèle canonique est sérialisé tel quel).
#[derive(ToSchema)]
#[allow(dead_code)]
struct TournamentRefSchema {
    #[schema(example = "startgg")]
    provider: String,
    external_id: String,
    slug: Option<String>,
    name: String,
    url: Option<String>,
    /// Début, en secondes Unix.
    starts_at: Option<i64>,
    ends_at: Option<i64>,
}

/// Épreuve d'un tournoi externe (documentation).
#[derive(ToSchema)]
#[allow(dead_code)]
struct EventRefSchema {
    external_id: String,
    name: String,
    game: Option<String>,
    url: Option<String>,
    starts_at: Option<i64>,
    #[schema(example = "created")]
    state: String,
    entrant_count: Option<u32>,
}

/// Cherche des tournois par nom chez une source (administrateur).
#[utoipa::path(
    get,
    path = "/connectors/{provider}/tournaments",
    tag = "external-tournaments",
    security(("bearer" = [])),
    params(("provider" = String, Path, example = "startgg"), SearchQuery),
    responses(
        (status = 200, description = "Tournois trouvés", body = [TournamentRefSchema]),
        (status = 400, description = "Recherche trop courte ou trop longue, ou non prise en charge", body = ErrorResponse),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 403, description = "Réservé aux administrateurs", body = ErrorResponse),
        (status = 404, description = "Source inconnue", body = ErrorResponse),
        (status = 503, description = "Source momentanément indisponible", body = ErrorResponse),
    ),
)]
#[get("/connectors/{provider}/tournaments")]
async fn search(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    provider: web::Path<String>,
    query: web::Query<SearchQuery>,
) -> Result<HttpResponse, ApiError> {
    require_admin(&state, &claims).await?;
    let connector = connector(&state, &provider)?;
    let q = query.q.trim();
    if !(QUERY_MIN..=QUERY_MAX).contains(&q.chars().count()) {
        return Err(ApiError::Validation(vec![(
            "q",
            format!("La recherche doit contenir entre {QUERY_MIN} et {QUERY_MAX} caractères."),
        )]));
    }
    let found = connector.search(q).await.map_err(connector_error)?;
    Ok(HttpResponse::Ok().json(found))
}

#[derive(Deserialize, ToSchema)]
struct ResolveRequest {
    /// Page du tournoi chez la source (`https://www.start.gg/tournament/<slug>`), ou
    /// `jsonfile://<nom>` pour la source de démonstration.
    #[serde(default)]
    #[schema(
        required = true,
        example = "https://www.start.gg/tournament/genesis-10"
    )]
    url: String,
}

#[derive(Serialize, ToSchema)]
struct ResolveResponse {
    #[schema(value_type = TournamentRefSchema)]
    tournament: ExternalTournamentRef,
    #[schema(value_type = Vec<EventRefSchema>)]
    events: Vec<ExternalEventRef>,
    /// Identifiant local si ce tournoi est déjà importé.
    already_imported: Option<Uuid>,
}

fn check_url(url: &str) -> Result<&str, ApiError> {
    let url = url.trim();
    if url.is_empty() || url.len() > 2048 {
        return Err(ApiError::Validation(vec![(
            "url",
            "Indiquez l'adresse du tournoi (2048 caractères au plus).".to_string(),
        )]));
    }
    Ok(url)
}

async fn find_existing(
    state: &AppState,
    reference: &ExternalTournamentRef,
) -> Result<Option<SourceRecord>, ApiError> {
    Ok(state
        .sync
        .store()
        .list()
        .await
        .map_err(store_error)?
        .into_iter()
        .find(|s| s.provider == reference.provider && s.external_id == reference.external_id))
}

/// Reconnaît l'URL d'un tournoi et liste ses épreuves, à choisir avant l'import
/// (administrateur). Seuls les hôtes des sources configurées sont acceptés ; l'URL n'est
/// jamais appelée telle quelle.
#[utoipa::path(
    post,
    path = "/connectors/resolve",
    tag = "external-tournaments",
    security(("bearer" = [])),
    request_body = ResolveRequest,
    responses(
        (status = 200, description = "Tournoi et épreuves", body = ResolveResponse),
        (status = 400, description = "URL non reconnue par les sources configurées", body = ErrorResponse),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 403, description = "Réservé aux administrateurs", body = ErrorResponse),
        (status = 404, description = "Tournoi introuvable chez la source", body = ErrorResponse),
        (status = 503, description = "Source momentanément indisponible", body = ErrorResponse),
    ),
)]
#[post("/connectors/resolve")]
async fn resolve(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    body: web::Json<ResolveRequest>,
) -> Result<HttpResponse, ApiError> {
    require_admin(&state, &claims).await?;
    let url = check_url(&body.url)?;
    let (connector, reference) = state
        .sync
        .registry()
        .resolve_url(url)
        .await
        .map_err(connector_error)?;
    let events = connector
        .list_events(&reference)
        .await
        .map_err(connector_error)?;
    let already_imported = find_existing(&state, &reference)
        .await?
        .and_then(|s| s.tournament_id);
    Ok(HttpResponse::Ok().json(ResolveResponse {
        tournament: reference,
        events,
        already_imported,
    }))
}

/// Tournoi externe importé et état de sa synchronisation.
#[derive(Serialize, ToSchema)]
struct SourceView {
    id: Uuid,
    #[schema(example = "startgg")]
    provider: String,
    external_id: String,
    name: String,
    /// Page de l'original, à citer avec les données affichées.
    url: Option<String>,
    /// Tournoi local en lecture seule.
    tournament_id: Option<Uuid>,
    event_ids: Vec<String>,
    /// État de la compétition chez la source (`created`, `active`, `completed`), d'après le
    /// dernier instantané.
    #[schema(example = "active")]
    state: Option<String>,
    #[schema(value_type = Object)]
    capabilities: Capabilities,
    /// Horodatages RFC 3339 en UTC.
    last_attempt_at: Option<String>,
    last_success_at: Option<String>,
    next_sync_at: String,
    /// Dernière erreur de synchronisation ; les données servies sont alors celles du dernier
    /// instantané réussi (`stale`).
    last_error: Option<String>,
    consecutive_failures: u32,
    stale: bool,
    /// Dernier instantané réussi (épreuves, phases, groupes, inscrits, matchs, classements),
    /// seulement dans le détail.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<Object>)]
    snapshot: Option<serde_json::Value>,
}

impl SourceView {
    fn new(record: SourceRecord, with_snapshot: bool) -> Self {
        let stale = record.is_stale();
        let state = record.snapshot.as_ref().map(|s| {
            serde_json::to_value(s.state)
                .ok()
                .and_then(|v| v.as_str().map(str::to_string))
                .unwrap_or_default()
        });
        let snapshot = if with_snapshot {
            record
                .snapshot
                .as_ref()
                .and_then(|s| serde_json::to_value(s).ok())
        } else {
            None
        };
        SourceView {
            id: record.id,
            provider: record.provider,
            external_id: record.external_id,
            name: record.reference.name,
            url: record.reference.url,
            tournament_id: record.tournament_id,
            event_ids: record.event_ids,
            state,
            capabilities: record.capabilities,
            last_attempt_at: record.last_attempt_at.map(timestamp),
            last_success_at: record.last_success_at.map(timestamp),
            next_sync_at: timestamp(record.next_sync_at),
            last_error: record.last_error,
            consecutive_failures: record.consecutive_failures,
            stale,
            snapshot,
        }
    }
}

/// Liste les tournois externes importés et l'état de leur synchronisation (administrateur).
#[utoipa::path(
    get,
    path = "/external-tournaments",
    tag = "external-tournaments",
    security(("bearer" = [])),
    responses(
        (status = 200, description = "Tournois externes, sans instantané", body = [SourceView]),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 403, description = "Réservé aux administrateurs", body = ErrorResponse),
    ),
)]
#[get("/external-tournaments")]
async fn list_sources(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
) -> Result<HttpResponse, ApiError> {
    require_admin(&state, &claims).await?;
    let sources: Vec<SourceView> = state
        .sync
        .store()
        .list()
        .await
        .map_err(store_error)?
        .into_iter()
        .map(|s| SourceView::new(s, false))
        .collect();
    Ok(HttpResponse::Ok().json(sources))
}

async fn find_source(state: &AppState, id: Uuid) -> Result<SourceRecord, ApiError> {
    state
        .sync
        .store()
        .find(id)
        .await
        .map_err(store_error)?
        .ok_or(ApiError::NotFound)
}

/// Détail d'un tournoi externe, avec son dernier instantané (administrateur).
#[utoipa::path(
    get,
    path = "/external-tournaments/{id}",
    tag = "external-tournaments",
    security(("bearer" = [])),
    params(("id" = Uuid, Path)),
    responses(
        (status = 200, description = "Tournoi externe", body = SourceView),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 403, description = "Réservé aux administrateurs", body = ErrorResponse),
        (status = 404, description = "Tournoi externe introuvable", body = ErrorResponse),
    ),
)]
#[get("/external-tournaments/{id}")]
async fn get_source(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    id: web::Path<Uuid>,
) -> Result<HttpResponse, ApiError> {
    require_admin(&state, &claims).await?;
    let record = find_source(&state, *id).await?;
    Ok(HttpResponse::Ok().json(SourceView::new(record, true)))
}

#[derive(Deserialize, ToSchema)]
struct ImportRequest {
    /// Page du tournoi chez la source.
    #[serde(default)]
    #[schema(
        required = true,
        example = "https://www.start.gg/tournament/genesis-10"
    )]
    url: String,
    /// Épreuves à importer (`external_id` renvoyés par `POST /connectors/resolve`).
    #[serde(default)]
    #[schema(required = true, min_items = 1, max_items = 20)]
    event_ids: Vec<String>,
    /// Jeu local auquel rattacher le tournoi.
    game_id: Uuid,
    /// Nom local ; par défaut celui de la source.
    name: Option<String>,
}

/// Importe un tournoi externe : crée le tournoi local en lecture seule, enregistre la source
/// et prend un premier instantané (administrateur). Un tournoi déjà importé n'est pas dupliqué
/// (`409 already_imported`). Si la source ne répond pas, rien n'est créé.
#[utoipa::path(
    post,
    path = "/external-tournaments",
    tag = "external-tournaments",
    security(("bearer" = [])),
    request_body = ImportRequest,
    responses(
        (status = 201, description = "Tournoi importé et synchronisé", body = SourceView),
        (status = 400, description = "URL, épreuves ou jeu invalides (`errors` détaille)", body = ErrorResponse),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 403, description = "Réservé aux administrateurs", body = ErrorResponse),
        (status = 404, description = "Tournoi introuvable chez la source", body = ErrorResponse),
        (status = 409, description = "Déjà importé, ou nom local déjà pris pour ce jeu", body = ErrorResponse),
        (status = 503, description = "Source momentanément indisponible", body = ErrorResponse),
    ),
)]
#[post("/external-tournaments")]
async fn import(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    body: web::Json<ImportRequest>,
) -> Result<HttpResponse, ApiError> {
    require_admin(&state, &claims).await?;
    let request = body.into_inner();
    let url = check_url(&request.url)?;
    let mut event_ids: Vec<String> = request
        .event_ids
        .iter()
        .map(|e| e.trim().to_string())
        .filter(|e| !e.is_empty())
        .collect();
    event_ids.sort();
    event_ids.dedup();
    if !(1..=EVENTS_MAX).contains(&event_ids.len()) {
        return Err(ApiError::Validation(vec![(
            "event_ids",
            format!("Choisissez entre 1 et {EVENTS_MAX} épreuves."),
        )]));
    }
    if state
        .store
        .find_game(request.game_id)
        .await
        .map_err(ApiError::internal)?
        .is_none()
    {
        return Err(ApiError::Validation(vec![(
            "game_id",
            "Jeu introuvable.".to_string(),
        )]));
    }

    let (connector, reference) = state
        .sync
        .registry()
        .resolve_url(url)
        .await
        .map_err(connector_error)?;
    if find_existing(&state, &reference).await?.is_some() {
        return Err(ApiError::AlreadyImported);
    }
    let events = connector
        .list_events(&reference)
        .await
        .map_err(connector_error)?;
    let unknown: Vec<&str> = event_ids
        .iter()
        .filter(|id| !events.iter().any(|e| &e.external_id == *id))
        .map(String::as_str)
        .collect();
    if !unknown.is_empty() {
        return Err(ApiError::Validation(vec![(
            "event_ids",
            format!("Épreuves inconnues de ce tournoi : {}.", unknown.join(", ")),
        )]));
    }

    let tournament = state
        .store
        .create_tournament(local_tournament(
            &request,
            &reference,
            connector.display_name(),
            &events,
            &event_ids,
        ))
        .await
        .map_err(|err| match err {
            StoreError::TournamentNameTaken => ApiError::TournamentNameTaken,
            other => ApiError::internal(other),
        })?;
    let source = NewSource {
        reference,
        event_ids,
        tournament_id: Some(tournament.id),
    };
    match state.sync.import(source, now()).await {
        Ok((record, true)) => Ok(HttpResponse::Created().json(SourceView::new(record, true))),
        outcome => {
            // Doublon concurrent ou premier instantané impossible : on ne garde rien.
            if let Ok(Some(record)) = state.sync.store().find_by_tournament(tournament.id).await {
                let _ = state.sync.store().delete(record.id).await;
            }
            if let Err(err) = state.store.delete_tournament(tournament.id).await {
                eprintln!(
                    "api-public : tournoi local {} non supprimé après un import échoué : {err}",
                    tournament.id
                );
            }
            Err(match outcome {
                Ok(_) => ApiError::AlreadyImported,
                Err(err) => sync_error(err),
            })
        }
    }
}

/// Tournoi local qui représente la source : brouillon, sans inscriptions ouvertes, dates et
/// capacité reprises de la source.
fn local_tournament(
    request: &ImportRequest,
    reference: &ExternalTournamentRef,
    source_name: &str,
    events: &[ExternalEventRef],
    event_ids: &[String],
) -> TournamentInput {
    let name: String = request
        .name
        .as_deref()
        .map(str::trim)
        .filter(|n| !n.is_empty())
        .unwrap_or(&reference.name)
        .chars()
        .take(NAME_MAX)
        .collect();
    let start = reference.starts_at.unwrap_or_else(now);
    let end = reference.ends_at.unwrap_or(start).max(start);
    let entrants: u32 = events
        .iter()
        .filter(|e| event_ids.contains(&e.external_id))
        .filter_map(|e| e.entrant_count)
        .sum();
    let description = match &reference.url {
        Some(url) => format!("Importé depuis {source_name} : {url}"),
        None => format!("Importé depuis {source_name}"),
    };
    TournamentInput {
        game_id: request.game_id,
        name,
        description: Some(description),
        start_date: timestamp(start),
        end_date: timestamp(end),
        registration_open_at: None,
        registration_close_at: None,
        participant_type: ParticipantType::Solo,
        team_size: None,
        max_participants: entrants.clamp(1, MAX_PARTICIPANTS_LIMIT) as i32,
        team_scoring_mode: TeamScoringMode::None,
        team_scoring_n: None,
    }
}

/// Resynchronise un tournoi externe maintenant (administrateur). En cas d'échec de la source,
/// la réponse est quand même `200` : le dernier instantané reste servi, marqué `stale`, avec
/// l'erreur et la date de la prochaine tentative.
#[utoipa::path(
    post,
    path = "/external-tournaments/{id}/sync",
    tag = "external-tournaments",
    security(("bearer" = [])),
    params(("id" = Uuid, Path)),
    responses(
        (status = 200, description = "État après la synchronisation", body = SourceView),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 403, description = "Réservé aux administrateurs", body = ErrorResponse),
        (status = 404, description = "Tournoi externe introuvable", body = ErrorResponse),
        (status = 409, description = "Synchronisation déjà en cours", body = ErrorResponse),
    ),
)]
#[post("/external-tournaments/{id}/sync")]
async fn sync_now(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    id: web::Path<Uuid>,
) -> Result<HttpResponse, ApiError> {
    require_admin(&state, &claims).await?;
    find_source(&state, *id).await?;
    state.sync.sync_one(*id, now()).await.map_err(sync_error)?;
    let record = find_source(&state, *id).await?;
    Ok(HttpResponse::Ok().json(SourceView::new(record, true)))
}

/// Supprime un tournoi externe : la source, ses événements et le tournoi local
/// (administrateur).
#[utoipa::path(
    delete,
    path = "/external-tournaments/{id}",
    tag = "external-tournaments",
    security(("bearer" = [])),
    params(("id" = Uuid, Path)),
    responses(
        (status = 204, description = "Supprimé"),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 403, description = "Réservé aux administrateurs", body = ErrorResponse),
        (status = 404, description = "Tournoi externe introuvable", body = ErrorResponse),
    ),
)]
#[delete("/external-tournaments/{id}")]
async fn remove(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    id: web::Path<Uuid>,
) -> Result<HttpResponse, ApiError> {
    require_admin(&state, &claims).await?;
    let record = find_source(&state, *id).await?;
    state
        .sync
        .store()
        .delete(record.id)
        .await
        .map_err(store_error)?;
    if let Some(tournament_id) = record.tournament_id {
        state
            .store
            .delete_tournament(tournament_id)
            .await
            .map_err(ApiError::internal)?;
    }
    Ok(HttpResponse::NoContent().finish())
}

/// Origine d'un tournoi importé, à afficher avec ses données.
#[derive(Serialize, ToSchema)]
struct TournamentSource {
    #[schema(example = "startgg")]
    provider: String,
    #[schema(example = "start.gg")]
    provider_name: String,
    url: Option<String>,
    last_success_at: Option<String>,
    /// Les données affichées datent du dernier instantané réussi : la source n'a pas répondu
    /// depuis.
    stale: bool,
}

/// Source d'un tournoi importé (tout compte) ; `404` si le tournoi est géré localement.
#[utoipa::path(
    get,
    path = "/tournaments/{id}/source",
    tag = "external-tournaments",
    security(("bearer" = [])),
    params(("id" = Uuid, Path)),
    responses(
        (status = 200, description = "Source du tournoi", body = TournamentSource),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 404, description = "Tournoi local ou introuvable", body = ErrorResponse),
    ),
)]
#[get("/tournaments/{id}/source")]
async fn tournament_source(
    state: web::Data<AppState>,
    id: web::Path<Uuid>,
) -> Result<HttpResponse, ApiError> {
    let record = state
        .sync
        .store()
        .find_by_tournament(*id)
        .await
        .map_err(store_error)?
        .ok_or(ApiError::NotFound)?;
    let provider_name = state
        .sync
        .registry()
        .get(&record.provider)
        .map(|c| c.display_name().to_string())
        .unwrap_or_else(|| record.provider.clone());
    Ok(HttpResponse::Ok().json(TournamentSource {
        stale: record.is_stale(),
        provider: record.provider,
        provider_name,
        url: record.reference.url,
        last_success_at: record.last_success_at.map(timestamp),
    }))
}

/// Tournoi local visé par une écriture, s'il y en a un : `/tournaments/{id}/…` ou
/// `/tournament-teams/{id}/…`.
async fn written_tournament(state: &AppState, path: &str) -> Result<Option<Uuid>, ApiError> {
    let mut segments = path.trim_start_matches('/').split('/');
    let (Some(resource), Some(id)) = (segments.next(), segments.next()) else {
        return Ok(None);
    };
    let Ok(id) = id.parse::<Uuid>() else {
        return Ok(None);
    };
    match resource {
        "tournaments" => Ok(Some(id)),
        "tournament-teams" => Ok(state
            .store
            .find_tournament_team(id)
            .await
            .map_err(ApiError::internal)?
            .map(|team| team.tournament_id)),
        _ => Ok(None),
    }
}

/// Le tournoi est-il géré par une source externe ?
pub(crate) async fn is_external(state: &AppState, tournament_id: Uuid) -> Result<bool, ApiError> {
    Ok(state
        .sync
        .store()
        .find_by_tournament(tournament_id)
        .await
        .map_err(store_error)?
        .is_some())
}

/// Refuse toute écriture sur un tournoi géré par une source externe (`409
/// externally_managed`) : ses données viennent de la synchronisation, pas de l'API.
pub async fn protect_external(
    req: ServiceRequest,
    next: Next<BoxBody>,
) -> Result<ServiceResponse<BoxBody>, Error> {
    let read = matches!(*req.method(), Method::GET | Method::HEAD | Method::OPTIONS);
    if read || !req.resource_map().has_resource(req.path()) {
        return next.call(req).await;
    }
    let Some(state) = req.app_data::<web::Data<AppState>>().cloned() else {
        return next.call(req).await;
    };
    let verdict = match written_tournament(&state, req.path()).await {
        Ok(Some(id)) => is_external(&state, id).await,
        Ok(None) => Ok(false),
        Err(err) => Err(err),
    };
    match verdict {
        Ok(false) => next.call(req).await,
        Ok(true) => Ok(req.into_response(ApiError::ExternallyManaged.error_response())),
        Err(err) => Ok(req.into_response(err.error_response())),
    }
}
