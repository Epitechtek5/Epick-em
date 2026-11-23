//! Connecteur start.gg (API GraphQL publique).
//!
//! - recherche par nom, résolution d'URL (`https://start.gg/tournament/<slug>`) et choix des
//!   épreuves à importer ;
//! - instantané complet : phases et groupes, inscrits (seeds, joueurs), sets (manches,
//!   personnages, stages, forfaits) et classements, page par page ;
//! - synchronisation incrémentale : sets modifiés depuis le curseur (`updatedAfter`), structure
//!   (phases, groupes, inscrits et seeds) et classements à jour.
//!
//! Le jeton d'API ne sert qu'au transport ([`HttpTransport`]) ; les tests utilisent un double
//! hors ligne ([`GraphqlTransport`]).

mod mapping;
pub mod queries;
pub mod transport;
pub mod url;

pub use self::mapping::PROVIDER;
pub use self::transport::{GraphqlTransport, HttpTransport, LimitedTransport};

use crate::connector::{ConnectorError, TournamentConnector};
use crate::model::{
    Capabilities, EventStructure, ExternalDelta, ExternalEvent, ExternalEventRef, ExternalPhase,
    ExternalTournament, ExternalTournamentRef, SyncCursor,
};
use async_trait::async_trait;
use serde_json::{Value, json};
use std::sync::Arc;

/// Pages au plus par liste : borne un tournoi aberrant ou une source qui boucle.
const MAX_PAGES: u32 = 1000;
/// Marge sur le curseur : un set modifié pendant la synchronisation précédente est relu.
const CURSOR_MARGIN_SECS: i64 = 60;
const SEARCH_RESULTS: u32 = 20;

pub struct StartGgConnector {
    transport: Arc<dyn GraphqlTransport>,
    entrants_per_page: u32,
    groups_per_page: u32,
    sets_per_page: u32,
    standings_per_page: u32,
}

impl StartGgConnector {
    pub fn new(transport: Arc<dyn GraphqlTransport>) -> Self {
        StartGgConnector {
            transport,
            entrants_per_page: 64,
            groups_per_page: 128,
            // Chaque set embarque ses manches et sélections : petites pages.
            sets_per_page: 24,
            standings_per_page: 128,
        }
    }

    /// Connecteur réel, authentifié par `token` ; chaque requête GraphQL prend un jeton de
    /// `limiter` (partagé par jeton d'API, voir [`crate::resilience::RateLimiter::shared`]).
    pub fn with_token(
        token: &str,
        limiter: Arc<crate::resilience::RateLimiter>,
    ) -> Result<Self, reqwest::Error> {
        Ok(Self::new(Arc::new(LimitedTransport::new(
            Arc::new(HttpTransport::new(token)?),
            limiter,
        ))))
    }

    /// Taille des pages de groupes de phase (tests de pagination).
    pub fn with_groups_per_page(mut self, per_page: u32) -> Self {
        self.groups_per_page = per_page.max(1);
        self
    }

    /// Taille des pages de sets (tests de pagination).
    pub fn with_sets_per_page(mut self, per_page: u32) -> Self {
        self.sets_per_page = per_page.max(1);
        self
    }

    async fn tournament(&self, slug: &str) -> Result<Value, ConnectorError> {
        let data = self
            .transport
            .query(queries::TOURNAMENT, json!({ "slug": slug }))
            .await?;
        match data.get("tournament") {
            Some(t) if !t.is_null() => Ok(t.clone()),
            _ => Err(ConnectorError::NotFound),
        }
    }

    fn slug(reference: &ExternalTournamentRef) -> Result<&str, ConnectorError> {
        reference
            .slug
            .as_deref()
            .filter(|s| url::valid_slug(s))
            .ok_or(ConnectorError::InvalidUrl("slug start.gg absent".into()))
    }

    /// Tous les nœuds d'une liste paginée `event.<field>`.
    async fn paginate(
        &self,
        query: &str,
        event_id: &str,
        field: &str,
        per_page: u32,
        extra: Value,
    ) -> Result<Vec<Value>, ConnectorError> {
        self.paginate_in(
            query,
            ("event", "eventId", event_id),
            field,
            per_page,
            extra,
        )
        .await
    }

    /// Tous les nœuds d'une liste paginée `<root>.<field>`, l'objet `root` étant désigné par la
    /// variable `id_var` = `id`. Si start.gg trouve une page trop coûteuse, la taille des pages
    /// est divisée par deux et la lecture reprend au même endroit.
    async fn paginate_in(
        &self,
        query: &str,
        (root, id_var, id): (&str, &str, &str),
        field: &str,
        per_page: u32,
        extra: Value,
    ) -> Result<Vec<Value>, ConnectorError> {
        let mut nodes = Vec::new();
        let mut per_page = per_page.max(1);
        let mut page = 1;
        while page <= MAX_PAGES {
            let mut variables = json!({ id_var: id, "page": page, "perPage": per_page });
            if let (Some(target), Some(extra)) = (variables.as_object_mut(), extra.as_object()) {
                target.extend(extra.clone());
            }
            let data = match self.transport.query(query, variables).await {
                Err(ConnectorError::TooComplex) if per_page > 1 => {
                    // Même position dans la liste, en pages deux fois plus petites.
                    page = (page - 1) * 2 + 1;
                    per_page /= 2;
                    continue;
                }
                other => other?,
            };
            let parent = &data[root];
            if parent.is_null() {
                return Err(ConnectorError::NotFound);
            }
            let list = &parent[field];
            let batch = list["nodes"].as_array().cloned().unwrap_or_default();
            let total = list["pageInfo"]["totalPages"].as_u64().unwrap_or(0);
            let empty = batch.is_empty();
            nodes.extend(batch);
            if empty || u64::from(page) >= total {
                break;
            }
            page += 1;
        }
        Ok(nodes)
    }

    async fn sets(
        &self,
        event: &ExternalEventRef,
        updated_after: Option<i64>,
    ) -> Result<Vec<crate::model::ExternalMatch>, ConnectorError> {
        let nodes = self
            .paginate(
                queries::SETS,
                &event.external_id,
                "sets",
                self.sets_per_page,
                json!({ "updatedAfter": updated_after }),
            )
            .await?;
        Ok(nodes
            .iter()
            .filter_map(|n| mapping::set(n, event.url.as_deref()))
            .collect())
    }

    async fn standings(
        &self,
        event_id: &str,
    ) -> Result<Vec<crate::model::ExternalStanding>, ConnectorError> {
        let nodes = self
            .paginate(
                queries::STANDINGS,
                event_id,
                "standings",
                self.standings_per_page,
                json!({}),
            )
            .await?;
        Ok(nodes.iter().filter_map(mapping::standing).collect())
    }

    /// Structure d'une épreuve : sa référence à jour, ses phases et leurs groupes (tous, page par
    /// page), et ses inscrits avec leurs seeds.
    async fn structure(
        &self,
        reference: ExternalEventRef,
    ) -> Result<(ExternalEventRef, EventStructure), ConnectorError> {
        let data = self
            .transport
            .query(queries::PHASES, json!({ "eventId": reference.external_id }))
            .await?;
        let detail = &data["event"];
        if detail.is_null() {
            return Err(ConnectorError::NotFound);
        }
        let mut phases: Vec<ExternalPhase> = detail["phases"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(mapping::phase)
            .collect();
        for phase in &mut phases {
            phase.groups = self
                .paginate_in(
                    queries::PHASE_GROUPS,
                    ("phase", "phaseId", &phase.external_id),
                    "phaseGroups",
                    self.groups_per_page,
                    json!({}),
                )
                .await?
                .iter()
                .filter_map(|node| mapping::group(node, phase.format))
                .collect();
        }
        let entrants = self
            .paginate(
                queries::ENTRANTS,
                &reference.external_id,
                "entrants",
                self.entrants_per_page,
                json!({}),
            )
            .await?
            .iter()
            .filter_map(mapping::entrant)
            .collect();
        Ok((
            mapping::event_ref(detail).unwrap_or(reference),
            EventStructure { phases, entrants },
        ))
    }

    async fn event(&self, reference: ExternalEventRef) -> Result<ExternalEvent, ConnectorError> {
        let (reference, structure) = self.structure(reference).await?;
        let matches = self.sets(&reference, None).await?;
        let standings = self.standings(&reference.external_id).await?;
        Ok(ExternalEvent {
            reference,
            phases: structure.phases,
            entrants: structure.entrants,
            matches,
            standings,
        })
    }

    /// Épreuves `event_ids` du tournoi ; [`ConnectorError::NotFound`] si l'une n'existe pas.
    fn selected(
        tournament: &Value,
        event_ids: &[String],
    ) -> Result<Vec<ExternalEventRef>, ConnectorError> {
        let events: Vec<ExternalEventRef> = tournament["events"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(mapping::event_ref)
            .collect();
        event_ids
            .iter()
            .map(|id| {
                events
                    .iter()
                    .find(|e| &e.external_id == id)
                    .cloned()
                    .ok_or(ConnectorError::NotFound)
            })
            .collect()
    }
}

#[async_trait]
impl TournamentConnector for StartGgConnector {
    fn id(&self) -> &'static str {
        PROVIDER
    }

    fn display_name(&self) -> &'static str {
        "start.gg"
    }

    fn capabilities(&self) -> Capabilities {
        Capabilities {
            search: true,
            url_resolution: true,
            phases: true,
            groups: true,
            matches: true,
            games: true,
            characters: true,
            stages: true,
            seeds: true,
            standings: true,
            incremental_sync: true,
        }
    }

    async fn search(&self, query: &str) -> Result<Vec<ExternalTournamentRef>, ConnectorError> {
        let query = query.trim();
        if query.chars().count() < 2 {
            return Ok(Vec::new());
        }
        let name: String = query.chars().take(100).collect();
        let data = self
            .transport
            .query(
                queries::SEARCH,
                json!({ "name": name, "perPage": SEARCH_RESULTS }),
            )
            .await?;
        Ok(data["tournaments"]["nodes"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(mapping::tournament_ref)
            .collect())
    }

    async fn resolve_url(&self, url: &str) -> Result<ExternalTournamentRef, ConnectorError> {
        let slug = url::tournament_slug(url)?;
        mapping::tournament_ref(&self.tournament(&slug).await?)
            .ok_or_else(|| ConnectorError::Unavailable("tournoi incomplet".into()))
    }

    async fn list_events(
        &self,
        tournament: &ExternalTournamentRef,
    ) -> Result<Vec<ExternalEventRef>, ConnectorError> {
        let data = self.tournament(Self::slug(tournament)?).await?;
        Ok(data["events"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(mapping::event_ref)
            .collect())
    }

    async fn fetch(
        &self,
        tournament: &ExternalTournamentRef,
        event_ids: &[String],
    ) -> Result<ExternalTournament, ConnectorError> {
        let data = self.tournament(Self::slug(tournament)?).await?;
        let mut events = Vec::new();
        for reference in Self::selected(&data, event_ids)? {
            events.push(self.event(reference).await?);
        }
        Ok(ExternalTournament {
            reference: mapping::tournament_ref(&data).unwrap_or_else(|| tournament.clone()),
            state: mapping::tournament_state(&data["state"]),
            events,
        })
    }

    async fn fetch_updates(
        &self,
        tournament: &ExternalTournamentRef,
        event_ids: &[String],
        cursor: SyncCursor,
    ) -> Result<ExternalDelta, ConnectorError> {
        let Some(since) = cursor.updated_after else {
            return Ok(ExternalDelta::Full {
                tournament: self.fetch(tournament, event_ids).await?,
            });
        };
        let data = self.tournament(Self::slug(tournament)?).await?;
        let mut matches = Vec::new();
        let mut standings = Vec::new();
        let mut structures = Vec::new();
        for event in Self::selected(&data, event_ids)? {
            // Inscriptions, seeds, phases et groupes créés depuis le dernier passage : les
            // matchs modifiés peuvent y renvoyer.
            let (event, structure) = self.structure(event).await?;
            structures.push((event.external_id.clone(), structure));
            for m in self.sets(&event, Some(since - CURSOR_MARGIN_SECS)).await? {
                matches.push((event.external_id.clone(), m));
            }
            standings.push((
                event.external_id.clone(),
                self.standings(&event.external_id).await?,
            ));
        }
        Ok(ExternalDelta::Partial {
            state: mapping::tournament_state(&data["state"]),
            structures,
            matches,
            standings,
        })
    }
}
