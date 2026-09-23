"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { bootstrapReferenciasFilaViva, publicarReferenciasFilaViva,
  FILA_GC_REFERENCES_ARQUIVO } = require("../modules/fila/fila-gc-references");
const { reconciliarProjecaoHotPublicaCliente, escreverFilaViva } = require("../modules/fila/fila-operacional-v2");
const { buildOrLoadReferenceIndex, indexDir, BUILDING_FILE, CURRENT_FILE,
  REASON, DEFAULT_BUILD_BYTES, DEFAULT_BUILD_DURATION_MS } = require("../modules/engine/auto-clean/gc-reference-index-builder");
const { runOnce, closeSession, CANDIDATE_AGE_MS } = require("../modules/engine/auto-clean/gc-relay.service");

const NOW = Date.parse("2026-09-22T12:00:00.000Z");
const H1 = "1".repeat(64);
const H2 = "2".repeat(64);
const silent = { log() {} };

function fixture(name) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-gc-141-"));
  const clientDir = path.join(dataDir, "clientes", name);
  fs.mkdirSync(clientDir, { recursive: true });
  const file = (_, filename) => path.join(clientDir, filename);
  const write = (_, filename, value) => {
    fs.writeFileSync(file(name, filename), JSON.stringify(value));
    return true;
  };
  return { dataDir, clientDir, workspace: name, file, write,
    deps: { getClienteJsonPath: file, writeClienteJson: write, logger: silent } };
}

function render(f, hash) {
  return `https://go.optimuspromo.com.br/identidade-visual-ofertas/public/clientes/${f.workspace}/renderizados/${hash}.png`;
}

function queue(f, entries) { f.write(f.workspace, "fila-viva.json", entries); }
function projection(f) { return f.file(f.workspace, FILA_GC_REFERENCES_ARQUIVO); }
function building(f) { return path.join(indexDir(f.dataDir, f.workspace), BUILDING_FILE); }
function current(f) { return path.join(indexDir(f.dataDir, f.workspace), CURRENT_FILE); }
function build(f, extra = {}) {
  return buildOrLoadReferenceIndex({ dataDir: f.dataDir, workspaceId: f.workspace,
    nowMs: NOW, logger: silent, ...extra });
}
async function relay(f) {
  const result = await runOnce({ dataDir: f.dataDir, workspaceId: f.workspace,
    nowMs: NOW, minIntervalMs: 0, logger: silent });
  assert.strictEqual(result.dryRun, true);
  return result;
}
async function cleanup(f) {
  await closeSession(`${f.dataDir}:${f.workspace}`);
  fs.rmSync(f.dataDir, { recursive: true, force: true });
}

async function testExistingQueueBootstrapsNaturally() {
  const f = fixture("user_gc_bootstrap141");
  try {
    const entries = [{ id: "item", imagem: render(f, H1) }];
    queue(f, entries); // fila-viva preexistente, sem projecao nova
    assert.ok(!fs.existsSync(projection(f)));
    const missing = await build(f);
    assert.strictEqual(missing.reasonCode, REASON.COMPACT_SOURCE_MISSING);
    assert.strictEqual(missing.complete, false);
    const candidate = path.join(f.dataDir, "identidade-visual-ofertas", "clientes", f.workspace,
      "renderizados", `${H2}.png`);
    fs.mkdirSync(path.dirname(candidate), { recursive: true });
    fs.writeFileSync(candidate, "fixture");
    const old = new Date(NOW - CANDIDATE_AGE_MS - 1000);
    fs.utimesSync(candidate, old, old);
    const before = await relay(f);
    assert.strictEqual(before.candidates, 0);
    assert.strictEqual(before.candidateBytes, 0);

    // O caminho real de inicializacao reutiliza a fila ja carregada em memoria.
    const observedMemory = { ...fs, promises: Object.create(fs.promises) };
    observedMemory.promises.readFile = async (file, ...args) => {
      assert.notStrictEqual(path.resolve(file), path.resolve(f.file(f.workspace, "fila-viva.json")),
        "bootstrap nao deve reler fila-viva quando a fila ja esta em memoria");
      return fs.promises.readFile(file, ...args);
    };
    reconciliarProjecaoHotPublicaCliente(f.workspace,
      { fila: entries, motivo: "carregarFila" }, { ...f.deps, fs: observedMemory });
    const recovered = await bootstrapReferenciasFilaViva(f.workspace,
      { ...f.deps, fs: observedMemory });
    assert.strictEqual(recovered.ok, true, JSON.stringify(recovered));
    assert.ok(fs.existsSync(projection(f)));
    assert.ok(fs.statSync(projection(f)).size < 1024);
    const observed = Object.create(fs.promises);
    observed.readFile = async (file, ...args) => {
      assert.notStrictEqual(path.resolve(file), path.resolve(f.file(f.workspace, "fila-viva.json")),
        "GC nao pode ler fila-viva integralmente");
      return fs.promises.readFile(file, ...args);
    };
    observed.open = async (file, ...args) => {
      assert.notStrictEqual(path.resolve(file), path.resolve(f.file(f.workspace, "fila-viva.json")));
      return fs.promises.open(file, ...args);
    };
    const ready = await build(f, { fsApi: observed });
    assert.strictEqual(ready.complete, true, JSON.stringify({ reasonCode: ready.reasonCode }));
    assert.ok(ready.refs.has(H1));
    assert.ok(fs.existsSync(current(f)));
    assert.ok(ready.bytesProcessed <= DEFAULT_BUILD_BYTES);
    assert.ok(ready.durationMs <= DEFAULT_BUILD_DURATION_MS);
    assert.ok(fs.existsSync(candidate), "dry-run nunca remove render");
    const after = await relay(f);
    assert.ok(after.candidates >= 1);
    assert.ok(after.candidateBytes >= 1);
    assert.ok(fs.existsSync(candidate), "mesmo candidato permanece no dry-run");
  } finally { await cleanup(f); }
}

async function testStaleCrashAndWriterCatchUp() {
  const f = fixture("user_gc_stale141");
  try {
    const first = [{ imagem: render(f, H1) }];
    queue(f, first);
    assert.strictEqual((await bootstrapReferenciasFilaViva(f.workspace, f.deps)).ok, true);
    const date = new Date(NOW).toISOString().slice(0, 10);
    const history = path.join(f.clientDir, "fila-historico-leve-incremental", `${date}.jsonl`);
    fs.mkdirSync(path.dirname(history), { recursive: true });
    const row = `${JSON.stringify({ imagemRef: render(f, H1) })}\n`;
    fs.writeFileSync(history, row.repeat(6));
    const pending = await build(f, { maxBytesPerRun: fs.statSync(projection(f)).size * 2 + Buffer.byteLength(row) });
    assert.strictEqual(pending.complete, false);
    const generation = JSON.parse(fs.readFileSync(building(f), "utf8")).generation;
    const next = [{ imagem: render(f, H2) }];
    queue(f, next); // simula crash entre escrita da fila e da projecao
    const stale = await build(f);
    assert.strictEqual(stale.complete, false);
    assert.strictEqual(stale.reasonCode, REASON.COMPACT_SOURCE_STALE);
    const closed = await relay(f);
    assert.strictEqual(closed.candidates, 0);
    assert.strictEqual(closed.candidateBytes, 0);
    const recovered = await bootstrapReferenciasFilaViva(f.workspace, f.deps);
    assert.strictEqual(recovered.ok, true);
    const caughtUp = await build(f);
    assert.strictEqual(caughtUp.complete, true);
    assert.strictEqual(caughtUp.generation, generation);
    assert.ok(caughtUp.refs.has(H2));
    assert.ok(!caughtUp.refs.get(H1)?.has("fila"), "fila antiga nao pode sobreviver ao catch-up");

    const written = escreverFilaViva(f.workspace, [{ id: "offer-2", clienteId: f.workspace,
      status: "pendente", imagem: render(f, H1), criadoEm: new Date(NOW).toISOString() }],
    { ...f.deps, agora: NOW });
    assert.strictEqual(written.ok, true);
    const postWriter = await build(f);
    assert.strictEqual(postWriter.complete, true);
    assert.ok(postWriter.refs.has(H1));

    queue(f, [{ imagem: render(f, H2) }]);
    let queueChanged = false;
    const observed = { ...fs, promises: Object.create(fs.promises) };
    observed.promises.readFile = async (file, ...args) => {
      const value = await fs.promises.readFile(file, ...args);
      if (!queueChanged && path.basename(file) === "fila-viva.json") {
        queueChanged = true;
        queue(f, [{ imagem: render(f, H2) }]);
      }
      return value;
    };
    const raced = await bootstrapReferenciasFilaViva(f.workspace, {
      ...f.deps, fs: observed
    });
    assert.strictEqual(raced.ok, false);
    assert.strictEqual(raced.motivo, "gc_references_guard_changed");
    assert.strictEqual((await build(f)).complete, false);
  } finally { await cleanup(f); }
}

async function testLegacyLightProjectionStaleRecoversOnQueueLoad() {
  const f = fixture("user_gc_light_stale141");
  try {
    const item = { id: "offer-light", clienteId: f.workspace, status: "pendente",
      imagem: render(f, H1) };
    queue(f, [{ item }]);
    f.write(f.workspace, "fila-projecao-leve.json", { versao: 1, clienteId: f.workspace, itens: [] });
    const old = new Date(Date.now() - 20000);
    fs.utimesSync(f.file(f.workspace, "fila-projecao-leve.json"), old, old);
    f.write(f.workspace, "fila.json", [item]);
    const stale = await build(f);
    assert.strictEqual(stale.complete, false);
    assert.strictEqual(stale.reasonCode, REASON.COMPACT_SOURCE_STALE);
    assert.strictEqual(stale.file, "fila-projecao-leve.json");
    reconciliarProjecaoHotPublicaCliente(f.workspace,
      { fila: [item], motivo: "carregarFila" }, f.deps);
    assert.strictEqual((await bootstrapReferenciasFilaViva(f.workspace, f.deps)).ok, true);
    const ready = await build(f);
    assert.strictEqual(ready.complete, true, JSON.stringify({ reasonCode: ready.reasonCode, file: ready.file }));
    assert.ok(ready.refs.has(H1));
  } finally { await cleanup(f); }
}

async function testLegacyBuildingMigratesWithoutRestart() {
  const f = fixture("user_gc_legacy141");
  try {
    const entries = [{ imagem: render(f, H1) }];
    queue(f, entries);
    assert.strictEqual((await bootstrapReferenciasFilaViva(f.workspace, f.deps)).ok, true);
    const date = new Date(NOW).toISOString().slice(0, 10);
    const history = path.join(f.clientDir, "fila-historico-leve-incremental", `${date}.jsonl`);
    fs.mkdirSync(path.dirname(history), { recursive: true });
    const row = `${JSON.stringify({ imagemRef: render(f, H1) })}\n`;
    fs.writeFileSync(history, row.repeat(6));
    const partial = await build(f, { maxBytesPerRun: fs.statSync(projection(f)).size * 2 + Buffer.byteLength(row) });
    assert.strictEqual(partial.complete, false);
    const state = JSON.parse(fs.readFileSync(building(f), "utf8"));
    const oldGeneration = state.generation;
    const queueStat = fs.statSync(f.file(f.workspace, "fila-viva.json"));
    const legacyKey = "compact:fila-viva";
    state.sourceOrder.unshift(legacyKey);
    state.sourceStates[legacyKey] = {
      key: legacyKey, kind: "array", source: "fila", file: "fila-viva.json",
      size: queueStat.size, mtimeMs: Math.trunc(queueStat.mtimeMs), identity: "",
      targetSize: queueStat.size, cursor: queueStat.size, complete: true,
      refs: { [H2]: ["fila"] }
    };
    state.refs[H2] = ["fila"];
    state.sourceIndex += 1;
    fs.writeFileSync(building(f), JSON.stringify(state));
    const migrated = await build(f);
    assert.strictEqual(migrated.complete, true, JSON.stringify({ reasonCode: migrated.reasonCode }));
    assert.strictEqual(migrated.generation, oldGeneration);
    assert.ok(migrated.refs.has(H1));
    assert.ok(!migrated.refs.has(H2), "refs do source legado removido nao sobrevivem");
    const saved = JSON.parse(fs.readFileSync(current(f), "utf8"));
    assert.ok(saved.sourceStates["compact:fila-gc-references"]);
    assert.ok(!saved.sourceStates[legacyKey]);
  } finally { await cleanup(f); }
}

async function testManyItemsRemainCompleteWithoutBudgetIncrease() {
  const f = fixture("user_gc_many141");
  try {
    const entries = Array.from({ length: 209 }, (_, index) => ({
      imagem: render(f, index % 2 ? H2 : H1),
      data: Array(1500).fill(0),
      padding: "x".repeat(110 * 1024)
    }));
    queue(f, entries);
    assert.ok(fs.statSync(f.file(f.workspace, "fila-viva.json")).size > 20 * 1024 * 1024);
    const started = Date.now();
    const projected = await bootstrapReferenciasFilaViva(f.workspace, f.deps);
    assert.strictEqual(projected.ok, true, JSON.stringify(projected));
    assert.ok(fs.statSync(projection(f)).size < 1024);
    const indexed = await build(f);
    assert.strictEqual(indexed.complete, true);
    assert.ok(indexed.refs.has(H1) && indexed.refs.has(H2));
    assert.strictEqual(DEFAULT_BUILD_BYTES, 16 * 1024 * 1024);
    assert.strictEqual(DEFAULT_BUILD_DURATION_MS, 750);
    console.log("GC_REF_BOOTSTRAP_141_SCALE", JSON.stringify({
      queueBytes: fs.statSync(f.file(f.workspace, "fila-viva.json")).size,
      projectionBytes: fs.statSync(projection(f)).size,
      bootstrapAndBuildMs: Date.now() - started,
      gcBytesProcessed: indexed.bytesProcessed,
      gcDurationMs: indexed.durationMs
    }));
    const oversizedItem = [{ data: Array(300001).fill(0), imagem: render(f, H1) }];
    queue(f, oversizedItem);
    const rejected = publicarReferenciasFilaViva(f.workspace, oversizedItem, f.deps);
    assert.strictEqual(rejected.ok, false);
    assert.strictEqual(rejected.motivo, "gc_references_complexity_limit");
    assert.strictEqual((await build(f)).complete, false);
  } finally { await cleanup(f); }
}

async function main() {
  await testExistingQueueBootstrapsNaturally();
  await testStaleCrashAndWriterCatchUp();
  await testLegacyLightProjectionStaleRecoversOnQueueLoad();
  await testLegacyBuildingMigratesWithoutRestart();
  await testManyItemsRemainCompleteWithoutBudgetIncrease();
  console.log("AUTO_CLEAN_GC_REFERENCE_INDEX_PHASE141_TESTS_PASS");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
