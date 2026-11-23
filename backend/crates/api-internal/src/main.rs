//! api-internal : se connecte à PostgreSQL et Redis, synchronise périodiquement les tournois
//! externes (start.gg…, voir `docs/connecteurs.md`), résout les pronostics et le Pick'em (voir
//! `docs/pickem.md`), et répond 200 sur toutes les routes en
//! attendant le vrai serveur HTTP.

use api_public::pickem_live::announce;
use api_public::projection::StoreProjector;
use api_public::resolution::resolve_pending;
use api_public::store::{AuthStore, PgStore};
use connectors::sync::{RedisSyncStore, SyncPolicy, SyncService};
use infra::{LiveBus, RedisLive};
use std::error::Error;
use std::process::ExitCode;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

#[tokio::main]
async fn main() -> ExitCode {
    match run().await {
        Ok(()) => ExitCode::SUCCESS,
        Err(err) => {
            eprintln!("api-internal : {err}");
            ExitCode::FAILURE
        }
    }
}

async fn run() -> Result<(), Box<dyn Error>> {
    let port = std::env::var("API_INTERNAL_PORT").unwrap_or_else(|_| "8081".into());
    let config = infra::Config::from_env()?;
    let db = infra::connect(&config).await?;

    let registry = connectors::registry_from_env(Some(db.cache().clone()))?;
    if registry.all().is_empty() {
        eprintln!("api-internal : aucune source externe configurée (STARTGG_TOKEN absente)");
    }
    // Les synchronisations planifiées reportent elles aussi chaque instantané dans le tournoi
    // local (inscrits importés, étapes, matchs et résultats). L'état de synchronisation et le
    // tournoi importé vivent dans Redis ; la base ne garde que le lien source ↔ tournoi.
    let redis = infra::RedisCache::connect(&config.redis_url).await?;
    let store = Arc::new(PgStore::new(db.clone()));
    let projector = StoreProjector::new(store.clone());
    let sync = Arc::new(
        SyncService::new(
            registry,
            Arc::new(RedisSyncStore::new(db.clone(), redis.connection())),
            SyncPolicy::default(),
        )
        .with_projector(Arc::new(projector)),
    );
    tokio::spawn(schedule(sync, sync_interval()));
    let live: Arc<dyn LiveBus> = Arc::new(RedisLive::publisher(redis.connection()));
    tokio::spawn(resolve(store, live, resolve_interval()));

    let listener = TcpListener::bind(format!("0.0.0.0:{port}")).await?;
    println!(
        "api-internal (domain {}) en écoute sur :{port}",
        domain::VERSION
    );

    loop {
        let (mut stream, _) = listener.accept().await?;
        let _ = stream.read(&mut [0; 1024]).await?;
        stream
            .write_all(b"HTTP/1.1 200 OK\r\ncontent-length: 2\r\n\r\nok")
            .await?;
    }
}

/// Délai entre deux passages du planificateur (`SYNC_INTERVAL_SECS`, 30 s par défaut).
fn sync_interval() -> Duration {
    let secs = std::env::var("SYNC_INTERVAL_SECS")
        .ok()
        .and_then(|v| v.trim().parse::<u64>().ok())
        .filter(|s| (5..=3600).contains(s))
        .unwrap_or(30);
    Duration::from_secs(secs)
}

/// Sources dues traitées par passage ; les suivantes attendent le passage d'après.
const SYNC_BATCH: u32 = 10;

/// Synchronise les sources dues à intervalle régulier. Chaque source porte sa prochaine
/// échéance (selon l'état du tournoi, ou le backoff après un échec) et un bail : plusieurs
/// instances d'api-internal peuvent tourner sans synchroniser deux fois la même source.
async fn schedule(sync: Arc<SyncService>, every: Duration) {
    let mut ticker = tokio::time::interval(every);
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    loop {
        ticker.tick().await;
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or_default();
        match sync.run_due(now, SYNC_BATCH).await {
            Ok(reports) => {
                for report in reports {
                    match report.error {
                        None => println!(
                            "api-internal : source {} synchronisée ({} changement(s))",
                            report.source_id, report.changes
                        ),
                        Some(err) => eprintln!(
                            "api-internal : échec de la synchronisation de {} : {err}",
                            report.source_id
                        ),
                    }
                }
            }
            Err(err) => eprintln!("api-internal : planificateur de synchronisation : {err}"),
        }
    }
}

/// Délai entre deux résolutions des pronostics (`RESOLVE_INTERVAL_SECS`, 30 s par défaut).
fn resolve_interval() -> Duration {
    let secs = std::env::var("RESOLVE_INTERVAL_SECS")
        .ok()
        .and_then(|v| v.trim().parse::<u64>().ok())
        .filter(|s| (5..=3600).contains(s))
        .unwrap_or(30);
    Duration::from_secs(secs)
}

/// Tournois résolus par passage ; les suivants attendent le passage d'après.
const RESOLVE_BATCH: i64 = 50;

/// Résout à intervalle régulier les pronostics et les réponses de Pick'em des tournois non
/// réglés. La résolution recalcule tout à partir de l'état et n'écrit que ce qui change : un
/// passage rejoué ou lancé par deux instances donne le même résultat.
async fn resolve(store: Arc<PgStore>, live: Arc<dyn LiveBus>, every: Duration) {
    let mut ticker = tokio::time::interval(every);
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    loop {
        ticker.tick().await;
        let store: &dyn AuthStore = store.as_ref();
        match resolve_pending(store, RESOLVE_BATCH).await {
            Ok(reports) => {
                for report in reports {
                    if let Ok(report) = &report {
                        announce(live.as_ref(), report).await;
                    }
                    match report {
                        Ok(report) if report.settled => println!(
                            "api-internal : pronostics du tournoi {} réglés",
                            report.tournament_id
                        ),
                        Ok(_) => {}
                        Err((tournament_id, err)) => eprintln!(
                            "api-internal : échec de la résolution du tournoi {tournament_id} : {err}"
                        ),
                    }
                }
            }
            Err(err) => eprintln!("api-internal : résolution des pronostics : {err}"),
        }
    }
}
