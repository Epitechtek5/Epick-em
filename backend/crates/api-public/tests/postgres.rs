//! `PgStore` contre un vrai PostgreSQL migré (image `db/`), ignoré par défaut :
//! `DATABASE_URL=… cargo test -p api-public --test postgres -- --ignored`

use api_public::store::{AuthStore, PgStore, Role, StoreError, UserUpdate};
use infra::{CachedDb, MemoryCache};
use std::sync::Arc;
use std::time::Duration;
use uuid::Uuid;

async fn store() -> PgStore {
    let url = std::env::var("DATABASE_URL").expect("DATABASE_URL");
    let pool = sqlx::PgPool::connect(&url).await.unwrap();
    PgStore::new(CachedDb::new(pool, Arc::new(MemoryCache::new())))
}

/// Nom unique par test : la base est partagée et jamais vidée.
fn unique(prefix: &str) -> String {
    format!("{prefix}-{}", &Uuid::new_v4().simple().to_string()[..12])
}

#[tokio::test]
#[ignore = "nécessite PostgreSQL migré (DATABASE_URL)"]
async fn users_are_unique_whatever_the_case() {
    let store = store().await;
    let name = unique("Alice");

    let user = store.create_user(&name, None, "hash").await.unwrap();
    assert_eq!(user.username, name);
    assert_eq!(user.role, Role::User);
    assert!(matches!(
        store.create_user(&name.to_lowercase(), None, "autre").await,
        Err(StoreError::UsernameTaken)
    ));

    let found = store
        .find_user_by_username(&name.to_uppercase())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(found.id, user.id);
    assert_eq!(found.password_hash, "hash");
    assert_eq!(
        store
            .find_user_by_id(user.id)
            .await
            .unwrap()
            .unwrap()
            .username,
        name
    );
    assert!(
        store
            .find_user_by_id(Uuid::new_v4())
            .await
            .unwrap()
            .is_none()
    );
}

#[tokio::test]
#[ignore = "nécessite PostgreSQL migré (DATABASE_URL)"]
async fn refresh_tokens_rotate_once_and_can_be_revoked() {
    let store = store().await;
    let user = store
        .create_user(&unique("rot"), None, "hash")
        .await
        .unwrap();
    let ttl = Duration::from_secs(60);
    let (a, b, c) = (unique("a"), unique("b"), unique("c"));

    store.insert_refresh_token(user.id, &a, ttl).await.unwrap();
    let stranger = Uuid::new_v4();
    // Un autre compte ne peut ni utiliser ni révoquer le jeton.
    assert!(
        !store
            .rotate_refresh_token(stranger, &a, &b, ttl)
            .await
            .unwrap()
    );
    store.revoke_refresh_token(stranger, &a).await.unwrap();
    assert!(
        store
            .rotate_refresh_token(user.id, &a, &b, ttl)
            .await
            .unwrap()
    );
    // `a` est consommé, et un échec de rotation n'enregistre rien.
    assert!(
        !store
            .rotate_refresh_token(user.id, &a, &c, ttl)
            .await
            .unwrap()
    );
    assert!(
        !store
            .rotate_refresh_token(user.id, &c, &c, ttl)
            .await
            .unwrap()
    );

    store.revoke_refresh_token(user.id, &b).await.unwrap();
    store.revoke_refresh_token(user.id, &b).await.unwrap();
    assert!(
        !store
            .rotate_refresh_token(user.id, &b, &c, ttl)
            .await
            .unwrap()
    );
}

#[tokio::test]
#[ignore = "nécessite PostgreSQL migré (DATABASE_URL)"]
async fn expired_refresh_tokens_are_refused() {
    let store = store().await;
    let user = store
        .create_user(&unique("exp"), None, "hash")
        .await
        .unwrap();
    let (a, b) = (unique("a"), unique("b"));

    store
        .insert_refresh_token(user.id, &a, Duration::from_millis(100))
        .await
        .unwrap();
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert!(
        !store
            .rotate_refresh_token(user.id, &a, &b, Duration::from_secs(60))
            .await
            .unwrap()
    );
}

#[tokio::test]
#[ignore = "nécessite PostgreSQL migré (DATABASE_URL)"]
async fn concurrent_rotations_of_one_token_have_a_single_winner() {
    let store = std::sync::Arc::new(store().await);
    let user = store
        .create_user(&unique("race"), None, "hash")
        .await
        .unwrap();
    let ttl = Duration::from_secs(60);
    let old = unique("old");
    store
        .insert_refresh_token(user.id, &old, ttl)
        .await
        .unwrap();

    let attempts = (0..8).map(|_| {
        let (store, old, new) = (store.clone(), old.clone(), unique("new"));
        let user_id = user.id;
        tokio::spawn(async move {
            store
                .rotate_refresh_token(user_id, &old, &new, ttl)
                .await
                .unwrap()
        })
    });
    let mut winners = 0;
    for attempt in attempts {
        winners += usize::from(attempt.await.unwrap());
    }
    assert_eq!(winners, 1);
}

#[tokio::test]
#[ignore = "nécessite PostgreSQL migré (DATABASE_URL)"]
async fn profiles_are_updated_and_the_cache_follows() {
    let store = store().await;
    let name = unique("prof");
    let user = store.create_user(&name, None, "hash").await.unwrap();

    // Première lecture : mise en cache. La modification doit l'invalider.
    let before = store.find_profile(user.id).await.unwrap().unwrap();
    assert_eq!(
        (before.username.as_str(), before.role),
        (name.as_str(), Role::User)
    );

    let renamed = unique("renamed");
    let updated = store
        .update_user(
            user.id,
            UserUpdate {
                username: Some(renamed.clone()),
                role: Some(Role::Watcher),
                ..UserUpdate::default()
            },
        )
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        (updated.username.as_str(), updated.role),
        (renamed.as_str(), Role::Watcher)
    );
    assert_eq!(store.find_profile(user.id).await.unwrap().unwrap(), updated);

    // Les champs non fournis sont conservés, l'empreinte comprise.
    let record = store.find_user_by_id(user.id).await.unwrap().unwrap();
    assert_eq!(record.password_hash, "hash");

    let other = store
        .create_user(&unique("other"), None, "hash")
        .await
        .unwrap();
    assert!(matches!(
        store
            .update_user(
                other.id,
                UserUpdate {
                    username: Some(renamed.to_uppercase()),
                    ..UserUpdate::default()
                },
            )
            .await,
        Err(StoreError::UsernameTaken)
    ));
    assert!(
        store
            .update_user(Uuid::new_v4(), UserUpdate::default())
            .await
            .unwrap()
            .is_none()
    );
}

#[tokio::test]
#[ignore = "nécessite PostgreSQL migré (DATABASE_URL)"]
async fn deleting_a_user_clears_the_cache_and_the_refresh_tokens() {
    let store = store().await;
    let user = store
        .create_user(&unique("del"), None, "hash")
        .await
        .unwrap();
    let token = unique("tok");
    store
        .insert_refresh_token(user.id, &token, Duration::from_secs(60))
        .await
        .unwrap();
    assert!(store.find_profile(user.id).await.unwrap().is_some());

    assert!(store.delete_user(user.id).await.unwrap());
    assert!(store.find_profile(user.id).await.unwrap().is_none());
    assert!(!store.delete_user(user.id).await.unwrap());
    assert!(
        !store
            .rotate_refresh_token(user.id, &token, &unique("new"), Duration::from_secs(60))
            .await
            .unwrap()
    );
}

#[tokio::test]
#[ignore = "nécessite PostgreSQL migré (DATABASE_URL)"]
async fn the_watcher_role_is_accepted_by_the_database() {
    let store = store().await;
    let user = store
        .create_user(&unique("watch"), None, "hash")
        .await
        .unwrap();
    let updated = store
        .update_user(
            user.id,
            UserUpdate {
                role: Some(Role::Watcher),
                ..UserUpdate::default()
            },
        )
        .await
        .unwrap()
        .unwrap();
    assert_eq!(updated.role, Role::Watcher);
    let listed = store.list_profiles(1000, 0).await.unwrap();
    assert!(
        listed
            .iter()
            .any(|p| p.id == user.id && p.role == Role::Watcher)
    );
}

#[tokio::test]
#[ignore = "nécessite PostgreSQL migré (DATABASE_URL)"]
async fn emails_are_unique_and_found() {
    let store = store().await;
    let email = format!("{}@example.com", unique("mail"));
    let user = store
        .create_user(&unique("mail"), Some(&email), "hash")
        .await
        .unwrap();
    assert_eq!(user.email.as_deref(), Some(email.as_str()));
    assert!(matches!(
        store
            .create_user(&unique("mail"), Some(&email), "hash")
            .await,
        Err(StoreError::EmailTaken)
    ));
    // Plusieurs comptes peuvent n'avoir aucune adresse.
    store
        .create_user(&unique("none"), None, "hash")
        .await
        .unwrap();
    store
        .create_user(&unique("none"), None, "hash")
        .await
        .unwrap();

    assert_eq!(
        store.find_user_by_email(&email).await.unwrap().unwrap().id,
        user.id
    );
    assert!(
        store
            .find_user_by_email("inconnu@example.com")
            .await
            .unwrap()
            .is_none()
    );

    let other = store
        .create_user(&unique("mail"), None, "hash")
        .await
        .unwrap();
    let taken = store
        .update_user(
            other.id,
            UserUpdate {
                email: Some(email.clone()),
                ..UserUpdate::default()
            },
        )
        .await;
    assert!(matches!(taken, Err(StoreError::EmailTaken)));
}

#[tokio::test]
#[ignore = "nécessite PostgreSQL migré (DATABASE_URL)"]
async fn password_reset_tokens_work_once_and_end_sessions() {
    let store = store().await;
    let user = store
        .create_user(&unique("reset"), None, "ancien")
        .await
        .unwrap();
    let ttl = Duration::from_secs(60);
    let (a, b) = (unique("tok-a"), unique("tok-b"));
    let (hash_a, hash_b) = (format!("{a:0>64}"), format!("{b:0>64}"));
    store
        .insert_refresh_token(user.id, &format!("{:0>64}", unique("rt")), ttl)
        .await
        .unwrap();
    let session = format!("{:0>64}", unique("rt"));
    store
        .insert_refresh_token(user.id, &session, ttl)
        .await
        .unwrap();

    // Une nouvelle demande invalide la précédente.
    store
        .insert_password_reset_token(user.id, &hash_a, ttl)
        .await
        .unwrap();
    store
        .insert_password_reset_token(user.id, &hash_b, ttl)
        .await
        .unwrap();
    assert!(
        !store
            .consume_password_reset_token(&hash_a, "x")
            .await
            .unwrap()
    );
    assert!(
        !store
            .consume_password_reset_token(&format!("{:0>64}", "inconnu"), "x")
            .await
            .unwrap()
    );

    assert!(
        store
            .consume_password_reset_token(&hash_b, "nouveau")
            .await
            .unwrap()
    );
    assert!(
        !store
            .consume_password_reset_token(&hash_b, "autre")
            .await
            .unwrap()
    );
    let found = store.find_user_by_id(user.id).await.unwrap().unwrap();
    assert_eq!(found.password_hash, "nouveau");
    // Les sessions ouvertes sont révoquées.
    assert!(
        !store
            .rotate_refresh_token(user.id, &session, &format!("{:0>64}", unique("n")), ttl)
            .await
            .unwrap()
    );
}

#[tokio::test]
#[ignore = "nécessite PostgreSQL migré (DATABASE_URL)"]
async fn expired_password_reset_tokens_are_refused() {
    let store = store().await;
    let user = store
        .create_user(&unique("rexp"), None, "ancien")
        .await
        .unwrap();
    let hash = format!("{:0>64}", unique("exp"));
    store
        .insert_password_reset_token(user.id, &hash, Duration::from_millis(50))
        .await
        .unwrap();
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert!(
        !store
            .consume_password_reset_token(&hash, "nouveau")
            .await
            .unwrap()
    );
    assert_eq!(
        store
            .find_user_by_id(user.id)
            .await
            .unwrap()
            .unwrap()
            .password_hash,
        "ancien"
    );
}
