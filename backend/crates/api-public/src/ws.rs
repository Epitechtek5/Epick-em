//! WebSocket temps réel : `GET /ws`.
//!
//! Un navigateur ne peut pas poser d'en-tête `Authorization` sur un WebSocket, et un jeton dans
//! l'URL finirait dans les journaux : le client s'authentifie par son **premier message**.
//!
//! ```text
//! client → {"type":"auth","token":"<access_token>"}      (dans les 10 s)
//! serveur → {"type":"ready","user_id":"…"}
//! client → {"type":"subscribe","topic":"tournament:<id>"}  (ou "leaderboard")
//! serveur → {"type":"subscribed","topic":"…"}
//! serveur → {"type":"event","topic":"…","event":"tournament.updated","data":{…}}
//! client → {"type":"unsubscribe","topic":"…"} | {"type":"ping"}
//! ```
//!
//! Les messages ne portent que des identifiants : le client relit l'API. Ils sont regroupés
//! toutes les [`FLUSH_EVERY`] et les doublons fusionnés (ADR-002, règle 5 : ne submerger ni les
//! clients ni les lecteurs d'écran). Si le client prend trop de retard, il reçoit
//! `{"type":"resync"}` et relit tout. La connexion se ferme à l'expiration du jeton (code
//! `4001`, le client se reconnecte avec un jeton rafraîchi) ou sans réponse aux pings.

use crate::auth::{AppState, Claims, decode_access_token};
use actix_web::{HttpRequest, HttpResponse, web};
use actix_ws::{AggregatedMessage, AggregatedMessageStream, CloseCode, CloseReason, Session};
use domain::events::{LiveMessage, topics};
use serde::Deserialize;
use serde_json::{Value, json};
use std::collections::HashSet;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tokio::sync::broadcast::error::RecvError;

/// Chemin du WebSocket.
pub const WS_PATH: &str = "/ws";
/// Délai pour s'authentifier après l'ouverture.
const AUTH_TIMEOUT: Duration = Duration::from_secs(10);
/// Regroupement des messages envoyés au client.
pub const FLUSH_EVERY: Duration = Duration::from_millis(250);
/// Intervalle des pings du serveur.
const HEARTBEAT: Duration = Duration::from_secs(30);
/// Sans réponse depuis ce délai, la connexion est fermée.
const CLIENT_TIMEOUT: Duration = Duration::from_secs(90);
/// Abonnements par connexion.
const MAX_TOPICS: usize = 50;
/// Taille maximale d'un message du client.
const MAX_MESSAGE: usize = 4 * 1024;
/// Fermeture pour authentification refusée ou jeton expiré.
const CLOSE_UNAUTHORIZED: u16 = 4001;

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum ClientMessage {
    Auth { token: String },
    Subscribe { topic: String },
    Unsubscribe { topic: String },
    Ping,
}

/// Ouvre la connexion et lance la session dans une tâche.
pub async fn connect(
    req: HttpRequest,
    body: web::Payload,
    state: web::Data<AppState>,
) -> Result<HttpResponse, actix_web::Error> {
    let (response, session, stream) = actix_ws::handle(&req, body)?;
    let stream = stream
        .max_frame_size(MAX_MESSAGE)
        .aggregate_continuations()
        .max_continuation_size(MAX_MESSAGE);
    actix_web::rt::spawn(run(state.into_inner(), session, stream));
    Ok(response)
}

fn close_reason(code: u16, description: &str) -> Option<CloseReason> {
    Some(CloseReason {
        code: CloseCode::Other(code),
        description: Some(description.into()),
    })
}

async fn send(session: &mut Session, value: Value) -> bool {
    session.text(value.to_string()).await.is_ok()
}

/// Attend le message d'authentification ; `None` si la connexion se ferme ou si le jeton est
/// refusé.
async fn authenticate(
    state: &AppState,
    session: &mut Session,
    stream: &mut AggregatedMessageStream,
) -> Option<Claims> {
    loop {
        match stream.recv().await? {
            Ok(AggregatedMessage::Text(text)) => {
                return match serde_json::from_str::<ClientMessage>(&text) {
                    Ok(ClientMessage::Auth { token }) => {
                        decode_access_token(&token, &state.config.jwt_secret)
                    }
                    _ => None,
                };
            }
            Ok(AggregatedMessage::Ping(bytes)) => {
                let _ = session.pong(&bytes).await;
            }
            Ok(AggregatedMessage::Pong(_)) => {}
            _ => return None,
        }
    }
}

/// Instant d'expiration du jeton, vu par l'horloge monotone.
fn expiry(claims: &Claims) -> tokio::time::Instant {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or_default();
    tokio::time::Instant::now() + Duration::from_secs(claims.exp.saturating_sub(now))
}

/// Ajoute le message à envoyer, sauf s'il y est déjà.
fn queue(pending: &mut Vec<LiveMessage>, message: LiveMessage) {
    if let Some(previous) = pending.iter_mut().find(|m| m.topic == message.topic && m.event == message.event) {
        // Keep only common identifiers: differing match IDs broaden the invalidation to the topic.
        if previous.data != message.data {
            if let (Some(old), Some(new)) = (previous.data.as_object_mut(), message.data.as_object()) {
                old.retain(|key, value| new.get(key) == Some(value));
            } else { previous.data = json!({}); }
        }
    } else {
        pending.push(message);
    }
}

async fn run(
    state: std::sync::Arc<AppState>,
    mut session: Session,
    mut stream: AggregatedMessageStream,
) {
    let claims = match tokio::time::timeout(
        AUTH_TIMEOUT,
        authenticate(&state, &mut session, &mut stream),
    )
    .await
    {
        Ok(Some(claims)) => claims,
        _ => {
            let _ = session
                .close(close_reason(CLOSE_UNAUTHORIZED, "unauthorized"))
                .await;
            return;
        }
    };
    if !send(
        &mut session,
        json!({ "type": "ready", "user_id": claims.sub }),
    )
    .await
    {
        return;
    }

    let mut messages = state.live.subscribe();
    let mut topics_of: HashSet<String> = HashSet::new();
    let mut pending: Vec<LiveMessage> = Vec::new();
    let mut flush = tokio::time::interval(FLUSH_EVERY);
    let mut heartbeat = tokio::time::interval(HEARTBEAT);
    let mut last_seen = Instant::now();
    let expires = tokio::time::sleep_until(expiry(&claims));
    tokio::pin!(expires);

    let reason = loop {
        tokio::select! {
            incoming = stream.recv() => {
                last_seen = Instant::now();
                let reply = match incoming {
                    Some(Ok(AggregatedMessage::Text(text))) => {
                        match serde_json::from_str::<ClientMessage>(&text) {
                            Ok(ClientMessage::Subscribe { topic }) => {
                                if !topics::is_valid(&topic) {
                                    json!({ "type": "error", "message": "sujet inconnu" })
                                } else if topics_of.len() >= MAX_TOPICS && !topics_of.contains(&topic) {
                                    json!({ "type": "error", "message": "trop d'abonnements" })
                                } else {
                                    topics_of.insert(topic.clone());
                                    json!({ "type": "subscribed", "topic": topic })
                                }
                            }
                            Ok(ClientMessage::Unsubscribe { topic }) => {
                                topics_of.remove(&topic);
                                pending.retain(|m| m.topic != topic);
                                json!({ "type": "unsubscribed", "topic": topic })
                            }
                            Ok(ClientMessage::Ping) => json!({ "type": "pong" }),
                            Ok(ClientMessage::Auth { .. }) => {
                                json!({ "type": "error", "message": "déjà authentifié" })
                            }
                            Err(_) => json!({ "type": "error", "message": "message illisible" }),
                        }
                    }
                    Some(Ok(AggregatedMessage::Ping(bytes))) => {
                        if session.pong(&bytes).await.is_err() {
                            break None;
                        }
                        continue;
                    }
                    Some(Ok(AggregatedMessage::Pong(_))) => continue,
                    Some(Ok(AggregatedMessage::Binary(_))) => {
                        json!({ "type": "error", "message": "messages texte JSON uniquement" })
                    }
                    Some(Ok(AggregatedMessage::Close(reason))) => break reason,
                    Some(Err(_)) | None => break None,
                };
                if !send(&mut session, reply).await {
                    break None;
                }
            }
            received = messages.recv() => match received {
                Ok(message) if message.is_resync() => {
                    pending.clear();
                    if !send(&mut session, json!({ "type": "resync" })).await { break None; }
                }
                Ok(message) if topics_of.contains(&message.topic) => queue(&mut pending, message),
                Ok(_) => {}
                Err(RecvError::Lagged(_)) => {
                    // Des messages ont été perdus : le client relit tout.
                    pending.clear();
                    if !send(&mut session, json!({ "type": "resync" })).await {
                        break None;
                    }
                }
                Err(RecvError::Closed) => break None,
            },
            _ = flush.tick() => {
                let mut sent = true;
                for message in pending.drain(..) {
                    let value = json!({
                        "type": "event", "topic": message.topic,
                        "event": message.event, "data": message.data,
                    });
                    if !send(&mut session, value).await {
                        sent = false;
                        break;
                    }
                }
                if !sent {
                    break None;
                }
            }
            _ = heartbeat.tick() => {
                if last_seen.elapsed() > CLIENT_TIMEOUT || session.ping(b"").await.is_err() {
                    break None;
                }
            }
            _ = &mut expires => break close_reason(CLOSE_UNAUTHORIZED, "token_expired"),
        }
    };
    let _ = session.close(reason).await;
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn batches_by_topic_and_event_without_losing_scope() {
        let mut pending = vec![];
        queue(&mut pending, LiveMessage::new("tournament:a", "tournament.updated", json!({"tournament_id":"a", "match_id":"one"})));
        queue(&mut pending, LiveMessage::new("tournament:a", "tournament.updated", json!({"tournament_id":"a", "match_id":"two"})));
        queue(&mut pending, LiveMessage::new("tournament:a", "predictions.updated", json!({"tournament_id":"a"})));
        queue(&mut pending, LiveMessage::new("tournament:b", "tournament.updated", json!({"tournament_id":"b"})));
        assert_eq!(pending.len(), 3);
        assert_eq!(pending[0].data, json!({"tournament_id":"a"}));
    }
}
