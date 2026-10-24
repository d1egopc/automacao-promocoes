"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const script = fs.readFileSync(path.join(root, "scripts/deploy-backend-vps-manual.sh"), "utf8").replace(/\r\n/g, "\n");
const match = script.match(/assert_compose_image_matches_base\(\) \{\n([\s\S]*?)\n\}/);
assert.ok(match, "executar a funcao de validacao usada pelo deploy oficial");

const bash = process.platform === "win32" ? "C:\\Program Files\\Git\\bin\\bash.exe" : "bash";
const code = [
  "set -Eeuo pipefail",
  'BASE_IMAGE="sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"',
  "docker() {",
  '  [[ "$1" == image && "$2" == inspect && "$3" == -f && "$4" == "{{.Id}}" ]] || return 97',
  '  case "$TEST_MODE" in',
  '    tag-correct|digest-correct) printf \'%s\\n\' "$BASE_IMAGE" ;;',
  '    tag-wrong) printf \'%s\\n\' "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" ;;',
  '    tag-missing) return 1 ;;',
  '    *) return 98 ;;',
  "  esac",
  "}",
  "assert_compose_image_matches_base() {",
  match[1],
  "}",
  'assert_compose_image_matches_base "$TEST_REFERENCE"'
].join("\n");

function validate(mode, reference) {
  return spawnSync(bash, ["-c", code], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, TEST_MODE: mode, TEST_REFERENCE: reference }
  });
}

test("tag Docker passa somente quando resolve para BASE_IMAGE", () => {
  assert.equal(validate("tag-correct", "local/optimus-backend:release").status, 0);
  assert.notEqual(validate("tag-wrong", "local/optimus-backend:other").status, 0);
});

test("referencia por digest tambem passa quando resolve para BASE_IMAGE", () => {
  assert.equal(validate("digest-correct", "ghcr.io/optimus/backend@sha256:cccc").status, 0);
});

test("tag inexistente falha fechada", () => {
  assert.notEqual(validate("tag-missing", "local/optimus-backend:missing").status, 0);
});
