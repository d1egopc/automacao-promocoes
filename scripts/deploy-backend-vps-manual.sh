#!/usr/bin/env bash
# Runs only from an explicit workflow_dispatch on main. Never uses /opt/optimus/backend.
set -Eeuo pipefail
umask 077

[[ "$SOURCE_SHA" =~ ^[0-9a-f]{40}$ ]]
[[ "$BASE_SHA" =~ ^[0-9a-f]{40}$ ]]
[[ "$BASE_IMAGE" =~ ^sha256:[0-9a-f]{64}$ ]]
test "$GITHUB_EVENT_NAME" = workflow_dispatch
test "$GITHUB_REF" = refs/heads/main

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
    AGENTS.md|docs/*|tests/*|.github/*|scripts/deploy-backend-vps-manual.sh) return 0 ;;
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
for path in "${approved[@]}"; do
  validate_runtime_overlay_path "$path" "${changed_runtime_status[$path]}"
done

scratch="$(mktemp -d)"
staging="$(mktemp -p "$infra" .backend-release.XXXXXXXX.yml)"
had_release=0
switched=0
cleanup() { rm -rf -- "$scratch"; rm -f -- "$staging"; }
rollback() {
  rc=$?
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
trap cleanup EXIT
trap rollback ERR

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
  echo 'Compose backend image does not resolve to the running rollback image'
  exit 1
fi

# Build in a clean Actions checkout, using the verified running image as base.
# Never git pull, build or edit the detached, dirty production checkout.
base_tag="local/optimus-deploy-base:$run_key"
recovery_tag="local/optimus-backend-recovery:$run_key"
candidate_tag="local/optimus-backend:$SOURCE_SHA-$run_key"
docker tag "$BASE_IMAGE" "$base_tag"
docker tag "$BASE_IMAGE" "$recovery_tag"
test "$(docker image inspect -f '{{.Id}}' "$recovery_tag")" = "$BASE_IMAGE"
{
  printf 'FROM %s\nUSER root\n' "$base_tag"
  for path in "${approved[@]}"; do
    printf 'COPY --chown=node:node %s /app/%s\n' "$path" "$path"
  done
  printf 'USER node\n'
} > "$scratch/Dockerfile"
docker build --pull=false --network=none -f "$scratch/Dockerfile" -t "$candidate_tag" "$source_dir"
candidate_id="$(docker image inspect -f '{{.Id}}' "$candidate_tag")"
[[ "$candidate_id" =~ ^sha256:[0-9a-f]{64}$ ]]
docker run --rm --network none --entrypoint node "$candidate_tag" --check /app/index.js

# A persistent Compose overlay changes only backend.image. The base Compose,
# env_file, secrets, mounts, ports, networks and PostgreSQL are untouched.
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

switched=1
mv -f -- "$staging" "$release"
docker compose -f "$compose" -f "$release" up -d --no-deps --no-build --force-recreate backend
test "$(docker inspect -f '{{.Image}}' optimus-backend)" = "$candidate_id"
test "$(env_fingerprint optimus-backend)" = "$baseline_env"
test "$(mount_fingerprint optimus-backend)" = "$baseline_mounts"
docker inspect -f '{{json .HostConfig.Ulimits}}' optimus-backend | python3 -c 'import json,sys; u=json.load(sys.stdin); core=[x for x in u if x.get("Name")=="core"]; assert len(core)==1 and core[0]["Soft"]==0 and core[0]["Hard"]==0'
test "$(docker compose -f "$compose" -f "$release" ps -q postgres)" = "$postgres_id"
test "$(docker inspect -f '{{.State.Health.Status}}' "$postgres_id")" = healthy
for attempt in {1..12}; do
  if test "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:3000/)" = 200 &&
     curl -fsS -o /dev/null --max-time 5 https://go.optimuspromo.com.br/; then
    break
  fi
  test "$attempt" -lt 12
  sleep 3
done
echo "Published source=$SOURCE_SHA image=$candidate_id rollback=$BASE_IMAGE"
