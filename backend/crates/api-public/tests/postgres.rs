//! `PgStore` contre un vrai PostgreSQL migré (image `db/`), ignoré par défaut :
//! `DATABASE_URL=… cargo test -p api-public --test postgres -- --ignored`

use api_public::store::{AuthStore, PgStore, Role, StoreError};
use std::time::Duration;
use uuid::Uuid;

async fn store() -> PgStore {
    let url = std::env::var("DATABASE_URL").expect("DATABASE_URL");
    PgStore::new(sqlx::PgPool::connect(&url).await.unwrap())
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

    let user = store.create_user(&name, "hash").await.unwrap();
    assert_eq!(user.username, name);
    assert_eq!(user.role, Role::User);
    assert!(matches!(
        store.create_user(&name.to_lowercase(), "autre").await,
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
    let user = store.create_user(&unique("rot"), "hash").await.unwrap();
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
    let user = store.create_user(&unique("exp"), "hash").await.unwrap();
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
    let user = store.create_user(&unique("race"), "hash").await.unwrap();
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
