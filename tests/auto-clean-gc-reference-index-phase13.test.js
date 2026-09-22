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
  REASON
} = require("../modules/engine/auto-clean/gc-reference-index-builder");

const NOW = Date.parse("2026-09-22T12:00:00.000Z");
const H1 = "1".repeat(64);
const H2 = "2".repeat(64);
const H3 = "3".repeat(64);
const H4 = "4".repeat(64);
const silent = { log() {} };

function fixture(workspace = "user_gc_phase13") {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-gc-index-13-"));
  const clientDir = path.join(dataDir, "clientes", workspace);
  fs.mkdirSync(clientDir, { recursive: true });
  return { dataDir, workspace, clientDir };
}

function renderUrl(f, hash) {
  return `https://go.optimuspromo.com.br/identidade-visual-ofertas/public/clientes/${f.workspace}/renderizados/${hash}.png`;
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
  return file;
}

function writeProjection(f, hash = H1, revision = 0) {
  const file = writeJson(path.join(f.clientDir, "fila-projecao-leve.json"), {
    versao: 1,
    clienteId: f.workspace,
    geradoEm: new Date(NOW + revision).toISOString(),
    total: hash ? 1 : 0,
    itens: hash ? [{ statusOperacional: "pendente", imagemRef: renderUrl(f, hash) }] : []
  });
  fs.utimesSync(file, new Date(Date.now() + revision + 1000), new Date(Date.now() + revision + 1000));
  return file;
}

function historyFile(f) {
  const day = new Date(NOW).toISOString().slice(0, 10);
  return path.join(f.clientDir, "fila-historico-leve-incremental", `${day}.jsonl`);
}

function line(f, hash) {
  return `${JSON.stringify({ imagemRef: renderUrl(f, hash) })}\n`;
}

function building(f) {
  return JSON.parse(fs.readFileSync(path.join(indexDir(f.dataDir, f.workspace), BUILDING_FILE), "utf8"));
}

function currentExists(f) {
  return fs.existsSync(path.join(indexDir(f.dataDir, f.workspace), CURRENT_FILE));
}

function build(f, extra = {}) {
  return buildOrLoadReferenceIndex({
    dataDir: f.dataDir,
    workspaceId: f.workspace,
    nowMs: NOW,
    logger: silent,
    ...extra
  });
}

function cleanup(f) {
  fs.rmSync(f.dataDir, { recursive: true, force: true });
}

async function testJsonlAppendResumesSameGeneration() {
  const f = fixture("user_gc_append");
  try {
    const file = historyFile(f);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const l1 = line(f, H1);
    const l2 = line(f, H2);
    fs.writeFileSync(file, l1 + l2);

    const first = await build(f, { maxBytesPerRun: Buffer.byteLength(l1) });
    assert.strictEqual(first.complete, false);
    const checkpoint1 = building(f);
    const generation = checkpoint1.generation;
    const cursor = checkpoint1.sourceCursor;
    const refs = Object.keys(checkpoint1.refs).length;
    assert.strictEqual(cursor, Buffer.byteLength(l1));

    fs.appendFileSync(file, line(f, H3));
    const second = await build(f, { maxBytesPerRun: Buffer.byteLength(l2) });
    assert.strictEqual(second.complete, false);
    const checkpoint2 = building(f);
    assert.strictEqual(checkpoint2.generation, generation, "append normal nao troca generation");
    assert.ok(checkpoint2.sourceCursor > cursor, "cursor precisa continuar do checkpoint anterior");
    assert.ok(Object.keys(checkpoint2.refs).length >= refs, "append nao descarta refs acumuladas");
    assert.ok(!currentExists(f), "indice parcial permanece fail-closed");
  } finally { cleanup(f); }
}

async function testJsonlTruncateInvalidatesGeneration() {
  const f = fixture("user_gc_truncate");
  try {
    const file = historyFile(f);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const l1 = line(f, H1);
    fs.writeFileSync(file, l1 + line(f, H2));
    await build(f, { maxBytesPerRun: Buffer.byteLength(l1) });
    const before = building(f);

    fs.writeFileSync(file, "");
    const result = await build(f, { maxBytesPerRun: Buffer.byteLength(l1) });
    const after = building(f);
    assert.strictEqual(result.complete, false);
    assert.strictEqual(result.reasonCode, REASON.SOURCE_CHANGED);
    assert.notStrictEqual(after.generation, before.generation, "truncate perigoso invalida a generation");
    assert.strictEqual(Object.keys(after.refs).length, 0);
    assert.ok(!currentExists(f));
  } finally { cleanup(f); }
}

async function testJsonlReplaceInvalidatesGeneration() {
  const f = fixture("user_gc_replace");
  try {
    const file = historyFile(f);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const l1 = line(f, H1);
    fs.writeFileSync(file, l1 + line(f, H2));
    await build(f, { maxBytesPerRun: Buffer.byteLength(l1) });
    const before = building(f);

    const replacement = `${file}.replacement`;
    fs.writeFileSync(replacement, line(f, H3) + line(f, H4));
    fs.renameSync(replacement, file);
    const result = await build(f, { maxBytesPerRun: Buffer.byteLength(l1) });
    const after = building(f);
    assert.strictEqual(result.complete, false);
    assert.strictEqual(result.reasonCode, REASON.SOURCE_CHANGED);
    assert.notStrictEqual(after.generation, before.generation,
      "replace perigoso invalida a generation mesmo sem reduzir o tamanho");
    assert.strictEqual(Object.keys(after.refs).length, 0);
    assert.ok(!currentExists(f));
  } finally { cleanup(f); }
}

async function testCompactChangeReplacesOnlyItsContribution() {
  const f = fixture("user_gc_compact");
  try {
    writeProjection(f, H1, 1);
    writeJson(path.join(f.clientDir, "vitrine.json"), {
      ofertas: [{ imagem: renderUrl(f, H2), ultimoEnvioEm: new Date(NOW).toISOString() }]
    });
    const initial = await build(f);
    assert.strictEqual(initial.complete, true);
    const updateGeneration = building(f).generation;

    writeProjection(f, H3, 20);
    const updated = await build(f);
    assert.strictEqual(updated.complete, true);
    assert.strictEqual(updated.generation, updateGeneration, "fonte mutavel usa generation de atualizacao existente");
    assert.ok(updated.refs.has(H3));
    assert.ok(updated.refs.has(H2), "ref independente da vitrine deve sobreviver");
    assert.ok(!updated.refs.has(H1), "contribuicao antiga da projecao deve ser substituida");
  } finally { cleanup(f); }
}

async function testProjectionStaleFailsClosedThenSameGenerationContinues() {
  const f = fixture("user_gc_stale");
  try {
    const guard = writeJson(path.join(f.clientDir, "fila.json"), []);
    const projection = writeProjection(f, H1, 1);
    const history = historyFile(f);
    fs.mkdirSync(path.dirname(history), { recursive: true });
    const l1 = line(f, H2);
    fs.writeFileSync(history, l1 + line(f, H3));
    const firstBudget = fs.statSync(projection).size + Buffer.byteLength(l1);
    await build(f, { maxBytesPerRun: firstBudget });
    const checkpoint = building(f);

    fs.appendFileSync(guard, " ");
    fs.utimesSync(guard, new Date(Date.now() + 5000), new Date(Date.now() + 5000));
    const stale = await build(f);
    assert.strictEqual(stale.complete, false);
    assert.strictEqual(stale.reasonCode, REASON.COMPACT_SOURCE_STALE);
    assert.strictEqual(stale.generation, checkpoint.generation);
    assert.ok(!currentExists(f));

    writeProjection(f, H1, 7000);
    let result;
    for (let round = 0; round < 4; round += 1) {
      result = await build(f);
      if (result.complete) break;
      assert.strictEqual(building(f).generation, checkpoint.generation,
        "catch-up da projecao nao reinicia todo bootstrap");
    }
    assert.strictEqual(result.complete, true, "projecao atualizada deve liberar a continuacao segura");
    assert.strictEqual(result.generation, checkpoint.generation);
    assert.ok(result.refs.has(H1) && result.refs.has(H2) && result.refs.has(H3));
  } finally { cleanup(f); }
}

async function testSourceAddedDuringBootstrapNeverOrphansRender() {
  const f = fixture("user_gc_new_source");
  try {
    const projection = writeProjection(f, H1, 1);
    const history = historyFile(f);
    fs.mkdirSync(path.dirname(history), { recursive: true });
    fs.writeFileSync(history, line(f, H2) + line(f, H3));
    const first = await build(f, { maxBytesPerRun: fs.statSync(projection).size });
    assert.strictEqual(first.complete, false);
    assert.ok(!currentExists(f), "bootstrap parcial nao pode promover current");

    writeJson(path.join(f.clientDir, "vitrine.json"), {
      ofertas: [{ imagem: renderUrl(f, H4), ultimoEnvioEm: new Date(NOW).toISOString() }]
    });
    const result = await build(f, { maxBytesPerRun: 1024 * 1024 });
    assert.strictEqual(result.complete, true, "fonte nova deve ser processada antes de READY");
    assert.ok(result.refs.has(H4), "fonte criada durante bootstrap nao pode virar falso orfao");
    assert.ok(currentExists(f));
  } finally { cleanup(f); }
}

async function testActiveWorkspaceConverges() {
  const f = fixture("user_gc_active");
  try {
    let projection = writeProjection(f, H1, 1);
    const history = historyFile(f);
    fs.mkdirSync(path.dirname(history), { recursive: true });
    const rows = [line(f, H1), line(f, H2), line(f, H3), line(f, H4)];
    fs.writeFileSync(history, rows.join(""));
    const perRound = fs.statSync(projection).size + Buffer.byteLength(rows[0]) * 2;
    let result = await build(f, { maxBytesPerRun: perRound });
    assert.strictEqual(result.complete, false);
    const generation = building(f).generation;

    for (let round = 1; round <= 3 && !result.complete; round += 1) {
      fs.appendFileSync(history, line(f, round % 2 ? H1 : H2));
      projection = writeProjection(f, round % 2 ? H3 : H4, round * 100);
      result = await build(f, { maxBytesPerRun: perRound });
      assert.strictEqual(result.generation, generation,
        "atividade ordinaria deve preservar a generation durante o catch-up");
      if (!result.complete) assert.strictEqual(building(f).generation, generation);
    }
    for (let round = 0; round < 4 && !result.complete; round += 1) {
      result = await build(f, { maxBytesPerRun: perRound });
      assert.strictEqual(result.generation, generation);
      if (!result.complete) assert.strictEqual(building(f).generation, generation);
    }
    assert.strictEqual(result.complete, true, "workspace ativo precisa convergir sem congelar desde a rodada inicial");
    assert.strictEqual(result.generation, generation);
    assert.ok(currentExists(f));
    assert.ok(result.bytesProcessed <= perRound, "budget por rodada deve permanecer respeitado");
  } finally { cleanup(f); }
}

async function testRestartResumesAndSharedRenderSurvives() {
  const f = fixture("user_gc_restart");
  try {
    writeProjection(f, H1, 1);
    writeJson(path.join(f.clientDir, "vitrine.json"), {
      ofertas: [{ imagem: renderUrl(f, H1), ultimoEnvioEm: new Date(NOW).toISOString() }]
    });
    const history = historyFile(f);
    fs.mkdirSync(path.dirname(history), { recursive: true });
    const l1 = line(f, H2);
    fs.writeFileSync(history, l1 + line(f, H3));
    const budget = fs.statSync(path.join(f.clientDir, "fila-projecao-leve.json")).size +
      fs.statSync(path.join(f.clientDir, "vitrine.json")).size + Buffer.byteLength(l1);
    await build(f, { maxBytesPerRun: budget });
    const before = building(f);
    const resumed = await build(f, { maxBytesPerRun: budget });
    assert.strictEqual(resumed.generation, before.generation, "novo processo logico retoma building persistido");

    writeProjection(f, "", 200);
    let final = await build(f, { maxBytesPerRun: budget });
    for (let round = 0; round < 4 && !final.complete; round += 1) final = await build(f, { maxBytesPerRun: budget });
    assert.strictEqual(final.complete, true);
    assert.ok(final.refs.has(H1), "render compartilhado continua vivo pela vitrine");
    assert.deepStrictEqual([...final.refs.get(H1)], ["vitrine"]);
  } finally { cleanup(f); }
}

async function testNoDeletionPrimitive() {
  const files = [
    "../modules/engine/auto-clean/gc-reference-index-builder.js",
    "../modules/engine/auto-clean/gc-relay.service.js"
  ];
  const forbidden = /\b(?:unlink|unlinkSync|rmSync|rmdir|truncate|deleteFile)\s*\(/;
  for (const relative of files) {
    assert.ok(!forbidden.test(fs.readFileSync(path.join(__dirname, relative), "utf8")),
      `${relative} nao pode ganhar exclusao fisica`);
  }
}

async function main() {
  await testJsonlAppendResumesSameGeneration();
  await testJsonlTruncateInvalidatesGeneration();
  await testJsonlReplaceInvalidatesGeneration();
  await testCompactChangeReplacesOnlyItsContribution();
  await testProjectionStaleFailsClosedThenSameGenerationContinues();
  await testSourceAddedDuringBootstrapNeverOrphansRender();
  await testActiveWorkspaceConverges();
  await testRestartResumesAndSharedRenderSurvives();
  await testNoDeletionPrimitive();
  console.log("AUTO_CLEAN_GC_REFERENCE_INDEX_PHASE13_TESTS_PASS");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
