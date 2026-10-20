#!/usr/bin/env bash
# Tests des migrations, en local comme en CI : base PostgreSQL jetable, migrations avec
# test du rollback (update → rollback → update), puis chaque fichier db/tests/*.test.sql.
set -euo pipefail
db="$(cd "$(dirname "$0")/.." && pwd)"
name="epickem-dbtest-$$"

cleanup() {
  docker rm -f "$name-pg" >/dev/null 2>&1 || true
  docker network rm "$name" >/dev/null 2>&1 || true
  docker rmi "$name" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker network create "$name" >/dev/null
docker run -d --rm --name "$name-pg" --network "$name" \
  -e POSTGRES_DB=epickem -e POSTGRES_USER=epickem -e POSTGRES_PASSWORD=epickem \
  postgres:17-alpine >/dev/null
docker build -q -t "$name" "$db" >/dev/null

# Via TCP : pendant l'initialisation, PostgreSQL n'écoute que sur le socket Unix.
for _ in $(seq 60); do
  docker exec "$name-pg" pg_isready -q -h 127.0.0.1 -U epickem && break
  sleep 1
done

echo "== Migrations (update-testing-rollback)"
# Sortie de Liquibase affichée uniquement en cas d'échec.
if ! log=$(docker run --rm --network "$name" \
  -e LIQUIBASE_COMMAND_URL="jdbc:postgresql://$name-pg:5432/epickem" \
  -e LIQUIBASE_COMMAND_USERNAME=epickem \
  -e LIQUIBASE_COMMAND_PASSWORD=epickem \
  "$name" update-testing-rollback 2>&1); then
  echo "$log"
  exit 1
fi
echo "ok"

echo "== Tests SQL"
for test in "$db"/tests/*.test.sql; do
  cat "$db/tests/helpers.sql" "$test" \
    | docker exec -i "$name-pg" psql -X -q -o /dev/null -v ON_ERROR_STOP=1 -U epickem -d epickem
  echo "ok $(basename "$test")"
done
