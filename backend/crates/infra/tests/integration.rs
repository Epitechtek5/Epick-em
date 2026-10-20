//! Parcours complet contre un vrai PostgreSQL et un vrai Redis, ignoré par défaut :
//! `DATABASE_URL=… REDIS_URL=… cargo test -p infra -- --ignored`

use infra::{Config, Ttl};

#[tokio::test]
#[ignore = "nécessite PostgreSQL (DATABASE_URL) et Redis (REDIS_URL)"]
async fn read_write_delete_through_redis() {
    let config = Config::from_env().unwrap();
    let db = infra::connect(&config).await.unwrap();
    let key = format!("infra-it:{}", std::process::id());
    let ttl = Ttl::from_secs(30);

    let value: i64 = db
        .read(&key, ttl, |pool| async move {
            sqlx::query_scalar("SELECT 41::bigint + 1")
                .fetch_one(&pool)
                .await
        })
        .await
        .unwrap();
    assert_eq!(value, 42);
    assert_eq!(db.cache().get(&key).await.unwrap(), Some(b"42".to_vec()));

    let value: i64 = db
        .write(&key, ttl, |pool| async move {
            sqlx::query_scalar("SELECT 43::bigint")
                .fetch_one(&pool)
                .await
        })
        .await
        .unwrap();
    assert_eq!(value, 43);
    assert_eq!(db.cache().get(&key).await.unwrap(), Some(b"43".to_vec()));

    db.delete(&[&key], |pool| async move {
        sqlx::query("SELECT 1").execute(&pool).await
    })
    .await
    .unwrap();
    assert_eq!(db.cache().get(&key).await.unwrap(), None);
}
