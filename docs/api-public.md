# API publique — authentification, comptes et jeux

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

### Erreurs

Format `{ "error", "message", "errors"? }` :

| Statut | `error` | Cas |
|---|---|---|
| `400` | `invalid_request` | corps illisible ou champs invalides (`errors` donne le détail par champ) |
| `401` | `unauthorized` | jeton absent, invalide ou expiré ; identifiants ou jeton de rafraîchissement refusés |
| `403` | `forbidden` | action réservée aux administrateurs, ou changement de son propre rôle |
| `404` | `not_found` | compte ou jeu introuvable (ou identifiant qui n'est pas un UUID) |
| `409` | `username_taken` | nom d'utilisateur déjà pris |
| `409` | `game_name_taken` | nom de jeu déjà pris |
| `409` | `stat_key_taken` | clé de statistique déjà prise |
| `409` | `stat_in_use` | statistique utilisée par un tournoi en cours |
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
