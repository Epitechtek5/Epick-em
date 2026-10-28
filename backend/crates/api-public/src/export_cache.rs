//! Cache des fichiers d'export (jeux, statistiques, équipes, tournois) : un export est un
//! parcours complet de la base, alors il est gardé une heure, par ressource et par format.
//!
//! Toute requête qui modifie quelque chose (ni `GET`, `HEAD` ni `OPTIONS`) et ne finit pas en
//! erreur du client vide tous les exports ([`evict_on_write`]) : un export dépend de plusieurs
//! tables (celui des tournois reprend les jeux, les statistiques, les équipes et les comptes),
//! et une suppression en cascade ne passe pas par la route de l'élément touché. Le cache n'est
//! qu'une optimisation : une erreur de cache est journalisée puis ignorée.
//!
//! Limite : un export commencé avant une écriture et terminé après peut remettre en cache un
//! fichier périmé, jusqu'à la prochaine écriture ou l'expiration du TTL.

use crate::auth::AppState;
use crate::game_io::Format;
use actix_web::body::BoxBody;
use actix_web::dev::{ServiceRequest, ServiceResponse};
use actix_web::http::Method;
use actix_web::http::header::{CONTENT_DISPOSITION, CONTENT_TYPE};
use actix_web::middleware::Next;
use actix_web::{Error, HttpResponse, web};
use infra::{Cache, Ttl};
use std::sync::Arc;

/// Durée de vie d'un fichier d'export en cache.
pub const TTL: Ttl = Ttl::from_hours(1);

/// Ressources exportables.
const RESOURCES: [&str; 4] = ["games", "stats", "teams", "tournaments"];
const FORMATS: [Format; 2] = [Format::Json, Format::Csv];

/// Routes d'écriture qui ne touchent à aucune donnée exportée.
const NO_WRITE_PATHS: [&str; 4] = ["/login", "/refresh", "/logout", "/register"];

fn key(resource: &str, format: Format) -> String {
    format!("export:{resource}:{}", format.extension())
}

/// Le fichier en cache, s'il y en a un.
pub(crate) async fn lookup(state: &AppState, resource: &str, format: Format) -> Option<Vec<u8>> {
    let key = key(resource, format);
    state
        .cache
        .get(&key)
        .await
        .inspect_err(|err| eprintln!("cache : échec de la lecture de {key} : {err}"))
        .ok()
        .flatten()
}

/// Garde le fichier pendant [`TTL`].
pub(crate) async fn save(state: &AppState, resource: &str, format: Format, body: &[u8]) {
    let key = key(resource, format);
    if let Err(err) = state.cache.set(&key, body.to_vec(), TTL).await {
        eprintln!("cache : échec de l'écriture de {key} : {err}");
    }
}

/// Réponse HTTP d'un export : le fichier en pièce jointe.
pub(crate) fn response(resource: &str, format: Format, body: Vec<u8>) -> HttpResponse {
    HttpResponse::Ok()
        .insert_header((CONTENT_TYPE, format.content_type()))
        .insert_header((
            CONTENT_DISPOSITION,
            format!("attachment; filename=\"{resource}.{}\"", format.extension()),
        ))
        .body(body)
}

/// Supprime tous les exports du cache.
pub async fn evict_all(cache: &Arc<dyn Cache>) {
    let keys: Vec<String> = RESOURCES
        .iter()
        .flat_map(|resource| FORMATS.iter().map(|format| key(resource, *format)))
        .collect();
    let keys: Vec<&str> = keys.iter().map(String::as_str).collect();
    if let Err(err) = cache.delete(&keys).await {
        eprintln!("cache : échec de l'invalidation des exports : {err}");
    }
}

/// Après toute écriture réussie, vide les exports en cache.
pub async fn evict_on_write(
    req: ServiceRequest,
    next: Next<BoxBody>,
) -> Result<ServiceResponse<BoxBody>, Error> {
    let writes = !matches!(*req.method(), Method::GET | Method::HEAD | Method::OPTIONS)
        && !NO_WRITE_PATHS.contains(&req.path());
    let cache = writes
        .then(|| {
            req.app_data::<web::Data<AppState>>()
                .map(|s| s.cache.clone())
        })
        .flatten();
    let response = next.call(req).await?;
    if let Some(cache) = cache
        && !response.status().is_client_error()
    {
        evict_all(&cache).await;
    }
    Ok(response)
}
