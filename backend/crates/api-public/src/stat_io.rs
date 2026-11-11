//! Import et export des statistiques (et de leur liaison aux jeux) en JSON ou en CSV.
//!
//! Le même format sert aux deux sens : un fichier exporté se réimporte sans perte. Deux
//! portées, `stat` et `stat - game` :
//!
//! - fichier des statistiques (`/stats/export`, `/stats/import`) :
//!   - JSON : `{ "version": 1, "stats": [{ "name", "key", "type", "scope", "games": [],
//!     "options": { "<jeu>": [{ "key", "label" }] } }] }`, où `games` liste les noms des jeux
//!     auxquels la statistique est liée ; `type` vaut `flat`, `percent`, `select` ou `mvp` ;
//!     `scope` (`participant` par défaut, `match`) et `options` (options d'une statistique
//!     `select`, par nom de jeu) sont facultatifs ;
//!   - CSV : en-tête `name,key,type,games,scope,options` (l'ancien en-tête à quatre colonnes
//!     reste accepté) ; `games` contient le tableau JSON des noms de jeux et `options` l'objet
//!     JSON des options par jeu ;
//! - statistiques d'un jeu, embarquées dans le fichier des jeux (voir [`crate::game_io`]) : un
//!   tableau de `{ "name", "key", "type", "scope"?, "options"? }`, géré par [`StoreStats`].

use crate::auth::{AppState, Claims};
use crate::error::{ApiError, ErrorResponse};
use crate::export_cache;
use crate::game_io::{Format, FormatQuery, GameStats};
use crate::stats::{check_options, check_scope, validate};
use crate::store::{AuthStore, Stat, StatInput, StatOption, StatScope, StatType, StoreError};
use crate::users::require_admin;
use actix_web::{HttpResponse, get, post, web};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::sync::Arc;
use utoipa::ToSchema;
use uuid::Uuid;

const FORMAT_VERSION: u32 = 1;
/// Nombre maximal de problèmes détaillés dans une réponse `400`.
const MAX_REPORTED_ERRORS: usize = 10;
const CSV_HEADER: [&str; 6] = ["name", "key", "type", "games", "scope", "options"];
/// En-tête des fichiers antérieurs aux statistiques à choix, toujours accepté à l'import.
const LEGACY_CSV_HEADER: [&str; 4] = ["name", "key", "type", "games"];

fn is_participant(scope: &StatScope) -> bool {
    *scope == StatScope::Participant
}

/// Statistiques des jeux lues et écrites dans la base, pour le fichier des jeux.
pub struct StoreStats(pub Arc<dyn AuthStore>);

/// Statistique telle qu'elle s'embarque dans le fichier d'un jeu.
#[derive(Debug, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
struct GameStat {
    name: String,
    key: String,
    #[serde(rename = "type")]
    kind: StatType,
    #[serde(default, skip_serializing_if = "is_participant")]
    scope: StatScope,
    /// Options d'une statistique `select` pour ce jeu.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    options: Vec<StatOption>,
}

impl From<Stat> for GameStat {
    fn from(stat: Stat) -> Self {
        GameStat {
            name: stat.name,
            key: stat.key,
            kind: stat.kind,
            scope: stat.scope,
            options: stat.options,
        }
    }
}

impl GameStat {
    fn input(&self) -> StatInput {
        StatInput {
            name: self.name.trim().to_string(),
            key: self.key.trim().to_string(),
            kind: self.kind,
            scope: self.scope,
        }
    }
}

/// Problèmes de type, de portée et d'options d'une statistique du fichier.
fn kind_problems(kind: StatType, scope: StatScope, options: &[StatOption]) -> Vec<String> {
    let mut reasons: Vec<String> = check_scope(kind, scope)
        .into_iter()
        .map(|(field, message)| format!("{field} : {message}"))
        .collect();
    if kind != StatType::Select && !options.is_empty() {
        reasons.push("options : seule une statistique `select` a des options.".into());
    }
    if let Some(problem) = check_options(
        &options
            .iter()
            .map(|o| StatOption {
                key: o.key.trim().to_string(),
                label: o.label.trim().to_string(),
            })
            .collect::<Vec<_>>(),
    ) {
        reasons.push(format!("options : {problem}"));
    }
    reasons
}

fn trimmed(options: &[StatOption]) -> Vec<StatOption> {
    options
        .iter()
        .map(|o| StatOption {
            key: o.key.trim().to_string(),
            label: o.label.trim().to_string(),
        })
        .collect()
}

fn parse_game_stats(stats: &[Value]) -> Result<Vec<GameStat>, String> {
    stats
        .iter()
        .enumerate()
        .map(|(index, value)| {
            serde_json::from_value(value.clone())
                .map_err(|e| format!("statistique {} invalide ({e}).", index + 1))
        })
        .collect()
}

#[async_trait]
impl GameStats for StoreStats {
    async fn export(&self, game_id: Uuid) -> Result<Vec<Value>, StoreError> {
        let stats = self.0.list_game_stats(game_id).await?.unwrap_or_default();
        stats
            .into_iter()
            .map(|stat| serde_json::to_value(GameStat::from(stat)))
            .collect::<Result<_, _>>()
            .map_err(|e| StoreError::Other(e.to_string()))
    }

    fn validate(&self, stats: &[Value]) -> Option<String> {
        let stats = match parse_game_stats(stats) {
            Ok(stats) => stats,
            Err(message) => return Some(message),
        };
        let mut keys = HashSet::new();
        for (index, stat) in stats.iter().enumerate() {
            let (name, key) = (stat.name.trim(), stat.key.trim());
            let reasons: Vec<_> = validate(Some(name), Some(key))
                .into_iter()
                .map(|(field, message)| format!("{field} : {message}"))
                .collect();
            if !reasons.is_empty() {
                return Some(format!("statistique {} : {}", index + 1, reasons.join(" ")));
            }
            let reasons = kind_problems(stat.kind, stat.scope, &stat.options);
            if !reasons.is_empty() {
                return Some(format!("statistique {} : {}", index + 1, reasons.join(" ")));
            }
            if !keys.insert(key) {
                return Some(format!(
                    "statistique {} : la clé `{key}` apparaît plusieurs fois.",
                    index + 1
                ));
            }
        }
        None
    }

    async fn import(&self, game_id: Uuid, stats: Vec<Value>) -> Result<(), StoreError> {
        let parsed = parse_game_stats(&stats).map_err(StoreError::Other)?;
        let saved = self
            .0
            .upsert_stats(parsed.iter().map(GameStat::input).collect())
            .await?;
        let ids = saved.iter().map(|(stat, _)| stat.id).collect();
        if !self.0.set_game_stats(game_id, ids).await? {
            return Err(StoreError::Other(format!("jeu {game_id} introuvable")));
        }
        for ((stat, _), item) in saved.iter().zip(&parsed) {
            if stat.kind == StatType::Select
                && !self
                    .0
                    .set_stat_options(game_id, stat.id, trimmed(&item.options))
                    .await?
            {
                return Err(StoreError::Other(format!(
                    "options de la statistique {} impossibles",
                    stat.key
                )));
            }
        }
        Ok(())
    }
}

#[derive(Debug, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
struct Document {
    version: u32,
    stats: Vec<ExportedStat>,
}

#[derive(Debug, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
struct ExportedStat {
    name: String,
    key: String,
    #[serde(rename = "type")]
    kind: StatType,
    /// `participant` s'il est absent.
    #[serde(default, skip_serializing_if = "is_participant")]
    scope: StatScope,
    /// Noms des jeux auxquels la statistique est liée.
    #[serde(default)]
    games: Vec<String>,
    /// Options d'une statistique `select`, par nom de jeu lié.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    options: BTreeMap<String, Vec<StatOption>>,
}

/// Résultat d'un import.
#[derive(Serialize, ToSchema)]
struct ImportReport {
    created: usize,
    updated: usize,
}

/// Exporte toutes les statistiques et leur liaison aux jeux (administrateur).
#[utoipa::path(
    get,
    path = "/stats/export",
    tag = "stats",
    security(("bearer" = [])),
    params(FormatQuery),
    responses(
        (status = 200, description = "Fichier JSON (`Document`) ou CSV, en pièce jointe", body = Document),
        (status = 400, description = "Format inconnu", body = ErrorResponse),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 403, description = "Réservé aux administrateurs", body = ErrorResponse),
    ),
)]
#[get("/stats/export")]
pub(crate) async fn export_stats(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    query: web::Query<FormatQuery>,
) -> Result<HttpResponse, ApiError> {
    require_admin(&state, &claims).await?;
    let format = query.format.unwrap_or_default();
    if let Some(body) = export_cache::lookup(&state, "stats", format).await {
        return Ok(export_cache::response("stats", format, body));
    }
    let store = &state.store;
    let mut games_by_stat: HashMap<Uuid, Vec<String>> = HashMap::new();
    let mut options_by_stat: HashMap<Uuid, BTreeMap<String, Vec<StatOption>>> = HashMap::new();
    for game in store
        .list_games(i64::MAX, 0)
        .await
        .map_err(ApiError::internal)?
    {
        let stats = store
            .list_game_stats(game.id)
            .await
            .map_err(ApiError::internal)?
            .unwrap_or_default();
        for stat in stats {
            games_by_stat
                .entry(stat.id)
                .or_default()
                .push(game.name.clone());
            if !stat.options.is_empty() {
                options_by_stat
                    .entry(stat.id)
                    .or_default()
                    .insert(game.name.clone(), stat.options);
            }
        }
    }
    let stats = store
        .list_stats(i64::MAX, 0)
        .await
        .map_err(ApiError::internal)?
        .into_iter()
        .map(|stat| ExportedStat {
            games: games_by_stat.remove(&stat.id).unwrap_or_default(),
            options: options_by_stat.remove(&stat.id).unwrap_or_default(),
            name: stat.name,
            key: stat.key,
            kind: stat.kind,
            scope: stat.scope,
        })
        .collect();
    let body = encode(format, stats).map_err(ApiError::internal)?;
    export_cache::save(&state, "stats", format, &body).await;
    Ok(export_cache::response("stats", format, body))
}

/// Importe des statistiques et leur liaison aux jeux depuis un fichier JSON ou CSV
/// (administrateur).
///
/// Une statistique du fichier dont la clé existe déjà met à jour cette statistique ; sinon elle
/// est créée. Ses jeux liés sont remplacés par ceux du fichier, qui doivent tous exister. Le
/// fichier est validé en entier avant toute écriture.
#[utoipa::path(
    post,
    path = "/stats/import",
    tag = "stats",
    security(("bearer" = [])),
    params(FormatQuery),
    request_body(content = String, content_type = "text/plain", description = "Contenu du fichier, 256 Kio au maximum"),
    responses(
        (status = 200, description = "Statistiques créées et mises à jour", body = ImportReport),
        (status = 400, description = "Fichier invalide (`errors.file` détaille les problèmes)", body = ErrorResponse),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 403, description = "Réservé aux administrateurs", body = ErrorResponse),
    ),
)]
#[post("/stats/import")]
pub(crate) async fn import_stats(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    query: web::Query<FormatQuery>,
    body: web::Bytes,
) -> Result<HttpResponse, ApiError> {
    require_admin(&state, &claims).await?;
    let format = query.format.unwrap_or_default();
    let stats = decode(format, &body).map_err(file_error)?;
    let games: HashMap<String, Uuid> = state
        .store
        .list_games(i64::MAX, 0)
        .await
        .map_err(ApiError::internal)?
        .into_iter()
        .map(|game| (game.name.to_lowercase(), game.id))
        .collect();
    let problems = check(&games, &stats);
    if !problems.is_empty() {
        return Err(file_error(problems));
    }

    let options: Vec<Vec<(Uuid, Vec<StatOption>)>> = stats
        .iter()
        .map(|stat| {
            stat.options
                .iter()
                .map(|(game, options)| (games[&game.trim().to_lowercase()], trimmed(options)))
                .collect()
        })
        .collect();

    let (inputs, game_ids): (Vec<_>, Vec<_>) = stats
        .into_iter()
        .map(|stat| {
            let ids: Vec<Uuid> = stat
                .games
                .iter()
                .map(|name| games[&name.trim().to_lowercase()])
                .collect();
            let input = StatInput {
                name: stat.name.trim().to_string(),
                key: stat.key.trim().to_string(),
                kind: stat.kind,
                scope: stat.scope,
            };
            (input, ids)
        })
        .unzip();
    let saved = state
        .store
        .upsert_stats(inputs)
        .await
        .map_err(ApiError::internal)?;
    let mut report = ImportReport {
        created: 0,
        updated: 0,
    };
    for (((stat, created), ids), options) in saved.into_iter().zip(game_ids).zip(options) {
        if !state
            .store
            .set_stat_games(stat.id, ids)
            .await
            .map_err(|err| match err {
                StoreError::StatInUse => ApiError::StatInUse,
                other => ApiError::internal(other),
            })?
        {
            return Err(ApiError::internal(format!(
                "liaison de la statistique {} impossible",
                stat.key
            )));
        }
        for (game_id, options) in options {
            if !state
                .store
                .set_stat_options(game_id, stat.id, options)
                .await
                .map_err(ApiError::internal)?
            {
                return Err(ApiError::internal(format!(
                    "options de la statistique {} impossibles",
                    stat.key
                )));
            }
        }
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

/// Problèmes du fichier, un message par statistique invalide (les premiers seulement).
/// `games` associe le nom en minuscules de chaque jeu existant à son identifiant.
fn check(games: &HashMap<String, Uuid>, stats: &[ExportedStat]) -> Vec<String> {
    let mut problems = Vec::new();
    let mut keys = HashSet::new();
    for (index, stat) in stats.iter().enumerate() {
        let (name, key) = (stat.name.trim(), stat.key.trim());
        let mut reasons: Vec<String> = validate(Some(name), Some(key))
            .into_iter()
            .map(|(field, message)| format!("{field} : {message}"))
            .collect();
        if !key.is_empty() && !keys.insert(key) {
            reasons.push("key : cette clé apparaît plusieurs fois dans le fichier.".into());
        }
        reasons.extend(kind_problems(stat.kind, stat.scope, &[]));
        for (game, options) in &stat.options {
            let lower = game.trim().to_lowercase();
            if !stat.games.iter().any(|g| g.trim().to_lowercase() == lower) {
                reasons.push(format!(
                    "options : le jeu « {game} » n'est pas dans `games`."
                ));
            }
            reasons.extend(
                kind_problems(stat.kind, stat.scope, options)
                    .into_iter()
                    .filter(|r| r.starts_with("options")),
            );
        }
        let mut listed = HashSet::new();
        for game in &stat.games {
            let lower = game.trim().to_lowercase();
            if !games.contains_key(&lower) {
                reasons.push(format!("games : jeu inconnu « {game} »."));
            } else if !listed.insert(lower) {
                reasons.push(format!("games : « {game} » apparaît plusieurs fois."));
            }
        }
        if !reasons.is_empty() {
            problems.push(format!("Statistique {} : {}", index + 1, reasons.join(" ")));
        }
    }
    problems.truncate(MAX_REPORTED_ERRORS);
    problems
}

fn encode(format: Format, stats: Vec<ExportedStat>) -> Result<Vec<u8>, String> {
    match format {
        Format::Json => serde_json::to_vec_pretty(&Document {
            version: FORMAT_VERSION,
            stats,
        })
        .map_err(|e| e.to_string()),
        Format::Csv => {
            let mut writer = csv::Writer::from_writer(Vec::new());
            writer.write_record(CSV_HEADER).map_err(|e| e.to_string())?;
            for stat in stats {
                let games = serde_json::to_string(&stat.games).map_err(|e| e.to_string())?;
                let options = if stat.options.is_empty() {
                    String::new()
                } else {
                    serde_json::to_string(&stat.options).map_err(|e| e.to_string())?
                };
                writer
                    .write_record([
                        &stat.name,
                        &stat.key,
                        stat.kind.as_str(),
                        &games,
                        stat.scope.as_str(),
                        &options,
                    ])
                    .map_err(|e| e.to_string())?;
            }
            writer.into_inner().map_err(|e| e.to_string())
        }
    }
}

/// Lit un fichier ; les erreurs sont des messages destinés à l'utilisateur.
fn decode(format: Format, bytes: &[u8]) -> Result<Vec<ExportedStat>, Vec<String>> {
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
            Ok(document.stats)
        }
        Format::Csv => decode_csv(text),
    }
}

#[derive(Deserialize)]
struct CsvRow {
    name: String,
    key: String,
    #[serde(rename = "type")]
    kind: String,
    games: String,
    #[serde(default)]
    scope: String,
    #[serde(default)]
    options: String,
}

fn decode_csv(text: &str) -> Result<Vec<ExportedStat>, Vec<String>> {
    let mut reader = csv::Reader::from_reader(text.as_bytes());
    let header_ok = reader
        .headers()
        .map(|h| h.iter().eq(CSV_HEADER) || h.iter().eq(LEGACY_CSV_HEADER))
        .unwrap_or(false);
    if !header_ok {
        return Err(vec![format!(
            "En-tête CSV attendu : {}.",
            CSV_HEADER.join(",")
        )]);
    }
    let mut stats = Vec::new();
    for (index, row) in reader.deserialize::<CsvRow>().enumerate() {
        let line = index + 2;
        let row = row.map_err(|e| vec![format!("Ligne {line} : {e}.")])?;
        let kind = row.kind.trim().parse::<StatType>().map_err(|_| {
            vec![format!(
                "Ligne {line} : type `{}` inconnu (`flat`, `percent`, `select` ou `mvp`).",
                row.kind
            )]
        })?;
        let games = if row.games.trim().is_empty() {
            Vec::new()
        } else {
            serde_json::from_str(&row.games)
                .map_err(|e| vec![format!("Ligne {line} : games invalides ({e}).")])?
        };
        let scope = if row.scope.trim().is_empty() {
            StatScope::default()
        } else {
            row.scope.trim().parse::<StatScope>().map_err(|_| {
                vec![format!(
                    "Ligne {line} : portée `{}` inconnue (`participant` ou `match`).",
                    row.scope
                )]
            })?
        };
        let options = if row.options.trim().is_empty() {
            BTreeMap::new()
        } else {
            serde_json::from_str(&row.options)
                .map_err(|e| vec![format!("Ligne {line} : options invalides ({e}).")])?
        };
        stats.push(ExportedStat {
            name: row.name,
            key: row.key,
            kind,
            scope,
            games,
            options,
        });
    }
    Ok(stats)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> Vec<ExportedStat> {
        vec![
            ExportedStat {
                name: "Éliminations, \"kills\"".into(),
                key: "kills".into(),
                kind: StatType::Flat,
                scope: StatScope::Participant,
                games: vec!["Valorant, \"FPS\"".into(), "Dota 2".into()],
                options: BTreeMap::new(),
            },
            ExportedStat {
                name: "Carte".into(),
                key: "map".into(),
                kind: StatType::Select,
                scope: StatScope::Match,
                games: vec!["Valorant, \"FPS\"".into()],
                options: BTreeMap::from([(
                    "Valorant, \"FPS\"".to_string(),
                    vec![
                        StatOption {
                            key: "ascent".into(),
                            label: "Ascent, \"A\"".into(),
                        },
                        StatOption {
                            key: "bind".into(),
                            label: "Bind".into(),
                        },
                    ],
                )]),
            },
            ExportedStat {
                name: "MVP".into(),
                key: "mvp".into(),
                kind: StatType::Mvp,
                scope: StatScope::Match,
                games: Vec::new(),
                options: BTreeMap::new(),
            },
            ExportedStat {
                name: "Précision".into(),
                key: "accuracy".into(),
                kind: StatType::Percent,
                scope: StatScope::Participant,
                games: Vec::new(),
                options: BTreeMap::new(),
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
            r#"{ "version": 2, "stats": [] }"#,
            r#"{ "stats": [] }"#,
            r#"{ "version": 1, "stats": [{ "name": "x", "key": "x" }] }"#,
            r#"{ "version": 1, "stats": [{ "name": "x", "key": "x", "type": "ratio" }] }"#,
            r#"{ "version": 1, "stats": [{ "name": "x", "key": "x", "type": "flat", "inconnu": 1 }] }"#,
            "pas du json",
        ];
        for text in bad {
            assert!(decode(Format::Json, text.as_bytes()).is_err(), "{text}");
        }
        let minimal = decode(
            Format::Json,
            "\u{feff}{\"version\":1,\"stats\":[{\"name\":\"x\",\"key\":\"x\",\"type\":\"flat\"}]}"
                .as_bytes(),
        )
        .unwrap();
        assert!(minimal[0].games.is_empty());
    }

    #[test]
    fn csv_requires_the_header_a_known_type_and_valid_games() {
        assert!(decode(Format::Csv, b"nom,cle\nx,y\n").is_err());
        assert!(decode(Format::Csv, b"name,key,type,games\nx,x,ratio,\n").is_err());
        assert!(decode(Format::Csv, b"name,key,type,games\nx,x,flat,pas-json\n").is_err());
        assert!(decode(Format::Csv, b"name,key,type,games\nx,x,flat\n").is_err());
        let stats = decode(Format::Csv, b"name,key,type,games\nx,x,flat,\n").unwrap();
        assert!(stats[0].games.is_empty());
    }

    #[test]
    fn invalid_files_are_reported_per_stat() {
        let games = HashMap::from([("valorant".to_string(), Uuid::new_v4())]);
        let stat = |name: &str, key: &str, games: &[&str]| ExportedStat {
            name: name.into(),
            key: key.into(),
            kind: StatType::Flat,
            scope: StatScope::Participant,
            games: games.iter().map(|g| g.to_string()).collect(),
            options: BTreeMap::new(),
        };
        let stats = vec![
            stat("Ok", "ok", &["VALORANT"]),
            stat(" ", "Mauvaise Clé", &[]),
            stat("Doublon", "ok", &["Inconnu", "valorant", "Valorant"]),
        ];
        let problems = check(&games, &stats);
        assert_eq!(problems.len(), 2);
        assert!(problems[0].starts_with("Statistique 2 :"));
        assert!(problems[0].contains("name") && problems[0].contains("key"));
        assert!(problems[1].starts_with("Statistique 3 :"));
        assert!(problems[1].contains("plusieurs fois") && problems[1].contains("Inconnu"));
    }
}
