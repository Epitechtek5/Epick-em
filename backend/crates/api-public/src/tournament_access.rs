//! Droits sur un tournoi : rôles propres au tournoi (propriétaire, administrateur, arbitre),
//! indépendants du rôle global du compte, et visibilité des tournois `invitation_only`.
//!
//! Tous les handlers passent par ces fonctions : un administrateur global garde tous ses droits,
//! un administrateur ou arbitre de tournoi n'en a que sur son tournoi, et un tournoi privé reste
//! introuvable (404) pour qui n'y a aucun lien, y compris par ses ressources enfants.

use crate::auth::{AppState, Claims};
use crate::error::ApiError;
use crate::store::{Role, Tournament, TournamentRole, Visibility};
use uuid::Uuid;

/// Rôle effectif d'un compte sur un tournoi.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Capacity {
    Owner,
    Admin,
    Referee,
}

/// Ce qu'un compte peut faire sur un tournoi.
#[derive(Debug, Clone, Copy)]
pub(crate) struct Access {
    pub global_admin: bool,
    pub watcher: bool,
    pub capacity: Option<Capacity>,
}

impl Access {
    /// Gérer le tournoi : configuration, inscriptions, étapes, matchs.
    pub fn can_manage(self) -> bool {
        self.global_admin || matches!(self.capacity, Some(Capacity::Owner | Capacity::Admin))
    }

    /// Arbitrer : saisir les résultats et pointer les inscrits.
    pub fn can_referee(self) -> bool {
        self.can_manage() || self.capacity == Some(Capacity::Referee)
    }

    /// Désigner les administrateurs et arbitres, transférer ou supprimer le tournoi.
    pub fn is_owner(self) -> bool {
        self.global_admin || self.capacity == Some(Capacity::Owner)
    }
}

/// Droits du compte du jeton sur le tournoi. Le compte est relu en base, hors cache : un
/// administrateur rétrogradé ou supprimé perd ses droits tout de suite (voir `require_admin`).
pub(crate) async fn access_of(
    state: &AppState,
    claims: &Claims,
    tournament: &Tournament,
) -> Result<Access, ApiError> {
    let user = state
        .store
        .find_user_by_id(claims.sub)
        .await
        .map_err(ApiError::internal)?
        .ok_or(ApiError::Unauthorized)?;
    let capacity = if tournament.owner_id == Some(user.id) {
        Some(Capacity::Owner)
    } else {
        state
            .store
            .find_tournament_role(tournament.id, user.id)
            .await
            .map_err(ApiError::internal)?
            .map(|role| match role {
                TournamentRole::Admin => Capacity::Admin,
                TournamentRole::Referee => Capacity::Referee,
            })
    };
    Ok(Access {
        global_admin: user.role == Role::Admin,
        watcher: user.role == Role::Watcher,
        capacity,
    })
}

/// `404` pour qui ne peut pas voir le tournoi, `403` pour qui le voit sans avoir le droit.
async fn deny(
    state: &AppState,
    claims: &Claims,
    tournament: &Tournament,
    access: Access,
) -> ApiError {
    match visible(state, claims, tournament, access).await {
        Ok(true) => ApiError::Forbidden,
        Ok(false) => ApiError::NotFound,
        Err(err) => err,
    }
}

pub(crate) async fn require_manage(
    state: &AppState,
    claims: &Claims,
    tournament: &Tournament,
) -> Result<(), ApiError> {
    let access = access_of(state, claims, tournament).await?;
    if access.can_manage() {
        Ok(())
    } else {
        Err(deny(state, claims, tournament, access).await)
    }
}

pub(crate) async fn require_referee(
    state: &AppState,
    claims: &Claims,
    tournament: &Tournament,
) -> Result<(), ApiError> {
    let access = access_of(state, claims, tournament).await?;
    if access.can_referee() {
        Ok(())
    } else {
        Err(deny(state, claims, tournament, access).await)
    }
}

pub(crate) async fn require_owner(
    state: &AppState,
    claims: &Claims,
    tournament: &Tournament,
) -> Result<(), ApiError> {
    let access = access_of(state, claims, tournament).await?;
    if access.is_owner() {
        Ok(())
    } else {
        Err(deny(state, claims, tournament, access).await)
    }
}

/// Le compte du jeton peut-il consulter le tournoi (et donc ses ressources enfants) ?
pub(crate) async fn require_visible(
    state: &AppState,
    claims: &Claims,
    tournament: &Tournament,
) -> Result<Access, ApiError> {
    let access = access_of(state, claims, tournament).await?;
    if visible(state, claims, tournament, access).await? {
        Ok(access)
    } else {
        Err(ApiError::NotFound)
    }
}

async fn visible(
    state: &AppState,
    claims: &Claims,
    tournament: &Tournament,
    access: Access,
) -> Result<bool, ApiError> {
    if access.can_manage() || access.capacity.is_some() {
        return Ok(true);
    }
    if tournament.is_template {
        return Ok(false);
    }
    if tournament.settings.visibility == Visibility::Public || access.watcher {
        return Ok(true);
    }
    if state
        .store
        .has_invitation(tournament.id, claims.sub)
        .await
        .map_err(ApiError::internal)?
    {
        return Ok(true);
    }
    is_involved(state, tournament.id, claims.sub).await
}

/// Le compte est inscrit, directement ou par une équipe dont il est membre ou propriétaire.
async fn is_involved(
    state: &AppState,
    tournament_id: Uuid,
    user_id: Uuid,
) -> Result<bool, ApiError> {
    let participants = state
        .store
        .list_participants(tournament_id, i64::MAX, 0)
        .await
        .map_err(ApiError::internal)?;
    for participant in participants {
        if participant.user_id == Some(user_id) {
            return Ok(true);
        }
        if let Some(team_id) = participant.tournament_team_id {
            let members = state
                .store
                .list_tournament_team_members(team_id)
                .await
                .map_err(ApiError::internal)?
                .unwrap_or_default();
            if members.iter().any(|member| member.user_id == user_id) {
                return Ok(true);
            }
        }
    }
    Ok(false)
}
