//! Test contre un vrai Redis, ignoré par défaut :
//! `REDIS_URL=redis://localhost:6379 cargo test -p infra -- --ignored`

use infra::{Cache, RedisCache, Ttl};
use std::time::Duration;

#[tokio::test]
#[ignore = "nécessite un Redis (REDIS_URL)"]
async fn redis_set_get_delete() {
    let url = std::env::var("REDIS_URL").expect("REDIS_URL");
    let cache = RedisCache::connect(&url).await.unwrap();
    let key = format!("infra-test:{}", std::process::id());

    cache
        .set(&key, b"v".to_vec(), Ttl::from_secs(60))
        .await
        .unwrap();
    assert_eq!(cache.get(&key).await.unwrap(), Some(b"v".to_vec()));
    cache.delete(&[&key]).await.unwrap();
    assert_eq!(cache.get(&key).await.unwrap(), None);
    cache.delete(&[]).await.unwrap();

    cache
        .set(&key, b"v".to_vec(), Ttl::from_secs(1))
        .await
        .unwrap();
    tokio::time::sleep(Duration::from_millis(1500)).await;
    assert_eq!(cache.get(&key).await.unwrap(), None);
}
