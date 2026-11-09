//! Parcours HTTP des routes des tournois (CRUD, barème, inscriptions, statuts, classements), sur
//! un store en mémoire.

mod common;

use actix_web::http::StatusCode;
use actix_web::test::TestRequest;
use api_public::config::AuthConfig;
use api_public::store::{AuthStore, MemoryStore, Role, StoreError};
use api_public::tournament_io::TournamentChild;
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

struct Account {
    token: String,
    id: String,
}

struct Setup {
    store: Arc<MemoryStore>,
    admin: String,
    alice: Account,
    bob: Account,
    carol: Account,
    game: String,
    kills: String,
    placement: String,
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

async fn post(app: &app_type!(), path: &str, token: &str, body: Value) -> (StatusCode, Value) {
    send(app, TestRequest::post(), path, token, Some(body)).await
}

async fn get(app: &app_type!(), path: &str, token: &str) -> (StatusCode, Value) {
    send(app, TestRequest::get(), path, token, None).await
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
    let (_, game) = post(&app, "/games", &admin, json!({ "name": "TFT" })).await;
    let game = game["id"].as_str().unwrap().to_string();
    let mut stats = Vec::new();
    for (name, key, kind) in [
        ("Kills", "kills", "flat"),
        ("Placement", "placement", "flat"),
    ] {
        let (status, stat) = post(
            &app,
            "/stats",
            &admin,
            json!({ "name": name, "key": key, "type": kind }),
        )
        .await;
        assert_eq!(status, StatusCode::CREATED, "{stat}");
        let stat_id = stat["id"].as_str().unwrap().to_string();
        let (status, _) = send(
            &app,
            TestRequest::put(),
            &format!("/games/{game}/stats/{stat_id}"),
            &admin,
            None,
        )
        .await;
        assert_eq!(status, StatusCode::NO_CONTENT);
        stats.push(stat_id);
    }
    let setup = Setup {
        store,
        admin,
        alice,
        bob,
        carol,
        game,
        placement: stats.pop().unwrap(),
        kills: stats.pop().unwrap(),
    };
    (app, setup)
}

fn tournament_body(s: &Setup) -> Value {
    json!({
        "game_id": s.game,
        "name": "TFT Open",
        "description": "Ouvert à tous",
        "start_date": "2026-11-14T18:00:00Z",
        "end_date": "2026-11-15T18:00:00Z",
        "participant_type": "solo",
        "max_participants": 8,
    })
}

/// Crée un tournoi avec les champs de `tournament_body` complétés par `extra`.
async fn create(app: &app_type!(), s: &Setup, extra: Value) -> Value {
    let mut body = tournament_body(s);
    body["name"] = json!(format!("TFT Open {}", Uuid::new_v4()));
    for (key, value) in extra.as_object().unwrap() {
        body[key] = value.clone();
    }
    let (status, tournament) = post(app, "/tournaments", &s.admin, body).await;
    assert_eq!(status, StatusCode::CREATED, "{tournament}");
    tournament
}

async fn set_status(app: &app_type!(), s: &Setup, tournament: &str, status: &str) -> StatusCode {
    post(
        app,
        &format!("/tournaments/{tournament}/status"),
        &s.admin,
        json!({ "status": status }),
    )
    .await
    .0
}

/// Un tournoi solo ouvert aux inscriptions.
async fn open_tournament(app: &app_type!(), s: &Setup, extra: Value) -> String {
    let tournament = create(app, s, extra).await;
    let id = tournament["id"].as_str().unwrap().to_string();
    assert_eq!(
        set_status(app, s, &id, "registration").await,
        StatusCode::OK
    );
    id
}

fn id(value: &Value) -> &str {
    value["id"].as_str().unwrap()
}

fn error_code(value: &Value) -> &str {
    value["error"].as_str().unwrap_or_default()
}

#[actix_web::test]
async fn every_route_requires_a_token() {
    let (app, _) = setup().await;
    let (a, b) = (Uuid::new_v4(), Uuid::new_v4());
    let requests = [
        (TestRequest::get(), "/tournaments".to_string()),
        (TestRequest::post(), "/tournaments".to_string()),
        (TestRequest::get(), format!("/tournaments/{a}")),
        (TestRequest::patch(), format!("/tournaments/{a}")),
        (TestRequest::delete(), format!("/tournaments/{a}")),
        (TestRequest::post(), format!("/tournaments/{a}/status")),
        (
            TestRequest::get(),
            format!("/tournaments/{a}/scoring-rules"),
        ),
        (
            TestRequest::post(),
            format!("/tournaments/{a}/scoring-rules"),
        ),
        (
            TestRequest::patch(),
            format!("/tournaments/{a}/scoring-rules/{b}"),
        ),
        (
            TestRequest::delete(),
            format!("/tournaments/{a}/scoring-rules/{b}"),
        ),
        (TestRequest::get(), format!("/tournaments/{a}/participants")),
        (
            TestRequest::post(),
            format!("/tournaments/{a}/participants"),
        ),
        (
            TestRequest::patch(),
            format!("/tournaments/{a}/participants/{b}"),
        ),
        (
            TestRequest::delete(),
            format!("/tournaments/{a}/participants/{b}"),
        ),
        (
            TestRequest::post(),
            format!("/tournaments/{a}/participants/{b}/check-in"),
        ),
        (TestRequest::get(), format!("/tournaments/{a}/ranking")),
        (TestRequest::get(), format!("/tournaments/{a}/team-ranking")),
    ];
    for (method, path) in requests {
        let (status, _) = call(&app, method.uri(&path)).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED, "{path}");
    }
}

#[actix_web::test]
async fn admins_create_read_update_and_delete_tournaments() {
    let (app, s) = setup().await;
    let (status, error) = post(&app, "/tournaments", &s.alice.token, tournament_body(&s)).await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{error}");

    let tournament = create(&app, &s, json!({})).await;
    let tid = id(&tournament);
    assert_eq!(tournament["status"], "draft");
    assert_eq!(tournament["team_scoring_mode"], "none");
    assert_eq!(tournament["start_date"], "2026-11-14T18:00:00.000000Z");
    assert_eq!(tournament["team_size"], Value::Null);

    // Tout compte consulte.
    let (status, found) = get(&app, &format!("/tournaments/{tid}"), &s.alice.token).await;
    assert_eq!((status, &found), (StatusCode::OK, &tournament));
    let (_, list) = get(&app, "/tournaments", &s.alice.token).await;
    assert_eq!(list.as_array().unwrap().len(), 1);
    let (_, list) = get(&app, "/tournaments?status=ongoing", &s.alice.token).await;
    assert!(list.as_array().unwrap().is_empty());
    let (_, list) = get(
        &app,
        &format!("/tournaments?game_id={}", Uuid::new_v4()),
        &s.alice.token,
    )
    .await;
    assert!(list.as_array().unwrap().is_empty());
    let (status, _) = get(
        &app,
        &format!("/tournaments/{}", Uuid::new_v4()),
        &s.alice.token,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    // Modification partielle, `null` efface une valeur facultative.
    let path = format!("/tournaments/{tid}");
    let (status, error) = send(
        &app,
        TestRequest::patch(),
        &path,
        &s.alice.token,
        Some(json!({ "name": "x" })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{error}");
    let (status, updated) = send(
        &app,
        TestRequest::patch(),
        &path,
        &s.admin,
        Some(json!({
            "name": "  TFT Cup  ",
            "description": null,
            "registration_open_at": "2026-11-01T00:00:00Z",
            "max_participants": 16,
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{updated}");
    assert_eq!(updated["name"], "TFT Cup");
    assert_eq!(updated["description"], Value::Null);
    assert_eq!(
        updated["registration_open_at"],
        "2026-11-01T00:00:00.000000Z"
    );
    assert_eq!(updated["max_participants"], 16);
    assert_eq!(updated["end_date"], tournament["end_date"]);

    // La cohérence se vérifie sur le tournoi entier.
    for body in [
        json!({ "end_date": "2026-11-13T00:00:00Z" }),
        json!({ "registration_close_at": "2026-10-01T00:00:00Z" }),
        json!({ "team_size": 5 }),
        json!({ "team_scoring_mode": "top_n" }),
        json!({ "name": "" }),
        json!({ "start_date": "demain" }),
        json!({ "max_participants": 0 }),
    ] {
        let (status, error) = send(
            &app,
            TestRequest::patch(),
            &path,
            &s.admin,
            Some(body.clone()),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{body} -> {error}");
    }

    let (status, _) = send(&app, TestRequest::delete(), &path, &s.alice.token, None).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = send(&app, TestRequest::delete(), &path, &s.admin, None).await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (status, _) = get(&app, &path, &s.admin).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[actix_web::test]
async fn creation_is_validated() {
    let (app, s) = setup().await;
    let bad = |extra: Value| {
        let mut body = tournament_body(&s);
        for (key, value) in extra.as_object().unwrap() {
            body[key] = value.clone();
        }
        body
    };
    let cases = [
        (bad(json!({ "game_id": Uuid::new_v4() })), "game_id"),
        (bad(json!({ "name": " " })), "name"),
        (bad(json!({ "start_date": "2026-11-14" })), "start_date"),
        (
            bad(json!({ "end_date": "2026-11-13T00:00:00Z" })),
            "end_date",
        ),
        (
            bad(json!({
                "registration_open_at": "2026-11-02T00:00:00Z",
                "registration_close_at": "2026-11-01T00:00:00Z",
            })),
            "registration_close_at",
        ),
        (bad(json!({ "max_participants": 0 })), "max_participants"),
        (bad(json!({ "participant_type": "team" })), "team_size"),
        (bad(json!({ "team_size": 3 })), "team_size"),
        (
            bad(json!({ "team_scoring_mode": "top_n" })),
            "team_scoring_n",
        ),
        (bad(json!({ "team_scoring_n": 2 })), "team_scoring_n"),
    ];
    for (body, field) in cases {
        let (status, error) = post(&app, "/tournaments", &s.admin, body.clone()).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
        assert!(error["errors"][field].is_string(), "{field}: {error}");
    }
    let (status, _) = post(
        &app,
        "/tournaments",
        &s.admin,
        bad(json!({
            "participant_type": "team",
            "team_size": 3,
            "team_scoring_mode": "top_n",
            "team_scoring_n": 2,
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
}

#[actix_web::test]
async fn the_status_follows_its_transitions() {
    let (app, s) = setup().await;
    let tournament = create(&app, &s, json!({})).await;
    let tid = id(&tournament);
    // draft -> ongoing saute l'inscription.
    assert_eq!(
        set_status(&app, &s, tid, "ongoing").await,
        StatusCode::CONFLICT
    );
    assert_eq!(
        set_status(&app, &s, tid, "finished").await,
        StatusCode::CONFLICT
    );
    let (status, _) = post(
        &app,
        &format!("/tournaments/{tid}/status"),
        &s.alice.token,
        json!({ "status": "registration" }),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(
        set_status(&app, &s, tid, "registration").await,
        StatusCode::OK
    );

    // Il faut deux inscrits actifs pour démarrer.
    let (status, error) = post(
        &app,
        &format!("/tournaments/{tid}/status"),
        &s.admin,
        json!({ "status": "ongoing" }),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{error}");
    assert!(error["errors"]["status"].is_string());
    let participants = format!("/tournaments/{tid}/participants");
    for account in [&s.alice, &s.bob] {
        let (status, _) = post(&app, &participants, &account.token, json!({})).await;
        assert_eq!(status, StatusCode::CREATED);
    }
    assert_eq!(set_status(&app, &s, tid, "ongoing").await, StatusCode::OK);
    assert_eq!(
        set_status(&app, &s, tid, "registration").await,
        StatusCode::CONFLICT
    );

    // En cours : ni suppression, ni changement de capacité.
    let path = format!("/tournaments/{tid}");
    let (status, error) = send(&app, TestRequest::delete(), &path, &s.admin, None).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(error_code(&error), "tournament_locked");
    let (status, _) = send(
        &app,
        TestRequest::patch(),
        &path,
        &s.admin,
        Some(json!({ "max_participants": 64 })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    let (status, renamed) = send(
        &app,
        TestRequest::patch(),
        &path,
        &s.admin,
        Some(json!({ "name": "Renommé" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{renamed}");

    assert_eq!(set_status(&app, &s, tid, "finished").await, StatusCode::OK);
    assert_eq!(
        set_status(&app, &s, tid, "cancelled").await,
        StatusCode::CONFLICT
    );
    let (status, _) = send(&app, TestRequest::delete(), &path, &s.admin, None).await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    // Un tournoi en préparation s'annule.
    let other = create(&app, &s, json!({})).await;
    assert_eq!(
        set_status(&app, &s, id(&other), "cancelled").await,
        StatusCode::OK
    );
}

#[actix_web::test]
async fn the_scoring_rules_follow_the_game_and_lock_when_ongoing() {
    let (app, s) = setup().await;
    let tournament = create(&app, &s, json!({})).await;
    let tid = id(&tournament);
    let rules = format!("/tournaments/{tid}/scoring-rules");

    let (status, _) = post(
        &app,
        &rules,
        &s.alice.token,
        json!({ "stat_id": s.kills, "mode": "linear", "coefficient": 1.5 }),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    let (status, kills) = post(
        &app,
        &rules,
        &s.admin,
        json!({ "stat_id": s.kills, "mode": "linear", "coefficient": 1.5 }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{kills}");
    assert_eq!(kills["coefficient"], 1.5);
    assert_eq!(kills["points_table"], Value::Null);
    let (status, placement) = post(
        &app,
        &rules,
        &s.admin,
        json!({ "stat_id": s.placement, "mode": "table", "points_table": { "1": 8, "2": 7 } }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{placement}");

    // Une règle par statistique.
    let (status, error) = post(
        &app,
        &rules,
        &s.admin,
        json!({ "stat_id": s.kills, "mode": "linear", "coefficient": 2 }),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(error_code(&error), "scoring_rule_taken");

    // Statistique inconnue ou non liée au jeu du tournoi.
    let (_, stray) = post(
        &app,
        "/stats",
        &s.admin,
        json!({ "name": "Soins", "key": "heals", "type": "flat" }),
    )
    .await;
    for stat_id in [id(&stray).to_string(), Uuid::new_v4().to_string()] {
        let (status, error) = post(
            &app,
            &rules,
            &s.admin,
            json!({ "stat_id": stat_id, "mode": "linear", "coefficient": 1 }),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{error}");
        assert!(error["errors"]["stat_id"].is_string());
    }

    // Chaque mode demande ses propres champs.
    for body in [
        json!({ "mode": "linear" }),
        json!({ "mode": "linear", "coefficient": 1, "points_table": {"1": 1} }),
        json!({ "mode": "table", "coefficient": 1 }),
        json!({ "mode": "table", "points_table": {} }),
        json!({ "mode": "table", "points_table": [1, 2] }),
        json!({ "mode": "table", "points_table": {"un": 1} }),
        json!({ "mode": "table", "points_table": {"1": "huit"} }),
    ] {
        let mut body = body;
        body["stat_id"] = json!(s.kills);
        let (status, _) = post(&app, &rules, &s.admin, body.clone()).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    }

    let (_, list) = get(&app, &rules, &s.alice.token).await;
    assert_eq!(list.as_array().unwrap().len(), 2);
    assert_eq!(list[0]["stat_id"], json!(s.kills));

    // Remplacement et suppression, via le bon tournoi uniquement.
    let rule = format!("{rules}/{}", id(&kills));
    let (status, replaced) = send(
        &app,
        TestRequest::patch(),
        &rule,
        &s.admin,
        Some(json!({ "mode": "table", "points_table": { "3": 1 } })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{replaced}");
    assert_eq!(replaced["coefficient"], Value::Null);
    assert_eq!(replaced["stat_id"], json!(s.kills));
    let elsewhere = create(&app, &s, json!({})).await;
    let (status, _) = send(
        &app,
        TestRequest::delete(),
        &format!(
            "/tournaments/{}/scoring-rules/{}",
            id(&elsewhere),
            id(&kills)
        ),
        &s.admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = send(&app, TestRequest::delete(), &rule, &s.admin, None).await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    // Dès `ongoing`, le barème est verrouillé et les statistiques deviennent indélébiles.
    assert_eq!(
        set_status(&app, &s, tid, "registration").await,
        StatusCode::OK
    );
    for account in [&s.alice, &s.bob] {
        post(
            &app,
            &format!("/tournaments/{tid}/participants"),
            &account.token,
            json!({}),
        )
        .await;
    }
    assert_eq!(set_status(&app, &s, tid, "ongoing").await, StatusCode::OK);
    let placement_rule = format!("{rules}/{}", id(&placement));
    let (status, error) = post(
        &app,
        &rules,
        &s.admin,
        json!({ "stat_id": s.kills, "mode": "linear", "coefficient": 1 }),
    )
    .await;
    assert_eq!(
        (status, error_code(&error)),
        (StatusCode::CONFLICT, "tournament_locked")
    );
    let (status, _) = send(
        &app,
        TestRequest::patch(),
        &placement_rule,
        &s.admin,
        Some(json!({ "mode": "linear", "coefficient": 1 })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    let (status, _) = send(&app, TestRequest::delete(), &placement_rule, &s.admin, None).await;
    assert_eq!(status, StatusCode::CONFLICT);

    let (status, error) = send(
        &app,
        TestRequest::delete(),
        &format!("/stats/{}", s.placement),
        &s.admin,
        None,
    )
    .await;
    assert_eq!(
        (status, error_code(&error)),
        (StatusCode::CONFLICT, "stat_in_use")
    );
    let (status, error) = send(
        &app,
        TestRequest::delete(),
        &format!("/games/{}/stats/{}", s.game, s.placement),
        &s.admin,
        None,
    )
    .await;
    assert_eq!(
        (status, error_code(&error)),
        (StatusCode::CONFLICT, "stat_in_use")
    );
    // Une statistique hors barème se délie toujours.
    let (status, _) = send(
        &app,
        TestRequest::delete(),
        &format!("/games/{}/stats/{}", s.game, s.kills),
        &s.admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
}

#[actix_web::test]
async fn solo_players_register_check_in_and_withdraw() {
    let (app, s) = setup().await;
    let draft = create(&app, &s, json!({})).await;
    let (status, error) = post(
        &app,
        &format!("/tournaments/{}/participants", id(&draft)),
        &s.alice.token,
        json!({}),
    )
    .await;
    assert_eq!(
        (status, error_code(&error)),
        (StatusCode::CONFLICT, "registration_closed")
    );

    let tid = open_tournament(&app, &s, json!({ "max_participants": 2 })).await;
    let participants = format!("/tournaments/{tid}/participants");
    let (status, alice) = post(&app, &participants, &s.alice.token, json!({})).await;
    assert_eq!(status, StatusCode::CREATED, "{alice}");
    assert_eq!(alice["status"], "registered");
    assert_eq!(alice["user_id"], json!(s.alice.id));
    assert_eq!(alice["tournament_team_id"], Value::Null);

    let (status, error) = post(&app, &participants, &s.alice.token, json!({})).await;
    assert_eq!(
        (status, error_code(&error)),
        (StatusCode::CONFLICT, "already_registered")
    );
    // Inscrire autrui est réservé aux administrateurs.
    let (status, _) = post(
        &app,
        &participants,
        &s.bob.token,
        json!({ "user_id": s.carol.id }),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, bob) = post(
        &app,
        &participants,
        &s.admin,
        json!({ "user_id": s.bob.id }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{bob}");
    let (status, error) = post(
        &app,
        &participants,
        &s.admin,
        json!({ "user_id": Uuid::new_v4() }),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{error}");
    // Complet.
    let (status, error) = post(&app, &participants, &s.carol.token, json!({})).await;
    assert_eq!(
        (status, error_code(&error)),
        (StatusCode::CONFLICT, "tournament_full")
    );
    // Un tournoi solo n'inscrit pas d'équipe inconnue.
    let (status, _) = post(
        &app,
        &participants,
        &s.carol.token,
        json!({ "tournament_team_id": Uuid::new_v4() }),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    let (_, list) = get(&app, &participants, &s.carol.token).await;
    assert_eq!(list.as_array().unwrap().len(), 2);

    // Pointage : soi-même ou un administrateur, pas autrui, idempotent.
    let check_in = format!("{participants}/{}/check-in", id(&alice));
    let (status, _) = post(&app, &check_in, &s.bob.token, json!({})).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    for _ in 0..2 {
        let (status, checked) = post(&app, &check_in, &s.alice.token, json!({})).await;
        assert_eq!(status, StatusCode::OK, "{checked}");
        assert_eq!(checked["status"], "checked_in");
    }
    let (status, _) = post(
        &app,
        &format!("{participants}/{}/check-in", id(&bob)),
        &s.admin,
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    // Désinscription : soi-même ou un administrateur ; la place se libère.
    let own = format!("{participants}/{}", id(&alice));
    let (status, _) = send(&app, TestRequest::delete(), &own, &s.carol.token, None).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = send(&app, TestRequest::delete(), &own, &s.alice.token, None).await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (status, _) = send(&app, TestRequest::delete(), &own, &s.alice.token, None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = post(&app, &participants, &s.carol.token, json!({})).await;
    assert_eq!(status, StatusCode::CREATED);
    // Participant d'un autre tournoi : introuvable ici.
    let other = open_tournament(&app, &s, json!({})).await;
    let (status, _) = send(
        &app,
        TestRequest::delete(),
        &format!("/tournaments/{other}/participants/{}", id(&bob)),
        &s.admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    // Un retrait ne se fait que par `withdrawn`, qui libère la place sans effacer la ligne.
    let bob_path = format!("{participants}/{}", id(&bob));
    let (status, _) = send(
        &app,
        TestRequest::patch(),
        &bob_path,
        &s.bob.token,
        Some(json!({ "status": "disqualified" })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, withdrawn) = send(
        &app,
        TestRequest::patch(),
        &bob_path,
        &s.bob.token,
        Some(json!({ "status": "withdrawn" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{withdrawn}");
    let (status, error) = post(
        &app,
        &format!("{bob_path}/check-in"),
        &s.bob.token,
        json!({}),
    )
    .await;
    assert_eq!(
        (status, error_code(&error)),
        (StatusCode::CONFLICT, "invalid_status_transition")
    );
    let (status, disqualified) = send(
        &app,
        TestRequest::patch(),
        &bob_path,
        &s.admin,
        Some(json!({ "status": "disqualified" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{disqualified}");
}

#[actix_web::test]
async fn the_registration_window_is_enforced() {
    let (app, s) = setup().await;
    for (open, close) in [
        ("2999-01-01T00:00:00Z", "2999-02-01T00:00:00Z"),
        ("2020-01-01T00:00:00Z", "2020-02-01T00:00:00Z"),
    ] {
        let tid = open_tournament(
            &app,
            &s,
            json!({ "registration_open_at": open, "registration_close_at": close }),
        )
        .await;
        let (status, error) = post(
            &app,
            &format!("/tournaments/{tid}/participants"),
            &s.alice.token,
            json!({}),
        )
        .await;
        assert_eq!(
            (status, error_code(&error)),
            (StatusCode::CONFLICT, "registration_closed"),
            "{open}"
        );
    }
    let tid = open_tournament(
        &app,
        &s,
        json!({ "registration_open_at": "2020-01-01T00:00:00Z", "registration_close_at": "2999-01-01T00:00:00Z" }),
    )
    .await;
    let (status, _) = post(
        &app,
        &format!("/tournaments/{tid}/participants"),
        &s.alice.token,
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
}

/// Crée une équipe de tournoi de zéro et lui ajoute les `members` (rôle `member`).
async fn team_of(
    app: &app_type!(),
    tid: &str,
    owner: &Account,
    name: &str,
    members: &[&Account],
) -> String {
    let (status, team) = post(
        app,
        &format!("/tournaments/{tid}/teams"),
        &owner.token,
        json!({ "name": name }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{team}");
    let team = id(&team).to_string();
    for member in members {
        let (status, added) = post(
            app,
            &format!("/tournament-teams/{team}/members"),
            &owner.token,
            json!({ "user_id": member.id, "role": "member" }),
        )
        .await;
        assert_eq!(status, StatusCode::CREATED, "{added}");
    }
    team
}

#[actix_web::test]
async fn teams_register_with_exactly_team_size_starters() {
    let (app, s) = setup().await;
    let tid = open_tournament(
        &app,
        &s,
        json!({ "participant_type": "team", "team_size": 2, "max_participants": 4 }),
    )
    .await;
    let participants = format!("/tournaments/{tid}/participants");
    let team = team_of(&app, &tid, &s.alice, "Alpha", &[]).await;

    // Un titulaire pour deux attendus ; un remplaçant ne compte pas.
    let (status, error) = post(
        &app,
        &participants,
        &s.alice.token,
        json!({ "tournament_team_id": team }),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{error}");
    let (status, _) = post(
        &app,
        &format!("/tournament-teams/{team}/members"),
        &s.alice.token,
        json!({ "user_id": s.carol.id, "role": "substitute" }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let (status, _) = post(
        &app,
        &participants,
        &s.alice.token,
        json!({ "tournament_team_id": team }),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, _) = post(
        &app,
        &format!("/tournament-teams/{team}/members"),
        &s.alice.token,
        json!({ "user_id": s.bob.id, "role": "member" }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);

    // Ni l'équipe d'autrui, ni un joueur, ni une équipe absente.
    let (status, _) = post(
        &app,
        &participants,
        &s.bob.token,
        json!({ "tournament_team_id": team }),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    for body in [
        json!({}),
        json!({ "user_id": s.alice.id }),
        json!({ "tournament_team_id": Uuid::new_v4() }),
    ] {
        let (status, _) = post(&app, &participants, &s.alice.token, body.clone()).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    }
    let (status, registered) = post(
        &app,
        &participants,
        &s.alice.token,
        json!({ "tournament_team_id": team }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{registered}");
    assert_eq!(registered["user_id"], Value::Null);
    let (status, error) = post(
        &app,
        &participants,
        &s.alice.token,
        json!({ "tournament_team_id": team }),
    )
    .await;
    assert_eq!(
        (status, error_code(&error)),
        (StatusCode::CONFLICT, "already_registered")
    );

    // Une équipe d'un autre tournoi n'est pas inscriptible ici.
    let other = open_tournament(
        &app,
        &s,
        json!({ "participant_type": "team", "team_size": 1 }),
    )
    .await;
    let foreign = team_of(&app, &other, &s.carol, "Ailleurs", &[]).await;
    let (status, _) = post(
        &app,
        &participants,
        &s.carol.token,
        json!({ "tournament_team_id": foreign }),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    // Le propriétaire pointe et retire son équipe ; les autres non.
    let participant = id(&registered);
    let (status, _) = post(
        &app,
        &format!("{participants}/{participant}/check-in"),
        &s.bob.token,
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, checked) = post(
        &app,
        &format!("{participants}/{participant}/check-in"),
        &s.alice.token,
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{checked}");
}

#[actix_web::test]
async fn solo_players_can_score_for_a_tournament_team() {
    let (app, s) = setup().await;
    let tid = open_tournament(
        &app,
        &s,
        json!({ "team_scoring_mode": "top_n", "team_scoring_n": 2 }),
    )
    .await;
    let participants = format!("/tournaments/{tid}/participants");
    let team = team_of(&app, &tid, &s.alice, "Alpha", &[&s.bob]).await;
    let other = team_of(&app, &tid, &s.carol, "Beta", &[]).await;

    // Carol n'est pas dans l'équipe Alpha.
    let (status, _) = post(
        &app,
        &participants,
        &s.carol.token,
        json!({ "tournament_team_id": team }),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let mut ids = Vec::new();
    for (account, team) in [(&s.alice, &team), (&s.bob, &team), (&s.carol, &other)] {
        let (status, participant) = post(
            &app,
            &participants,
            &account.token,
            json!({ "tournament_team_id": team }),
        )
        .await;
        assert_eq!(status, StatusCode::CREATED, "{participant}");
        assert_eq!(participant["user_id"], json!(account.id));
        ids.push(id(&participant).parse::<Uuid>().unwrap());
    }

    // Aucun résultat n'est enregistré : tout le monde est à 0 et à égalité.
    let (status, ranking) = get(&app, &format!("/tournaments/{tid}/ranking"), &s.alice.token).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(ranking.as_array().unwrap().len(), 3);
    assert!(
        ranking
            .as_array()
            .unwrap()
            .iter()
            .all(|r| r["rank"] == 1 && r["points"] == 0.0)
    );

    for (participant, points) in ids.iter().zip([10.0, 4.0, 12.0]) {
        s.store.set_participant_points(*participant, points);
    }
    let (_, ranking) = get(&app, &format!("/tournaments/{tid}/ranking"), &s.alice.token).await;
    let order: Vec<(u64, &str)> = ranking
        .as_array()
        .unwrap()
        .iter()
        .map(|r| (r["rank"].as_u64().unwrap(), r["user_id"].as_str().unwrap()))
        .collect();
    assert_eq!(
        order,
        [
            (1, s.carol.id.as_str()),
            (2, s.alice.id.as_str()),
            (3, s.bob.id.as_str())
        ]
    );

    // `top_n` (n = 2) : Alpha 10 + 4 = 14, Beta 12.
    let (_, teams) = get(
        &app,
        &format!("/tournaments/{tid}/team-ranking"),
        &s.alice.token,
    )
    .await;
    assert_eq!(teams[0]["name"], "Alpha");
    assert_eq!(
        (teams[0]["rank"].clone(), teams[0]["points"].clone()),
        (json!(1), json!(14.0))
    );
    assert_eq!(
        (teams[1]["name"].clone(), teams[1]["points"].clone()),
        (json!("Beta"), json!(12.0))
    );

    // Un joueur retiré sort des deux classements.
    let (status, _) = send(
        &app,
        TestRequest::patch(),
        &format!("{participants}/{}", ids[0]),
        &s.admin,
        Some(json!({ "status": "disqualified" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (_, ranking) = get(&app, &format!("/tournaments/{tid}/ranking"), &s.alice.token).await;
    assert_eq!(ranking.as_array().unwrap().len(), 2);
    let (_, teams) = get(
        &app,
        &format!("/tournaments/{tid}/team-ranking"),
        &s.alice.token,
    )
    .await;
    assert_eq!(teams[0]["name"], "Beta");
    assert_eq!(teams[1]["points"], 4.0);
}

#[actix_web::test]
async fn team_scoring_modes_aggregate_the_players() {
    let (app, s) = setup().await;
    for (mode, expected) in [("sum", 14.0), ("best", 10.0), ("none", 0.0)] {
        let tid = open_tournament(&app, &s, json!({ "team_scoring_mode": mode })).await;
        let participants = format!("/tournaments/{tid}/participants");
        let team = team_of(&app, &tid, &s.alice, "Alpha", &[&s.bob]).await;
        let mut ids = Vec::new();
        for account in [&s.alice, &s.bob] {
            let (_, participant) = post(
                &app,
                &participants,
                &account.token,
                json!({ "tournament_team_id": team }),
            )
            .await;
            ids.push(id(&participant).parse::<Uuid>().unwrap());
        }
        for (participant, points) in ids.iter().zip([10.0, 4.0]) {
            s.store.set_participant_points(*participant, points);
        }
        let (_, teams) = get(
            &app,
            &format!("/tournaments/{tid}/team-ranking"),
            &s.alice.token,
        )
        .await;
        if mode == "none" {
            assert!(teams.as_array().unwrap().is_empty(), "{teams}");
        } else {
            assert_eq!(teams[0]["points"], expected, "{mode}");
        }
    }
}

#[actix_web::test]
async fn team_tournaments_rank_their_teams() {
    let (app, s) = setup().await;
    let tid = open_tournament(
        &app,
        &s,
        json!({ "participant_type": "team", "team_size": 1, "max_participants": 4 }),
    )
    .await;
    let participants = format!("/tournaments/{tid}/participants");
    let mut ids = Vec::new();
    for (account, name) in [(&s.alice, "Alpha"), (&s.bob, "Beta"), (&s.carol, "Gamma")] {
        let team = team_of(&app, &tid, account, name, &[]).await;
        let (status, participant) = post(
            &app,
            &participants,
            &account.token,
            json!({ "tournament_team_id": team }),
        )
        .await;
        assert_eq!(status, StatusCode::CREATED, "{participant}");
        ids.push(id(&participant).parse::<Uuid>().unwrap());
    }
    for (participant, points) in ids.iter().zip([5.0, 9.0, 5.0]) {
        s.store.set_participant_points(*participant, points);
    }
    let (_, teams) = get(
        &app,
        &format!("/tournaments/{tid}/team-ranking"),
        &s.alice.token,
    )
    .await;
    let ranks: Vec<(u64, &str)> = teams
        .as_array()
        .unwrap()
        .iter()
        .map(|t| (t["rank"].as_u64().unwrap(), t["name"].as_str().unwrap()))
        .collect();
    assert_eq!(ranks, [(1, "Beta"), (2, "Alpha"), (2, "Gamma")]);
    // Pas de joueurs individuels dans un tournoi par équipes.
    let (_, players) = get(&app, &format!("/tournaments/{tid}/ranking"), &s.alice.token).await;
    assert!(players.as_array().unwrap().is_empty());
    let (status, _) = get(
        &app,
        &format!("/tournaments/{}/ranking", Uuid::new_v4()),
        &s.alice.token,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    // Au passage en `ongoing`, la composition est revérifiée : Dave rejoint Alpha après coup.
    let dave = account(&app, "dave").await;
    let alpha = teams
        .as_array()
        .unwrap()
        .iter()
        .find(|t| t["name"] == "Alpha")
        .unwrap()["tournament_team_id"]
        .as_str()
        .unwrap();
    let (status, _) = post(
        &app,
        &format!("/tournament-teams/{alpha}/members"),
        &s.alice.token,
        json!({ "user_id": dave.id, "role": "member" }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let (status, error) = post(
        &app,
        &format!("/tournaments/{tid}/status"),
        &s.admin,
        json!({ "status": "ongoing" }),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{error}");
    assert!(
        error["errors"]["status"]
            .as_str()
            .unwrap()
            .contains("titulaires")
    );
}

#[actix_web::test]
async fn teams_cannot_join_a_tournament_of_another_game_or_a_started_one() {
    let (app, s) = setup().await;
    let (_, other_game) = post(&app, "/games", &s.admin, json!({ "name": "Valorant" })).await;
    let (status, team) = post(
        &app,
        "/teams",
        &s.alice.token,
        json!({ "game_id": other_game["id"], "name": "Karmine" }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{team}");
    let tid = open_tournament(&app, &s, json!({})).await;
    let (status, error) = post(
        &app,
        &format!("/tournaments/{tid}/teams"),
        &s.alice.token,
        json!({ "team_id": team["id"] }),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{error}");
    assert!(error["errors"]["team_id"].is_string());

    let (status, _) = get(
        &app,
        &format!("/tournaments/{}/teams", Uuid::new_v4()),
        &s.alice.token,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = post(
        &app,
        &format!("/tournaments/{}/teams", Uuid::new_v4()),
        &s.alice.token,
        json!({ "name": "Fantôme" }),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    for account in [&s.alice, &s.bob] {
        post(
            &app,
            &format!("/tournaments/{tid}/participants"),
            &account.token,
            json!({}),
        )
        .await;
    }
    assert_eq!(set_status(&app, &s, &tid, "ongoing").await, StatusCode::OK);
    let (status, error) = post(
        &app,
        &format!("/tournaments/{tid}/teams"),
        &s.carol.token,
        json!({ "name": "Tardive" }),
    )
    .await;
    assert_eq!(
        (status, error_code(&error)),
        (StatusCode::CONFLICT, "tournament_locked")
    );
}

#[actix_web::test]
async fn deleting_a_user_keeps_the_store_consistent() {
    // Le store en mémoire reste cohérent : un tournoi supprimé emporte barème, inscrits et équipes.
    let (app, s) = setup().await;
    let tid = open_tournament(&app, &s, json!({})).await;
    post(
        &app,
        &format!("/tournaments/{tid}/scoring-rules"),
        &s.admin,
        json!({ "stat_id": s.kills, "mode": "linear", "coefficient": 1 }),
    )
    .await;
    post(
        &app,
        &format!("/tournaments/{tid}/participants"),
        &s.alice.token,
        json!({}),
    )
    .await;
    team_of(&app, &tid, &s.bob, "Alpha", &[]).await;
    let (status, _) = send(
        &app,
        TestRequest::delete(),
        &format!("/tournaments/{tid}"),
        &s.admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let id: Uuid = tid.parse().unwrap();
    assert!(s.store.list_scoring_rules(id).await.unwrap().is_empty());
    assert!(
        s.store
            .list_participants(id, 10, 0)
            .await
            .unwrap()
            .is_empty()
    );
    assert!(
        s.store
            .list_tournament_teams(id, 10, 0)
            .await
            .unwrap()
            .is_empty()
    );
}

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
            &format!("/tournaments/export?format={format}"),
            Some(token),
        )
        .to_request(),
    )
    .await;
    let status = response.status();
    let bytes = actix_web::test::read_body(response).await;
    (status, String::from_utf8(bytes.to_vec()).unwrap())
}

/// Deux tournois riches : un solo avec équipes et barème, un par équipes.
async fn populate(app: &app_type!(), s: &Setup) {
    let solo = open_tournament(
        app,
        s,
        json!({
            "name": "Solo Cup",
            "description": "Avec équipes, \"guillemets\" et\nretour à la ligne",
            "team_scoring_mode": "top_n",
            "team_scoring_n": 2,
            "registration_open_at": "2020-11-01T00:00:00Z",
            "registration_close_at": "2999-01-01T00:00:00Z",
        }),
    )
    .await;
    for body in [
        json!({ "stat_id": s.kills, "mode": "linear", "coefficient": 1.5 }),
        json!({ "stat_id": s.placement, "mode": "table", "points_table": { "1": 8, "2": 7 } }),
    ] {
        let (status, rule) = post(
            app,
            &format!("/tournaments/{solo}/scoring-rules"),
            &s.admin,
            body,
        )
        .await;
        assert_eq!(status, StatusCode::CREATED, "{rule}");
    }
    let team = team_of(app, &solo, &s.alice, "Alpha", &[&s.bob]).await;
    let participants = format!("/tournaments/{solo}/participants");
    for (account, with_team) in [(&s.alice, true), (&s.bob, true), (&s.carol, false)] {
        let body = if with_team {
            json!({ "tournament_team_id": team })
        } else {
            json!({})
        };
        let (status, participant) = post(app, &participants, &account.token, body).await;
        assert_eq!(status, StatusCode::CREATED, "{participant}");
    }
    let (_, list) = get(app, &participants, &s.admin).await;
    let carol = list
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["user_id"] == json!(s.carol.id))
        .unwrap();
    let (status, _) = post(
        app,
        &format!("{participants}/{}/check-in", id(carol)),
        &s.carol.token,
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let teams = open_tournament(
        app,
        s,
        json!({ "name": "Team Cup", "participant_type": "team", "team_size": 1, "max_participants": 4 }),
    )
    .await;
    for (account, name) in [(&s.alice, "Rouge"), (&s.bob, "Bleue")] {
        let team = team_of(app, &teams, account, name, &[]).await;
        let (status, _) = post(
            app,
            &format!("/tournaments/{teams}/participants"),
            &account.token,
            json!({ "tournament_team_id": team }),
        )
        .await;
        assert_eq!(status, StatusCode::CREATED);
    }
    // Un tournoi vide, au statut d'origine.
    let (status, _) = post(
        app,
        "/tournaments",
        &s.admin,
        json!({
            "game_id": s.game, "name": "Brouillon", "start_date": "2027-01-01T00:00:00Z",
            "end_date": "2027-01-02T00:00:00Z", "participant_type": "solo", "max_participants": 2,
        }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
}

async fn delete_all(app: &app_type!(), s: &Setup) {
    let (_, list) = get(app, "/tournaments", &s.admin).await;
    for tournament in list.as_array().unwrap() {
        let (status, _) = send(
            app,
            TestRequest::delete(),
            &format!("/tournaments/{}", id(tournament)),
            &s.admin,
            None,
        )
        .await;
        assert_eq!(status, StatusCode::NO_CONTENT);
    }
}

#[actix_web::test]
async fn export_then_import_reproduces_the_tournaments() {
    for format in ["json", "csv"] {
        let (app, s) = setup().await;
        populate(&app, &s).await;
        let (status, file) = export(&app, &s.admin, format).await;
        assert_eq!(status, StatusCode::OK, "{format}");
        if format == "json" {
            let document: Value = serde_json::from_str(&file).unwrap();
            let tournaments = document["tournaments"].as_array().unwrap();
            assert_eq!(tournaments.len(), 3);
            let solo = tournaments
                .iter()
                .find(|t| t["name"] == "Solo Cup")
                .unwrap();
            assert_eq!(solo["scoring_rules"].as_array().unwrap().len(), 2);
            assert_eq!(solo["scoring_rules"][0]["stat"], "kills");
            assert_eq!(solo["participants"].as_array().unwrap().len(), 3);
            assert_eq!(solo["teams"][0]["name"], "Alpha");
            assert_eq!(solo["teams"][0]["members"].as_array().unwrap().len(), 2);
            let in_team = solo["participants"]
                .as_array()
                .unwrap()
                .iter()
                .filter(|p| p["team"] == 0)
                .count();
            assert_eq!(in_team, 2);
        }

        // Vider la base puis réimporter le fichier redonne exactement le même export.
        delete_all(&app, &s).await;
        let (status, report) = send_raw(
            &app,
            &format!("/tournaments/import?format={format}"),
            &s.admin,
            &file,
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{format}: {report}");
        assert_eq!(report, json!({ "created": 3, "updated": 0 }));
        let (_, again) = export(&app, &s.admin, format).await;
        assert_eq!(again, file, "{format}");

        // Un second import met tout à jour, sans rien créer ni perdre.
        let (status, report) = send_raw(
            &app,
            &format!("/tournaments/import?format={format}"),
            &s.admin,
            &file,
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{format}: {report}");
        assert_eq!(report, json!({ "created": 0, "updated": 3 }));
        let (_, again) = export(&app, &s.admin, format).await;
        assert_eq!(again, file, "{format}");
        let (_, list) = get(&app, "/tournaments", &s.admin).await;
        assert_eq!(list.as_array().unwrap().len(), 3);
    }
}

#[actix_web::test]
async fn importing_an_existing_tournament_replaces_its_content() {
    let (app, s) = setup().await;
    let tid = open_tournament(&app, &s, json!({ "name": "Cup", "max_participants": 4 })).await;
    post(
        &app,
        &format!("/tournaments/{tid}/participants"),
        &s.alice.token,
        json!({}),
    )
    .await;
    post(
        &app,
        &format!("/tournaments/{tid}/scoring-rules"),
        &s.admin,
        json!({ "stat_id": s.kills, "mode": "linear", "coefficient": 1 }),
    )
    .await;

    let file = json!({ "version": 1, "tournaments": [{
        "game": "tft", "name": "CUP", "description": "Mis à jour",
        "start_date": "2026-12-01T10:00:00Z", "end_date": "2026-12-02T10:00:00Z",
        "participant_type": "solo", "max_participants": 3, "status": "registration",
        "scoring_rules": [{ "stat": "placement", "mode": "table", "points_table": { "1": 5 } }],
        "participants": [
            { "user": "BOB", "status": "checked_in", "registered_at": "2026-11-02T08:00:00Z" },
            { "user": "carol", "registered_at": "2026-11-03T08:00:00Z" },
        ],
        "teams": [{ "name": "Gamma", "owner": "bob", "members": [{ "username": "bob", "role": "owner" }] }],
    }] });
    let (status, report) = send_raw(&app, "/tournaments/import", &s.admin, &file.to_string()).await;
    assert_eq!(status, StatusCode::OK, "{report}");
    assert_eq!(report, json!({ "created": 0, "updated": 1 }));

    let (_, tournament) = get(&app, &format!("/tournaments/{tid}"), &s.admin).await;
    assert_eq!(tournament["name"], "CUP");
    assert_eq!(tournament["description"], "Mis à jour");
    assert_eq!(tournament["max_participants"], 3);
    let (_, rules) = get(&app, &format!("/tournaments/{tid}/scoring-rules"), &s.admin).await;
    assert_eq!(rules.as_array().unwrap().len(), 1);
    assert_eq!(rules[0]["stat_id"], json!(s.placement));
    let (_, participants) = get(&app, &format!("/tournaments/{tid}/participants"), &s.admin).await;
    let users: Vec<&str> = participants
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p["user_id"].as_str().unwrap())
        .collect();
    assert_eq!(users, [s.bob.id.as_str(), s.carol.id.as_str()]);
    assert_eq!(participants[0]["status"], "checked_in");
    assert_eq!(
        participants[0]["registered_at"],
        "2026-11-02T08:00:00.000000Z"
    );
    assert_eq!(participants[1]["status"], "registered");
    assert_eq!(
        participants[1]["registered_at"],
        "2026-11-03T08:00:00.000000Z"
    );
    let (_, teams) = get(&app, &format!("/tournaments/{tid}/teams"), &s.admin).await;
    assert_eq!(teams.as_array().unwrap().len(), 1);
    assert_eq!(teams[0]["name"], "Gamma");
}

#[actix_web::test]
async fn invalid_files_are_refused_without_any_write() {
    let (app, s) = setup().await;
    let running = open_tournament(&app, &s, json!({ "name": "En cours" })).await;
    for account in [&s.alice, &s.bob] {
        post(
            &app,
            &format!("/tournaments/{running}/participants"),
            &account.token,
            json!({}),
        )
        .await;
    }
    assert_eq!(
        set_status(&app, &s, &running, "ongoing").await,
        StatusCode::OK
    );

    let valid = |extra: Value| {
        let mut tournament = json!({
            "game": "TFT", "name": "Nouveau", "start_date": "2026-12-01T10:00:00Z",
            "end_date": "2026-12-02T10:00:00Z", "participant_type": "solo", "max_participants": 4,
        });
        for (key, value) in extra.as_object().unwrap() {
            tournament[key] = value.clone();
        }
        tournament
    };
    let cases = [
        ("jeu inconnu", valid(json!({ "game": "Inconnu" })), "game"),
        (
            "dates",
            valid(json!({ "end_date": "2026-11-01T00:00:00Z" })),
            "end_date",
        ),
        (
            "team_size",
            valid(json!({ "participant_type": "team" })),
            "team_size",
        ),
        (
            "statistique inconnue",
            valid(
                json!({ "scoring_rules": [{ "stat": "nope", "mode": "linear", "coefficient": 1 }] }),
            ),
            "statistique inconnue",
        ),
        (
            "règle incomplète",
            valid(json!({ "scoring_rules": [{ "stat": "kills", "mode": "linear" }] })),
            "coefficient",
        ),
        (
            "règle en double",
            valid(json!({ "scoring_rules": [
            { "stat": "kills", "mode": "linear", "coefficient": 1 },
            { "stat": "kills", "mode": "linear", "coefficient": 2 }] })),
            "plusieurs fois",
        ),
        (
            "compte inconnu",
            valid(json!({ "participants": [{ "user": "fantôme" }] })),
            "compte inconnu",
        ),
        (
            "solo sans joueur",
            valid(json!({ "participants": [{}] })),
            "tournoi solo",
        ),
        (
            "joueur en double",
            valid(json!({ "participants": [{ "user": "alice" }, { "user": "ALICE" }] })),
            "plusieurs fois",
        ),
        (
            "trop d'inscrits",
            valid(
                json!({ "max_participants": 1, "participants": [{ "user": "alice" }, { "user": "bob" }] }),
            ),
            "places",
        ),
        (
            "équipe absente",
            valid(json!({ "participants": [{ "user": "alice", "team": 0 }] })),
            "n'existe pas",
        ),
        (
            "date d'inscription",
            valid(json!({ "participants": [{ "user": "alice", "registered_at": "hier" }] })),
            "registered_at",
        ),
        (
            "équipe invalide",
            valid(json!({ "teams": [{ "name": "X", "owner": "alice", "members": [] }] })),
            "propriétaire",
        ),
        (
            "étape invalide",
            valid(json!({ "steps": [{ "format": "pool" }] })),
            "étape 1 invalide",
        ),
        (
            "matchs hors de leur étape",
            valid(json!({ "matches": [{}] })),
            "matchs",
        ),
        ("en cours", valid(json!({ "name": "en cours" })), "en cours"),
        (
            "doublon",
            json!([valid(json!({})), valid(json!({ "name": "NOUVEAU" }))]),
            "plusieurs fois",
        ),
    ];
    for (label, tournaments, needle) in cases {
        let tournaments = if tournaments.is_array() {
            tournaments
        } else {
            json!([tournaments])
        };
        let file = json!({ "version": 1, "tournaments": tournaments }).to_string();
        let (status, body) = send_raw(&app, "/tournaments/import", &s.admin, &file).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{label}: {body}");
        assert!(
            body["errors"]["file"].as_str().unwrap().contains(needle),
            "{label}: {body}"
        );
    }
    for file in [
        "pas du json".to_string(),
        json!({ "version": 2, "tournaments": [] }).to_string(),
        json!({ "version": 1, "tournaments": [], "extra": 1 }).to_string(),
        json!({ "version": 1, "tournaments": [valid(json!({ "inconnu": 1 }))] }).to_string(),
    ] {
        let (status, body) = send_raw(&app, "/tournaments/import", &s.admin, &file).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{file}: {body}");
    }
    let (status, _) = send_raw(&app, "/tournaments/import?format=csv", &s.admin, "a,b\n1,2").await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    // Un seul tournoi invalide fait refuser tout le fichier.
    let mixed = json!({ "version": 1, "tournaments": [valid(json!({})), valid(json!({ "name": "Autre", "game": "?" }))] });
    let (status, _) = send_raw(&app, "/tournaments/import", &s.admin, &mixed.to_string()).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    let (_, list) = get(&app, "/tournaments", &s.admin).await;
    assert_eq!(list.as_array().unwrap().len(), 1);
}

#[actix_web::test]
async fn import_and_export_are_reserved_to_administrators() {
    let (app, s) = setup().await;
    let (status, _) = export(&app, &s.alice.token, "json").await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = send_raw(
        &app,
        "/tournaments/import",
        &s.alice.token,
        r#"{ "version": 1, "tournaments": [] }"#,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = call(
        &app,
        request(TestRequest::get(), "/tournaments/export", None),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    let (status, _) = call(
        &app,
        request(TestRequest::post(), "/tournaments/import", None),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[actix_web::test]
async fn tournament_names_are_unique_per_game() {
    let (app, s) = setup().await;
    let first = create(&app, &s, json!({ "name": "Open" })).await;
    let (status, error) = post(&app, "/tournaments", &s.admin, {
        let mut body = tournament_body(&s);
        body["name"] = json!("OPEN");
        body
    })
    .await;
    assert_eq!(
        (status, error_code(&error)),
        (StatusCode::CONFLICT, "tournament_name_taken")
    );
    let other = create(&app, &s, json!({})).await;
    let (status, error) = send(
        &app,
        TestRequest::patch(),
        &format!("/tournaments/{}", id(&other)),
        &s.admin,
        Some(json!({ "name": "open" })),
    )
    .await;
    assert_eq!(
        (status, error_code(&error)),
        (StatusCode::CONFLICT, "tournament_name_taken")
    );
    // Renommer un tournoi avec son propre nom (autre casse) reste permis.
    let (status, _) = send(
        &app,
        TestRequest::patch(),
        &format!("/tournaments/{}", id(&first)),
        &s.admin,
        Some(json!({ "name": "OPEN" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
}

/// Sous-niveau de test : des valeurs opaques, conservées telles quelles.
#[derive(Default)]
struct FakeChild {
    by_tournament: Mutex<HashMap<Uuid, Vec<Value>>>,
}

#[async_trait]
impl TournamentChild for FakeChild {
    async fn export(&self, tournament_id: Uuid) -> Result<Vec<(Uuid, Value)>, StoreError> {
        Ok(self
            .by_tournament
            .lock()
            .unwrap()
            .get(&tournament_id)
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .map(|value| (Uuid::new_v4(), value))
            .collect())
    }

    async fn validate(&self, _: Uuid, items: &[Value]) -> Result<Option<String>, StoreError> {
        Ok(items
            .iter()
            .any(|item| !item.is_object())
            .then(|| "chaque élément doit être un objet".to_string()))
    }

    async fn import(
        &self,
        tournament_id: Uuid,
        items: Vec<Value>,
    ) -> Result<Vec<Uuid>, StoreError> {
        let ids = items.iter().map(|_| Uuid::new_v4()).collect();
        self.by_tournament
            .lock()
            .unwrap()
            .insert(tournament_id, items);
        Ok(ids)
    }
}

#[actix_web::test]
async fn steps_and_matches_are_delegated_to_their_levels() {
    let store = Arc::new(MemoryStore::new());
    let config = AuthConfig {
        jwt_secret: common::SECRET.into(),
        access_token_ttl: Duration::from_secs(900),
        refresh_token_ttl: Duration::from_secs(3600),
    };
    let (steps, matches) = (
        Arc::new(FakeChild::default()),
        Arc::new(FakeChild::default()),
    );
    let state = AppState::new(store.clone(), config)
        .unwrap()
        .with_steps(steps.clone())
        .with_matches(matches.clone());
    let app = actix_web::test::init_service(app(state)).await;
    logged_in_as(&app, "root", "secret123").await;
    store.set_role("root", Role::Admin);
    let (_, session) = login(&app, "root", "secret123").await;
    let admin = access(&session).to_string();
    let (_, game) = post(&app, "/games", &admin, json!({ "name": "TFT" })).await;
    assert!(game["id"].is_string());

    let tournament = |extra: Value| {
        let mut base = json!({
            "game": "TFT", "name": "Cup", "start_date": "2026-12-01T10:00:00Z",
            "end_date": "2026-12-02T10:00:00Z", "participant_type": "solo", "max_participants": 4,
        });
        for (key, value) in extra.as_object().unwrap() {
            base[key] = value.clone();
        }
        json!({ "version": 1, "tournaments": [base] }).to_string()
    };
    let file = tournament(json!({
        "steps": [{ "format": "pool", "anything": [1, 2] }, { "whatever": true }],
        "matches": [{ "round": 1 }],
    }));
    let (status, body) = send_raw(&app, "/tournaments/import", &admin, &file).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        steps
            .by_tournament
            .lock()
            .unwrap()
            .values()
            .next()
            .unwrap()
            .len(),
        2
    );
    assert_eq!(
        matches
            .by_tournament
            .lock()
            .unwrap()
            .values()
            .next()
            .unwrap()
            .len(),
        1
    );

    // L'export embarque les valeurs telles que les sous-niveaux les fournissent.
    let (_, exported) = export(&app, &admin, "json").await;
    let exported: Value = serde_json::from_str(&exported).unwrap();
    assert_eq!(
        exported["tournaments"][0]["steps"],
        json!([{ "format": "pool", "anything": [1, 2] }, { "whatever": true }])
    );
    assert_eq!(
        exported["tournaments"][0]["matches"],
        json!([{ "round": 1 }])
    );
    let (_, csv) = export(&app, &admin, "csv").await;
    let (status, _) = send_raw(&app, "/tournaments/import?format=csv", &admin, &csv).await;
    assert_eq!(status, StatusCode::OK);

    // Leur validation décide : un fichier refusé n'écrit rien.
    let bad = tournament(json!({ "name": "Autre", "steps": [42] }));
    let (status, body) = send_raw(&app, "/tournaments/import", &admin, &bad).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(body["errors"]["file"].as_str().unwrap().contains("objet"));
    let (_, list) = get(&app, "/tournaments", &admin).await;
    assert_eq!(list.as_array().unwrap().len(), 1);
}

#[actix_web::test]
async fn tournament_files_in_json_and_csv_give_the_same_tournaments() {
    let (app, s) = setup().await;
    populate(&app, &s).await;
    let as_json = export(&app, &s.admin, "json").await.1;
    let as_csv = export(&app, &s.admin, "csv").await.1;
    let header = as_csv.lines().next().unwrap().to_string();
    assert_eq!(header.split(',').count(), 18, "{header}");
    assert!(as_csv.lines().count() > 3, "{as_csv}");

    // Chaque fichier, importé après avoir tout supprimé, redonne les deux exports d'origine.
    for (format, file) in [("json", &as_json), ("csv", &as_csv)] {
        delete_all(&app, &s).await;
        let (status, report) = send_raw(
            &app,
            &format!("/tournaments/import?format={format}"),
            &s.admin,
            file,
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{format}: {report}");
        assert_eq!(report, json!({ "created": 3, "updated": 0 }), "{format}");
        assert_eq!(export(&app, &s.admin, "json").await.1, as_json, "{format}");
        assert_eq!(export(&app, &s.admin, "csv").await.1, as_csv, "{format}");
    }
}

#[actix_web::test]
async fn invalid_tournament_files_are_refused_in_both_formats() {
    let (app, s) = setup().await;
    populate(&app, &s).await;
    let as_json = export(&app, &s.admin, "json").await.1;
    let as_csv = export(&app, &s.admin, "csv").await.1;
    let header = as_csv.lines().next().unwrap().to_string();

    let bad = [
        ("json", "pas du json".to_string()),
        ("json", r#"{ "version": 9, "tournaments": [] }"#.to_string()),
        ("json", as_csv.clone()),
        ("csv", as_json.clone()),
        ("csv", String::new()),
        ("csv", "game,name\nValorant,x\n".to_string()),
        ("csv", format!("{header}\nValorant\n")),
        ("xml", "<tournaments/>".to_string()),
    ];
    for (format, file) in bad {
        let (status, error) = send_raw(
            &app,
            &format!("/tournaments/import?format={format}"),
            &s.admin,
            &file,
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{format}: {file}");
        assert!(error.is_object(), "{error}");
    }
    assert_eq!(export(&app, &s.admin, "json").await.1, as_json);
}
