//! Implémentation PostgreSQL de [`AuthStore`] (tables `users` et `refresh_tokens`,
//! voir `db/changelog`).

use super::{
    AuthStore, Game, GameInput, GameUpdate, Match, MatchFinish, MatchImport, MatchInput,
    MatchParticipant, MatchScore, MatchStatus, MatchUpdate, ParticipantImport, ParticipantInput,
    ParticipantStatus, Role, ScoringRule, ScoringRuleDefinition, ScoringRuleInput, Stat, StatInput,
    StatUpdate, Step, StepClosing, StepDefinition, StepGroup, StepInput, StepParticipant,
    StepStart, StoreError, Team, TeamImport, TeamInput, TeamMember, TeamRole, TeamUpdate,
    Tournament, TournamentImport, TournamentInput, TournamentParticipant, TournamentStatus,
    TournamentTeam, TournamentTeamInput, TournamentTeamMember, TournamentUpdate, UserProfile,
    UserRecord, UserUpdate,
};
use async_trait::async_trait;
use infra::{CachedDb, Ttl};
use sqlx::PgPool;
use std::collections::HashMap;
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

/// Colonnes de `tournaments`, dans l'ordre de [`TournamentRow`].
fn tournament_columns() -> String {
    format!(
        "id, game_id, name, description, {} AS start_date, {} AS end_date, \
         {} AS registration_open_at, {} AS registration_close_at, participant_type, team_size, \
         max_participants, team_scoring_mode, team_scoring_n, status, {} AS created_at, \
         {} AS updated_at",
        ts("start_date"),
        ts("end_date"),
        ts("registration_open_at"),
        ts("registration_close_at"),
        ts("created_at"),
        ts("updated_at")
    )
}

type TournamentRow = (
    Uuid,
    Uuid,
    String,
    Option<String>,
    String,
    String,
    Option<String>,
    Option<String>,
    String,
    Option<i32>,
    i32,
    String,
    Option<i32>,
    String,
    String,
    String,
);

fn tournament(row: TournamentRow) -> Result<Tournament, StoreError> {
    Ok(Tournament {
        id: row.0,
        game_id: row.1,
        name: row.2,
        description: row.3,
        start_date: row.4,
        end_date: row.5,
        registration_open_at: row.6,
        registration_close_at: row.7,
        participant_type: row.8.parse()?,
        team_size: row.9,
        max_participants: row.10,
        team_scoring_mode: row.11.parse()?,
        team_scoring_n: row.12,
        status: row.13.parse()?,
        created_at: row.14,
        updated_at: row.15,
    })
}

const SCORING_RULE_COLUMNS: &str =
    "id, tournament_id, stat_id, mode, coefficient::float8, points_table::text";

type ScoringRuleRow = (Uuid, Uuid, Uuid, String, Option<f64>, Option<String>);

fn scoring_rule(row: ScoringRuleRow) -> Result<ScoringRule, StoreError> {
    Ok(ScoringRule {
        id: row.0,
        tournament_id: row.1,
        stat_id: row.2,
        mode: row.3.parse()?,
        coefficient: row.4,
        points_table: row
            .5
            .map(|text| serde_json::from_str(&text))
            .transpose()
            .map_err(|err| StoreError::Other(err.to_string()))?,
    })
}

/// Colonnes de `step`, dans l'ordre de [`StepRow`].
fn step_columns() -> String {
    format!(
        "id, tournament_id, position, format, match_type, group_count, group_size, \
         matches_per_group, advance_per_group, tiebreak::text, status, {} AS created_at, \
         {} AS updated_at",
        ts("created_at"),
        ts("updated_at")
    )
}

type StepRow = (
    Uuid,
    Uuid,
    i32,
    String,
    String,
    i32,
    i32,
    i32,
    i32,
    String,
    String,
    String,
    String,
);

fn step(row: StepRow) -> Result<Step, StoreError> {
    Ok(Step {
        id: row.0,
        tournament_id: row.1,
        position: row.2,
        format: row.3.parse()?,
        match_type: row.4.parse()?,
        group_count: row.5,
        group_size: row.6,
        matches_per_group: row.7,
        advance_per_group: row.8,
        tiebreak: serde_json::from_str(&row.9).map_err(|err| StoreError::Other(err.to_string()))?,
        status: row.10.parse()?,
        created_at: row.11,
        updated_at: row.12,
    })
}

type StepParticipantRow = (Uuid, Uuid, Uuid, f64, Option<i32>, String);

fn step_participant(row: StepParticipantRow) -> Result<StepParticipant, StoreError> {
    Ok(StepParticipant {
        step_id: row.0,
        participant_id: row.1,
        group_id: row.2,
        points: row.3,
        final_rank: row.4,
        status: row.5.parse()?,
    })
}

fn step_conflict(err: sqlx::Error) -> StoreError {
    if let sqlx::Error::Database(db) = &err
        && db.code().as_deref() == Some(UNIQUE_VIOLATION)
        && db.constraint() == Some("step_tournament_position_key")
    {
        return StoreError::StepPositionTaken;
    }
    err.into()
}

/// Passe l'étape `pending` en `ongoing` et crée ses groupes et ses participants.
async fn start_step_in(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    start: StepStart,
) -> Result<Option<Step>, StoreError> {
    let updated = sqlx::query_as::<_, StepRow>(&format!(
        "UPDATE step SET status = 'ongoing', updated_at = now() \
         WHERE id = $1 AND status = 'pending' RETURNING {}",
        step_columns()
    ))
    .bind(start.step_id)
    .fetch_optional(&mut **tx)
    .await?;
    let Some(updated) = updated else {
        let exists =
            sqlx::query_scalar::<_, bool>("SELECT EXISTS (SELECT 1 FROM step WHERE id = $1)")
                .bind(start.step_id)
                .fetch_one(&mut **tx)
                .await?;
        return if exists {
            Err(StoreError::StepState)
        } else {
            Ok(None)
        };
    };
    let step = step(updated)?;
    for (index, ids) in start.groups.iter().enumerate() {
        let group_id = sqlx::query_scalar::<_, Uuid>(
            "INSERT INTO step_group (step_id, index) VALUES ($1, $2) RETURNING id",
        )
        .bind(step.id)
        .bind(i32::try_from(index + 1).unwrap_or(i32::MAX))
        .fetch_one(&mut **tx)
        .await?;
        for participant_id in ids {
            sqlx::query(
                "INSERT INTO step_participant (step_id, tournament_id, participant_id, group_id) \
                 VALUES ($1, $2, $3, $4)",
            )
            .bind(step.id)
            .bind(step.tournament_id)
            .bind(participant_id)
            .bind(group_id)
            .execute(&mut **tx)
            .await?;
        }
    }
    Ok(Some(step))
}

/// Colonnes de `match`, dans l'ordre de [`MatchRow`].
fn match_columns() -> String {
    format!(
        "id, game_id, step_id, group_id, round, bracket, next_match_id, {} AS scheduled_at, \
         {} AS started_at, {} AS ended_at, status, {} AS created_at, {} AS updated_at",
        ts("scheduled_at"),
        ts("started_at"),
        ts("ended_at"),
        ts("created_at"),
        ts("updated_at")
    )
}

type MatchRow = (
    Uuid,
    Uuid,
    Uuid,
    Option<Uuid>,
    Option<i32>,
    Option<String>,
    Option<Uuid>,
    Option<String>,
    Option<String>,
    Option<String>,
    String,
    String,
    String,
);

fn match_from(row: MatchRow) -> Result<Match, StoreError> {
    Ok(Match {
        id: row.0,
        game_id: row.1,
        step_id: row.2,
        group_id: row.3,
        round: row.4,
        bracket: row.5.map(|b| b.parse()).transpose()?,
        next_match_id: row.6,
        scheduled_at: row.7,
        started_at: row.8,
        ended_at: row.9,
        status: row.10.parse()?,
        created_at: row.11,
        updated_at: row.12,
    })
}

type MatchParticipantRow = (Uuid, Uuid, String, f64, Option<i32>, Option<String>);

const MATCH_PARTICIPANT_COLUMNS: &str =
    "match_id, participant_id, stats::text, points::float8, rank, result";

fn match_participant(row: MatchParticipantRow) -> Result<MatchParticipant, StoreError> {
    Ok(MatchParticipant {
        match_id: row.0,
        participant_id: row.1,
        stats: serde_json::from_str(&row.2).map_err(|err| StoreError::Other(err.to_string()))?,
        points: row.3,
        rank: row.4,
        result: row.5.map(|r| r.parse()).transpose()?,
    })
}

/// Remplace les participants du match : ceux qui restent gardent leurs résultats.
async fn set_match_participants_in(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    match_id: Uuid,
    participants: &[Uuid],
) -> Result<(), StoreError> {
    sqlx::query("DELETE FROM match_participant WHERE match_id = $1 AND participant_id <> ALL($2)")
        .bind(match_id)
        .bind(participants)
        .execute(&mut **tx)
        .await?;
    for participant_id in participants {
        insert_match_participant(tx, match_id, *participant_id).await?;
    }
    Ok(())
}

async fn insert_match_participant(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    match_id: Uuid,
    participant_id: Uuid,
) -> Result<(), StoreError> {
    sqlx::query(
        "INSERT INTO match_participant (match_id, participant_id) VALUES ($1, $2) \
         ON CONFLICT DO NOTHING",
    )
    .bind(match_id)
    .bind(participant_id)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn save_match_scores_in(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    match_id: Uuid,
    scores: Vec<MatchScore>,
) -> Result<(), StoreError> {
    for score in scores {
        sqlx::query(
            "UPDATE match_participant SET stats = $3::jsonb, points = $4::float8::numeric, \
                 rank = $5, result = $6 \
             WHERE match_id = $1 AND participant_id = $2",
        )
        .bind(match_id)
        .bind(score.participant_id)
        .bind(score.stats.to_string())
        .bind(score.points)
        .bind(score.rank)
        .bind(score.result.map(|r| r.as_str()))
        .execute(&mut **tx)
        .await?;
    }
    Ok(())
}

/// Verrouille le match et vérifie qu'il accepte encore des résultats.
async fn lock_open_match(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    match_id: Uuid,
) -> Result<Option<Uuid>, StoreError> {
    let row = sqlx::query_as::<_, (String, Uuid)>(
        "SELECT status, step_id FROM match WHERE id = $1 FOR UPDATE",
    )
    .bind(match_id)
    .fetch_optional(&mut **tx)
    .await?;
    match row {
        None => Ok(None),
        Some((status, _)) if status == "finished" || status == "cancelled" => {
            Err(StoreError::MatchState)
        }
        Some((_, step_id)) => Ok(Some(step_id)),
    }
}

/// Colonnes de `tournament_participant`, dans l'ordre de [`ParticipantRow`].
fn participant_columns() -> String {
    format!(
        "id, tournament_id, user_id, tournament_team_id, status, {} AS registered_at",
        ts("registered_at")
    )
}

type ParticipantRow = (Uuid, Uuid, Option<Uuid>, Option<Uuid>, String, String);

fn participant(row: ParticipantRow) -> Result<TournamentParticipant, StoreError> {
    Ok(TournamentParticipant {
        id: row.0,
        tournament_id: row.1,
        user_id: row.2,
        tournament_team_id: row.3,
        status: row.4.parse()?,
        registered_at: row.5,
    })
}

/// Traduit la violation d'une contrainte d'unicité des inscriptions ou du barème.
fn tournament_conflict(err: sqlx::Error) -> StoreError {
    if let sqlx::Error::Database(db) = &err
        && db.code().as_deref() == Some(UNIQUE_VIOLATION)
    {
        match db.constraint() {
            Some("tournament_participant_user_key" | "tournament_participant_team_key") => {
                return StoreError::AlreadyParticipant;
            }
            Some("scoring_rule_tournament_stat_key") => return StoreError::ScoringRuleTaken,
            Some("tournaments_game_name_lower_key") => return StoreError::TournamentNameTaken,
            _ => {}
        }
    }
    err.into()
}

/// Le barème d'un tournoi `ongoing` s'appuie sur la statistique (pour ce jeu, si précisé).
async fn stat_locked(
    pool: &PgPool,
    stat_id: Option<Uuid>,
    game_id: Option<Uuid>,
) -> Result<bool, StoreError> {
    Ok(sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS (SELECT 1 FROM scoring_rule r \
         JOIN tournaments t ON t.id = r.tournament_id \
         WHERE t.status = 'ongoing' \
           AND ($1::uuid IS NULL OR r.stat_id = $1) AND ($2::uuid IS NULL OR r.game_id = $2))",
    )
    .bind(stat_id)
    .bind(game_id)
    .fetch_one(pool)
    .await?)
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
        if stat_locked(&self.pool, Some(id), None).await? {
            return Err(StoreError::StatInUse);
        }
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
        if stat_locked(&self.pool, Some(stat_id), Some(game_id)).await? {
            return Err(StoreError::StatInUse);
        }
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
        // Retirer une liaison supprimerait en cascade la règle d'un tournoi `ongoing`.
        if sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS (SELECT 1 FROM scoring_rule r \
             JOIN tournaments t ON t.id = r.tournament_id \
             WHERE t.status = 'ongoing' AND r.game_id = $1 AND NOT (r.stat_id = ANY($2)))",
        )
        .bind(game_id)
        .bind(&stat_ids)
        .fetch_one(&self.pool)
        .await?
        {
            return Err(StoreError::StatInUse);
        }
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
        if sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS (SELECT 1 FROM scoring_rule r \
             JOIN tournaments t ON t.id = r.tournament_id \
             WHERE t.status = 'ongoing' AND r.stat_id = $1 AND NOT (r.game_id = ANY($2)))",
        )
        .bind(stat_id)
        .bind(&game_ids)
        .fetch_one(&self.pool)
        .await?
        {
            return Err(StoreError::StatInUse);
        }
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

    async fn list_tournaments(
        &self,
        game_id: Option<Uuid>,
        status: Option<TournamentStatus>,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<Tournament>, StoreError> {
        sqlx::query_as::<_, TournamentRow>(&format!(
            "SELECT {} FROM tournaments \
             WHERE ($1::uuid IS NULL OR game_id = $1) AND ($2::text IS NULL OR status = $2) \
             ORDER BY start_date, id LIMIT $3 OFFSET $4",
            tournament_columns()
        ))
        .bind(game_id)
        .bind(status.map(|status| status.as_str()))
        .bind(limit)
        .bind(offset)
        .fetch_all(&self.pool)
        .await?
        .into_iter()
        .map(tournament)
        .collect()
    }

    async fn find_tournament(&self, id: Uuid) -> Result<Option<Tournament>, StoreError> {
        sqlx::query_as::<_, TournamentRow>(&format!(
            "SELECT {} FROM tournaments WHERE id = $1",
            tournament_columns()
        ))
        .bind(id)
        .fetch_optional(&self.pool)
        .await?
        .map(tournament)
        .transpose()
    }

    async fn create_tournament(&self, input: TournamentInput) -> Result<Tournament, StoreError> {
        let row = sqlx::query_as::<_, TournamentRow>(&format!(
            "INSERT INTO tournaments (game_id, name, description, start_date, end_date, \
                 registration_open_at, registration_close_at, participant_type, team_size, \
                 max_participants, team_scoring_mode, team_scoring_n) \
             VALUES ($1, $2, $3, $4::timestamptz, $5::timestamptz, $6::timestamptz, \
                 $7::timestamptz, $8, $9, $10, $11, $12) RETURNING {}",
            tournament_columns()
        ))
        .bind(input.game_id)
        .bind(input.name)
        .bind(input.description)
        .bind(input.start_date)
        .bind(input.end_date)
        .bind(input.registration_open_at)
        .bind(input.registration_close_at)
        .bind(input.participant_type.as_str())
        .bind(input.team_size)
        .bind(input.max_participants)
        .bind(input.team_scoring_mode.as_str())
        .bind(input.team_scoring_n)
        .fetch_one(&self.pool)
        .await
        .map_err(tournament_conflict)?;
        tournament(row)
    }

    async fn update_tournament(
        &self,
        id: Uuid,
        update: TournamentUpdate,
    ) -> Result<Option<Tournament>, StoreError> {
        sqlx::query_as::<_, TournamentRow>(&format!(
            "UPDATE tournaments SET \
                 name = COALESCE($2, name), \
                 description = CASE WHEN $3 THEN $4 ELSE description END, \
                 start_date = COALESCE($5::timestamptz, start_date), \
                 end_date = COALESCE($6::timestamptz, end_date), \
                 registration_open_at = CASE WHEN $7 THEN $8::timestamptz ELSE registration_open_at END, \
                 registration_close_at = CASE WHEN $9 THEN $10::timestamptz ELSE registration_close_at END, \
                 team_size = CASE WHEN $11 THEN $12 ELSE team_size END, \
                 max_participants = COALESCE($13, max_participants), \
                 team_scoring_mode = COALESCE($14, team_scoring_mode), \
                 team_scoring_n = CASE WHEN $15 THEN $16 ELSE team_scoring_n END, \
                 updated_at = now() \
             WHERE id = $1 RETURNING {}",
            tournament_columns()
        ))
        .bind(id)
        .bind(update.name)
        .bind(update.description.is_some())
        .bind(update.description.flatten())
        .bind(update.start_date)
        .bind(update.end_date)
        .bind(update.registration_open_at.is_some())
        .bind(update.registration_open_at.flatten())
        .bind(update.registration_close_at.is_some())
        .bind(update.registration_close_at.flatten())
        .bind(update.team_size.is_some())
        .bind(update.team_size.flatten())
        .bind(update.max_participants)
        .bind(update.team_scoring_mode.map(|mode| mode.as_str()))
        .bind(update.team_scoring_n.is_some())
        .bind(update.team_scoring_n.flatten())
        .fetch_optional(&self.pool)
        .await
        .map_err(tournament_conflict)?
        .map(tournament)
        .transpose()
    }

    async fn set_tournament_status(
        &self,
        id: Uuid,
        status: TournamentStatus,
    ) -> Result<Option<Tournament>, StoreError> {
        sqlx::query_as::<_, TournamentRow>(&format!(
            "UPDATE tournaments SET status = $2, updated_at = now() WHERE id = $1 RETURNING {}",
            tournament_columns()
        ))
        .bind(id)
        .bind(status.as_str())
        .fetch_optional(&self.pool)
        .await?
        .map(tournament)
        .transpose()
    }

    async fn delete_tournament(&self, id: Uuid) -> Result<bool, StoreError> {
        let result = sqlx::query("DELETE FROM tournaments WHERE id = $1")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(result.rows_affected() > 0)
    }

    async fn list_scoring_rules(
        &self,
        tournament_id: Uuid,
    ) -> Result<Vec<ScoringRule>, StoreError> {
        sqlx::query_as::<_, ScoringRuleRow>(&format!(
            "SELECT {SCORING_RULE_COLUMNS} FROM scoring_rule r \
             WHERE tournament_id = $1 \
             ORDER BY (SELECT key FROM stats WHERE id = r.stat_id), id"
        ))
        .bind(tournament_id)
        .fetch_all(&self.pool)
        .await?
        .into_iter()
        .map(scoring_rule)
        .collect()
    }

    async fn find_scoring_rule(&self, id: Uuid) -> Result<Option<ScoringRule>, StoreError> {
        sqlx::query_as::<_, ScoringRuleRow>(&format!(
            "SELECT {SCORING_RULE_COLUMNS} FROM scoring_rule WHERE id = $1"
        ))
        .bind(id)
        .fetch_optional(&self.pool)
        .await?
        .map(scoring_rule)
        .transpose()
    }

    async fn create_scoring_rule(
        &self,
        input: ScoringRuleInput,
    ) -> Result<Option<ScoringRule>, StoreError> {
        // `game_id` vient du tournoi ; la liaison statistique / jeu est garantie par la clé
        // étrangère vers `stat_game`, qui rend aussi l'insertion impossible sinon.
        sqlx::query_as::<_, ScoringRuleRow>(&format!(
            "INSERT INTO scoring_rule (tournament_id, game_id, stat_id, mode, coefficient, points_table) \
             SELECT t.id, t.game_id, $2, $3, $4::float8::numeric, $5::jsonb \
             FROM tournaments t \
             WHERE t.id = $1 \
               AND EXISTS (SELECT 1 FROM stat_game sg WHERE sg.stat_id = $2 AND sg.game_id = t.game_id) \
             RETURNING {SCORING_RULE_COLUMNS}"
        ))
        .bind(input.tournament_id)
        .bind(input.stat_id)
        .bind(input.definition.mode.as_str())
        .bind(input.definition.coefficient)
        .bind(input.definition.points_table.map(|table| table.to_string()))
        .fetch_optional(&self.pool)
        .await
        .map_err(tournament_conflict)?
        .map(scoring_rule)
        .transpose()
    }

    async fn replace_scoring_rule(
        &self,
        id: Uuid,
        definition: ScoringRuleDefinition,
    ) -> Result<Option<ScoringRule>, StoreError> {
        sqlx::query_as::<_, ScoringRuleRow>(&format!(
            "UPDATE scoring_rule SET mode = $2, coefficient = $3::float8::numeric, \
                 points_table = $4::jsonb \
             WHERE id = $1 RETURNING {SCORING_RULE_COLUMNS}"
        ))
        .bind(id)
        .bind(definition.mode.as_str())
        .bind(definition.coefficient)
        .bind(definition.points_table.map(|table| table.to_string()))
        .fetch_optional(&self.pool)
        .await?
        .map(scoring_rule)
        .transpose()
    }

    async fn delete_scoring_rule(&self, id: Uuid) -> Result<bool, StoreError> {
        let result = sqlx::query("DELETE FROM scoring_rule WHERE id = $1")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(result.rows_affected() > 0)
    }

    async fn list_participants(
        &self,
        tournament_id: Uuid,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<TournamentParticipant>, StoreError> {
        sqlx::query_as::<_, ParticipantRow>(&format!(
            "SELECT {} FROM tournament_participant WHERE tournament_id = $1 \
             ORDER BY registered_at, id LIMIT $2 OFFSET $3",
            participant_columns()
        ))
        .bind(tournament_id)
        .bind(limit)
        .bind(offset)
        .fetch_all(&self.pool)
        .await?
        .into_iter()
        .map(participant)
        .collect()
    }

    async fn find_participant(
        &self,
        id: Uuid,
    ) -> Result<Option<TournamentParticipant>, StoreError> {
        sqlx::query_as::<_, ParticipantRow>(&format!(
            "SELECT {} FROM tournament_participant WHERE id = $1",
            participant_columns()
        ))
        .bind(id)
        .fetch_optional(&self.pool)
        .await?
        .map(participant)
        .transpose()
    }

    async fn add_participant(
        &self,
        input: ParticipantInput,
    ) -> Result<Option<TournamentParticipant>, StoreError> {
        let mut tx = self.pool.begin().await?;
        // Le verrou sur le tournoi sérialise les inscriptions : le plafond ne se dépasse pas.
        let Some(max) = sqlx::query_scalar::<_, i32>(
            "SELECT max_participants FROM tournaments WHERE id = $1 FOR UPDATE",
        )
        .bind(input.tournament_id)
        .fetch_optional(&mut *tx)
        .await?
        else {
            return Ok(None);
        };
        let active = sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM tournament_participant \
             WHERE tournament_id = $1 AND status <> 'withdrawn'",
        )
        .bind(input.tournament_id)
        .fetch_one(&mut *tx)
        .await?;
        if active >= i64::from(max) {
            return Err(StoreError::TournamentFull);
        }
        let row = sqlx::query_as::<_, ParticipantRow>(&format!(
            "INSERT INTO tournament_participant (tournament_id, user_id, tournament_team_id) \
             VALUES ($1, $2, $3) RETURNING {}",
            participant_columns()
        ))
        .bind(input.tournament_id)
        .bind(input.user_id)
        .bind(input.tournament_team_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(tournament_conflict)?;
        tx.commit().await?;
        participant(row).map(Some)
    }

    async fn set_participant_status(
        &self,
        id: Uuid,
        status: ParticipantStatus,
    ) -> Result<Option<TournamentParticipant>, StoreError> {
        sqlx::query_as::<_, ParticipantRow>(&format!(
            "UPDATE tournament_participant SET status = $2 WHERE id = $1 RETURNING {}",
            participant_columns()
        ))
        .bind(id)
        .bind(status.as_str())
        .fetch_optional(&self.pool)
        .await?
        .map(participant)
        .transpose()
    }

    async fn delete_participant(&self, id: Uuid) -> Result<bool, StoreError> {
        let result = sqlx::query("DELETE FROM tournament_participant WHERE id = $1")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(result.rows_affected() > 0)
    }

    async fn participant_points(
        &self,
        tournament_id: Uuid,
    ) -> Result<HashMap<Uuid, f64>, StoreError> {
        let rows = sqlx::query_as::<_, (Uuid, f64)>(
            "SELECT participant_id, sum(points)::float8 FROM step_participant \
             WHERE tournament_id = $1 GROUP BY participant_id",
        )
        .bind(tournament_id)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows.into_iter().collect())
    }

    async fn list_steps(&self, tournament_id: Uuid) -> Result<Vec<Step>, StoreError> {
        sqlx::query_as::<_, StepRow>(&format!(
            "SELECT {} FROM step WHERE tournament_id = $1 ORDER BY position",
            step_columns()
        ))
        .bind(tournament_id)
        .fetch_all(&self.pool)
        .await?
        .into_iter()
        .map(step)
        .collect()
    }

    async fn find_step(&self, id: Uuid) -> Result<Option<Step>, StoreError> {
        sqlx::query_as::<_, StepRow>(&format!(
            "SELECT {} FROM step WHERE id = $1",
            step_columns()
        ))
        .bind(id)
        .fetch_optional(&self.pool)
        .await?
        .map(step)
        .transpose()
    }

    async fn create_step(&self, input: StepInput) -> Result<Option<Step>, StoreError> {
        let definition = input.definition;
        sqlx::query_as::<_, StepRow>(&format!(
            "INSERT INTO step (tournament_id, position, format, match_type, group_count, \
                 group_size, matches_per_group, advance_per_group, tiebreak) \
             SELECT t.id, $2, $3, $4, $5, $6, $7, $8, $9::jsonb FROM tournaments t WHERE t.id = $1 \
             RETURNING {}",
            step_columns()
        ))
        .bind(input.tournament_id)
        .bind(definition.position)
        .bind(definition.format.as_str())
        .bind(definition.match_type.as_str())
        .bind(definition.group_count)
        .bind(definition.group_size)
        .bind(definition.matches_per_group)
        .bind(definition.advance_per_group)
        .bind(definition.tiebreak.to_string())
        .fetch_optional(&self.pool)
        .await
        .map_err(step_conflict)?
        .map(step)
        .transpose()
    }

    async fn replace_step(
        &self,
        id: Uuid,
        definition: StepDefinition,
    ) -> Result<Option<Step>, StoreError> {
        sqlx::query_as::<_, StepRow>(&format!(
            "UPDATE step SET position = $2, format = $3, match_type = $4, group_count = $5, \
                 group_size = $6, matches_per_group = $7, advance_per_group = $8, \
                 tiebreak = $9::jsonb, updated_at = now() \
             WHERE id = $1 RETURNING {}",
            step_columns()
        ))
        .bind(id)
        .bind(definition.position)
        .bind(definition.format.as_str())
        .bind(definition.match_type.as_str())
        .bind(definition.group_count)
        .bind(definition.group_size)
        .bind(definition.matches_per_group)
        .bind(definition.advance_per_group)
        .bind(definition.tiebreak.to_string())
        .fetch_optional(&self.pool)
        .await
        .map_err(step_conflict)?
        .map(step)
        .transpose()
    }

    async fn delete_step(&self, id: Uuid) -> Result<bool, StoreError> {
        let result = sqlx::query("DELETE FROM step WHERE id = $1")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(result.rows_affected() > 0)
    }

    async fn list_step_groups(&self, step_id: Uuid) -> Result<Vec<StepGroup>, StoreError> {
        Ok(sqlx::query_as::<_, (Uuid, Uuid, i32)>(
            "SELECT id, step_id, index FROM step_group WHERE step_id = $1 ORDER BY index",
        )
        .bind(step_id)
        .fetch_all(&self.pool)
        .await?
        .into_iter()
        .map(|row| StepGroup {
            id: row.0,
            step_id: row.1,
            index: row.2,
        })
        .collect())
    }

    async fn list_step_participants(
        &self,
        step_id: Uuid,
    ) -> Result<Vec<StepParticipant>, StoreError> {
        sqlx::query_as::<_, StepParticipantRow>(
            "SELECT p.step_id, p.participant_id, p.group_id, p.points::float8, p.final_rank, \
                 p.status \
             FROM step_participant p JOIN step_group g ON g.id = p.group_id \
             WHERE p.step_id = $1 ORDER BY g.index, p.participant_id",
        )
        .bind(step_id)
        .fetch_all(&self.pool)
        .await?
        .into_iter()
        .map(step_participant)
        .collect()
    }

    async fn start_step(&self, start: StepStart) -> Result<Option<Step>, StoreError> {
        let mut tx = self.pool.begin().await?;
        let started = start_step_in(&mut tx, start).await?;
        tx.commit().await?;
        Ok(started)
    }

    async fn close_step(&self, closing: StepClosing) -> Result<Option<Step>, StoreError> {
        let mut tx = self.pool.begin().await?;
        let updated = sqlx::query_as::<_, StepRow>(&format!(
            "UPDATE step SET status = 'finished', updated_at = now() \
             WHERE id = $1 AND status = 'ongoing' RETURNING {}",
            step_columns()
        ))
        .bind(closing.step_id)
        .fetch_optional(&mut *tx)
        .await?;
        let Some(updated) = updated else {
            let exists =
                sqlx::query_scalar::<_, bool>("SELECT EXISTS (SELECT 1 FROM step WHERE id = $1)")
                    .bind(closing.step_id)
                    .fetch_one(&mut *tx)
                    .await?;
            return if exists {
                Err(StoreError::StepState)
            } else {
                Ok(None)
            };
        };
        for outcome in &closing.outcomes {
            sqlx::query(
                "UPDATE step_participant SET final_rank = $3, status = $4 \
                 WHERE step_id = $1 AND participant_id = $2",
            )
            .bind(closing.step_id)
            .bind(outcome.participant_id)
            .bind(outcome.final_rank)
            .bind(outcome.status.as_str())
            .execute(&mut *tx)
            .await?;
        }
        if let Some(next) = closing.next {
            start_step_in(&mut tx, next).await?;
        }
        tx.commit().await?;
        Ok(Some(step(updated)?))
    }

    async fn set_step_points(
        &self,
        step_id: Uuid,
        participant_id: Uuid,
        points: f64,
    ) -> Result<bool, StoreError> {
        let result = sqlx::query(
            "UPDATE step_participant SET points = $3::float8::numeric \
             WHERE step_id = $1 AND participant_id = $2",
        )
        .bind(step_id)
        .bind(participant_id)
        .bind(points)
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() > 0)
    }

    async fn list_matches(
        &self,
        step_id: Uuid,
        group_id: Option<Uuid>,
        status: Option<MatchStatus>,
    ) -> Result<Vec<Match>, StoreError> {
        sqlx::query_as::<_, MatchRow>(&format!(
            "SELECT {} FROM match \
             WHERE step_id = $1 AND ($2::uuid IS NULL OR group_id = $2) \
                 AND ($3::text IS NULL OR status = $3) \
             ORDER BY (SELECT index FROM step_group WHERE id = match.group_id), round, \
                 created_at, id",
            match_columns()
        ))
        .bind(step_id)
        .bind(group_id)
        .bind(status.map(|s| s.as_str()))
        .fetch_all(&self.pool)
        .await?
        .into_iter()
        .map(match_from)
        .collect()
    }

    async fn find_match(&self, id: Uuid) -> Result<Option<Match>, StoreError> {
        sqlx::query_as::<_, MatchRow>(&format!(
            "SELECT {} FROM match WHERE id = $1",
            match_columns()
        ))
        .bind(id)
        .fetch_optional(&self.pool)
        .await?
        .map(match_from)
        .transpose()
    }

    async fn list_step_match_participants(
        &self,
        step_id: Uuid,
    ) -> Result<Vec<MatchParticipant>, StoreError> {
        sqlx::query_as::<_, MatchParticipantRow>(&format!(
            "SELECT {MATCH_PARTICIPANT_COLUMNS} FROM match_participant \
             WHERE match_id IN (SELECT id FROM match WHERE step_id = $1) \
             ORDER BY match_id, participant_id"
        ))
        .bind(step_id)
        .fetch_all(&self.pool)
        .await?
        .into_iter()
        .map(match_participant)
        .collect()
    }

    async fn create_match(&self, input: MatchInput) -> Result<Match, StoreError> {
        let mut tx = self.pool.begin().await?;
        let row = sqlx::query_as::<_, MatchRow>(&format!(
            "INSERT INTO match (game_id, step_id, group_id, round, bracket, next_match_id, \
                 scheduled_at) \
             VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz) RETURNING {}",
            match_columns()
        ))
        .bind(input.game_id)
        .bind(input.step_id)
        .bind(input.group_id)
        .bind(input.round)
        .bind(input.bracket.map(|b| b.as_str()))
        .bind(input.next_match_id)
        .bind(input.scheduled_at)
        .fetch_one(&mut *tx)
        .await?;
        let created = match_from(row)?;
        for participant_id in &input.participants {
            insert_match_participant(&mut tx, created.id, *participant_id).await?;
        }
        tx.commit().await?;
        Ok(created)
    }

    async fn update_match(
        &self,
        id: Uuid,
        update: MatchUpdate,
    ) -> Result<Option<Match>, StoreError> {
        let mut tx = self.pool.begin().await?;
        let row = sqlx::query_as::<_, MatchRow>(&format!(
            "UPDATE match SET \
                 round = CASE WHEN $2 THEN $3 ELSE round END, \
                 bracket = CASE WHEN $4 THEN $5 ELSE bracket END, \
                 next_match_id = CASE WHEN $6 THEN $7 ELSE next_match_id END, \
                 scheduled_at = CASE WHEN $8 THEN $9::timestamptz ELSE scheduled_at END, \
                 updated_at = now() \
             WHERE id = $1 RETURNING {}",
            match_columns()
        ))
        .bind(id)
        .bind(update.round.is_some())
        .bind(update.round.flatten())
        .bind(update.bracket.is_some())
        .bind(update.bracket.flatten().map(|b| b.as_str()))
        .bind(update.next_match_id.is_some())
        .bind(update.next_match_id.flatten())
        .bind(update.scheduled_at.is_some())
        .bind(update.scheduled_at.flatten())
        .fetch_optional(&mut *tx)
        .await?;
        let Some(row) = row else {
            return Ok(None);
        };
        if let Some(participants) = &update.participants {
            set_match_participants_in(&mut tx, id, participants).await?;
        }
        tx.commit().await?;
        Ok(Some(match_from(row)?))
    }

    async fn set_match_status(
        &self,
        id: Uuid,
        status: MatchStatus,
    ) -> Result<Option<Match>, StoreError> {
        let mut tx = self.pool.begin().await?;
        if lock_open_match(&mut tx, id).await?.is_none() {
            return Ok(None);
        }
        let sql = match status {
            MatchStatus::Ongoing => {
                "UPDATE match SET status = 'ongoing', started_at = COALESCE(started_at, now()), \
                     updated_at = now() WHERE id = $1 RETURNING "
            }
            MatchStatus::Cancelled => {
                "UPDATE match SET status = 'cancelled', ended_at = now(), updated_at = now() \
                 WHERE id = $1 RETURNING "
            }
            _ => return Err(StoreError::MatchState),
        };
        let row = sqlx::query_as::<_, MatchRow>(&format!("{sql}{}", match_columns()))
            .bind(id)
            .fetch_one(&mut *tx)
            .await?;
        tx.commit().await?;
        Ok(Some(match_from(row)?))
    }

    async fn delete_match(&self, id: Uuid) -> Result<bool, StoreError> {
        let result = sqlx::query("DELETE FROM match WHERE id = $1")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(result.rows_affected() > 0)
    }

    async fn save_match_scores(
        &self,
        match_id: Uuid,
        scores: Vec<MatchScore>,
    ) -> Result<bool, StoreError> {
        let mut tx = self.pool.begin().await?;
        if lock_open_match(&mut tx, match_id).await?.is_none() {
            return Ok(false);
        }
        save_match_scores_in(&mut tx, match_id, scores).await?;
        tx.commit().await?;
        Ok(true)
    }

    async fn finish_match(&self, finish: MatchFinish) -> Result<Option<Match>, StoreError> {
        let mut tx = self.pool.begin().await?;
        let Some(step_id) = lock_open_match(&mut tx, finish.match_id).await? else {
            return Ok(None);
        };
        save_match_scores_in(&mut tx, finish.match_id, finish.scores).await?;
        if let Some((next_id, participant_id)) = finish.advance {
            insert_match_participant(&mut tx, next_id, participant_id).await?;
        }
        for (participant_id, points) in finish.step_points {
            sqlx::query(
                "UPDATE step_participant SET points = $3::float8::numeric \
                 WHERE step_id = $1 AND participant_id = $2",
            )
            .bind(step_id)
            .bind(participant_id)
            .bind(points)
            .execute(&mut *tx)
            .await?;
        }
        let row = sqlx::query_as::<_, MatchRow>(&format!(
            "UPDATE match SET status = 'finished', started_at = COALESCE(started_at, now()), \
                 ended_at = now(), updated_at = now() WHERE id = $1 RETURNING {}",
            match_columns()
        ))
        .bind(finish.match_id)
        .fetch_one(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(Some(match_from(row)?))
    }

    async fn replace_step_matches(
        &self,
        step_id: Uuid,
        game_id: Uuid,
        matches: Vec<MatchImport>,
    ) -> Result<bool, StoreError> {
        let mut tx = self.pool.begin().await?;
        let exists =
            sqlx::query_scalar::<_, bool>("SELECT EXISTS (SELECT 1 FROM step WHERE id = $1)")
                .bind(step_id)
                .fetch_one(&mut *tx)
                .await?;
        if !exists {
            return Ok(false);
        }
        sqlx::query("DELETE FROM match WHERE step_id = $1")
            .bind(step_id)
            .execute(&mut *tx)
            .await?;
        let mut ids = Vec::with_capacity(matches.len());
        for import in &matches {
            let id = sqlx::query_scalar::<_, Uuid>(
                "INSERT INTO match (game_id, step_id, group_id, round, bracket, scheduled_at, \
                     started_at, ended_at, status) \
                 VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7::timestamptz, \
                     $8::timestamptz, $9) RETURNING id",
            )
            .bind(game_id)
            .bind(step_id)
            .bind(import.group_id)
            .bind(import.round)
            .bind(import.bracket.map(|b| b.as_str()))
            .bind(&import.scheduled_at)
            .bind(&import.started_at)
            .bind(&import.ended_at)
            .bind(import.status.as_str())
            .fetch_one(&mut *tx)
            .await?;
            ids.push(id);
        }
        for (import, id) in matches.into_iter().zip(&ids) {
            if let Some(next) = import.next.and_then(|next| ids.get(next)) {
                sqlx::query("UPDATE match SET next_match_id = $2 WHERE id = $1")
                    .bind(id)
                    .bind(next)
                    .execute(&mut *tx)
                    .await?;
            }
            for score in import.participants {
                insert_match_participant(&mut tx, *id, score.participant_id).await?;
                save_match_scores_in(&mut tx, *id, vec![score]).await?;
            }
        }
        tx.commit().await?;
        Ok(true)
    }

    async fn import_tournaments(
        &self,
        tournaments: Vec<TournamentImport>,
    ) -> Result<Vec<(Tournament, bool)>, StoreError> {
        let mut tx = self.pool.begin().await?;
        let mut result = Vec::with_capacity(tournaments.len());
        for import in tournaments {
            let TournamentImport {
                input,
                status,
                rules,
            } = import;
            // `xmax = 0` distingue une ligne insérée d'une ligne mise à jour.
            let (id, created) = sqlx::query_as::<_, (Uuid, bool)>(
                "INSERT INTO tournaments (game_id, name, description, start_date, end_date, \
                     registration_open_at, registration_close_at, participant_type, team_size, \
                     max_participants, team_scoring_mode, team_scoring_n, status) \
                 VALUES ($1, $2, $3, $4::timestamptz, $5::timestamptz, $6::timestamptz, \
                     $7::timestamptz, $8, $9, $10, $11, $12, $13) \
                 ON CONFLICT (game_id, lower(name)) DO UPDATE SET \
                     name = EXCLUDED.name, description = EXCLUDED.description, \
                     start_date = EXCLUDED.start_date, end_date = EXCLUDED.end_date, \
                     registration_open_at = EXCLUDED.registration_open_at, \
                     registration_close_at = EXCLUDED.registration_close_at, \
                     participant_type = EXCLUDED.participant_type, team_size = EXCLUDED.team_size, \
                     max_participants = EXCLUDED.max_participants, \
                     team_scoring_mode = EXCLUDED.team_scoring_mode, \
                     team_scoring_n = EXCLUDED.team_scoring_n, status = EXCLUDED.status, \
                     updated_at = now() \
                 RETURNING id, (xmax = 0)",
            )
            .bind(input.game_id)
            .bind(input.name)
            .bind(input.description)
            .bind(input.start_date)
            .bind(input.end_date)
            .bind(input.registration_open_at)
            .bind(input.registration_close_at)
            .bind(input.participant_type.as_str())
            .bind(input.team_size)
            .bind(input.max_participants)
            .bind(input.team_scoring_mode.as_str())
            .bind(input.team_scoring_n)
            .bind(status.as_str())
            .fetch_one(&mut *tx)
            .await?;
            sqlx::query("DELETE FROM scoring_rule WHERE tournament_id = $1")
                .bind(id)
                .execute(&mut *tx)
                .await?;
            for rule in rules {
                sqlx::query(
                    "INSERT INTO scoring_rule (tournament_id, game_id, stat_id, mode, coefficient, points_table) \
                     VALUES ($1, $2, $3, $4, $5::float8::numeric, $6::jsonb)",
                )
                .bind(id)
                .bind(input.game_id)
                .bind(rule.stat_id)
                .bind(rule.definition.mode.as_str())
                .bind(rule.definition.coefficient)
                .bind(rule.definition.points_table.map(|table| table.to_string()))
                .execute(&mut *tx)
                .await?;
            }
            let row = sqlx::query_as::<_, TournamentRow>(&format!(
                "SELECT {} FROM tournaments WHERE id = $1",
                tournament_columns()
            ))
            .bind(id)
            .fetch_one(&mut *tx)
            .await?;
            result.push((tournament(row)?, created));
        }
        tx.commit().await?;
        Ok(result)
    }

    async fn replace_participants(
        &self,
        tournament_id: Uuid,
        participants: Vec<ParticipantImport>,
    ) -> Result<(), StoreError> {
        let mut tx = self.pool.begin().await?;
        sqlx::query("DELETE FROM tournament_participant WHERE tournament_id = $1")
            .bind(tournament_id)
            .execute(&mut *tx)
            .await?;
        for participant in participants {
            sqlx::query(
                "INSERT INTO tournament_participant \
                     (tournament_id, user_id, tournament_team_id, status, registered_at) \
                 VALUES ($1, $2, $3, $4, COALESCE($5::timestamptz, now()))",
            )
            .bind(tournament_id)
            .bind(participant.user_id)
            .bind(participant.tournament_team_id)
            .bind(participant.status.as_str())
            .bind(participant.registered_at)
            .execute(&mut *tx)
            .await?;
        }
        tx.commit().await?;
        Ok(())
    }
}
