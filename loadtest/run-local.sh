#!/usr/bin/env bash
# Test de charge reproductible, dans un environnement isolé et jetable :
#   PostgreSQL + Redis dans des conteneurs dédiés, migrations Liquibase, api-public compilé en
#   release et lancé sur l'hôte, comptes de test, puis le scénario k6 `tournament-live.js`.
# Tout ce qui est créé (conteneurs, réseau, volumes, processus) est supprimé à la sortie.
#
#   loadtest/run-local.sh                       # paramètres par défaut
#   PEAK_VUS=400 DURATION=5m LOAD_GROUPS=8 loadtest/run-local.sh
#
# Ne vise jamais un environnement partagé ni la production : l'API testée est celle qu'il lance.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
name="epk-load"
pg_port="${PG_PORT:-55433}"
redis_port="${REDIS_PORT:-56380}"
api_port="${API_PORT:-18080}"
password="loadtest-password"
spectators="${SPECTATORS:-50}"
groups="${LOAD_GROUPS:-8}"
players=$((groups * 8))
k6_image="${K6_IMAGE:-grafana/k6:1.0.0}"
pg_image="postgres:17-alpine"
redis_image="${REDIS_IMAGE:-redis:8.4.0-bookworm}"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
results="$root/loadtest/results"
summary="$results/tournament-live-$stamp.json"
api_pid=""

cleanup() {
  [ -n "$api_pid" ] && kill "$api_pid" 2>/dev/null || true
  docker rm -f -v "$name-pg" "$name-redis" >/dev/null 2>&1 || true
  docker network rm "$name" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "› Conteneurs PostgreSQL et Redis"
docker network create "$name" >/dev/null
docker run -d --name "$name-pg" --network "$name" -p "127.0.0.1:$pg_port:5432" \
  -e POSTGRES_USER=epk -e POSTGRES_PASSWORD=epk -e POSTGRES_DB=epk "$pg_image" >/dev/null
docker run -d --name "$name-redis" --network "$name" -p "127.0.0.1:$redis_port:6379" "$redis_image" >/dev/null
until docker exec "$name-pg" pg_isready -U epk -d epk >/dev/null 2>&1; do sleep 1; done
sleep 2

echo "› Migrations"
docker run --rm --network "$name" -v "$root/db/changelog:/liquibase/changelog:ro,z" liquibase/liquibase:4.31 \
  --changelog-file=changelog/db.changelog-master.yaml --url="jdbc:postgresql://$name-pg:5432/epk" \
  --username=epk --password=epk update >/dev/null

echo "› api-public (release)"
cargo build -q --release --manifest-path "$root/backend/Cargo.toml" -p api-public
DATABASE_URL="postgres://epk:epk@127.0.0.1:$pg_port/epk" REDIS_URL="redis://127.0.0.1:$redis_port" \
  JWT_SECRET="loadtest-secret-loadtest-secret-0123456789" API_PUBLIC_PORT="$api_port" \
  "$root/backend/target/release/api-public" >"$results/.api.log" 2>&1 &
api_pid=$!
until curl -fs "http://127.0.0.1:$api_port/health" >/dev/null; do
  kill -0 "$api_pid" 2>/dev/null || { cat "$results/.api.log"; exit 1; }
  sleep 0.5
done

echo "› Comptes : 1 arbitre, $spectators spectateurs, $players joueurs"
# L'inscription est limitée par adresse IP : seul l'arbitre passe par l'API ; les autres comptes
# reprennent son empreinte de mot de passe (même mot de passe), directement en base.
curl -fsS -X POST "http://127.0.0.1:$api_port/register" -H 'Content-Type: application/json' \
  -d "{\"username\":\"referee\",\"password\":\"$password\",\"email\":\"referee@load.test\"}" >/dev/null
psql() { docker exec "$name-pg" psql -q -tA -U epk -d epk -c "$1"; }
psql "UPDATE users SET email_verified_at = now(), role = 'admin' WHERE username = 'referee';
      INSERT INTO users (username, email, password_hash, email_verified_at)
        SELECT prefix || i, prefix || i || '@load.test',
               (SELECT password_hash FROM users WHERE username = 'referee'), now()
        FROM (VALUES ('spectator', $spectators), ('player', $players)) AS kinds(prefix, n),
             generate_series(0, n - 1) AS i;"
player_ids="$(psql "SELECT string_agg(id::text, ',' ORDER BY username) FROM users WHERE username LIKE 'player%'")"

echo "› k6 ($k6_image)"
docker run --rm --network host -u "$(id -u):$(id -g)" -v "$root/loadtest:/loadtest:z" \
  -e BASE_URL="http://127.0.0.1:$api_port" -e ADMIN_EMAIL=referee@load.test -e PASSWORD="$password" \
  -e SPECTATORS="$spectators" -e PLAYERS="$player_ids" -e GROUPS="$groups" \
  -e MATCHES_PER_GROUP="${MATCHES_PER_GROUP:-10}" -e PEAK_VUS="${PEAK_VUS:-200}" \
  -e DURATION="${DURATION:-3m}" -e RESULTS_RATE="${RESULTS_RATE:-1}" \
  -e SUMMARY="/loadtest/results/$(basename "$summary")" \
  "$k6_image" run /loadtest/tournament-live.js && status=0 || status=$?

echo "› Résumé : $summary (code k6 : $status)"
rm -f "$results/.api.log"
exit "$status"
