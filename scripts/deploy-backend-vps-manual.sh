#!/usr/bin/env bash
# Runs only from an explicit workflow_dispatch on main. Never uses /opt/optimus/backend.
set -Eeuo pipefail
deploy_stage=initialize
switched=0
had_release=0
# BEGIN deploy failure diagnostics
report_deploy_failure() {
  local rc=$?
  local line="${BASH_LINENO[0]:-unknown}"
  local stage="${deploy_stage:-unknown}"
  trap - ERR
  printf 'deploy_failure stage=%s line=%s exit_code=%s result=command_failed\n' "$stage" "$line" "$rc" >&2
  if [[ "${switched:-0}" == 1 ]]; then
    rollback "$rc"
  fi
  exit "$rc"
}
trap report_deploy_failure ERR
# END deploy failure diagnostics
umask 077

deploy_stage=validate_inputs
[[ "$SOURCE_SHA" =~ ^[0-9a-f]{40}$ ]]
[[ "$BASE_SHA" =~ ^[0-9a-f]{40}$ ]]
[[ "$BASE_IMAGE" =~ ^sha256:[0-9a-f]{64}$ ]]
test "$GITHUB_EVENT_NAME" = workflow_dispatch
test "$GITHUB_REF" = refs/heads/main

deploy_stage=validate_source_checkout
source_dir="$GITHUB_WORKSPACE/release-source"
infra=/opt/optimus/infra
compose="$infra/compose.yml"
release="$infra/backend-release.yml"
run_key="$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
backup="$infra/backend-release.rollback-$run_key.yml"
test -f "$compose"
exec 9>"$infra/backend-release.lock"
flock -n 9
test "$(git -C "$source_dir" rev-parse HEAD)" = "$SOURCE_SHA"
test -z "$(git -C "$source_dir" status --porcelain)"
git -C "$source_dir" merge-base --is-ancestor "$BASE_SHA" "$SOURCE_SHA"
git -C "$source_dir" merge-base --is-ancestor "$SOURCE_SHA" "$GITHUB_SHA"
git -C "$source_dir" diff --check "$BASE_SHA" "$SOURCE_SHA"

# Every runtime delta must be named in the manual authorization. Documentation
# and tests are excluded from the image, and deleted runtime files fail closed.
deploy_stage=validate_runtime_allowlist
guardian_runtime="$(node "$GITHUB_WORKSPACE/scripts/guardian-v1.cjs" prepare --repo "$source_dir" --base "$BASE_SHA" --source "$SOURCE_SHA" --format value)"
guardian_mode="$(node "$GITHUB_WORKSPACE/scripts/guardian-v1.cjs" prepare --repo "$source_dir" --base "$BASE_SHA" --source "$SOURCE_SHA" --format mode)"
[[ "$guardian_mode" == overlay || "$guardian_mode" == baileys_buffer_patch ]]
test -n "$guardian_runtime"
test "$RUNTIME_FILES" = "$guardian_runtime"
IFS=, read -r -a approved <<< "$RUNTIME_FILES"
test "${#approved[@]}" -gt 0
declare -A approved_set=()
# BEGIN runtime overlay validation helpers
validate_runtime_path() {
  local path="${1:-}"
  [[ "$path" =~ ^[A-Za-z0-9._/-]+$ ]] || return 1
  [[ "$path" != /* && "$path" != *..* && "$path" != .* ]] || return 1
  test -f "$source_dir/$path"
  test ! -L "$source_dir/$path"
}
for path in "${approved[@]}"; do
  validate_runtime_path "$path"
  test -z "${approved_set[$path]+present}"
  approved_set["$path"]=1
done
test -z "$(git -C "$source_dir" diff --name-only --diff-filter=D --no-renames "$BASE_SHA" "$SOURCE_SHA")"
declare -A changed_runtime=()
declare -A changed_runtime_status=()
record_runtime_change() {
  local status="$1" path="$2"
  case "$path" in
    AGENTS.md|docs/*|tests/*|.github/*|scripts/deploy-backend-vps-manual.sh|scripts/guardian-v1.cjs|scripts/benchmark-gerente-observability-v2.cjs) return 0 ;;
    optimus-capture/adapters/magalu.js|optimus-capture/local-worker/magalu-identity.js) return 0 ;;
  esac
  case "$status" in
    A|M) ;;
    *) echo "Unsupported runtime change type: $status $path" >&2; return 1 ;;
  esac
  test -n "${approved_set[$path]+present}"
  changed_runtime["$path"]=1
  changed_runtime_status["$path"]="$status"
}
while IFS=$'\t' read -r status path; do
  record_runtime_change "$status" "$path"
done < <(git -C "$source_dir" diff --name-status --no-renames "$BASE_SHA" "$SOURCE_SHA")
test "${#changed_runtime[@]}" -eq "${#approved_set[@]}"
for path in "${approved[@]}"; do test -n "${changed_runtime[$path]+present}"; done

validate_runtime_overlay_path() {
  local path="$1" change_type="$2" base_entry="" image_state=""
  local source_hash="" checkout_hash="" base_hash="" image_hash=""
  [[ "$change_type" == A || "$change_type" == M ]] || return 1
  base_entry="$(git -C "$source_dir" ls-tree -r --name-only "$BASE_SHA" -- "$path")"
  source_hash="$(git -C "$source_dir" show "$SOURCE_SHA:$path" | sha256sum | cut -d' ' -f1)"
  checkout_hash="$(sha256sum "$source_dir/$path" | cut -d' ' -f1)"
  [[ "$source_hash" =~ ^[0-9a-f]{64}$ && "$checkout_hash" == "$source_hash" ]] || {
    echo "Candidate content/hash mismatch: $path" >&2
    return 1
  }
  image_state="$(docker exec optimus-backend sh -c 'if [ -L "$1" ]; then printf symlink; elif [ -f "$1" ]; then printf file; elif [ -e "$1" ]; then printf other; else printf absent; fi' sh "/app/$path")"
  case "$change_type" in
    A)
      test -z "$base_entry" || { echo "New runtime path already exists in base: $path" >&2; return 1; }
      test "$image_state" = absent || { echo "New runtime path already exists in active image: $path" >&2; return 1; }
      ;;
    M)
      test "$base_entry" = "$path" || { echo "Modified runtime path missing from base: $path" >&2; return 1; }
      test "$image_state" = file || { echo "Modified runtime path missing or not a regular file in active image: $path" >&2; return 1; }
      base_hash="$(git -C "$source_dir" show "$BASE_SHA:$path" | sha256sum | cut -d' ' -f1)"
      image_hash="$(docker exec optimus-backend sha256sum "/app/$path" | cut -d' ' -f1)"
      [[ "$base_hash" =~ ^[0-9a-f]{64}$ && "$image_hash" == "$base_hash" ]] || {
        echo "Base image content/hash mismatch: $path" >&2
        return 1
      }
      ;;
  esac
}
# END runtime overlay validation helpers

# Prove that the advertised rollback image is the actual running image.
deploy_stage=validate_production_baseline
active_id="$(docker inspect -f '{{.Image}}' optimus-backend)"
test "$active_id" = "$BASE_IMAGE"
test "$(docker image inspect -f '{{.Id}}' "$BASE_IMAGE")" = "$BASE_IMAGE"
postgres_id="$(docker compose -f "$compose" ps -q postgres)"
test -n "$postgres_id"
test "$(docker inspect -f '{{.State.Health.Status}}' "$postgres_id")" = healthy
test "$(docker inspect -f '{{.State.Status}}' optimus-backend)" = running
test "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:3000/)" = 200
docker inspect -f '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Type}}{{end}}{{end}}' optimus-backend | grep -Fx bind
env_fingerprint() {
  docker inspect -f '{{json .Config.Env}}' "$1" | python3 -c 'import json,sys; items=json.load(sys.stdin); d={};
for item in items:
 key,sep,value=item.partition("=")
 if not sep or key in d: raise SystemExit("invalid or duplicate environment key")
 d[key]=value
print(json.dumps(d,sort_keys=True,separators=(",",":")))' | sha256sum | cut -d' ' -f1
}
mount_fingerprint() {
  docker inspect -f '{{json .Mounts}}' "$1" | python3 -c 'import json,sys; m=json.load(sys.stdin); print(json.dumps(sorted((x["Type"],x["Source"],x["Destination"],x["RW"]) for x in m)))' | sha256sum | cut -d' ' -f1
}
baseline_env="$(env_fingerprint optimus-backend)"
baseline_mounts="$(mount_fingerprint optimus-backend)"
docker inspect -f '{{json .HostConfig.Ulimits}}' optimus-backend | python3 -c 'import json,sys; u=json.load(sys.stdin); core=[x for x in u if x.get("Name")=="core"]; assert len(core)==1 and core[0]["Soft"]==0 and core[0]["Hard"]==0'

# Existing paths must match the published base byte-for-byte. New paths are
# accepted only when absent from both that base tree and the active image.
# Every candidate path must match the authorized source commit.
deploy_stage=validate_runtime_hashes
for path in "${approved[@]}"; do
  validate_runtime_overlay_path "$path" "${changed_runtime_status[$path]}"
done

# The exceptional dependency build is authorized by exact Guardian hashes.
# Only inspect these three fixed library files; never read auth/env or /data.
if [[ "$guardian_mode" == baileys_buffer_patch ]]; then
  deploy_stage=validate_baileys_dependency_base
  test "$(docker exec optimus-backend node -p "require('/app/node_modules/@whiskeysockets/baileys/package.json').version")" = 6.7.22
  dependency_count=0
  while IFS=$'\t' read -r dependency expected_hash; do
    [[ "$dependency" == lib/Socket/socket.js || "$dependency" == lib/Socket/chats.js || "$dependency" == lib/Socket/messages-recv.js ]]
    [[ "$expected_hash" =~ ^[0-9a-f]{64}$ ]]
    test "$(docker exec optimus-backend sh -c 'if [ -L "$1" ]; then printf symlink; elif [ -f "$1" ]; then printf file; else printf absent; fi' sh "/app/node_modules/@whiskeysockets/baileys/$dependency")" = file
    test "$(docker exec optimus-backend sha256sum "/app/node_modules/@whiskeysockets/baileys/$dependency" | cut -d' ' -f1)" = "$expected_hash"
    dependency_count=$((dependency_count + 1))
  done < <(node "$GITHUB_WORKSPACE/scripts/guardian-v1.cjs" prepare --repo "$source_dir" --base "$BASE_SHA" --source "$SOURCE_SHA" --format dependencies-before)
  test "$dependency_count" -eq 3
fi

deploy_stage=prepare_release_artifacts
scratch="$(mktemp -d)"
staging="$(mktemp -p "$infra" .backend-release.XXXXXXXX.yml)"
had_release=0
switched=0
cleanup() { rm -rf -- "$scratch"; rm -f -- "$staging"; }
# BEGIN deploy rollback handler
rollback() {
  local rc="${1:-$?}"
  trap - ERR
  if test "$switched" = 1; then
    if test "$had_release" = 1; then cp -p -- "$backup" "$release"; else rm -f -- "$release"; fi
    files=(-f "$compose")
    if test -f "$release"; then files+=(-f "$release"); fi
    docker compose "${files[@]}" up -d --no-deps --no-build --force-recreate backend || true
    if test "$(docker inspect -f '{{.Image}}' optimus-backend)" != "$BASE_IMAGE"; then
      echo 'CRITICAL: rollback image mismatch'
    fi
  fi
  exit "$rc"
}
# END deploy rollback handler
trap cleanup EXIT

deploy_stage=validate_compose_baseline
files=(-f "$compose")
if test -f "$release"; then files+=(-f "$release"); fi
release_fingerprint=absent
if test -f "$release"; then release_fingerprint="$(sha256sum "$release" | cut -d' ' -f1)"; fi
docker compose "${files[@]}" config --format json > "$scratch/before.json"
python3 - "$scratch/before.json" <<'PY'
import json, sys
config = json.load(open(sys.argv[1]))
image = config['services']['backend']['image']
if not isinstance(image, str) or not image.strip():
    raise SystemExit('Compose backend image is missing')
if 'build' in config['services']['backend']:
    raise SystemExit('Unexpected build context in production Compose')
PY
compose_image="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["services"]["backend"]["image"])' "$scratch/before.json")"
assert_compose_image_matches_base() {
  local compose_image="${1:-}"
  [[ -n "$compose_image" ]] || return 1
  local resolved_image_id
  resolved_image_id="$(docker image inspect -f '{{.Id}}' "$compose_image")" || return 1
  [[ "$resolved_image_id" == "$BASE_IMAGE" ]]
}
if ! assert_compose_image_matches_base "$compose_image"; then
  printf 'deploy_failure stage=%s line=%s exit_code=1 result=compose_image_mismatch\n' "$deploy_stage" "$LINENO" >&2
  echo 'Compose backend image does not resolve to the running rollback image'
  exit 1
fi

# Build in a clean Actions checkout, using the verified running image as base.
# Never git pull, build or edit the detached, dirty production checkout.
deploy_stage=build_candidate_image
base_tag="local/optimus-deploy-base:$run_key"
recovery_tag="local/optimus-backend-recovery:$run_key"
candidate_tag="local/optimus-backend:$SOURCE_SHA-$run_key"
docker tag "$BASE_IMAGE" "$base_tag"
docker tag "$BASE_IMAGE" "$recovery_tag"
test "$(docker image inspect -f '{{.Id}}' "$recovery_tag")" = "$BASE_IMAGE"
node "$GITHUB_WORKSPACE/scripts/guardian-v1.cjs" build-dockerfile --repo "$source_dir" --base "$BASE_SHA" --source "$SOURCE_SHA" --base-tag "$base_tag" > "$scratch/Dockerfile"
docker build --pull=false --network=none -f "$scratch/Dockerfile" -t "$candidate_tag" "$source_dir"
candidate_id="$(docker image inspect -f '{{.Id}}' "$candidate_tag")"
[[ "$candidate_id" =~ ^sha256:[0-9a-f]{64}$ ]]
docker run --rm --network none --entrypoint node "$candidate_tag" --check /app/index.js
if [[ "$guardian_mode" == baileys_buffer_patch ]]; then
  deploy_stage=verify_baileys_dependency_image
  dependency_count=0
  while IFS=$'\t' read -r dependency expected_hash; do
    [[ "$dependency" == lib/Socket/socket.js || "$dependency" == lib/Socket/chats.js || "$dependency" == lib/Socket/messages-recv.js ]]
    [[ "$expected_hash" =~ ^[0-9a-f]{64}$ ]]
    test "$(docker run --rm --network none --entrypoint sha256sum "$candidate_tag" "/app/node_modules/@whiskeysockets/baileys/$dependency" | cut -d' ' -f1)" = "$expected_hash"
    dependency_count=$((dependency_count + 1))
  done < <(node "$GITHUB_WORKSPACE/scripts/guardian-v1.cjs" prepare --repo "$source_dir" --base "$BASE_SHA" --source "$SOURCE_SHA" --format dependencies-after)
  test "$dependency_count" -eq 3
fi

# A persistent Compose overlay changes only backend.image. The base Compose,
# env_file, secrets, mounts, ports, networks and PostgreSQL are untouched.
deploy_stage=validate_compose_overlay
printf 'services:\n  backend:\n    image: %s\n' "$candidate_tag" > "$staging"
docker compose -f "$compose" -f "$staging" config --format json > "$scratch/after.json"
python3 - "$scratch/before.json" "$scratch/after.json" <<'PY'
import json, sys
before, after = (json.load(open(path)) for path in sys.argv[1:])
after['services']['backend']['image'] = before['services']['backend']['image']
if before != after:
    raise SystemExit('Effective Compose changed beyond backend image')
PY
test "$(docker image inspect -f '{{.Id}}' "$candidate_tag")" = "$candidate_id"
if test "$release_fingerprint" = absent; then
  test ! -e "$release"
else
  test "$(sha256sum "$release" | cut -d' ' -f1)" = "$release_fingerprint"
fi
if test -f "$release"; then
  test ! -e "$backup"
  cp -p -- "$release" "$backup"
  had_release=1
fi

deploy_stage=switch_backend
switched=1
mv -f -- "$staging" "$release"
docker compose -f "$compose" -f "$release" up -d --no-deps --no-build --force-recreate backend
deploy_stage=verify_backend
test "$(docker inspect -f '{{.Image}}' optimus-backend)" = "$candidate_id"
test "$(env_fingerprint optimus-backend)" = "$baseline_env"
test "$(mount_fingerprint optimus-backend)" = "$baseline_mounts"
docker inspect -f '{{json .HostConfig.Ulimits}}' optimus-backend | python3 -c 'import json,sys; u=json.load(sys.stdin); core=[x for x in u if x.get("Name")=="core"]; assert len(core)==1 and core[0]["Soft"]==0 and core[0]["Hard"]==0'
test "$(docker compose -f "$compose" -f "$release" ps -q postgres)" = "$postgres_id"
test "$(docker inspect -f '{{.State.Health.Status}}' "$postgres_id")" = healthy
deploy_stage=post_deploy_readiness
for attempt in {1..12}; do
  if test "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:3000/)" = 200 &&
     curl -fsS -o /dev/null --max-time 5 https://go.optimuspromo.com.br/; then
    break
  fi
  test "$attempt" -lt 12
  sleep 3
done
deploy_stage=post_deploy_operational_observation
started_at="$(docker inspect -f '{{.State.StartedAt}}' optimus-backend)"
docker logs --since "$started_at" optimus-backend > "$scratch/post-deploy.log" 2>&1
count_log() { grep -Ec "$1" "$scratch/post-deploy.log" || true; }
session_connected="$(count_log '\[WHATSAPP\] WHATSAPP CONECTADO')"
session_qr="$(count_log 'QR RECEBIDO|needs.?qr|precisa.?qr')"
rio_activity="$(count_log '\[EXECUTOR')"
pool_errors="$(count_log 'Cannot use a pool after calling end on the pool')"
programadas_errors="$(count_log 'MENSAGEIRO-V3-SCHEDULER-ERRO|MENSAGEIRO-PROGRAMACAO-SCHEDULER-ERRO')"
teleradar_errors="$(count_log 'TELERADAR[^]]*ERRO|TELERADAR[^]]*ERROR')"
test "$session_qr" -eq 0
test "$pool_errors" -eq 0
test "$programadas_errors" -eq 0
test "$teleradar_errors" -eq 0
sessions_status=BLOCKED_NO_ACTIVITY
rio_status=BLOCKED_NO_ACTIVITY
test "$session_connected" -eq 0 || sessions_status=PASS
test "$rio_activity" -eq 0 || rio_status=PASS
printf 'guardian_health backend=PASS postgres=PASS http=PASS sessions=%s rio=%s programadas=PASS_NO_ERRORS persistence=PASS mounts=PASS\n' "$sessions_status" "$rio_status"
echo "Published source=$SOURCE_SHA image=$candidate_id rollback=$BASE_IMAGE"
