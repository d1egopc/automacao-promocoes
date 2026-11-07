"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const {
  createIngressBoundaryObservation,
  resolveConfiguredObservationGroups,
  MAX_CONTINUOUS_GENERATIONS,
  MAX_CONTINUOUS_MESSAGES,
  MAX_CONTINUOUS_SCOPES,
  MAX_GROUP_IDS_PER_SCOPE,
  MAX_GROUP_ROWS
} = require("../modules/whatsapp/ingress-boundary-observation");
const GROUP_A = "120363408782037034@g.us";
const GROUP_B = "120363429821085702@g.us";
const GROUP_C = "120363428838923822@g.us";

function socket() {
  const ev = new EventEmitter();
  ev.isBuffering = () => false;
  const ws = new EventEmitter();
  return { ev, ws, __optimusListeners: { "messages.upsert": { emissor: ev, handler: () => {} } } };
}

function message(id, group, fromMe = false) {
  return { key: { id, remoteJid: group, fromMe }, message: { conversation: "PRIVATE MESSAGE BODY MUST NEVER BE STORED" } };
}

test("continuous observer is OFF until started and obtains scopes from the live resolver", () => {
  const observer = createIngressBoundaryObservation({ resolveContinuousScope: ({ workspaceId, sessionId }) =>
    workspaceId === "tenant-a" && sessionId === "wa-a" ? { verified: true, groupIds: [GROUP_A] } : { verified: false, groupIds: [] } });
  assert.equal(observer.status().state, "off");
  assert.ok(MAX_CONTINUOUS_GENERATIONS > 0 && MAX_CONTINUOUS_MESSAGES > 0 && MAX_GROUP_ROWS > 0);
  observer.startContinuous();
  assert.equal(observer.status().coverageState, "DEGRADED_JOURNAL", "no persistent sink must never look fully covered");
  assert.equal(observer.trackSocket({ workspaceId: "tenant-a", sessionId: "wa-a", generation: 1, sock: socket() }), true);
  assert.equal(observer.status().scope.length, 1);
  assert.equal(observer.trackSocket({ workspaceId: "tenant-b", sessionId: "wa-b", generation: 1, sock: socket() }), false);
  observer.stop("test_complete");
});

test("configured scope is tenant-isolated, supports new workspaces, and fails closed on stale or invalid associations", () => {
  const shared = GROUP_A;
  const radarConfig = { monitoramentoAtivo: true, sessoesWhatsappMonitoradas: [
    { sessaoId: "wa-a", gruposMonitorados: [{ remoteJid: GROUP_A, ativo: true }, { remoteJid: GROUP_B, ativo: true }] },
    { sessaoId: "wa-old", gruposMonitorados: [{ remoteJid: GROUP_C, ativo: true }] }
  ] };
  const profiles = [
    { workspaceId: "tenant-a", sessionId: "wa-a", active: true, destinations: [shared], cards: { commands: { active: true, configuration: { grupos: [shared], gruposConfigurados: true } } } },
    { workspaceId: "tenant-b", sessionId: "wa-b", active: true, destinations: [shared], cards: { welcome: { active: true, configuration: { grupos: [shared], gruposConfigurados: true } } } },
    { workspaceId: "tenant-c", sessionId: "wa-c", active: true, destinations: [GROUP_C], cards: { farewell: { active: false, configuration: { grupos: [GROUP_C], gruposConfigurados: true } } } }
  ];
  const resolve = (workspaceId, sessionId, actualGroupIds, config = radarConfig) => resolveConfiguredObservationGroups({
    workspaceId, sessionId, sessionBelongsToWorkspace: true, sessionWorkspaceId: workspaceId, actualGroupIds,
    radarConfig: config, resolveRadarSessionId: value => value, messengerProfiles: profiles.filter(row => row.workspaceId === workspaceId)
  });
  assert.deepEqual(resolve("tenant-a", "wa-a", [GROUP_A, GROUP_B]), [GROUP_A, GROUP_B]);
  assert.deepEqual(resolve("tenant-b", "wa-b", [shared]), [shared]);
  assert.deepEqual(resolve("tenant-a", "wa-a", [GROUP_A]), [GROUP_A], "removed group drops from the socket's actual membership");
  assert.deepEqual(resolve("tenant-a", "wa-new", [GROUP_A]), [], "a changed session cannot inherit the old session scope");
  assert.deepEqual(resolve("tenant-a", "wa-a", [GROUP_A], { monitoramentoAtivo: false, sessoesWhatsappMonitoradas: [] }), [shared], "Radar can be off while an explicitly active Messenger profile remains scoped");
  assert.deepEqual(resolveConfiguredObservationGroups({ workspaceId: "tenant-a", sessionId: "wa-a", sessionBelongsToWorkspace: false,
    sessionWorkspaceId: "tenant-b", actualGroupIds: [GROUP_A], radarConfig, messengerProfiles: profiles }), [], "workspace divergence fails closed");
  assert.deepEqual(resolveConfiguredObservationGroups({ workspaceId: "tenant-c", sessionId: "wa-c", sessionBelongsToWorkspace: true,
    sessionWorkspaceId: "tenant-c", actualGroupIds: ["not-a-jid"], radarConfig: { monitoramentoAtivo: "true" }, messengerProfiles: profiles }), [], "invalid JIDs and non-boolean activation fail closed");
  assert.deepEqual(resolveConfiguredObservationGroups({ workspaceId: "tenant-a", sessionId: "wa-a", sessionBelongsToWorkspace: true,
    sessionWorkspaceId: "tenant-a", actualGroupIds: [GROUP_A], radarConfig: { monitoramentoAtivo: true, sessaoWhatsappId: "wa-a",
      sessoesWhatsappMonitoradas: [{ sessaoId: "wa-ambiguous", gruposMonitorados: [{ remoteJid: GROUP_A }] }],
      gruposMonitorados: [{ remoteJid: GROUP_A }] } }), [], "legacy fallback cannot bypass an unresolved explicit session selection");
  const oversizedGroups = Array.from({ length: MAX_GROUP_IDS_PER_SCOPE + 1 }, (_, index) => `120363${String(index).padStart(15, "0")}@g.us`);
  assert.deepEqual(resolveConfiguredObservationGroups({ workspaceId: "tenant-a", sessionId: "wa-a", sessionBelongsToWorkspace: true,
    sessionWorkspaceId: "tenant-a", actualGroupIds: oversizedGroups, radarConfig: { monitoramentoAtivo: true,
      sessoesWhatsappMonitoradas: [{ sessaoId: "wa-a", gruposMonitorados: oversizedGroups.map(remoteJid => ({ remoteJid })) }] } }), [],
    "an oversized group scope fails closed instead of silently observing only a subset");
  assert.deepEqual(resolveConfiguredObservationGroups({ workspaceId: "tenant-a", sessionId: "wa-a", sessionBelongsToWorkspace: true,
    sessionWorkspaceId: "tenant-a", actualGroupIds: [GROUP_A], radarConfig: { monitoramentoAtivo: true, sessaoWhatsappId: "wa-a",
      gruposMonitorados: [{ remoteJid: "invalid", jid: GROUP_A }] } }), [GROUP_A], "a valid exact group JID is found without trusting another identifier field");
  const laterWorkspace = { workspaceId: "tenant-new", sessionId: "wa-new", active: true, destinations: [GROUP_C], cards: { groupManager: { active: true, configuration: { grupos: [GROUP_C], gruposConfigurados: true } } } };
  assert.deepEqual(resolveConfiguredObservationGroups({ workspaceId: "tenant-new", sessionId: "wa-new", sessionBelongsToWorkspace: true,
    sessionWorkspaceId: "tenant-new", actualGroupIds: [GROUP_C], messengerProfiles: [laterWorkspace] }), [GROUP_C], "new configured workspace is resolved without a static allowlist");
});

test("journal startup is reported separately until persistent coverage is ready", async () => {
  let resolveOpen;
  let available = false;
  const journal = {
    open: () => new Promise(resolve => { resolveOpen = resolve; }),
    status: () => ({ available, failed: false, dropped: 0, queued: 0, bytes: 0, maxBytes: 2 * 1024 * 1024, retentionMs: 72 * 60 * 60 * 1000 }),
    append: () => true,
    close: async () => {}
  };
  const observer = createIngressBoundaryObservation({ journal, resolveContinuousScope: ({ workspaceId, sessionId }) =>
    workspaceId === "admin" && sessionId === "admin_Zoiao Claro" ? { verified: true, groupIds: [GROUP_A, GROUP_B] } : { verified: false, groupIds: [] } });
  observer.startContinuous();
  await Promise.resolve();
  assert.equal(observer.status().coverageState, "STARTING_JOURNAL");
  available = true;
  resolveOpen(true);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(observer.status().coverageState, "WAITING_FOR_SOCKET");
  observer.stop("test_complete");
});

test("continuous stages correlate notify/append, fromMe, Radar and Messenger without raw identifiers", () => {
  const persisted = [];
  const journal = { open: async () => true, append: value => { persisted.push(value); return true; }, status: () => ({ available: true, maxBytes: 2 * 1024 * 1024, retentionMs: 72 * 60 * 60 * 1000 }) };
  const observer = createIngressBoundaryObservation({ journal, resolveContinuousScope: ({ workspaceId, sessionId }) =>
    workspaceId === "admin" && sessionId === "admin_Zoiao Claro" ? { verified: true, groupIds: [GROUP_A] } : { verified: false, groupIds: [] } });
  assert.equal(observer.startContinuous().ok, true);
  const sock = socket();
  assert.equal(observer.trackSocket({ workspaceId: "admin", sessionId: "admin_Zoiao Claro", generation: 1, sock }), true);
  const rawMessageId = "msg-node-to-upsert";
  sock.ws.emit("CB:message", { tag: "message", attrs: { from: GROUP_A, id: rawMessageId } });
  const handler = ({ messages, type }) => {
    observer.mark("callback", { workspaceId: "admin", sessionId: "admin_Zoiao Claro", sock, emitter: sock.ev, messages, upsertType: type });
    for (const item of messages) {
      observer.mark("listener", { workspaceId: "admin", sessionId: "admin_Zoiao Claro", sock, emitter: sock.ev, message: item });
      observer.mark("radar", { workspaceId: "admin", sessionId: "admin_Zoiao Claro", sock, emitter: sock.ev, message: item });
      observer.mark("result", { workspaceId: "admin", sessionId: "admin_Zoiao Claro", sock, emitter: sock.ev, message: item, decision: "accepted", reason: "accepted" });
      observer.mark("mensageiro_gerente", { workspaceId: "admin", sessionId: "admin_Zoiao Claro", sock, emitter: sock.ev, message: item, decision: "ignored", reason: "ignored" });
    }
  };
  sock.ev.on("messages.upsert", handler);
  sock.ev.emit("messages.upsert", { type: "notify", messages: [message(rawMessageId, GROUP_A, false)] });
  sock.ev.emit("messages.upsert", { type: "notify", messages: [message("msg-a", GROUP_A, false)] });
  sock.ev.emit("messages.upsert", { type: "append", messages: [message("msg-b", GROUP_A, true)] });

  const status = observer.status();
  assert.equal(status.state, "active");
  assert.equal(status.mode, "continuous");
  assert.equal(status.expiresAt, null);
  assert.equal(status.generations[0].counters.callbackCalls, 3);
  assert.equal(status.generations[0].counters.radarEntries, 3);
  assert.equal(status.generations[0].counters.mensageiroGerenteCalls, 3);
  assert.equal(status.groupStats[0].counts.upsertNotify, 2);
  assert.equal(status.groupStats[0].counts.upsertAppend, 1);
  assert.equal(status.groupStats[0].counts.fromMeFalse, 2);
  assert.equal(status.groupStats[0].counts.fromMeTrue, 1);
  assert.equal(status.messages.length, 3);
  assert.ok(status.messages.every(row => /^[a-f0-9]{16}$/.test(row.messageRef) && !JSON.stringify(row).includes("120363")));
  const serialized = JSON.stringify({ status, persisted });
  for (const forbidden of [GROUP_A, "admin_Zoiao Claro", "msg-a", "PRIVATE MESSAGE BODY"]) assert.equal(serialized.includes(forbidden), false, forbidden);
  assert.ok(persisted.some(row => row.stage === "radar_result" && row.decision === "accepted"));
  assert.ok(persisted.some(row => row.stage === "mensageiro_gerente" && row.decision === "ignored"));
  const messageNode = persisted.find(row => row.stage === "message_node");
  const emitAttempt = persisted.find(row => row.stage === "emit_attempt" && row.eventRef === messageNode?.eventRef);
  assert.match(messageNode?.eventRef || "", /^[a-f0-9]{16}$/);
  assert.ok(emitAttempt, "the sanitized node identity must correlate with the later messages.upsert emission");
  assert.equal(JSON.stringify({ messageNode, emitAttempt }).includes(rawMessageId), false);
  assert.equal(status.groupStats[0].sessionRef, persisted.find(row => row.stage === "callback").sessionRef);
  assert.equal(status.groupStats[0].groupRef, status.scope[0].groups.find(ref => ref === status.groupStats[0].groupRef));
  observer.stop("test_complete");
  assert.equal(observer.status().state, "stopped");
});

test("target scope fails closed across tenants, sessions and non-group JIDs", () => {
  const observer = createIngressBoundaryObservation({ resolveContinuousScope: ({ workspaceId, sessionId }) =>
    workspaceId === "tenant-a" && sessionId === "wa-a" ? { verified: true, groupIds: [GROUP_A] } : { verified: false, groupIds: [] } });
  observer.startContinuous();
  const sock = socket();
  assert.equal(observer.trackSocket({ workspaceId: "tenant-b", sessionId: "wa-a", generation: 1, sock }), false);
  assert.equal(observer.trackSocket({ workspaceId: "tenant-a", sessionId: "wa-other", generation: 1, sock }), false);
  assert.equal(observer.trackSocket({ workspaceId: "tenant-a", sessionId: "wa-a", generation: 1, sock }), true);
  assert.equal(observer.trackSocket({ workspaceId: "tenant-a", sessionId: "wa-empty", generation: 2, sock: socket() }), false,
    "a valid owner without configured/observed groups does not attach instrumentation");
  const before = observer.status().generations[0].counters.emitAttempts;
  sock.ev.emit("messages.upsert", { type: "notify", messages: [message("private", "15551234567@s.whatsapp.net")] });
  assert.equal(observer.status().generations[0].counters.emitAttempts, before, "unconfigured one-to-one chats are not included in the monitoring counters");
  assert.equal(observer.status().messages.length, 0);
  observer.stop("test_complete");
});

test("an owned session with no active group selection remains uninstrumented", () => {
  const observer = createIngressBoundaryObservation({ resolveContinuousScope: ({ sessionId }) =>
    ({ verified: true, groupIds: sessionId === "wa-active" ? [GROUP_A] : [] }) });
  observer.startContinuous();
  assert.equal(observer.trackSocket({ workspaceId: "tenant-a", sessionId: "wa-active", generation: 1, sock: socket() }), true);
  assert.equal(observer.trackSocket({ workspaceId: "tenant-a", sessionId: "wa-empty", generation: 1, sock: socket() }), false);
  assert.equal(observer.status().generations.length, 1);
  observer.stop("test_complete");
});

test("a generation initially outside the resolved scope is attached after group refresh", () => {
  let resolved = false;
  const persisted = [];
  const observer = createIngressBoundaryObservation({
    journal: { append: value => persisted.push(value), status: () => ({ available: true, failed: false, dropped: 0, maxBytes: 2 * 1024 * 1024, retentionMs: 72 * 60 * 60 * 1000 }) },
    resolveContinuousScope: ({ workspaceId, sessionId }) =>
      workspaceId === "tenant-a" && sessionId === "wa-a" && resolved
        ? { verified: true, groupIds: [GROUP_A] }
        : { verified: false, groupIds: [] }
  });
  observer.startContinuous();
  const sock = socket();
  assert.equal(observer.trackSocket({ workspaceId: "tenant-a", sessionId: "wa-a", generation: 1, sock }), false);
  assert.equal(observer.status().generations.length, 0);

  // This models the post-connect group refresh in carregarGruposSessao.
  resolved = true;
  assert.equal(observer.trackSocket({ workspaceId: "tenant-a", sessionId: "wa-a", generation: 1, sock }), true);
  sock.ev.on("messages.upsert", ({ messages, type }) => {
    observer.mark("callback", { workspaceId: "tenant-a", sessionId: "wa-a", sock, emitter: sock.ev, messages, upsertType: type });
  });
  sock.ev.emit("messages.upsert", { type: "notify", messages: [message("late-scope", GROUP_A)] });
  const status = observer.status();
  assert.equal(status.generations[0].generation, 1);
  assert.equal(status.generations[0].counters.callbackCalls, 1);
  assert.ok(persisted.some(row => row.stage === "callback"));
  observer.stop("test_complete");
});

test("dynamic group changes apply without restart and socket replacement detaches old wrappers", () => {
  let now = 1000;
  let groups = [GROUP_A];
  const observer = createIngressBoundaryObservation({ now: () => now, resolveContinuousScope: ({ workspaceId, sessionId }) =>
    workspaceId === "tenant-a" && sessionId === "wa-a" ? { verified: true, groupIds: groups } : { verified: false, groupIds: [] } });
  observer.startContinuous();
  const first = socket();
  const originalEmit = first.ev.emit;
  observer.trackSocket({ workspaceId: "tenant-a", sessionId: "wa-a", generation: 1, sock: first });
  first.ev.on("messages.upsert", ({ messages, type }) => observer.mark("callback", { workspaceId: "tenant-a", sessionId: "wa-a", sock: first, emitter: first.ev, messages, upsertType: type }));
  groups = [GROUP_B];
  first.ev.emit("messages.upsert", { type: "notify", messages: [message("removed", GROUP_A)] });
  assert.equal(observer.status().messages.length, 0, "removed target is rejected immediately from the refreshed resolver");
  first.ev.emit("messages.upsert", { type: "notify", messages: [message("added", GROUP_B)] });
  const second = socket();
  observer.trackSocket({ workspaceId: "tenant-a", sessionId: "wa-a", generation: 2, sock: second });
  assert.equal(first.ev.emit, originalEmit);
  now += 60 * 60 * 1000;
  second.ev.emit("messages.upsert", { type: "notify", messages: [message("after-hour", GROUP_B)] });
  const status = observer.status();
  assert.equal(status.state, "active");
  assert.equal(status.generations.length, 1);
  assert.equal(status.generations[0].generation, 2);
  assert.equal(status.finishedGenerations[0].generation, 1);
  observer.stop("test_complete");
});

test("configured scope capacity is bounded and reports degraded coverage", () => {
  const resolved = new Map();
  const observer = createIngressBoundaryObservation({ journal: { status: () => ({ available: true, failed: false, dropped: 0, maxBytes: 2 * 1024 * 1024, retentionMs: 72 * 60 * 60 * 1000 }) }, resolveContinuousScope: ({ workspaceId, sessionId }) => {
    const key = `${workspaceId}:${sessionId}`;
    if (!resolved.has(key)) resolved.set(key, { verified: true, groupIds: [GROUP_A] });
    return resolved.get(key);
  } });
  observer.startContinuous();
  for (let index = 0; index <= MAX_CONTINUOUS_GENERATIONS; index++) {
    observer.trackSocket({ workspaceId: `tenant-${index}`, sessionId: `wa-${index}`, generation: 1, sock: socket() });
  }
  const status = observer.status();
  assert.equal(status.scope.length, MAX_CONTINUOUS_SCOPES);
  assert.equal(status.scopesDropped, 1);
  assert.equal(status.coverageState, "DEGRADED_OBSERVER_CAPACITY");
  observer.stop("test_complete");
});
