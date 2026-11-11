//! Parcours HTTP de la génération automatique des matchs : élimination simple et double, poules,
//! rondes suisses, têtes de série, séries (BO), barème d'étape et départages, sur un store en
//! mémoire.

mod common;

use actix_web::http::StatusCode;
use actix_web::test::TestRequest;
use api_public::store::{MemoryStore, Role};
use common::{access, app_with, call, logged_in_as, login, request};
use serde_json::{Value, json};
use std::collections::HashMap;
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

async fn get(app: &app_type!(), path: &str, token: &str) -> (StatusCode, Value) {
    send(app, TestRequest::get(), path, token, None).await
}

/// Un administrateur et `count` joueurs.
async fn setup(count: usize) -> (app_type!(), Setup) {
    let store = Arc::new(MemoryStore::new());
    let app = app_with(store.clone(), Duration::from_secs(3600)).await;
    logged_in_as(&app, "root", "secret123").await;
    store.set_role("root", Role::Admin);
    let (_, session) = login(&app, "root", "secret123").await;
    let admin = access(&session).to_string();
    let (_, game) = post(&app, "/games", &admin, json!({ "name": "Chess" })).await;
    let game = game["id"].as_str().unwrap().to_string();
    let mut players = Vec::new();
    for index in 0..count {
        let session = logged_in_as(&app, &format!("player{index}"), "secret123").await;
        players.push(access(&session).to_string());
    }
    (
        app,
        Setup {
            admin,
            game,
            players,
        },
    )
}

struct Running {
    tid: String,
    step: String,
    /// Inscrits par tête de série.
    ids: Vec<String>,
}

impl Running {
    fn base(&self) -> String {
        format!("/tournaments/{}/steps/{}", self.tid, self.step)
    }
}

/// Crée le tournoi (une étape `step`, `max_participants` = nombre de joueurs), inscrit tout le
/// monde, le passe `ongoing` et lance l'étape avec `start_body`.
async fn running(
    app: &app_type!(),
    s: &Setup,
    step: Value,
    start_body: Option<Value>,
) -> (StatusCode, Value, Running) {
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
            "max_participants": s.players.len(),
        }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{tournament}");
    let tid = tournament["id"].as_str().unwrap().to_string();
    let (status, created) = post(app, &format!("/tournaments/{tid}/steps"), &s.admin, step).await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    let step_id = created["id"].as_str().unwrap().to_string();
    post(
        app,
        &format!("/tournaments/{tid}/status"),
        &s.admin,
        json!({ "status": "registration" }),
    )
    .await;
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
    let path = format!("/tournaments/{tid}/steps/{step_id}/start");
    let (status, started) = match start_body {
        Some(body) => post(app, &path, &s.admin, body).await,
        None => post(app, &path, &s.admin, json!({})).await,
    };
    let mut run = Running {
        tid,
        step: step_id,
        ids: Vec::new(),
    };
    if status == StatusCode::OK {
        let (_, ranking) = get(app, &format!("{}/ranking", run.base()), &s.admin).await;
        let mut seeded: Vec<(i64, String)> = ranking
            .as_array()
            .unwrap()
            .iter()
            .flat_map(|g| g["participants"].as_array().unwrap().clone())
            .map(|p| {
                (
                    p["seed"].as_i64().unwrap_or(i64::MAX),
                    p["participant_id"].as_str().unwrap().to_string(),
                )
            })
            .collect();
        seeded.sort();
        run.ids = seeded.into_iter().map(|(_, id)| id).collect();
    }
    (status, started, run)
}

fn id(value: &Value) -> String {
    value["id"].as_str().unwrap().to_string()
}

async fn generate(app: &app_type!(), s: &Setup, run: &Running) -> (StatusCode, Value) {
    post(
        app,
        &format!("{}/generate", run.base()),
        &s.admin,
        json!({}),
    )
    .await
}

async fn matches(app: &app_type!(), s: &Setup, run: &Running) -> Vec<Value> {
    let (status, list) = get(app, &format!("{}/matches", run.base()), &s.admin).await;
    assert_eq!(status, StatusCode::OK);
    list.as_array().unwrap().clone()
}

fn members(found: &Value) -> Vec<String> {
    found["participants"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p["participant_id"].as_str().unwrap().to_string())
        .collect()
}

/// Termine le match : `winner` gagne (rang 1), l'autre perd. `games` : manches (vainqueur,
/// perdant) pour une série.
async fn finish_match(
    app: &app_type!(),
    s: &Setup,
    run: &Running,
    found: &Value,
    winner: &str,
    games: Option<(i64, i64)>,
) -> (StatusCode, Value) {
    let path = format!("{}/matches/{}", run.base(), id(found));
    let results: Vec<Value> = members(found)
        .into_iter()
        .map(|p| {
            let won = p == winner;
            let mut entry = json!({
                "participant_id": p, "stats": {},
                "rank": if won { 1 } else { 2 },
                "result": if won { "win" } else { "loss" },
            });
            if let Some((w, l)) = games {
                entry["games_won"] = json!(if won { w } else { l });
            }
            entry
        })
        .collect();
    let (status, body) = put(
        app,
        &format!("{path}/results"),
        &s.admin,
        json!({ "results": results }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    post(
        app,
        &format!("{path}/status"),
        &s.admin,
        json!({ "status": "finished" }),
    )
    .await
}

async fn refreshed(app: &app_type!(), s: &Setup, run: &Running, match_id: &str) -> Value {
    let (status, found) = get(app, &format!("{}/matches/{match_id}", run.base()), &s.admin).await;
    assert_eq!(status, StatusCode::OK);
    found
}

fn step(format: &str, match_type: &str, size: usize, per_group: i64) -> Value {
    json!({
        "position": 1, "format": format, "match_type": match_type, "group_count": 1,
        "group_size": size, "matches_per_group": per_group, "advance_per_group": 1,
    })
}

#[actix_web::test]
async fn single_elimination_with_byes_plays_to_a_champion() {
    let (app, s) = setup(5).await;
    let (status, body, run) = running(&app, &s, step("single_elim", "duel", 5, 1), None).await;
    assert_eq!(status, StatusCode::OK, "{body}");

    let (status, generated) = generate(&app, &s, &run).await;
    assert_eq!(status, StatusCode::CREATED, "{generated}");
    // 5 participants : 4 matchs, les têtes de série 1 à 3 passent le premier tour.
    let all = matches(&app, &s, &run).await;
    assert_eq!(all.len(), 4);
    let first_round: Vec<&Value> = all.iter().filter(|m| m["round"] == 1).collect();
    assert_eq!(first_round.len(), 1);
    let opening = members(first_round[0]);
    assert!(opening.contains(&run.ids[3]) && opening.contains(&run.ids[4]));
    for top in &run.ids[..3] {
        let waiting = all
            .iter()
            .filter(|m| m["round"] == 2)
            .any(|m| members(m).contains(top));
        assert!(waiting, "la tête de série {top} attend au deuxième tour");
    }

    // Pas de régénération.
    let (status, _) = generate(&app, &s, &run).await;
    assert_eq!(status, StatusCode::CONFLICT);

    // On joue : la meilleure tête de série gagne tous ses matchs.
    let champion = run.ids[0].clone();
    for round in 1..=3 {
        let current: Vec<Value> = matches(&app, &s, &run)
            .await
            .into_iter()
            .filter(|m| m["round"] == round && m["status"] == "scheduled")
            .collect();
        assert!(!current.is_empty(), "ronde {round}");
        for found in current {
            let players = members(&found);
            assert_eq!(players.len(), 2, "ronde {round} : {found}");
            let winner = if players.contains(&champion) {
                champion.clone()
            } else {
                players[0].clone()
            };
            let (status, outcome) = finish_match(&app, &s, &run, &found, &winner, None).await;
            assert_eq!(status, StatusCode::OK, "{outcome}");
        }
    }
    let (_, ranking) = get(&app, &format!("{}/ranking", run.base()), &s.admin).await;
    assert_eq!(ranking[0]["participants"][0]["participant_id"], champion);
    assert_eq!(ranking[0]["participants"][0]["rank"], 1);
    let (_, step) = get(&app, &run.base(), &s.admin).await;
    assert_eq!(
        step["status"], "finished",
        "la dernière manche clôt l'étape"
    );
}

#[actix_web::test]
async fn double_elimination_sends_losers_down_and_plays_the_reset() {
    let (app, s) = setup(4).await;
    let (status, body, run) = running(&app, &s, step("double_elim", "duel", 4, 1), None).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let (status, generated) = generate(&app, &s, &run).await;
    assert_eq!(status, StatusCode::CREATED, "{generated}");
    let all = matches(&app, &s, &run).await;
    let count = |bracket: &str| all.iter().filter(|m| m["bracket"] == bracket).count();
    assert_eq!(
        (count("winners"), count("losers"), count("grand_final")),
        (3, 2, 2)
    );

    let seed = |i: usize| run.ids[i].clone();
    // Tableau des vainqueurs : 1 bat 4, 2 bat 3 (têtes de série 0 et 1).
    let by_round = |all: &[Value], bracket: &str, round: i64| -> Vec<Value> {
        all.iter()
            .filter(|m| m["bracket"] == bracket && m["round"] == round)
            .cloned()
            .collect()
    };
    for found in by_round(&all, "winners", 1) {
        let players = members(&found);
        let winner = if players.contains(&seed(0)) || players.contains(&seed(1)) {
            players
                .iter()
                .find(|p| **p == seed(0) || **p == seed(1))
                .unwrap()
                .clone()
        } else {
            players[0].clone()
        };
        let (status, out) = finish_match(&app, &s, &run, &found, &winner, None).await;
        assert_eq!(status, StatusCode::OK, "{out}");
    }
    // Les deux perdants se retrouvent dans le premier match des perdants.
    let all = matches(&app, &s, &run).await;
    let losers_first = by_round(&all, "losers", 1);
    assert_eq!(losers_first.len(), 1);
    let drop = members(&losers_first[0]);
    assert_eq!(drop.len(), 2);
    assert!(drop.contains(&seed(2)) && drop.contains(&seed(3)));

    // Finale des vainqueurs : 0 bat 1. Le perdant (1) descend dans la finale des perdants.
    let wb_final = by_round(&all, "winners", 2).remove(0);
    let (status, out) = finish_match(&app, &s, &run, &wb_final, &seed(0), None).await;
    assert_eq!(status, StatusCode::OK, "{out}");
    // Les perdants : 2 bat 3, puis 2 bat 1 en finale des perdants.
    let (status, out) = finish_match(&app, &s, &run, &losers_first[0], &seed(2), None).await;
    assert_eq!(status, StatusCode::OK, "{out}");
    let all = matches(&app, &s, &run).await;
    let lb_final = by_round(&all, "losers", 2).remove(0);
    let finalists = members(&lb_final);
    assert!(
        finalists.contains(&seed(1)) && finalists.contains(&seed(2)),
        "{finalists:?}"
    );
    let (status, out) = finish_match(&app, &s, &run, &lb_final, &seed(2), None).await;
    assert_eq!(status, StatusCode::OK, "{out}");

    // Grande finale : le vainqueur du tableau des perdants (2) bat celui des vainqueurs (0) :
    // la manche de reset se joue.
    let all = matches(&app, &s, &run).await;
    let grand = by_round(&all, "grand_final", 1).remove(0);
    let gf_players = members(&grand);
    assert!(gf_players.contains(&seed(0)) && gf_players.contains(&seed(2)));
    let (status, out) = finish_match(&app, &s, &run, &grand, &seed(2), None).await;
    assert_eq!(status, StatusCode::OK, "{out}");
    assert!(out["step_closed"].is_null(), "le reset reste à jouer");
    let reset = refreshed(&app, &s, &run, &id(&by_round(&all, "grand_final", 2)[0])).await;
    assert_eq!(reset["status"], "scheduled");
    assert_eq!(members(&reset).len(), 2);
    let (status, out) = finish_match(&app, &s, &run, &reset, &seed(0), None).await;
    assert_eq!(status, StatusCode::OK, "{out}");
    assert!(
        !out["step_closed"].is_null(),
        "la dernière manche clôt l'étape"
    );
    let (_, ranking) = get(&app, &format!("{}/ranking", run.base()), &s.admin).await;
    assert_eq!(ranking[0]["participants"][0]["participant_id"], seed(0));
}

#[actix_web::test]
async fn the_reset_is_cancelled_when_the_winners_champion_wins_the_grand_final() {
    let (app, s) = setup(4).await;
    let (_, _, run) = running(&app, &s, step("double_elim", "duel", 4, 1), None).await;
    generate(&app, &s, &run).await;
    let seed = |i: usize| run.ids[i].clone();
    // Les têtes de série les plus hautes gagnent toujours.
    let order: HashMap<String, usize> = run
        .ids
        .iter()
        .enumerate()
        .map(|(i, id)| (id.clone(), i))
        .collect();
    let mut closed = false;
    for _ in 0..8 {
        let open: Vec<Value> = matches(&app, &s, &run)
            .await
            .into_iter()
            .filter(|m| m["status"] == "scheduled" && members(m).len() == 2)
            .collect();
        let Some(found) = open.first() else { break };
        let players = members(found);
        let winner = players.iter().min_by_key(|p| order[*p]).unwrap().clone();
        let (status, out) = finish_match(&app, &s, &run, found, &winner, None).await;
        assert_eq!(status, StatusCode::OK, "{out}");
        closed = !out["step_closed"].is_null();
    }
    assert!(closed, "l'étape se clôt sans manche de reset");
    let all = matches(&app, &s, &run).await;
    let reset = all
        .iter()
        .find(|m| m["bracket"] == "grand_final" && m["round"] == 2)
        .unwrap();
    assert_eq!(reset["status"], "cancelled");
    let (_, ranking) = get(&app, &format!("{}/ranking", run.base()), &s.admin).await;
    assert_eq!(ranking[0]["participants"][0]["participant_id"], seed(0));
}

#[actix_web::test]
async fn a_round_robin_pool_plays_everyone_once_and_head_to_head_breaks_ties() {
    let (app, s) = setup(4).await;
    let mut definition = step("pool", "duel", 4, 1);
    definition["tiebreak"] = json!(["head_to_head"]);
    definition["rules"] = json!({ "scoring": { "win": 3, "draw": 1, "loss": 0 } });
    let (status, body, run) = running(&app, &s, definition, None).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let (status, _) = generate(&app, &s, &run).await;
    assert_eq!(status, StatusCode::CREATED);
    let all = matches(&app, &s, &run).await;
    assert_eq!(all.len(), 6);
    let mut pairs: Vec<Vec<String>> = all
        .iter()
        .map(|m| {
            let mut pair = members(m);
            pair.sort();
            pair
        })
        .collect();
    pairs.sort();
    pairs.dedup();
    assert_eq!(pairs.len(), 6, "chaque paire se rencontre une fois");

    // A bat tout le monde, B bat C et D, C bat D... sauf que D bat B : B, C et D sont à égalité de
    // points ; la confrontation directe les départage dans un mini-classement.
    let (a, b, c, d) = (&run.ids[0], &run.ids[1], &run.ids[2], &run.ids[3]);
    let winner_of = |players: &[String]| -> String {
        let has = |x: &String| players.contains(x);
        if has(a) {
            a.clone()
        } else if has(b) && has(c) {
            b.clone()
        } else if has(b) && has(d) {
            d.clone()
        } else {
            c.clone()
        }
    };
    for found in &all {
        let winner = winner_of(&members(found));
        let (status, out) = finish_match(&app, &s, &run, found, &winner, None).await;
        assert_eq!(status, StatusCode::OK, "{out}");
    }
    let (_, ranking) = get(&app, &format!("{}/ranking", run.base()), &s.admin).await;
    let order: Vec<&str> = ranking[0]["participants"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p["participant_id"].as_str().unwrap())
        .collect();
    assert_eq!(order[0], a);
    // Le barème de l'étape remplace les points : 3 par victoire, jamais additionnés à ceux des
    // statistiques.
    assert_eq!(ranking[0]["participants"][0]["points"], 9.0);
    let (_, step) = get(&app, &run.base(), &s.admin).await;
    assert_eq!(step["status"], "finished");
}

#[actix_web::test]
async fn swiss_rounds_follow_the_standings_without_rematches() {
    let (app, s) = setup(5).await;
    let mut definition = step("swiss", "duel", 5, 3);
    definition["tiebreak"] = json!(["buchholz"]);
    definition["rules"] = json!({ "scoring": { "win": 3, "draw": 1, "loss": 0 } });
    let (status, body, run) = running(&app, &s, definition, None).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    generate(&app, &s, &run).await;

    let mut seen: Vec<Vec<String>> = Vec::new();
    for round in 1..=3 {
        let in_round: Vec<Value> = matches(&app, &s, &run)
            .await
            .into_iter()
            .filter(|m| m["round"] == round)
            .collect();
        assert_eq!(in_round.len(), 3, "2 duels et un bye à la ronde {round}");
        assert_eq!(
            in_round
                .iter()
                .filter(|m| members(m).len() == 1 && m["status"] == "finished")
                .count(),
            1,
            "le bye est un match terminé"
        );
        for found in in_round.iter().filter(|m| members(m).len() == 2) {
            let mut pair = members(found);
            pair.sort();
            assert!(!seen.contains(&pair), "revanche à la ronde {round}");
            seen.push(pair.clone());
            let (status, out) = finish_match(&app, &s, &run, found, &pair[0], None).await;
            assert_eq!(status, StatusCode::OK, "{out}");
        }
    }
    // Trois rondes jouées : l'étape se clôt, rien de plus à générer.
    let (_, step) = get(&app, &run.base(), &s.admin).await;
    assert_eq!(step["status"], "finished");
    let (status, _) = post(&app, &format!("{}/rounds", run.base()), &s.admin, json!({})).await;
    assert_eq!(status, StatusCode::CONFLICT);
    // Un seul bye par participant tant que c'est possible.
    let byes: Vec<String> = matches(&app, &s, &run)
        .await
        .iter()
        .filter(|m| members(m).len() == 1)
        .flat_map(members)
        .collect();
    let mut distinct = byes.clone();
    distinct.sort();
    distinct.dedup();
    assert_eq!(byes.len(), distinct.len(), "{byes:?}");
}

#[actix_web::test]
async fn swiss_reports_impossible_pairings_and_accepts_rematches_on_request() {
    let (app, s) = setup(4).await;
    // 4 participants, 4 rondes : la 4e ronde force une revanche (3 adversaires possibles).
    let (_, _, run) = running(&app, &s, step("swiss", "duel", 4, 4), None).await;
    generate(&app, &s, &run).await;
    for round in 1..=3 {
        let in_round: Vec<Value> = matches(&app, &s, &run)
            .await
            .into_iter()
            .filter(|m| m["round"] == round && m["status"] == "scheduled")
            .collect();
        for found in in_round {
            let players = members(&found);
            finish_match(&app, &s, &run, &found, &players[0], None).await;
        }
    }
    let rounds = format!("{}/rounds", run.base());
    // Après trois rondes, tous les couples se sont rencontrés : la quatrième est impossible sans
    // revanche.
    let (status, body) = post(&app, &rounds, &s.admin, json!({})).await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    assert!(body["errors"]["pairing"].is_string(), "{body}");
    assert_eq!(
        matches(&app, &s, &run)
            .await
            .iter()
            .filter(|m| m["round"] == 4)
            .count(),
        0
    );
    let (status, body) = post(&app, &rounds, &s.admin, json!({ "allow_rematches": true })).await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    assert_eq!(body["matches"].as_array().unwrap().len(), 2);
    // Une ronde déjà générée n'est pas régénérée.
    let (status, _) = post(&app, &rounds, &s.admin, json!({ "allow_rematches": true })).await;
    assert_eq!(status, StatusCode::CONFLICT);
}

#[actix_web::test]
async fn seeds_are_manual_random_or_ranking_based() {
    // Manuel : l'ordre est exigé, complet, et persisté.
    let (app, s) = setup(4).await;
    let mut definition = step("single_elim", "duel", 4, 1);
    definition["rules"] = json!({ "seeding": "manual" });
    let (status, body, _) = running(&app, &s, definition.clone(), None).await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    assert!(body["errors"]["seed_order"].is_string(), "{body}");

    // Ranking sans classement fiable : refusé.
    let (app, s) = setup(4).await;
    let mut definition = step("single_elim", "duel", 4, 1);
    definition["rules"] = json!({ "seeding": "ranking" });
    let (status, body, _) = running(&app, &s, definition, None).await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    assert!(body["errors"]["seeding"].is_string(), "{body}");

    // Aléatoire : toutes les têtes de série 1 à N, une fois chacune.
    let (app, s) = setup(4).await;
    let (status, _, run) = running(&app, &s, step("single_elim", "duel", 4, 1), None).await;
    assert_eq!(status, StatusCode::OK);
    let (_, ranking) = get(&app, &format!("{}/ranking", run.base()), &s.admin).await;
    let mut seeds: Vec<i64> = ranking[0]["participants"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p["seed"].as_i64().unwrap())
        .collect();
    seeds.sort_unstable();
    assert_eq!(seeds, [1, 2, 3, 4]);
}

#[actix_web::test]
async fn a_manual_seed_order_places_the_bracket() {
    let (app, s) = setup(4).await;
    // Le seeding manuel ne connaît pas encore les identifiants : on lance une première fois pour
    // les lire, puis on vérifie la contrainte sur une seconde étape.
    let mut definition = step("single_elim", "duel", 4, 1);
    definition["rules"] = json!({ "seeding": "manual" });
    let (tournament_status, tournament) = post(
        &app,
        "/tournaments",
        &s.admin,
        json!({
            "game_id": s.game, "name": "Manual",
            "start_date": "2026-11-14T18:00:00Z", "end_date": "2026-11-15T18:00:00Z",
            "participant_type": "solo", "max_participants": 4,
        }),
    )
    .await;
    assert_eq!(tournament_status, StatusCode::CREATED);
    let tid = id(&tournament);
    let (_, created) = post(
        &app,
        &format!("/tournaments/{tid}/steps"),
        &s.admin,
        definition,
    )
    .await;
    let step_id = id(&created);
    post(
        &app,
        &format!("/tournaments/{tid}/status"),
        &s.admin,
        json!({"status": "registration"}),
    )
    .await;
    let mut registered = Vec::new();
    for player in &s.players {
        let (_, p) = post(
            &app,
            &format!("/tournaments/{tid}/participants"),
            player,
            json!({}),
        )
        .await;
        registered.push(id(&p));
    }
    post(
        &app,
        &format!("/tournaments/{tid}/status"),
        &s.admin,
        json!({"status": "ongoing"}),
    )
    .await;
    let start = format!("/tournaments/{tid}/steps/{step_id}/start");
    let (status, _) = post(
        &app,
        &start,
        &s.admin,
        json!({ "seed_order": &registered[..3] }),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::BAD_REQUEST,
        "un ordre incomplet est refusé"
    );
    let order: Vec<&String> = registered.iter().rev().collect();
    let (status, body) = post(&app, &start, &s.admin, json!({ "seed_order": order })).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let run = Running {
        tid,
        step: step_id,
        ids: registered.iter().rev().cloned().collect(),
    };
    generate(&app, &s, &run).await;
    let all = matches(&app, &s, &run).await;
    let first = all
        .iter()
        .find(|m| m["round"] == 1 && members(m).contains(&run.ids[0]))
        .unwrap();
    assert!(
        members(first).contains(&run.ids[3]),
        "la tête de série 1 affronte la 4"
    );
    let (_, ranking) = get(&app, &format!("{}/ranking", run.base()), &s.admin).await;
    for participant in ranking[0]["participants"].as_array().unwrap() {
        let at = run
            .ids
            .iter()
            .position(|i| *i == participant["participant_id"].as_str().unwrap())
            .unwrap();
        assert_eq!(participant["seed"], at + 1);
    }
}

#[actix_web::test]
async fn series_need_a_decided_score_and_keep_rounds_apart_from_games() {
    let (app, s) = setup(4).await;
    let mut definition = step("single_elim", "duel", 4, 1);
    definition["rules"] = json!({ "best_of": 3, "best_of_by_round": { "2": 5 } });
    let (status, body, run) = running(&app, &s, definition, None).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    generate(&app, &s, &run).await;
    let all = matches(&app, &s, &run).await;
    assert!(
        all.iter()
            .filter(|m| m["round"] == 1)
            .all(|m| m["best_of"] == 3)
    );
    assert!(
        all.iter()
            .filter(|m| m["round"] == 2)
            .all(|m| m["best_of"] == 5)
    );

    let semi = all.iter().find(|m| m["round"] == 1).unwrap().clone();
    let winner = members(&semi)[0].clone();
    // Sans manches, la série n'est pas décidée.
    let (status, error) = finish_match(&app, &s, &run, &semi, &winner, None).await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{error}");
    // 3-0 n'existe pas au meilleur de 3 (2 manches suffisent) ; 2-2 non plus.
    let path = format!("{}/matches/{}/results", run.base(), id(&semi));
    let (status, _) = put(
        &app,
        &path,
        &s.admin,
        json!({ "results": [{ "participant_id": winner, "stats": {}, "games_won": 3 }] }),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, error) = finish_match(&app, &s, &run, &semi, &winner, Some((2, 2))).await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{error}");
    let (status, out) = finish_match(&app, &s, &run, &semi, &winner, Some((2, 1))).await;
    assert_eq!(status, StatusCode::OK, "{out}");
    let done = refreshed(&app, &s, &run, &id(&semi)).await;
    assert_eq!(
        done["participants"]
            .as_array()
            .unwrap()
            .iter()
            .find(|p| p["participant_id"] == winner)
            .unwrap()["games_won"],
        2
    );
}

#[actix_web::test]
async fn unsupported_combinations_and_bad_rules_are_rejected() {
    let (app, s) = setup(4).await;
    let (status, body) = post(
        &app,
        &format!("/tournaments/{}/steps", Uuid::new_v4()),
        &s.admin,
        step("single_elim", "ffa", 4, 1),
    )
    .await;
    // Le tournoi n'existe pas : la validation passe avant ou après selon la route, mais jamais 201.
    assert_ne!(status, StatusCode::CREATED, "{body}");

    let (_, tournament) = post(
        &app,
        "/tournaments",
        &s.admin,
        json!({
            "game_id": s.game, "name": "Rules",
            "start_date": "2026-11-14T18:00:00Z", "end_date": "2026-11-15T18:00:00Z",
            "participant_type": "solo", "max_participants": 4,
        }),
    )
    .await;
    let path = format!("/tournaments/{}/steps", id(&tournament));
    for bad in [
        step("single_elim", "ffa", 4, 1),
        step("swiss", "ffa", 4, 2),
        step("double_elim", "ffa", 4, 1),
    ] {
        let (status, body) = post(&app, &path, &s.admin, bad).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
        assert!(body["errors"]["match_type"].is_string(), "{body}");
    }
    let mut series = step("single_elim", "duel", 4, 1);
    series["rules"] = json!({ "best_of": 4 });
    let (status, body) = post(&app, &path, &s.admin, series).await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    let mut ffa_series = step("pool", "ffa", 4, 1);
    ffa_series["rules"] = json!({ "best_of": 3 });
    let (status, _) = post(&app, &path, &s.admin, ffa_series).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let mut unknown = step("pool", "duel", 4, 1);
    unknown["rules"] = json!({ "seeding": "tarot" });
    let (status, _) = post(&app, &path, &s.admin, unknown).await;
    assert!(status.is_client_error());
}

#[actix_web::test]
async fn generation_is_idempotent_under_concurrent_calls_and_keeps_manual_matches() {
    let (app, s) = setup(4).await;
    let (_, _, run) = running(&app, &s, step("pool", "duel", 4, 1), None).await;
    let path = format!("{}/generate", run.base());
    let admin = s.admin.clone();
    let (first, second) = tokio::join!(
        post(&app, &path, &admin, json!({})),
        post(&app, &path, &admin, json!({})),
    );
    let mut statuses = [first.0, second.0];
    statuses.sort();
    assert_eq!(statuses, [StatusCode::CREATED, StatusCode::CONFLICT]);
    assert_eq!(matches(&app, &s, &run).await.len(), 6, "pas de doublon");

    // Une étape qui a des matchs créés à la main ne se régénère pas.
    let (app, s) = setup(4).await;
    let (_, _, run) = running(&app, &s, step("pool", "duel", 4, 1), None).await;
    let (_, ranking) = get(&app, &format!("{}/ranking", run.base()), &s.admin).await;
    let group = ranking[0]["group_id"].as_str().unwrap().to_string();
    let (status, manual) = post(
        &app,
        &format!("{}/matches", run.base()),
        &s.admin,
        json!({ "group_id": group, "participant_ids": [run.ids[0], run.ids[1]] }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{manual}");
    let (status, _) = generate(&app, &s, &run).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(matches(&app, &s, &run).await.len(), 1);
}

#[actix_web::test]
async fn generation_routes_need_an_administrator() {
    let (app, s) = setup(4).await;
    let (_, _, run) = running(&app, &s, step("pool", "duel", 4, 1), None).await;
    for suffix in ["generate", "rounds"] {
        let path = format!("{}/{suffix}", run.base());
        let (status, _) = call(&app, request(TestRequest::post(), &path, None)).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
        let (status, _) = post(&app, &path, &s.players[0], json!({})).await;
        assert_eq!(status, StatusCode::FORBIDDEN);
    }
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

#[actix_web::test]
async fn a_generated_bracket_exports_and_reimports_without_loss() {
    let (app, s) = setup(4).await;
    let mut definition = step("double_elim", "duel", 4, 1);
    definition["rules"] = json!({
        "best_of": 3,
        "qualification": "rank",
        "scoring": { "win": 3, "draw": 1, "loss": 0 },
    });
    let (status, body, run) = running(&app, &s, definition, None).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    generate(&app, &s, &run).await;
    // Un match terminé, pour exporter des résultats et des manches.
    let first = matches(&app, &s, &run)
        .await
        .into_iter()
        .find(|m| m["round"] == 1 && m["bracket"] == "winners")
        .unwrap();
    let winner = members(&first)[0].clone();
    finish_match(&app, &s, &run, &first, &winner, Some((2, 1))).await;

    let (_, tournament) = get(&app, &format!("/tournaments/{}", run.tid), &s.admin).await;
    let name = tournament["name"].as_str().unwrap().to_string();
    let original: Value = serde_json::from_str(&export_file(&app, &s.admin, "json").await).unwrap();
    let found = |document: &Value, name: &str| -> Value {
        document["tournaments"]
            .as_array()
            .unwrap()
            .iter()
            .find(|t| t["name"] == name)
            .unwrap()
            .clone()
    };
    let exported = found(&original, &name);
    let steps = exported["steps"].clone();
    assert_eq!(steps[0]["rules"]["best_of"], 3);
    assert_eq!(steps[0]["rules"]["scoring"]["win"], 3.0);
    let matches = steps[0]["matches"].as_array().unwrap();
    assert_eq!(matches.len(), 7);
    assert!(
        matches
            .iter()
            .all(|m| m["best_of"] == 3 && m["number"].is_number())
    );
    assert!(matches.iter().any(|m| m["loser_next"].is_number()));
    assert!(matches.iter().any(|m| m["next_slot"].is_number()));
    let played = matches.iter().find(|m| m["status"] == "finished").unwrap();
    assert!(
        played["participants"]
            .as_array()
            .unwrap()
            .iter()
            .any(|p| p["games_won"] == 2)
    );
    assert!(
        steps[0]["groups"][0]["participants"]
            .as_array()
            .unwrap()
            .iter()
            .all(|p| p["seed"].is_number())
    );

    // Réimport sous un autre nom : mêmes étapes, mêmes matchs, mêmes liens.
    let mut copy = exported.clone();
    copy["name"] = json!("Copie générée");
    let mut document = original.clone();
    document["tournaments"] = json!([copy]);
    let (status, report) = call(
        &app,
        request(
            TestRequest::post(),
            "/tournaments/import?format=json",
            Some(&s.admin),
        )
        .set_payload(document.to_string()),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{report}");
    let after: Value = serde_json::from_str(&export_file(&app, &s.admin, "json").await).unwrap();
    assert_eq!(found(&after, "Copie générée")["steps"], steps);
}
