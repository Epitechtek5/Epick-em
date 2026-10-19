//! Squelette de api-internal : répond 200 sur toutes les routes en attendant le vrai serveur HTTP.

use std::io::{Read, Write};
use std::net::TcpListener;

fn main() -> std::io::Result<()> {
    let port = std::env::var("API_INTERNAL_PORT").unwrap_or_else(|_| "8081".into());
    let listener = TcpListener::bind(format!("0.0.0.0:{port}"))?;
    println!(
        "api-internal (domain {}) en écoute sur :{port}",
        domain::VERSION
    );

    for stream in listener.incoming() {
        let mut stream = stream?;
        let _ = stream.read(&mut [0; 1024])?;
        stream.write_all(b"HTTP/1.1 200 OK\r\ncontent-length: 2\r\n\r\nok")?;
    }
    Ok(())
}
