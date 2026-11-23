//! Parcours HTTP des pronostics, du Pick'em, de leur résolution et des classements des
//! spectateurs, sur un store en mémoire.

mod common;

use actix_web::http::StatusCode;
use actix_web::test::TestRequest;
use api_public::resolution::{resolve_pending, resolve_tournament};
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

const FUTURE: &str = "2099-01-01T00:00:00Z";

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

async fn put(app: &app_type!(), path: &str, token: &str, body: Value) -> (StatusCode, Value) {
    send(app, TestRequest::put(), path, token, Some(body)).await
}

async fn get(app: &app_type!(), path: &str, token: &str) -> (StatusCode, Value) {
    send(app, TestRequest::get(), path, token, None).await
}

async fn delete(app: &app_type!(), path: &str, token: &str) -> StatusCode {
    send(app, TestRequest::delete(), path, token, None).await.0
}

fn id(value: &Value) -> String {
    value["id"].as_str().unwrap().to_string()
}

struct Arena {
    store: Arc<MemoryStore>,
    admin: String,
    fans: Vec<String>,
    tournament: String,
    step: String,
    participants: Vec<String>,
}

/// Un tournoi en cours de quatre joueurs, une étape `pool` en FFA lancée (un groupe, un
/// qualifié), un barème `kills` et deux spectateurs.
async fn arena(app: &app_type!(), store: Arc<MemoryStore>) -> Arena {
    logged_in_as(app, "root", "secret123").await;
    store.set_role("root", Role::Admin);
    let (_, session) = login(app, "root", "secret123").await;
    let admin = access(&session).to_string();
    let (_, game) = post(app, "/games", &admin, json!({ "name": "TFT" })).await;
    let game = id(&game);
    let (_, stat) = post(
        app,
        "/stats",
        &admin,
        json!({ "name": "Kills", "key": "kills", "type": "flat" }),
    )
    .await;
    let stat = id(&stat);
    send(
        app,
        TestRequest::put(),
        &format!("/games/{game}/stats/{stat}"),
        &admin,
        None,
    )
    .await;
    let (status, tournament) = post(
        app,
        "/tournaments",
        &admin,
        json!({
            "game_id": game, "name": "Open", "start_date": "2026-11-14T18:00:00Z",
            "end_date": "2026-11-15T18:00:00Z", "participant_type": "solo",
            "max_participants": 4,
        }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{tournament}");
    let tid = id(&tournament);
    let (status, _) = post(
        app,
        &format!("/tournaments/{tid}/scoring-rules"),
        &admin,
        json!({ "stat_id": stat, "mode": "linear", "coefficient": 1.0 }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let (_, step) = post(
        app,
        &format!("/tournaments/{tid}/steps"),
        &admin,
        json!({
            "position": 1, "format": "pool", "match_type": "ffa", "group_count": 1,
            "group_size": 4, "matches_per_group": 1, "advance_per_group": 1,
        }),
    )
    .await;
    let step = id(&step);
    let status_path = format!("/tournaments/{tid}/status");
    post(
        app,
        &status_path,
        &admin,
        json!({ "status": "registration" }),
    )
    .await;
    for index in 0..4 {
        let session = logged_in_as(app, &format!("player{index}"), "secret123").await;
        let (status, _) = post(
            app,
            &format!("/tournaments/{tid}/participants"),
            access(&session),
            json!({}),
        )
        .await;
        assert_eq!(status, StatusCode::CREATED);
    }
    post(app, &status_path, &admin, json!({ "status": "ongoing" })).await;
    let (status, _) = post(
        app,
        &format!("/tournaments/{tid}/steps/{step}/start"),
        &admin,
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (_, participants) = get(app, &format!("/tournaments/{tid}/participants"), &admin).await;
    let participants = participants.as_array().unwrap().iter().map(id).collect();
    let mut fans = Vec::new();
    for name in ["fan", "rival"] {
        let session = logged_in_as(app, name, "secret123").await;
        fans.push(access(&session).to_string());
    }
    Arena {
        store,
        admin,
        fans,
        tournament: tid,
        step,
        participants,
    }
}

#[actix_web::test]
async fn every_route_requires_a_token() {
    let store = Arc::new(MemoryStore::new());
    let app = app_with(store, Duration::from_secs(3600)).await;
    let (t, m, q) = (Uuid::new_v4(), Uuid::new_v4(), Uuid::new_v4());
    let requests = [
        (
            TestRequest::get(),
            format!("/tournaments/{t}/matches/{m}/prediction"),
        ),
        (
            TestRequest::put(),
            format!("/tournaments/{t}/matches/{m}/prediction"),
        ),
        (
            TestRequest::delete(),
            format!("/tournaments/{t}/matches/{m}/prediction"),
        ),
        (
            TestRequest::get(),
            format!("/tournaments/{t}/matches/{m}/predictions"),
        ),
        (TestRequest::get(), "/predictions".to_string()),
        (TestRequest::get(), format!("/tournaments/{t}/leaderboard")),
        (TestRequest::get(), "/leaderboard".to_string()),
        (TestRequest::get(), format!("/tournaments/{t}/pickem")),
        (
            TestRequest::get(),
            format!("/tournaments/{t}/pickem/templates"),
        ),
        (
            TestRequest::post(),
            format!("/tournaments/{t}/pickem/questions"),
        ),
        (
            TestRequest::patch(),
            format!("/tournaments/{t}/pickem/questions/{q}"),
        ),
        (
            TestRequest::delete(),
            format!("/tournaments/{t}/pickem/questions/{q}"),
        ),
        (
            TestRequest::put(),
            format!("/tournaments/{t}/pickem/questions/{q}/answer"),
        ),
    ];
    for (method, path) in requests {
        let (status, _) = call(&app, request(method, &path, None)).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED, "{path}");
    }
}

#[actix_web::test]
async fn predictions_and_pickem_are_resolved_into_leaderboards() {
    let store = Arc::new(MemoryStore::new());
    let app = app_with(store.clone(), Duration::from_secs(3600)).await;
    let a = arena(&app, store).await;
    let (tid, step, ids) = (&a.tournament, &a.step, &a.participants);
    let (fan, rival) = (&a.fans[0], &a.fans[1]);
    let matches = format!("/tournaments/{tid}/steps/{step}/matches");
    let group = {
        let (_, ranking) = get(
            &app,
            &format!("/tournaments/{tid}/steps/{step}/ranking"),
            fan,
        )
        .await;
        ranking[0]["group_id"].as_str().unwrap().to_string()
    };

    // Le match principal est prévu plus tard ; un autre l'était déjà ce matin.
    let (_, main) = post(
        &app,
        &matches,
        &a.admin,
        json!({ "group_id": group, "round": 1, "scheduled_at": FUTURE, "participant_ids": ids }),
    )
    .await;
    let main = id(&main);
    let (_, early) = post(
        &app,
        &matches,
        &a.admin,
        json!({ "group_id": group, "round": 1, "scheduled_at": "2026-01-01T00:00:00Z",
                "participant_ids": [ids[0], ids[1]] }),
    )
    .await;
    let early = id(&early);
    let prediction = format!("/tournaments/{tid}/matches/{main}/prediction");

    // Un FFA se pronostique avec un classement de participants du match, sans doublon.
    for body in [
        json!({ "winner_id": ids[0] }),
        json!({ "ranking": [] }),
        json!({ "ranking": [ids[0], ids[0]] }),
        json!({ "ranking": [Uuid::new_v4()] }),
        json!({ "ranking": [ids[0]], "winner_id": ids[0] }),
    ] {
        let (status, error) = put(&app, &prediction, fan, body.clone()).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{body}: {error}");
    }
    let (status, saved) = put(
        &app,
        &prediction,
        fan,
        json!({ "ranking": [ids[1], ids[0]] }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{saved}");
    assert_eq!(saved["outcome"], "pending");
    assert_eq!(saved["locked"], false);
    // Il se remplace, se supprime et se refait.
    let (status, _) = put(
        &app,
        &prediction,
        fan,
        json!({ "ranking": [ids[0], ids[1]] }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(delete(&app, &prediction, fan).await, StatusCode::NO_CONTENT);
    assert_eq!(delete(&app, &prediction, fan).await, StatusCode::NOT_FOUND);
    put(
        &app,
        &prediction,
        fan,
        json!({ "ranking": [ids[0], ids[1]] }),
    )
    .await;
    let (status, mine) = get(&app, &prediction, fan).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(mine["ranking"], json!([ids[0], ids[1]]));
    put(
        &app,
        &prediction,
        rival,
        json!({ "ranking": [ids[3], ids[2]] }),
    )
    .await;

    // L'heure prévue passée, le pronostic est verrouillé par l'horloge du serveur.
    let (status, error) = put(
        &app,
        &format!("/tournaments/{tid}/matches/{early}/prediction"),
        fan,
        json!({ "ranking": [ids[0]] }),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(error["error"], "prediction_locked");
    // Un match d'un autre tournoi est introuvable.
    let (status, _) = get(
        &app,
        &format!("/tournaments/{}/matches/{main}/prediction", Uuid::new_v4()),
        fan,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    // Avant le verrouillage, les pronostics des autres restent cachés.
    let all = format!("/tournaments/{tid}/matches/{main}/predictions");
    let (_, hidden) = get(&app, &all, rival).await;
    assert_eq!(hidden["locked"], false);
    assert_eq!(hidden["count"], 2);
    assert_eq!(hidden["predictions"], json!([]));

    // Pick'em : modèles résolubles avec les données du tournoi.
    let pickem = format!("/tournaments/{tid}/pickem");
    let (status, _) = get(&app, &format!("{pickem}/templates"), fan).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (_, templates) = get(&app, &format!("{pickem}/templates"), &a.admin).await;
    let templates = templates.as_array().unwrap();
    assert!(
        templates.iter().all(|t| t["available"] == true),
        "{templates:?}"
    );
    let qualifiers = templates
        .iter()
        .find(|t| t["kind"] == "step_qualifiers")
        .unwrap();
    assert_eq!(qualifiers["steps"][0]["step_id"], step.as_str());
    assert_eq!(qualifiers["steps"][0]["expected"], 1);

    let questions = format!("{pickem}/questions");
    let (status, _) = post(&app, &questions, fan, json!({ "kind": "top_scorer" })).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    // Le tournoi a commencé : sa date de début ne peut pas servir de fermeture.
    let (status, error) = post(&app, &questions, &a.admin, json!({ "kind": "top_scorer" })).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(error["errors"]["locks_at"].is_string());
    let (status, error) = post(
        &app,
        &questions,
        &a.admin,
        json!({ "kind": "step_qualifiers", "locks_at": FUTURE }),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(error["errors"]["params"].is_string());
    let mut question_ids = Vec::new();
    for body in [
        json!({ "kind": "tournament_winner", "locks_at": FUTURE }),
        json!({ "kind": "top_scorer", "locks_at": FUTURE, "points": 15 }),
        json!({ "kind": "step_qualifiers", "locks_at": FUTURE, "params": { "step_id": step } }),
    ] {
        let (status, question) = post(&app, &questions, &a.admin, body).await;
        assert_eq!(status, StatusCode::CREATED, "{question}");
        question_ids.push(id(&question));
    }
    let (winner_q, scorer_q, qualifiers_q) = (&question_ids[0], &question_ids[1], &question_ids[2]);
    let answer = |q: &str| format!("{questions}/{q}/answer");

    // Réponses : des inscrits du tournoi, autant que la question en attend.
    let (status, _) = put(
        &app,
        &answer(winner_q),
        fan,
        json!({ "participant_ids": [ids[0]] }),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, _) = put(
        &app,
        &answer(winner_q),
        fan,
        json!({ "participant_id": Uuid::new_v4() }),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, _) = put(
        &app,
        &answer(qualifiers_q),
        fan,
        json!({ "participant_ids": [ids[0], ids[1]] }),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    for (q, body) in [
        (winner_q, json!({ "participant_id": ids[0] })),
        (scorer_q, json!({ "participant_id": ids[0] })),
        (qualifiers_q, json!({ "participant_ids": [ids[0]] })),
    ] {
        let (status, saved) = put(&app, &answer(q), fan, body).await;
        assert_eq!(status, StatusCode::OK, "{saved}");
    }
    put(
        &app,
        &answer(winner_q),
        rival,
        json!({ "participant_id": ids[3] }),
    )
    .await;
    let (_, view) = get(&app, &pickem, fan).await;
    assert_eq!(view.as_array().unwrap().len(), 3);
    assert!(
        view.as_array()
            .unwrap()
            .iter()
            .all(|q| !q["my_answer"].is_null())
    );
    assert!(
        view.as_array()
            .unwrap()
            .iter()
            .all(|q| q["locked"] == false)
    );

    // Le match a lieu : player0 gagne, player1 deuxième, player2 troisième.
    let (status, _) = post(
        &app,
        &format!("{matches}/{early}/status"),
        &a.admin,
        json!({ "status": "cancelled" }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let results: Vec<Value> = ids
        .iter()
        .enumerate()
        .map(|(rank, p)| json!({ "participant_id": p, "stats": { "kills": 9 - 3 * rank } }))
        .collect();
    let (status, body) = put(
        &app,
        &format!("{matches}/{main}/results"),
        &a.admin,
        json!({ "results": results }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let (status, done) = post(
        &app,
        &format!("{matches}/{main}/status"),
        &a.admin,
        json!({ "status": "finished" }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{done}");
    assert_eq!(done["step_closed"]["step"]["status"], "finished");

    // Verrouillé : plus de modification, et les pronostics deviennent visibles.
    let (status, _) = put(&app, &prediction, fan, json!({ "ranking": [ids[3]] })).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(delete(&app, &prediction, fan).await, StatusCode::CONFLICT);
    let (_, shown) = get(&app, &all, rival).await;
    assert_eq!(shown["locked"], true);
    assert_eq!(shown["predictions"].as_array().unwrap().len(), 2);
    assert_eq!(shown["distribution"][&ids[0]], 1);
    assert_eq!(shown["distribution"][&ids[3]], 1);
    assert!(
        shown["predictions"]
            .as_array()
            .unwrap()
            .iter()
            .any(|p| p["username"] == "fan")
    );

    // Résolution, le tournoi encore en cours : l'étape est jouée, pas le meilleur marqueur.
    let tournament_id: Uuid = tid.parse().unwrap();
    let report = resolve_tournament(a.store.as_ref() as &dyn AuthStore, tournament_id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!((report.predictions, report.answers), (2, 4));
    assert!(!report.settled);
    let (_, mine) = get(&app, &prediction, fan).await;
    assert_eq!(mine["outcome"], "correct");
    assert_eq!(mine["points"], 10.0);
    let (_, view) = get(&app, &pickem, fan).await;
    let outcome = |q: &str| {
        view.as_array()
            .unwrap()
            .iter()
            .find(|v| v["id"] == q)
            .unwrap()["my_answer"]["outcome"]
            .clone()
    };
    assert_eq!(outcome(winner_q), "correct");
    assert_eq!(outcome(qualifiers_q), "correct");
    assert_eq!(outcome(scorer_q), "pending");

    // Le tournoi terminé, tout est tranché et le tournoi est réglé.
    let (status, _) = post(
        &app,
        &format!("/tournaments/{tid}/status"),
        &a.admin,
        json!({ "status": "finished" }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let reports = resolve_pending(a.store.as_ref() as &dyn AuthStore, 10)
        .await
        .unwrap();
    assert_eq!(reports.len(), 1);
    assert!(reports[0].as_ref().unwrap().settled);
    // Finished tournaments remain eligible for corrected results.
    assert_eq!(
        resolve_pending(a.store.as_ref() as &dyn AuthStore, 10)
            .await
            .unwrap()
            .len(),
        1
    );

    // fan : classement exact (2 × 5) + vainqueur (30) + meilleur marqueur (15) + qualifié (20).
    // rival : player3 premier (dernier en vrai), player2 deuxième (troisième en vrai) → 2.
    let (status, board) = get(&app, &format!("/tournaments/{tid}/leaderboard"), fan).await;
    assert_eq!(status, StatusCode::OK);
    let summary: Vec<(i64, &str, f64, i64)> = board
        .as_array()
        .unwrap()
        .iter()
        .map(|row| {
            (
                row["rank"].as_i64().unwrap(),
                row["username"].as_str().unwrap(),
                row["points"].as_f64().unwrap(),
                row["correct"].as_i64().unwrap(),
            )
        })
        .collect();
    assert_eq!(summary, [(1, "fan", 75.0, 4), (2, "rival", 2.0, 1)]);

    // Rejouer la résolution ne compte rien deux fois.
    resolve_tournament(a.store.as_ref() as &dyn AuthStore, tournament_id)
        .await
        .unwrap();
    let (_, again) = get(&app, &format!("/tournaments/{tid}/leaderboard"), fan).await;
    assert_eq!(again, board);
    let (_, global) = get(&app, "/leaderboard?limit=1", fan).await;
    assert_eq!(global.as_array().unwrap().len(), 1);
    assert_eq!(global[0]["username"], "fan");
    let (_, page) = get(&app, "/leaderboard?offset=1", fan).await;
    assert_eq!(page[0]["rank"], 2);

    let (_, mine) = get(&app, &format!("/predictions?tournament_id={tid}"), fan).await;
    assert_eq!(mine.as_array().unwrap().len(), 1);

    // A correction after settlement is consumed by the periodic worker and replaces points.
    let corrected_results: Vec<Value> = ids
        .iter()
        .enumerate()
        .map(|(index, id)| {
            json!({"participant_id":id,"stats":{"kills":if index == 1 {1000} else {9 - 3 * index}},
               "rank":index + 1})
        })
        .collect();
    let correction_input =
        json!({"report":{"results":corrected_results},"reason":"Verified score correction"});
    let (status, preview) = post(
        &app,
        &format!("{matches}/{main}/correction-preview"),
        &a.admin,
        correction_input.clone(),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{preview}");
    let (status, corrected_result) = post(
        &app,
        &format!("{matches}/{main}/corrections"),
        &a.admin,
        json!({"operation_id":Uuid::new_v4(),"revision":preview["revision"],"reset_downstream":true,
               "report":correction_input["report"],"reason":correction_input["reason"]}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{corrected_result}");
    // Correcting a completed tournament can reopen its sporting state, never its wagers.
    let (status, _) = put(
        &app,
        &answer(scorer_q),
        fan,
        json!({"participant_id":ids[1]}),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    let (status, response) = post(
        &app,
        &format!("/tournaments/{tid}/status"),
        &a.admin,
        json!({"status":"finished"}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{response}");

    resolve_pending(a.store.as_ref() as &dyn AuthStore, 10)
        .await
        .unwrap();
    let (_, corrected) = get(&app, &format!("/tournaments/{tid}/leaderboard"), fan).await;
    let fan_score = corrected
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["username"] == "fan")
        .unwrap()["points"]
        .as_f64()
        .unwrap();
    assert!(fan_score < 75.0, "{corrected}");
    let (_, question_views) = get(&app, &pickem, fan).await;
    let scorer = question_views
        .as_array()
        .unwrap()
        .iter()
        .find(|q| q["id"] == scorer_q.as_str())
        .unwrap();
    assert_eq!(scorer["my_answer"]["outcome"], "incorrect", "{scorer}");
    resolve_pending(a.store.as_ref() as &dyn AuthStore, 10)
        .await
        .unwrap();
    let (_, replayed) = get(&app, &format!("/tournaments/{tid}/leaderboard"), fan).await;
    assert_eq!(corrected, replayed);

    // Tournoi terminé : le Pick'em est fermé.
    let (status, error) = put(
        &app,
        &answer(winner_q),
        fan,
        json!({ "participant_id": ids[1] }),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(error["error"], "pickem_locked");
    let (status, _) = send(
        &app,
        TestRequest::patch(),
        &format!("{questions}/{winner_q}"),
        &a.admin,
        Some(json!({ "points": 50 })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(
        delete(&app, &format!("{questions}/{winner_q}"), &a.admin).await,
        StatusCode::CONFLICT
    );
}

#[actix_web::test]
async fn questions_are_editable_only_before_answers_open() {
    let store = Arc::new(MemoryStore::new());
    let app = app_with(store.clone(), Duration::from_secs(3600)).await;
    let a = arena(&app, store).await;
    let questions = format!("/tournaments/{}/pickem/questions", a.tournament);
    let (_, question) = post(
        &app,
        &questions,
        &a.admin,
        json!({ "kind": "tournament_winner", "opens_at": "2090-01-01T00:00:00Z", "locks_at": FUTURE }),
    )
    .await;
    let one = format!("{questions}/{}", id(&question));
    for body in [
        json!({ "points": 0 }),
        json!({ "locks_at": "2020-01-01T00:00:00Z" }),
    ] {
        let (status, _) = send(&app, TestRequest::patch(), &one, &a.admin, Some(body)).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
    }
    let (status, updated) = send(
        &app,
        TestRequest::patch(),
        &one,
        &a.admin,
        Some(json!({ "points": 50 })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{updated}");
    assert_eq!(updated["points"], 50);
    assert_eq!(delete(&app, &one, &a.admin).await, StatusCode::NO_CONTENT);
    assert_eq!(delete(&app, &one, &a.admin).await, StatusCode::NOT_FOUND);
}

#[actix_web::test]
async fn an_open_question_is_immutable_even_before_the_first_answer() {
    let store = Arc::new(MemoryStore::new());
    let app = app_with(store.clone(), Duration::from_secs(3600)).await;
    let a = arena(&app, store).await;
    let questions = format!("/tournaments/{}/pickem/questions", a.tournament);
    let (_, question) = post(
        &app,
        &questions,
        &a.admin,
        json!({"kind":"tournament_winner", "locks_at":FUTURE}),
    )
    .await;
    let one = format!("{questions}/{}", id(&question));
    let (status, _) = send(
        &app,
        TestRequest::patch(),
        &one,
        &a.admin,
        Some(json!({"points":50})),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(delete(&app, &one, &a.admin).await, StatusCode::CONFLICT);
}
