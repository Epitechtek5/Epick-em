//! Implémentation en mémoire de [`AuthStore`], pour les tests.

use super::teams::now_rfc3339;
use super::{
    AuthStore, Game, GameInput, GameUpdate, Role, Stat, StatInput, StatUpdate, StoreError, Team,
    TeamInput, TeamMember, TeamRole, TeamUpdate, TournamentTeam, TournamentTeamInput,
    TournamentTeamMember, UserProfile, UserRecord, UserUpdate,
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
    teams: Vec<Team>,
    team_members: Vec<(Uuid, TeamMember)>,
    tournament_teams: Vec<TournamentTeam>,
    tournament_team_members: Vec<(Uuid, TournamentTeamMember)>,
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
        let doomed: Vec<Uuid> = state
            .teams
            .iter()
            .filter(|t| t.game_id == id)
            .map(|t| t.id)
            .collect();
        for team_id in doomed {
            state.remove_team(team_id);
        }
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

    async fn upsert_stats(&self, stats: Vec<StatInput>) -> Result<Vec<(Stat, bool)>, StoreError> {
        let mut state = self.state();
        Ok(stats
            .into_iter()
            .map(|input| state.upsert_stat(input))
            .collect())
    }

    async fn set_game_stats(&self, game_id: Uuid, stat_ids: Vec<Uuid>) -> Result<bool, StoreError> {
        let mut state = self.state();
        if !state.games.iter().any(|g| g.id == game_id)
            || !stat_ids
                .iter()
                .all(|id| state.stats.iter().any(|s| s.id == *id))
        {
            return Ok(false);
        }
        state.stat_games.retain(|(_, game)| *game != game_id);
        state
            .stat_games
            .extend(stat_ids.into_iter().map(|stat_id| (stat_id, game_id)));
        Ok(true)
    }

    async fn set_stat_games(&self, stat_id: Uuid, game_ids: Vec<Uuid>) -> Result<bool, StoreError> {
        let mut state = self.state();
        if !state.stats.iter().any(|s| s.id == stat_id)
            || !game_ids
                .iter()
                .all(|id| state.games.iter().any(|g| g.id == *id))
        {
            return Ok(false);
        }
        state.stat_games.retain(|(stat, _)| *stat != stat_id);
        state
            .stat_games
            .extend(game_ids.into_iter().map(|game_id| (stat_id, game_id)));
        Ok(true)
    }

    async fn unlink_stat(&self, game_id: Uuid, stat_id: Uuid) -> Result<bool, StoreError> {
        Ok(self.state().stat_games.remove(&(stat_id, game_id)))
    }

    async fn list_teams(
        &self,
        game_id: Option<Uuid>,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<Team>, StoreError> {
        let mut teams: Vec<Team> = self
            .state()
            .teams
            .iter()
            .filter(|t| game_id.is_none_or(|game| t.game_id == game))
            .cloned()
            .collect();
        teams.sort_by_key(|t| (t.name.to_lowercase(), t.id));
        Ok(teams
            .into_iter()
            .skip(usize::try_from(offset).unwrap_or(0))
            .take(usize::try_from(limit).unwrap_or(0))
            .collect())
    }

    async fn find_team(&self, id: Uuid) -> Result<Option<Team>, StoreError> {
        Ok(self.state().teams.iter().find(|t| t.id == id).cloned())
    }

    async fn create_team(&self, input: TeamInput) -> Result<Team, StoreError> {
        let mut state = self.state();
        if state.team_name_taken(input.game_id, &input.name, None) {
            return Err(StoreError::TeamNameTaken);
        }
        let now = now_rfc3339();
        let team = Team {
            id: Uuid::new_v4(),
            game_id: input.game_id,
            name: input.name,
            tag: input.tag,
            picture_url: input.picture_url,
            owner_id: input.owner_id,
            created_at: now.clone(),
            updated_at: now.clone(),
        };
        state.team_members.push((
            team.id,
            TeamMember {
                user_id: team.owner_id,
                role: TeamRole::Owner,
                joined_at: now,
                left_at: None,
            },
        ));
        state.teams.push(team.clone());
        Ok(team)
    }

    async fn update_team(&self, id: Uuid, update: TeamUpdate) -> Result<Option<Team>, StoreError> {
        let mut state = self.state();
        let Some(game_id) = state.teams.iter().find(|t| t.id == id).map(|t| t.game_id) else {
            return Ok(None);
        };
        if let Some(name) = &update.name
            && state.team_name_taken(game_id, name, Some(id))
        {
            return Err(StoreError::TeamNameTaken);
        }
        let Some(team) = state.teams.iter_mut().find(|t| t.id == id) else {
            return Ok(None);
        };
        if let Some(name) = update.name {
            team.name = name;
        }
        if let Some(tag) = update.tag {
            team.tag = tag;
        }
        if let Some(picture_url) = update.picture_url {
            team.picture_url = picture_url;
        }
        team.updated_at = now_rfc3339();
        Ok(Some(team.clone()))
    }

    async fn delete_team(&self, id: Uuid) -> Result<bool, StoreError> {
        let mut state = self.state();
        if !state.teams.iter().any(|t| t.id == id) {
            return Ok(false);
        }
        state.remove_team(id);
        Ok(true)
    }

    async fn list_team_members(
        &self,
        team_id: Uuid,
    ) -> Result<Option<Vec<TeamMember>>, StoreError> {
        let state = self.state();
        if !state.teams.iter().any(|t| t.id == team_id) {
            return Ok(None);
        }
        let mut members: Vec<TeamMember> = state
            .team_members
            .iter()
            .filter(|(team, _)| *team == team_id)
            .map(|(_, member)| member.clone())
            .collect();
        members.sort_by_key(|m| (m.joined_at.clone(), m.user_id));
        Ok(Some(members))
    }

    async fn add_team_member(
        &self,
        team_id: Uuid,
        user_id: Uuid,
        role: TeamRole,
    ) -> Result<Option<TeamMember>, StoreError> {
        let mut state = self.state();
        if !state.teams.iter().any(|t| t.id == team_id)
            || !state.users.iter().any(|u| u.id == user_id)
        {
            return Ok(None);
        }
        if state.active_team_member(team_id, user_id).is_some() {
            return Err(StoreError::AlreadyTeamMember);
        }
        let member = TeamMember {
            user_id,
            role,
            joined_at: now_rfc3339(),
            left_at: None,
        };
        state.team_members.push((team_id, member.clone()));
        Ok(Some(member))
    }

    async fn set_team_member_role(
        &self,
        team_id: Uuid,
        user_id: Uuid,
        role: TeamRole,
    ) -> Result<Option<TeamMember>, StoreError> {
        let mut state = self.state();
        Ok(state.active_team_member(team_id, user_id).map(|member| {
            member.role = role;
            member.clone()
        }))
    }

    async fn remove_team_member(&self, team_id: Uuid, user_id: Uuid) -> Result<bool, StoreError> {
        let mut state = self.state();
        Ok(state
            .active_team_member(team_id, user_id)
            .map(|member| member.left_at = Some(now_rfc3339()))
            .is_some())
    }

    async fn list_tournament_teams(
        &self,
        tournament_id: Uuid,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<TournamentTeam>, StoreError> {
        let mut teams: Vec<TournamentTeam> = self
            .state()
            .tournament_teams
            .iter()
            .filter(|t| t.tournament_id == tournament_id)
            .cloned()
            .collect();
        teams.sort_by_key(|t| (t.name.to_lowercase(), t.id));
        Ok(teams
            .into_iter()
            .skip(usize::try_from(offset).unwrap_or(0))
            .take(usize::try_from(limit).unwrap_or(0))
            .collect())
    }

    async fn find_tournament_team(&self, id: Uuid) -> Result<Option<TournamentTeam>, StoreError> {
        Ok(self
            .state()
            .tournament_teams
            .iter()
            .find(|t| t.id == id)
            .cloned())
    }

    async fn create_tournament_team(
        &self,
        input: TournamentTeamInput,
    ) -> Result<TournamentTeam, StoreError> {
        let mut state = self.state();
        if let Some(team_id) = input.team_id
            && state
                .tournament_teams
                .iter()
                .any(|t| t.tournament_id == input.tournament_id && t.team_id == Some(team_id))
        {
            return Err(StoreError::TeamAlreadyRegistered);
        }
        if input
            .members
            .iter()
            .any(|(user_id, _)| state.player_registered(input.tournament_id, *user_id))
        {
            return Err(StoreError::PlayerAlreadyRegistered);
        }
        let team = TournamentTeam {
            id: Uuid::new_v4(),
            tournament_id: input.tournament_id,
            team_id: input.team_id,
            name: input.name,
            tag: input.tag,
            picture_url: input.picture_url,
            owner_id: input.owner_id,
            created_at: now_rfc3339(),
        };
        state.tournament_team_members.extend(
            input
                .members
                .into_iter()
                .map(|(user_id, role)| (team.id, TournamentTeamMember { user_id, role })),
        );
        state.tournament_teams.push(team.clone());
        Ok(team)
    }

    async fn update_tournament_team(
        &self,
        id: Uuid,
        update: TeamUpdate,
    ) -> Result<Option<TournamentTeam>, StoreError> {
        let mut state = self.state();
        let Some(team) = state.tournament_teams.iter_mut().find(|t| t.id == id) else {
            return Ok(None);
        };
        if let Some(name) = update.name {
            team.name = name;
        }
        if let Some(tag) = update.tag {
            team.tag = tag;
        }
        if let Some(picture_url) = update.picture_url {
            team.picture_url = picture_url;
        }
        Ok(Some(team.clone()))
    }

    async fn delete_tournament_team(&self, id: Uuid) -> Result<bool, StoreError> {
        let mut state = self.state();
        let before = state.tournament_teams.len();
        state.tournament_teams.retain(|t| t.id != id);
        state
            .tournament_team_members
            .retain(|(team, _)| *team != id);
        Ok(state.tournament_teams.len() != before)
    }

    async fn list_tournament_team_members(
        &self,
        id: Uuid,
    ) -> Result<Option<Vec<TournamentTeamMember>>, StoreError> {
        let state = self.state();
        if !state.tournament_teams.iter().any(|t| t.id == id) {
            return Ok(None);
        }
        let mut members: Vec<TournamentTeamMember> = state
            .tournament_team_members
            .iter()
            .filter(|(team, _)| *team == id)
            .map(|(_, member)| member.clone())
            .collect();
        members.sort_by_key(|m| m.user_id);
        Ok(Some(members))
    }

    async fn add_tournament_team_member(
        &self,
        id: Uuid,
        user_id: Uuid,
        role: TeamRole,
    ) -> Result<Option<TournamentTeamMember>, StoreError> {
        let mut state = self.state();
        let Some(tournament_id) = state
            .tournament_teams
            .iter()
            .find(|t| t.id == id)
            .map(|t| t.tournament_id)
        else {
            return Ok(None);
        };
        if !state.users.iter().any(|u| u.id == user_id) {
            return Ok(None);
        }
        if state.player_registered(tournament_id, user_id) {
            return Err(StoreError::PlayerAlreadyRegistered);
        }
        let member = TournamentTeamMember { user_id, role };
        state.tournament_team_members.push((id, member.clone()));
        Ok(Some(member))
    }

    async fn set_tournament_team_member_role(
        &self,
        id: Uuid,
        user_id: Uuid,
        role: TeamRole,
    ) -> Result<Option<TournamentTeamMember>, StoreError> {
        let mut state = self.state();
        Ok(state
            .tournament_team_members
            .iter_mut()
            .find(|(team, member)| *team == id && member.user_id == user_id)
            .map(|(_, member)| {
                member.role = role;
                member.clone()
            }))
    }

    async fn remove_tournament_team_member(
        &self,
        id: Uuid,
        user_id: Uuid,
    ) -> Result<bool, StoreError> {
        let mut state = self.state();
        let before = state.tournament_team_members.len();
        state
            .tournament_team_members
            .retain(|(team, member)| !(*team == id && member.user_id == user_id));
        Ok(state.tournament_team_members.len() != before)
    }
}

impl State {
    fn team_name_taken(&self, game_id: Uuid, name: &str, except: Option<Uuid>) -> bool {
        self.teams.iter().any(|t| {
            t.game_id == game_id
                && Some(t.id) != except
                && t.name.to_lowercase() == name.to_lowercase()
        })
    }

    fn active_team_member(&mut self, team_id: Uuid, user_id: Uuid) -> Option<&mut TeamMember> {
        self.team_members
            .iter_mut()
            .find(|(team, member)| {
                *team == team_id && member.user_id == user_id && member.left_at.is_none()
            })
            .map(|(_, member)| member)
    }

    /// Supprime l'équipe et ses membres ; ses copies de tournoi perdent leur origine.
    fn remove_team(&mut self, id: Uuid) {
        self.teams.retain(|t| t.id != id);
        self.team_members.retain(|(team, _)| *team != id);
        for copy in &mut self.tournament_teams {
            if copy.team_id == Some(id) {
                copy.team_id = None;
            }
        }
    }

    fn player_registered(&self, tournament_id: Uuid, user_id: Uuid) -> bool {
        self.tournament_team_members.iter().any(|(team, member)| {
            member.user_id == user_id
                && self
                    .tournament_teams
                    .iter()
                    .any(|t| t.id == *team && t.tournament_id == tournament_id)
        })
    }

    fn upsert_stat(&mut self, input: StatInput) -> (Stat, bool) {
        if let Some(stat) = self.stats.iter_mut().find(|s| s.key == input.key) {
            stat.name = input.name;
            stat.kind = input.kind;
            return (stat.clone(), false);
        }
        let stat = Stat {
            id: Uuid::new_v4(),
            name: input.name,
            key: input.key,
            kind: input.kind,
        };
        self.stats.push(stat.clone());
        (stat, true)
    }
}

fn sort_stats(stats: &mut [Stat]) {
    stats.sort_by_key(|s| (s.name.to_lowercase(), s.id));
}
