//! Parcours HTTP des routes des statistiques, sur un store en mémoire.

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

/// Store, application, jeton d'un administrateur et jeton d'un simple utilisateur.
async fn setup() -> (Arc<MemoryStore>, app_type!(), String, String) {
    let store = Arc::new(MemoryStore::new());
    let app = app_with(store.clone(), Duration::from_secs(3600)).await;
    logged_in_as(&app, "root", "secret123").await;
    store.set_role("root", Role::Admin);
    let (_, session) = login(&app, "root", "secret123").await;
    let admin = access(&session).to_string();
    let session = logged_in_as(&app, "alice", "secret123").await;
    let user = access(&session).to_string();
    (store, app, admin, user)
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

async fn create_stat(app: &app_type!(), admin: &str, name: &str, key: &str) -> Value {
    let (status, stat) = send(
        app,
        TestRequest::post(),
        "/stats",
        admin,
        Some(json!({ "name": name, "key": key, "type": "flat" })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{stat}");
    stat
}

async fn create_game(app: &app_type!(), admin: &str, name: &str) -> String {
    let (status, game) = send(
        app,
        TestRequest::post(),
        "/games",
        admin,
        Some(json!({ "name": name })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    game["id"].as_str().unwrap().to_string()
}

fn names(list: &Value) -> Vec<&str> {
    list.as_array()
        .unwrap()
        .iter()
        .map(|s| s["name"].as_str().unwrap())
        .collect()
}

#[actix_web::test]
async fn every_route_requires_a_token() {
    let (_, app, ..) = setup().await;
    let (id, game) = (Uuid::new_v4(), Uuid::new_v4());
    let requests = [
        (TestRequest::get(), "/stats".to_string()),
        (TestRequest::post(), "/stats".to_string()),
        (TestRequest::get(), format!("/stats/{id}")),
        (TestRequest::patch(), format!("/stats/{id}")),
        (TestRequest::delete(), format!("/stats/{id}")),
        (TestRequest::get(), format!("/games/{game}/stats")),
        (TestRequest::put(), format!("/games/{game}/stats/{id}")),
        (TestRequest::delete(), format!("/games/{game}/stats/{id}")),
    ];
    for (method, path) in requests {
        let (status, body) = call(&app, request(method, &path, None).set_json(json!({}))).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED, "{path}");
        assert_eq!(body["error"], "unauthorized", "{path}");
    }
}

#[actix_web::test]
async fn admin_manages_stats_and_everyone_reads_them() {
    let (_, app, admin, user) = setup().await;

    let (status, stat) = send(
        &app,
        TestRequest::post(),
        "/stats",
        &admin,
        Some(json!({ "name": "  Éliminations ", "key": "kills", "type": "flat" })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(stat["name"], "Éliminations");
    assert_eq!(stat["key"], "kills");
    assert_eq!(stat["type"], "flat");
    let id = stat["id"].as_str().unwrap();
    create_stat(&app, &admin, "Aide", "assists").await;

    let (status, list) = send(&app, TestRequest::get(), "/stats", &user, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(names(&list), ["Aide", "Éliminations"]);
    let (status, page) = send(
        &app,
        TestRequest::get(),
        "/stats?limit=1&offset=1",
        &user,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(names(&page), ["Éliminations"]);
    let (status, one) = send(
        &app,
        TestRequest::get(),
        &format!("/stats/{id}"),
        &user,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(one, stat);

    let (status, updated) = send(
        &app,
        TestRequest::patch(),
        &format!("/stats/{id}"),
        &admin,
        Some(json!({ "type": "percent", "key": "kill_rate" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(updated["type"], "percent");
    assert_eq!(updated["key"], "kill_rate");
    assert_eq!(updated["name"], "Éliminations");

    let (status, _) = send(
        &app,
        TestRequest::delete(),
        &format!("/stats/{id}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (status, body) = send(
        &app,
        TestRequest::get(),
        &format!("/stats/{id}"),
        &user,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body["error"], "not_found");
}

#[actix_web::test]
async fn writes_are_reserved_to_administrators() {
    let (_, app, admin, user) = setup().await;
    let stat = create_stat(&app, &admin, "Kills", "kills").await;
    let id = stat["id"].as_str().unwrap();
    let game = create_game(&app, &admin, "Valorant").await;

    let requests = [
        (TestRequest::post(), "/stats".to_string()),
        (TestRequest::patch(), format!("/stats/{id}")),
        (TestRequest::delete(), format!("/stats/{id}")),
        (TestRequest::put(), format!("/games/{game}/stats/{id}")),
        (TestRequest::delete(), format!("/games/{game}/stats/{id}")),
    ];
    for (method, path) in requests {
        let (status, body) = send(
            &app,
            method,
            &path,
            &user,
            Some(json!({ "name": "x", "key": "x", "type": "flat" })),
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{path}");
        assert_eq!(body["error"], "forbidden", "{path}");
    }
}

#[actix_web::test]
async fn inputs_are_validated() {
    let (_, app, admin, _) = setup().await;
    let stat = create_stat(&app, &admin, "Kills", "kills").await;
    let id = stat["id"].as_str().unwrap();

    let bad = [
        json!({ "name": " ", "key": "kills2", "type": "flat" }),
        json!({ "name": "x".repeat(65), "key": "kills2", "type": "flat" }),
        json!({ "name": "A", "key": "Kills 2", "type": "flat" }),
        json!({ "name": "A", "key": "a__b", "type": "flat" }),
        json!({ "name": "A", "key": "", "type": "flat" }),
        json!({ "name": "A", "key": "a".repeat(65), "type": "flat" }),
        json!({ "name": "A", "key": "ok", "type": "ratio" }),
        json!({ "name": "A", "key": "ok" }),
    ];
    for body in bad {
        let (status, response) = send(
            &app,
            TestRequest::post(),
            "/stats",
            &admin,
            Some(body.clone()),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
        assert_eq!(response["error"], "invalid_request", "{body}");
    }
    let (_, response) = send(
        &app,
        TestRequest::post(),
        "/stats",
        &admin,
        Some(json!({ "name": "A", "key": "Bad Key", "type": "flat" })),
    )
    .await;
    assert!(response["errors"]["key"].is_string());

    for body in [json!({}), json!({ "key": "Bad" }), json!({ "name": "" })] {
        let (status, _) = send(
            &app,
            TestRequest::patch(),
            &format!("/stats/{id}"),
            &admin,
            Some(body.clone()),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    }
    let (status, _) = send(
        &app,
        TestRequest::patch(),
        &format!("/stats/{}", Uuid::new_v4()),
        &admin,
        Some(json!({ "name": "x" })),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = send(&app, TestRequest::get(), "/stats/pas-un-uuid", &admin, None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[actix_web::test]
async fn keys_are_unique() {
    let (_, app, admin, _) = setup().await;
    create_stat(&app, &admin, "Kills", "kills").await;
    let other = create_stat(&app, &admin, "Aide", "assists").await;

    let (status, body) = send(
        &app,
        TestRequest::post(),
        "/stats",
        &admin,
        Some(json!({ "name": "Autre", "key": "kills", "type": "percent" })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(body["error"], "stat_key_taken");

    let id = other["id"].as_str().unwrap();
    let (status, body) = send(
        &app,
        TestRequest::patch(),
        &format!("/stats/{id}"),
        &admin,
        Some(json!({ "key": "kills" })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(body["error"], "stat_key_taken");
    // Reprendre sa propre clé n'est pas un conflit.
    let (status, _) = send(
        &app,
        TestRequest::patch(),
        &format!("/stats/{id}"),
        &admin,
        Some(json!({ "key": "assists", "name": "Passes" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
}

#[actix_web::test]
async fn stats_are_linked_to_games() {
    let (_, app, admin, user) = setup().await;
    let game = create_game(&app, &admin, "Valorant").await;
    let other_game = create_game(&app, &admin, "Dota 2").await;
    let kills = create_stat(&app, &admin, "Kills", "kills").await;
    let placement = create_stat(&app, &admin, "Placement", "placement").await;
    let (kills, placement) = (
        kills["id"].as_str().unwrap(),
        placement["id"].as_str().unwrap(),
    );

    let (status, list) = send(
        &app,
        TestRequest::get(),
        &format!("/games/{game}/stats"),
        &user,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(list, json!([]));

    for stat in [placement, kills, kills] {
        let (status, _) = send(
            &app,
            TestRequest::put(),
            &format!("/games/{game}/stats/{stat}"),
            &admin,
            None,
        )
        .await;
        assert_eq!(status, StatusCode::NO_CONTENT, "idempotent");
    }
    let (_, list) = send(
        &app,
        TestRequest::get(),
        &format!("/games/{game}/stats"),
        &user,
        None,
    )
    .await;
    assert_eq!(names(&list), ["Kills", "Placement"]);
    let (_, list) = send(
        &app,
        TestRequest::get(),
        &format!("/games/{other_game}/stats"),
        &user,
        None,
    )
    .await;
    assert_eq!(list, json!([]));

    // Jeu ou statistique inconnu.
    let missing = Uuid::new_v4();
    for path in [
        format!("/games/{missing}/stats/{kills}"),
        format!("/games/{game}/stats/{missing}"),
    ] {
        let (status, _) = send(&app, TestRequest::put(), &path, &admin, None).await;
        assert_eq!(status, StatusCode::NOT_FOUND, "{path}");
    }
    let (status, _) = send(
        &app,
        TestRequest::get(),
        &format!("/games/{missing}/stats"),
        &user,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    let (status, _) = send(
        &app,
        TestRequest::delete(),
        &format!("/games/{game}/stats/{kills}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (status, _) = send(
        &app,
        TestRequest::delete(),
        &format!("/games/{game}/stats/{kills}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (_, list) = send(
        &app,
        TestRequest::get(),
        &format!("/games/{game}/stats"),
        &user,
        None,
    )
    .await;
    assert_eq!(names(&list), ["Placement"]);

    // Supprimer la statistique ou le jeu emporte la liaison, pas l'autre côté.
    let (status, _) = send(
        &app,
        TestRequest::delete(),
        &format!("/stats/{placement}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (_, list) = send(
        &app,
        TestRequest::get(),
        &format!("/games/{game}/stats"),
        &user,
        None,
    )
    .await;
    assert_eq!(list, json!([]));
    let (status, _) = send(
        &app,
        TestRequest::get(),
        &format!("/stats/{kills}"),
        &user,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
}

#[actix_web::test]
async fn a_stat_used_by_an_ongoing_tournament_cannot_be_deleted() {
    let (store, app, admin, _) = setup().await;
    let stat = create_stat(&app, &admin, "Kills", "kills").await;
    let id = stat["id"].as_str().unwrap();
    store.lock_stat(id.parse().unwrap());

    let (status, body) = send(
        &app,
        TestRequest::delete(),
        &format!("/stats/{id}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(body["error"], "stat_in_use");
    let (status, _) = send(
        &app,
        TestRequest::get(),
        &format!("/stats/{id}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
}
