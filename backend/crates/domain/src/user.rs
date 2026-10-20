//! Règles de validation des comptes utilisateurs.

use std::fmt;

/// Longueur du nom d'utilisateur, bornée par la colonne `users.username` (VARCHAR(32)).
pub const USERNAME_MIN_LEN: usize = 3;
pub const USERNAME_MAX_LEN: usize = 32;
/// Longueur du mot de passe, en caractères. La borne haute limite le coût du hachage.
pub const PASSWORD_MIN_LEN: usize = 8;
pub const PASSWORD_MAX_LEN: usize = 128;

/// Rôle d'un utilisateur, aligné sur le type PostgreSQL `role_name`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Role {
    Admin,
    User,
    Watcher,
}

impl Role {
    pub fn as_str(self) -> &'static str {
        match self {
            Role::Admin => "admin",
            Role::User => "user",
            Role::Watcher => "watcher",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "admin" => Some(Role::Admin),
            "user" => Some(Role::User),
            "watcher" => Some(Role::Watcher),
            _ => None,
        }
    }
}

/// Erreur de validation, avec un message destiné au client.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidationError(pub String);

impl fmt::Display for ValidationError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for ValidationError {}

/// Nom d'utilisateur : 3 à 32 caractères ASCII parmi lettres, chiffres, `_`, `-` et `.`.
pub fn validate_username(username: &str) -> Result<(), ValidationError> {
    let len = username.chars().count();
    if !(USERNAME_MIN_LEN..=USERNAME_MAX_LEN).contains(&len) {
        return Err(ValidationError(format!(
            "le nom d'utilisateur doit faire entre {USERNAME_MIN_LEN} et {USERNAME_MAX_LEN} caractères"
        )));
    }
    if !username
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.'))
    {
        return Err(ValidationError(
            "le nom d'utilisateur ne peut contenir que des lettres, des chiffres, '_', '-' et '.'"
                .into(),
        ));
    }
    Ok(())
}

pub fn validate_password(password: &str) -> Result<(), ValidationError> {
    let len = password.chars().count();
    if !(PASSWORD_MIN_LEN..=PASSWORD_MAX_LEN).contains(&len) {
        return Err(ValidationError(format!(
            "le mot de passe doit faire entre {PASSWORD_MIN_LEN} et {PASSWORD_MAX_LEN} caractères"
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn username_accepts_valid_names() {
        for name in ["abc", "Player_1", "jean-luc.p", &"a".repeat(32)] {
            assert_eq!(validate_username(name), Ok(()), "{name}");
        }
    }

    #[test]
    fn username_rejects_bad_length() {
        assert!(validate_username("ab").is_err());
        assert!(validate_username(&"a".repeat(33)).is_err());
    }

    #[test]
    fn username_rejects_bad_characters() {
        for name in ["with space", "émile", "a/b", "semi;colon"] {
            assert!(validate_username(name).is_err(), "{name}");
        }
    }

    #[test]
    fn password_length_bounds() {
        assert!(validate_password("1234567").is_err());
        assert_eq!(validate_password("12345678"), Ok(()));
        assert_eq!(validate_password(&"x".repeat(128)), Ok(()));
        assert!(validate_password(&"x".repeat(129)).is_err());
    }

    #[test]
    fn role_round_trips() {
        for role in [Role::Admin, Role::User, Role::Watcher] {
            assert_eq!(Role::parse(role.as_str()), Some(role));
        }
        assert_eq!(Role::parse("root"), None);
    }
}
