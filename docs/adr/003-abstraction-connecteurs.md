# ADR-003 — Abstraction des sources de tournois externes (connecteurs)

- **Statut :** Accepté
- **Date :** 2026-10-19
- **Décideurs :** équipe backend/devops
- **Issue liée :** #…

## Contexte

Le sujet impose l'import de tournois depuis start.gg, avec :

- recherche par URL ou par nom, récupération des phases, arbres, participants, matchs, manches, personnages, cartes, seeds et classements **quand ils sont disponibles** ;
- synchronisation régulière pendant le tournoi, **avec cache et respect des limites de requêtes** ;
- tournois importés **en lecture seule** ;
- plateforme utilisable quand start.gg ne répond pas : données en cache affichées, reprise automatique ;
- **architecture en connecteurs** : une autre plateforme doit pouvoir être branchée **sans modifier le cœur du produit** ;
- le constructeur de Pick'em ne propose **que les questions résolubles** avec les données disponibles ;
- tests du connecteur **sans connexion réseau** (mocks) ;
- un **guide du développeur de connecteurs** est livré.

## Options étudiées

### Option A — Client start.gg appelé directement par le cœur
- ✅ Rapide à écrire.
- ❌ Le modèle start.gg fuit dans le domaine ; un second connecteur oblige à modifier le cœur. Non conforme au sujet.

### Option B — Trait Rust `TournamentConnector` + couche générique de résilience
- ✅ Le cœur ne connaît qu'un modèle neutre.
- ✅ Rate limit, cache et retry écrits une seule fois.
- ✅ Mock trivial pour les tests.
- ❌ Un peu plus de code au départ.

## Décision

**Nous retenons l'option B.**

### Interface

```rust
#[async_trait]
pub trait TournamentConnector: Send + Sync {
    /// Identifiant stable, stocké avec chaque donnée importée ("startgg").
    fn id(&self) -> &'static str;

    /// Données que cette source sait fournir (personnages, cartes, stats…).
    fn capabilities(&self) -> Capabilities;

    async fn search(&self, query: &str) -> Result<Vec<ExternalTournamentRef>, ConnectorError>;
    async fn resolve_url(&self, url: &str) -> Result<ExternalTournamentRef, ConnectorError>;

    /// Import initial complet.
    async fn fetch(&self, r: &ExternalTournamentRef) -> Result<ExternalTournament, ConnectorError>;

    /// Synchronisation incrémentale depuis un curseur.
    async fn fetch_updates(&self, r: &ExternalTournamentRef, since: SyncCursor)
        -> Result<ExternalDelta, ConnectorError>;
}
```

- Les types `External*` forment un **modèle neutre** (phases, matchs, manches, participants, stats). Le **mapping vers le modèle de la plateforme** est fait par le cœur, une seule fois, pour toutes les sources.
- `Capabilities` est déterminé **par tournoi** (un tournoi start.gg peut ne pas fournir les personnages). Le constructeur de Pick'em s'en sert pour filtrer les modèles de questions proposés.
- Chaque donnée importée garde sa **source** et un **lien vers l'original** (règle d'or du sujet).

### Couche de résilience générique

Un décorateur `ResilientConnector<C: TournamentConnector>` ajoute à n'importe quel connecteur :

- **rate limiting** (token bucket configurable par connecteur) ;
- **cache Redis** des réponses avec TTL ;
- **retry avec backoff exponentiel** et jitter ;
- **circuit breaker** : après N échecs, on cesse d'appeler la source pendant un délai, l'interface affiche les données en cache avec l'horodatage de la dernière synchronisation.

### Synchronisation

Portée par **api-internal** : un planificateur relance `fetch_updates` sur les tournois importés en cours. Les changements détectés produisent les **mêmes événements** qu'une saisie interne (`match.result`, `score.corrected`…, voir ADR-002), donc la même mécanique de résolution et de recalcul.

### Secrets

Le jeton start.gg est fourni par variable d'environnement, jamais dans le dépôt (voir ADR-007).

## Conséquences

- **Positives :** second connecteur possible sans toucher au cœur (bonus du sujet) ; tests hors ligne via `MockConnector` et fixtures JSON enregistrées ; plateforme résiliente aux pannes de start.gg.
- **Négatives / coûts acceptés :** un modèle neutre à maintenir ; le mapping start.gg → modèle neutre demande du soin (formats de phases variés).
- **Actions à mener :**
  - Implémenter `StartGgConnector` (API GraphQL publique).
  - Enregistrer des réponses réelles anonymisées en fixtures pour les tests.
  - Tests : mapping, capabilities, comportement en cas de 429 / timeout / panne prolongée.
  - Rédiger le guide du développeur de connecteurs, avec un tutoriel de connecteur simple (par exemple depuis un fichier JSON distant).
