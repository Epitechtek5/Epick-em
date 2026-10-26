//! Parcours HTTP des routes des équipes globales et des équipes de tournoi, sur un store en
//! mémoire.

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

struct Account {
    token: String,
    id: String,
}

struct Setup {
    admin: String,
    alice: Account,
    bob: Account,
    carol: Account,
    game: String,
}

async fn account(app: &app_type!(), name: &str) -> Account {
    let session = logged_in_as(app, name, "secret123").await;
    let claims = api_public::auth::decode_access_token(access(&session), common::SECRET).unwrap();
    Account {
        token: access(&session).to_string(),
        id: claims.sub.to_string(),
    }
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

async fn setup() -> (app_type!(), Setup) {
    let store = Arc::new(MemoryStore::new());
    let app = app_with(store.clone(), Duration::from_secs(3600)).await;
    logged_in_as(&app, "root", "secret123").await;
    store.set_role("root", Role::Admin);
    let (_, session) = login(&app, "root", "secret123").await;
    let admin = access(&session).to_string();
    let alice = account(&app, "alice").await;
    let bob = account(&app, "bob").await;
    let carol = account(&app, "carol").await;
    let (status, game) = send(
        &app,
        TestRequest::post(),
        "/games",
        &admin,
        Some(json!({ "name": "Valorant" })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let game = game["id"].as_str().unwrap().to_string();
    let setup = Setup {
        admin,
        alice,
        bob,
        carol,
        game,
    };
    (app, setup)
}

/// Crée une équipe globale et renvoie son JSON.
async fn create_team(app: &app_type!(), s: &Setup, token: &str, name: &str) -> Value {
    let (status, team) = send(
        app,
        TestRequest::post(),
        "/teams",
        token,
        Some(json!({ "game_id": s.game, "name": name, "tag": "KC", "picture_url": "https://img.example/kc.png" })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{team}");
    team
}

async fn add_member(app: &app_type!(), owner: &str, team: &str, user: &str, role: &str) {
    let (status, member) = send(
        app,
        TestRequest::post(),
        &format!("/teams/{team}/members"),
        owner,
        Some(json!({ "user_id": user, "role": role })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{member}");
}

fn id(value: &Value) -> &str {
    value["id"].as_str().unwrap()
}

#[actix_web::test]
async fn every_route_requires_a_token() {
    let (app, _) = setup().await;
    let (a, b, c) = (Uuid::new_v4(), Uuid::new_v4(), Uuid::new_v4());
    let requests = [
        (TestRequest::get(), "/teams".to_string()),
        (TestRequest::post(), "/teams".to_string()),
        (TestRequest::get(), format!("/teams/{a}")),
        (TestRequest::patch(), format!("/teams/{a}")),
        (TestRequest::delete(), format!("/teams/{a}")),
        (TestRequest::get(), format!("/teams/{a}/members")),
        (TestRequest::post(), format!("/teams/{a}/members")),
        (TestRequest::patch(), format!("/teams/{a}/members/{b}")),
        (TestRequest::delete(), format!("/teams/{a}/members/{b}")),
        (TestRequest::get(), format!("/tournaments/{c}/teams")),
        (TestRequest::post(), format!("/tournaments/{c}/teams")),
        (TestRequest::get(), format!("/tournament-teams/{a}")),
        (TestRequest::patch(), format!("/tournament-teams/{a}")),
        (TestRequest::delete(), format!("/tournament-teams/{a}")),
        (TestRequest::get(), format!("/tournament-teams/{a}/members")),
        (
            TestRequest::post(),
            format!("/tournament-teams/{a}/members"),
        ),
        (
            TestRequest::patch(),
            format!("/tournament-teams/{a}/members/{b}"),
        ),
        (
            TestRequest::delete(),
            format!("/tournament-teams/{a}/members/{b}"),
        ),
    ];
    for (method, path) in requests {
        let (status, body) = call(&app, request(method, &path, None).set_json(json!({}))).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED, "{path}");
        assert_eq!(body["error"], "unauthorized", "{path}");
    }
}

#[actix_web::test]
async fn anyone_creates_a_team_and_becomes_its_owner() {
    let (app, s) = setup().await;
    let team = create_team(&app, &s, &s.alice.token, "Karmine Corp").await;
    assert_eq!(team["owner_id"], s.alice.id);
    assert_eq!(team["game_id"], s.game);
    assert_eq!(team["tag"], "KC");

    let (status, members) = send(
        &app,
        TestRequest::get(),
        &format!("/teams/{}/members", id(&team)),
        &s.bob.token,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(members.as_array().unwrap().len(), 1);
    assert_eq!(members[0]["user_id"], s.alice.id);
    assert_eq!(members[0]["role"], "owner");
    assert_eq!(members[0]["left_at"], Value::Null);

    // Tout le monde lit.
    let (status, read) = send(
        &app,
        TestRequest::get(),
        &format!("/teams/{}", id(&team)),
        &s.bob.token,
        None,
    )
    .await;
    assert_eq!((status, &read), (StatusCode::OK, &team));
}

#[actix_web::test]
async fn creation_is_validated() {
    let (app, s) = setup().await;
    let cases = [
        json!({ "game_id": s.game, "name": "  " }),
        json!({ "game_id": s.game, "name": "x".repeat(65) }),
        json!({ "game_id": s.game, "name": "ok", "tag": "123456789" }),
        json!({ "game_id": s.game, "name": "ok", "picture_url": "ftp://x" }),
        json!({ "game_id": Uuid::new_v4(), "name": "ok" }),
    ];
    for body in cases {
        let (status, error) = send(
            &app,
            TestRequest::post(),
            "/teams",
            &s.alice.token,
            Some(body.clone()),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
        assert_eq!(error["error"], "invalid_request");
    }
    let (status, _) = send(
        &app,
        TestRequest::post(),
        "/teams",
        &s.alice.token,
        Some(json!({ "name": "pas de jeu" })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    // Nom unique par jeu, sans tenir compte de la casse.
    create_team(&app, &s, &s.alice.token, "Karmine").await;
    let (status, error) = send(
        &app,
        TestRequest::post(),
        "/teams",
        &s.bob.token,
        Some(json!({ "game_id": s.game, "name": "KARMINE" })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(error["error"], "team_name_taken");
}

#[actix_web::test]
async fn only_the_owner_edits_and_deletes() {
    let (app, s) = setup().await;
    let team = create_team(&app, &s, &s.alice.token, "Karmine").await;
    let path = format!("/teams/{}", id(&team));

    for token in [&s.bob.token, &s.admin] {
        let (status, error) = send(
            &app,
            TestRequest::patch(),
            &path,
            token,
            Some(json!({ "name": "Volée" })),
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN);
        assert_eq!(error["error"], "forbidden");
        let (status, _) = send(&app, TestRequest::delete(), &path, token, None).await;
        assert_eq!(status, StatusCode::FORBIDDEN);
    }

    let (status, updated) = send(
        &app,
        TestRequest::patch(),
        &path,
        &s.alice.token,
        Some(json!({ "name": "Karmine Blue", "tag": "" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{updated}");
    assert_eq!(updated["name"], "Karmine Blue");
    assert_eq!(updated["tag"], Value::Null);
    assert_eq!(updated["picture_url"], "https://img.example/kc.png");

    let (status, _) = send(
        &app,
        TestRequest::patch(),
        &path,
        &s.alice.token,
        Some(json!({})),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    let (status, _) = send(&app, TestRequest::delete(), &path, &s.alice.token, None).await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (status, _) = send(&app, TestRequest::get(), &path, &s.alice.token, None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[actix_web::test]
async fn teams_are_listed_by_name_and_filtered_by_game() {
    let (app, s) = setup().await;
    create_team(&app, &s, &s.alice.token, "Zeta").await;
    create_team(&app, &s, &s.bob.token, "alpha").await;
    let (_, other) = send(
        &app,
        TestRequest::post(),
        "/games",
        &s.admin,
        Some(json!({ "name": "Dota 2" })),
    )
    .await;
    let (status, _) = send(
        &app,
        TestRequest::post(),
        "/teams",
        &s.alice.token,
        Some(json!({ "game_id": id(&other), "name": "Beta" })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);

    let names = |list: &Value| -> Vec<String> {
        list.as_array()
            .unwrap()
            .iter()
            .map(|t| t["name"].as_str().unwrap().to_string())
            .collect()
    };
    let (_, all) = send(&app, TestRequest::get(), "/teams", &s.carol.token, None).await;
    assert_eq!(names(&all), ["alpha", "Beta", "Zeta"]);
    let (_, one) = send(
        &app,
        TestRequest::get(),
        &format!("/teams?game_id={}", s.game),
        &s.carol.token,
        None,
    )
    .await;
    assert_eq!(names(&one), ["alpha", "Zeta"]);
    let (_, page) = send(
        &app,
        TestRequest::get(),
        "/teams?limit=1&offset=1",
        &s.carol.token,
        None,
    )
    .await;
    assert_eq!(names(&page), ["Beta"]);
}

#[actix_web::test]
async fn owner_manages_members() {
    let (app, s) = setup().await;
    let team = create_team(&app, &s, &s.alice.token, "Karmine").await;
    let team_id = id(&team);
    let members = format!("/teams/{team_id}/members");

    add_member(&app, &s.alice.token, team_id, &s.bob.id, "member").await;

    // Doublon, rôle `owner`, compte inconnu, droits.
    let body = |user: &str, role: &str| Some(json!({ "user_id": user, "role": role }));
    let (status, error) = send(
        &app,
        TestRequest::post(),
        &members,
        &s.alice.token,
        body(&s.bob.id, "substitute"),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(error["error"], "already_team_member");
    for (user, role) in [
        (s.carol.id.as_str(), "owner"),
        (Uuid::new_v4().to_string().as_str(), "member"),
    ] {
        let (status, _) = send(
            &app,
            TestRequest::post(),
            &members,
            &s.alice.token,
            body(user, role),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{user} {role}");
    }
    let (status, _) = send(
        &app,
        TestRequest::post(),
        &members,
        &s.bob.token,
        body(&s.carol.id, "member"),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    // Changement de rôle ; le propriétaire est intouchable.
    let one = format!("{members}/{}", s.bob.id);
    let (status, member) = send(
        &app,
        TestRequest::patch(),
        &one,
        &s.alice.token,
        Some(json!({ "role": "substitute" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{member}");
    assert_eq!(member["role"], "substitute");
    let owner = format!("{members}/{}", s.alice.id);
    let (status, _) = send(
        &app,
        TestRequest::patch(),
        &owner,
        &s.alice.token,
        Some(json!({ "role": "member" })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, _) = send(&app, TestRequest::delete(), &owner, &s.alice.token, None).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    // Départ : la ligne reste avec `left_at`, et le compte peut revenir.
    let (status, _) = send(&app, TestRequest::delete(), &one, &s.bob.token, None).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = send(&app, TestRequest::delete(), &one, &s.alice.token, None).await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (status, _) = send(&app, TestRequest::delete(), &one, &s.alice.token, None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (_, list) = send(&app, TestRequest::get(), &members, &s.alice.token, None).await;
    assert_eq!(list.as_array().unwrap().len(), 2);
    assert_ne!(list[1]["left_at"], Value::Null);

    add_member(&app, &s.alice.token, team_id, &s.bob.id, "member").await;
    let (_, list) = send(&app, TestRequest::get(), &members, &s.alice.token, None).await;
    assert_eq!(list.as_array().unwrap().len(), 3);
}

/// Inscrit une équipe de zéro ou par copie à `tournament`.
async fn register(
    app: &app_type!(),
    token: &str,
    tournament: &str,
    body: Value,
) -> (StatusCode, Value) {
    send(
        app,
        TestRequest::post(),
        &format!("/tournaments/{tournament}/teams"),
        token,
        Some(body),
    )
    .await
}

#[actix_web::test]
async fn copy_is_complete_and_independent() {
    let (app, s) = setup().await;
    let team = create_team(&app, &s, &s.alice.token, "Karmine").await;
    let team_id = id(&team);
    add_member(&app, &s.alice.token, team_id, &s.bob.id, "member").await;
    add_member(&app, &s.alice.token, team_id, &s.carol.id, "substitute").await;
    // Carol quitte l'équipe : elle n'est pas copiée.
    let (status, _) = send(
        &app,
        TestRequest::delete(),
        &format!("/teams/{team_id}/members/{}", s.carol.id),
        &s.alice.token,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    let tournament = Uuid::new_v4().to_string();
    // Seul le propriétaire inscrit sa propre équipe.
    let (status, _) = register(
        &app,
        &s.bob.token,
        &tournament,
        json!({ "team_id": team_id }),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    let (status, copy) = register(
        &app,
        &s.alice.token,
        &tournament,
        json!({ "team_id": team_id }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{copy}");
    assert_eq!(copy["team_id"], team_id);
    assert_eq!(copy["tournament_id"], tournament);
    for field in ["name", "tag", "picture_url", "owner_id"] {
        assert_eq!(copy[field], team[field], "{field}");
    }
    let copy_id = id(&copy);
    let (_, members) = send(
        &app,
        TestRequest::get(),
        &format!("/tournament-teams/{copy_id}/members"),
        &s.bob.token,
        None,
    )
    .await;
    let mut got: Vec<(String, String)> = members
        .as_array()
        .unwrap()
        .iter()
        .map(|m| {
            (
                m["user_id"].as_str().unwrap().to_string(),
                m["role"].as_str().unwrap().to_string(),
            )
        })
        .collect();
    got.sort();
    let mut want = vec![
        (s.alice.id.clone(), "owner".to_string()),
        (s.bob.id.clone(), "member".to_string()),
    ];
    want.sort();
    assert_eq!(got, want);

    // La copie est modifiée : l'équipe globale ne bouge pas.
    let (status, edited) = send(
        &app,
        TestRequest::patch(),
        &format!("/tournament-teams/{copy_id}"),
        &s.alice.token,
        Some(json!({ "name": "Karmine (tournoi)", "picture_url": "" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{edited}");
    let (_, global) = send(
        &app,
        TestRequest::get(),
        &format!("/teams/{team_id}"),
        &s.alice.token,
        None,
    )
    .await;
    assert_eq!(global, team);

    // L'équipe globale est modifiée : la copie ne bouge pas.
    let (status, _) = send(
        &app,
        TestRequest::patch(),
        &format!("/teams/{team_id}"),
        &s.alice.token,
        Some(json!({ "name": "Karmine Corp", "tag": "KCB" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    add_member(&app, &s.alice.token, team_id, &s.carol.id, "member").await;
    let (_, copy_now) = send(
        &app,
        TestRequest::get(),
        &format!("/tournament-teams/{copy_id}"),
        &s.alice.token,
        None,
    )
    .await;
    assert_eq!(copy_now["name"], "Karmine (tournoi)");
    assert_eq!(copy_now["tag"], "KC");
    let (_, members) = send(
        &app,
        TestRequest::get(),
        &format!("/tournament-teams/{copy_id}/members"),
        &s.alice.token,
        None,
    )
    .await;
    assert_eq!(members.as_array().unwrap().len(), 2);

    // Supprimer l'équipe globale garde la copie, désormais sans origine.
    let (status, _) = send(
        &app,
        TestRequest::delete(),
        &format!("/teams/{team_id}"),
        &s.alice.token,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (status, orphan) = send(
        &app,
        TestRequest::get(),
        &format!("/tournament-teams/{copy_id}"),
        &s.alice.token,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(orphan["team_id"], Value::Null);
    assert_eq!(orphan["name"], "Karmine (tournoi)");
}

#[actix_web::test]
async fn copy_can_pick_members_but_only_active_ones() {
    let (app, s) = setup().await;
    let team = create_team(&app, &s, &s.alice.token, "Karmine").await;
    let team_id = id(&team);
    add_member(&app, &s.alice.token, team_id, &s.bob.id, "member").await;
    let tournament = Uuid::new_v4().to_string();

    // Carol n'a jamais été membre.
    let (status, error) = register(
        &app,
        &s.alice.token,
        &tournament,
        json!({ "team_id": team_id, "member_ids": [s.carol.id] }),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{error}");
    assert!(error["errors"]["member_ids"].is_string());

    // Seul Bob est demandé : le propriétaire est copié quand même.
    let (status, copy) = register(
        &app,
        &s.alice.token,
        &tournament,
        json!({ "team_id": team_id, "member_ids": [s.bob.id] }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{copy}");

    let (status, error) = register(
        &app,
        &s.alice.token,
        &Uuid::new_v4().to_string(),
        json!({ "team_id": Uuid::new_v4() }),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{error}");
    let (status, _) = register(
        &app,
        &s.alice.token,
        &Uuid::new_v4().to_string(),
        json!({ "team_id": team_id, "name": "Autre" }),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[actix_web::test]
async fn a_team_registers_once_and_a_player_joins_one_team_per_tournament() {
    let (app, s) = setup().await;
    let team = create_team(&app, &s, &s.alice.token, "Karmine").await;
    let team_id = id(&team);
    add_member(&app, &s.alice.token, team_id, &s.bob.id, "member").await;
    let tournament = Uuid::new_v4().to_string();

    let (status, _) = register(
        &app,
        &s.alice.token,
        &tournament,
        json!({ "team_id": team_id }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let (status, error) = register(
        &app,
        &s.alice.token,
        &tournament,
        json!({ "team_id": team_id }),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(error["error"], "team_already_registered");

    // Bob est déjà dans l'équipe copiée : il ne peut pas en créer une autre ni rejoindre Carol.
    let (status, error) =
        register(&app, &s.bob.token, &tournament, json!({ "name": "Solo" })).await;
    assert_eq!(status, StatusCode::CONFLICT, "{error}");
    assert_eq!(error["error"], "player_already_registered");
    let (status, solo) =
        register(&app, &s.carol.token, &tournament, json!({ "name": "Solo" })).await;
    assert_eq!(status, StatusCode::CREATED, "{solo}");
    let solo = id(&solo).to_string();
    let (status, error) = send(
        &app,
        TestRequest::post(),
        &format!("/tournament-teams/{solo}/members"),
        &s.carol.token,
        Some(json!({ "user_id": s.bob.id, "role": "member" })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(error["error"], "player_already_registered");
    let (status, _) = register(
        &app,
        &s.alice.token,
        &Uuid::new_v4().to_string(),
        json!({ "name": "Ailleurs" }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
}

#[actix_web::test]
async fn tournament_team_crud_is_owner_only() {
    let (app, s) = setup().await;
    let tournament = Uuid::new_v4().to_string();
    let (status, team) = register(
        &app,
        &s.alice.token,
        &tournament,
        json!({ "name": "Pickup", "tag": "PU" }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{team}");
    assert_eq!(team["team_id"], Value::Null);
    assert_eq!(team["owner_id"], s.alice.id);
    let team_id = id(&team);
    let path = format!("/tournament-teams/{team_id}");

    let (status, _) = register(&app, &s.alice.token, &tournament, json!({})).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, _) = register(
        &app,
        &s.alice.token,
        &tournament,
        json!({ "member_ids": [] }),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    let (status, list) = send(
        &app,
        TestRequest::get(),
        &format!("/tournaments/{tournament}/teams"),
        &s.carol.token,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(list.as_array().unwrap().len(), 1);

    for token in [&s.bob.token, &s.admin] {
        let (status, _) = send(
            &app,
            TestRequest::patch(),
            &path,
            token,
            Some(json!({ "name": "Volée" })),
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN);
        let (status, _) = send(&app, TestRequest::delete(), &path, token, None).await;
        assert_eq!(status, StatusCode::FORBIDDEN);
        let (status, _) = send(
            &app,
            TestRequest::post(),
            &format!("{path}/members"),
            token,
            Some(json!({ "user_id": s.carol.id, "role": "member" })),
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN);
    }

    let members = format!("{path}/members");
    let (status, _) = send(
        &app,
        TestRequest::post(),
        &members,
        &s.alice.token,
        Some(json!({ "user_id": s.bob.id, "role": "member" })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let (status, member) = send(
        &app,
        TestRequest::patch(),
        &format!("{members}/{}", s.bob.id),
        &s.alice.token,
        Some(json!({ "role": "substitute" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{member}");
    assert_eq!(member["role"], "substitute");
    let (status, _) = send(
        &app,
        TestRequest::delete(),
        &format!("{members}/{}", s.alice.id),
        &s.alice.token,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, _) = send(
        &app,
        TestRequest::delete(),
        &format!("{members}/{}", s.bob.id),
        &s.alice.token,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    let (status, _) = send(&app, TestRequest::delete(), &path, &s.alice.token, None).await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (status, _) = send(&app, TestRequest::get(), &path, &s.alice.token, None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = send(&app, TestRequest::get(), &members, &s.alice.token, None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}
