//! Parcours HTTP « mot de passe oublié », sur un store et un mailer en mémoire.

mod common;

use actix_web::http::StatusCode;
use api_public::config::AuthConfig;
use api_public::mail::{MailConfig, Mailer, MemoryMailer, NotificationMail, ResendMailer};
use api_public::store::{AuthStore, MemoryStore};
use api_public::store::{Category, Language};
use common::{PUBLIC_URL, access, app_with_mailer, login, post, post_as};
use serde_json::{Value, json};
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

async fn register_with_email(
    app: &impl actix_web::dev::Service<
        actix_http::Request,
        Response = actix_web::dev::ServiceResponse<impl actix_web::body::MessageBody>,
        Error = actix_web::Error,
    >,
    username: &str,
    email: &str,
) -> (StatusCode, Value) {
    let response = post(
        app,
        "/register",
        json!({ "username": username, "password": "secret123", "email": email }),
    )
    .await;
    if response.0 == StatusCode::CREATED {
        common::confirm(app, email).await;
    }
    response
}

/// L'envoi part en tâche de fond : attend qu'il ait eu lieu.
async fn wait_for_mails(mailer: &MemoryMailer, count: usize) -> Vec<(String, String)> {
    for _ in 0..100 {
        if mailer.sent().len() >= count {
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    mailer.sent()
}

fn token_of(link: &str) -> &str {
    link.strip_prefix(&format!("{PUBLIC_URL}/reset-password?token="))
        .expect("lien de réinitialisation")
}

#[actix_web::test]
async fn forgot_password_mails_a_link_to_the_account() {
    let mailer = Arc::new(MemoryMailer::new());
    let app = app_with_mailer(Arc::new(MemoryStore::new()), mailer.clone()).await;
    let (status, _) = register_with_email(&app, "alice", "Alice@Example.com").await;
    assert_eq!(status, StatusCode::CREATED);

    // L'adresse est comparée sans tenir compte de la casse ni des espaces.
    let (status, body) = post(
        &app,
        "/forgot-password",
        json!({ "email": " ALICE@example.com " }),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert_eq!(body, Value::Null);

    let sent = wait_for_mails(&mailer, 1).await;
    assert_eq!(sent.len(), 1);
    assert_eq!(sent[0].0, "alice@example.com");
    assert_eq!(token_of(&sent[0].1).len(), 64);
}

#[actix_web::test]
async fn forgot_password_does_not_reveal_unknown_addresses() {
    let mailer = Arc::new(MemoryMailer::new());
    let app = app_with_mailer(Arc::new(MemoryStore::new()), mailer.clone()).await;
    let (status, body) = post(
        &app,
        "/forgot-password",
        json!({ "email": "personne@example.com" }),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert_eq!(body, Value::Null);
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert!(mailer.sent().is_empty());
}

#[actix_web::test]
async fn forgot_password_rejects_a_malformed_address() {
    let app = app_with_mailer(Arc::new(MemoryStore::new()), Arc::new(MemoryMailer::new())).await;
    for body in [
        json!({ "email": "pas-un-email" }),
        json!({ "email": "" }),
        json!({}),
    ] {
        let (status, body) = post(&app, "/forgot-password", body).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(body["error"], "invalid_request");
    }
}

#[actix_web::test]
async fn reset_password_changes_the_password_once() {
    let mailer = Arc::new(MemoryMailer::new());
    let app = app_with_mailer(Arc::new(MemoryStore::new()), mailer.clone()).await;
    register_with_email(&app, "alice", "alice@example.com").await;
    post(
        &app,
        "/forgot-password",
        json!({ "email": "alice@example.com" }),
    )
    .await;
    let sent = wait_for_mails(&mailer, 1).await;
    let token = token_of(&sent[0].1).to_string();

    let (status, _) = post(
        &app,
        "/reset-password",
        json!({ "token": token, "password": "nouveau-mdp-1" }),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert_eq!(
        login(&app, "alice", "secret123").await.0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        login(&app, "alice", "nouveau-mdp-1").await.0,
        StatusCode::OK
    );

    // Le jeton est à usage unique.
    let (status, body) = post(
        &app,
        "/reset-password",
        json!({ "token": token, "password": "encore-un-mdp" }),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["error"], "invalid_reset_token");
    assert_eq!(
        login(&app, "alice", "nouveau-mdp-1").await.0,
        StatusCode::OK
    );
}

#[actix_web::test]
async fn reset_password_rejects_unknown_tokens_and_weak_passwords() {
    let mailer = Arc::new(MemoryMailer::new());
    let app = app_with_mailer(Arc::new(MemoryStore::new()), mailer.clone()).await;
    register_with_email(&app, "alice", "alice@example.com").await;
    post(
        &app,
        "/forgot-password",
        json!({ "email": "alice@example.com" }),
    )
    .await;
    let sent = wait_for_mails(&mailer, 1).await;
    let token = token_of(&sent[0].1).to_string();

    let (status, body) = post(
        &app,
        "/reset-password",
        json!({ "token": "inconnu", "password": "nouveau-mdp-1" }),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["error"], "invalid_reset_token");

    // Un mot de passe refusé ne consomme pas le jeton.
    let (status, body) = post(
        &app,
        "/reset-password",
        json!({ "token": token, "password": "court" }),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(body["errors"]["password"].is_string());
    let (status, _) = post(
        &app,
        "/reset-password",
        json!({ "token": token, "password": "nouveau-mdp-1" }),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
}

#[actix_web::test]
async fn a_new_request_invalidates_the_previous_link() {
    let mailer = Arc::new(MemoryMailer::new());
    let app = app_with_mailer(Arc::new(MemoryStore::new()), mailer.clone()).await;
    register_with_email(&app, "alice", "alice@example.com").await;
    for _ in 0..2 {
        post(
            &app,
            "/forgot-password",
            json!({ "email": "alice@example.com" }),
        )
        .await;
    }
    let sent = wait_for_mails(&mailer, 2).await;
    let (old, new) = (
        token_of(&sent[0].1).to_string(),
        token_of(&sent[1].1).to_string(),
    );
    assert_ne!(old, new);

    let (status, _) = post(
        &app,
        "/reset-password",
        json!({ "token": old, "password": "nouveau-mdp-1" }),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, _) = post(
        &app,
        "/reset-password",
        json!({ "token": new, "password": "nouveau-mdp-1" }),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
}

#[actix_web::test]
async fn resetting_the_password_ends_open_sessions() {
    let mailer = Arc::new(MemoryMailer::new());
    let app = app_with_mailer(Arc::new(MemoryStore::new()), mailer.clone()).await;
    register_with_email(&app, "alice", "alice@example.com").await;
    let (_, session) = login(&app, "alice", "secret123").await;
    post(
        &app,
        "/forgot-password",
        json!({ "email": "alice@example.com" }),
    )
    .await;
    let sent = wait_for_mails(&mailer, 1).await;
    post(
        &app,
        "/reset-password",
        json!({ "token": token_of(&sent[0].1), "password": "nouveau-mdp-1" }),
    )
    .await;

    let (status, _) = post_as(
        &app,
        access(&session),
        "/refresh",
        json!({ "refresh_token": session["refresh_token"] }),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[actix_web::test]
async fn expired_links_are_refused() {
    let store = Arc::new(MemoryStore::new());
    let app = app_with_mailer(store.clone(), Arc::new(MemoryMailer::new())).await;
    let (_, user) = register_with_email(&app, "alice", "alice@example.com").await;
    let id = user["id"].as_str().unwrap().parse().unwrap();
    store
        .insert_password_reset_token(
            id,
            Some("alice@example.com"),
            &sha256_hex("expire"),
            Duration::from_millis(1),
        )
        .await
        .unwrap();
    tokio::time::sleep(Duration::from_millis(20)).await;
    let (status, body) = post(
        &app,
        "/reset-password",
        json!({ "token": "expire", "password": "nouveau-mdp-1" }),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["error"], "invalid_reset_token");
}

#[actix_web::test]
async fn email_is_required_and_unique() {
    let app = app_with_mailer(Arc::new(MemoryStore::new()), Arc::new(MemoryMailer::new())).await;
    assert_eq!(
        common::register(&app, "bob", "secret123").await,
        StatusCode::CREATED
    );
    assert_eq!(
        register_with_email(&app, "alice", "alice@example.com")
            .await
            .0,
        StatusCode::CREATED
    );

    let (status, body) = register_with_email(&app, "carol", "ALICE@example.com").await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(body["error"], "email_taken");
    let (status, body) = register_with_email(&app, "carol", "pas-un-email").await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(body["errors"]["email"].is_string());
}

#[actix_web::test]
async fn recovery_accepts_the_current_address_after_an_idempotent_profile_update() {
    let mailer = Arc::new(MemoryMailer::new());
    let app = app_with_mailer(Arc::new(MemoryStore::new()), mailer.clone()).await;
    common::register(&app, "bob", "secret123").await;
    let (_, session) = login(&app, "bob", "secret123").await;

    let request = common::request(
        actix_web::test::TestRequest::patch(),
        "/me/update",
        Some(access(&session)),
    )
    .set_json(json!({ "email": "Bob@Example.com" }));
    assert_eq!(common::call(&app, request).await.0, StatusCode::OK);

    post(
        &app,
        "/forgot-password",
        json!({ "email": "bob@example.com" }),
    )
    .await;
    assert_eq!(wait_for_mails(&mailer, 1).await[0].0, "bob@example.com");
}

fn sha256_hex(value: &str) -> String {
    use sha2::{Digest, Sha256};
    Sha256::digest(value.as_bytes())
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// Serveur HTTP minimal qui répond `status` et renvoie la requête reçue (en-têtes et corps).
async fn fake_resend(status: u16) -> (String, tokio::task::JoinHandle<String>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint = format!("http://{}/emails", listener.local_addr().unwrap());
    let handle = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut received = Vec::new();
        let mut chunk = [0u8; 4096];
        loop {
            let n = socket.read(&mut chunk).await.unwrap();
            received.extend_from_slice(&chunk[..n]);
            let text = String::from_utf8_lossy(&received).to_string();
            if let Some((head, body)) = text.split_once("\r\n\r\n") {
                let length = head
                    .lines()
                    .find_map(|l| {
                        l.to_lowercase()
                            .strip_prefix("content-length: ")
                            .map(|v| v.trim().parse::<usize>().unwrap())
                    })
                    .unwrap_or(0);
                if body.len() >= length || n == 0 {
                    break;
                }
            } else if n == 0 {
                break;
            }
        }
        let response =
            format!("HTTP/1.1 {status} X\r\ncontent-length: 2\r\nconnection: close\r\n\r\n{{}}");
        socket.write_all(response.as_bytes()).await.unwrap();
        String::from_utf8_lossy(&received).to_string()
    });
    (endpoint, handle)
}

fn mail_config() -> MailConfig {
    MailConfig {
        api_key: "re_test_key".into(),
        from: "Epick'em <no-reply@epickem.test>".into(),
        public_url: PUBLIC_URL.into(),
        password_reset_template: [
            "password-reset-fr".into(),
            "password-reset-en".into(),
            "password-reset-es".into(),
        ],
        verification_template: [
            "email-address-confirmation-fr".into(),
            "email-address-confirmation-en".into(),
            "email-address-confirmation-es".into(),
        ],
        welcome_template: [
            "welcome-account-fr".into(),
            "welcome-account-en".into(),
            "welcome-account-es".into(),
        ],
        notification_templates: [
            "notification-fr".into(),
            "notification-en".into(),
            "notification-es".into(),
        ],
    }
}

#[tokio::test]
async fn resend_mailer_posts_the_message_to_resend() {
    let (endpoint, server) = fake_resend(200).await;
    let mailer = ResendMailer::with_endpoint(&mail_config(), &endpoint).unwrap();
    mailer
        .send_password_reset(
            "alice@example.com",
            "https://x.test/r?token=abc",
            Language::Fr,
        )
        .await
        .unwrap();

    let request = server.await.unwrap();
    assert!(request.starts_with("POST /emails "), "{request}");
    assert!(
        request
            .to_lowercase()
            .contains("authorization: bearer re_test_key")
    );
    let body: Value = serde_json::from_str(request.split_once("\r\n\r\n").unwrap().1).unwrap();
    assert_eq!(body["from"], "Epick'em <no-reply@epickem.test>");
    assert_eq!(body["to"], json!(["alice@example.com"]));
    assert_eq!(body["template"]["id"], "password-reset-fr");
    assert_eq!(
        body["template"]["variables"]["RESET_URL"],
        "https://x.test/r?token=abc"
    );
    assert!(body.get("html").is_none());
    assert!(body.get("text").is_none());
}

#[tokio::test]
async fn resend_notifications_use_the_template_of_the_language() {
    for (language, template) in [
        (Language::Fr, "notification-fr"),
        (Language::En, "notification-en"),
        (Language::Es, "notification-es"),
    ] {
        let (endpoint, server) = fake_resend(200).await;
        let mailer = ResendMailer::with_endpoint(&mail_config(), &endpoint).unwrap();
        mailer
            .send_notification(
                "alice@example.com",
                &NotificationMail {
                    language,
                    category: Category::Teams,
                    title: "Titre".into(),
                    body: "Corps".into(),
                    action_url: Some("https://x.test/tournaments/1".into()),
                },
            )
            .await
            .unwrap();
        let request = server.await.unwrap();
        let body: Value = serde_json::from_str(request.split_once("\r\n\r\n").unwrap().1).unwrap();
        assert_eq!(body["template"]["id"], template);
        assert_eq!(body["subject"], "Titre");
        assert_eq!(
            body["template"]["variables"],
            json!({
                "TITLE": "Titre", "BODY": "Corps", "CATEGORY": "teams",
                "LANGUAGE": language.as_str(),
                "ACTION_URL": "https://x.test/tournaments/1",
            })
        );
    }
}

#[tokio::test]
async fn resend_mailer_reports_a_refusal() {
    let (endpoint, _server) = fake_resend(403).await;
    let mailer = ResendMailer::with_endpoint(&mail_config(), &endpoint).unwrap();
    let err = mailer
        .send_password_reset("alice@example.com", "l", Language::Fr)
        .await
        .unwrap_err();
    assert!(err.to_string().contains("403"), "{err}");
    assert!(!err.to_string().contains("re_test_key"));
}

#[tokio::test]
async fn account_templates_follow_the_recipient_language() {
    for language in [Language::Fr, Language::En, Language::Es] {
        for kind in [
            "password-reset",
            "email-address-confirmation",
            "welcome-account",
        ] {
            let (endpoint, server) = fake_resend(200).await;
            let mailer = ResendMailer::with_endpoint(&mail_config(), &endpoint).unwrap();
            match kind {
                "password-reset" => mailer
                    .send_password_reset("alice@example.test", "link", language)
                    .await
                    .unwrap(),
                "email-address-confirmation" => mailer
                    .send_verification("alice@example.test", "link", language)
                    .await
                    .unwrap(),
                _ => mailer
                    .send_welcome("alice@example.test", "Alice", language)
                    .await
                    .unwrap(),
            }
            let request = server.await.unwrap();
            let body: Value =
                serde_json::from_str(request.split_once("\r\n\r\n").unwrap().1).unwrap();
            assert_eq!(
                body["template"]["id"],
                format!("{kind}-{}", language.as_str())
            );
        }
    }
}

#[test]
fn auth_config_is_unaffected_by_mail_settings() {
    // L'envoi est facultatif : l'API démarre sans configuration Resend.
    let vars = |name: &str| (name == "JWT_SECRET").then(|| common::SECRET.to_string());
    assert!(AuthConfig::from_lookup(vars).is_ok());
    assert!(MailConfig::from_lookup(|_| None).is_none());
}

#[tokio::test]
async fn verification_and_welcome_use_distinct_hosted_templates() {
    for welcome in [false, true] {
        let (endpoint, server) = fake_resend(200).await;
        let mailer = ResendMailer::with_endpoint(&mail_config(), &endpoint).unwrap();
        let (alias, variables) = if welcome {
            mailer
                .send_welcome("alice@example.test", "Alice", Language::Fr)
                .await
                .unwrap();
            ("welcome-account-fr", json!({"USERNAME":"Alice"}))
        } else {
            mailer
                .send_verification(
                    "alice@example.test",
                    "epickem://verify-email?token=fixture",
                    Language::Fr,
                )
                .await
                .unwrap();
            (
                "email-address-confirmation-fr",
                json!({"VERIFICATION_URL":"epickem://verify-email?token=fixture"}),
            )
        };
        let request = server.await.unwrap();
        let body: Value = serde_json::from_str(request.split_once("\r\n\r\n").unwrap().1).unwrap();
        assert_eq!(body["template"], json!({"id":alias,"variables":variables}));
        assert!(body.get("html").is_none());
    }
}
