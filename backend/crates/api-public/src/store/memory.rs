//! Implémentation en mémoire de [`AuthStore`], pour les tests.

use super::{AuthStore, Role, StoreError, UserProfile, UserRecord, UserUpdate};
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

struct ResetToken {
    user_id: Uuid,
    expires_at: Instant,
    used: bool,
}

#[derive(Default)]
struct State {
    users: Vec<UserRecord>,
    tokens: HashMap<String, RefreshToken>,
    reset_tokens: HashMap<String, ResetToken>,
}

#[derive(Default)]
pub struct MemoryStore {
    state: Mutex<State>,
}

impl MemoryStore {
    pub fn new() -> Self {
        Self::default()
    }

    /// Change le rôle d'un compte existant (les inscriptions créent toujours un `User`).
    pub fn set_role(&self, username: &str, role: Role) {
        let mut state = self.state();
        if let Some(user) = state
            .users
            .iter_mut()
            .find(|user| user.username.eq_ignore_ascii_case(username))
        {
            user.role = role;
        }
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
        email: Option<&str>,
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
        if let Some(email) = email
            && state
                .users
                .iter()
                .any(|user| user.email.as_deref() == Some(email))
        {
            return Err(StoreError::EmailTaken);
        }
        let user = UserRecord {
            id: Uuid::new_v4(),
            username: username.to_string(),
            password_hash: password_hash.to_string(),
            role: Role::User,
            email: email.map(str::to_string),
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

    async fn find_user_by_email(&self, email: &str) -> Result<Option<UserRecord>, StoreError> {
        Ok(self
            .state()
            .users
            .iter()
            .find(|user| user.email.as_deref() == Some(email))
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

    async fn find_profile(&self, id: Uuid) -> Result<Option<UserProfile>, StoreError> {
        Ok(self
            .state()
            .users
            .iter()
            .find(|user| user.id == id)
            .map(UserProfile::from))
    }

    async fn list_profiles(&self, limit: i64, offset: i64) -> Result<Vec<UserProfile>, StoreError> {
        Ok(self
            .state()
            .users
            .iter()
            .skip(usize::try_from(offset).unwrap_or(0))
            .take(usize::try_from(limit).unwrap_or(0))
            .map(UserProfile::from)
            .collect())
    }

    async fn update_user(
        &self,
        id: Uuid,
        update: UserUpdate,
    ) -> Result<Option<UserProfile>, StoreError> {
        let mut state = self.state();
        if let Some(username) = &update.username
            && state
                .users
                .iter()
                .any(|u| u.id != id && u.username.eq_ignore_ascii_case(username))
        {
            return Err(StoreError::UsernameTaken);
        }
        if let Some(email) = &update.email
            && state
                .users
                .iter()
                .any(|u| u.id != id && u.email.as_deref() == Some(email))
        {
            return Err(StoreError::EmailTaken);
        }
        let Some(user) = state.users.iter_mut().find(|user| user.id == id) else {
            return Ok(None);
        };
        if let Some(username) = update.username {
            user.username = username;
        }
        if let Some(password_hash) = update.password_hash {
            user.password_hash = password_hash;
        }
        if let Some(role) = update.role {
            user.role = role;
        }
        if let Some(email) = update.email {
            user.email = Some(email);
        }
        Ok(Some(UserProfile::from(&*user)))
    }

    async fn delete_user(&self, id: Uuid) -> Result<bool, StoreError> {
        let mut state = self.state();
        let before = state.users.len();
        state.users.retain(|user| user.id != id);
        state.tokens.retain(|_, token| token.user_id != id);
        state.reset_tokens.retain(|_, token| token.user_id != id);
        Ok(state.users.len() != before)
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

    async fn insert_password_reset_token(
        &self,
        user_id: Uuid,
        token_hash: &str,
        ttl: Duration,
    ) -> Result<(), StoreError> {
        let mut state = self.state();
        for token in state.reset_tokens.values_mut() {
            if token.user_id == user_id {
                token.used = true;
            }
        }
        state.reset_tokens.insert(
            token_hash.to_string(),
            ResetToken {
                user_id,
                expires_at: Instant::now() + ttl,
                used: false,
            },
        );
        Ok(())
    }

    async fn consume_password_reset_token(
        &self,
        token_hash: &str,
        password_hash: &str,
    ) -> Result<bool, StoreError> {
        let mut state = self.state();
        let user_id = match state.reset_tokens.get_mut(token_hash) {
            Some(token) if !token.used && token.expires_at > Instant::now() => {
                token.used = true;
                token.user_id
            }
            _ => return Ok(false),
        };
        if let Some(user) = state.users.iter_mut().find(|user| user.id == user_id) {
            user.password_hash = password_hash.to_string();
        }
        for token in state.tokens.values_mut() {
            if token.user_id == user_id {
                token.revoked = true;
            }
        }
        Ok(true)
    }
}
