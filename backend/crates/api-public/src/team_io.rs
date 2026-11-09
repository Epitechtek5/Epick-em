//! Import et export des équipes globales (`teams` et `team_member`) en JSON ou en CSV.
//!
//! Le même format sert aux deux sens : un fichier exporté se réimporte sans perte. Les équipes de
//! tournoi sont hors périmètre. Un jeu est désigné par son nom et un compte par son nom
//! d'utilisateur, jamais par un identifiant propre à une base.
//!
//! - JSON : `{ "version": 1, "teams": [{ "game", "name", "tag", "picture_url", "owner",
//!   "members": [{ "username", "role", "joined_at", "left_at" }] }] }` ; `tag`, `picture_url`
//!   et `members[].joined_at` / `left_at` sont facultatifs à l'import, les autres clés sont
//!   refusées ;
//! - CSV : en-tête `game,name,tag,picture_url,owner,members` ; `members` contient le tableau JSON
//!   des membres.
//!
//! `members` décrit l'état complet de l'équipe, anciens membres compris : importer une équipe
//! existante (même jeu et même nom, sans tenir compte de la casse) la met à jour et **remplace**
//! ses membres. Le propriétaire figure parmi les membres, comme `owner` actif.

use crate::auth::{AppState, Claims};
use crate::error::{ApiError, ErrorResponse};
use crate::game_io::{Format, FormatQuery};
use crate::store::{AuthStore, MemberImport, TeamImport, TeamRole};
use crate::teams::validate;
use crate::users::require_admin;
use actix_web::http::header::{CONTENT_DISPOSITION, CONTENT_TYPE};
use actix_web::{HttpResponse, get, post, web};
use serde::{Deserialize, Serialize};
use std::collections::hash_map::Entry;
use std::collections::{HashMap, HashSet};
use utoipa::ToSchema;
use uuid::Uuid;

const FORMAT_VERSION: u32 = 1;
/// Nombre maximal de problèmes détaillés dans une réponse `400`.
const MAX_REPORTED_ERRORS: usize = 10;
const CSV_HEADER: [&str; 6] = ["game", "name", "tag", "picture_url", "owner", "members"];

#[derive(Debug, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
struct Document {
    version: u32,
    teams: Vec<ExportedTeam>,
}

#[derive(Debug, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
struct ExportedTeam {
    /// Nom du jeu de l'équipe.
    game: String,
    name: String,
    #[serde(default)]
    tag: Option<String>,
    #[serde(default)]
    picture_url: Option<String>,
    /// Nom d'utilisateur du propriétaire.
    owner: String,
    members: Vec<ExportedMember>,
}

#[derive(Debug, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
struct ExportedMember {
    username: String,
    role: TeamRole,
    /// Horodatage RFC 3339 en UTC ; l'instant de l'import s'il est absent.
    #[serde(default)]
    joined_at: Option<String>,
    /// Renseigné quand le membre a quitté l'équipe.
    #[serde(default)]
    left_at: Option<String>,
}

/// Résultat d'un import.
#[derive(Serialize, ToSchema)]
struct ImportReport {
    created: usize,
    updated: usize,
}

/// Exporte toutes les équipes globales et leurs membres (administrateur).
#[utoipa::path(
    get,
    path = "/teams/export",
    tag = "teams",
    security(("bearer" = [])),
    params(FormatQuery),
    responses(
        (status = 200, description = "Fichier JSON (`Document`) ou CSV, en pièce jointe", body = Document),
        (status = 400, description = "Format inconnu", body = ErrorResponse),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 403, description = "Réservé aux administrateurs", body = ErrorResponse),
    ),
)]
#[get("/teams/export")]
pub(crate) async fn export_teams(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    query: web::Query<FormatQuery>,
) -> Result<HttpResponse, ApiError> {
    require_admin(&state, &claims).await?;
    let format = query.format.unwrap_or_default();
    let store = &state.store;
    let games: HashMap<Uuid, String> = store
        .list_games(i64::MAX, 0)
        .await
        .map_err(ApiError::internal)?
        .into_iter()
        .map(|game| (game.id, game.name))
        .collect();
    let mut usernames: HashMap<Uuid, String> = HashMap::new();
    let mut teams = Vec::new();
    for team in store
        .list_teams(None, i64::MAX, 0)
        .await
        .map_err(ApiError::internal)?
    {
        let members = store
            .list_team_members(team.id)
            .await
            .map_err(ApiError::internal)?
            .unwrap_or_default();
        let mut exported = Vec::with_capacity(members.len());
        for member in members {
            exported.push(ExportedMember {
                username: username(store.as_ref(), &mut usernames, member.user_id).await?,
                role: member.role,
                joined_at: Some(member.joined_at),
                left_at: member.left_at,
            });
        }
        teams.push(ExportedTeam {
            game: games.get(&team.game_id).cloned().unwrap_or_default(),
            owner: username(store.as_ref(), &mut usernames, team.owner_id).await?,
            name: team.name,
            tag: team.tag,
            picture_url: team.picture_url,
            members: exported,
        });
    }
    let body = encode(format, teams).map_err(ApiError::internal)?;
    Ok(HttpResponse::Ok()
        .insert_header((CONTENT_TYPE, format.content_type()))
        .insert_header((
            CONTENT_DISPOSITION,
            format!("attachment; filename=\"teams.{}\"", format.extension()),
        ))
        .body(body))
}

/// Nom d'utilisateur d'un compte, mémorisé pour la durée de l'export.
async fn username(
    store: &dyn AuthStore,
    known: &mut HashMap<Uuid, String>,
    id: Uuid,
) -> Result<String, ApiError> {
    if let Some(name) = known.get(&id) {
        return Ok(name.clone());
    }
    let profile = store
        .find_profile(id)
        .await
        .map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::internal(format!("compte {id} introuvable")))?;
    known.insert(id, profile.username.clone());
    Ok(profile.username)
}

/// Importe des équipes globales et leurs membres depuis un fichier JSON ou CSV (administrateur).
///
/// Une équipe du fichier dont le jeu et le nom (sans tenir compte de la casse) existent déjà met
/// à jour cette équipe et **remplace** ses membres ; sinon elle est créée. Les jeux et les
/// comptes du fichier doivent exister. Le fichier est validé en entier avant toute écriture.
#[utoipa::path(
    post,
    path = "/teams/import",
    tag = "teams",
    security(("bearer" = [])),
    params(FormatQuery),
    request_body(content = String, content_type = "text/plain", description = "Contenu du fichier, 256 Kio au maximum"),
    responses(
        (status = 200, description = "Équipes créées et mises à jour", body = ImportReport),
        (status = 400, description = "Fichier invalide (`errors.file` détaille les problèmes)", body = ErrorResponse),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 403, description = "Réservé aux administrateurs", body = ErrorResponse),
    ),
)]
#[post("/teams/import")]
pub(crate) async fn import_teams(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    query: web::Query<FormatQuery>,
    body: web::Bytes,
) -> Result<HttpResponse, ApiError> {
    require_admin(&state, &claims).await?;
    let format = query.format.unwrap_or_default();
    let teams = decode(format, &body).map_err(file_error)?;
    let store = &state.store;
    let games: HashMap<String, Uuid> = store
        .list_games(i64::MAX, 0)
        .await
        .map_err(ApiError::internal)?
        .into_iter()
        .map(|game| (game.name.to_lowercase(), game.id))
        .collect();
    let mut users: HashMap<String, Option<Uuid>> = HashMap::new();
    for name in teams
        .iter()
        .flat_map(|t| std::iter::once(&t.owner).chain(t.members.iter().map(|m| &m.username)))
    {
        if let Entry::Vacant(slot) = users.entry(name.trim().to_lowercase()) {
            let id = store
                .find_user_by_username(name.trim())
                .await
                .map_err(ApiError::internal)?
                .map(|user| user.id);
            slot.insert(id);
        }
    }
    let inputs = match check(&games, &users, &teams) {
        Ok(inputs) => inputs,
        Err(problems) => return Err(file_error(problems)),
    };
    let saved = store
        .import_teams(inputs)
        .await
        .map_err(ApiError::internal)?;
    let created = saved.iter().filter(|(_, created)| *created).count();
    Ok(HttpResponse::Ok().json(ImportReport {
        created,
        updated: saved.len() - created,
    }))
}

fn file_error(problems: Vec<String>) -> ApiError {
    ApiError::Validation(vec![("file", problems.join(" "))])
}

/// Équipes prêtes à écrire, ou les problèmes du fichier, un message par équipe invalide (les
/// premiers seulement). `games` et `users` associent le nom en minuscules à l'identifiant, `None`
/// si le compte n'existe pas.
fn check(
    games: &HashMap<String, Uuid>,
    users: &HashMap<String, Option<Uuid>>,
    teams: &[ExportedTeam],
) -> Result<Vec<TeamImport>, Vec<String>> {
    let mut problems = Vec::new();
    let mut inputs = Vec::new();
    let mut seen = HashSet::new();
    for (index, team) in teams.iter().enumerate() {
        let (name, game) = (team.name.trim(), team.game.trim());
        let tag = team.tag.as_deref().map(str::trim).filter(|t| !t.is_empty());
        let picture = team
            .picture_url
            .as_deref()
            .map(str::trim)
            .filter(|u| !u.is_empty());
        let mut reasons: Vec<String> = validate(Some(name), tag, picture)
            .into_iter()
            .map(|(field, message)| format!("{field} : {message}"))
            .collect();
        let game_id = games.get(&game.to_lowercase()).copied();
        if game_id.is_none() {
            reasons.push(format!("game : jeu inconnu « {} ».", team.game));
        }
        if !name.is_empty() && !seen.insert((game.to_lowercase(), name.to_lowercase())) {
            reasons.push("name : cette équipe apparaît plusieurs fois dans le fichier.".into());
        }
        let owner = users
            .get(&team.owner.trim().to_lowercase())
            .copied()
            .flatten();
        if owner.is_none() {
            reasons.push(format!("owner : compte inconnu « {} ».", team.owner));
        }
        let (members, member_reasons) = check_members(users, &team.members, owner);
        reasons.extend(member_reasons);
        match (game_id, owner) {
            (Some(game_id), Some(owner_id)) if reasons.is_empty() => inputs.push(TeamImport {
                game_id,
                name: name.to_string(),
                tag: tag.map(str::to_string),
                picture_url: picture.map(str::to_string),
                owner_id,
                members,
            }),
            _ => problems.push(format!("Équipe {} : {}", index + 1, reasons.join(" "))),
        }
    }
    if problems.is_empty() {
        Ok(inputs)
    } else {
        problems.truncate(MAX_REPORTED_ERRORS);
        Err(problems)
    }
}

/// Membres prêts à écrire et les raisons pour lesquelles ils ne le sont pas.
fn check_members(
    users: &HashMap<String, Option<Uuid>>,
    members: &[ExportedMember],
    owner: Option<Uuid>,
) -> (Vec<MemberImport>, Vec<String>) {
    let mut reasons = Vec::new();
    let mut out = Vec::with_capacity(members.len());
    let mut active = HashSet::new();
    let mut rows = HashSet::new();
    let mut active_owners = Vec::new();
    for member in members {
        let label = &member.username;
        let Some(user_id) = users.get(&label.trim().to_lowercase()).copied().flatten() else {
            reasons.push(format!("members : compte inconnu « {label} »."));
            continue;
        };
        let joined_at = match member.joined_at.as_deref().map(normalize_timestamp) {
            Some(Some(ts)) => Some(ts),
            Some(None) => {
                reasons.push(format!("members : joined_at invalide pour « {label} »."));
                continue;
            }
            None => None,
        };
        let left_at = match member.left_at.as_deref().map(normalize_timestamp) {
            Some(Some(ts)) => Some(ts),
            Some(None) => {
                reasons.push(format!("members : left_at invalide pour « {label} »."));
                continue;
            }
            None => None,
        };
        match (&joined_at, &left_at) {
            (None, Some(_)) => {
                reasons.push(format!(
                    "members : left_at exige joined_at pour « {label} »."
                ));
            }
            (Some(joined), Some(left)) if left < joined => {
                reasons.push(format!("members : « {label} » est parti avant d'arriver."));
            }
            _ => {}
        }
        if left_at.is_none() {
            if !active.insert(user_id) {
                reasons.push(format!(
                    "members : « {label} » est membre actif plusieurs fois."
                ));
            }
            if member.role == TeamRole::Owner {
                active_owners.push(user_id);
            }
        }
        if !rows.insert((user_id, joined_at.clone())) {
            reasons.push(format!(
                "members : « {label} » apparaît plusieurs fois à la même date."
            ));
        }
        out.push(MemberImport {
            user_id,
            role: member.role,
            joined_at,
            left_at,
        });
    }
    if active_owners.len() != 1 || Some(active_owners[0]) != owner {
        reasons.push(
            "members : le propriétaire doit être l'unique membre actif de rôle `owner`.".into(),
        );
    }
    (out, reasons)
}

/// Horodatage RFC 3339 en UTC (`2026-10-26T14:03:09Z`, décimales facultatives) ramené à six
/// décimales, format de l'export : des chaînes normalisées se comparent dans l'ordre du temps.
pub(crate) fn normalize_timestamp(value: &str) -> Option<String> {
    let value = value.trim().strip_suffix('Z')?;
    let (date_time, fraction) = match value.split_once('.') {
        Some((head, fraction)) => (head, fraction),
        None => (value, ""),
    };
    if fraction.len() > 6 || !fraction.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let (date, time) = date_time.split_once('T')?;
    let number = |part: &str, len: usize| -> Option<u32> {
        (part.len() == len && part.bytes().all(|b| b.is_ascii_digit()))
            .then(|| part.parse().ok())
            .flatten()
    };
    let mut date = date.split('-');
    let (year, month, day) = (
        number(date.next()?, 4)?,
        number(date.next()?, 2)?,
        number(date.next()?, 2)?,
    );
    let mut time = time.split(':');
    let (hour, minute, second) = (
        number(time.next()?, 2)?,
        number(time.next()?, 2)?,
        number(time.next()?, 2)?,
    );
    if date.next().is_some() || time.next().is_some() {
        return None;
    }
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let days = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        2 => 28,
        _ => return None,
    };
    if year == 0 || !(1..=days).contains(&day) || hour > 23 || minute > 59 || second > 59 {
        return None;
    }
    Some(format!(
        "{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}.{fraction:0<6}Z"
    ))
}

fn encode(format: Format, teams: Vec<ExportedTeam>) -> Result<Vec<u8>, String> {
    match format {
        Format::Json => serde_json::to_vec_pretty(&Document {
            version: FORMAT_VERSION,
            teams,
        })
        .map_err(|e| e.to_string()),
        Format::Csv => {
            let mut writer = csv::Writer::from_writer(Vec::new());
            writer.write_record(CSV_HEADER).map_err(|e| e.to_string())?;
            for team in teams {
                let members = serde_json::to_string(&team.members).map_err(|e| e.to_string())?;
                writer
                    .write_record([
                        &team.game,
                        &team.name,
                        team.tag.as_deref().unwrap_or(""),
                        team.picture_url.as_deref().unwrap_or(""),
                        &team.owner,
                        &members,
                    ])
                    .map_err(|e| e.to_string())?;
            }
            writer.into_inner().map_err(|e| e.to_string())
        }
    }
}

/// Lit un fichier ; les erreurs sont des messages destinés à l'utilisateur.
fn decode(format: Format, bytes: &[u8]) -> Result<Vec<ExportedTeam>, Vec<String>> {
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
            Ok(document.teams)
        }
        Format::Csv => decode_csv(text),
    }
}

#[derive(Deserialize)]
struct CsvRow {
    game: String,
    name: String,
    tag: String,
    picture_url: String,
    owner: String,
    members: String,
}

fn decode_csv(text: &str) -> Result<Vec<ExportedTeam>, Vec<String>> {
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
    let mut teams = Vec::new();
    for (index, row) in reader.deserialize::<CsvRow>().enumerate() {
        let line = index + 2;
        let row = row.map_err(|e| vec![format!("Ligne {line} : {e}.")])?;
        let members = serde_json::from_str(&row.members)
            .map_err(|e| vec![format!("Ligne {line} : members invalides ({e}).")])?;
        let optional = |value: String| Some(value).filter(|v| !v.is_empty());
        teams.push(ExportedTeam {
            game: row.game,
            name: row.name,
            tag: optional(row.tag),
            picture_url: optional(row.picture_url),
            owner: row.owner,
            members,
        });
    }
    Ok(teams)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn member(
        username: &str,
        role: TeamRole,
        joined: Option<&str>,
        left: Option<&str>,
    ) -> ExportedMember {
        ExportedMember {
            username: username.into(),
            role,
            joined_at: joined.map(str::to_string),
            left_at: left.map(str::to_string),
        }
    }

    fn sample() -> Vec<ExportedTeam> {
        vec![
            ExportedTeam {
                game: "Valorant, \"FPS\"".into(),
                name: "Karmine, \"KC\"".into(),
                tag: Some("KC".into()),
                picture_url: Some("https://img.example/kc.png".into()),
                owner: "alice".into(),
                members: vec![
                    member(
                        "alice",
                        TeamRole::Owner,
                        Some("2026-01-02T03:04:05.123456Z"),
                        None,
                    ),
                    member(
                        "bob",
                        TeamRole::Substitute,
                        Some("2026-01-03T00:00:00.000000Z"),
                        Some("2026-02-03T00:00:00.000000Z"),
                    ),
                ],
            },
            ExportedTeam {
                game: "Dota 2".into(),
                name: "Sans tag".into(),
                tag: None,
                picture_url: None,
                owner: "bob".into(),
                members: Vec::new(),
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
            r#"{ "version": 2, "teams": [] }"#,
            r#"{ "teams": [] }"#,
            r#"{ "version": 1, "teams": [{ "game": "g", "name": "n", "owner": "o" }] }"#,
            r#"{ "version": 1, "teams": [{ "game": "g", "name": "n", "owner": "o", "members": [{ "username": "o", "role": "boss" }] }] }"#,
            r#"{ "version": 1, "teams": [{ "game": "g", "name": "n", "owner": "o", "members": [], "inconnu": 1 }] }"#,
            "pas du json",
        ];
        for text in bad {
            assert!(decode(Format::Json, text.as_bytes()).is_err(), "{text}");
        }
        let minimal = decode(
            Format::Json,
            "\u{feff}{\"version\":1,\"teams\":[{\"game\":\"g\",\"name\":\"n\",\"owner\":\"o\",\"members\":[{\"username\":\"o\",\"role\":\"owner\"}]}]}"
                .as_bytes(),
        )
        .unwrap();
        assert_eq!(minimal[0].tag, None);
        assert_eq!(minimal[0].members[0].joined_at, None);
    }

    #[test]
    fn csv_requires_the_header_and_valid_members() {
        assert!(decode(Format::Csv, b"nom,jeu\nx,y\n").is_err());
        assert!(
            decode(
                Format::Csv,
                b"game,name,tag,picture_url,owner,members\ng,n,,,o,pas-json\n"
            )
            .is_err()
        );
        assert!(
            decode(
                Format::Csv,
                b"game,name,tag,picture_url,owner,members\ng,n,,,o\n"
            )
            .is_err()
        );
        let teams = decode(
            Format::Csv,
            b"game,name,tag,picture_url,owner,members\ng,n,,,o,[]\n",
        )
        .unwrap();
        assert_eq!(teams[0].tag, None);
    }

    #[test]
    fn timestamps_are_normalized_and_validated() {
        assert_eq!(
            normalize_timestamp("2026-10-26T14:03:09Z").as_deref(),
            Some("2026-10-26T14:03:09.000000Z")
        );
        assert_eq!(
            normalize_timestamp("2026-10-26T14:03:09.5Z").as_deref(),
            Some("2026-10-26T14:03:09.500000Z")
        );
        assert_eq!(
            normalize_timestamp("2024-02-29T00:00:00.123456Z").as_deref(),
            Some("2024-02-29T00:00:00.123456Z")
        );
        for bad in [
            "2026-10-26T14:03:09",
            "2026-10-26 14:03:09Z",
            "2026-10-26T14:03:09+02:00",
            "2026-02-30T00:00:00Z",
            "2025-02-29T00:00:00Z",
            "2026-13-01T00:00:00Z",
            "2026-10-26T24:00:00Z",
            "2026-10-26T14:03:09.1234567Z",
            "2026-10-26T14:03:09.xZ",
            "26-10-26T14:03:09Z",
            "",
        ] {
            assert_eq!(normalize_timestamp(bad), None, "{bad}");
        }
    }

    #[test]
    fn invalid_files_are_reported_per_team() {
        let game = Uuid::new_v4();
        let (alice, bob) = (Uuid::new_v4(), Uuid::new_v4());
        let games = HashMap::from([("valorant".to_string(), game)]);
        let users = HashMap::from([
            ("alice".to_string(), Some(alice)),
            ("bob".to_string(), Some(bob)),
            ("ghost".to_string(), None),
        ]);
        let team =
            |game: &str, name: &str, owner: &str, members: Vec<ExportedMember>| ExportedTeam {
                game: game.into(),
                name: name.into(),
                tag: None,
                picture_url: None,
                owner: owner.into(),
                members,
            };
        let owner = |name: &str| member(name, TeamRole::Owner, None, None);

        let ok = check(
            &games,
            &users,
            &[team("VALORANT", " Ok ", "ALICE", vec![owner("alice")])],
        )
        .unwrap();
        assert_eq!(
            (ok[0].game_id, ok[0].owner_id, ok[0].name.as_str()),
            (game, alice, "Ok")
        );

        let teams = vec![
            team("Valorant", "Doublon", "alice", vec![owner("alice")]),
            team("Valorant", "doublon", "alice", vec![owner("alice")]),
            team("Inconnu", " ", "ghost", vec![owner("ghost")]),
            team(
                "Valorant",
                "Sans owner",
                "alice",
                vec![member("alice", TeamRole::Member, None, None)],
            ),
            team(
                "Valorant",
                "Deux owners",
                "alice",
                vec![owner("alice"), owner("bob")],
            ),
            team("Valorant", "Autre owner", "alice", vec![owner("bob")]),
            team(
                "Valorant",
                "Dates",
                "alice",
                vec![
                    owner("alice"),
                    member("bob", TeamRole::Member, None, Some("2026-01-01T00:00:00Z")),
                    member(
                        "bob",
                        TeamRole::Member,
                        Some("2026-03-01T00:00:00Z"),
                        Some("2026-02-01T00:00:00Z"),
                    ),
                    member("bob", TeamRole::Member, Some("pas une date"), None),
                ],
            ),
            team(
                "Valorant",
                "Actif deux fois",
                "alice",
                vec![
                    owner("alice"),
                    member("bob", TeamRole::Member, Some("2026-01-01T00:00:00Z"), None),
                    member(
                        "bob",
                        TeamRole::Substitute,
                        Some("2026-01-02T00:00:00Z"),
                        None,
                    ),
                    member("fantome", TeamRole::Member, None, None),
                ],
            ),
        ];
        let problems = check(&games, &users, &teams).unwrap_err();
        assert_eq!(problems.len(), MAX_REPORTED_ERRORS.min(7));
        assert!(problems[0].starts_with("Équipe 2 :") && problems[0].contains("plusieurs fois"));
        assert!(problems[1].starts_with("Équipe 3 :"));
        assert!(
            problems[1].contains("name")
                && problems[1].contains("game")
                && problems[1].contains("owner")
        );
        assert!(problems[2].contains("unique membre actif"));
        assert!(problems[3].contains("unique membre actif"));
        assert!(problems[4].contains("unique membre actif"));
        assert!(
            problems[5].contains("left_at exige joined_at")
                && problems[5].contains("avant d'arriver")
                && problems[5].contains("joined_at invalide")
        );
        assert!(
            problems[6].contains("actif plusieurs fois") && problems[6].contains("compte inconnu")
        );
    }
}
