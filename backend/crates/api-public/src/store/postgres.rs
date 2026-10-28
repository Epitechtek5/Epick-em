//! Implémentation PostgreSQL de [`AuthStore`] (tables `users` et `refresh_tokens`,
//! voir `db/changelog`).

use super::{
    AuthStore, Game, GameInput, GameUpdate, Role, Stat, StatInput, StatUpdate, StoreError,
    UserProfile, UserRecord, UserUpdate,
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
}
