"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const deployScript = fs.readFileSync(path.join(root, "scripts/deploy-backend-vps-manual.sh"), "utf8").replace(/\r\n/g, "\n");
const helperStart = deployScript.indexOf("# BEGIN runtime overlay validation helpers");
const helperEnd = deployScript.indexOf("# END runtime overlay validation helpers", helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, "extractar os helpers reais do deploy manual");
const helpers = deployScript.slice(helperStart, helperEnd);
const runtimePath = "modules/mensageiro/gerente-observability-v2.js";
const bash = process.platform === "win32" ? "C:\\Program Files\\Git\\bin\\bash.exe" : "bash";

function runCase({
  mode = "overlay",
  changeType = "A",
  pathValue = runtimePath,
  basePresent = false,
  imageState = "absent",
  baseContent = "base-content",
  imageContent = baseContent,
  sourceContent = "candidate-content",
  checkoutContent = sourceContent,
  approvedPath = runtimePath
} = {}) {
  const tempParent = path.join(root, "tmp", "test-tmp");
  fs.mkdirSync(tempParent, { recursive: true });
  const fixture = fs.mkdtempSync(path.join(tempParent, "deploy-overlay-"));
  const candidateFile = path.join(fixture, ...runtimePath.split("/"));
  fs.mkdirSync(path.dirname(candidateFile), { recursive: true });
  fs.writeFileSync(candidateFile, checkoutContent);

  const harness = String.raw`
set -Eeuo pipefail
source_dir="$FIXTURE_DIR"
BASE_SHA=base-sha
SOURCE_SHA=source-sha
MOCK_PATH="$FIXTURE_PATH"
MOCK_BASE_PRESENT="$FIXTURE_BASE_PRESENT"
MOCK_BASE_CONTENT="$FIXTURE_BASE_CONTENT"
MOCK_IMAGE_STATE="$FIXTURE_IMAGE_STATE"
MOCK_IMAGE_CONTENT="$FIXTURE_IMAGE_CONTENT"
MOCK_SOURCE_CONTENT="$FIXTURE_SOURCE_CONTENT"
declare -A approved_set=()
declare -A changed_runtime=()
declare -A changed_runtime_status=()
approved_set["$FIXTURE_APPROVED_PATH"]=1
git() {
  if [[ "$1" == "-C" ]]; then shift 2; fi
  case "$1" in
    ls-tree)
      if [[ "$MOCK_BASE_PRESENT" == "yes" ]]; then printf '%s\n' "$MOCK_PATH"; fi
      return 0
      ;;
    show)
      case "$2" in
        "$BASE_SHA:$MOCK_PATH")
          [[ "$MOCK_BASE_PRESENT" == "yes" ]] || return 128
          printf '%s' "$MOCK_BASE_CONTENT"
          ;;
        "$SOURCE_SHA:$MOCK_PATH") printf '%s' "$MOCK_SOURCE_CONTENT" ;;
        *) return 128 ;;
      esac
      ;;
    *) return 98 ;;
  esac
}
docker() {
  [[ "$1" == exec && "$2" == optimus-backend ]] || return 97
  case "$3" in
    sh) printf '%s' "$MOCK_IMAGE_STATE" ;;
    sha256sum)
      [[ "$MOCK_IMAGE_STATE" == file ]] || return 96
      printf '%s  %s\n' "$(printf '%s' "$MOCK_IMAGE_CONTENT" | command sha256sum | cut -d' ' -f1)" "$4"
      ;;
    *) return 95 ;;
  esac
}
${helpers}
case "$MODE" in
  overlay)
    validate_runtime_path "$FIXTURE_PATH"
    validate_runtime_overlay_path "$FIXTURE_PATH" "$FIXTURE_CHANGE_TYPE"
    ;;
  record)
    record_runtime_change "$FIXTURE_CHANGE_TYPE" "$FIXTURE_PATH"
    ;;
  invalid-path)
    if validate_runtime_path "$FIXTURE_PATH"; then exit 44; else exit 0; fi
    ;;
  *) exit 45 ;;
esac
`;

  try {
    return spawnSync(bash, ["-c", harness], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        MODE: mode,
        FIXTURE_DIR: fixture,
        FIXTURE_PATH: pathValue,
        FIXTURE_CHANGE_TYPE: changeType,
        FIXTURE_BASE_PRESENT: basePresent ? "yes" : "no",
        FIXTURE_IMAGE_STATE: imageState,
        FIXTURE_BASE_CONTENT: baseContent,
        FIXTURE_IMAGE_CONTENT: imageContent,
        FIXTURE_SOURCE_CONTENT: sourceContent,
        FIXTURE_APPROVED_PATH: approvedPath
      }
    });
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
}

test("arquivo novo autorizado, ausente da base e da imagem, passa após validar o hash do candidato", () => {
  const result = runCase({ changeType: "A", basePresent: false, imageState: "absent" });
  assert.equal(result.status, 0, result.stderr);
});

test("tipo A declarado é rejeitado quando o caminho já existe na base", () => {
  const result = runCase({ changeType: "A", basePresent: true, imageState: "file" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /already exists in base/);
});

test("tipo A declarado é rejeitado quando o caminho já existe na imagem ativa", () => {
  const result = runCase({ changeType: "A", basePresent: false, imageState: "file" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /already exists in active image/);
});

test("arquivo modificado é aceito somente quando a imagem contém o hash exato da base", () => {
  const result = runCase({
    changeType: "M",
    basePresent: true,
    imageState: "file",
    baseContent: "same-base-bytes",
    imageContent: "same-base-bytes"
  });
  assert.equal(result.status, 0, result.stderr);
});

test("arquivo existente com hash incorreto na imagem é rejeitado", () => {
  const result = runCase({
    changeType: "M",
    basePresent: true,
    imageState: "file",
    baseContent: "expected-base-bytes",
    imageContent: "wrong-image-bytes"
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Base image content\/hash mismatch/);
});

test("conteúdo do candidato diverge do blob do SOURCE_SHA e é rejeitado", () => {
  const result = runCase({
    changeType: "A",
    basePresent: false,
    imageState: "absent",
    sourceContent: "committed-content",
    checkoutContent: "tampered-checkout-content"
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Candidate content\/hash mismatch/);
});

test("runtime novo fora da allowlist é rejeitado", () => {
  const result = runCase({
    mode: "record",
    changeType: "A",
    pathValue: "modules/other/new.js",
    approvedPath: runtimePath
  });
  assert.notEqual(result.status, 0);
});

test("caminhos absolutos e com travessia são rejeitados", () => {
  for (const pathValue of ["/etc/passwd", "../escape.js", "modules/../../secret.js", "modules\\escape.js"]) {
    const result = runCase({ mode: "invalid-path", pathValue });
    assert.equal(result.status, 0, `${pathValue}: ${result.stderr}`);
  }
});

test("deletions e tipos runtime inesperados seguem bloqueados", () => {
  for (const changeType of ["D", "T", "R100"]) {
    const result = runCase({ mode: "record", changeType, pathValue: runtimePath, approvedPath: runtimePath });
    assert.notEqual(result.status, 0, changeType);
  }
  assert.match(deployScript, /diff --name-only --diff-filter=D --no-renames/);
});

test("runtime alterado não autorizado continua bloqueado", () => {
  const result = runCase({ mode: "record", changeType: "M", pathValue: "modules/engine/unapproved.js" });
  assert.notEqual(result.status, 0);
});

test("ancestralidade, imagem ativa, Compose, mounts, ambiente e rollback continuam protegidos", () => {
  for (const guard of [
    'merge-base --is-ancestor "$BASE_SHA" "$SOURCE_SHA"',
    'merge-base --is-ancestor "$SOURCE_SHA" "$GITHUB_SHA"',
    'test "$active_id" = "$BASE_IMAGE"',
    "Effective Compose changed beyond backend image",
    "baseline_mounts",
    "baseline_env",
    "local/optimus-backend-recovery:"
  ]) assert.ok(deployScript.includes(guard), guard);
});
