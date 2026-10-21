#!/usr/bin/env bash
set -Eeuo pipefail

image="$1"
suffix="${GITHUB_RUN_ID:-local}-$$"
network="v3-release-${suffix}"
postgres="v3-pg-${suffix}"
backend="v3-api-${suffix}"
cleanup() {
  docker rm -f "$backend" "$postgres" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker network create --internal "$network" >/dev/null
docker run -d --network "$network" --name "$postgres" \
  -e POSTGRES_USER=v3_smoke -e POSTGRES_PASSWORD=v3_smoke_only \
  -e POSTGRES_DB=v3_smoke postgres:17 >/dev/null
for attempt in $(seq 1 40); do
  if docker exec "$postgres" pg_isready -U v3_smoke -d v3_smoke >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec "$postgres" pg_isready -U v3_smoke -d v3_smoke >/dev/null

docker run -d --network "$network" --name "$backend" \
  -e DATABASE_URL="postgresql://v3_smoke:v3_smoke_only@${postgres}:5432/v3_smoke" \
  -e PGSSLMODE=disable \
  -e DATA_DIR=/data "$image" >/dev/null
for attempt in $(seq 1 60); do
  if [[ "$(docker inspect --format '{{.State.Running}}' "$backend")" != true ]]; then
    docker logs --tail 60 "$backend" >&2
    exit 1
  fi
  if docker exec "$backend" node -e \
    "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))" \
    >/dev/null 2>&1; then
    test "$(docker inspect --format '{{.RestartCount}}' "$backend")" = 0
    echo "HTTP_200_BOOTSTRAP_PASS=$image"
    exit 0
  fi
  sleep 1
done
docker logs --tail 60 "$backend" >&2
exit 1
