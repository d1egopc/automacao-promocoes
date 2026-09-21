"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { createMemoryTeleradarStore } = require("../modules/teleradar/checkpoint.repository");
const { createEnvelope } = require("../modules/teleradar/envelope.contract");
const { createHandoffRepository, HANDOFFS_FILE } = require("../modules/teleradar/handoff.repository");
const { createHandoffService } = require("../modules/teleradar/handoff.service");
const { createRadarIngressAdapter } = require("../modules/teleradar/radar-ingress.adapter");
const { createTeleRadarService } = require("../modules/teleradar");

const context = Object.freeze({
  clientId: "admin",
  workspaceId: "workspace_admin",
  scope: "admin_master",
  feature: "teleradar",
  accountIdInterno: "telegram-admin-1"
});

function clockFixture(initial = "2026-09-21T18:00:00.000Z") {
  let now = Date.parse(initial);
  return {
    clock: () => new Date(now),
    advance: milliseconds => { now += milliseconds; }
  };
}

function fakeTimers() {
  const active = new Set();
  return {
    setTimeoutFn(callback, delay) {
      const timer = { callback, delay, unref() {} };
      active.add(timer);
      return timer;
    },
    clearTimeoutFn(timer) { active.delete(timer); },
    active
  };
}

function envelopeFixture({ messageId = "100", text = "Oferta https://example.com", entities } = {}) {
  return createEnvelope({
    accountId: "90071992547409931",
    chatId: "-100123",
    chatKey: "-100123",
    messageId,
    senderId: "90071992547409932",
    receivedAt: "2026-09-21T18:00:00.000Z",
    sourceTimestamp: "2026-09-21T17:59:59.000Z",
    envelopeCreatedAt: "2026-09-21T18:00:00.100Z",
    text,
    textSource: "text",
    hasMedia: false,
    mediaType: null,
    protectedContent: false,
    entities: entities || [{
      type: "url",
      occurrence: 0,
      offset: 7,
      length: 19,
      label: "https://example.com",
      url: "https://example.com"
    }]
  });
}

async function testHappyPathAndObservability() {
  const store = createMemoryTeleradarStore();
  const time = clockFixture();
  const timers = fakeTimers();
  const order = [];
  let ingressCalls = 0;
  const handoff = createHandoffService({
    context,
    store,
    clock: time.clock,
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
    beforeAttempt: async () => { order.push("checkpoint"); },
    radarIngress: {
      accept: async () => {
        ingressCalls += 1;
        order.push("radar");
        return { accepted: true, durable: true, code: "RADAR_ACCEPTED", radarEventId: "42999" };
      }
    }
  });
  const envelope = envelopeFixture();
  order.push("persist");
  const persisted = await handoff.persistEnvelope(envelope);
  assert.equal(persisted.created, true);
  time.advance(250);
  const delivered = await handoff.attempt(envelope.eventId);
  assert.equal(delivered.accepted, true);
  assert.deepEqual(order, ["persist", "checkpoint", "radar"]);
  assert.equal(ingressCalls, 1);
  const record = await handoff.get(envelope.eventId);
  assert.equal(record.status, "acked");
  assert.equal(record.capturedAt, envelope.capturedAt);
  assert.equal(record.envelopeCreatedAt, envelope.envelopeCreatedAt);
  assert(record.handoffPersistedAt);
  assert(record.handoffAttemptedAt);
  assert(record.radarAcceptedAt);
  assert.equal(record.handoffLatencyMs, 1250);
  assert.equal(record.radarReceipt.code, "RADAR_ACCEPTED");
  assert.deepEqual(await handoff.getObservability(), {
    outbox: { pending: 0, delivering: 0, failedPermanent: 0 },
    activity: {
      lastCapturedAt: envelope.capturedAt,
      lastHandoffAt: record.handoffAttemptedAt,
      lastRadarAcceptedAt: record.radarAcceptedAt,
      lastHandoffLatencyMs: 1250
    }
  });

  assert.equal((await handoff.persistEnvelope(envelope)).created, false);
  assert.equal((await handoff.attempt(envelope.eventId)).skipped, true);
  assert.equal(ingressCalls, 1, "evento duplicado nao reingressa no Radar");
}

async function testObservabilityAndRecoveryStayScoped() {
  const store = createMemoryTeleradarStore();
  const otherContext = Object.freeze({ ...context, accountIdInterno: "telegram-admin-2" });
  const firstRepository = createHandoffRepository({ store, context });
  const secondRepository = createHandoffRepository({ store, context: otherContext });
  const firstEnvelope = envelopeFixture({ messageId: "801" });
  const secondEnvelope = envelopeFixture({ messageId: "802" });
  await firstRepository.persist({ envelope: firstEnvelope, persistedAt: "2026-09-21T18:00:01.000Z" });
  await secondRepository.persist({ envelope: secondEnvelope, persistedAt: "2026-09-21T18:00:02.000Z" });
  assert.deepEqual((await firstRepository.listRecoverable(new Date("2026-09-21T18:00:03.000Z"))).map(item => item.eventId), [firstEnvelope.eventId]);
  assert.deepEqual((await secondRepository.listRecoverable(new Date("2026-09-21T18:00:03.000Z"))).map(item => item.eventId), [secondEnvelope.eventId]);
  assert.equal((await firstRepository.summarize()).outbox.pending, 1);
  assert.equal((await secondRepository.summarize()).outbox.pending, 1);
}

async function testRetryConcurrencyAndCallbackException() {
  const store = createMemoryTeleradarStore();
  const time = clockFixture();
  const timers = fakeTimers();
  let calls = 0;
  const handoff = createHandoffService({
    context,
    store,
    clock: time.clock,
    backoffMs: [1000, 5000, 30000],
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
    radarIngress: {
      accept: async () => {
        calls += 1;
        if (calls === 1) throw new Error("db_temporariamente_indisponivel");
        return { accepted: true, durable: true, code: "RADAR_ACCEPTED", radarEventId: "43000" };
      }
    }
  });
  const envelope = envelopeFixture({ messageId: "101" });
  await handoff.start();
  await handoff.persistEnvelope(envelope);
  const failed = await handoff.attempt(envelope.eventId);
  assert.equal(failed.pending, true);
  assert.equal((await handoff.get(envelope.eventId)).status, "pending");
  assert.equal(timers.active.size, 1);

  time.advance(1000);
  const concurrent = await Promise.all([
    handoff.attempt(envelope.eventId),
    handoff.attempt(envelope.eventId)
  ]);
  assert.equal(concurrent.filter(item => item.accepted).length, 1);
  assert.equal(calls, 2, "claims concorrentes produzem uma unica chamada adicional");
  assert.equal((await handoff.get(envelope.eventId)).status, "acked");
  await handoff.stop();
}

async function testRestartResumesPendingAndPermanentFailureObservable() {
  const store = createMemoryTeleradarStore();
  const time = clockFixture();
  const timersA = fakeTimers();
  const envelope = envelopeFixture({ messageId: "102" });
  const first = createHandoffService({
    context,
    store,
    clock: time.clock,
    setTimeoutFn: timersA.setTimeoutFn,
    clearTimeoutFn: timersA.clearTimeoutFn,
    radarIngress: { accept: async () => ({ accepted: false, durable: false, retryable: true, code: "DB_DOWN" }) }
  });
  await first.start();
  await first.persistEnvelope(envelope);
  await first.attempt(envelope.eventId);
  await first.stop();
  time.advance(1000);

  let resumedCalls = 0;
  const second = createHandoffService({
    context,
    store,
    clock: time.clock,
    setTimeoutFn: fakeTimers().setTimeoutFn,
    clearTimeoutFn: () => {},
    radarIngress: {
      accept: async () => {
        resumedCalls += 1;
        return { accepted: true, durable: true, code: "RADAR_ACCEPTED", radarEventId: "43001", duplicate: false };
      }
    }
  });
  await second.start();
  assert.equal(resumedCalls, 1);
  assert.equal((await second.get(envelope.eventId)).status, "acked");
  await second.stop();

  const permanentEnvelope = envelopeFixture({ messageId: "103", text: "sem url", entities: [] });
  const permanent = createHandoffService({
    context,
    store,
    clock: time.clock,
    setTimeoutFn: fakeTimers().setTimeoutFn,
    clearTimeoutFn: () => {},
    radarIngress: { accept: async () => ({ accepted: false, durable: false, retryable: false, code: "sem_links" }) }
  });
  await permanent.persistEnvelope(permanentEnvelope);
  const rejected = await permanent.attempt(permanentEnvelope.eventId);
  assert.equal(rejected.permanent, true);
  const permanentRecord = await permanent.get(permanentEnvelope.eventId);
  assert.equal(permanentRecord.status, "failed_permanent");
  assert.equal(permanentRecord.lastErrorCode, "sem_links");
}

async function testRestartReschedulesActiveLease() {
  const store = createMemoryTeleradarStore();
  const time = clockFixture();
  const repository = createHandoffRepository({ store, context });
  const envelope = envelopeFixture({ messageId: "107" });
  await repository.persist({ envelope, persistedAt: time.clock() });
  await repository.claimAttempt({ eventId: envelope.eventId, attemptedAt: time.clock(), leaseMs: 30000 });

  const timers = fakeTimers();
  let calls = 0;
  const resumed = createHandoffService({
    context,
    store,
    repository,
    clock: time.clock,
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
    radarIngress: {
      accept: async () => {
        calls += 1;
        return { accepted: true, durable: true, code: "RADAR_ACCEPTED", radarEventId: "43002" };
      }
    }
  });
  await resumed.start();
  assert.equal(calls, 0);
  assert.equal(timers.active.size, 1, "lease ativo e reagendado para retomada apos restart");
  time.advance(30000);
  [...timers.active][0].callback();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1);
  assert.equal((await resumed.get(envelope.eventId)).status, "acked");
  await resumed.stop();
}

async function testProtectedNeverPersists() {
  const store = createMemoryTeleradarStore();
  const repository = createHandoffRepository({ store, context });
  const envelope = { ...envelopeFixture({ messageId: "104" }), protectedContent: true, text: "SEGREDO_PROTEGIDO" };
  await assert.rejects(
    () => repository.persist({ envelope, persistedAt: "2026-09-21T18:00:00.000Z" }),
    /TELERADAR_REJEITADO_PROTECTED_CONTENT/
  );
  assert(!JSON.stringify(store.snapshot()).includes("SEGREDO_PROTEGIDO"));
}

async function testRadarIngressContract() {
  let payload = null;
  const adapter = createRadarIngressAdapter({
    processarMensagemRadar: async value => {
      payload = value;
      return { radarAccepted: true, radarAck: "RADAR_ACCEPTED", radarEventId: 43100, radarDuplicate: false };
    }
  });
  const repeatedEntities = [
    { type: "url", occurrence: 0, offset: 0, length: 19, label: "https://example.com", url: "https://example.com" },
    { type: "text_url", occurrence: 1, offset: 20, length: 3, label: "APP", url: "https://example.com/app" },
    { type: "url", occurrence: 2, offset: 24, length: 19, label: "https://example.com", url: "https://example.com" }
  ];
  const envelope = envelopeFixture({ messageId: "105", entities: repeatedEntities });
  const result = await adapter.accept(envelope, { handoffPersistedAt: "2026-09-21T18:00:00.200Z" });
  assert.deepEqual(result, {
    accepted: true,
    durable: true,
    retryable: false,
    code: "RADAR_ACCEPTED",
    radarEventId: "43100",
    duplicate: false
  });
  assert.equal(payload.origemTipo, "telegram");
  assert.equal(payload.origemAutorizadaInternamente, true);
  assert.equal(payload.aguardarAckEngine, true);
  assert.equal(payload.hashEvento, envelope.eventId);
  assert.deepEqual(payload.linksCapturados, ["https://example.com", "https://example.com/app", "https://example.com"]);
  assert.deepEqual(payload.teleradarHandoff.entities.map(item => item.occurrence), [0, 1, 2]);
  assert.equal(payload.raw.teleradar.entities[1].type, "text_url");

  const notPersisted = createRadarIngressAdapter({
    processarMensagemRadar: async () => ({ ok: false, motivo: "radar_chamada_falhou" })
  });
  assert.equal((await notPersisted.accept(envelope)).retryable, true);
  const noLinks = createRadarIngressAdapter({
    processarMensagemRadar: async () => ({ ok: false, motivo: "sem_links" })
  });
  assert.equal((await noLinks.accept(envelope)).retryable, false);
}

async function testOutboxBeforeCheckpointFailure() {
  const store = createMemoryTeleradarStore();
  const time = clockFixture();
  let listener = null;
  const telegramAccountService = {
    async restore() { return { authorized: true }; },
    async subscribeNewMessages({ onMessage }) { listener = onMessage; return async () => { listener = null; }; },
    async listParticipatingChats() {
      return [{ chatKey: "-100123", chatId: "-100123", title: "Fonte", type: "channel", protectedContent: false }];
    },
    async disconnect() {}
  };
  const checkpoints = {
    async get() { return null; },
    async acceptIfNewer() { throw new Error("checkpoint_indisponivel"); }
  };
  const service = createTeleRadarService({
    context,
    store,
    clock: time.clock,
    telegramAccountService,
    checkpoints,
    radarIngress: { accept: async () => { throw new Error("nao_deveria_entregar"); } },
    handoffOptions: {
      setTimeoutFn: fakeTimers().setTimeoutFn,
      clearTimeoutFn: () => {}
    }
  });
  await service.replaceSelectedSources(["-100123"]);
  await service.start();
  time.advance(1000);
  const update = {
    accountId: "90071992547409931",
    chatId: "-100123",
    chatKey: "-100123",
    messageId: "106",
    senderId: "90071992547409932",
    receivedAt: time.clock().toISOString(),
    text: "Oferta https://example.com",
    textSource: "text",
    hasMedia: false,
    protectedContent: false,
    entities: [{ type: "url", occurrence: 0, offset: 7, length: 19, label: "https://example.com", url: "https://example.com" }]
  };
  const result = await listener(update);
  assert.equal(result.accepted, false);
  assert.equal(result.reason, "checkpoint_indisponivel");
  const outboxState = await store.read(context, HANDOFFS_FILE);
  const records = Object.values(outboxState.entries);
  assert.equal(records.length, 1);
  assert.equal(records[0].status, "pending", "handoff duravel existe antes da falha de checkpoint");
  assert.equal(records[0].envelope.messageId, "106");
  await service.stop();
}

async function testExplicitEventIdControlsEngineIdempotency() {
  const databasePath = require.resolve("../modules/engine/database");
  const jobsPath = require.resolve("../modules/engine/jobs.service");
  const inboxPath = require.resolve("../modules/engine/inbox.service");
  const originals = new Map([
    [databasePath, require.cache[databasePath]],
    [jobsPath, require.cache[jobsPath]],
    [inboxPath, require.cache[inboxPath]]
  ]);
  const idsByHash = new Map();
  let nextId = 50000;
  let legacyDuplicateQueries = 0;
  try {
    require.cache[databasePath] = {
      id: databasePath,
      filename: databasePath,
      loaded: true,
      exports: {
        queryEngine: async (sql, params = []) => {
          if (/COALESCE\(origem/i.test(sql)) {
            legacyDuplicateQueries += 1;
            return { ok: true, resultado: { rows: [{ id: 49999 }] }, metricas: {} };
          }
          if (/INSERT INTO engine_eventos_brutos/i.test(sql)) {
            const hash = params[9];
            if (idsByHash.has(hash)) return { ok: true, resultado: { rows: [] }, metricas: {} };
            nextId += 1;
            idsByHash.set(hash, nextId);
            return { ok: true, resultado: { rows: [{ id: nextId }] }, metricas: {} };
          }
          if (/FROM engine_eventos_brutos[\s\S]*hash_evento = \$1/i.test(sql)) {
            const id = idsByHash.get(params[0]);
            return { ok: true, resultado: { rows: id ? [{ id }] : [] }, metricas: {} };
          }
          return { ok: true, resultado: { rows: [] }, metricas: {} };
        }
      }
    };
    require.cache[jobsPath] = {
      id: jobsPath,
      filename: jobsPath,
      loaded: true,
      exports: { criarJobsParaClientes: async () => ({ criados: 1, existentes: 0 }) }
    };
    delete require.cache[inboxPath];
    const { registrarEventoBruto } = require("../modules/engine/inbox.service");
    const base = {
      origem: "radar",
      origemFluxo: "optimus",
      origemTipo: "telegram",
      fonte: "teleradar",
      grupoId: "-100123",
      textoOriginal: "Oferta identica https://example.com",
      linksExtraidos: ["https://example.com"],
      capturadoEm: "2026-09-21T18:00:00.000Z"
    };
    const hashA = "a".repeat(64);
    const hashB = "b".repeat(64);
    const first = await registrarEventoBruto({ ...base, hashEvento: hashA }, { clientes: ["workspace_a"] });
    const second = await registrarEventoBruto({ ...base, hashEvento: hashB }, { clientes: ["workspace_a"] });
    const retry = await registrarEventoBruto({ ...base, hashEvento: hashA }, { clientes: ["workspace_a"] });
    assert.equal(legacyDuplicateQueries, 0, "hash explicito nao usa dedupe legado por texto/janela");
    assert.notEqual(first.id, second.id, "mensagens distintas com mesmo texto preservam identidades distintas");
    assert.equal(retry.id, first.id);
    assert.equal(retry.duplicado, true);
    const clonador = await registrarEventoBruto({
      ...base,
      fonte: "clonador_grupos",
      origem: "clonador_grupos",
      hashEvento: "c".repeat(64)
    }, { clientes: ["workspace_a"] });
    assert.equal(legacyDuplicateQueries, 1, "hash explicito de outro fluxo preserva comportamento legado");
    assert.equal(clonador.id, 49999);
  } finally {
    for (const [resolved, cached] of originals) {
      if (cached) require.cache[resolved] = cached;
      else delete require.cache[resolved];
    }
  }
}

async function testStaticBoundaries() {
  const moduleDir = path.join(__dirname, "..", "modules", "teleradar");
  const combined = fs.readdirSync(moduleDir)
    .filter(file => file.endsWith(".js"))
    .map(file => fs.readFileSync(path.join(moduleDir, file), "utf8"))
    .join("\n");
  assert(!/registrarEventoBruto|criarJobsParaClientes|processarFila|distribuirOfertasEngine|marketplaces\//.test(combined));
  assert(!/precoAtual|precoAnterior|cupom|afiliad|destinoIds|creditos/i.test(combined));
  assert(!/downloadMedia|mediaBuffer|Buffer\.from\([^)]*media/i.test(combined));
  const root = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  assert(root.includes("registerRadarIngressHandler(processarMensagemRadar)"));
  assert(root.includes("hashEvento: envelope.eventId") === false, "mapeamento de envelope permanece no adapter TeleRadar");
}

async function main() {
  await testHappyPathAndObservability();
  await testObservabilityAndRecoveryStayScoped();
  await testRetryConcurrencyAndCallbackException();
  await testRestartResumesPendingAndPermanentFailureObservable();
  await testRestartReschedulesActiveLease();
  await testProtectedNeverPersists();
  await testRadarIngressContract();
  await testOutboxBeforeCheckpointFailure();
  await testExplicitEventIdControlsEngineIdempotency();
  await testStaticBoundaries();
  console.log("teleradar-handoff.test.js OK");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
