# web

Front web d'Epick'em : React 19 + TypeScript, [Vite](https://vite.dev), [Tailwind CSS v4](https://tailwindcss.com) et [shadcn/ui](https://ui.shadcn.com) (preset `b5vnF8h2A` : base Radix UI, style nova, thème violet, icônes Hugeicons, police Inter).

## Commandes

Prérequis : Node.js 22+.

```sh
npm ci            # installe les dépendances (lockfile)
npm run dev       # serveur de dev sur http://localhost:5173
npm run lint      # oxlint
npm test          # vitest (une seule exécution)
npm run build     # typecheck + build de production dans dist/
```

## Structure

| Dossier | Contenu |
|---|---|
| `src/pages/` | Écrans : `LoginPage`, `RegisterPage`, `HomePage` (zone authentifiée), `GamesPage`, `GameDetailsPage`, `GameEditorPage`, `GameTransferPage`, `NotFoundPage` |
| `src/components/` | `ui/` (shadcn), `form/` (champ accessible, résumé d'erreurs), `layout/` (shell, en-tête), `home/` (blocs du tableau de bord), `auth/` (routes protégée, invité, admin), `games/` (carte, image, formulaire, confirmation de suppression) |
| `src/lib/api/` | Client HTTP (`client.ts`), appels d'authentification (`auth.ts`), lecture des erreurs serveur |
| `src/lib/auth/` | `AuthProvider`, `useAuth` (rôle, `isAdmin`), stockage observable des tokens (`token-store.ts`), renouvellement de session (`session.ts`), lecture des claims JWT (`jwt.ts`) |
| `src/features/games/` | Types, appels API, validation, import/export de fichiers, messages d'erreur |
| `src/i18n/` | Traductions FR/EN (`fr.ts`, `en.ts`), `I18nProvider`, `LanguageSwitcher` |
| `src/lib/validation/` | Règles de validation alignées sur le backend |

Routes : `/login`, `/register`, `/app` (protégée, redirige vers `/login`), `/games`, `/games/:id` (tous les rôles), `/games/new`, `/games/:id/edit`, `/games/transfer` (administrateurs).

`/app` est la page principale, atteinte après connexion : en-tête avec navigation principale, nom du compte et déconnexion, puis un tableau de bord en quatre blocs (tournois en direct, mes pronostics, classement général, mes groupes). Les blocs affichent « Bientôt disponible » tant que les API correspondantes n'existent pas ; pour en brancher un, passer le contenu réel en `children` de `DashboardSection` (`src/components/home/`). Pour ajouter une entrée de navigation, compléter `NAV_ITEMS` dans `src/components/layout/AppHeader.tsx`.

## Authentification

Contrat de l'API publique (voir `backend/crates/api-public`) :

| Appel | Succès | Erreurs gérées |
|---|---|---|
| `POST /register` | 201 jetons (corps ignoré par le web) | 400 (`errors` par champ), 409 (nom déjà pris) |
| `POST /login` | 200 `{ access_token, refresh_token, token_type, expires_in }` | 400, 401 |
| `POST /logout` (Bearer JWT + `{ refresh_token }`) | 204 (révoque le refresh token) | ignorées : la session locale est fermée quoi qu'il arrive |

- `register` n'accepte que le **201** : un autre 2xx (proxy mal ciblé, squelette) est traité comme une erreur inattendue plutôt qu'un faux « Compte créé ».
- Après connexion, `GuestRoute` envoie vers la page visée avant la connexion, sinon vers `/app` ; un utilisateur déjà connecté qui ouvre `/login` ou `/register` est renvoyé vers `/app`.
- Seul mécanisme d'authentification : `Authorization: Bearer <JWT>`. Jamais d'en-tête `X-User-Id`.
- Les tokens restent **en mémoire** (pas de `localStorage`, exposé au XSS) : la session est perdue au rechargement de la page.
- **Renouvellement automatique** (`apiRequest`) : sur 401, `POST /refresh` (Bearer expiré toléré + `{ refresh_token }`, à usage unique) est appelé **une seule fois à la fois**, puis la requête est rejouée une fois. Si le serveur refuse le refresh token, ou si le rejeu est encore en 401, la session locale est fermée et l'utilisateur revient à `/login`. Une panne réseau pendant le renouvellement laisse la session intacte.
- **Rôle** : lu dans les claims du JWT (`role` : `user`, `admin`, `watcher`) pour adapter l'interface uniquement, sans vérifier la signature. Le serveur reste l'autorité (il relit le rôle en base et répond 403). Sur un 403 inattendu, la session est renouvelée pour relire le rôle ; l'écran d'administration disparaît si le rôle n'est plus `admin`.

## Jeux

Contrat : `GET /games?limit=&offset=` (ordre alphabétique du serveur), `GET /games/{id}`, `POST /games` (201), `PATCH /games/{id}` (champs modifiés uniquement), `DELETE /games/{id}` (204), `GET /games/export?format=json|csv`, `POST /games/import?format=json|csv` (corps brut, 256 Kio max). Tous les rôles consultent ; seuls les administrateurs créent, modifient, suppriment, importent et exportent (contrôles masqués aux autres, accès direct aux URL d'administration refusé, 401/403/404/409 traités).

- **Pagination** : taille de page 12 ; le front demande une entrée de plus (`limit=13`) pour savoir s'il existe une page suivante (l'API ne renvoie pas de total). La page est dans l'URL (`?page=`).
- **Validation** (`features/games/validation.ts`), identique au serveur : nom 1–64 caractères après trim, description ≤ 2000 caractères, ≤ 10 images, URL `http(s)` sans espace ≤ 2048 octets UTF-8. Un nom déjà pris (409 `game_name_taken`, insensible à la casse) est affiché sur le champ.
- **Export** : le fichier du serveur est téléchargé tel quel (`Content-Disposition` pour le nom, repli `games.<format>`).
- **Import** : contrôles locaux (extension `.json`/`.csv`, 1 octet–256 Kio, UTF-8, JSON syntaxiquement valide) puis envoi du corps brut ; le résultat `{ created, updated }` et `errors.file` du serveur sont affichés.
- **Statistiques** : hors périmètre. Les exports contiennent des statistiques vides et le serveur refuse les imports qui en contiennent.
- Les types de `/games` sont écrits à la main : l'OpenAPI du dépôt ne décrit pas encore cette ressource.

## Langues

Les écrans de jeux, l'en-tête et le sélecteur de langue sont disponibles en **français** (défaut) et en **anglais** (`src/i18n/`, choix mémorisé dans `localStorage` sous `epickem-lang`, attribut `lang` du document mis à jour). Les écrans de connexion, d'inscription et d'accueil restent en français pour l'instant. Toute nouvelle clé doit exister dans `fr.ts` et `en.ts` (le type `Messages` le vérifie).

## API

Le navigateur appelle `/api/*`, proxifié vers `api-public` en retirant le préfixe `/api` :

- en dev, par Vite (`VITE_DEV_API_TARGET`, défaut `http://localhost:8080`) ;
- en Docker, par nginx (`API_UPSTREAM`, défaut `api-public:8080`).

Variables : voir [`.env.example`](.env.example) (`.env.local` pour surcharger).

## Accessibilité

Formulaires : libellés reliés, aide et erreurs liées aux champs (`aria-describedby`, `aria-invalid`), résumé d'erreurs annoncé (`role="alert"`) qui reçoit le focus, `autocomplete` adaptés, titre de page par écran, lien d'évitement, focus ramené sur le contenu à chaque navigation. Cible : WCAG 2.2 AA.

## Ajouter un composant shadcn/ui

```sh
npx shadcn@latest add <composant>   # ex. dialog, card, table
```

La configuration est dans [`components.json`](components.json) ; alias `@/` → `src/`.

## Docker

```sh
docker build -t epickem-web web/
docker run --rm -p 3000:8080 epickem-web   # http://localhost:3000
```

Image en deux étapes (build Node, puis nginx non-root sur le port 8080 avec fallback SPA et `/healthz`). Via Compose : `make up` expose le front sur `WEB_PORT` (3000 par défaut).

## CI

[`.github/workflows/web.yml`](../.github/workflows/web.yml) exécute `npm ci`, `npm run lint`, `npm test` et `npm run build` à chaque PR touchant `web/`.

## Apparence

Configuration shadcn : `npx shadcn@latest init --preset b5vnF8h2A --base radix --template vite`. Les composants existants utilisent ce preset.
Le logo partagé est servi depuis `public/brand/epickem-logo.svg`. Le bouton de l’en-tête permet de basculer entre les thèmes clair et sombre ; le mode sombre est actif par défaut et le choix est mémorisé localement.
