//! Codes TOTP (RFC 6238 : HMAC-SHA1, 6 chiffres, pas de 30 s), chiffrement des secrets et codes
//! de récupération.
//!
//! - le secret (160 bits) n'est stocké que chiffré en AES-256-GCM avec `TOTP_ENCRYPTION_KEY` ;
//!   l'identifiant du compte sert de donnée associée : un secret copié sur un autre compte ne se
//!   déchiffre pas ;
//! - un code est accepté pour le pas courant et ses deux voisins (décalage d'horloge) ; le pas
//!   accepté est mémorisé pour refuser le rejeu ;
//! - les codes de récupération (60 bits d'aléa chacun) ne sont stockés que hachés (SHA-256).

use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use argon2::password_hash::rand_core::{OsRng, RngCore};
use data_encoding::BASE32_NOPAD;
use hmac::{Hmac, Mac};
use sha1::Sha1;
use std::fmt;
use uuid::Uuid;

pub const DIGITS: u32 = 6;
pub const PERIOD_SECS: u64 = 30;
/// Pas tolérés de part et d'autre du pas courant.
const SKEW: i64 = 1;
const SECRET_LEN: usize = 20;
const NONCE_LEN: usize = 12;
pub const RECOVERY_CODE_COUNT: usize = 10;
const ISSUER: &str = "Epick'em";
/// Alphabet des codes de récupération : sans `0/o`, `1/l/i`, faciles à recopier.
const RECOVERY_ALPHABET: &[u8; 31] = b"abcdefghjkmnpqrstuvwxyz23456789";

/// Clé de chiffrement des secrets (32 octets).
#[derive(Clone)]
pub struct TotpKey([u8; 32]);

impl fmt::Debug for TotpKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("TotpKey(<masquée>)")
    }
}

impl TotpKey {
    pub fn new(bytes: [u8; 32]) -> Self {
        TotpKey(bytes)
    }

    /// Lit 64 caractères hexadécimaux (`openssl rand -hex 32`).
    pub fn from_hex(value: &str) -> Option<Self> {
        let bytes = data_encoding::HEXLOWER_PERMISSIVE
            .decode(value.trim().as_bytes())
            .ok()?;
        bytes.try_into().ok().map(TotpKey)
    }

    fn cipher(&self) -> Aes256Gcm {
        Aes256Gcm::new(&self.0.into())
    }

    /// Chiffre le secret ; le nonce aléatoire précède le chiffré.
    pub fn encrypt(&self, user_id: Uuid, secret: &[u8]) -> Vec<u8> {
        let mut nonce = [0u8; NONCE_LEN];
        OsRng.fill_bytes(&mut nonce);
        let mut out = nonce.to_vec();
        let sealed = self
            .cipher()
            .encrypt(
                Nonce::from_slice(&nonce),
                Payload {
                    msg: secret,
                    aad: user_id.as_bytes(),
                },
            )
            .expect("AES-GCM ne peut pas échouer sur un message de cette taille");
        out.extend(sealed);
        out
    }

    /// `None` si le chiffré est altéré, d'un autre compte ou d'une autre clé.
    pub fn decrypt(&self, user_id: Uuid, data: &[u8]) -> Option<Vec<u8>> {
        if data.len() <= NONCE_LEN {
            return None;
        }
        let (nonce, sealed) = data.split_at(NONCE_LEN);
        self.cipher()
            .decrypt(
                Nonce::from_slice(nonce),
                Payload {
                    msg: sealed,
                    aad: user_id.as_bytes(),
                },
            )
            .ok()
    }
}

/// Nouveau secret aléatoire.
pub fn new_secret() -> Vec<u8> {
    let mut secret = vec![0u8; SECRET_LEN];
    OsRng.fill_bytes(&mut secret);
    secret
}

/// Secret en base32, tel que saisi à la main dans une application d'authentification.
pub fn encode_secret(secret: &[u8]) -> String {
    BASE32_NOPAD.encode(secret)
}

/// URI `otpauth://` (format Key Uri de Google Authenticator), à afficher en QR code.
pub fn provisioning_uri(secret: &[u8], account: &str) -> String {
    let mut url = url::Url::parse("otpauth://totp/").expect("URL constante valide");
    url.set_path(&format!("{ISSUER}:{account}"));
    url.query_pairs_mut()
        .append_pair("secret", &encode_secret(secret))
        .append_pair("issuer", ISSUER)
        .append_pair("algorithm", "SHA1")
        .append_pair("digits", &DIGITS.to_string())
        .append_pair("period", &PERIOD_SECS.to_string());
    url.into()
}

/// Code du pas `step` (RFC 4226).
pub fn code_at(secret: &[u8], step: i64) -> u32 {
    let mut mac = <Hmac<Sha1> as Mac>::new_from_slice(secret).expect("HMAC accepte toute longueur");
    mac.update(&step.to_be_bytes());
    let digest = mac.finalize().into_bytes();
    let offset = usize::from(digest[19] & 0x0f);
    let value = u32::from_be_bytes([
        digest[offset] & 0x7f,
        digest[offset + 1],
        digest[offset + 2],
        digest[offset + 3],
    ]);
    value % 10u32.pow(DIGITS)
}

/// Pas TOTP de l'instant `unix_secs`.
pub fn step_at(unix_secs: u64) -> i64 {
    i64::try_from(unix_secs / PERIOD_SECS).unwrap_or(i64::MAX)
}

/// Pas du code s'il est valable à `unix_secs` (pas courant ± [`SKEW`]), le plus récent d'abord.
pub fn verify(secret: &[u8], code: &str, unix_secs: u64) -> Option<i64> {
    let code = code.trim();
    if code.len() != DIGITS as usize || !code.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let expected: u32 = code.parse().ok()?;
    let now = step_at(unix_secs);
    (-SKEW..=SKEW)
        .rev()
        .map(|delta| now + delta)
        .find(|&step| constant_time_eq(code_at(secret, step), expected))
}

fn constant_time_eq(a: u32, b: u32) -> bool {
    (a ^ b) == 0
}

/// `true` si `input` a la forme d'un code TOTP (sinon c'est peut-être un code de récupération).
pub fn looks_like_totp(input: &str) -> bool {
    let input = input.trim();
    input.len() == DIGITS as usize && input.bytes().all(|b| b.is_ascii_digit())
}

/// Nouveaux codes de récupération, au format `xxxx-xxxx-xxxx`.
pub fn new_recovery_codes() -> Vec<String> {
    (0..RECOVERY_CODE_COUNT)
        .map(|_| {
            let mut bytes = [0u8; 12];
            OsRng.fill_bytes(&mut bytes);
            let chars: String = bytes
                .iter()
                // 256 n'est pas multiple de 31 : biais négligeable pour un code à usage unique.
                .map(|b| RECOVERY_ALPHABET[usize::from(*b) % RECOVERY_ALPHABET.len()] as char)
                .collect();
            format!("{}-{}-{}", &chars[..4], &chars[4..8], &chars[8..])
        })
        .collect()
}

/// Forme comparée d'un code de récupération : minuscules, sans tirets ni espaces.
pub fn normalize_recovery_code(code: &str) -> String {
    code.chars()
        .filter(|c| !c.is_whitespace() && *c != '-')
        .flat_map(char::to_lowercase)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Vecteurs de la RFC 6238 (annexe B), secret ASCII « 12345678901234567890 », SHA-1, tronqués
    /// à 6 chiffres.
    #[test]
    fn rfc6238_vectors() {
        let secret = b"12345678901234567890";
        for (time, expected) in [
            (59u64, 287_082),
            (1_111_111_109, 81_804),
            (1_111_111_111, 50_471),
            (1_234_567_890, 5_924),
            (2_000_000_000, 279_037),
            (20_000_000_000, 353_130),
        ] {
            assert_eq!(code_at(secret, step_at(time)), expected, "t={time}");
        }
    }

    #[test]
    fn verify_accepts_neighbour_steps_only() {
        let secret = new_secret();
        let now = 1_700_000_000;
        let step = step_at(now);
        let code = |s: i64| format!("{:06}", code_at(&secret, s));
        assert_eq!(verify(&secret, &code(step), now), Some(step));
        assert_eq!(verify(&secret, &code(step - 1), now), Some(step - 1));
        assert_eq!(verify(&secret, &code(step + 1), now), Some(step + 1));
        assert_eq!(verify(&secret, &code(step - 2), now), None);
        assert_eq!(verify(&secret, "12345", now), None);
        assert_eq!(verify(&secret, "abcdef", now), None);
    }

    #[test]
    fn encryption_round_trip_is_bound_to_the_account() {
        let key = TotpKey::new([7; 32]);
        let (alice, bob) = (Uuid::new_v4(), Uuid::new_v4());
        let secret = new_secret();
        let sealed = key.encrypt(alice, &secret);
        assert_ne!(&sealed[NONCE_LEN..], secret.as_slice());
        assert_eq!(key.decrypt(alice, &sealed), Some(secret.clone()));
        assert_eq!(key.decrypt(bob, &sealed), None);
        assert_eq!(TotpKey::new([8; 32]).decrypt(alice, &sealed), None);
        let mut tampered = sealed.clone();
        *tampered.last_mut().unwrap() ^= 1;
        assert_eq!(key.decrypt(alice, &tampered), None);
        assert_eq!(key.decrypt(alice, &[1, 2, 3]), None);
        // Nonce aléatoire : deux chiffrements du même secret diffèrent.
        assert_ne!(key.encrypt(alice, &secret), sealed);
    }

    #[test]
    fn key_parsing() {
        assert!(TotpKey::from_hex(&"ab".repeat(32)).is_some());
        assert!(TotpKey::from_hex(&"AB".repeat(32)).is_some());
        assert!(TotpKey::from_hex(&"ab".repeat(31)).is_none());
        assert!(TotpKey::from_hex("zz").is_none());
        assert!(!format!("{:?}", TotpKey::new([1; 32])).contains('1'));
    }

    #[test]
    fn provisioning_uri_format() {
        let uri = provisioning_uri(b"12345678901234567890", "alice@example.com");
        assert!(
            uri.starts_with("otpauth://totp/Epick'em:alice@example.com?"),
            "{uri}"
        );
        assert!(
            uri.contains("secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"),
            "{uri}"
        );
        assert!(uri.contains("issuer=Epick%27em"), "{uri}");
        assert!(
            uri.contains("digits=6") && uri.contains("period=30"),
            "{uri}"
        );
    }

    #[test]
    fn recovery_codes_are_unique_and_normalized() {
        let codes = new_recovery_codes();
        assert_eq!(codes.len(), RECOVERY_CODE_COUNT);
        let unique: std::collections::HashSet<_> = codes.iter().collect();
        assert_eq!(unique.len(), RECOVERY_CODE_COUNT);
        for code in &codes {
            assert_eq!(code.len(), 14);
            assert_eq!(normalize_recovery_code(code).len(), 12);
            assert!(!looks_like_totp(code));
        }
        assert_eq!(normalize_recovery_code(" ABCD-efgh-2345 "), "abcdefgh2345");
        assert!(looks_like_totp(" 123456 "));
    }
}
