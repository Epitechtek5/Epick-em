//! Garanties de concurrence et d'idempotence des opérations critiques, contre un vrai
//! PostgreSQL migré (ignoré par défaut) :
//! `DATABASE_URL=… cargo test -p api-public --test concurrency -- --ignored`.
//!
//! Les requêtes sont lancées ensemble sur la même application : elles s'entrelacent à chaque
//! accès à la base, comme des requêtes simultanées de clients différents.

mod common;

use actix_web::http::StatusCode;
use actix_web::test::{self, TestRequest};
use api_public::config::AuthConfig;
use api_public::store::PgStore;
use api_public::{AppState, app};
use common::{access, call, logged_in_as, login, request};
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

async fn get(app: &app_type!(), path: &str, token: &str) -> (StatusCode, Value) {
    send(app, TestRequest::get(), path, token, None).await
}

struct Setup {
    admin: String,
    game: String,
    /// Statistique `kills` : identifiant (barème) et clé (résultats).
    kills_id: String,
    kills_key: String,
    players: Vec<String>,
}

/// Application sur PostgreSQL, un administrateur, un jeu avec la statistique `kills` et
/// `players` joueurs. Noms uniques : la base est partagée et jamais vidée.
async fn setup(players: usize) -> (app_type!(), Setup) {
    let url = std::env::var("DATABASE_URL").expect("DATABASE_URL");
    let pool = sqlx::PgPool::connect(&url).await.unwrap();
    let config = AuthConfig {
        jwt_secret: common::SECRET.into(),
        access_token_ttl: Duration::from_secs(900),
        refresh_token_ttl: Duration::from_secs(3600),
    };
    let store = PgStore::new(infra::CachedDb::new(
        pool.clone(),
        Arc::new(infra::MemoryCache::new()),
    ));
    let state = common::with_test_mailer(AppState::new(Arc::new(store), config).unwrap());
    let app = test::init_service(app(state)).await;
    let tag = &Uuid::new_v4().simple().to_string()[..10];
    let root = format!("root{tag}");
    logged_in_as(&app, &root, "secret123").await;
    sqlx::query("UPDATE users SET role = 'admin' WHERE username = $1")
        .bind(&root)
        .execute(&pool)
        .await
        .unwrap();
    let (_, session) = login(&app, &root, "secret123").await;
    let admin = access(&session).to_string();
    let (status, game) = post(
        &app,
        "/games",
        &admin,
        json!({ "name": format!("Jeu {tag}") }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{game}");
    let game = game["id"].as_str().unwrap().to_string();
    let (status, stat) = post(
        &app,
        "/stats",
        &admin,
        json!({ "name": format!("Kills {tag}"), "key": format!("kills_{tag}"), "type": "flat" }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{stat}");
    let kills_id = stat["id"].as_str().unwrap().to_string();
    let (status, _) = send(
        &app,
        TestRequest::put(),
        &format!("/games/{game}/stats/{kills_id}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let mut tokens = Vec::new();
    for index in 0..players {
        let session = logged_in_as(&app, &format!("p{index}{tag}"), "secret123").await;
        tokens.push(access(&session).to_string());
    }
    (
        app,
        Setup {
            admin,
            game,
            kills_id,
            kills_key: format!("kills_{tag}"),
            players: tokens,
        },
    )
}

/// Tournoi solo de `max` places, barème `kills` × 1.
async fn tournament(app: &app_type!(), s: &Setup, max: usize) -> String {
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
            "max_participants": max,
        }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{tournament}");
    let tid = tournament["id"].as_str().unwrap().to_string();
    let (status, rule) = post(
        app,
        &format!("/tournaments/{tid}/scoring-rules"),
        &s.admin,
        json!({ "stat_id": s.kills_id, "mode": "linear", "coefficient": 1 }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{rule}");
    tid
}

async fn set_status(app: &app_type!(), s: &Setup, tid: &str, status: &str) {
    let (code, body) = post(
        app,
        &format!("/tournaments/{tid}/status"),
        &s.admin,
        json!({ "status": status }),
    )
    .await;
    assert_eq!(code, StatusCode::OK, "{status} {body}");
}

/// Étape FFA lancée avec les quatre joueurs et `matches` matchs, chacun avec ses résultats
/// saisis (`kills` = 1 pour tout le monde) mais pas encore terminé.
async fn ffa_step(app: &app_type!(), s: &Setup, matches: usize) -> (String, String, Vec<String>) {
    let tid = tournament(app, s, 4).await;
    let (status, step) = post(
        app,
        &format!("/tournaments/{tid}/steps"),
        &s.admin,
        json!({
            "position": 1, "format": "pool", "match_type": "ffa", "group_count": 1,
            "group_size": 4, "matches_per_group": matches, "advance_per_group": 1,
        }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{step}");
    let step = step["id"].as_str().unwrap().to_string();
    set_status(app, s, &tid, "registration").await;
    for player in &s.players[..4] {
        let (status, body) = post(
            app,
            &format!("/tournaments/{tid}/participants"),
            player,
            json!({}),
        )
        .await;
        assert_eq!(status, StatusCode::CREATED, "{body}");
    }
    set_status(app, s, &tid, "ongoing").await;
    let (status, started) = post(
        app,
        &format!("/tournaments/{tid}/steps/{step}/start"),
        &s.admin,
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{started}");
    let (_, ranking) = get(
        app,
        &format!("/tournaments/{tid}/steps/{step}/ranking"),
        &s.admin,
    )
    .await;
    let group = ranking[0]["group_id"].as_str().unwrap().to_string();
    let ids: Vec<String> = ranking[0]["participants"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p["participant_id"].as_str().unwrap().to_string())
        .collect();
    let base = format!("/tournaments/{tid}/steps/{step}/matches");
    let mut paths = Vec::new();
    for _ in 0..matches {
        let (status, created) = post(
            app,
            &base,
            &s.admin,
            json!({ "group_id": group, "participant_ids": ids }),
        )
        .await;
        assert_eq!(status, StatusCode::CREATED, "{created}");
        let path = format!("{base}/{}", created["id"].as_str().unwrap());
        let results: Vec<Value> = ids
            .iter()
            .enumerate()
            .map(|(rank, id)| {
                json!({ "participant_id": id, "stats": { s.kills_key.as_str(): 1 }, "rank": rank + 1 })
            })
            .collect();
        let (status, saved) = send(
            app,
            TestRequest::put(),
            &format!("{path}/results"),
            &s.admin,
            Some(json!({ "results": results })),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{saved}");
        paths.push(path);
    }
    (format!("/tournaments/{tid}/steps/{step}"), tid, paths)
}

/// Points de chaque participant au classement de l'étape.
async fn step_points(app: &app_type!(), s: &Setup, step: &str) -> Vec<f64> {
    let (status, ranking) = get(app, &format!("{step}/ranking"), &s.admin).await;
    assert_eq!(status, StatusCode::OK, "{ranking}");
    ranking[0]["participants"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p["points"].as_f64().unwrap())
        .collect()
}

/// Plusieurs matchs d'un même groupe terminés en même temps : chaque participant garde les
/// points de tous ses matchs (aucune mise à jour perdue).
#[actix_web::test]
#[ignore = "nécessite PostgreSQL migré (DATABASE_URL)"]
async fn matches_finished_together_keep_every_point() {
    let (app, s) = setup(4).await;
    const MATCHES: usize = 6;
    let (step, _, paths) = ffa_step(&app, &s, MATCHES).await;
    let status_paths: Vec<String> = paths.iter().map(|p| format!("{p}/status")).collect();
    let finishes = status_paths
        .iter()
        .map(|path| post(&app, path, &s.admin, json!({ "status": "finished" })));
    let outcomes = futures_join_all(finishes).await;
    for (status, body) in &outcomes {
        assert_eq!(*status, StatusCode::OK, "{body}");
    }
    // `kills` = 1 par match, barème × 1 : MATCHES points chacun.
    assert_eq!(step_points(&app, &s, &step).await, vec![MATCHES as f64; 4]);
}

/// Terminer deux fois le même match en même temps : une seule fois compte.
#[actix_web::test]
#[ignore = "nécessite PostgreSQL migré (DATABASE_URL)"]
async fn finishing_a_match_twice_at_once_counts_once() {
    let (app, s) = setup(4).await;
    let (step, _, paths) = ffa_step(&app, &s, 2).await;
    let path = format!("{}/status", paths[0]);
    let attempts = (0..4).map(|_| post(&app, &path, &s.admin, json!({ "status": "finished" })));
    let outcomes = futures_join_all(attempts).await;
    let ok = outcomes
        .iter()
        .filter(|(s, _)| *s == StatusCode::OK)
        .count();
    assert_eq!(ok, 1, "{outcomes:?}");
    assert!(
        outcomes
            .iter()
            .all(|(s, _)| *s == StatusCode::OK || *s == StatusCode::CONFLICT),
        "{outcomes:?}"
    );
    assert_eq!(step_points(&app, &s, &step).await, vec![1.0; 4]);
}

/// Inscriptions simultanées au-delà de la capacité : exactement `max` réussissent.
#[actix_web::test]
#[ignore = "nécessite PostgreSQL migré (DATABASE_URL)"]
async fn simultaneous_registrations_never_exceed_the_capacity() {
    let (app, s) = setup(10).await;
    let tid = tournament(&app, &s, 4).await;
    set_status(&app, &s, &tid, "registration").await;
    let path = format!("/tournaments/{tid}/participants");
    let attempts = s
        .players
        .iter()
        .map(|player| post(&app, &path, player, json!({})));
    let outcomes = futures_join_all(attempts).await;
    let created = outcomes
        .iter()
        .filter(|(s, _)| *s == StatusCode::CREATED)
        .count();
    let full = outcomes
        .iter()
        .filter(|(_, b)| b["error"] == "tournament_full")
        .count();
    assert_eq!((created, full), (4, 6), "{outcomes:?}");
    let (_, participants) = get(&app, &path, &s.admin).await;
    let listed = participants
        .as_array()
        .or_else(|| participants["items"].as_array())
        .map(Vec::len)
        .unwrap();
    assert_eq!(listed, 4);
}

/// Exécute les futures ensemble, sur la tâche courante, et renvoie leurs résultats dans l'ordre.
async fn futures_join_all<F: std::future::Future>(
    futures: impl Iterator<Item = F>,
) -> Vec<F::Output> {
    let mut pinned: Vec<_> = futures.map(Box::pin).collect();
    let mut outputs: Vec<Option<F::Output>> = pinned.iter().map(|_| None).collect();
    std::future::poll_fn(|cx| {
        let mut pending = false;
        for (future, output) in pinned.iter_mut().zip(outputs.iter_mut()) {
            if output.is_none() {
                match future.as_mut().poll(cx) {
                    std::task::Poll::Ready(value) => *output = Some(value),
                    std::task::Poll::Pending => pending = true,
                }
            }
        }
        if pending {
            std::task::Poll::Pending
        } else {
            std::task::Poll::Ready(())
        }
    })
    .await;
    outputs.into_iter().map(Option::unwrap).collect()
}
