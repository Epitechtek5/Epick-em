//! Pool de connexions PostgreSQL.

use crate::config::Config;
use sqlx::PgPool;
use sqlx::postgres::PgPoolOptions;

/// Ouvre le pool et vérifie qu'une première connexion aboutit.
pub async fn connect(config: &Config) -> Result<PgPool, sqlx::Error> {
    PgPoolOptions::new()
        .max_connections(config.database_max_connections)
        .connect(&config.database_url)
        .await
}
