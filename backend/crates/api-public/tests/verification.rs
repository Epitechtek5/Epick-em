//! End-to-end contracts for verification and historical enrollment.
mod common;

use actix_web::{http::StatusCode, test};
use api_public::{
    AppState, app,
    config::AuthConfig,
    mail::MemoryMailer,
    store::{AuthStore, MemoryStore, PgStore, UserUpdate},
};
use common::{SECRET, post};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{sync::Arc, time::Duration};
use uuid::Uuid;

#[actix_web::test]
async fn account_emails_use_persisted_language_including_pending_addresses() {
    use api_public::store::{Language, SettingsUpdate};
    for language in [Language::Fr, Language::En, Language::Es] {
        let mailer = Arc::new(MemoryMailer::new());
        let store = Arc::new(MemoryStore::new());
        let app = common::app_with_mailer(store.clone(), mailer.clone()).await;
        let (status, response) = post(
            &app,
            "/register",
            json!({
                "username": "alice", "password": "Password123!",
                "email": "alice@example.test", "language": language.as_str()
            }),
        )
        .await;
        assert_eq!(status, StatusCode::CREATED);
        let id = Uuid::parse_str(response["id"].as_str().unwrap()).unwrap();
        assert_eq!(
            store.user_settings(id).await.unwrap().unwrap().language,
            language
        );
        for _ in 0..100 {
            if mailer.languages.lock().unwrap().len() >= 2 {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        assert_eq!(
            *mailer.languages.lock().unwrap(),
            vec![("verification", language), ("welcome", language)]
        );
        // Password recovery reads current settings, not the language at registration.
        let next = if language == Language::Es {
            Language::En
        } else {
            Language::Es
        };
        store
            .update_user_settings(
                id,
                SettingsUpdate {
                    language: Some(next),
                    ..Default::default()
                },
            )
            .await
            .unwrap();
        assert_eq!(
            post(
                &app,
                "/forgot-password",
                json!({"email": "alice@example.test"})
            )
            .await
            .0,
            StatusCode::NO_CONTENT
        );
        for _ in 0..100 {
            if mailer.languages.lock().unwrap().len() >= 3 {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        assert_eq!(
            mailer.languages.lock().unwrap().last(),
            Some(&("password_reset", next))
        );
        // A separate account avoids the registration resend cooldown.
        let pending_user = store
            .create_user("pending", Some("old@example.test"), "fixture")
            .await
            .unwrap();
        let id = pending_user.id;
        store
            .update_user_settings(
                id,
                SettingsUpdate {
                    language: Some(next),
                    ..Default::default()
                },
            )
            .await
            .unwrap();
        store
            .update_user(
                id,
                UserUpdate {
                    email: Some("pending@example.test".into()),
                    ..Default::default()
                },
            )
            .await
            .unwrap();
        assert!(
            store
                .find_user_by_email("pending@example.test")
                .await
                .unwrap()
                .is_none()
        );
        assert_eq!(
            store
                .find_user_by_verification_email("pending@example.test")
                .await
                .unwrap()
                .unwrap()
                .id,
            id
        );
        assert_eq!(
            post(
                &app,
                "/resend-verification-email",
                json!({"email": "pending@example.test"})
            )
            .await
            .0,
            StatusCode::NO_CONTENT
        );
        for _ in 0..100 {
            if mailer.languages.lock().unwrap().len() >= 4 {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        assert_eq!(
            mailer.languages.lock().unwrap().last(),
            Some(&("verification", next))
        );
    }
}

#[actix_web::test]
async fn registration_and_login_require_verification() {
    let mailer = Arc::new(MemoryMailer::new());
    let store = Arc::new(MemoryStore::new());
    let app = common::app_with_mailer(store.clone(), mailer.clone()).await;
    let user = json!({"username":"alice","password":"Password123!"});
    assert!(post(&app, "/register", user.clone()).await.1["errors"]["email"].is_string());
    assert!(post(&app, "/login", user.clone()).await.1["errors"]["email"].is_string());
    let mut user = user;
    user["email"] = json!(" Alice@Example.COM ");
    assert_eq!(
        post(&app, "/register", user.clone()).await.0,
        StatusCode::CREATED
    );
    assert_eq!(
        post(&app, "/register", user.clone()).await.0,
        StatusCode::CONFLICT
    );
    assert_eq!(
        post(&app, "/login", user.clone()).await.1["error"],
        "email_unverified"
    );
    assert_eq!(
        post(
            &app,
            "/login",
            json!({"email":"alice@example.com","password":"wrong"})
        )
        .await
        .0,
        StatusCode::UNAUTHORIZED
    );
    for address in ["alice@example.com", "unknown@example.com"] {
        assert_eq!(
            post(&app, "/resend-verification-email", json!({"email":address})).await,
            (StatusCode::NO_CONTENT, serde_json::Value::Null)
        );
    }
    tokio::task::yield_now().await;
    assert_eq!(
        mailer.welcome.lock().unwrap().as_slice(),
        &[("alice@example.com".into(), "alice".into())]
    );
    assert_eq!(mailer.verification.lock().unwrap().len(), 1);
    let link = mailer.verification.lock().unwrap()[0].1.clone();
    let token = link
        .strip_prefix(&format!("{}/verify-email?token=", common::PUBLIC_URL))
        .unwrap();
    assert_eq!(token.len(), 64);
    let token = json!({"token":token});
    assert_eq!(
        post(&app, "/verify-email", token.clone()).await.0,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        post(&app, "/verify-email", token).await.0,
        StatusCode::BAD_REQUEST
    );
    assert!(post(&app, "/login", user).await.1["refresh_token"].is_string());
}

#[actix_web::test]
async fn legacy_enrollment_requires_existing_password_and_mailbox() {
    let store = Arc::new(MemoryStore::new());
    let app = common::app_with_mailer(store.clone(), Arc::new(MemoryMailer::new())).await;
    common::register(&app, "other", "Password123!").await;
    let source = store.find_user_by_username("other").await.unwrap().unwrap();
    let legacy = store
        .create_user("legacy", None, &source.password_hash)
        .await
        .unwrap();
    let mut body = json!({"username":"legacy","password":"wrong","email":"new@example.com"});
    assert_eq!(
        post(&app, "/enroll-email", body.clone()).await.0,
        StatusCode::UNAUTHORIZED
    );
    body["password"] = json!("Password123!");
    assert_eq!(
        post(&app, "/enroll-email", body.clone()).await.0,
        StatusCode::NO_CONTENT
    );
    assert!(
        store
            .find_user_by_id(legacy.id)
            .await
            .unwrap()
            .unwrap()
            .email
            .is_none()
    );
    common::confirm(&app, "new@example.com").await;
    assert_eq!(
        store
            .find_user_by_email("new@example.com")
            .await
            .unwrap()
            .unwrap()
            .id,
        legacy.id
    );
    assert_eq!(post(&app, "/login", body).await.0, StatusCode::OK);
}

#[actix_web::test]
#[ignore = "requires disposable migrated PostgreSQL"]
async fn postgres_registration_resend_and_concurrent_confirmation() {
    let pool = sqlx::PgPool::connect(&std::env::var("DATABASE_URL").unwrap())
        .await
        .unwrap();
    let store = Arc::new(PgStore::new(infra::CachedDb::new(
        pool.clone(),
        Arc::new(infra::MemoryCache::new()),
    )));
    let mailer = Arc::new(MemoryMailer::new());
    let config = AuthConfig {
        jwt_secret: SECRET.into(),
        access_token_ttl: Duration::from_secs(900),
        refresh_token_ttl: Duration::from_secs(3600),
    };
    let state = AppState::new(store.clone(), config)
        .unwrap()
        .with_mailer(mailer.clone(), common::PUBLIC_URL);
    let app = test::init_service(app(state)).await;
    let username = format!("person-{}", &Uuid::new_v4().simple().to_string()[..12]);
    let email = format!("{username}@example.test");
    let body = json!({"username":username,"password":"Password123!","email":email});
    assert_eq!(
        post(&app, "/register", body.clone()).await.0,
        StatusCode::CREATED
    );
    tokio::task::yield_now().await;
    let get_token = || {
        mailer
            .verification
            .lock()
            .unwrap()
            .last()
            .unwrap()
            .1
            .split_once("?token=")
            .unwrap()
            .1
            .to_string()
    };
    let first = get_token();
    let user = store.find_user_by_email(&email).await.unwrap().unwrap();
    assert!(user.email_verified_at.is_none());
    let (hash,ttl):(String,i32)=sqlx::query_as("SELECT token_hash,extract(epoch FROM expires_at-created_at)::int FROM email_verification_tokens WHERE user_id=$1")
        .bind(user.id).fetch_one(&pool).await.unwrap();
    assert_eq!(hash, format!("{:x}", Sha256::digest(first.as_bytes())));
    assert_eq!(ttl, 900);
    let resend = json!({"email":email});
    assert_eq!(
        post(&app, "/resend-verification-email", resend.clone())
            .await
            .0,
        StatusCode::NO_CONTENT
    );
    assert_eq!(mailer.verification.lock().unwrap().len(), 1);
    sqlx::query("UPDATE email_verification_tokens SET created_at=created_at-interval '61 seconds' WHERE user_id=$1").bind(user.id).execute(&pool).await.unwrap();
    post(&app, "/resend-verification-email", resend.clone()).await;
    tokio::task::yield_now().await;
    let second = get_token();
    assert_ne!(first, second);
    // Public resend returns before provider acknowledgement and token promotion.
    for _ in 0..100 {
        let active: String =
            sqlx::query_scalar("SELECT status FROM email_verification_tokens WHERE token_hash=$1")
                .bind(format!("{:x}", Sha256::digest(second.as_bytes())))
                .fetch_one(&pool)
                .await
                .unwrap();
        if active == "active" {
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    assert_eq!(
        post(&app, "/verify-email", json!({"token":first})).await.0,
        StatusCode::BAD_REQUEST
    );
    let hash = format!("{:x}", Sha256::digest(second.as_bytes()));
    let (a, b) = tokio::join!(
        store.consume_verification(&hash),
        store.consume_verification(&hash)
    );
    assert_ne!(a.unwrap(), b.unwrap());
    assert_eq!(post(&app, "/login", body.clone()).await.0, StatusCode::OK);
    let pending = format!("change-{email}");
    store
        .update_user(
            user.id,
            UserUpdate {
                email: Some(pending.clone()),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    assert!(store.find_user_by_email(&pending).await.unwrap().is_none());
    assert_eq!(post(&app, "/login", body).await.0, StatusCode::OK);
    sqlx::query("UPDATE email_verification_tokens SET created_at=created_at-interval '61 seconds' WHERE user_id=$1").bind(user.id).execute(&pool).await.unwrap();
    assert!(
        store
            .issue_verification(&pending, &"e".repeat(64))
            .await
            .unwrap()
    );
    store.activate_verification(&"e".repeat(64)).await.unwrap();
    sqlx::query("UPDATE email_verification_tokens SET expires_at=now() WHERE user_id=$1")
        .bind(user.id)
        .execute(&pool)
        .await
        .unwrap();
    assert!(!store.consume_verification(&"e".repeat(64)).await.unwrap());
    // Failed delivery leaves a staged token unusable. A later successful send promotes it.
    let tick = "UPDATE email_verification_tokens SET created_at=created_at-interval '61 seconds' WHERE user_id=$1";
    sqlx::query(tick)
        .bind(user.id)
        .execute(&pool)
        .await
        .unwrap();
    let replacement = format!("{:x}", Sha256::digest(format!("{pending}-replacement")));
    assert!(
        store
            .issue_verification(&pending, &replacement)
            .await
            .unwrap()
    );
    assert!(!store.consume_verification(&replacement).await.unwrap());
    store.activate_verification(&replacement).await.unwrap();
    assert!(store.consume_verification(&replacement).await.unwrap());
    assert!(store.find_user_by_email(&email).await.unwrap().is_none());
    assert_eq!(
        store
            .find_user_by_email(&pending)
            .await
            .unwrap()
            .unwrap()
            .id,
        user.id
    );
    assert!(
        !store
            .insert_password_reset_token(user.id, Some(&email), &hash, Duration::from_secs(900))
            .await
            .unwrap()
    );

    let peer = format!("{:x}", Sha256::digest(&email));
    for _ in 0..30 {
        assert!(store.allow_verification_request(&peer).await.unwrap());
    }
    assert!(!store.allow_verification_request(&peer).await.unwrap());
    let prior_address = format!("retry-{email}");
    let old_hash = format!("{:x}", Sha256::digest(&prior_address));
    let prior = store
        .create_user_with_token(
            &format!("retry-{username}"),
            Some(&prior_address),
            "fixture",
            Some(&old_hash),
        )
        .await
        .unwrap();
    sqlx::query(tick)
        .bind(prior.id)
        .execute(&pool)
        .await
        .unwrap();
    let candidate = format!("{:x}", Sha256::digest(format!("stage-{email}")));
    assert!(
        store
            .issue_verification(&prior_address, &candidate)
            .await
            .unwrap()
    );
    assert!(!store.consume_verification(&candidate).await.unwrap());
    assert!(store.consume_verification(&old_hash).await.unwrap());
    store.activate_verification(&candidate).await.unwrap();
    assert!(!store.consume_verification(&candidate).await.unwrap());
    let quota_email = format!("quota-{email}");
    let quota = store
        .create_user(&format!("quota-{username}"), Some(&quota_email), "fixture")
        .await
        .unwrap();
    for attempt in 0..5 {
        let token_hash = format!("{:x}", Sha256::digest(format!("{quota_email}-{attempt}")));
        assert!(
            store
                .issue_verification(&quota_email, &token_hash)
                .await
                .unwrap()
        );
        sqlx::query(tick)
            .bind(quota.id)
            .execute(&pool)
            .await
            .unwrap();
    }
    assert!(
        !store
            .issue_verification(&quota_email, &old_hash)
            .await
            .unwrap()
    );
    store.delete_user(quota.id).await.unwrap();
    store.delete_user(prior.id).await.unwrap();
    store.delete_user(user.id).await.unwrap();
}

#[actix_web::test]
async fn reset_does_not_confirm_an_unverified_address() {
    let store = Arc::new(MemoryStore::new());
    let mailer = Arc::new(MemoryMailer::new());
    let app = common::app_with_mailer(store.clone(), mailer.clone()).await;
    let email = "recovery@example.test";
    post(
        &app,
        "/register",
        json!({"username":"reset","email":email,"password":"Password123!"}),
    )
    .await;
    post(&app, "/forgot-password", json!({"email":email})).await;
    tokio::task::yield_now().await;
    let link = mailer.sent()[0].1.clone();
    let token = link.split_once("?token=").unwrap().1;
    assert_eq!(
        post(
            &app,
            "/reset-password",
            json!({"token":token,"password":"Changed123!"})
        )
        .await
        .0,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        post(
            &app,
            "/login",
            json!({"email":email,"password":"Changed123!"})
        )
        .await
        .1["error"],
        "email_unverified"
    );
}

#[actix_web::test]
async fn address_edits_invalidate_old_links_even_if_the_address_returns() {
    let store = MemoryStore::new();
    let user = store
        .create_user("edit", Some("first@example.test"), "fixture")
        .await
        .unwrap();
    assert!(
        store
            .issue_verification("first@example.test", "first")
            .await
            .unwrap()
    );
    store.activate_verification("first").await.unwrap();
    for address in ["second@example.test", "first@example.test"] {
        store
            .update_user(
                user.id,
                UserUpdate {
                    email: Some(address.into()),
                    ..Default::default()
                },
            )
            .await
            .unwrap();
    }
    assert!(!store.consume_verification("first").await.unwrap());
}

#[actix_web::test]
async fn failed_delivery_keeps_registration_unverified_and_retry_safe() {
    let store = Arc::new(MemoryStore::new());
    let config = AuthConfig {
        jwt_secret: SECRET.into(),
        access_token_ttl: Duration::from_secs(900),
        refresh_token_ttl: Duration::from_secs(3600),
    };
    // NoopMailer reports unavailable delivery and never synthesizes successful mail.
    let app = test::init_service(app(AppState::new(store.clone(), config).unwrap())).await;
    let body =
        json!({"username":"failure","email":"failure@example.test","password":"Password123!"});
    assert_eq!(
        post(&app, "/register", body.clone()).await.0,
        StatusCode::CREATED
    );
    assert_eq!(
        post(&app, "/register", body.clone()).await.0,
        StatusCode::CONFLICT
    );
    assert_eq!(
        post(&app, "/login", body).await.1["error"],
        "email_unverified"
    );
}
