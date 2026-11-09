//! Cache des exports : un export est gardé une heure, et toute écriture réussie le vide.

mod common;

use actix_web::http::StatusCode;
use actix_web::test::{self, TestRequest};
use api_public::config::AuthConfig;
use api_public::export_cache::TTL;
use api_public::store::{MemoryStore, Role};
use api_public::{AppState, app};
use common::{access, call, logged_in_as, login, request};
use infra::{Cache, MemoryCache};
use serde_json::{Value, json};
use std::sync::Arc;
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

const RESOURCES: [&str; 4] = ["games", "stats", "teams", "tournaments"];
const FORMATS: [&str; 2] = ["json", "csv"];

/// Application, cache observable, jeton d'un administrateur et jeton d'un simple utilisateur.
async fn setup() -> (app_type!(), Arc<MemoryCache>, String, String) {
    let store = Arc::new(MemoryStore::new());
    let cache = Arc::new(MemoryCache::new());
    let config = AuthConfig {
        jwt_secret: "0123456789abcdef0123456789abcdef".into(),
        access_token_ttl: Duration::from_secs(900),
        refresh_token_ttl: Duration::from_secs(3600),
    };
    let state = AppState::new(store.clone(), config)
        .unwrap()
        .with_cache(cache.clone());
    let app = test::init_service(app(state)).await;
    logged_in_as(&app, "root", "secret123").await;
    store.set_role("root", Role::Admin);
    let (_, session) = login(&app, "root", "secret123").await;
    let admin = access(&session).to_string();
    let session = logged_in_as(&app, "alice", "secret123").await;
    let user = access(&session).to_string();
    (app, cache, admin, user)
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

async fn export(app: &app_type!(), resource: &str, format: &str, token: &str) -> String {
    let response = test::call_service(
        app,
        request(
            TestRequest::get(),
            &format!("/{resource}/export?format={format}"),
            Some(token),
        )
        .to_request(),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK, "{resource} {format}");
    String::from_utf8(test::read_body(response).await.to_vec()).unwrap()
}

/// Exporte chaque ressource dans chaque format, ce qui remplit le cache.
async fn prime(app: &app_type!(), cache: &MemoryCache, admin: &str) {
    for resource in RESOURCES {
        for format in FORMATS {
            export(app, resource, format, admin).await;
            assert!(
                cache
                    .get(&format!("export:{resource}:{format}"))
                    .await
                    .unwrap()
                    .is_some(),
                "{resource} {format}"
            );
        }
    }
}

async fn cached(cache: &MemoryCache) -> Vec<String> {
    let mut present = Vec::new();
    for resource in RESOURCES {
        for format in FORMATS {
            let key = format!("export:{resource}:{format}");
            if cache.get(&key).await.unwrap().is_some() {
                present.push(key);
            }
        }
    }
    present
}

#[test]
fn exports_are_kept_for_one_hour() {
    assert_eq!(TTL.as_secs(), 3600);
}

#[actix_web::test]
async fn an_export_is_served_from_the_cache_until_something_changes() {
    let (app, cache, admin, _) = setup().await;
    send(
        &app,
        TestRequest::post(),
        "/games",
        &admin,
        Some(json!({ "name": "Valorant" })),
    )
    .await;
    let first = export(&app, "games", "json", &admin).await;
    assert!(first.contains("Valorant"));

    // Une entrée posée dans le cache est servie telle quelle : la base n'est pas relue.
    cache
        .set("export:games:json", b"{\"en\":\"cache\"}".to_vec(), TTL)
        .await
        .unwrap();
    assert_eq!(
        export(&app, "games", "json", &admin).await,
        "{\"en\":\"cache\"}"
    );
    // Chaque format a sa propre entrée.
    assert!(
        export(&app, "games", "csv", &admin)
            .await
            .contains("Valorant")
    );

    // Les en-têtes sont ceux d'un export, qu'il vienne du cache ou non.
    let response = test::call_service(
        &app,
        request(TestRequest::get(), "/games/export", Some(&admin)).to_request(),
    )
    .await;
    let disposition = response.headers().get("content-disposition").unwrap();
    assert_eq!(disposition, "attachment; filename=\"games.json\"");
}

#[actix_web::test]
async fn every_write_clears_the_cached_exports() {
    let (app, cache, admin, _) = setup().await;
    let (_, game) = send(
        &app,
        TestRequest::post(),
        "/games",
        &admin,
        Some(json!({ "name": "Valorant" })),
    )
    .await;
    let game = game["id"].as_str().unwrap().to_string();

    let writes: Vec<(&str, TestRequest, String, Option<Value>)> = vec![
        (
            "création",
            TestRequest::post(),
            "/games".into(),
            Some(json!({ "name": "Dota 2" })),
        ),
        (
            "modification",
            TestRequest::patch(),
            format!("/games/{game}"),
            Some(json!({ "description": "FPS" })),
        ),
        (
            "statistique",
            TestRequest::post(),
            "/stats".into(),
            Some(json!({ "name": "Kills", "key": "kills", "type": "flat" })),
        ),
        ("import", TestRequest::post(), "/games/import".into(), None),
        (
            "suppression",
            TestRequest::delete(),
            format!("/games/{game}"),
            None,
        ),
    ];
    for (label, method, path, body) in writes {
        prime(&app, &cache, &admin).await;
        let request = request(method, &path, Some(&admin));
        let request = match (label, body) {
            ("import", _) => request
                .set_payload(r#"{ "version": 1, "games": [{ "name": "Importé" }] }"#.to_string()),
            (_, Some(body)) => request.set_json(body),
            (_, None) => request,
        };
        let (status, error) = call(&app, request).await;
        assert!(status.is_success(), "{label}: {status} {error}");
        assert_eq!(cached(&cache).await, Vec::<String>::new(), "{label}");
    }
}

#[actix_web::test]
async fn deleting_a_game_clears_the_exports_of_what_depends_on_it() {
    let (app, _, admin, _) = setup().await;
    let (_, game) = send(
        &app,
        TestRequest::post(),
        "/games",
        &admin,
        Some(json!({ "name": "Valorant" })),
    )
    .await;
    let game = game["id"].as_str().unwrap().to_string();
    let (status, _) = send(
        &app,
        TestRequest::post(),
        "/teams",
        &admin,
        Some(json!({ "game_id": game, "name": "Karmine" })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert!(
        export(&app, "teams", "json", &admin)
            .await
            .contains("Karmine")
    );

    let (status, _) = send(
        &app,
        TestRequest::delete(),
        &format!("/games/{game}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    // L'équipe est partie avec le jeu, et l'export des équipes n'est plus celui en cache.
    assert!(
        !export(&app, "teams", "json", &admin)
            .await
            .contains("Karmine")
    );
}

#[actix_web::test]
async fn reads_failed_writes_and_logins_keep_the_cache() {
    let (app, cache, admin, user) = setup().await;
    prime(&app, &cache, &admin).await;
    let all = cached(&cache).await;
    assert_eq!(all.len(), 8);

    // Lectures.
    send(&app, TestRequest::get(), "/games", &admin, None).await;
    // Écritures refusées (droits) ou invalides.
    let (status, _) = send(
        &app,
        TestRequest::post(),
        "/games",
        &user,
        Some(json!({ "name": "Pirate" })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = send(
        &app,
        TestRequest::post(),
        "/games",
        &admin,
        Some(json!({ "name": "  " })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, _) = send(
        &app,
        TestRequest::delete(),
        "/games/00000000-0000-0000-0000-000000000000",
        &admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    // Connexion : n'écrit rien d'exporté.
    login(&app, "root", "secret123").await;
    assert_eq!(cached(&cache).await, all);
}
