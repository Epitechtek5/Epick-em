//! Implémentation PostgreSQL de [`AuthStore`] (tables `users` et `refresh_tokens`,
//! voir `db/changelog`).

use super::{
    AuthStore, Game, GameInput, GameUpdate, Role, Stat, StatInput, StatUpdate, StoreError, Team,
    TeamImport, TeamInput, TeamMember, TeamRole, TeamUpdate, TournamentTeam, TournamentTeamInput,
    TournamentTeamMember, UserProfile, UserRecord, UserUpdate,
};
use async_trait::async_trait;
use infra::{CachedDb, Ttl};
use sqlx::PgPool;
use std::time::Duration;
use uuid::Uuid;

/// Code SQLSTATE d'une violation de contrainte d'unicité.
const UNIQUE_VIOLATION: &str = "23505";
/// Code SQLSTATE d'une violation de clé étrangère.
const FOREIGN_KEY_VIOLATION: &str = "23503";

/// Durée de vie d'un profil en cache. Les modifications et suppressions invalident l'entrée ;
/// le TTL ne borne que la durée d'une valeur périmée si l'invalidation échoue.
const PROFILE_TTL: Ttl = Ttl::from_mins(5);

/// Seuls les profils (sans empreinte de mot de passe) passent par le cache ; la connexion et le
/// rafraîchissement lisent toujours la base.
pub struct PgStore {
    db: CachedDb,
    pool: PgPool,
}

impl PgStore {
    pub fn new(db: CachedDb) -> Self {
        let pool = db.pool().clone();
        PgStore { db, pool }
    }
}

fn profile_key(id: Uuid) -> String {
    format!("user:{id}")
}

type ProfileRow = (Uuid, String, String);

fn profile(row: ProfileRow) -> Result<UserProfile, StoreError> {
    Ok(UserProfile {
        id: row.0,
        username: row.1,
        role: row.2.parse::<Role>()?,
    })
}

/// Un rôle illisible en base remonte comme une erreur de décodage sqlx.
fn decode(err: StoreError) -> sqlx::Error {
    sqlx::Error::Decode(Box::new(err))
}

fn username_taken(err: sqlx::Error) -> StoreError {
    match &err {
        sqlx::Error::Database(db) if db.code().as_deref() == Some(UNIQUE_VIOLATION) => {
            StoreError::UsernameTaken
        }
        _ => err.into(),
    }
}

type GameRow = (Uuid, String, String, Vec<String>);

fn game(row: GameRow) -> Game {
    Game {
        id: row.0,
        name: row.1,
        description: row.2,
        images: row.3,
    }
}

fn game_name_taken(err: sqlx::Error) -> StoreError {
    match &err {
        sqlx::Error::Database(db) if db.code().as_deref() == Some(UNIQUE_VIOLATION) => {
            StoreError::GameNameTaken
        }
        _ => err.into(),
    }
}

type StatRow = (Uuid, String, String, String);

fn stat(row: StatRow) -> Result<Stat, StoreError> {
    Ok(Stat {
        id: row.0,
        name: row.1,
        key: row.2,
        kind: row.3.parse()?,
    })
}

fn stat_key_taken(err: sqlx::Error) -> StoreError {
    match &err {
        sqlx::Error::Database(db) if db.code().as_deref() == Some(UNIQUE_VIOLATION) => {
            StoreError::StatKeyTaken
        }
        _ => err.into(),
    }
}

/// Horodatage RFC 3339 en UTC, avec les microsecondes de PostgreSQL : sans perte à l'aller-retour.
fn ts(column: &str) -> String {
    format!("to_char({column} AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"')")
}

/// Colonnes de `teams`, dans l'ordre de [`TeamRow`].
fn team_columns() -> String {
    format!(
        "id, game_id, name, tag, picture_url, owner_id, {} AS created_at, {} AS updated_at",
        ts("created_at"),
        ts("updated_at")
    )
}

/// Colonnes de `tournament_teams`, dans l'ordre de [`TournamentTeamRow`].
fn tournament_team_columns() -> String {
    format!(
        "id, tournament_id, team_id, name, tag, picture_url, owner_id, {} AS created_at",
        ts("created_at")
    )
}

fn member_columns() -> String {
    format!(
        "user_id, role, {} AS joined_at, {} AS left_at",
        ts("joined_at"),
        ts("left_at")
    )
}

type TeamRow = (
    Uuid,
    Uuid,
    String,
    Option<String>,
    Option<String>,
    Uuid,
    String,
    String,
);

fn team(row: TeamRow) -> Team {
    Team {
        id: row.0,
        game_id: row.1,
        name: row.2,
        tag: row.3,
        picture_url: row.4,
        owner_id: row.5,
        created_at: row.6,
        updated_at: row.7,
    }
}

type TeamMemberRow = (Uuid, String, String, Option<String>);

fn team_member(row: TeamMemberRow) -> Result<TeamMember, StoreError> {
    Ok(TeamMember {
        user_id: row.0,
        role: row.1.parse::<TeamRole>()?,
        joined_at: row.2,
        left_at: row.3,
    })
}

type TournamentTeamRow = (
    Uuid,
    Uuid,
    Option<Uuid>,
    String,
    Option<String>,
    Option<String>,
    Uuid,
    String,
);

fn tournament_team(row: TournamentTeamRow) -> TournamentTeam {
    TournamentTeam {
        id: row.0,
        tournament_id: row.1,
        team_id: row.2,
        name: row.3,
        tag: row.4,
        picture_url: row.5,
        owner_id: row.6,
        created_at: row.7,
    }
}

fn tournament_member(row: (Uuid, String)) -> Result<TournamentTeamMember, StoreError> {
    Ok(TournamentTeamMember {
        user_id: row.0,
        role: row.1.parse::<TeamRole>()?,
    })
}

/// Traduit la violation d'une contrainte d'unicité des équipes (reconnue à son nom) ; les autres
/// erreurs restent des pannes.
fn team_conflict(err: sqlx::Error) -> StoreError {
    if let sqlx::Error::Database(db) = &err
        && db.code().as_deref() == Some(UNIQUE_VIOLATION)
    {
        match db.constraint() {
            Some("teams_game_name_lower_key") => return StoreError::TeamNameTaken,
            Some("team_member_active_key") => return StoreError::AlreadyTeamMember,
            Some("tournament_teams_team_key") => return StoreError::TeamAlreadyRegistered,
            Some("tournament_team_member_user_key") => {
                return StoreError::PlayerAlreadyRegistered;
            }
            _ => {}
        }
    }
    err.into()
}

fn is_foreign_key_violation(err: &sqlx::Error) -> bool {
    matches!(err, sqlx::Error::Database(db) if db.code().as_deref() == Some(FOREIGN_KEY_VIOLATION))
}

type UserRow = (Uuid, String, String, String);

fn user(row: UserRow) -> Result<UserRecord, StoreError> {
    Ok(UserRecord {
        id: row.0,
        username: row.1,
        password_hash: row.2,
        role: row.3.parse::<Role>()?,
    })
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
             RETURNING id, username, password_hash, role",
        )
        .bind(username)
        .bind(password_hash)
        .fetch_one(&self.pool)
        .await
        .map_err(username_taken)
        .and_then(user)
    }

    async fn find_user_by_username(
        &self,
        username: &str,
    ) -> Result<Option<UserRecord>, StoreError> {
        Ok(sqlx::query_as::<_, UserRow>(
            "SELECT id, username, password_hash, role FROM users WHERE lower(username) = lower($1)",
        )
        .bind(username)
        .fetch_optional(&self.pool)
        .await?
        .map(user)
        .transpose()?)
    }

    async fn find_user_by_id(&self, id: Uuid) -> Result<Option<UserRecord>, StoreError> {
        Ok(sqlx::query_as::<_, UserRow>(
            "SELECT id, username, password_hash, role FROM users WHERE id = $1",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await?
        .map(user)
        .transpose()?)
    }

    async fn find_profile(&self, id: Uuid) -> Result<Option<UserProfile>, StoreError> {
        Ok(self
            .db
            .read_optional(&profile_key(id), PROFILE_TTL, |pool| async move {
                sqlx::query_as::<_, ProfileRow>(
                    "SELECT id, username, role FROM users WHERE id = $1",
                )
                .bind(id)
                .fetch_optional(&pool)
                .await?
                .map(|row| profile(row).map_err(decode))
                .transpose()
            })
            .await?)
    }

    async fn list_profiles(&self, limit: i64, offset: i64) -> Result<Vec<UserProfile>, StoreError> {
        sqlx::query_as::<_, ProfileRow>(
            "SELECT id, username, role FROM users ORDER BY created_at, id LIMIT $1 OFFSET $2",
        )
        .bind(limit)
        .bind(offset)
        .fetch_all(&self.pool)
        .await?
        .into_iter()
        .map(profile)
        .collect()
    }

    async fn update_user(
        &self,
        id: Uuid,
        update: UserUpdate,
    ) -> Result<Option<UserProfile>, StoreError> {
        // L'entrée en cache est invalidée plutôt que réécrite : la prochaine lecture la recharge.
        self.db
            .delete(&[&profile_key(id)], |pool| async move {
                sqlx::query_as::<_, ProfileRow>(
                    "UPDATE users SET \
                         username = COALESCE($2, username), \
                         password_hash = COALESCE($3, password_hash), \
                         role = COALESCE($4, role) \
                     WHERE id = $1 RETURNING id, username, role",
                )
                .bind(id)
                .bind(update.username)
                .bind(update.password_hash)
                .bind(update.role.map(Role::as_str))
                .fetch_optional(&pool)
                .await
            })
            .await
            .map_err(username_taken)?
            .map(profile)
            .transpose()
    }

    async fn delete_user(&self, id: Uuid) -> Result<bool, StoreError> {
        let result = self
            .db
            .delete(&[&profile_key(id)], |pool| async move {
                sqlx::query("DELETE FROM users WHERE id = $1")
                    .bind(id)
                    .execute(&pool)
                    .await
            })
            .await?;
        Ok(result.rows_affected() > 0)
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

    async fn list_games(&self, limit: i64, offset: i64) -> Result<Vec<Game>, StoreError> {
        Ok(sqlx::query_as::<_, GameRow>(
            "SELECT id, name, description, images FROM games \
             ORDER BY lower(name), id LIMIT $1 OFFSET $2",
        )
        .bind(limit)
        .bind(offset)
        .fetch_all(&self.pool)
        .await?
        .into_iter()
        .map(game)
        .collect())
    }

    async fn find_game(&self, id: Uuid) -> Result<Option<Game>, StoreError> {
        Ok(sqlx::query_as::<_, GameRow>(
            "SELECT id, name, description, images FROM games WHERE id = $1",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await?
        .map(game))
    }

    async fn create_game(&self, input: GameInput) -> Result<Game, StoreError> {
        sqlx::query_as::<_, GameRow>(
            "INSERT INTO games (name, description, images) VALUES ($1, $2, $3) \
             RETURNING id, name, description, images",
        )
        .bind(input.name)
        .bind(input.description)
        .bind(input.images)
        .fetch_one(&self.pool)
        .await
        .map(game)
        .map_err(game_name_taken)
    }

    async fn update_game(&self, id: Uuid, update: GameUpdate) -> Result<Option<Game>, StoreError> {
        sqlx::query_as::<_, GameRow>(
            "UPDATE games SET \
                 name = COALESCE($2, name), \
                 description = COALESCE($3, description), \
                 images = COALESCE($4, images) \
             WHERE id = $1 RETURNING id, name, description, images",
        )
        .bind(id)
        .bind(update.name)
        .bind(update.description)
        .bind(update.images)
        .fetch_optional(&self.pool)
        .await
        .map(|row| row.map(game))
        .map_err(game_name_taken)
    }

    async fn delete_game(&self, id: Uuid) -> Result<bool, StoreError> {
        let result = sqlx::query("DELETE FROM games WHERE id = $1")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(result.rows_affected() > 0)
    }

    async fn upsert_games(&self, games: Vec<GameInput>) -> Result<Vec<(Game, bool)>, StoreError> {
        let mut tx = self.pool.begin().await?;
        let mut result = Vec::with_capacity(games.len());
        for input in games {
            // `xmax = 0` distingue une ligne insérée d'une ligne mise à jour.
            let row = sqlx::query_as::<_, (Uuid, String, String, Vec<String>, bool)>(
                "INSERT INTO games (name, description, images) VALUES ($1, $2, $3) \
                 ON CONFLICT (lower(name)) DO UPDATE SET \
                     name = EXCLUDED.name, \
                     description = EXCLUDED.description, \
                     images = EXCLUDED.images \
                 RETURNING id, name, description, images, (xmax = 0)",
            )
            .bind(input.name)
            .bind(input.description)
            .bind(input.images)
            .fetch_one(&mut *tx)
            .await?;
            result.push((game((row.0, row.1, row.2, row.3)), row.4));
        }
        tx.commit().await?;
        Ok(result)
    }

    async fn list_stats(&self, limit: i64, offset: i64) -> Result<Vec<Stat>, StoreError> {
        sqlx::query_as::<_, StatRow>(
            "SELECT id, name, key, type FROM stats \
             ORDER BY lower(name), id LIMIT $1 OFFSET $2",
        )
        .bind(limit)
        .bind(offset)
        .fetch_all(&self.pool)
        .await?
        .into_iter()
        .map(stat)
        .collect()
    }

    async fn find_stat(&self, id: Uuid) -> Result<Option<Stat>, StoreError> {
        sqlx::query_as::<_, StatRow>("SELECT id, name, key, type FROM stats WHERE id = $1")
            .bind(id)
            .fetch_optional(&self.pool)
            .await?
            .map(stat)
            .transpose()
    }

    async fn create_stat(&self, input: StatInput) -> Result<Stat, StoreError> {
        sqlx::query_as::<_, StatRow>(
            "INSERT INTO stats (name, key, type) VALUES ($1, $2, $3) \
             RETURNING id, name, key, type",
        )
        .bind(input.name)
        .bind(input.key)
        .bind(input.kind.as_str())
        .fetch_one(&self.pool)
        .await
        .map_err(stat_key_taken)
        .and_then(stat)
    }

    async fn update_stat(&self, id: Uuid, update: StatUpdate) -> Result<Option<Stat>, StoreError> {
        sqlx::query_as::<_, StatRow>(
            "UPDATE stats SET \
                 name = COALESCE($2, name), \
                 key = COALESCE($3, key), \
                 type = COALESCE($4, type) \
             WHERE id = $1 RETURNING id, name, key, type",
        )
        .bind(id)
        .bind(update.name)
        .bind(update.key)
        .bind(update.kind.map(|kind| kind.as_str()))
        .fetch_optional(&self.pool)
        .await
        .map_err(stat_key_taken)?
        .map(stat)
        .transpose()
    }

    async fn delete_stat(&self, id: Uuid) -> Result<bool, StoreError> {
        // Le barème des tournois (`scoring_rule`, #62) n'existe pas encore : aucune statistique
        // n'est utilisée par un tournoi `ongoing`. Le contrôle `StatInUse` se branche ici avec
        // cette table.
        let result = sqlx::query("DELETE FROM stats WHERE id = $1")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(result.rows_affected() > 0)
    }

    async fn list_game_stats(&self, game_id: Uuid) -> Result<Option<Vec<Stat>>, StoreError> {
        let exists =
            sqlx::query_scalar::<_, bool>("SELECT EXISTS (SELECT 1 FROM games WHERE id = $1)")
                .bind(game_id)
                .fetch_one(&self.pool)
                .await?;
        if !exists {
            return Ok(None);
        }
        sqlx::query_as::<_, StatRow>(
            "SELECT s.id, s.name, s.key, s.type FROM stats s \
             JOIN stat_game sg ON sg.stat_id = s.id WHERE sg.game_id = $1 \
             ORDER BY lower(s.name), s.id",
        )
        .bind(game_id)
        .fetch_all(&self.pool)
        .await?
        .into_iter()
        .map(stat)
        .collect::<Result<_, _>>()
        .map(Some)
    }

    async fn link_stat(&self, game_id: Uuid, stat_id: Uuid) -> Result<bool, StoreError> {
        let result = sqlx::query(
            "INSERT INTO stat_game (stat_id, game_id) VALUES ($1, $2) \
             ON CONFLICT DO NOTHING",
        )
        .bind(stat_id)
        .bind(game_id)
        .execute(&self.pool)
        .await;
        match result {
            Ok(_) => Ok(true),
            Err(sqlx::Error::Database(db))
                if db.code().as_deref() == Some(FOREIGN_KEY_VIOLATION) =>
            {
                Ok(false)
            }
            Err(err) => Err(err.into()),
        }
    }

    async fn unlink_stat(&self, game_id: Uuid, stat_id: Uuid) -> Result<bool, StoreError> {
        let result = sqlx::query("DELETE FROM stat_game WHERE stat_id = $1 AND game_id = $2")
            .bind(stat_id)
            .bind(game_id)
            .execute(&self.pool)
            .await?;
        Ok(result.rows_affected() > 0)
    }

    async fn upsert_stats(&self, stats: Vec<StatInput>) -> Result<Vec<(Stat, bool)>, StoreError> {
        let mut tx = self.pool.begin().await?;
        let mut result = Vec::with_capacity(stats.len());
        for input in stats {
            // `xmax = 0` distingue une ligne insérée d'une ligne mise à jour.
            let row = sqlx::query_as::<_, (Uuid, String, String, String, bool)>(
                "INSERT INTO stats (name, key, type) VALUES ($1, $2, $3) \
                 ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, type = EXCLUDED.type \
                 RETURNING id, name, key, type, (xmax = 0)",
            )
            .bind(input.name)
            .bind(input.key)
            .bind(input.kind.as_str())
            .fetch_one(&mut *tx)
            .await?;
            result.push((stat((row.0, row.1, row.2, row.3))?, row.4));
        }
        tx.commit().await?;
        Ok(result)
    }

    async fn set_game_stats(&self, game_id: Uuid, stat_ids: Vec<Uuid>) -> Result<bool, StoreError> {
        let mut tx = self.pool.begin().await?;
        sqlx::query("DELETE FROM stat_game WHERE game_id = $1")
            .bind(game_id)
            .execute(&mut *tx)
            .await?;
        let inserted = sqlx::query(
            "INSERT INTO stat_game (stat_id, game_id) SELECT unnest($1::uuid[]), $2 \
             ON CONFLICT DO NOTHING",
        )
        .bind(&stat_ids)
        .bind(game_id)
        .execute(&mut *tx)
        .await;
        match inserted {
            Ok(_) => {
                tx.commit().await?;
                Ok(true)
            }
            // Le jeu ou une statistique n'existe pas : la transaction est abandonnée.
            Err(sqlx::Error::Database(db))
                if db.code().as_deref() == Some(FOREIGN_KEY_VIOLATION) =>
            {
                Ok(false)
            }
            Err(err) => Err(err.into()),
        }
    }

    async fn set_stat_games(&self, stat_id: Uuid, game_ids: Vec<Uuid>) -> Result<bool, StoreError> {
        let mut tx = self.pool.begin().await?;
        sqlx::query("DELETE FROM stat_game WHERE stat_id = $1")
            .bind(stat_id)
            .execute(&mut *tx)
            .await?;
        let inserted = sqlx::query(
            "INSERT INTO stat_game (stat_id, game_id) SELECT $1, unnest($2::uuid[]) \
             ON CONFLICT DO NOTHING",
        )
        .bind(stat_id)
        .bind(&game_ids)
        .execute(&mut *tx)
        .await;
        match inserted {
            Ok(_) => {
                tx.commit().await?;
                Ok(true)
            }
            Err(sqlx::Error::Database(db))
                if db.code().as_deref() == Some(FOREIGN_KEY_VIOLATION) =>
            {
                Ok(false)
            }
            Err(err) => Err(err.into()),
        }
    }

    async fn list_teams(
        &self,
        game_id: Option<Uuid>,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<Team>, StoreError> {
        Ok(sqlx::query_as::<_, TeamRow>(&format!(
            "SELECT {} FROM teams WHERE $1::uuid IS NULL OR game_id = $1 \
             ORDER BY lower(name), id LIMIT $2 OFFSET $3",
            team_columns()
        ))
        .bind(game_id)
        .bind(limit)
        .bind(offset)
        .fetch_all(&self.pool)
        .await?
        .into_iter()
        .map(team)
        .collect())
    }

    async fn find_team(&self, id: Uuid) -> Result<Option<Team>, StoreError> {
        Ok(sqlx::query_as::<_, TeamRow>(&format!(
            "SELECT {} FROM teams WHERE id = $1",
            team_columns()
        ))
        .bind(id)
        .fetch_optional(&self.pool)
        .await?
        .map(team))
    }

    async fn create_team(&self, input: TeamInput) -> Result<Team, StoreError> {
        let mut tx = self.pool.begin().await?;
        let row = sqlx::query_as::<_, TeamRow>(&format!(
            "INSERT INTO teams (game_id, name, tag, picture_url, owner_id) \
             VALUES ($1, $2, $3, $4, $5) RETURNING {}",
            team_columns()
        ))
        .bind(input.game_id)
        .bind(input.name)
        .bind(input.tag)
        .bind(input.picture_url)
        .bind(input.owner_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(team_conflict)?;
        sqlx::query("INSERT INTO team_member (team_id, user_id, role) VALUES ($1, $2, 'owner')")
            .bind(row.0)
            .bind(input.owner_id)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        Ok(team(row))
    }

    async fn update_team(&self, id: Uuid, update: TeamUpdate) -> Result<Option<Team>, StoreError> {
        Ok(sqlx::query_as::<_, TeamRow>(&format!(
            "UPDATE teams SET \
                 name = COALESCE($2, name), \
                 tag = CASE WHEN $3 THEN $4 ELSE tag END, \
                 picture_url = CASE WHEN $5 THEN $6 ELSE picture_url END, \
                 updated_at = now() \
             WHERE id = $1 RETURNING {}",
            team_columns()
        ))
        .bind(id)
        .bind(update.name)
        .bind(update.tag.is_some())
        .bind(update.tag.flatten())
        .bind(update.picture_url.is_some())
        .bind(update.picture_url.flatten())
        .fetch_optional(&self.pool)
        .await
        .map_err(team_conflict)?
        .map(team))
    }

    async fn delete_team(&self, id: Uuid) -> Result<bool, StoreError> {
        let result = sqlx::query("DELETE FROM teams WHERE id = $1")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(result.rows_affected() > 0)
    }

    async fn list_team_members(
        &self,
        team_id: Uuid,
    ) -> Result<Option<Vec<TeamMember>>, StoreError> {
        let exists =
            sqlx::query_scalar::<_, bool>("SELECT EXISTS (SELECT 1 FROM teams WHERE id = $1)")
                .bind(team_id)
                .fetch_one(&self.pool)
                .await?;
        if !exists {
            return Ok(None);
        }
        sqlx::query_as::<_, TeamMemberRow>(&format!(
            "SELECT {} FROM team_member WHERE team_id = $1 ORDER BY joined_at, user_id",
            member_columns()
        ))
        .bind(team_id)
        .fetch_all(&self.pool)
        .await?
        .into_iter()
        .map(team_member)
        .collect::<Result<_, _>>()
        .map(Some)
    }

    async fn add_team_member(
        &self,
        team_id: Uuid,
        user_id: Uuid,
        role: TeamRole,
    ) -> Result<Option<TeamMember>, StoreError> {
        let row = sqlx::query_as::<_, TeamMemberRow>(&format!(
            "INSERT INTO team_member (team_id, user_id, role) VALUES ($1, $2, $3) RETURNING {}",
            member_columns()
        ))
        .bind(team_id)
        .bind(user_id)
        .bind(role.as_str())
        .fetch_one(&self.pool)
        .await;
        match row {
            Ok(row) => team_member(row).map(Some),
            // L'équipe ou le compte n'existe pas.
            Err(err) if is_foreign_key_violation(&err) => Ok(None),
            Err(err) => Err(team_conflict(err)),
        }
    }

    async fn set_team_member_role(
        &self,
        team_id: Uuid,
        user_id: Uuid,
        role: TeamRole,
    ) -> Result<Option<TeamMember>, StoreError> {
        sqlx::query_as::<_, TeamMemberRow>(&format!(
            "UPDATE team_member SET role = $3 \
             WHERE team_id = $1 AND user_id = $2 AND left_at IS NULL RETURNING {}",
            member_columns()
        ))
        .bind(team_id)
        .bind(user_id)
        .bind(role.as_str())
        .fetch_optional(&self.pool)
        .await?
        .map(team_member)
        .transpose()
    }

    async fn remove_team_member(&self, team_id: Uuid, user_id: Uuid) -> Result<bool, StoreError> {
        let result = sqlx::query(
            "UPDATE team_member SET left_at = now() \
             WHERE team_id = $1 AND user_id = $2 AND left_at IS NULL",
        )
        .bind(team_id)
        .bind(user_id)
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() > 0)
    }

    async fn import_teams(&self, teams: Vec<TeamImport>) -> Result<Vec<(Team, bool)>, StoreError> {
        let mut tx = self.pool.begin().await?;
        let mut result = Vec::with_capacity(teams.len());
        for input in teams {
            // `xmax = 0` distingue une ligne insérée d'une ligne mise à jour.
            let row = sqlx::query_as::<
                _,
                (
                    Uuid,
                    Uuid,
                    String,
                    Option<String>,
                    Option<String>,
                    Uuid,
                    String,
                    String,
                    bool,
                ),
            >(&format!(
                "INSERT INTO teams (game_id, name, tag, picture_url, owner_id) \
                 VALUES ($1, $2, $3, $4, $5) \
                 ON CONFLICT (game_id, lower(name)) DO UPDATE SET \
                     name = EXCLUDED.name, \
                     tag = EXCLUDED.tag, \
                     picture_url = EXCLUDED.picture_url, \
                     owner_id = EXCLUDED.owner_id, \
                     updated_at = now() \
                 RETURNING {}, (xmax = 0)",
                team_columns()
            ))
            .bind(input.game_id)
            .bind(input.name)
            .bind(input.tag)
            .bind(input.picture_url)
            .bind(input.owner_id)
            .fetch_one(&mut *tx)
            .await
            .map_err(team_conflict)?;
            // Le fichier décrit l'état complet de l'équipe : ses membres remplacent les anciens.
            sqlx::query("DELETE FROM team_member WHERE team_id = $1")
                .bind(row.0)
                .execute(&mut *tx)
                .await?;
            for member in input.members {
                sqlx::query(
                    "INSERT INTO team_member (team_id, user_id, role, joined_at, left_at) \
                     VALUES ($1, $2, $3, COALESCE($4::timestamptz, now()), $5::timestamptz)",
                )
                .bind(row.0)
                .bind(member.user_id)
                .bind(member.role.as_str())
                .bind(member.joined_at)
                .bind(member.left_at)
                .execute(&mut *tx)
                .await
                .map_err(team_conflict)?;
            }
            result.push((
                team((row.0, row.1, row.2, row.3, row.4, row.5, row.6, row.7)),
                row.8,
            ));
        }
        tx.commit().await?;
        Ok(result)
    }

    async fn list_tournament_teams(
        &self,
        tournament_id: Uuid,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<TournamentTeam>, StoreError> {
        Ok(sqlx::query_as::<_, TournamentTeamRow>(&format!(
            "SELECT {} FROM tournament_teams WHERE tournament_id = $1 \
             ORDER BY lower(name), id LIMIT $2 OFFSET $3",
            tournament_team_columns()
        ))
        .bind(tournament_id)
        .bind(limit)
        .bind(offset)
        .fetch_all(&self.pool)
        .await?
        .into_iter()
        .map(tournament_team)
        .collect())
    }

    async fn find_tournament_team(&self, id: Uuid) -> Result<Option<TournamentTeam>, StoreError> {
        Ok(sqlx::query_as::<_, TournamentTeamRow>(&format!(
            "SELECT {} FROM tournament_teams WHERE id = $1",
            tournament_team_columns()
        ))
        .bind(id)
        .fetch_optional(&self.pool)
        .await?
        .map(tournament_team))
    }

    async fn create_tournament_team(
        &self,
        input: TournamentTeamInput,
    ) -> Result<TournamentTeam, StoreError> {
        let mut tx = self.pool.begin().await?;
        let row = sqlx::query_as::<_, TournamentTeamRow>(&format!(
            "INSERT INTO tournament_teams (tournament_id, team_id, name, tag, picture_url, owner_id) \
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING {}",
            tournament_team_columns()
        ))
        .bind(input.tournament_id)
        .bind(input.team_id)
        .bind(input.name)
        .bind(input.tag)
        .bind(input.picture_url)
        .bind(input.owner_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(team_conflict)?;
        for (user_id, role) in input.members {
            sqlx::query(
                "INSERT INTO tournament_team_member (tournament_team_id, tournament_id, user_id, role) \
                 VALUES ($1, $2, $3, $4)",
            )
            .bind(row.0)
            .bind(input.tournament_id)
            .bind(user_id)
            .bind(role.as_str())
            .execute(&mut *tx)
            .await
            .map_err(team_conflict)?;
        }
        tx.commit().await?;
        Ok(tournament_team(row))
    }

    async fn update_tournament_team(
        &self,
        id: Uuid,
        update: TeamUpdate,
    ) -> Result<Option<TournamentTeam>, StoreError> {
        Ok(sqlx::query_as::<_, TournamentTeamRow>(&format!(
            "UPDATE tournament_teams SET \
                 name = COALESCE($2, name), \
                 tag = CASE WHEN $3 THEN $4 ELSE tag END, \
                 picture_url = CASE WHEN $5 THEN $6 ELSE picture_url END \
             WHERE id = $1 RETURNING {}",
            tournament_team_columns()
        ))
        .bind(id)
        .bind(update.name)
        .bind(update.tag.is_some())
        .bind(update.tag.flatten())
        .bind(update.picture_url.is_some())
        .bind(update.picture_url.flatten())
        .fetch_optional(&self.pool)
        .await?
        .map(tournament_team))
    }

    async fn delete_tournament_team(&self, id: Uuid) -> Result<bool, StoreError> {
        let result = sqlx::query("DELETE FROM tournament_teams WHERE id = $1")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(result.rows_affected() > 0)
    }

    async fn list_tournament_team_members(
        &self,
        id: Uuid,
    ) -> Result<Option<Vec<TournamentTeamMember>>, StoreError> {
        let exists = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS (SELECT 1 FROM tournament_teams WHERE id = $1)",
        )
        .bind(id)
        .fetch_one(&self.pool)
        .await?;
        if !exists {
            return Ok(None);
        }
        sqlx::query_as::<_, (Uuid, String)>(
            "SELECT user_id, role FROM tournament_team_member \
             WHERE tournament_team_id = $1 ORDER BY user_id",
        )
        .bind(id)
        .fetch_all(&self.pool)
        .await?
        .into_iter()
        .map(tournament_member)
        .collect::<Result<_, _>>()
        .map(Some)
    }

    async fn add_tournament_team_member(
        &self,
        id: Uuid,
        user_id: Uuid,
        role: TeamRole,
    ) -> Result<Option<TournamentTeamMember>, StoreError> {
        let row = sqlx::query_as::<_, (Uuid, String)>(
            "INSERT INTO tournament_team_member (tournament_team_id, tournament_id, user_id, role) \
             SELECT id, tournament_id, $2, $3 FROM tournament_teams WHERE id = $1 \
             RETURNING user_id, role",
        )
        .bind(id)
        .bind(user_id)
        .bind(role.as_str())
        .fetch_optional(&self.pool)
        .await;
        match row {
            Ok(row) => row.map(tournament_member).transpose(),
            // Le compte n'existe pas.
            Err(err) if is_foreign_key_violation(&err) => Ok(None),
            Err(err) => Err(team_conflict(err)),
        }
    }

    async fn set_tournament_team_member_role(
        &self,
        id: Uuid,
        user_id: Uuid,
        role: TeamRole,
    ) -> Result<Option<TournamentTeamMember>, StoreError> {
        sqlx::query_as::<_, (Uuid, String)>(
            "UPDATE tournament_team_member SET role = $3 \
             WHERE tournament_team_id = $1 AND user_id = $2 RETURNING user_id, role",
        )
        .bind(id)
        .bind(user_id)
        .bind(role.as_str())
        .fetch_optional(&self.pool)
        .await?
        .map(tournament_member)
        .transpose()
    }

    async fn remove_tournament_team_member(
        &self,
        id: Uuid,
        user_id: Uuid,
    ) -> Result<bool, StoreError> {
        let result = sqlx::query(
            "DELETE FROM tournament_team_member WHERE tournament_team_id = $1 AND user_id = $2",
        )
        .bind(id)
        .bind(user_id)
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() > 0)
    }
}
