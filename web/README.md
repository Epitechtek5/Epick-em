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
