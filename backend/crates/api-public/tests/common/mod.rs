//! Outils communs aux tests HTTP : application sur un store en mémoire, requêtes JSON.
#![allow(dead_code)] // chaque fichier de tests n'utilise qu'une partie de ces fonctions

use actix_web::body::MessageBody;
use actix_web::dev::{Service, ServiceResponse};
use actix_web::http::StatusCode;
use actix_web::test::{self, TestRequest};
use api_public::config::AuthConfig;
use api_public::mail::MemoryMailer;
use api_public::store::MemoryStore;
use api_public::{AppState, app};
use serde_json::{Value, json};
use std::sync::Arc;
use std::time::Duration;

pub const PUBLIC_URL: &str = "https://epickem.test";
pub const SECRET: &str = "0123456789abcdef0123456789abcdef";

/// L'application complète (garde d'authentification comprise) sur le store donné.
pub async fn app_with(
    store: Arc<MemoryStore>,
    refresh_ttl: Duration,
) -> impl Service<
    actix_http::Request,
    Response = ServiceResponse<impl MessageBody>,
    Error = actix_web::Error,
> {
    let config = AuthConfig {
        jwt_secret: SECRET.into(),
        access_token_ttl: Duration::from_secs(900),
        refresh_token_ttl: refresh_ttl,
    };
    let state = AppState::new(store, config).unwrap();
    test::init_service(app(state)).await
}

/// Comme [`app_with`], avec `mailer` branché et l'origine publique `PUBLIC_URL`.
pub async fn app_with_mailer(
    store: Arc<MemoryStore>,
    mailer: Arc<MemoryMailer>,
) -> impl Service<
    actix_http::Request,
    Response = ServiceResponse<impl MessageBody>,
    Error = actix_web::Error,
> {
    let config = AuthConfig {
        jwt_secret: SECRET.into(),
        access_token_ttl: Duration::from_secs(900),
        refresh_token_ttl: Duration::from_secs(3600),
    };
    let state = AppState::new(store, config)
        .unwrap()
        .with_mailer(mailer, PUBLIC_URL);
    test::init_service(app(state)).await
}

pub async fn app_default() -> impl Service<
    actix_http::Request,
    Response = ServiceResponse<impl MessageBody>,
    Error = actix_web::Error,
> {
    app_with(Arc::new(MemoryStore::new()), Duration::from_secs(3600)).await
}

/// Exécute la requête et renvoie le statut et le corps JSON (`Null` si le corps est vide).
pub async fn call(
    app: &impl Service<
        actix_http::Request,
        Response = ServiceResponse<impl MessageBody>,
        Error = actix_web::Error,
    >,
    request: TestRequest,
) -> (StatusCode, Value) {
    let response = test::call_service(app, request.to_request()).await;
    let status = response.status();
    let bytes = test::read_body(response).await;
    let json = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes).unwrap_or(Value::Null)
    };
    (status, json)
}

/// Requête `method` sur `path`, avec le jeton d'accès dans `Authorization` s'il est donné.
pub fn request(method: TestRequest, path: &str, token: Option<&str>) -> TestRequest {
    let request = method.uri(path);
    match token {
        Some(token) => request.insert_header(("authorization", format!("Bearer {token}"))),
        None => request,
    }
}

pub async fn post(
    app: &impl Service<
        actix_http::Request,
        Response = ServiceResponse<impl MessageBody>,
        Error = actix_web::Error,
    >,
    path: &str,
    body: Value,
) -> (StatusCode, Value) {
    call(app, request(TestRequest::post(), path, None).set_json(body)).await
}

/// POST avec le jeton d'accès dans `Authorization`.
pub async fn post_as(
    app: &impl Service<
        actix_http::Request,
        Response = ServiceResponse<impl MessageBody>,
        Error = actix_web::Error,
    >,
    token: &str,
    path: &str,
    body: Value,
) -> (StatusCode, Value) {
    call(
        app,
        request(TestRequest::post(), path, Some(token)).set_json(body),
    )
    .await
}

pub async fn register(
    app: &impl Service<
        actix_http::Request,
        Response = ServiceResponse<impl MessageBody>,
        Error = actix_web::Error,
    >,
    username: &str,
    password: &str,
) -> StatusCode {
    post(
        app,
        "/register",
        json!({ "username": username, "password": password }),
    )
    .await
    .0
}

pub async fn login(
    app: &impl Service<
        actix_http::Request,
        Response = ServiceResponse<impl MessageBody>,
        Error = actix_web::Error,
    >,
    username: &str,
    password: &str,
) -> (StatusCode, Value) {
    post(
        app,
        "/login",
        json!({ "username": username, "password": password }),
    )
    .await
}

pub fn access(login: &Value) -> &str {
    login["access_token"].as_str().unwrap()
}

/// Inscrit puis connecte `username` ; renvoie la réponse de connexion.
pub async fn logged_in_as(
    app: &impl Service<
        actix_http::Request,
        Response = ServiceResponse<impl MessageBody>,
        Error = actix_web::Error,
    >,
    username: &str,
    password: &str,
) -> Value {
    assert_eq!(register(app, username, password).await, StatusCode::CREATED);
    let (status, body) = login(app, username, password).await;
    assert_eq!(status, StatusCode::OK);
    body
}
