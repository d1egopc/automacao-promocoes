"use strict";

const assert = require("node:assert/strict");
const { createGerenteObservabilityV2, MAX_BUFFER_BYTES } = require("../modules/mensageiro/gerente-observability-v2");
const { createOperationalIngress, selectProfile } = require("../modules/mensageiro-v3/operational-gates");
const { createGerenteObservabilityV2Routes } = require("../modules/mensageiro/gerente-observability-v2.routes");
const { criarAdminMasterEstrito } = require("../utils/admin-auth-estrito");

const target = {
  workspaceId: "user_k3phmbkf",
  sessionId: "user_k3phmbkf_ClaroTeste",
  groupId: "120363000000000000@g.us"
};
const runId = "713f90be-4ebf-4c2c-9fd9-69a6586dfdd1";

function makeController(options = {}) {
  let now = 1_798_000_000_000;
  const timers = [];
  const controller = createGerenteObservabilityV2({
    validateTarget: options.validateTarget || (() => true),
    clock: () => now,
    monotonicClock: options.monotonicClock || (() => now),
    setTimer: (fn, ms) => { const timer = { fn, ms, unref() {} }; timers.push(timer); return timer; },
    clearTimer: timer => { timer.cleared = true; },
    randomBytes: () => Buffer.alloc(32, 7)
  });
  return { controller, timers, advance(ms) { now += ms; }, now: () => now };
}

function start(controller, overrides = {}) {
  return controller.start({ ...target, durationMs: 15_000, maxEvents: 10, runId, ...overrides });
}

function sensitiveScan(records) {
  const serialized = JSON.stringify(records);
  for (const forbidden of [target.workspaceId, target.sessionId, target.groupId, "5511999999999", "vt.tiktok.com", "secret-token", "mensagem privada"]) {
    assert.equal(serialized.includes(forbidden), false, `sensitive_value_leaked:${forbidden}`);
  }
  return serialized;
}

async function main() {
  {
    let monotonicReads = 0;
    const { controller } = makeController({ monotonicClock: () => { monotonicReads += 1; return 1; } });
    assert.equal(controller.isActiveFor(target), false);
    assert.equal(monotonicReads, 0, "off_path_must_not_read_monotonic_clock");
    controller.dispose();
  }

  {
    function inactiveProfileCounter() {
      let sessionReads = 0;
      const profile = new Proxy({
        id: "inactive-profile",
        workspaceId: target.workspaceId,
        sessionId: target.sessionId,
        active: false,
        cards: {},
        destinations: [target.groupId]
      }, {
        get(object, key, receiver) {
          if (key === "sessionId") sessionReads += 1;
          return Reflect.get(object, key, receiver);
        }
      });
      const store = {
        reload() {},
        snapshot() { return { workspaces: { [target.workspaceId]: { profiles: { p1: profile } } } }; }
      };
      return { store, sessionReads: () => sessionReads };
    }
    const off = inactiveProfileCounter();
    const offResult = selectProfile(off.store, {
      workspaceId: target.workspaceId, sessionId: target.sessionId,
      card: "groupManager", groupId: target.groupId
    });
    assert.deepEqual(offResult, { profileId: "", reason: "PERFIL_INATIVO" });
    assert.equal(off.sessionReads(), 1, "off_path_must_not_scan_inactive_candidates_again");

    const on = inactiveProfileCounter();
    const observations = [];
    const onResult = selectProfile(on.store, {
      workspaceId: target.workspaceId, sessionId: target.sessionId,
      card: "groupManager", groupId: target.groupId,
      diagnostic: item => observations.push(item)
    });
    assert.deepEqual(onResult, offResult);
    assert.equal(on.sessionReads(), 2, "diagnostic_candidate_scan_runs_only_when_enabled");
    assert.deepEqual(observations, [{ reason: "PERFIL_INATIVO", profileId: "inactive-profile" }]);
  }

  {
    const { controller } = makeController();
    assert.equal(controller.status().state, "off");
    assert.deepEqual(start(controller).ok, true);
    const capture = controller.beginEvent({ ...target, messageId: "baileys-message-id" });
    assert.equal(typeof capture, "function");
    assert.equal(capture("ingress", "received", { result: "ok" }), true);
    assert.equal(capture("profile_selection", "profile_selected", { profileId: "profile-secret-id", result: "ok" }), true);
    assert.equal(capture("rule_evaluation", "rule_match", { profileId: "profile-secret-id", ruleId: "rule-secret-id", result: "ok" }), true);
    assert.equal(capture("exemption", "sender_not_exempt", { result: "ok" }), true);
    assert.equal(capture("bot_admin", "bot_admin", { result: "ok" }), true);
    assert.equal(capture("delete_attempt", "delete_started", { result: "unknown" }), true);
    assert.equal(capture("delete_result", "delete_succeeded", { result: "ok", durationMs: 14 }), true);
    assert.equal(controller.beginEvent({ ...target, groupId: "another-group@g.us", messageId: "x" }), null);
    const records = controller.readEvents(runId);
    assert.equal(records.length, 7);
    assert.equal(new Set(records.map(record => record.eventHash)).size, 1);
    assert.notEqual(records[0].groupHash, target.groupId);
    assert.equal(sensitiveScan(records).length < MAX_BUFFER_BYTES, true);
    controller.dispose();
  }

  {
    const { controller } = makeController();
    start(controller);
    const traceThatThrows = () => { throw new Error("diagnostic_failure"); };
    const profile = {
      id: "p1", workspaceId: target.workspaceId, sessionId: target.sessionId, active: true,
      destinations: [target.groupId],
      cards: { groupManager: { active: true, configuration: { grupos: [target.groupId] } } }
    };
    const store = { reload() {}, snapshot() { return { workspaces: { [target.workspaceId]: { profiles: { p1: profile } } } }; } };
    let dispatched = false;
    const ingress = createOperationalIngress({
      store,
      bridge: { async dispatch() { dispatched = true; return { ok: true, result: { allowed: true } }; } }
    });
    const result = await ingress({
      workspaceId: target.workspaceId, sessionId: target.sessionId, card: "groupManager",
      message: { key: { id: "diagnostic-failure", remoteJid: target.groupId } }, sock: {}, planAllowed: true,
      diagnosticV2: traceThatThrows
    });
    assert.equal(dispatched, true);
    assert.deepEqual(result, { allowed: true });
    controller.dispose();
  }

  {
    const { controller } = makeController({ validateTarget: () => false });
    assert.equal(start(controller).code, "target_not_in_v3_scope");
    assert.equal(controller.status().state, "off");
  }

  {
    const { controller } = makeController();
    assert.equal(controller.start({ ...target, durationMs: 900_001, maxEvents: 1, runId }).code, "invalid_target_or_limits");
    assert.equal(controller.start({ ...target, durationMs: 15_000, maxEvents: 11, runId }).code, "invalid_target_or_limits");
    assert.equal(controller.start({ ...target, durationMs: 15_000, maxEvents: 1, runId, extra: "no" }).code, "invalid_request");
    assert.equal(start(controller).ok, true);
    assert.equal(start(controller, { runId: "eebff7f1-c107-4fd1-9bad-81c4f283f1ef" }).code, "diagnostic_already_active");
    assert.equal(controller.beginEvent({ ...target, workspaceId: "other", messageId: "x" }), null);
    assert.equal(controller.beginEvent({ ...target, sessionId: "other", messageId: "x" }), null);
    assert.equal(controller.beginEvent({ ...target, groupId: "other@g.us", messageId: "x" }), null);
    controller.dispose();
  }

  {
    const { controller, advance, timers } = makeController();
    start(controller, { durationMs: 1000, maxEvents: 1 });
    timers[0].fn();
    assert.equal(controller.status().state, "finished");
    assert.equal(controller.status().stopReason, "time_limit");
    controller.dispose();
  }

  {
    const { controller, advance } = makeController();
    start(controller, { durationMs: 1000, maxEvents: 1 });
    const capture = controller.beginEvent({ ...target, messageId: "msg" });
    capture("delete_result", "delete_succeeded", { result: "ok" });
    advance(1001);
    assert.equal(controller.status().state, "finished");
    assert.equal(controller.status().stopReason, "time_limit");
    assert.equal(controller.readEvents(runId).length, 1);
    assert.equal(controller.beginEvent({ ...target, messageId: "late" }), null);
    controller.dispose();
  }

  {
    const { controller } = makeController();
    start(controller);
    const capture = controller.beginEvent({ ...target, messageId: "msg" });
    assert.equal(capture("delete_result", "delete_succeeded", { message: "private text", result: "ok" }), true);
    const stopped = controller.stop(runId);
    assert.equal(stopped.ok, true);
    assert.equal(stopped.status.stopReason, "admin_stop");
    assert.equal(stopped.events.length, 1);
    assert.equal(controller.status().state, "finished");
    sensitiveScan(stopped.events);
    controller.dispose();
  }

  {
    const { controller } = makeController();
    start(controller, { maxEvents: 1 });
    const capture = controller.beginEvent({ ...target, messageId: "first" });
    assert.equal(capture("ingress", "received"), true);
    assert.equal(controller.beginEvent({ ...target, messageId: "second" }), null);
    assert.equal(controller.status().stopReason, "event_limit");
    assert.equal(controller.readEvents(runId).length, 1);
    controller.dispose();
  }

  {
    const { controller } = makeController();
    start(controller, { maxEvents: 10 });
    for (let eventIndex = 0; eventIndex < 10; eventIndex += 1) {
      const capture = controller.beginEvent({ ...target, messageId: `bounded-${eventIndex}` });
      assert.equal(typeof capture, "function");
      capture("ingress", "received");
      capture("session_workspace", "resolved");
      capture("group_resolution", "resolved");
      capture("socket_guard", "socket_current");
      capture("profile_selection", "profile_selected", { profileId: `profile-${eventIndex}` });
      capture("card_scope", "profile_selected", { profileId: `profile-${eventIndex}` });
      capture("handler_result", "handler_called", { profileId: `profile-${eventIndex}` });
      capture("rule_evaluation", "rule_match", { profileId: `profile-${eventIndex}`, ruleId: "rule" });
      capture("exemption", "sender_not_exempt");
      capture("bot_admin", "bot_admin", { durationMs: 7 });
      capture("delete_attempt", "delete_started");
      capture("delete_result", "delete_succeeded", { durationMs: 3 });
    }
    const status = controller.status();
    const records = controller.readEvents(runId);
    assert.equal(status.eventCount, 10);
    assert.equal(status.recordCount, 120);
    assert.equal(status.bytesBudgeted, MAX_BUFFER_BYTES);
    assert.ok(Buffer.byteLength(JSON.stringify(records)) < MAX_BUFFER_BYTES);
    assert.equal(controller.beginEvent({ ...target, messageId: "bounded-overflow" }), null);
    assert.equal(controller.status().stopReason, "event_limit");
    controller.dispose();
  }

  {
    const { controller } = makeController();
    start(controller);
    const eventTrace = controller.beginEvent({ ...target, messageId: "message-profile-inactive" });
    eventTrace("ingress", "received", { result: "ok" });
    const store = {
      reload() {},
      snapshot() { return { workspaces: { [target.workspaceId]: { profiles: {
        p1: { id: "profile-private", workspaceId: target.workspaceId, sessionId: target.sessionId, active: false, cards: {}, destinations: [target.groupId] }
      } } } }; }
    };
    let dispatched = false;
    const ingress = createOperationalIngress({ store, bridge: { async dispatch() { dispatched = true; return { ok: true }; } } });
    const result = await ingress({
      workspaceId: target.workspaceId,
      sessionId: target.sessionId,
      card: "groupManager",
      message: { key: { id: "message-profile-inactive", remoteJid: target.groupId } },
      sock: {},
      planAllowed: true,
      diagnosticV2: eventTrace
    });
    assert.equal(result.reason, "PERFIL_INATIVO");
    assert.equal(dispatched, false);
    const records = controller.readEvents(runId);
    assert.ok(records.some(record => record.stage === "profile_selection" && record.code === "profile_inactive" && record.profileHash));
    sensitiveScan(records);
    controller.dispose();
  }

  {
    const { controller } = makeController();
    start(controller);
    const eventTrace = controller.beginEvent({ ...target, messageId: "message-rule-match" });
    eventTrace("ingress", "received", { result: "ok" });
    const profile = {
      id: "profile-v3-id",
      workspaceId: target.workspaceId,
      sessionId: target.sessionId,
      active: true,
      destinations: [],
      cards: { groupManager: { active: true, configuration: { gruposConfigurados: true, grupos: [target.groupId] } } }
    };
    const store = {
      reload() {},
      snapshot() { return { workspaces: { [target.workspaceId]: { profiles: { p1: profile } } } }; }
    };
    let bridgeCalled = false;
    const ingress = createOperationalIngress({
      store,
      bridge: { async dispatch(request) {
        bridgeCalled = true;
        request.args.diagnosticV2("rule_evaluation", "rule_match", { profileId: request.profileId, ruleId: "rule-id", result: "ok" });
        return { ok: true, result: { processed: true } };
      } }
    });
    const result = await ingress({
      workspaceId: target.workspaceId,
      sessionId: target.sessionId,
      card: "groupManager",
      message: { key: { id: "message-rule-match", remoteJid: target.groupId } },
      sock: {},
      planAllowed: true,
      diagnosticV2: eventTrace
    });
    assert.equal(bridgeCalled, true);
    assert.deepEqual(result, { processed: true });
    assert.ok(controller.readEvents(runId).some(record => record.stage === "rule_evaluation" && record.code === "rule_match" && record.profileHash));
    sensitiveScan(controller.readEvents(runId));
    controller.dispose();
  }

  {
    const calls = [];
    const router = {
      middleware: [], routes: new Map(),
      use(fn) { this.middleware.push(fn); },
      post(path, ...handlers) { this.routes.set(`POST ${path}`, handlers); },
      get(path, ...handlers) { this.routes.set(`GET ${path}`, handlers); }
    };
    const express = { Router: () => router };
    let started = 0;
    const fakeController = {
      start(body) { started += 1; return { ok: false, code: "rejected", bodyWasNotReturned: !body.secret }; },
      stop() { return { ok: false }; }, status() { return { state: "off" }; }, readEvents() { return []; }
    };
    const requireAdminMaster = criarAdminMasterEstrito({
      jwt: { verify(token) {
        if (token === "master-token") return { clienteId: "master" };
        if (token === "user-token") return { clienteId: "ordinary" };
        throw new Error("invalid_token");
      } },
      getJwtSecret: () => "test-secret",
      getUsuarios: () => [
        { id: "master", papel: "admin_master", ativo: true },
        { id: "ordinary", papel: "cliente", ativo: true }
      ],
      usuarioEhAdminMaster: usuario => usuario?.papel === "admin_master"
    });
    createGerenteObservabilityV2Routes({ express, requireAdminMaster, controller: fakeController });
    function invoke(method, path, req) {
      const res = {
        statusCode: 200, headers: {}, body: null,
        set(name, value) { this.headers[name] = value; return this; },
        status(value) { this.statusCode = value; return this; },
        json(value) { this.body = value; return this; }
      };
      let index = 0;
      const handlers = [
        ...router.middleware,
        ...(router.routes.get(`${method} ${path}`) || [])
      ];
      const next = () => { const handler = handlers[index++]; if (handler) handler(req, res, next); };
      next();
      return res;
    }
    const unauthenticated = invoke("POST", "/start", { headers: { authorization: "" }, body: {} });
    assert.equal(unauthenticated.statusCode, 401);
    const nonAdmin = invoke("POST", "/start", { headers: { authorization: "Bearer user-token" }, body: {} });
    assert.equal(nonAdmin.statusCode, 403);
    const admin = invoke("POST", "/start", { headers: { authorization: "Bearer master-token" }, body: { secret: "private" } });
    assert.equal(admin.statusCode, 409);
    assert.equal(started, 1);
    assert.equal(JSON.stringify(admin.body).includes("private"), false);
    assert.equal(admin.headers["Cache-Control"], "no-store");
  }

  console.log("mensageiro-gerente-observability-v2: PASS");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
