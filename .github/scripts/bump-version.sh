#!/usr/bin/env bash
# Appelé par semantic-release (prepareCmd) : reporte la nouvelle version dans les manifestes.
set -euo pipefail
version="$1"
root="$(cd "$(dirname "$0")/../.." && pwd)"

# Première ligne `version = …` du workspace : celle de [workspace.package]
sed -i "0,/^version = .*/s//version = \"${version}\"/" "$root/backend/Cargo.toml"
(cd "$root/backend" && cargo update --workspace)

sed -i -E "s/^(version|appVersion): .*/\1: \"${version}\"/" "$root/deploy/helm/epickem/Chart.yaml"
