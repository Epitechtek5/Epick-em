//! Parcours HTTP des routes des jeux, sur un store en mémoire.

mod common;

use actix_web::http::StatusCode;
use actix_web::test::TestRequest;
use api_public::store::{MemoryStore, Role};
use common::{access, app_with, call, logged_in_as, login, request};
use serde_json::{Value, json};
use std::sync::Arc;
use std::time::Duration;
use uuid::Uuid;

macro_rules! app_type {
    () => {
        impl actix_web::dev::Service<
            actix_http::Request,
            Response = actix_web::dev::ServiceResponse<impl actix_web::body::MessageBody>,
            Error = actix_web::Error,
        >
    };
}

/// Application, jeton d'un administrateur et jeton d'un simple utilisateur.
async fn setup() -> (app_type!(), String, String) {
    let store = Arc::new(MemoryStore::new());
    let app = app_with(store.clone(), Duration::from_secs(3600)).await;
    logged_in_as(&app, "root", "secret123").await;
    store.set_role("root", Role::Admin);
    let (_, session) = login(&app, "root", "secret123").await;
    let admin = access(&session).to_string();
    let session = logged_in_as(&app, "alice", "secret123").await;
    let user = access(&session).to_string();
    (app, admin, user)
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

async fn create(app: &app_type!(), admin: &str, name: &str) -> Value {
    let (status, game) = send(
        app,
        TestRequest::post(),
        "/games",
        admin,
        Some(json!({ "name": name })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    game
}

#[actix_web::test]
async fn every_route_requires_a_token() {
    let (app, ..) = setup().await;
    let id = Uuid::new_v4();
    let requests = [
        (TestRequest::get(), "/games".to_string()),
        (TestRequest::post(), "/games".to_string()),
        (TestRequest::get(), format!("/games/{id}")),
        (TestRequest::patch(), format!("/games/{id}")),
        (TestRequest::delete(), format!("/games/{id}")),
    ];
    for (method, path) in requests {
        let (status, body) = call(
            &app,
            request(method, &path, None).set_json(json!({ "name": "x" })),
        )
        .await;
        assert_eq!(status, StatusCode::UNAUTHORIZED, "{path}");
        assert_eq!(body["error"], "unauthorized", "{path}");
    }
}

#[actix_web::test]
async fn admin_manages_games_and_everyone_reads_them() {
    let (app, admin, user) = setup().await;

    let (status, game) = send(
        &app,
        TestRequest::post(),
        "/games",
        &admin,
        Some(json!({
            "name": "  Valorant ",
            "description": "FPS tactique",
            "images": ["https://example.com/valorant.png"],
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(game["name"], "Valorant");
    assert_eq!(game["images"], json!(["https://example.com/valorant.png"]));
    let id = game["id"].as_str().unwrap();
    create(&app, &admin, "Dota 2").await;

    // Un simple utilisateur lit la liste (ordre alphabétique) et le détail.
    let (status, list) = send(&app, TestRequest::get(), "/games", &user, None).await;
    assert_eq!(status, StatusCode::OK);
    let names: Vec<_> = list
        .as_array()
        .unwrap()
        .iter()
        .map(|g| g["name"].as_str().unwrap())
        .collect();
    assert_eq!(names, ["Dota 2", "Valorant"]);
    let (status, one) = send(
        &app,
        TestRequest::get(),
        &format!("/games/{id}"),
        &user,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(one, game);

    let (status, updated) = send(
        &app,
        TestRequest::patch(),
        &format!("/games/{id}"),
        &admin,
        Some(json!({ "description": "Nouvelle description", "images": [] })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(updated["name"], "Valorant");
    assert_eq!(updated["description"], "Nouvelle description");
    assert_eq!(updated["images"], json!([]));

    let (status, _) = send(
        &app,
        TestRequest::delete(),
        &format!("/games/{id}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (status, body) = send(
        &app,
        TestRequest::get(),
        &format!("/games/{id}"),
        &user,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body["error"], "not_found");
}

#[actix_web::test]
async fn writes_are_reserved_to_administrators() {
    let (app, admin, user) = setup().await;
    let game = create(&app, &admin, "Valorant").await;
    let id = game["id"].as_str().unwrap();

    let attempts = [
        (TestRequest::post(), "/games".to_string()),
        (TestRequest::patch(), format!("/games/{id}")),
        (TestRequest::delete(), format!("/games/{id}")),
    ];
    for (method, path) in attempts {
        let (status, body) =
            send(&app, method, &path, &user, Some(json!({ "name": "Hack" }))).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{path}");
        assert_eq!(body["error"], "forbidden", "{path}");
    }
    let (_, one) = send(
        &app,
        TestRequest::get(),
        &format!("/games/{id}"),
        &user,
        None,
    )
    .await;
    assert_eq!(one["name"], "Valorant");
}

#[actix_web::test]
async fn names_are_unique_whatever_the_case() {
    let (app, admin, _) = setup().await;
    create(&app, &admin, "Valorant").await;
    let other = create(&app, &admin, "Dota 2").await;

    let (status, body) = send(
        &app,
        TestRequest::post(),
        "/games",
        &admin,
        Some(json!({ "name": "VALORANT" })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(body["error"], "game_name_taken");

    let id = other["id"].as_str().unwrap();
    let (status, body) = send(
        &app,
        TestRequest::patch(),
        &format!("/games/{id}"),
        &admin,
        Some(json!({ "name": "valorant" })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(body["error"], "game_name_taken");

    // Garder son propre nom n'est pas un conflit.
    let (status, _) = send(
        &app,
        TestRequest::patch(),
        &format!("/games/{id}"),
        &admin,
        Some(json!({ "name": "DOTA 2" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
}

#[actix_web::test]
async fn invalid_input_is_rejected_with_field_details() {
    let (app, admin, _) = setup().await;
    let game = create(&app, &admin, "Valorant").await;
    let id = game["id"].as_str().unwrap();

    let too_many: Vec<_> = (0..11).map(|i| format!("https://e.com/{i}.png")).collect();
    let bad_bodies = [
        (json!({ "name": "   " }), "name"),
        (json!({ "name": "x".repeat(65) }), "name"),
        (
            json!({ "name": "ok", "description": "d".repeat(2001) }),
            "description",
        ),
        (
            json!({ "name": "ok", "images": ["ftp://e.com/a.png"] }),
            "images",
        ),
        (
            json!({ "name": "ok", "images": ["https://e.com/a b.png"] }),
            "images",
        ),
        (json!({ "name": "ok", "images": too_many }), "images"),
    ];
    for (body, field) in bad_bodies {
        let (status, response) = send(
            &app,
            TestRequest::post(),
            "/games",
            &admin,
            Some(body.clone()),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
        assert!(response["errors"][field].is_string(), "{body}");
    }

    let (status, _) = send(&app, TestRequest::post(), "/games", &admin, Some(json!({}))).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, response) = send(
        &app,
        TestRequest::patch(),
        &format!("/games/{id}"),
        &admin,
        Some(json!({})),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(response["errors"]["body"].is_string());
    let (status, response) = send(
        &app,
        TestRequest::patch(),
        &format!("/games/{id}"),
        &admin,
        Some(json!({ "name": "" })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(response["errors"]["name"].is_string());
}

#[actix_web::test]
async fn unknown_games_are_not_found() {
    let (app, admin, _) = setup().await;
    let id = Uuid::new_v4();
    for (method, body) in [
        (TestRequest::get(), None),
        (TestRequest::patch(), Some(json!({ "name": "x" }))),
        (TestRequest::delete(), None),
    ] {
        let (status, response) = send(&app, method, &format!("/games/{id}"), &admin, body).await;
        assert_eq!(status, StatusCode::NOT_FOUND);
        assert_eq!(response["error"], "not_found");
    }
    let (status, _) = send(&app, TestRequest::get(), "/games/pas-un-uuid", &admin, None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[actix_web::test]
async fn listing_is_paginated() {
    let (app, admin, _) = setup().await;
    for name in ["A", "B", "C"] {
        create(&app, &admin, name).await;
    }
    let (_, page) = send(
        &app,
        TestRequest::get(),
        "/games?limit=2&offset=1",
        &admin,
        None,
    )
    .await;
    let names: Vec<_> = page
        .as_array()
        .unwrap()
        .iter()
        .map(|g| g["name"].as_str().unwrap())
        .collect();
    assert_eq!(names, ["B", "C"]);
}
