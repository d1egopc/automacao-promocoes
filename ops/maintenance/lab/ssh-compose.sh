#!/usr/bin/env bash
set -euo pipefail
test "${GITHUB_ACTIONS:-}" = true
test "${RUNNER_ENVIRONMENT:-}" = github-hosted
test "${GITHUB_REF:-}" = refs/heads/validation/optimus-vps-maintenance-v1
candidate=b59f5e8563f612bd4df640a91f511ff55be152ff
git diff --quiet "$candidate" HEAD -- modules/engine/universal-claim-fence.service.js \
  ops/maintenance/entry.cjs ops/maintenance/broker.cjs ops/maintenance/deployment.cjs \
  ops/maintenance/docker-host.cjs ops/maintenance/fence.cjs ops/maintenance/audit.cjs

lab=$(mktemp -d "${RUNNER_TEMP}/optimus-maintenance-e2e.XXXXXX")
infra="$lab/infra"
# OpenSSH and the low-privilege fixture accounts must be able to traverse these paths.
chmod 755 "$lab"
mkdir "$infra"
project=optimus-maintenance-e2e
compose=(docker compose -p "$project" -f "$infra/compose.yml" -f "$infra/backend-release.yml")
cleanup() {
  "${compose[@]}" down >/dev/null 2>&1 || true
  docker rm -f v1-fixture-registry >/dev/null 2>&1 || true
  if test -s "$lab/sshd.pid"; then sudo kill "$(cat "$lab/sshd.pid")" || true; fi
}
trap cleanup EXIT
on_error() {
  echo "Fixture failed at line $1"
  sudo journalctl -t optimus-maintenance-v1 -n 35 --no-pager || true
  test ! -r "$lab/sshd.log" || tail -n 15 "$lab/sshd.log"
}
trap 'on_error $LINENO' ERR

docker run -d --name v1-fixture-registry -p 127.0.0.1:15000:5000 registry:2 >/dev/null
mkdir -p "$lab/build/modules/engine" "$lab/build/ops/maintenance"
cp modules/engine/{universal-claim-fence.service.js,operation-epoch.js} "$lab/build/modules/engine/"
cp ops/maintenance/fence.cjs "$lab/build/ops/maintenance/"
cp ops/maintenance/lab/backend.cjs "$lab/build/backend.cjs"
cat > "$lab/build/Dockerfile" <<'EOF'
FROM node:24-bookworm
WORKDIR /app
RUN npm install --no-save --ignore-scripts --no-audit --no-fund pg@8.22.0
COPY modules modules
COPY ops ops
COPY backend.cjs /app/backend.cjs
ARG FIXTURE_HEALTH=healthy
RUN printf '%s\n' "$FIXTURE_HEALTH" > /app/fixture-health
USER node
CMD ["/usr/local/bin/node","/app/backend.cjs"]
EOF
for image in base good bad; do
  status=healthy
  [[ "$image" != bad ]] || status=unhealthy
  ref="localhost:15000/fixture-$image:lab"
  docker build -q --build-arg "FIXTURE_HEALTH=$status" --label "fixture.variant=$image" -t "$ref" "$lab/build"
  docker push "$ref" >/dev/null
  docker image inspect --format '{{index .RepoDigests 0}} {{.Id}}' "$ref" > "$lab/artifact-$image"
done
CONTROL_IMAGE=$(awk '{print $2}' "$lab/artifact-base")
read -r base_ref _ < "$lab/artifact-base"
read -r good_ref _ < "$lab/artifact-good"
read -r bad_ref _ < "$lab/artifact-bad"
export CONTROL_IMAGE
cat > "$infra/compose.yml" <<'EOF'
services:
  backend:
    container_name: v1-fixture-backend
    ports: ["127.0.0.1:18080:3000"]
  postgres:
    container_name: v1-fixture-postgres
    image: postgres:17
    environment:
      POSTGRES_DB: maintenance_e2e
      POSTGRES_HOST_AUTH_METHOD: trust
    ports: ["127.0.0.1:15432:5432"]
    tmpfs: ["/var/lib/postgresql/data"]
    healthcheck:
      test: ["CMD", "pg_isready", "-U", "postgres", "-d", "maintenance_e2e"]
      interval: 2s
      timeout: 2s
      retries: 20
EOF
printf 'services:\n  backend:\n    image: %s\n    pull_policy: never\n' "$base_ref" > "$infra/backend-release.yml"
touch "$infra/backend-release.lock"
"${compose[@]}" up -d --wait
product_sql() { docker exec -i v1-fixture-postgres psql -XqAt -v ON_ERROR_STOP=1 -U postgres -d maintenance_e2e "$@"; }
product_sql < ops/maintenance/lab/e2e.sql
test "$(product_sql -c "SELECT current_setting('server_version_num')::int / 10000")" = 17
echo "PASS PostgreSQL 17 synthetic database"

sudo install -m 0755 "$(command -v node)" /usr/local/bin/node
sudo install -d -m 0755 /run/sshd /etc/optimus-maintenance /etc/optimus-maintenance/audit \
  /opt/optimus-maintenance/ops/maintenance /opt/optimus-maintenance/node_modules
sudo install -d -m 0700 /etc/optimus-maintenance/releases /var/lib/optimus-maintenance
sudo install -m 0644 ops/maintenance/{entry,broker,deploy*,docker-host,audit}.cjs /opt/optimus-maintenance/ops/maintenance/
mkdir "$lab/npm"
npm install --prefix "$lab/npm" --no-save --ignore-scripts --no-audit --no-fund pg@8.22.0 >/dev/null
sudo cp -R "$lab/npm/node_modules/." /opt/optimus-maintenance/node_modules/
sudo chown -R root:root /opt/optimus-maintenance
sudo chmod -R go-w /opt/optimus-maintenance
for user in fixtureaudit fixturerelease; do
  sudo useradd -m -s /bin/sh "$user"
  # Short-lived lab keypairs are generated and kept only within this hosted runner.
  ssh-keygen -q -t ed25519 -N '' -f "$lab/$user.key"
  sudo install -o root -g root -m 0644 "$lab/$user.key.pub" "$lab/$user.authorized"
done
ssh-keygen -q -t ed25519 -N '' -f "$lab/host.key"
printf '[127.0.0.1]:12291 %s\n' "$(cut -d' ' -f1,2 "$lab/host.key.pub")" > "$lab/known_hosts"
printf '%s\n' 'fixturerelease ALL=(root) NOPASSWD:NOSETENV: /usr/local/bin/node -- /opt/optimus-maintenance/ops/maintenance/broker.cjs' \
  | sudo tee /etc/sudoers.d/v1-fixture >/dev/null
sudo chmod 440 /etc/sudoers.d/v1-fixture
sudo visudo -cf /etc/sudoers.d/v1-fixture >/dev/null
cat > "$lab/sshd_config" <<EOF
Port 12291
ListenAddress 127.0.0.1
HostKey $lab/host.key
PidFile $lab/sshd.pid
AuthorizedKeysFile $lab/%u.authorized
AllowUsers fixtureaudit fixturerelease
AuthenticationMethods publickey
PasswordAuthentication no
KbdInteractiveAuthentication no
UsePAM yes
PermitUserEnvironment no
PermitTTY no
DisableForwarding yes
Match User fixtureaudit
  ForceCommand /usr/local/bin/node -- /opt/optimus-maintenance/ops/maintenance/entry.cjs audit
Match User fixturerelease
  ForceCommand /usr/local/bin/node -- /opt/optimus-maintenance/ops/maintenance/entry.cjs deploy
EOF
sudo /usr/sbin/sshd -t -f "$lab/sshd_config"
sudo /usr/sbin/sshd -f "$lab/sshd_config" -E "$lab/sshd.log"
node ops/maintenance/lab/release-fixture.cjs "$lab" "$candidate"
sudo install -m 0644 "$lab/approval.pub.pem" /etc/optimus-maintenance/release-approval.pub.pem
sudo install -m 0600 "$lab/deploy.json" /etc/optimus-maintenance/deploy.json
sudo install -m 0600 "$lab/fence-url" /etc/optimus-maintenance/fence-url
sudo install -m 0600 "$lab"/release-*.json /etc/optimus-maintenance/releases/
sudo install -o root -g fixtureaudit -m 0640 "$lab/audit.json" /etc/optimus-maintenance/audit/fixtureaudit.json

ssh_opts=(-o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes
  -o UserKnownHostsFile="$lab/known_hosts" -p 12291 -T)
audit_ssh() { ssh "${ssh_opts[@]}" -i "$lab/fixtureaudit.key" fixtureaudit@127.0.0.1 "$@"; }
deploy_ssh() { ssh "${ssh_opts[@]}" -i "$lab/fixturerelease.key" fixturerelease@127.0.0.1 "$@"; }
denied() { if "$@" > "$lab/denied.log" 2>&1; then echo "Unexpected command success"; return 1; fi; }
denied audit_ssh "id"
denied deploy_ssh "docker ps"
denied audit_ssh "deploy release-good"
denied deploy_ssh "jobs alpha 60 20"
denied audit_ssh "jobs beta 60 20"
denied ssh "${ssh_opts[@]}" -i "$lab/fixtureaudit.key" fixturerelease@127.0.0.1 "status current"
denied ssh "${ssh_opts[@]}" -i "$lab/fixtureaudit.key" -W 127.0.0.1:18080 fixtureaudit@127.0.0.1
audit_ssh "jobs alpha 60 20" | jq -e '.rows | length == 1 and .[0].id == "1" and .[0].motivo_final == "other"'
audit_ssh "acks alpha 60 20" | jq -e '.rows | length == 1 and .[0].factual == 1'
echo "PASS OpenSSH forced commands, no shell or forwarding, separate keys, workspace isolation and sanitized evidence"

denied deploy_ssh "preflight release-no-golden"
denied deploy_ssh "preflight release-tampered"
denied deploy_ssh "deploy unknown-release"
deploy_ssh "preflight release-good" | jq -e '.ok and .phase == "preflight_ok"'
echo "PASS signed release gates and digest preflight"

ssh "${ssh_opts[@]}" -i "$lab/fixturerelease.key" fixturerelease@127.0.0.1 "deploy release-good" > "$lab/interrupted.log" 2>&1 &
ssh_pid=$!
for _ in $(seq 1 35); do
  [[ "$(product_sql -c 'SELECT state FROM engine_universal_claim_fence')" != DRAINING ]] || break
  sleep 1
done
test "$(product_sql -c 'SELECT state FROM engine_universal_claim_fence')" = DRAINING
denied deploy_ssh "deploy release-good"
grep -q 'maintenance_failed_or_locked' "$lab/denied.log"
kill "$ssh_pid"
wait "$ssh_pid" || true
# The server may continue until its bounded drain timeout. Keep the synthetic send open until then.
sudo flock -w 140 "$infra/backend-release.lock" /usr/bin/true
test "$(product_sql -c "SELECT state || ':' || generation FROM engine_universal_claim_fence")" = DRAINING:1
id=$(deploy_ssh "status current" | jq -er .id)
product_sql -c "UPDATE engine_universal_queue_destinations SET status='sent', confirmed_at=now(), provider_message_id='fixture-late-confirmed' WHERE id=3"
deploy_ssh "recover $id" | jq -e '.ok and .phase == "rolled_back" and .generation == 1'
test "$(product_sql -c "SELECT state || ':' || generation FROM engine_universal_claim_fence")" = OPEN:1
echo "PASS real SSH interruption, concurrent deploy denial, same-generation recovery"

deploy_ssh "deploy release-good" | jq -e '.ok and .phase == "open" and .generation == 2'
test "$(docker inspect -f '{{.Config.Image}}' v1-fixture-backend)" = "$good_ref"
grep -Fx "    image: $good_ref" "$infra/backend-release.yml"
echo "PASS backend-only Compose switch and OPEN"

denied deploy_ssh "deploy release-bad"
test "$(product_sql -c "SELECT state || ':' || generation FROM engine_universal_claim_fence")" = DRAINED:3
test "$(docker inspect -f '{{.Config.Image}}' v1-fixture-backend)" = "$bad_ref"
docker stop v1-fixture-backend >/dev/null
id=$(deploy_ssh "status current" | jq -er .id)
deploy_ssh "recover $id" | jq -e '.ok and .phase == "rolled_back" and .generation == 3'
test "$(docker inspect -f '{{.Config.Image}}' v1-fixture-backend)" = "$good_ref"
test "$(product_sql -c "SELECT state || ':' || generation FROM engine_universal_claim_fence")" = OPEN:3
test "$(product_sql -c 'SELECT status || chr(58) || coalesce(provider_message_id, chr(45)) FROM engine_universal_queue_destinations WHERE id IN (1,2,3) ORDER BY id')" = $'sent:fixture-confirmed\nambiguous:-\nsent:fixture-late-confirmed'
audit_ssh "acks alpha 60 20" | jq -e '.rows[0].factual == 2'
echo "PASS failed digest remains fenced, rollback from stopped backend, factual ACKs and ambiguity preserved"
