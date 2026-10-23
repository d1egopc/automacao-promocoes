"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-teleradar-compaction-"));
process.env.DATA_DIR = fixtureRoot;
process.env.NODE_ENV = "test";

const { getClienteJsonPath } = require("../utils/storage");
const { createTeleradarJsonStore, scopedKey } = require("../modules/teleradar/checkpoint.repository");
const { createHandoffRepository } = require("../modules/teleradar/handoff.repository");
const { compactFile } = require("../modules/teleradar/handoff-compaction.worker");

const context = Object.freeze({
  clientId: "admin",
  workspaceId: "workspace_admin",
  scope: "admin_master",
  feature: "teleradar",
  accountIdInterno: "telegram-admin-1"
});

function eventId(index) {
  return crypto.createHash("sha256").update(`event-${index}`).digest("hex");
}

function record(index, status = "acked", padding = "") {
  const id = eventId(index);
  const createdAt = new Date(Date.UTC(2026, 9, 22, 20, 0, 0) + index).toISOString();
  return {
    eventId: id,
    status,
    envelope: {
      eventId: id,
      origem: "radar",
      origemFluxo: "optimus",
      origemTipo: "telegram",
      fonte: "teleradar",
      fonteCaptura: "teleradar",
      capturedAt: createdAt,
      receivedAt: createdAt,
      envelopeCreatedAt: createdAt,
      payload: padding
    },
    capturedAt: createdAt,
    envelopeCreatedAt: createdAt,
    handoffPersistedAt: createdAt,
    handoffAttemptedAt: createdAt,
    radarAcceptedAt: status === "acked" ? createdAt : null,
    handoffLatencyMs: 0,
    attempts: 1,
    nextAttemptAt: status === "pending" ? createdAt : null,
    leaseUntil: null,
    lastErrorCode: null,
    radarReceipt: status === "acked"
      ? { code: "RADAR_ACCEPTED", radarEventId: String(900000 + index), duplicate: false }
      : null
  };
}

async function httpProbe(port) {
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
  const padding = "x".repeat(5600);
  const entries = {};
  const terminalCount = 12000;
  for (let index = 0; index < terminalCount; index += 1) {
    const item = record(index, "acked", padding);
    entries[scopedKey("handoff", context, item.eventId)] = item;
  }
  for (let index = terminalCount; index < terminalCount + 12; index += 1) {
    const item = record(index, "pending", "");
    entries[scopedKey("handoff", context, item.eventId)] = item;
  }
  fs.writeFileSync(file, `${JSON.stringify({ schemaVersion: 1, entries, clienteId: "admin" }, null, 2)}\n`);
  const bytesBefore = fs.statSync(file).size;
  assert(bytesBefore > 64 * 1024 * 1024, `fixture precisa representar arquivo grande: ${bytesBefore}`);

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

  try {
    const repository = createHandoffRepository({ store: createTeleradarJsonStore(), context });
    const requests = Array.from({ length: 188 }, () => repository.compactTerminals({ force: true }));
    const probes = [];
    let probing = true;
    const probeLoop = (async () => {
      while (probing) {
        try { probes.push(await httpProbe(port)); } catch (error) {
          if (probing) throw error;
        }
        await new Promise(resolve => setTimeout(resolve, 5));
      }
    })();
    const results = await Promise.all(requests);
    probing = false;
    await probeLoop;

    assert(results.every(item => item.compacted === true), "chamadas concorrentes compartilham a mesma compactacao");
    assert(probes.length >= 1, "HTTP foi exercitado durante a compactacao");
    assert(Math.max(...probes) < 1000, `HTTP bloqueado durante compactacao: ${Math.max(...probes)}ms`);
    assert(maxDriftMs < 1000, `event loop bloqueado: drift=${maxDriftMs}ms`);

    const active = JSON.parse(fs.readFileSync(file, "utf8"));
    const activeRecords = Object.values(active.entries);
    const tombstones = activeRecords.filter(item => item.archived === true);
    const pending = activeRecords.filter(item => item.status === "pending");
    assert.equal(activeRecords.length, terminalCount + 12, "indice ativo conserva identidade exata para dedupe");
    assert.equal(tombstones.length, terminalCount - 512);
    assert.equal(pending.length, 12, "pendencias nunca sao arquivadas");
    assert(fs.statSync(file).size < bytesBefore / 4, "arquivo ativo foi materialmente reduzido");

    const archiveDir = path.join(path.dirname(file), "teleradar-ha");
    const segments = fs.readdirSync(archiveDir).filter(name => name.endsWith(".json"));
    assert.equal(segments.length, 1);
    const archived = JSON.parse(fs.readFileSync(path.join(archiveDir, segments[0]), "utf8"));
    assert.equal(archived.entryCount, terminalCount - 512);
    assert.equal(Object.keys(archived.entries).length, terminalCount - 512);

    const duplicateIndex = 0;
    const duplicate = record(duplicateIndex, "acked", "").envelope;
    const duplicateTombstone = active.entries[scopedKey("handoff", context, duplicate.eventId)];
    assert.equal(duplicateTombstone.status, "acked");
    assert.equal(duplicateTombstone.archived, true, "terminal arquivado permanece no indice ativo de dedupe");
    if (process.platform !== "win32") {
      const persisted = await repository.persist({ envelope: duplicate, persistedAt: duplicate.capturedAt });
      assert.equal(persisted.created, false, "terminal arquivado nao reentra na outbox");
      assert.equal(persisted.record.status, "acked");
      assert.equal(persisted.record.archived, true);
    }

    const retry = await repository.compactTerminals({ force: true });
    assert.equal(retry.compacted, false, "repeticao e idempotente");
    assert.equal(fs.readdirSync(archiveDir).filter(name => name.endsWith(".json")).length, 1);

    const crashFile = path.join(path.dirname(file), "teleradar-handoffs-crash-fixture.json");
    const crashEntries = {};
    for (let index = 20000; index < 20800; index += 1) {
      const item = record(index, "acked", "y".repeat(100));
      crashEntries[scopedKey("handoff", context, item.eventId)] = item;
    }
    fs.writeFileSync(crashFile, `${JSON.stringify({ schemaVersion: 1, entries: crashEntries, clienteId: "admin" }, null, 2)}\n`);
    const crashSourceHash = crypto.createHash("sha256").update(fs.readFileSync(crashFile)).digest("hex");
    await assert.rejects(
      () => compactFile({
        file: crashFile,
        keepTerminal: 64,
        terminalHighWater: 100,
        maxActiveBytes: 1024,
        _testFailAfterArchive: true
      }),
      /TELERADAR_TEST_FAILURE_AFTER_ARCHIVE/
    );
    assert.equal(
      crypto.createHash("sha256").update(fs.readFileSync(crashFile)).digest("hex"),
      crashSourceHash,
      "falha apos arquivo imutavel nao altera a outbox ativa"
    );
    const recovered = await compactFile({
      file: crashFile,
      keepTerminal: 64,
      terminalHighWater: 100,
      maxActiveBytes: 1024
    });
    assert.equal(recovered.compacted, true, "retry apos crash conclui a mesma compactacao");
    assert.equal(Object.keys(JSON.parse(fs.readFileSync(crashFile, "utf8")).entries).length, 800);
    console.log(JSON.stringify({
      ok: true,
      bytesBefore,
      bytesAfter: fs.statSync(file).size,
      archived: archived.entryCount,
      pending: pending.length,
      httpProbes: probes.length,
      maxHttpMs: Math.round(Math.max(...probes)),
      maxEventLoopDriftMs: maxDriftMs
    }));
  } finally {
    clearInterval(timer);
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
