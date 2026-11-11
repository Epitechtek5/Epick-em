//! Parcours HTTP des statistiques à choix et des parties de match (BO1, BO3, BO5, agrégation,
//! propagation du vainqueur, import et export), sur un store en mémoire.

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
    character: String,
    map: String,
    mvp: String,
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
    // Statistiques à choix : un personnage par participant, une carte et un MVP par partie.
    let mut extra = Vec::new();
    for (name, key, kind, scope) in [
        ("Personnage", "character", "select", "participant"),
        ("Carte", "map", "select", "match"),
        ("MVP", "mvp", "mvp", "match"),
    ] {
        let (status, stat) = post(
            &app,
            "/stats",
            &admin,
            json!({ "name": name, "key": key, "type": kind, "scope": scope }),
        )
        .await;
        assert_eq!(status, StatusCode::CREATED, "{stat}");
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
        extra.push(id);
    }
    for (stat, options) in [
        (&extra[0], json!([["jett", "Jett"], ["omen", "Omen"]])),
        (&extra[1], json!([["ascent", "Ascent"], ["bind", "Bind"]])),
    ] {
        let options: Vec<Value> = options
            .as_array()
            .unwrap()
            .iter()
            .map(|o| json!({ "key": o[0], "label": o[1] }))
            .collect();
        let (status, saved) = put(
            &app,
            &format!("/games/{game}/stats/{stat}/options"),
            &admin,
            json!({ "options": options }),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{saved}");
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
            character: extra[0].clone(),
            map: extra[1].clone(),
            mvp: extra[2].clone(),
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

fn id(value: &Value) -> String {
    value["id"].as_str().unwrap().to_string()
}

struct Series {
    tid: String,
    step: String,
    group: String,
    ids: Vec<String>,
}

impl Series {
    fn matches(&self) -> String {
        format!("/tournaments/{}/steps/{}/matches", self.tid, self.step)
    }
}

async fn series(app: &app_type!(), s: &Setup, format: &str) -> Series {
    let (tid, step, group, ids) = running(app, s, format, "duel").await;
    Series {
        tid,
        step,
        group,
        ids,
    }
}

async fn new_match(app: &app_type!(), s: &Setup, series: &Series, best_of: i32) -> String {
    let (status, created) = post(
        app,
        &series.matches(),
        &s.admin,
        json!({ "group_id": series.group, "round": 1, "best_of": best_of,
                "participant_ids": [series.ids[0], series.ids[1]] }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    assert_eq!(created["best_of"], best_of);
    assert_eq!(created["games"], json!([]));
    id(&created)
}

/// Ouvre une partie, la remplit (le premier participant gagne aux points) et la termine.
async fn play(
    app: &app_type!(),
    s: &Setup,
    series: &Series,
    match_id: &str,
    winner: usize,
) -> (StatusCode, Value) {
    let games = format!("{}/{match_id}/games", series.matches());
    let (status, game) = post(
        app,
        &games,
        &s.admin,
        json!({ "attributes": { "map": "ascent" } }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{game}");
    let number = game["number"].as_i64().unwrap();
    let (winner_id, loser_id) = (&series.ids[winner], &series.ids[1 - winner]);
    let (status, saved) = put(
        app,
        &format!("{games}/{number}/results"),
        &s.admin,
        json!({
            "attributes": { "map": "bind", "mvp": winner_id },
            "results": [
                { "participant_id": winner_id, "stats": { "kills": 4, "accuracy": 80, "character": "jett" } },
                { "participant_id": loser_id, "stats": { "kills": 1, "accuracy": 40, "character": "omen" } },
            ],
        }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{saved}");
    post(
        app,
        &format!("{games}/{number}/finish"),
        &s.admin,
        json!({}),
    )
    .await
}

fn of<'a>(participants: &'a Value, participant_id: &str) -> &'a Value {
    participants
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["participant_id"] == participant_id)
        .unwrap()
}

#[actix_web::test]
async fn every_game_route_requires_a_token() {
    let (app, _) = setup().await;
    let (a, b, c) = (Uuid::new_v4(), Uuid::new_v4(), Uuid::new_v4());
    let base = format!("/tournaments/{a}/steps/{b}/matches/{c}/games");
    let requests = [
        (TestRequest::get(), base.clone()),
        (TestRequest::post(), base.clone()),
        (TestRequest::get(), format!("{base}/1")),
        (TestRequest::delete(), format!("{base}/1")),
        (TestRequest::put(), format!("{base}/1/results")),
        (TestRequest::post(), format!("{base}/1/finish")),
        (TestRequest::get(), format!("/games/{a}/stats/{b}/options")),
        (TestRequest::put(), format!("/games/{a}/stats/{b}/options")),
    ];
    for (method, path) in requests {
        let (status, _) = call(&app, request(method, &path, None)).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED, "{path}");
    }
}

#[actix_web::test]
async fn selection_stats_have_a_scope_and_options_per_game() {
    let (app, s) = setup().await;
    // Portée incohérente avec le type.
    for body in [
        json!({ "name": "A", "key": "a", "type": "flat", "scope": "match" }),
        json!({ "name": "B", "key": "b", "type": "mvp", "scope": "participant" }),
        json!({ "name": "C", "key": "c", "type": "inconnu" }),
    ] {
        let (status, _) = post(&app, "/stats", &s.admin, body.clone()).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    }
    // Par défaut : participant, sauf le MVP.
    let (_, flat) = post(
        &app,
        "/stats",
        &s.admin,
        json!({ "name": "Assists", "key": "assists", "type": "flat" }),
    )
    .await;
    assert_eq!(flat["scope"], "participant");
    assert!(flat.get("options").is_none());
    let (_, best) = get(&app, &format!("/stats/{}", s.mvp), &s.admin).await;
    assert_eq!(
        (best["type"].as_str(), best["scope"].as_str()),
        (Some("mvp"), Some("match"))
    );

    // Un statistique numérique ne devient pas un choix, ni l'inverse ; la portée d'un choix change.
    let flat_id = id(&flat);
    let (status, _) = patch(
        &app,
        &format!("/stats/{flat_id}"),
        &s.admin,
        json!({ "type": "select" }),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, changed) = patch(
        &app,
        &format!("/stats/{}", s.character),
        &s.admin,
        json!({ "scope": "match" }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{changed}");
    assert_eq!(changed["scope"], "match");
    patch(
        &app,
        &format!("/stats/{}", s.character),
        &s.admin,
        json!({ "scope": "participant" }),
    )
    .await;

    // Les options d'un jeu, dans l'ordre ; clés stables, sans doublon.
    let options = format!("/games/{}/stats/{}/options", s.game, s.character);
    let (status, listed) = get(&app, &options, &s.players[0]).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        listed,
        json!([{ "key": "jett", "label": "Jett" }, { "key": "omen", "label": "Omen" }])
    );
    let (_, with_options) = get(&app, &format!("/games/{}/stats", s.game), &s.admin).await;
    let character = with_options
        .as_array()
        .unwrap()
        .iter()
        .find(|stat| stat["key"] == "character")
        .unwrap();
    assert_eq!(character["options"], listed);
    for bad in [
        json!({ "options": [{ "key": "Jett", "label": "Jett" }] }),
        json!({ "options": [{ "key": "a", "label": "A" }, { "key": "a", "label": "B" }] }),
        json!({ "options": [{ "key": "a", "label": " " }] }),
    ] {
        let (status, _) = put(&app, &options, &s.admin, bad.clone()).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{bad}");
    }
    let (status, _) = put(&app, &options, &s.players[0], json!({ "options": [] })).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    // Seul un choix a des options, et il doit être lié au jeu.
    let (status, _) = put(
        &app,
        &format!("/games/{}/stats/{}/options", s.game, s.kills),
        &s.admin,
        json!({ "options": [] }),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, _) = put(
        &app,
        &format!("/games/{}/stats/{flat_id}/options", s.game),
        &s.admin,
        json!({ "options": [] }),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    // Délier la statistique du jeu retire ses options.
    let (status, _) = send(
        &app,
        TestRequest::delete(),
        &format!("/games/{}/stats/{}", s.game, s.character),
        &s.admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (status, _) = get(&app, &options, &s.admin).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[actix_web::test]
async fn only_numeric_stats_enter_a_scoring_rule() {
    let (app, s) = setup().await;
    let (_, tournament) = post(
        &app,
        "/tournaments",
        &s.admin,
        json!({ "game_id": s.game, "name": "Barème", "start_date": "2026-11-14T18:00:00Z",
                "end_date": "2026-11-15T18:00:00Z", "participant_type": "solo",
                "max_participants": 4 }),
    )
    .await;
    for stat in [&s.character, &s.map, &s.mvp] {
        let (status, error) = post(
            &app,
            &format!("/tournaments/{}/scoring-rules", id(&tournament)),
            &s.admin,
            json!({ "stat_id": stat, "mode": "linear", "coefficient": 1 }),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{error}");
        assert!(error["errors"]["stat_id"].is_string(), "{error}");
    }
}

#[actix_web::test]
async fn a_best_of_three_ends_early_and_aggregates_the_games() {
    let (app, s) = setup().await;
    let series = series(&app, &s, "pool").await;
    let match_id = new_match(&app, &s, &series, 3).await;
    let one = format!("{}/{match_id}", series.matches());
    let games = format!("{one}/games");

    // La série se joue en parties : pas de saisie ni de clôture directes.
    let (status, error) = put(
        &app,
        &format!("{one}/results"),
        &s.admin,
        json!({ "results": [{ "participant_id": series.ids[0], "stats": { "kills": 1 } }] }),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{error}");
    let (status, _) = post(
        &app,
        &format!("{one}/status"),
        &s.admin,
        json!({ "status": "finished" }),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    for best_of in [0, 2, 7] {
        let (status, _) = patch(&app, &one, &s.admin, json!({ "best_of": best_of })).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{best_of}");
    }

    // Attributs invalides : option inconnue, attribut de participant, MVP étranger au match.
    let stranger = Uuid::new_v4().to_string();
    for attributes in [
        json!({ "map": "nowhere" }),
        json!({ "map": 3 }),
        json!({ "character": "jett" }),
        json!({ "mvp": stranger }),
        json!({ "mvp": "pas-un-uuid" }),
        json!([]),
    ] {
        let (status, _) = post(&app, &games, &s.admin, json!({ "attributes": attributes })).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{attributes}");
    }
    let (status, _) = post(&app, &games, &s.players[0], json!({})).await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    // Partie 1 : ouverte, résultats invalides refusés, puis valides.
    let (status, game) = post(
        &app,
        &games,
        &s.admin,
        json!({ "attributes": { "map": "ascent" } }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{game}");
    assert_eq!(
        (game["number"].as_i64(), game["status"].as_str()),
        (Some(1), Some("ongoing"))
    );
    assert_eq!(game["participants"].as_array().unwrap().len(), 2);
    let (_, current) = get(&app, &one, &s.admin).await;
    assert_eq!(current["status"], "ongoing");
    // Une seule partie ouverte à la fois.
    let (status, _) = post(&app, &games, &s.admin, json!({})).await;
    assert_eq!(status, StatusCode::CONFLICT);
    let results = format!("{games}/1/results");
    for (body, field) in [
        (
            json!({ "results": [{ "participant_id": series.ids[2], "stats": {} }] }),
            "results",
        ),
        (
            json!({ "results": [{ "participant_id": series.ids[0], "stats": { "character": "sage" } }] }),
            "results",
        ),
        (
            json!({ "results": [{ "participant_id": series.ids[0], "stats": { "map": "bind" } }] }),
            "results",
        ),
        (
            json!({ "results": [{ "participant_id": series.ids[0], "stats": { "kills": "7" } }] }),
            "results",
        ),
        (
            json!({ "results": [{ "participant_id": series.ids[0], "stats": {}, "rank": 3 }] }),
            "results",
        ),
        (json!({ "attributes": { "map": "nowhere" } }), "attributes"),
        (json!({}), "results"),
    ] {
        let (status, error) = put(&app, &results, &s.admin, body.clone()).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
        assert!(error["errors"][field].is_string(), "{body}: {error}");
    }
    let (status, _) = post(&app, &format!("{games}/1/finish"), &s.admin, json!({})).await;
    assert_eq!(
        status,
        StatusCode::BAD_REQUEST,
        "une partie vide ne se termine pas"
    );
    let (status, saved) = put(
        &app,
        &results,
        &s.admin,
        json!({
            "attributes": { "map": "bind", "mvp": series.ids[0] },
            "results": [
                { "participant_id": series.ids[0], "stats": { "kills": 4, "accuracy": 80, "character": "jett" } },
                { "participant_id": series.ids[1], "stats": { "kills": 1, "accuracy": 40, "character": "omen" } },
            ],
        }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{saved}");
    assert_eq!(
        saved["attributes"],
        json!({ "map": "bind", "mvp": series.ids[0] })
    );
    // Les points ne viennent que des statistiques numériques : 4 kills × 1,5.
    assert_eq!(of(&saved["participants"], &series.ids[0])["points"], 6.0);
    assert_eq!(
        of(&saved["participants"], &series.ids[0])["stats"]["character"],
        "jett"
    );

    let (status, outcome) = post(&app, &format!("{games}/1/finish"), &s.admin, json!({})).await;
    assert_eq!(status, StatusCode::OK, "{outcome}");
    assert_eq!(outcome["series_finished"], false);
    assert_eq!(outcome["game"]["status"], "finished");
    assert_eq!(
        of(&outcome["game"]["participants"], &series.ids[0])["result"],
        "win"
    );
    assert_eq!(outcome["match"]["status"], "ongoing");
    // Une partie terminée ne change plus, ne se supprime pas.
    let (status, _) = put(&app, &results, &s.admin, json!({ "attributes": {} })).await;
    assert_eq!(status, StatusCode::CONFLICT);
    let (status, _) = send(
        &app,
        TestRequest::delete(),
        &format!("{games}/1"),
        &s.admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    // La série ne peut pas passer sous le nombre de parties jouées.
    let (status, _) = patch(&app, &one, &s.admin, json!({ "best_of": 1 })).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    // Partie 2 : le même participant gagne, la série (2-0) se termine sans partie 3.
    let (status, outcome) = play(&app, &s, &series, &match_id, 0).await;
    assert_eq!(status, StatusCode::OK, "{outcome}");
    assert_eq!(outcome["series_finished"], true);
    let finished = &outcome["match"];
    assert_eq!(finished["status"], "finished");
    assert_eq!(finished["games"].as_array().unwrap().len(), 2);
    let winner = of(&finished["participants"], &series.ids[0]);
    let loser = of(&finished["participants"], &series.ids[1]);
    assert_eq!(
        (winner["rank"].as_i64(), winner["result"].as_str()),
        (Some(1), Some("win"))
    );
    assert_eq!(
        (loser["rank"].as_i64(), loser["result"].as_str()),
        (Some(2), Some("loss"))
    );
    // Statistiques cumulées (kills), pourcentages moyennés, points cumulés (2 × 6).
    assert_eq!(winner["stats"], json!({ "kills": 8.0, "accuracy": 80.0 }));
    assert_eq!(winner["points"], 12.0);
    assert_eq!(loser["points"], 3.0);
    // Le match est terminé : plus de partie, de saisie ni de suppression.
    let (status, _) = post(&app, &games, &s.admin, json!({})).await;
    assert_eq!(status, StatusCode::CONFLICT);
    let (status, _) = send(&app, TestRequest::delete(), &one, &s.admin, None).await;
    assert_eq!(status, StatusCode::CONFLICT);
    // Les points de l'étape suivent, et l'étape (un seul match) est clôturée.
    assert!(outcome["step_closed"].is_object(), "{outcome}");
    let (_, listed) = get(&app, &games, &s.players[0]).await;
    assert_eq!(listed.as_array().unwrap().len(), 2);
    let (status, one_game) = get(&app, &format!("{games}/2"), &s.players[1]).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(one_game["number"], 2);
    let (status, _) = get(&app, &format!("{games}/3"), &s.admin).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (_, in_list) = get(&app, &series.matches(), &s.admin).await;
    assert_eq!(in_list[0]["games"].as_array().unwrap().len(), 2);
}

#[actix_web::test]
async fn a_split_series_goes_to_the_deciding_game_and_a_bo1_ends_with_its_game() {
    let (app, s) = setup().await;
    let series = series(&app, &s, "pool").await;
    let match_id = new_match(&app, &s, &series, 3).await;
    // Un second match, à jouer, garde l'étape ouverte quand la série se termine.
    let other = new_match(&app, &s, &series, 1).await;
    for winner in [0, 1] {
        let (status, outcome) = play(&app, &s, &series, &match_id, winner).await;
        assert_eq!(status, StatusCode::OK, "{outcome}");
        assert_eq!(outcome["series_finished"], false, "{outcome}");
    }
    // Une partie ouverte se supprime ; la série reste ouverte.
    let games = format!("{}/{match_id}/games", series.matches());
    post(&app, &games, &s.admin, json!({})).await;
    let (status, _) = send(
        &app,
        TestRequest::delete(),
        &format!("{games}/3"),
        &s.admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (status, outcome) = play(&app, &s, &series, &match_id, 1).await;
    assert_eq!(status, StatusCode::OK, "{outcome}");
    assert_eq!(outcome["series_finished"], true);
    let finished = &outcome["match"];
    assert_eq!(finished["games"].as_array().unwrap().len(), 3);
    assert_eq!(
        of(&finished["participants"], &series.ids[1])["result"],
        "win"
    );
    assert_eq!(
        of(&finished["participants"], &series.ids[0])["result"],
        "loss"
    );

    // BO1 : la partie décide le match.
    let (status, outcome) = play(&app, &s, &series, &other, 0).await;
    assert_eq!(status, StatusCode::OK, "{outcome}");
    assert_eq!(outcome["series_finished"], true);
    assert_eq!(outcome["match"]["status"], "finished");
}

#[actix_web::test]
async fn a_match_without_games_keeps_its_direct_results() {
    let (app, s) = setup().await;
    let series = series(&app, &s, "pool").await;
    // Sans `best_of`, un match est d'une seule partie saisie directement, comme avant.
    let (_, created) = post(
        &app,
        &series.matches(),
        &s.admin,
        json!({ "group_id": series.group, "participant_ids": [series.ids[0], series.ids[1]] }),
    )
    .await;
    assert_eq!(created["best_of"], 1);
    let one = format!("{}/{}", series.matches(), id(&created));
    let (status, saved) = put(
        &app,
        &format!("{one}/results"),
        &s.admin,
        json!({ "results": [
            { "participant_id": series.ids[0], "stats": { "kills": 2, "character": "jett" } },
            { "participant_id": series.ids[1], "stats": { "kills": 1 } },
        ] }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{saved}");
    assert_eq!(of(&saved["participants"], &series.ids[0])["points"], 3.0);
    let (status, done) = post(
        &app,
        &format!("{one}/status"),
        &s.admin,
        json!({ "status": "finished" }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{done}");
    assert_eq!(done["games"], json!([]));
    assert_eq!(of(&done["participants"], &series.ids[0])["result"], "win");
}

#[actix_web::test]
async fn the_winner_of_a_series_moves_to_the_next_match() {
    let (app, s) = setup().await;
    let series = series(&app, &s, "single_elim").await;
    let (_, last) = post(
        &app,
        &series.matches(),
        &s.admin,
        json!({ "group_id": series.group, "round": 2 }),
    )
    .await;
    let semi = {
        let (status, created) = post(
            &app,
            &series.matches(),
            &s.admin,
            json!({ "group_id": series.group, "round": 1, "best_of": 3, "next_match_id": id(&last),
                    "participant_ids": [series.ids[0], series.ids[1]] }),
        )
        .await;
        assert_eq!(status, StatusCode::CREATED, "{created}");
        id(&created)
    };
    for _ in 0..2 {
        let (status, outcome) = play(&app, &s, &series, &semi, 1).await;
        assert_eq!(status, StatusCode::OK, "{outcome}");
    }
    let (_, finale) = get(
        &app,
        &format!("{}/{}", series.matches(), id(&last)),
        &s.admin,
    )
    .await;
    let waiting = finale["participants"].as_array().unwrap();
    assert_eq!(waiting.len(), 1);
    assert_eq!(waiting[0]["participant_id"], series.ids[1]);
}

async fn export_stats(app: &app_type!(), token: &str, format: &str) -> String {
    let response = actix_web::test::call_service(
        app,
        request(
            TestRequest::get(),
            &format!("/stats/export?format={format}"),
            Some(token),
        )
        .to_request(),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    String::from_utf8(actix_web::test::read_body(response).await.to_vec()).unwrap()
}

#[actix_web::test]
async fn selection_stats_and_their_options_survive_an_export_and_import() {
    let (app, s) = setup().await;
    for format in ["json", "csv"] {
        let before = export_stats(&app, &s.admin, format).await;
        if format == "json" {
            let document: Value = serde_json::from_str(&before).unwrap();
            let map = document["stats"]
                .as_array()
                .unwrap()
                .iter()
                .find(|stat| stat["key"] == "map")
                .unwrap();
            assert_eq!(
                (map["type"].as_str(), map["scope"].as_str()),
                (Some("select"), Some("match"))
            );
            assert_eq!(
                map["options"]["TFT"][1],
                json!({ "key": "bind", "label": "Bind" })
            );
        }
        // Retirer les options, puis réimporter le fichier exporté : tout revient.
        for stat in [&s.character, &s.map] {
            put(
                &app,
                &format!("/games/{}/stats/{stat}/options", s.game),
                &s.admin,
                json!({ "options": [] }),
            )
            .await;
        }
        let (status, report) = call(
            &app,
            request(
                TestRequest::post(),
                &format!("/stats/import?format={format}"),
                Some(&s.admin),
            )
            .set_payload(before.clone()),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{format}: {report}");
        assert_eq!(
            export_stats(&app, &s.admin, format).await,
            before,
            "{format}"
        );
    }
    // Options sans jeu lié, ou sur une statistique numérique : refusées.
    let bad = json!({ "version": 1, "stats": [
        { "name": "K", "key": "k", "type": "flat", "games": ["TFT"],
          "options": { "TFT": [{ "key": "a", "label": "A" }] } },
    ] });
    let (status, error) = call(
        &app,
        request(
            TestRequest::post(),
            "/stats/import?format=json",
            Some(&s.admin),
        )
        .set_payload(bad.to_string()),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{error}");
}

#[actix_web::test]
async fn games_and_mvp_survive_a_tournament_export_and_import() {
    let (app, s) = setup().await;
    let series = series(&app, &s, "pool").await;
    let match_id = new_match(&app, &s, &series, 3).await;
    for winner in [0, 1] {
        play(&app, &s, &series, &match_id, winner).await;
    }
    // Une troisième partie reste en cours, avec un MVP désigné.
    let games = format!("{}/{match_id}/games", series.matches());
    post(
        &app,
        &games,
        &s.admin,
        json!({ "attributes": { "mvp": series.ids[1] } }),
    )
    .await;

    let (_, tournament) = get(&app, &format!("/tournaments/{}", series.tid), &s.admin).await;
    let name = tournament["name"].as_str().unwrap().to_string();
    let original =
        serde_json::from_str::<Value>(&export_file(&app, &s.admin, "json").await).unwrap();
    let steps = tournament_named(&original, &name)["steps"].clone();
    let item = &steps[0]["matches"][0];
    assert_eq!(item["best_of"], 3);
    let exported = item["games"].as_array().unwrap();
    assert_eq!(exported.len(), 3);
    assert_eq!(exported[0]["status"], "finished");
    assert_eq!(exported[2]["status"], "ongoing");
    // Le MVP voyage sous la forme d'un participant, pas d'un identifiant.
    assert!(
        exported[0]["attributes"]["mvp"]["user"]
            .as_str()
            .unwrap()
            .starts_with("player")
    );
    assert_eq!(exported[0]["attributes"]["map"], "bind");

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
        let after =
            serde_json::from_str::<Value>(&export_file(&app, &s.admin, "json").await).unwrap();
        assert_eq!(tournament_named(&after, &copy)["steps"], steps, "{format}");
    }

    // Un fichier incohérent est refusé en entier.
    let mut broken = original.clone();
    let mut one = tournament_named(&original, &name).clone();
    one["name"] = json!("Cassé");
    one["steps"][0]["matches"][0]["games"][0]["attributes"] = json!({ "map": "nowhere" });
    broken["tournaments"] = json!([one.clone()]);
    let (status, error) = import_file(&app, &s.admin, "json", broken.to_string()).await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{error}");
    one["steps"][0]["matches"][0]["games"][0]["attributes"] =
        json!({ "mvp": { "user": "inconnu" } });
    broken["tournaments"] = json!([one.clone()]);
    let (status, _) = import_file(&app, &s.admin, "json", broken.to_string()).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    one["steps"][0]["matches"][0]["best_of"] = json!(2);
    one["steps"][0]["matches"][0]["games"][0]["attributes"] = json!({});
    broken["tournaments"] = json!([one]);
    let (status, _) = import_file(&app, &s.admin, "json", broken.to_string()).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}
