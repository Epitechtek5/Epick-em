//! [`SecurityStore`] en mémoire, pour les tests.

use super::{MemoryStore, State};
use crate::store::{
    OAuthState, Role, SecurityStatus, SecurityStore, StoreError, TotpRecord, Unlink, UserRecord,
    now_rfc3339,
};
use async_trait::async_trait;
use std::time::{Duration, Instant};
use uuid::Uuid;

impl State {
    /// Oublie tout ce qui concerne la sécurité du compte supprimé.
    pub(super) fn forget_security(&mut self, id: Uuid) {
        self.identities.retain(|(user, _, _)| *user != id);
        self.oauth_states
            .retain(|_, (state, _)| state.user_id != Some(id));
        self.totp.remove(&id);
        self.recovery_codes.retain(|_, (user, _)| *user != id);
        self.mfa_challenges.retain(|_, (user, ..)| *user != id);
        self.passwordless.remove(&id);
    }

    fn revoke_sessions(&mut self, id: Uuid) {
        for token in self.tokens.values_mut() {
            if token.user_id == id {
                token.revoked = true;
            }
        }
    }
}

#[async_trait]
impl SecurityStore for MemoryStore {
    async fn allow_attempt(
        &self,
        key_hash: &str,
        limit: u32,
        window: Duration,
    ) -> Result<bool, StoreError> {
        let mut state = self.state();
        let now = Instant::now();
        let entry = state
            .attempt_limits
            .entry(key_hash.to_string())
            .or_insert((now, 0));
        if now.duration_since(entry.0) >= window {
            *entry = (now, 0);
        }
        if entry.1 >= limit {
            return Ok(false);
        }
        entry.1 += 1;
        Ok(true)
    }

    async fn save_oauth_state(
        &self,
        state_hash: &str,
        oauth: &OAuthState,
        ttl: Duration,
    ) -> Result<(), StoreError> {
        self.state().oauth_states.insert(
            state_hash.to_string(),
            (oauth.clone(), Instant::now() + ttl),
        );
        Ok(())
    }

    async fn take_oauth_state(&self, state_hash: &str) -> Result<Option<OAuthState>, StoreError> {
        Ok(self
            .state()
            .oauth_states
            .remove(state_hash)
            .filter(|(_, expires_at)| *expires_at > Instant::now())
            .map(|(oauth, _)| oauth))
    }

    async fn find_user_by_identity(
        &self,
        provider: &str,
        subject: &str,
    ) -> Result<Option<UserRecord>, StoreError> {
        let state = self.state();
        Ok(state
            .identities
            .iter()
            .find(|(_, p, s)| p == provider && s == subject)
            .and_then(|(id, ..)| state.users.iter().find(|u| u.id == *id))
            .cloned())
    }

    async fn create_oauth_user(
        &self,
        username: &str,
        email: &str,
        password_hash: &str,
        provider: &str,
        subject: &str,
    ) -> Result<UserRecord, StoreError> {
        let mut state = self.state();
        if state
            .identities
            .iter()
            .any(|(_, p, s)| p == provider && s == subject)
        {
            return Err(StoreError::IdentityTaken);
        }
        if state
            .users
            .iter()
            .any(|u| u.username.eq_ignore_ascii_case(username))
        {
            return Err(StoreError::UsernameTaken);
        }
        if state
            .users
            .iter()
            .any(|u| u.email.as_deref() == Some(email) || u.pending_email.as_deref() == Some(email))
        {
            return Err(StoreError::EmailTaken);
        }
        let user = UserRecord {
            id: Uuid::new_v4(),
            username: username.to_string(),
            password_hash: password_hash.to_string(),
            role: Role::User,
            email: Some(email.to_string()),
            pending_email: None,
            email_verified_at: Some(now_rfc3339()),
        };
        state.users.push(user.clone());
        state
            .identities
            .push((user.id, provider.to_string(), subject.to_string()));
        state.passwordless.insert(user.id);
        Ok(user)
    }

    async fn link_identity(
        &self,
        user_id: Uuid,
        provider: &str,
        subject: &str,
        _email: Option<&str>,
    ) -> Result<(), StoreError> {
        let mut state = self.state();
        if state
            .identities
            .iter()
            .any(|(u, p, s)| p == provider && (s == subject || *u == user_id))
        {
            return Err(StoreError::IdentityTaken);
        }
        if !state.users.iter().any(|u| u.id == user_id) {
            return Err(StoreError::Other("compte introuvable".into()));
        }
        state
            .identities
            .push((user_id, provider.to_string(), subject.to_string()));
        Ok(())
    }

    async fn unlink_identity(&self, user_id: Uuid, provider: &str) -> Result<Unlink, StoreError> {
        let mut state = self.state();
        let Some(index) = state
            .identities
            .iter()
            .position(|(u, p, _)| *u == user_id && p == provider)
        else {
            return Ok(Unlink::NotLinked);
        };
        let other_identity = state
            .identities
            .iter()
            .any(|(u, p, _)| *u == user_id && p != provider);
        if state.passwordless.contains(&user_id) && !other_identity {
            return Ok(Unlink::LastMethod);
        }
        state.identities.remove(index);
        state.revoke_sessions(user_id);
        Ok(Unlink::Unlinked)
    }

    async fn security_status(&self, user_id: Uuid) -> Result<SecurityStatus, StoreError> {
        let state = self.state();
        Ok(SecurityStatus {
            password_set: !state.passwordless.contains(&user_id),
            google_linked: state
                .identities
                .iter()
                .any(|(u, p, _)| *u == user_id && p == crate::store::GOOGLE),
            totp_enabled: state.totp.get(&user_id).is_some_and(|(_, on, _)| *on),
            recovery_codes_remaining: state
                .recovery_codes
                .values()
                .filter(|(u, used)| *u == user_id && !used)
                .count() as u32,
        })
    }

    async fn find_totp(&self, user_id: Uuid) -> Result<Option<TotpRecord>, StoreError> {
        Ok(self
            .state()
            .totp
            .get(&user_id)
            .map(|(ciphertext, enabled, _)| TotpRecord {
                ciphertext: ciphertext.clone(),
                enabled: *enabled,
            }))
    }

    async fn stage_totp(&self, user_id: Uuid, ciphertext: &[u8]) -> Result<bool, StoreError> {
        let mut state = self.state();
        if state.totp.get(&user_id).is_some_and(|(_, on, _)| *on) {
            return Ok(false);
        }
        state.totp.insert(user_id, (ciphertext.to_vec(), false, 0));
        Ok(true)
    }

    async fn enable_totp(
        &self,
        user_id: Uuid,
        step: i64,
        recovery_hashes: &[String],
    ) -> Result<bool, StoreError> {
        let mut state = self.state();
        match state.totp.get_mut(&user_id) {
            Some((_, enabled, last)) if !*enabled && *last < step => {
                *enabled = true;
                *last = step;
            }
            _ => return Ok(false),
        }
        state.recovery_codes.retain(|_, (u, _)| *u != user_id);
        for hash in recovery_hashes {
            state.recovery_codes.insert(hash.clone(), (user_id, false));
        }
        Ok(true)
    }

    async fn use_totp_step(&self, user_id: Uuid, step: i64) -> Result<bool, StoreError> {
        match self.state().totp.get_mut(&user_id) {
            Some((_, true, last)) if *last < step => {
                *last = step;
                Ok(true)
            }
            _ => Ok(false),
        }
    }

    async fn consume_recovery_code(
        &self,
        user_id: Uuid,
        code_hash: &str,
    ) -> Result<bool, StoreError> {
        match self.state().recovery_codes.get_mut(code_hash) {
            Some((u, used)) if *u == user_id && !*used => {
                *used = true;
                Ok(true)
            }
            _ => Ok(false),
        }
    }

    async fn replace_recovery_codes(
        &self,
        user_id: Uuid,
        recovery_hashes: &[String],
    ) -> Result<bool, StoreError> {
        let mut state = self.state();
        if !state.totp.get(&user_id).is_some_and(|(_, on, _)| *on) {
            return Ok(false);
        }
        state.recovery_codes.retain(|_, (u, _)| *u != user_id);
        for hash in recovery_hashes {
            state.recovery_codes.insert(hash.clone(), (user_id, false));
        }
        Ok(true)
    }

    async fn disable_totp(&self, user_id: Uuid) -> Result<bool, StoreError> {
        let mut state = self.state();
        if !state.totp.get(&user_id).is_some_and(|(_, on, _)| *on) {
            return Ok(false);
        }
        state.totp.remove(&user_id);
        state.recovery_codes.retain(|_, (u, _)| *u != user_id);
        state.revoke_sessions(user_id);
        Ok(true)
    }

    async fn create_mfa_challenge(
        &self,
        user_id: Uuid,
        token_hash: &str,
        ttl: Duration,
    ) -> Result<(), StoreError> {
        self.state().mfa_challenges.insert(
            token_hash.to_string(),
            (user_id, 0, Instant::now() + ttl, false),
        );
        Ok(())
    }

    async fn attempt_mfa_challenge(
        &self,
        token_hash: &str,
        max_attempts: u32,
    ) -> Result<Option<Uuid>, StoreError> {
        match self.state().mfa_challenges.get_mut(token_hash) {
            Some((user, attempts, expires_at, false))
                if *expires_at > Instant::now() && *attempts < max_attempts =>
            {
                *attempts += 1;
                Ok(Some(*user))
            }
            _ => Ok(None),
        }
    }

    async fn consume_mfa_challenge(&self, token_hash: &str) -> Result<bool, StoreError> {
        match self.state().mfa_challenges.get_mut(token_hash) {
            Some((.., consumed)) if !*consumed => {
                *consumed = true;
                Ok(true)
            }
            _ => Ok(false),
        }
    }

    async fn revoke_all_refresh_tokens(&self, user_id: Uuid) -> Result<(), StoreError> {
        self.state().revoke_sessions(user_id);
        Ok(())
    }
}
