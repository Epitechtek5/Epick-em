//! Hachage des mots de passe en argon2id, stocké au format PHC (`$argon2id$…`).

use crate::error::ApiError;
use actix_web::web;
use argon2::Argon2;
use argon2::password_hash::{PasswordHasher, SaltString, rand_core::OsRng};

/// Le hachage est volontairement coûteux : il tourne sur le pool de threads bloquants
/// pour ne pas monopoliser un worker HTTP.
pub async fn hash(password: String) -> Result<String, ApiError> {
    web::block(move || {
        let salt = SaltString::generate(&mut OsRng);
        Argon2::default()
            .hash_password(password.as_bytes(), &salt)
            .map(|hash| hash.to_string())
    })
    .await
    .map_err(|_| ApiError::Internal)?
    .map_err(|err| {
        eprintln!("échec du hachage du mot de passe : {err}");
        ApiError::Internal
    })
}
