//! api-internal : se connecte à PostgreSQL et Redis, synchronise périodiquement les tournois
//! externes (start.gg…, voir `docs/connecteurs.md`), et répond 200 sur toutes les routes en
//! attendant le vrai serveur HTTP.

use connectors::sync::{PgSyncStore, SyncPolicy, SyncService};
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
    let sync = Arc::new(SyncService::new(
        registry,
        Arc::new(PgSyncStore::new(db.pool().clone())),
        SyncPolicy::default(),
    ));
    tokio::spawn(schedule(sync, sync_interval()));

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
