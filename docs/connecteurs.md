# Guide du développeur de connecteurs

Ce guide explique comment Epick'em importe des tournois depuis des plateformes externes et comment
**brancher une nouvelle source sans toucher au cœur** (ADR-003). Il se termine par un tutoriel
complet : le connecteur « fichiers JSON » livré dans `backend/crates/connectors/src/json_file.rs`.

## Vue d'ensemble

```
            api-public (admin)                       api-internal
   /connectors/resolve, /external-tournaments     planificateur (30 s)
                    │                                    │
                    └──────────────┬─────────────────────┘
                                   ▼
                           SyncService (sync)
            identité, bail, curseur, instantané, backoff, événements
                                   │
                         ConnectorRegistry
                                   │
                ResilientConnector (commun à toutes les sources)
     seau à jetons · reprises + jitter · Retry-After · disjoncteur · cache
                                   │
             ┌─────────────────────┼─────────────────────┐
             ▼                     ▼                     ▼
     StartGgConnector      JsonFileConnector       votre connecteur
```

Un connecteur **ne fait que lire sa source et la traduire** dans le modèle canonique
(`connectors::model`). Tout le reste est commun :

| Responsabilité | Où | Ce que le connecteur doit faire |
|---|---|---|
| Limite de requêtes, reprises, disjoncteur, cache | `resilience.rs` | renvoyer la bonne `ConnectorError` (transitoire ou non) |
| Identité d'un tournoi importé (pas de doublon) | `sync` + `external_sources` | fournir un `external_id` **stable** |
| Planification, bail, backoff, état « périmé » | `sync` | rien |
| Fusion des mises à jour, détection des résultats modifiés | `sync::apply_delta`, `sync::diff` | renvoyer un `ExternalDelta` cohérent |
| Lecture seule des tournois importés | api-public (`external.rs`) | rien |
| Persistance (Redis ; seul le lien source ↔ tournoi est en base) | `sync::RedisSyncStore` | rien |

## L'interface

```rust
#[async_trait]
pub trait TournamentConnector: Send + Sync {
    fn id(&self) -> &'static str;            // "startgg" : stocké en base, ne change jamais
    fn display_name(&self) -> &'static str;  // "start.gg" : affiché à côté des données
    fn capabilities(&self) -> Capabilities;  // ce que la source sait fournir en général

    async fn search(&self, query: &str) -> Result<Vec<ExternalTournamentRef>, ConnectorError>;
    async fn resolve_url(&self, url: &str) -> Result<ExternalTournamentRef, ConnectorError>;
    async fn list_events(&self, t: &ExternalTournamentRef)
        -> Result<Vec<ExternalEventRef>, ConnectorError>;
    async fn fetch(&self, t: &ExternalTournamentRef, event_ids: &[String])
        -> Result<ExternalTournament, ConnectorError>;

    // Par défaut : instantané complet. À surcharger si la source sait filtrer par date.
    async fn fetch_updates(&self, t: &ExternalTournamentRef, event_ids: &[String],
        cursor: SyncCursor) -> Result<ExternalDelta, ConnectorError>;
}
```

### Règles à respecter

1. **Identifiants stables.** `external_id` (tournoi, épreuve, phase, groupe, inscrit, match) ne
   doit jamais changer d'une synchronisation à l'autre : c'est la clé de fusion et de détection
   des changements.
2. **Ne rien inventer.** Une donnée absente reste `None` ou vide. Les capacités effectives d'un
   tournoi sont déduites de ce qui est réellement rempli (`Capabilities::observed`) : le
   constructeur de Pick'em ne doit proposer que des questions résolubles.
3. **Pas de SSRF.** `resolve_url` **analyse** l'URL (hôtes de la source uniquement, pas
   d'identifiants, pas de port) et en extrait un identifiant ; les requêtes partent toujours
   vers le point d'entrée fixe de la source. Renvoyez `ConnectorError::InvalidUrl` pour une URL
   qui n'est pas la vôtre : le registre essaie alors le connecteur suivant.
4. **Classer les erreurs.** `RateLimited { retry_after }`, `Timeout` et `Unavailable` sont
   transitoires (reprises, disjoncteur, cache de secours) ; `NotFound`, `InvalidUrl`,
   `Unauthorized`, `Unsupported` ne le sont pas. `TooComplex` signale une requête trop grosse
   (le connecteur start.gg réduit alors sa page).
5. **Secrets.** Un jeton vient de l'environnement (ADR-007) et n'apparaît jamais dans `Debug`
   ni dans les messages d'erreur (voir `HttpTransport`).
6. **Lien vers l'original.** Remplissez `url` sur le tournoi, les épreuves et, si possible, les
   matchs : l'interface cite toujours la source.

### Synchronisation incrémentale

Si la source sait renvoyer « ce qui a changé depuis T », surchargez `fetch_updates` :

- `cursor.updated_after` vaut le début de la dernière synchronisation réussie (secondes Unix) ;
- renvoyez `ExternalDelta::Partial { state, structures, matches, standings }` : la structure à
  jour de chaque épreuve (phases, groupes, inscrits et seeds, qui remplacent ceux de
  l'instantané), les matchs modifiés et les classements ; `apply_delta` fusionne les matchs par
  `external_id` dans le dernier instantané ;
- en cas de doute (curseur trop ancien, changement de structure), renvoyez `ExternalDelta::Full`.

start.gg utilise `updatedAfter` avec une marge de 60 s pour ne rien manquer aux frontières, et
relit la structure à chaque passage : une inscription ou un tableau créés après l'import y
figurent avant les matchs qui y renvoient.

Un changement de résultat est détecté sur l'état, le vainqueur, les inscrits et scores de chaque
place, le forfait et le détail des manches (vainqueur, stage, personnages) : corriger un
personnage ou le perdant à score égal produit aussi un `result_corrected`.

## Brancher une source

1. Créez `src/<source>.rs` (ou un dossier, comme `startgg/`) et implémentez le trait.
2. Ajoutez-la dans `registry_from_lookup` (`src/lib.rs`), activée par une variable
   d'environnement, et enveloppée dans `ResilientConnector` comme les autres.
3. Documentez la variable dans `.env.example` et `docs/api-public.md`.
4. Écrivez des tests **hors ligne** : réponses enregistrées dans `tests/fixtures/<source>/`,
   transport factice (voir `tests/startgg.rs` et son `FakeApi`).

Rien d'autre ne change : ni les tables, ni `SyncService`, ni les routes, ni api-internal.

## Tutoriel : le connecteur « fichiers JSON »

Objectif : importer des tournois décrits par des fichiers `<nom>.json` d'un répertoire, au format
du modèle canonique. C'est la source de démonstration hors ligne, et le modèle pour une source
sans API riche (pas de synchronisation incrémentale).

### 1. Le format

Un fichier est un `ExternalTournament` sérialisé ; exemple complet dans
`backend/crates/connectors/tests/fixtures/jsonfile/ligue-locale.json` :

```json
{
  "provider": "jsonfile",
  "external_id": "ligue-locale-2026",
  "name": "Ligue locale 2026",
  "starts_at": 1767225600,
  "state": "active",
  "events": [{
    "external_id": "principal", "name": "Tableau principal", "state": "active",
    "phases":   [{ "external_id": "finale", "name": "Finale", "order": 1,
                   "format": "single_elimination", "state": "active", "groups": [] }],
    "entrants": [{ "external_id": "bleus", "name": "Les Bleus", "seed": 1, "players": [] }],
    "matches":  [{ "external_id": "m1", "phase_id": "finale", "round": 1, "state": "completed",
                   "slots": [{ "entrant_id": "bleus", "score": 3 }, { "entrant_id": "rouges", "score": 1 }],
                   "winner_entrant_id": "bleus", "forfeit": false, "games": [] }],
    "standings": [{ "entrant_id": "bleus", "placement": 1 }]
  }]
}
```

### 2. Le connecteur

```rust
pub const PROVIDER: &str = "jsonfile";
const SCHEME: &str = "jsonfile://";

pub struct JsonFileConnector { root: PathBuf }

impl JsonFileConnector {
    async fn load(&self, slug: &str) -> Result<ExternalTournament, ConnectorError> {
        // Le slug est validé (minuscules, chiffres, tirets) : impossible de sortir du répertoire.
        if !valid_slug(slug) {
            return Err(ConnectorError::InvalidUrl("slug invalide".into()));
        }
        let bytes = match tokio::fs::read(self.root.join(format!("{slug}.json"))).await {
            Ok(bytes) => bytes,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Err(ConnectorError::NotFound),
            Err(e) => return Err(ConnectorError::Unavailable(e.to_string())),
        };
        let mut t: ExternalTournament = serde_json::from_slice(&bytes)
            .map_err(|e| ConnectorError::Unavailable(format!("{slug}.json : {e}")))?;
        // L'identité vient du fichier ; la source, le slug et l'URL, du connecteur.
        t.reference.provider = PROVIDER.into();
        t.reference.slug = Some(slug.into());
        t.reference.url = Some(format!("{SCHEME}{slug}"));
        Ok(t)
    }
}
```

### 3. Les méthodes du trait

- `id` → `"jsonfile"`, `display_name` → `"Fichiers JSON"` ;
- `capabilities` → tout `true` sauf `incremental_sync` (le format peut tout porter ; chaque
  fichier en fournit ce qu'il contient) ;
- `search` parcourt le répertoire et filtre sur le nom ;
- `resolve_url` n'accepte que `jsonfile://<slug>` (sinon `InvalidUrl`, pour laisser sa chance
  au connecteur suivant) ;
- `list_events` renvoie les `reference` des épreuves ;
- `fetch` garde les épreuves demandées (`NotFound` si l'une manque) ;
- `fetch_updates` n'est pas écrit : l'implémentation par défaut fait un instantané complet, et
  `sync::diff` en déduit quand même les matchs terminés ou corrigés.

Le fichier complet fait moins de 150 lignes : `backend/crates/connectors/src/json_file.rs`.

### 4. L'enregistrement

Dans `registry_from_lookup` :

```rust
if let Some(dir) = get("EXTERNAL_JSON_DIR") {
    registry = registry.register(wrap(Arc::new(json_file::JsonFileConnector::new(dir))));
}
```

### 5. Les tests

Sur le répertoire de fixtures, sans réseau : `tests/startgg.rs` (registre) vérifie la
résolution, le refus des URL étrangères et des slugs qui sortent du répertoire, et
l'instantané complet ; `tests/json_file.rs` branche le connecteur sur `SyncService` et vérifie
qu'un score corrigé dans le fichier produit exactement un événement `result_corrected`.

### 6. L'essayer

```bash
EXTERNAL_JSON_DIR=backend/crates/connectors/tests/fixtures/jsonfile  # dans .env
# puis, en administrateur :
POST /api/connectors/resolve        { "url": "jsonfile://ligue-locale" }
POST /api/external-tournaments      { "url": "jsonfile://ligue-locale", "event_ids": ["principal"], "game_id": "<jeu>" }
```

Modifiez le score de `m1` dans le fichier puis `POST /api/external-tournaments/{id}/sync` :
un événement `result_corrected` est enregistré dans la boîte d'envoi (`sync:events` dans Redis).

## start.gg en détail

- **Accès :** `STARTGG_TOKEN` (jeton d'API personnel, page *Developer Settings* de start.gg).
  Point d'entrée fixe `https://api.start.gg/gql/alpha`, sans redirection.
- **URL acceptées :** `start.gg`, `www.start.gg`, et les anciens `smash.gg` ; seul le slug du
  tournoi est retenu (`/tournament/<slug>/…`).
- **Correspondance :** épreuves (`events`), phases et groupes (`phases`, `phaseGroups` paginés
  par phase, format
  depuis `bracketType`), inscrits et joueurs (`entrants`, `participants`), matchs (`sets`, état,
  scores, vainqueur, forfait), manches (`games`, personnages via `selections`, cartes via
  `stage`), seeds, classements (`standings`). Ce que start.gg ne renvoie pas pour un tournoi
  reste vide et la capacité correspondante est fausse.
- **Limites :** start.gg documente 80 requêtes par minute ; la politique par défaut en autorise
  60. Le seau à jetons est dans le transport : chaque requête GraphQL (une par page) prend un
  jeton, sur un limiteur partagé par jeton d'API dans le processus (`RateLimiter::shared`). Le
  délai `Retry-After` du fournisseur est respecté tel quel, même au-delà du plafond du backoff.
  Une requête trop complexe est rejouée avec une page plus petite.
- **Tests :** `tests/startgg.rs`, sans réseau, sur des réponses enregistrées
  (`tests/fixtures/startgg/`).

## Exploitation

- **Variables :** `STARTGG_TOKEN`, `EXTERNAL_JSON_DIR`, `SYNC_INTERVAL_SECS` (api-internal, 30 s
  par défaut).
- **Cadence :** une source est due toutes les 2 min pendant le tournoi, 30 min avant, 6 h après ;
  après un échec, 1 min doublée à chaque échec jusqu'à 1 h. Un bail de 10 min empêche deux
  synchronisations simultanées de la même source (plusieurs instances d'api-internal possibles) ;
  une synchronisation qui a dépassé son bail, repris depuis par une autre, n'écrit rien
  (instantané, curseur et événements sont conditionnés à l'échéance du bail qu'elle a posé).
- **Panne :** les données servies restent celles du dernier instantané réussi (`stale: true`,
  `last_error`, `last_success_at` dans `GET /external-tournaments/{id}`) ; la reprise est
  automatique au retour de la source.
- **Stockage :** les données de start.gg n'atteignent jamais PostgreSQL. La table
  `external_sources` ne garde que le **lien** : identité chez la source, épreuves importées,
  tournoi local. Ses lectures passent par le cache (`sync:link:*`, `sync:links`, 1 h, invalidés
  à l'enregistrement et à la suppression) : en régime établi, synchronisations et lectures ne
  touchent pas la base. Tout le reste est dans Redis, sans expiration (`sync::RedisSyncStore`) :
  - `sync:state:{source}` : dernier instantané, capacités, curseur, fraîcheur, prochaine échéance ;
  - `sync:lease:{source}` : bail de la synchronisation en cours, pris atomiquement (script Lua)
    et qui expire de lui-même si son détenteur meurt ;
  - `sync:events` (+ `sync:events:seq`) : changements de résultats à consommer, triés par
    numéro d'ordre ; `mark_processed` les retire.

  L'instantané, ses événements et la libération du bail sont écrits par un seul script Lua,
  seulement si la synchronisation tient toujours le bail. Une source dont l'état a disparu de
  Redis (base vidée, éviction) redevient due et la synchronisation suivante refait un
  instantané complet.

## Report dans le tournoi local

Après chaque instantané enregistré (import compris), `SyncService` appelle son `Projector`
(`api_public::projection::StoreProjector`, branché dans api-public et api-internal), qui traduit
tout l'instantané en modèle local et le range **dans Redis**, jamais en base
(`api_public::store::Imports`) :

- **Inscrits importés :** les inscrits de la source n'ont pas de compte. Ils deviennent des
  inscrits sans `user_id` ni équipe, avec `external_id` (`<épreuve>:<inscrit>`) et
  `display_name` (leur nom chez la source), affichés et classés comme les autres.
- **Étapes et groupes :** chaque phase (non vide) devient une étape, dans l'ordre de la source ;
  chaque groupe de phase, un groupe. Une phase à plusieurs groupes est une étape `pool` ; sinon
  le format suit la source (`single_elim`, `double_elim`, `swiss`, `pool` par défaut). Les
  membres d'un groupe sont les inscrits de ses sets ; leurs points sont leurs victoires ; ils
  sont `qualified` s'ils jouent une phase suivante, `eliminated` une fois le groupe terminé ou
  le nombre de défaites de l'élimination atteint, sinon `in`. La dernière phase reprend le
  classement final de la source.
- **Matchs :** chaque set devient un match (tour négatif chez start.gg → tableau `losers`,
  « Grand Final » → `grand_final`), avec score (`stats.score`), résultat, rang et 1 point au
  vainqueur.
- **Statut du tournoi :** `draft` avant le début, `ongoing` pendant, `finished` après.

Les identifiants locaux sont dérivés de l'identifiant chez la source (UUID v5 dans l'espace du
tournoi) : ils restent stables d'une synchronisation à l'autre, et ce qui a disparu de la source
disparaît du modèle. Le report n'a lieu que si la synchronisation tient encore son bail ; un
report échoué compte comme un échec de synchronisation et, l'instantané complet étant reporté à
chaque fois, il est rattrapé au passage suivant. Le tournoi reste en lecture seule pour l'API
(`409 externally_managed`).

- **Clés :** `import:tournament:{tournoi}` (le modèle entier), `import:summary:{tournoi}` (statut
  et nombre d'inscrits, pour les listes) et `import:owner:{élément}` (d'un inscrit, d'une étape
  ou d'un match vers son tournoi). Elles sont réécrites à chaque synchronisation et expirent au
  bout de 30 jours sans synchronisation ; supprimer le tournoi les efface.
- **Lectures :** `PgStore` et `MemoryStore` servent ce modèle pour un tournoi importé (inscrits,
  points, étapes, groupes, membres, matchs et leurs participants) sans requête en base. La ligne
  du tournoi reste en base telle que créée à l'import : son statut et sa capacité sont lus dans
  `import:summary`. Pour filtrer la liste des tournois par statut, les tournois importés passent
  le filtre SQL puis sont filtrés sur leur statut importé : une page peut être plus courte que
  `limit`.
- **Redis perd le modèle** (base vidée, éviction) : le tournoi importé paraît vide jusqu'à la
  synchronisation suivante (2 min pendant le tournoi, 6 h après), qui le réécrit à l'identique.
  En production, réglez Redis en `maxmemory-policy noeviction` (ou sans limite de mémoire) et
  activez sa persistance (AOF ou RDB) pour éviter ce trou.

## Limites connues

- La boîte d'envoi `sync:events` reste pour les consommateurs en aval (pronostics…) : le modèle
  local, lui, est recalculé depuis l'instantané à chaque synchronisation.
- Redis devient la seule copie des données importées : sans persistance Redis, un redémarrage
  les efface et elles sont reconstruites depuis start.gg au fil des synchronisations dues.
- La limite de requêtes est tenue par processus et par jeton : api-public et api-internal ont
  chacun leur seau.

### Atomic projection

The projector prepares serialized cache records without writing. Redis commits these records, the source snapshot, cursor and result events in one Lua operation that verifies the lease before releasing it. A stale execution cannot write either the snapshot or the visible tournament model. The in-memory implementation holds its synchronization mutex through the corresponding cache writes.
