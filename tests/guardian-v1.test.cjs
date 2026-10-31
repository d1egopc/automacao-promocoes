"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const guardian = path.join(root, "scripts", "guardian-v1.cjs");
const fixtureRoot = path.join(root, "tmp", "guardian-v1-test-fixtures");

test.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));

function run(command, args, cwd, env = process.env) {
  return spawnSync(command, args, { cwd, env, encoding: "utf8", windowsHide: true });
}

function createRepo() {
  fs.mkdirSync(fixtureRoot, { recursive: true });
  const dir = fs.mkdtempSync(path.join(fixtureRoot, "optimus-guardian-v1-"));
  fs.mkdirSync(path.join(dir, "modules", "demo"), { recursive: true });
  fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(dir, "tests"), { recursive: true });
  fs.copyFileSync(guardian, path.join(dir, "scripts", "guardian-v1.cjs"));
  fs.writeFileSync(path.join(dir, "index.js"), "console.log('base');\n");
  fs.writeFileSync(path.join(dir, "modules", "demo", "existing.js"), "module.exports = 1;\n");
  run("git", ["init", "-q"], dir);
  run("git", ["config", "user.email", "guardian@example.invalid"], dir);
  run("git", ["config", "user.name", "Guardian fixture"], dir);
  run("git", ["add", "."], dir);
  run("git", ["commit", "-qm", "base"], dir);
  const base = run("git", ["rev-parse", "HEAD"], dir).stdout.trim();
  return { dir, base };
}

function commit(repo, message = "candidate") {
  run("git", ["add", "."], repo.dir);
  const committed = run("git", ["commit", "-qm", message], repo.dir);
  assert.equal(committed.status, 0, committed.stderr);
  return run("git", ["rev-parse", "HEAD"], repo.dir).stdout.trim();
}

function prepare(repo, source) {
  const result = run(process.execPath, [guardian, "prepare", "--repo", repo.dir, "--base", repo.base, "--source", source], root);
  return { result, body: JSON.parse(result.stdout || "{}") };
}

function cleanup(repo) {
  fs.rmSync(repo.dir, { recursive: true, force: true });
}

test("bootstrap localiza o repositório atual sem alterar a árvore", () => {
  const repo = createRepo();
  try {
    const before = run("git", ["status", "--porcelain"], repo.dir).stdout;
    const result = run(process.execPath, [guardian, "bootstrap", "--repo", repo.dir], root);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /HEAD=[0-9a-f]{40}/);
    assert.equal(run("git", ["status", "--porcelain"], repo.dir).stdout, before);
  } finally { cleanup(repo); }
});

test("arquivo runtime modificado e novo são derivados automaticamente", () => {
  const repo = createRepo();
  try {
    fs.writeFileSync(path.join(repo.dir, "modules", "demo", "existing.js"), "module.exports = 2;\n");
    fs.writeFileSync(path.join(repo.dir, "modules", "demo", "new.js"), "module.exports = 3;\n");
    const source = commit(repo);
    const { result, body } = prepare(repo, source);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(body.validation, "PASS");
    assert.deepEqual(body.runtimeFiles, ["modules/demo/existing.js", "modules/demo/new.js"]);
  } finally { cleanup(repo); }
});

test("documentação e ferramentas exatas não entram na imagem", () => {
  const repo = createRepo();
  try {
    fs.mkdirSync(path.join(repo.dir, "docs"), { recursive: true });
    fs.writeFileSync(path.join(repo.dir, "docs", "note.md"), "safe\n");
    fs.writeFileSync(path.join(repo.dir, "scripts", "guardian-v1.cjs"), fs.readFileSync(guardian));
    fs.appendFileSync(path.join(repo.dir, "scripts", "guardian-v1.cjs"), "\n// fixture\n");
    const source = commit(repo);
    const { result, body } = prepare(repo, source);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(body.runtimeFiles, []);
    assert.deepEqual(body.ignoredFiles, ["docs/note.md", "scripts/guardian-v1.cjs"]);
  } finally { cleanup(repo); }
});

test("script inesperado e raiz desconhecida permanecem bloqueados", () => {
  for (const relative of ["scripts/unknown-helper.cjs", "unknown/runtime.js"]) {
    const repo = createRepo();
    try {
      const target = path.join(repo.dir, ...relative.split("/"));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, "module.exports = true;\n");
      const source = commit(repo, relative);
      const { result, body } = prepare(repo, source);
      assert.equal(result.status, 2);
      assert.equal(body.validation, "BLOCKED");
      assert.equal(body.blocked[0].cause, "unknown_or_disallowed_runtime_path");
    } finally { cleanup(repo); }
  }
});

test("somente os dois arquivos Magalu da extensão ficam fora do overlay backend", () => {
  const repo = createRepo();
  try {
    const permitidos = ["optimus-capture/adapters/magalu.js", "optimus-capture/local-worker/magalu-identity.js"];
    for (const relativo of permitidos) {
      const destino = path.join(repo.dir, ...relativo.split("/"));
      fs.mkdirSync(path.dirname(destino), { recursive: true });
      fs.writeFileSync(destino, "module.exports = true;\n");
    }
    let source = commit(repo, "extension-approved-paths");
    let result = prepare(repo, source);
    assert.equal(result.body.validation, "PASS");
    assert.deepEqual(result.body.runtimeFiles, []);
    assert.deepEqual(result.body.ignoredFiles, permitidos);
    const inesperado = path.join(repo.dir, "optimus-capture", "local-worker", "unexpected.js");
    fs.writeFileSync(inesperado, "module.exports = true;\n");
    source = commit(repo, "extension-unexpected-path");
    result = prepare(repo, source);
    assert.equal(result.body.validation, "BLOCKED");
    assert.equal(result.body.blocked[0].file, "optimus-capture/local-worker/unexpected.js");
  } finally { cleanup(repo); }
});

test("dependência e Dockerfile exigem fluxo futuro de imagem completa", () => {
  for (const relative of ["package.json", "package-lock.json", "Dockerfile"]) {
    const repo = createRepo();
    try {
      fs.writeFileSync(path.join(repo.dir, relative), `${relative} changed\n`);
      const source = commit(repo, relative);
      const { result, body } = prepare(repo, source);
      assert.equal(result.status, 2);
      assert.equal(body.blocked[0].cause, "full_image_build_not_supported_by_guardian_v1");
    } finally { cleanup(repo); }
  }
});

test("remoção de runtime falha fechada", () => {
  const repo = createRepo();
  try {
    fs.unlinkSync(path.join(repo.dir, "modules", "demo", "existing.js"));
    run("git", ["add", "-u"], repo.dir);
    const source = commit(repo, "delete");
    const { result, body } = prepare(repo, source);
    assert.equal(result.status, 2);
    assert.equal(body.blocked[0].cause, "deleted_file_not_supported");
  } finally { cleanup(repo); }
});

test("caminhos absolutos, travessia e duplicatas são rejeitados pela API", () => {
  delete require.cache[require.resolve(guardian)];
  const api = require(guardian);
  for (const value of ["/etc/passwd", "../escape.js", "modules/../escape.js", "modules/./escape.js", "modules//x.js"])
    assert.throws(() => api.normalizeRuntimePath(value), /unsafe_path/);
  assert.equal(api.normalizeRuntimePath(".github/workflows/ci.yml"), ".github/workflows/ci.yml");
});

test("dotfile desconhecido continua bloqueado pela allowlist", () => {
  const repo = createRepo();
  try {
    fs.writeFileSync(path.join(repo.dir, ".unknown-runtime"), "blocked\n");
    const source = commit(repo, "unknown dotfile");
    const { result, body } = prepare(repo, source);
    assert.equal(result.status, 2);
    assert.equal(body.blocked[0].cause, "unknown_or_disallowed_runtime_path");
  } finally { cleanup(repo); }
});

test("matriz distingue contratos afetados e mantém críticos", () => {
  delete require.cache[require.resolve(guardian)];
  const { testMatrix } = require(guardian);
  const tests = testMatrix({ runtimeFiles: ["modules/mensageiro/demo.js"], ignoredFiles: [] }).map(item => item.id);
  for (const required of ["contract:rio", "contract:radar", "contract:teleradar", "contract:clonador", "contract:fila-viva", "mensageiro:gerente", "mensageiro:comandos", "mensageiro:programadas"])
    assert.ok(tests.includes(required), required);
  const radar = testMatrix({ runtimeFiles: ["modules/radar/comercial-precedencia.js"], ignoredFiles: [] }).map(item => item.id);
  for (const required of ["radar:commercial-fidelity", "radar:faithful-mirror", "radar:mirror-propagation", "radar:commercial-precedence", "radar:semantic-price"])
    assert.ok(radar.includes(required), required);
  const infra = testMatrix({ runtimeFiles: [], ignoredFiles: ["scripts/guardian-v1.cjs"] });
  assert.equal(infra.find(item => item.id === "deploy:syntax").requiresBash, true);
  assert.equal(infra.find(item => item.id === "guardian:v1").requiresBash, false);
});

test("classificação de resultado distingue regressão, dívida e bloqueio", () => {
  delete require.cache[require.resolve(guardian)];
  const { classifyTestOutcome, environmentBlocked, summarizeResults } = require(guardian);
  assert.equal(classifyTestOutcome(0, undefined), "PASS");
  assert.equal(classifyTestOutcome(1, 0), "FAIL");
  assert.equal(classifyTestOutcome(1, 1), "BASELINE_DEBT");
  assert.equal(classifyTestOutcome(null, 0), "BLOCKED");
  assert.equal(classifyTestOutcome(1, null), "BLOCKED");
  assert.equal(environmentBlocked({ status: null, stdout: "", stderr: "" }), true);
  assert.equal(environmentBlocked({ status: 1, stdout: "", stderr: "fatal: NtCreateDirectoryObject failed, 0xC0000022" }), true);
  assert.equal(environmentBlocked({ status: 1, stdout: "assertion failed", stderr: "" }), false);
  assert.equal(summarizeResults([{ status: "PASS" }]), "PASS");
  assert.equal(summarizeResults([{ status: "BASELINE_DEBT" }]), "BASELINE_DEBT");
  assert.equal(summarizeResults([{ status: "BLOCKED" }]), "BLOCKED");
  assert.equal(summarizeResults([{ status: "BLOCKED" }, { status: "FAIL" }]), "FAIL");
});
