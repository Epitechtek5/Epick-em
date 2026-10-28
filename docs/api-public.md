# API publique — authentification, comptes, jeux, statistiques et équipes

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
- **Équipes de tournoi :** créées de zéro ou par **copie** d'une équipe globale (nom, tag, photo, propriétaire et membres actifs, éventuellement restreints par `member_ids`, qui doivent être membres actifs). La copie est indépendante : aucune modification ne se propage de l'une à l'autre, et supprimer l'équipe globale garde la copie (`team_id` devient `null`). Une équipe globale s'inscrit une seule fois par tournoi, un joueur n'est que dans une équipe par tournoi. La table des tournois (#62) n'existe pas encore : `tournament_id` n'est pas vérifié, ni la règle « le jeu de l'équipe est celui du tournoi ».

### Import et export des équipes

Les équipes de tournoi sont hors périmètre : seuls `teams` et `team_member` sont exportés. Un fichier exporté se réimporte sans perte (l'export d'une base réimportée est identique). Un jeu est désigné par son nom et un compte par son nom d'utilisateur.

- **JSON :** `{ "version": 1, "teams": [{ "game", "name", "tag", "picture_url", "owner", "members": [{ "username", "role", "joined_at", "left_at" }] }] }` ; `tag`, `picture_url`, `joined_at` et `left_at` sont facultatifs à l'import, les autres clés sont refusées.
- **CSV :** en-tête `game,name,tag,picture_url,owner,members` ; `members` contient le tableau JSON des membres.
- **Membres :** le tableau décrit l'état complet de l'équipe, anciens membres compris (`left_at` renseigné). Le propriétaire y figure comme unique membre `owner` actif ; un compte n'est membre actif qu'une fois. Les horodatages sont en RFC 3339 UTC (`2026-10-26T14:03:09Z`, six décimales au plus) ; `joined_at` vaut l'instant de l'import s'il est absent, et `left_at` exige `joined_at`.
- **Import :** une équipe dont le jeu et le nom (sans tenir compte de la casse) existent déjà met à jour cette équipe (tag, photo, propriétaire) et **remplace** ses membres, sinon elle est créée. Les jeux et les comptes doivent exister. Le fichier est validé en entier avant toute écriture (mêmes règles que `POST /teams`, équipes distinctes) ; un fichier invalide renvoie `400` avec `errors.file` (dix problèmes au plus).

### Erreurs

Format `{ "error", "message", "errors"? }` :

| Statut | `error` | Cas |
|---|---|---|
| `400` | `invalid_request` | corps illisible ou champs invalides (`errors` donne le détail par champ) |
| `401` | `unauthorized` | jeton absent, invalide ou expiré ; identifiants ou jeton de rafraîchissement refusés |
| `403` | `forbidden` | action réservée aux administrateurs ou au propriétaire de l'équipe, ou changement de son propre rôle |
| `404` | `not_found` | compte, jeu, statistique ou équipe introuvable (ou identifiant qui n'est pas un UUID) |
| `409` | `username_taken` | nom d'utilisateur déjà pris |
| `409` | `game_name_taken` | nom de jeu déjà pris |
| `409` | `stat_key_taken` | clé de statistique déjà prise |
| `409` | `stat_in_use` | statistique utilisée par un tournoi en cours |
| `409` | `team_name_taken` | nom d'équipe déjà pris pour ce jeu |
| `409` | `already_team_member` | compte déjà membre actif de l'équipe |
| `409` | `team_already_registered` | équipe globale déjà inscrite à ce tournoi |
| `409` | `player_already_registered` | joueur déjà dans une équipe de ce tournoi |
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
