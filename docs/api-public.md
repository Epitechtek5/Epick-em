# API publique — authentification, comptes, jeux, statistiques, équipes et tournois

Référence des routes de `api-public` (décisions : [ADR-009](adr/009-authentification-jwt-et-roles.md)). Les routes sont exposées sans préfixe ; le front les appelle en `/api/*` et nginx (ou le proxy Vite) retire le préfixe.

## Documentation OpenAPI

Swagger UI est servi sur `/docs` (`/api/docs/` via nginx ou Vite) et la spécification sur `/openapi.json`, sans authentification. Pour ajouter un endpoint : annoter le handler avec `#[utoipa::path]`, puis l'enregistrer avec `routes!(handler)` dans le `routes()` de son module (détails en tête de `openapi.rs`). Les types TS du web et du mobile en sont générés, voir [`openapi/README.md`](../openapi/README.md).

## Routes

| Route | Authentification | Corps | Réponse |
|---|---|---|---|
| `GET /health` | aucune | — | `200` `ok` |
| `GET /hello` | aucune | — | `200` `Hello, world!` |
| `POST /register` | aucune | `{ username, password }` | `201` `{ id, username }` |
| `POST /login` | aucune | `{ username, password }` | `200` jetons (voir ci-dessous) |
| `POST /refresh` | JWT, **expiré toléré** | `{ refresh_token }` | `200` nouveaux jetons |
| `POST /logout` | JWT valide | `{ refresh_token }` | `204` |
| `GET /users` | JWT valide | `?limit` (1 à 100, 50 par défaut), `?offset` | `200` `[{ id, username, role }]` |
| `GET /user/{id}` | JWT valide | — | `200` `{ id, username, role }` |
| `PATCH /user/{id}/update` | JWT valide, **administrateur** | `{ username?, password?, role? }` | `200` `{ id, username, role }` |
| `DELETE /user/{id}/delete` | JWT valide, **administrateur** | — | `204` |
| `PATCH /me/update` | JWT valide | `{ username?, password? }` (`role` refusé) | `200` `{ id, username, role }` |
| `DELETE /me/delete` | JWT valide | — | `204` |
| `GET /games` | JWT valide | `?limit` (1 à 100, 50 par défaut), `?offset` | `200` `[{ id, name, description, images }]`, par ordre alphabétique |
| `GET /games/{id}` | JWT valide | — | `200` `{ id, name, description, images }` |
| `POST /games` | JWT valide, **administrateur** | `{ name, description?, images? }` | `201` `{ id, name, description, images }` |
| `PATCH /games/{id}` | JWT valide, **administrateur** | `{ name?, description?, images? }` | `200` `{ id, name, description, images }` |
| `DELETE /games/{id}` | JWT valide, **administrateur** | — | `204` |
| `GET /games/export` | JWT valide, **administrateur** | `?format=json` (défaut) ou `csv` | `200` fichier `games.json` / `games.csv` |
| `POST /games/import` | JWT valide, **administrateur** | `?format=json` (défaut) ou `csv` ; contenu du fichier en corps (256 Kio max) | `200` `{ created, updated }` |
| `GET /stats` | JWT valide | `?limit` (1 à 100, 50 par défaut), `?offset` | `200` `[{ id, name, key, type }]`, par ordre alphabétique |
| `GET /stats/{id}` | JWT valide | — | `200` `{ id, name, key, type }` |
| `POST /stats` | JWT valide, **administrateur** | `{ name, key, type }` (`key` : slug unique, `type` : `flat` ou `percent`) | `201` `{ id, name, key, type }` |
| `PATCH /stats/{id}` | JWT valide, **administrateur** | `{ name?, key?, type? }` | `200` `{ id, name, key, type }` |
| `DELETE /stats/{id}` | JWT valide, **administrateur** | — | `204` ; `409` si le barème d'un tournoi `ongoing` s'en sert |
| `GET /games/{id}/stats` | JWT valide | — | `200` `[{ id, name, key, type }]`, statistiques du jeu |
| `PUT /games/{id}/stats/{stat_id}` | JWT valide, **administrateur** | — | `204` (sans effet si déjà liée) |
| `DELETE /games/{id}/stats/{stat_id}` | JWT valide, **administrateur** | — | `204`, `404` si la liaison n'existe pas |
| `GET /stats/export` | JWT valide, **administrateur** | `?format=json` (défaut) ou `csv` | `200` fichier `stats.json` / `stats.csv` |
| `POST /stats/import` | JWT valide, **administrateur** | `?format=json` (défaut) ou `csv` ; contenu du fichier en corps (256 Kio max) | `200` `{ created, updated }` |
| `GET /teams` | JWT valide | `?game_id`, `?limit` (1 à 100, 50 par défaut), `?offset` | `200` `[{ id, game_id, name, tag, picture_url, owner_id, created_at, updated_at }]`, par ordre alphabétique |
| `GET /teams/export` | JWT valide, **administrateur** | `?format=json` (défaut) ou `csv` | `200` fichier `teams.json` / `teams.csv` |
| `POST /teams/import` | JWT valide, **administrateur** | `?format=json` (défaut) ou `csv` ; contenu du fichier en corps (256 Kio max) | `200` `{ created, updated }` |
| `GET /teams/{id}` | JWT valide | — | `200` l'équipe |
| `POST /teams` | JWT valide | `{ game_id, name, tag?, picture_url? }` | `201` l'équipe ; l'appelant en est le propriétaire et le premier membre |
| `PATCH /teams/{id}` | JWT valide, **propriétaire** | `{ name?, tag?, picture_url? }` (chaîne vide : efface `tag` / `picture_url`) | `200` l'équipe |
| `DELETE /teams/{id}` | JWT valide, **propriétaire** | — | `204` ; supprime les membres, garde les équipes de tournoi copiées |
| `GET /teams/{id}/members` | JWT valide | — | `200` `[{ user_id, role, joined_at, left_at }]`, anciens membres compris |
| `POST /teams/{id}/members` | JWT valide, **propriétaire** | `{ user_id, role }` (`member` ou `substitute`) | `201` le membre ; `409` s'il est déjà membre actif |
| `PATCH /teams/{id}/members/{user_id}` | JWT valide, **propriétaire** | `{ role }` (`member` ou `substitute`) | `200` le membre |
| `DELETE /teams/{id}/members/{user_id}` | JWT valide, **propriétaire** | — | `204` ; la ligne est gardée avec `left_at` |
| `GET /tournaments/{tournament_id}/teams` | JWT valide | `?limit`, `?offset` | `200` `[{ id, tournament_id, team_id, name, tag, picture_url, owner_id, created_at }]` |
| `POST /tournaments/{tournament_id}/teams` | JWT valide | `{ team_id, member_ids? }` (copie d'une équipe globale dont l'appelant est propriétaire) ou `{ name, tag?, picture_url? }` (de zéro) | `201` l'équipe de tournoi ; `409` si l'équipe globale est déjà inscrite ou si un joueur est déjà dans une équipe du tournoi |
| `GET /tournament-teams/{id}` | JWT valide | — | `200` l'équipe de tournoi |
| `PATCH /tournament-teams/{id}` | JWT valide, **propriétaire** | `{ name?, tag?, picture_url? }` | `200` l'équipe de tournoi |
| `DELETE /tournament-teams/{id}` | JWT valide, **propriétaire** | — | `204` |
| `GET /tournament-teams/{id}/members` | JWT valide | — | `200` `[{ user_id, role }]` |
| `POST /tournament-teams/{id}/members` | JWT valide, **propriétaire** | `{ user_id, role }` (`member` ou `substitute`) | `201` le membre ; `409` s'il est déjà dans une équipe du tournoi |
| `PATCH /tournament-teams/{id}/members/{user_id}` | JWT valide, **propriétaire** | `{ role }` | `200` le membre |
| `DELETE /tournament-teams/{id}/members/{user_id}` | JWT valide, **propriétaire** | — | `204` |
| `GET /tournaments/export` | JWT valide, **administrateur** | `?format=json` (défaut) ou `csv` | `200` fichier en pièce jointe |
| `POST /tournaments/import` | JWT valide, **administrateur** | `?format=json` (défaut) ou `csv` ; contenu du fichier en corps (256 Kio max) | `200` `{ created, updated }` |
| `GET /tournaments` | JWT valide | `?game_id`, `?status`, `?limit`, `?offset` | `200` `[Tournament]`, par date de début |
| `GET /tournaments/{id}` | JWT valide | — | `200` le tournoi |
| `POST /tournaments` | JWT valide, **administrateur** | `{ game_id, name, description?, start_date, end_date, registration_open_at?, registration_close_at?, participant_type, team_size?, max_participants, team_scoring_mode?, team_scoring_n? }` | `201` le tournoi, au statut `draft` |
| `PATCH /tournaments/{id}` | JWT valide, **administrateur** | champs de la création sauf `game_id` et `participant_type` ; `null` efface une valeur facultative | `200` le tournoi ; `409` si la capacité ou le score d'équipe change alors que le tournoi est `ongoing` ou `finished` |
| `DELETE /tournaments/{id}` | JWT valide, **administrateur** | — | `204` ; supprime équipes, barème et inscrits ; `409` si le tournoi est `ongoing` |
| `POST /tournaments/{id}/status` | JWT valide, **administrateur** | `{ status }` | `200` le tournoi ; `409` si la transition est impossible, `400` si le démarrage est impossible |
| `GET /tournaments/{id}/scoring-rules` | JWT valide | — | `200` `[{ id, tournament_id, stat_id, mode, coefficient, points_table }]` |
| `POST /tournaments/{id}/scoring-rules` | JWT valide, **administrateur** | `{ stat_id, mode, coefficient? }` (`linear`) ou `{ stat_id, mode, points_table }` (`table`) | `201` la règle ; `400` si la statistique n'est pas liée au jeu ; `409` si elle a déjà une règle ou si le barème est verrouillé |
| `PATCH /tournaments/{id}/scoring-rules/{rule_id}` | JWT valide, **administrateur** | `{ mode, coefficient? }` ou `{ mode, points_table }` | `200` la règle ; `409` si le barème est verrouillé |
| `DELETE /tournaments/{id}/scoring-rules/{rule_id}` | JWT valide, **administrateur** | — | `204` ; `409` si le barème est verrouillé |
| `GET /tournaments/{id}/participants` | JWT valide | `?limit`, `?offset` | `200` `[{ id, tournament_id, user_id, tournament_team_id, status, registered_at }]` |
| `POST /tournaments/{id}/participants` | JWT valide | `{ user_id?, tournament_team_id? }` | `201` l'inscription ; `409` si les inscriptions sont fermées, si le participant est déjà inscrit ou si le tournoi est complet |
| `PATCH /tournaments/{id}/participants/{participant_id}` | JWT valide, **administrateur**, ou l'inscrit pour `withdrawn` | `{ status }` | `200` l'inscription |
| `DELETE /tournaments/{id}/participants/{participant_id}` | JWT valide, l'inscrit, le propriétaire de son équipe ou un **administrateur** | — | `204` ; `409` une fois le tournoi `ongoing` |
| `POST /tournaments/{id}/participants/{participant_id}/check-in` | JWT valide, l'inscrit, le propriétaire de son équipe ou un **administrateur** | — | `200` l'inscription au statut `checked_in` |
| `GET /tournaments/{id}/ranking` | JWT valide | — | `200` `[{ rank, participant_id, user_id, tournament_team_id, points }]` |
| `GET /tournaments/{id}/team-ranking` | JWT valide | — | `200` `[{ rank, tournament_team_id, name, points }]` |
| `GET /tournaments/{id}/steps` | JWT valide | — | `200` `[{ id, tournament_id, position, format, match_type, group_count, group_size, matches_per_group, advance_per_group, tiebreak, status, created_at, updated_at }]` par position |
| `GET /tournaments/{id}/steps/{step_id}` | JWT valide | — | `200` l'étape |
| `POST /tournaments/{id}/steps` | JWT valide, **administrateur** | `{ position, format, match_type, group_count, group_size, matches_per_group?, advance_per_group, tiebreak? }` | `201` l'étape `pending` ; `409` si la position est prise ou si le tournoi est `ongoing` ou terminé |
| `PATCH /tournaments/{id}/steps/{step_id}` | JWT valide, **administrateur** | champs de la création, tous facultatifs | `200` l'étape ; `409` comme à la création |
| `DELETE /tournaments/{id}/steps/{step_id}` | JWT valide, **administrateur** | — | `204` ; `409` une fois le tournoi `ongoing` |
| `GET /tournaments/{id}/steps/{step_id}/ranking` | JWT valide | — | `200` `[{ group_id, index, participants: [{ participant_id, points, rank, status }] }]` |
| `POST /tournaments/{id}/steps/{step_id}/start` | JWT valide, **administrateur** | — | `200` l'étape `ongoing` ; `400` si le chaînage ou le nombre de participants ne convient pas ; `409` si le tournoi n'est pas `ongoing`, si l'étape n'est pas `pending` ou si les précédentes ne sont pas `finished` |
| `POST /tournaments/{id}/steps/{step_id}/close` | JWT valide, **administrateur** | — | `200` `{ step, next_step }` ; `409` si l'étape n'est pas `ongoing` |
| `GET /tournaments/{id}/steps/{step_id}/matches` | JWT valide | `?group_id`, `?status` | `200` `[{ id, game_id, step_id, group_id, round, bracket, next_match_id, scheduled_at, started_at, ended_at, status, created_at, updated_at, participants: [{ match_id, participant_id, stats, points, rank, result }] }]` par groupe puis par manche |
| `GET /tournaments/{id}/steps/{step_id}/matches/{match_id}` | JWT valide | — | `200` le match et ses participants |
| `POST /tournaments/{id}/steps/{step_id}/matches` | JWT valide, **administrateur** | `{ group_id, round?, bracket?, next_match_id?, scheduled_at?, participant_ids? }` | `201` le match `scheduled` ; `400` si le groupe, les participants, le tableau ou le match suivant ne conviennent pas ; `409` si l'étape n'est pas `ongoing` |
| `PATCH /tournaments/{id}/steps/{step_id}/matches/{match_id}` | JWT valide, **administrateur** | `{ round?, bracket?, next_match_id?, scheduled_at?, participant_ids? }` (`null` efface) | `200` le match ; `409` s'il est `finished` ou `cancelled`, ou pour `participant_ids` une fois lancé |
| `DELETE /tournaments/{id}/steps/{step_id}/matches/{match_id}` | JWT valide, **administrateur** | — | `204` ; `409` si le match est `finished` |
| `PUT /tournaments/{id}/steps/{step_id}/matches/{match_id}/results` | JWT valide, **administrateur** | `{ results: [{ participant_id, stats, rank?, result? }] }` | `200` le match avec les points calculés ; `400` si une statistique est inconnue ou invalide ; `409` si le match est `finished` ou `cancelled` |
| `POST /tournaments/{id}/steps/{step_id}/matches/{match_id}/status` | JWT valide, **administrateur** | `{ status }` (`ongoing`, `finished` ou `cancelled`) | `200` le match, et `step_closed` (`{ step, next_step }`) quand c'était le dernier de l'étape ; `400` si les participants ou les résultats ne conviennent pas ; `409` pour une transition impossible |
| toute autre route | JWT valide | — | — |

L'authentification se fait par `Authorization: Bearer <access_token>`.

### Réponse de `/login` et `/refresh`

```json
{
  "access_token": "<JWT>",
  "refresh_token": "<64 caractères hexadécimaux>",
  "token_type": "Bearer",
  "expires_in": 900
}
```

Le jeton d'accès est un JWT HS256 dont les claims sont `sub` (id du compte), `username`, `role` (`user`, `admin` ou `watcher`), `iat` et `exp`.

### Règles

- **Inscription :** nom de 3 à 32 caractères (lettres, chiffres, `_`, `.`, `-`), unique sans tenir compte de la casse ; mot de passe de 8 à 128 caractères. Le compte créé a le rôle `user`.
- **`/refresh`** : le jeton de rafraîchissement est à usage unique (il est remplacé à chaque appel) et doit appartenir au compte du JWT. Le rôle est relu en base.
- **`/logout`** : révoque le jeton de rafraîchissement, s'il appartient au compte du JWT. Idempotent : `204` même si le jeton est inconnu, déjà révoqué ou d'un autre compte (dans ce dernier cas il n'est pas révoqué). Le jeton d'accès reste valable jusqu'à son expiration.

- **Jeux :** nom de 1 à 64 caractères (espaces autour retirés), unique sans tenir compte de la casse ; description de 2000 caractères au maximum ; 10 images au maximum, chacune une URL `http(s)` sans espace de 2048 caractères au maximum. `PATCH` remplace les champs fournis (`images` est remplacé en entier).

### Import et export des jeux

Un seul format pour les deux sens : un fichier exporté se réimporte sans perte.

- **JSON :** `{ "version": 1, "games": [{ "name", "description", "images": [], "stats": [] }] }` ; `description`, `images` et `stats` sont facultatifs à l'import, les autres clés sont refusées.
- **CSV :** en-tête `name,description,images,stats` ; `images` sépare les URLs par une espace ; `stats` contient le tableau JSON des statistiques (vide accepté).
- **Import :** un jeu dont le nom (sans tenir compte de la casse) existe déjà met à jour ce jeu, sinon il est créé. Le fichier est validé en entier (mêmes règles que `POST /games`, noms distincts dans le fichier) avant toute écriture, puis les jeux sont écrits en une transaction ; un fichier invalide renvoie `400` avec `errors.file` (dix problèmes au plus).
- **Statistiques :** ce niveau les traite comme des valeurs opaques. Leur validation, leur export et leur import sont délégués au trait `game_io::GameStats`, branché par défaut sur `stat_io::StoreStats` (`AppState::with_stats` permet d'en changer). Chaque jeu embarque `[{ "name", "key", "type" }]` ; importer un jeu crée ou met à jour (par clé) ces statistiques et **remplace** celles qui lui sont liées.

### Import et export des statistiques

Même principe, portée `stat` et `stat - game` uniquement.

- **JSON :** `{ "version": 1, "stats": [{ "name", "key", "type", "games": [] }] }` ; `games` liste les noms des jeux liés et est facultatif à l'import, les autres clés sont refusées.
- **CSV :** en-tête `name,key,type,games` ; `games` contient le tableau JSON des noms de jeux (vide accepté).
- **Import :** une statistique dont la clé existe déjà met à jour cette statistique (nom, type) et **remplace** ses jeux liés, sinon elle est créée. Le fichier est validé en entier avant toute écriture (mêmes règles que `POST /stats`, clés distinctes, jeux existants et distincts) ; un fichier invalide renvoie `400` avec `errors.file` (dix problèmes au plus).

- **Équipes :** nom de 1 à 64 caractères, unique par jeu sans tenir compte de la casse ; tag de 1 à 8 caractères ; photo : URL `http(s)` de 2048 caractères au maximum. Seul le **propriétaire** (l'appelant de `POST /teams`) modifie ou supprime l'équipe et gère ses membres, les administrateurs n'ont pas ce droit. Le propriétaire est membre `owner` : son rôle est fixe, il ne peut pas être retiré et `owner` n'est pas attribuable.
- **Équipes de tournoi :** créées de zéro ou par **copie** d'une équipe globale (nom, tag, photo, propriétaire et membres actifs, éventuellement restreints par `member_ids`, qui doivent être membres actifs). La copie est indépendante : aucune modification ne se propage de l'une à l'autre, et supprimer l'équipe globale garde la copie (`team_id` devient `null`). Une équipe globale s'inscrit une seule fois par tournoi, un joueur n'est que dans une équipe par tournoi. Le tournoi doit exister et être en `draft` ou `registration`, et l'équipe globale copiée doit être du jeu du tournoi.

### Tournois

- **Champs :** `name` de 1 à 128 caractères, unique par jeu sans tenir compte de la casse ; `start_date`, `end_date`, `registration_open_at` et `registration_close_at` en RFC 3339 UTC (`2026-11-14T18:00:00Z`), la fin ne précède pas le début ni la clôture l'ouverture ; `max_participants` de 1 à 10 000 ; `participant_type` vaut `solo` ou `team` et ne se change pas ; `team_size` (1 à 100) est renseigné si et seulement si le tournoi est `team` ; `team_scoring_mode` vaut `none` (défaut), `sum`, `best` ou `top_n`, et `team_scoring_n` (1 à 100) est renseigné si et seulement si le mode est `top_n`.
- **Statuts :** `draft` → `registration` → `ongoing` → `finished`, et `draft`, `registration` ou `ongoing` → `cancelled`. Le passage en `ongoing` exige au moins deux inscrits actifs (ni `withdrawn` ni `disqualified`) et, pour un tournoi par équipes, exactement `team_size` titulaires (propriétaire et membres, remplaçants exclus) dans chaque équipe inscrite ; s'il a des étapes, leur chaînage doit être valide (voir *Étapes*).
- **Barème :** une règle par statistique, qui doit être liée au jeu du tournoi. `linear` : points = valeur × `coefficient` ; `table` : `points_table` associe une valeur à des points (`{"1": 8, "2": 7}`). Le barème est modifiable en `draft` et `registration` seulement. Dès qu'un tournoi est `ongoing`, ses statistiques ne peuvent plus être supprimées ni déliées du jeu (`409 stat_in_use`).
- **Inscriptions :** seulement au statut `registration` et dans la fenêtre d'inscription, si elle est définie. En **solo**, l'appelant s'inscrit lui-même (un administrateur peut désigner `user_id`), seul ou pour une équipe du tournoi dont il est membre (`tournament_team_id`) : les joueurs d'une même équipe s'affrontent mais marquent pour elle. Dans un tournoi **par équipes**, le propriétaire (ou un administrateur) inscrit son équipe (`tournament_team_id` seul), qui doit compter exactement `team_size` titulaires. Un joueur ou une équipe ne s'inscrit qu'une fois ; un inscrit `withdrawn` libère sa place mais garde sa ligne. Le check-in n'est possible qu'au statut `registration`.
- **Classements :** les points d'un inscrit sont la somme de ses points dans les étapes du tournoi (renseignés par la fin des matchs, voir *Matchs*) : tant qu'aucun match n'est terminé, tous les inscrits sont à 0. Les ex æquo partagent le même rang (1, 2, 2, 4) et les inscrits `withdrawn` ou `disqualified` n'y figurent pas. `ranking` classe les joueurs d'un tournoi solo (vide pour un tournoi par équipes) : le gagnant est le rang 1. `team-ranking` classe les équipes : dans un tournoi par équipes, chaque équipe marque ses propres points ; en solo, les points des joueurs d'une même équipe sont agrégés selon `team_scoring_mode` (`sum`, `best`, `top_n` des `team_scoring_n` meilleurs), et le classement est vide avec `none`.

### Étapes

- **Réglages :** `position` de 1 à 100, unique par tournoi ; `format` vaut `pool`, `swiss`, `single_elim` ou `double_elim`, et `match_type` `duel` ou `ffa` (TFT = `pool` + `ffa` + `advance_per_group = group_size / 2`) ; `group_count` de 1 à 1 000 (un seul pour `swiss` et l'élimination, qui classent globalement), `group_size` de 2 à 10 000, `matches_per_group` de 1 à 1 000 (1 par défaut), `advance_per_group` de 1 à `group_size` ; `tiebreak` liste jusqu'à 8 critères distincts en minuscules, chiffres et underscores. Les réglages ne se modifient plus dès que le tournoi est `ongoing` (`409 tournament_locked`).
- **Chaînage :** vérifié au passage du tournoi en `ongoing`, pour un tournoi qui a des étapes. Les positions se suivent à partir de 1 ; l'étape 1 accueille `max_participants` (`group_count × group_size`) ; l'étape n accueille les qualifiés de l'étape n−1 (`group_count × advance_per_group`) ; la dernière étape ne qualifie qu'un participant.
- **Lancement :** le tournoi est `ongoing`, les étapes précédentes sont `finished`. L'étape 1 réunit les inscrits actifs, les suivantes les qualifiés de l'étape précédente. Les participants sont tirés au sort et répartis à tour de rôle dans les groupes, sans règle sur les équipes ; il en faut au moins 2 par groupe et au plus `group_count × group_size`. L'étape passe `ongoing`.
- **Clôture :** chaque groupe est classé aux points (à égalité, l'ordre d'inscription départage), les `advance_per_group` premiers passent `qualified`, les autres `eliminated`, et l'étape suivante s'ouvre toute seule si elle est `pending` et si le nombre de qualifiés lui convient ; sinon elle se lance à la main. Le tournoi reste `ongoing` : il se termine par `POST /tournaments/{id}/status`.
- **À venir :** la génération des matchs au lancement (pool, swiss, élimination) et l'évaluation des critères `tiebreak`, que la clôture ignore : à égalité de points, l'ordre d'inscription départage.

### Matchs

Les matchs se jouent dans les groupes d'une étape `ongoing` (leurs groupes n'existent qu'à son lancement) ; la consultation est ouverte à tout compte, le reste est réservé aux administrateurs. Le lancement d'une étape ne génère pas encore ses matchs : un administrateur les crée.

- **Participants :** inscrits du groupe du match, distincts. Un `duel` oppose exactement 2 participants, un `ffa` de 2 à `group_size` ; ce nombre est exigé pour lancer ou terminer le match. Un match d'élimination peut être créé vide et se remplit par la propagation du vainqueur.
- **Élimination :** `next_match_id` désigne le match de la même étape où va le vainqueur (formats `single_elim` et `double_elim`, sans boucle) ; `bracket` (`winners`, `losers`, `grand_final`) ne se précise qu'en `double_elim`.
- **Statistiques :** `stats` est un objet dont les clés sont les statistiques liées au jeu du tournoi (`stat.key`) et les valeurs des nombres (0 à 100 pour un pourcentage). Pour une équipe, `{ "total": {...}, "players": { "<user_id>": {...} } }` détaille chaque joueur et le barème porte sur `total`.
- **Points :** somme, pour chaque règle du barème du tournoi dont la statistique est renseignée, des points qu'elle rapporte ; une statistique sans règle ne rapporte rien. `PUT .../results` les calcule et remplace le résultat de chaque participant listé.
- **Cycle de vie :** `scheduled` → `ongoing` → `finished`, `cancelled` tant que le match n'est pas terminé, et `scheduled` → `finished` directement. Pour terminer un match, chaque participant a des statistiques ou un rang. Sans aucun rang, ils sont déduits des points (les ex æquo le partagent) ; sans `result`, la première place vaut `win` (`draw` si elle est partagée), les autres `loss`.
- **Fin d'un match :** les points du match s'ajoutent aux points de chaque participant dans l'étape (seuls les matchs `finished` comptent), et, s'il a un `next_match_id`, le vainqueur y est ajouté. Le match a alors un seul `win`, le match suivant est `scheduled` et pas complet (`409` sinon). Tout se fait en une opération.
- **Clôture automatique :** quand chaque groupe a au moins un match `finished` et qu'il n'en reste aucun à jouer (les `cancelled` ne comptent pas), l'étape est clôturée comme par `POST .../close` et la réponse porte `step_closed`. Si cette clôture échoue, le match reste terminé et l'étape se clôture à la main.
- **Verrouillage :** un match `finished` ne se modifie ni ne se supprime ; aucune écriture n'est possible une fois l'étape `finished`.

### Import et export des matchs

Les matchs (`match` et `match_participant`, `stats` JSON compris) s'exportent et s'importent dans le tableau `matches` de leur étape, donc dans le fichier des tournois (`GET /tournaments/export`, `POST /tournaments/import`, JSON ou CSV), avec le même format dans les deux sens. Le niveau des étapes traite `matches` comme une valeur opaque et délègue à `match_io`.

- **Match :** `{ group, round, bracket, next, scheduled_at, started_at, ended_at, status, participants: [{ user | team, stats, points, rank, result }] }`, toutes les clés étant facultatives (`status` vaut `scheduled`, `stats` vaut `{}`). `group` est le rang du groupe dans l'étape, `next` le rang (à partir de 0) du match suivant dans le tableau `matches` de la même étape, et un participant désigne un inscrit comme dans les étapes : `user` ou `team`.
- **Validation :** avant toute écriture, les règles de l'API s'appliquent. L'étape n'est pas `pending` ; le groupe existe ; les participants sont distincts et du groupe du match ; `bracket` seulement en `double_elim` et `next` seulement en élimination, vers un autre match et sans boucle ; `round` de 1 à 1000 ; horodatages RFC 3339 en UTC, `ended_at` après `started_at`, un match `scheduled` sans début ni fin et un match `ongoing` sans fin ; un `duel` compte au plus 2 participants et exactement 2 s'il est `ongoing` ou `finished`, un `ffa` de 2 à `group_size` dans ce cas ; les clés de `stats` sont des statistiques liées au jeu, de valeur numérique ; les rangs vont de 1 au nombre de participants ; un match `finished` donne à chaque participant des statistiques ou un rang, les rangs étant donnés à tous ou à aucun.
- **Import :** remplace tous les matchs de l'étape, une fois l'étape reconstituée. Les `points` du fichier sont conservés ; absents, ils sont calculés d'après le barème du tournoi. Les `rank` et `result` absents d'un match `finished` sont déduits des points comme à la fin d'un match. Un fichier exporté se réimporte sans perte (hors horodatages de création).

### Import et export des équipes

Les équipes de tournoi sont hors périmètre : seuls `teams` et `team_member` sont exportés. Un fichier exporté se réimporte sans perte (l'export d'une base réimportée est identique). Un jeu est désigné par son nom et un compte par son nom d'utilisateur.

- **JSON :** `{ "version": 1, "teams": [{ "game", "name", "tag", "picture_url", "owner", "members": [{ "username", "role", "joined_at", "left_at" }] }] }` ; `tag`, `picture_url`, `joined_at` et `left_at` sont facultatifs à l'import, les autres clés sont refusées.
- **CSV :** en-tête `game,name,tag,picture_url,owner,members` ; `members` contient le tableau JSON des membres.
- **Membres :** le tableau décrit l'état complet de l'équipe, anciens membres compris (`left_at` renseigné). Le propriétaire y figure comme unique membre `owner` actif ; un compte n'est membre actif qu'une fois. Les horodatages sont en RFC 3339 UTC (`2026-10-26T14:03:09Z`, six décimales au plus) ; `joined_at` vaut l'instant de l'import s'il est absent, et `left_at` exige `joined_at`.
- **Import :** une équipe dont le jeu et le nom (sans tenir compte de la casse) existent déjà met à jour cette équipe (tag, photo, propriétaire) et **remplace** ses membres, sinon elle est créée. Les jeux et les comptes doivent exister. Le fichier est validé en entier avant toute écriture (mêmes règles que `POST /teams`, équipes distinctes) ; un fichier invalide renvoie `400` avec `errors.file` (dix problèmes au plus).

### Import et export des tournois

Un fichier exporté se réimporte sans perte (hors horodatages de création et de modification). Un jeu est désigné par son nom, une statistique par sa clé et un compte par son nom d'utilisateur.

- **JSON :** `{ "version": 1, "tournaments": [{ "game", "name", "description", "start_date", "end_date", "registration_open_at", "registration_close_at", "participant_type", "team_size", "max_participants", "team_scoring_mode", "team_scoring_n", "status", "scoring_rules": [{ "stat", "mode", "coefficient", "points_table" }], "participants": [{ "user", "team", "status", "registered_at" }], "teams": [], "steps": [], "matches": [] }] }` ; seuls `game`, `name`, `start_date`, `end_date`, `participant_type` et `max_participants` sont obligatoires, les autres clés inconnues sont refusées.
- **CSV :** en-tête `game,name,description,start_date,end_date,registration_open_at,registration_close_at,participant_type,team_size,max_participants,team_scoring_mode,team_scoring_n,status,scoring_rules,participants,teams,steps,matches` ; les cinq dernières colonnes contiennent le tableau JSON correspondant.
- **Inscrits :** `user` désigne un joueur (obligatoire en solo, interdit dans un tournoi par équipes) et `team` le rang, à partir de 0, d'une équipe du tableau `teams` (obligatoire dans un tournoi par équipes, facultatif en solo où le joueur marque pour cette équipe).
- **Composition :** `teams`, `steps` et `matches` sont des valeurs opaques pour ce niveau : leur validation, leur export et leur import sont délégués à leur propre sous-niveau (`TournamentChild`, branché sur `AppState`). Les équipes de tournoi sont gérées par `tournament_team_io` : `{ name, tag, picture_url, owner, origin, members: [{ username, role }] }`, `origin` étant le nom de l'équipe globale copiée dans le jeu du tournoi. Les étapes sont gérées par `step_io` (voir ci-dessous), et les matchs voyagent avec leur étape : le tableau `matches` du tournoi doit rester vide, un fichier qui en contient est refusé (`steps[].matches`).
- **Import :** un tournoi dont le jeu et le nom (sans tenir compte de la casse) existent déjà met à jour ce tournoi et **remplace** son barème, ses inscrits, ses équipes, ses étapes et ses matchs, sinon il est créé avec le `status` du fichier (`draft` par défaut). Un tournoi existant `ongoing` ou `finished` est refusé, ses résultats étant verrouillés. Le fichier est validé en entier avant toute écriture (champs comme `POST /tournaments`, statistiques liées au jeu, barème, inscrits, plafond `max_participants`, sous-niveaux) ; un fichier invalide renvoie `400` avec `errors.file` (dix problèmes au plus). Les écritures se font ensuite dans l'ordre (tournois et barèmes en une transaction, puis équipes, étapes, matchs et inscrits de chaque tournoi) : une panne en cours de route peut laisser un tournoi à moitié importé, qu'un nouvel import du même fichier complète.
- **Étapes :** `steps` est un tableau de `{ position, format, match_type, group_count, group_size, matches_per_group, advance_per_group, tiebreak, status, groups: [{ index, participants: [{ user | team, points, final_rank, status }] }], matches }` ; seuls `position`, `format`, `match_type`, `group_count`, `group_size` et `advance_per_group` sont obligatoires (`matches_per_group` vaut 1, `tiebreak` est vide, `status` vaut `pending`). Un participant d'étape désigne un inscrit comme le fichier du tournoi : `user` pour un joueur, `team` (rang dans `teams`) pour une équipe inscrite seule ; il doit figurer dans `participants`. Les réglages suivent les règles de `POST /tournaments/{id}/steps`. Une étape `pending` n'a pas de groupes ; une étape `ongoing` ou `finished` en a exactement `group_count`, numérotés de 1, d'au plus `group_size` participants chacun ; une étape `finished` donne à chaque participant un `final_rank` (de 1 à la taille du groupe, sans doublon) et un statut `qualified` pour les `advance_per_group` premiers, `eliminated` pour les autres ; une étape lancée suppose les précédentes `finished` et ses participants qualifiés à la précédente. `matches` est opaque pour ce niveau, qui délègue sa validation, son export et son import à `StepMatches` (voir *Import et export des matchs*). L'import remplace toutes les étapes du tournoi et reconstitue une étape lancée comme l'API (création, lancement, points, clôture), après l'écriture des inscrits.

### Erreurs

Format `{ "error", "message", "errors"? }` :

| Statut | `error` | Cas |
|---|---|---|
| `400` | `invalid_request` | corps illisible ou champs invalides (`errors` donne le détail par champ) |
| `401` | `unauthorized` | jeton absent, invalide ou expiré ; identifiants ou jeton de rafraîchissement refusés |
| `403` | `forbidden` | action réservée aux administrateurs ou au propriétaire de l'équipe, ou changement de son propre rôle |
| `404` | `not_found` | compte, jeu, statistique, équipe, tournoi ou inscription introuvable (ou identifiant qui n'est pas un UUID) |
| `409` | `username_taken` | nom d'utilisateur déjà pris |
| `409` | `game_name_taken` | nom de jeu déjà pris |
| `409` | `stat_key_taken` | clé de statistique déjà prise |
| `409` | `stat_in_use` | statistique utilisée par un tournoi en cours |
| `409` | `team_name_taken` | nom d'équipe déjà pris pour ce jeu |
| `409` | `already_team_member` | compte déjà membre actif de l'équipe |
| `409` | `team_already_registered` | équipe globale déjà inscrite à ce tournoi |
| `409` | `player_already_registered` | joueur déjà dans une équipe de ce tournoi |
| `409` | `tournament_name_taken` | nom de tournoi déjà pris pour ce jeu |
| `409` | `scoring_rule_taken` | le barème définit déjà cette statistique |
| `409` | `already_registered` | joueur ou équipe déjà inscrit au tournoi |
| `409` | `tournament_full` | `max_participants` atteint |
| `409` | `tournament_locked` | tournoi en cours ou terminé : barème, capacité, suppression ou équipes verrouillés |
| `409` | `step_position_taken` | une étape occupe déjà cette position dans le tournoi |
| `409` | `registration_closed` | tournoi hors `registration` ou hors de la fenêtre d'inscription |
| `409` | `invalid_status_transition` | changement de statut impossible depuis le statut actuel |
| `500` | `internal` | erreur serveur (détail journalisé, jamais renvoyé) |

## Configuration

| Variable | Défaut | Rôle |
|---|---|---|
| `JWT_SECRET` | — (obligatoire, 32 caractères minimum) | clé de signature des jetons d'accès |
| `ACCESS_TOKEN_TTL_SECS` | `900` | durée du jeton d'accès |
| `REFRESH_TOKEN_TTL_SECS` | `2592000` | durée du jeton de rafraîchissement |

## Rôles

Les inscriptions créent des `user`. Les rôles sont `user`, `admin` et `watcher`. Un administrateur change le rôle d'un compte avec `PATCH /user/{id}/update` ; le premier administrateur se désigne en base :

```sql
UPDATE users SET role = 'admin' WHERE lower(username) = lower('<nom>');
```

Le changement apparaît dans le jeton d'accès au prochain `/refresh` ou `/login`. Les routes réservées aux administrateurs ne se fient pas au claim `role` (qui peut dater de `ACCESS_TOKEN_TTL_SECS`) : elles relisent le rôle courant en base (hors cache), si bien qu'un administrateur rétrogradé ou supprimé perd ses droits immédiatement. Le framework est actix-web ([ADR-010](adr/010-api-publique-actix-web.md)).
