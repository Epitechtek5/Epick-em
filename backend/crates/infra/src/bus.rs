//! Bus Redis (ADR-002) : événements métier et diffusion temps réel.
//!
//! - **Événements** ([`EventBus`] pour publier, [`EventStream`] pour consommer) : un flux Redis
//!   Streams, lu par un groupe de consommateurs avec acquittement. Un événement non acquitté
//!   (consommateur tombé en cours de traitement) est repris par un autre au bout de
//!   [`CLAIM_AFTER`] ; rien n'est perdu au redémarrage d'api-internal.
//! - **Temps réel** ([`LiveBus`]) : Redis Pub/Sub, éphémère. Chaque instance d'api-public
//!   s'abonne à `live.*` et redistribue les messages à ses clients WebSocket ; un message publié
//!   par une instance atteint donc toutes les autres.
//!
//! Les implémentations en mémoire servent aux tests et au développement sans Redis.

use async_trait::async_trait;
use domain::events::{Event, LiveMessage};
use futures_util::StreamExt;
use redis::aio::{ConnectionManager, ConnectionManagerConfig};
use redis::streams::{
    StreamAutoClaimOptions, StreamAutoClaimReply, StreamId, StreamReadOptions, StreamReadReply,
};
use redis::{AsyncCommands, RedisError};
use std::collections::{HashMap, VecDeque};
use std::fmt;
use std::sync::Mutex;
use std::time::Duration;
use tokio::sync::{Notify, broadcast};

/// Nom du flux des événements métier.
pub const EVENTS_STREAM: &str = "epickem:events";
/// Groupe de consommateurs d'api-internal.
pub const EVENTS_GROUP: &str = "api-internal";
/// Préfixe des canaux Pub/Sub temps réel (`live.<sujet>`).
pub const LIVE_PREFIX: &str = "live.";
/// Événements gardés dans le flux (approximativement) : au-delà, les plus anciens tombent.
pub const STREAM_MAXLEN: usize = 100_000;
/// Délai après lequel un événement livré mais non acquitté est repris par un autre
/// consommateur.
pub const CLAIM_AFTER: Duration = Duration::from_secs(60);
/// Messages temps réel en attente par abonné local ; au-delà, l'abonné en retard est prévenu.
const LIVE_CAPACITY: usize = 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BusError(pub String);

impl fmt::Display for BusError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for BusError {}

impl From<RedisError> for BusError {
    fn from(err: RedisError) -> Self {
        BusError(err.to_string())
    }
}

/// Événement livré par le flux : `event` vaut `None` s'il est illisible (schéma inconnu), à
/// acquitter quand même pour ne pas le relire sans fin.
#[derive(Debug, Clone, PartialEq)]
pub struct Delivery {
    pub id: String,
    pub event: Option<Event>,
}

/// Publication des événements métier.
#[async_trait]
pub trait EventBus: Send + Sync {
    async fn publish(&self, event: &Event) -> Result<(), BusError>;
}

/// Consommation des événements métier, au sein d'un groupe.
#[async_trait]
pub trait EventStream: Send + Sync {
    /// Jusqu'à `max` événements : d'abord ceux abandonnés par un autre consommateur, sinon les
    /// nouveaux, en attendant au plus `block`. Vide si rien n'est arrivé.
    async fn read(&self, max: usize, block: Duration) -> Result<Vec<Delivery>, BusError>;

    /// Acquitte les événements traités.
    async fn ack(&self, ids: &[String]) -> Result<(), BusError>;
}

/// Diffusion temps réel à toutes les instances.
#[async_trait]
pub trait LiveBus: Send + Sync {
    /// Diffuse le message ; les abonnés de toutes les instances le reçoivent.
    async fn broadcast(&self, message: &LiveMessage) -> Result<(), BusError>;

    /// Abonnement aux messages reçus par cette instance.
    fn subscribe(&self) -> broadcast::Receiver<LiveMessage>;
}

// ---------------------------------------------------------------------------------------------
// En mémoire

#[derive(Default)]
struct MemoryState {
    next_id: u64,
    queue: VecDeque<(String, Event)>,
    in_flight: HashMap<String, Event>,
    published: Vec<Event>,
}

/// Flux en mémoire, à un seul consommateur. Plafonné : sans consommateur, les plus anciens
/// événements tombent.
#[derive(Default)]
pub struct MemoryBus {
    state: Mutex<MemoryState>,
    arrived: Notify,
}

impl MemoryBus {
    const CAPACITY: usize = 10_000;

    pub fn new() -> Self {
        Self::default()
    }

    fn state(&self) -> std::sync::MutexGuard<'_, MemoryState> {
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Événements publiés jusqu'ici (les plus récents, dans la limite du plafond).
    pub fn published(&self) -> Vec<Event> {
        self.state().published.clone()
    }

    /// Événements livrés et pas encore acquittés.
    pub fn in_flight(&self) -> usize {
        self.state().in_flight.len()
    }
}

#[async_trait]
impl EventBus for MemoryBus {
    async fn publish(&self, event: &Event) -> Result<(), BusError> {
        {
            let mut state = self.state();
            state.next_id += 1;
            let id = format!("{}-0", state.next_id);
            state.queue.push_back((id, event.clone()));
            state.published.push(event.clone());
            if state.queue.len() > Self::CAPACITY {
                state.queue.pop_front();
            }
            if state.published.len() > Self::CAPACITY {
                state.published.remove(0);
            }
        }
        self.arrived.notify_one();
        Ok(())
    }
}

#[async_trait]
impl EventStream for MemoryBus {
    async fn read(&self, max: usize, block: Duration) -> Result<Vec<Delivery>, BusError> {
        let take = |state: &mut MemoryState| -> Vec<Delivery> {
            let mut out = Vec::new();
            while out.len() < max {
                let Some((id, event)) = state.queue.pop_front() else {
                    break;
                };
                state.in_flight.insert(id.clone(), event.clone());
                out.push(Delivery {
                    id,
                    event: Some(event),
                });
            }
            out
        };
        let ready = take(&mut self.state());
        if !ready.is_empty() || block.is_zero() {
            return Ok(ready);
        }
        let _ = tokio::time::timeout(block, self.arrived.notified()).await;
        Ok(take(&mut self.state()))
    }

    async fn ack(&self, ids: &[String]) -> Result<(), BusError> {
        let mut state = self.state();
        for id in ids {
            state.in_flight.remove(id);
        }
        Ok(())
    }
}

/// Diffusion en mémoire, limitée à ce processus.
pub struct MemoryLive {
    sender: broadcast::Sender<LiveMessage>,
}

impl Default for MemoryLive {
    fn default() -> Self {
        MemoryLive {
            sender: broadcast::channel(LIVE_CAPACITY).0,
        }
    }
}

impl MemoryLive {
    pub fn new() -> Self {
        Self::default()
    }
}

#[async_trait]
impl LiveBus for MemoryLive {
    async fn broadcast(&self, message: &LiveMessage) -> Result<(), BusError> {
        // Sans abonné, le message est simplement perdu : c'est le contrat du temps réel.
        let _ = self.sender.send(message.clone());
        Ok(())
    }

    fn subscribe(&self) -> broadcast::Receiver<LiveMessage> {
        self.sender.subscribe()
    }
}

// ---------------------------------------------------------------------------------------------
// Redis

fn event_of(entry: &StreamId) -> Delivery {
    let event = entry
        .get::<String>("event")
        .and_then(|json| serde_json::from_str::<Event>(&json).ok());
    Delivery {
        id: entry.id.clone(),
        event,
    }
}

/// Publication dans le flux Redis (`XADD … MAXLEN ~`).
#[derive(Clone)]
pub struct RedisEventBus {
    connection: ConnectionManager,
    stream: String,
}

impl RedisEventBus {
    /// Sur une connexion existante (celle du cache) : `XADD` ne bloque pas.
    pub fn new(connection: ConnectionManager, stream: &str) -> Self {
        RedisEventBus {
            connection,
            stream: stream.to_string(),
        }
    }
}

#[async_trait]
impl EventBus for RedisEventBus {
    async fn publish(&self, event: &Event) -> Result<(), BusError> {
        let json = serde_json::to_string(event).map_err(|err| BusError(err.to_string()))?;
        redis::cmd("XADD")
            .arg(&self.stream)
            .arg("MAXLEN")
            .arg("~")
            .arg(STREAM_MAXLEN)
            .arg("*")
            .arg("event")
            .arg(json)
            .query_async::<String>(&mut self.connection.clone())
            .await?;
        Ok(())
    }
}

/// Consommateur du flux Redis, membre d'un groupe. Sa connexion lui est propre : la lecture
/// bloquante (`XREADGROUP … BLOCK`) ne doit pas retenir les autres commandes.
pub struct RedisEventStream {
    connection: ConnectionManager,
    stream: String,
    group: String,
    consumer: String,
}

impl RedisEventStream {
    /// Ouvre une connexion dédiée et crée le groupe s'il n'existe pas (le flux aussi).
    pub async fn connect(
        url: &str,
        stream: &str,
        group: &str,
        consumer: &str,
    ) -> Result<Self, BusError> {
        let client = redis::Client::open(url)?;
        // Le délai de réponse doit couvrir l'attente de XREADGROUP BLOCK.
        let config = ConnectionManagerConfig::new()
            .set_response_timeout(Some(Duration::from_secs(30)))
            .set_connection_timeout(Some(Duration::from_secs(5)));
        let connection = ConnectionManager::new_with_config(client, config).await?;
        let consumer = RedisEventStream {
            connection,
            stream: stream.to_string(),
            group: group.to_string(),
            consumer: consumer.to_string(),
        };
        consumer.ensure_group().await?;
        Ok(consumer)
    }

    /// Crée le groupe, à partir du début du flux ; sans effet s'il existe déjà.
    async fn ensure_group(&self) -> Result<(), BusError> {
        let created: Result<(), RedisError> = self
            .connection
            .clone()
            .xgroup_create_mkstream(&self.stream, &self.group, "0")
            .await;
        match created {
            Ok(()) => Ok(()),
            Err(err) if err.code() == Some("BUSYGROUP") => Ok(()),
            Err(err) => Err(err.into()),
        }
    }

    async fn read_once(&self, max: usize, block: Duration) -> Result<Vec<Delivery>, RedisError> {
        let mut connection = self.connection.clone();
        let claimed: StreamAutoClaimReply = connection
            .xautoclaim_options(
                &self.stream,
                &self.group,
                &self.consumer,
                CLAIM_AFTER.as_millis() as u64,
                "0-0",
                StreamAutoClaimOptions::default().count(max),
            )
            .await?;
        if !claimed.claimed.is_empty() {
            return Ok(claimed.claimed.iter().map(event_of).collect());
        }
        let options = StreamReadOptions::default()
            .group(&self.group, &self.consumer)
            .count(max)
            .block(block.as_millis() as usize);
        let reply: Option<StreamReadReply> = connection
            .xread_options(&[&self.stream], &[">"], &options)
            .await?;
        Ok(reply
            .map(|reply| {
                reply
                    .keys
                    .iter()
                    .flat_map(|key| key.ids.iter().map(event_of))
                    .collect()
            })
            .unwrap_or_default())
    }
}

#[async_trait]
impl EventStream for RedisEventStream {
    async fn read(&self, max: usize, block: Duration) -> Result<Vec<Delivery>, BusError> {
        match self.read_once(max, block).await {
            Ok(deliveries) => Ok(deliveries),
            // Flux ou groupe disparu (Redis vidé) : on les recrée et on relit.
            Err(err) if err.code() == Some("NOGROUP") => {
                self.ensure_group().await?;
                Ok(self.read_once(max, block).await?)
            }
            Err(err) => Err(err.into()),
        }
    }

    async fn ack(&self, ids: &[String]) -> Result<(), BusError> {
        if ids.is_empty() {
            return Ok(());
        }
        self.connection
            .clone()
            .xack::<_, _, _, ()>(&self.stream, &self.group, ids)
            .await?;
        Ok(())
    }
}

/// Diffusion par Redis Pub/Sub. Une tâche de fond reste abonnée à `live.*` (et se réabonne
/// après une coupure) et redistribue chaque message aux abonnés de ce processus.
pub struct RedisLive {
    connection: ConnectionManager,
    sender: broadcast::Sender<LiveMessage>,
}

impl RedisLive {
    /// Publie sur `connection` (celle du cache) et lance l'abonnement sur une connexion dédiée.
    /// À appeler depuis un runtime tokio.
    pub fn start(url: &str, connection: ConnectionManager) -> Result<Self, BusError> {
        let client = redis::Client::open(url)?;
        let sender = broadcast::channel(LIVE_CAPACITY).0;
        tokio::spawn(relay(client, sender.clone()));
        Ok(RedisLive { connection, sender })
    }

    /// Publication seule, sans abonnement (api-internal ne relaie rien à des clients).
    pub fn publisher(connection: ConnectionManager) -> Self {
        RedisLive {
            connection,
            sender: broadcast::channel(1).0,
        }
    }
}

/// Relaie les messages `live.*` aux abonnés locaux, en se réabonnant après chaque coupure.
async fn relay(client: redis::Client, sender: broadcast::Sender<LiveMessage>) {
    loop {
        match client.get_async_pubsub().await {
            Ok(mut pubsub) => match pubsub.psubscribe(format!("{LIVE_PREFIX}*")).await {
                Ok(()) => {
                    let mut messages = pubsub.on_message();
                    while let Some(message) = messages.next().await {
                        if let Ok(live) =
                            serde_json::from_slice::<LiveMessage>(message.get_payload_bytes())
                        {
                            let _ = sender.send(live);
                        }
                    }
                    eprintln!("bus : abonnement temps réel interrompu, reconnexion");
                }
                Err(err) => eprintln!("bus : abonnement temps réel impossible : {err}"),
            },
            Err(err) => eprintln!("bus : connexion Pub/Sub impossible : {err}"),
        }
        tokio::time::sleep(Duration::from_secs(1)).await;
    }
}

#[async_trait]
impl LiveBus for RedisLive {
    async fn broadcast(&self, message: &LiveMessage) -> Result<(), BusError> {
        let json = serde_json::to_string(message).map_err(|err| BusError(err.to_string()))?;
        self.connection
            .clone()
            .publish::<_, _, ()>(format!("{LIVE_PREFIX}{}", message.topic), json)
            .await?;
        Ok(())
    }

    fn subscribe(&self) -> broadcast::Receiver<LiveMessage> {
        self.sender.subscribe()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use domain::events::{ChangeCause, EventKind};
    use serde_json::json;
    use uuid::Uuid;

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
    async fn memory_bus_delivers_then_waits_for_acks() {
        let bus = MemoryBus::new();
        assert!(bus.read(10, Duration::ZERO).await.unwrap().is_empty());
        let (a, b) = (event(), event());
        bus.publish(&a).await.unwrap();
        bus.publish(&b).await.unwrap();
        let read = bus.read(1, Duration::ZERO).await.unwrap();
        assert_eq!(read.len(), 1);
        assert_eq!(read[0].event.as_ref(), Some(&a));
        assert_eq!(bus.in_flight(), 1);
        bus.ack(&[read[0].id.clone()]).await.unwrap();
        assert_eq!(bus.in_flight(), 0);
        let rest = bus.read(10, Duration::from_millis(10)).await.unwrap();
        assert_eq!(rest[0].event.as_ref(), Some(&b));
        assert_eq!(bus.published(), vec![a, b]);
    }

    #[tokio::test]
    async fn memory_bus_wakes_a_blocked_reader() {
        let bus = std::sync::Arc::new(MemoryBus::new());
        let reader = {
            let bus = bus.clone();
            tokio::spawn(async move { bus.read(10, Duration::from_secs(5)).await.unwrap() })
        };
        tokio::time::sleep(Duration::from_millis(20)).await;
        bus.publish(&event()).await.unwrap();
        assert_eq!(reader.await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn memory_live_reaches_every_subscriber() {
        let live = MemoryLive::new();
        let (mut a, mut b) = (live.subscribe(), live.subscribe());
        let message = LiveMessage::new("leaderboard", "leaderboard.updated", json!({}));
        live.broadcast(&message).await.unwrap();
        assert_eq!(a.recv().await.unwrap(), message);
        assert_eq!(b.recv().await.unwrap(), message);
    }
}
