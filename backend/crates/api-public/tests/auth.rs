//! Parcours HTTP complet des routes d'authentification, sur un store en mémoire.

use api_public::auth::decode_access_token;
use api_public::config::AuthConfig;
use api_public::store::{AuthStore, MemoryStore};
use api_public::{AppState, router};
use axum::Router;
use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use std::sync::Arc;
use std::time::Duration;
use tower::ServiceExt;

const SECRET: &str = "0123456789abcdef0123456789abcdef";

fn app_with(store: Arc<MemoryStore>, refresh_ttl: Duration) -> Router {
    let config = AuthConfig {
        jwt_secret: SECRET.into(),
        access_token_ttl: Duration::from_secs(900),
        refresh_token_ttl: refresh_ttl,
    };
    router(AppState::new(store, config).unwrap())
}

fn app() -> Router {
    app_with(Arc::new(MemoryStore::new()), Duration::from_secs(3600))
}

async fn post(app: &Router, path: &str, body: Value) -> (StatusCode, Value) {
    post_raw(app, path, body.to_string()).await
}

async fn post_raw(app: &Router, path: &str, body: String) -> (StatusCode, Value) {
    let request = Request::post(path)
        .header("content-type", "application/json")
        .body(Body::from(body))
        .unwrap();
    let response = app.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let json = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes).unwrap()
    };
    (status, json)
}

async fn register(app: &Router, username: &str, password: &str) -> StatusCode {
    post(
        app,
        "/register",
        json!({ "username": username, "password": password }),
    )
    .await
    .0
}

async fn login(app: &Router, username: &str, password: &str) -> (StatusCode, Value) {
    post(
        app,
        "/login",
        json!({ "username": username, "password": password }),
    )
    .await
}

/// Inscrit puis connecte `alice` ; renvoie la réponse de connexion.
async fn logged_in(app: &Router) -> Value {
    assert_eq!(
        register(app, "alice", "secret123").await,
        StatusCode::CREATED
    );
    let (status, body) = login(app, "alice", "secret123").await;
    assert_eq!(status, StatusCode::OK);
    body
}

#[tokio::test]
async fn healthz_answers_ok() {
    let response = app()
        .oneshot(Request::get("/healthz").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
}

#[tokio::test]
async fn register_creates_the_account_without_leaking_the_password() {
    let (status, body) = post(
        &app(),
        "/register",
        json!({ "username": "alice", "password": "secret123" }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(body["username"], "alice");
    assert!(body["id"].is_string());
    assert!(!body.to_string().contains("secret123"));
    assert!(body.get("password_hash").is_none());
}

#[tokio::test]
async fn register_stores_an_argon2_hash_not_the_password() {
    let store = Arc::new(MemoryStore::new());
    let app = app_with(store.clone(), Duration::from_secs(3600));
    assert_eq!(
        register(&app, "alice", "secret123").await,
        StatusCode::CREATED
    );

    let user = store.find_user_by_username("alice").await.unwrap().unwrap();
    assert!(user.password_hash.starts_with("$argon2id$"));
    assert!(!user.password_hash.contains("secret123"));
}

#[tokio::test]
async fn register_rejects_a_taken_username_whatever_the_case() {
    let app = app();
    assert_eq!(
        register(&app, "alice", "secret123").await,
        StatusCode::CREATED
    );
    assert_eq!(
        register(&app, "alice", "autre-mdp-1").await,
        StatusCode::CONFLICT
    );
    assert_eq!(
        register(&app, "ALICE", "autre-mdp-1").await,
        StatusCode::CONFLICT
    );
}

#[tokio::test]
async fn register_reports_each_invalid_field() {
    let app = app();
    for username in ["ab", &"a".repeat(33), "john doe", "jöhn", "john@doe"] {
        let (status, body) = post(
            &app,
            "/register",
            json!({ "username": username, "password": "secret123" }),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{username}");
        assert!(body["errors"]["username"].is_string(), "{username}");
        assert!(body["errors"].get("password").is_none());
    }
    for password in ["short", &"a".repeat(129)] {
        let (status, body) = post(
            &app,
            "/register",
            json!({ "username": "alice", "password": password }),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert!(body["errors"]["password"].is_string());
    }
    let (_, body) = post(
        &app,
        "/register",
        json!({ "username": "a", "password": "b" }),
    )
    .await;
    assert_eq!(body["errors"].as_object().unwrap().len(), 2);
}

#[tokio::test]
async fn register_accepts_the_boundary_lengths() {
    let app = app();
    assert_eq!(
        register(&app, &"a".repeat(32), &"p".repeat(128)).await,
        StatusCode::CREATED
    );
    assert_eq!(register(&app, "abc", "12345678").await, StatusCode::CREATED);
}

#[tokio::test]
async fn malformed_bodies_are_bad_requests() {
    let app = app();
    for path in ["/register", "/login", "/refresh", "/logout"] {
        let (status, body) = post_raw(&app, path, "pas du json".into()).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{path}");
        assert_eq!(body["error"], "invalid_request");

        let (status, _) = post(&app, path, json!({})).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{path} sans champs");
    }
}

#[tokio::test]
async fn login_returns_a_valid_access_token_and_a_refresh_token() {
    let app = app();
    let body = logged_in(&app).await;

    assert_eq!(body["token_type"], "Bearer");
    assert_eq!(body["expires_in"], 900);
    let claims = decode_access_token(body["access_token"].as_str().unwrap(), SECRET).unwrap();
    assert_eq!(claims.username, "alice");
    assert_eq!(claims.exp - claims.iat, 900);
    assert_eq!(body["refresh_token"].as_str().unwrap().len(), 64);
}

#[tokio::test]
async fn login_ignores_the_case_of_the_username() {
    let app = app();
    assert_eq!(
        register(&app, "Alice", "secret123").await,
        StatusCode::CREATED
    );
    let (status, body) = login(&app, "aLiCe", "secret123").await;
    assert_eq!(status, StatusCode::OK);
    // Le nom renvoyé est celui de l'inscription.
    let claims = decode_access_token(body["access_token"].as_str().unwrap(), SECRET).unwrap();
    assert_eq!(claims.username, "Alice");
}

#[tokio::test]
async fn login_failures_are_indistinguishable() {
    let app = app();
    assert_eq!(
        register(&app, "alice", "secret123").await,
        StatusCode::CREATED
    );

    let wrong_password = login(&app, "alice", "mauvais-mdp").await;
    let unknown_user = login(&app, "bob", "secret123").await;
    let too_long = login(&app, "alice", &"a".repeat(1000)).await;
    assert_eq!(wrong_password.0, StatusCode::UNAUTHORIZED);
    assert_eq!(wrong_password, unknown_user);
    assert_eq!(wrong_password, too_long);
}

#[tokio::test]
async fn login_requires_both_fields() {
    let (status, body) = login(&app(), "", "").await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(body["errors"]["username"].is_string());
    assert!(body["errors"]["password"].is_string());
}

#[tokio::test]
async fn refresh_issues_new_tokens_and_invalidates_the_old_refresh_token() {
    let app = app();
    let first = logged_in(&app).await;
    let old = first["refresh_token"].as_str().unwrap();

    let (status, second) = post(&app, "/refresh", json!({ "refresh_token": old })).await;
    assert_eq!(status, StatusCode::OK);
    assert_ne!(second["refresh_token"], first["refresh_token"]);
    let claims = decode_access_token(second["access_token"].as_str().unwrap(), SECRET).unwrap();
    assert_eq!(claims.username, "alice");

    // Usage unique : rejouer l'ancien jeton échoue, le nouveau fonctionne.
    let (status, _) = post(&app, "/refresh", json!({ "refresh_token": old })).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    let new = second["refresh_token"].as_str().unwrap();
    let (status, _) = post(&app, "/refresh", json!({ "refresh_token": new })).await;
    assert_eq!(status, StatusCode::OK);
}

#[tokio::test]
async fn refresh_rejects_unknown_tokens() {
    let app = app();
    logged_in(&app).await;
    for token in ["", "inconnu", &"0".repeat(64)] {
        let (status, body) = post(&app, "/refresh", json!({ "refresh_token": token })).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED, "{token:?}");
        assert_eq!(body["error"], "unauthorized");
    }
}

#[tokio::test]
async fn refresh_rejects_an_expired_token() {
    let app = app_with(Arc::new(MemoryStore::new()), Duration::from_millis(50));
    let login = logged_in(&app).await;
    tokio::time::sleep(Duration::from_millis(100)).await;

    let (status, _) = post(
        &app,
        "/refresh",
        json!({ "refresh_token": login["refresh_token"] }),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn logout_revokes_the_refresh_token() {
    let app = app();
    let login = logged_in(&app).await;
    let body = json!({ "refresh_token": login["refresh_token"] });

    let (status, response) = post(&app, "/logout", body.clone()).await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert_eq!(response, Value::Null);

    let (status, _) = post(&app, "/refresh", body).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn logout_only_ends_the_given_session() {
    let app = app();
    let first = logged_in(&app).await;
    let (_, second) = login(&app, "alice", "secret123").await;

    post(
        &app,
        "/logout",
        json!({ "refresh_token": first["refresh_token"] }),
    )
    .await;

    let (status, _) = post(
        &app,
        "/refresh",
        json!({ "refresh_token": second["refresh_token"] }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
}

#[tokio::test]
async fn logout_is_idempotent() {
    let app = app();
    let login = logged_in(&app).await;
    let body = json!({ "refresh_token": login["refresh_token"] });

    assert_eq!(
        post(&app, "/logout", body.clone()).await.0,
        StatusCode::NO_CONTENT
    );
    assert_eq!(post(&app, "/logout", body).await.0, StatusCode::NO_CONTENT);
    assert_eq!(
        post(&app, "/logout", json!({ "refresh_token": "inconnu" }))
            .await
            .0,
        StatusCode::NO_CONTENT
    );
}
