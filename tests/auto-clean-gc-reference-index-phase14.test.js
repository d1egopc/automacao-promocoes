"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  buildOrLoadReferenceIndex, indexDir, CURRENT_FILE, BUILDING_FILE,
  DEFAULT_BUILD_BYTES, DEFAULT_BUILD_DURATION_MS, REASON
} = require("../modules/engine/auto-clean/gc-reference-index-builder");
const { inventariarReferenciasVivas } = require("../modules/engine/auto-clean/gc-reference-index");
const {
  FILA_GC_REFERENCES_ARQUIVO, projetarReferenciasFilaViva,
  publicarReferenciasFilaViva
} = require("../modules/fila/fila-gc-references");
const { escreverFilaViva } = require("../modules/fila/fila-operacional-v2");
const { runOnce, closeSession, CANDIDATE_AGE_MS } = require("../modules/engine/auto-clean/gc-relay.service");
const { projetarFilaV2Shadow } = require("../modules/fila/fila-v2-shadow");

const NOW = Date.parse("2026-09-22T12:00:00.000Z");
const H1 = "1".repeat(64);
const H2 = "2".repeat(64);
const H3 = "3".repeat(64);
const silent = { log() {} };

function fixture(name) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-gc-14-"));
  const clientDir = path.join(dataDir, "clientes", name);
  fs.mkdirSync(clientDir, { recursive: true });
  return { dataDir, clientDir, workspace: name };
}

function render(f, hash) {
  return `https://go.optimuspromo.com.br/identidade-visual-ofertas/public/clientes/${f.workspace}/renderizados/${hash}.png`;
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
  return file;
}

function queueFile(f) { return path.join(f.clientDir, "fila-viva.json"); }
function projectionFile(f) { return path.join(f.clientDir, FILA_GC_REFERENCES_ARQUIVO); }
function currentFile(f) { return path.join(indexDir(f.dataDir, f.workspace), CURRENT_FILE); }
function buildingFile(f) { return path.join(indexDir(f.dataDir, f.workspace), BUILDING_FILE); }
function readBuilding(f) { return JSON.parse(fs.readFileSync(buildingFile(f), "utf8")); }

function publish(f, entries) {
  writeJson(queueFile(f), entries);
  return writeJson(projectionFile(f), projetarReferenciasFilaViva(entries, f.workspace,
    fs.statSync(queueFile(f), { bigint: true })));
}

function build(f, extra = {}) {
  return buildOrLoadReferenceIndex({ dataDir: f.dataDir, workspaceId: f.workspace,
    nowMs: NOW, logger: silent, ...extra });
}

async function assertRelayFailsClosed(f, hash = H1) {
  const rendered = path.join(f.dataDir, "identidade-visual-ofertas", "clientes", f.workspace,
    "renderizados", `${hash}.png`);
  fs.mkdirSync(path.dirname(rendered), { recursive: true });
  fs.writeFileSync(rendered, "fixture");
  const old = new Date(NOW - CANDIDATE_AGE_MS - 1000);
  fs.utimesSync(rendered, old, old);
  const relay = await runOnce({ dataDir: f.dataDir, workspaceId: f.workspace,
    nowMs: NOW, minIntervalMs: 0, logger: silent });
  assert.strictEqual(relay.candidates, 0);
  assert.strictEqual(relay.candidateBytes, 0);
  assert.strictEqual(relay.dryRun, true);
  assert.ok(fs.existsSync(rendered), "fail-closed nao pode remover render");
}

async function cleanup(f) {
  await closeSession(`${f.dataDir}:${f.workspace}`);
  fs.rmSync(f.dataDir, { recursive: true, force: true });
}

async function testLargeQueueIsNeverRead() {
  const f = fixture("user_gc_large_viva");
  try {
    const entries = [{ item: { imagem: render(f, H1), metadata: { nested: render(f, H2) },
      padding: "x".repeat(21 * 1024 * 1024) } }];
    publish(f, entries);
    assert.ok(fs.statSync(queueFile(f)).size > 20 * 1024 * 1024);
    assert.ok(fs.statSync(projectionFile(f)).size < 1024,
      "projecao contem apenas hashes e watermark, sem payload comercial");
    const base = fs.promises;
    const observed = Object.create(base);
    let gcBytesRead = 0;
    const assertNotQueueRead = file => {
      assert.notStrictEqual(path.resolve(file), path.resolve(queueFile(f)),
        "GC nao pode ler fila-viva integralmente");
    };
    observed.readFile = async (file, ...args) => {
      assertNotQueueRead(file);
      const content = await base.readFile(file, ...args);
      gcBytesRead += Buffer.byteLength(content);
      return content;
    };
    observed.open = async (file, ...args) => {
      assertNotQueueRead(file);
      return base.open(file, ...args);
    };
    const result = await build(f, { fsApi: observed });
    assert.strictEqual(result.complete, true, JSON.stringify({ reasonCode: result.reasonCode, source: result.source }));
    assert.ok(result.refs.has(H1) && result.refs.has(H2), "inclusive refs aninhadas devem ser protegidas");
    assert.ok(result.bytesProcessed < 1024);
    assert.strictEqual(gcBytesRead, result.bytesProcessed);
    assert.ok(gcBytesRead <= DEFAULT_BUILD_BYTES);
    assert.ok(result.durationMs <= DEFAULT_BUILD_DURATION_MS);
    console.log("GC_REF_PROJECTION_SCALE", JSON.stringify({
      queueBytes: fs.statSync(queueFile(f)).size,
      items: entries.length,
      uniqueRefs: result.refs.size,
      projectionBytes: fs.statSync(projectionFile(f)).size,
      gcBytesRead,
      durationMs: result.durationMs
    }));
    assert.strictEqual(DEFAULT_BUILD_BYTES, 16 * 1024 * 1024);
    assert.strictEqual(DEFAULT_BUILD_DURATION_MS, 750);
  } finally { await cleanup(f); }
}

async function testMuchLargerQueueGuardIsMetadataOnly() {
  const f = fixture("user_gc_huge_guard");
  try {
    const entries = [{ item: { image: render(f, H1) } }];
    writeJson(queueFile(f), entries);
    const real = fs.statSync(queueFile(f), { bigint: true });
    const synthetic = {
      size: 512n * 1024n * 1024n,
      mtimeMs: real.mtimeMs,
      dev: real.dev,
      ino: real.ino,
      isFile: () => true,
      isSymbolicLink: () => false
    };
    writeJson(projectionFile(f), projetarReferenciasFilaViva(entries, f.workspace, synthetic));
    const base = fs.promises;
    const observed = Object.create(base);
    let gcBytesRead = 0;
    observed.lstat = async file => path.resolve(file) === path.resolve(queueFile(f))
      ? synthetic : base.lstat(file);
    observed.readFile = async (file, ...args) => {
      assert.notStrictEqual(path.resolve(file), path.resolve(queueFile(f)));
      const content = await base.readFile(file, ...args);
      gcBytesRead += Buffer.byteLength(content);
      return content;
    };
    observed.open = async (file, ...args) => {
      assert.notStrictEqual(path.resolve(file), path.resolve(queueFile(f)));
      return base.open(file, ...args);
    };
    const result = await build(f, { fsApi: observed });
    assert.strictEqual(result.complete, true);
    assert.ok(result.refs.has(H1));
    assert.ok(result.bytesProcessed < 1024);
    assert.ok(result.durationMs <= DEFAULT_BUILD_DURATION_MS);
    assert.strictEqual(gcBytesRead, result.bytesProcessed);
    assert.ok(gcBytesRead <= DEFAULT_BUILD_BYTES);
    console.log("GC_REF_PROJECTION_SCALE_SIMULATED", JSON.stringify({
      queueBytes: Number(synthetic.size),
      items: entries.length,
      uniqueRefs: result.refs.size,
      projectionBytes: fs.statSync(projectionFile(f)).size,
      gcBytesRead,
      durationMs: result.durationMs
    }));
  } finally { await cleanup(f); }
}

async function testProjectionMatchesLegacyCollector() {
  const f = fixture("user_gc_projection_differential");
  try {
    const entries = [
      { id: "offer-a", status: "pendente", imagemUsada: render(f, H1), thumbRef: render(f, H2),
        metadata: { thumbnailUrl: render(f, H3) } },
      { id: "offer-b", status: "processando", imagemFinal: render(f, H1),
        imagemOriginal: render(f, H2), imagemCanonicaFinal: render(f, H3) }
    ];
    publish(f, entries);
    const legacy = await inventariarReferenciasVivas({ dataDir: f.dataDir,
      workspaceId: f.workspace, nowMs: NOW, maxBytes: 1024 * 1024 });
    assert.strictEqual(legacy.complete, true);
    const indexed = await build(f);
    assert.strictEqual(indexed.complete, true);
    const expected = new Set([...legacy.refs.keys()]);
    assert.deepStrictEqual([...indexed.refs.keys()].sort(), [...expected].sort(),
      "a projection must preserve the old collector's complete queue reference set");
    for (const hash of [H1, H2, H3]) assert.ok(indexed.refs.get(hash)?.has("fila"));
  } finally { await cleanup(f); }
}

async function testProjectionAboveFourMegabytesFailsClosed() {
  const f = fixture("user_gc_projection_oversize");
  try {
    const hashes = Array.from({ length: 70000 }, (_, index) => index.toString(16).padStart(64, "0"));
    const entries = [{ images: hashes.map(hash => render(f, hash)) }];
    writeJson(queueFile(f), entries);
    writeJson(projectionFile(f), projetarReferenciasFilaViva(entries, f.workspace,
      fs.statSync(queueFile(f), { bigint: true })));
    assert.ok(fs.statSync(projectionFile(f)).size > 4 * 1024 * 1024);
    const result = await build(f);
    assert.strictEqual(result.complete, false);
    assert.strictEqual(result.reasonCode, REASON.COMPACT_SOURCE_TOO_LARGE);
    assert.ok(!fs.existsSync(currentFile(f)), "oversized projection must not promote current.json");
    await assertRelayFailsClosed(f);
    console.log("GC_REF_PROJECTION_OVERSIZE", JSON.stringify({
      items: entries.length,
      uniqueRefs: hashes.length,
      projectionBytes: fs.statSync(projectionFile(f)).size,
      limitBytes: 4 * 1024 * 1024,
      complete: result.complete,
      reasonCode: result.reasonCode
    }));
  } finally { await cleanup(f); }
}

async function testStaleMissingCorruptAndPartialFailClosed() {
  for (const mode of ["missing", "corrupt", "partial", "tampered", "wrong-version", "stale"]) {
    const f = fixture(`user_gc_${mode}`);
    try {
      const entries = [{ item: { imagem: render(f, H1) } }];
      writeJson(queueFile(f), entries);
      if (mode === "corrupt") fs.writeFileSync(projectionFile(f), "{invalid");
      if (mode === "partial") writeJson(projectionFile(f), { versao: 1, clienteId: f.workspace, hashes: [H1] });
      if (mode === "tampered") {
        publish(f, entries);
        const documento = JSON.parse(fs.readFileSync(projectionFile(f), "utf8"));
        documento.hashes = [];
        documento.totalRefs = 0;
        writeJson(projectionFile(f), documento);
      }
      if (mode === "wrong-version") {
        const documento = projetarReferenciasFilaViva(entries, f.workspace,
          fs.statSync(queueFile(f), { bigint: true }));
        documento.versao += 1;
        writeJson(projectionFile(f), documento);
      }
      if (mode === "stale") {
        publish(f, entries);
        writeJson(queueFile(f), [{ item: { imagem: render(f, H2), changedDuringWrite: "new queue state" } }]);
        writeJson(`${projectionFile(f)}.tmp.interrupted`, "partial next projection");
      }
      const result = await build(f);
      assert.strictEqual(result.complete, false, `${mode} nunca pode virar COMPLETE`);
      assert.ok(!fs.existsSync(currentFile(f)));
      assert.strictEqual(result.reasonCode,
        mode === "missing" ? REASON.COMPACT_SOURCE_MISSING :
          mode === "corrupt" ? REASON.SOURCE_INVALID_JSON : REASON.COMPACT_SOURCE_STALE);
      await assertRelayFailsClosed(f);
    } finally { await cleanup(f); }
  }
}

async function testSameSizeAndMtimeReplacementFailsIdentityWatermark() {
  const f = fixture("user_gc_identity_replaced");
  try {
    const oldEntries = [{ status: "pendente", imagemRef: render(f, H1) }];
    publish(f, oldEntries);
    const original = fs.statSync(queueFile(f), { bigint: true });
    const replacement = [{ status: "pendente", imagemRef: render(f, H2) }];
    const temporary = `${queueFile(f)}.replacement`;
    const backup = `${queueFile(f)}.old`;
    writeJson(temporary, replacement);
    assert.strictEqual(fs.statSync(temporary).size, Number(original.size));
    fs.utimesSync(temporary, new Date(Number(original.mtimeMs)), new Date(Number(original.mtimeMs)));
    fs.renameSync(queueFile(f), backup);
    fs.renameSync(temporary, queueFile(f));
    const timestamp = new Date(Number(original.mtimeMs));
    fs.utimesSync(queueFile(f), timestamp, timestamp);
    const replacementStat = fs.statSync(queueFile(f), { bigint: true });
    assert.strictEqual(replacementStat.size, original.size);
    assert.strictEqual(Math.trunc(Number(replacementStat.mtimeMs)), Math.trunc(Number(original.mtimeMs)));
    assert.notStrictEqual(replacementStat.ino, original.ino);
    const result = await build(f);
    assert.strictEqual(result.complete, false);
    assert.strictEqual(result.reasonCode, REASON.COMPACT_SOURCE_STALE);
    assert.ok(!fs.existsSync(currentFile(f)));
    await assertRelayFailsClosed(f);
  } finally { await cleanup(f); }
}

async function testCatchUpRemovalAndSharedRender() {
  const f = fixture("user_gc_shared");
  try {
    publish(f, [{ item: { imagem: render(f, H1), extra: render(f, H2) } },
      { item: { imagem: render(f, H1) } }]);
    writeJson(path.join(f.clientDir, "vitrine.json"), {
      ofertas: [{ imagem: render(f, H1), ultimoEnvioEm: new Date(NOW).toISOString() }]
    });
    const first = await build(f);
    assert.strictEqual(first.complete, true, JSON.stringify({ reasonCode: first.reasonCode, source: first.source }));
    assert.deepStrictEqual([...first.refs.get(H1)].sort(), ["fila", "vitrine"]);

    writeJson(queueFile(f), [{ item: { imagem: render(f, H3) } }]);
    const stale = await build(f);
    assert.strictEqual(stale.complete, false);
    assert.strictEqual(stale.reasonCode, REASON.COMPACT_SOURCE_STALE);
    publish(f, [{ item: { imagem: render(f, H3) } }]);
    const ready = await build(f);
    assert.strictEqual(ready.complete, true);
    assert.ok(!ready.refs.has(H2), "contribuicao removida sai apenas apos projecao valida");
    assert.deepStrictEqual([...ready.refs.get(H1)], ["vitrine"], "outra fonte preserva render compartilhado");
    assert.ok(ready.refs.has(H3));
  } finally { await cleanup(f); }
}

async function testRestartActiveWorkspaceAndAppend() {
  const f = fixture("user_gc_resume14");
  try {
    publish(f, [{ item: { imagem: render(f, H1) } }]);
    const day = new Date(NOW).toISOString().slice(0, 10);
    const history = path.join(f.clientDir, "fila-historico-leve-incremental", `${day}.jsonl`);
    fs.mkdirSync(path.dirname(history), { recursive: true });
    const row = `${JSON.stringify({ imagemRef: render(f, H2) })}\n`;
    fs.writeFileSync(history, row.repeat(6));
    const perRound = fs.statSync(projectionFile(f)).size * 2 + Buffer.byteLength(row);
    let result = await build(f, { maxBytesPerRun: perRound });
    assert.strictEqual(result.complete, false);
    const first = readBuilding(f);
    assert.ok(first.sourceCursor > 0);
    fs.appendFileSync(history, row);
    publish(f, [{ item: { imagem: render(f, H1), second: render(f, H3) } }]);
    result = await build(f, { maxBytesPerRun: perRound });
    assert.strictEqual(result.generation, first.generation);
    const resumed = readBuilding(f);
    assert.ok(resumed.sourceCursor > first.sourceCursor);
    assert.ok(resumed.refs[H2], "append preserva a contribuicao ja lida do historico");
    for (let round = 0; round < 2 && !result.complete; round += 1) {
      fs.appendFileSync(history, row);
      publish(f, [{ item: { imagem: render(f, H1), second: render(f, H3) } }]);
      result = await build(f, { maxBytesPerRun: perRound });
      assert.strictEqual(result.generation, first.generation,
        "atividade ordinaria continua na mesma generation");
      assert.ok(result.bytesProcessed <= perRound);
    }
    for (let round = 0; round < 8 && !result.complete; round += 1) {
      result = await build(f, { maxBytesPerRun: perRound });
      assert.strictEqual(result.generation, first.generation);
      assert.ok(result.bytesProcessed <= perRound);
    }
    assert.strictEqual(result.complete, true);
    assert.ok(result.refs.has(H1) && result.refs.has(H2) && result.refs.has(H3));
  } finally { await cleanup(f); }
}

async function testProjectionPublisherAndDryRun() {
  const f = fixture("user_gc_publisher");
  try {
    const entries = [{ item: { imagem: render(f, H1), nested: render(f, H1) } }];
    writeJson(queueFile(f), entries);
    const writer = (workspace, name, data) => {
      assert.strictEqual(workspace, f.workspace);
      writeJson(path.join(f.clientDir, name), data);
      return true;
    };
    const published = publicarReferenciasFilaViva(f.workspace, entries, {
      getClienteJsonPath: (_, name) => path.join(f.clientDir, name),
      writeClienteJson: writer
    });
    assert.strictEqual(published.ok, true);
    assert.strictEqual(published.totalRefs, 1);
    const rendered = path.join(f.dataDir, "identidade-visual-ofertas", "clientes", f.workspace, "renderizados", `${H1}.png`);
    fs.mkdirSync(path.dirname(rendered), { recursive: true });
    fs.writeFileSync(rendered, "fixture");
    const old = new Date(NOW - CANDIDATE_AGE_MS - 1000);
    fs.utimesSync(rendered, old, old);
    const result = await runOnce({ dataDir: f.dataDir, workspaceId: f.workspace,
      nowMs: NOW, minIntervalMs: 0, logger: silent });
    assert.strictEqual(result.candidates, 0);
    assert.strictEqual(result.dryRun, true);
    assert.ok(fs.existsSync(rendered));
  } finally { await cleanup(f); }
}

async function testOperationalWriterPublishesProjection() {
  const f = fixture("user_gc_operational_writer");
  try {
    const writer = (workspace, name, value) => {
      assert.strictEqual(workspace, f.workspace);
      writeJson(path.join(f.clientDir, name), value);
      return true;
    };
    const result = escreverFilaViva(f.workspace, [{ id: "offer-1", clienteId: f.workspace,
      status: "pendente", imagem: render(f, H1), criadoEm: new Date(NOW).toISOString() }], {
      agora: NOW,
      getClienteJsonPath: (_, name) => path.join(f.clientDir, name),
      writeClienteJson: writer
    });
    assert.strictEqual(result.ok, true);
    assert.ok(fs.existsSync(projectionFile(f)));
    const indexed = await build(f);
    assert.strictEqual(indexed.complete, true);
    assert.ok(indexed.refs.get(H1)?.has("fila"));
  } finally { await cleanup(f); }
}

async function testMissingFileIdentityFailsClosed() {
  const f = fixture("user_gc_no_inode");
  try {
    const entries = [{ image: render(f, H1) }];
    writeJson(queueFile(f), entries);
    const stat = fs.statSync(queueFile(f), { bigint: true });
    const withoutIdentity = { size: stat.size, mtimeMs: stat.mtimeMs, dev: stat.dev, ino: 0n };
    writeJson(projectionFile(f), projetarReferenciasFilaViva(entries, f.workspace, withoutIdentity));
    const indexed = await build(f);
    assert.strictEqual(indexed.complete, false);
    assert.strictEqual(indexed.reasonCode, REASON.COMPACT_SOURCE_STALE);
    const published = publicarReferenciasFilaViva(f.workspace, entries, {
      getClienteJsonPath: (_, name) => path.join(f.clientDir, name),
      writeClienteJson: (workspace, name, value) => writeJson(path.join(f.clientDir, name), value),
      fs: { lstatSync: () => ({ size: stat.size, mtimeMs: stat.mtimeMs, dev: stat.dev,
        ino: 0n, isFile: () => true, isSymbolicLink: () => false }) }
    });
    assert.strictEqual(published.ok, false);
    assert.strictEqual(published.motivo, "gc_references_identity_unavailable");
  } finally { await cleanup(f); }
}

async function testShadowWriterPublishesMatchingProjection() {
  const f = fixture("user_gc_shadow_writer");
  try {
    const result = projetarFilaV2Shadow({
      clienteId: f.workspace,
      fila: [{ id: "offer-1", clienteId: f.workspace, status: "pendente",
        imagem: render(f, H1), metadata: { outraImagem: render(f, H2) } }],
      agora: NOW,
      getClienteJsonPath: (_, name) => path.join(f.clientDir, name),
      writeClienteJson: (_, name, value) => writeJson(path.join(f.clientDir, name), value),
      logger: silent
    });
    assert.strictEqual(result.ok, true);
    assert.ok(fs.existsSync(projectionFile(f)));
    const indexed = await build(f);
    assert.strictEqual(indexed.complete, true);
    assert.ok(indexed.refs.has(H1) && indexed.refs.has(H2));
  } finally { await cleanup(f); }
}

async function testNoPhysicalDelete() {
  for (const relative of [
    "../modules/fila/fila-gc-references.js",
    "../modules/engine/auto-clean/gc-reference-index-builder.js",
    "../modules/engine/auto-clean/gc-relay.service.js"
  ]) {
    const source = fs.readFileSync(path.join(__dirname, relative), "utf8");
    assert.ok(!/\b(?:unlink|unlinkSync|rm|rmSync|rmdir|truncate|deleteFile)\s*\(/.test(source));
  }
}

async function main() {
  await testLargeQueueIsNeverRead();
  await testMuchLargerQueueGuardIsMetadataOnly();
  await testProjectionMatchesLegacyCollector();
  await testProjectionAboveFourMegabytesFailsClosed();
  await testSameSizeAndMtimeReplacementFailsIdentityWatermark();
  await testStaleMissingCorruptAndPartialFailClosed();
  await testCatchUpRemovalAndSharedRender();
  await testRestartActiveWorkspaceAndAppend();
  await testProjectionPublisherAndDryRun();
  await testOperationalWriterPublishesProjection();
  await testMissingFileIdentityFailsClosed();
  await testShadowWriterPublishesMatchingProjection();
  await testNoPhysicalDelete();
  console.log("AUTO_CLEAN_GC_REFERENCE_INDEX_PHASE14_TESTS_PASS");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
