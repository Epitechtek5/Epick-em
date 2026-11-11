//! Import de tournois en deux temps (aperçu en lecture seule, puis confirmation), têtes de série et
//! traitement des résultats importés, sur un store en mémoire.

mod common;

use actix_web::http::StatusCode;
use actix_web::test::TestRequest;
use api_public::store::{
    ImportPlan, MemoryStore, Role, StepDefinition, StepFormat, StepPlan, StepStatus, StoreError,
    TournamentImport, TournamentInput, TournamentPlan, TournamentStatus,
};
use common::{access, app_with, call, logged_in_as, login, request};
use serde_json::{Value, json};
use std::sync::Arc;
use std::time::Duration;

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
    player: String,
    store: Arc<MemoryStore>,
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

async fn raw(app: &app_type!(), path: &str, token: &str, body: &str) -> (StatusCode, Value) {
    call(
        app,
        request(TestRequest::post(), path, Some(token)).set_payload(body.to_string()),
    )
    .await
}

async fn preview(app: &app_type!(), token: &str, file: &Value) -> (StatusCode, Value) {
    raw(app, "/tournaments/import/preview", token, &file.to_string()).await
}

async fn apply(app: &app_type!(), token: &str, id: &Value, confirm: bool) -> (StatusCode, Value) {
    post(
        app,
        "/tournaments/import/apply",
        token,
        json!({ "preview_id": id, "confirm_destructive": confirm }),
    )
    .await
}

/// Un administrateur, quatre joueurs et un jeu TFT doté de la statistique `kills`.
async fn setup() -> (app_type!(), Setup) {
    let store = Arc::new(MemoryStore::new());
    let app = app_with(store.clone(), Duration::from_secs(3600)).await;
    logged_in_as(&app, "root", "secret123").await;
    store.set_role("root", Role::Admin);
    let (_, session) = login(&app, "root", "secret123").await;
    let admin = access(&session).to_string();
    let (_, game) = post(&app, "/games", &admin, json!({ "name": "TFT" })).await;
    let game = game["id"].as_str().unwrap().to_string();
    let (_, stat) = post(
        &app,
        "/stats",
        &admin,
        json!({ "name": "Kills", "key": "kills", "type": "flat" }),
    )
    .await;
    let (status, _) = send(
        &app,
        TestRequest::put(),
        &format!("/games/{game}/stats/{}", stat["id"].as_str().unwrap()),
        &admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let mut player = String::new();
    for index in 0..4 {
        let session = logged_in_as(&app, &format!("player{index}"), "secret123").await;
        player = access(&session).to_string();
    }
    (
        app,
        Setup {
            admin,
            player,
            store,
        },
    )
}

/// Tournoi de quatre joueurs, élimination directe : une demi-finale terminée (les points du
/// fichier sont faux), une à jouer, une finale vide ; têtes de série 1 à 4.
fn bracket(name: &str) -> Value {
    json!({
        "game": "TFT", "name": name,
        "start_date": "2026-11-14T18:00:00Z", "end_date": "2026-11-15T18:00:00Z",
        "participant_type": "solo", "max_participants": 4,
        "scoring_rules": [{ "stat": "kills", "mode": "linear", "coefficient": 1.5 }],
        "participants": [
            { "user": "player0" }, { "user": "player1" },
            { "user": "player2" }, { "user": "player3" },
        ],
        "steps": [{
            "position": 1, "format": "single_elim", "match_type": "duel",
            "group_count": 1, "group_size": 4, "advance_per_group": 1, "status": "ongoing",
            "groups": [{ "index": 1, "participants": [
                { "user": "player0", "seed": 1 }, { "user": "player1", "seed": 4 },
                { "user": "player2", "seed": 2 }, { "user": "player3", "seed": 3 },
            ] }],
            "matches": [
                { "group": 1, "round": 1, "status": "finished", "next": 2, "participants": [
                    { "user": "player0", "stats": { "kills": 3 }, "points": 99 },
                    { "user": "player1", "stats": { "kills": 1 } },
                ] },
                { "group": 1, "round": 1, "status": "scheduled", "next": 2, "participants": [
                    { "user": "player2" }, { "user": "player3" },
                ] },
                { "group": 1, "round": 2, "status": "scheduled" },
            ],
        }],
    })
}

fn document(tournaments: Vec<Value>) -> Value {
    json!({ "version": 1, "tournaments": tournaments })
}

async fn tournaments(app: &app_type!(), token: &str) -> Vec<Value> {
    get(app, "/tournaments", token)
        .await
        .1
        .as_array()
        .unwrap()
        .clone()
}

async fn exported(app: &app_type!(), token: &str) -> Value {
    let response = actix_web::test::call_service(
        app,
        request(TestRequest::get(), "/tournaments/export", Some(token)).to_request(),
    )
    .await;
    serde_json::from_slice(&actix_web::test::read_body(response).await).unwrap()
}

#[actix_web::test]
async fn a_preview_describes_the_changes_and_writes_nothing() {
    let (app, s) = setup().await;
    let (status, body) = preview(&app, &s.admin, &document(vec![bracket("Cup")])).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["valid"], true);
    assert_eq!(body["requires_confirmation"], false);
    assert!(body["preview_id"].is_string());
    let tournament = &body["tournaments"][0];
    assert_eq!(
        (&tournament["name"], &tournament["action"]),
        (&json!("Cup"), &json!("create"))
    );
    let resources: Vec<(&str, &str, u64)> = tournament["changes"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| {
            (
                c["resource"].as_str().unwrap(),
                c["action"].as_str().unwrap(),
                c["after"].as_u64().unwrap(),
            )
        })
        .collect();
    assert_eq!(
        resources,
        [
            ("tournament", "create", 1),
            ("scoring_rules", "create", 1),
            ("participants", "create", 4),
            ("steps", "create", 1),
            ("matches", "create", 3),
        ]
    );
    let downstream = tournament["downstream"].to_string();
    assert!(
        downstream.contains("4 tête(s) de série") && downstream.contains("1 match(s) terminé(s)"),
        "{downstream}"
    );
    // Les points du fichier sont recalculés d'après le barème : un avertissement le dit.
    assert!(
        body["warnings"].to_string().contains("recalculés"),
        "{body}"
    );
    // Rien n'a été écrit.
    assert!(tournaments(&app, &s.admin).await.is_empty());
    assert_eq!(exported(&app, &s.admin).await["tournaments"], json!([]));
}

#[actix_web::test]
async fn invalid_files_have_structured_errors_and_cannot_be_applied() {
    let (app, s) = setup().await;
    let mut file = bracket("Cup");
    file["steps"][0]["groups"][0]["participants"][0]["seed"] = json!(2);
    let (status, body) = preview(&app, &s.admin, &document(vec![file])).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["valid"], false);
    assert!(body.get("preview_id").is_none());
    assert!(body["errors"].to_string().contains("tête"), "{body}");

    let (status, body) = raw(&app, "/tournaments/import/preview", &s.admin, "pas du json").await;
    assert_eq!((status, &body["valid"]), (StatusCode::OK, &json!(false)));
    let (status, body) = apply(&app, &s.admin, &json!(uuid()), false).await;
    assert_eq!(
        (status, body["error"].as_str().unwrap()),
        (StatusCode::GONE, "import_preview_expired")
    );
}

fn uuid() -> String {
    uuid::Uuid::new_v4().to_string()
}

#[actix_web::test]
async fn seeds_are_all_or_none_unique_and_from_one_to_the_participant_count() {
    let (app, s) = setup().await;
    for (label, mutate) in [
        ("doublon", json!([1, 1, 2, 3])),
        ("trou", json!([1, 2, 3, 5])),
        ("zéro", json!([0, 1, 2, 3])),
        ("partiel", json!([1, 2, 3, null])),
    ] {
        let mut file = bracket("Cup");
        for (index, seed) in mutate.as_array().unwrap().iter().enumerate() {
            file["steps"][0]["groups"][0]["participants"][index]["seed"] = seed.clone();
        }
        let (_, body) = preview(&app, &s.admin, &document(vec![file])).await;
        assert_eq!(body["valid"], false, "{label}: {body}");
        assert!(
            body["errors"].to_string().contains("seed"),
            "{label}: {body}"
        );
    }
    // Sans aucune tête de série (fichier d'avant) : accepté.
    let mut file = bracket("Cup");
    for index in 0..4 {
        file["steps"][0]["groups"][0]["participants"][index]
            .as_object_mut()
            .unwrap()
            .remove("seed");
    }
    let (_, body) = preview(&app, &s.admin, &document(vec![file])).await;
    assert_eq!(body["valid"], true, "{body}");
}

#[actix_web::test]
async fn confirming_writes_seeds_and_processes_results_like_the_api() {
    let (app, s) = setup().await;
    let (_, body) = preview(&app, &s.admin, &document(vec![bracket("Cup")])).await;
    let (status, report) = apply(&app, &s.admin, &body["preview_id"], false).await;
    assert_eq!(status, StatusCode::OK, "{report}");
    assert_eq!(report, json!({ "created": 1, "updated": 0 }));

    let step = &exported(&app, &s.admin).await["tournaments"][0]["steps"][0].clone();
    let members = step["groups"][0]["participants"].as_array().unwrap();
    let find = |user: &str| members.iter().find(|m| m["user"] == user).unwrap();
    // Les têtes de série sont écrites ; les points d'étape viennent des matchs terminés.
    assert_eq!(find("player1")["seed"], 4);
    assert_eq!(find("player2")["seed"], 2);
    assert_eq!(find("player0")["points"], 4.5);
    assert_eq!(find("player1")["points"], 1.5);
    assert_eq!(find("player2")["points"], 0.0);
    let matches = step["matches"].as_array().unwrap();
    let first = &matches[0];
    let winner = first["participants"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["user"] == "player0")
        .unwrap();
    assert_eq!(
        winner["points"], 4.5,
        "les points du fichier (99) sont recalculés"
    );
    assert_eq!(
        (&winner["rank"], &winner["result"]),
        (&json!(1), &json!("win"))
    );
    // Le vainqueur de la demi-finale terminée est avancé dans la finale, une seule fois.
    let final_match = matches.iter().find(|m| m["round"] == 2).unwrap();
    let finalists: Vec<&Value> = final_match["participants"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| &p["user"])
        .collect();
    assert_eq!(finalists, [&json!("player0")]);
}

#[actix_web::test]
async fn a_preview_is_single_use() {
    let (app, s) = setup().await;
    let (_, body) = preview(&app, &s.admin, &document(vec![bracket("Cup")])).await;
    let id = body["preview_id"].clone();
    assert_eq!(apply(&app, &s.admin, &id, false).await.0, StatusCode::OK);
    let before = exported(&app, &s.admin).await;
    let (status, error) = apply(&app, &s.admin, &id, true).await;
    assert_eq!(
        (status, error["error"].as_str().unwrap()),
        (StatusCode::GONE, "import_preview_expired")
    );
    // Rien n'a été écrit une seconde fois : mêmes points, mêmes matchs.
    assert_eq!(exported(&app, &s.admin).await, before);
}

#[actix_web::test]
async fn replacing_existing_data_needs_an_explicit_confirmation() {
    let (app, s) = setup().await;
    let (_, body) = preview(&app, &s.admin, &document(vec![bracket("Cup")])).await;
    apply(&app, &s.admin, &body["preview_id"], false).await;

    let mut changed = bracket("cup");
    changed["description"] = json!("Nouvelle édition");
    changed["steps"][0]["matches"][1]["status"] = json!("ongoing");
    let (_, body) = preview(&app, &s.admin, &document(vec![changed])).await;
    assert_eq!(body["valid"], true, "{body}");
    assert_eq!(body["requires_confirmation"], true);
    let tournament = &body["tournaments"][0];
    assert_eq!(tournament["action"], "update");
    assert_eq!(tournament["destructive"], true);
    let changes = tournament["changes"].as_array().unwrap();
    let of = |resource: &str| changes.iter().find(|c| c["resource"] == resource).unwrap();
    assert_eq!(of("tournament")["details"], "name, description");
    assert_eq!(of("steps")["action"], "replace");
    assert!(
        tournament["downstream"]
            .to_string()
            .contains("1 résultat(s)"),
        "{tournament}"
    );
    assert!(body["warnings"].to_string().contains("remplacés"), "{body}");

    let id = body["preview_id"].clone();
    let (status, error) = apply(&app, &s.admin, &id, false).await;
    assert_eq!(
        (status, error["error"].as_str().unwrap()),
        (StatusCode::CONFLICT, "import_confirmation_required")
    );
    // Le refus ne consomme pas l'aperçu : la confirmation explicite l'applique.
    let (status, report) = apply(&app, &s.admin, &id, true).await;
    assert_eq!(status, StatusCode::OK, "{report}");
    assert_eq!(report, json!({ "created": 0, "updated": 1 }));
    assert_eq!(tournaments(&app, &s.admin).await.len(), 1);
}

#[actix_web::test]
async fn a_preview_is_refused_when_the_database_changed_since() {
    let (app, s) = setup().await;
    let (_, body) = preview(&app, &s.admin, &document(vec![bracket("Cup")])).await;
    let id = body["preview_id"].clone();
    // Entre l'aperçu et la confirmation, un autre import crée le même tournoi.
    let (status, _) = raw(
        &app,
        "/tournaments/import",
        &s.admin,
        &document(vec![bracket("Cup")]).to_string(),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let before = exported(&app, &s.admin).await;
    let (status, error) = apply(&app, &s.admin, &id, true).await;
    assert_eq!(
        (status, error["error"].as_str().unwrap()),
        (StatusCode::CONFLICT, "import_preview_stale")
    );
    assert_eq!(exported(&app, &s.admin).await, before);
    // Périmé une fois, l'aperçu ne revient pas.
    assert_eq!(apply(&app, &s.admin, &id, true).await.0, StatusCode::GONE);
}

#[actix_web::test]
async fn previews_belong_to_their_administrator_and_need_an_administrator() {
    let (app, s) = setup().await;
    let file = document(vec![bracket("Cup")]);
    let (status, _) = preview(&app, &s.player, &file).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = apply(&app, &s.player, &json!(uuid()), true).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = call(
        &app,
        request(TestRequest::post(), "/tournaments/import/preview", None).set_payload("{}"),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[actix_web::test]
async fn running_tournaments_are_still_locked_against_import() {
    let (app, s) = setup().await;
    let mut file = bracket("Cup");
    file["status"] = json!("ongoing");
    let (status, body) = raw(
        &app,
        "/tournaments/import",
        &s.admin,
        &document(vec![file.clone()]).to_string(),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let (_, body) = preview(&app, &s.admin, &document(vec![bracket("Cup")])).await;
    assert_eq!(body["valid"], false, "{body}");
    assert!(body["errors"].to_string().contains("en cours"), "{body}");
}

#[actix_web::test]
async fn csv_files_are_previewed_like_json_ones() {
    let (app, s) = setup().await;
    let (_, _) = raw(
        &app,
        "/tournaments/import",
        &s.admin,
        &document(vec![bracket("Cup")]).to_string(),
    )
    .await;
    let response = actix_web::test::call_service(
        &app,
        request(
            TestRequest::get(),
            "/tournaments/export?format=csv",
            Some(&s.admin),
        )
        .to_request(),
    )
    .await;
    let csv = String::from_utf8(actix_web::test::read_body(response).await.to_vec()).unwrap();
    let (status, body) = raw(
        &app,
        "/tournaments/import/preview?format=csv",
        &s.admin,
        &csv,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["valid"], true, "{body}");
    assert_eq!(body["tournaments"][0]["action"], "update");
    let (status, report) = apply(&app, &s.admin, &body["preview_id"], true).await;
    assert_eq!(
        (status, report),
        (StatusCode::OK, json!({ "created": 0, "updated": 1 }))
    );
    // Le seeding survit à l'aller-retour CSV.
    let after = exported(&app, &s.admin).await;
    assert_eq!(
        after["tournaments"][0]["steps"][0]["groups"][0]["participants"][1]["seed"],
        4
    );
}

/// Un plan dont l'écriture échoue en cours de route (deux étapes à la même position) ne laisse
/// aucune trace : le tournoi existant garde son contenu.
#[actix_web::test]
async fn a_failing_plan_leaves_existing_data_unchanged() {
    let (app, s) = setup().await;
    let (_, body) = preview(&app, &s.admin, &document(vec![bracket("Cup")])).await;
    apply(&app, &s.admin, &body["preview_id"], false).await;
    let before = exported(&app, &s.admin).await;

    let tournament = tournaments(&app, &s.admin).await.remove(0);
    let import = TournamentImport {
        input: TournamentInput {
            game_id: tournament["game_id"].as_str().unwrap().parse().unwrap(),
            name: "Cup".into(),
            description: Some("écrasé ?".into()),
            start_date: "2026-11-14T18:00:00.000000Z".into(),
            end_date: "2026-11-15T18:00:00.000000Z".into(),
            registration_open_at: None,
            registration_close_at: None,
            participant_type: api_public::store::ParticipantType::Solo,
            team_size: None,
            max_participants: 4,
            team_scoring_mode: api_public::store::TeamScoringMode::None,
            team_scoring_n: None,
        },
        status: TournamentStatus::Draft,
        rules: Vec::new(),
    };
    let step = || StepPlan {
        definition: StepDefinition {
            position: 1,
            format: StepFormat::Pool,
            match_type: api_public::store::MatchType::Ffa,
            group_count: 1,
            group_size: 4,
            matches_per_group: 1,
            advance_per_group: 2,
            tiebreak: json!([]),
        },
        status: StepStatus::Pending,
        groups: Vec::new(),
        matches: Vec::new(),
    };
    use api_public::store::AuthStore;
    let result = s
        .store
        .apply_import(ImportPlan {
            tournaments: vec![TournamentPlan {
                import,
                teams: Vec::new(),
                participants: Vec::new(),
                steps: vec![step(), step()],
            }],
        })
        .await;
    assert!(
        matches!(result, Err(StoreError::StepPositionTaken)),
        "{result:?}"
    );
    assert_eq!(exported(&app, &s.admin).await, before);
}
