//! Tests des endpoints utilisateurs qui échouent avant tout accès à la base :
//! le pool est paresseux et ne se connecte jamais.

use actix_web::{App, http::StatusCode, test, web};
use api_public::auth::USER_ID_HEADER;
use sqlx::postgres::PgPoolOptions;

macro_rules! app {
    () => {{
        let pool = PgPoolOptions::new()
            .connect_lazy("postgres://unused@localhost/unused")
            .unwrap();
        test::init_service(
            App::new()
                .app_data(web::Data::new(pool))
                .configure(api_public::configure),
        )
        .await
    }};
}

async fn error_of(resp: actix_web::dev::ServiceResponse) -> String {
    let body: serde_json::Value = test::read_body_json(resp).await;
    body["error"].as_str().unwrap().to_owned()
}

#[actix_web::test]
async fn register_rejects_short_password() {
    let app = app!();
    let req = test::TestRequest::post()
        .uri("/register")
        .set_json(serde_json::json!({ "username": "alice", "password": "short" }))
        .to_request();
    let resp = test::call_service(&app, req).await;
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    assert!(error_of(resp).await.contains("mot de passe"));
}

#[actix_web::test]
async fn register_rejects_invalid_username() {
    let app = app!();
    let req = test::TestRequest::post()
        .uri("/register")
        .set_json(serde_json::json!({ "username": "a b", "password": "long enough" }))
        .to_request();
    let resp = test::call_service(&app, req).await;
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

#[actix_web::test]
async fn register_rejects_malformed_json() {
    let app = app!();
    let req = test::TestRequest::post()
        .uri("/register")
        .insert_header(("content-type", "application/json"))
        .set_payload("{\"username\": \"alice\"}")
        .to_request();
    let resp = test::call_service(&app, req).await;
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    assert!(error_of(resp).await.contains("JSON"));
}

#[actix_web::test]
async fn protected_routes_require_authentication() {
    let app = app!();
    let requests = [
        test::TestRequest::get().uri("/users"),
        test::TestRequest::get().uri("/user/1"),
        test::TestRequest::patch()
            .uri("/user/1/update")
            .set_json(serde_json::json!({ "username": "bob" })),
        test::TestRequest::delete().uri("/user/1/delete"),
        test::TestRequest::patch()
            .uri("/me/update")
            .set_json(serde_json::json!({ "username": "bob" })),
        test::TestRequest::delete().uri("/me/delete"),
    ];
    for req in requests {
        let resp = test::call_service(&app, req.to_request()).await;
        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    }
}

#[actix_web::test]
async fn non_numeric_user_id_header_is_rejected() {
    let app = app!();
    let req = test::TestRequest::get()
        .uri("/users")
        .insert_header((USER_ID_HEADER, "admin"))
        .to_request();
    let resp = test::call_service(&app, req).await;
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}
