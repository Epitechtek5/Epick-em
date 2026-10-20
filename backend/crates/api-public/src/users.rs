//! Endpoints des utilisateurs : inscription, lecture, modification, suppression.

use crate::auth::CurrentUser;
use crate::error::ApiError;
use crate::password;
use actix_web::{HttpResponse, delete, get, patch, post, web};
use domain::user::{Role, validate_password, validate_username};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;

const DEFAULT_PAGE_SIZE: i64 = 50;
const MAX_PAGE_SIZE: i64 = 100;

/// Représentation publique d'un utilisateur : le hash du mot de passe n'en sort jamais.
#[derive(Debug, Serialize, sqlx::FromRow)]
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
    pool: web::Data<PgPool>,
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
    .fetch_one(pool.get_ref())
    .await?;

    Ok(HttpResponse::Created().json(user))
}

#[get("/users")]
async fn list_users(
    _: CurrentUser,
    pool: web::Data<PgPool>,
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
    .fetch_all(pool.get_ref())
    .await?;

    Ok(HttpResponse::Ok().json(users))
}

#[get("/user/{id}")]
async fn get_user(
    _: CurrentUser,
    pool: web::Data<PgPool>,
    id: web::Path<i64>,
) -> Result<HttpResponse, ApiError> {
    let user: Option<UserResponse> = sqlx::query_as(
        "SELECT u.id, u.username, r.name::text AS role
         FROM users u JOIN roles r ON r.id = u.role_id
         WHERE u.id = $1",
    )
    .bind(id.into_inner())
    .fetch_optional(pool.get_ref())
    .await?;

    user.map(|user| HttpResponse::Ok().json(user))
        .ok_or(ApiError::NotFound)
}

#[patch("/user/{id}/update")]
async fn update_user(
    current: CurrentUser,
    pool: web::Data<PgPool>,
    id: web::Path<i64>,
    body: web::Json<UpdateUserRequest>,
) -> Result<HttpResponse, ApiError> {
    current.require_admin()?;
    let user = update(&pool, id.into_inner(), body.into_inner()).await?;
    Ok(HttpResponse::Ok().json(user))
}

#[delete("/user/{id}/delete")]
async fn delete_user(
    current: CurrentUser,
    pool: web::Data<PgPool>,
    id: web::Path<i64>,
) -> Result<HttpResponse, ApiError> {
    current.require_admin()?;
    delete(&pool, id.into_inner()).await?;
    Ok(HttpResponse::NoContent().finish())
}

#[patch("/me/update")]
async fn update_me(
    current: CurrentUser,
    pool: web::Data<PgPool>,
    body: web::Json<UpdateUserRequest>,
) -> Result<HttpResponse, ApiError> {
    // Un utilisateur ne peut pas changer son propre rôle, administrateur compris :
    // cela passe par /user/{id}/update.
    if body.role.is_some() {
        return Err(ApiError::Forbidden);
    }
    let user = update(&pool, current.id, body.into_inner()).await?;
    Ok(HttpResponse::Ok().json(user))
}

#[delete("/me/delete")]
async fn delete_me(
    current: CurrentUser,
    pool: web::Data<PgPool>,
) -> Result<HttpResponse, ApiError> {
    delete(&pool, current.id).await?;
    Ok(HttpResponse::NoContent().finish())
}

/// Applique une mise à jour partielle : seuls les champs fournis sont modifiés.
async fn update(
    pool: &PgPool,
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

    let user: Option<UserResponse> = sqlx::query_as(
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
    .fetch_optional(pool)
    .await?;

    user.ok_or(ApiError::NotFound)
}

async fn delete(pool: &PgPool, id: i64) -> Result<(), ApiError> {
    let result = sqlx::query("DELETE FROM users WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await?;
    if result.rows_affected() == 0 {
        return Err(ApiError::NotFound);
    }
    Ok(())
}
