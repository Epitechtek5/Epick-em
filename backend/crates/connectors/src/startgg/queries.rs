//! Requêtes GraphQL de start.gg. Chacune porte un nom d'opération, qui sert aussi aux doubles
//! de test pour choisir leur réponse.
//!
//! La complexité est bornée par start.gg (1000 objets par requête) : les listes sont paginées
//! et la taille des pages se réduit d'elle-même si start.gg trouve la requête trop coûteuse.

pub const SEARCH: &str = r#"query Search($name: String!, $perPage: Int!) {
  tournaments(query: { page: 1, perPage: $perPage, filter: { name: $name } }) {
    nodes { id slug name url(relative: false) startAt endAt state }
  }
}"#;

pub const TOURNAMENT: &str = r#"query Tournament($slug: String!) {
  tournament(slug: $slug) {
    id slug name url(relative: false) startAt endAt state
    events {
      id name slug startAt state numEntrants
      videogame { name }
    }
  }
}"#;

pub const PHASES: &str = r#"query EventPhases($eventId: ID!) {
  event(id: $eventId) {
    id name slug startAt state numEntrants
    videogame { name }
    phases {
      id name phaseOrder bracketType state
      phaseGroups(query: { page: 1, perPage: 128 }) {
        nodes { id displayIdentifier bracketType state bracketUrl }
      }
    }
  }
}"#;

pub const ENTRANTS: &str = r#"query EventEntrants($eventId: ID!, $page: Int!, $perPage: Int!) {
  event(id: $eventId) {
    entrants(query: { page: $page, perPage: $perPage }) {
      pageInfo { totalPages }
      nodes {
        id name initialSeedNum
        participants { id gamerTag prefix }
      }
    }
  }
}"#;

pub const SETS: &str = r#"query EventSets($eventId: ID!, $page: Int!, $perPage: Int!, $updatedAfter: Timestamp) {
  event(id: $eventId) {
    state
    sets(page: $page, perPage: $perPage, sortType: STANDARD, filters: { updatedAfter: $updatedAfter }) {
      pageInfo { totalPages }
      nodes {
        id round fullRoundText state winnerId startedAt completedAt displayScore
        phaseGroup { id phase { id } }
        slots { entrant { id } standing { stats { score { value } } } }
        games {
          id orderNum winnerId
          stage { name }
          selections { entrant { id } character { name } }
        }
      }
    }
  }
}"#;

pub const STANDINGS: &str = r#"query EventStandings($eventId: ID!, $page: Int!, $perPage: Int!) {
  event(id: $eventId) {
    standings(query: { page: $page, perPage: $perPage }) {
      pageInfo { totalPages }
      nodes { placement entrant { id } }
    }
  }
}"#;

/// Nom d'opération d'une requête (`query Nom(…)`).
pub fn operation(query: &str) -> &str {
    query
        .trim_start()
        .strip_prefix("query ")
        .and_then(|rest| rest.split(['(', ' ', '{']).next())
        .unwrap_or_default()
}
