//! Événements métier et temps réel (ADR-002).
//!
//! - **Publication** : après chaque écriture réussie sur un tournoi (`/tournaments/{id}/…`), le
//!   middleware [`publish_changes`] publie un [`Event`] dans le flux (Redis Streams) et diffuse
//!   `tournament.updated` (Redis Pub/Sub) aux clients WebSocket abonnés au tournoi. Un nouvel
//!   instantané d'une source externe fait de même ([`StoreProjector`](crate::projection)).
//! - **Consommation** : api-internal lit le flux ([`consume`]) et, pour chaque tournoi modifié,
//!   résout aussitôt les pronostics ([`handle_event`]) puis diffuse `leaderboard.updated` si des
//!   points ont changé. Un événement n'est acquitté qu'une fois traité ; rejouer ne change rien,
//!   la résolution recalculant tout à partir de l'état.
//!
//! La publication ne fait jamais échouer la requête : si Redis ne répond pas, l'erreur est
//! journalisée et la résolution périodique d'api-internal rattrape le retard.

use crate::auth::AppState;
use crate::predictions::spectator_owned;
use crate::resolution::{ResolutionReport, resolve_tournament};
use crate::store::{AuthStore, StoreError};
use actix_web::body::BoxBody;
use actix_web::dev::{ServiceRequest, ServiceResponse};
use actix_web::http::Method;
use actix_web::middleware::Next;
use actix_web::{Error, web};
use domain::events::{ChangeCause, Event, EventKind, LiveMessage, live, topics};
use infra::{EventBus, EventStream, LiveBus};
use serde_json::json;
use std::time::Duration;
use uuid::Uuid;

/// Événements lus par passage.
const READ_BATCH: usize = 32;
/// Attente d'un nouvel événement avant de relire le flux.
const READ_BLOCK: Duration = Duration::from_secs(5);

/// Instant présent en millisecondes Unix.
pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or_default()
}

/// Nouvel événement, horodaté maintenant.
pub fn event(kind: EventKind) -> Event {
    Event::new(Uuid::new_v4(), now_ms(), kind)
}

/// Ce qu'une écriture réussie change, d'après son chemin.
#[derive(Debug, PartialEq)]
enum Change {
    /// Données du tournoi (résultats, matchs, étapes, statut…).
    Tournament {
        tournament_id: Uuid,
        match_id: Option<Uuid>,
    },
    /// Tournoi supprimé.
    Deleted(Uuid),
    /// Pronostic d'un spectateur sur un match.
    Prediction { tournament_id: Uuid, match_id: Uuid },
}

fn change_of(method: &Method, path: &str) -> Option<Change> {
    if matches!(*method, Method::GET | Method::HEAD | Method::OPTIONS) {
        return None;
    }
    let segments: Vec<&str> = path.trim_matches('/').split('/').collect();
    let tournament_id = match segments.as_slice() {
        ["tournaments", id, ..] => id.parse::<Uuid>().ok()?,
        _ => return None,
    };
    if let ["tournaments", _, "matches", match_id, "prediction"] = segments.as_slice() {
        return Some(Change::Prediction {
            tournament_id,
            match_id: match_id.parse().ok()?,
        });
    }
    // Le Pick'em ne change ni les données du tournoi ni les points déjà acquis.
    if spectator_owned(path) {
        return None;
    }
    if segments.len() == 2 && *method == Method::DELETE {
        return Some(Change::Deleted(tournament_id));
    }
    let match_id = segments
        .iter()
        .position(|s| *s == "matches")
        .and_then(|i| segments.get(i + 1))
        .and_then(|id| id.parse().ok());
    Some(Change::Tournament {
        tournament_id,
        match_id,
    })
}

/// Publie l'événement ; une panne de Redis est journalisée sans faire échouer l'appelant.
pub async fn publish(events: &dyn EventBus, event: &Event) {
    if let Err(err) = events.publish(event).await {
        eprintln!(
            "bus : publication de l'événement {} impossible : {err}",
            event.id
        );
    }
}

/// Diffuse le message ; une panne de Redis est journalisée sans faire échouer l'appelant.
pub async fn broadcast(live: &dyn LiveBus, message: LiveMessage) {
    if let Err(err) = live.broadcast(&message).await {
        eprintln!("bus : diffusion de {} impossible : {err}", message.event);
    }
}

/// Signale un changement des données d'un tournoi : événement dans le flux et message temps
/// réel.
pub async fn tournament_changed(
    events: &dyn EventBus,
    live: &dyn LiveBus,
    tournament_id: Uuid,
    match_id: Option<Uuid>,
    cause: ChangeCause,
) {
    publish(
        events,
        &event(EventKind::TournamentChanged {
            tournament_id,
            match_id,
            cause,
        }),
    )
    .await;
    broadcast(
        live,
        LiveMessage::new(
            topics::tournament(tournament_id),
            live::TOURNAMENT_UPDATED,
            json!({ "tournament_id": tournament_id, "match_id": match_id, "cause": cause }),
        ),
    )
    .await;
}

/// Après une écriture réussie sur un tournoi, publie l'événement et prévient les abonnés.
pub async fn publish_changes(
    req: ServiceRequest,
    next: Next<BoxBody>,
) -> Result<ServiceResponse<BoxBody>, Error> {
    let change = change_of(req.method(), req.path());
    let state = change
        .as_ref()
        .and_then(|_| req.app_data::<web::Data<AppState>>().cloned());
    let response = next.call(req).await?;
    let (Some(change), Some(state)) = (change, state) else {
        return Ok(response);
    };
    if !response.status().is_success() {
        return Ok(response);
    }
    let (events, live) = (state.events.as_ref(), state.live.as_ref());
    match change {
        Change::Tournament {
            tournament_id,
            match_id,
        } => tournament_changed(events, live, tournament_id, match_id, ChangeCause::Api).await,
        Change::Deleted(tournament_id) => {
            publish(
                events,
                &event(EventKind::TournamentDeleted { tournament_id }),
            )
            .await;
            broadcast(
                live,
                LiveMessage::new(
                    topics::tournament(tournament_id),
                    live::TOURNAMENT_DELETED,
                    json!({ "tournament_id": tournament_id }),
                ),
            )
            .await;
        }
        Change::Prediction {
            tournament_id,
            match_id,
        } => {
            broadcast(
                live,
                LiveMessage::new(
                    topics::tournament(tournament_id),
                    live::PREDICTIONS_UPDATED,
                    json!({ "tournament_id": tournament_id, "match_id": match_id }),
                ),
            )
            .await;
        }
    }
    Ok(response)
}

/// Prévient les abonnés quand une résolution a changé des points.
pub async fn announce(live: &dyn LiveBus, report: &ResolutionReport) {
    crate::pickem_live::announce(live, report).await;
}

/// Traite un événement : résout les pronostics du tournoi modifié et prévient les abonnés si
/// des points ont changé.
pub async fn handle_event(
    store: &dyn AuthStore,
    live: &dyn LiveBus,
    event: &Event,
) -> Result<Option<ResolutionReport>, StoreError> {
    match &event.kind {
        EventKind::TournamentChanged { tournament_id, .. } => {
            let report = resolve_tournament(store, *tournament_id).await?;
            if let Some(report) = &report {
                announce(live, report).await;
            }
            Ok(report)
        }
        // Pronostics et réponses partent avec le tournoi (clés étrangères).
        EventKind::TournamentDeleted { tournament_id } => {
            broadcast(
                live,
                LiveMessage::new(
                    topics::LEADERBOARD,
                    live::LEADERBOARD_UPDATED,
                    json!({"tournament_id": tournament_id}),
                ),
            )
            .await;
            Ok(None)
        }
    }
}

/// Lit un lot d'événements, les traite et acquitte ceux qui l'ont été ; un événement en échec
/// reste en attente et sera repris. Renvoie le nombre d'événements acquittés.
pub async fn consume_once(
    store: &dyn AuthStore,
    stream: &dyn EventStream,
    live: &dyn LiveBus,
    block: Duration,
) -> Result<usize, infra::BusError> {
    let deliveries = stream.read(READ_BATCH, block).await?;
    let mut done = Vec::with_capacity(deliveries.len());
    // Un tournoi modifié plusieurs fois dans le lot n'est résolu qu'une fois.
    let mut resolved: Vec<(Uuid, bool)> = Vec::new();
    for delivery in deliveries {
        let Some(event) = delivery.event else {
            eprintln!("bus : événement {} illisible, ignoré", delivery.id);
            done.push(delivery.id);
            continue;
        };
        let tournament_id = event.tournament_id();
        let key = (
            tournament_id,
            matches!(event.kind, EventKind::TournamentDeleted { .. }),
        );
        if resolved.contains(&key) {
            done.push(delivery.id);
            continue;
        }
        match handle_event(store, live, &event).await {
            Ok(_) => {
                resolved.push(key);
                done.push(delivery.id);
            }
            Err(err) => eprintln!(
                "bus : échec du traitement de l'événement {} (tournoi {tournament_id}) : {err}",
                event.id
            ),
        }
    }
    stream.ack(&done).await?;
    Ok(done.len())
}

/// Consomme le flux sans fin (api-internal).
pub async fn consume(store: &dyn AuthStore, stream: &dyn EventStream, live: &dyn LiveBus) {
    loop {
        if let Err(err) = consume_once(store, stream, live, READ_BLOCK).await {
            eprintln!("bus : lecture du flux impossible : {err}");
            tokio::time::sleep(Duration::from_secs(1)).await;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_are_mapped_to_changes() {
        let (t, m) = (Uuid::new_v4(), Uuid::new_v4());
        let s = Uuid::new_v4();
        assert_eq!(change_of(&Method::GET, &format!("/tournaments/{t}")), None);
        assert_eq!(
            change_of(&Method::PATCH, &format!("/tournaments/{t}")),
            Some(Change::Tournament {
                tournament_id: t,
                match_id: None
            })
        );
        assert_eq!(
            change_of(&Method::DELETE, &format!("/tournaments/{t}")),
            Some(Change::Deleted(t))
        );
        assert_eq!(
            change_of(
                &Method::POST,
                &format!("/tournaments/{t}/steps/{s}/matches/{m}/status")
            ),
            Some(Change::Tournament {
                tournament_id: t,
                match_id: Some(m)
            })
        );
        assert_eq!(
            change_of(
                &Method::PUT,
                &format!("/tournaments/{t}/matches/{m}/prediction")
            ),
            Some(Change::Prediction {
                tournament_id: t,
                match_id: m
            })
        );
        assert_eq!(
            change_of(
                &Method::PUT,
                &format!("/tournaments/{t}/pickem/questions/{m}/answer")
            ),
            None
        );
        assert_eq!(change_of(&Method::POST, "/tournaments"), None);
        assert_eq!(change_of(&Method::POST, "/tournaments/import"), None);
    }
}
