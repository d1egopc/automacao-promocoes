"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const base = "4db00b0b3ac990b6633749e355d7beae9e32eac2";
const deployScript = fs.readFileSync(path.join(root, "scripts/deploy-backend-vps-manual.sh"), "utf8").replace(/\r\n/g, "\n");
const match = deployScript.match(/while IFS= read -r path; do\n([\s\S]*?)\ndone < <\(git -C "\$source_dir" diff --name-only "\$BASE_SHA" "\$SOURCE_SHA"\)/);
assert.ok(match, "usar o classificador real do script de deploy");

const approved = [
  "index.js",
  "modules/telemetria/infra-memory-snapshot.js",
  "modules/whatsapp/socket-listener-lifecycle.service.js"
];
const bash = process.platform === "win32" ? "C:\\Program Files\\Git\\bin\\bash.exe" : "bash";
const code = [
  "set -Eeuo pipefail",
  "declare -A approved_set=()",
  `for path in ${approved.join(" ")}; do approved_set["$path"]=1; done`,
  "declare -A changed_runtime=()",
  "while IFS= read -r path; do",
  match[1],
  'done <<< "$CANDIDATE_PATHS"',
  'printf "%s\\n" "${!changed_runtime[@]}" | sort'
].join("\n");

function run(args, env = process.env) {
  return spawnSync(args[0], args.slice(1), { cwd: root, env, encoding: "utf8" });
}

function classificar(paths) {
  return run([bash, "-c", code], { ...process.env, CANDIDATE_PATHS: paths.join("\n") });
}

test("base produtiva classifica somente os tres arquivos do backend", () => {
  const diff = run(["git", "diff", "--name-only", base, "HEAD"]);
  assert.equal(diff.status, 0, diff.stderr);
  const paths = diff.stdout.trim().split(/\r?\n/);
  assert.ok(paths.includes("scripts/deploy-backend-vps-manual.sh"), "script novo deve estar no diff real");
  const result = classificar(paths);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.stdout.trim().split(/\r?\n/), [...approved].sort());
});

test("outro script e outro modulo continuam bloqueados", () => {
  for (const extra of ["scripts/outro-helper.sh", "modules/engine/outro-modulo.js"]) {
    const result = classificar([...approved, extra]);
    assert.notEqual(result.status, 0, extra);
  }
});

test("gates de arquivos deletados, hashes, imagem e Compose permanecem no script", () => {
  for (const guard of [
    "diff --name-only --diff-filter=D",
    'test "$active_id" = "$BASE_IMAGE"',
    'show "$BASE_SHA:$path"',
    "Effective Compose changed beyond backend image",
    "local/optimus-backend-recovery:"
  ]) assert.ok(deployScript.includes(guard), guard);
});
