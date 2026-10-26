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
| `src/pages/` | Écrans : `LoginPage`, `RegisterPage`, `HomePage` (zone authentifiée), `NotFoundPage` |
| `src/components/` | `ui/` (shadcn), `form/` (champ accessible, résumé d'erreurs), `layout/`, `auth/` (route protégée) |
| `src/lib/api/` | Client HTTP (`client.ts`), appels d'authentification (`auth.ts`), lecture des erreurs serveur |
| `src/lib/auth/` | `AuthProvider`, `useAuth`, stockage des tokens (`token-store.ts`) |
| `src/lib/validation/` | Règles de validation alignées sur le backend |

Routes : `/login`, `/register`, `/app` (protégée, redirige vers `/login`).

## Authentification

- `POST /register` est branché (201 → connexion, 400 → erreurs affichées, 409 → nom déjà pris).
- `POST /login` renvoie `{ access_token, refresh_token, token_type, expires_in }` et `POST /refresh` / `POST /logout` existent côté API (voir [`docs/api-public.md`](../docs/api-public.md)). Le client web utilise encore un contrat provisoire (`src/lib/api/auth.ts`, `TODO(#15)`) à aligner : `/refresh` et `/logout` exigent un `Authorization: Bearer` et un corps `{ refresh_token }`.
- Seul mécanisme d'authentification : `Authorization: Bearer <JWT>`. Jamais d'en-tête `X-User-Id`.
- Les tokens restent **en mémoire** (pas de `localStorage`, exposé au XSS) ; la persistance de session passera par un cookie httpOnly (#15).

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
