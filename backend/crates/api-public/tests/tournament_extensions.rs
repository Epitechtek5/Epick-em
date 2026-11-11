//! Extension des tournois (#146) : configuration, inscriptions avec approbation et liste
//! d'attente, pointage, accès public, rôles propres au tournoi, doublons et modèles. Parcours
//! HTTP sur un store en mémoire.

mod common;

use actix_web::http::StatusCode;
use actix_web::test::TestRequest;
use api_public::config::AuthConfig;
use api_public::events::{EventKind, MemoryEvents};
use api_public::store::{
    AuthStore, MemoryStore, ParticipantInput, ParticipantStatus, Role, TournamentInput,
    TournamentSettings, no_responses,
};
use api_public::{AppState, app};
use common::{SECRET, access, call, logged_in_as, login, request};
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
    events: Arc<MemoryEvents>,
    admin: Account,
    alice: Account,
    bob: Account,
    carol: Account,
    dave: Account,
    game: String,
}

async fn account(app: &app_type!(), name: &str) -> Account {
    let session = logged_in_as(app, name, "secret123").await;
    let claims = api_public::auth::decode_access_token(access(&session), SECRET).unwrap();
    Account {
        token: access(&session).to_string(),
        id: claims.sub.to_string(),
    }
}

async fn send(
    app: &app_type!(),
    method: TestRequest,
    path: &str,
    token: Option<&str>,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let req = request(method, path, token);
    call(
        app,
        match body {
            Some(body) => req.set_json(body),
            None => req,
        },
    )
    .await
}

async fn post(app: &app_type!(), path: &str, who: &Account, body: Value) -> (StatusCode, Value) {
    send(app, TestRequest::post(), path, Some(&who.token), Some(body)).await
}

async fn put(app: &app_type!(), path: &str, who: &Account, body: Value) -> (StatusCode, Value) {
    send(app, TestRequest::put(), path, Some(&who.token), Some(body)).await
}

async fn patch(app: &app_type!(), path: &str, who: &Account, body: Value) -> (StatusCode, Value) {
    send(
        app,
        TestRequest::patch(),
        path,
        Some(&who.token),
        Some(body),
    )
    .await
}

async fn get(app: &app_type!(), path: &str, who: &Account) -> (StatusCode, Value) {
    send(app, TestRequest::get(), path, Some(&who.token), None).await
}

async fn delete(app: &app_type!(), path: &str, who: &Account) -> (StatusCode, Value) {
    send(app, TestRequest::delete(), path, Some(&who.token), None).await
}

/// Lecture sans jeton.
async fn anonymous(app: &app_type!(), path: &str) -> (StatusCode, Value) {
    send(app, TestRequest::get(), path, None, None).await
}

async fn setup() -> (app_type!(), Setup) {
    let store = Arc::new(MemoryStore::new());
    let events = Arc::new(MemoryEvents::new());
    let config = AuthConfig {
        jwt_secret: SECRET.into(),
        access_token_ttl: Duration::from_secs(900),
        refresh_token_ttl: Duration::from_secs(3600),
    };
    let state = common::with_test_mailer(
        AppState::new(store.clone(), config)
            .unwrap()
            .with_events(events.clone()),
    );
    let app = actix_web::test::init_service(app(state)).await;
    logged_in_as(&app, "root", "secret123").await;
    store.set_role("root", Role::Admin);
    let (_, session) = login(&app, "root", "secret123").await;
    let claims = api_public::auth::decode_access_token(access(&session), SECRET).unwrap();
    let admin = Account {
        token: access(&session).to_string(),
        id: claims.sub.to_string(),
    };
    let alice = account(&app, "alice").await;
    let bob = account(&app, "bob").await;
    let carol = account(&app, "carol").await;
    let dave = account(&app, "dave").await;
    let (_, game) = post(&app, "/games", &admin, json!({ "name": "TFT" })).await;
    let game = game["id"].as_str().unwrap().to_string();
    (
        app,
        Setup {
            events,
            admin,
            alice,
            bob,
            carol,
            dave,
            game,
        },
    )
}

fn body(s: &Setup, extra: Value) -> Value {
    let mut base = json!({
        "game_id": s.game,
        "name": "TFT Open",
        "start_date": "2026-11-14T18:00:00Z",
        "end_date": "2026-11-15T18:00:00Z",
        "participant_type": "solo",
        "max_participants": 4,
    });
    for (key, value) in extra.as_object().unwrap() {
        base[key] = value.clone();
    }
    base
}

/// Crée un tournoi (par l'administrateur global) et l'ouvre aux inscriptions.
async fn open(app: &app_type!(), s: &Setup, extra: Value) -> String {
    let (status, created) = post(app, "/tournaments", &s.admin, body(s, extra)).await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    let id = created["id"].as_str().unwrap().to_string();
    let (status, error) = post(
        app,
        &format!("/tournaments/{id}/status"),
        &s.admin,
        json!({ "status": "registration" }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{error}");
    id
}

async fn register(
    app: &app_type!(),
    tid: &str,
    who: &Account,
    extra: Value,
) -> (StatusCode, Value) {
    let mut payload = json!({});
    for (key, value) in extra.as_object().unwrap() {
        payload[key] = value.clone();
    }
    post(
        app,
        &format!("/tournaments/{tid}/participants"),
        who,
        payload,
    )
    .await
}

fn id(value: &Value) -> String {
    value["id"].as_str().unwrap().to_string()
}

// ---------------------------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------------------------

#[actix_web::test]
async fn a_tournament_is_configurable_and_owned_by_its_creator() {
    let (app, s) = setup().await;
    let (status, t) = post(
        &app,
        "/tournaments",
        &s.admin,
        body(
            &s,
            json!({
                "mode": "hybrid", "location": "  Paris Expo ", "visibility": "invitation_only",
                "rules": "Pas de triche.", "participant_type": "team",
                "team_min_starters": 2, "team_max_starters": 3, "team_max_substitutes": 1,
                "registration_policy": "approval_required", "waiting_list_enabled": true,
                "check_in_open_at": "2026-11-14T16:00:00Z",
                "check_in_close_at": "2026-11-14T17:30:00Z",
                "registration_fields": [
                    { "key": "rank", "label": "Rang", "field_type": "select", "required": true,
                      "options": ["gold", "plat"] }
                ],
            }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{t}");
    assert_eq!(t["owner_id"], s.admin.id);
    assert_eq!(t["mode"], "hybrid");
    assert_eq!(t["location"], "Paris Expo");
    assert_eq!(t["visibility"], "invitation_only");
    assert_eq!(t["rules"], "Pas de triche.");
    assert_eq!(t["team_min_starters"], 2);
    assert_eq!(t["team_max_starters"], 3);
    assert_eq!(t["team_max_substitutes"], 1);
    assert_eq!(t["registration_policy"], "approval_required");
    assert_eq!(t["check_in_open_at"], "2026-11-14T16:00:00.000000Z");
    assert_eq!(t["is_template"], false);
    assert!(t.get("team_size").is_none());

    // Défauts : en ligne, public, inscriptions ouvertes, remplaçants illimités.
    let (_, plain) = post(
        &app,
        "/tournaments",
        &s.admin,
        body(&s, json!({ "name": "Défauts" })),
    )
    .await;
    assert_eq!(plain["mode"], "online");
    assert_eq!(plain["visibility"], "public");
    assert_eq!(plain["registration_policy"], "open");
    assert_eq!(plain["team_max_substitutes"], Value::Null);

    // L'ancien `team_size` fixe la fourchette de titulaires.
    let (_, legacy) = post(
        &app,
        "/tournaments",
        &s.admin,
        body(
            &s,
            json!({ "name": "Ancien", "participant_type": "team", "team_size": 4 }),
        ),
    )
    .await;
    assert_eq!(legacy["team_min_starters"], 4);
    assert_eq!(legacy["team_max_starters"], 4);

    // Seul un administrateur global crée un tournoi.
    let (status, _) = post(&app, "/tournaments", &s.alice, body(&s, json!({}))).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[actix_web::test]
async fn configuration_is_validated() {
    let (app, s) = setup().await;
    let bad = |extra: Value| body(&s, extra);
    let cases = [
        (bad(json!({ "mode": "lan" })), "invalid_request", None),
        (
            bad(
                json!({ "participant_type": "team", "team_min_starters": 3, "team_max_starters": 2 }),
            ),
            "invalid_request",
            Some("team_max_starters"),
        ),
        (
            bad(json!({ "participant_type": "team", "team_size": 2, "team_max_substitutes": -1 })),
            "invalid_request",
            Some("team_max_substitutes"),
        ),
        (
            bad(json!({ "team_min_starters": 2 })),
            "invalid_request",
            Some("team_min_starters"),
        ),
        (
            bad(
                json!({ "check_in_open_at": "2026-11-14T18:00:00Z", "check_in_close_at": "2026-11-14T17:00:00Z" }),
            ),
            "invalid_request",
            Some("check_in_close_at"),
        ),
        (
            bad(json!({ "registration_fields": [
                { "key": "a", "label": "A", "field_type": "text" },
                { "key": "a", "label": "B", "field_type": "text" } ] })),
            "invalid_request",
            Some("registration_fields"),
        ),
        (
            bad(json!({ "registration_fields": [
                { "key": "x", "label": "X", "field_type": "select" } ] })),
            "invalid_request",
            Some("registration_fields"),
        ),
    ];
    for (payload, _, field) in cases {
        let (status, error) = post(&app, "/tournaments", &s.admin, payload.clone()).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{payload}");
        if let Some(field) = field {
            assert!(error["errors"][field].is_string(), "{field}: {error}");
        }
    }

    // Une équipe inscrite doit respecter les nouvelles bornes.
    let (_, t) = post(
        &app,
        "/tournaments",
        &s.admin,
        body(&s, json!({ "participant_type": "team", "team_size": 1 })),
    )
    .await;
    let tid = id(&t);
    post(
        &app,
        &format!("/tournaments/{tid}/status"),
        &s.admin,
        json!({ "status": "registration" }),
    )
    .await;
    let (_, team) = post(
        &app,
        &format!("/tournaments/{tid}/teams"),
        &s.alice,
        json!({ "name": "Alpha" }),
    )
    .await;
    let (status, _) = register(
        &app,
        &tid,
        &s.alice,
        json!({ "tournament_team_id": team["id"] }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let (status, error) = patch(
        &app,
        &format!("/tournaments/{tid}"),
        &s.admin,
        json!({ "team_min_starters": 2, "team_max_starters": 3 }),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{error}");
}

#[actix_web::test]
async fn team_composition_limits_apply_to_members_and_substitutes() {
    let (app, s) = setup().await;
    let tid = open(
        &app,
        &s,
        json!({ "participant_type": "team", "team_min_starters": 1, "team_max_starters": 2, "team_max_substitutes": 1 }),
    )
    .await;
    let (status, team) = post(
        &app,
        &format!("/tournaments/{tid}/teams"),
        &s.alice,
        json!({ "name": "Alpha" }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{team}");
    let team_id = team["id"].as_str().unwrap().to_string();
    let members = format!("/tournament-teams/{team_id}/members");
    let (status, _) = post(
        &app,
        &members,
        &s.alice,
        json!({ "user_id": s.bob.id, "role": "member" }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    // Deux titulaires au plus.
    let (status, _) = post(
        &app,
        &members,
        &s.alice,
        json!({ "user_id": s.carol.id, "role": "member" }),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    // Un remplaçant au plus.
    let (status, _) = post(
        &app,
        &members,
        &s.alice,
        json!({ "user_id": s.carol.id, "role": "substitute" }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let (status, _) = post(
        &app,
        &members,
        &s.alice,
        json!({ "user_id": s.dave.id, "role": "substitute" }),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    // Les rôles existants sont conservés.
    let (_, listed) = get(&app, &members, &s.alice).await;
    let roles: Vec<&str> = listed
        .as_array()
        .unwrap()
        .iter()
        .map(|m| m["role"].as_str().unwrap())
        .collect();
    assert!(roles.contains(&"owner") && roles.contains(&"member") && roles.contains(&"substitute"));
}

// ---------------------------------------------------------------------------------------------
// Inscriptions : approbation, liste d'attente, champs personnalisés
// ---------------------------------------------------------------------------------------------

#[actix_web::test]
async fn approval_required_registrations_wait_for_an_administrator() {
    let (app, s) = setup().await;
    let tid = open(
        &app,
        &s,
        json!({ "registration_policy": "approval_required", "max_participants": 1 }),
    )
    .await;
    let (status, pending) = register(&app, &tid, &s.alice, json!({})).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(pending["status"], "pending");
    let (_, other) = register(&app, &tid, &s.bob, json!({})).await;
    // Une place seulement : les inscriptions en attente n'en occupent aucune.
    assert_eq!(other["status"], "pending");

    let approve = |p: &Value| format!("/tournaments/{tid}/participants/{}/approve", id(p));
    // Réservé aux organisateurs.
    let (status, _) = post(&app, &approve(&pending), &s.bob, json!({})).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, approved) = post(&app, &approve(&pending), &s.admin, json!({})).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(approved["status"], "registered");
    // On n'approuve pas deux fois.
    let (status, _) = post(&app, &approve(&pending), &s.admin, json!({})).await;
    assert_eq!(status, StatusCode::CONFLICT);
    // Tournoi complet sans liste d'attente : l'approbation est refusée.
    let (status, error) = post(&app, &approve(&other), &s.admin, json!({})).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(error["error"], "tournament_full");
    // Le refus est possible, une seule fois.
    let reject = format!("/tournaments/{tid}/participants/{}/reject", id(&other));
    let (status, rejected) = post(&app, &reject, &s.admin, json!({})).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(rejected["status"], "rejected");
    let (status, _) = post(&app, &reject, &s.admin, json!({})).await;
    assert_eq!(status, StatusCode::CONFLICT);

    let kinds: Vec<EventKind> = s.events.events().iter().map(|e| e.kind).collect();
    assert_eq!(
        kinds,
        [
            EventKind::PendingApproval,
            EventKind::PendingApproval,
            EventKind::Approved,
            EventKind::Rejected
        ]
    );
}

#[actix_web::test]
async fn the_waiting_list_is_ordered_and_never_exceeds_the_capacity() {
    let (app, s) = setup().await;
    let tid = open(
        &app,
        &s,
        json!({ "waiting_list_enabled": true, "max_participants": 1 }),
    )
    .await;
    let (_, first) = register(&app, &tid, &s.alice, json!({})).await;
    let (_, second) = register(&app, &tid, &s.bob, json!({})).await;
    let (_, third) = register(&app, &tid, &s.carol, json!({})).await;
    assert_eq!(first["status"], "registered");
    assert_eq!(second["status"], "waitlisted");
    assert_eq!(third["status"], "waitlisted");

    // Plein : rien à promouvoir.
    let (status, promoted) = post(
        &app,
        &format!("/tournaments/{tid}/waiting-list/promote"),
        &s.admin,
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(promoted.as_array().unwrap().is_empty());
    let (status, _) = post(
        &app,
        &format!("/tournaments/{tid}/waiting-list/promote"),
        &s.bob,
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    // Un retrait libère la place : le premier de la liste est promu, pas le suivant.
    let (status, _) = patch(
        &app,
        &format!("/tournaments/{tid}/participants/{}", id(&first)),
        &s.alice,
        json!({ "status": "withdrawn" }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (_, all) = get(&app, &format!("/tournaments/{tid}/participants"), &s.admin).await;
    let status_of = |p: &Value| {
        all.as_array()
            .unwrap()
            .iter()
            .find(|x| x["id"] == p["id"])
            .unwrap()["status"]
            .clone()
    };
    assert_eq!(status_of(&second), "registered");
    assert_eq!(status_of(&third), "waitlisted");
    let kinds: Vec<EventKind> = s.events.events().iter().map(|e| e.kind).collect();
    assert_eq!(
        kinds.iter().filter(|k| **k == EventKind::Promoted).count(),
        1
    );

    // Sans liste d'attente, un tournoi complet refuse toujours.
    let full = open(
        &app,
        &s,
        json!({ "name": "Sans liste", "max_participants": 1 }),
    )
    .await;
    register(&app, &full, &s.alice, json!({})).await;
    let (status, error) = register(&app, &full, &s.bob, json!({})).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(error["error"], "tournament_full");
}

#[actix_web::test]
async fn concurrent_registrations_and_promotions_never_exceed_the_capacity() {
    let store = Arc::new(MemoryStore::new());
    let mut users = Vec::new();
    for n in 0..24 {
        users.push(
            store
                .create_user(&format!("u{n}"), None, "hash")
                .await
                .unwrap()
                .id,
        );
    }
    let mut input = TournamentInput {
        game_id: Uuid::new_v4(),
        name: "Race".into(),
        description: None,
        start_date: "2026-11-14T18:00:00.000000Z".into(),
        end_date: "2026-11-15T18:00:00.000000Z".into(),
        registration_open_at: None,
        registration_close_at: None,
        participant_type: api_public::store::ParticipantType::Solo,
        max_participants: 5,
        team_scoring_mode: api_public::store::TeamScoringMode::None,
        team_scoring_n: None,
        settings: TournamentSettings::solo(),
        owner_id: None,
        is_template: false,
    };
    input.settings.waiting_list_enabled = true;
    let tournament = store.create_tournament(input).await.unwrap();
    let mut tasks = Vec::new();
    for user in users {
        let store = store.clone();
        tasks.push(tokio::spawn(async move {
            let added = store
                .add_participant(ParticipantInput {
                    tournament_id: tournament.id,
                    user_id: Some(user),
                    tournament_team_id: None,
                    responses: no_responses(),
                })
                .await
                .unwrap()
                .unwrap();
            // Des promotions concurrentes ne doivent rien changer au plafond.
            store.promote_waitlist(tournament.id).await.unwrap();
            added
        }));
    }
    for task in tasks {
        task.await.unwrap();
    }
    let all = store
        .list_participants(tournament.id, i64::MAX, 0)
        .await
        .unwrap();
    let seated = all.iter().filter(|p| p.status.holds_a_seat()).count();
    let waiting = all
        .iter()
        .filter(|p| p.status == ParticipantStatus::Waitlisted)
        .count();
    assert_eq!(seated, 5);
    assert_eq!(waiting, 19);
}

#[actix_web::test]
async fn custom_registration_fields_are_validated_and_stored() {
    let (app, s) = setup().await;
    let tid = open(
        &app,
        &s,
        json!({ "registration_fields": [
            { "key": "ingame", "label": "Pseudo", "field_type": "text", "required": true },
            { "key": "level", "label": "Niveau", "field_type": "number" },
            { "key": "platform", "label": "Plateforme", "field_type": "select", "options": ["pc", "console"] },
            { "key": "stream", "label": "Stream", "field_type": "boolean" },
        ] }),
    )
    .await;
    for bad in [
        json!({}),
        json!({ "responses": { "ingame": "Faker", "level": "high" } }),
        json!({ "responses": { "ingame": "Faker", "platform": "mobile" } }),
        json!({ "responses": { "ingame": "Faker", "stream": "yes" } }),
        json!({ "responses": { "ingame": "Faker", "inconnu": 1 } }),
        json!({ "responses": ["x"] }),
    ] {
        let (status, error) = register(&app, &tid, &s.alice, bad.clone()).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{bad}");
        assert!(error["errors"]["responses"].is_string(), "{error}");
    }
    let (status, participant) = register(
        &app,
        &tid,
        &s.alice,
        json!({ "responses": { "ingame": " Faker ", "level": 12, "platform": "pc", "stream": true } }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{participant}");
    assert_eq!(
        participant["responses"],
        json!({ "ingame": "Faker", "level": 12, "platform": "pc", "stream": true })
    );
    register(
        &app,
        &tid,
        &s.bob,
        json!({ "responses": { "ingame": "Bob" } }),
    )
    .await;

    // Les réponses ne sont lues que par l'équipe organisatrice et par l'inscrit.
    let path = format!("/tournaments/{tid}/participants");
    let (_, as_admin) = get(&app, &path, &s.admin).await;
    assert!(
        as_admin
            .as_array()
            .unwrap()
            .iter()
            .all(|p| p["responses"]["ingame"].is_string())
    );
    let (_, as_bob) = get(&app, &path, &s.bob).await;
    let seen: Vec<bool> = as_bob
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p["responses"]["ingame"].is_string())
        .collect();
    assert_eq!(seen, [false, true]);
}

// ---------------------------------------------------------------------------------------------
// Pointage
// ---------------------------------------------------------------------------------------------

#[actix_web::test]
async fn check_in_is_enforced_inside_its_window() {
    let (app, s) = setup().await;
    let future = open(
        &app,
        &s,
        json!({ "name": "Futur", "check_in_open_at": "2099-01-01T00:00:00Z", "check_in_close_at": "2099-01-02T00:00:00Z" }),
    )
    .await;
    let (_, p) = register(&app, &future, &s.alice, json!({})).await;
    let url = format!("/tournaments/{future}/participants/{}/check-in", id(&p));
    let (status, error) = post(&app, &url, &s.alice, json!({})).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(error["error"], "check_in_closed");

    let now = open(
        &app,
        &s,
        json!({ "name": "Ouvert", "check_in_open_at": "2020-01-01T00:00:00Z", "check_in_close_at": "2099-01-02T00:00:00Z" }),
    )
    .await;
    let (_, p) = register(&app, &now, &s.alice, json!({})).await;
    let url = format!("/tournaments/{now}/participants/{}/check-in", id(&p));
    let (status, checked) = post(&app, &url, &s.alice, json!({})).await;
    assert_eq!(status, StatusCode::OK, "{checked}");
    assert_eq!(checked["status"], "checked_in");
    // Sans fenêtre, le pointage reste libre pendant les inscriptions (ancien comportement).
    let free = open(&app, &s, json!({ "name": "Libre" })).await;
    let (_, p) = register(&app, &free, &s.alice, json!({})).await;
    let (status, _) = post(
        &app,
        &format!("/tournaments/{free}/participants/{}/check-in", id(&p)),
        &s.alice,
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
}

#[actix_web::test]
async fn closing_the_check_in_marks_absentees_and_promotes_the_waiting_list() {
    let (app, s) = setup().await;
    let tid = open(
        &app,
        &s,
        json!({ "waiting_list_enabled": true, "max_participants": 2 }),
    )
    .await;
    let (_, here) = register(&app, &tid, &s.alice, json!({})).await;
    let (_, absent) = register(&app, &tid, &s.bob, json!({})).await;
    let (_, first_waiting) = register(&app, &tid, &s.carol, json!({})).await;
    let (_, second_waiting) = register(&app, &tid, &s.dave, json!({})).await;
    assert_eq!(first_waiting["status"], "waitlisted");
    post(
        &app,
        &format!("/tournaments/{tid}/participants/{}/check-in", id(&here)),
        &s.alice,
        json!({}),
    )
    .await;

    // Réservé aux organisateurs.
    let (status, _) = post(
        &app,
        &format!("/tournaments/{tid}/check-in/close"),
        &s.alice,
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, closed) = post(
        &app,
        &format!("/tournaments/{tid}/check-in/close"),
        &s.admin,
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(closed["check_in_settled_at"].is_string());

    let (_, all) = get(&app, &format!("/tournaments/{tid}/participants"), &s.admin).await;
    let status_of = |p: &Value| {
        all.as_array()
            .unwrap()
            .iter()
            .find(|x| x["id"] == p["id"])
            .unwrap()["status"]
            .clone()
    };
    assert_eq!(status_of(&here), "checked_in");
    assert_eq!(status_of(&absent), "absent");
    // Une seule place libérée : le premier de la liste d'attente la prend, pas le second.
    assert_eq!(status_of(&first_waiting), "registered");
    assert_eq!(status_of(&second_waiting), "waitlisted");

    // La clôture ne se traite qu'une fois, et ne change plus la fenêtre.
    post(
        &app,
        &format!("/tournaments/{tid}/check-in/close"),
        &s.admin,
        json!({}),
    )
    .await;
    let kinds: Vec<EventKind> = s.events.events().iter().map(|e| e.kind).collect();
    assert_eq!(kinds.iter().filter(|k| **k == EventKind::Absent).count(), 1);
    assert_eq!(
        kinds.iter().filter(|k| **k == EventKind::Promoted).count(),
        1
    );
    let (status, _) = patch(
        &app,
        &format!("/tournaments/{tid}"),
        &s.admin,
        json!({ "check_in_close_at": "2099-01-01T00:00:00Z" }),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
}

#[actix_web::test]
async fn an_elapsed_check_in_window_is_settled_lazily() {
    let (app, s) = setup().await;
    let tid = open(
        &app,
        &s,
        json!({ "max_participants": 2, "waiting_list_enabled": true,
                "check_in_open_at": "2020-01-01T00:00:00Z", "check_in_close_at": "2020-01-02T00:00:00Z" }),
    )
    .await;
    // La fenêtre est déjà passée : les inscrits n'ont pas pu pointer.
    let (_, p) = register(&app, &tid, &s.alice, json!({})).await;
    let (status, error) = post(
        &app,
        &format!("/tournaments/{tid}/participants/{}/check-in", id(&p)),
        &s.alice,
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{error}");
    let (_, all) = get(&app, &format!("/tournaments/{tid}/participants"), &s.admin).await;
    assert_eq!(all[0]["status"], "absent");
}

// ---------------------------------------------------------------------------------------------
// Accès public
// ---------------------------------------------------------------------------------------------

#[actix_web::test]
async fn public_endpoints_need_no_token_and_hide_private_data() {
    let (app, s) = setup().await;
    let tid = open(
        &app,
        &s,
        json!({ "registration_fields": [{ "key": "ingame", "label": "Pseudo", "field_type": "text" }] }),
    )
    .await;
    register(
        &app,
        &tid,
        &s.alice,
        json!({ "responses": { "ingame": "Secret" } }),
    )
    .await;
    // Un tournoi en brouillon n'est pas public.
    let (_, draft) = post(
        &app,
        "/tournaments",
        &s.admin,
        body(&s, json!({ "name": "Brouillon" })),
    )
    .await;
    let (status, _) = anonymous(&app, &format!("/public/tournaments/{}", id(&draft))).await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    let (status, list) = anonymous(&app, "/public/tournaments").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(list.as_array().unwrap().len(), 1);
    let (status, t) = anonymous(&app, &format!("/public/tournaments/{tid}")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(t["name"], "TFT Open");
    assert!(t.get("owner_id").is_none() && t.get("is_template").is_none());

    let (status, players) =
        anonymous(&app, &format!("/public/tournaments/{tid}/participants")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(players[0]["name"], "alice");
    assert!(!players.to_string().contains("Secret"));
    assert!(!players.to_string().contains(&s.alice.id));
    for path in ["ranking", "team-ranking", "steps"] {
        let (status, _) = anonymous(&app, &format!("/public/tournaments/{tid}/{path}")).await;
        assert_eq!(status, StatusCode::OK, "{path}");
    }
    let (_, ranking) = anonymous(&app, &format!("/public/tournaments/{tid}/ranking")).await;
    assert_eq!(ranking[0]["username"], "alice");
    assert!(!ranking.to_string().contains(&s.alice.id));

    // Les mutations restent authentifiées, y compris sous l'ancien préfixe.
    let (status, _) = send(
        &app,
        TestRequest::post(),
        &format!("/tournaments/{tid}/participants"),
        None,
        Some(json!({})),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    let (status, _) = send(
        &app,
        TestRequest::post(),
        &format!("/public/tournaments/{tid}/participants"),
        None,
        Some(json!({})),
    )
    .await;
    assert!(matches!(
        status,
        StatusCode::NOT_FOUND | StatusCode::METHOD_NOT_ALLOWED
    ));
}

#[actix_web::test]
async fn invitation_only_tournaments_are_hidden_server_side_including_children() {
    let (app, s) = setup().await;
    let tid = open(&app, &s, json!({ "visibility": "invitation_only" })).await;
    let (_, step) = post(
        &app,
        &format!("/tournaments/{tid}/steps"),
        &s.admin,
        json!({ "position": 1, "format": "pool", "match_type": "ffa", "group_count": 1, "group_size": 4, "advance_per_group": 1 }),
    )
    .await;
    let step_id = id(&step);
    // Sans jeton : introuvable partout.
    for path in [
        format!("/public/tournaments/{tid}"),
        format!("/public/tournaments/{tid}/participants"),
        format!("/public/tournaments/{tid}/ranking"),
        format!("/public/tournaments/{tid}/steps"),
        format!("/public/tournaments/{tid}/steps/{step_id}/matches"),
        format!("/public/tournaments/{tid}/steps/{step_id}/ranking"),
    ] {
        assert_eq!(
            anonymous(&app, &path).await.0,
            StatusCode::NOT_FOUND,
            "{path}"
        );
    }
    assert!(
        anonymous(&app, "/public/tournaments")
            .await
            .1
            .as_array()
            .unwrap()
            .is_empty()
    );

    // Avec un jeton mais sans invitation : introuvable aussi, ressources enfants comprises.
    let children = [
        format!("/tournaments/{tid}"),
        format!("/tournaments/{tid}/participants"),
        format!("/tournaments/{tid}/scoring-rules"),
        format!("/tournaments/{tid}/ranking"),
        format!("/tournaments/{tid}/team-ranking"),
        format!("/tournaments/{tid}/teams"),
        format!("/tournaments/{tid}/steps"),
        format!("/tournaments/{tid}/steps/{step_id}"),
        format!("/tournaments/{tid}/steps/{step_id}/ranking"),
        format!("/tournaments/{tid}/steps/{step_id}/matches"),
    ];
    for path in &children {
        assert_eq!(
            get(&app, path, &s.bob).await.0,
            StatusCode::NOT_FOUND,
            "{path}"
        );
    }
    let (_, listed) = get(&app, "/tournaments", &s.bob).await;
    assert!(listed.as_array().unwrap().is_empty());
    let (status, _) = register(&app, &tid, &s.bob, json!({})).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = post(
        &app,
        &format!("/tournaments/{tid}/teams"),
        &s.bob,
        json!({ "name": "Intrus" }),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    // Pas même un 403 qui révélerait son existence.
    let (status, _) = patch(&app, &format!("/tournaments/{tid}"), &s.bob, json!({})).await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    // Invité : le tournoi devient visible et l'inscription possible.
    let (status, _) = put(
        &app,
        &format!("/tournaments/{tid}/invitations/{}", s.bob.id),
        &s.admin,
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    for path in &children {
        assert_eq!(get(&app, path, &s.bob).await.0, StatusCode::OK, "{path}");
    }
    let (status, _) = register(&app, &tid, &s.bob, json!({})).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(
        get(&app, &format!("/tournaments/{tid}"), &s.carol).await.0,
        StatusCode::NOT_FOUND
    );
    // Le retrait de l'invitation ne chasse pas un inscrit, mais l'invitation sans inscription
    // ferme l'accès.
    let (status, _) = delete(
        &app,
        &format!("/tournaments/{tid}/invitations/{}", s.carol.id),
        &s.admin,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    // Seuls les organisateurs invitent.
    let (status, _) = put(
        &app,
        &format!("/tournaments/{tid}/invitations/{}", s.carol.id),
        &s.bob,
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

// ---------------------------------------------------------------------------------------------
// Rôles du tournoi
// ---------------------------------------------------------------------------------------------

async fn other_tournament(app: &app_type!(), s: &Setup) -> String {
    let (_, t) = post(
        app,
        "/tournaments",
        &s.admin,
        body(s, json!({ "name": "Autre" })),
    )
    .await;
    id(&t)
}

#[actix_web::test]
async fn the_owner_delegates_roles_and_they_stay_scoped_to_the_tournament() {
    let (app, s) = setup().await;
    let tid = open(&app, &s, json!({})).await;
    let other = other_tournament(&app, &s).await;
    // Un compte ordinaire n'administre rien.
    let (status, _) = patch(
        &app,
        &format!("/tournaments/{tid}"),
        &s.alice,
        json!({ "description": "x" }),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    let (status, assigned) = put(
        &app,
        &format!("/tournaments/{tid}/roles/{}", s.alice.id),
        &s.admin,
        json!({ "role": "admin" }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{assigned}");
    let (status, _) = put(
        &app,
        &format!("/tournaments/{tid}/roles/{}", s.bob.id),
        &s.admin,
        json!({ "role": "referee" }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    // L'administrateur de tournoi gère son tournoi...
    let (status, _) = patch(
        &app,
        &format!("/tournaments/{tid}"),
        &s.alice,
        json!({ "description": "Géré par Alice" }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (status, step) = post(
        &app,
        &format!("/tournaments/{tid}/steps"),
        &s.alice,
        json!({ "position": 1, "format": "pool", "match_type": "ffa", "group_count": 1, "group_size": 4, "advance_per_group": 1 }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{step}");
    let (_, p) = register(&app, &tid, &s.carol, json!({})).await;
    let (status, _) = patch(
        &app,
        &format!("/tournaments/{tid}/participants/{}", id(&p)),
        &s.alice,
        json!({ "status": "disqualified" }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    // ... mais pas un autre tournoi : il lui est visible (public) donc 403.
    let (status, _) = patch(
        &app,
        &format!("/tournaments/{other}"),
        &s.alice,
        json!({ "description": "x" }),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = post(
        &app,
        &format!("/tournaments/{other}/status"),
        &s.alice,
        json!({ "status": "registration" }),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = post(&app, &format!("/tournaments/{other}/steps"), &s.alice, json!({ "position": 1, "format": "pool", "match_type": "ffa", "group_count": 1, "group_size": 4, "advance_per_group": 1 })).await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    // Pas d'escalade : un administrateur de tournoi ne désigne personne, ne se transfère rien,
    // ne supprime pas le tournoi.
    let (status, _) = put(
        &app,
        &format!("/tournaments/{tid}/roles/{}", s.carol.id),
        &s.alice,
        json!({ "role": "admin" }),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = put(
        &app,
        &format!("/tournaments/{tid}/roles/{}", s.alice.id),
        &s.alice,
        json!({ "role": "admin" }),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = post(
        &app,
        &format!("/tournaments/{tid}/transfer-ownership"),
        &s.alice,
        json!({ "user_id": s.alice.id }),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = delete(&app, &format!("/tournaments/{tid}"), &s.alice).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = delete(
        &app,
        &format!("/tournaments/{tid}/roles/{}", s.bob.id),
        &s.alice,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    // Il ne crée pas non plus de tournoi : réservé aux administrateurs globaux.
    let (status, _) = post(
        &app,
        "/tournaments",
        &s.alice,
        body(&s, json!({ "name": "Nouveau" })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    // L'arbitre arbitre (résultats, pointage) mais ne gère pas.
    let (status, _) = patch(
        &app,
        &format!("/tournaments/{tid}"),
        &s.bob,
        json!({ "description": "x" }),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = post(
        &app,
        &format!("/tournaments/{tid}/participants/{}/approve", id(&p)),
        &s.bob,
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = put(
        &app,
        &format!(
            "/tournaments/{tid}/steps/{}/matches/{}/results",
            id(&step),
            Uuid::new_v4()
        ),
        &s.bob,
        json!({ "results": [] }),
    )
    .await;
    assert_ne!(
        status,
        StatusCode::FORBIDDEN,
        "un arbitre saisit les résultats"
    );
    let (status, _) = post(
        &app,
        &format!("/tournaments/{tid}/steps/{}/matches", id(&step)),
        &s.bob,
        json!({ "group_id": Uuid::new_v4() }),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::FORBIDDEN,
        "un arbitre ne crée pas de match"
    );
    // L'arbitre ne voit pas la liste des rôles.
    assert_eq!(
        get(&app, &format!("/tournaments/{tid}/roles"), &s.bob)
            .await
            .0,
        StatusCode::FORBIDDEN
    );

    // L'administrateur global garde tous ses droits sur les deux tournois.
    for t in [&tid, &other] {
        let (status, _) = patch(
            &app,
            &format!("/tournaments/{t}"),
            &s.admin,
            json!({ "description": "Root" }),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
    }
}

#[actix_web::test]
async fn roles_can_be_revoked_and_the_owner_is_protected() {
    let (app, s) = setup().await;
    let tid = open(&app, &s, json!({})).await;
    put(
        &app,
        &format!("/tournaments/{tid}/roles/{}", s.alice.id),
        &s.admin,
        json!({ "role": "admin" }),
    )
    .await;
    let (_, roles) = get(&app, &format!("/tournaments/{tid}/roles"), &s.alice).await;
    assert_eq!(roles["owner_id"], s.admin.id);
    assert_eq!(roles["roles"].as_array().unwrap().len(), 1);

    // Le propriétaire n'a pas de rôle délégué : on ne peut ni lui en donner ni lui en retirer,
    // il reste donc toujours un propriétaire.
    let (status, _) = put(
        &app,
        &format!("/tournaments/{tid}/roles/{}", s.admin.id),
        &s.admin,
        json!({ "role": "referee" }),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, _) = delete(
        &app,
        &format!("/tournaments/{tid}/roles/{}", s.admin.id),
        &s.admin,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    // Compte inconnu.
    let (status, _) = put(
        &app,
        &format!("/tournaments/{tid}/roles/{}", Uuid::new_v4()),
        &s.admin,
        json!({ "role": "admin" }),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    let (status, _) = delete(
        &app,
        &format!("/tournaments/{tid}/roles/{}", s.alice.id),
        &s.admin,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (status, _) = patch(
        &app,
        &format!("/tournaments/{tid}"),
        &s.alice,
        json!({ "description": "x" }),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = delete(
        &app,
        &format!("/tournaments/{tid}/roles/{}", s.alice.id),
        &s.admin,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[actix_web::test]
async fn ownership_transfer_is_atomic_audited_and_keeps_a_single_owner() {
    let (app, s) = setup().await;
    let tid = open(&app, &s, json!({})).await;
    put(
        &app,
        &format!("/tournaments/{tid}/roles/{}", s.alice.id),
        &s.admin,
        json!({ "role": "referee" }),
    )
    .await;
    let url = format!("/tournaments/{tid}/transfer-ownership");
    // Soi-même, compte inconnu : refusés.
    let (status, _) = post(&app, &url, &s.admin, json!({ "user_id": s.admin.id })).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, _) = post(&app, &url, &s.admin, json!({ "user_id": Uuid::new_v4() })).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    // Un tiers ne transfère pas.
    let (status, _) = post(&app, &url, &s.bob, json!({ "user_id": s.bob.id })).await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    let (status, after) = post(&app, &url, &s.admin, json!({ "user_id": s.alice.id })).await;
    assert_eq!(status, StatusCode::OK, "{after}");
    assert_eq!(after["owner_id"], s.alice.id);
    // L'ancien propriétaire devient administrateur du tournoi ; le nouveau perd son rôle délégué.
    let roles = after["roles"].as_array().unwrap();
    assert_eq!(roles.len(), 1);
    assert_eq!(roles[0]["user_id"], s.admin.id);
    assert_eq!(roles[0]["role"], "admin");
    let (_, t) = get(&app, &format!("/tournaments/{tid}"), &s.alice).await;
    assert_eq!(t["owner_id"], s.alice.id);

    // Le nouveau propriétaire délègue ; l'ancien (simple administrateur de tournoi) ne le peut plus.
    let (status, _) = put(
        &app,
        &format!("/tournaments/{tid}/roles/{}", s.bob.id),
        &s.alice,
        json!({ "role": "admin" }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    // Le journal consigne tout, dans l'ordre.
    let (status, audit) = get(&app, &format!("/tournaments/{tid}/role-audit"), &s.alice).await;
    assert_eq!(status, StatusCode::OK);
    let actions: Vec<(&str, &str)> = audit
        .as_array()
        .unwrap()
        .iter()
        .map(|e| {
            (
                e["action"].as_str().unwrap(),
                e["actor_id"].as_str().unwrap(),
            )
        })
        .collect();
    assert_eq!(
        actions,
        [
            ("assign", s.admin.id.as_str()),
            ("transfer", s.admin.id.as_str()),
            ("assign", s.alice.id.as_str()),
        ]
    );
    assert_eq!(audit[1]["target_user_id"], s.alice.id);
    assert_eq!(
        get(&app, &format!("/tournaments/{tid}/role-audit"), &s.carol)
            .await
            .0,
        StatusCode::FORBIDDEN
    );
}

#[actix_web::test]
async fn concurrent_transfers_leave_exactly_one_owner() {
    let store = Arc::new(MemoryStore::new());
    let mut users = Vec::new();
    for n in 0..6 {
        users.push(
            store
                .create_user(&format!("u{n}"), None, "hash")
                .await
                .unwrap()
                .id,
        );
    }
    let mut input = TournamentInput {
        game_id: Uuid::new_v4(),
        name: "Own".into(),
        description: None,
        start_date: "2026-11-14T18:00:00.000000Z".into(),
        end_date: "2026-11-15T18:00:00.000000Z".into(),
        registration_open_at: None,
        registration_close_at: None,
        participant_type: api_public::store::ParticipantType::Solo,
        max_participants: 2,
        team_scoring_mode: api_public::store::TeamScoringMode::None,
        team_scoring_n: None,
        settings: TournamentSettings::solo(),
        owner_id: Some(users[0]),
        is_template: false,
    };
    input.settings.visibility = api_public::store::Visibility::Public;
    let tournament = store.create_tournament(input).await.unwrap();
    // Tous les transferts partent de l'ancien propriétaire : un seul peut aboutir.
    let mut tasks = Vec::new();
    for user in users.iter().skip(1) {
        let (store, user, from) = (store.clone(), *user, users[0]);
        tasks.push(tokio::spawn(async move {
            store
                .transfer_tournament_ownership(tournament.id, Some(from), user, from)
                .await
                .unwrap()
        }));
    }
    let mut won = 0;
    for task in tasks {
        if task.await.unwrap() {
            won += 1;
        }
    }
    assert_eq!(won, 1);
    let owner = store
        .find_tournament(tournament.id)
        .await
        .unwrap()
        .unwrap()
        .owner_id;
    assert!(owner.is_some() && owner != Some(users[0]));
}

// ---------------------------------------------------------------------------------------------
// Doublons et modèles
// ---------------------------------------------------------------------------------------------

#[actix_web::test]
async fn duplicates_and_templates_copy_the_configuration_only() {
    let (app, s) = setup().await;
    let (_, stat) = post(
        &app,
        "/stats",
        &s.admin,
        json!({ "name": "Kills", "key": "kills", "type": "flat" }),
    )
    .await;
    put(
        &app,
        &format!("/games/{}/stats/{}", s.game, id(&stat)),
        &s.admin,
        json!({}),
    )
    .await;
    let tid = open(
        &app,
        &s,
        json!({ "mode": "in_person", "location": "Lyon", "rules": "Fair-play", "waiting_list_enabled": true,
                "registration_policy": "approval_required",
                "registration_fields": [{ "key": "ingame", "label": "Pseudo", "field_type": "text" }] }),
    )
    .await;
    post(
        &app,
        &format!("/tournaments/{tid}/scoring-rules"),
        &s.admin,
        json!({ "stat_id": id(&stat), "mode": "linear", "coefficient": 2 }),
    )
    .await;
    post(
        &app,
        &format!("/tournaments/{tid}/steps"),
        &s.admin,
        json!({ "position": 1, "format": "pool", "match_type": "ffa", "group_count": 1, "group_size": 4, "advance_per_group": 1 }),
    )
    .await;
    register(
        &app,
        &tid,
        &s.alice,
        json!({ "responses": { "ingame": "Faker" } }),
    )
    .await;
    post(
        &app,
        &format!("/tournaments/{tid}/check-in/close"),
        &s.admin,
        json!({}),
    )
    .await;

    let (status, copy) = post(&app, &format!("/tournaments/{tid}/duplicate"), &s.admin, json!({ "name": "TFT Open #2", "start_date": "2027-01-10T18:00:00Z", "end_date": "2027-01-11T18:00:00Z" })).await;
    assert_eq!(status, StatusCode::CREATED, "{copy}");
    let cid = id(&copy);
    // Configuration recopiée...
    assert_eq!(copy["mode"], "in_person");
    assert_eq!(copy["location"], "Lyon");
    assert_eq!(copy["rules"], "Fair-play");
    assert_eq!(copy["registration_policy"], "approval_required");
    assert_eq!(copy["registration_fields"][0]["key"], "ingame");
    assert_eq!(copy["start_date"], "2027-01-10T18:00:00.000000Z");
    // ... état de fonctionnement exclu.
    assert_eq!(copy["status"], "draft");
    assert_eq!(copy["check_in_settled_at"], Value::Null);
    assert_eq!(copy["owner_id"], s.admin.id);
    assert_eq!(
        get(&app, &format!("/tournaments/{cid}/participants"), &s.admin)
            .await
            .1,
        json!([])
    );
    assert_eq!(
        get(&app, &format!("/tournaments/{cid}/scoring-rules"), &s.admin)
            .await
            .1
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        get(&app, &format!("/tournaments/{cid}/steps"), &s.admin)
            .await
            .1
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        get(&app, &format!("/tournaments/{cid}/steps"), &s.admin)
            .await
            .1[0]["status"],
        "pending"
    );
    assert_eq!(
        get(&app, &format!("/tournaments/{cid}/teams"), &s.admin)
            .await
            .1,
        json!([])
    );
    // Nom pris, création réservée aux administrateurs globaux.
    let (status, _) = post(
        &app,
        &format!("/tournaments/{tid}/duplicate"),
        &s.admin,
        json!({ "name": "tft open #2" }),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    let (status, _) = post(
        &app,
        &format!("/tournaments/{tid}/duplicate"),
        &s.alice,
        json!({ "name": "Autre" }),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    // Modèles : jamais listés avec les tournois, ni exposés, ni ouverts aux inscriptions.
    let (status, template) = post(
        &app,
        &format!("/tournaments/{tid}/templates"),
        &s.admin,
        json!({ "name": "Modèle TFT" }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{template}");
    assert_eq!(template["is_template"], true);
    let template_id = id(&template);
    let (_, tournaments) = get(&app, "/tournaments", &s.admin).await;
    assert!(
        tournaments
            .as_array()
            .unwrap()
            .iter()
            .all(|t| t["id"] != template["id"])
    );
    let (_, templates) = get(&app, "/tournament-templates", &s.admin).await;
    assert_eq!(templates.as_array().unwrap().len(), 1);
    assert_eq!(
        get(&app, "/tournament-templates", &s.alice).await.0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        get(&app, &format!("/tournaments/{template_id}"), &s.alice)
            .await
            .0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        anonymous(&app, &format!("/public/tournaments/{template_id}"))
            .await
            .0,
        StatusCode::NOT_FOUND
    );
    let (status, _) = post(
        &app,
        &format!("/tournaments/{template_id}/status"),
        &s.admin,
        json!({ "status": "registration" }),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    let export = send(
        &app,
        TestRequest::get(),
        "/tournaments/export",
        Some(&s.admin.token),
        None,
    )
    .await
    .1;
    assert!(!export.to_string().contains("Modèle TFT"));

    let (status, from_template) = post(
        &app,
        &format!("/tournament-templates/{template_id}/tournaments"),
        &s.admin,
        json!({ "name": "Depuis modèle" }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{from_template}");
    assert_eq!(from_template["is_template"], false);
    assert_eq!(from_template["status"], "draft");
    assert_eq!(from_template["location"], "Lyon");
    assert_eq!(
        get(
            &app,
            &format!("/tournaments/{}/participants", id(&from_template)),
            &s.admin
        )
        .await
        .1,
        json!([])
    );
    let (status, _) = delete(
        &app,
        &format!("/tournament-templates/{template_id}"),
        &s.admin,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert_eq!(
        get(
            &app,
            &format!("/tournament-templates/{template_id}"),
            &s.admin
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    // Un tournoi ordinaire n'est pas un modèle.
    assert_eq!(
        get(&app, &format!("/tournament-templates/{tid}"), &s.admin)
            .await
            .0,
        StatusCode::NOT_FOUND
    );
}

// ---------------------------------------------------------------------------------------------
// Import / export
// ---------------------------------------------------------------------------------------------

#[actix_web::test]
async fn new_settings_survive_an_export_and_an_import() {
    let (app, s) = setup().await;
    let tid = open(
        &app,
        &s,
        json!({ "participant_type": "team", "team_min_starters": 2, "team_max_starters": 3, "team_max_substitutes": 1,
                "mode": "hybrid", "location": "Paris", "visibility": "invitation_only", "rules": "R",
                "registration_policy": "approval_required", "waiting_list_enabled": true,
                "check_in_open_at": "2099-01-01T00:00:00Z", "check_in_close_at": "2099-01-02T00:00:00Z",
                "registration_fields": [{ "key": "k", "label": "K", "field_type": "text", "required": true }] }),
    )
    .await;
    {
        let format = "json";
        let (status, exported) = {
            let req = request(
                TestRequest::get(),
                &format!("/tournaments/export?format={format}"),
                Some(&s.admin.token),
            );
            let response = actix_web::test::call_service(&app, req.to_request()).await;
            let status = response.status();
            let bytes = actix_web::test::read_body(response).await;
            (status, String::from_utf8(bytes.to_vec()).unwrap())
        };
        assert_eq!(status, StatusCode::OK);
        assert!(exported.contains("invitation_only"), "{format}: {exported}");
        post(
            &app,
            &format!("/tournaments/{tid}/status"),
            &s.admin,
            json!({ "status": "cancelled" }),
        )
        .await;
        let (status, _) = delete(&app, &format!("/tournaments/{tid}"), &s.admin).await;
        assert_eq!(status, StatusCode::NO_CONTENT);
        let req = request(
            TestRequest::post(),
            &format!("/tournaments/import?format={format}"),
            Some(&s.admin.token),
        )
        .set_payload(exported);
        let (status, report) = call(&app, req).await;
        assert_eq!(status, StatusCode::OK, "{format}: {report}");
        let (_, listed) = get(&app, "/tournaments", &s.admin).await;
        let t = &listed.as_array().unwrap()[0];
        assert_eq!(t["mode"], "hybrid");
        assert_eq!(t["location"], "Paris");
        assert_eq!(t["visibility"], "invitation_only");
        assert_eq!(t["team_min_starters"], 2);
        assert_eq!(t["team_max_starters"], 3);
        assert_eq!(t["team_max_substitutes"], 1);
        assert_eq!(t["registration_policy"], "approval_required");
        assert_eq!(t["waiting_list_enabled"], true);
        assert_eq!(t["check_in_close_at"], "2099-01-02T00:00:00.000000Z");
        assert_eq!(t["registration_fields"][0]["key"], "k");
        // Importer ne change pas le propriétaire d'un tournoi existant (nouveau : l'importeur).
        assert_eq!(t["owner_id"], s.admin.id);
    }
}

#[actix_web::test]
async fn a_legacy_file_without_settings_still_imports() {
    let (app, s) = setup().await;
    let file = json!({ "version": 1, "tournaments": [{
        "game": "TFT", "name": "Ancien", "start_date": "2026-11-14T18:00:00Z",
        "end_date": "2026-11-15T18:00:00Z", "participant_type": "team", "team_size": 3,
        "max_participants": 4 }] });
    let req = request(
        TestRequest::post(),
        "/tournaments/import",
        Some(&s.admin.token),
    )
    .set_payload(file.to_string());
    let (status, report) = call(&app, req).await;
    assert_eq!(status, StatusCode::OK, "{report}");
    let (_, listed) = get(&app, "/tournaments", &s.admin).await;
    let t = &listed.as_array().unwrap()[0];
    assert_eq!(t["team_min_starters"], 3);
    assert_eq!(t["team_max_starters"], 3);
    assert_eq!(t["visibility"], "public");
    assert_eq!(t["owner_id"], s.admin.id);
}
