"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-teleradar-real-mutations-"));
process.env.DATA_DIR = fixtureRoot;
process.env.NODE_ENV = "test";

const { getClienteJsonPath } = require("../utils/storage");
const { createTeleradarJsonStore, scopedKey } = require("../modules/teleradar/checkpoint.repository");
const { createHandoffRepository } = require("../modules/teleradar/handoff.repository");
const { createHandoffService } = require("../modules/teleradar/handoff.service");

const context = Object.freeze({
  clientId: "admin",
  workspaceId: "workspace_admin",
  scope: "admin_master",
  feature: "teleradar",
  accountIdInterno: "telegram-admin-1"
});

function eventId(index) {
  return crypto.createHash("sha256").update(`real-handoff-${index}`).digest("hex");
}

function envelope(index, padding = "") {
  const id = eventId(index);
  const at = new Date(Date.UTC(2026, 9, 22, 20, 0, 0) + index).toISOString();
  return {
    eventId: id,
    origem: "radar",
    origemFluxo: "optimus",
    origemTipo: "telegram",
    fonte: "teleradar",
    fonteCaptura: "teleradar",
    capturedAt: at,
    receivedAt: at,
    envelopeCreatedAt: at,
    text: `Oferta ${index} ${padding}`,
    entities: []
  };
}

function pendingRecord(index, padding) {
  const item = envelope(index, padding);
  return {
    eventId: item.eventId,
    status: "pending",
    envelope: item,
    capturedAt: item.capturedAt,
    envelopeCreatedAt: item.envelopeCreatedAt,
    handoffPersistedAt: item.capturedAt,
    handoffAttemptedAt: null,
    radarAcceptedAt: null,
    handoffLatencyMs: null,
    attempts: 0,
    nextAttemptAt: "2026-10-22T19:00:00.000Z",
    leaseUntil: null,
    lastErrorCode: null,
    radarReceipt: null
  };
}

function httpProbe(port) {
  return new Promise((resolve, reject) => {
    const started = process.hrtime.bigint();
    const request = http.get({ host: "127.0.0.1", port, path: "/health", timeout: 2000 }, response => {
      response.resume();
      response.once("end", () => resolve(Number(process.hrtime.bigint() - started) / 1e6));
    });
    request.once("timeout", () => request.destroy(new Error("HTTP_TIMEOUT")));
    request.once("error", reject);
  });
}

async function main() {
  const file = getClienteJsonPath("admin", "teleradar-handoffs.json");
  const entries = {};
  const operationCount = 188;
  const fillerCount = 11000;
  const padding = "p".repeat(6000);
  for (let index = 0; index < fillerCount; index += 1) {
    entries[scopedKey("handoff", context, eventId(index))] = pendingRecord(index, padding);
  }
  fs.writeFileSync(file, `${JSON.stringify({ schemaVersion: 1, entries, clienteId: "admin" }, null, 2)}\n`);
  const bytesBefore = fs.statSync(file).size;
  assert(bytesBefore > 64 * 1024 * 1024, `fixture precisa ter aproximadamente 71 MB: ${bytesBefore}`);

  const server = http.createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end("{\"ok\":true}");
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  let maxDriftMs = 0;
  let expectedTick = Date.now() + 10;
  const timer = setInterval(() => {
    const now = Date.now();
    maxDriftMs = Math.max(maxDriftMs, now - expectedTick);
    expectedTick = now + 10;
  }, 10);

  const repository = createHandoffRepository({ store: createTeleradarJsonStore(), context });
  const handoff = createHandoffService({
    context,
    repository,
    clock: () => new Date("2026-10-22T20:30:00.000Z"),
    radarIngress: {
      accept: async () => ({ accepted: true, durable: true, code: "RADAR_ACCEPTED", radarEventId: "real-stress" })
    }
  });
  let probing = true;
  const probes = [];
  const probeLoop = (async () => {
    while (probing) {
      probes.push(await httpProbe(port));
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  })();

  try {
    const attempts = Array.from({ length: operationCount }, (_, index) => handoff.attempt(eventId(index)));
    const results = await Promise.all(attempts);
    probing = false;
    await probeLoop;
    assert.equal(results.filter(result => result.accepted === true).length, operationCount);
    assert.equal(results.some(result => result.pending === true), false);
    assert(probes.length >= 1, "HTTP nao foi exercitado durante as mutacoes reais");
    assert(Math.max(...probes) < 1000, `HTTP bloqueado durante mutacoes: ${Math.max(...probes)}ms`);
    assert(maxDriftMs < 1000, `event loop bloqueado: drift=${maxDriftMs}ms`);

    const persisted = JSON.parse(fs.readFileSync(file, "utf8"));
    const records = Object.values(persisted.entries);
    assert.equal(records.length, fillerCount, "nenhum registro foi perdido");
    assert.equal(records.filter(item => item.status === "acked").length, operationCount);
    assert.equal(records.filter(item => item.status === "pending").length, fillerCount - operationCount);
    const duplicate = await repository.persist({ envelope: envelope(0), persistedAt: "2026-10-22T20:31:00.000Z" });
    assert.equal(duplicate.created, false, "dedupe do handoff permanece idempotente");
    assert.equal(duplicate.record.status, "acked");
    console.log(JSON.stringify({
      ok: true,
      operationCount,
      bytesBefore,
      bytesAfter: fs.statSync(file).size,
      pending: records.filter(item => item.status === "pending").length,
      acked: records.filter(item => item.status === "acked").length,
      httpProbes: probes.length,
      maxHttpMs: Math.round(Math.max(...probes)),
      maxEventLoopDriftMs: Math.round(maxDriftMs)
    }));
  } finally {
    probing = false;
    await probeLoop.catch(() => {});
    clearInterval(timer);
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
