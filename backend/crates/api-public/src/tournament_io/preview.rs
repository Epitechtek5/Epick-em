//! Import de tournois en quatre temps : lire, valider, planifier, appliquer.
//!
//! [`analyze`] lit le fichier, le valide et en tire un [`ImportPlan`] entièrement résolu, sans
//! rien écrire. [`preview`] en fait un aperçu structuré (créations, mises à jour, remplacements,
//! suppressions, avertissements, erreurs) et le garde dix minutes sous un identifiant à usage
//! unique, lié au contenu du fichier, à son auteur et à l'état de la base. [`confirm`] refait
//! l'analyse et refuse l'aperçu s'il a expiré, si l'état de la base a changé ou si des opérations
//! destructives n'ont pas été confirmées : jamais un autre ensemble de changements que celui qui a
//! été montré. [`apply`] écrit tout le plan en **une seule transaction**
//! ([`AuthStore::apply_import`]) ; le plan est recalculé en entier depuis le fichier, si bien
//! qu'une confirmation répétée ne peut ni dupliquer d'opérations ni cumuler des points.
//!
//! Limite : la comparaison de l'état de la base précède l'écriture ; un tournoi modifié entre les
//! deux est tout de même protégé par le verrou et la revérification de son statut dans la
//! transaction, mais pas ses autres données.

use super::*;
use crate::store::{ImportPlan, ParticipantPlan, TournamentPlan};
use infra::Ttl;
use sha2::{Digest, Sha256};
use std::time::{SystemTime, UNIX_EPOCH};

/// Durée de validité d'un aperçu.
const PREVIEW_TTL_SECS: u64 = 600;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub(super) enum ChangeAction {
    /// La ressource n'existe pas encore.
    Create,
    /// La ressource existe et certains champs changent.
    Update,
    /// Toutes les ressources existantes sont remplacées par celles du fichier.
    Replace,
    /// Les ressources existantes sont supprimées : le fichier n'en contient aucune.
    Delete,
}

/// Changement d'une famille de ressources d'un tournoi.
#[derive(Debug, Serialize, ToSchema)]
pub(super) struct ResourceChange {
    /// `tournament`, `scoring_rules`, `participants`, `teams`, `steps` ou `matches`.
    resource: String,
    action: ChangeAction,
    /// Nombre d'éléments avant l'import (0 pour un tournoi créé).
    before: usize,
    /// Nombre d'éléments après l'import.
    after: usize,
    /// Pour une mise à jour du tournoi : les champs modifiés.
    #[serde(skip_serializing_if = "Option::is_none")]
    details: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub(super) struct TournamentChanges {
    game: String,
    name: String,
    /// `create` ou `update`.
    action: ChangeAction,
    /// Vrai si l'import remplace ou supprime des inscrits, équipes, étapes ou matchs existants.
    destructive: bool,
    changes: Vec<ResourceChange>,
    /// Conséquences en aval : résultats traités, classements recalculés, données écrasées.
    downstream: Vec<String>,
}

/// Aperçu d'un import : rien n'a été écrit.
#[derive(Debug, Serialize, ToSchema)]
pub(super) struct ImportPreview {
    /// Identifiant à usage unique à confirmer (`POST /tournaments/import/apply`) ; absent si le
    /// fichier est invalide.
    #[serde(skip_serializing_if = "Option::is_none")]
    preview_id: Option<Uuid>,
    /// Durée de validité restante de l'aperçu, en secondes.
    #[serde(skip_serializing_if = "Option::is_none")]
    expires_in: Option<u64>,
    /// Faux si le fichier a des erreurs : il ne peut pas être appliqué.
    valid: bool,
    /// Vrai si la confirmation doit être explicite (`confirm_destructive`).
    requires_confirmation: bool,
    tournaments: Vec<TournamentChanges>,
    /// Écarts à connaître avant d'appliquer (données remplacées, valeurs recalculées).
    warnings: Vec<String>,
    /// Erreurs de validation du fichier.
    errors: Vec<String>,
}

/// Confirmation d'un aperçu.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub(crate) struct ApplyRequest {
    preview_id: Uuid,
    /// Obligatoire quand l'aperçu `requires_confirmation`.
    #[serde(default)]
    confirm_destructive: bool,
}

/// Résultat de l'analyse d'un fichier valide.
pub(super) struct Analysis {
    /// Plan atomique ; `None` si un sous-niveau ne sait pas se planifier (écriture niveau par
    /// niveau, sans atomicité entre les niveaux).
    plan: Option<ImportPlan>,
    prepared: Vec<Prepared>,
    tournaments: Vec<TournamentChanges>,
    warnings: Vec<String>,
    fingerprint: String,
    destructive: bool,
}

/// Aperçu gardé en cache pendant [`PREVIEW_TTL_SECS`].
#[derive(Serialize, Deserialize)]
struct Stored {
    csv: bool,
    text: String,
    owner: Uuid,
    fingerprint: String,
    expires_at: u64,
}

fn cache_key(id: Uuid) -> String {
    format!("import-preview:{id}")
}

fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs())
}

/// Ce qu'un tournoi existant contient aujourd'hui.
struct Current {
    rules: usize,
    participants: usize,
    teams: usize,
    steps: usize,
    started_steps: usize,
    matches: usize,
    finished_matches: usize,
    /// Contenu complet, pour détecter tout changement entre l'aperçu et la confirmation.
    signature: Value,
}

async fn current(state: &AppState, tournament: &Tournament) -> Result<Current, ApiError> {
    let store = &state.store;
    let rules = store
        .list_scoring_rules(tournament.id)
        .await
        .map_err(ApiError::internal)?;
    let participants = store
        .list_participants(tournament.id, i64::MAX, 0)
        .await
        .map_err(ApiError::internal)?;
    let teams = state
        .tournament_teams
        .export(tournament.id)
        .await
        .map_err(ApiError::internal)?;
    let team_order: Vec<Uuid> = teams.iter().map(|(id, _)| *id).collect();
    let steps = state
        .steps
        .export_in(tournament.id, &team_order)
        .await
        .map_err(ApiError::internal)?;
    let matches = state
        .matches
        .export(tournament.id)
        .await
        .map_err(ApiError::internal)?;
    let (mut count, mut finished, mut started) = (matches.len(), 0, 0);
    for (_, step) in &steps {
        if step
            .get("status")
            .and_then(Value::as_str)
            .is_some_and(|s| s != "pending")
        {
            started += 1;
        }
        for item in step
            .get("matches")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            count += 1;
            if item.get("status").and_then(Value::as_str) == Some("finished") {
                finished += 1;
            }
        }
    }
    let values =
        |items: &[(Uuid, Value)]| -> Vec<Value> { items.iter().map(|(_, v)| v.clone()).collect() };
    Ok(Current {
        rules: rules.len(),
        participants: participants.len(),
        teams: teams.len(),
        steps: steps.len(),
        started_steps: started,
        matches: count,
        finished_matches: finished,
        signature: serde_json::json!({
            "tournament": tournament,
            "rules": rules,
            "participants": participants,
            "teams": values(&teams),
            "steps": values(&steps),
            "matches": values(&matches),
        }),
    })
}

/// Champs du tournoi qui changent.
fn changed_fields(current: &Tournament, import: &TournamentImport) -> Vec<&'static str> {
    let input = &import.input;
    let mut changed = Vec::new();
    let mut note = |name: &'static str, differs: bool| {
        if differs {
            changed.push(name);
        }
    };
    note("name", current.name != input.name);
    note("description", current.description != input.description);
    note("start_date", current.start_date != input.start_date);
    note("end_date", current.end_date != input.end_date);
    note(
        "registration_open_at",
        current.registration_open_at != input.registration_open_at,
    );
    note(
        "registration_close_at",
        current.registration_close_at != input.registration_close_at,
    );
    note(
        "participant_type",
        current.participant_type != input.participant_type,
    );
    note("team_size", current.team_size != input.team_size);
    note(
        "max_participants",
        current.max_participants != input.max_participants,
    );
    note(
        "team_scoring_mode",
        current.team_scoring_mode != input.team_scoring_mode,
    );
    note(
        "team_scoring_n",
        current.team_scoring_n != input.team_scoring_n,
    );
    note("status", current.status != import.status);
    changed
}

fn resource_change(resource: &str, before: usize, after: usize) -> Option<ResourceChange> {
    let action = match (before, after) {
        (0, 0) => return None,
        (0, _) => ChangeAction::Create,
        (_, 0) => ChangeAction::Delete,
        _ => ChangeAction::Replace,
    };
    Some(ResourceChange {
        resource: resource.to_string(),
        action,
        before,
        after,
        details: None,
    })
}

/// Lit, valide et planifie le fichier ; rien n'est écrit. `Err` : les problèmes du fichier.
pub(super) async fn analyze(
    state: &AppState,
    format: Format,
    bytes: &[u8],
) -> Result<Result<Analysis, Vec<String>>, ApiError> {
    let tournaments = match decode(format, bytes) {
        Ok(tournaments) => tournaments,
        Err(problems) => return Ok(Err(problems)),
    };
    let lookups = Lookups::load(state, &tournaments).await?;
    let prepared = match prepare(state, &lookups, tournaments).await? {
        Ok(prepared) => prepared,
        Err(problems) => return Ok(Err(problems)),
    };

    // Planification : chaque sous-niveau calcule ce qui se déduit du fichier.
    let mut atomic = true;
    let mut warnings = Vec::new();
    let mut problems = Vec::new();
    let mut plans = Vec::with_capacity(prepared.len());
    for item in &prepared {
        let game_id = item.import.input.game_id;
        let planned = async {
            let teams = state
                .tournament_teams
                .plan_in(game_id, &item.teams, &item.plan_scope)
                .await?;
            let steps = state
                .steps
                .plan_in(game_id, &item.steps, &item.plan_scope)
                .await?;
            Ok::<_, StoreError>((teams, steps))
        }
        .await;
        // Une incohérence du fichier détectée en planifiant est une erreur de validation.
        let (teams, steps) = match planned {
            Ok(planned) => planned,
            Err(StoreError::InvalidPlan(problem)) => {
                problems.push(format!(
                    "Tournoi « {} » : {problem}",
                    item.import.input.name
                ));
                continue;
            }
            Err(other) => return Err(ApiError::internal(other)),
        };
        match (teams, steps) {
            (
                Some(ChildPlan::Teams(teams)),
                Some(ChildPlan::Steps {
                    steps,
                    warnings: found,
                }),
            ) if item.matches.is_empty() => {
                warnings.extend(
                    found
                        .into_iter()
                        .map(|w| format!("« {} » : {w}", item.import.input.name)),
                );
                plans.push(TournamentPlan {
                    import: item.import.clone(),
                    teams,
                    participants: item
                        .participants
                        .iter()
                        .map(|p| ParticipantPlan {
                            user_id: p.user_id,
                            team: p.team,
                            status: p.status,
                            registered_at: p.registered_at.clone(),
                        })
                        .collect(),
                    steps,
                });
            }
            _ => atomic = false,
        }
    }

    if !problems.is_empty() {
        problems.truncate(MAX_REPORTED_ERRORS);
        return Ok(Err(problems));
    }

    // Comparaison avec la base.
    let mut changes = Vec::with_capacity(prepared.len());
    let mut destructive = false;
    let mut signatures = Vec::with_capacity(prepared.len());
    for (index, item) in prepared.iter().enumerate() {
        let input = &item.import.input;
        let existing = lookups
            .existing
            .get(&(input.game_id, input.name.to_lowercase()));
        let current = match existing {
            Some(tournament) => Some((tournament, current(state, tournament).await?)),
            None => None,
        };
        signatures.push(current.as_ref().map(|(_, c)| c.signature.to_string()));
        let after_matches = item.matches.len()
            + item
                .steps
                .iter()
                .map(|s| {
                    s.get("matches")
                        .and_then(Value::as_array)
                        .map_or(0, Vec::len)
                })
                .sum::<usize>();
        let (action, mut list) = match &current {
            None => (
                ChangeAction::Create,
                vec![ResourceChange {
                    resource: "tournament".into(),
                    action: ChangeAction::Create,
                    before: 0,
                    after: 1,
                    details: None,
                }],
            ),
            Some((tournament, _)) => {
                let fields = changed_fields(tournament, &item.import);
                (
                    ChangeAction::Update,
                    vec![ResourceChange {
                        resource: "tournament".into(),
                        action: ChangeAction::Update,
                        before: 1,
                        after: 1,
                        details: Some(if fields.is_empty() {
                            "aucun champ modifié".to_string()
                        } else {
                            fields.join(", ")
                        }),
                    }],
                )
            }
        };
        let before = |pick: fn(&Current) -> usize| current.as_ref().map_or(0, |(_, c)| pick(c));
        list.extend(
            [
                resource_change(
                    "scoring_rules",
                    before(|c| c.rules),
                    item.import.rules.len(),
                ),
                resource_change(
                    "participants",
                    before(|c| c.participants),
                    item.participants.len(),
                ),
                resource_change("teams", before(|c| c.teams), item.teams.len()),
                resource_change("steps", before(|c| c.steps), item.steps.len()),
                resource_change("matches", before(|c| c.matches), after_matches),
            ]
            .into_iter()
            .flatten(),
        );
        let replaces = current
            .as_ref()
            .is_some_and(|(_, c)| c.participants + c.teams + c.steps + c.matches > 0);
        destructive |= replaces;
        let mut downstream = Vec::new();
        if let Some((_, c)) = &current {
            if c.finished_matches > 0 {
                downstream.push(format!(
                    "{} résultat(s) de match terminé(s) existant(s) seront écrasés.",
                    c.finished_matches
                ));
            }
            if c.started_steps > 0 {
                downstream.push(format!(
                    "{} étape(s) lancée(s) existante(s) seront remplacées, avec leurs classements.",
                    c.started_steps
                ));
            }
            if replaces {
                warnings.push(format!(
                    "« {} » existe : ses inscrits, équipes, étapes et matchs seront remplacés.",
                    input.name
                ));
            }
        }
        if let Some(plan) = plans.get(index).filter(|_| atomic) {
            for step in plan
                .steps
                .iter()
                .filter(|s| s.status != crate::store::StepStatus::Pending)
            {
                let members: usize = step.groups.iter().map(Vec::len).sum();
                let finished = step
                    .matches
                    .iter()
                    .filter(|m| m.status == crate::store::MatchStatus::Finished)
                    .count();
                let seeded = step
                    .groups
                    .iter()
                    .flatten()
                    .filter(|m| m.seed.is_some())
                    .count();
                let mut line = format!(
                    "étape {} ({}) : {members} participant(s) en {} groupe(s)",
                    step.definition.position,
                    step.status.as_str(),
                    step.groups.len()
                );
                if seeded > 0 {
                    line.push_str(&format!(", {seeded} tête(s) de série"));
                }
                if finished > 0 {
                    line.push_str(&format!(
                        ", {finished} match(s) terminé(s) traité(s) selon le barème (points, progression des vainqueurs)"
                    ));
                }
                if step.status == crate::store::StepStatus::Finished {
                    line.push_str(", classement final et qualifiés calculés");
                }
                line.push('.');
                downstream.push(line);
            }
        }
        changes.push(TournamentChanges {
            game: item.game.clone(),
            name: input.name.clone(),
            action,
            destructive: replaces,
            changes: list,
            downstream,
        });
    }

    // Empreinte : le fichier, ce qu'il désigne dans la base (le plan) et l'état de ce qu'il remplace.
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hasher.update([u8::from(atomic)]);
    match atomic {
        true => hasher.update(format!(
            "{:?}",
            ImportPlan {
                tournaments: plans.clone()
            }
        )),
        false => {
            for item in &prepared {
                hasher.update(format!("{:?}", item.import));
                hasher.update(Value::Array(item.teams.clone()).to_string());
                hasher.update(Value::Array(item.steps.clone()).to_string());
                hasher.update(Value::Array(item.matches.clone()).to_string());
            }
        }
    }
    for signature in &signatures {
        hasher.update(signature.as_deref().unwrap_or("absent"));
    }
    Ok(Ok(Analysis {
        plan: atomic.then_some(ImportPlan { tournaments: plans }),
        prepared,
        tournaments: changes,
        warnings,
        fingerprint: format!("{:x}", hasher.finalize()),
        destructive,
    }))
}

/// Aperçu d'un fichier : rien n'est écrit. Un fichier valide reçoit un identifiant à confirmer.
pub(super) async fn preview(
    state: &AppState,
    owner: Uuid,
    format: Format,
    bytes: &[u8],
) -> Result<ImportPreview, ApiError> {
    let analysis = match analyze(state, format, bytes).await? {
        Ok(analysis) => analysis,
        Err(errors) => {
            return Ok(ImportPreview {
                preview_id: None,
                expires_in: None,
                valid: false,
                requires_confirmation: false,
                tournaments: Vec::new(),
                warnings: Vec::new(),
                errors,
            });
        }
    };
    let id = Uuid::new_v4();
    let stored = Stored {
        csv: format == Format::Csv,
        text: String::from_utf8_lossy(bytes).into_owned(),
        owner,
        fingerprint: analysis.fingerprint.clone(),
        expires_at: unix_now() + PREVIEW_TTL_SECS,
    };
    let value = serde_json::to_vec(&stored).map_err(ApiError::internal)?;
    state
        .cache
        .set(&cache_key(id), value, Ttl::from_secs(PREVIEW_TTL_SECS))
        .await
        .map_err(ApiError::internal)?;
    Ok(ImportPreview {
        preview_id: Some(id),
        expires_in: Some(PREVIEW_TTL_SECS),
        valid: true,
        requires_confirmation: analysis.destructive,
        tournaments: analysis.tournaments,
        warnings: analysis.warnings,
        errors: Vec::new(),
    })
}

/// Applique un aperçu confirmé : refuse celui qui est inconnu, expiré, déjà appliqué, périmé ou
/// dont les opérations destructives ne sont pas confirmées.
pub(super) async fn confirm(
    state: &AppState,
    owner: Uuid,
    request: ApplyRequest,
) -> Result<ImportReport, ApiError> {
    let key = cache_key(request.preview_id);
    let bytes = state
        .cache
        .get(&key)
        .await
        .map_err(ApiError::internal)?
        .ok_or(ApiError::ImportPreviewExpired)?;
    let stored: Stored =
        serde_json::from_slice(&bytes).map_err(|_| ApiError::ImportPreviewExpired)?;
    let forget = || async {
        if let Err(err) = state.cache.delete(&[&key]).await {
            eprintln!("cache : échec de la suppression de {key} : {err}");
        }
    };
    if stored.owner != owner || stored.expires_at < unix_now() {
        forget().await;
        return Err(ApiError::ImportPreviewExpired);
    }
    let format = if stored.csv {
        Format::Csv
    } else {
        Format::Json
    };
    let analysis = match analyze(state, format, stored.text.as_bytes()).await? {
        Ok(analysis) if analysis.fingerprint == stored.fingerprint => analysis,
        _ => {
            forget().await;
            return Err(ApiError::ImportPreviewStale);
        }
    };
    if analysis.destructive && !request.confirm_destructive {
        return Err(ApiError::ImportConfirmationRequired);
    }
    // À usage unique : l'aperçu disparaît avant l'écriture.
    forget().await;
    apply(state, analysis).await
}

/// Écrit l'analyse : en une seule transaction quand elle a un plan, sinon niveau par niveau.
pub(super) async fn apply(state: &AppState, analysis: Analysis) -> Result<ImportReport, ApiError> {
    let mut report = ImportReport {
        created: 0,
        updated: 0,
    };
    if let Some(plan) = analysis.plan {
        let saved = state
            .store
            .apply_import(plan)
            .await
            .map_err(|err| match err {
                StoreError::TournamentLocked => ApiError::TournamentLocked,
                StoreError::StepPositionTaken => ApiError::StepPositionTaken,
                other => ApiError::internal(other),
            })?;
        for (_, created) in saved {
            if created {
                report.created += 1;
            } else {
                report.updated += 1;
            }
        }
        return Ok(report);
    }
    let (imports, files): (Vec<_>, Vec<_>) = analysis
        .prepared
        .into_iter()
        .map(|p| (p.import, (p.participants, p.teams, p.steps, p.matches)))
        .unzip();
    let saved = state
        .store
        .import_tournaments(imports)
        .await
        .map_err(ApiError::internal)?;
    for ((tournament, created), (participants, teams, steps, matches)) in
        saved.into_iter().zip(files)
    {
        let team_ids = state
            .tournament_teams
            .import(tournament.id, teams)
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
        // Les inscrits d'abord : les étapes et les matchs les désignent.
        state
            .store
            .replace_participants(tournament.id, participants)
            .await
            .map_err(ApiError::internal)?;
        state
            .steps
            .import_in(tournament.id, steps, &team_ids)
            .await
            .map_err(ApiError::internal)?;
        state
            .matches
            .import(tournament.id, matches)
            .await
            .map_err(ApiError::internal)?;
        if created {
            report.created += 1;
        } else {
            report.updated += 1;
        }
    }
    Ok(report)
}
