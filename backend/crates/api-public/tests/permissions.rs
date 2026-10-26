//! Droits de chaque route qui écrit : un compte ordinaire reçoit `403` sur les routes réservées
//! aux administrateurs, et un compte étranger reçoit `403` sur les ressources d'autrui
//! (équipes, inscriptions). Une ligne par route.

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

async fn post(app: &app_type!(), path: &str, token: &str, body: Value) -> (StatusCode, Value) {
    send(app, TestRequest::post(), path, token, Some(body)).await
}

fn id(value: &Value) -> String {
    value["id"].as_str().unwrap().to_string()
}

/// Ce que la route attend : le verbe, le chemin et un corps valide, pour que le refus vienne du
/// contrôle des droits et non de la validation de la requête.
type Route = (&'static str, String, Option<Value>);

fn method(verb: &str) -> TestRequest {
    match verb {
        "GET" => TestRequest::get(),
        "POST" => TestRequest::post(),
        "PUT" => TestRequest::put(),
        "PATCH" => TestRequest::patch(),
        "DELETE" => TestRequest::delete(),
        other => panic!("verbe {other}"),
    }
}

/// Toutes les routes de lecture seule ou publiques sont exclues : seules celles qui écrivent.
#[actix_web::test]
async fn every_admin_route_refuses_an_ordinary_account() {
    let store = Arc::new(MemoryStore::new());
    let app = app_with(store.clone(), Duration::from_secs(3600)).await;
    logged_in_as(&app, "root", "secret123").await;
    store.set_role("root", Role::Admin);
    let (_, session) = login(&app, "root", "secret123").await;
    let admin = access(&session).to_string();
    let user = access(&logged_in_as(&app, "alice", "secret123").await).to_string();

    let (a, b, c, d) = (
        Uuid::new_v4(),
        Uuid::new_v4(),
        Uuid::new_v4(),
        Uuid::new_v4(),
    );
    let steps = format!("/tournaments/{a}/steps");
    let matches = format!("{steps}/{b}/matches");
    let routes: Vec<Route> = vec![
        ("PATCH", format!("/user/{a}/update"), Some(json!({}))),
        ("DELETE", format!("/user/{a}/delete"), None),
        ("POST", "/games".into(), Some(json!({ "name": "Jeu" }))),
        ("PATCH", format!("/games/{a}"), Some(json!({}))),
        ("DELETE", format!("/games/{a}"), None),
        ("GET", "/games/export".into(), None),
        ("POST", "/games/import".into(), None),
        (
            "POST",
            "/stats".into(),
            Some(json!({ "name": "Kills", "key": "kills", "type": "flat" })),
        ),
        ("PATCH", format!("/stats/{a}"), Some(json!({}))),
        ("DELETE", format!("/stats/{a}"), None),
        ("PUT", format!("/games/{a}/stats/{b}"), None),
        ("DELETE", format!("/games/{a}/stats/{b}"), None),
        ("GET", "/stats/export".into(), None),
        ("POST", "/stats/import".into(), None),
        ("GET", "/teams/export".into(), None),
        ("POST", "/teams/import".into(), None),
        (
            "POST",
            "/tournaments".into(),
            Some(json!({
                "game_id": a, "name": "Open", "start_date": "2026-11-14T18:00:00Z",
                "end_date": "2026-11-15T18:00:00Z", "participant_type": "solo",
                "max_participants": 4,
            })),
        ),
        ("PATCH", format!("/tournaments/{a}"), Some(json!({}))),
        ("DELETE", format!("/tournaments/{a}"), None),
        (
            "POST",
            format!("/tournaments/{a}/status"),
            Some(json!({ "status": "registration" })),
        ),
        (
            "POST",
            format!("/tournaments/{a}/scoring-rules"),
            Some(json!({ "stat_id": b, "mode": "linear", "coefficient": 1 })),
        ),
        (
            "PATCH",
            format!("/tournaments/{a}/scoring-rules/{b}"),
            Some(json!({ "mode": "linear", "coefficient": 1 })),
        ),
        (
            "DELETE",
            format!("/tournaments/{a}/scoring-rules/{b}"),
            None,
        ),
        ("GET", "/tournaments/export".into(), None),
        ("POST", "/tournaments/import".into(), None),
        (
            "POST",
            steps.clone(),
            Some(json!({
                "position": 1, "format": "pool", "match_type": "ffa", "group_count": 1,
                "group_size": 4, "advance_per_group": 1,
            })),
        ),
        ("PATCH", format!("{steps}/{b}"), Some(json!({}))),
        ("DELETE", format!("{steps}/{b}"), None),
        ("POST", format!("{steps}/{b}/start"), None),
        ("POST", format!("{steps}/{b}/close"), None),
        ("POST", matches.clone(), Some(json!({ "group_id": c }))),
        ("PATCH", format!("{matches}/{c}"), Some(json!({}))),
        ("DELETE", format!("{matches}/{c}"), None),
        (
            "PUT",
            format!("{matches}/{c}/results"),
            Some(json!({ "results": [] })),
        ),
        (
            "POST",
            format!("{matches}/{c}/status"),
            Some(json!({ "status": "ongoing" })),
        ),
    ];
    for (verb, path, body) in routes {
        let (status, _) = send(&app, method(verb), &path, &user, body.clone()).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{verb} {path}");
        // L'administrateur passe le contrôle des droits (la ressource n'existe pas : pas de 403).
        let (status, _) = send(&app, method(verb), &path, &admin, body).await;
        assert_ne!(status, StatusCode::FORBIDDEN, "admin {verb} {path}");
        assert_ne!(status, StatusCode::UNAUTHORIZED, "admin {verb} {path}");
    }
}

#[actix_web::test]
async fn every_owned_resource_refuses_another_account() {
    let store = Arc::new(MemoryStore::new());
    let app = app_with(store.clone(), Duration::from_secs(3600)).await;
    logged_in_as(&app, "root", "secret123").await;
    store.set_role("root", Role::Admin);
    let (_, session) = login(&app, "root", "secret123").await;
    let admin = access(&session).to_string();
    let alice = access(&logged_in_as(&app, "alice", "secret123").await).to_string();
    let bob = access(&logged_in_as(&app, "bob", "secret123").await).to_string();
    let (_, users) = send(&app, TestRequest::get(), "/users", &admin, None).await;
    let user_id = |name: &str| -> String {
        users
            .as_array()
            .unwrap()
            .iter()
            .find(|u| u["username"] == name)
            .map(id)
            .unwrap()
    };
    let (alice_id, bob_id) = (user_id("alice"), user_id("bob"));

    let (_, game) = post(&app, "/games", &admin, json!({ "name": "TFT" })).await;
    let game = id(&game);
    let (_, tournament) = post(
        &app,
        "/tournaments",
        &admin,
        json!({
            "game_id": game, "name": "Open", "start_date": "2026-11-14T18:00:00Z",
            "end_date": "2026-11-15T18:00:00Z", "participant_type": "solo",
            "max_participants": 4,
        }),
    )
    .await;
    let tid = id(&tournament);
    post(
        &app,
        &format!("/tournaments/{tid}/status"),
        &admin,
        json!({ "status": "registration" }),
    )
    .await;
    let (status, participant) = post(
        &app,
        &format!("/tournaments/{tid}/participants"),
        &alice,
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{participant}");
    let pid = id(&participant);
    let (_, team) = post(
        &app,
        "/teams",
        &alice,
        json!({ "game_id": game, "name": "Les Alice" }),
    )
    .await;
    let team = id(&team);
    let (status, copy) = post(
        &app,
        &format!("/tournaments/{tid}/teams"),
        &alice,
        json!({ "name": "Copie" }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{copy}");
    let copy = id(&copy);

    let routes: Vec<Route> = vec![
        (
            "PATCH",
            format!("/teams/{team}"),
            Some(json!({ "tag": "X" })),
        ),
        ("DELETE", format!("/teams/{team}"), None),
        (
            "POST",
            format!("/teams/{team}/members"),
            Some(json!({ "user_id": bob_id, "role": "member" })),
        ),
        (
            "PATCH",
            format!("/teams/{team}/members/{alice_id}"),
            Some(json!({ "role": "substitute" })),
        ),
        ("DELETE", format!("/teams/{team}/members/{alice_id}"), None),
        (
            "PATCH",
            format!("/tournament-teams/{copy}"),
            Some(json!({ "tag": "X" })),
        ),
        ("DELETE", format!("/tournament-teams/{copy}"), None),
        (
            "POST",
            format!("/tournament-teams/{copy}/members"),
            Some(json!({ "user_id": bob_id, "role": "member" })),
        ),
        (
            "PATCH",
            format!("/tournament-teams/{copy}/members/{alice_id}"),
            Some(json!({ "role": "substitute" })),
        ),
        (
            "DELETE",
            format!("/tournament-teams/{copy}/members/{alice_id}"),
            None,
        ),
        (
            "POST",
            format!("/tournaments/{tid}/participants"),
            Some(json!({ "user_id": alice_id })),
        ),
        (
            "PATCH",
            format!("/tournaments/{tid}/participants/{pid}"),
            Some(json!({ "status": "withdrawn" })),
        ),
        (
            "DELETE",
            format!("/tournaments/{tid}/participants/{pid}"),
            None,
        ),
        (
            "POST",
            format!("/tournaments/{tid}/participants/{pid}/check-in"),
            None,
        ),
    ];
    for (verb, path, body) in routes {
        let (status, error) = send(&app, method(verb), &path, &bob, body).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{verb} {path} : {error}");
    }
    // Rien n'a bougé : l'équipe et l'inscription existent toujours, intactes.
    let (status, team_after) = send(
        &app,
        TestRequest::get(),
        &format!("/teams/{team}"),
        &bob,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(team_after["tag"], Value::Null);
    let (_, members) = send(
        &app,
        TestRequest::get(),
        &format!("/teams/{team}/members"),
        &bob,
        None,
    )
    .await;
    assert_eq!(members.as_array().unwrap().len(), 1);
    let (_, participants) = send(
        &app,
        TestRequest::get(),
        &format!("/tournaments/{tid}/participants"),
        &bob,
        None,
    )
    .await;
    assert_eq!(participants[0]["status"], "registered");

    // Le propriétaire, lui, passe : contrôle de non-régression sur une route de chaque famille.
    let (status, _) = send(
        &app,
        TestRequest::patch(),
        &format!("/teams/{team}"),
        &alice,
        Some(json!({ "tag": "AL" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (status, _) = send(
        &app,
        TestRequest::patch(),
        &format!("/tournaments/{tid}/participants/{pid}"),
        &alice,
        Some(json!({ "status": "withdrawn" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
}
