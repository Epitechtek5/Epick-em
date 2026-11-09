//! Parcours HTTP complet des routes d'authentification, sur un store en mémoire.

mod common;

use actix_web::http::StatusCode;
use actix_web::test::TestRequest;
use api_public::auth::decode_access_token;
use api_public::store::{AuthStore, MemoryStore, Role};
use common::{
    SECRET, access, app_default, app_with, call, logged_in_as, login, post, post_as, register,
    request,
};
use serde_json::{Value, json};
use std::sync::Arc;
use std::time::Duration;

/// Inscrit puis connecte `alice` ; renvoie la réponse de connexion.
async fn logged_in(
    app: &impl actix_web::dev::Service<
        actix_http::Request,
        Response = actix_web::dev::ServiceResponse<impl actix_web::body::MessageBody>,
        Error = actix_web::Error,
    >,
) -> Value {
    logged_in_as(app, "alice", "secret123").await
}

/// POST d'un corps brut (éventuellement illisible) avec un jeton d'accès facultatif.
async fn post_raw(
    app: &impl actix_web::dev::Service<
        actix_http::Request,
        Response = actix_web::dev::ServiceResponse<impl actix_web::body::MessageBody>,
        Error = actix_web::Error,
    >,
    path: &str,
    body: &str,
    token: Option<&str>,
) -> (StatusCode, Value) {
    let req = request(TestRequest::post(), path, token)
        .insert_header(("content-type", "application/json"))
        .set_payload(body.to_string());
    call(app, req).await
}

#[actix_web::test]
async fn health_and_hello_answer_ok() {
    let app = app_default().await;
    for path in ["/health", "/hello"] {
        let (status, _) = call(&app, request(TestRequest::get(), path, None)).await;
        assert_eq!(status, StatusCode::OK, "{path}");
    }
    // Un chemin inconnu reste un 404, même sans jeton.
    let (status, _) = call(&app, request(TestRequest::get(), "/healthz", None)).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[actix_web::test]
async fn register_returns_usable_tokens_without_leaking_the_password() {
    let app = app_default().await;
    let (status, body) = post(
        &app,
        "/register",
        json!({ "username": "alice", "password": "secret123" }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(body["token_type"], "Bearer");
    assert!(body["expires_in"].is_u64());
    let claims = decode_access_token(body["access_token"].as_str().unwrap(), SECRET).unwrap();
    assert_eq!(claims.username, "alice");
    assert!(!body.to_string().contains("secret123"));
    assert!(body.get("password_hash").is_none());

    // Le jeton de rafraîchissement émis à l'inscription est valable.
    let (status, _) = post_as(
        &app,
        body["access_token"].as_str().unwrap(),
        "/refresh",
        json!({ "refresh_token": body["refresh_token"] }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
}

#[actix_web::test]
async fn register_stores_an_argon2_hash_not_the_password() {
    let store = Arc::new(MemoryStore::new());
    let app = app_with(store.clone(), Duration::from_secs(3600)).await;
    assert_eq!(
        register(&app, "alice", "secret123").await,
        StatusCode::CREATED
    );

    let user = store.find_user_by_username("alice").await.unwrap().unwrap();
    assert!(user.password_hash.starts_with("$argon2id$"));
    assert!(!user.password_hash.contains("secret123"));
}

#[actix_web::test]
async fn register_rejects_a_taken_username_whatever_the_case() {
    let app = app_default().await;
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

#[actix_web::test]
async fn register_reports_each_invalid_field() {
    let app = app_default().await;
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

#[actix_web::test]
async fn register_accepts_the_boundary_lengths() {
    let app = app_default().await;
    assert_eq!(
        register(&app, &"a".repeat(32), &"p".repeat(128)).await,
        StatusCode::CREATED
    );
    assert_eq!(register(&app, "abc", "12345678").await, StatusCode::CREATED);
}

#[actix_web::test]
async fn malformed_bodies_are_bad_requests() {
    let app = app_default().await;
    let token = logged_in(&app).await["access_token"]
        .as_str()
        .unwrap()
        .to_string();
    for path in ["/register", "/login", "/refresh", "/logout"] {
        let (status, body) = post_raw(&app, path, "pas du json", Some(&token)).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{path}");
        assert_eq!(body["error"], "invalid_request");

        let (status, _) = post_as(&app, &token, path, json!({})).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{path} sans champs");
    }
}

#[actix_web::test]
async fn login_returns_a_valid_access_token_and_a_refresh_token() {
    let app = app_default().await;
    let body = logged_in(&app).await;

    assert_eq!(body["token_type"], "Bearer");
    assert_eq!(body["expires_in"], 900);
    let claims = decode_access_token(body["access_token"].as_str().unwrap(), SECRET).unwrap();
    assert_eq!(claims.username, "alice");
    assert_eq!(claims.exp - claims.iat, 900);
    assert_eq!(body["refresh_token"].as_str().unwrap().len(), 64);
}

#[actix_web::test]
async fn login_ignores_the_case_of_the_username() {
    let app = app_default().await;
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

#[actix_web::test]
async fn login_failures_are_indistinguishable() {
    let app = app_default().await;
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

#[actix_web::test]
async fn login_requires_both_fields() {
    let (status, body) = login(&app_default().await, "", "").await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(body["errors"]["username"].is_string());
    assert!(body["errors"]["password"].is_string());
}

#[actix_web::test]
async fn refresh_issues_new_tokens_and_invalidates_the_old_refresh_token() {
    let app = app_default().await;
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

#[actix_web::test]
async fn refresh_rejects_unknown_tokens() {
    let app = app_default().await;
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

#[actix_web::test]
async fn refresh_rejects_an_expired_token() {
    let app = app_with(Arc::new(MemoryStore::new()), Duration::from_millis(50)).await;
    let login = logged_in(&app).await;
    actix_web::rt::time::sleep(Duration::from_millis(100)).await;

    let (status, _) = post_as(
        &app,
        access(&login),
        "/refresh",
        json!({ "refresh_token": login["refresh_token"] }),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[actix_web::test]
async fn logout_revokes_the_refresh_token() {
    let app = app_default().await;
    let login = logged_in(&app).await;
    let body = json!({ "refresh_token": login["refresh_token"] });

    let (status, response) = post_as(&app, access(&login), "/logout", body.clone()).await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert_eq!(response, Value::Null);

    let (status, _) = post_as(&app, access(&login), "/refresh", body).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[actix_web::test]
async fn logout_only_ends_the_given_session() {
    let app = app_default().await;
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

#[actix_web::test]
async fn logout_is_idempotent() {
    let app = app_default().await;
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

#[actix_web::test]
async fn public_routes_need_no_token() {
    let app = app_default().await;
    assert_eq!(
        register(&app, "alice", "secret123").await,
        StatusCode::CREATED
    );
    assert_eq!(login(&app, "alice", "secret123").await.0, StatusCode::OK);
    for path in ["/health", "/hello"] {
        let (status, _) = call(&app, request(TestRequest::get(), path, None)).await;
        assert_eq!(status, StatusCode::OK, "{path}");
    }
}

#[actix_web::test]
async fn logout_requires_a_valid_access_token() {
    let app = app_default().await;
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

#[actix_web::test]
async fn refresh_requires_a_token_but_tolerates_an_expired_one() {
    let app = app_default().await;
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

#[actix_web::test]
async fn unsigned_or_wrongly_signed_tokens_are_rejected() {
    let app = app_default().await;
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

#[actix_web::test]
async fn a_refresh_token_only_works_with_the_access_token_of_its_owner() {
    let app = app_default().await;
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

#[actix_web::test]
async fn the_role_is_in_the_access_token_and_survives_a_refresh() {
    let store = Arc::new(MemoryStore::new());
    let app = app_with(store.clone(), Duration::from_secs(3600)).await;
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

#[actix_web::test]
async fn openapi_docs_are_public() {
    let app = app_default().await;
    for path in ["/openapi.json", "/docs/"] {
        let (status, _) = call(&app, request(TestRequest::get(), path, None)).await;
        assert_eq!(status, StatusCode::OK, "{path}");
    }
    let (_, spec) = call(&app, request(TestRequest::get(), "/openapi.json", None)).await;
    for path in [
        "/register",
        "/login",
        "/refresh",
        "/logout",
        "/health",
        "/users",
        "/user/{id}",
    ] {
        assert!(spec["paths"][path].is_object(), "{path} absent de la spec");
    }
}
