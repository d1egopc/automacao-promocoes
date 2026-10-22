"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { runMediaPhysical, RETENTION_MS, OBSERVATION_DELAY_MS, MAX_DELETE_PER_RUN } =
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

async function main() {
  await testIdentityProtectionExpiryAndGate();
  await testConcurrentReferenceAndRewriteFailClosed();
  await testSocialMultiworkspaceAndIncomplete();
  await testPostgresReferenceContract();
  await testFutureSocialReferenceAndWorkspaceIsolation();
  await testBatchLimit();
  console.log("AUTO_CLEAN_MEDIA_PHYSICAL_TESTS_PASS");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
