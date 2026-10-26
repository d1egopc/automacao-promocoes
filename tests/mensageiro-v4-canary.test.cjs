"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), crypto = require("node:crypto");
const suite = fs.mkdtempSync(path.join(os.tmpdir(), "v4-canary-suite-"));
process.env.DATA_DIR = suite;
fs.writeFileSync(path.join(suite, "usuarios.json"), "[]");
test.after(() => fs.rmSync(suite, { recursive: true, force: true }));
const { Canary } = require("../modules/mensageiro-v4/canary");
const { Scope } = require("../modules/mensageiro-v4/scope");
const { V4Engine } = require("../modules/mensageiro-v4/engine");
const { Diagnostics } = require("../modules/mensageiro-v4/diagnostics");
const { V4Repository } = require("../modules/mensageiro-v4/repository");
const { V3Store } = require("../modules/mensageiro-v3/src/v3/store");
const { createV4Routes } = require("../modules/mensageiro-v4/routes");
const W = "fixture_A", S = "fixture_A_phone", G = "servmaq_fixture@g.us", P = "fixture_profile";
const target = { workspaceId: W, sessionId: S, groupId: G, profileId: P };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function control(clock = () => 0) {
  const c = new Canary({ clock, authorizeTarget: t => t.workspaceId === W && t.sessionId === S && t.groupId === G });
  const scope = new Scope(); scope.canary = c;
  const d = new Diagnostics({ clock, ownsSession: (w, s) => w === W && s === S,
    authorizeTarget: t => !!scope.match(t), onStop: () => c.stop("diagnostic_stopped") });
  c.stopDiagnostic = w => d.stop(w);
  const start = (mode = "observation", options = {}) => {
    const r = c.start({ target, mode, ...options });
    d.start({ ...target, ...options });
    return r;
  };
  return { c, scope, d, start };
}
function engineFixture(t, clock = () => 0) {
  const f = control(clock); t.after(() => f.c.stop());
  const p = { ...target, id: P, revision: 1, active: true, destinations: [G], cards: {
    groupManager: { active: true, configuration: { v4: { migrationVersion: 4 }, regras: [{ id: "links", ativo: true,
      tipo: "links_externos", acao: "apagar_avisar", parametros: { dominiosPermitidos: [] } }] } } } };
  const calls = [], sent = [], claims = new Set();
  const repository = { call: async (op, args) => {
    calls.push(op);
    if (op === "select") return { profile: p };
    if (op === "profile") return p;
    if (op === "claim") { if (claims.has(args.key)) return false; claims.add(args.key); return true; }
    return true;
  } };
  const sock = { user: { id: "bot@lid" }, groupMetadata: async () => ({ participants: [
    { id: "bot@lid", admin: "admin" }, { id: "participant@lid", admin: null }, { id: "other@lid", admin: null }] }),
    sendMessage: async (to, content) => { sent.push({ to, content }); return { key: { id: "fixture_outbound" } }; } };
  const e = new V4Engine({ repository, scope: f.scope, canary: f.c, enabled: w => f.scope.owns(w),
    contextValid: (w, s, sk) => w === W && s === S && sk === sock, actionAllowed: () => true, diagnostics: f.d,
    credits: { send: () => { throw new Error("sem_creditos"); } } });
  const message = (id = "natural", text = "https://example.org/professional", participant = "participant@lid", groupId = G) => ({
    key: { id, remoteJid: groupId, participant, fromMe: false }, message: { conversation: text } });
  const ingress = (m, options = {}) => {
    const a = { sessionId: S, capturedWorkspaceId: W, current: true, messages: [m], type: "notify", ...options };
    f.d.observe(a); f.c.ingress(a);
  };
  let legacyCalls = 0;
  const dispatch = (m, options = {}) => f.c.route({ sessionId: S, groupId: m.key.remoteJid,
    card: "groupManager", message: m }, async () => { legacyCalls++; return { legacy: true }; },
    lease => e.dispatch({ workspaceId: W, sessionId: S, sock, card: "groupManager", message: m,
      planAllowed: true, canaryLease: lease, ...options }));
  const arm = (notice = false) => {
    const r = f.start("controlled_test");
    const text = "https://example.org/controlled CANARIO " + r.testChallenge;
    f.c.arm({ workspaceId: W, runId: r.runId, participantId: "participant@lid", text,
      authorization: "single_test_delete", sendNotice: notice });
    return text;
  };
  return { ...f, e, p, calls, sent, sock, message, ingress, dispatch, arm, legacyCalls: () => legacyCalls };
}

test("runtime ON/OFF, strict tuple, empty environment and process restart remain OFF", t => {
  const f = control(); t.after(() => f.c.stop());
  assert.equal(f.scope.owns(W), false);
  f.start(); assert.equal(f.scope.owns(W), true);
  assert.ok(f.scope.match(target));
  for (const change of [{ workspaceId: "B" }, { sessionId: "wrong" }, { groupId: "other@g.us" }, { profileId: "other" }, { card: "commands" }])
    assert.equal(f.scope.match({ ...target, ...change }), null);
  f.c.stop(); assert.equal(f.scope.owns(W), false); assert.equal(f.d.status(W).state, "finished");
  assert.equal(new Canary().status(W).state, "off"); assert.equal(new Scope().owns(W), false);
  assert.throws(() => new Canary().start({ target, mode: "observation" }), /alvo_nao_autorizado/);
});
test("OFF ingress does not read clock or hash; observation is read-only and natural links are untouched", async t => {
  const off = new Canary({ clock: () => assert.fail("OFF clock") });
  off.ingress({});
  const f = engineFixture(t); f.start(); const m = f.message(); f.ingress(m);
  const result = await f.dispatch(m);
  assert.equal(result.reason, "observation_only"); assert.equal(result.simulatedDecision, "delete_warn");
  assert.deepEqual(f.sent, []); assert.deepEqual(f.calls, ["select"]); assert.equal(f.legacyCalls(), 0);
  assert.ok(f.d.status(W).records.some(r => r.stage === "ingress"));
  assert.ok(f.d.status(W).records.some(r => r.stage === "profile" && r.code === "selected"));
  assert.ok(f.d.status(W).records.some(r => r.stage === "rule" && r.code === "violation"));
  const serialized = JSON.stringify(f.d.status(W));
  for (const raw of [G, S, "participant@lid", "example.org", P]) assert.equal(serialized.includes(raw), false);
});
test("controlled test requires explicit authorization, exact nonce/text, participant and fresh current notify", async t => {
  const f = engineFixture(t), text = f.arm();
  const cases = [f.message("natural"), f.message("other-sender", text, "other@lid"), f.message("changed", text + "changed")];
  for (const m of cases) { f.ingress(m); assert.equal((await f.dispatch(m)).reason, "observation_only"); }
  for (const options of [{ type: "append" }, { current: false }, { capturedWorkspaceId: "B" }]) {
    const m = f.message("wrong-" + JSON.stringify(options), text); f.ingress(m, options);
    assert.equal((await f.dispatch(m)).reason, "observation_only");
  }
  assert.equal(f.sent.length, 0); assert.equal(f.calls.includes("claim"), false);
  const missing = f.message("unobserved", text);
  assert.equal((await f.dispatch(missing)).reason, "observation_only");
});
test("one authorized deletion is free, warning blocked at zero, no fabricated remote confirmation", async t => {
  const f = engineFixture(t), text = f.arm(true), m = f.message("exact-test", text); f.ingress(m);
  const result = await f.dispatch(m);
  assert.equal(result.deleteAttempted, true); assert.equal(result.deleteResult, "local_resolved");
  assert.equal(result.remoteDeletionConfirmed, false); assert.equal(result.noticeResult, "sem_creditos");
  assert.equal(f.sent.length, 1); assert.ok(f.sent[0].content.delete);
  assert.equal(f.c.status(W).state, "off"); assert.equal(f.c.status(W).deletionAttempts, 1);
  await f.dispatch(m); assert.equal(f.sent.length, 1); assert.equal(f.legacyCalls(), 0);
});
test("other group is never dispatched to V4 and workspace/profile/session mismatches fail closed", async t => {
  const f = engineFixture(t), text = f.arm();
  const other = f.message("other-group", text, "participant@lid", "other@g.us"); f.ingress(other);
  assert.equal((await f.dispatch(other)).legacy, true); assert.equal(f.sent.length, 0);
  const m = f.message("misroute", text); f.ingress(m);
  const r = await f.dispatch(m, { workspaceId: "B" }); assert.equal(r.blocked, true); assert.equal(f.sent.length, 0);
  f.p.id = "other_profile";
  assert.equal((await f.dispatch(m)).reason, "profile_unauthorized");
});
test("expiry rechecked after awaits blocks transport even if the timer has not run", async t => {
  let now = 0; const f = engineFixture(t, () => now), text = f.arm();
  const m = f.message("late", text); f.ingress(m);
  f.sock.groupMetadata = async () => { now = 900001; return { participants: [
    { id: "bot@lid", admin: "admin" }, { id: "participant@lid", admin: null }] }; };
  const r = await f.dispatch(m); assert.equal(r.blocked, true); assert.equal(f.sent.length, 0);
  assert.equal(f.c.status(W).state, "off"); assert.equal(f.d.status(W).state, "finished");
});
test("expiry immediately before transport reports not attempted rather than a fictional deletion", async t => {
  let now = 0; const f = engineFixture(t, () => now), text = f.arm();
  const m = f.message("last-boundary", text); f.ingress(m);
  f.e.transport = action => { now = 900001; return action(); };
  const result = await f.dispatch(m);
  assert.equal(result.deleteAttempted, false); assert.equal(result.deleteResult, "not_attempted");
  assert.equal(f.c.status(W).deletionAttempts, 0); assert.equal(f.sent.length, 0);
});
test("manual stop and expiry during unresolved native transport fence legacy until real settlement", async t => {
  const f = engineFixture(t), text = f.arm(), pending = deferred(), called = deferred();
  const m = f.message("native-pending", text); f.ingress(m);
  f.sock.sendMessage = () => { called.resolve(); return pending.promise; };
  // Timeout wrapper returns before the native promise, as the real transport does.
  f.e.transport = action => Promise.race([action(), new Promise((_, reject) => setTimeout(() => reject(new Error("fixture_timeout")), 20))]);
  const result = f.dispatch(m); await called.promise; f.c.stop("manual");
  assert.equal((await result).deleteResult, "error"); assert.equal(f.c.status(W).draining, true);
  assert.equal((await f.dispatch(f.message("during-drain"))).reason, "canary_draining");
  assert.equal(f.legacyCalls(), 0); assert.throws(() => f.start(), /canary_busy/);
  pending.resolve({}); await new Promise(r => setImmediate(r));
  assert.equal(f.c.status(W).draining, false);
  assert.equal((await f.dispatch(f.message("after-drain"))).legacy, true);
});
test("no overlap with an already running legacy handler; no claims cancelled", async t => {
  const f = control(); t.after(() => f.c.stop()); const gate = deferred(), called = deferred();
  const legacy = f.c.route({ sessionId: S, groupId: G, card: "groupManager" }, async () => { called.resolve(); await gate.promise; }, () => assert.fail());
  await called.promise; assert.throws(() => f.start(), /legacy_busy/);
  gate.resolve(); await legacy; f.start();
  assert.equal(f.c.status(W).state, "active");
});
test("event bound ends both diagnostic and actions, never falls into legacy for the same batch", async t => {
  const f = engineFixture(t); f.start("observation", { maxEvents: 2 });
  const a = f.message("a"), b = f.message("b"); f.ingress(a); f.ingress(b);
  assert.equal(f.c.status(W).state, "off"); assert.equal(f.d.status(W).state, "finished");
  await f.dispatch(a); await f.dispatch(b); assert.equal(f.sent.length, 0); assert.equal(f.legacyCalls(), 0);
});
test("a closed batch cannot become legacy traffic after another runtime execution starts", async t => {
  const f = engineFixture(t); f.start(); const m = f.message("old-batch"); f.ingress(m);
  f.c.stop();
  // Results are normally retained for collection; resetting the diagnostic here
  // simulates collecting/discarding the previous run before another activation.
  f.d.run = null; f.start();
  assert.equal((await f.dispatch(m)).reason, "canary_closed_event");
  assert.equal(f.legacyCalls(), 0); assert.equal(f.sent.length, 0);
});
test("concurrent duplicate test events never consume more than one deletion", async t => {
  const f = engineFixture(t), text = f.arm(), gate = deferred(), called = deferred();
  const m = f.message("concurrent", text); f.ingress(m);
  f.sock.sendMessage = async (to, content) => { f.sent.push({ to, content }); called.resolve(); await gate.promise; return {}; };
  const first = f.dispatch(m); await called.promise;
  assert.equal((await f.dispatch(m)).reason, "canary_test_busy");
  const natural = f.message("natural-during-test"); f.ingress(natural);
  assert.equal((await f.dispatch(natural)).reason, "observation_only");
  assert.equal(f.c.status(W).state, "active");
  gate.resolve(); await first; assert.equal(f.sent.length, 1); assert.equal(f.c.status(W).state, "off");
});
test("timer alone ends the functional canary and diagnostic without polling", async t => {
  const f = control(() => performance.now()); t.after(() => f.c.stop());
  f.start("observation", { durationMs: 1000 });
  await new Promise(r => setTimeout(r, 1050));
  assert.equal(f.c.run.active, false); assert.equal(f.d.run.active, false);
});
test("unauthorized arms, wrong run, missing nonce, exempt sender and absent admin never delete", async t => {
  const f = engineFixture(t), r = f.start("controlled_test");
  for (const change of [{ authorization: "yes" }, { runId: "other" }, { participantId: "bad" }, { text: "https://example.org/no-nonce" }, { workspaceId: "B" }])
    assert.throws(() => f.c.arm({ workspaceId: W, runId: r.runId, participantId: "participant@lid",
      text: "https://example.org/ " + r.testChallenge, authorization: "single_test_delete", ...change }), /test_authorization_invalid/);
  const text = "https://example.org/ " + r.testChallenge;
  f.c.arm({ workspaceId: W, runId: r.runId, participantId: "participant@lid", text, authorization: "single_test_delete" });
  const m = f.message("exempt", text); f.ingress(m);
  f.sock.groupMetadata = async () => ({ participants: [
    { id: "bot@lid", admin: "admin" }, { id: "participant@lid", admin: "admin" }] });
  assert.equal((await f.dispatch(m)).reason, "sender_exempt"); assert.equal(f.sent.length, 0);
});

test("Admin-only preparation works OFF via official transaction, CAS and multiworkspace scope", async t => {
  const root = fs.mkdtempSync(path.join(suite, "api-")), file = path.join(root, "state.json");
  const store = new V3Store({ filePath: file });
  let p = store.createProfile({ workspaceId: W, sessionId: S, name: "Fixture" });
  store.updateProfile(W, p.id, { active: true, destinations: [G] });
  store.saveCard(W, p.id, "groupManager", { active: true, configuration: { regras: [{ id: "links", tipo: "links_externos",
    ativo: true, acao: "apagar_avisar", parametros: { dominiosPermitidos: [] } }], imagem: "" } });
  p = store.getProfile(W, p.id); const before = JSON.parse(JSON.stringify(p));
  const repo = new V4Repository({ filePath: file });
  const f = control(); f.c.authorizeTarget = a => a.profileId === p.id && a.workspaceId === W && a.groupId === G;
  const e = new V4Engine({ repository: repo, scope: f.scope, enabled: w => f.scope.owns(w), canary: f.c });
  const express = require("express"), app = express(); app.use(express.json());
  app.use((req, _res, next) => { if (req.headers.auth) req.usuario = { id: W }; next(); });
  app.use(createV4Routes({ repository: repo, engine: e, diagnostics: f.d, canary: f.c,
    getWorkspace: req => req.headers.workspace || W, hasFeature: req => req.headers.plan !== "no",
    canUseTarget: (w, req) => (w === (req.headers.workspace || W) || req.headers.workspace === "admin_fixture") && req.headers.plan !== "no",
    requireAdminMaster: (req, res, next) => req.headers.admin === "yes" ? next() : res.status(403).json({ code: "admin_required" }),
    listSessions: w => w === W ? [{ id: S, connected: true }] : [],
    listGroups: w => w === W ? [{ id: G }] : [] }));
  const server = app.listen(0, "127.0.0.1"); await new Promise(r => server.once("listening", r));
  t.after(async () => { f.c.stop(); await new Promise(r => server.close(r)); await repo.close(); });
  const origin = "http://127.0.0.1:" + server.address().port;
  const headers = { auth: "fixture", admin: "yes", "content-type": "application/json" };
  const input = { sessionId: S, groupId: G, profileId: p.id, expectedRevision: p.revision };
  const post = (url, body, h = headers) => fetch(origin + url, { method: "POST", headers: h, body: JSON.stringify(body) });
  const groupHash = crypto.createHash("sha256").update(G).digest("hex");
  const targetUrl = "/canary/target?workspaceId=" + W + "&sessionId=" + S + "&groupHash=" + groupHash;
  assert.equal((await fetch(origin + targetUrl)).status, 401);
  assert.equal((await fetch(origin + targetUrl, { headers: { ...headers, admin: "no" } })).status, 403);
  assert.equal((await fetch(origin + targetUrl, { headers: { ...headers, plan: "no", workspace: "admin_fixture" } })).status, 403);
  assert.equal((await fetch(origin + targetUrl, { headers: { ...headers, workspace: "B" } })).status, 403);
  assert.equal((await fetch(origin + targetUrl.replace(groupHash, "0".repeat(64)), { headers })).status, 422);
  assert.equal((await fetch(origin + targetUrl.replace(groupHash, "malformed"), { headers })).status, 422);
  const targetResponse = await fetch(origin + targetUrl, { headers: { ...headers, workspace: "admin_fixture" } });
  assert.equal(targetResponse.status, 200);
  const targetPayload = await targetResponse.json();
  assert.deepEqual(targetPayload.target, { workspaceId: W, sessionId: S, groupId: G,
    groupName: "Grupo autorizado", profileId: p.id, expectedRevision: p.revision,
    readyForObservation: false });
  assert.equal(f.c.status(W).state, "off", "target discovery never activates the canary");
  assert.equal((await repo.call("profile", { workspaceId: W, profileId: p.id })).revision, before.revision,
    "target discovery is read-only");
  assert.equal((await post("/canary/prepare", input, {})).status, 401);
  assert.equal((await post("/canary/prepare", input, { ...headers, admin: "no" })).status, 403);
  assert.equal((await post("/canary/prepare", input, { ...headers, plan: "no" })).status, 403);
  assert.equal((await post("/canary/prepare", input, { ...headers, workspace: "B" })).status, 422);
  assert.equal((await post("/canary/prepare", { ...input, expectedRevision: 0 })).status, 409);
  assert.equal((await fetch(origin + "/state", { headers })).status, 503);
  const prepared = await post("/canary/prepare", input); assert.equal(prepared.status, 200);
  const payload = await prepared.json(); assert.equal(payload.canary.state, "off");
  const after = await repo.call("profile", { workspaceId: W, profileId: p.id });
  assert.deepEqual(after.cards.groupManager.configuration.regras, before.cards.groupManager.configuration.regras);
  assert.deepEqual(after.destinations, before.destinations); assert.equal(after.sessionId, before.sessionId);
  assert.equal(after.cards.groupManager.configuration.v4.migrationVersion, 4);
  const readyResponse = await fetch(origin + targetUrl, { headers: { ...headers, workspace: "admin_fixture" } });
  assert.equal((await readyResponse.json()).target.readyForObservation, true);
  const master = await post("/canary/prepare", { ...input, expectedRevision: after.revision, workspaceId: W },
    { ...headers, workspace: "admin_fixture" });
  assert.equal(master.status, 200, "global Admin Master can nominate only the validated target, without tenant impersonation");
  assert.equal((await post("/profiles/" + p.id + "/migrate", { workspaceId: W },
    { ...headers, workspace: "admin_fixture" })).status, 503, "business routes cannot nominate another tenant");
  const updated = { ...input, expectedRevision: after.revision, mode: "observation", durationMs: 1000 };
  const start = await post("/canary/start", updated); assert.equal(start.status, 200);
  const state = await start.json(); assert.equal(state.canary.state, "active");
  const stop = await post("/canary/stop", { runId: state.canary.runId }); assert.equal(stop.status, 200);
  assert.equal((await stop.json()).canary.state, "off");
  assert.equal((await post("/canary/stop", { runId: "old" })).status, 422);
});

test("original callback contains trace/control before filters, no extra listener, other consumers unchanged", () => {
  const source = fs.readFileSync(path.join(__dirname, "../index.js"), "utf8");
  const start = source.indexOf('handler: async ({ messages = [], type } = {}) => {');
  const end = source.indexOf('diagnosticarEntradaUpsert({', start);
  const early = source.slice(start, end);
  assert.ok(early.includes("mensageiroV4Diagnostics.observe")); assert.ok(early.includes("mensageiroV4Canary.ingress"));
  assert.equal(early.includes(".on("), false); assert.equal(early.includes("writeFile"), false);
  assert.match(source, /mensageiroV4Canary\.route\(context,/);
  assert.ok(source.includes('card !== "scheduled"')); assert.ok(source.includes("processarMensagemRadarAutomatica"));
});
