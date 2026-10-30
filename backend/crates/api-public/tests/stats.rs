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
        (TestRequest::get(), "/stats/export".to_string()),
        (TestRequest::post(), "/stats/import".to_string()),
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

async fn send_raw(app: &app_type!(), path: &str, token: &str, body: &str) -> (StatusCode, Value) {
    call(
        app,
        request(TestRequest::post(), path, Some(token)).set_payload(body.to_string()),
    )
    .await
}

async fn export(app: &app_type!(), path: &str, token: &str) -> (StatusCode, String) {
    let response = actix_web::test::call_service(
        app,
        request(TestRequest::get(), path, Some(token)).to_request(),
    )
    .await;
    let status = response.status();
    let bytes = actix_web::test::read_body(response).await;
    (status, String::from_utf8(bytes.to_vec()).unwrap())
}

async fn link(app: &app_type!(), admin: &str, game: &str, stat: &Value) {
    let (status, _) = send(
        app,
        TestRequest::put(),
        &format!("/games/{game}/stats/{}", stat["id"].as_str().unwrap()),
        admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
}

#[actix_web::test]
async fn exported_stats_are_imported_without_loss() {
    for format in ["json", "csv"] {
        let (_, app, admin, _) = setup().await;
        let valorant = create_game(&app, &admin, "Valorant, \"FPS\"").await;
        let dota = create_game(&app, &admin, "Dota 2").await;
        let kills = create_stat(&app, &admin, "Éliminations, \"kills\"", "kills").await;
        let (_, accuracy) = send(
            &app,
            TestRequest::post(),
            "/stats",
            &admin,
            Some(json!({ "name": "Précision", "key": "accuracy", "type": "percent" })),
        )
        .await;
        create_stat(&app, &admin, "Orpheline", "orphan").await;
        link(&app, &admin, &valorant, &kills).await;
        link(&app, &admin, &dota, &kills).await;
        link(&app, &admin, &valorant, &accuracy).await;

        let path = format!("/stats/export?format={format}");
        let (status, file) = export(&app, &path, &admin).await;
        assert_eq!(status, StatusCode::OK);

        // Une base vierge dotée des mêmes jeux retrouve les mêmes statistiques et liaisons.
        let (_, fresh, fresh_admin, _) = setup().await;
        create_game(&fresh, &fresh_admin, "Valorant, \"FPS\"").await;
        create_game(&fresh, &fresh_admin, "Dota 2").await;
        let import = format!("/stats/import?format={format}");
        let (status, report) = send_raw(&fresh, &import, &fresh_admin, &file).await;
        assert_eq!(status, StatusCode::OK, "{report}");
        assert_eq!(report, json!({ "created": 3, "updated": 0 }));
        let (_, again) = export(&fresh, &path, &fresh_admin).await;
        assert_eq!(again, file, "{format}");

        // Réimporter met à jour sans rien créer ni perdre.
        let (_, report) = send_raw(&fresh, &import, &fresh_admin, &file).await;
        assert_eq!(report, json!({ "created": 0, "updated": 3 }));
        let (_, again) = export(&fresh, &path, &fresh_admin).await;
        assert_eq!(again, file, "{format}");
    }
}

#[actix_web::test]
async fn import_updates_existing_stats_and_replaces_their_games() {
    let (_, app, admin, _) = setup().await;
    let valorant = create_game(&app, &admin, "Valorant").await;
    create_game(&app, &admin, "Dota 2").await;
    let kills = create_stat(&app, &admin, "Kills", "kills").await;
    link(&app, &admin, &valorant, &kills).await;

    let file = r#"{ "version": 1, "stats": [
        { "name": "Éliminations", "key": "kills", "type": "percent", "games": ["dota 2"] } ] }"#;
    let (status, report) = send_raw(&app, "/stats/import", &admin, file).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(report, json!({ "created": 0, "updated": 1 }));

    let id = kills["id"].as_str().unwrap();
    let (_, stat) = send(
        &app,
        TestRequest::get(),
        &format!("/stats/{id}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(stat["name"], "Éliminations");
    assert_eq!(stat["type"], "percent");
    let (_, list) = send(
        &app,
        TestRequest::get(),
        &format!("/games/{valorant}/stats"),
        &admin,
        None,
    )
    .await;
    assert_eq!(list, json!([]));
}

#[actix_web::test]
async fn invalid_files_change_nothing() {
    let (_, app, admin, _) = setup().await;
    create_game(&app, &admin, "Valorant").await;
    let bad = [
        ("json", "pas du json"),
        ("json", r#"{ "version": 9, "stats": [] }"#),
        (
            "json",
            r#"{ "version": 1, "stats": [
                { "name": "Ok", "key": "ok", "type": "flat" },
                { "name": " ", "key": "Mauvaise Clé", "type": "flat" } ] }"#,
        ),
        (
            "json",
            r#"{ "version": 1, "stats": [
                { "name": "A", "key": "a", "type": "flat" },
                { "name": "B", "key": "a", "type": "flat" } ] }"#,
        ),
        (
            "json",
            r#"{ "version": 1, "stats": [
                { "name": "A", "key": "a", "type": "flat", "games": ["Inconnu"] } ] }"#,
        ),
        ("csv", "name,key\nA,a\n"),
        ("csv", "name,key,type,games\nA,a,ratio,\n"),
        ("xml", "<stats/>"),
    ];
    for (format, file) in bad {
        let (status, body) = send_raw(
            &app,
            &format!("/stats/import?format={format}"),
            &admin,
            file,
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{format}: {file}");
        assert_eq!(body["error"], "invalid_request");
    }
    let (_, list) = send(&app, TestRequest::get(), "/stats", &admin, None).await;
    assert_eq!(list, json!([]));
}

#[actix_web::test]
async fn import_and_export_are_reserved_to_administrators() {
    let (_, app, admin, user) = setup().await;
    create_stat(&app, &admin, "Kills", "kills").await;
    let (status, _) = export(&app, "/stats/export", &user).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = send_raw(
        &app,
        "/stats/import",
        &user,
        r#"{ "version": 1, "stats": [{ "name": "P", "key": "p", "type": "flat" }] }"#,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = call(&app, request(TestRequest::get(), "/stats/export", None)).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    let (_, list) = send(&app, TestRequest::get(), "/stats", &admin, None).await;
    assert_eq!(list.as_array().unwrap().len(), 1);
}

#[actix_web::test]
async fn games_files_carry_their_stats() {
    let (_, app, admin, _) = setup().await;
    let valorant = create_game(&app, &admin, "Valorant").await;
    let kills = create_stat(&app, &admin, "Kills", "kills").await;
    link(&app, &admin, &valorant, &kills).await;

    let (_, file) = export(&app, "/games/export", &admin).await;
    let exported: Value = serde_json::from_str(&file).unwrap();
    assert_eq!(
        exported["games"][0]["stats"],
        json!([{ "name": "Kills", "key": "kills", "type": "flat" }])
    );

    // Importer dans le jeu remplace ses statistiques ; celles du fichier sont créées au besoin.
    let file = r#"{ "version": 1, "games": [{ "name": "VALORANT", "stats": [
        { "name": "Placement", "key": "placement", "type": "flat" },
        { "name": "Précision", "key": "accuracy", "type": "percent" } ] }] }"#;
    let (status, report) = send_raw(&app, "/games/import", &admin, file).await;
    assert_eq!(status, StatusCode::OK, "{report}");
    let (_, list) = send(
        &app,
        TestRequest::get(),
        &format!("/games/{valorant}/stats"),
        &admin,
        None,
    )
    .await;
    assert_eq!(names(&list), ["Placement", "Précision"]);
    let (_, all) = send(&app, TestRequest::get(), "/stats", &admin, None).await;
    assert_eq!(all.as_array().unwrap().len(), 3, "kills n'est que délié");

    for bad in [
        r#"[1]"#,
        r#"[{ "name": "A", "key": "Bad Key", "type": "flat" }]"#,
        r#"[{ "name": "A", "key": "a", "type": "flat" }, { "name": "B", "key": "a", "type": "flat" }]"#,
        r#"[{ "name": "A", "key": "a" }]"#,
    ] {
        let file =
            format!(r#"{{ "version": 1, "games": [{{ "name": "Valorant", "stats": {bad} }}] }}"#);
        let (status, body) = send_raw(&app, "/games/import", &admin, &file).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{bad}");
        assert!(body["errors"]["file"].as_str().unwrap().contains("stats"));
    }
    let (_, list) = send(
        &app,
        TestRequest::get(),
        &format!("/games/{valorant}/stats"),
        &admin,
        None,
    )
    .await;
    assert_eq!(names(&list), ["Placement", "Précision"]);
}
