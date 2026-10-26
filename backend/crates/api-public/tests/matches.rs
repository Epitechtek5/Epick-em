//! Parcours HTTP des routes des matchs (création, résultats, points, propagation du vainqueur,
//! clôture automatique de l'étape), sur un store en mémoire.

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

struct Setup {
    admin: String,
    game: String,
    players: Vec<String>,
    kills: String,
    placement: String,
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

async fn put(app: &app_type!(), path: &str, token: &str, body: Value) -> (StatusCode, Value) {
    send(app, TestRequest::put(), path, token, Some(body)).await
}

async fn patch(app: &app_type!(), path: &str, token: &str, body: Value) -> (StatusCode, Value) {
    send(app, TestRequest::patch(), path, token, Some(body)).await
}

async fn get(app: &app_type!(), path: &str, token: &str) -> (StatusCode, Value) {
    send(app, TestRequest::get(), path, token, None).await
}

/// Un administrateur, quatre joueurs et un jeu doté des statistiques `kills`, `placement` et
/// `accuracy` (pourcentage).
async fn setup() -> (app_type!(), Setup) {
    let store = Arc::new(MemoryStore::new());
    let app = app_with(store.clone(), Duration::from_secs(3600)).await;
    logged_in_as(&app, "root", "secret123").await;
    store.set_role("root", Role::Admin);
    let (_, session) = login(&app, "root", "secret123").await;
    let admin = access(&session).to_string();
    let (_, game) = post(&app, "/games", &admin, json!({ "name": "TFT" })).await;
    let game = game["id"].as_str().unwrap().to_string();
    let mut stat_ids = Vec::new();
    for (name, key, kind) in [
        ("Kills", "kills", "flat"),
        ("Placement", "placement", "flat"),
        ("Précision", "accuracy", "percent"),
    ] {
        let (_, stat) = post(
            &app,
            "/stats",
            &admin,
            json!({ "name": name, "key": key, "type": kind }),
        )
        .await;
        let id = stat["id"].as_str().unwrap().to_string();
        let (status, _) = send(
            &app,
            TestRequest::put(),
            &format!("/games/{game}/stats/{id}"),
            &admin,
            None,
        )
        .await;
        assert_eq!(status, StatusCode::NO_CONTENT);
        stat_ids.push(id);
    }
    let mut players = Vec::new();
    for index in 0..4 {
        let session = logged_in_as(&app, &format!("player{index}"), "secret123").await;
        players.push(access(&session).to_string());
    }
    (
        app,
        Setup {
            admin,
            game,
            players,
            kills: stat_ids[0].clone(),
            placement: stat_ids[1].clone(),
        },
    )
}

/// Un tournoi de quatre joueurs à une seule étape, barème `kills` × 1,5 et `placement` en table.
/// Renvoie le tournoi, l'étape lancée, son groupe et ses quatre participants.
async fn running(
    app: &app_type!(),
    s: &Setup,
    format: &str,
    match_type: &str,
) -> (String, String, String, Vec<String>) {
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
            "max_participants": 4,
        }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{tournament}");
    let tid = tournament["id"].as_str().unwrap().to_string();
    let rules = format!("/tournaments/{tid}/scoring-rules");
    for body in [
        json!({ "stat_id": s.kills, "mode": "linear", "coefficient": 1.5 }),
        json!({ "stat_id": s.placement, "mode": "table",
                "points_table": { "1": 8, "2": 7, "3": 6, "4": 5 } }),
    ] {
        let (status, rule) = post(app, &rules, &s.admin, body).await;
        assert_eq!(status, StatusCode::CREATED, "{rule}");
    }
    let (status, step) = post(
        app,
        &format!("/tournaments/{tid}/steps"),
        &s.admin,
        json!({
            "position": 1, "format": format, "match_type": match_type, "group_count": 1,
            "group_size": 4, "matches_per_group": 1, "advance_per_group": 1,
        }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{step}");
    let step_id = step["id"].as_str().unwrap().to_string();
    for status in ["registration"] {
        post(
            app,
            &format!("/tournaments/{tid}/status"),
            &s.admin,
            json!({ "status": status }),
        )
        .await;
    }
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
    let (status, _) = post(
        app,
        &format!("/tournaments/{tid}/status"),
        &s.admin,
        json!({ "status": "ongoing" }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (status, started) = post(
        app,
        &format!("/tournaments/{tid}/steps/{step_id}/start"),
        &s.admin,
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{started}");
    let (_, ranking) = get(
        app,
        &format!("/tournaments/{tid}/steps/{step_id}/ranking"),
        &s.admin,
    )
    .await;
    let group = ranking[0]["group_id"].as_str().unwrap().to_string();
    let participants = ranking[0]["participants"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p["participant_id"].as_str().unwrap().to_string())
        .collect();
    (tid, step_id, group, participants)
}

fn id(value: &Value) -> String {
    value["id"].as_str().unwrap().to_string()
}

fn participant<'a>(detail: &'a Value, participant_id: &str) -> &'a Value {
    detail["participants"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["participant_id"] == participant_id)
        .unwrap()
}

#[actix_web::test]
async fn every_route_requires_a_token() {
    let (app, _) = setup().await;
    let (a, b, c) = (Uuid::new_v4(), Uuid::new_v4(), Uuid::new_v4());
    let base = format!("/tournaments/{a}/steps/{b}/matches");
    let requests = [
        (TestRequest::get(), base.clone()),
        (TestRequest::post(), base.clone()),
        (TestRequest::get(), format!("{base}/{c}")),
        (TestRequest::patch(), format!("{base}/{c}")),
        (TestRequest::delete(), format!("{base}/{c}")),
        (TestRequest::put(), format!("{base}/{c}/results")),
        (TestRequest::post(), format!("{base}/{c}/status")),
    ];
    for (method, path) in requests {
        let (status, _) = call(&app, request(method, &path, None)).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED, "{path}");
    }
}

#[actix_web::test]
async fn results_give_points_and_the_last_match_closes_the_step() {
    let (app, s) = setup().await;
    let (tid, step, group, ids) = running(&app, &s, "pool", "ffa").await;
    let base = format!("/tournaments/{tid}/steps/{step}/matches");

    // Un joueur consulte mais ne modifie rien.
    let (status, list) = get(&app, &base, &s.players[0]).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(list, json!([]));
    let (status, _) = post(&app, &base, &s.players[0], json!({ "group_id": group })).await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    // Réglages invalides, champ par champ.
    let stranger = Uuid::new_v4().to_string();
    let cases = [
        (json!({ "group_id": stranger }), "group_id"),
        (json!({ "group_id": group, "round": 0 }), "round"),
        (
            json!({ "group_id": group, "scheduled_at": "demain" }),
            "scheduled_at",
        ),
        (
            json!({ "group_id": group, "bracket": "winners" }),
            "bracket",
        ),
        (
            json!({ "group_id": group, "next_match_id": Uuid::new_v4() }),
            "next_match_id",
        ),
        (
            json!({ "group_id": group, "participant_ids": [stranger] }),
            "participant_ids",
        ),
        (
            json!({ "group_id": group, "participant_ids": [ids[0], ids[0]] }),
            "participant_ids",
        ),
    ];
    for (body, field) in cases {
        let (status, error) = post(&app, &base, &s.admin, body.clone()).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
        assert!(error["errors"][field].is_string(), "{field}: {error}");
    }

    let (status, created) = post(
        &app,
        &base,
        &s.admin,
        json!({ "group_id": group, "round": 1, "scheduled_at": "2026-11-14T18:00:00Z",
                "participant_ids": ids }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    let mid = id(&created);
    let one = format!("{base}/{mid}");
    assert_eq!(created["status"], "scheduled");
    assert_eq!(created["group_id"], group);
    assert_eq!(created["participants"].as_array().unwrap().len(), 4);
    assert_eq!(created["participants"][0]["stats"], json!({}));

    // Un match en trop se supprime tant qu'il n'est pas terminé.
    let (_, spare) = post(&app, &base, &s.admin, json!({ "group_id": group })).await;
    let (status, _) = send(
        &app,
        TestRequest::delete(),
        &format!("{base}/{}", id(&spare)),
        &s.admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (status, _) = get(&app, &format!("{base}/{}", id(&spare)), &s.admin).await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    // Sans résultat, le match ne se termine pas.
    let status_path = format!("{one}/status");
    let (status, error) = post(
        &app,
        &status_path,
        &s.admin,
        json!({ "status": "finished" }),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{error}");
    assert!(error["errors"]["results"].is_string());

    // Statistiques invalides.
    let results = format!("{one}/results");
    for stats in [
        json!({ "deaths": 3 }),
        json!({ "kills": "beaucoup" }),
        json!({ "accuracy": 140 }),
        json!([1]),
    ] {
        let (status, _) = put(
            &app,
            &results,
            &s.admin,
            json!({ "results": [{ "participant_id": ids[0], "stats": stats }] }),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{stats}");
    }
    for entry in [
        json!({ "participant_id": stranger, "stats": {} }),
        json!({ "participant_id": ids[0], "stats": {}, "rank": 5 }),
    ] {
        let (status, _) = put(&app, &results, &s.admin, json!({ "results": [entry] })).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{entry}");
    }
    let (status, _) = put(&app, &results, &s.admin, json!({ "results": [] })).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    // Les points viennent du barème : kills × 1,5 plus la table de placement.
    let team_detail = json!({
        "total": { "kills": 0, "placement": 4 },
        "players": { Uuid::new_v4().to_string(): { "kills": 0 } },
    });
    let (status, saved) = put(
        &app,
        &results,
        &s.admin,
        json!({ "results": [
            { "participant_id": ids[0], "stats": { "kills": 6, "placement": 1 } },
            { "participant_id": ids[1], "stats": { "kills": 4, "placement": 2, "accuracy": 55.5 } },
            { "participant_id": ids[2], "stats": { "kills": 2, "placement": 3 } },
            { "participant_id": ids[3], "stats": team_detail },
        ] }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{saved}");
    let points: Vec<f64> = ids
        .iter()
        .map(|p| participant(&saved, p)["points"].as_f64().unwrap())
        .collect();
    assert_eq!(points, [17.0, 13.0, 9.0, 5.0]);
    assert_eq!(participant(&saved, &ids[3])["stats"], team_detail);

    // Cycle de vie : lancé une fois, modifiable sauf ses participants.
    let (status, started) =
        post(&app, &status_path, &s.admin, json!({ "status": "ongoing" })).await;
    assert_eq!(status, StatusCode::OK, "{started}");
    assert_eq!(started["status"], "ongoing");
    assert!(started["started_at"].is_string());
    assert_eq!(started["step_closed"], Value::Null);
    let (status, _) = post(&app, &status_path, &s.admin, json!({ "status": "ongoing" })).await;
    assert_eq!(status, StatusCode::CONFLICT);
    let (status, _) = post(
        &app,
        &status_path,
        &s.admin,
        json!({ "status": "scheduled" }),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    let (status, updated) = patch(&app, &one, &s.admin, json!({ "round": 2 })).await;
    assert_eq!(status, StatusCode::OK, "{updated}");
    assert_eq!(updated["round"], 2);
    let (status, cleared) = patch(&app, &one, &s.admin, json!({ "round": null })).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(cleared["round"], Value::Null);
    let (status, _) = patch(
        &app,
        &one,
        &s.admin,
        json!({ "participant_ids": [ids[0], ids[1]] }),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);

    // Le dernier match de l'étape la clôture : classement par points, un seul qualifié.
    let (status, done) = post(
        &app,
        &status_path,
        &s.admin,
        json!({ "status": "finished" }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{done}");
    assert_eq!(done["status"], "finished");
    assert!(done["ended_at"].is_string());
    let ranks: Vec<i64> = ids
        .iter()
        .map(|p| participant(&done, p)["rank"].as_i64().unwrap())
        .collect();
    assert_eq!(ranks, [1, 2, 3, 4]);
    let results_by_rank: Vec<&str> = ids
        .iter()
        .map(|p| participant(&done, p)["result"].as_str().unwrap())
        .collect();
    assert_eq!(results_by_rank, ["win", "loss", "loss", "loss"]);
    assert_eq!(done["step_closed"]["step"]["status"], "finished");
    let (_, ranking) = get(
        &app,
        &format!("/tournaments/{tid}/steps/{step}/ranking"),
        &s.admin,
    )
    .await;
    let ranked: Vec<(f64, i64, &str)> = ranking[0]["participants"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| {
            (
                p["points"].as_f64().unwrap(),
                p["rank"].as_i64().unwrap(),
                p["status"].as_str().unwrap(),
            )
        })
        .collect();
    assert_eq!(
        ranked,
        [
            (17.0, 1, "qualified"),
            (13.0, 2, "eliminated"),
            (9.0, 3, "eliminated"),
            (5.0, 4, "eliminated"),
        ]
    );

    // Terminé, le match et l'étape sont figés.
    let (status, _) = put(
        &app,
        &results,
        &s.admin,
        json!({ "results": [{ "participant_id": ids[0], "stats": {} }] }),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    let (status, _) = post(
        &app,
        &status_path,
        &s.admin,
        json!({ "status": "cancelled" }),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    let (status, _) = send(&app, TestRequest::delete(), &one, &s.admin, None).await;
    assert_eq!(status, StatusCode::CONFLICT);
    let (status, error) = post(&app, &base, &s.admin, json!({ "group_id": group })).await;
    assert_eq!(status, StatusCode::CONFLICT, "{error}");
    let (_, listed) = get(&app, &format!("{base}?status=finished"), &s.players[1]).await;
    assert_eq!(listed.as_array().unwrap().len(), 1);
    let (_, none) = get(&app, &format!("{base}?status=ongoing"), &s.players[1]).await;
    assert_eq!(none, json!([]));
    let (status, _) = get(&app, &format!("{base}/{}", Uuid::new_v4()), &s.admin).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[actix_web::test]
async fn the_winner_moves_on_in_an_elimination_bracket() {
    let (app, s) = setup().await;
    let (tid, step, group, ids) = running(&app, &s, "single_elim", "duel").await;
    let base = format!("/tournaments/{tid}/steps/{step}/matches");

    // Un duel n'a que deux participants.
    let (status, error) = post(
        &app,
        &base,
        &s.admin,
        json!({ "group_id": group, "participant_ids": [ids[0], ids[1], ids[2]] }),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(error["errors"]["participant_ids"].is_string(), "{error}");

    let (status, last) = post(
        &app,
        &base,
        &s.admin,
        json!({ "group_id": group, "round": 2 }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{last}");
    let last = id(&last);
    let mut semis = Vec::new();
    for pair in [[&ids[0], &ids[1]], [&ids[2], &ids[3]]] {
        let (status, semi) = post(
            &app,
            &base,
            &s.admin,
            json!({ "group_id": group, "round": 1, "next_match_id": last,
                    "participant_ids": pair }),
        )
        .await;
        assert_eq!(status, StatusCode::CREATED, "{semi}");
        semis.push(id(&semi));
    }

    // Pas de boucle dans le tableau.
    for next in [semis[0].clone(), last.clone()] {
        let (status, error) = patch(
            &app,
            &format!("{base}/{last}"),
            &s.admin,
            json!({ "next_match_id": next }),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{error}");
        assert!(error["errors"]["next_match_id"].is_string());
    }
    let (status, _) = patch(
        &app,
        &format!("{base}/{}", semis[0]),
        &s.admin,
        json!({ "next_match_id": semis[1] }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "une chaîne reste valide");
    patch(
        &app,
        &format!("{base}/{}", semis[0]),
        &s.admin,
        json!({ "next_match_id": last }),
    )
    .await;

    // La finale attend ses deux participants.
    let (status, error) = post(
        &app,
        &format!("{base}/{last}/status"),
        &s.admin,
        json!({ "status": "ongoing" }),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{error}");

    let finish = |semi: String, winner_kills: u32, loser_kills: u32, pair: [String; 2]| {
        let (app, admin, base) = (&app, s.admin.clone(), base.clone());
        async move {
            let (status, saved) = put(
                app,
                &format!("{base}/{semi}/results"),
                &admin,
                json!({ "results": [
                    { "participant_id": pair[0], "stats": { "kills": winner_kills } },
                    { "participant_id": pair[1], "stats": { "kills": loser_kills } },
                ] }),
            )
            .await;
            assert_eq!(status, StatusCode::OK, "{saved}");
            post(
                app,
                &format!("{base}/{semi}/status"),
                &admin,
                json!({ "status": "finished" }),
            )
            .await
        }
    };

    // Une égalité sans vainqueur ne se propage pas.
    let (status, error) = finish(semis[1].clone(), 2, 2, [ids[2].clone(), ids[3].clone()]).await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{error}");

    let (status, done) = finish(semis[0].clone(), 3, 1, [ids[0].clone(), ids[1].clone()]).await;
    assert_eq!(status, StatusCode::OK, "{done}");
    assert_eq!(
        done["step_closed"],
        Value::Null,
        "il reste des matchs à jouer"
    );
    let (_, waiting) = get(&app, &format!("{base}/{last}"), &s.admin).await;
    let in_final: Vec<&str> = waiting["participants"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p["participant_id"].as_str().unwrap())
        .collect();
    assert_eq!(in_final, [ids[0].as_str()]);
    let (status, _) = post(
        &app,
        &format!("{base}/{}/status", semis[0]),
        &s.admin,
        json!({ "status": "finished" }),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "déjà terminé");

    let (status, done) = finish(semis[1].clone(), 5, 2, [ids[3].clone(), ids[2].clone()]).await;
    assert_eq!(status, StatusCode::OK, "{done}");
    let (_, ready) = get(&app, &format!("{base}/{last}"), &s.admin).await;
    assert_eq!(ready["participants"].as_array().unwrap().len(), 2);

    // La finale terminée clôture l'étape ; le total d'un finaliste cumule ses matchs.
    let (status, _) = post(
        &app,
        &format!("{base}/{last}/status"),
        &s.admin,
        json!({ "status": "ongoing" }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (status, _) = put(
        &app,
        &format!("{base}/{last}/results"),
        &s.admin,
        json!({ "results": [
            { "participant_id": ids[0], "stats": { "kills": 4 } },
            { "participant_id": ids[3], "stats": { "kills": 1 } },
        ] }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (status, closed) = post(
        &app,
        &format!("{base}/{last}/status"),
        &s.admin,
        json!({ "status": "finished" }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{closed}");
    assert_eq!(closed["step_closed"]["step"]["status"], "finished");
    let (_, ranking) = get(
        &app,
        &format!("/tournaments/{tid}/steps/{step}/ranking"),
        &s.admin,
    )
    .await;
    let champion = &ranking[0]["participants"][0];
    // 3 × 1,5 en demi-finale puis 4 × 1,5 en finale.
    assert_eq!(champion["participant_id"], ids[0]);
    assert_eq!(champion["points"], 10.5);
    assert_eq!(champion["status"], "qualified");
}

#[actix_web::test]
async fn a_cancelled_match_is_closed_for_good() {
    let (app, s) = setup().await;
    let (tid, step, group, ids) = running(&app, &s, "pool", "duel").await;
    let base = format!("/tournaments/{tid}/steps/{step}/matches");
    let (_, created) = post(
        &app,
        &base,
        &s.admin,
        json!({ "group_id": group, "participant_ids": [ids[0], ids[1]] }),
    )
    .await;
    let one = format!("{base}/{}", id(&created));
    let (status, cancelled) = post(
        &app,
        &format!("{one}/status"),
        &s.admin,
        json!({ "status": "cancelled" }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{cancelled}");
    assert_eq!(cancelled["status"], "cancelled");
    assert!(cancelled["ended_at"].is_string());
    for status_body in ["ongoing", "finished", "cancelled"] {
        let (status, _) = post(
            &app,
            &format!("{one}/status"),
            &s.admin,
            json!({ "status": status_body }),
        )
        .await;
        assert_eq!(status, StatusCode::CONFLICT, "{status_body}");
    }
    let (status, _) = patch(&app, &one, &s.admin, json!({ "round": 3 })).await;
    assert_eq!(status, StatusCode::CONFLICT);
    // Annulé sans match terminé, le groupe n'est pas joué : l'étape reste ouverte.
    let (_, step_after) = get(&app, &format!("/tournaments/{tid}/steps/{step}"), &s.admin).await;
    assert_eq!(step_after["status"], "ongoing");
    let (status, _) = send(&app, TestRequest::delete(), &one, &s.admin, None).await;
    assert_eq!(status, StatusCode::NO_CONTENT);
}

async fn export_file(app: &app_type!(), token: &str, format: &str) -> String {
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
    assert_eq!(response.status(), StatusCode::OK);
    String::from_utf8(actix_web::test::read_body(response).await.to_vec()).unwrap()
}

async fn import_file(
    app: &app_type!(),
    token: &str,
    format: &str,
    body: String,
) -> (StatusCode, Value) {
    call(
        app,
        request(
            TestRequest::post(),
            &format!("/tournaments/import?format={format}"),
            Some(token),
        )
        .set_payload(body),
    )
    .await
}

fn tournament_named<'a>(document: &'a Value, name: &str) -> &'a Value {
    document["tournaments"]
        .as_array()
        .unwrap()
        .iter()
        .find(|t| t["name"] == name)
        .unwrap_or_else(|| panic!("tournoi {name} absent de {document}"))
}

/// Un tableau d'élimination à mi-parcours : première demi-finale terminée, seconde en cours avec
/// ses statistiques, finale annoncée avec son premier finaliste.
async fn halfway(app: &app_type!(), s: &Setup) -> (String, Vec<String>) {
    let (tid, step, group, ids) = running(app, s, "single_elim", "duel").await;
    let base = format!("/tournaments/{tid}/steps/{step}/matches");
    let (_, last) = post(
        app,
        &base,
        &s.admin,
        json!({ "group_id": group, "round": 2, "scheduled_at": "2026-11-15T18:00:00Z" }),
    )
    .await;
    let last = id(&last);
    let mut semis = Vec::new();
    for pair in [[&ids[0], &ids[1]], [&ids[2], &ids[3]]] {
        let (_, semi) = post(
            app,
            &base,
            &s.admin,
            json!({ "group_id": group, "round": 1, "next_match_id": last,
                    "scheduled_at": "2026-11-14T18:00:00Z", "participant_ids": pair }),
        )
        .await;
        semis.push(id(&semi));
    }
    put(
        app,
        &format!("{base}/{}/results", semis[0]),
        &s.admin,
        json!({ "results": [
            { "participant_id": ids[0], "stats": { "kills": 3, "accuracy": 62.5 } },
            { "participant_id": ids[1], "stats": { "kills": 1 } },
        ] }),
    )
    .await;
    let (status, _) = post(
        app,
        &format!("{base}/{}/status", semis[0]),
        &s.admin,
        json!({ "status": "finished" }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    put(
        app,
        &format!("{base}/{}/results", semis[1]),
        &s.admin,
        json!({ "results": [{ "participant_id": ids[2], "stats": { "kills": 2 } }] }),
    )
    .await;
    post(
        app,
        &format!("{base}/{}/status", semis[1]),
        &s.admin,
        json!({ "status": "ongoing" }),
    )
    .await;
    (tid, ids)
}

#[actix_web::test]
async fn exported_matches_reimport_without_loss_in_json_and_csv() {
    let (app, s) = setup().await;
    let (tid, _) = halfway(&app, &s).await;
    let (_, tournament) = get(&app, &format!("/tournaments/{tid}"), &s.admin).await;
    let name = tournament["name"].as_str().unwrap().to_string();

    let original =
        serde_json::from_str::<Value>(&export_file(&app, &s.admin, "json").await).unwrap();
    let steps = tournament_named(&original, &name)["steps"].clone();
    let matches = steps[0]["matches"].clone();
    assert_eq!(tournament_named(&original, &name)["matches"], json!([]));
    assert_eq!(matches.as_array().unwrap().len(), 3);
    // Les demi-finales d'abord (tour 1), la finale à la fin ; `next` désigne la finale.
    assert_eq!(matches[0]["round"], 1);
    assert_eq!(matches[0]["status"], "finished");
    assert_eq!(matches[0]["next"], 2);
    assert_eq!(matches[0]["group"], 1);
    assert_eq!(matches[1]["status"], "ongoing");
    assert_eq!(matches[2]["round"], 2);
    assert_eq!(matches[2]["next"], Value::Null);
    let winner = &matches[0]["participants"][0];
    assert!(winner["user"].as_str().unwrap().starts_with("player"));
    assert_eq!(winner["stats"], json!({ "kills": 3, "accuracy": 62.5 }));
    assert_eq!(winner["points"], 4.5);
    assert_eq!(winner["rank"], 1);
    assert_eq!(winner["result"], "win");
    // Le vainqueur attend en finale, sans statistiques.
    assert_eq!(matches[2]["participants"].as_array().unwrap().len(), 1);
    assert_eq!(matches[2]["participants"][0]["stats"], json!({}));

    // Réimport sous un autre nom, en JSON puis en CSV : mêmes étapes, mêmes matchs.
    for format in ["json", "csv"] {
        let copy = format!("Copie {format}");
        let file = if format == "json" {
            let mut document = original.clone();
            let mut one = tournament_named(&original, &name).clone();
            one["name"] = json!(copy);
            document["tournaments"] = json!([one]);
            document.to_string()
        } else {
            let csv = export_file(&app, &s.admin, "csv").await;
            let mut reader = csv::Reader::from_reader(csv.as_bytes());
            let mut writer = csv::Writer::from_writer(Vec::new());
            writer.write_record(reader.headers().unwrap()).unwrap();
            for record in reader.records().map(Result::unwrap) {
                if &record[1] == name.as_str() {
                    let renamed: Vec<&str> = record
                        .iter()
                        .enumerate()
                        .map(|(i, field)| if i == 1 { copy.as_str() } else { field })
                        .collect();
                    writer.write_record(renamed).unwrap();
                }
            }
            String::from_utf8(writer.into_inner().unwrap()).unwrap()
        };
        let (status, report) = import_file(&app, &s.admin, format, file).await;
        assert_eq!(status, StatusCode::OK, "{format}: {report}");
        assert_eq!(report["created"], 1, "{report}");
        let after =
            serde_json::from_str::<Value>(&export_file(&app, &s.admin, "json").await).unwrap();
        assert_eq!(tournament_named(&after, &copy)["steps"], steps, "{format}");
    }

    // La copie est de vrais matchs : lisibles par l'API, liés entre eux, et qui se terminent.
    let (_, list) = get(&app, "/tournaments", &s.admin).await;
    let copy_id = list
        .as_array()
        .unwrap()
        .iter()
        .find(|t| t["name"] == "Copie json")
        .map(id)
        .unwrap();
    let (_, copied) = get(&app, &format!("/tournaments/{copy_id}/steps"), &s.admin).await;
    let step = id(&copied[0]);
    let base = format!("/tournaments/{copy_id}/steps/{step}/matches");
    let (status, imported) = get(&app, &base, &s.admin).await;
    assert_eq!(status, StatusCode::OK);
    let imported = imported.as_array().unwrap();
    assert_eq!(imported.len(), 3);
    assert_eq!(imported[0]["next_match_id"], imported[2]["id"]);
    assert_eq!(imported[0]["status"], "finished");
    assert_eq!(imported[0]["participants"][0]["points"], 4.5);
    let (_, ranking) = get(
        &app,
        &format!("/tournaments/{copy_id}/steps/{step}/ranking"),
        &s.admin,
    )
    .await;
    assert_eq!(ranking[0]["participants"].as_array().unwrap().len(), 4);
    let (status, done) = post(
        &app,
        &format!("{base}/{}/status", imported[1]["id"].as_str().unwrap()),
        &s.admin,
        json!({ "status": "finished" }),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::BAD_REQUEST,
        "{done}: un seul participant a des résultats"
    );
}

#[actix_web::test]
async fn match_files_are_validated_before_any_write() {
    let (app, s) = setup().await;
    let (tid, _) = halfway(&app, &s).await;
    let (_, tournament) = get(&app, &format!("/tournaments/{tid}"), &s.admin).await;
    let name = tournament["name"].as_str().unwrap().to_string();
    let original =
        serde_json::from_str::<Value>(&export_file(&app, &s.admin, "json").await).unwrap();
    let valid = tournament_named(&original, &name).clone();

    let with_matches = |matches: Value| {
        let mut one = valid.clone();
        one["name"] = json!("Invalide");
        one["steps"][0]["matches"] = matches;
        json!({ "version": 1, "tournaments": [one] }).to_string()
    };
    let cases = [
        (
            "participant hors du tournoi",
            json!([{ "group": 1, "participants": [{ "user": "inconnu" }] }]),
            "n'est pas dans ce groupe",
        ),
        (
            "statistique inconnue",
            json!([{ "group": 1, "participants": [{ "user": "player0", "stats": { "deaths": 1 } }] }]),
            "stats",
        ),
        ("groupe absent", json!([{ "group": 4 }]), "group"),
        (
            "boucle",
            json!([{ "group": 1, "next": 1 }, { "group": 1, "next": 0 }]),
            "boucle",
        ),
        (
            "match terminé sans résultat",
            json!([{ "group": 1, "status": "finished", "participants": [
                { "user": "player0" }, { "user": "player1" },
            ] }]),
            "Ni statistiques ni rang",
        ),
        (
            "clé inconnue",
            json!([{ "group": 1, "winner": "player0" }]),
            "invalide",
        ),
    ];
    for (label, matches, expected) in cases {
        let (status, error) = import_file(&app, &s.admin, "json", with_matches(matches)).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{label}: {error}");
        let message = error["errors"]["file"].as_str().unwrap();
        assert!(message.contains(expected), "{label}: {message}");
    }
    // Rien n'a été écrit.
    let (_, list) = get(&app, "/tournaments", &s.admin).await;
    assert!(
        list.as_array()
            .unwrap()
            .iter()
            .all(|t| t["name"] != "Invalide")
    );

    // Les matchs ne se déclarent pas au niveau du tournoi.
    let mut one = valid.clone();
    one["name"] = json!("Hors étape");
    one["matches"] = json!([{ "group": 1 }]);
    let (status, error) = import_file(
        &app,
        &s.admin,
        "json",
        json!({ "version": 1, "tournaments": [one] }).to_string(),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{error}");
    assert!(
        error["errors"]["file"]
            .as_str()
            .unwrap()
            .contains("steps[].matches")
    );
}
