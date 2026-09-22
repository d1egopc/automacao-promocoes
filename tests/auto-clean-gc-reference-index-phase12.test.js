"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  buildOrLoadReferenceIndex,
  indexDir,
  CURRENT_FILE,
  BUILDING_FILE,
  INDEX_MAX_AGE_MS,
  REASON
} = require("../modules/engine/auto-clean/gc-reference-index-builder");
const { runOnce, closeSession, CANDIDATE_AGE_MS } = require("../modules/engine/auto-clean/gc-relay.service");

const NOW = Date.parse("2026-09-22T12:00:00.000Z");
const H1 = "a".repeat(64);
const H2 = "b".repeat(64);
const silent = { log() {} };

function fixture(workspace = "user_gc_phase12") {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-gc-index-"));
  const clientDir = path.join(dataDir, "clientes", workspace);
  const renderDir = path.join(dataDir, "identidade-visual-ofertas", "clientes", workspace, "renderizados");
  fs.mkdirSync(clientDir, { recursive: true });
  fs.mkdirSync(renderDir, { recursive: true });
  return { dataDir, workspace, clientDir, renderDir };
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
  return file;
}

function renderUrl(f, hash) {
  return `https://go.optimuspromo.com.br/identidade-visual-ofertas/public/clientes/${f.workspace}/renderizados/${hash}.png`;
}

function projection(f, items = []) {
  return writeJson(path.join(f.clientDir, "fila-projecao-leve.json"), {
    versao: 1,
    clienteId: f.workspace,
    geradoEm: new Date(NOW).toISOString(),
    total: items.length,
    itens: items
  });
}

function oldRender(f, hash) {
  const file = path.join(f.renderDir, `${hash}.png`);
  fs.writeFileSync(file, "fixture");
  const when = new Date(NOW - CANDIDATE_AGE_MS - 1000);
  fs.utimesSync(file, when, when);
  return file;
}

async function cleanup(f) {
  await closeSession(`${f.dataDir}:${f.workspace}`);
  fs.rmSync(f.dataDir, { recursive: true, force: true });
}

async function build(f, extra = {}) {
  return buildOrLoadReferenceIndex({
    dataDir: f.dataDir,
    workspaceId: f.workspace,
    nowMs: NOW,
    logger: silent,
    ...extra
  });
}

function currentPath(f) {
  return path.join(indexDir(f.dataDir, f.workspace), CURRENT_FILE);
}

function buildingPath(f) {
  return path.join(indexDir(f.dataDir, f.workspace), BUILDING_FILE);
}

async function testSmallWorkspaceAndMinimalIndex() {
  const f = fixture();
  try {
    projection(f, [
      { statusOperacional: "pendente", imagemRef: renderUrl(f, H1),
        titulo: "NAO COPIAR TITULO", cupom: "SEGREDO-COMERCIAL" },
      { statusOperacional: "terminal", imagemRef: renderUrl(f, H2),
        finalizadoEm: new Date(NOW - 8 * 24 * 60 * 60 * 1000).toISOString() }
    ]);
    const result = await build(f);
    assert.strictEqual(result.complete, true);
    assert.deepStrictEqual([...result.refs.get(H1)], ["fila"]);
    assert.strictEqual(result.refs.has(H2), false, "terminal expirado nao permanece vivo para sempre");
    const persisted = fs.readFileSync(currentPath(f), "utf8");
    assert.ok(persisted.includes(H1));
    assert.ok(!persisted.includes("NAO COPIAR TITULO"));
    assert.ok(!persisted.includes("SEGREDO-COMERCIAL"));
    assert.ok(!persisted.includes("https://"));
  } finally { await cleanup(f); }
}

async function testLargeLegacyIsGuardOnly() {
  const f = fixture();
  try {
    const legacy = path.join(f.clientDir, "fila.json");
    const fd = fs.openSync(legacy, "w");
    fs.writeSync(fd, Buffer.from("\n"), 0, 1, 17 * 1024 * 1024);
    fs.closeSync(fd);
    projection(f, [{ statusOperacional: "pendente", imagemRef: renderUrl(f, H1) }]);
    const base = fs.promises;
    const observed = Object.create(base);
    observed.readFile = async (file, ...args) => {
      assert.notStrictEqual(path.resolve(file), path.resolve(legacy), "fila monolitica nao pode ser lida");
      return base.readFile(file, ...args);
    };
    const result = await build(f, { fsApi: observed });
    assert.strictEqual(result.complete, true);
    assert.ok(result.refs.has(H1));
  } finally { await cleanup(f); }
}

async function testBootstrapCursorAndPromotion() {
  const f = fixture();
  try {
    writeJson(path.join(f.clientDir, "fila.json"), []);
    const projectionFile = projection(f, [{ statusOperacional: "pendente", imagemRef: renderUrl(f, H1) }]);
    const day = new Date(NOW).toISOString().slice(0, 10);
    const file = path.join(f.clientDir, "fila-historico-leve-incremental", `${day}.jsonl`);
    const firstLine = `${JSON.stringify({ imagemRef: renderUrl(f, H1) })}\n`;
    const secondLine = `${JSON.stringify({ imagemRef: renderUrl(f, H2) })}\n`;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, firstLine + secondLine);
    const budget = fs.statSync(projectionFile).size + Buffer.byteLength(firstLine);
    const first = await build(f, { maxBytesPerRun: budget });
    assert.strictEqual(first.complete, false);
    assert.strictEqual(first.reasonCode, REASON.BUILD_BUDGET);
    assert.ok(!fs.existsSync(currentPath(f)), "geracao parcial nao pode ser promovida");
    const cursor = JSON.parse(fs.readFileSync(buildingPath(f), "utf8")).sourceCursor;
    assert.strictEqual(cursor, Buffer.byteLength(firstLine));
    const second = await build(f, { maxBytesPerRun: budget });
    assert.strictEqual(second.complete, true, "novo processo retoma cursor persistido");
    assert.ok(fs.existsSync(currentPath(f)));
    assert.ok(second.refs.has(H1) && second.refs.has(H2));
  } finally { await cleanup(f); }
}

async function testRelayHonorsMaximumBatch() {
  const f = fixture("user_gc_batch");
  try {
    for (let index = 0; index < 60; index += 1) {
      const hash = index.toString(16).padStart(64, "0");
      oldRender(f, hash);
    }
    const result = await runOnce({ dataDir: f.dataDir, nowMs: NOW, minIntervalMs: 0,
      maxEntries: 999, logger: silent });
    assert.strictEqual(result.inspected, 50);
    assert.strictEqual(result.candidates, 50);
  } finally { await cleanup(f); }
}

async function testRelayFailClosedDuringBootstrap() {
  const f = fixture();
  try {
    const file = oldRender(f, H1);
    const day = new Date(NOW).toISOString().slice(0, 10);
    const history = path.join(f.clientDir, "fila-historico-leve-incremental", `${day}.jsonl`);
    fs.mkdirSync(path.dirname(history), { recursive: true });
    fs.writeFileSync(history, `${JSON.stringify({ imagemRef: renderUrl(f, H2) })}\n`);
    const result = await runOnce({ dataDir: f.dataDir, workspaceId: f.workspace, nowMs: NOW,
      minIntervalMs: 0, maxEntries: 1, maxReferenceBytes: 8, logger: silent });
    assert.strictEqual(result.referenceComplete, false);
    assert.strictEqual(result.candidates, 0);
    assert.ok(result.errors >= 2);
    assert.ok(fs.existsSync(file));
  } finally { await cleanup(f); }
}

async function testSourceChangePreventsPromotion() {
  const f = fixture();
  try {
    const target = projection(f, [{ statusOperacional: "pendente", imagemRef: renderUrl(f, H1) }]);
    const base = fs.promises;
    let changed = false;
    const mutating = Object.create(base);
    mutating.readFile = async (file, ...args) => {
      const content = await base.readFile(file, ...args);
      if (!changed && path.resolve(file) === path.resolve(target)) {
        changed = true;
        fs.appendFileSync(target, " ");
      }
      return content;
    };
    const result = await build(f, { fsApi: mutating });
    assert.strictEqual(result.complete, false);
    assert.strictEqual(result.reasonCode, REASON.SOURCE_CHANGED);
    assert.ok(!fs.existsSync(currentPath(f)));
    const converged = await build(f);
    assert.strictEqual(converged.complete, true, "apos estabilizar, o bootstrap converge");
  } finally { await cleanup(f); }
}

async function testLegacyGuardsNeverFakeCompleteness() {
  for (const file of ["fila.json", "fila-historico.json"]) {
    const f = fixture(`user_gc_guard_${file === "fila.json" ? "fila" : "history"}`);
    try {
      writeJson(path.join(f.clientDir, file), [{ imagem: renderUrl(f, H1), status: "pendente" }]);
      const result = await build(f);
      assert.strictEqual(result.complete, false, `${file} sem read-model nao pode virar COMPLETE`);
      assert.strictEqual(result.reasonCode, REASON.COMPACT_SOURCE_MISSING);
      assert.ok(!fs.existsSync(currentPath(f)));
    } finally { await cleanup(f); }
  }
}

async function testIsolatedCompactSources() {
  const cases = [
    ["fila-viva.json", [{ imagem: renderUrl({ workspace: "user_gc_iso" }, H1) }], "fila"],
    ["vitrine.json", { ofertas: [{ imagem: renderUrl({ workspace: "user_gc_iso" }, H1), ultimoEnvioEm: new Date(NOW).toISOString() }] }, "vitrine"],
    ["manual_ofertas_v2.json", [{ imagem: renderUrl({ workspace: "user_gc_iso" }, H1), status: "agendada" }], "manual"],
    ["social-agendamentos.json", [{ imagemUrl: renderUrl({ workspace: "user_gc_iso" }, H1), status: "agendada" }], "social"]
  ];
  for (const [file, value, source] of cases) {
    const f = fixture("user_gc_iso");
    try {
      writeJson(path.join(f.clientDir, file), value);
      const result = await build(f);
      assert.strictEqual(result.complete, true, `${file} isolado deve ser coberto`);
      assert.deepStrictEqual([...result.refs.get(H1)], [source]);
    } finally { await cleanup(f); }
  }

  const history = fixture("user_gc_iso_history");
  try {
    const day = new Date(NOW).toISOString().slice(0, 10);
    const file = path.join(history.clientDir, "fila-historico-leve-incremental", `${day}.jsonl`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify({ imagemRef: renderUrl(history, H1) })}\n`);
    const result = await build(history);
    assert.strictEqual(result.complete, true);
    assert.deepStrictEqual([...result.refs.get(H1)], ["historico"]);
  } finally { await cleanup(history); }
}

async function testCompleteIndexPreservesSharedRender() {
  const f = fixture();
  try {
    const file = oldRender(f, H1);
    writeJson(path.join(f.clientDir, "vitrine.json"), { ofertas: [
      { imagem: renderUrl(f, H1), ultimoEnvioEm: new Date(NOW - 60 * 60 * 1000).toISOString() },
      { imagem: renderUrl(f, H1), ultimoEnvioEm: new Date(NOW - 10 * 24 * 60 * 60 * 1000).toISOString() }
    ] });
    const result = await runOnce({ dataDir: f.dataDir, nowMs: NOW, minIntervalMs: 0,
      maxEntries: 1, logger: silent });
    assert.strictEqual(result.referenceComplete, true);
    assert.strictEqual(result.live, 1);
    assert.strictEqual(result.candidates, 0);
    assert.ok(fs.existsSync(file));
  } finally { await cleanup(f); }
}

async function testCorruptAndStaleCurrentFailClosed() {
  for (const mode of ["corrupt", "stale"]) {
    const f = fixture(`user_gc_${mode}`);
    try {
      projection(f, [{ statusOperacional: "pendente", imagemRef: renderUrl(f, H1) }]);
      assert.strictEqual((await build(f)).complete, true);
      if (mode === "corrupt") fs.writeFileSync(currentPath(f), "{invalido");
      const nowMs = mode === "stale" ? NOW + INDEX_MAX_AGE_MS + 1 : NOW;
      const result = await buildOrLoadReferenceIndex({ dataDir: f.dataDir, workspaceId: f.workspace,
        nowMs, maxBytesPerRun: 1, logger: silent });
      assert.strictEqual(result.complete, false, `${mode} nao pode ser usado pelo GC`);
      assert.strictEqual(result.reasonCode, REASON.COMPACT_SOURCE_TOO_LARGE);
    } finally { await cleanup(f); }
  }
}

async function testFreshCurrentReuseAndIndexSizes() {
  const f = fixture("user_gc_fresh");
  try {
    const target = projection(f, [{ statusOperacional: "pendente", imagemRef: renderUrl(f, H1) }]);
    assert.strictEqual((await build(f)).complete, true);
    const base = fs.promises;
    const observed = Object.create(base);
    observed.readFile = async (file, ...args) => {
      assert.notStrictEqual(path.resolve(file), path.resolve(target), "indice fresco nao relê fonte");
      return base.readFile(file, ...args);
    };
    assert.strictEqual((await build(f, { fsApi: observed })).complete, true);
  } finally { await cleanup(f); }

  for (const count of [1000, 10000, 50000]) {
    const refs = {};
    for (let index = 0; index < count; index += 1) {
      refs[index.toString(16).padStart(64, "0")] = ["fila"];
    }
    const bytes = Buffer.byteLength(JSON.stringify({ schemaVersion: 1, status: "complete", workspaceId: "w", refs }));
    assert.ok(bytes < 16 * 1024 * 1024, `indice de ${count} refs excedeu o teto`);
  }
}

async function testOptionalMissingAndRequiredUnreadable() {
  const optional = fixture("user_gc_optional");
  try {
    assert.strictEqual((await build(optional)).complete, true);
  } finally { await cleanup(optional); }

  const required = fixture("user_gc_required");
  try {
    writeJson(path.join(required.clientDir, "fila.json"), []);
    const target = projection(required, []);
    const base = fs.promises;
    const denied = Object.create(base);
    denied.lstat = async (file, ...args) => {
      if (path.resolve(file) === path.resolve(target)) {
        const error = new Error("denied");
        error.code = "EACCES";
        throw error;
      }
      return base.lstat(file, ...args);
    };
    const result = await build(required, { fsApi: denied });
    assert.strictEqual(result.complete, false);
    assert.strictEqual(result.reasonCode, REASON.SOURCE_READ_ERROR);
    assert.strictEqual(result.source, "fila");
    assert.ok(!fs.existsSync(currentPath(required)));
  } finally { await cleanup(required); }
}

async function testBuilderReasonCodesAreSanitized() {
  const invalidJson = fixture("user_gc_invalid_json");
  try {
    fs.writeFileSync(path.join(invalidJson.clientDir, "fila-projecao-leve.json"), "{invalido");
    const result = await build(invalidJson);
    assert.strictEqual(result.complete, false);
    assert.strictEqual(result.reasonCode, REASON.SOURCE_INVALID_JSON);
    assert.strictEqual(result.referenceFile, "fila-projecao-leve.json");
  } finally { await cleanup(invalidJson); }

  const invalidJsonl = fixture("user_gc_invalid_jsonl");
  try {
    const day = new Date(NOW).toISOString().slice(0, 10);
    const file = path.join(invalidJsonl.clientDir, "fila-historico-leve-incremental", `${day}.jsonl`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "{invalido\n");
    const result = await build(invalidJsonl);
    assert.strictEqual(result.complete, false);
    assert.strictEqual(result.reasonCode, REASON.JSONL_PARSE_ERROR);
    assert.strictEqual(result.referenceFile, `${day}.jsonl`);
    assert.strictEqual(result.lineNumber, 1);
  } finally { await cleanup(invalidJsonl); }
}

async function testBudgetAndTimeCeilings() {
  const budget = fixture("user_gc_budget");
  try {
    const day = new Date(NOW).toISOString().slice(0, 10);
    const file = path.join(budget.clientDir, "fila-historico-leve-incremental", `${day}.jsonl`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const firstLine = `${JSON.stringify({ imagemRef: renderUrl(budget, H1) })}\n`;
    fs.writeFileSync(file, `${firstLine}${JSON.stringify({ imagemRef: renderUrl(budget, H2) })}\n`);
    const roundBudget = Buffer.byteLength(firstLine);
    const result = await build(budget, { maxBytesPerRun: roundBudget });
    assert.strictEqual(result.complete, false);
    assert.strictEqual(result.reasonCode, REASON.BUILD_BUDGET);
    assert.ok(result.bytesProcessed <= roundBudget);
  } finally { await cleanup(budget); }

  const timed = fixture("user_gc_timed");
  try {
    projection(timed, []);
    let tick = 0;
    const result = await build(timed, { maxDurationMs: 10, clock: () => (tick++ === 0 ? 0 : 11) });
    assert.strictEqual(result.complete, false);
    assert.strictEqual(result.reasonCode, REASON.BUILD_TIME);
    assert.strictEqual(result.bytesProcessed, 0);
  } finally { await cleanup(timed); }
}

async function testNoPhysicalDeletionPrimitive() {
  const files = [
    "../modules/engine/auto-clean/gc-reference-index-builder.js",
    "../modules/engine/auto-clean/gc-reference-index.js",
    "../modules/engine/auto-clean/gc-relay.service.js"
  ];
  const forbidden = /\b(?:unlink|unlinkSync|rmSync|rmdir|truncate|deleteFile)\s*\(/;
  for (const relative of files) {
    const source = fs.readFileSync(path.join(__dirname, relative), "utf8");
    assert.ok(!forbidden.test(source), `${relative} nao pode conter primitiva de exclusao fisica`);
  }
}

async function main() {
  await testSmallWorkspaceAndMinimalIndex();
  await testLargeLegacyIsGuardOnly();
  await testBootstrapCursorAndPromotion();
  await testRelayFailClosedDuringBootstrap();
  await testSourceChangePreventsPromotion();
  await testLegacyGuardsNeverFakeCompleteness();
  await testIsolatedCompactSources();
  await testCompleteIndexPreservesSharedRender();
  await testCorruptAndStaleCurrentFailClosed();
  await testFreshCurrentReuseAndIndexSizes();
  await testOptionalMissingAndRequiredUnreadable();
  await testBuilderReasonCodesAreSanitized();
  await testBudgetAndTimeCeilings();
  await testRelayHonorsMaximumBatch();
  await testNoPhysicalDeletionPrimitive();
  console.log("AUTO_CLEAN_GC_REFERENCE_INDEX_PHASE12_TESTS_PASS");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
