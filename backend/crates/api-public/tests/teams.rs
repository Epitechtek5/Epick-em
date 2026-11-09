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
    tournament: String,
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

/// Crée un tournoi solo pour `game` et renvoie son identifiant.
async fn create_tournament(app: &app_type!(), admin: &str, game: &str) -> String {
    let (status, tournament) = send(
        app,
        TestRequest::post(),
        "/tournaments",
        admin,
        Some(json!({
            "game_id": game,
            "name": format!("Open {}", Uuid::new_v4()),
            "start_date": "2026-11-14T18:00:00Z",
            "end_date": "2026-11-15T18:00:00Z",
            "participant_type": "solo",
            "max_participants": 8,
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{tournament}");
    tournament["id"].as_str().unwrap().to_string()
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
    let tournament = create_tournament(&app, &admin, &game).await;
    let setup = Setup {
        admin,
        alice,
        bob,
        carol,
        game,
        tournament,
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
        (TestRequest::get(), "/teams/export".to_string()),
        (TestRequest::post(), "/teams/import".to_string()),
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

/// Un second tournoi du même jeu.
async fn other_tournament(app: &app_type!(), s: &Setup) -> String {
    create_tournament(app, &s.admin, &s.game).await
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

    let tournament = s.tournament.clone();
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
    let tournament = s.tournament.clone();

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
        &s.tournament,
        json!({ "team_id": Uuid::new_v4() }),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{error}");
    let (status, _) = register(
        &app,
        &s.alice.token,
        &other_tournament(&app, &s).await,
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
    let tournament = s.tournament.clone();

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
        &other_tournament(&app, &s).await,
        json!({ "name": "Ailleurs" }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
}

#[actix_web::test]
async fn tournament_team_crud_is_owner_only() {
    let (app, s) = setup().await;
    let tournament = s.tournament.clone();
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

/// Deux équipes, dont une avec un ancien membre.
async fn seed(app: &app_type!(), s: &Setup) {
    let team = create_team(app, s, &s.alice.token, "Karmine, \"KC\"").await;
    add_member(app, &s.alice.token, id(&team), &s.bob.id, "member").await;
    add_member(app, &s.alice.token, id(&team), &s.carol.id, "substitute").await;
    let (status, _) = send(
        app,
        TestRequest::delete(),
        &format!("/teams/{}/members/{}", id(&team), s.carol.id),
        &s.alice.token,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (status, _) = send(
        app,
        TestRequest::post(),
        "/teams",
        &s.bob.token,
        Some(json!({ "game_id": s.game, "name": "Sans tag" })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
}

async fn delete_all_teams(app: &app_type!(), token: &str) {
    let (_, teams) = send(app, TestRequest::get(), "/teams", token, None).await;
    for team in teams.as_array().unwrap() {
        let owner = if team["name"] == "Sans tag" {
            "bob"
        } else {
            "alice"
        };
        // Le propriétaire seul supprime : on se reconnecte à son nom.
        let (_, session) = login(app, owner, "secret123").await;
        let (status, _) = send(
            app,
            TestRequest::delete(),
            &format!("/teams/{}", id(team)),
            access(&session),
            None,
        )
        .await;
        assert_eq!(status, StatusCode::NO_CONTENT);
    }
}

#[actix_web::test]
async fn team_import_and_export_are_reserved_to_administrators() {
    let (app, s) = setup().await;
    for token in [&s.alice.token] {
        let (status, error) = send(&app, TestRequest::get(), "/teams/export", token, None).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{error}");
        let (status, _) = send_raw(&app, "/teams/import", token, "{}").await;
        assert_eq!(status, StatusCode::FORBIDDEN);
    }
    let (status, _) = export(&app, "/teams/export?format=xml", &s.admin).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[actix_web::test]
async fn exported_teams_are_imported_without_loss() {
    let (app, s) = setup().await;
    seed(&app, &s).await;
    for format in ["json", "csv"] {
        let path = format!("/teams/export?format={format}");
        let (status, file) = export(&app, &path, &s.admin).await;
        assert_eq!(status, StatusCode::OK);
        assert!(file.contains("Karmine"), "{file}");
        assert!(file.contains("carol"), "{file}");

        delete_all_teams(&app, &s.admin).await;
        let (_, empty) = send(&app, TestRequest::get(), "/teams", &s.admin, None).await;
        assert!(empty.as_array().unwrap().is_empty());

        let import = format!("/teams/import?format={format}");
        let (status, report) = send_raw(&app, &import, &s.admin, &file).await;
        assert_eq!(status, StatusCode::OK, "{report}");
        assert_eq!(report, json!({ "created": 2, "updated": 0 }));
        let (_, again) = export(&app, &path, &s.admin).await;
        assert_eq!(again, file, "{format}");

        // Réimporter met à jour sans rien créer ni perdre.
        let (_, report) = send_raw(&app, &import, &s.admin, &file).await;
        assert_eq!(report, json!({ "created": 0, "updated": 2 }));
        let (_, still) = export(&app, &path, &s.admin).await;
        assert_eq!(still, file, "{format}");
    }

    // L'équipe importée est pleinement utilisable : le propriétaire importé la gère.
    let (_, teams) = send(&app, TestRequest::get(), "/teams", &s.admin, None).await;
    let karmine = teams
        .as_array()
        .unwrap()
        .iter()
        .find(|t| t["name"] == "Karmine, \"KC\"")
        .unwrap();
    assert_eq!(karmine["owner_id"], s.alice.id);
    let (status, members) = send(
        &app,
        TestRequest::get(),
        &format!("/teams/{}/members", id(karmine)),
        &s.alice.token,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(members.as_array().unwrap().len(), 3);
}

#[actix_web::test]
async fn import_updates_a_team_and_replaces_its_members() {
    let (app, s) = setup().await;
    let team = create_team(&app, &s, &s.alice.token, "Karmine").await;
    add_member(&app, &s.alice.token, id(&team), &s.bob.id, "member").await;

    let file = json!({
        "version": 1,
        "teams": [
            {
                "game": "VALORANT",
                "name": "KARMINE",
                "tag": "KCB",
                "owner": "Carol",
                "members": [
                    { "username": "carol", "role": "owner", "joined_at": "2026-01-01T00:00:00Z" },
                    { "username": "alice", "role": "member", "joined_at": "2026-01-01T00:00:00Z", "left_at": "2026-02-01T00:00:00Z" }
                ]
            },
            {
                "game": "Valorant",
                "name": "Nouvelle",
                "owner": "bob",
                "members": [{ "username": "bob", "role": "owner" }]
            }
        ]
    });
    let (status, report) = send_raw(&app, "/teams/import", &s.admin, &file.to_string()).await;
    assert_eq!(status, StatusCode::OK, "{report}");
    assert_eq!(report, json!({ "created": 1, "updated": 1 }));

    let (_, updated) = send(
        &app,
        TestRequest::get(),
        &format!("/teams/{}", id(&team)),
        &s.bob.token,
        None,
    )
    .await;
    assert_eq!(updated["name"], "KARMINE");
    assert_eq!(updated["tag"], "KCB");
    assert_eq!(updated["owner_id"], s.carol.id);
    assert_eq!(updated["picture_url"], Value::Null);
    let (_, members) = send(
        &app,
        TestRequest::get(),
        &format!("/teams/{}/members", id(&team)),
        &s.bob.token,
        None,
    )
    .await;
    let users: Vec<&str> = members
        .as_array()
        .unwrap()
        .iter()
        .map(|m| m["user_id"].as_str().unwrap())
        .collect();
    assert_eq!(users.len(), 2);
    assert!(!users.contains(&s.bob.id.as_str()));

    // Alice n'est plus propriétaire, Carol l'est.
    let (status, _) = send(
        &app,
        TestRequest::patch(),
        &format!("/teams/{}", id(&team)),
        &s.alice.token,
        Some(json!({ "name": "Vol" })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = send(
        &app,
        TestRequest::patch(),
        &format!("/teams/{}", id(&team)),
        &s.carol.token,
        Some(json!({ "name": "Karmine" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
}

#[actix_web::test]
async fn an_invalid_import_changes_nothing() {
    let (app, s) = setup().await;
    create_team(&app, &s, &s.alice.token, "Karmine").await;
    let (_, before) = export(&app, "/teams/export", &s.admin).await;

    let bad = [
        // Une équipe valide suivie d'une équipe au jeu et au propriétaire inconnus.
        json!({ "version": 1, "teams": [
            { "game": "Valorant", "name": "Valide", "owner": "bob", "members": [{ "username": "bob", "role": "owner" }] },
            { "game": "Inconnu", "name": "Invalide", "owner": "fantome", "members": [] }
        ] }),
        json!({ "version": 1, "teams": [
            { "game": "Valorant", "name": "Sans owner", "owner": "bob", "members": [{ "username": "bob", "role": "member" }] }
        ] }),
        json!({ "version": 1, "teams": [
            { "game": "Valorant", "name": "Date", "owner": "bob", "members": [{ "username": "bob", "role": "owner", "joined_at": "hier" }] }
        ] }),
        json!({ "version": 2, "teams": [] }),
    ];
    for file in bad {
        let (status, error) = send_raw(&app, "/teams/import", &s.admin, &file.to_string()).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{file}");
        assert!(error["errors"]["file"].is_string(), "{error}");
    }
    let (status, _) = send_raw(
        &app,
        "/teams/import?format=csv",
        &s.admin,
        "game,name\nValorant,x\n",
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    let (_, after) = export(&app, "/teams/export", &s.admin).await;
    assert_eq!(after, before);
}

#[actix_web::test]
async fn team_files_in_json_and_csv_give_the_same_teams() {
    let (app, s) = setup().await;
    seed(&app, &s).await;
    let (_, as_json) = export(&app, "/teams/export?format=json", &s.admin).await;
    let (_, as_csv) = export(&app, "/teams/export?format=csv", &s.admin).await;
    let parsed: Value = serde_json::from_str(&as_json).unwrap();
    assert_eq!(parsed["version"], 1);
    assert_eq!(parsed["teams"].as_array().unwrap().len(), 2);
    assert!(as_csv.lines().count() >= 3, "{as_csv}");

    // Chaque fichier, importé après avoir vidé les équipes, redonne l'autre format à l'identique.
    for (format, file) in [("json", &as_json), ("csv", &as_csv)] {
        delete_all_teams(&app, &s.admin).await;
        let (status, report) = send_raw(
            &app,
            &format!("/teams/import?format={format}"),
            &s.admin,
            file,
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{format}: {report}");
        assert_eq!(report, json!({ "created": 2, "updated": 0 }), "{format}");
        let (_, json_again) = export(&app, "/teams/export?format=json", &s.admin).await;
        let (_, csv_again) = export(&app, "/teams/export?format=csv", &s.admin).await;
        assert_eq!(json_again, as_json, "{format}");
        assert_eq!(csv_again, as_csv, "{format}");
    }
}

#[actix_web::test]
async fn invalid_team_files_are_refused_in_both_formats() {
    let (app, s) = setup().await;
    seed(&app, &s).await;
    let (_, before) = export(&app, "/teams/export?format=json", &s.admin).await;
    let (_, as_json) = export(&app, "/teams/export?format=json", &s.admin).await;
    let (_, as_csv) = export(&app, "/teams/export?format=csv", &s.admin).await;
    let header = as_csv.lines().next().unwrap().to_string();

    let bad = [
        ("json", "pas du json".to_string()),
        ("json", as_csv.clone()),
        ("csv", as_json.clone()),
        ("csv", String::new()),
        ("csv", "game,name\nValorant,x\n".to_string()),
        // Une ligne qui n'a pas le bon nombre de colonnes.
        ("csv", format!("{header}\nValorant\n")),
    ];
    for (format, file) in bad {
        let (status, error) = send_raw(
            &app,
            &format!("/teams/import?format={format}"),
            &s.admin,
            &file,
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{format}: {file}");
        assert!(error["errors"]["file"].is_string(), "{error}");
    }
    let (_, after) = export(&app, "/teams/export?format=json", &s.admin).await;
    assert_eq!(after, before);
}
