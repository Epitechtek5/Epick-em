//! Implémentation PostgreSQL de [`AuthStore`] (tables `users` et `refresh_tokens`,
//! voir `db/changelog`).

use super::{AuthStore, StoreError, UserRecord};
use async_trait::async_trait;
use sqlx::PgPool;
use std::time::Duration;
use uuid::Uuid;

/// Code SQLSTATE d'une violation de contrainte d'unicité.
const UNIQUE_VIOLATION: &str = "23505";

pub struct PgStore {
    pool: PgPool,
}

impl PgStore {
    pub fn new(pool: PgPool) -> Self {
        PgStore { pool }
    }
}

type UserRow = (Uuid, String, String);

fn user(row: UserRow) -> UserRecord {
    UserRecord {
        id: row.0,
        username: row.1,
        password_hash: row.2,
    }
}

#[async_trait]
impl AuthStore for PgStore {
    async fn create_user(
        &self,
        username: &str,
        password_hash: &str,
    ) -> Result<UserRecord, StoreError> {
        sqlx::query_as::<_, UserRow>(
            "INSERT INTO users (username, password_hash) VALUES ($1, $2) \
             RETURNING id, username, password_hash",
        )
        .bind(username)
        .bind(password_hash)
        .fetch_one(&self.pool)
        .await
        .map(user)
        .map_err(|err| match &err {
            sqlx::Error::Database(db) if db.code().as_deref() == Some(UNIQUE_VIOLATION) => {
                StoreError::UsernameTaken
            }
            _ => err.into(),
        })
    }

    async fn find_user_by_username(
        &self,
        username: &str,
    ) -> Result<Option<UserRecord>, StoreError> {
        Ok(sqlx::query_as::<_, UserRow>(
            "SELECT id, username, password_hash FROM users WHERE lower(username) = lower($1)",
        )
        .bind(username)
        .fetch_optional(&self.pool)
        .await?
        .map(user))
    }

    async fn find_user_by_id(&self, id: Uuid) -> Result<Option<UserRecord>, StoreError> {
        Ok(sqlx::query_as::<_, UserRow>(
            "SELECT id, username, password_hash FROM users WHERE id = $1",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await?
        .map(user))
    }

    async fn insert_refresh_token(
        &self,
        user_id: Uuid,
        token_hash: &str,
        ttl: Duration,
    ) -> Result<(), StoreError> {
        sqlx::query(
            "INSERT INTO refresh_tokens (user_id, token_hash, expires_at) \
             VALUES ($1, $2, now() + $3::float8 * interval '1 second')",
        )
        .bind(user_id)
        .bind(token_hash)
        .bind(ttl.as_secs_f64())
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn rotate_refresh_token(
        &self,
        user_id: Uuid,
        old_hash: &str,
        new_hash: &str,
        ttl: Duration,
    ) -> Result<bool, StoreError> {
        let mut tx = self.pool.begin().await?;
        // L'UPDATE conditionnel verrouille la ligne : deux rafraîchissements simultanés
        // avec le même jeton ne peuvent pas réussir tous les deux.
        let rotated = sqlx::query(
            "UPDATE refresh_tokens SET revoked_at = now() \
             WHERE token_hash = $1 AND user_id = $2 AND revoked_at IS NULL AND expires_at > now()",
        )
        .bind(old_hash)
        .bind(user_id)
        .execute(&mut *tx)
        .await?
        .rows_affected();
        if rotated == 0 {
            return Ok(false);
        }
        sqlx::query(
            "INSERT INTO refresh_tokens (user_id, token_hash, expires_at) \
             VALUES ($1, $2, now() + $3::float8 * interval '1 second')",
        )
        .bind(user_id)
        .bind(new_hash)
        .bind(ttl.as_secs_f64())
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(true)
    }

    async fn revoke_refresh_token(
        &self,
        user_id: Uuid,
        token_hash: &str,
    ) -> Result<(), StoreError> {
        sqlx::query(
            "UPDATE refresh_tokens SET revoked_at = now() \
             WHERE token_hash = $1 AND user_id = $2 AND revoked_at IS NULL",
        )
        .bind(token_hash)
        .bind(user_id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }
}
