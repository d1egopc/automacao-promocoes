"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { selecionarRoundRobin } = require("../modules/engine/auto-clean/workspace-rotation");
const { inventariarReferenciasVivas, REFERENCE_REASON } = require("../modules/engine/auto-clean/gc-reference-index");
const { executarGcRelaySeguro, runOnce, closeSession, CANDIDATE_AGE_MS, STATE_FILE, CLASSIFICACAO,
  classificarRender } = require("../modules/engine/auto-clean/gc-relay.service");

const H1 = "a".repeat(64);
const H2 = "b".repeat(64);
const H3 = "c".repeat(64);
const NOW = Date.parse("2026-09-22T12:00:00.000Z");

function fixture() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-gc-relay-"));
  const workspace = "user_gc_test";
  const clientDir = path.join(dataDir, "clientes", workspace);
  const renderDir = path.join(dataDir, "identidade-visual-ofertas", "clientes", workspace, "renderizados");
  fs.mkdirSync(clientDir, { recursive: true });
  fs.mkdirSync(renderDir, { recursive: true });
  return { dataDir, workspace, clientDir, renderDir };
}

function json(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
}

function render(f, hash, ageMs) {
  const file = path.join(f.renderDir, `${hash}.png`);
  fs.writeFileSync(file, "fixture");
  const when = new Date(NOW - ageMs);
  fs.utimesSync(file, when, when);
  return file;
}

function url(f, hash) {
  return `https://go.optimuspromo.com.br/identidade-visual-ofertas/public/clientes/${f.workspace}/renderizados/${hash}.png`;
}

async function cleanup(f) {
  await closeSession(`${f.dataDir}:${f.workspace}`);
  fs.rmSync(f.dataDir, { recursive: true, force: true });
}

async function run(f, extra = {}) {
  return runOnce({ dataDir: f.dataDir, nowMs: NOW, minIntervalMs: 0, maxEntries: 50, ...extra });
}

async function testRoundRobin() {
  const ids = Array.from({ length: 20 }, (_, index) => `user_${String(index + 1).padStart(2, "0")}`);
  let cursor = "";
  for (let round = 0; round < 4; round += 1) {
    const result = selecionarRoundRobin(ids, cursor, 5);
    assert.deepStrictEqual(result.selecionados, ids.slice(round * 5, round * 5 + 5));
    cursor = result.ultimo;
  }
  assert.deepStrictEqual(selecionarRoundRobin(ids, cursor, 5).selecionados, ids.slice(0, 5));
  assert.deepStrictEqual(selecionarRoundRobin(["a", "c", "d"], "b", 2).selecionados, ["c", "d"]);
  assert.strictEqual(classificarRender({ sources: new Set(["vitrine"]), ageMs: CANDIDATE_AGE_MS + 1,
    referenceComplete: true }), CLASSIFICACAO.VIVO_REFERENCIADO);
  assert.strictEqual(classificarRender({ ageMs: 1, referenceComplete: true }), CLASSIFICACAO.JOVEM);
  assert.strictEqual(classificarRender({ ageMs: CANDIDATE_AGE_MS + 1,
    referenceComplete: true }), CLASSIFICACAO.CANDIDATO_ORFAO);
  assert.strictEqual(classificarRender({ ageMs: CANDIDATE_AGE_MS + 1,
    referenceComplete: false }), CLASSIFICACAO.ERRO);
}

async function testYoungAndOrphan() {
  const f = fixture();
  try {
    const young = render(f, H1, 12 * 60 * 60 * 1000);
    const orphan = render(f, H2, CANDIDATE_AGE_MS + 1000);
    const result = await run(f);
    assert.strictEqual(result.young, 1);
    assert.strictEqual(result.candidates, 1);
    assert.strictEqual(result.dryRun, true);
    assert.ok(result.candidateBytes > 0);
    assert.ok(fs.existsSync(young) && fs.existsSync(orphan), "dry-run nao remove render");
    assert.ok(fs.existsSync(path.join(f.dataDir, STATE_FILE)), "cursor fica persistido");
  } finally { await cleanup(f); }
}

async function testVitrineAndShared() {
  const f = fixture();
  try {
    const file = render(f, H1, 60 * 60 * 60 * 1000);
    json(path.join(f.clientDir, "vitrine.json"), { ofertas: [
      { imagem: url(f, H1), ultimoEnvioEm: new Date(NOW - 50 * 60 * 60 * 1000).toISOString() },
      { imagem: url(f, H1), ultimoEnvioEm: new Date(NOW - 100 * 60 * 60 * 1000).toISOString() }
    ] });
    const result = await run(f);
    assert.strictEqual(result.live, 1, "uma referencia viva protege render compartilhado");
    assert.strictEqual(result.vitrineConflicts, 1, "vitrine 72h protege render acima de 36h");
    assert.strictEqual(result.candidates, 0);
    assert.ok(fs.existsSync(file));
  } finally { await cleanup(f); }
}

async function testHistoryManualSocial() {
  const f = fixture();
  try {
    render(f, H1, 4 * 24 * 60 * 60 * 1000);
    render(f, H2, 4 * 24 * 60 * 60 * 1000);
    render(f, H3, 4 * 24 * 60 * 60 * 1000);
    const day = new Date(NOW).toISOString().slice(0, 10);
    const historyFile = path.join(f.clientDir, "fila-historico-leve-incremental", `${day}.jsonl`);
    fs.mkdirSync(path.dirname(historyFile), { recursive: true });
    fs.writeFileSync(historyFile, JSON.stringify({ imagemRef: url(f, H1), detalheRef: { id: "1" } }) + "\n");
    json(path.join(f.clientDir, "manual_ofertas_v2.json"), [{ status: "agendada", imagem: url(f, H2) }]);
    json(path.join(f.clientDir, "social-agendamentos.json"), [{ status: "agendada", imagemUrl: url(f, H3) }]);
    const result = await run(f);
    assert.strictEqual(result.live, 3);
    assert.strictEqual(result.historyConflicts, 1);
    assert.strictEqual(result.candidates, 0);
  } finally { await cleanup(f); }
}

async function testBudgetAndContinuation() {
  const f = fixture();
  try {
    render(f, H1, CANDIDATE_AGE_MS + 1000);
    render(f, H2, CANDIDATE_AGE_MS + 1000);
    const first = await run(f, { maxEntries: 1 });
    const second = await run(f, { maxEntries: 1 });
    const third = await run(f, { maxEntries: 1 });
    assert.strictEqual(first.inspected, 1);
    assert.strictEqual(second.inspected, 1);
    assert.ok(third.directoryComplete);
    assert.strictEqual(first.candidates + second.candidates, 2);
    assert.ok(fs.existsSync(path.join(f.renderDir, `${H1}.png`)));
  } finally { await cleanup(f); }
}

async function testRelayWorkspaceRotationAndRestartCursor() {
  const f = fixture();
  const second = "user_gc_test_z";
  const secondDir = path.join(f.dataDir, "identidade-visual-ofertas", "clientes", second, "renderizados");
  try {
    render(f, H1, CANDIDATE_AGE_MS + 1000);
    render(f, H2, CANDIDATE_AGE_MS + 1000);
    fs.mkdirSync(secondDir, { recursive: true });
    fs.writeFileSync(path.join(secondDir, `${H3}.png`), "second");
    const first = await run(f, { maxEntries: 1 });
    assert.strictEqual(first.workspace, f.workspace);
    const next = await run(f, { maxEntries: 1 });
    assert.strictEqual(next.workspace, second);
    await closeSession(`${f.dataDir}:${f.workspace}`); // Simula perda do handle no restart.
    const resumed = await run(f, { maxEntries: 2 });
    assert.strictEqual(resumed.workspace, f.workspace);
    assert.strictEqual(resumed.replayed, 1);
    assert.strictEqual(resumed.inspected, 1);
    assert.strictEqual(resumed.candidates, 1);
  } finally {
    await closeSession(`${f.dataDir}:${second}`);
    await cleanup(f);
  }
}

async function testVitrineExpiredAndHistoryWindow() {
  const f = fixture();
  try {
    render(f, H1, 8 * 24 * 60 * 60 * 1000);
    json(path.join(f.clientDir, "vitrine.json"), { ofertas: [
      { imagem: url(f, H1), ultimoEnvioEm: new Date(NOW - 4 * 24 * 60 * 60 * 1000).toISOString() }
    ] });
    json(path.join(f.clientDir, "fila-historico.json"), [{
      item: { imagem: url(f, H1), status: "enviado", enviadoEm: new Date(NOW - 8 * 24 * 60 * 60 * 1000).toISOString() }
    }]);
    json(path.join(f.clientDir, "fila-projecao-leve.json"), {
      versao: 1, clienteId: f.workspace, geradoEm: new Date(NOW).toISOString(), itens: []
    });
    json(path.join(f.clientDir, "manual_ofertas_v2.json"), [{
      imagem: url(f, H1), status: "enviada", enviadoEm: new Date(NOW - 8 * 24 * 60 * 60 * 1000).toISOString()
    }]);
    const oldDay = new Date(NOW - 9 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const file = path.join(f.clientDir, "fila-historico-leve-incremental", `${oldDay}.jsonl`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ imagemRef: url(f, H1) }) + "\n");
    const result = await run(f);
    assert.strictEqual(result.candidates, 1, "referencias expiradas nao mantem arquivo vivo");
    assert.strictEqual(result.live, 0);
  } finally { await cleanup(f); }
}

async function testNoLogoNoSymlinkAndFailClosed() {
  const f = fixture();
  try {
    const logo = path.join(path.dirname(f.renderDir), "logos", `${H1}.png`);
    fs.mkdirSync(path.dirname(logo), { recursive: true });
    fs.writeFileSync(logo, "logo");
    render(f, H2, CANDIDATE_AGE_MS + 1000);
    json(path.join(f.clientDir, "fila.json"), [{ imagem: url(f, H2) }, { large: "x".repeat(2048) }]);
    const incomplete = await inventariarReferenciasVivas({
      dataDir: f.dataDir, workspaceId: f.workspace, nowMs: NOW, maxBytes: 100
    });
    assert.strictEqual(incomplete.complete, false);
    assert.strictEqual(incomplete.reasonCode, REFERENCE_REASON.FILE_TOO_LARGE);
    assert.strictEqual(incomplete.referenceFile, "fila.json");
    assert.ok(fs.existsSync(logo));
    // Mesmo um dirent simbolico forjado nao pode entrar em lstat/GC.
    const g = fixture();
    try {
      const base = fs.promises;
      const fake = Object.create(base);
      fake.opendir = async () => ({
        read: async () => ({ name: `${H1}.png`, isFile: () => false, isSymbolicLink: () => true }),
        close: async () => {}
      });
      const result = await run(g, { fsApi: fake, maxEntries: 1 });
      assert.strictEqual(result.candidates, 0);
      assert.strictEqual(result.errors, 1);
    } finally { await cleanup(g); }
  } finally { await cleanup(f); }
}

async function testReferenceReasonCodes() {
  const optional = fixture();
  try {
    const result = await inventariarReferenciasVivas({
      dataDir: optional.dataDir, workspaceId: optional.workspace, nowMs: NOW
    });
    assert.strictEqual(result.complete, true, "fontes opcionais ausentes nao tornam indice incompleto");
  } finally { await cleanup(optional); }

  const aggregate = fixture();
  try {
    json(path.join(aggregate.clientDir, "fila.json"), [{ value: "x".repeat(30) }]);
    json(path.join(aggregate.clientDir, "fila-viva.json"), [{ value: "y".repeat(30) }]);
    const result = await inventariarReferenciasVivas({
      dataDir: aggregate.dataDir, workspaceId: aggregate.workspace, nowMs: NOW, maxBytes: 70
    });
    assert.strictEqual(result.reasonCode, REFERENCE_REASON.BUDGET_EXCEEDED);
    assert.strictEqual(result.referenceFile, "fila-viva.json");
  } finally { await cleanup(aggregate); }

  const invalidJson = fixture();
  try {
    fs.writeFileSync(path.join(invalidJson.clientDir, "fila.json"), "{invalido");
    const result = await inventariarReferenciasVivas({
      dataDir: invalidJson.dataDir, workspaceId: invalidJson.workspace, nowMs: NOW
    });
    assert.strictEqual(result.reasonCode, REFERENCE_REASON.FILE_INVALID_JSON);
    assert.strictEqual(result.referenceFile, "fila.json");
  } finally { await cleanup(invalidJson); }

  const invalidJsonl = fixture();
  try {
    const day = new Date(NOW).toISOString().slice(0, 10);
    const file = path.join(invalidJsonl.clientDir, "fila-historico-leve-incremental", `${day}.jsonl`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "{invalido\n");
    const result = await inventariarReferenciasVivas({
      dataDir: invalidJsonl.dataDir, workspaceId: invalidJsonl.workspace, nowMs: NOW
    });
    assert.strictEqual(result.reasonCode, REFERENCE_REASON.JSONL_PARSE_ERROR);
    assert.strictEqual(result.referenceSource, "historico");
    assert.strictEqual(result.lineNumber, 1);
  } finally { await cleanup(invalidJsonl); }

  const unreadable = fixture();
  try {
    const target = path.join(unreadable.clientDir, "fila.json");
    json(target, []);
    const base = fs.promises;
    const denied = Object.create(base);
    denied.readFile = async (file, ...args) => {
      if (path.resolve(file) === path.resolve(target)) {
        const error = new Error("denied");
        error.code = "EACCES";
        throw error;
      }
      return base.readFile(file, ...args);
    };
    const result = await inventariarReferenciasVivas({
      dataDir: unreadable.dataDir, workspaceId: unreadable.workspace, nowMs: NOW, fsApi: denied
    });
    assert.strictEqual(result.reasonCode, REFERENCE_REASON.READ_ERROR);
    assert.strictEqual(result.referenceFile, "fila.json");
  } finally { await cleanup(unreadable); }

  const failClosed = fixture();
  try {
    const old = render(failClosed, H1, CANDIDATE_AGE_MS + 1000);
    fs.writeFileSync(path.join(failClosed.clientDir, "fila.json"), "{invalido");
    const result = await run(failClosed);
    assert.strictEqual(result.referenceReasonCode, "REFERENCE_COMPACT_SOURCE_MISSING");
    assert.strictEqual(result.candidates, 0);
    assert.ok(result.errors >= 2);
    assert.ok(fs.existsSync(old), "indice incompleto jamais remove nem candidata render antigo");
  } finally { await cleanup(failClosed); }
}

async function testIntervalAndSingleFlight() {
  const f = fixture();
  try {
    const first = await runOnce({ dataDir: f.dataDir, nowMs: NOW, maxEntries: 1 });
    assert.strictEqual(first.skipped, undefined);
    const throttled = await runOnce({ dataDir: f.dataDir, nowMs: NOW + 1000, maxEntries: 1 });
    assert.strictEqual(throttled.reason, "interval");

    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const base = fs.promises;
    const delayed = Object.create(base);
    delayed.readdir = async (...args) => { await gate; return base.readdir(...args); };
    const running = executarGcRelaySeguro({ dataDir: f.dataDir, nowMs: NOW + 20 * 60 * 1000,
      minIntervalMs: 0, fsApi: delayed, logger: { log() {} } });
    const concurrent = await executarGcRelaySeguro({ dataDir: f.dataDir, nowMs: NOW + 20 * 60 * 1000,
      minIntervalMs: 0, logger: { log() {} } });
    assert.strictEqual(concurrent.reason, "already_running");
    release();
    await running;
  } finally { await cleanup(f); }
}

async function main() {
  await testRoundRobin();
  await testYoungAndOrphan();
  await testVitrineAndShared();
  await testHistoryManualSocial();
  await testBudgetAndContinuation();
  await testRelayWorkspaceRotationAndRestartCursor();
  await testVitrineExpiredAndHistoryWindow();
  await testNoLogoNoSymlinkAndFailClosed();
  await testReferenceReasonCodes();
  await testIntervalAndSingleFlight();
  console.log("AUTO_CLEAN_GC_RELAY_PHASE1_TESTS_PASS");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
