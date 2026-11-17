//! Bus contre un vrai Redis, ignoré par défaut :
//! `REDIS_URL=redis://localhost:6379 cargo test -p infra --test bus -- --ignored`

use domain::events::{ChangeCause, Event, EventKind, LiveMessage};
use infra::{
    EventBus, EventStream, LiveBus, RedisCache, RedisEventBus, RedisEventStream, RedisLive,
};
use serde_json::json;
use std::time::Duration;
use uuid::Uuid;

fn url() -> String {
    std::env::var("REDIS_URL").expect("REDIS_URL")
}

fn event() -> Event {
    Event::new(
        Uuid::new_v4(),
        1,
        EventKind::TournamentChanged {
            tournament_id: Uuid::new_v4(),
            match_id: None,
            cause: ChangeCause::Api,
        },
    )
}

#[tokio::test]
#[ignore = "nécessite un Redis (REDIS_URL)"]
async fn stream_delivers_once_per_group_and_keeps_unacked() {
    let url = url();
    let cache = RedisCache::connect(&url).await.unwrap();
    let stream = format!("infra-test:events:{}", Uuid::new_v4());
    let bus = RedisEventBus::new(cache.connection(), &stream);
    let a = RedisEventStream::connect(&url, &stream, "g", "a")
        .await
        .unwrap();
    let b = RedisEventStream::connect(&url, &stream, "g", "b")
        .await
        .unwrap();
    // Le groupe existe déjà : la seconde connexion ne le recrée pas.

    let (first, second) = (event(), event());
    bus.publish(&first).await.unwrap();
    bus.publish(&second).await.unwrap();
    let read = a.read(1, Duration::from_millis(100)).await.unwrap();
    assert_eq!(read.len(), 1);
    assert_eq!(read[0].event.as_ref(), Some(&first));
    // L'autre membre du groupe reçoit la suite, pas le même événement.
    let other = b.read(10, Duration::from_millis(100)).await.unwrap();
    assert_eq!(other.len(), 1);
    assert_eq!(other[0].event.as_ref(), Some(&second));
    a.ack(&[read[0].id.clone()]).await.unwrap();
    b.ack(&[other[0].id.clone()]).await.unwrap();
    // Rien de neuf : la lecture bloque puis rend la main, vide.
    assert!(
        a.read(10, Duration::from_millis(200))
            .await
            .unwrap()
            .is_empty()
    );

    redis::cmd("DEL")
        .arg(&stream)
        .query_async::<()>(&mut cache.connection())
        .await
        .unwrap();
    // Flux supprimé : le groupe est recréé à la volée.
    bus.publish(&first).await.unwrap();
    let again = a.read(10, Duration::from_millis(100)).await.unwrap();
    assert_eq!(again.len(), 1);
    redis::cmd("DEL")
        .arg(&stream)
        .query_async::<()>(&mut cache.connection())
        .await
        .unwrap();
}

#[tokio::test]
#[ignore = "nécessite un Redis (REDIS_URL)"]
async fn live_messages_reach_every_instance() {
    let url = url();
    let cache = RedisCache::connect(&url).await.unwrap();
    let (one, two) = (
        RedisLive::start(&url, cache.connection()).unwrap(),
        RedisLive::start(&url, cache.connection()).unwrap(),
    );
    let mut heard = two.subscribe();
    // Laisse aux tâches le temps de s'abonner.
    tokio::time::sleep(Duration::from_millis(300)).await;
    let message = LiveMessage::new(
        format!("tournament:{}", Uuid::new_v4()),
        "tournament.updated",
        json!({ "n": 1 }),
    );
    one.broadcast(&message).await.unwrap();
    let got = tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            let m = heard.recv().await.unwrap();
            if m == message {
                return m;
            }
        }
    })
    .await
    .unwrap();
    assert_eq!(got, message);
    // This integration suite requires an isolated Redis. Drop Pub/Sub connections only;
    // the existing local receiver must be invalidated after the relay reconnects.
    redis::cmd("CLIENT")
        .arg("KILL")
        .arg("TYPE")
        .arg("pubsub")
        .query_async::<u64>(&mut cache.connection())
        .await
        .unwrap();
    let restored = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let message = heard.recv().await.unwrap();
            if message.is_resync() {
                return message;
            }
        }
    })
    .await
    .unwrap();
    assert!(restored.is_resync());
    one.broadcast(&message).await.unwrap();
    let got = tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            let received = heard.recv().await.unwrap();
            if received == message {
                return received;
            }
        }
    })
    .await
    .unwrap();
    assert_eq!(got, message);
}
