//! [`SecurityStore`] sur PostgreSQL (tables du changelog `0016-google-oauth-and-totp`).

use super::{PgStore, UNIQUE_VIOLATION, UserRow, user};
use crate::store::{
    OAuthPurpose, OAuthState, SecurityStatus, SecurityStore, StoreError, TotpRecord, Unlink,
    UserRecord,
};
use async_trait::async_trait;
use sqlx::{Postgres, Transaction};
use std::time::Duration;
use uuid::Uuid;

const USER_COLUMNS: &str = "u.id, u.username, u.password_hash, u.role, u.email, u.pending_email, \
                            u.email_verified_at::text";

/// Contrainte d'unicité violée par une création de compte ou une liaison.
fn oauth_conflict(err: sqlx::Error) -> StoreError {
    match &err {
        sqlx::Error::Database(db) if db.code().as_deref() == Some(UNIQUE_VIOLATION) => {
            match db.constraint() {
                Some("users_email_key" | "users_pending_email_key") => StoreError::EmailTaken,
                Some(
                    "oauth_accounts_provider_subject_key" | "oauth_accounts_user_provider_key",
                ) => StoreError::IdentityTaken,
                _ => StoreError::UsernameTaken,
            }
        }
        _ => err.into(),
    }
}

async fn revoke_sessions(tx: &mut Transaction<'_, Postgres>, id: Uuid) -> Result<(), StoreError> {
    sqlx::query(
        "UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL",
    )
    .bind(id)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn insert_recovery_codes(
    tx: &mut Transaction<'_, Postgres>,
    id: Uuid,
    hashes: &[String],
) -> Result<(), StoreError> {
    sqlx::query("DELETE FROM totp_recovery_codes WHERE user_id = $1")
        .bind(id)
        .execute(&mut **tx)
        .await?;
    sqlx::query(
        "INSERT INTO totp_recovery_codes (user_id, code_hash) SELECT $1, unnest($2::text[])",
    )
    .bind(id)
    .bind(hashes)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

#[async_trait]
impl SecurityStore for PgStore {
    async fn allow_attempt(
        &self,
        key_hash: &str,
        limit: u32,
        window: Duration,
    ) -> Result<bool, StoreError> {
        let mut tx = self.pool.begin().await?;
        sqlx::query(
            "DELETE FROM auth_attempt_limits \
             WHERE window_start <= now() - $1::float8 * interval '1 second'",
        )
        .bind(window.as_secs_f64())
        .execute(&mut *tx)
        .await?;
        let allowed = sqlx::query(
            "INSERT INTO auth_attempt_limits (key_hash) VALUES ($1) \
             ON CONFLICT (key_hash) DO UPDATE SET attempts = auth_attempt_limits.attempts + 1 \
             WHERE auth_attempt_limits.attempts < $2",
        )
        .bind(key_hash)
        .bind(i32::try_from(limit).unwrap_or(i32::MAX))
        .execute(&mut *tx)
        .await?
        .rows_affected()
            == 1;
        tx.commit().await?;
        Ok(allowed)
    }

    async fn save_oauth_state(
        &self,
        state_hash: &str,
        oauth: &OAuthState,
        ttl: Duration,
    ) -> Result<(), StoreError> {
        sqlx::query("DELETE FROM oauth_states WHERE expires_at <= now()")
            .execute(&self.pool)
            .await?;
        sqlx::query(
            "INSERT INTO oauth_states (state_hash, purpose, user_id, code_verifier, nonce, expires_at) \
             VALUES ($1, $2, $3, $4, $5, now() + $6::float8 * interval '1 second')",
        )
        .bind(state_hash)
        .bind(oauth.purpose.as_str())
        .bind(oauth.user_id)
        .bind(&oauth.code_verifier)
        .bind(&oauth.nonce)
        .bind(ttl.as_secs_f64())
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn take_oauth_state(&self, state_hash: &str) -> Result<Option<OAuthState>, StoreError> {
        // DELETE … RETURNING : deux callbacks simultanés ne peuvent pas tous deux l'obtenir.
        let row = sqlx::query_as::<_, (String, Option<Uuid>, String, String)>(
            "DELETE FROM oauth_states WHERE state_hash = $1 AND expires_at > now() \
             RETURNING purpose, user_id, code_verifier, nonce",
        )
        .bind(state_hash)
        .fetch_optional(&self.pool)
        .await?;
        row.map(|(purpose, user_id, code_verifier, nonce)| {
            Ok(OAuthState {
                purpose: OAuthPurpose::parse(&purpose)?,
                user_id,
                code_verifier,
                nonce,
            })
        })
        .transpose()
    }

    async fn find_user_by_identity(
        &self,
        provider: &str,
        subject: &str,
    ) -> Result<Option<UserRecord>, StoreError> {
        sqlx::query_as::<_, UserRow>(&format!(
            "SELECT {USER_COLUMNS} FROM users u JOIN oauth_accounts o ON o.user_id = u.id \
             WHERE o.provider = $1 AND o.subject = $2"
        ))
        .bind(provider)
        .bind(subject)
        .fetch_optional(&self.pool)
        .await?
        .map(user)
        .transpose()
    }

    async fn create_oauth_user(
        &self,
        username: &str,
        email: &str,
        password_hash: &str,
        provider: &str,
        subject: &str,
    ) -> Result<UserRecord, StoreError> {
        let mut tx = self.pool.begin().await?;
        let created = sqlx::query_as::<_, UserRow>(
            "INSERT INTO users (username, email, password_hash, password_set, email_verified_at) \
             VALUES ($1, $2, $3, false, now()) \
             RETURNING id, username, password_hash, role, email, pending_email, email_verified_at::text",
        )
        .bind(username)
        .bind(email)
        .bind(password_hash)
        .fetch_one(&mut *tx)
        .await
        .map_err(oauth_conflict)
        .and_then(user)?;
        sqlx::query(
            "INSERT INTO oauth_accounts (user_id, provider, subject, email) VALUES ($1, $2, $3, $4)",
        )
        .bind(created.id)
        .bind(provider)
        .bind(subject)
        .bind(email)
        .execute(&mut *tx)
        .await
        .map_err(oauth_conflict)?;
        tx.commit().await?;
        Ok(created)
    }

    async fn link_identity(
        &self,
        user_id: Uuid,
        provider: &str,
        subject: &str,
        email: Option<&str>,
    ) -> Result<(), StoreError> {
        sqlx::query(
            "INSERT INTO oauth_accounts (user_id, provider, subject, email) VALUES ($1, $2, $3, $4)",
        )
        .bind(user_id)
        .bind(provider)
        .bind(subject)
        .bind(email)
        .execute(&self.pool)
        .await
        .map_err(oauth_conflict)?;
        Ok(())
    }

    async fn unlink_identity(&self, user_id: Uuid, provider: &str) -> Result<Unlink, StoreError> {
        let mut tx = self.pool.begin().await?;
        // Verrou sur le compte : sérialise avec un changement de mot de passe ou une autre
        // déliaison, pour ne jamais retirer la dernière méthode de connexion.
        let password_set: Option<bool> =
            sqlx::query_scalar("SELECT password_set FROM users WHERE id = $1 FOR UPDATE")
                .bind(user_id)
                .fetch_optional(&mut *tx)
                .await?;
        let Some(password_set) = password_set else {
            return Ok(Unlink::NotLinked);
        };
        let (linked, others): (bool, bool) = sqlx::query_as(
            "SELECT bool_or(provider = $2), bool_or(provider <> $2) FROM oauth_accounts \
             WHERE user_id = $1",
        )
        .bind(user_id)
        .bind(provider)
        .fetch_one(&mut *tx)
        .await
        .map(|(a, b): (Option<bool>, Option<bool>)| (a.unwrap_or(false), b.unwrap_or(false)))?;
        if !linked {
            return Ok(Unlink::NotLinked);
        }
        if !password_set && !others {
            return Ok(Unlink::LastMethod);
        }
        sqlx::query("DELETE FROM oauth_accounts WHERE user_id = $1 AND provider = $2")
            .bind(user_id)
            .bind(provider)
            .execute(&mut *tx)
            .await?;
        revoke_sessions(&mut tx, user_id).await?;
        tx.commit().await?;
        Ok(Unlink::Unlinked)
    }

    async fn security_status(&self, user_id: Uuid) -> Result<SecurityStatus, StoreError> {
        let row: Option<(bool, bool, bool, i64)> = sqlx::query_as(
            "SELECT u.password_set, \
                    EXISTS (SELECT 1 FROM oauth_accounts o WHERE o.user_id = u.id AND o.provider = 'google'), \
                    EXISTS (SELECT 1 FROM user_totp t WHERE t.user_id = u.id AND t.enabled_at IS NOT NULL), \
                    (SELECT count(*) FROM totp_recovery_codes r WHERE r.user_id = u.id AND r.used_at IS NULL) \
             FROM users u WHERE u.id = $1",
        )
        .bind(user_id)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row
            .map(
                |(password_set, google_linked, totp_enabled, remaining)| SecurityStatus {
                    password_set,
                    google_linked,
                    totp_enabled,
                    recovery_codes_remaining: u32::try_from(remaining).unwrap_or(0),
                },
            )
            .unwrap_or_default())
    }

    async fn find_totp(&self, user_id: Uuid) -> Result<Option<TotpRecord>, StoreError> {
        Ok(sqlx::query_as::<_, (Vec<u8>, bool)>(
            "SELECT secret_ciphertext, enabled_at IS NOT NULL FROM user_totp WHERE user_id = $1",
        )
        .bind(user_id)
        .fetch_optional(&self.pool)
        .await?
        .map(|(ciphertext, enabled)| TotpRecord {
            ciphertext,
            enabled,
        }))
    }

    async fn stage_totp(&self, user_id: Uuid, ciphertext: &[u8]) -> Result<bool, StoreError> {
        Ok(sqlx::query(
            "INSERT INTO user_totp (user_id, secret_ciphertext) VALUES ($1, $2) \
             ON CONFLICT (user_id) DO UPDATE \
               SET secret_ciphertext = EXCLUDED.secret_ciphertext, last_used_step = 0, created_at = now() \
             WHERE user_totp.enabled_at IS NULL",
        )
        .bind(user_id)
        .bind(ciphertext)
        .execute(&self.pool)
        .await?
        .rows_affected()
            == 1)
    }

    async fn enable_totp(
        &self,
        user_id: Uuid,
        step: i64,
        recovery_hashes: &[String],
    ) -> Result<bool, StoreError> {
        let mut tx = self.pool.begin().await?;
        let enabled = sqlx::query(
            "UPDATE user_totp SET enabled_at = now(), last_used_step = $2 \
             WHERE user_id = $1 AND enabled_at IS NULL AND last_used_step < $2",
        )
        .bind(user_id)
        .bind(step)
        .execute(&mut *tx)
        .await?
        .rows_affected()
            == 1;
        if !enabled {
            return Ok(false);
        }
        insert_recovery_codes(&mut tx, user_id, recovery_hashes).await?;
        tx.commit().await?;
        Ok(true)
    }

    async fn use_totp_step(&self, user_id: Uuid, step: i64) -> Result<bool, StoreError> {
        Ok(sqlx::query(
            "UPDATE user_totp SET last_used_step = $2 \
             WHERE user_id = $1 AND enabled_at IS NOT NULL AND last_used_step < $2",
        )
        .bind(user_id)
        .bind(step)
        .execute(&self.pool)
        .await?
        .rows_affected()
            == 1)
    }

    async fn consume_recovery_code(
        &self,
        user_id: Uuid,
        code_hash: &str,
    ) -> Result<bool, StoreError> {
        Ok(sqlx::query(
            "UPDATE totp_recovery_codes SET used_at = now() \
             WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL",
        )
        .bind(user_id)
        .bind(code_hash)
        .execute(&self.pool)
        .await?
        .rows_affected()
            == 1)
    }

    async fn replace_recovery_codes(
        &self,
        user_id: Uuid,
        recovery_hashes: &[String],
    ) -> Result<bool, StoreError> {
        let mut tx = self.pool.begin().await?;
        let enabled: Option<Uuid> = sqlx::query_scalar(
            "SELECT user_id FROM user_totp WHERE user_id = $1 AND enabled_at IS NOT NULL FOR UPDATE",
        )
        .bind(user_id)
        .fetch_optional(&mut *tx)
        .await?;
        if enabled.is_none() {
            return Ok(false);
        }
        insert_recovery_codes(&mut tx, user_id, recovery_hashes).await?;
        tx.commit().await?;
        Ok(true)
    }

    async fn disable_totp(&self, user_id: Uuid) -> Result<bool, StoreError> {
        let mut tx = self.pool.begin().await?;
        let removed =
            sqlx::query("DELETE FROM user_totp WHERE user_id = $1 AND enabled_at IS NOT NULL")
                .bind(user_id)
                .execute(&mut *tx)
                .await?
                .rows_affected()
                == 1;
        if !removed {
            return Ok(false);
        }
        sqlx::query("DELETE FROM totp_recovery_codes WHERE user_id = $1")
            .bind(user_id)
            .execute(&mut *tx)
            .await?;
        revoke_sessions(&mut tx, user_id).await?;
        tx.commit().await?;
        Ok(true)
    }

    async fn create_mfa_challenge(
        &self,
        user_id: Uuid,
        token_hash: &str,
        ttl: Duration,
    ) -> Result<(), StoreError> {
        sqlx::query("DELETE FROM mfa_challenges WHERE expires_at <= now()")
            .execute(&self.pool)
            .await?;
        sqlx::query(
            "INSERT INTO mfa_challenges (user_id, token_hash, expires_at) \
             VALUES ($1, $2, now() + $3::float8 * interval '1 second')",
        )
        .bind(user_id)
        .bind(token_hash)
        .bind(ttl.as_secs_f64())
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn attempt_mfa_challenge(
        &self,
        token_hash: &str,
        max_attempts: u32,
    ) -> Result<Option<Uuid>, StoreError> {
        Ok(sqlx::query_scalar(
            "UPDATE mfa_challenges SET attempts = attempts + 1 \
             WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > now() AND attempts < $2 \
             RETURNING user_id",
        )
        .bind(token_hash)
        .bind(i32::try_from(max_attempts).unwrap_or(i32::MAX))
        .fetch_optional(&self.pool)
        .await?)
    }

    async fn consume_mfa_challenge(&self, token_hash: &str) -> Result<bool, StoreError> {
        Ok(sqlx::query(
            "UPDATE mfa_challenges SET consumed_at = now() \
             WHERE token_hash = $1 AND consumed_at IS NULL",
        )
        .bind(token_hash)
        .execute(&self.pool)
        .await?
        .rows_affected()
            == 1)
    }

    async fn revoke_all_refresh_tokens(&self, user_id: Uuid) -> Result<(), StoreError> {
        let mut tx = self.pool.begin().await?;
        revoke_sessions(&mut tx, user_id).await?;
        tx.commit().await?;
        Ok(())
    }
}
