#!/usr/bin/env bash
# Régénère la spécification OpenAPI et les types TypeScript du web et du mobile.
# Appelé par bump-version.sh à la release ; sans serveur ni base de données.
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"

cargo run -q --manifest-path "$root/backend/Cargo.toml" -p api-public --bin openapi > "$root/openapi/openapi.json"

for app in web mobile; do
  (cd "$root/$app" && npm ci --no-audit --no-fund && npm run openapi:build)
done
