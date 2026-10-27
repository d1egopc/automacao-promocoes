"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRadarIngressObservation, MAX_DURATION_MS, MAX_EVENTS } = require("../modules/radar/ingress-observation-v1");

const WORKSPACE = "user_k3phmbkf";
const SESSION = `${WORKSPACE}_ClaroTeste`;
const GROUP = "OP_TESTE_PRIVATE_GROUP@g.us";
const URL = "https://magazineluiza.onelink.me/589508454/new-test";

function fixture(options = {}) {
  let now = 1000;
  let clockCalls = 0;
  const timers = [];
  const sock = { ev: {} };
  const observer = createRadarIngressObservation({
    now: () => { clockCalls += 1; return now; },
    setTimer: (fn, ms) => {
      const timer = { fn, ms, cleared: false, unref() {} };
      timers.push(timer);
      return timer;
    },
    clearTimer: timer => { timer.cleared = true; },
    secret: Buffer.alloc(32, 7),
    ...options
  });
  const start = () => observer.start({ workspaceId: WORKSPACE, sessionId: SESSION, groupId: GROUP,
    sock, generation: 4, scopeValidated: true, listenerRegistered: true });
  const message = (id = "PRIVATE_MESSAGE_ID", groupId = GROUP, fromMe = false) => ({
    key: { id, remoteJid: groupId, fromMe },
    message: { conversation: `PRIVATE CONTENT ${id} ${URL}` }
  });
  return { observer, sock, timers, message, start, advance: ms => { now += ms; }, getNow: () => now, getClockCalls: () => clockCalls };
}

test("OFF and unvalidated target cannot start an observation", () => {
  const f = fixture();
  assert.deepEqual(f.observer.status(), { state: "off", events: 0, records: [], counters: {} });
  f.observer.observeWrapper({ sessionId: SESSION, sock: f.sock, emitter: f.sock.ev,
    emitterCurrent: true, callbackCurrent: true, generation: 4 });
  f.observer.observeUpsert({ workspaceId: WORKSPACE, sessionId: SESSION, sock: f.sock,
    emitter: f.sock.ev, current: true, generation: 4, messages: [], type: "notify" });
  f.observer.recordStage({ workspaceId: WORKSPACE, sessionId: SESSION, sock: f.sock,
    message: f.message(), stage: "radar_gate", decision: "accepted" });
  assert.equal(f.observer.isActiveFor({ workspaceId: WORKSPACE, sessionId: SESSION, groupId: GROUP, sock: f.sock }), false);
  assert.equal(f.observer.start({ workspaceId: WORKSPACE, sessionId: SESSION, groupId: GROUP,
    sock: f.sock, generation: 4 }).reason, "target_scope_not_validated");
  assert.equal(f.getClockCalls(), 0, "OFF path must not read the clock");
  assert.equal(f.timers.length, 0);
});

test("existing callback probe records fromMe, upsert type, URL classification and Radar result without raw data", () => {
  const f = fixture();
  assert.equal(f.start().ok, true);
  f.observer.observeWrapper({ sessionId: SESSION, sock: f.sock, emitter: f.sock.ev,
    emitterCurrent: true, callbackCurrent: true, generation: 4 });
  const message = f.message();
  f.observer.observeUpsert({ workspaceId: WORKSPACE, sessionId: SESSION, sock: f.sock,
    emitter: f.sock.ev, current: true, generation: 4, messages: [message], type: "notify" });
  f.observer.recordStage({ workspaceId: WORKSPACE, sessionId: SESSION, sock: f.sock, message,
    stage: "radar_gate", decision: "accepted", reason: "accepted", generation: 4 });
  f.observer.recordStage({ workspaceId: WORKSPACE, sessionId: SESSION, sock: f.sock, message,
    stage: "url_extraction", decision: "resolved", reason: "accepted", urls: [URL] });
  f.observer.recordStage({ workspaceId: WORKSPACE, sessionId: SESSION, sock: f.sock, message,
    stage: "marketplace_classification", decision: "resolved", reason: "accepted", urls: [URL], marketplace: "magalu" });
  f.observer.recordStage({ workspaceId: WORKSPACE, sessionId: SESSION, sock: f.sock, message,
    stage: "radar_decision", decision: "accepted", reason: "accepted", generation: 4 });
  f.observer.recordStage({ workspaceId: WORKSPACE, sessionId: SESSION, sock: f.sock, message,
    stage: "engine_event", decision: "accepted", reason: "accepted", urls: [URL], marketplace: "magalu", engineResult: "created" });

  const report = f.observer.status();
  assert.equal(report.state, "active");
  assert.equal(report.counters.wrapperCalls, 1);
  assert.equal(report.counters.callbackCalls, 1);
  assert.equal(report.counters.targetMessages, 1);
  assert.equal(report.records[0].fromMe, false);
  assert.equal(report.records[0].upsertType, "notify");
  assert.deepEqual(report.records[0].stages.map(item => item.stage), [
    "upsert_callback", "radar_gate", "url_extraction", "marketplace_classification", "radar_decision", "engine_event"
  ]);
  assert.equal(report.records[0].stages[3].marketplace, "magalu");
  assert.equal(report.records[0].stages[5].engineResult, "created");
  assert.notEqual(report.records[0].stages[2].urlHashes[0], URL);

  const serialized = JSON.stringify(report);
  for (const privateValue of [WORKSPACE, SESSION, GROUP, URL, "PRIVATE_MESSAGE_ID", "PRIVATE CONTENT"]) {
    assert.equal(serialized.includes(privateValue), false, `leaked ${privateValue}`);
  }
});

test("fromMe=true is visible at callback and Radar gate while same group stays isolated", () => {
  const f = fixture(); f.start();
  const ownMessage = f.message("OWN_MESSAGE_PRIVATE", GROUP, true);
  f.observer.observeUpsert({ workspaceId: WORKSPACE, sessionId: SESSION, sock: f.sock,
    emitter: f.sock.ev, current: true, generation: 4, messages: [ownMessage], type: "notify" });
  f.observer.recordStage({ workspaceId: WORKSPACE, sessionId: SESSION, sock: f.sock, message: ownMessage,
    stage: "radar_gate", decision: "rejected", reason: "from_me", generation: 4 });
  const record = f.observer.status().records[0];
  assert.equal(record.fromMe, true);
  assert.equal(record.stages[1].reason, "from_me");
});

test("non-target groups contribute aggregate count only and never expand capture scope", () => {
  const f = fixture(); f.start();
  const other = f.message("OTHER_MESSAGE_PRIVATE", "OTHER_PRIVATE_GROUP@g.us", false);
  f.observer.observeUpsert({ workspaceId: WORKSPACE, sessionId: SESSION, sock: f.sock,
    emitter: f.sock.ev, current: true, generation: 4, messages: [other], type: "notify" });
  const report = f.observer.status();
  assert.equal(report.counters.nonTargetMessages, 1);
  assert.equal(report.counters.nonTargetGroups, 1);
  assert.equal(report.counters.nonGroupMessages, 0);
  assert.equal(report.events, 0);
  assert.equal(JSON.stringify(report).includes("OTHER_PRIVATE_GROUP"), false);
  assert.equal(JSON.stringify(report).includes("OTHER_MESSAGE_PRIVATE"), false);
});

test("wrong workspace, stale socket, emitter and generation are distinguished without retaining messages", () => {
  const f = fixture(); f.start();
  const message = f.message("STALE_PRIVATE_MESSAGE");
  f.observer.observeUpsert({ workspaceId: "other_private_workspace", sessionId: SESSION, sock: {},
    emitter: {}, current: false, generation: 3, messages: [message], type: "append" });
  const report = f.observer.status();
  assert.equal(report.counters.workspaceMismatch, 1);
  assert.equal(report.counters.staleSocket, 1);
  assert.equal(report.counters.staleGeneration, 1);
  assert.equal(report.events, 0);
  assert.equal(JSON.stringify(report).includes("other_private_workspace"), false);
});

test("observation stops at five minutes, caps at ten target events, and manual stop retains a bounded report", () => {
  const f = fixture({ maxDurationMs: MAX_DURATION_MS + 10_000, maxEvents: MAX_EVENTS + 10 });
  assert.equal(f.start().maxEvents, 10);
  for (let i = 0; i < 10; i += 1) {
    const message = f.message(`MESSAGE_${i}`);
    f.observer.observeUpsert({ workspaceId: WORKSPACE, sessionId: SESSION, sock: f.sock,
      emitter: f.sock.ev, current: true, generation: 4, messages: [message], type: "notify" });
    f.observer.recordStage({ workspaceId: WORKSPACE, sessionId: SESSION, sock: f.sock, message,
      stage: "radar_decision", decision: "ignored", reason: "from_me" });
  }
  assert.equal(f.observer.status().state, "stopped");
  assert.equal(f.observer.status().stopReason, "event_limit");
  assert.equal(f.observer.status().events, 10);

  const g = fixture({ maxDurationMs: 100 }); g.start(); g.advance(100);
  assert.equal(g.observer.status().state, "expired");
  assert.equal(g.observer.status().stopReason, "expired");
  g.advance(15 * 60 * 1000);
  assert.equal(g.observer.status().state, "off", "report is cleared after its retention window");
  assert.equal(f.observer.stop("manual").state, "stopped");
  assert.equal(createRadarIngressObservation().status().state, "off", "process restart starts OFF");
});

test("manual stop rejects new ingress but permits a late stage only for a previously captured event", () => {
  const f = fixture(); f.start();
  const message = f.message("CAPTURED_MESSAGE");
  f.observer.observeUpsert({ workspaceId: WORKSPACE, sessionId: SESSION, sock: f.sock,
    emitter: f.sock.ev, current: true, generation: 4, messages: [message], type: "notify" });
  f.observer.stop("manual");
  const other = f.message("UNCAPTURED_MESSAGE");
  assert.equal(f.observer.observeUpsert({ workspaceId: WORKSPACE, sessionId: SESSION, sock: f.sock,
    emitter: f.sock.ev, current: true, generation: 4, messages: [other], type: "notify" }), null);
  assert.equal(f.observer.recordStage({ workspaceId: WORKSPACE, sessionId: SESSION, sock: f.sock,
    message, stage: "engine_event", decision: "accepted", reason: "accepted", engineResult: "created" }), true);
  assert.equal(f.observer.recordStage({ workspaceId: WORKSPACE, sessionId: SESSION, sock: f.sock,
    message: other, stage: "engine_event", decision: "accepted", reason: "accepted", engineResult: "created" }), false);
  assert.equal(f.observer.status().records[0].stages.at(-1).stage, "engine_event");
  assert.equal(JSON.stringify(f.observer.status()).includes("UNCAPTURED_MESSAGE"), false);
});

test("probe uses the existing upsert callback hook and adds no listener or persistent I/O", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  const moduleSource = fs.readFileSync(path.join(__dirname, "..", "modules/radar/ingress-observation-v1.js"), "utf8");
  const callbackStart = source.indexOf('evento: "messages.upsert"');
  const callbackEnd = source.indexOf('sock.ev.on("group-participants.update"', callbackStart);
  assert.ok(callbackStart >= 0 && callbackEnd > callbackStart);
  const existingListener = source.slice(callbackStart, callbackEnd);
  assert.match(existingListener, /onInvoke:/);
  assert.match(existingListener, /radarIngressObservation\.observeWrapper/);
  assert.match(existingListener, /radarIngressObservation\.observeUpsert/);
  assert.doesNotMatch(moduleSource, /\.on\s*\(|\.addListener\s*\(|writeFile|appendFile|fetch\s*\(|axios\./);

  const routeStart = source.indexOf('app.get("/admin/radar/ingress-observation"');
  const routeEnd = source.indexOf('app.post("/radar/config"', routeStart);
  assert.ok(routeStart >= 0 && routeEnd > routeStart);
  const adminRoutes = source.slice(routeStart, routeEnd);
  const targetConfig = source.slice(source.indexOf("const RADAR_INGRESS_OBSERVATION_TARGET"), routeStart);
  assert.equal((adminRoutes.match(/exigirAdminMasterEngine\(req, res\)/g) || []).length, 3);
  assert.match(targetConfig, /workspaceId: "user_k3phmbkf"/);
  assert.match(targetConfig, /groupName: "optesteradar"/);
  assert.doesNotMatch(targetConfig, /sessionId:.*ClaroTeste|sessionId:.*ServCel/);
  assert.match(targetConfig, /item\?\.sessaoId/);
  assert.match(targetConfig, /resolverSessaoWhatsappRadarCliente\("admin", sessionInput\)/);
  assert.match(targetConfig, /metadata\.workspaceId !== workspaceId/);
  assert.match(targetConfig, /listener_registration_unverified/);
  assert.match(targetConfig, /listener_attachment_missing/);
});

test("target binding uses the configured OP Teste Radar session and rejects a different workspace", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  const start = source.indexOf("const RADAR_INGRESS_OBSERVATION_TARGET");
  const end = source.indexOf("function responderObservacaoIngressRadar", start);
  assert.ok(start >= 0 && end > start);

  const configuredSessionId = "persisted-radar-session";
  const socket = { ev: {} };
  socket.__optimusListeners = {
    "messages.upsert": { emissor: socket.ev, evento: "messages.upsert", handler() {} }
  };
  const config = {
    monitoramentoAtivo: true,
    sessoesWhatsappMonitoradas: [{
      sessaoId: configuredSessionId,
      gruposMonitorados: [{
        nome: "OP Teste Radar",
        ativo: true,
        remoteJid: "fixture-group@g.us"
      }]
    }]
  };

  function validate(workspaceId) {
    const metadata = { workspaceId, clienteId: workspaceId };
    const context = {
      carregarRadarConfigCliente: () => config,
      normalizarTexto: value => String(value || "").toLowerCase().replace(/[^a-z0-9]/g, ""),
      obterGrupoWhatsappIdTecnicoRadar: group => group.remoteJid,
      resolverSessaoWhatsappRadarCliente: (_admin, input) => input,
      sessoesMeta: { [configuredSessionId]: metadata },
      resolverClienteMensageiroPorSessao: () => ({ clienteIdMensageiro: workspaceId }),
      sessoes: { [configuredSessionId]: socket },
      statusSessao: { [configuredSessionId]: "open" },
      socketEhAtual: () => true,
      geracoesSocketWhatsapp: { [configuredSessionId]: 3 }
    };
    vm.runInNewContext(source.slice(start, end) + "; this.validateBinding = validarAlvoObservacaoIngressRadar;", context);
    return context.validateBinding();
  }

  const valid = validate(WORKSPACE);
  assert.equal(valid.ok, true);
  assert.equal(valid.sessionId, configuredSessionId);
  assert.equal(valid.groupId, "fixture-group@g.us");

  const mismatch = validate("different-workspace");
  assert.deepEqual(
    { ok: mismatch.ok, reason: mismatch.reason },
    { ok: false, reason: "session_workspace_mismatch" }
  );
});
