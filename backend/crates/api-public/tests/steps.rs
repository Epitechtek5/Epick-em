//! Parcours HTTP des routes des étapes (réglages, chaînage, lancement, clôture, classements),
//! sur un store en mémoire.

mod common;

use actix_web::http::StatusCode;
use actix_web::test::TestRequest;
use api_public::store::{AuthStore, MemoryStore, Role};
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

struct Setup {
    store: Arc<MemoryStore>,
    admin: String,
    game: String,
    players: Vec<String>,
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

/// Un administrateur, un jeu et huit joueurs.
async fn setup() -> (app_type!(), Setup) {
    let store = Arc::new(MemoryStore::new());
    let app = app_with(store.clone(), Duration::from_secs(3600)).await;
    logged_in_as(&app, "root", "secret123").await;
    store.set_role("root", Role::Admin);
    let (_, session) = login(&app, "root", "secret123").await;
    let admin = access(&session).to_string();
    let (_, game) = post(&app, "/games", &admin, json!({ "name": "TFT" })).await;
    let game = game["id"].as_str().unwrap().to_string();
    let mut players = Vec::new();
    for index in 0..8 {
        let session = logged_in_as(&app, &format!("player{index}"), "secret123").await;
        players.push(access(&session).to_string());
    }
    (
        app,
        Setup {
            store,
            admin,
            game,
            players,
        },
    )
}

async fn tournament(app: &app_type!(), s: &Setup, max_participants: u32) -> String {
    let (status, tournament) = post(
        app,
        "/tournaments",
        &s.admin,
        json!({
            "game_id": s.game,
            "name": format!("Open {}", Uuid::new_v4()),
            "start_date": "2026-11-14T18:00:00Z",
            "end_date": "2026-11-15T18:00:00Z",
            "participant_type": "solo",
            "max_participants": max_participants,
        }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{tournament}");
    tournament["id"].as_str().unwrap().to_string()
}

async fn set_status(app: &app_type!(), s: &Setup, tid: &str, status: &str) -> StatusCode {
    post(
        app,
        &format!("/tournaments/{tid}/status"),
        &s.admin,
        json!({ "status": status }),
    )
    .await
    .0
}

fn step_body(position: u32, groups: u32, size: u32, advance: u32) -> Value {
    json!({
        "position": position,
        "format": "pool",
        "match_type": "ffa",
        "group_count": groups,
        "group_size": size,
        "matches_per_group": 3,
        "advance_per_group": advance,
        "tiebreak": ["wins"],
    })
}

async fn create_step(app: &app_type!(), s: &Setup, tid: &str, body: Value) -> String {
    let (status, step) = post(app, &format!("/tournaments/{tid}/steps"), &s.admin, body).await;
    assert_eq!(status, StatusCode::CREATED, "{step}");
    step["id"].as_str().unwrap().to_string()
}

/// Un tournoi de 8 joueurs inscrits en deux étapes : deux groupes de 4 dont 2 passent, puis une
/// finale de 4 dont 1 gagne.
async fn running(app: &app_type!(), s: &Setup) -> (String, String, String) {
    let tid = tournament(app, s, 8).await;
    let first = create_step(app, s, &tid, step_body(1, 2, 4, 2)).await;
    let last = create_step(app, s, &tid, step_body(2, 1, 4, 1)).await;
    assert_eq!(
        set_status(app, s, &tid, "registration").await,
        StatusCode::OK
    );
    for player in &s.players {
        let (status, body) = post(
            app,
            &format!("/tournaments/{tid}/participants"),
            player,
            json!({}),
        )
        .await;
        assert_eq!(status, StatusCode::CREATED, "{body}");
    }
    assert_eq!(set_status(app, s, &tid, "ongoing").await, StatusCode::OK);
    (tid, first, last)
}

fn error_code(value: &Value) -> &str {
    value["error"].as_str().unwrap_or_default()
}

fn ids(groups: &Value) -> Vec<Vec<Uuid>> {
    groups
        .as_array()
        .unwrap()
        .iter()
        .map(|group| {
            group["participants"]
                .as_array()
                .unwrap()
                .iter()
                .map(|p| p["participant_id"].as_str().unwrap().parse().unwrap())
                .collect()
        })
        .collect()
}

#[actix_web::test]
async fn every_route_requires_a_token() {
    let (app, _) = setup().await;
    let (a, b) = (Uuid::new_v4(), Uuid::new_v4());
    let requests = [
        (TestRequest::get(), format!("/tournaments/{a}/steps")),
        (TestRequest::post(), format!("/tournaments/{a}/steps")),
        (TestRequest::get(), format!("/tournaments/{a}/steps/{b}")),
        (TestRequest::patch(), format!("/tournaments/{a}/steps/{b}")),
        (TestRequest::delete(), format!("/tournaments/{a}/steps/{b}")),
        (
            TestRequest::get(),
            format!("/tournaments/{a}/steps/{b}/ranking"),
        ),
        (
            TestRequest::post(),
            format!("/tournaments/{a}/steps/{b}/start"),
        ),
        (
            TestRequest::post(),
            format!("/tournaments/{a}/steps/{b}/close"),
        ),
    ];
    for (method, path) in requests {
        let (status, _) = call(&app, request(method, &path, None)).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED, "{path}");
    }
}

#[actix_web::test]
async fn steps_are_managed_by_admins_and_locked_once_the_tournament_runs() {
    let (app, s) = setup().await;
    let tid = tournament(&app, &s, 8).await;
    let path = format!("/tournaments/{tid}/steps");

    // Un joueur consulte mais ne modifie rien.
    let (status, _) = post(&app, &path, &s.players[0], step_body(1, 2, 4, 2)).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, steps) = get(&app, &path, &s.players[0]).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(steps, json!([]));

    let first = create_step(&app, &s, &tid, step_body(1, 2, 4, 2)).await;
    let (status, step) = get(&app, &format!("{path}/{first}"), &s.players[0]).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(step["status"], "pending");
    assert_eq!(step["tiebreak"], json!(["wins"]));
    assert_eq!(step["format"], "pool");

    // Position prise, puis réglages invalides, champ par champ.
    let (status, error) = post(&app, &path, &s.admin, step_body(1, 1, 4, 1)).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(error_code(&error), "step_position_taken");
    let cases = [
        (json!({ "position": 0 }), "position"),
        (
            json!({ "group_size": 1, "advance_per_group": 1 }),
            "group_size",
        ),
        (json!({ "advance_per_group": 5 }), "advance_per_group"),
        (json!({ "matches_per_group": 0 }), "matches_per_group"),
        (json!({ "format": "swiss" }), "group_count"),
        (json!({ "tiebreak": ["Wins"] }), "tiebreak"),
        (json!({ "tiebreak": ["a", "a"] }), "tiebreak"),
    ];
    for (patch, field) in cases {
        let mut body = step_body(2, 2, 4, 2);
        for (key, value) in patch.as_object().unwrap() {
            body[key] = value.clone();
        }
        let (status, error) = post(&app, &path, &s.admin, body.clone()).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
        assert!(error["errors"][field].is_string(), "{field}: {error}");
    }
    let (status, _) = post(&app, &path, &s.admin, json!({ "position": 2 })).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    // Modification partielle : le résultat complet doit rester valide.
    let (status, step) = send(
        &app,
        TestRequest::patch(),
        &format!("{path}/{first}"),
        &s.admin,
        Some(json!({ "advance_per_group": 3, "tiebreak": [] })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{step}");
    assert_eq!(step["advance_per_group"], 3);
    assert_eq!(step["group_size"], 4);
    assert_eq!(step["tiebreak"], json!([]));
    let (status, _) = send(
        &app,
        TestRequest::patch(),
        &format!("{path}/{first}"),
        &s.admin,
        Some(json!({ "advance_per_group": 9 })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let second = create_step(&app, &s, &tid, step_body(2, 1, 4, 1)).await;
    let (status, error) = send(
        &app,
        TestRequest::patch(),
        &format!("{path}/{second}"),
        &s.admin,
        Some(json!({ "position": 1 })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(error_code(&error), "step_position_taken");
    let (status, _) = send(
        &app,
        TestRequest::patch(),
        &format!("{path}/{first}"),
        &s.players[0],
        Some(json!({})),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    // Une étape d'un autre tournoi reste introuvable ici.
    let other = tournament(&app, &s, 8).await;
    let (status, _) = get(
        &app,
        &format!("/tournaments/{other}/steps/{first}"),
        &s.admin,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = get(
        &app,
        &format!("/tournaments/{}/steps", Uuid::new_v4()),
        &s.admin,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    let (status, _) = send(
        &app,
        TestRequest::delete(),
        &format!("{path}/{second}"),
        &s.admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (_, steps) = get(&app, &path, &s.admin).await;
    assert_eq!(steps.as_array().unwrap().len(), 1);

    // Dès `ongoing`, les réglages sont verrouillés.
    let (running_tid, running_first, _) = running(&app, &s).await;
    let running_path = format!("/tournaments/{running_tid}/steps");
    let (status, error) = post(&app, &running_path, &s.admin, step_body(3, 1, 4, 1)).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(error_code(&error), "tournament_locked");
    let (status, _) = send(
        &app,
        TestRequest::patch(),
        &format!("{running_path}/{running_first}"),
        &s.admin,
        Some(json!({ "group_size": 5 })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    let (status, _) = send(
        &app,
        TestRequest::delete(),
        &format!("{running_path}/{running_first}"),
        &s.admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
}

#[actix_web::test]
async fn the_tournament_only_starts_with_a_valid_chain() {
    let (app, s) = setup().await;
    let tid = tournament(&app, &s, 8).await;
    // Le tournoi attend 8 participants, l'étape 1 en accueille 6, et 2 ne suit pas.
    create_step(&app, &s, &tid, step_body(1, 2, 3, 2)).await;
    let broken = create_step(&app, &s, &tid, step_body(3, 1, 4, 2)).await;
    assert_eq!(
        set_status(&app, &s, &tid, "registration").await,
        StatusCode::OK
    );
    for player in s.players.iter().take(2) {
        post(
            &app,
            &format!("/tournaments/{tid}/participants"),
            player,
            json!({}),
        )
        .await;
    }
    let (status, error) = post(
        &app,
        &format!("/tournaments/{tid}/status"),
        &s.admin,
        json!({ "status": "ongoing" }),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{error}");
    let message = error["errors"]["status"].as_str().unwrap();
    assert!(message.contains("positions"), "{message}");
    assert!(message.contains("attend 8"), "{message}");
    assert!(message.contains("dernière étape"), "{message}");

    // Chaîne corrigée : 8 -> 2 groupes de 4 -> 4 -> finale de 4 -> 1.
    let steps = format!("/tournaments/{tid}/steps");
    let (status, _) = send(
        &app,
        TestRequest::delete(),
        &format!("{steps}/{broken}"),
        &s.admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (_, listed) = get(&app, &steps, &s.admin).await;
    let first = listed[0]["id"].as_str().unwrap();
    send(
        &app,
        TestRequest::patch(),
        &format!("{steps}/{first}"),
        &s.admin,
        Some(json!({ "group_size": 4 })),
    )
    .await;
    create_step(&app, &s, &tid, step_body(2, 1, 4, 1)).await;
    assert_eq!(set_status(&app, &s, &tid, "ongoing").await, StatusCode::OK);
}

#[actix_web::test]
async fn a_step_starts_with_a_random_draw_and_closes_into_the_next_one() {
    let (app, s) = setup().await;
    let (tid, first, last) = running(&app, &s).await;
    let steps = format!("/tournaments/{tid}/steps");

    // Dans l'ordre, et pas sans droits.
    let (status, _) = post(&app, &format!("{steps}/{last}/start"), &s.admin, json!({})).await;
    assert_eq!(status, StatusCode::CONFLICT);
    let (status, _) = post(
        &app,
        &format!("{steps}/{first}/start"),
        &s.players[0],
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = post(&app, &format!("{steps}/{first}/close"), &s.admin, json!({})).await;
    assert_eq!(
        status,
        StatusCode::CONFLICT,
        "une étape non lancée ne se clôture pas"
    );

    let (status, ranking) = get(&app, &format!("{steps}/{first}/ranking"), &s.admin).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(ranking, json!([]));

    let (status, step) = post(&app, &format!("{steps}/{first}/start"), &s.admin, json!({})).await;
    assert_eq!(status, StatusCode::OK, "{step}");
    assert_eq!(step["status"], "ongoing");
    let (status, _) = post(&app, &format!("{steps}/{first}/start"), &s.admin, json!({})).await;
    assert_eq!(status, StatusCode::CONFLICT, "déjà lancée");

    // Huit inscrits répartis en deux groupes de quatre, sans doublon.
    let (_, ranking) = get(&app, &format!("{steps}/{first}/ranking"), &s.players[0]).await;
    let groups = ids(&ranking);
    assert_eq!(groups.iter().map(Vec::len).collect::<Vec<_>>(), [4, 4]);
    assert_eq!(ranking[0]["index"], 1);
    assert_eq!(ranking[1]["index"], 2);
    let mut everyone: Vec<Uuid> = groups.iter().flatten().copied().collect();
    everyone.sort();
    everyone.dedup();
    assert_eq!(everyone.len(), 8);
    assert!(
        ranking[0]["participants"]
            .as_array()
            .unwrap()
            .iter()
            .all(|p| p["status"] == "in")
    );

    // Des points : 10 > 7 = 7 > 0 dans le premier groupe, 3 > 2 > 1 > 0 dans le second.
    let step_id: Uuid = first.parse().unwrap();
    for (group, points) in groups
        .iter()
        .zip([[10.0, 7.0, 7.0, 0.0], [3.0, 2.0, 1.0, 0.0]])
    {
        for (participant, points) in group.iter().zip(points) {
            assert!(
                s.store
                    .set_step_points(step_id, *participant, points)
                    .await
                    .unwrap()
            );
        }
    }
    let (_, ranking) = get(&app, &format!("{steps}/{first}/ranking"), &s.admin).await;
    let ranks: Vec<Vec<u64>> = ranking
        .as_array()
        .unwrap()
        .iter()
        .map(|g| {
            g["participants"]
                .as_array()
                .unwrap()
                .iter()
                .map(|p| p["rank"].as_u64().unwrap())
                .collect()
        })
        .collect();
    assert_eq!(ranks, [vec![1, 2, 2, 4], vec![1, 2, 3, 4]]);
    // Les points du tournoi sont la somme de ceux des étapes.
    let (_, standings) = get(&app, &format!("/tournaments/{tid}/ranking"), &s.admin).await;
    assert_eq!(standings[0]["points"], 10.0);

    // Clôture : les deux premiers de chaque groupe passent, la finale s'ouvre toute seule.
    let (status, closed) = post(&app, &format!("{steps}/{first}/close"), &s.admin, json!({})).await;
    assert_eq!(status, StatusCode::OK, "{closed}");
    assert_eq!(closed["step"]["status"], "finished");
    assert_eq!(closed["next_step"]["status"], "ongoing");
    assert_eq!(closed["next_step"]["id"], json!(last));
    let (_, ranking) = get(&app, &format!("{steps}/{first}/ranking"), &s.admin).await;
    let outcomes: Vec<Vec<(u64, &str)>> = ranking
        .as_array()
        .unwrap()
        .iter()
        .map(|g| {
            g["participants"]
                .as_array()
                .unwrap()
                .iter()
                .map(|p| (p["rank"].as_u64().unwrap(), p["status"].as_str().unwrap()))
                .collect()
        })
        .collect();
    let expected = [
        vec![
            (1, "qualified"),
            (2, "qualified"),
            (3, "eliminated"),
            (4, "eliminated"),
        ],
        vec![
            (1, "qualified"),
            (2, "qualified"),
            (3, "eliminated"),
            (4, "eliminated"),
        ],
    ];
    assert_eq!(outcomes, expected);
    let (status, _) = post(&app, &format!("{steps}/{first}/close"), &s.admin, json!({})).await;
    assert_eq!(status, StatusCode::CONFLICT, "déjà clôturée");

    // La finale réunit les quatre qualifiés dans un seul groupe.
    let (_, finale) = get(&app, &format!("{steps}/{last}/ranking"), &s.admin).await;
    let finalists = ids(&finale);
    assert_eq!(finalists.len(), 1);
    assert_eq!(finalists[0].len(), 4);
    let qualified: Vec<Uuid> = ids(&ranking)
        .into_iter()
        .zip([[true, true, false, false]; 2])
        .flat_map(|(group, keep)| {
            group
                .into_iter()
                .zip(keep)
                .filter(|(_, k)| *k)
                .map(|(id, _)| id)
        })
        .collect();
    let mut sorted_finalists = finalists[0].clone();
    sorted_finalists.sort();
    let mut sorted_qualified = qualified;
    sorted_qualified.sort();
    assert_eq!(sorted_finalists, sorted_qualified);

    // Un seul qualifié à la fin ; le tournoi reste en cours jusqu'à ce qu'on le termine.
    let (status, closed) = post(&app, &format!("{steps}/{last}/close"), &s.admin, json!({})).await;
    assert_eq!(status, StatusCode::OK, "{closed}");
    assert_eq!(closed["next_step"], Value::Null);
    let (_, finale) = get(&app, &format!("{steps}/{last}/ranking"), &s.admin).await;
    let statuses: Vec<&str> = finale[0]["participants"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p["status"].as_str().unwrap())
        .collect();
    assert_eq!(statuses.iter().filter(|s| **s == "qualified").count(), 1);
    assert_eq!(set_status(&app, &s, &tid, "finished").await, StatusCode::OK);
}

#[actix_web::test]
async fn a_step_needs_enough_participants_and_a_running_tournament() {
    let (app, s) = setup().await;
    // Trois inscrits pour deux groupes : il en faut au moins deux par groupe.
    let tid = tournament(&app, &s, 8).await;
    let first = create_step(&app, &s, &tid, step_body(1, 2, 4, 2)).await;
    let steps = format!("/tournaments/{tid}/steps");
    let (status, error) = post(&app, &format!("{steps}/{first}/start"), &s.admin, json!({})).await;
    assert_eq!(
        status,
        StatusCode::CONFLICT,
        "{error}: le tournoi n'est pas en cours"
    );
    set_status(&app, &s, &tid, "registration").await;
    for player in s.players.iter().take(3) {
        post(
            &app,
            &format!("/tournaments/{tid}/participants"),
            player,
            json!({}),
        )
        .await;
    }
    // Le chaînage est incomplet : la seule étape qualifie 4 participants.
    let (status, _) = post(
        &app,
        &format!("/tournaments/{tid}/status"),
        &s.admin,
        json!({ "status": "ongoing" }),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    send(
        &app,
        TestRequest::patch(),
        &format!("{steps}/{first}"),
        &s.admin,
        Some(json!({ "group_count": 1, "group_size": 8, "advance_per_group": 1 })),
    )
    .await;
    assert_eq!(set_status(&app, &s, &tid, "ongoing").await, StatusCode::OK);
    let (status, step) = post(&app, &format!("{steps}/{first}/start"), &s.admin, json!({})).await;
    assert_eq!(status, StatusCode::OK, "{step}");
    let (_, ranking) = get(&app, &format!("{steps}/{first}/ranking"), &s.admin).await;
    assert_eq!(ids(&ranking)[0].len(), 3, "un seul groupe de trois");

    // Une étape de deux groupes ne se lance pas avec trois inscrits.
    let small = tournament(&app, &s, 8).await;
    let only = create_step(&app, &s, &small, step_body(1, 2, 4, 2)).await;
    create_step(&app, &s, &small, step_body(2, 1, 4, 1)).await;
    set_status(&app, &s, &small, "registration").await;
    for player in s.players.iter().take(3) {
        post(
            &app,
            &format!("/tournaments/{small}/participants"),
            player,
            json!({}),
        )
        .await;
    }
    assert_eq!(
        set_status(&app, &s, &small, "ongoing").await,
        StatusCode::OK
    );
    let (status, error) = post(
        &app,
        &format!("/tournaments/{small}/steps/{only}/start"),
        &s.admin,
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{error}");
    assert!(error["errors"]["participants"].is_string());
}
