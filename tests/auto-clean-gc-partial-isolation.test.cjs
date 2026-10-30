"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { runMediaPhysicalBatch, RETENTION_MS, OBSERVATION_DELAY_MS } =
  require("../modules/engine/auto-clean/gc-media-physical.service");

const now = Date.parse("2026-10-30T12:00:00.000Z");
const old = new Date(now - RETENTION_MS - 60_000);
const hash = digit => digit.repeat(64);
const file = (dir, name) => {
  fs.mkdirSync(dir, { recursive: true });
  const result = path.join(dir, name);
  fs.writeFileSync(result, "fixture");
  fs.utimesSync(result, old, old);
  return result;
};

async function run() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "auto-clean-gc-isolation-"));
  try {
    const clients = path.join(dataDir, "clientes");
    fs.mkdirSync(path.join(clients, "user_blocked"), { recursive: true });
    fs.mkdirSync(path.join(clients, "user_healthy"), { recursive: true });
    const blockedDir = path.join(dataDir, "identidade-visual-ofertas", "clientes", "user_blocked", "renderizados");
    const healthyDir = path.join(dataDir, "identidade-visual-ofertas", "clientes", "user_healthy", "renderizados");
    const socialDir = path.join(dataDir, "social", "midia", "publica", "engine");
    const blocked = file(blockedDir, `${hash("a")}.png`);
    const referenced = file(healthyDir, `${hash("b")}.png`);
    const shared = file(healthyDir, `${hash("c")}.png`);
    const orphan = file(healthyDir, `${hash("d")}.png`);
    const social = file(socialDir, "unreferenced.jpg");
    const referenceIndexBuilder = async ({ workspaceId }) => workspaceId === "user_blocked"
      ? { complete: false, refs: new Map(), reasonCode: "REFERENCE_COMPACT_SOURCE_STALE" }
      : { complete: true, refs: new Map([
        [hash("b"), new Set(["fila"])],
        [hash("c"), new Set(["fila", "historico"])]
      ]), generation: "verified" };
    const options = { dataDir, maxTargetsPerRun: 3, maxScan: 10, maxDelete: 3,
      referenceIndexBuilder, socialReferenceProvider: async () => ({ complete: true, refs: new Set() }) };
    const first = await runMediaPhysicalBatch({ ...options, nowMs: now });
    assert.equal(first.removed, 0);
    assert.equal(first.targetResults.find(item => item.target === "identity:user_blocked")?.referenceComplete, false);
    assert.equal(first.targetResults.find(item => item.target === "identity:user_healthy")?.candidates, 1);
    assert.equal(first.targetResults.find(item => item.target === "social:engine")?.referenceComplete, false,
      "social compartilhado depende da cobertura de todas as workspaces");

    const second = await runMediaPhysicalBatch({ ...options, nowMs: now + OBSERVATION_DELAY_MS + 1,
      execute: true, mediaDeleteEnabled: true });
    assert.equal(second.removed, 1, "somente origem independente pode avançar");
    assert.equal(second.bytesFreed, Buffer.byteLength("fixture"));
    assert.equal(second.targetResults.find(item => item.target === "identity:user_blocked")?.removed, 0);
    assert.equal(second.targetResults.find(item => item.target === "social:engine")?.removed, 0);
    assert.ok(fs.existsSync(blocked), "referência desconhecida bloqueia exclusão");
    assert.ok(fs.existsSync(referenced), "referência existente protege");
    assert.ok(fs.existsSync(shared), "referência compartilhada protege");
    assert.ok(!fs.existsSync(orphan), "órfão comprovado em origem independente pode ser removido");
    assert.ok(fs.existsSync(social), "origem social compartilhada continua bloqueada");

    const again = await runMediaPhysicalBatch({ ...options, nowMs: now + 2 * OBSERVATION_DELAY_MS + 2,
      execute: true, mediaDeleteEnabled: true });
    assert.equal(again.removed, 0, "repetição é idempotente");
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

run().then(() => console.log("auto-clean-gc-partial-isolation.test.cjs OK"), error => {
  console.error(error); process.exitCode = 1;
});
