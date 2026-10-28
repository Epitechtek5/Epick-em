//! Import et export des jeux (et de leurs statistiques) en JSON ou en CSV.
//!
//! Le même format sert aux deux sens : un fichier exporté se réimporte sans perte.
//!
//! - JSON : `{ "version": 1, "games": [{ "name", "description", "images": [], "stats": [] }] }` ;
//! - CSV : en-tête `name,description,images,stats` ; `images` sépare les URLs par une espace
//!   (une URL n'en contient jamais) et `stats` contient le tableau JSON des statistiques.
//!
//! Règle de composition : les statistiques sont des valeurs opaques pour ce niveau. Il ne
//! connaît ni leur contenu ni leur structure : leur validation, leur lecture et leur écriture
//! sont déléguées à [`GameStats`], et il se contente de les embarquer dans le fichier.

use crate::auth::{AppState, Claims};
use crate::error::{ApiError, ErrorResponse};
use crate::games::validate;
use crate::store::{GameInput, StoreError};
use crate::users::require_admin;
use actix_web::http::header::{CONTENT_DISPOSITION, CONTENT_TYPE};
use actix_web::{HttpResponse, get, post, web};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

const FORMAT_VERSION: u32 = 1;
/// Nombre maximal de problèmes détaillés dans une réponse `400`.
const MAX_REPORTED_ERRORS: usize = 10;
const CSV_HEADER: [&str; 4] = ["name", "description", "images", "stats"];

/// Import et export des statistiques d'un jeu : le sous-niveau des statistiques.
#[async_trait]
pub trait GameStats: Send + Sync {
    /// Statistiques liées au jeu, telles qu'elles s'embarquent dans le fichier.
    async fn export(&self, game_id: Uuid) -> Result<Vec<Value>, StoreError>;

    /// Message d'erreur si `stats` est invalide. Appelée avant toute écriture.
    fn validate(&self, stats: &[Value]) -> Option<String>;

    /// Remplace les statistiques du jeu par `stats`, déjà validées.
    async fn import(&self, game_id: Uuid, stats: Vec<Value>) -> Result<(), StoreError>;
}

/// Tant que les statistiques ne sont pas branchées : aucune à exporter, aucune acceptée.
pub struct NoStats;

#[async_trait]
impl GameStats for NoStats {
    async fn export(&self, _: Uuid) -> Result<Vec<Value>, StoreError> {
        Ok(Vec::new())
    }

    fn validate(&self, stats: &[Value]) -> Option<String> {
        (!stats.is_empty()).then(|| "les statistiques ne sont pas encore prises en charge".into())
    }

    async fn import(&self, _: Uuid, _: Vec<Value>) -> Result<(), StoreError> {
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum Format {
    #[default]
    Json,
    Csv,
}

impl Format {
    pub(crate) fn content_type(self) -> &'static str {
        match self {
            Format::Json => "application/json",
            Format::Csv => "text/csv; charset=utf-8",
        }
    }

    pub(crate) fn extension(self) -> &'static str {
        match self {
            Format::Json => "json",
            Format::Csv => "csv",
        }
    }
}

#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub(crate) struct FormatQuery {
    /// Format du fichier (`json` par défaut).
    pub(crate) format: Option<Format>,
}

#[derive(Debug, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
struct Document {
    version: u32,
    games: Vec<ExportedGame>,
}

#[derive(Debug, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
struct ExportedGame {
    name: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    images: Vec<String>,
    /// Statistiques du jeu, opaques pour ce niveau.
    #[serde(default)]
    stats: Vec<Value>,
}

/// Résultat d'un import.
#[derive(Serialize, ToSchema)]
struct ImportReport {
    created: usize,
    updated: usize,
}

/// Exporte tous les jeux et leurs statistiques (administrateur).
#[utoipa::path(
    get,
    path = "/games/export",
    tag = "games",
    security(("bearer" = [])),
    params(FormatQuery),
    responses(
        (status = 200, description = "Fichier JSON (`Document`) ou CSV, en pièce jointe", body = Document),
        (status = 400, description = "Format inconnu", body = ErrorResponse),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 403, description = "Réservé aux administrateurs", body = ErrorResponse),
    ),
)]
#[get("/games/export")]
pub(crate) async fn export_games(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    query: web::Query<FormatQuery>,
) -> Result<HttpResponse, ApiError> {
    require_admin(&state, &claims).await?;
    let format = query.format.unwrap_or_default();
    let mut games = Vec::new();
    for game in state
        .store
        .list_games(i64::MAX, 0)
        .await
        .map_err(ApiError::internal)?
    {
        let stats = state
            .stats
            .export(game.id)
            .await
            .map_err(ApiError::internal)?;
        games.push(ExportedGame {
            name: game.name,
            description: game.description,
            images: game.images,
            stats,
        });
    }
    let body = encode(format, games).map_err(ApiError::internal)?;
    Ok(HttpResponse::Ok()
        .insert_header((CONTENT_TYPE, format.content_type()))
        .insert_header((
            CONTENT_DISPOSITION,
            format!("attachment; filename=\"games.{}\"", format.extension()),
        ))
        .body(body))
}

/// Importe des jeux et leurs statistiques depuis un fichier JSON ou CSV (administrateur).
///
/// Un jeu du fichier dont le nom (sans tenir compte de la casse) existe déjà met à jour ce
/// jeu ; sinon il est créé. Le fichier est validé en entier avant toute écriture.
#[utoipa::path(
    post,
    path = "/games/import",
    tag = "games",
    security(("bearer" = [])),
    params(FormatQuery),
    request_body(content = String, content_type = "text/plain", description = "Contenu du fichier, 256 Kio au maximum"),
    responses(
        (status = 200, description = "Jeux créés et mis à jour", body = ImportReport),
        (status = 400, description = "Fichier invalide (`errors.file` détaille les problèmes)", body = ErrorResponse),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 403, description = "Réservé aux administrateurs", body = ErrorResponse),
    ),
)]
#[post("/games/import")]
pub(crate) async fn import_games(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    query: web::Query<FormatQuery>,
    body: web::Bytes,
) -> Result<HttpResponse, ApiError> {
    require_admin(&state, &claims).await?;
    let format = query.format.unwrap_or_default();
    let games = decode(format, &body).map_err(file_error)?;
    let problems = check(&*state.stats, &games);
    if !problems.is_empty() {
        return Err(file_error(problems));
    }

    let (inputs, stats): (Vec<_>, Vec<_>) = games
        .into_iter()
        .map(|game| {
            let input = GameInput {
                name: game.name.trim().to_string(),
                description: game.description,
                images: game.images,
            };
            (input, game.stats)
        })
        .unzip();
    let saved = state
        .store
        .upsert_games(inputs)
        .await
        .map_err(ApiError::internal)?;
    let mut report = ImportReport {
        created: 0,
        updated: 0,
    };
    for ((game, created), stats) in saved.into_iter().zip(stats) {
        state
            .stats
            .import(game.id, stats)
            .await
            .map_err(ApiError::internal)?;
        if created {
            report.created += 1;
        } else {
            report.updated += 1;
        }
    }
    Ok(HttpResponse::Ok().json(report))
}

fn file_error(problems: Vec<String>) -> ApiError {
    ApiError::Validation(vec![("file", problems.join(" "))])
}

/// Problèmes du fichier, un message par jeu invalide (les premiers seulement).
fn check(stats: &dyn GameStats, games: &[ExportedGame]) -> Vec<String> {
    let mut problems = Vec::new();
    let mut names = HashSet::new();
    for (index, game) in games.iter().enumerate() {
        let name = game.name.trim();
        let mut reasons: Vec<String> =
            validate(Some(name), Some(&game.description), Some(&game.images))
                .into_iter()
                .map(|(field, message)| format!("{field} : {message}"))
                .collect();
        if !name.is_empty() && !names.insert(name.to_lowercase()) {
            reasons.push("name : ce nom apparaît plusieurs fois dans le fichier.".into());
        }
        if let Some(message) = stats.validate(&game.stats) {
            reasons.push(format!("stats : {message}"));
        }
        if !reasons.is_empty() {
            problems.push(format!("Jeu {} : {}", index + 1, reasons.join(" ")));
        }
    }
    problems.truncate(MAX_REPORTED_ERRORS);
    problems
}

fn encode(format: Format, games: Vec<ExportedGame>) -> Result<Vec<u8>, String> {
    match format {
        Format::Json => serde_json::to_vec_pretty(&Document {
            version: FORMAT_VERSION,
            games,
        })
        .map_err(|e| e.to_string()),
        Format::Csv => {
            let mut writer = csv::Writer::from_writer(Vec::new());
            writer.write_record(CSV_HEADER).map_err(|e| e.to_string())?;
            for game in games {
                let stats = serde_json::to_string(&game.stats).map_err(|e| e.to_string())?;
                writer
                    .write_record([
                        &game.name,
                        &game.description,
                        &game.images.join(" "),
                        &stats,
                    ])
                    .map_err(|e| e.to_string())?;
            }
            writer.into_inner().map_err(|e| e.to_string())
        }
    }
}

/// Lit un fichier ; les erreurs sont des messages destinés à l'utilisateur.
fn decode(format: Format, bytes: &[u8]) -> Result<Vec<ExportedGame>, Vec<String>> {
    let text = std::str::from_utf8(bytes)
        .map_err(|_| vec!["Le fichier doit être encodé en UTF-8.".to_string()])?;
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    match format {
        Format::Json => {
            let document: Document =
                serde_json::from_str(text).map_err(|e| vec![format!("JSON invalide : {e}.")])?;
            if document.version != FORMAT_VERSION {
                return Err(vec![format!(
                    "Version {} non prise en charge (attendue : {FORMAT_VERSION}).",
                    document.version
                )]);
            }
            Ok(document.games)
        }
        Format::Csv => decode_csv(text),
    }
}

#[derive(Deserialize)]
struct CsvRow {
    name: String,
    description: String,
    images: String,
    stats: String,
}

fn decode_csv(text: &str) -> Result<Vec<ExportedGame>, Vec<String>> {
    let mut reader = csv::Reader::from_reader(text.as_bytes());
    let header_ok = reader
        .headers()
        .map(|h| h.iter().eq(CSV_HEADER))
        .unwrap_or(false);
    if !header_ok {
        return Err(vec![format!(
            "En-tête CSV attendu : {}.",
            CSV_HEADER.join(",")
        )]);
    }
    let mut games = Vec::new();
    for (index, row) in reader.deserialize::<CsvRow>().enumerate() {
        let line = index + 2;
        let row = row.map_err(|e| vec![format!("Ligne {line} : {e}.")])?;
        let stats = if row.stats.trim().is_empty() {
            Vec::new()
        } else {
            serde_json::from_str(&row.stats)
                .map_err(|e| vec![format!("Ligne {line} : stats invalides ({e}).")])?
        };
        games.push(ExportedGame {
            name: row.name,
            description: row.description,
            images: row.images.split_whitespace().map(str::to_string).collect(),
            stats,
        });
    }
    Ok(games)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn sample() -> Vec<ExportedGame> {
        vec![
            ExportedGame {
                name: "Valorant, \"FPS\"".into(),
                description: "ligne 1\nligne 2, avec virgule".into(),
                images: vec!["https://e.com/a.png".into(), "https://e.com/b.png".into()],
                stats: vec![json!({ "kills": 3 }), json!("opaque")],
            },
            ExportedGame {
                name: "Dota 2".into(),
                description: String::new(),
                images: Vec::new(),
                stats: Vec::new(),
            },
        ]
    }

    #[test]
    fn formats_round_trip_without_loss() {
        for format in [Format::Json, Format::Csv] {
            let bytes = encode(format, sample()).unwrap();
            assert_eq!(decode(format, &bytes).unwrap(), sample(), "{format:?}");
        }
    }

    #[test]
    fn json_requires_the_known_version_and_fields() {
        let bad = [
            r#"{ "version": 2, "games": [] }"#,
            r#"{ "games": [] }"#,
            r#"{ "version": 1, "games": [{ "name": "x", "inconnu": 1 }] }"#,
            "pas du json",
        ];
        for text in bad {
            assert!(decode(Format::Json, text.as_bytes()).is_err(), "{text}");
        }
        let minimal = decode(
            Format::Json,
            "\u{feff}{\"version\":1,\"games\":[{\"name\":\"x\"}]}".as_bytes(),
        )
        .unwrap();
        assert_eq!(minimal[0].description, "");
        assert!(minimal[0].images.is_empty() && minimal[0].stats.is_empty());
    }

    #[test]
    fn csv_requires_the_header_and_valid_stats() {
        assert!(decode(Format::Csv, b"nom,description\nx,y\n").is_err());
        assert!(
            decode(
                Format::Csv,
                b"name,description,images,stats\nx,y,,pas-json\n"
            )
            .is_err()
        );
        assert!(decode(Format::Csv, b"name,description,images,stats\nx,y\n").is_err());
        let games = decode(Format::Csv, b"name,description,images,stats\nx,y,,\n").unwrap();
        assert!(games[0].stats.is_empty());
    }

    #[test]
    fn invalid_files_are_reported_per_game() {
        let games = vec![
            ExportedGame {
                name: "Ok".into(),
                description: String::new(),
                images: Vec::new(),
                stats: Vec::new(),
            },
            ExportedGame {
                name: " ".into(),
                description: String::new(),
                images: vec!["ftp://x".into()],
                stats: Vec::new(),
            },
            ExportedGame {
                name: "OK".into(),
                description: String::new(),
                images: Vec::new(),
                stats: vec![json!(1)],
            },
        ];
        let problems = check(&NoStats, &games);
        assert_eq!(problems.len(), 2);
        assert!(problems[0].starts_with("Jeu 2 :"));
        assert!(problems[1].starts_with("Jeu 3 :"));
        assert!(problems[1].contains("plusieurs fois") && problems[1].contains("stats"));
    }
}
