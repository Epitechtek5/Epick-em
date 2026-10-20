//! Tests de `CachedDb` sans base : les closures ne touchent pas au pool (paresseux,
//! jamais connecté) et comptent leurs appels pour distinguer cache et base.

use async_trait::async_trait;
use infra::{Cache, CacheError, CachedDb, MemoryCache, Ttl};
use sqlx::postgres::PgPoolOptions;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

const TTL: Ttl = Ttl::from_mins(1);

fn db(cache: Arc<dyn Cache>) -> CachedDb {
    let pool = PgPoolOptions::new()
        .connect_lazy("postgres://unused@localhost/unused")
        .unwrap();
    CachedDb::new(pool, cache)
}

/// Cache toujours en erreur, comme un Redis injoignable.
struct FailingCache;

#[async_trait]
impl Cache for FailingCache {
    async fn get(&self, _: &str) -> Result<Option<Vec<u8>>, CacheError> {
        Err(CacheError("injoignable".into()))
    }
    async fn set(&self, _: &str, _: Vec<u8>, _: Ttl) -> Result<(), CacheError> {
        Err(CacheError("injoignable".into()))
    }
    async fn delete(&self, _: &[&str]) -> Result<(), CacheError> {
        Err(CacheError("injoignable".into()))
    }
}

#[tokio::test]
async fn read_queries_once_then_hits_cache() {
    let db = db(Arc::new(MemoryCache::new()));
    let calls = AtomicUsize::new(0);
    for _ in 0..2 {
        let value: Vec<String> = db
            .read("k", TTL, |_| async {
                calls.fetch_add(1, Ordering::SeqCst);
                Ok(vec!["a".to_owned()])
            })
            .await
            .unwrap();
        assert_eq!(value, ["a"]);
    }
    assert_eq!(calls.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn read_optional_does_not_cache_none() {
    let db = db(Arc::new(MemoryCache::new()));
    let none: Option<i64> = db
        .read_optional("k", TTL, |_| async { Ok(None) })
        .await
        .unwrap();
    assert_eq!(none, None);
    let some: Option<i64> = db
        .read_optional("k", TTL, |_| async { Ok(Some(7)) })
        .await
        .unwrap();
    assert_eq!(some, Some(7));
    let cached: Option<i64> = db
        .read_optional("k", TTL, |_| async { panic!("aurait dû venir du cache") })
        .await
        .unwrap();
    assert_eq!(cached, Some(7));
}

#[tokio::test]
async fn write_replaces_cached_value() {
    let db = db(Arc::new(MemoryCache::new()));
    let _: i64 = db.read("k", TTL, |_| async { Ok(1) }).await.unwrap();
    let written: i64 = db.write("k", TTL, |_| async { Ok(2) }).await.unwrap();
    assert_eq!(written, 2);
    let read: i64 = db
        .read("k", TTL, |_| async { panic!("aurait dû venir du cache") })
        .await
        .unwrap();
    assert_eq!(read, 2);
}

#[tokio::test]
async fn delete_invalidates_keys() {
    let db = db(Arc::new(MemoryCache::new()));
    let _: i64 = db.read("a", TTL, |_| async { Ok(1) }).await.unwrap();
    let _: i64 = db.read("b", TTL, |_| async { Ok(1) }).await.unwrap();
    db.delete(&["a", "b"], |_| async { Ok(()) }).await.unwrap();
    for key in ["a", "b"] {
        let value: i64 = db.read(key, TTL, |_| async { Ok(2) }).await.unwrap();
        assert_eq!(value, 2);
    }
}

#[tokio::test]
async fn database_error_is_returned_and_not_cached() {
    let db = db(Arc::new(MemoryCache::new()));
    let err = db
        .read::<i64, _, _>("k", TTL, |_| async { Err(sqlx::Error::RowNotFound) })
        .await;
    assert!(matches!(err, Err(sqlx::Error::RowNotFound)));
    let value: i64 = db.read("k", TTL, |_| async { Ok(3) }).await.unwrap();
    assert_eq!(value, 3);
}

#[tokio::test]
async fn unreadable_cached_value_falls_back_to_database() {
    let cache = Arc::new(MemoryCache::new());
    cache.set("k", b"pas du json".to_vec(), TTL).await.unwrap();
    let db = db(cache);
    let value: i64 = db.read("k", TTL, |_| async { Ok(4) }).await.unwrap();
    assert_eq!(value, 4);
}

#[tokio::test]
async fn cache_failure_is_ignored() {
    let db = db(Arc::new(FailingCache));
    let value: i64 = db.read("k", TTL, |_| async { Ok(5) }).await.unwrap();
    assert_eq!(value, 5);
    let value: i64 = db.write("k", TTL, |_| async { Ok(6) }).await.unwrap();
    assert_eq!(value, 6);
    db.delete(&["k"], |_| async { Ok(()) }).await.unwrap();
}
