//! Import et export des tournois, de leur barème et de leurs inscrits en JSON ou en CSV.
//!
//! Le même format sert aux deux sens : un fichier exporté se réimporte sans perte (hors
//! horodatages de création et de modification). Un jeu est désigné par son nom, une statistique
//! par sa clé, un compte par son nom d'utilisateur ; une équipe de tournoi est désignée par son
//! rang (à partir de 0) dans le tableau `teams` du tournoi.
//!
//! - JSON : `{ "version": 1, "tournaments": [{ "game", "name", "description", "start_date",
//!   "end_date", "registration_open_at", "registration_close_at", "participant_type",
//!   "team_size", "max_participants", "team_scoring_mode", "team_scoring_n", "status",
//!   "scoring_rules": [{ "stat", "mode", "coefficient", "points_table" }],
//!   "participants": [{ "user", "team", "status", "registered_at" }],
//!   "teams": [], "steps": [], "matches": [] }] }` ;
//! - CSV : en-tête `game,name,description,start_date,end_date,registration_open_at,
//!   registration_close_at,participant_type,team_size,max_participants,team_scoring_mode,
//!   team_scoring_n,status,scoring_rules,participants,teams,steps,matches` ; les cinq dernières
//!   colonnes contiennent le tableau JSON correspondant.
//!
//! Règle de composition : les équipes de tournoi, les étapes et les matchs sont des valeurs
//! opaques pour ce niveau. Il ne connaît ni leur contenu ni leur structure : leur validation,
//! leur lecture et leur écriture sont déléguées à des [`TournamentChild`], et il se contente de
//! les embarquer dans le fichier. Il ne s'appuie que sur leur ordre pour désigner une équipe.
//!
//! Importer un tournoi existant (même jeu et même nom, sans tenir compte de la casse) le met à
//! jour et **remplace** son barème, ses inscrits, ses équipes, ses étapes et ses matchs. Un
//! tournoi `ongoing` ou `finished` ne s'importe pas : ses résultats sont verrouillés.

use crate::auth::{AppState, Claims};
use crate::error::{ApiError, ErrorResponse};
use crate::game_io::{Format, FormatQuery};
use crate::store::{
    AuthStore, ParticipantImport, ParticipantStatus, ParticipantType, ScoringMode,
    ScoringRuleImport, StoreError, TeamScoringMode, Tournament, TournamentImport, TournamentInput,
    TournamentStatus,
};
use crate::team_io::normalize_timestamp;
use crate::tournaments::{check as check_fields, definition_checked};
use crate::users::require_admin;
use actix_web::http::header::{CONTENT_DISPOSITION, CONTENT_TYPE};
use actix_web::{HttpResponse, get, post, web};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::hash_map::Entry;
use std::collections::{HashMap, HashSet};
use utoipa::ToSchema;
use uuid::Uuid;

const FORMAT_VERSION: u32 = 1;
/// Nombre maximal de problèmes détaillés dans une réponse `400`.
const MAX_REPORTED_ERRORS: usize = 10;
const CSV_HEADER: [&str; 18] = [
    "game",
    "name",
    "description",
    "start_date",
    "end_date",
    "registration_open_at",
    "registration_close_at",
    "participant_type",
    "team_size",
    "max_participants",
    "team_scoring_mode",
    "team_scoring_n",
    "status",
    "scoring_rules",
    "participants",
    "teams",
    "steps",
    "matches",
];

/// Import et export d'un niveau inférieur d'un tournoi (équipes de tournoi, étapes, matchs).
#[async_trait]
pub trait TournamentChild: Send + Sync {
    /// Éléments liés au tournoi, avec leur identifiant, tels qu'ils s'embarquent dans le fichier.
    /// L'ordre est stable : il désigne les éléments dans le fichier.
    async fn export(&self, tournament_id: Uuid) -> Result<Vec<(Uuid, Value)>, StoreError>;

    /// Message d'erreur si `items` est invalide pour un tournoi de ce jeu. Appelée avant toute
    /// écriture.
    async fn validate(&self, game_id: Uuid, items: &[Value]) -> Result<Option<String>, StoreError>;

    /// Remplace les éléments du tournoi par `items`, déjà validés, et renvoie leurs identifiants
    /// dans le même ordre.
    async fn import(&self, tournament_id: Uuid, items: Vec<Value>)
    -> Result<Vec<Uuid>, StoreError>;
}

/// Tant qu'un niveau n'est pas branché : rien à exporter, rien d'accepté.
pub struct NoChild(pub &'static str);

#[async_trait]
impl TournamentChild for NoChild {
    async fn export(&self, _: Uuid) -> Result<Vec<(Uuid, Value)>, StoreError> {
        Ok(Vec::new())
    }

    async fn validate(&self, _: Uuid, items: &[Value]) -> Result<Option<String>, StoreError> {
        Ok((!items.is_empty()).then(|| format!("{} ne sont pas encore prises en charge", self.0)))
    }

    async fn import(&self, _: Uuid, _: Vec<Value>) -> Result<Vec<Uuid>, StoreError> {
        Ok(Vec::new())
    }
}

#[derive(Debug, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
struct Document {
    version: u32,
    tournaments: Vec<ExportedTournament>,
}

#[derive(Debug, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
struct ExportedTournament {
    /// Nom du jeu du tournoi.
    game: String,
    name: String,
    #[serde(default)]
    description: Option<String>,
    /// Horodatages RFC 3339 en UTC (suffixe `Z`).
    start_date: String,
    end_date: String,
    #[serde(default)]
    registration_open_at: Option<String>,
    #[serde(default)]
    registration_close_at: Option<String>,
    participant_type: ParticipantType,
    #[serde(default)]
    team_size: Option<i32>,
    max_participants: i32,
    /// `none` s'il est absent.
    #[serde(default)]
    team_scoring_mode: Option<TeamScoringMode>,
    #[serde(default)]
    team_scoring_n: Option<i32>,
    /// `draft` s'il est absent.
    #[serde(default)]
    status: Option<TournamentStatus>,
    #[serde(default)]
    scoring_rules: Vec<ExportedRule>,
    #[serde(default)]
    participants: Vec<ExportedParticipant>,
    /// Équipes du tournoi, opaques pour ce niveau.
    #[serde(default)]
    #[schema(value_type = Vec<Object>)]
    teams: Vec<Value>,
    /// Étapes du tournoi, opaques pour ce niveau.
    #[serde(default)]
    #[schema(value_type = Vec<Object>)]
    steps: Vec<Value>,
    /// Matchs du tournoi, opaques pour ce niveau.
    #[serde(default)]
    #[schema(value_type = Vec<Object>)]
    matches: Vec<Value>,
}

#[derive(Debug, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
struct ExportedRule {
    /// Clé de la statistique.
    stat: String,
    mode: ScoringMode,
    #[serde(default)]
    coefficient: Option<f64>,
    #[serde(default)]
    #[schema(value_type = Option<Object>)]
    points_table: Option<Value>,
}

#[derive(Debug, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
struct ExportedParticipant {
    /// Nom d'utilisateur du joueur ; absent pour une équipe inscrite seule.
    #[serde(default)]
    user: Option<String>,
    /// Rang (à partir de 0) de l'équipe dans `teams`.
    #[serde(default)]
    team: Option<usize>,
    /// `registered` s'il est absent.
    #[serde(default)]
    status: Option<ParticipantStatus>,
    /// Horodatage RFC 3339 en UTC ; l'instant de l'import s'il est absent.
    #[serde(default)]
    registered_at: Option<String>,
}

/// Résultat d'un import.
#[derive(Serialize, ToSchema)]
struct ImportReport {
    created: usize,
    updated: usize,
}

/// Exporte tous les tournois, leur barème et leurs inscrits (administrateur).
#[utoipa::path(
    get,
    path = "/tournaments/export",
    tag = "tournaments",
    security(("bearer" = [])),
    params(FormatQuery),
    responses(
        (status = 200, description = "Fichier JSON (`Document`) ou CSV, en pièce jointe", body = Document),
        (status = 400, description = "Format inconnu", body = ErrorResponse),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 403, description = "Réservé aux administrateurs", body = ErrorResponse),
    ),
)]
#[get("/tournaments/export")]
pub(crate) async fn export_tournaments(
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
    let stat_keys: HashMap<Uuid, String> = store
        .list_stats(i64::MAX, 0)
        .await
        .map_err(ApiError::internal)?
        .into_iter()
        .map(|stat| (stat.id, stat.key))
        .collect();
    let mut usernames: HashMap<Uuid, String> = HashMap::new();
    let mut exported = Vec::new();
    for tournament in store
        .list_tournaments(None, None, i64::MAX, 0)
        .await
        .map_err(ApiError::internal)?
    {
        let mut scoring_rules = Vec::new();
        for rule in store
            .list_scoring_rules(tournament.id)
            .await
            .map_err(ApiError::internal)?
        {
            scoring_rules.push(ExportedRule {
                stat: stat_keys.get(&rule.stat_id).cloned().unwrap_or_default(),
                mode: rule.mode,
                coefficient: rule.coefficient,
                points_table: rule.points_table,
            });
        }
        let teams = state
            .tournament_teams
            .export(tournament.id)
            .await
            .map_err(ApiError::internal)?;
        let mut participants = Vec::new();
        for participant in store
            .list_participants(tournament.id, i64::MAX, 0)
            .await
            .map_err(ApiError::internal)?
        {
            let user = match participant.user_id {
                Some(id) => Some(username(store.as_ref(), &mut usernames, id).await?),
                None => None,
            };
            participants.push(ExportedParticipant {
                user,
                team: participant
                    .tournament_team_id
                    .and_then(|id| teams.iter().position(|(team_id, _)| *team_id == id)),
                status: Some(participant.status),
                registered_at: Some(participant.registered_at),
            });
        }
        // Ordre indépendant des identifiants : deux exports du même contenu sont identiques.
        participants.sort_by(|a, b| {
            (&a.registered_at, &a.user, a.team).cmp(&(&b.registered_at, &b.user, b.team))
        });
        let steps = state
            .steps
            .export(tournament.id)
            .await
            .map_err(ApiError::internal)?;
        let matches = state
            .matches
            .export(tournament.id)
            .await
            .map_err(ApiError::internal)?;
        let values = |items: Vec<(Uuid, Value)>| items.into_iter().map(|(_, v)| v).collect();
        exported.push(ExportedTournament {
            game: games.get(&tournament.game_id).cloned().unwrap_or_default(),
            name: tournament.name,
            description: tournament.description,
            start_date: tournament.start_date,
            end_date: tournament.end_date,
            registration_open_at: tournament.registration_open_at,
            registration_close_at: tournament.registration_close_at,
            participant_type: tournament.participant_type,
            team_size: tournament.team_size,
            max_participants: tournament.max_participants,
            team_scoring_mode: Some(tournament.team_scoring_mode),
            team_scoring_n: tournament.team_scoring_n,
            status: Some(tournament.status),
            scoring_rules,
            participants,
            teams: values(teams),
            steps: values(steps),
            matches: values(matches),
        });
    }
    exported.sort_by_cached_key(|t| (t.game.to_lowercase(), t.name.to_lowercase()));
    let body = encode(format, exported).map_err(ApiError::internal)?;
    Ok(HttpResponse::Ok()
        .insert_header((CONTENT_TYPE, format.content_type()))
        .insert_header((
            CONTENT_DISPOSITION,
            format!(
                "attachment; filename=\"tournaments.{}\"",
                format.extension()
            ),
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

/// Importe des tournois, leur barème et leurs inscrits depuis un fichier JSON ou CSV
/// (administrateur).
///
/// Un tournoi du fichier dont le jeu et le nom (sans tenir compte de la casse) existent déjà met
/// à jour ce tournoi et **remplace** son barème, ses inscrits, ses équipes, ses étapes et ses
/// matchs ; sinon il est créé. Les jeux, statistiques (liées au jeu) et comptes du fichier
/// doivent exister, et un tournoi existant `ongoing` ou `finished` est refusé. Le fichier est
/// validé en entier avant toute écriture.
#[utoipa::path(
    post,
    path = "/tournaments/import",
    tag = "tournaments",
    security(("bearer" = [])),
    params(FormatQuery),
    request_body(content = String, content_type = "text/plain", description = "Contenu du fichier, 256 Kio au maximum"),
    responses(
        (status = 200, description = "Tournois créés et mis à jour", body = ImportReport),
        (status = 400, description = "Fichier invalide (`errors.file` détaille les problèmes)", body = ErrorResponse),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 403, description = "Réservé aux administrateurs", body = ErrorResponse),
    ),
)]
#[post("/tournaments/import")]
pub(crate) async fn import_tournaments(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    query: web::Query<FormatQuery>,
    body: web::Bytes,
) -> Result<HttpResponse, ApiError> {
    require_admin(&state, &claims).await?;
    let format = query.format.unwrap_or_default();
    let tournaments = decode(format, &body).map_err(file_error)?;
    let lookups = Lookups::load(&state, &tournaments).await?;
    let prepared = match prepare(&state, &lookups, tournaments).await? {
        Ok(prepared) => prepared,
        Err(problems) => return Err(file_error(problems)),
    };

    let (imports, files): (Vec<_>, Vec<_>) = prepared
        .into_iter()
        .map(|p| (p.import, (p.participants, p.teams, p.steps, p.matches)))
        .unzip();
    let saved = state
        .store
        .import_tournaments(imports)
        .await
        .map_err(ApiError::internal)?;
    let mut report = ImportReport {
        created: 0,
        updated: 0,
    };
    for ((tournament, created), (participants, teams, steps, matches)) in
        saved.into_iter().zip(files)
    {
        let team_ids = state
            .tournament_teams
            .import(tournament.id, teams)
            .await
            .map_err(ApiError::internal)?;
        state
            .steps
            .import(tournament.id, steps)
            .await
            .map_err(ApiError::internal)?;
        state
            .matches
            .import(tournament.id, matches)
            .await
            .map_err(ApiError::internal)?;
        let participants = participants
            .into_iter()
            .map(|p| ParticipantImport {
                user_id: p.user_id,
                tournament_team_id: p.team.and_then(|rank| team_ids.get(rank).copied()),
                status: p.status,
                registered_at: p.registered_at,
            })
            .collect();
        state
            .store
            .replace_participants(tournament.id, participants)
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

/// Ce que le fichier désigne dans la base.
struct Lookups {
    /// Jeux par nom en minuscules.
    games: HashMap<String, Uuid>,
    /// Statistiques par clé.
    stats: HashMap<String, Uuid>,
    /// Liaisons (statistique, jeu) existantes.
    links: HashSet<(Uuid, Uuid)>,
    /// Comptes par nom d'utilisateur en minuscules, `None` s'il n'existe pas.
    users: HashMap<String, Option<Uuid>>,
    /// Tournois existants par (jeu, nom en minuscules).
    existing: HashMap<(Uuid, String), Tournament>,
}

impl Lookups {
    async fn load(state: &AppState, tournaments: &[ExportedTournament]) -> Result<Self, ApiError> {
        let store = &state.store;
        let games: HashMap<String, Uuid> = store
            .list_games(i64::MAX, 0)
            .await
            .map_err(ApiError::internal)?
            .into_iter()
            .map(|game| (game.name.to_lowercase(), game.id))
            .collect();
        let stats = store
            .list_stats(i64::MAX, 0)
            .await
            .map_err(ApiError::internal)?
            .into_iter()
            .map(|stat| (stat.key, stat.id))
            .collect();
        let mut links = HashSet::new();
        let mut existing = HashMap::new();
        let used_games: HashSet<Uuid> = tournaments
            .iter()
            .filter_map(|t| games.get(&t.game.trim().to_lowercase()).copied())
            .collect();
        for game_id in used_games {
            for stat in store
                .list_game_stats(game_id)
                .await
                .map_err(ApiError::internal)?
                .unwrap_or_default()
            {
                links.insert((stat.id, game_id));
            }
            for tournament in store
                .list_tournaments(Some(game_id), None, i64::MAX, 0)
                .await
                .map_err(ApiError::internal)?
            {
                existing.insert((game_id, tournament.name.to_lowercase()), tournament);
            }
        }
        let mut users: HashMap<String, Option<Uuid>> = HashMap::new();
        for name in tournaments
            .iter()
            .flat_map(|t| t.participants.iter().filter_map(|p| p.user.as_deref()))
        {
            let key = name.trim().to_lowercase();
            if let Entry::Vacant(slot) = users.entry(key) {
                let id = store
                    .find_user_by_username(name.trim())
                    .await
                    .map_err(ApiError::internal)?
                    .map(|user| user.id);
                slot.insert(id);
            }
        }
        Ok(Lookups {
            games,
            stats,
            links,
            users,
            existing,
        })
    }
}

/// Inscription prête à écrire ; `team` est le rang de l'équipe dans le fichier.
struct PreparedParticipant {
    user_id: Option<Uuid>,
    team: Option<usize>,
    status: ParticipantStatus,
    registered_at: Option<String>,
}

struct Prepared {
    import: TournamentImport,
    participants: Vec<PreparedParticipant>,
    teams: Vec<Value>,
    steps: Vec<Value>,
    matches: Vec<Value>,
}

/// Tournois prêts à écrire, ou les problèmes du fichier, un message par tournoi invalide (les
/// premiers seulement).
async fn prepare(
    state: &AppState,
    lookups: &Lookups,
    tournaments: Vec<ExportedTournament>,
) -> Result<Result<Vec<Prepared>, Vec<String>>, ApiError> {
    let mut problems = Vec::new();
    let mut prepared = Vec::new();
    let mut seen = HashSet::new();
    for (index, tournament) in tournaments.into_iter().enumerate() {
        let game_id = lookups
            .games
            .get(&tournament.game.trim().to_lowercase())
            .copied();
        let mut input = TournamentInput {
            game_id: game_id.unwrap_or_default(),
            name: tournament.name.clone(),
            description: tournament.description.clone(),
            start_date: tournament.start_date.clone(),
            end_date: tournament.end_date.clone(),
            registration_open_at: tournament.registration_open_at.clone(),
            registration_close_at: tournament.registration_close_at.clone(),
            participant_type: tournament.participant_type,
            team_size: tournament.team_size,
            max_participants: tournament.max_participants,
            team_scoring_mode: tournament
                .team_scoring_mode
                .unwrap_or(TeamScoringMode::None),
            team_scoring_n: tournament.team_scoring_n,
        };
        let mut reasons: Vec<String> = check_fields(&mut input)
            .into_iter()
            .map(|(field, message)| format!("{field} : {message}"))
            .collect();
        match game_id {
            None => reasons.push(format!("game : jeu inconnu « {} ».", tournament.game)),
            Some(game_id) => {
                if !seen.insert((game_id, input.name.to_lowercase())) {
                    reasons
                        .push("name : ce tournoi apparaît plusieurs fois dans le fichier.".into());
                }
                if let Some(current) = lookups.existing.get(&(game_id, input.name.to_lowercase()))
                    && matches!(
                        current.status,
                        TournamentStatus::Ongoing | TournamentStatus::Finished
                    )
                {
                    reasons.push(
                        "ce tournoi existe et il est en cours ou terminé : import impossible."
                            .into(),
                    );
                }
            }
        }
        let rules = check_rules(lookups, game_id, &tournament.scoring_rules, &mut reasons);
        let participants = check_participants(lookups, &tournament, &mut reasons);
        if let Some(game_id) = game_id {
            for (label, items) in [
                ("teams", &tournament.teams),
                ("steps", &tournament.steps),
                ("matches", &tournament.matches),
            ] {
                let child: &dyn TournamentChild = match label {
                    "teams" => state.tournament_teams.as_ref(),
                    "steps" => state.steps.as_ref(),
                    _ => state.matches.as_ref(),
                };
                if let Some(problem) = child
                    .validate(game_id, items)
                    .await
                    .map_err(ApiError::internal)?
                {
                    reasons.push(format!("{label} : {problem}"));
                }
            }
        }
        if reasons.is_empty() {
            prepared.push(Prepared {
                import: TournamentImport {
                    input,
                    status: tournament.status.unwrap_or(TournamentStatus::Draft),
                    rules,
                },
                participants,
                teams: tournament.teams,
                steps: tournament.steps,
                matches: tournament.matches,
            });
        } else {
            problems.push(format!("Tournoi {} : {}", index + 1, reasons.join(" ")));
        }
    }
    if problems.is_empty() {
        Ok(Ok(prepared))
    } else {
        problems.truncate(MAX_REPORTED_ERRORS);
        Ok(Err(problems))
    }
}

fn check_rules(
    lookups: &Lookups,
    game_id: Option<Uuid>,
    rules: &[ExportedRule],
    reasons: &mut Vec<String>,
) -> Vec<ScoringRuleImport> {
    let mut out = Vec::with_capacity(rules.len());
    let mut stats = HashSet::new();
    for rule in rules {
        let Some(stat_id) = lookups.stats.get(rule.stat.trim()).copied() else {
            reasons.push(format!(
                "scoring_rules : statistique inconnue « {} ».",
                rule.stat
            ));
            continue;
        };
        if game_id.is_some_and(|game| !lookups.links.contains(&(stat_id, game))) {
            reasons.push(format!(
                "scoring_rules : la statistique « {} » n'est pas liée au jeu du tournoi.",
                rule.stat
            ));
        }
        if !stats.insert(stat_id) {
            reasons.push(format!(
                "scoring_rules : la statistique « {} » apparaît plusieurs fois.",
                rule.stat
            ));
        }
        match definition_checked(rule.mode, rule.coefficient, rule.points_table.clone()) {
            Ok(definition) => out.push(ScoringRuleImport {
                stat_id,
                definition,
            }),
            Err(errors) => reasons.extend(errors.into_iter().map(|(field, message)| {
                format!("scoring_rules « {} » : {field} : {message}", rule.stat)
            })),
        }
    }
    out
}

fn check_participants(
    lookups: &Lookups,
    tournament: &ExportedTournament,
    reasons: &mut Vec<String>,
) -> Vec<PreparedParticipant> {
    let mut out = Vec::with_capacity(tournament.participants.len());
    let mut users = HashSet::new();
    let mut teams = HashSet::new();
    for participant in &tournament.participants {
        let user_id = match participant.user.as_deref() {
            None => None,
            Some(name) => match lookups
                .users
                .get(&name.trim().to_lowercase())
                .copied()
                .flatten()
            {
                Some(id) => {
                    if !users.insert(id) {
                        reasons.push(format!(
                            "participants : « {name} » apparaît plusieurs fois."
                        ));
                    }
                    Some(id)
                }
                None => {
                    reasons.push(format!("participants : compte inconnu « {name} »."));
                    continue;
                }
            },
        };
        match tournament.participant_type {
            ParticipantType::Solo if user_id.is_none() => reasons.push(
                "participants : un tournoi solo inscrit des joueurs (`user` est obligatoire)."
                    .into(),
            ),
            ParticipantType::Team if user_id.is_some() || participant.team.is_none() => reasons
                .push(
                    "participants : un tournoi par équipes inscrit des équipes (`team` seul)."
                        .into(),
                ),
            _ => {}
        }
        if let Some(rank) = participant.team {
            if rank >= tournament.teams.len() {
                reasons.push(format!(
                    "participants : l'équipe {rank} n'existe pas (le tournoi en compte {}).",
                    tournament.teams.len()
                ));
            } else if user_id.is_none() && !teams.insert(rank) {
                reasons.push(format!(
                    "participants : l'équipe {rank} est inscrite plusieurs fois."
                ));
            }
        }
        let registered_at = match participant
            .registered_at
            .as_deref()
            .map(normalize_timestamp)
        {
            Some(Some(ts)) => Some(ts),
            Some(None) => {
                reasons.push("participants : registered_at invalide.".into());
                continue;
            }
            None => None,
        };
        out.push(PreparedParticipant {
            user_id,
            team: participant.team,
            status: participant.status.unwrap_or(ParticipantStatus::Registered),
            registered_at,
        });
    }
    let active = out
        .iter()
        .filter(|p| p.status != ParticipantStatus::Withdrawn)
        .count();
    if i64::try_from(active).unwrap_or(i64::MAX) > i64::from(tournament.max_participants) {
        reasons.push(format!(
            "participants : {active} inscrits pour {} places.",
            tournament.max_participants
        ));
    }
    out
}

fn encode(format: Format, tournaments: Vec<ExportedTournament>) -> Result<Vec<u8>, String> {
    match format {
        Format::Json => serde_json::to_vec_pretty(&Document {
            version: FORMAT_VERSION,
            tournaments,
        })
        .map_err(|e| e.to_string()),
        Format::Csv => {
            let mut writer = csv::Writer::from_writer(Vec::new());
            writer.write_record(CSV_HEADER).map_err(|e| e.to_string())?;
            for t in tournaments {
                let optional = |value: &Option<String>| value.clone().unwrap_or_default();
                let number = |value: Option<i32>| value.map(|n| n.to_string()).unwrap_or_default();
                let text = |value: serde_json::Result<Value>| -> Result<String, String> {
                    value.map(|v| v.to_string()).map_err(|e| e.to_string())
                };
                writer
                    .write_record([
                        t.game.clone(),
                        t.name.clone(),
                        optional(&t.description),
                        t.start_date.clone(),
                        t.end_date.clone(),
                        optional(&t.registration_open_at),
                        optional(&t.registration_close_at),
                        t.participant_type.as_str().to_string(),
                        number(t.team_size),
                        t.max_participants.to_string(),
                        t.team_scoring_mode
                            .map(|m| m.as_str().to_string())
                            .unwrap_or_default(),
                        number(t.team_scoring_n),
                        t.status.map(|s| s.as_str().to_string()).unwrap_or_default(),
                        text(serde_json::to_value(&t.scoring_rules))?,
                        text(serde_json::to_value(&t.participants))?,
                        text(Ok(Value::Array(t.teams.clone())))?,
                        text(Ok(Value::Array(t.steps.clone())))?,
                        text(Ok(Value::Array(t.matches.clone())))?,
                    ])
                    .map_err(|e| e.to_string())?;
            }
            writer.into_inner().map_err(|e| e.to_string())
        }
    }
}

/// Lit un fichier ; les erreurs sont des messages destinés à l'utilisateur.
fn decode(format: Format, bytes: &[u8]) -> Result<Vec<ExportedTournament>, Vec<String>> {
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
            Ok(document.tournaments)
        }
        Format::Csv => decode_csv(text),
    }
}

/// Lit une énumération écrite en toutes lettres dans une cellule CSV.
fn parse_word<T: serde::de::DeserializeOwned>(
    line: usize,
    name: &str,
    value: Option<String>,
) -> Result<Option<T>, Vec<String>> {
    value
        .map(|word| serde_json::from_value(Value::String(word)))
        .transpose()
        .map_err(|e| vec![format!("Ligne {line} : {name} invalide ({e}).")])
}

fn decode_csv(text: &str) -> Result<Vec<ExportedTournament>, Vec<String>> {
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
    let mut tournaments = Vec::new();
    for (index, record) in reader.records().enumerate() {
        let line = index + 2;
        let record = record.map_err(|e| vec![format!("Ligne {line} : {e}.")])?;
        let cell = |name: &str| -> &str {
            let column = CSV_HEADER.iter().position(|h| *h == name).unwrap_or(0);
            record.get(column).unwrap_or("")
        };
        let optional = |name: &str| Some(cell(name).to_string()).filter(|v| !v.is_empty());
        let number = |name: &str| -> Result<Option<i32>, Vec<String>> {
            match cell(name) {
                "" => Ok(None),
                value => value
                    .parse()
                    .map(Some)
                    .map_err(|_| vec![format!("Ligne {line} : {name} invalide.")]),
            }
        };
        let json = |name: &str| -> Result<Vec<Value>, Vec<String>> {
            match cell(name) {
                "" => Ok(Vec::new()),
                value => serde_json::from_str(value)
                    .map_err(|e| vec![format!("Ligne {line} : {name} invalide ({e}).")]),
            }
        };
        let word = |name: &str| optional(name);
        let participant_type = parse_word(line, "participant_type", word("participant_type"))?
            .ok_or_else(|| vec![format!("Ligne {line} : participant_type est obligatoire.")])?;
        let max_participants = number("max_participants")?
            .ok_or_else(|| vec![format!("Ligne {line} : max_participants est obligatoire.")])?;
        tournaments.push(ExportedTournament {
            game: cell("game").to_string(),
            name: cell("name").to_string(),
            description: optional("description"),
            start_date: cell("start_date").to_string(),
            end_date: cell("end_date").to_string(),
            registration_open_at: optional("registration_open_at"),
            registration_close_at: optional("registration_close_at"),
            participant_type,
            team_size: number("team_size")?,
            max_participants,
            team_scoring_mode: parse_word(line, "team_scoring_mode", word("team_scoring_mode"))?,
            team_scoring_n: number("team_scoring_n")?,
            status: parse_word(line, "status", word("status"))?,
            scoring_rules: serde_json::from_value(Value::Array(json("scoring_rules")?))
                .map_err(|e| vec![format!("Ligne {line} : scoring_rules invalide ({e}).")])?,
            participants: serde_json::from_value(Value::Array(json("participants")?))
                .map_err(|e| vec![format!("Ligne {line} : participants invalide ({e}).")])?,
            teams: json("teams")?,
            steps: json("steps")?,
            matches: json("matches")?,
        });
    }
    Ok(tournaments)
}
