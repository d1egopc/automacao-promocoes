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

function sanitizeDiagnostic(value) {
  return String(value || "")
    .replace(/\bauthorization\s*:\s*bearer\s+\S+/gi, "Authorization: <redacted>")
    .replace(/\b(token|password|secret|cookie)\b\s*[:=]\s*\S+/gi, "$1=<redacted>")
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, "<token>")
    .replace(/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, "<token>")
    .replace(/[A-Za-z]:\\[^:\r\n]*/g, "<local-path>")
    .replace(/\/(?:home|tmp|Users|opt|workspace|runner|mnt|var)\/[^\s:\r\n]*/g, "<path>")
    .split(/\r?\n/)
    .slice(-30)
    .join("\n")
    .slice(-4000);
}

function processDiagnostic(scenario, result) {
  return [
    `scenario=${scenario}`,
    `expected=${result.expected || "scenario assertion"}`,
    `actual_exit_code=${result.status === null ? "null" : result.status}`,
    `signal=${result.signal || "none"}`,
    result.error ? `spawn_error=${sanitizeDiagnostic(result.error.message)}` : "",
    `stdout:\n${sanitizeDiagnostic(result.stdout) || "<empty>"}`,
    `stderr:\n${sanitizeDiagnostic(result.stderr) || "<empty>"}`
  ].filter(Boolean).join("\n");
}

function runCase({
  scenario = "unnamed-scenario",
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
STEP=fixture_setup
trap 'rc=$?; printf "harness_exit scenario=%s stage=%s code=%s\n" "$SCENARIO" "$STEP" "$rc" >&2' EXIT
trap 'rc=$?; printf "harness_error scenario=%s stage=%s line=%s code=%s\n" "$SCENARIO" "$STEP" "$LINENO" "$rc" >&2; exit "$rc"' ERR
source_dir="$FIXTURE_DIR"
BASE_SHA=base-sha
SOURCE_SHA=source-sha
MOCK_PATH="$FIXTURE_PATH"
MOCK_BASE_PRESENT="$FIXTURE_BASE_PRESENT"
MOCK_BASE_CONTENT="$FIXTURE_BASE_CONTENT"
MOCK_IMAGE_STATE="$FIXTURE_IMAGE_STATE"
MOCK_IMAGE_CONTENT="$FIXTURE_IMAGE_CONTENT"
MOCK_SOURCE_CONTENT="$FIXTURE_SOURCE_CONTENT"
approved=("$FIXTURE_APPROVED_PATH")
declare -A approved_set=()
declare -A changed_runtime=()
declare -A changed_runtime_status=()
STEP=fixture_helper_bootstrap
git() {
  if [[ "$1" == "-C" ]]; then shift 2; fi
  case "$1" in
    diff)
      case "$2" in
        --name-only)
          printf 'mock_git=diff-deletions\n' >&2
          if [[ "$FIXTURE_CHANGE_TYPE" == D ]]; then printf '%s\n' "$FIXTURE_PATH"; fi
          return 0 ;;
        --name-status)
          printf 'mock_git=diff-runtime-status\n' >&2
          printf '%s\t%s\n' "$FIXTURE_CHANGE_TYPE" "$FIXTURE_APPROVED_PATH"
          return 0
          ;;
        *) return 98 ;;
      esac
      ;;
    ls-tree)
      printf 'mock_git=ls-tree\n' >&2
      if [[ "$MOCK_BASE_PRESENT" == "yes" ]]; then printf '%s\n' "$MOCK_PATH"; fi
      return 0
      ;;
    show)
      case "$2" in
        "$BASE_SHA:$MOCK_PATH")
          printf 'mock_git=show-base\n' >&2
          [[ "$MOCK_BASE_PRESENT" == "yes" ]] || return 128
          printf '%s' "$MOCK_BASE_CONTENT"
          ;;
        "$SOURCE_SHA:$MOCK_PATH") printf 'mock_git=show-source\n' >&2; printf '%s' "$MOCK_SOURCE_CONTENT" ;;
        *) return 128 ;;
      esac
      ;;
    *) return 98 ;;
  esac
}
sha256sum() {
  if [[ "$#" == 1 && -f "$1" ]]; then
    command sha256sum < "$1"
  else
    command sha256sum "$@"
  fi
}
docker() {
  [[ "$1" == exec && "$2" == optimus-backend ]] || return 97
  case "$3" in
    sh) printf 'mock_docker=inspect-path\n' >&2; printf '%s' "$MOCK_IMAGE_STATE" ;;
    sha256sum)
      printf 'mock_docker=hash-active\n' >&2
      [[ "$MOCK_IMAGE_STATE" == file ]] || return 96
      printf '%s  %s\n' "$(printf '%s' "$MOCK_IMAGE_CONTENT" | command sha256sum | cut -d' ' -f1)" "$4"
      ;;
    *) return 95 ;;
  esac
}
${helpers}
case "$MODE" in
  overlay)
    STEP=path_validation
    validate_runtime_path "$FIXTURE_PATH"
    STEP=overlay_base_validation
    validate_runtime_overlay_path "$FIXTURE_PATH" "$FIXTURE_CHANGE_TYPE"
    ;;
  record)
    STEP=runtime_allowlist_classification
    record_runtime_change "$FIXTURE_CHANGE_TYPE" "$FIXTURE_PATH"
    ;;
  record-required)
    STEP=runtime_allowlist_classification
    record_runtime_change "$FIXTURE_CHANGE_TYPE" "$FIXTURE_PATH"
    [[ -v 'changed_runtime[$FIXTURE_PATH]' ]]
    ;;
  deletions)
    STEP=global_deletion_guard
    test -z "$(git -C "$source_dir" diff --name-only --diff-filter=D --no-renames "$BASE_SHA" "$SOURCE_SHA")"
    ;;
  invalid-path)
    STEP=expected_path_rejection
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
        SCENARIO: scenario,
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
  const scenario = "new-file-authorized-absent-from-base-and-image";
  const result = runCase({ scenario, changeType: "A", basePresent: false, imageState: "absent" });
  result.expected = "exit code 0";
  assert.equal(result.status, 0, processDiagnostic(scenario, result));
});

test("tipo A declarado é rejeitado quando o caminho já existe na base", () => {
  const scenario = "declared-new-but-present-in-base";
  const result = runCase({ scenario, changeType: "A", basePresent: true, imageState: "file" });
  result.expected = "nonzero exit and base-exists diagnostic";
  assert.notEqual(result.status, 0, processDiagnostic(scenario, result));
  assert.match(sanitizeDiagnostic(result.stderr), /already exists in base/, processDiagnostic(scenario, result));
});

test("tipo A declarado é rejeitado quando o caminho já existe na imagem ativa", () => {
  const scenario = "declared-new-but-present-in-active-image";
  const result = runCase({ scenario, changeType: "A", basePresent: false, imageState: "file" });
  result.expected = "nonzero exit and active-image-exists diagnostic";
  assert.notEqual(result.status, 0, processDiagnostic(scenario, result));
  assert.match(sanitizeDiagnostic(result.stderr), /already exists in active image/, processDiagnostic(scenario, result));
});

test("arquivo modificado é aceito somente quando a imagem contém o hash exato da base", () => {
  const scenario = "modified-file-with-matching-base-image-hash";
  const result = runCase({
    scenario,
    changeType: "M",
    basePresent: true,
    imageState: "file",
    baseContent: "same-base-bytes",
    imageContent: "same-base-bytes"
  });
  result.expected = "exit code 0";
  assert.equal(result.status, 0, processDiagnostic(scenario, result));
});

test("arquivo existente com hash incorreto na imagem é rejeitado", () => {
  const scenario = "modified-file-with-wrong-active-image-hash";
  const result = runCase({
    scenario,
    changeType: "M",
    basePresent: true,
    imageState: "file",
    baseContent: "expected-base-bytes",
    imageContent: "wrong-image-bytes"
  });
  result.expected = "nonzero exit and base-image-hash diagnostic";
  assert.notEqual(result.status, 0, processDiagnostic(scenario, result));
  assert.match(sanitizeDiagnostic(result.stderr), /Base image content\/hash mismatch/, processDiagnostic(scenario, result));
});

test("conteúdo do candidato diverge do blob do SOURCE_SHA e é rejeitado", () => {
  const scenario = "candidate-checkout-content-diverges-from-source-commit";
  const result = runCase({
    scenario,
    changeType: "A",
    basePresent: false,
    imageState: "absent",
    sourceContent: "committed-content",
    checkoutContent: "tampered-checkout-content"
  });
  result.expected = "nonzero exit and candidate-hash diagnostic";
  assert.notEqual(result.status, 0, processDiagnostic(scenario, result));
  assert.match(sanitizeDiagnostic(result.stderr), /Candidate content\/hash mismatch/, processDiagnostic(scenario, result));
});

test("runtime novo fora da allowlist é rejeitado", () => {
  const scenario = "new-runtime-outside-allowlist";
  const result = runCase({
    scenario,
    mode: "record",
    changeType: "A",
    pathValue: "modules/other/new.js",
    approvedPath: runtimePath
  });
  result.expected = "nonzero exit";
  assert.notEqual(result.status, 0, processDiagnostic(scenario, result));
});

test("benchmark sintético específico é excluído da classificação de runtime", () => {
  const scenario = "authorized-synthetic-benchmark-is-non-runtime";
  const result = runCase({
    scenario,
    mode: "record",
    changeType: "A",
    pathValue: "scripts/benchmark-gerente-observability-v2.cjs",
    approvedPath: runtimePath
  });
  result.expected = "exit code 0 for the exact non-runtime benchmark path";
  assert.equal(result.status, 0, processDiagnostic(scenario, result));
});

test("outro arquivo inesperado sob scripts continua bloqueado", () => {
  const scenario = "unexpected-script-remains-runtime-blocked";
  const result = runCase({
    scenario,
    mode: "record",
    changeType: "A",
    pathValue: "scripts/outro-helper.cjs",
    approvedPath: runtimePath
  });
  result.expected = "nonzero exit for any other scripts path";
  assert.notEqual(result.status, 0, processDiagnostic(scenario, result));
});

test("somente os dois artefatos Magalu exatos são ignorados; runtime backend continua obrigatório", () => {
  for (const pathValue of ["optimus-capture/adapters/magalu.js", "optimus-capture/local-worker/magalu-identity.js"]) {
    const result = runCase({ scenario: pathValue, mode: "record", changeType: "M", pathValue });
    assert.equal(result.status, 0, processDiagnostic(pathValue, result));
    const deleted = runCase({ scenario: pathValue + "-deleted", mode: "deletions", changeType: "D", pathValue });
    assert.notEqual(deleted.status, 0, processDiagnostic(pathValue, deleted));
  }
  for (const pathValue of ["optimus-capture/adapters/other.js", "optimus-capture/local-worker/magalu-identity.js.bak"]) {
    const result = runCase({ scenario: pathValue, mode: "record", changeType: "M", pathValue });
    assert.notEqual(result.status, 0, processDiagnostic(pathValue, result));
  }
  const legitimate = runCase({ scenario: "backend-required", mode: "record-required", changeType: "M" });
  assert.equal(legitimate.status, 0, processDiagnostic("backend-required", legitimate));
  const excluded = runCase({ scenario: "extension-cannot-replace-backend", mode: "record-required", changeType: "M", pathValue: "optimus-capture/adapters/magalu.js" });
  assert.notEqual(excluded.status, 0, processDiagnostic("extension-cannot-replace-backend", excluded));
});

test("caminhos absolutos e com travessia são rejeitados", () => {
  const invalidPaths = [
    ["absolute-path", "/etc/passwd"],
    ["parent-traversal", "../escape.js"],
    ["nested-traversal", "modules/../../secret.js"],
    ["backslash-path", "modules\\escape.js"]
  ];
  for (const [scenario, pathValue] of invalidPaths) {
    const result = runCase({ scenario, mode: "invalid-path", pathValue });
    result.expected = "exit code 0 after rejecting the path";
    assert.equal(result.status, 0, processDiagnostic(scenario, result));
  }
});

test("deletions e tipos runtime inesperados seguem bloqueados", () => {
  for (const changeType of ["D", "T", "R100"]) {
    const scenario = `runtime-change-type-${changeType}-rejected`;
    const result = runCase({ scenario, mode: "record", changeType, pathValue: runtimePath, approvedPath: runtimePath });
    result.expected = "nonzero exit";
    assert.notEqual(result.status, 0, processDiagnostic(scenario, result));
  }
  assert.match(deployScript, /diff --name-only --diff-filter=D --no-renames/);
});

test("runtime alterado não autorizado continua bloqueado", () => {
  const scenario = "modified-runtime-outside-allowlist";
  const result = runCase({ scenario, mode: "record", changeType: "M", pathValue: "modules/engine/unapproved.js" });
  result.expected = "nonzero exit";
  assert.notEqual(result.status, 0, processDiagnostic(scenario, result));
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
