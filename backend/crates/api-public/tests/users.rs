//! Parcours HTTP des routes de gestion des comptes, sur un store en mémoire.

mod common;

use actix_web::http::StatusCode;
use actix_web::test::TestRequest;
use api_public::store::{MemoryStore, Role};
use common::{access, app_with, call, logged_in_as, login, register, request};
use serde_json::{Value, json};
use std::sync::Arc;
use std::time::Duration;
use uuid::Uuid;

/// Application sur un store partagé avec le test, pour pouvoir promouvoir un compte.
async fn setup() -> (
    Arc<MemoryStore>,
    impl actix_web::dev::Service<
        actix_http::Request,
        Response = actix_web::dev::ServiceResponse<impl actix_web::body::MessageBody>,
        Error = actix_web::Error,
    >,
) {
    let store = Arc::new(MemoryStore::new());
    let app = app_with(store.clone(), Duration::from_secs(3600)).await;
    (store, app)
}

/// Inscrit et connecte `name` ; renvoie son jeton d'accès et son identifiant.
async fn user(
    app: &impl actix_web::dev::Service<
        actix_http::Request,
        Response = actix_web::dev::ServiceResponse<impl actix_web::body::MessageBody>,
        Error = actix_web::Error,
    >,
    name: &str,
) -> (String, String) {
    let session = logged_in_as(app, name, "secret123").await;
    let claims = api_public::auth::decode_access_token(access(&session), common::SECRET).unwrap();
    (access(&session).to_string(), claims.sub.to_string())
}

/// Promeut `name` en administrateur et renvoie un jeton d'accès portant ce rôle.
async fn promote(
    store: &MemoryStore,
    app: &impl actix_web::dev::Service<
        actix_http::Request,
        Response = actix_web::dev::ServiceResponse<impl actix_web::body::MessageBody>,
        Error = actix_web::Error,
    >,
    name: &str,
) -> String {
    store.set_role(name, Role::Admin);
    let (status, session) = login(app, name, "secret123").await;
    assert_eq!(status, StatusCode::OK);
    access(&session).to_string()
}

#[actix_web::test]
async fn every_route_requires_a_token() {
    let (_, app) = setup().await;
    let id = Uuid::new_v4();
    let requests = [
        (TestRequest::get(), "/users".to_string()),
        (TestRequest::get(), format!("/user/{id}")),
        (TestRequest::patch(), format!("/user/{id}/update")),
        (TestRequest::delete(), format!("/user/{id}/delete")),
        (TestRequest::patch(), "/me/update".to_string()),
        (TestRequest::delete(), "/me/delete".to_string()),
    ];
    for (method, path) in requests {
        let (status, body) = call(
            &app,
            request(method, &path, None).set_json(json!({ "username": "bob" })),
        )
        .await;
        assert_eq!(status, StatusCode::UNAUTHORIZED, "{path}");
        assert_eq!(body["error"], "unauthorized", "{path}");
    }
}

#[actix_web::test]
async fn users_can_be_listed_and_read() {
    let (_, app) = setup().await;
    let (token, alice) = user(&app, "alice").await;
    let (_, bob) = user(&app, "bob").await;

    let (status, list) = call(&app, request(TestRequest::get(), "/users", Some(&token))).await;
    assert_eq!(status, StatusCode::OK);
    let names: Vec<_> = list
        .as_array()
        .unwrap()
        .iter()
        .map(|u| u["username"].as_str().unwrap())
        .collect();
    assert_eq!(names, ["alice", "bob"]);
    assert!(!list.to_string().contains("password"));

    let (status, one) = call(
        &app,
        request(TestRequest::get(), &format!("/user/{bob}"), Some(&token)),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(one, json!({ "id": bob, "username": "bob", "role": "user" }));
    assert_ne!(alice, bob);
}

#[actix_web::test]
async fn listing_is_paginated() {
    let (_, app) = setup().await;
    let (token, _) = user(&app, "alice").await;
    for name in ["bob", "carol", "dave"] {
        assert_eq!(register(&app, name, "secret123").await, StatusCode::CREATED);
    }
    let page = |query: &'static str| {
        let app = &app;
        let token = &token;
        async move {
            let (status, list) = call(
                app,
                request(TestRequest::get(), &format!("/users{query}"), Some(token)),
            )
            .await;
            assert_eq!(status, StatusCode::OK, "{query}");
            list.as_array()
                .unwrap()
                .iter()
                .map(|u| u["username"].as_str().unwrap().to_string())
                .collect::<Vec<_>>()
        }
    };
    assert_eq!(page("?limit=2").await, ["alice", "bob"]);
    assert_eq!(page("?limit=2&offset=2").await, ["carol", "dave"]);
    assert_eq!(page("?offset=3").await, ["dave"]);
    // Les bornes sont ramenées dans la plage autorisée.
    assert_eq!(page("?limit=0").await.len(), 1);
    assert_eq!(page("?offset=-5").await.len(), 4);
}

#[actix_web::test]
async fn an_unknown_user_is_not_found() {
    let (_, app) = setup().await;
    let (token, _) = user(&app, "alice").await;
    for path in [
        format!("/user/{}", Uuid::new_v4()),
        "/user/pas-un-uuid".into(),
    ] {
        let (status, body) = call(&app, request(TestRequest::get(), &path, Some(&token))).await;
        assert_eq!(status, StatusCode::NOT_FOUND, "{path}");
        assert_eq!(body["error"], "not_found");
    }
}

#[actix_web::test]
async fn an_admin_updates_another_account() {
    let (store, app) = setup().await;
    let (_, _) = user(&app, "root").await;
    let (_, bob) = user(&app, "bob").await;
    let admin = promote(&store, &app, "root").await;

    let (status, updated) = call(
        &app,
        request(
            TestRequest::patch(),
            &format!("/user/{bob}/update"),
            Some(&admin),
        )
        .set_json(json!({ "username": "robert", "password": "nouveau-mdp-1", "role": "watcher" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        updated,
        json!({ "id": bob, "username": "robert", "role": "watcher" })
    );

    // Le nouveau mot de passe est celui qui fonctionne, et le rôle est dans le jeton.
    assert_eq!(
        login(&app, "robert", "secret123").await.0,
        StatusCode::UNAUTHORIZED
    );
    let (status, session) = login(&app, "robert", "nouveau-mdp-1").await;
    assert_eq!(status, StatusCode::OK);
    let claims = api_public::auth::decode_access_token(access(&session), common::SECRET).unwrap();
    assert_eq!(claims.role, Role::Watcher);
}

#[actix_web::test]
async fn a_partial_update_only_changes_the_given_fields() {
    let (store, app) = setup().await;
    let (_, _) = user(&app, "root").await;
    let (_, bob) = user(&app, "bob").await;
    let admin = promote(&store, &app, "root").await;

    let (status, updated) = call(
        &app,
        request(
            TestRequest::patch(),
            &format!("/user/{bob}/update"),
            Some(&admin),
        )
        .set_json(json!({ "role": "admin" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(updated["username"], "bob");
    assert_eq!(updated["role"], "admin");
    assert_eq!(login(&app, "bob", "secret123").await.0, StatusCode::OK);
}

#[actix_web::test]
async fn only_an_admin_updates_or_deletes_another_account() {
    let (_, app) = setup().await;
    let (alice_token, alice) = user(&app, "alice").await;
    let (_, bob) = user(&app, "bob").await;

    for (method, path, body) in [
        (
            TestRequest::patch(),
            format!("/user/{bob}/update"),
            json!({ "username": "robert" }),
        ),
        (
            TestRequest::delete(),
            format!("/user/{bob}/delete"),
            json!({}),
        ),
        // Y compris sur son propre compte : cela passe par /me/*.
        (
            TestRequest::patch(),
            format!("/user/{alice}/update"),
            json!({ "role": "admin" }),
        ),
    ] {
        let (status, response) = call(
            &app,
            request(method, &path, Some(&alice_token)).set_json(body),
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{path}");
        assert_eq!(response["error"], "forbidden");
    }
    let (status, bob_now) = call(
        &app,
        request(
            TestRequest::get(),
            &format!("/user/{bob}"),
            Some(&alice_token),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(bob_now["username"], "bob");
}

/// Le rôle du jeton peut être périmé : une action d'administration relit le rôle courant.
#[actix_web::test]
async fn a_demoted_admin_loses_access_with_the_old_token() {
    let (store, app) = setup().await;
    let (_, _) = user(&app, "root").await;
    let (_, bob) = user(&app, "bob").await;
    let admin = promote(&store, &app, "root").await;

    store.set_role("root", Role::User);
    let (status, _) = call(
        &app,
        request(
            TestRequest::delete(),
            &format!("/user/{bob}/delete"),
            Some(&admin),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[actix_web::test]
async fn updates_are_validated() {
    let (store, app) = setup().await;
    let (_, _) = user(&app, "root").await;
    let (_, bob) = user(&app, "bob").await;
    let admin = promote(&store, &app, "root").await;
    let path = format!("/user/{bob}/update");
    let patch = |body: Value| {
        let (app, admin, path) = (&app, &admin, &path);
        async move {
            call(
                app,
                request(TestRequest::patch(), path, Some(admin)).set_json(body),
            )
            .await
        }
    };

    let (status, body) = patch(json!({})).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(body["errors"]["body"].is_string());

    let (status, body) = patch(json!({ "username": "a b", "password": "court" })).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(body["errors"]["username"].is_string());
    assert!(body["errors"]["password"].is_string());

    // Rôle inconnu, ou type incorrect.
    assert_eq!(
        patch(json!({ "role": "dieu" })).await.0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        patch(json!({ "username": 3 })).await.0,
        StatusCode::BAD_REQUEST
    );

    // Nom déjà pris, quelle que soit la casse.
    let (status, body) = patch(json!({ "username": "ROOT" })).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(body["error"], "username_taken");

    // Rien n'a changé.
    assert_eq!(login(&app, "bob", "secret123").await.0, StatusCode::OK);
}

#[actix_web::test]
async fn updating_an_unknown_account_is_not_found() {
    let (store, app) = setup().await;
    let (_, _) = user(&app, "root").await;
    let admin = promote(&store, &app, "root").await;
    let (status, _) = call(
        &app,
        request(
            TestRequest::patch(),
            &format!("/user/{}/update", Uuid::new_v4()),
            Some(&admin),
        )
        .set_json(json!({ "username": "fantome" })),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[actix_web::test]
async fn an_admin_deletes_an_account() {
    let (store, app) = setup().await;
    let (_, _) = user(&app, "root").await;
    let (bob_token, bob) = user(&app, "bob").await;
    let admin = promote(&store, &app, "root").await;
    let delete = format!("/user/{bob}/delete");

    let (status, body) = call(&app, request(TestRequest::delete(), &delete, Some(&admin))).await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert_eq!(body, Value::Null);

    assert_eq!(
        login(&app, "bob", "secret123").await.0,
        StatusCode::UNAUTHORIZED
    );
    let (status, _) = call(
        &app,
        request(TestRequest::get(), &format!("/user/{bob}"), Some(&admin)),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = call(&app, request(TestRequest::delete(), &delete, Some(&admin))).await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    // Ses jetons de rafraîchissement sont révoqués avec le compte.
    let (status, _) = common::post_as(
        &app,
        &bob_token,
        "/refresh",
        json!({ "refresh_token": "peu importe" }),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[actix_web::test]
async fn a_user_updates_their_own_account() {
    let (_, app) = setup().await;
    let (token, alice) = user(&app, "alice").await;

    let (status, updated) = call(
        &app,
        request(TestRequest::patch(), "/me/update", Some(&token))
            .set_json(json!({ "username": "alicia", "password": "nouveau-mdp-1" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        updated,
        json!({ "id": alice, "username": "alicia", "role": "user" })
    );
    assert_eq!(
        login(&app, "alicia", "nouveau-mdp-1").await.0,
        StatusCode::OK
    );
    assert_eq!(
        login(&app, "alice", "secret123").await.0,
        StatusCode::UNAUTHORIZED
    );
}

#[actix_web::test]
async fn a_user_cannot_change_their_own_role() {
    let (store, app) = setup().await;
    let (token, _) = user(&app, "alice").await;
    let (status, body) = call(
        &app,
        request(TestRequest::patch(), "/me/update", Some(&token))
            .set_json(json!({ "role": "admin" })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(body["error"], "forbidden");

    // Un administrateur non plus : /user/{id}/update existe pour cela.
    let admin = promote(&store, &app, "alice").await;
    let (status, _) = call(
        &app,
        request(TestRequest::patch(), "/me/update", Some(&admin))
            .set_json(json!({ "role": "user" })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[actix_web::test]
async fn a_user_deletes_their_own_account() {
    let (_, app) = setup().await;
    let (token, alice) = user(&app, "alice").await;
    let (other, _) = user(&app, "bob").await;

    let (status, _) = call(
        &app,
        request(TestRequest::delete(), "/me/delete", Some(&token)),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert_eq!(
        login(&app, "alice", "secret123").await.0,
        StatusCode::UNAUTHORIZED
    );
    let (status, _) = call(
        &app,
        request(TestRequest::get(), &format!("/user/{alice}"), Some(&other)),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    // Le jeton d'accès reste valable jusqu'à son expiration, mais le compte n'existe plus.
    let (status, _) = call(
        &app,
        request(TestRequest::delete(), "/me/delete", Some(&token)),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}
