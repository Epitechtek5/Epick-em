//! Parcours HTTP complet des routes d'authentification, sur un store en mémoire.

use api_public::auth::decode_access_token;
use api_public::config::AuthConfig;
use api_public::store::{AuthStore, MemoryStore, Role};
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
    send(app, path, body, None).await
}

/// POST avec le jeton d'accès dans `Authorization`.
async fn post_as(app: &Router, token: &str, path: &str, body: Value) -> (StatusCode, Value) {
    send(app, path, body.to_string(), Some(token)).await
}

async fn send(app: &Router, path: &str, body: String, token: Option<&str>) -> (StatusCode, Value) {
    let mut request = Request::post(path).header("content-type", "application/json");
    if let Some(token) = token {
        request = request.header("authorization", format!("Bearer {token}"));
    }
    let request = request.body(Body::from(body)).unwrap();
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

fn access(login: &Value) -> &str {
    login["access_token"].as_str().unwrap()
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
async fn health_and_hello_answer_ok() {
    let app = app();
    for path in ["/health", "/hello"] {
        let response = app
            .clone()
            .oneshot(Request::get(path).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK, "{path}");
    }
    let response = app
        .oneshot(Request::get("/healthz").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
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
    let token = logged_in(&app).await["access_token"]
        .as_str()
        .unwrap()
        .to_string();
    for path in ["/register", "/login", "/refresh", "/logout"] {
        let (status, body) = send(&app, path, "pas du json".into(), Some(&token)).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{path}");
        assert_eq!(body["error"], "invalid_request");

        let (status, _) = post_as(&app, &token, path, json!({})).await;
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

    let (status, second) = post_as(
        &app,
        access(&first),
        "/refresh",
        json!({ "refresh_token": old }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_ne!(second["refresh_token"], first["refresh_token"]);
    let claims = decode_access_token(second["access_token"].as_str().unwrap(), SECRET).unwrap();
    assert_eq!(claims.username, "alice");

    // Usage unique : rejouer l'ancien jeton échoue, le nouveau fonctionne.
    let (status, _) = post_as(
        &app,
        access(&first),
        "/refresh",
        json!({ "refresh_token": old }),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    let new = second["refresh_token"].as_str().unwrap();
    let (status, _) = post_as(
        &app,
        access(&second),
        "/refresh",
        json!({ "refresh_token": new }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
}

#[tokio::test]
async fn refresh_rejects_unknown_tokens() {
    let app = app();
    let login = logged_in(&app).await;
    for token in ["", "inconnu", &"0".repeat(64)] {
        let (status, body) = post_as(
            &app,
            access(&login),
            "/refresh",
            json!({ "refresh_token": token }),
        )
        .await;
        assert_eq!(status, StatusCode::UNAUTHORIZED, "{token:?}");
        assert_eq!(body["error"], "unauthorized");
    }
}

#[tokio::test]
async fn refresh_rejects_an_expired_token() {
    let app = app_with(Arc::new(MemoryStore::new()), Duration::from_millis(50));
    let login = logged_in(&app).await;
    tokio::time::sleep(Duration::from_millis(100)).await;

    let (status, _) = post_as(
        &app,
        access(&login),
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

    let (status, response) = post_as(&app, access(&login), "/logout", body.clone()).await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert_eq!(response, Value::Null);

    let (status, _) = post_as(&app, access(&login), "/refresh", body).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn logout_only_ends_the_given_session() {
    let app = app();
    let first = logged_in(&app).await;
    let (_, second) = login(&app, "alice", "secret123").await;

    post_as(
        &app,
        access(&first),
        "/logout",
        json!({ "refresh_token": first["refresh_token"] }),
    )
    .await;

    let (status, _) = post_as(
        &app,
        access(&second),
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
        post_as(&app, access(&login), "/logout", body.clone())
            .await
            .0,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        post_as(&app, access(&login), "/logout", body).await.0,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        post_as(
            &app,
            access(&login),
            "/logout",
            json!({ "refresh_token": "inconnu" })
        )
        .await
        .0,
        StatusCode::NO_CONTENT
    );
}

/// Jeton signé avec le bon secret, mais émis et expiré il y a longtemps.
fn expired_token(user_id: uuid::Uuid) -> String {
    let claims = api_public::auth::Claims {
        sub: user_id,
        username: "alice".into(),
        role: api_public::store::Role::User,
        iat: 1_000,
        exp: 2_000,
    };
    jsonwebtoken::encode(
        &jsonwebtoken::Header::default(),
        &claims,
        &jsonwebtoken::EncodingKey::from_secret(SECRET.as_bytes()),
    )
    .unwrap()
}

async fn status_of(app: &Router, request: Request<Body>) -> StatusCode {
    app.clone().oneshot(request).await.unwrap().status()
}

#[tokio::test]
async fn public_routes_need_no_token() {
    let app = app();
    assert_eq!(
        register(&app, "alice", "secret123").await,
        StatusCode::CREATED
    );
    assert_eq!(login(&app, "alice", "secret123").await.0, StatusCode::OK);
    for path in ["/health", "/hello"] {
        let request = Request::get(path).body(Body::empty()).unwrap();
        assert_eq!(status_of(&app, request).await, StatusCode::OK, "{path}");
    }
}

#[tokio::test]
async fn logout_requires_a_valid_access_token() {
    let app = app();
    let login = logged_in(&app).await;
    let body = json!({ "refresh_token": login["refresh_token"] });

    let (status, _) = post(&app, "/logout", body.clone()).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    for token in ["n'importe quoi", &expired_token(uuid::Uuid::new_v4())] {
        let (status, response) = post_as(&app, token, "/logout", body.clone()).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED, "{token}");
        assert_eq!(response["error"], "unauthorized");
    }

    // Sans jeton valide, la session n'est pas révoquée.
    let (status, _) = post_as(&app, access(&login), "/refresh", body).await;
    assert_eq!(status, StatusCode::OK);
}

#[tokio::test]
async fn refresh_requires_a_token_but_tolerates_an_expired_one() {
    let app = app();
    let login = logged_in(&app).await;
    let body = |login: &Value| json!({ "refresh_token": login["refresh_token"] });

    assert_eq!(
        post(&app, "/refresh", body(&login)).await.0,
        StatusCode::UNAUTHORIZED
    );
    let forged = {
        let mut token = access(&login).to_string();
        token.push('x');
        token
    };
    assert_eq!(
        post_as(&app, &forged, "/refresh", body(&login)).await.0,
        StatusCode::UNAUTHORIZED
    );

    let claims = decode_access_token(access(&login), SECRET).unwrap();
    let (status, renewed) =
        post_as(&app, &expired_token(claims.sub), "/refresh", body(&login)).await;
    assert_eq!(status, StatusCode::OK);
    assert!(decode_access_token(access(&renewed), SECRET).is_some());
}

#[tokio::test]
async fn unsigned_or_wrongly_signed_tokens_are_rejected() {
    let app = app();
    let login = logged_in(&app).await;
    let claims = decode_access_token(access(&login), SECRET).unwrap();
    let foreign = jsonwebtoken::encode(
        &jsonwebtoken::Header::default(),
        &claims,
        &jsonwebtoken::EncodingKey::from_secret(b"un-autre-secret-un-autre-secret!"),
    )
    .unwrap();
    let body = json!({ "refresh_token": login["refresh_token"] });
    for path in ["/logout", "/refresh"] {
        let (status, _) = post_as(&app, &foreign, path, body.clone()).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED, "{path}");
    }
}

#[tokio::test]
async fn a_refresh_token_only_works_with_the_access_token_of_its_owner() {
    let app = app();
    let alice = logged_in(&app).await;
    assert_eq!(
        register(&app, "bob", "secret456").await,
        StatusCode::CREATED
    );
    let (_, bob) = login(&app, "bob", "secret456").await;
    let alice_refresh = json!({ "refresh_token": alice["refresh_token"] });

    // Bob ne peut ni utiliser ni révoquer le jeton d'Alice...
    let (status, _) = post_as(&app, access(&bob), "/refresh", alice_refresh.clone()).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    let (status, _) = post_as(&app, access(&bob), "/logout", alice_refresh.clone()).await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    // ... qui reste utilisable par Alice : rien n'a été consommé.
    let (status, renewed) = post_as(&app, access(&alice), "/refresh", alice_refresh).await;
    assert_eq!(status, StatusCode::OK);
    let claims = decode_access_token(access(&renewed), SECRET).unwrap();
    assert_eq!(claims.username, "alice");
}

#[tokio::test]
async fn the_role_is_in_the_access_token_and_survives_a_refresh() {
    let store = Arc::new(MemoryStore::new());
    let app = app_with(store.clone(), Duration::from_secs(3600));
    let user = logged_in(&app).await;
    assert_eq!(
        decode_access_token(access(&user), SECRET).unwrap().role,
        Role::User
    );
    // Dans le JWT, le rôle est une chaîne en minuscules.
    let raw = jsonwebtoken::dangerous::insecure_decode::<Value>(access(&user)).unwrap();
    assert_eq!(raw.claims["role"], "user");

    store.set_role("alice", Role::Admin);
    let (_, admin) = login(&app, "alice", "secret123").await;
    assert_eq!(
        decode_access_token(access(&admin), SECRET).unwrap().role,
        Role::Admin
    );
    // Le rafraîchissement relit le rôle en base : une promotion est prise en compte.
    let (_, renewed) = post_as(
        &app,
        access(&user),
        "/refresh",
        json!({ "refresh_token": user["refresh_token"] }),
    )
    .await;
    assert_eq!(
        decode_access_token(access(&renewed), SECRET).unwrap().role,
        Role::Admin
    );
}

#[tokio::test]
async fn openapi_docs_are_public() {
    let app = app();
    for path in ["/openapi.json", "/docs/"] {
        let response = app
            .clone()
            .oneshot(Request::get(path).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK, "{path}");
    }
    let response = app
        .oneshot(Request::get("/openapi.json").body(Body::empty()).unwrap())
        .await
        .unwrap();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let spec: Value = serde_json::from_slice(&bytes).unwrap();
    for path in ["/register", "/login", "/refresh", "/logout", "/health"] {
        assert!(spec["paths"][path].is_object(), "{path} absent de la spec");
    }
}
