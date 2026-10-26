# OpenAPI

`openapi.json` est la spécification de l'API publique. Les types TypeScript du web
(`web/src/lib/api/generated/schema.ts`) et du mobile (`mobile/src/api/generated/schema.ts`)
en sont générés ; ne pas les modifier à la main.

Depuis `web/` ou `mobile/` :

- `npm run openapi:generate` : télécharge la spec depuis l'API lancée
  (`OPENAPI_URL`, défaut `http://localhost:8080/openapi.json`) ;
- `npm run openapi:build` : génère le code TypeScript à partir de `openapi/openapi.json`.

À la release, `.github/scripts/generate-openapi.sh` (appelé par `bump-version.sh`) produit la
spec avec `cargo run --bin openapi` (sans serveur), régénère les deux fichiers TS, et
semantic-release les commit avec la version.
