//! Parcours HTTP des tournois externes : sources, résolution d'URL, import en lecture seule,
//! resynchronisation (panne et reprise) et suppression, avec un connecteur factice.

mod common;

use actix_web::http::StatusCode;
use actix_web::test::{self, TestRequest};
use api_public::config::AuthConfig;
use api_public::projection::StoreProjector;
use api_public::store::{AuthStore, MemoryStore, PgStore, Role};
use api_public::{AppState, app};
use async_trait::async_trait;
use common::{access, call, logged_in_as, login, request};
use connectors::model::{
    BracketFormat, Capabilities, CompetitionState, ExternalEntrant, ExternalEvent,
    ExternalEventRef, ExternalGroup, ExternalMatch, ExternalPhase, ExternalSlot, ExternalStanding,
    ExternalTournament, ExternalTournamentRef, MatchState,
};
use connectors::sync::{MemorySyncStore, RedisSyncStore, SyncPolicy, SyncService, SyncStore};
use connectors::{ConnectorError, ConnectorRegistry, TournamentConnector};
use serde_json::{Value, json};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

macro_rules! app_type {
    () => {
        impl actix_web::dev::Service<
            actix_http::Request,
            Response = actix_web::dev::ServiceResponse<impl actix_web::body::MessageBody>,
            Error = actix_web::Error,
        >
    };
}

const URL: &str = "https://fake.test/t/winter-cup";

/// Source factice : un seul tournoi (`winter-cup`, épreuves `main` et `side`), qui peut tomber
/// en panne à la demande. L'épreuve `main` a un tableau à élimination simple, Alice contre Bob,
/// dont le set se termine à la demande (`finished`).
struct FakeSource {
    down: AtomicBool,
    finished: AtomicBool,
    paused: AtomicBool,
}

fn reference() -> ExternalTournamentRef {
    ExternalTournamentRef {
        provider: "fake".into(),
        external_id: "42".into(),
        slug: Some("winter-cup".into()),
        name: "Winter Cup".into(),
        url: Some(URL.into()),
        starts_at: Some(1_767_225_600),
        ends_at: Some(1_767_312_000),
    }
}

fn event(id: &str) -> ExternalEventRef {
    ExternalEventRef {
        external_id: id.into(),
        name: format!("Épreuve {id}"),
        game: Some("Rocket League".into()),
        url: None,
        starts_at: None,
        state: CompetitionState::Active,
        entrant_count: Some(16),
    }
}

impl FakeSource {
    fn main_event(&self) -> ExternalEvent {
        let finished = self.finished.load(Ordering::SeqCst);
        let state = if finished {
            CompetitionState::Completed
        } else {
            CompetitionState::Active
        };
        let entrant = |id: &str, name: &str, seed| ExternalEntrant {
            external_id: id.into(),
            name: name.into(),
            seed: Some(seed),
            players: Vec::new(),
        };
        let slot = |id: &str, score| ExternalSlot {
            entrant_id: Some(id.into()),
            score: finished.then_some(score),
        };
        ExternalEvent {
            reference: event("main"),
            phases: vec![ExternalPhase {
                external_id: "bracket".into(),
                name: "Top 2".into(),
                order: Some(1),
                format: Some(BracketFormat::SingleElimination),
                state,
                groups: vec![ExternalGroup {
                    external_id: "g1".into(),
                    label: Some("A".into()),
                    format: Some(BracketFormat::SingleElimination),
                    state,
                    url: None,
                }],
            }],
            entrants: vec![entrant("a", "Alice", 1), entrant("b", "Bob", 2)],
            matches: vec![ExternalMatch {
                external_id: "final".into(),
                phase_id: Some("bracket".into()),
                group_id: Some("g1".into()),
                round: Some(1),
                round_label: Some("Finale".into()),
                state: if finished {
                    MatchState::Completed
                } else {
                    MatchState::Pending
                },
                slots: vec![slot("a", 3), slot("b", 1)],
                winner_entrant_id: finished.then(|| "a".into()),
                forfeit: false,
                games: Vec::new(),
                started_at: None,
                completed_at: finished.then_some(1_767_300_000),
                updated_at: None,
                url: None,
            }],
            standings: if finished {
                vec![
                    ExternalStanding {
                        entrant_id: "a".into(),
                        placement: 1,
                    },
                    ExternalStanding {
                        entrant_id: "b".into(),
                        placement: 2,
                    },
                ]
            } else {
                Vec::new()
            },
        }
    }

    fn check(&self) -> Result<(), ConnectorError> {
        if self.down.load(Ordering::SeqCst) {
            Err(ConnectorError::Unavailable("HTTP 503".into()))
        } else {
            Ok(())
        }
    }
}

#[async_trait]
impl TournamentConnector for FakeSource {
    fn id(&self) -> &'static str {
        "fake"
    }

    fn display_name(&self) -> &'static str {
        "Fake"
    }

    fn capabilities(&self) -> Capabilities {
        Capabilities {
            search: true,
            url_resolution: true,
            matches: true,
            ..Capabilities::default()
        }
    }

    async fn search(&self, query: &str) -> Result<Vec<ExternalTournamentRef>, ConnectorError> {
        self.check()?;
        Ok(if "winter cup".contains(&query.to_lowercase()) {
            vec![reference()]
        } else {
            Vec::new()
        })
    }

    async fn resolve_url(&self, url: &str) -> Result<ExternalTournamentRef, ConnectorError> {
        match url.strip_prefix("https://fake.test/t/") {
            Some("winter-cup") => {
                self.check()?;
                Ok(reference())
            }
            Some(_) => Err(ConnectorError::NotFound),
            None => Err(ConnectorError::InvalidUrl("hôte inconnu".into())),
        }
    }

    async fn list_events(
        &self,
        _: &ExternalTournamentRef,
    ) -> Result<Vec<ExternalEventRef>, ConnectorError> {
        self.check()?;
        Ok(vec![event("main"), event("side")])
    }

    async fn fetch(
        &self,
        tournament: &ExternalTournamentRef,
        event_ids: &[String],
    ) -> Result<ExternalTournament, ConnectorError> {
        while self.paused.load(Ordering::SeqCst) {
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
        self.check()?;
        Ok(ExternalTournament {
            reference: tournament.clone(),
            state: if self.finished.load(Ordering::SeqCst) {
                CompetitionState::Completed
            } else {
                CompetitionState::Active
            },
            events: event_ids
                .iter()
                .map(|id| match id.as_str() {
                    "main" => self.main_event(),
                    _ => ExternalEvent {
                        reference: event(id),
                        phases: Vec::new(),
                        entrants: Vec::new(),
                        matches: Vec::new(),
                        standings: Vec::new(),
                    },
                })
                .collect(),
        })
    }
}

struct Setup {
    source: Arc<FakeSource>,
    admin: String,
    player: String,
    game: String,
}

async fn send(
    app: &app_type!(),
    method: TestRequest,
    path: &str,
    token: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let request = request(method, path, Some(token));
    call(
        app,
        match body {
            Some(body) => request.set_json(body),
            None => request,
        },
    )
    .await
}

async fn get(app: &app_type!(), path: &str, token: &str) -> (StatusCode, Value) {
    send(app, TestRequest::get(), path, token, None).await
}

async fn post(app: &app_type!(), path: &str, token: &str, body: Value) -> (StatusCode, Value) {
    send(app, TestRequest::post(), path, token, Some(body)).await
}

/// L'application sur `store` et `sync_store`, avec la source factice ; `promote` rend `root`
/// administrateur.
async fn build<F: std::future::Future<Output = ()>>(
    store: Arc<dyn AuthStore>,
    sync_store: Arc<dyn SyncStore>,
    root: &str,
    promote: impl FnOnce(String) -> F,
) -> (app_type!(), Setup) {
    let source = Arc::new(FakeSource {
        down: AtomicBool::new(false),
        finished: AtomicBool::new(false),
        paused: AtomicBool::new(false),
    });
    let sync = SyncService::new(
        ConnectorRegistry::new().register(source.clone()),
        sync_store,
        SyncPolicy::default(),
    )
    .with_projector(Arc::new(StoreProjector::new(store.clone())));
    let config = AuthConfig {
        jwt_secret: common::SECRET.into(),
        access_token_ttl: Duration::from_secs(900),
        refresh_token_ttl: Duration::from_secs(3600),
    };
    let state = common::with_test_mailer(
        AppState::new(store, config)
            .unwrap()
            .with_sync(Arc::new(sync)),
    );
    let app = test::init_service(app(state)).await;
    logged_in_as(&app, root, "secret123").await;
    promote(root.to_string()).await;
    let (_, session) = login(&app, root, "secret123").await;
    let admin = access(&session).to_string();
    let player_name = format!("{root}-joueur");
    let player = access(&logged_in_as(&app, &player_name, "secret123").await).to_string();
    let (status, game) = post(
        &app,
        "/games",
        &admin,
        json!({ "name": format!("Rocket League {root}") }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{game}");
    let game = game["id"].as_str().unwrap().to_string();
    (
        app,
        Setup {
            source,
            admin,
            player,
            game,
        },
    )
}

async fn setup() -> (app_type!(), Setup) {
    let store = Arc::new(MemoryStore::new());
    let promoted = store.clone();
    let cache = store.imports().cache();
    build(
        store,
        Arc::new(MemorySyncStore::new().with_projection_cache(cache)),
        "root",
        |name| async move { promoted.set_role(&name, Role::Admin) },
    )
    .await
}

async fn import(app: &app_type!(), s: &Setup) -> Value {
    let (status, body) = post(
        app,
        "/external-tournaments",
        &s.admin,
        json!({ "url": URL, "event_ids": ["main"], "game_id": s.game }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    body
}

#[actix_web::test]
async fn sources_and_resolution_are_reserved_to_admins() {
    let (app, s) = setup().await;
    let (status, _) = get(&app, "/connectors", &s.player).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = call(&app, request(TestRequest::get(), "/connectors", None)).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);

    let (status, body) = get(&app, "/connectors", &s.admin).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body[0]["id"], "fake");
    assert_eq!(body[0]["capabilities"]["search"], true);

    let (status, body) = get(&app, "/connectors/fake/tournaments?q=winter", &s.admin).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body[0]["name"], "Winter Cup");
    let (status, body) = get(&app, "/connectors/fake/tournaments?q=w", &s.admin).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(body["errors"]["q"].is_string());
    let (status, _) = get(&app, "/connectors/autre/tournaments?q=winter", &s.admin).await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    let (status, body) = post(&app, "/connectors/resolve", &s.admin, json!({ "url": URL })).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["tournament"]["external_id"], "42");
    assert_eq!(body["events"].as_array().unwrap().len(), 2);
    assert_eq!(body["already_imported"], Value::Null);

    for url in [
        "https://evil.example/t/winter-cup",
        "",
        "file:///etc/passwd",
    ] {
        let (status, body) =
            post(&app, "/connectors/resolve", &s.admin, json!({ "url": url })).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{url} {body}");
        assert!(body["errors"]["url"].is_string());
    }
    let (status, _) = post(
        &app,
        "/connectors/resolve",
        &s.admin,
        json!({ "url": "https://fake.test/t/inconnu" }),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = post(
        &app,
        "/connectors/resolve",
        &s.player,
        json!({ "url": URL }),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[actix_web::test]
async fn background_import_returns_before_fetching_and_publishes_results_later() {
    let (app, s) = setup().await;
    s.source.paused.store(true, Ordering::SeqCst);
    let body = json!({ "url": URL, "event_ids": ["main"], "game_id": s.game });
    let (status, queued) = tokio::time::timeout(
        Duration::from_secs(1),
        post(
            &app,
            "/external-tournaments?background=true",
            &s.admin,
            body.clone(),
        ),
    )
    .await
    .expect("Import must not wait for the provider snapshot");
    assert_eq!(status, StatusCode::ACCEPTED, "{queued}");
    assert!(queued.get("snapshot").is_none());
    assert!(queued["last_success_at"].is_null());
    let id = queued["tournament_id"].as_str().unwrap();
    let path = format!("/tournaments/{id}/source?details=true");
    let (_, pending) = get(&app, &path, &s.player).await;
    assert!(pending["snapshot"].is_null());
    let (status, _) = post(
        &app,
        "/external-tournaments?background=true",
        &s.admin,
        body,
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    s.source.paused.store(false, Ordering::SeqCst);
    tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            let (_, ready) = get(&app, &path, &s.player).await;
            if !ready["snapshot"].is_null() {
                assert!(!ready["last_success_at"].is_null());
                break;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .expect("Background import must eventually publish the snapshot");
}

#[actix_web::test]
async fn background_import_keeps_failed_sources_for_retry() {
    let (app, s) = setup().await;
    s.source.paused.store(true, Ordering::SeqCst);
    let (status, queued) = post(
        &app,
        "/external-tournaments?background=true",
        &s.admin,
        json!({ "url": URL, "event_ids": ["main"], "game_id": s.game }),
    )
    .await;
    assert_eq!(status, StatusCode::ACCEPTED);
    s.source.down.store(true, Ordering::SeqCst);
    s.source.paused.store(false, Ordering::SeqCst);
    let path = format!(
        "/tournaments/{}/source?details=true",
        queued["tournament_id"].as_str().unwrap()
    );
    tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            let (status, failed) = get(&app, &path, &s.player).await;
            assert_eq!(status, StatusCode::OK);
            if failed["stale"] == true {
                break;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .unwrap();
    s.source.down.store(false, Ordering::SeqCst);
    let (status, recovered) = post(
        &app,
        &format!(
            "/external-tournaments/{}/sync",
            queued["id"].as_str().unwrap()
        ),
        &s.admin,
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(recovered["stale"], false);
    assert!(!recovered["snapshot"].is_null());
}

#[actix_web::test]
async fn import_creates_a_read_only_tournament_once() {
    let (app, s) = setup().await;
    let source = import(&app, &s).await;
    assert_eq!(source["provider"], "fake");
    assert_eq!(source["name"], "Winter Cup");
    assert_eq!(source["stale"], false);
    assert_eq!(source["state"], "active");
    assert_eq!(source["snapshot"]["events"][0]["external_id"], "main");
    let tournament = source["tournament_id"].as_str().unwrap().to_string();

    let (status, local) = get(&app, &format!("/tournaments/{tournament}"), &s.player).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(local["name"], "Winter Cup");
    // Le statut suit la source (épreuve en cours).
    assert_eq!(local["status"], "ongoing");
    assert_eq!(local["start_date"], "2026-01-01T00:00:00.000000Z");
    assert_eq!(local["max_participants"], 16);
    assert!(local["description"].as_str().unwrap().contains(URL));

    // Même tournoi, même par une autre épreuve : pas de doublon.
    let (status, body) = post(
        &app,
        "/external-tournaments",
        &s.admin,
        json!({ "url": URL, "event_ids": ["side"], "game_id": s.game, "name": "Autre" }),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(body["error"], "already_imported");
    let (_, body) = post(&app, "/connectors/resolve", &s.admin, json!({ "url": URL })).await;
    assert_eq!(body["already_imported"], tournament.as_str());
    let (_, list) = get(&app, "/external-tournaments", &s.admin).await;
    assert_eq!(list.as_array().unwrap().len(), 1);
    assert!(list[0].get("snapshot").is_none());

    // Lecture seule : réglages, inscriptions, barème, étapes, suppression directe.
    for (method, path, body) in [
        (
            TestRequest::patch(),
            format!("/tournaments/{tournament}"),
            json!({ "name": "Renommé" }),
        ),
        (
            TestRequest::post(),
            format!("/tournaments/{tournament}/participants"),
            json!({}),
        ),
        (
            TestRequest::post(),
            format!("/tournaments/{tournament}/status"),
            json!({ "status": "registration_open" }),
        ),
        (
            TestRequest::post(),
            format!("/tournaments/{tournament}/steps"),
            json!({}),
        ),
        (
            TestRequest::delete(),
            format!("/tournaments/{tournament}"),
            Value::Null,
        ),
    ] {
        let (status, body) = send(&app, method, &path, &s.admin, Some(body)).await;
        assert_eq!(status, StatusCode::CONFLICT, "{path} {body}");
        assert_eq!(body["error"], "externally_managed", "{path}");
    }
    let (_, local_after) = get(&app, &format!("/tournaments/{tournament}"), &s.admin).await;
    assert_eq!(local_after["name"], "Winter Cup");

    // L'attribution est visible de tous les comptes.
    let (status, origin) = get(
        &app,
        &format!("/tournaments/{tournament}/source"),
        &s.player,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(origin["provider_name"], "Fake");
    assert_eq!(origin["url"], URL);
    assert_eq!(origin["stale"], false);
    assert_eq!(origin["id"], source["id"]);
    assert!(origin["snapshot"].is_null());
    let (status, details) = get(
        &app,
        &format!("/tournaments/{tournament}/source?details=true"),
        &s.player,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(details["snapshot"], source["snapshot"]);
    assert_eq!(details["capabilities"], source["capabilities"]);
    assert!(details.get("last_error").is_none());
    assert!(details.get("next_sync_at").is_none());
}

#[actix_web::test]
async fn local_tournaments_stay_writable() {
    let (app, s) = setup().await;
    import(&app, &s).await;
    let (status, local) = post(
        &app,
        "/tournaments",
        &s.admin,
        json!({
            "game_id": s.game,
            "name": "Locale",
            "start_date": "2026-03-01T10:00:00Z",
            "end_date": "2026-03-02T10:00:00Z",
            "participant_type": "solo",
            "max_participants": 8,
        }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{local}");
    let id = local["id"].as_str().unwrap();
    let (status, body) = send(
        &app,
        TestRequest::patch(),
        &format!("/tournaments/{id}"),
        &s.admin,
        Some(json!({ "name": "Locale 2" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let (status, _) = get(&app, &format!("/tournaments/{id}/source"), &s.admin).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[actix_web::test]
async fn import_validates_its_input() {
    let (app, s) = setup().await;
    for (body, field) in [
        (
            json!({ "url": URL, "event_ids": [], "game_id": s.game }),
            "event_ids",
        ),
        (
            json!({ "url": URL, "event_ids": ["inconnue"], "game_id": s.game }),
            "event_ids",
        ),
        (
            json!({ "url": URL, "event_ids": ["main"], "game_id": uuid::Uuid::new_v4() }),
            "game_id",
        ),
        (
            json!({ "url": "https://evil.example/x", "event_ids": ["main"], "game_id": s.game }),
            "url",
        ),
    ] {
        let (status, response) = post(&app, "/external-tournaments", &s.admin, body).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{response}");
        assert!(response["errors"][field].is_string(), "{response}");
    }
    let (_, list) = get(&app, "/external-tournaments", &s.admin).await;
    assert_eq!(list, json!([]));
}

#[actix_web::test]
async fn a_source_outage_keeps_the_last_snapshot_and_recovers() {
    let (app, s) = setup().await;
    let source = import(&app, &s).await;
    let id = source["id"].as_str().unwrap().to_string();
    let tournament = source["tournament_id"].as_str().unwrap().to_string();

    s.source.down.store(true, Ordering::SeqCst);
    let (status, during) = post(
        &app,
        &format!("/external-tournaments/{id}/sync"),
        &s.admin,
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{during}");
    assert_eq!(during["stale"], true);
    assert_eq!(during["consecutive_failures"], 1);
    assert!(during["last_error"].as_str().unwrap().contains("503"));
    assert_eq!(during["snapshot"], source["snapshot"]);
    assert_eq!(during["last_success_at"], source["last_success_at"]);
    let (_, origin) = get(
        &app,
        &format!("/tournaments/{tournament}/source"),
        &s.player,
    )
    .await;
    assert_eq!(origin["stale"], true);
    let (_, cached) = get(
        &app,
        &format!("/tournaments/{tournament}/source?details=true"),
        &s.player,
    )
    .await;
    assert_eq!(cached["snapshot"], source["snapshot"]);
    assert_eq!(cached["last_success_at"], source["last_success_at"]);

    // Résolution impossible pendant la panne : 503 sans détail technique.
    let (status, body) = post(&app, "/connectors/resolve", &s.admin, json!({ "url": URL })).await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(body["error"], "external_unavailable");

    s.source.down.store(false, Ordering::SeqCst);
    let (status, after) = post(
        &app,
        &format!("/external-tournaments/{id}/sync"),
        &s.admin,
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(after["stale"], false);
    assert_eq!(after["last_error"], Value::Null);
    assert_eq!(after["consecutive_failures"], 0);
}

#[actix_web::test]
async fn a_failed_first_import_leaves_nothing_behind() {
    let (app, s) = setup().await;
    s.source.down.store(true, Ordering::SeqCst);
    let (status, body) = post(
        &app,
        "/external-tournaments",
        &s.admin,
        json!({ "url": URL, "event_ids": ["main"], "game_id": s.game }),
    )
    .await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE, "{body}");
    let (_, list) = get(&app, "/external-tournaments", &s.admin).await;
    assert_eq!(list, json!([]));
    let (_, tournaments) = get(&app, "/tournaments", &s.admin).await;
    assert_eq!(
        tournaments,
        json!([]),
        "le tournoi local doit être supprimé"
    );

    s.source.down.store(false, Ordering::SeqCst);
    import(&app, &s).await;
}

#[actix_web::test]
async fn deleting_an_external_tournament_removes_the_local_copy() {
    let (app, s) = setup().await;
    let source = import(&app, &s).await;
    let id = source["id"].as_str().unwrap();
    let tournament = source["tournament_id"].as_str().unwrap();
    let path = format!("/external-tournaments/{id}");
    let (status, _) = send(&app, TestRequest::delete(), &path, &s.player, None).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = send(&app, TestRequest::delete(), &path, &s.admin, None).await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (status, _) = get(&app, &path, &s.admin).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = get(&app, &format!("/tournaments/{tournament}"), &s.admin).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    // Réimportable ensuite.
    import(&app, &s).await;
}

/// Le parcours principal sur PostgreSQL et Redis (`PgStore` + `RedisSyncStore`), ignoré par
/// défaut : `DATABASE_URL=… REDIS_URL=… cargo test -p api-public --test external -- --ignored`.
#[actix_web::test]
#[ignore = "nécessite Redis et PostgreSQL migré (REDIS_URL, DATABASE_URL)"]
async fn import_sync_and_delete_on_postgres() {
    let url = std::env::var("DATABASE_URL").expect("DATABASE_URL");
    let pool = sqlx::PgPool::connect(&url).await.unwrap();
    let redis = infra::RedisCache::connect(&std::env::var("REDIS_URL").expect("REDIS_URL"))
        .await
        .unwrap();
    let root = format!("root{}", &uuid::Uuid::new_v4().simple().to_string()[..10]);
    let admin_pool = pool.clone();
    let db = infra::CachedDb::new(pool.clone(), Arc::new(redis.clone()));
    let store = Arc::new(PgStore::new(db.clone()));
    let (app, s) = build(
        store.clone(),
        Arc::new(RedisSyncStore::with_prefix(
            db,
            redis.connection(),
            &format!("test-{root}"),
        )),
        &root,
        |name| async move {
            sqlx::query("UPDATE users SET role = 'admin' WHERE username = $1")
                .bind(name)
                .execute(&admin_pool)
                .await
                .unwrap();
        },
    )
    .await;
    // La base est partagée : on part d'un état sans ce tournoi externe.
    sqlx::query("DELETE FROM external_sources WHERE provider = 'fake' AND external_id = '42'")
        .execute(&pool)
        .await
        .unwrap();

    let (status, source) = post(
        &app,
        "/external-tournaments?background=true",
        &s.admin,
        json!({ "url": URL, "event_ids": ["main"], "game_id": s.game, "name": format!("Winter Cup {root}") }),
    )
    .await;
    assert_eq!(status, StatusCode::ACCEPTED, "{source}");
    let id = source["id"].as_str().unwrap().to_string();
    let tournament = source["tournament_id"].as_str().unwrap().to_string();
    let source = tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            let (_, ready) = get(&app, &format!("/external-tournaments/{id}"), &s.admin).await;
            if !ready["last_success_at"].is_null() {
                break ready;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("Durable background import should publish its first snapshot");
    assert_eq!(source["snapshot"]["events"][0]["external_id"], "main");
    // Inscrits importés, tableau et résultats reportés et mis à jour sur place, servis depuis
    // Redis : la base n'en contient rien.
    check_projection(&app, &s, &source).await;
    for table in ["tournament_participant", "step"] {
        let rows: i64 = sqlx::query_scalar(&format!(
            "SELECT count(*) FROM {table} WHERE tournament_id = $1::uuid"
        ))
        .bind(&tournament)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(rows, 0, "{table}");
    }
    let (_, local) = get(&app, &format!("/tournaments/{tournament}"), &s.player).await;
    assert_eq!(local["status"], "finished", "statut lu dans Redis");
    let stored: String = sqlx::query_scalar("SELECT status FROM tournaments WHERE id = $1::uuid")
        .bind(&tournament)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(stored, "draft", "la base garde la ligne telle que créée");
    let (_, listed) = get(&app, "/tournaments?status=finished&limit=200", &s.player).await;
    assert!(
        listed
            .as_array()
            .unwrap()
            .iter()
            .any(|t| t["id"] == tournament.as_str()),
        "filtre sur le statut importé"
    );
    let (_, source) = get(&app, &format!("/external-tournaments/{id}"), &s.admin).await;

    let (status, body) = send(
        &app,
        TestRequest::patch(),
        &format!("/tournaments/{tournament}"),
        &s.admin,
        Some(json!({ "name": "Renommé" })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(body["error"], "externally_managed");

    s.source.down.store(true, Ordering::SeqCst);
    let (_, during) = post(
        &app,
        &format!("/external-tournaments/{id}/sync"),
        &s.admin,
        json!({}),
    )
    .await;
    assert_eq!(during["stale"], true, "{during}");
    assert_eq!(during["snapshot"], source["snapshot"]);
    s.source.down.store(false, Ordering::SeqCst);
    let (_, after) = post(
        &app,
        &format!("/external-tournaments/{id}/sync"),
        &s.admin,
        json!({}),
    )
    .await;
    assert_eq!(after["stale"], false, "{after}");

    let (status, origin) = get(
        &app,
        &format!("/tournaments/{tournament}/source"),
        &s.player,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(origin["provider"], "fake");

    let (status, _) = send(
        &app,
        TestRequest::delete(),
        &format!("/external-tournaments/{id}"),
        &s.admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (status, _) = get(&app, &format!("/tournaments/{tournament}"), &s.admin).await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    // Réimporté, le tournoi reçoit des pronostics : en base, sans ses matchs.
    s.source.finished.store(false, Ordering::SeqCst);
    check_predictions_in_db(&app, &s, store.as_ref(), &pool).await;
}

/// Les inscrits de la source n'ont pas de compte : ils sont importés avec leur nom, et le
/// tableau, ses matchs et leurs résultats suivent la source à chaque synchronisation, sous les
/// mêmes identifiants locaux.
async fn check_projection(app: &app_type!(), s: &Setup, source: &Value) {
    let id = source["id"].as_str().unwrap();
    let tournament = source["tournament_id"].as_str().unwrap();
    let (status, participants) = get(
        app,
        &format!("/tournaments/{tournament}/participants"),
        &s.player,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{participants}");
    let names: Vec<&str> = participants
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p["display_name"].as_str().unwrap())
        .collect();
    assert_eq!(names.len(), 2, "{participants}");
    assert!(
        names.contains(&"Alice") && names.contains(&"Bob"),
        "{names:?}"
    );
    for p in participants.as_array().unwrap() {
        assert!(
            p["user_id"].is_null() && p["tournament_team_id"].is_null(),
            "{p}"
        );
        assert!(
            p["external_id"].as_str().unwrap().starts_with("main:"),
            "{p}"
        );
    }
    let alice = participants
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["display_name"] == "Alice")
        .unwrap()["id"]
        .clone();

    let (_, steps) = get(app, &format!("/tournaments/{tournament}/steps"), &s.player).await;
    let steps = steps.as_array().unwrap().clone();
    assert_eq!(steps.len(), 1, "{steps:?}");
    assert_eq!(steps[0]["format"], "single_elim");
    assert_eq!(steps[0]["status"], "ongoing");
    let step = steps[0]["id"].as_str().unwrap().to_string();
    let matches_path = format!("/tournaments/{tournament}/steps/{step}/matches");
    let (_, before) = get(app, &matches_path, &s.player).await;
    let before = before.as_array().unwrap().clone();
    assert_eq!(before.len(), 1, "{before:?}");
    assert_eq!(before[0]["status"], "scheduled");

    // Le set se termine chez la source : la resynchronisation le reporte sur place.
    s.source.finished.store(true, Ordering::SeqCst);
    let (status, after) = post(
        app,
        &format!("/external-tournaments/{id}/sync"),
        &s.admin,
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{after}");
    assert_eq!(after["stale"], false, "{after}");
    let (_, local) = get(app, &format!("/tournaments/{tournament}"), &s.player).await;
    assert_eq!(local["status"], "finished");
    let (_, steps) = get(app, &format!("/tournaments/{tournament}/steps"), &s.player).await;
    assert_eq!(steps[0]["id"], step.as_str(), "même étape locale");
    assert_eq!(steps[0]["status"], "finished");
    let (_, finished) = get(app, &matches_path, &s.player).await;
    let finished = finished.as_array().unwrap().clone();
    assert_eq!(finished.len(), 1);
    assert_eq!(finished[0]["id"], before[0]["id"], "même match local");
    assert_eq!(finished[0]["status"], "finished");
    let match_id = finished[0]["id"].as_str().unwrap();
    let (_, detail) = get(app, &format!("{matches_path}/{match_id}"), &s.player).await;
    let winner = detail["participants"]
        .as_array()
        .unwrap_or_else(|| panic!("{detail}"))
        .iter()
        .find(|p| p["result"] == "win")
        .unwrap_or_else(|| panic!("{detail}"))
        .clone();
    assert_eq!(winner["participant_id"], alice, "{detail}");
    assert_eq!(winner["stats"]["score"], 3);

    // Le classement du tournoi range les inscrits importés, sans compte, par leur nom.
    let (status, ranking) = get(
        app,
        &format!("/tournaments/{tournament}/ranking"),
        &s.player,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{ranking}");
    assert_eq!(ranking[0]["display_name"], "Alice", "{ranking}");
    assert_eq!(ranking[0]["rank"], 1);
    assert!(ranking[0]["user_id"].is_null());
    assert_eq!(ranking[1]["display_name"], "Bob", "{ranking}");

    // Toujours en lecture seule.
    let (status, _) = post(
        app,
        &format!("/tournaments/{tournament}/participants"),
        &s.player,
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
}

#[actix_web::test]
async fn imported_entrants_and_results_are_projected_locally() {
    let (app, s) = setup().await;
    let source = import(&app, &s).await;
    check_projection(&app, &s, &source).await;
}

/// Pronostic et Pick'em d'un spectateur sur un tournoi importé : permis malgré la lecture
/// seule, résolus d'après les résultats synchronisés. Renvoie le tournoi local.
async fn check_predictions(app: &app_type!(), s: &Setup, store: &dyn AuthStore) -> String {
    let source = import(app, s).await;
    let id = source["id"].as_str().unwrap().to_string();
    let tournament = source["tournament_id"].as_str().unwrap().to_string();
    let (_, steps) = get(app, &format!("/tournaments/{tournament}/steps"), &s.player).await;
    let step = steps[0]["id"].as_str().unwrap().to_string();
    let (_, matches) = get(
        app,
        &format!("/tournaments/{tournament}/steps/{step}/matches"),
        &s.player,
    )
    .await;
    let match_id = matches[0]["id"].as_str().unwrap().to_string();
    let (_, participants) = get(
        app,
        &format!("/tournaments/{tournament}/participants"),
        &s.player,
    )
    .await;
    let alice = participants
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["display_name"] == "Alice")
        .unwrap()["id"]
        .clone();

    let prediction = format!("/tournaments/{tournament}/matches/{match_id}/prediction");
    let (status, saved) = send(
        app,
        TestRequest::put(),
        &prediction,
        &s.player,
        Some(json!({ "winner_id": alice })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{saved}");

    // Pas de barème chez la source : le meilleur marqueur n'est pas proposé.
    let pickem = format!("/tournaments/{tournament}/pickem");
    let (_, templates) = get(app, &format!("{pickem}/templates"), &s.admin).await;
    let top_scorer = templates
        .as_array()
        .unwrap()
        .iter()
        .find(|t| t["kind"] == "top_scorer")
        .unwrap()
        .clone();
    assert_eq!(top_scorer["available"], false, "{templates}");
    let (status, question) = post(
        app,
        &format!("{pickem}/questions"),
        &s.admin,
        json!({ "kind": "tournament_winner", "locks_at": "2099-01-01T00:00:00Z" }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{question}");
    let question = question["id"].as_str().unwrap().to_string();
    let (status, answer) = send(
        app,
        TestRequest::put(),
        &format!("{pickem}/questions/{question}/answer"),
        &s.player,
        Some(json!({ "participant_id": alice })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{answer}");

    // Alice gagne chez la source ; la synchronisation puis la résolution donnent les points.
    s.source.finished.store(true, Ordering::SeqCst);
    let (status, _) = post(
        app,
        &format!("/external-tournaments/{id}/sync"),
        &s.admin,
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let report = api_public::resolution::resolve_tournament(store, tournament.parse().unwrap())
        .await
        .unwrap()
        .unwrap();
    assert!(
        !report.settled,
        "un tournoi importé peut encore être corrigé"
    );
    let (_, mine) = get(app, &prediction, &s.player).await;
    assert_eq!(mine["outcome"], "correct", "{mine}");
    let (_, board) = get(
        app,
        &format!("/tournaments/{tournament}/leaderboard"),
        &s.player,
    )
    .await;
    assert_eq!(board[0]["points"], 40.0, "{board}");
    assert_eq!(board[0]["correct"], 2, "{board}");
    tournament
}

#[actix_web::test]
async fn spectators_predict_imported_tournaments() {
    let store = Arc::new(MemoryStore::new());
    let promoted = store.clone();
    let (app, s) = build(
        store.clone(),
        Arc::new(MemorySyncStore::new().with_projection_cache(store.imports().cache())),
        "root",
        |name| async move { promoted.set_role(&name, Role::Admin) },
    )
    .await;
    check_predictions(&app, &s, store.as_ref()).await;
}

/// Pronostics sur un tournoi importé, sur PostgreSQL et Redis : ils sont en base, les matchs
/// qu'ils visent n'y sont pas, et la suppression du tournoi les emporte.
async fn check_predictions_in_db(
    app: &app_type!(),
    s: &Setup,
    store: &dyn AuthStore,
    pool: &sqlx::PgPool,
) {
    let tournament = check_predictions(app, s, store).await;
    let count = |sql: &'static str| {
        let pool = pool.clone();
        let tournament = tournament.clone();
        async move {
            sqlx::query_scalar::<_, i64>(sql)
                .bind(tournament)
                .fetch_one(&pool)
                .await
                .unwrap()
        }
    };
    assert_eq!(
        count("SELECT count(*) FROM prediction WHERE tournament_id = $1::uuid").await,
        1
    );
    assert_eq!(
        count("SELECT count(*) FROM pickem_answer WHERE tournament_id = $1::uuid").await,
        1
    );
    assert_eq!(
        count(
            "SELECT count(*) FROM match m JOIN step s ON s.id = m.step_id \
             WHERE s.tournament_id = $1::uuid"
        )
        .await,
        0,
        "les matchs importés restent dans Redis"
    );
    // Le tournoi supprimé emporte pronostics et réponses.
    let (_, sources) = get(app, "/external-tournaments", &s.admin).await;
    let source = sources
        .as_array()
        .unwrap()
        .iter()
        .find(|x| x["tournament_id"] == tournament.as_str())
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_string();
    let (status, _) = send(
        app,
        TestRequest::delete(),
        &format!("/external-tournaments/{source}"),
        &s.admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert_eq!(
        count("SELECT count(*) FROM prediction WHERE tournament_id = $1::uuid").await,
        0
    );
}
