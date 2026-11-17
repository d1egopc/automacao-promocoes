"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

const {
  createIngressBoundaryObservation,
  resolveConfiguredObservationGroups
} = require("../modules/whatsapp/ingress-boundary-observation");
const {
  registrarListenerUnicoSocket
} = require("../modules/whatsapp/socket-listener-lifecycle.service");
const {
  classificarErroSignal,
  observarErroSignal
} = require("../modules/whatsapp/baileys-session-observability.service");
const {
  avaliarGateCapturaRadarWhatsapp
} = require("../modules/radar/whatsapp-capture-gate");

const SESSION = "admin_Radar Zap Claro";
const WORKSPACE = "admin";
const GROUP = "120363408782037034@g.us";
const GROUP_B = "120363429821085702@g.us";

function socket() {
  const ev = new EventEmitter();
  ev.isBuffering = () => false;
  return { ev, ws: new EventEmitter() };
}

function message(id, remoteJid = GROUP, fromMe = false) {
  return {
    key: { id, remoteJid, fromMe },
    message: { conversation: "PRIVATE CONTENT MUST NOT BE STORED" }
  };
}

function journalFixture() {
  const rows = [];
  return {
    rows,
    open: async () => true,
    append: row => { rows.push(row); return true; },
    status: () => ({ available: true, failed: false, dropped: 0, queued: 0,
      bytes: 0, maxBytes: 2 * 1024 * 1024, retentionMs: 15 * 60 * 1000 }),
    close: async () => {}
  };
}

function observerFor(scopes = new Map()) {
  return createIngressBoundaryObservation({
    journal: journalFixture(),
    resolveContinuousScope: ({ workspaceId, sessionId }) =>
      scopes.get(`${workspaceId}:${sessionId}`) || { verified: false, groupIds: [] }
  });
}

function attachRadarListener(observer, sock, { workspaceId, sessionId, onInvoke } = {}) {
  return registrarListenerUnicoSocket({
    sock,
    evento: "messages.upsert",
    sessaoId: sessionId,
    socketGeracao: 1,
    onInvoke,
    logger: { log() {}, warn() {} },
    handler: ({ messages, type }) => {
      observer.mark("callback", { sock, emitter: sock.ev, workspaceId, sessionId, messages, upsertType: type });
      for (const item of messages) {
        observer.mark("listener", { sock, emitter: sock.ev, workspaceId, sessionId, message: item });
        observer.mark("radar", { sock, emitter: sock.ev, workspaceId, sessionId, message: item });
        observer.mark("result", { sock, emitter: sock.ev, workspaceId, sessionId, message: item,
          decision: "accepted", reason: "accepted" });
      }
    }
  });
}

test("group notify is observable through listener and Radar without retaining message content", () => {
  const journal = journalFixture();
  const observer = createIngressBoundaryObservation({
    journal,
    resolveContinuousScope: ({ workspaceId, sessionId }) =>
      workspaceId === WORKSPACE && sessionId === SESSION ? { verified: true, groupIds: [GROUP] } : { verified: false, groupIds: [] }
  });
  assert.equal(observer.startContinuous().ok, true);
  const sock = socket();
  assert.equal(observer.trackSocket({ workspaceId: WORKSPACE, sessionId: SESSION, generation: 21, sock }), true);
  attachRadarListener(observer, sock, { workspaceId: WORKSPACE, sessionId: SESSION,
    onInvoke: () => observer.mark("wrapper", { sock, sessionId: SESSION }) });

  sock.ev.emit("messages.upsert", { type: "notify", messages: [message("synthetic-group-event")] });
  const status = observer.status();
  const generation = status.generations[0];
  assert.equal(generation.counters.callbackCalls, 1);
  assert.equal(generation.counters.radarEntries, 1);
  assert.equal(status.groupStats[0].counts.upsertNotify, 1);
  assert.equal(status.groupStats[0].counts.radarAccepted, 1);
  assert.equal(status.messages.length, 1);
  const serialized = JSON.stringify({ status, journal: journal.rows });
  for (const forbidden of [GROUP, SESSION, "synthetic-group-event", "PRIVATE CONTENT MUST NOT BE STORED"]) {
    assert.equal(serialized.includes(forbidden), false, `telemetria vazou ${forbidden}`);
  }
  assert.ok(journal.rows.some(row => row.stage === "radar_result" && row.decision === "accepted"));
  observer.stop("test_complete");
});

test("direct Signal failure is classified separately and does not block a group listener", () => {
  assert.equal(classificarErroSignal(new Error("No matching sessions found")), "no_matching_sessions");
  const entries = [];
  const logger = { error: (entry, text) => entries.push({ entry, text }) };
  const groupEvents = new EventEmitter();
  let groupEventsObserved = 0;
  groupEvents.on("messages.upsert", () => { groupEventsObserved += 1; });
  const direct = observarErroSignal(new Error("No matching sessions found"), logger, "decryptMessage", {
    jid: "123456:1@lid", type: "msg"
  });
  const group = observarErroSignal(new Error("No matching sessions found"), logger, "decryptGroupMessage", {
    authorJid: "123456:1@g.us", group: GROUP, type: "skmsg"
  });
  assert.equal(direct, true);
  assert.equal(group, true);
  groupEvents.emit("messages.upsert", { type: "notify", messages: [] });
  assert.equal(groupEventsObserved, 1);
  assert.equal(entries[0].entry.erroTipo, "no_matching_sessions");
  assert.equal(entries[0].entry.decryptKind, "direct");
  assert.equal(entries[0].entry.peerType, "lid");
  assert.equal(entries[1].entry.decryptKind, "group");
  assert.ok(entries[1].entry.groupHash);
  const serialized = JSON.stringify(entries);
  for (const forbidden of ["123456:1@lid", GROUP]) assert.equal(serialized.includes(forbidden), false);
});

test("bootstrap timeout remains distinct from listener loss", () => {
  const observer = observerFor(new Map([[`${WORKSPACE}:${SESSION}`, { verified: true, groupIds: [GROUP] }]]));
  observer.startContinuous();
  const sock = socket();
  observer.trackSocket({ workspaceId: WORKSPACE, sessionId: SESSION, generation: 22, sock });
  attachRadarListener(observer, sock, { workspaceId: WORKSPACE, sessionId: SESSION });
  const bootstrap = observer.bootstrapObserver({ workspaceId: WORKSPACE, sessionId: SESSION, generation: 22 });
  assert.ok(bootstrap);
  bootstrap.syncState("Connecting");
  bootstrap.syncState("AwaitingInitialSync");
  bootstrap.offlineTask("queued");
  bootstrap.offlineTask("started");
  bootstrap.offlineTask("failed");
  bootstrap.recordBufferObservation({ kind: "flush_requested", reason: "initial_sync_timeout", buffering: false, pendingWorks: 0 });
  const generation = observer.status().generations[0];
  assert.equal(generation.listener.state, "ATTACHED");
  assert.equal(generation.bootstrap.synchronization.state, "AwaitingInitialSync");
  assert.equal(generation.bootstrap.offlineTasks.errors, 1);
  assert.equal(generation.distinction, "no_upsert_emit_observed_not_transport_proof");
  observer.stop("test_complete");
});

test("socket replacement detaches the old generation and keeps the deadline unchanged", () => {
  const observer = observerFor(new Map([[`${WORKSPACE}:${SESSION}`, { verified: true, groupIds: [GROUP] }]]));
  observer.startContinuous();
  const first = socket();
  const second = socket();
  observer.trackSocket({ workspaceId: WORKSPACE, sessionId: SESSION, generation: 21, sock: first });
  observer.trackSocket({ workspaceId: WORKSPACE, sessionId: SESSION, generation: 22, sock: second });
  attachRadarListener(observer, second, { workspaceId: WORKSPACE, sessionId: SESSION });
  first.ev.emit("messages.upsert", { type: "notify", messages: [message("old-generation")] });
  second.ev.emit("messages.upsert", { type: "notify", messages: [message("new-generation")] });
  const status = observer.status();
  assert.equal(status.generations.length, 1);
  assert.equal(status.generations[0].generation, 22);
  assert.equal(status.finishedGenerations.length, 1);
  assert.equal(status.finishedGenerations[0].generation, 21);
  assert.equal(status.messages.length, 1);
  assert.equal(status.messages[0].messageRef.length, 16);
  observer.stop("test_complete");
});

test("pre-ingress Radar filters distinguish valid notify, history, old and unmonitored messages", () => {
  const config = {
    monitoramentoAtivo: true,
    monitoramentoAtivadoEm: "2026-11-17T09:00:00.000Z",
    monitoramento: { horaInicial: "00:00", horaFinal: "23:59" },
    sessoesWhatsappMonitoradas: [{ sessaoId: SESSION, gruposMonitorados: [{ grupoId: GROUP }] }]
  };
  const now = new Date("2026-11-17T10:00:00.000Z");
  const common = { config, sessaoId: SESSION, grupoId: GROUP, agora: now,
    bootAtMs: Date.parse("2026-11-17T09:30:00.000Z"), mensagemTimestamp: Math.floor(now.getTime() / 1000),
    exigirMensagemNova: true };
  assert.equal(avaliarGateCapturaRadarWhatsapp({ ...common, upsertType: "notify" }).ok, true);
  assert.equal(avaliarGateCapturaRadarWhatsapp({ ...common, upsertType: "append" }).motivo, "whatsapp_upsert_historico");
  assert.equal(avaliarGateCapturaRadarWhatsapp({ ...common, grupoId: GROUP_B, upsertType: "notify" }).motivo, "grupo_whatsapp_nao_monitorado");
  assert.equal(avaliarGateCapturaRadarWhatsapp({ ...common, mensagemTimestamp: Math.floor(Date.parse("2026-11-17T08:00:00Z") / 1000), upsertType: "notify" }).motivo,
    "whatsapp_mensagem_anterior_ativacao");
});

test("continuous scopes isolate sessions/workspaces even when a group id is shared", () => {
  const scopes = new Map([
    ["radar:admin_Radar Zap Claro", { verified: true, groupIds: [GROUP] }],
    ["tele:telegram", { verified: true, groupIds: [GROUP] }],
    ["clonador:wa-clonador", { verified: true, groupIds: [GROUP] }]
  ]);
  const observer = observerFor(scopes);
  observer.startContinuous();
  const radarSock = socket();
  const teleSock = socket();
  const clonadorSock = socket();
  observer.trackSocket({ workspaceId: "radar", sessionId: "admin_Radar Zap Claro", generation: 21, sock: radarSock });
  observer.trackSocket({ workspaceId: "tele", sessionId: "telegram", generation: 1, sock: teleSock });
  observer.trackSocket({ workspaceId: "clonador", sessionId: "wa-clonador", generation: 1, sock: clonadorSock });
  attachRadarListener(observer, radarSock, { workspaceId: "radar", sessionId: "admin_Radar Zap Claro" });
  attachRadarListener(observer, teleSock, { workspaceId: "tele", sessionId: "telegram" });
  attachRadarListener(observer, clonadorSock, { workspaceId: "clonador", sessionId: "wa-clonador" });
  radarSock.ev.emit("messages.upsert", { type: "notify", messages: [message("radar-event")] });
  teleSock.ev.emit("messages.upsert", { type: "notify", messages: [message("tele-event")] });
  clonadorSock.ev.emit("messages.upsert", { type: "notify", messages: [message("clonador-event")] });
  const status = observer.status();
  assert.equal(status.scope.length, 3);
  assert.equal(status.groupStats.length, 3);
  assert.notEqual(status.groupStats[0].sessionRef, status.groupStats[1].sessionRef);
  assert.notEqual(status.groupStats[1].sessionRef, status.groupStats[2].sessionRef);
  assert.equal(status.messages.length, 3);
  observer.stop("test_complete");
});

test("configured group resolution is fail-closed and source scopes remain explicit", () => {
  const groups = resolveConfiguredObservationGroups({
    workspaceId: "radar", sessionId: SESSION, sessionBelongsToWorkspace: true, sessionWorkspaceId: "radar",
    actualGroupIds: [GROUP],
    radarConfig: { monitoramentoAtivo: true, sessoesWhatsappMonitoradas: [{ sessaoId: SESSION, gruposMonitorados: [{ remoteJid: GROUP }] }] },
    resolveRadarSessionId: value => value,
    messengerProfiles: []
  });
  assert.deepEqual(groups, [GROUP]);
  assert.deepEqual(resolveConfiguredObservationGroups({
    workspaceId: "radar", sessionId: SESSION, sessionBelongsToWorkspace: false, sessionWorkspaceId: "other",
    actualGroupIds: [GROUP], radarConfig: { monitoramentoAtivo: true,
      sessoesWhatsappMonitoradas: [{ sessaoId: SESSION, gruposMonitorados: [{ remoteJid: GROUP }] }] }
  }), []);
});
