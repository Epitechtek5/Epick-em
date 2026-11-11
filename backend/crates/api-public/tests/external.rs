//! Parcours HTTP des tournois externes : sources, résolution d'URL, import en lecture seule,
//! resynchronisation (panne et reprise) et suppression, avec un connecteur factice.

mod common;

use actix_web::http::StatusCode;
use actix_web::test::{self, TestRequest};
use api_public::config::AuthConfig;
use api_public::store::{AuthStore, MemoryStore, PgStore, Role};
use api_public::{AppState, app};
use async_trait::async_trait;
use common::{access, call, logged_in_as, login, request};
use connectors::model::{
    Capabilities, CompetitionState, ExternalEvent, ExternalEventRef, ExternalTournament,
    ExternalTournamentRef,
};
use connectors::sync::{MemorySyncStore, PgSyncStore, SyncPolicy, SyncService, SyncStore};
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
/// en panne à la demande.
struct FakeSource {
    down: AtomicBool,
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
        self.check()?;
        Ok(ExternalTournament {
            reference: tournament.clone(),
            state: CompetitionState::Active,
            events: event_ids
                .iter()
                .map(|id| ExternalEvent {
                    reference: event(id),
                    phases: Vec::new(),
                    entrants: Vec::new(),
                    matches: Vec::new(),
                    standings: Vec::new(),
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
    });
    let sync = SyncService::new(
        ConnectorRegistry::new().register(source.clone()),
        sync_store,
        SyncPolicy::default(),
    );
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
    build(
        store,
        Arc::new(MemorySyncStore::new()),
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
    assert_eq!(local["status"], "draft");
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

/// Le parcours principal sur PostgreSQL (`PgStore` + `PgSyncStore`), ignoré par défaut :
/// `DATABASE_URL=… cargo test -p api-public --test external -- --ignored`.
#[actix_web::test]
#[ignore = "nécessite PostgreSQL migré (DATABASE_URL)"]
async fn import_sync_and_delete_on_postgres() {
    let url = std::env::var("DATABASE_URL").expect("DATABASE_URL");
    let pool = sqlx::PgPool::connect(&url).await.unwrap();
    let root = format!("root{}", &uuid::Uuid::new_v4().simple().to_string()[..10]);
    let admin_pool = pool.clone();
    let (app, s) = build(
        Arc::new(PgStore::new(infra::CachedDb::new(
            pool.clone(),
            Arc::new(infra::MemoryCache::new()),
        ))),
        Arc::new(PgSyncStore::new(pool.clone())),
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
        "/external-tournaments",
        &s.admin,
        json!({ "url": URL, "event_ids": ["main"], "game_id": s.game, "name": format!("Winter Cup {root}") }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{source}");
    let id = source["id"].as_str().unwrap().to_string();
    let tournament = source["tournament_id"].as_str().unwrap().to_string();
    assert_eq!(source["snapshot"]["events"][0]["external_id"], "main");

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
}
