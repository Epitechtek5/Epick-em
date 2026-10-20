//! Squelette de api-internal : se connecte à PostgreSQL et Redis, puis répond 200 sur
//! toutes les routes en attendant le vrai serveur HTTP.

use std::error::Error;
use std::process::ExitCode;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

#[tokio::main]
async fn main() -> ExitCode {
    match run().await {
        Ok(()) => ExitCode::SUCCESS,
        Err(err) => {
            eprintln!("api-internal : {err}");
            ExitCode::FAILURE
        }
    }
}

async fn run() -> Result<(), Box<dyn Error>> {
    let port = std::env::var("API_INTERNAL_PORT").unwrap_or_else(|_| "8081".into());
    let config = infra::Config::from_env()?;
    let _db = infra::connect(&config).await?;

    let listener = TcpListener::bind(format!("0.0.0.0:{port}")).await?;
    println!(
        "api-internal (domain {}) en écoute sur :{port}",
        domain::VERSION
    );

    loop {
        let (mut stream, _) = listener.accept().await?;
        let _ = stream.read(&mut [0; 1024]).await?;
        stream
            .write_all(b"HTTP/1.1 200 OK\r\ncontent-length: 2\r\n\r\nok")
            .await?;
    }
}
