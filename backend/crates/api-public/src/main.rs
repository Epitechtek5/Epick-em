//! Point d'entrée de api-public : se connecte à PostgreSQL et Redis, puis sert l'API HTTP et le
//! WebSocket temps réel.

use actix_web::HttpServer;
use api_public::config::AuthConfig;
use api_public::mail::{MailConfig, ResendMailer};
use api_public::projection::StoreProjector;
use api_public::store::PgStore;
use api_public::{AppState, app};
use connectors::sync::{RedisSyncStore, SyncPolicy, SyncService};
use infra::bus::EVENTS_STREAM;
use infra::{EventBus, LiveBus, RedisEventBus, RedisLive};
use std::error::Error;
use std::process::ExitCode;
use std::sync::Arc;

#[actix_web::main]
async fn main() -> ExitCode {
    match run().await {
        Ok(()) => ExitCode::SUCCESS,
        Err(err) => {
            eprintln!("api-public : {err}");
            ExitCode::FAILURE
        }
    }
}

async fn run() -> Result<(), Box<dyn Error>> {
    let port = std::env::var("API_PUBLIC_PORT").unwrap_or_else(|_| "8080".into());
    let config = infra::Config::from_env()?;
    let auth_config = AuthConfig::from_env()?;
    let db = infra::connect(&config).await?;

    let cache = db.cache().clone();
    let registry = connectors::registry_from_env(Some(cache.clone()))?;
    let store = Arc::new(PgStore::new(db.clone()));
    // Chaque instantané importé est reporté dans le tournoi local (inscrits, étapes, matchs).
    // L'état de synchronisation et le tournoi importé vivent dans Redis ; la base ne garde que
    // le lien source ↔ tournoi.
    let redis = infra::RedisCache::connect(&config.redis_url).await?;
    // Bus Redis (ADR-002) : événements métier vers api-internal (Streams), temps réel vers les
    // clients WebSocket de toutes les instances (Pub/Sub).
    let events: Arc<dyn EventBus> = Arc::new(RedisEventBus::new(redis.connection(), EVENTS_STREAM));
    let live: Arc<dyn LiveBus> = Arc::new(RedisLive::start(&config.redis_url, redis.connection())?);
    let sync = Arc::new(
        SyncService::new(
            registry,
            Arc::new(RedisSyncStore::new(db.clone(), redis.connection())),
            SyncPolicy::default(),
        )
        .with_projector(Arc::new(
            StoreProjector::new(store.clone()).with_bus(events.clone(), live.clone()),
        )),
    );
    let state = AppState::new(store, auth_config)
        .map_err(|err| format!("initialisation du hachage de mots de passe : {err}"))?
        .with_cache(cache)
        .with_sync(sync)
        .with_bus(events, live);
    let state = match MailConfig::from_env() {
        Some(mail) => state.with_mailer(Arc::new(ResendMailer::new(&mail)?), &mail.public_url),
        None => {
            eprintln!("api-public : RESEND_API_KEY absente, les e-mails ne seront pas envoyés");
            state
        }
    };

    let server = HttpServer::new(move || app(state.clone())).bind(format!("0.0.0.0:{port}"))?;
    println!(
        "api-public (domain {}) en écoute sur :{port}",
        domain::VERSION
    );
    server.run().await?;
    Ok(())
}
