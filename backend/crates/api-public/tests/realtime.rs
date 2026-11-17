//! Temps réel : publication des changements sur le bus, consommation du flux (résolution des
//! pronostics) et WebSocket `/ws`, sur le bus et le store en mémoire.

mod common;

use actix_http::ws::{CloseCode, Frame, Message};
use actix_web::http::StatusCode;
use actix_web::test::{self, TestRequest};
use api_public::auth::Claims;
use api_public::config::AuthConfig;
use api_public::realtime::consume_once;
use api_public::store::{AuthStore, MemoryStore, Role};
use api_public::{AppState, app};
use common::{SECRET, access, call, logged_in_as, login, request};
use domain::events::{ChangeCause, EventKind, LiveMessage, topics};
use futures_util::{SinkExt, StreamExt};
use infra::{EventBus, LiveBus, MemoryBus, MemoryLive};
use serde_json::{Value, json};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use uuid::Uuid;

fn config() -> AuthConfig {
    AuthConfig {
        jwt_secret: SECRET.into(),
        access_token_ttl: Duration::from_secs(900),
        refresh_token_ttl: Duration::from_secs(3600),
    }
}

fn state(store: Arc<MemoryStore>, events: Arc<MemoryBus>, live: Arc<MemoryLive>) -> AppState {
    common::with_test_mailer(
        AppState::new(store, config())
            .unwrap()
            .with_bus(events, live),
    )
}

fn token(exp_in: i64) -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;
    let claims = Claims {
        sub: Uuid::new_v4(),
        username: "fan".into(),
        role: Role::User,
        iat: now as u64,
        exp: (now + exp_in).max(0) as u64,
    };
    jsonwebtoken::encode(
        &jsonwebtoken::Header::default(),
        &claims,
        &jsonwebtoken::EncodingKey::from_secret(SECRET.as_bytes()),
    )
    .unwrap()
}

#[actix_web::test]
async fn tournament_writes_are_published_on_the_bus() {
    let store = Arc::new(MemoryStore::new());
    let (events, live) = (Arc::new(MemoryBus::new()), Arc::new(MemoryLive::new()));
    let app = test::init_service(app(state(store.clone(), events.clone(), live.clone()))).await;
    logged_in_as(&app, "root", "secret123").await;
    store.set_role("root", Role::Admin);
    let (_, session) = login(&app, "root", "secret123").await;
    let admin = access(&session).to_string();
    let send = |method: TestRequest, path: String, body: Option<Value>| {
        let request = request(method, &path, Some(&admin));
        match body {
            Some(body) => request.set_json(body),
            None => request,
        }
    };
    let (_, game) = call(
        &app,
        send(
            TestRequest::post(),
            "/games".into(),
            Some(json!({ "name": "TFT" })),
        ),
    )
    .await;
    let (status, tournament) = call(
        &app,
        send(
            TestRequest::post(),
            "/tournaments".into(),
            Some(json!({
                "game_id": game["id"], "name": "Open", "start_date": "2026-11-20T18:00:00Z",
                "end_date": "2026-11-21T18:00:00Z", "participant_type": "solo",
                "max_participants": 8,
            })),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    // Créer un tournoi ne concerne encore aucun abonné.
    assert!(events.published().is_empty());
    let id: Uuid = tournament["id"].as_str().unwrap().parse().unwrap();
    let mut messages = live.subscribe();

    let (status, _) = call(
        &app,
        send(
            TestRequest::patch(),
            format!("/tournaments/{id}"),
            Some(json!({ "description": "Finale à 18 h" })),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let published = events.published();
    assert_eq!(published.len(), 1);
    assert_eq!(
        published[0].kind,
        EventKind::TournamentChanged {
            tournament_id: id,
            match_id: None,
            cause: ChangeCause::Api
        }
    );
    let message = messages.recv().await.unwrap();
    assert_eq!(message.topic, topics::tournament(id));
    assert_eq!(message.event, "tournament.updated");

    // Une écriture refusée ne publie rien.
    let (status, _) = call(
        &app,
        send(
            TestRequest::patch(),
            format!("/tournaments/{}", Uuid::new_v4()),
            Some(json!({ "description": "x" })),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(events.published().len(), 1);

    let (status, _) = call(
        &app,
        send(TestRequest::delete(), format!("/tournaments/{id}"), None),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert_eq!(
        events.published()[1].kind,
        EventKind::TournamentDeleted { tournament_id: id }
    );
    assert_eq!(messages.recv().await.unwrap().event, "tournament.deleted");
}

#[actix_web::test]
async fn consuming_the_stream_resolves_and_acknowledges() {
    let store = Arc::new(MemoryStore::new());
    let (events, live) = (Arc::new(MemoryBus::new()), Arc::new(MemoryLive::new()));
    // Un tournoi inconnu se traite sans erreur ; l'événement est acquitté.
    let unknown = api_public::realtime::event(EventKind::TournamentChanged {
        tournament_id: Uuid::new_v4(),
        match_id: None,
        cause: ChangeCause::Api,
    });
    events.publish(&unknown).await.unwrap();
    events.publish(&unknown).await.unwrap();
    let done = consume_once(
        store.as_ref() as &dyn AuthStore,
        events.as_ref(),
        live.as_ref(),
        Duration::ZERO,
    )
    .await
    .unwrap();
    assert_eq!(done, 2);
    assert_eq!(events.in_flight(), 0);
}

type Conn<T> = actix_codec::Framed<T, actix_http::ws::Codec>;

async fn next_text<T: actix_codec::AsyncRead + actix_codec::AsyncWrite + Unpin>(
    conn: &mut Conn<T>,
    within: Duration,
) -> Option<Value> {
    loop {
        match tokio::time::timeout(within, conn.next()).await {
            Ok(Some(Ok(Frame::Text(bytes)))) => return serde_json::from_slice(&bytes).ok(),
            Ok(Some(Ok(Frame::Ping(_) | Frame::Pong(_)))) => continue,
            _ => return None,
        }
    }
}

async fn say<T: actix_codec::AsyncRead + actix_codec::AsyncWrite + Unpin>(
    conn: &mut Conn<T>,
    value: Value,
) {
    conn.send(Message::Text(value.to_string().into()))
        .await
        .unwrap();
}

#[actix_web::test]
async fn websocket_requires_a_token_first() {
    let store = Arc::new(MemoryStore::new());
    let (events, live) = (Arc::new(MemoryBus::new()), Arc::new(MemoryLive::new()));
    let state = state(store, events, live);
    let mut srv = actix_test::start(move || app(state.clone()));

    for first in [
        json!({ "type": "subscribe", "topic": "leaderboard" }),
        json!({ "type": "auth", "token": "pas-un-jeton" }),
        json!({ "type": "auth", "token": token(-60) }),
    ] {
        let mut conn = srv.ws_at("/ws").await.unwrap();
        say(&mut conn, first.clone()).await;
        match tokio::time::timeout(Duration::from_secs(2), conn.next()).await {
            Ok(Some(Ok(Frame::Close(Some(reason))))) => {
                assert_eq!(reason.code, CloseCode::Other(4001), "{first}")
            }
            other => panic!("{first} : fermeture attendue, reçu {other:?}"),
        }
    }
}

#[actix_web::test]
async fn websocket_relays_subscribed_topics_once() {
    let store = Arc::new(MemoryStore::new());
    let (events, live) = (Arc::new(MemoryBus::new()), Arc::new(MemoryLive::new()));
    let state = state(store, events, live.clone());
    let mut srv = actix_test::start(move || app(state.clone()));
    let mut conn = srv.ws_at("/ws").await.unwrap();
    say(&mut conn, json!({ "type": "auth", "token": token(600) })).await;
    let ready = next_text(&mut conn, Duration::from_secs(2)).await.unwrap();
    assert_eq!(ready["type"], "ready");

    let (watched, other) = (Uuid::new_v4(), Uuid::new_v4());
    say(&mut conn, json!({ "type": "subscribe", "topic": "users" })).await;
    assert_eq!(
        next_text(&mut conn, Duration::from_secs(2)).await.unwrap()["type"],
        "error"
    );
    say(
        &mut conn,
        json!({ "type": "subscribe", "topic": topics::tournament(watched) }),
    )
    .await;
    assert_eq!(
        next_text(&mut conn, Duration::from_secs(2)).await.unwrap()["type"],
        "subscribed"
    );
    say(&mut conn, json!({ "type": "ping" })).await;
    assert_eq!(
        next_text(&mut conn, Duration::from_secs(2)).await.unwrap()["type"],
        "pong"
    );

    // Trois fois le même message en rafale : un seul envoi. Rien pour un autre tournoi.
    let update = LiveMessage::new(
        topics::tournament(watched),
        "tournament.updated",
        json!({ "tournament_id": watched }),
    );
    for _ in 0..3 {
        live.broadcast(&update).await.unwrap();
    }
    live.broadcast(&LiveMessage::new(
        topics::tournament(other),
        "tournament.updated",
        json!({ "tournament_id": other }),
    ))
    .await
    .unwrap();
    let event = next_text(&mut conn, Duration::from_secs(2)).await.unwrap();
    assert_eq!(event["type"], "event");
    assert_eq!(event["event"], "tournament.updated");
    assert_eq!(event["data"]["tournament_id"], watched.to_string());
    assert!(
        next_text(&mut conn, Duration::from_millis(600))
            .await
            .is_none()
    );

    // Pub/Sub reconnection control bypasses topic filters and tells the same socket to reload.
    live.broadcast(&LiveMessage::resync()).await.unwrap();
    assert_eq!(
        next_text(&mut conn, Duration::from_secs(2)).await.unwrap()["type"],
        "resync"
    );

    // Désabonné : plus rien.
    say(
        &mut conn,
        json!({ "type": "unsubscribe", "topic": topics::tournament(watched) }),
    )
    .await;
    assert_eq!(
        next_text(&mut conn, Duration::from_secs(2)).await.unwrap()["type"],
        "unsubscribed"
    );
    live.broadcast(&update).await.unwrap();
    assert!(
        next_text(&mut conn, Duration::from_millis(600))
            .await
            .is_none()
    );
}

#[actix_web::test]
async fn deletion_invalidates_global_scores_even_after_an_update_in_the_same_batch() {
    let store = MemoryStore::new();
    let events = MemoryBus::new();
    let live = MemoryLive::new();
    let mut messages = live.subscribe();
    let tournament_id = Uuid::new_v4();
    events
        .publish(&api_public::realtime::event(EventKind::TournamentChanged {
            tournament_id,
            match_id: None,
            cause: ChangeCause::Api,
        }))
        .await
        .unwrap();
    events
        .publish(&api_public::realtime::event(EventKind::TournamentDeleted {
            tournament_id,
        }))
        .await
        .unwrap();
    events
        .publish(&api_public::realtime::event(EventKind::TournamentDeleted {
            tournament_id,
        }))
        .await
        .unwrap();
    assert_eq!(
        consume_once(&store, &events, &live, Duration::ZERO)
            .await
            .unwrap(),
        3
    );
    let message = messages.recv().await.unwrap();
    assert_eq!(message.topic, topics::LEADERBOARD);
    assert_eq!(message.event, "leaderboard.updated");
    assert!(messages.try_recv().is_err());
    assert_eq!(events.in_flight(), 0);
}
