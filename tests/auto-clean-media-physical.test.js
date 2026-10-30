"use strict";

process.env.OPTIMUS_AUTO_CLEAN_MEDIA_DELETE_RELEASE = "approved"; // temporary fixture only
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { runMediaPhysical, runMediaPhysicalBatch, RETENTION_MS, OBSERVATION_DELAY_MS, MAX_DELETE_PER_RUN } =
  require("../modules/engine/auto-clean/gc-media-physical.service");
const { referenciasSocialPostgres } = require("../modules/engine/auto-clean/gc-social-reference-index");
const { chavesMidiaSocialEmValor } = require("../modules/engine/auto-clean/gc-reference-index");
const { inventariarReferenciasVivas } = require("../modules/engine/auto-clean/gc-reference-index");

const NOW = Date.parse("2026-10-21T18:00:00.000Z");
const OLD = new Date(NOW - RETENTION_MS - 60_000);

function fixture() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-media-gc-"));
  const workspace = "user_a";
  const identity = path.join(dataDir, "identidade-visual-ofertas", "clientes", workspace, "renderizados");
  const social = path.join(dataDir, "social", "midia", "publica", "engine");
  const clients = path.join(dataDir, "clientes", workspace);
  fs.mkdirSync(identity, { recursive: true }); fs.mkdirSync(social, { recursive: true });
  fs.mkdirSync(clients, { recursive: true });
  return { dataDir, workspace, identity, social };
}

function file(dir, name, old = true) {
  const target = path.join(dir, name); fs.writeFileSync(target, Buffer.alloc(16));
  if (old) fs.utimesSync(target, OLD, OLD);
  return target;
}

function loader(refs = new Map(), complete = true) {
  return async () => ({ complete, refs, generation: "test", reasonCode: complete ? "" : "incomplete" });
}

async function run(f, nowMs, extra = {}) {
  return runMediaPhysical({ dataDir: f.dataDir, nowMs, maxScan: 50, maxDelete: 32,
    referenceLoader: loader(), ...extra });
}

async function testIdentityProtectionExpiryAndGate() {
  const f = fixture(); const hashLive = "a".repeat(64); const hashOrphan = "b".repeat(64);
  try {
    const live = file(f.identity, `${hashLive}.png`); const orphan = file(f.identity, `${hashOrphan}.png`);
    const young = file(f.identity, `${"c".repeat(64)}.png`, false);
    const refs = new Map([[hashLive, new Set(["fila"])]]);
    const first = await run(f, NOW, { referenceLoader: loader(refs) });
    assert.strictEqual(first.dryRun, true); assert.strictEqual(first.referenced, 1);
    assert.strictEqual(first.candidates, 1); assert.strictEqual(first.young, 1);
    const gated = await run(f, NOW + OBSERVATION_DELAY_MS + 1,
      { execute: true, mediaDeleteEnabled: false, referenceLoader: loader(refs) });
    assert.strictEqual(gated.dryRun, true); assert.ok(fs.existsSync(orphan));
    const deleted = await run(f, NOW + 2 * OBSERVATION_DELAY_MS + 2,
      { execute: true, mediaDeleteEnabled: true, referenceLoader: loader(refs) });
    assert.strictEqual(deleted.removed, 1); assert.strictEqual(deleted.bytesFreed, 16);
    assert.ok(!fs.existsSync(orphan)); assert.ok(fs.existsSync(live)); assert.ok(fs.existsSync(young));
    const repeat = await run(f, NOW + 3 * OBSERVATION_DELAY_MS + 3,
      { execute: true, mediaDeleteEnabled: true, referenceLoader: loader(refs) });
    assert.strictEqual(repeat.removed, 0, "idempotencia");
  } finally { fs.rmSync(f.dataDir, { recursive: true, force: true }); }
}

async function testConcurrentReferenceAndRewriteFailClosed() {
  const f = fixture(); const hash = "d".repeat(64); const target = file(f.identity, `${hash}.png`);
  try {
    await run(f, NOW);
    let refs = new Map();
    const referenceLoader = async () => ({ complete: true, refs, generation: "g" });
    const protectedResult = await run(f, NOW + OBSERVATION_DELAY_MS + 1, {
      execute: true, mediaDeleteEnabled: true, referenceLoader,
      beforeRevalidate: async () => { refs = new Map([[hash, new Set(["programacao_futura"])]]); }
    });
    assert.strictEqual(protectedResult.removed, 0); assert.ok(fs.existsSync(target));

    refs = new Map();
    await run(f, NOW + 2 * OBSERVATION_DELAY_MS + 2, { referenceLoader });
    const rewritten = await run(f, NOW + 3 * OBSERVATION_DELAY_MS + 3, {
      execute: true, mediaDeleteEnabled: true, referenceLoader,
      beforeRevalidate: async () => { fs.appendFileSync(target, "new"); }
    });
    assert.strictEqual(rewritten.removed, 0); assert.ok(fs.existsSync(target), "arquivo recriado fica protegido");
  } finally { fs.rmSync(f.dataDir, { recursive: true, force: true }); }
}

async function testSocialMultiworkspaceAndIncomplete() {
  const f = fixture();
  try {
    const socialName = "radar_evento_abcdef123456789012345678.jpg";
    const social = file(f.social, socialName);
    // First run targets identity; second reaches social:engine.
    await run(f, NOW);
    const firstSocial = await run(f, NOW + 1, { referenceLoader: loader() });
    assert.strictEqual(firstSocial.kind, "social"); assert.strictEqual(firstSocial.candidates, 1);
    await run(f, NOW + OBSERVATION_DELAY_MS + 2);
    const incomplete = await run(f, NOW + OBSERVATION_DELAY_MS + 3, {
      execute: true, mediaDeleteEnabled: true, referenceLoader: loader(new Map(), false)
    });
    assert.strictEqual(incomplete.referenceComplete, false); assert.ok(fs.existsSync(social));
    assert.ok(chavesMidiaSocialEmValor(`https://go.test/social/midia/publica/engine/${socialName}`).includes(
      `social:engine/${socialName}`));
  } finally { fs.rmSync(f.dataDir, { recursive: true, force: true }); }
}

async function testPostgresReferenceContract() {
  let observed;
  const result = await referenciasSocialPostgres({ bucket: "engine", query: async (sql, params, options) => {
    observed = { sql, params, options };
    return { ok: true, resultado: { rows: [{ nome: "radar_a.jpg" }] } };
  } });
  assert.strictEqual(result.complete, true);
  assert.ok(result.refs.has("social:engine/radar_a.jpg"));
  assert.ok(observed.sql.includes("engine_ofertas") && observed.sql.includes("engine_jobs_cliente") &&
    observed.sql.includes("engine_eventos_brutos"));
  assert.ok(observed.params[0].includes("enviado")); assert.strictEqual(observed.options.timeoutSqlMs, 45000);
  const failed = await referenciasSocialPostgres({ bucket: "engine", query: async () => ({ ok: false, motivo: "timeout" }) });
  assert.strictEqual(failed.complete, false); assert.strictEqual(failed.refs.size, 0);
}

async function testStaleIndexFailsClosed() {
  const f = fixture();
  try {
    const target = file(f.identity, `${"f".repeat(64)}.png`);
    const stale = async () => ({ complete: false, refs: new Map(),
      reasonCode: "REFERENCE_INDEX_STALE" });
    const first = await run(f, NOW, { referenceLoader: stale });
    assert.strictEqual(first.referenceComplete, false);
    assert.strictEqual(first.referenceReasonCode, "REFERENCE_INDEX_STALE");
    const attempted = await run(f, NOW + OBSERVATION_DELAY_MS + 1, {
      execute: true, mediaDeleteEnabled: true, referenceLoader: stale
    });
    assert.strictEqual(attempted.removed, 0);
    assert.strictEqual(attempted.errors, 0);
    assert.strictEqual(attempted.blocked, 1);
    assert.ok(fs.existsSync(target), "indice stale deve bloquear exclusao");
  } finally { fs.rmSync(f.dataDir, { recursive: true, force: true }); }
}

async function testFutureSocialReferenceAndWorkspaceIsolation() {
  const f = fixture();
  try {
    const name = "publicacao_futura_abcdef123456789012345678.jpg";
    fs.writeFileSync(path.join(f.dataDir, "clientes", f.workspace, "social-agendamentos.json"),
      JSON.stringify([{ ativo: true, executarEm: "2026-11-01T12:00:00.000Z",
        imagemUrl: `https://go.optimus.test/social/midia/publica/${f.workspace}/${name}` }]));
    const index = await inventariarReferenciasVivas({ dataDir: f.dataDir, workspaceId: f.workspace, nowMs: NOW });
    assert.strictEqual(index.complete, true);
    assert.ok(index.refs.has(`social:${f.workspace}/${name}`), "programacao futura protege a midia social");

    const other = "user_b";
    const otherDir = path.join(f.dataDir, "identidade-visual-ofertas", "clientes", other, "renderizados");
    fs.mkdirSync(path.join(f.dataDir, "clientes", other), { recursive: true });
    fs.mkdirSync(otherDir, { recursive: true });
    const otherFile = file(otherDir, `${"e".repeat(64)}.png`);
    const first = await runMediaPhysical({ dataDir: f.dataDir, nowMs: NOW, maxScan: 50,
      referenceLoader: loader() });
    assert.strictEqual(first.workspace, f.workspace);
    assert.ok(fs.existsSync(otherFile), "um workspace nao sofre mutacao durante o lote de outro");
  } finally { fs.rmSync(f.dataDir, { recursive: true, force: true }); }
}

async function testBatchLimit() {
  const f = fixture();
  try {
    for (let i = 0; i < MAX_DELETE_PER_RUN + 5; i++) file(f.identity, `${i.toString(16).padStart(64, "0")}.png`);
    await run(f, NOW);
    const result = await run(f, NOW + OBSERVATION_DELAY_MS + 1,
      { execute: true, mediaDeleteEnabled: true, maxDelete: 999 });
    assert.ok(result.removed <= MAX_DELETE_PER_RUN);
  } finally { fs.rmSync(f.dataDir, { recursive: true, force: true }); }
}

async function testTenWorkspaceMicroBatchesAndMetrics() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-media-gc-ten-"));
  const files = [];
  try {
    for (let index = 0; index < 10; index += 1) {
      const workspace = `user_${String(index).padStart(2, "0")}`;
      const identity = path.join(dataDir, "identidade-visual-ofertas", "clientes", workspace, "renderizados");
      fs.mkdirSync(identity, { recursive: true });
      fs.mkdirSync(path.join(dataDir, "clientes", workspace), { recursive: true });
      for (let item = 0; item < 2; item += 1) {
        files.push(file(identity, `${String.fromCharCode(97 + index)}${item}`.padEnd(64, "a") + ".png"));
      }
    }
    const observed = await runMediaPhysicalBatch({ dataDir, nowMs: NOW, maxTargetsPerRun: 10,
      microBatchSize: 2, maxDelete: 20, maxDurationMs: 2000, referenceLoader: loader() });
    assert.strictEqual(observed.targetsProcessed, 10, "dez workspaces devem receber uma rodada justa");
    assert.ok(observed.candidates > 0 && observed.candidates <= 20,
      "o orcamento pode limitar a observacao, mas deve produzir candidatos");
    assert.strictEqual(observed.backlog, observed.candidates);
    assert.strictEqual(observed.createdGiB, 0);

    const revalidationCalls = { count: 0 };
    const deleted = await runMediaPhysicalBatch({ dataDir, nowMs: NOW + OBSERVATION_DELAY_MS + 1,
      maxTargetsPerRun: 10, microBatchSize: 2, maxDelete: 20, maxDurationMs: 2000,
      execute: true, mediaDeleteEnabled: true,
      referenceLoader: async (...args) => { revalidationCalls.count += 1; return loader()(...args); }
    });
    assert.ok(deleted.removed > 0 && deleted.removed <= 20,
      "micro-lotes devem reduzir o backlog sem ultrapassar o teto global");
    assert.strictEqual(deleted.revalidations, deleted.removed, "cada exclusao exige revalidacao propria");
    assert.strictEqual(revalidationCalls.count, deleted.revalidations + deleted.targetsProcessed,
      "leituras iniciais e revalidacoes devem ser contabilizadas separadamente");
    assert.strictEqual(deleted.bytesFreedGiB, deleted.removed * 16 / (1024 ** 3));
    assert.ok(deleted.backlog <= observed.candidates,
      "o backlog final nao pode exceder os candidatos observados");
    assert.strictEqual(files.filter(target => fs.existsSync(target)).length,
      20 - deleted.removed);
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
}

async function testLoadGuardStopsWithoutStarvation() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-media-gc-load-"));
  try {
    for (let index = 0; index < 10; index += 1) {
      const workspace = `user_${String(index).padStart(2, "0")}`;
      const identity = path.join(dataDir, "identidade-visual-ofertas", "clientes", workspace, "renderizados");
      fs.mkdirSync(identity, { recursive: true });
      fs.mkdirSync(path.join(dataDir, "clientes", workspace), { recursive: true });
      file(identity, `${String.fromCharCode(97 + index)}`.repeat(64) + ".png");
    }
    let calls = 0;
    const result = await runMediaPhysicalBatch({ dataDir, nowMs: NOW, maxTargetsPerRun: 10,
      loadGuard: () => { calls += 1; return calls <= 2; }, referenceLoader: loader() });
    assert.strictEqual(result.targetsProcessed, 2, "o guard de carga deve interromper o lote sem varrer o restante");
    assert.strictEqual(result.throttled, true);
    assert.strictEqual(result.stopReason, "load_guard");
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
}

async function main() {
  await testIdentityProtectionExpiryAndGate();
  await testConcurrentReferenceAndRewriteFailClosed();
  await testSocialMultiworkspaceAndIncomplete();
  await testPostgresReferenceContract();
  await testStaleIndexFailsClosed();
  await testFutureSocialReferenceAndWorkspaceIsolation();
  await testBatchLimit();
  await testTenWorkspaceMicroBatchesAndMetrics();
  await testLoadGuardStopsWithoutStarvation();
  console.log("AUTO_CLEAN_MEDIA_PHYSICAL_TESTS_PASS");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
