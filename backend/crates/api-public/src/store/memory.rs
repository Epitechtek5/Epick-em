//! Implémentation en mémoire de [`AuthStore`], pour les tests.

use super::{AuthStore, StoreError, UserRecord};
use async_trait::async_trait;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use uuid::Uuid;

struct RefreshToken {
    user_id: Uuid,
    expires_at: Instant,
    revoked: bool,
}

#[derive(Default)]
struct State {
    users: Vec<UserRecord>,
    tokens: HashMap<String, RefreshToken>,
}

#[derive(Default)]
pub struct MemoryStore {
    state: Mutex<State>,
}

impl MemoryStore {
    pub fn new() -> Self {
        Self::default()
    }

    fn state(&self) -> std::sync::MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }
}

#[async_trait]
impl AuthStore for MemoryStore {
    async fn create_user(
        &self,
        username: &str,
        password_hash: &str,
    ) -> Result<UserRecord, StoreError> {
        let mut state = self.state();
        if state
            .users
            .iter()
            .any(|user| user.username.eq_ignore_ascii_case(username))
        {
            return Err(StoreError::UsernameTaken);
        }
        let user = UserRecord {
            id: Uuid::new_v4(),
            username: username.to_string(),
            password_hash: password_hash.to_string(),
        };
        state.users.push(user.clone());
        Ok(user)
    }

    async fn find_user_by_username(
        &self,
        username: &str,
    ) -> Result<Option<UserRecord>, StoreError> {
        Ok(self
            .state()
            .users
            .iter()
            .find(|user| user.username.eq_ignore_ascii_case(username))
            .cloned())
    }

    async fn find_user_by_id(&self, id: Uuid) -> Result<Option<UserRecord>, StoreError> {
        Ok(self
            .state()
            .users
            .iter()
            .find(|user| user.id == id)
            .cloned())
    }

    async fn insert_refresh_token(
        &self,
        user_id: Uuid,
        token_hash: &str,
        ttl: Duration,
    ) -> Result<(), StoreError> {
        self.state().tokens.insert(
            token_hash.to_string(),
            RefreshToken {
                user_id,
                expires_at: Instant::now() + ttl,
                revoked: false,
            },
        );
        Ok(())
    }

    async fn rotate_refresh_token(
        &self,
        user_id: Uuid,
        old_hash: &str,
        new_hash: &str,
        ttl: Duration,
    ) -> Result<bool, StoreError> {
        let mut state = self.state();
        match state.tokens.get_mut(old_hash) {
            Some(token)
                if token.user_id == user_id
                    && !token.revoked
                    && token.expires_at > Instant::now() =>
            {
                token.revoked = true;
            }
            _ => return Ok(false),
        }
        state.tokens.insert(
            new_hash.to_string(),
            RefreshToken {
                user_id,
                expires_at: Instant::now() + ttl,
                revoked: false,
            },
        );
        Ok(true)
    }

    async fn revoke_refresh_token(
        &self,
        user_id: Uuid,
        token_hash: &str,
    ) -> Result<(), StoreError> {
        if let Some(token) = self.state().tokens.get_mut(token_hash)
            && token.user_id == user_id
        {
            token.revoked = true;
        }
        Ok(())
    }
}
