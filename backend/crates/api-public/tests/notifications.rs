//! Réglages du compte, appareils push et moteur de notifications, sur un store en mémoire.

mod common;

use actix_web::http::StatusCode;
use actix_web::test::TestRequest;
use api_public::AppState;
use api_public::config::AuthConfig;
use api_public::mail::MemoryMailer;
use api_public::notifications::{
    Audience, Catalog, Event, EventDefinition, Notifier, team_member_added,
};
use api_public::push::MemoryPush;
use api_public::store::{
    AuthStore, Category, Channel, MemoryStore, Platform, Role, SettingsUpdate, UserSettings,
};
use common::{
    PUBLIC_URL, SECRET, access, app_with_services, call, eventually, logged_in_as, login, request,
};
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

const ALICE_PUSH: &str = "ExponentPushToken[alice-device-1]";
const BOB_PUSH: &str = "ExponentPushToken[bob-device-1]";

struct Env {
    store: Arc<MemoryStore>,
    mailer: Arc<MemoryMailer>,
    push: Arc<MemoryPush>,
    admin: String,
    alice: String,
    alice_id: Uuid,
    bob: String,
    bob_id: Uuid,
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

async fn user_id(store: &MemoryStore, name: &str) -> Uuid {
    store.find_user_by_username(name).await.unwrap().unwrap().id
}

async fn env() -> (app_type!(), Env) {
    let store = Arc::new(MemoryStore::new());
    let mailer = Arc::new(MemoryMailer::new());
    let push = Arc::new(MemoryPush::new());
    let app = app_with_services(store.clone(), mailer.clone(), push.clone()).await;
    logged_in_as(&app, "root", "secret123").await;
    store.set_role("root", Role::Admin);
    let (_, session) = login(&app, "root", "secret123").await;
    let admin = access(&session).to_string();
    let alice = access(&logged_in_as(&app, "alice", "secret123").await).to_string();
    let bob = access(&logged_in_as(&app, "bob", "secret123").await).to_string();
    let env = Env {
        alice_id: user_id(&store, "alice").await,
        bob_id: user_id(&store, "bob").await,
        store,
        mailer,
        push,
        admin,
        alice,
        bob,
    };
    (app, env)
}

fn state(env: &Env) -> AppState {
    AppState::new(
        env.store.clone(),
        AuthConfig {
            jwt_secret: SECRET.into(),
            access_token_ttl: Duration::from_secs(900),
            refresh_token_ttl: Duration::from_secs(3600),
        },
    )
    .unwrap()
    .with_mailer(env.mailer.clone(), PUBLIC_URL)
    .with_push(env.push.clone())
    .with_retry_delay(Duration::ZERO)
}

fn member_added(env: &Env, key: &str) -> Event {
    team_member_added(Uuid::new_v4(), "Les Aigles", env.alice_id, key)
}

#[actix_web::test]
async fn settings_default_then_update_partially() {
    let (app, e) = env().await;
    let (status, settings) = send(&app, TestRequest::get(), "/me/settings", &e.alice, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(settings["language"], "fr");
    assert_eq!(settings["theme"], "system");
    for category in [
        "tournaments",
        "teams",
        "matches",
        "predictions",
        "pickem",
        "rankings",
        "account",
    ] {
        assert_eq!(
            settings["notifications"][category],
            json!({"email": true, "push": true})
        );
    }

    let patch = |body: Value| {
        let (app, token) = (&app, e.alice.clone());
        async move {
            send(
                app,
                TestRequest::patch(),
                "/me/settings",
                &token,
                Some(body),
            )
            .await
        }
    };
    let (status, settings) = patch(json!({"language": "es"})).await;
    assert_eq!(
        (status, &settings["language"], &settings["theme"]),
        (StatusCode::OK, &json!("es"), &json!("system"))
    );
    let (_, settings) =
        patch(json!({"theme": "dark", "notifications": {"teams": {"email": false}}})).await;
    assert_eq!(settings["theme"], "dark");
    assert_eq!(settings["language"], "es");
    assert_eq!(
        settings["notifications"]["teams"],
        json!({"email": false, "push": true})
    );
    // Une seconde modification fusionne avec la précédente au lieu de la remplacer.
    let (_, settings) =
        patch(json!({"notifications": {"teams": {"push": false}, "matches": {"push": false}}}))
            .await;
    assert_eq!(
        settings["notifications"]["teams"],
        json!({"email": false, "push": false})
    );
    assert_eq!(
        settings["notifications"]["matches"],
        json!({"email": true, "push": false})
    );
    let (_, again) = send(&app, TestRequest::get(), "/me/settings", &e.alice, None).await;
    assert_eq!(again, settings);

    // Chacun a ses propres réglages.
    let (_, bob) = send(&app, TestRequest::get(), "/me/settings", &e.bob, None).await;
    assert_eq!(bob["language"], "fr");
    assert_eq!(
        bob["notifications"]["teams"],
        json!({"email": true, "push": true})
    );
}

#[actix_web::test]
async fn settings_updates_are_validated_and_authenticated() {
    let (app, e) = env().await;
    for body in [
        json!({}),
        json!({"notifications": {}}),
        json!({"notifications": {"teams": {}}}),
        json!({"language": "de"}),
        json!({"theme": "neon"}),
        json!({"notifications": {"spam": {"email": true}}}),
        json!({"notifications": {"teams": {"sms": true}}}),
        json!({"notifications": {"teams": {"email": "oui"}}}),
        json!({"unknown": 1}),
    ] {
        let (status, error) = send(
            &app,
            TestRequest::patch(),
            "/me/settings",
            &e.alice,
            Some(body.clone()),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{body} {error}");
    }
    for (method, path) in [
        (TestRequest::get(), "/me/settings"),
        (TestRequest::patch(), "/me/settings"),
        (TestRequest::post(), "/me/push-tokens"),
        (TestRequest::delete(), "/me/push-tokens"),
    ] {
        let (status, _) = call(&app, request(method, path, None).set_json(json!({}))).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED, "{path}");
    }
    // Un jeton d'accès dont le compte n'existe plus ne lit ni ne crée de réglages.
    assert_eq!(
        send(&app, TestRequest::delete(), "/me/delete", &e.bob, None)
            .await
            .0,
        StatusCode::NO_CONTENT
    );
    let (status, _) = send(&app, TestRequest::get(), "/me/settings", &e.bob, None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = send(
        &app,
        TestRequest::patch(),
        "/me/settings",
        &e.bob,
        Some(json!({"theme": "dark"})),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = send(
        &app,
        TestRequest::post(),
        "/me/push-tokens",
        &e.bob,
        Some(json!({"token": BOB_PUSH, "platform": "ios"})),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert!(e.store.list_push_tokens(e.bob_id).await.unwrap().is_empty());
}

#[actix_web::test]
async fn push_tokens_are_registered_and_revoked_by_their_owner_only() {
    let (app, e) = env().await;
    let post = |token: &str, body: Value| {
        let (app, token) = (&app, token.to_string());
        async move {
            send(
                app,
                TestRequest::post(),
                "/me/push-tokens",
                &token,
                Some(body),
            )
            .await
        }
    };
    let (status, created) = post(&e.alice, json!({"token": ALICE_PUSH, "platform": "ios"})).await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    assert_eq!(created["platform"], "ios");
    assert!(
        created.get("token").is_none(),
        "le jeton n'est jamais renvoyé"
    );
    // Même jeton : même enregistrement.
    let (_, again) = post(
        &e.alice,
        json!({"token": ALICE_PUSH, "platform": "android"}),
    )
    .await;
    assert_eq!(again["id"], created["id"]);
    assert_eq!(e.store.list_push_tokens(e.alice_id).await.unwrap().len(), 1);

    for body in [
        json!({"token": "n-importe-quoi", "platform": "ios"}),
        json!({"token": "ExponentPushToken[]", "platform": "ios"}),
        json!({"token": ALICE_PUSH, "platform": "windows"}),
        json!({"token": ALICE_PUSH}),
    ] {
        assert_eq!(
            post(&e.alice, body.clone()).await.0,
            StatusCode::BAD_REQUEST,
            "{body}"
        );
    }

    // Bob ne peut pas révoquer l'appareil d'Alice.
    let revoke = |token: &str, device: &str| {
        let (app, token) = (&app, token.to_string());
        let body = json!({"token": device});
        async move {
            send(
                app,
                TestRequest::delete(),
                "/me/push-tokens",
                &token,
                Some(body),
            )
            .await
            .0
        }
    };
    assert_eq!(revoke(&e.bob, ALICE_PUSH).await, StatusCode::NOT_FOUND);
    assert_eq!(e.store.list_push_tokens(e.alice_id).await.unwrap().len(), 1);
    assert_eq!(revoke(&e.alice, ALICE_PUSH).await, StatusCode::NO_CONTENT);
    assert_eq!(revoke(&e.alice, ALICE_PUSH).await, StatusCode::NOT_FOUND);

    // Un appareil qui change de compte quitte l'ancien.
    post(&e.alice, json!({"token": ALICE_PUSH, "platform": "ios"})).await;
    post(&e.bob, json!({"token": ALICE_PUSH, "platform": "ios"})).await;
    assert!(
        e.store
            .list_push_tokens(e.alice_id)
            .await
            .unwrap()
            .is_empty()
    );
    assert_eq!(e.store.list_push_tokens(e.bob_id).await.unwrap().len(), 1);

    // Dix appareils au plus par compte : les plus anciens partent.
    for index in 0..12 {
        post(
            &e.alice,
            json!({"token": format!("ExponentPushToken[bulk-{index}]"), "platform": "android"}),
        )
        .await;
    }
    let tokens = e.store.list_push_tokens(e.alice_id).await.unwrap();
    assert_eq!(tokens.len(), 10);
    assert!(tokens.iter().any(|t| t.token.ends_with("bulk-11]")));
    assert!(!tokens.iter().any(|t| t.token.ends_with("bulk-0]")));
}

#[actix_web::test]
async fn profile_pictures_follow_the_clearable_url_convention() {
    let (app, e) = env().await;
    let update = |body: Value| {
        let (app, token) = (&app, e.alice.clone());
        async move { send(app, TestRequest::patch(), "/me/update", &token, Some(body)).await }
    };
    let (_, me) = send(&app, TestRequest::get(), "/me", &e.alice, None).await;
    assert_eq!(me["picture_url"], Value::Null);

    let (status, me) = update(json!({"picture_url": "  https://cdn.example.com/a.png "})).await;
    assert_eq!(
        (status, &me["picture_url"]),
        (StatusCode::OK, &json!("https://cdn.example.com/a.png"))
    );
    for bad in [
        "ftp://x/y.png",
        "pas une url",
        "https://",
        "https://a b.png",
        &format!("https://x/{}", "a".repeat(2048)),
    ] {
        let (status, error) = update(json!({"picture_url": bad})).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{bad}");
        assert!(error["errors"]["picture_url"].is_string(), "{error}");
    }
    // La photo est publique, les réglages non.
    let (_, public) = send(
        &app,
        TestRequest::get(),
        &format!("/user/{}", e.alice_id),
        &e.bob,
        None,
    )
    .await;
    assert_eq!(public["picture_url"], "https://cdn.example.com/a.png");
    for private in ["email", "language", "theme", "notifications"] {
        assert!(public.get(private).is_none(), "{private}");
    }
    let (_, list) = send(&app, TestRequest::get(), "/users", &e.bob, None).await;
    assert!(
        list.as_array()
            .unwrap()
            .iter()
            .any(|u| u["picture_url"] == "https://cdn.example.com/a.png")
    );

    // Seule la photo change : le reste du compte est intact. Une chaîne vide l'efface.
    let (status, me) = update(json!({"picture_url": ""})).await;
    assert_eq!((status, &me["picture_url"]), (StatusCode::OK, &Value::Null));
    assert_eq!(me["username"], "alice");
    // Un administrateur peut aussi la modifier.
    let (status, profile) = send(
        &app,
        TestRequest::patch(),
        &format!("/user/{}/update", e.bob_id),
        &e.admin,
        Some(json!({"picture_url": "http://img.example/b.png"})),
    )
    .await;
    assert_eq!(
        (status, &profile["picture_url"]),
        (StatusCode::OK, &json!("http://img.example/b.png"))
    );
}

async fn game_and_tournament(app: &app_type!(), e: &Env) -> (String, String) {
    let (_, game) = send(
        app,
        TestRequest::post(),
        "/games",
        &e.admin,
        Some(json!({"name": "TFT"})),
    )
    .await;
    let (status, tournament) = send(
        app,
        TestRequest::post(),
        "/tournaments",
        &e.admin,
        Some(json!({
            "game_id": game["id"], "name": "Open d'hiver",
            "start_date": "2026-11-14T18:00:00Z", "end_date": "2026-11-15T18:00:00Z",
            "participant_type": "solo", "max_participants": 8,
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{tournament}");
    (
        game["id"].as_str().unwrap().into(),
        tournament["id"].as_str().unwrap().into(),
    )
}

async fn set_status(app: &app_type!(), e: &Env, tournament: &str, status: &str) -> StatusCode {
    send(
        app,
        TestRequest::post(),
        &format!("/tournaments/{tournament}/status"),
        &e.admin,
        Some(json!({"status": status})),
    )
    .await
    .0
}

#[actix_web::test]
async fn tournament_events_reach_active_participants_in_their_language_and_channels() {
    let (app, e) = env().await;
    let (_, tid) = game_and_tournament(&app, &e).await;
    assert_eq!(
        set_status(&app, &e, &tid, "registration").await,
        StatusCode::OK
    );
    for token in [&e.alice, &e.bob] {
        let (status, _) = send(
            &app,
            TestRequest::post(),
            &format!("/tournaments/{tid}/participants"),
            token,
            Some(json!({})),
        )
        .await;
        assert_eq!(status, StatusCode::CREATED);
    }
    // Alice : espagnol, un appareil. Bob : anglais, e-mail coupé pour les tournois.
    send(
        &app,
        TestRequest::post(),
        "/me/push-tokens",
        &e.alice,
        Some(json!({"token": ALICE_PUSH, "platform": "ios"})),
    )
    .await;
    send(
        &app,
        TestRequest::patch(),
        "/me/settings",
        &e.alice,
        Some(json!({"language": "es"})),
    )
    .await;
    send(
        &app,
        TestRequest::post(),
        "/me/push-tokens",
        &e.bob,
        Some(json!({"token": BOB_PUSH, "platform": "android"})),
    )
    .await;
    send(
        &app,
        TestRequest::patch(),
        "/me/settings",
        &e.bob,
        Some(json!({"language": "en", "notifications": {"tournaments": {"email": false}}})),
    )
    .await;

    // L'inscription ouverte au public n'avertit personne : seul le démarrage est un événement.
    assert_eq!(set_status(&app, &e, &tid, "ongoing").await, StatusCode::OK);
    eventually(|| e.mailer.notifications().len() == 1 && e.push.sent().len() == 2).await;

    let mails = e.mailer.notifications();
    assert_eq!(mails[0].0, "alice@example.com");
    assert_eq!(mails[0].1.title, "Open d'hiver ha comenzado");
    assert_eq!(mails[0].1.category, Category::Tournaments);
    assert_eq!(
        mails[0].1.action_url.as_deref(),
        Some(format!("{PUBLIC_URL}/tournaments/{tid}").as_str())
    );
    let pushes = e.push.sent();
    let bob_push = pushes.iter().find(|p| p.token == BOB_PUSH).unwrap();
    assert_eq!(bob_push.title, "Open d'hiver has started");
    assert_eq!(bob_push.data["kind"], "tournament.started");
    assert_eq!(bob_push.data["path"], format!("/tournaments/{tid}"));
    assert_eq!(
        pushes.iter().find(|p| p.token == ALICE_PUSH).unwrap().title,
        "Open d'hiver ha comenzado"
    );

    // Alice se retire : la fin du tournoi ne la concerne plus.
    let (_, list) = send(
        &app,
        TestRequest::get(),
        &format!("/tournaments/{tid}/participants"),
        &e.alice,
        None,
    )
    .await;
    let mine = list
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["user_id"] == json!(e.alice_id))
        .unwrap();
    send(
        &app,
        TestRequest::patch(),
        &format!(
            "/tournaments/{tid}/participants/{}",
            mine["id"].as_str().unwrap()
        ),
        &e.alice,
        Some(json!({"status": "withdrawn"})),
    )
    .await;
    assert_eq!(set_status(&app, &e, &tid, "finished").await, StatusCode::OK);
    eventually(|| e.push.sent().len() == 3).await;
    let finished = e.push.sent().pop().unwrap();
    assert_eq!(
        (finished.token.as_str(), finished.data["kind"].as_str()),
        (BOB_PUSH, Some("tournament.finished"))
    );
    assert_eq!(e.mailer.notifications().len(), 1);
}

#[actix_web::test]
async fn team_events_notify_the_member_concerned() {
    let (app, e) = env().await;
    let (game, _) = game_and_tournament(&app, &e).await;
    let (status, team) = send(
        &app,
        TestRequest::post(),
        "/teams",
        &e.alice,
        Some(json!({"game_id": game, "name": "Les Aigles"})),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{team}");
    let team = team["id"].as_str().unwrap();
    let (status, _) = send(
        &app,
        TestRequest::post(),
        &format!("/teams/{team}/members"),
        &e.alice,
        Some(json!({"user_id": e.bob_id, "role": "member"})),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    eventually(|| !e.mailer.notifications().is_empty()).await;
    let (to, mail) = e.mailer.notifications().remove(0);
    assert_eq!(
        (to.as_str(), mail.title.as_str()),
        ("bob@example.com", "Bienvenue dans Les Aigles")
    );

    let (status, _) = send(
        &app,
        TestRequest::delete(),
        &format!("/teams/{team}/members/{}", e.bob_id),
        &e.alice,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    eventually(|| e.mailer.notifications().len() == 2).await;
    assert_eq!(
        e.mailer.notifications()[1].1.title,
        "Vous avez quitté Les Aigles"
    );
    // Les refus n'envoient rien : Bob ne peut pas ajouter quelqu'un à l'équipe d'Alice.
    let (status, _) = send(
        &app,
        TestRequest::post(),
        &format!("/teams/{team}/members"),
        &e.bob,
        Some(json!({"user_id": e.bob_id, "role": "member"})),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    actix_web::rt::time::sleep(Duration::from_millis(50)).await;
    assert_eq!(e.mailer.notifications().len(), 2);
}

#[actix_web::test]
async fn preferences_are_enforced_per_category_and_channel() {
    let (_app, e) = env().await;
    let notifier = Notifier::from_state(&state(&e));
    e.store
        .register_push_token(e.alice_id, ALICE_PUSH, Platform::Ios)
        .await
        .unwrap();

    notifier.deliver(member_added(&e, "1")).await;
    assert_eq!(
        (e.mailer.notifications().len(), e.push.sent().len()),
        (1, 1)
    );

    let off = |category, channel| SettingsUpdate {
        notifications: vec![(category, channel, false)],
        ..Default::default()
    };
    e.store
        .update_user_settings(e.alice_id, off(Category::Teams, Channel::Email))
        .await
        .unwrap();
    notifier.deliver(member_added(&e, "2")).await;
    assert_eq!(
        (e.mailer.notifications().len(), e.push.sent().len()),
        (1, 2),
        "e-mail coupé, push actif"
    );

    e.store
        .update_user_settings(e.alice_id, off(Category::Teams, Channel::Push))
        .await
        .unwrap();
    notifier.deliver(member_added(&e, "3")).await;
    assert_eq!(
        (e.mailer.notifications().len(), e.push.sent().len()),
        (1, 2),
        "tout coupé"
    );

    // Les autres catégories ne sont pas affectées ; réactiver rétablit l'envoi.
    let matches = Event {
        kind: "match.finished",
        key: "m1".into(),
        audience: Audience::Users(vec![e.alice_id]),
        payload: json!({"tournament_name": "Open", "tournament_id": "t", "step_id": "s"}),
    };
    notifier.deliver(matches).await;
    assert_eq!(
        (e.mailer.notifications().len(), e.push.sent().len()),
        (2, 3)
    );
    e.store
        .update_user_settings(
            e.alice_id,
            SettingsUpdate {
                notifications: vec![(Category::Teams, Channel::Email, true)],
                ..Default::default()
            },
        )
        .await
        .unwrap();
    notifier.deliver(member_added(&e, "4")).await;
    assert_eq!(e.mailer.notifications().len(), 3);
}

#[actix_web::test]
async fn an_event_is_delivered_once_per_recipient_and_channel() {
    let (_app, e) = env().await;
    let notifier = Notifier::from_state(&state(&e));
    e.store
        .register_push_token(e.alice_id, ALICE_PUSH, Platform::Ios)
        .await
        .unwrap();
    let event = member_added(&e, "same");
    notifier.deliver(event.clone()).await;
    notifier.deliver(event.clone()).await;
    assert_eq!(
        (e.mailer.notifications().len(), e.push.sent().len()),
        (1, 1)
    );
    // Un autre fait (autre clé) est livré.
    notifier.deliver(member_added(&e, "other")).await;
    assert_eq!(e.mailer.notifications().len(), 2);
    // Un destinataire en double dans l'audience n'est prévenu qu'une fois.
    let twice = Event {
        audience: Audience::Users(vec![e.bob_id, e.bob_id]),
        key: "dup".into(),
        ..event
    };
    notifier.deliver(twice).await;
    assert_eq!(e.mailer.notifications().len(), 3);
}

#[actix_web::test]
async fn failed_deliveries_are_retried_then_released_for_a_later_attempt() {
    let (_app, e) = env().await;
    let notifier = Notifier::from_state(&state(&e));
    // Deux échecs passagers : le troisième essai passe.
    *e.mailer.notification_failures.lock().unwrap() = 2;
    notifier.deliver(member_added(&e, "retry")).await;
    assert_eq!(e.mailer.notifications().len(), 1);

    // Échec définitif : rien n'est livré, rien n'est marqué comme livré.
    *e.mailer.notification_failures.lock().unwrap() = 3;
    let event = member_added(&e, "lost");
    notifier.deliver(event.clone()).await;
    assert_eq!(e.mailer.notifications().len(), 1);
    notifier.deliver(event).await;
    assert_eq!(
        e.mailer.notifications().len(),
        2,
        "le nouvel envoi de l'événement réussit"
    );

    // Même chose pour le push.
    e.store
        .register_push_token(e.alice_id, ALICE_PUSH, Platform::Ios)
        .await
        .unwrap();
    *e.push.transient_failures.lock().unwrap() = 2;
    notifier.deliver(member_added(&e, "push-retry")).await;
    assert_eq!(e.push.sent().len(), 1);
}

#[actix_web::test]
async fn invalid_push_tokens_are_removed_and_the_others_still_served() {
    let (_app, e) = env().await;
    let notifier = Notifier::from_state(&state(&e));
    for token in [ALICE_PUSH, "ExponentPushToken[alice-device-2]"] {
        e.store
            .register_push_token(e.alice_id, token, Platform::Android)
            .await
            .unwrap();
    }
    e.push
        .invalid_tokens
        .lock()
        .unwrap()
        .push(ALICE_PUSH.into());
    notifier.deliver(member_added(&e, "1")).await;
    let remaining = e.store.list_push_tokens(e.alice_id).await.unwrap();
    assert_eq!(
        remaining
            .iter()
            .map(|t| t.token.as_str())
            .collect::<Vec<_>>(),
        ["ExponentPushToken[alice-device-2]"]
    );
    assert_eq!(e.push.sent().len(), 1);
    assert_eq!(e.push.sent()[0].token, "ExponentPushToken[alice-device-2]");
}

#[actix_web::test]
async fn delivery_failures_never_undo_the_business_operation() {
    let (app, e) = env().await;
    let (_, tid) = game_and_tournament(&app, &e).await;
    set_status(&app, &e, &tid, "registration").await;
    for token in [&e.alice, &e.bob] {
        send(
            &app,
            TestRequest::post(),
            &format!("/tournaments/{tid}/participants"),
            token,
            Some(json!({})),
        )
        .await;
    }
    send(
        &app,
        TestRequest::post(),
        "/me/push-tokens",
        &e.alice,
        Some(json!({"token": ALICE_PUSH, "platform": "ios"})),
    )
    .await;
    *e.mailer.notification_failures.lock().unwrap() = usize::MAX;
    *e.push.transient_failures.lock().unwrap() = usize::MAX;

    assert_eq!(set_status(&app, &e, &tid, "ongoing").await, StatusCode::OK);
    let (_, tournament) = send(
        &app,
        TestRequest::get(),
        &format!("/tournaments/{tid}"),
        &e.admin,
        None,
    )
    .await;
    assert_eq!(tournament["status"], "ongoing");
    actix_web::rt::time::sleep(Duration::from_millis(50)).await;
    assert!(e.mailer.notifications().is_empty() && e.push.sent().is_empty());
}

#[actix_web::test]
async fn only_verified_addresses_receive_email_and_security_mail_ignores_preferences() {
    let (app, e) = env().await;
    let notifier = Notifier::from_state(&state(&e));
    // Compte non vérifié : inscrit sans confirmer son adresse.
    let (status, _) = common::post(
        &app,
        "/register",
        json!({"username": "dave", "password": "secret123", "email": "dave@example.com"}),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let dave = user_id(&e.store, "dave").await;
    let event = Event {
        audience: Audience::Users(vec![dave]),
        ..member_added(&e, "unverified")
    };
    notifier.deliver(event).await;
    assert!(e.mailer.notifications().is_empty());

    // Alice coupe toutes les notifications d'e-mail : le mot de passe oublié arrive quand même.
    let every_email: Vec<_> = Category::ALL
        .iter()
        .map(|&c| (c, Channel::Email, false))
        .collect();
    e.store
        .update_user_settings(
            e.alice_id,
            SettingsUpdate {
                notifications: every_email,
                ..Default::default()
            },
        )
        .await
        .unwrap();
    let (status, _) = common::post(
        &app,
        "/forgot-password",
        json!({"email": "alice@example.com"}),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    eventually(|| e.mailer.sent().len() == 1).await;
    assert_eq!(e.mailer.sent()[0].0, "alice@example.com");
    notifier.deliver(member_added(&e, "silenced")).await;
    assert!(e.mailer.notifications().is_empty());
}

#[actix_web::test]
async fn future_features_register_their_own_events() {
    let (_app, e) = env().await;
    let mut catalog = Catalog::builtin();
    let definition = EventDefinition {
        kind: "pickem.result",
        category: Category::Pickem,
        channels: &[Channel::Email],
        texts: [
            ("Résultat {rank}", "Vous êtes {rank}e."),
            ("Result {rank}", "You are #{rank}."),
            ("Resultado {rank}", "Eres el {rank}."),
        ],
        path: Some("/pickem"),
    };
    assert!(catalog.register(definition.clone()));
    assert!(!catalog.register(definition));
    let notifier = Notifier::from_state(&state(&e).with_catalog(catalog));
    let event = Event {
        kind: "pickem.result",
        key: "p1".into(),
        audience: Audience::Users(vec![e.alice_id]),
        payload: json!({"rank": 2}),
    };
    notifier.deliver(event.clone()).await;
    let (_, mail) = e.mailer.notifications().remove(0);
    assert_eq!(
        (mail.title.as_str(), mail.body.as_str()),
        ("Résultat 2", "Vous êtes 2e.")
    );
    assert_eq!(
        mail.action_url.as_deref(),
        Some(format!("{PUBLIC_URL}/pickem").as_str())
    );

    // Le catalogue par défaut ne le connaît pas : l'événement est ignoré sans erreur.
    let default = Notifier::from_state(&state(&e));
    default
        .deliver(Event {
            key: "p2".into(),
            ..event
        })
        .await;
    assert_eq!(e.mailer.notifications().len(), 1);
    assert_eq!(
        UserSettings::defaults().language,
        api_public::store::Language::Fr
    );
}
