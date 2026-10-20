use actix_web::{App, HttpServer, web};
use sqlx::PgPool;

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    let port = std::env::var("API_PUBLIC_PORT").unwrap_or_else(|_| "8080".into());
    let database_url = std::env::var("DATABASE_URL")
        .map_err(|_| std::io::Error::other("la variable DATABASE_URL est requise"))?;
    let pool = PgPool::connect(&database_url)
        .await
        .map_err(std::io::Error::other)?;
    let pool = web::Data::new(pool);

    println!(
        "api-public (domain {}) en écoute sur :{port}",
        domain::VERSION
    );
    HttpServer::new(move || {
        App::new()
            .app_data(pool.clone())
            .configure(api_public::configure)
    })
    .bind(format!("0.0.0.0:{port}"))?
    .run()
    .await
}
