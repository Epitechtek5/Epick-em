//! Parcours HTTP des routes des jeux, sur un store en mémoire.

mod common;

use actix_web::http::StatusCode;
use actix_web::test::TestRequest;
use api_public::config::AuthConfig;
use api_public::game_io::GameStats;
use api_public::store::{MemoryStore, Role, StoreError};
use api_public::{AppState, app};
use async_trait::async_trait;
use common::{access, app_with, call, logged_in_as, login, request};
use serde_json::{Value, json};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
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

/// Corps brut (fichier à importer) avec le jeton donné.
async fn send_raw(app: &app_type!(), path: &str, token: &str, body: &str) -> (StatusCode, Value) {
    call(
        app,
        request(TestRequest::post(), path, Some(token)).set_payload(body.to_string()),
    )
    .await
}

async fn export(app: &app_type!(), token: &str, format: &str) -> (StatusCode, String) {
    let response = actix_web::test::call_service(
        app,
        request(
            TestRequest::get(),
            &format!("/games/export?format={format}"),
            Some(token),
        )
        .to_request(),
    )
    .await;
    let status = response.status();
    let bytes = actix_web::test::read_body(response).await;
    (status, String::from_utf8(bytes.to_vec()).unwrap())
}

#[actix_web::test]
async fn export_then_import_reproduces_the_games() {
    for format in ["json", "csv"] {
        let (app, admin, _) = setup().await;
        let (status, _) = send(
            &app,
            TestRequest::post(),
            "/games",
            &admin,
            Some(json!({
                "name": "Valorant, \"FPS\"",
                "description": "ligne 1\nligne 2",
                "images": ["https://e.com/a.png", "https://e.com/b.png"],
            })),
        )
        .await;
        assert_eq!(status, StatusCode::CREATED);
        create(&app, &admin, "Dota 2").await;

        let (status, file) = export(&app, &admin, format).await;
        assert_eq!(status, StatusCode::OK);
        let (_, before) = send(&app, TestRequest::get(), "/games", &admin, None).await;

        // Un second import du même fichier met tout à jour, sans rien créer ni perdre.
        let (status, report) = send_raw(
            &app,
            &format!("/games/import?format={format}"),
            &admin,
            &file,
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{format}: {report}");
        assert_eq!(report, json!({ "created": 0, "updated": 2 }));
        let (_, after) = send(&app, TestRequest::get(), "/games", &admin, None).await;
        assert_eq!(before, after, "{format}");

        // Dans une base vide (autre instance), les mêmes jeux sont recréés à l'identique.
        let (other, other_admin, _) = setup().await;
        let (status, report) = send_raw(
            &other,
            &format!("/games/import?format={format}"),
            &other_admin,
            &file,
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(report, json!({ "created": 2, "updated": 0 }));
        let strip = |list: &Value| -> Vec<Value> {
            list.as_array()
                .unwrap()
                .iter()
                .map(|g| json!([g["name"], g["description"], g["images"]]))
                .collect()
        };
        let (_, copied) = send(&other, TestRequest::get(), "/games", &other_admin, None).await;
        assert_eq!(strip(&before), strip(&copied), "{format}");
    }
}

#[actix_web::test]
async fn import_updates_existing_games_by_name() {
    let (app, admin, _) = setup().await;
    let game = create(&app, &admin, "Valorant").await;
    let file = r#"{ "version": 1, "games": [
        { "name": "VALORANT", "description": "mis à jour" },
        { "name": "Dota 2" } ] }"#;
    let (status, report) = send_raw(&app, "/games/import", &admin, file).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(report, json!({ "created": 1, "updated": 1 }));
    let id = game["id"].as_str().unwrap();
    let (_, one) = send(
        &app,
        TestRequest::get(),
        &format!("/games/{id}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(one["name"], "VALORANT");
    assert_eq!(one["description"], "mis à jour");
}

#[actix_web::test]
async fn invalid_files_change_nothing() {
    let (app, admin, _) = setup().await;
    create(&app, &admin, "Valorant").await;
    let bad = [
        ("json", "pas du json"),
        ("json", r#"{ "version": 9, "games": [] }"#),
        (
            "json",
            r#"{ "version": 1, "games": [{ "name": "Nouveau" }, { "name": "  " }] }"#,
        ),
        (
            "json",
            r#"{ "version": 1, "games": [{ "name": "A" }, { "name": "a" }] }"#,
        ),
        (
            "json",
            r#"{ "version": 1, "games": [{ "name": "A", "stats": [1] }] }"#,
        ),
        ("csv", "name,description\nA,B\n"),
        ("csv", "name,description,images,stats\nNouveau,,,\n ,,,\n"),
        ("xml", "<games/>"),
    ];
    for (format, file) in bad {
        let (status, body) = send_raw(
            &app,
            &format!("/games/import?format={format}"),
            &admin,
            file,
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{format}: {file}");
        assert_eq!(body["error"], "invalid_request");
    }
    let (_, list) = send(&app, TestRequest::get(), "/games", &admin, None).await;
    assert_eq!(list.as_array().unwrap().len(), 1);
}

#[actix_web::test]
async fn import_and_export_are_reserved_to_administrators() {
    let (app, admin, user) = setup().await;
    create(&app, &admin, "Valorant").await;
    let (status, _) = export(&app, &user, "json").await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = send_raw(
        &app,
        "/games/import",
        &user,
        r#"{ "version": 1, "games": [{ "name": "Pirate" }] }"#,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = call(&app, request(TestRequest::get(), "/games/export", None)).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    let (_, list) = send(&app, TestRequest::get(), "/games", &admin, None).await;
    assert_eq!(list.as_array().unwrap().len(), 1);
}

/// Sous-niveau des statistiques de test : les statistiques sont de simples valeurs opaques.
#[derive(Default)]
struct FakeStats {
    by_game: Mutex<HashMap<uuid::Uuid, Vec<Value>>>,
}

#[async_trait]
impl GameStats for FakeStats {
    async fn export(&self, game_id: uuid::Uuid) -> Result<Vec<Value>, StoreError> {
        Ok(self
            .by_game
            .lock()
            .unwrap()
            .get(&game_id)
            .cloned()
            .unwrap_or_default())
    }

    fn validate(&self, stats: &[Value]) -> Option<String> {
        stats
            .iter()
            .any(|stat| !stat.is_object())
            .then(|| "chaque statistique doit être un objet".to_string())
    }

    async fn import(&self, game_id: uuid::Uuid, stats: Vec<Value>) -> Result<(), StoreError> {
        self.by_game.lock().unwrap().insert(game_id, stats);
        Ok(())
    }
}

#[actix_web::test]
async fn stats_are_delegated_to_the_stats_level() {
    let store = Arc::new(MemoryStore::new());
    let config = AuthConfig {
        jwt_secret: common::SECRET.into(),
        access_token_ttl: Duration::from_secs(900),
        refresh_token_ttl: Duration::from_secs(3600),
    };
    let stats = Arc::new(FakeStats::default());
    let state = AppState::new(store.clone(), config)
        .unwrap()
        .with_stats(stats.clone());
    let app = actix_web::test::init_service(app(state)).await;
    logged_in_as(&app, "root", "secret123").await;
    store.set_role("root", Role::Admin);
    let (_, session) = login(&app, "root", "secret123").await;
    let admin = access(&session).to_string();

    let file = r#"{ "version": 1, "games": [
        { "name": "Valorant", "stats": [{ "kills": 3 }, { "anything": ["goes", 1] }] } ] }"#;
    let (status, _) = send_raw(&app, "/games/import", &admin, file).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        stats.by_game.lock().unwrap().values().next().unwrap().len(),
        2
    );

    // L'export embarque les statistiques telles que le sous-niveau les fournit.
    let (_, exported) = export(&app, &admin, "json").await;
    let exported: Value = serde_json::from_str(&exported).unwrap();
    assert_eq!(
        exported["games"][0]["stats"],
        json!([{ "kills": 3 }, { "anything": ["goes", 1] }])
    );
    let (_, csv) = export(&app, &admin, "csv").await;
    let (status, _) = send_raw(&app, "/games/import?format=csv", &admin, &csv).await;
    assert_eq!(status, StatusCode::OK);

    // Sa validation décide : un fichier refusé n'écrit rien.
    let bad = r#"{ "version": 1, "games": [{ "name": "Dota 2", "stats": [42] }] }"#;
    let (status, body) = send_raw(&app, "/games/import", &admin, bad).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(body["errors"]["file"].as_str().unwrap().contains("objet"));
    let (_, list) = send(&app, TestRequest::get(), "/games", &admin, None).await;
    assert_eq!(list.as_array().unwrap().len(), 1);
}

#[actix_web::test]
async fn json_export_follows_the_documented_shape() {
    let (app, admin, _) = setup().await;
    let (status, _) = send(
        &app,
        TestRequest::post(),
        "/games",
        &admin,
        Some(
            json!({ "name": "Valorant", "description": "FPS", "images": ["https://e.com/a.png"] }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);

    // Sans paramètre, le format est le JSON.
    let (status, default) = export(&app, &admin, "json").await;
    assert_eq!(status, StatusCode::OK);
    let file: Value = serde_json::from_str(&default).unwrap();
    assert_eq!(file["version"], 1);
    let game = &file["games"][0];
    assert_eq!(game["name"], "Valorant");
    assert_eq!(game["description"], "FPS");
    assert_eq!(game["images"], json!(["https://e.com/a.png"]));
    assert!(game["stats"].is_array(), "{game}");

    let response = actix_web::test::call_service(
        &app,
        request(TestRequest::get(), "/games/export", Some(&admin)).to_request(),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let content_type = response
        .headers()
        .get("content-type")
        .unwrap()
        .to_str()
        .unwrap();
    assert!(
        content_type.starts_with("application/json"),
        "{content_type}"
    );
    let bytes = actix_web::test::read_body(response).await;
    assert_eq!(String::from_utf8(bytes.to_vec()).unwrap(), default);
}

#[actix_web::test]
async fn csv_export_has_a_header_and_one_line_per_game() {
    let (app, admin, _) = setup().await;
    for name in ["Valorant", "Dota 2"] {
        create(&app, &admin, name).await;
    }
    let response = actix_web::test::call_service(
        &app,
        request(TestRequest::get(), "/games/export?format=csv", Some(&admin)).to_request(),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let content_type = response
        .headers()
        .get("content-type")
        .unwrap()
        .to_str()
        .unwrap();
    assert!(content_type.starts_with("text/csv"), "{content_type}");
    let bytes = actix_web::test::read_body(response).await;
    let file = String::from_utf8(bytes.to_vec()).unwrap();

    let lines: Vec<&str> = file.lines().collect();
    assert_eq!(lines[0], "name,description,images,stats", "{file}");
    assert_eq!(lines.len(), 3, "{file}");
    assert!(
        file.contains("Valorant") && file.contains("Dota 2"),
        "{file}"
    );
}

#[actix_web::test]
async fn json_and_csv_files_are_interchangeable() {
    let (app, admin, _) = setup().await;
    let (status, _) = send(
        &app,
        TestRequest::post(),
        "/games",
        &admin,
        Some(json!({
            "name": "Valorant, \"FPS\"",
            "description": "ligne 1\nligne 2",
            "images": ["https://e.com/a.png", "https://e.com/b.png"],
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    create(&app, &admin, "Dota 2").await;
    let (_, as_json) = export(&app, &admin, "json").await;
    let (_, as_csv) = export(&app, &admin, "csv").await;

    // Un fichier JSON importé donne le même état qu'un fichier CSV : leurs deux exports se valent.
    let (from_json, token_json, _) = setup().await;
    let (status, report) = send_raw(
        &from_json,
        "/games/import?format=json",
        &token_json,
        &as_json,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{report}");
    let (from_csv, token_csv, _) = setup().await;
    let (status, report) =
        send_raw(&from_csv, "/games/import?format=csv", &token_csv, &as_csv).await;
    assert_eq!(status, StatusCode::OK, "{report}");

    for format in ["json", "csv"] {
        let (_, a) = export(&from_json, &token_json, format).await;
        let (_, b) = export(&from_csv, &token_csv, format).await;
        assert_eq!(a, b, "{format}");
    }
    let (_, a) = export(&from_json, &token_json, "json").await;
    assert_eq!(a, as_json);
    let (_, b) = export(&from_csv, &token_csv, "csv").await;
    assert_eq!(b, as_csv);
}

#[actix_web::test]
async fn a_file_in_the_wrong_format_is_refused() {
    let (app, admin, _) = setup().await;
    create(&app, &admin, "Valorant").await;
    let (_, as_json) = export(&app, &admin, "json").await;
    let (_, as_csv) = export(&app, &admin, "csv").await;
    for (format, file) in [("csv", &as_json), ("json", &as_csv)] {
        let (status, body) = send_raw(
            &app,
            &format!("/games/import?format={format}"),
            &admin,
            file,
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{format}: {body}");
    }
    let (_, list) = send(&app, TestRequest::get(), "/games", &admin, None).await;
    assert_eq!(list.as_array().unwrap().len(), 1);
}
