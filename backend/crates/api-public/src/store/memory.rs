//! Implémentation en mémoire de [`AuthStore`], pour les tests.

use super::{
    AuthStore, Game, GameInput, GameUpdate, Role, Stat, StatInput, StatUpdate, StoreError,
    UserProfile, UserRecord, UserUpdate,
};
use async_trait::async_trait;
use std::collections::{HashMap, HashSet};
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
    games: Vec<Game>,
    stats: Vec<Stat>,
    stat_games: HashSet<(Uuid, Uuid)>,
    /// Statistiques que le barème d'un tournoi en cours rend indélébiles.
    locked_stats: HashSet<Uuid>,
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

    /// Simule l'usage de la statistique par un tournoi `ongoing` : sa suppression est refusée.
    pub fn lock_stat(&self, id: Uuid) {
        self.state().locked_stats.insert(id);
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
            role: Role::User,
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
        Ok(Some(UserProfile::from(&*user)))
    }

    async fn delete_user(&self, id: Uuid) -> Result<bool, StoreError> {
        let mut state = self.state();
        let before = state.users.len();
        state.users.retain(|user| user.id != id);
        state.tokens.retain(|_, token| token.user_id != id);
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

    async fn list_games(&self, limit: i64, offset: i64) -> Result<Vec<Game>, StoreError> {
        let mut games = self.state().games.clone();
        games.sort_by_key(|game| (game.name.to_lowercase(), game.id));
        Ok(games
            .into_iter()
            .skip(usize::try_from(offset).unwrap_or(0))
            .take(usize::try_from(limit).unwrap_or(0))
            .collect())
    }

    async fn find_game(&self, id: Uuid) -> Result<Option<Game>, StoreError> {
        Ok(self.state().games.iter().find(|g| g.id == id).cloned())
    }

    async fn create_game(&self, input: GameInput) -> Result<Game, StoreError> {
        let mut state = self.state();
        if state
            .games
            .iter()
            .any(|g| g.name.to_lowercase() == input.name.to_lowercase())
        {
            return Err(StoreError::GameNameTaken);
        }
        let game = Game {
            id: Uuid::new_v4(),
            name: input.name,
            description: input.description,
            images: input.images,
        };
        state.games.push(game.clone());
        Ok(game)
    }

    async fn update_game(&self, id: Uuid, update: GameUpdate) -> Result<Option<Game>, StoreError> {
        let mut state = self.state();
        if let Some(name) = &update.name
            && state
                .games
                .iter()
                .any(|g| g.id != id && g.name.to_lowercase() == name.to_lowercase())
        {
            return Err(StoreError::GameNameTaken);
        }
        let Some(game) = state.games.iter_mut().find(|g| g.id == id) else {
            return Ok(None);
        };
        if let Some(name) = update.name {
            game.name = name;
        }
        if let Some(description) = update.description {
            game.description = description;
        }
        if let Some(images) = update.images {
            game.images = images;
        }
        Ok(Some(game.clone()))
    }

    async fn delete_game(&self, id: Uuid) -> Result<bool, StoreError> {
        let mut state = self.state();
        let before = state.games.len();
        state.games.retain(|g| g.id != id);
        state.stat_games.retain(|(_, game_id)| *game_id != id);
        Ok(state.games.len() != before)
    }

    async fn upsert_games(&self, games: Vec<GameInput>) -> Result<Vec<(Game, bool)>, StoreError> {
        let mut state = self.state();
        let mut result = Vec::with_capacity(games.len());
        for input in games {
            let existing = state
                .games
                .iter_mut()
                .find(|g| g.name.to_lowercase() == input.name.to_lowercase());
            match existing {
                Some(game) => {
                    game.name = input.name;
                    game.description = input.description;
                    game.images = input.images;
                    result.push((game.clone(), false));
                }
                None => {
                    let game = Game {
                        id: Uuid::new_v4(),
                        name: input.name,
                        description: input.description,
                        images: input.images,
                    };
                    state.games.push(game.clone());
                    result.push((game, true));
                }
            }
        }
        Ok(result)
    }

    async fn list_stats(&self, limit: i64, offset: i64) -> Result<Vec<Stat>, StoreError> {
        let mut stats = self.state().stats.clone();
        sort_stats(&mut stats);
        Ok(stats
            .into_iter()
            .skip(usize::try_from(offset).unwrap_or(0))
            .take(usize::try_from(limit).unwrap_or(0))
            .collect())
    }

    async fn find_stat(&self, id: Uuid) -> Result<Option<Stat>, StoreError> {
        Ok(self.state().stats.iter().find(|s| s.id == id).cloned())
    }

    async fn create_stat(&self, input: StatInput) -> Result<Stat, StoreError> {
        let mut state = self.state();
        if state.stats.iter().any(|s| s.key == input.key) {
            return Err(StoreError::StatKeyTaken);
        }
        let stat = Stat {
            id: Uuid::new_v4(),
            name: input.name,
            key: input.key,
            kind: input.kind,
        };
        state.stats.push(stat.clone());
        Ok(stat)
    }

    async fn update_stat(&self, id: Uuid, update: StatUpdate) -> Result<Option<Stat>, StoreError> {
        let mut state = self.state();
        if let Some(key) = &update.key
            && state.stats.iter().any(|s| s.id != id && s.key == *key)
        {
            return Err(StoreError::StatKeyTaken);
        }
        let Some(stat) = state.stats.iter_mut().find(|s| s.id == id) else {
            return Ok(None);
        };
        if let Some(name) = update.name {
            stat.name = name;
        }
        if let Some(key) = update.key {
            stat.key = key;
        }
        if let Some(kind) = update.kind {
            stat.kind = kind;
        }
        Ok(Some(stat.clone()))
    }

    async fn delete_stat(&self, id: Uuid) -> Result<bool, StoreError> {
        let mut state = self.state();
        if !state.stats.iter().any(|s| s.id == id) {
            return Ok(false);
        }
        if state.locked_stats.contains(&id) {
            return Err(StoreError::StatInUse);
        }
        state.stats.retain(|s| s.id != id);
        state.stat_games.retain(|(stat_id, _)| *stat_id != id);
        Ok(true)
    }

    async fn list_game_stats(&self, game_id: Uuid) -> Result<Option<Vec<Stat>>, StoreError> {
        let state = self.state();
        if !state.games.iter().any(|g| g.id == game_id) {
            return Ok(None);
        }
        let mut stats: Vec<Stat> = state
            .stats
            .iter()
            .filter(|s| state.stat_games.contains(&(s.id, game_id)))
            .cloned()
            .collect();
        sort_stats(&mut stats);
        Ok(Some(stats))
    }

    async fn link_stat(&self, game_id: Uuid, stat_id: Uuid) -> Result<bool, StoreError> {
        let mut state = self.state();
        if !state.games.iter().any(|g| g.id == game_id)
            || !state.stats.iter().any(|s| s.id == stat_id)
        {
            return Ok(false);
        }
        state.stat_games.insert((stat_id, game_id));
        Ok(true)
    }

    async fn unlink_stat(&self, game_id: Uuid, stat_id: Uuid) -> Result<bool, StoreError> {
        Ok(self.state().stat_games.remove(&(stat_id, game_id)))
    }
}

fn sort_stats(stats: &mut [Stat]) {
    stats.sort_by_key(|s| (s.name.to_lowercase(), s.id));
}
