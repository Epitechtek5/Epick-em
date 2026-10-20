use actix_web::{App, HttpServer, web};
use std::error::Error;
use std::process::ExitCode;

#[actix_web::main]
async fn main() -> ExitCode {
    match run().await {
        Ok(()) => ExitCode::SUCCESS,
        Err(err) => {
            eprintln!("api-public : {err}");
            ExitCode::FAILURE
        }
    }
}

async fn run() -> Result<(), Box<dyn Error>> {
    let port = std::env::var("API_PUBLIC_PORT").unwrap_or_else(|_| "8080".into());
    let config = infra::Config::from_env()?;
    let db = infra::connect(&config).await?;
    let pool = web::Data::new(db.pool().clone());

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
    .await?;
    Ok(())
}
