//! Parcours HTTP du moteur d'invitations (équipes, équipes de tournoi, tournois, liens), sur un
//! store en mémoire.

mod common;

use actix_web::http::StatusCode;
use actix_web::test::{self, TestRequest};
use api_public::config::AuthConfig;
use api_public::invitations::MemoryInvitationNotifier;
use api_public::store::{InvitationEventKind, MemoryStore, Role};
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
    store: Arc<MemoryStore>,
    notifier: Arc<MemoryInvitationNotifier>,
    admin: String,
    alice: Account,
    bob: Account,
    carol: Account,
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

fn error_code(value: &Value) -> &str {
    value["error"].as_str().unwrap_or_default()
}

fn id(value: &Value) -> &str {
    value["id"].as_str().unwrap()
}

async fn setup() -> (app_type!(), Setup) {
    let store = Arc::new(MemoryStore::new());
    let notifier = Arc::new(MemoryInvitationNotifier::new());
    let config = AuthConfig {
        jwt_secret: SECRET.into(),
        access_token_ttl: Duration::from_secs(900),
        refresh_token_ttl: Duration::from_secs(3600),
    };
    let state = AppState::new(store.clone(), config).unwrap();
    let state = common::with_test_mailer(state).with_invitation_notifier(notifier.clone());
    let app = test::init_service(app(state)).await;
    logged_in_as(&app, "root", "secret123").await;
    store.set_role("root", Role::Admin);
    let (_, session) = login(&app, "root", "secret123").await;
    let admin = access(&session).to_string();
    let alice = account(&app, "alice").await;
    let bob = account(&app, "bob").await;
    let carol = account(&app, "carol").await;
    let (status, game) = post(&app, "/games", &admin, json!({ "name": "Valorant" })).await;
    assert_eq!(status, StatusCode::CREATED);
    let game = id(&game).to_string();
    let setup = Setup {
        store,
        notifier,
        admin,
        alice,
        bob,
        carol,
        game,
    };
    (app, setup)
}

async fn create_team(app: &app_type!(), s: &Setup, token: &str) -> String {
    let (status, team) = post(
        app,
        "/teams",
        token,
        json!({ "game_id": s.game, "name": format!("Team {}", Uuid::new_v4()) }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{team}");
    id(&team).to_string()
}

async fn invite(app: &app_type!(), token: &str, body: Value) -> (StatusCode, Value) {
    post(app, "/invitations", token, body).await
}

async fn invite_to_team(app: &app_type!(), token: &str, team: &str, user: &str) -> Value {
    let (status, invitation) = invite(
        app,
        token,
        json!({ "type": "team", "resource_id": team, "recipient_id": user }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{invitation}");
    invitation
}

async fn team_members(app: &app_type!(), token: &str, team: &str) -> Vec<Value> {
    let (status, members) = get(app, &format!("/teams/{team}/members"), token).await;
    assert_eq!(status, StatusCode::OK);
    members.as_array().unwrap().clone()
}

async fn open_tournament(app: &app_type!(), s: &Setup, max: u32, status: &str) -> String {
    let (code, tournament) = post(
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
    assert_eq!(code, StatusCode::CREATED, "{tournament}");
    let tournament = id(&tournament).to_string();
    if status != "draft" {
        let (code, body) = post(
            app,
            &format!("/tournaments/{tournament}/status"),
            &s.admin,
            json!({ "status": status }),
        )
        .await;
        assert_eq!(code, StatusCode::OK, "{body}");
    }
    tournament
}

#[actix_web::test]
async fn every_route_requires_a_token() {
    let (app, _) = setup().await;
    let (a, token) = (Uuid::new_v4(), "abc");
    let routes = [
        (TestRequest::get(), "/invitations".to_string()),
        (TestRequest::post(), "/invitations".to_string()),
        (TestRequest::get(), format!("/invitations/{a}")),
        (TestRequest::get(), format!("/invitations/{a}/events")),
        (TestRequest::post(), format!("/invitations/{a}/accept")),
        (TestRequest::post(), format!("/invitations/{a}/decline")),
        (TestRequest::post(), format!("/invitations/{a}/revoke")),
        (TestRequest::get(), format!("/invitation-links/{token}")),
        (
            TestRequest::post(),
            format!("/invitation-links/{token}/accept"),
        ),
    ];
    for (method, path) in routes {
        let (status, _) = call(&app, request(method, &path, None)).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED, "{path}");
    }
}

#[actix_web::test]
async fn team_invitation_lifecycle_creates_the_membership() {
    let (app, s) = setup().await;
    let team = create_team(&app, &s, &s.alice.token).await;
    let invitation = invite_to_team(&app, &s.alice.token, &team, &s.bob.id).await;
    let inv = id(&invitation).to_string();
    assert_eq!(invitation["status"], "pending");
    assert_eq!(invitation["role"], "member");
    assert_eq!(invitation["is_link"], false);
    assert!(invitation.get("token").is_none_or(Value::is_null));

    // Listes reçues / envoyées, filtres et pagination.
    let (_, incoming) = get(&app, "/invitations", &s.bob.token).await;
    assert_eq!(incoming["total"], 1);
    assert_eq!(incoming["items"][0]["id"], inv);
    let (_, outgoing) = get(&app, "/invitations?direction=outgoing", &s.alice.token).await;
    assert_eq!(outgoing["total"], 1);
    let (_, none) = get(&app, "/invitations", &s.alice.token).await;
    assert_eq!(none["total"], 0);
    let (_, filtered) = get(&app, "/invitations?status=accepted&type=team", &s.bob.token).await;
    assert_eq!(filtered["total"], 0);
    let (_, paged) = get(&app, "/invitations?limit=1&offset=1", &s.bob.token).await;
    assert_eq!(
        (
            paged["items"].as_array().unwrap().len(),
            paged["total"].as_i64()
        ),
        (0, Some(1))
    );

    // Une invitation étrangère reste introuvable ; l'administrateur la voit.
    let path = format!("/invitations/{inv}");
    assert_eq!(
        get(&app, &path, &s.carol.token).await.0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(get(&app, &path, &s.admin).await.0, StatusCode::OK);

    // Seul l'invité répond : ni l'invitant, ni un tiers.
    for token in [&s.alice.token, &s.carol.token] {
        let (status, _) = post(&app, &format!("{path}/accept"), token, json!({})).await;
        assert_eq!(status, StatusCode::NOT_FOUND);
    }
    assert_eq!(team_members(&app, &s.alice.token, &team).await.len(), 1);

    let (status, accepted) = post(&app, &format!("{path}/accept"), &s.bob.token, json!({})).await;
    assert_eq!(status, StatusCode::OK, "{accepted}");
    assert_eq!(accepted["status"], "accepted");
    assert!(accepted["responded_at"].is_string());
    let members = team_members(&app, &s.alice.token, &team).await;
    assert!(
        members
            .iter()
            .any(|m| m["user_id"] == s.bob.id && m["role"] == "member")
    );

    // Pas de seconde acceptation ni de refus tardif.
    for action in ["accept", "decline"] {
        let (status, error) =
            post(&app, &format!("{path}/{action}"), &s.bob.token, json!({})).await;
        assert_eq!(
            (status, error_code(&error)),
            (StatusCode::CONFLICT, "invitation_not_pending")
        );
    }

    let (_, events) = get(&app, &format!("{path}/events"), &s.alice.token).await;
    let kinds: Vec<_> = events
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["kind"].as_str().unwrap())
        .collect();
    assert_eq!(kinds, ["created", "accepted"]);

    tokio::task::yield_now().await;
    assert_eq!(
        s.notifier.kinds(),
        [InvitationEventKind::Created, InvitationEventKind::Accepted]
    );
}

#[actix_web::test]
async fn creation_rules_are_enforced() {
    let (app, s) = setup().await;
    let team = create_team(&app, &s, &s.alice.token).await;
    let body = |extra: Value| {
        let mut body = json!({ "type": "team", "resource_id": team, "recipient_id": s.bob.id });
        for (key, value) in extra.as_object().unwrap() {
            body[key] = value.clone();
        }
        body
    };
    // Seul le propriétaire invite, administrateur compris.
    for token in [&s.carol.token, &s.admin] {
        let (status, _) = invite(&app, token, body(json!({}))).await;
        assert_eq!(status, StatusCode::FORBIDDEN);
    }
    let (status, error) = invite(&app, &s.alice.token, body(json!({ "role": "owner" }))).await;
    assert_eq!(
        (status, error_code(&error)),
        (StatusCode::BAD_REQUEST, "invalid_request")
    );
    let (status, _) = invite(
        &app,
        &s.alice.token,
        body(json!({ "recipient_id": s.alice.id })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, _) = invite(
        &app,
        &s.alice.token,
        body(json!({ "recipient_id": Uuid::new_v4() })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, _) = invite(&app, &s.alice.token, body(json!({ "max_uses": 3 }))).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, _) = invite(&app, &s.alice.token, body(json!({ "expires_in_hours": 0 }))).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, _) = invite(
        &app,
        &s.alice.token,
        body(json!({ "expires_in_hours": 24 * 31 })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, _) = invite(
        &app,
        &s.alice.token,
        json!({ "type": "team", "resource_id": Uuid::new_v4(), "recipient_id": s.bob.id }),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    let (status, _) = invite(
        &app,
        &s.alice.token,
        body(json!({ "role": "substitute", "expires_in_hours": 2 })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    // Pas de doublon actif.
    let (status, error) = invite(&app, &s.alice.token, body(json!({}))).await;
    assert_eq!(
        (status, error_code(&error)),
        (StatusCode::CONFLICT, "invitation_already_pending")
    );
    // Ni d'invitation d'un membre actuel.
    let (status, error) = invite(
        &app,
        &s.alice.token,
        body(json!({ "recipient_id": s.alice.id })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{error}");
}

#[actix_web::test]
async fn decline_revoke_and_expiry() {
    let (app, s) = setup().await;
    let team = create_team(&app, &s, &s.alice.token).await;

    let first = invite_to_team(&app, &s.alice.token, &team, &s.bob.id).await;
    let (status, declined) = post(
        &app,
        &format!("/invitations/{}/decline", id(&first)),
        &s.bob.token,
        json!({}),
    )
    .await;
    assert_eq!(
        (status, declined["status"].as_str()),
        (StatusCode::OK, Some("declined"))
    );
    assert_eq!(team_members(&app, &s.alice.token, &team).await.len(), 1);

    // Une invitation refusée n'empêche pas d'en refaire une.
    let second = invite_to_team(&app, &s.alice.token, &team, &s.bob.id).await;
    let path = format!("/invitations/{}", id(&second));
    let (status, _) = post(&app, &format!("{path}/revoke"), &s.bob.token, json!({})).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = post(&app, &format!("{path}/revoke"), &s.carol.token, json!({})).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, revoked) = post(&app, &format!("{path}/revoke"), &s.alice.token, json!({})).await;
    assert_eq!(
        (status, revoked["status"].as_str()),
        (StatusCode::OK, Some("revoked"))
    );
    let (status, error) = post(&app, &format!("{path}/accept"), &s.bob.token, json!({})).await;
    assert_eq!(
        (status, error_code(&error)),
        (StatusCode::CONFLICT, "invitation_not_pending")
    );

    // Expiration : l'acceptation est refusée et le statut enregistré.
    let third = invite_to_team(&app, &s.alice.token, &team, &s.bob.id).await;
    let expired_id = Uuid::parse_str(id(&third)).unwrap();
    s.store.expire_invitation_now(expired_id);
    let path = format!("/invitations/{expired_id}");
    let (status, _) = get(&app, &path, &s.bob.token).await;
    assert_eq!(status, StatusCode::OK);
    let (_, current) = get(&app, &path, &s.bob.token).await;
    assert_eq!(current["status"], "expired");
    let (status, error) = post(&app, &format!("{path}/accept"), &s.bob.token, json!({})).await;
    assert_eq!(
        (status, error_code(&error)),
        (StatusCode::CONFLICT, "invitation_not_pending")
    );
    let (_, events) = get(&app, &format!("{path}/events"), &s.alice.token).await;
    assert_eq!(
        events.as_array().unwrap().last().unwrap()["kind"],
        "expired"
    );
    assert_eq!(team_members(&app, &s.alice.token, &team).await.len(), 1);

    // Une invitation échue mais pas encore purgée répond 410 à l'acceptation.
    let fourth = invite_to_team(&app, &s.alice.token, &team, &s.bob.id).await;
    let fourth_id = Uuid::parse_str(id(&fourth)).unwrap();
    s.store.expire_invitation_now(fourth_id);
    let (status, error) = post(
        &app,
        &format!("/invitations/{fourth_id}/accept"),
        &s.bob.token,
        json!({}),
    )
    .await;
    assert_eq!(
        (status, error_code(&error)),
        (StatusCode::GONE, "invitation_expired")
    );
    let (_, current) = get(&app, &format!("/invitations/{fourth_id}"), &s.bob.token).await;
    assert_eq!(current["status"], "expired");
    tokio::task::yield_now().await;
    assert!(s.notifier.kinds().contains(&InvitationEventKind::Expired));
}

#[actix_web::test]
async fn links_are_secure_single_use_and_revocable() {
    let (app, s) = setup().await;
    let team = create_team(&app, &s, &s.alice.token).await;
    let (status, created) = invite(
        &app,
        &s.alice.token,
        json!({ "type": "team", "resource_id": team, "role": "substitute" }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    let token = created["token"].as_str().unwrap().to_string();
    assert_eq!(created["is_link"], true);
    assert_eq!(created["max_uses"], 1);
    assert!(
        created["link"]
            .as_str()
            .unwrap()
            .ends_with(&format!("/invite/{token}"))
    );
    // Le jeton n'est jamais relisible.
    let (_, detail) = get(
        &app,
        &format!("/invitations/{}", id(&created)),
        &s.alice.token,
    )
    .await;
    assert!(!detail.to_string().contains(&token));
    assert!(!detail.to_string().contains("token_hash"));
    // Les liens ne s'acceptent pas par identifiant.
    let (status, _) = post(
        &app,
        &format!("/invitations/{}/accept", id(&created)),
        &s.bob.token,
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    // Aperçu sans information privée.
    let link = format!("/invitation-links/{token}");
    let (status, preview) = get(&app, &link, &s.bob.token).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(preview["type"], "team");
    assert_eq!(preview["inviter_username"], "alice");
    assert_eq!(preview["role"], "substitute");
    assert!(preview.get("inviter_id").is_none() && preview.get("id").is_none());

    let (status, accepted) = post(&app, &format!("{link}/accept"), &s.bob.token, json!({})).await;
    assert_eq!(status, StatusCode::OK, "{accepted}");
    let members = team_members(&app, &s.alice.token, &team).await;
    assert!(
        members
            .iter()
            .any(|m| m["user_id"] == s.bob.id && m["role"] == "substitute")
    );

    // Usage unique : plus réutilisable après l'acceptation.
    assert_eq!(
        get(&app, &link, &s.carol.token).await.0,
        StatusCode::NOT_FOUND
    );
    let (status, _) = post(&app, &format!("{link}/accept"), &s.carol.token, json!({})).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(team_members(&app, &s.alice.token, &team).await.len(), 2);
    assert_eq!(
        get(&app, "/invitation-links/inconnu", &s.carol.token)
            .await
            .0,
        StatusCode::NOT_FOUND
    );
}

#[actix_web::test]
async fn multi_use_links_stop_at_the_limit_and_can_be_revoked_or_expire() {
    let (app, s) = setup().await;
    let team = create_team(&app, &s, &s.alice.token).await;
    let (_, created) = invite(
        &app,
        &s.alice.token,
        json!({ "type": "team", "resource_id": team, "max_uses": 2 }),
    )
    .await;
    let link = format!("/invitation-links/{}", created["token"].as_str().unwrap());
    for user in [&s.bob, &s.carol] {
        let (status, body) = post(&app, &format!("{link}/accept"), &user.token, json!({})).await;
        assert_eq!(status, StatusCode::OK, "{body}");
    }
    let (_, detail) = get(
        &app,
        &format!("/invitations/{}", id(&created)),
        &s.alice.token,
    )
    .await;
    assert_eq!(
        (detail["status"].as_str(), detail["uses"].as_i64()),
        (Some("accepted"), Some(2))
    );

    // Un membre actuel ne peut pas réutiliser un lien encore valide.
    let (_, again) = invite(
        &app,
        &s.alice.token,
        json!({ "type": "team", "resource_id": team, "max_uses": 5 }),
    )
    .await;
    let again_link = format!("/invitation-links/{}", again["token"].as_str().unwrap());
    let (status, error) = post(
        &app,
        &format!("{again_link}/accept"),
        &s.bob.token,
        json!({}),
    )
    .await;
    assert_eq!(
        (status, error_code(&error)),
        (StatusCode::CONFLICT, "already_team_member")
    );

    // Révocation : le lien cesse de fonctionner.
    let (status, _) = post(
        &app,
        &format!("/invitations/{}/revoke", id(&again)),
        &s.alice.token,
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        get(&app, &again_link, &s.bob.token).await.0,
        StatusCode::NOT_FOUND
    );

    // Expiration : idem.
    let (_, short) = invite(
        &app,
        &s.alice.token,
        json!({ "type": "team", "resource_id": team }),
    )
    .await;
    s.store
        .expire_invitation_now(Uuid::parse_str(id(&short)).unwrap());
    let link = format!("/invitation-links/{}", short["token"].as_str().unwrap());
    assert_eq!(get(&app, &link, &s.admin).await.0, StatusCode::NOT_FOUND);
    let (status, _) = post(&app, &format!("{link}/accept"), &s.admin, json!({})).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[actix_web::test]
async fn concurrent_acceptances_of_a_single_use_link_admit_one_account() {
    let (app, s) = setup().await;
    let team = create_team(&app, &s, &s.alice.token).await;
    let (_, created) = invite(
        &app,
        &s.alice.token,
        json!({ "type": "team", "resource_id": team }),
    )
    .await;
    let path = format!(
        "/invitation-links/{}/accept",
        created["token"].as_str().unwrap()
    );
    let (a, b) = tokio::join!(
        post(&app, &path, &s.bob.token, json!({})),
        post(&app, &path, &s.carol.token, json!({}))
    );
    let mut statuses = [a.0, b.0];
    statuses.sort();
    assert_eq!(statuses, [StatusCode::OK, StatusCode::NOT_FOUND]);
    assert_eq!(team_members(&app, &s.alice.token, &team).await.len(), 2);
}

#[actix_web::test]
async fn tournament_invitations_register_solo_players_within_the_rules() {
    let (app, s) = setup().await;
    let tournament = open_tournament(&app, &s, 1, "registration").await;
    let body = |user: &str| json!({ "type": "tournament", "resource_id": tournament, "recipient_id": user });
    // Réservé aux administrateurs, sans rôle.
    let (status, _) = invite(&app, &s.alice.token, body(&s.bob.id)).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = invite(
        &app,
        &s.admin,
        json!({ "type": "tournament", "resource_id": tournament, "recipient_id": s.bob.id, "role": "member" }),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (_, to_bob) = invite(&app, &s.admin, body(&s.bob.id)).await;
    let (_, to_carol) = invite(&app, &s.admin, body(&s.carol.id)).await;

    let (status, _) = post(
        &app,
        &format!("/invitations/{}/accept", id(&to_bob)),
        &s.bob.token,
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (_, participants) = get(
        &app,
        &format!("/tournaments/{tournament}/participants"),
        &s.admin,
    )
    .await;
    assert_eq!(participants.as_array().unwrap().len(), 1);
    assert_eq!(participants[0]["user_id"], s.bob.id);

    // Capacité revalidée à l'acceptation.
    let (status, error) = post(
        &app,
        &format!("/invitations/{}/accept", id(&to_carol)),
        &s.carol.token,
        json!({}),
    )
    .await;
    assert_eq!(
        (status, error_code(&error)),
        (StatusCode::CONFLICT, "tournament_full")
    );
    let (_, still) = get(
        &app,
        &format!("/invitations/{}", id(&to_carol)),
        &s.carol.token,
    )
    .await;
    assert_eq!(still["status"], "pending");

    // Inscriptions fermées (brouillon) : indisponible.
    let draft = open_tournament(&app, &s, 4, "draft").await;
    let (_, invitation) = invite(
        &app,
        &s.admin,
        json!({ "type": "tournament", "resource_id": draft, "recipient_id": s.alice.id }),
    )
    .await;
    let (status, error) = post(
        &app,
        &format!("/invitations/{}/accept", id(&invitation)),
        &s.alice.token,
        json!({}),
    )
    .await;
    assert_eq!(
        (status, error_code(&error)),
        (StatusCode::CONFLICT, "invitation_unavailable")
    );
}

#[actix_web::test]
async fn tournament_team_invitations_add_members_with_the_chosen_role() {
    let (app, s) = setup().await;
    let tournament = open_tournament(&app, &s, 8, "registration").await;
    let (status, team) = post(
        &app,
        &format!("/tournaments/{tournament}/teams"),
        &s.alice.token,
        json!({ "name": "Rocket" }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{team}");
    let team = id(&team).to_string();
    let body = |token: &str, user: &str, role: &str| {
        let _ = token;
        json!({ "type": "tournament_team", "resource_id": team, "recipient_id": user, "role": role })
    };
    let (status, _) = invite(&app, &s.bob.token, body("", &s.carol.id, "member")).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = invite(&app, &s.alice.token, body("", &s.bob.id, "owner")).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (_, invitation) = invite(&app, &s.alice.token, body("", &s.bob.id, "substitute")).await;
    let (status, _) = post(
        &app,
        &format!("/invitations/{}/accept", id(&invitation)),
        &s.bob.token,
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (_, members) = get(
        &app,
        &format!("/tournament-teams/{team}/members"),
        &s.alice.token,
    )
    .await;
    assert!(
        members
            .as_array()
            .unwrap()
            .iter()
            .any(|m| m["user_id"] == s.bob.id && m["role"] == "substitute")
    );
    // Déjà dans une équipe du tournoi : nouvelle invitation refusée.
    let (status, _) = invite(&app, &s.alice.token, body("", &s.bob.id, "member")).await;
    assert_eq!(status, StatusCode::CONFLICT);
}

#[actix_web::test]
async fn acceptance_revalidates_the_resource() {
    let (app, s) = setup().await;
    let team = create_team(&app, &s, &s.alice.token).await;
    let invitation = invite_to_team(&app, &s.alice.token, &team, &s.bob.id).await;
    // L'équipe est supprimée entre-temps.
    let (status, _) = send(
        &app,
        TestRequest::delete(),
        &format!("/teams/{team}"),
        &s.alice.token,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (status, error) = post(
        &app,
        &format!("/invitations/{}/accept", id(&invitation)),
        &s.bob.token,
        json!({}),
    )
    .await;
    assert_eq!(
        (status, error_code(&error)),
        (StatusCode::CONFLICT, "invitation_unavailable")
    );
}
