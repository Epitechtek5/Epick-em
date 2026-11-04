use crate::auth::{AppState, PASSWORD_MAX, hash_token, new_token, verify_password};
use crate::error::ApiError;
use crate::password_reset::{email_error, normalize_email};
use actix_web::{HttpResponse, post, web};
use serde::Deserialize;
use utoipa::ToSchema;
use utoipa_actix_web::service_config::ServiceConfig;

pub fn routes(cfg: &mut ServiceConfig) {
    cfg.service(verify_email).service(resend).service(enroll);
}

#[derive(Deserialize, ToSchema)]
struct Address {
    email: String,
}
#[derive(Deserialize, ToSchema)]
struct Verification {
    token: String,
}
#[derive(Deserialize, ToSchema)]
struct Enrollment {
    username: String,
    password: String,
    email: String,
}

pub async fn within_peer_limit(
    state: &AppState,
    request: &actix_web::HttpRequest,
) -> Result<bool, ApiError> {
    let Some(peer) = request.peer_addr() else {
        return Ok(true);
    };
    state
        .store
        .allow_verification_request(&hash_token(&peer.ip().to_string()))
        .await
        .map_err(ApiError::internal)
}

fn address(input: &str) -> Result<String, ApiError> {
    let email = normalize_email(input);
    if let Some(msg) = email_error(&email) {
        return Err(ApiError::Validation(vec![("email", msg)]));
    }
    Ok(email)
}

pub async fn dispatch(state: &AppState, email: String) -> Result<(), ApiError> {
    if !state.mailer.available() {
        return Ok(());
    }
    let token = new_token();
    let issued = state
        .store
        .issue_verification(&email, &hash_token(&token))
        .await
        .map_err(ApiError::internal)?;
    if issued {
        send(state, email, token, None)
    }
    Ok(())
}

pub fn send(state: &AppState, email: String, token: String, welcome: Option<String>) {
    if !state.mailer.available() {
        return;
    }
    let mailer = state.mailer.clone();
    let store = state.store.clone();
    let link = format!("{}/verify-email?token={token}", state.public_url.trim_end_matches('/'));
    actix_web::rt::spawn(async move {
        if mailer
            .send_verification(&email, &link)
            .await
            .is_err()
        {
            eprintln!("api-public: verification email delivery failed");
        } else if welcome.is_none()
            && store
                .activate_verification(&hash_token(&token))
                .await
                .is_err()
        {
            eprintln!("api-public: could not activate replacement verification link");
        }
        if let Some(username) = welcome
            && mailer.send_welcome(&email, &username).await.is_err()
        {
            eprintln!("api-public: welcome email delivery failed");
        }
    });
}

#[utoipa::path(post,path="/verify-email",tag="auth",request_body=Verification,responses((status=204,description="Email confirmed"),(status=400,description="Invalid or expired link")))]
#[post("/verify-email")]
async fn verify_email(
    state: web::Data<AppState>,
    request: web::Json<Verification>,
) -> Result<HttpResponse, ApiError> {
    if request.token.len() == 64
        && state
            .store
            .consume_verification(&hash_token(&request.token))
            .await
            .map_err(ApiError::internal)?
    {
        return Ok(HttpResponse::NoContent().finish());
    }
    Err(ApiError::Validation(vec![(
        "token",
        "Invalid or expired verification link".into(),
    )]))
}

#[utoipa::path(post,path="/resend-verification-email",tag="auth",request_body=Address,responses((status=204,description="Request received")))]
#[post("/resend-verification-email")]
async fn resend(
    state: web::Data<AppState>,
    http: actix_web::HttpRequest,
    request: web::Json<Address>,
) -> Result<HttpResponse, ApiError> {
    let email = address(&request.email)?;
    if within_peer_limit(&state, &http).await? {
        dispatch(&state, email).await?;
    }
    Ok(HttpResponse::NoContent().finish())
}

#[utoipa::path(post,path="/enroll-email",tag="auth",request_body=Enrollment,responses((status=204,description="Enrollment requested"),(status=401,description="Credentials rejected")))]
#[post("/enroll-email")]
async fn enroll(
    state: web::Data<AppState>,
    http: actix_web::HttpRequest,
    request: web::Json<Enrollment>,
) -> Result<HttpResponse, ApiError> {
    let email = address(&request.email)?;
    if !within_peer_limit(&state, &http).await? {
        return Err(ApiError::VerificationLimited);
    }
    if request.password.chars().count() > PASSWORD_MAX {
        return Err(ApiError::Unauthorized);
    }
    let user = state
        .store
        .find_user_by_username(&request.username)
        .await
        .map_err(ApiError::internal)?;
    let hash = user
        .as_ref()
        .map_or_else(|| state.dummy_hash.to_string(), |u| u.password_hash.clone());
    let password = request.into_inner().password;
    let valid = web::block(move || verify_password(&password, &hash))
        .await
        .map_err(ApiError::internal)?;
    let user = user
        .filter(|u| valid && u.email.is_none())
        .ok_or(ApiError::Unauthorized)?;
    if state
        .store
        .enroll_legacy(user.id, &user.password_hash, &email)
        .await
        .map_err(|err| match err {
            crate::store::StoreError::EmailTaken => ApiError::EmailTaken,
            other => ApiError::internal(other),
        })?
    {
        dispatch(&state, email).await?;
    } else {
        return Err(ApiError::Unauthorized);
    }
    Ok(HttpResponse::NoContent().finish())
}
