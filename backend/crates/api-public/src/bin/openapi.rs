//! Écrit la spécification OpenAPI sur la sortie standard, sans démarrer le serveur.
//! Utilisé à la release pour générer les clients web et mobile : `cargo run -q --bin openapi`.

use std::process::ExitCode;

fn main() -> ExitCode {
    match api_public::router::openapi().to_pretty_json() {
        Ok(json) => {
            println!("{json}");
            ExitCode::SUCCESS
        }
        Err(err) => {
            eprintln!("openapi : {err}");
            ExitCode::FAILURE
        }
    }
}
