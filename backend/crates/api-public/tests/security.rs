//! Connexion Google (fournisseur OIDC simulé, clés RSA générées au lancement) et double
//! authentification TOTP, de bout en bout sur l'application complète.

mod common;

use actix_web::body::MessageBody;
use actix_web::dev::{Service, ServiceResponse};
use actix_web::http::StatusCode;
use actix_web::test::{self, TestRequest};
use api_public::auth::Claims;
use api_public::config::{AuthConfig, GoogleConfig};
use api_public::google::{GoogleAuth, OidcError, OidcProvider, pkce_challenge};
use api_public::mail::MemoryMailer;
use api_public::store::MemoryStore;
use api_public::totp::{TotpKey, code_at, step_at};
use api_public::{AppState, app};
use async_trait::async_trait;
use common::{SECRET, access, call, logged_in_as, login, post, post_as, request, with_test_mailer};
use jsonwebtoken::jwk::JwkSet;
use jsonwebtoken::{Algorithm, EncodingKey, Header};
use rsa::pkcs1::EncodeRsaPrivateKey;
use rsa::traits::PublicKeyParts;
use serde_json::{Value, json};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const CLIENT_ID: &str = "epickem-test.apps.googleusercontent.com";
const REDIRECT_URI: &str = "https://epickem.test/auth/google/callback";
const KID: &str = "cle-de-test";

type Tweak = fn(&mut Value);

/// Clé RSA de signature des jetons d'identité simulés, générée une fois par exécution.
fn signing_key() -> &'static (EncodingKey, JwkSet) {
    static KEY: OnceLock<(EncodingKey, JwkSet)> = OnceLock::new();
    KEY.get_or_init(|| {
        let mut rng = argon2::password_hash::rand_core::OsRng;
        let private = rsa::RsaPrivateKey::new(&mut rng, 2048).unwrap();
        let pem = private.to_pkcs1_pem(rsa::pkcs1::LineEnding::LF).unwrap();
        let public = private.to_public_key();
        let b64 = |bytes: Vec<u8>| data_encoding::BASE64URL_NOPAD.encode(&bytes);
        let jwks = serde_json::from_value(json!({ "keys": [{
            "kty": "RSA", "alg": "RS256", "use": "sig", "kid": KID,
            "n": b64(public.n().to_bytes_be()), "e": b64(public.e().to_bytes_be()),
        }]}))
        .unwrap();
        (EncodingKey::from_rsa_pem(pem.as_bytes()).unwrap(), jwks)
    })
}

/// Google simulé : les codes d'autorisation sont enregistrés par le test, avec le
/// `code_challenge` PKCE que le vérificateur présenté doit satisfaire.
#[derive(Default)]
struct FakeGoogle {
    codes: Mutex<HashMap<String, (String, String)>>,
    down: AtomicBool,
}

#[async_trait]
impl OidcProvider for FakeGoogle {
    async fn exchange_code(&self, code: &str, verifier: &str) -> Result<String, OidcError> {
        if self.down.load(Ordering::SeqCst) {
            return Err(OidcError::Provider("panne simulée".into()));
        }
        let (token, challenge) = self
            .codes
            .lock()
            .unwrap()
            .remove(code)
            .ok_or_else(|| OidcError::Provider("code inconnu".into()))?;
        if pkce_challenge(verifier) != challenge {
            return Err(OidcError::Provider("PKCE refusé".into()));
        }
        Ok(token)
    }

    async fn signing_keys(&self, _refresh: bool) -> Result<JwkSet, OidcError> {
        Ok(signing_key().1.clone())
    }
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs()
}

/// Identité présentée par le Google simulé.
struct Who<'a> {
    sub: &'a str,
    email: &'a str,
    verified: bool,
}

fn who<'a>(sub: &'a str, email: &'a str) -> Who<'a> {
    Who {
        sub,
        email,
        verified: true,
    }
}

/// Jeton d'identité signé ; `tweak` modifie les claims avant signature.
fn id_token(who: &Who, nonce: &str, tweak: impl FnOnce(&mut Value)) -> String {
    let mut claims = json!({
        "iss": "https://accounts.google.com",
        "aud": CLIENT_ID,
        "sub": who.sub,
        "email": who.email,
        "email_verified": who.verified,
        "nonce": nonce,
        "iat": now(),
        "exp": now() + 600,
    });
    tweak(&mut claims);
    let mut header = Header::new(Algorithm::RS256);
    header.kid = Some(KID.into());
    jsonwebtoken::encode(&header, &claims, &signing_key().0).unwrap()
}

/// Simule le passage du navigateur chez Google : renvoie `(code, state)` pour la réponse de
/// `…/authorize`.
fn consent(
    google: &FakeGoogle,
    authorization: &Value,
    who: &Who,
    tweak: impl FnOnce(&mut Value),
) -> (String, String) {
    let url = url::Url::parse(authorization["authorization_url"].as_str().unwrap()).unwrap();
    let query: HashMap<_, _> = url.query_pairs().into_owned().collect();
    assert_eq!(query["state"], authorization["state"].as_str().unwrap());
    assert_eq!(query["client_id"], CLIENT_ID);
    assert_eq!(query["redirect_uri"], REDIRECT_URI);
    let code = format!("code-{}", uuid::Uuid::new_v4());
    google.codes.lock().unwrap().insert(
        code.clone(),
        (
            id_token(who, &query["nonce"], tweak),
            query["code_challenge"].clone(),
        ),
    );
    (code, query["state"].clone())
}

struct Options {
    google: bool,
    totp: bool,
}

const ALL: Options = Options {
    google: true,
    totp: true,
};

async fn setup(
    options: Options,
) -> (
    impl Service<
        actix_http::Request,
        Response = ServiceResponse<impl MessageBody>,
        Error = actix_web::Error,
    >,
    Arc<FakeGoogle>,
    Arc<MemoryMailer>,
) {
    let google = Arc::new(FakeGoogle::default());
    let mailer = Arc::new(MemoryMailer::new());
    common::set_test_mailbox(mailer.clone());
    let config = AuthConfig {
        jwt_secret: SECRET.into(),
        access_token_ttl: Duration::from_secs(900),
        refresh_token_ttl: Duration::from_secs(3600),
    };
    let auth = options.google.then(|| {
        Arc::new(GoogleAuth::new(
            GoogleConfig {
                client_id: CLIENT_ID.into(),
                client_secret: "secret".into(),
                redirect_uri: REDIRECT_URI.into(),
            },
            google.clone(),
        ))
    });
    let state = AppState::new(Arc::new(MemoryStore::new()), config)
        .unwrap()
        .with_google(auth)
        .with_totp_key(options.totp.then(|| TotpKey::new([42; 32])));
    // Les inscriptions confirment leur adresse via la boîte partagée de `common`.
    let state = with_test_mailer(state);
    (test::init_service(app(state)).await, google, mailer)
}

macro_rules! google_sign_in {
    ($app:expr, $google:expr, $who:expr) => {
        google_sign_in!($app, $google, $who, |_| {})
    };
    ($app:expr, $google:expr, $who:expr, $tweak:expr) => {{
        let (status, authorization) = post($app, "/auth/google/authorize", json!({})).await;
        assert_eq!(status, StatusCode::OK, "{authorization}");
        let (code, state) = consent(&$google, &authorization, &$who, $tweak);
        post(
            $app,
            "/auth/google/callback",
            json!({ "code": code, "state": state }),
        )
        .await
    }};
}

macro_rules! link_google {
    ($app:expr, $google:expr, $token:expr, $who:expr, $second:expr) => {{
        let (status, authorization) =
            post_as($app, $token, "/account/google/authorize", json!({})).await;
        assert_eq!(status, StatusCode::OK, "{authorization}");
        let (code, state) = consent(&$google, &authorization, &$who, |_| {});
        post_as(
            $app,
            $token,
            "/account/google/link",
            json!({ "code": code, "state": state, "second_factor": $second }),
        )
        .await
    }};
}

async fn me(
    app: &impl Service<
        actix_http::Request,
        Response = ServiceResponse<impl MessageBody>,
        Error = actix_web::Error,
    >,
    token: &str,
) -> Value {
    let (status, body) = call(app, request(TestRequest::get(), "/me", Some(token))).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    body
}

async fn security(
    app: &impl Service<
        actix_http::Request,
        Response = ServiceResponse<impl MessageBody>,
        Error = actix_web::Error,
    >,
    token: &str,
) -> Value {
    let (status, body) = call(
        app,
        request(TestRequest::get(), "/account/security", Some(token)),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    body
}

/// Jeton d'accès valide dont l'authentification date de `age` secondes.
fn token_authenticated_ago(login: &Value, age: u64) -> String {
    let claims = api_public::auth::decode_access_token(access(login), SECRET).unwrap();
    let claims = Claims {
        auth_time: now() - age,
        ..claims
    };
    jsonwebtoken::encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(SECRET.as_bytes()),
    )
    .unwrap()
}

fn base32(secret: &str) -> Vec<u8> {
    data_encoding::BASE32_NOPAD
        .decode(secret.as_bytes())
        .unwrap()
}

fn code(secret: &[u8], offset: i64) -> String {
    format!("{:06}", code_at(secret, step_at(now()) + offset))
}

/// Active la double authentification ; renvoie le secret et les codes de récupération.
async fn enable_2fa(
    app: &impl Service<
        actix_http::Request,
        Response = ServiceResponse<impl MessageBody>,
        Error = actix_web::Error,
    >,
    token: &str,
) -> (Vec<u8>, Vec<String>) {
    let (status, setup) = post_as(app, token, "/2fa/setup", json!({})).await;
    assert_eq!(status, StatusCode::OK, "{setup}");
    let secret = base32(setup["secret"].as_str().unwrap());
    assert!(
        setup["otpauth_uri"]
            .as_str()
            .unwrap()
            .starts_with("otpauth://totp/")
    );
    let (status, enabled) = post_as(
        app,
        token,
        "/2fa/enable",
        json!({ "code": code(&secret, -1) }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{enabled}");
    let codes = enabled["recovery_codes"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c.as_str().unwrap().to_string())
        .collect();
    (secret, codes)
}

#[actix_web::test]
async fn google_sign_in_creates_a_verified_account_without_a_usable_password() {
    let (app, google, mailer) = setup(ALL).await;
    let (status, tokens) = google_sign_in!(&app, google, who("g-1", "Zoe.Martin@Gmail.com"));
    assert_eq!(status, StatusCode::OK, "{tokens}");
    assert!(tokens["refresh_token"].is_string());
    let profile = me(&app, access(&tokens)).await;
    assert_eq!(profile["email"], "zoe.martin@gmail.com");
    assert_eq!(profile["username"], "zoe.martin");
    let status = security(&app, access(&tokens)).await;
    assert_eq!(status["password_set"], false);
    assert_eq!(status["google_linked"], true);
    assert_eq!(status["two_factor_enabled"], false);

    // Même identité Google : même compte, même si l'adresse a changé chez Google.
    let (status, again) = google_sign_in!(&app, google, who("g-1", "autre@gmail.com"));
    assert_eq!(status, StatusCode::OK);
    assert_eq!(me(&app, access(&again)).await["id"], profile["id"]);

    // Le mot de passe aléatoire n'est connu de personne ; /forgot-password en définit un vrai.
    assert_eq!(
        post(
            &app,
            "/forgot-password",
            json!({ "email": "zoe.martin@gmail.com" })
        )
        .await
        .0,
        StatusCode::NO_CONTENT
    );
    tokio::task::yield_now().await;
    let link = mailer.sent().last().unwrap().1.clone();
    let token = link.split_once("token=").unwrap().1;
    assert_eq!(
        post(
            &app,
            "/reset-password",
            json!({ "token": token, "password": "nouveau-mdp" })
        )
        .await
        .0,
        StatusCode::NO_CONTENT
    );
    let (status, by_password) = post(
        &app,
        "/login",
        json!({ "email": "zoe.martin@gmail.com", "password": "nouveau-mdp" }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        security(&app, access(&by_password)).await["password_set"],
        true
    );
}

#[actix_web::test]
async fn usernames_of_google_accounts_are_unique() {
    let (app, google, _) = setup(ALL).await;
    logged_in_as(&app, "sam", "secret123").await;
    let (status, tokens) = google_sign_in!(&app, google, who("g-sam", "sam@gmail.com"));
    assert_eq!(status, StatusCode::OK, "{tokens}");
    let username = me(&app, access(&tokens)).await["username"]
        .as_str()
        .unwrap()
        .to_string();
    assert!(
        username.starts_with("sam-") && username.len() == 10,
        "{username}"
    );
}

#[actix_web::test]
async fn an_existing_address_is_never_merged_automatically() {
    let (app, google, _) = setup(ALL).await;
    let alice = logged_in_as(&app, "alice", "secret123").await;
    let (status, body) = google_sign_in!(&app, google, who("g-alice", "alice@example.com"));
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(body["error"], "account_exists");
    assert!(body.get("access_token").is_none());

    // Alice lie elle-même le compte Google, puis s'en sert pour se connecter.
    let (status, body) = link_google!(
        &app,
        google,
        access(&alice),
        who("g-alice", "alice@example.com"),
        Value::Null
    );
    assert_eq!(status, StatusCode::NO_CONTENT, "{body}");
    let (status, tokens) = google_sign_in!(&app, google, who("g-alice", "alice@example.com"));
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        me(&app, access(&tokens)).await["id"],
        me(&app, access(&alice)).await["id"]
    );
}

#[actix_web::test]
async fn unverified_google_addresses_cannot_create_accounts() {
    let (app, google, _) = setup(ALL).await;
    let unverified = Who {
        sub: "g-x",
        email: "x@gmail.com",
        verified: false,
    };
    let (status, body) = google_sign_in!(&app, google, unverified);
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(body["error"], "provider_email_unverified");
}

#[actix_web::test]
async fn id_tokens_are_fully_validated() {
    let (app, google, _) = setup(ALL).await;
    let tweaks: [(&str, Tweak); 5] = [
        ("audience", |c| c["aud"] = json!("autre-client")),
        ("émetteur", |c| c["iss"] = json!("https://evil.example")),
        ("expiration", |c| c["exp"] = json!(now() - 3600)),
        ("nonce", |c| c["nonce"] = json!("rejoue")),
        ("sub", |c| c["sub"] = json!("")),
    ];
    for (what, tweak) in tweaks {
        let (status, body) = google_sign_in!(&app, google, who("g-v", "v@gmail.com"), tweak);
        assert_eq!(status, StatusCode::UNAUTHORIZED, "{what}: {body}");
    }

    // Signature d'une autre clé (HS256 avec un secret connu) : refusée.
    let (_, authorization) = post(&app, "/auth/google/authorize", json!({})).await;
    let (code, state) = consent(&google, &authorization, &who("g-v", "v@gmail.com"), |_| {});
    let forged = jsonwebtoken::encode(
        &Header::default(),
        &json!({"sub": "g-v", "aud": CLIENT_ID, "iss": "accounts.google.com", "exp": now() + 60}),
        &EncodingKey::from_secret(b"secret"),
    )
    .unwrap();
    google.codes.lock().unwrap().get_mut(&code).unwrap().0 = forged;
    let (status, _) = post(
        &app,
        "/auth/google/callback",
        json!({ "code": code, "state": state }),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[actix_web::test]
async fn oauth_states_are_single_use_and_bound_to_their_purpose() {
    let (app, google, _) = setup(ALL).await;
    let (_, authorization) = post(&app, "/auth/google/authorize", json!({})).await;
    let (code, state) = consent(&google, &authorization, &who("g-s", "s@gmail.com"), |_| {});
    let body = json!({ "code": code, "state": state });
    assert_eq!(
        post(&app, "/auth/google/callback", body.clone()).await.0,
        StatusCode::OK
    );
    let (status, error) = post(&app, "/auth/google/callback", body).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(error["error"], "invalid_oauth_state");

    // Un `state` de liaison ne sert pas à se connecter, ni à lier un autre compte.
    let bob = logged_in_as(&app, "bob", "secret123").await;
    let carol = logged_in_as(&app, "carol", "secret123").await;
    for (path, token) in [
        ("/auth/google/callback", None),
        ("/account/google/link", Some(access(&carol))),
    ] {
        let (_, authorization) =
            post_as(&app, access(&bob), "/account/google/authorize", json!({})).await;
        let (code, state) = consent(&google, &authorization, &who("g-b", "b@gmail.com"), |_| {});
        let (status, _) = call(
            &app,
            request(TestRequest::post(), path, token)
                .set_json(json!({ "code": code, "state": state })),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{path}");
    }

    // Google injoignable : 502, sans détail.
    google.down.store(true, Ordering::SeqCst);
    let (status, body) = google_sign_in!(&app, google, who("g-d", "d@gmail.com"));
    assert_eq!(status, StatusCode::BAD_GATEWAY);
    assert_eq!(body["error"], "provider_unavailable");
}

#[actix_web::test]
async fn linking_never_steals_an_identity() {
    let (app, google, _) = setup(ALL).await;
    let (_, owner) = google_sign_in!(&app, google, who("g-owner", "owner@gmail.com"));
    let mallory = logged_in_as(&app, "mallory", "secret123").await;
    let (status, body) = link_google!(
        &app,
        google,
        access(&mallory),
        who("g-owner", "owner@gmail.com"),
        Value::Null
    );
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(body["error"], "identity_taken");
    assert_eq!(
        security(&app, access(&mallory)).await["google_linked"],
        false
    );
    assert_eq!(security(&app, access(&owner)).await["google_linked"], true);

    // Un compte ne se lie qu'à une identité Google.
    link_google!(
        &app,
        google,
        access(&mallory),
        who("g-m1", "m1@gmail.com"),
        Value::Null
    );
    let (status, _) = link_google!(
        &app,
        google,
        access(&mallory),
        who("g-m2", "m2@gmail.com"),
        Value::Null
    );
    assert_eq!(status, StatusCode::CONFLICT);
}

#[actix_web::test]
async fn the_last_login_method_cannot_be_unlinked() {
    let (app, google, _) = setup(ALL).await;
    let (_, google_only) = google_sign_in!(&app, google, who("g-only", "only@gmail.com"));
    let (status, body) = post_as(
        &app,
        access(&google_only),
        "/account/google/unlink",
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(body["error"], "last_login_method");

    let dave = logged_in_as(&app, "dave", "secret123").await;
    let (status, _) = post_as(&app, access(&dave), "/account/google/unlink", json!({})).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    link_google!(
        &app,
        google,
        access(&dave),
        who("g-dave", "dave@gmail.com"),
        Value::Null
    );
    let (status, _) = post_as(&app, access(&dave), "/account/google/unlink", json!({})).await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert_eq!(security(&app, access(&dave)).await["google_linked"], false);
    // Les sessions du compte sont révoquées.
    let (status, _) = post_as(
        &app,
        access(&dave),
        "/refresh",
        json!({ "refresh_token": dave["refresh_token"] }),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    // L'identité déliée crée désormais un nouveau compte… mais l'adresse est prise.
    let (status, _) = google_sign_in!(&app, google, who("g-dave", "dave@example.com"));
    assert_eq!(status, StatusCode::CONFLICT);
}

#[actix_web::test]
async fn sensitive_changes_need_a_recent_authentication() {
    let (app, google, _) = setup(ALL).await;
    let erin = logged_in_as(&app, "erin", "secret123").await;
    let stale = token_authenticated_ago(&erin, 3600);
    for path in [
        "/2fa/setup",
        "/2fa/enable",
        "/2fa/disable",
        "/2fa/recovery-codes",
        "/account/google/authorize",
        "/account/google/unlink",
    ] {
        let (status, body) = post_as(&app, &stale, path, json!({})).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{path}");
        assert_eq!(body["error"], "reauthentication_required", "{path}");
    }
    let (_, authorization) =
        post_as(&app, access(&erin), "/account/google/authorize", json!({})).await;
    let (code, state) = consent(&google, &authorization, &who("g-e", "e@gmail.com"), |_| {});
    let (status, _) = post_as(
        &app,
        &stale,
        "/account/google/link",
        json!({ "code": code, "state": state }),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    // `/refresh` conserve l'instant d'authentification : il ne rajeunit pas la session.
    let (status, refreshed) = post_as(
        &app,
        &stale,
        "/refresh",
        json!({ "refresh_token": erin["refresh_token"] }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (status, _) = post_as(&app, access(&refreshed), "/2fa/setup", json!({})).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[actix_web::test]
async fn totp_enrollment_needs_a_valid_first_code() {
    let (app, _, _) = setup(ALL).await;
    let fred = logged_in_as(&app, "fred", "secret123").await;
    let token = access(&fred);
    let (status, _) = post_as(&app, token, "/2fa/enable", json!({ "code": "123456" })).await;
    assert_eq!(status, StatusCode::CONFLICT, "rien en attente");

    let (_, setup) = post_as(&app, token, "/2fa/setup", json!({})).await;
    let secret = base32(setup["secret"].as_str().unwrap());
    assert!(
        setup["otpauth_uri"]
            .as_str()
            .unwrap()
            .contains("fred@example.com")
    );
    let wrong = format!(
        "{:06}",
        (code(&secret, 0).parse::<u32>().unwrap() + 1) % 1_000_000
    );
    let (status, body) = post_as(&app, token, "/2fa/enable", json!({ "code": wrong })).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(body["error"], "invalid_second_factor");
    assert_eq!(security(&app, token).await["two_factor_enabled"], false);

    // Un nouvel enrôlement remplace le secret en attente.
    let (_, again) = post_as(&app, token, "/2fa/setup", json!({})).await;
    let secret = base32(again["secret"].as_str().unwrap());
    let (status, body) = post_as(
        &app,
        token,
        "/2fa/enable",
        json!({ "code": code(&secret, 0) }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["recovery_codes"].as_array().unwrap().len(), 10);
    let status = security(&app, token).await;
    assert_eq!(status["two_factor_enabled"], true);
    assert_eq!(status["recovery_codes_remaining"], 10);
    let (status, _) = post_as(&app, token, "/2fa/setup", json!({})).await;
    assert_eq!(status, StatusCode::CONFLICT, "déjà active");
}

#[actix_web::test]
async fn password_login_requires_the_second_factor() {
    let (app, _, _) = setup(ALL).await;
    let gina = logged_in_as(&app, "gina", "secret123").await;
    let (secret, recovery) = enable_2fa(&app, access(&gina)).await;

    let (status, challenge) = login(&app, "gina", "secret123").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(challenge["mfa_required"], true);
    assert!(challenge.get("access_token").is_none());
    assert!(challenge.get("refresh_token").is_none());
    let mfa = challenge["mfa_token"].as_str().unwrap();

    let (status, _) = post(
        &app,
        "/login/2fa",
        json!({ "mfa_token": "inconnu", "code": "1" }),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    let (status, body) = post(
        &app,
        "/login/2fa",
        json!({ "mfa_token": mfa, "code": "000000" }),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(body["error"], "invalid_second_factor");
    // Le pas qui a servi à l'activation ne peut pas resservir (rejeu).
    let (status, _) = post(
        &app,
        "/login/2fa",
        json!({ "mfa_token": mfa, "code": code(&secret, -1) }),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);

    let next = code(&secret, 1);
    let (status, tokens) = post(
        &app,
        "/login/2fa",
        json!({ "mfa_token": mfa, "code": next }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{tokens}");
    assert_eq!(me(&app, access(&tokens)).await["username"], "gina");
    // Le défi est consommé, et le code ne resert pas sur un nouveau défi.
    let (status, _) = post(
        &app,
        "/login/2fa",
        json!({ "mfa_token": mfa, "code": next }),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    let (_, challenge) = login(&app, "gina", "secret123").await;
    let mfa = challenge["mfa_token"].as_str().unwrap();
    let (status, _) = post(
        &app,
        "/login/2fa",
        json!({ "mfa_token": mfa, "code": next }),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);

    // Un code de récupération sert une fois, quelle que soit sa mise en forme.
    let spaced = recovery[0].to_uppercase().replace('-', " ");
    let (status, _) = post(
        &app,
        "/login/2fa",
        json!({ "mfa_token": mfa, "code": spaced }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (_, challenge) = login(&app, "gina", "secret123").await;
    let mfa = challenge["mfa_token"].as_str().unwrap();
    let (status, _) = post(
        &app,
        "/login/2fa",
        json!({ "mfa_token": mfa, "code": recovery[0] }),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(
        security(&app, access(&tokens)).await["recovery_codes_remaining"],
        9
    );
}

#[actix_web::test]
async fn challenges_and_codes_are_rate_limited() {
    let (app, _, _) = setup(ALL).await;
    let hugo = logged_in_as(&app, "hugo", "secret123").await;
    let (_, recovery) = enable_2fa(&app, access(&hugo)).await;

    let (_, challenge) = login(&app, "hugo", "secret123").await;
    let mfa = challenge["mfa_token"].as_str().unwrap();
    for _ in 0..5 {
        let (status, _) = post(
            &app,
            "/login/2fa",
            json!({ "mfa_token": mfa, "code": "000000" }),
        )
        .await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
    }
    // Défi épuisé : même un bon code est refusé.
    let (status, _) = post(
        &app,
        "/login/2fa",
        json!({ "mfa_token": mfa, "code": recovery[0] }),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);

    // Limite par compte, tous défis confondus (10 codes par quart d'heure, l'activation comprise).
    let mut limited = false;
    for _ in 0..10 {
        let (_, challenge) = login(&app, "hugo", "secret123").await;
        let mfa = challenge["mfa_token"].as_str().unwrap();
        let (status, _) = post(
            &app,
            "/login/2fa",
            json!({ "mfa_token": mfa, "code": "000000" }),
        )
        .await;
        if status == StatusCode::TOO_MANY_REQUESTS {
            limited = true;
            break;
        }
    }
    assert!(limited);
}

#[actix_web::test]
async fn google_sign_in_also_requires_the_second_factor() {
    let (app, google, _) = setup(ALL).await;
    let (_, tokens) = google_sign_in!(&app, google, who("g-ivy", "ivy@gmail.com"));
    let (secret, _) = enable_2fa(&app, access(&tokens)).await;
    let (status, challenge) = google_sign_in!(&app, google, who("g-ivy", "ivy@gmail.com"));
    assert_eq!(status, StatusCode::OK);
    assert_eq!(challenge["mfa_required"], true);
    assert!(challenge.get("access_token").is_none());
    let (status, _) = post(
        &app,
        "/login/2fa",
        json!({ "mfa_token": challenge["mfa_token"], "code": code(&secret, 1) }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
}

#[actix_web::test]
async fn disabling_and_regenerating_need_the_second_factor() {
    let (app, google, _) = setup(ALL).await;
    let jade = logged_in_as(&app, "jade", "secret123").await;
    let token = access(&jade);
    let (_, recovery) = enable_2fa(&app, token).await;

    // Lier Google exige aussi le second facteur.
    let (status, _) = link_google!(&app, google, token, who("g-j", "j@gmail.com"), Value::Null);
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    let (status, _) = link_google!(&app, google, token, who("g-j", "j@gmail.com"), recovery[1]);
    assert_eq!(status, StatusCode::NO_CONTENT);

    let (status, _) = post_as(&app, token, "/2fa/recovery-codes", json!({})).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    let (status, fresh) = post_as(
        &app,
        token,
        "/2fa/recovery-codes",
        json!({ "code": recovery[2] }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let fresh: Vec<String> = serde_json::from_value(fresh["recovery_codes"].clone()).unwrap();
    // Les anciens codes ne valent plus rien.
    let (status, _) = post_as(&app, token, "/2fa/disable", json!({ "code": recovery[3] })).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    let (status, _) = post_as(&app, token, "/2fa/disable", json!({ "code": fresh[0] })).await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert_eq!(security(&app, token).await["two_factor_enabled"], false);
    // Désactiver révoque les sessions ; la connexion redevient directe.
    let (status, _) = post_as(
        &app,
        token,
        "/refresh",
        json!({ "refresh_token": jade["refresh_token"] }),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    let (status, tokens) = login(&app, "jade", "secret123").await;
    assert_eq!(status, StatusCode::OK);
    assert!(tokens["access_token"].is_string());
    let (status, _) = post_as(&app, token, "/2fa/disable", json!({ "code": fresh[1] })).await;
    assert_eq!(status, StatusCode::CONFLICT);
}

#[actix_web::test]
async fn unconfigured_features_answer_503() {
    let (app, _, _) = setup(Options {
        google: false,
        totp: false,
    })
    .await;
    let (status, body) = post(&app, "/auth/google/authorize", json!({})).await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(body["error"], "not_configured");
    let kim = logged_in_as(&app, "kim", "secret123").await;
    let (status, _) = post_as(&app, access(&kim), "/2fa/setup", json!({})).await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    let status = security(&app, access(&kim)).await;
    assert_eq!(status["google_available"], false);
    assert_eq!(status["two_factor_available"], false);
    assert_eq!(status["password_set"], true);
}
