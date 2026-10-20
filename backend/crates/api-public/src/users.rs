//! Endpoints des utilisateurs : inscription, lecture, modification, suppression.

use crate::auth::CurrentUser;
use crate::error::ApiError;
use crate::password;
use actix_web::{HttpResponse, delete, get, patch, post, web};
use domain::user::{Role, validate_password, validate_username};
use infra::{CachedDb, Ttl};
use serde::{Deserialize, Serialize};

const DEFAULT_PAGE_SIZE: i64 = 50;
const MAX_PAGE_SIZE: i64 = 100;

/// Durée de vie d'un utilisateur en cache. Les modifications et suppressions invalident
/// l'entrée ; le TTL ne borne que la durée d'une valeur périmée si l'invalidation échoue.
pub(crate) const USER_TTL: Ttl = Ttl::from_mins(5);

/// Clé de cache d'un utilisateur, partagée avec l'authentification ([`crate::auth`]).
pub(crate) fn user_key(id: i64) -> String {
    format!("user:{id}")
}

const SELECT_USER: &str = "SELECT u.id, u.username, r.name::text AS role
     FROM users u JOIN roles r ON r.id = u.role_id
     WHERE u.id = $1";

/// Représentation publique d'un utilisateur : le hash du mot de passe n'en sort jamais.
#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct UserResponse {
    pub id: i64,
    pub username: String,
    pub role: String,
}

#[derive(Deserialize)]
pub struct RegisterRequest {
    username: String,
    password: String,
}

/// Champs modifiables, tous facultatifs. `role` est réservé aux administrateurs.
#[derive(Deserialize)]
pub struct UpdateUserRequest {
    username: Option<String>,
    password: Option<String>,
    role: Option<String>,
}

#[derive(Deserialize)]
pub struct Pagination {
    limit: Option<i64>,
    offset: Option<i64>,
}

pub fn configure(cfg: &mut web::ServiceConfig) {
    cfg.service(register)
        .service(list_users)
        .service(get_user)
        .service(update_user)
        .service(delete_user)
        .service(update_me)
        .service(delete_me);
}

#[post("/register")]
async fn register(
    db: web::Data<CachedDb>,
    body: web::Json<RegisterRequest>,
) -> Result<HttpResponse, ApiError> {
    let RegisterRequest { username, password } = body.into_inner();
    validate_username(&username)?;
    validate_password(&password)?;
    let password_hash = password::hash(password).await?;

    let user: UserResponse = sqlx::query_as(
        "WITH inserted AS (
             INSERT INTO users (username, password_hash, role_id)
             SELECT $1, $2, id FROM roles WHERE name = $3::role_name
             RETURNING id, username, role_id
         )
         SELECT i.id, i.username, r.name::text AS role
         FROM inserted i JOIN roles r ON r.id = i.role_id",
    )
    .bind(username)
    .bind(password_hash)
    .bind(Role::User.as_str())
    .fetch_one(db.pool())
    .await?;

    Ok(HttpResponse::Created().json(user))
}

#[get("/users")]
async fn list_users(
    _: CurrentUser,
    db: web::Data<CachedDb>,
    page: web::Query<Pagination>,
) -> Result<HttpResponse, ApiError> {
    let limit = page
        .limit
        .unwrap_or(DEFAULT_PAGE_SIZE)
        .clamp(1, MAX_PAGE_SIZE);
    let offset = page.offset.unwrap_or(0).max(0);

    let users: Vec<UserResponse> = sqlx::query_as(
        "SELECT u.id, u.username, r.name::text AS role
         FROM users u JOIN roles r ON r.id = u.role_id
         ORDER BY u.id
         LIMIT $1 OFFSET $2",
    )
    .bind(limit)
    .bind(offset)
    .fetch_all(db.pool())
    .await?;

    Ok(HttpResponse::Ok().json(users))
}

#[get("/user/{id}")]
async fn get_user(
    _: CurrentUser,
    db: web::Data<CachedDb>,
    id: web::Path<i64>,
) -> Result<HttpResponse, ApiError> {
    let user = find(&db, id.into_inner()).await?;

    user.map(|user| HttpResponse::Ok().json(user))
        .ok_or(ApiError::NotFound)
}

#[patch("/user/{id}/update")]
async fn update_user(
    current: CurrentUser,
    db: web::Data<CachedDb>,
    id: web::Path<i64>,
    body: web::Json<UpdateUserRequest>,
) -> Result<HttpResponse, ApiError> {
    current.require_admin()?;
    let user = update(&db, id.into_inner(), body.into_inner()).await?;
    Ok(HttpResponse::Ok().json(user))
}

#[delete("/user/{id}/delete")]
async fn delete_user(
    current: CurrentUser,
    db: web::Data<CachedDb>,
    id: web::Path<i64>,
) -> Result<HttpResponse, ApiError> {
    current.require_admin()?;
    delete(&db, id.into_inner()).await?;
    Ok(HttpResponse::NoContent().finish())
}

#[patch("/me/update")]
async fn update_me(
    current: CurrentUser,
    db: web::Data<CachedDb>,
    body: web::Json<UpdateUserRequest>,
) -> Result<HttpResponse, ApiError> {
    // Un utilisateur ne peut pas changer son propre rôle, administrateur compris :
    // cela passe par /user/{id}/update.
    if body.role.is_some() {
        return Err(ApiError::Forbidden);
    }
    let user = update(&db, current.id, body.into_inner()).await?;
    Ok(HttpResponse::Ok().json(user))
}

#[delete("/me/delete")]
async fn delete_me(
    current: CurrentUser,
    db: web::Data<CachedDb>,
) -> Result<HttpResponse, ApiError> {
    delete(&db, current.id).await?;
    Ok(HttpResponse::NoContent().finish())
}

/// Lit un utilisateur, depuis le cache si possible.
pub(crate) async fn find(db: &CachedDb, id: i64) -> Result<Option<UserResponse>, sqlx::Error> {
    db.read_optional(&user_key(id), USER_TTL, |pool| async move {
        sqlx::query_as(SELECT_USER)
            .bind(id)
            .fetch_optional(&pool)
            .await
    })
    .await
}

/// Applique une mise à jour partielle : seuls les champs fournis sont modifiés.
async fn update(
    db: &CachedDb,
    id: i64,
    request: UpdateUserRequest,
) -> Result<UserResponse, ApiError> {
    let UpdateUserRequest {
        username,
        password,
        role,
    } = request;
    if username.is_none() && password.is_none() && role.is_none() {
        return Err(ApiError::BadRequest("aucun champ à modifier".into()));
    }
    if let Some(username) = &username {
        validate_username(username)?;
    }
    let role = role
        .map(|role| {
            Role::parse(&role).ok_or_else(|| ApiError::BadRequest(format!("rôle inconnu : {role}")))
        })
        .transpose()?;
    let password_hash = match password {
        Some(password) => {
            validate_password(&password)?;
            Some(password::hash(password).await?)
        }
        None => None,
    };

    // L'entrée en cache est invalidée plutôt que réécrite : la prochaine lecture la
    // recharge, et un utilisateur introuvable n'est jamais mis en cache.
    let user: Option<UserResponse> = db
        .delete(&[&user_key(id)], |pool| async move {
            sqlx::query_as(
                "WITH updated AS (
                     UPDATE users SET
                         username = COALESCE($2, username),
                         password_hash = COALESCE($3, password_hash),
                         role_id = COALESCE((SELECT id FROM roles WHERE name = $4::role_name), role_id)
                     WHERE id = $1
                     RETURNING id, username, role_id
                 )
                 SELECT u.id, u.username, r.name::text AS role
                 FROM updated u JOIN roles r ON r.id = u.role_id",
            )
            .bind(id)
            .bind(username)
            .bind(password_hash)
            .bind(role.map(Role::as_str))
            .fetch_optional(&pool)
            .await
        })
        .await?;

    user.ok_or(ApiError::NotFound)
}

async fn delete(db: &CachedDb, id: i64) -> Result<(), ApiError> {
    let result = db
        .delete(&[&user_key(id)], |pool| async move {
            sqlx::query("DELETE FROM users WHERE id = $1")
                .bind(id)
                .execute(&pool)
                .await
        })
        .await?;
    if result.rows_affected() == 0 {
        return Err(ApiError::NotFound);
    }
    Ok(())
}
