"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "messenger-universal-suite-"));
process.env.DATA_DIR = root;
fs.writeFileSync(path.join(root, "usuarios.json"), JSON.stringify(["universal_A", "universal_B"].map(id => ({ id, ativo: true }))));
test.after(() => fs.rmSync(root, { recursive: true, force: true }));
const express = require("express");
const { V3Store } = require("../modules/mensageiro-v3/src/v3/store");
const { V4Repository } = require("../modules/mensageiro-v4/repository");
const { ProfileScope } = require("../modules/mensageiro-v4/scope");
const { V4Engine } = require("../modules/mensageiro-v4/engine");
const { createV4Routes } = require("../modules/mensageiro-v4/routes");
const { createOperationalIngress } = require("../modules/mensageiro-v3/operational-gates");
const image = "data:image/png;base64," + Buffer.from([137,80,78,71,13,10,26,10,1]).toString("base64");
const W = "universal_A", B = "universal_B", G = "fixture@g.us", P = "5511999999999@s.whatsapp.net";
async function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "messenger-universal-"));
  const filePath = path.join(dir, "state.json"), store = new V3Store({ filePath });
  const repository = new V4Repository({ filePath }), scope = new ProfileScope();
  const sent = [], debits = [], sockets = {};
  const session = w => w + "_Vivo fixture";
  for (const w of [W, B]) sockets[w] = {
    __optimusMessengerLiveReady: true,
    user: { id: "bot@s.whatsapp.net" },
    groupMetadata: async () => ({ participants: [{ id: "bot@s.whatsapp.net", admin: "admin" }, { id: P }] }),
    sendPresenceUpdate: async () => {},
    sendMessage: async (to, content) => { const id = "fixture-send-" + sent.length;
      sent.push({ w, to, content, id }); return { key: { id } }; },
  };
  const refresh = async () => scope.configure(await repository.call("universal_sessions"));
  await refresh();
  const engine = new V4Engine({ repository, scope, enabled: () => true,
    contextValid: (w, s, sock) => s === session(w) && sockets[w] === sock,
    actionAllowed: () => true, groupAllowed: (_w, _s, g) => g === G,
    participantReady: sock => sock.__optimusMessengerLiveReady === true,
    credits: { send: async args => { await args.revalidate(); debits.push({ w: args.workspaceId, to: args.groupId });
      return args.transport(args.content, args.options); } },
  });
  const app = express(); app.use(express.json({limit:"10mb"}));
  app.use((req, _res, next) => { req.clienteId = req.headers["x-fixture-workspace"];
    if (req.clienteId) req.usuario = { id: req.clienteId }; next(); });
  app.use("/mensageiro-v4", createV4Routes({ repository, engine, universal: true,
    getWorkspace: req => req.clienteId, hasFeature: req => req.headers["x-fixture-plan"] !== "blocked",
    diagnostics: { status: () => ({ state: "off" }) }, onConfigurationChange: refresh,
    listSessions: w => [{ id: session(w), connected: true }], listGroups: () => [{ id: G }],
  }));
  const server = app.listen(0, "127.0.0.1"); await new Promise(resolve => server.once("listening", resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await repository.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const api = async (w, method, url, body, plan) => {
    const r = await fetch("http://127.0.0.1:" + server.address().port + "/mensageiro-v4" + url, {
      method, headers: { "content-type": "application/json", ...(w ? { "x-fixture-workspace": w } : {}),
        ...(plan ? { "x-fixture-plan": plan } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json() };
  };
  const current = async (w, id) => (await api(w, "GET", "/state")).body.profiles.find(p => p.id === id);
  const card = async (w, id, name, configuration) => {
    const p = await current(w, id);
    const r = await api(w, "PATCH", `/profiles/${id}/cards/${name}`, { active: true, configuration, expectedRevision: p.revision });
    assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body.profile;
  };
  const create = async (w = W) => { const r = await api(w, "POST", "/profiles", { name: "Fixture", sessionId: session(w), destinations: [G] });
    assert.equal(r.status, 200); return r.body.profile; };
  const activate = async (w, id, extra = {}) => { const p = await current(w, id);
    return api(w, "PATCH", "/profiles/" + id, { ...p, active: true, confirmActivation: true, expectedRevision: p.revision, ...extra }); };
  const dispatch = (w, id, kind = "commands", text = "ping", destination = G, overrides = {}) => engine.dispatchConfigured({
    workspaceId: w, sessionId: session(w), sock: sockets[w], planAllowed: true, card: kind, upsertType: "notify",
    message: { key: { id, remoteJid: destination, participant: P, fromMe: false },
      messageTimestamp: Math.ceil(Date.now() / 1000), message: { conversation: text } }, ...overrides });
  return { api, create, card, activate, current, dispatch, store, repository, scope, refresh, session, sockets, sent, debits, filePath,engine };
}
module.exports={fixture,W,B,G,P,image};

test("all authenticated entitled workspaces can prepare; explicit activation and CAS are mandatory", async t => {
  const f = await fixture(t);
  assert.equal((await f.api(null, "GET", "/state")).status, 401);
  assert.equal((await f.api(W, "GET", "/state", null, "blocked")).status, 403);
  for (const w of [W, B]) {
    const initial = await f.api(w, "GET", "/state");
    assert.equal(initial.status, 200); assert.equal(initial.body.universal, true); assert.deepEqual(initial.body.profiles, []);
    const p = await f.create(w); assert.equal(p.active, false);
    assert.equal((await f.activate(w, p.id)).body.code, "active_card_required");
    await f.card(w, p.id, "commands", { comandos: [{ id: "ping", ativo: true, gatilhos: ["ping"], resposta: { tipo: "texto", texto: "pong" } }] });
    assert.equal((await f.activate(w, p.id, { confirmActivation: false })).body.code, "activation_confirmation_required");
    const active = await f.activate(w, p.id); assert.equal(active.status, 200); assert.ok(active.body.profile.activatedAt);
    assert.equal((await f.api(w, "PATCH", "/profiles/" + p.id, { ...active.body.profile,
      expectedRevision: 0, confirmActivation: true })).body.code, "conflito_revisao");
  }
  assert.equal(f.sent.length, 0); assert.equal(f.debits.length, 0);
});

test("commands use real handlers, keep workspace/session/group scope and reject duplicate/history/stale input", async t => {
  const f = await fixture(t);
  for (const w of [W, B]) {
    const p = await f.create(w);
    await f.card(w, p.id, "commands", { comandos: [{ id: "ping", nome: "Ping", ativo: true, gatilhos: ["ping"],
      grupos: [G], gruposConfigurados: true, resposta: { tipo: "texto", texto: "pong-" + w }, cooldownSegundos: 0, cooldownParticipanteSegundos: 0 }] });
    await f.activate(w, p.id);
    await f.dispatch(w, "same-provider-id"); await f.dispatch(w, "same-provider-id");
    assert.equal(f.sent.filter(s => s.w === w).length, 1);
    assert.equal(f.sent.find(s => s.w === w).content.text, "pong-" + w);
    await f.dispatch(w, "other-group", "commands", "ping", "other@g.us");
    await f.dispatch(w, "history", "commands", "ping", G, { upsertType: "append" });
    await f.dispatch(w, "stale", "commands", "ping", G, { sock: {} });
    await f.dispatch(w, "no-plan", "commands", "ping", G, { planAllowed: false });
    assert.equal(f.sent.filter(s => s.w === w).length, 1);
    assert.equal((await f.api(w === W ? B : W, "GET", "/profiles/" + p.id)).body.code, "perfil_nao_encontrado");
  }
  assert.deepEqual(f.debits.map(d => d.w).sort(), [W, B].sort());
});

test("private configured trigger with image wins over intelligent fallback and survives repository restart", async t => {
  const f = await fixture(t), p = await f.create();
  await f.card(W, p.id, "attendance", { escopo: "privado", cooldownMinutos: 1,
    gatilhos: [{ id: "support", ativo: true, palavrasObrigatorias: ["ajuda"], modo: "todas",
      respostas: [{ tipo: "imagem_texto", conteudo: "Resposta própria", imagem: image }] }] });
  const active = await f.activate(W, p.id, { intelligence: { enabled: true, fallbackEnabled: true } });
  assert.equal(active.status, 200);
  await f.dispatch(W, "private", "attendance", "ajuda", P);
  assert.equal(f.sent.length, 1); assert.ok(Buffer.isBuffer(f.sent[0].content.image));
  assert.equal(f.sent[0].content.caption, "Resposta própria"); assert.equal(f.sent[0].to, P);
  const restarted = new V3Store({ filePath: f.filePath });
  assert.equal(restarted.getProfile(W, p.id).cards.attendance.configuration.gatilhos[0].respostas[0].imagem, image);
  await f.dispatch(W, "cooldown", "attendance", "ajuda", P); assert.equal(f.sent.length, 1);
});

test("welcome/farewell use current socket, reject bootstrap and allow only proven participant aliases", async t => {
  const f = await fixture(t), p = await f.create();
  for (const c of ["welcome", "farewell"]) await f.card(W, p.id, c, {
    mensagem: "Olá {numero}", imagem: image, envio: { destino: "privado", modoGrupo: "imagem_texto" } });
  await f.activate(W, p.id);
  const event = { id: G, action: "add", participants: ["peer@lid"] };
  f.sockets[W].contacts = { "peer@lid": { lid: "peer@lid", jid: P } };
  f.sockets[W].__optimusMessengerLiveReady = false;
  const args = { message: undefined, event };
  assert.equal((await f.dispatch(W, "join", "welcome", "", G, args)).result.reason, "offline_sync_unproven");
  f.sockets[W].__optimusMessengerLiveReady = true;
  await f.dispatch(W, "join", "welcome", "", G, args);
  assert.equal(f.sent.length, 1); assert.equal(f.sent[0].to, P);
  await f.dispatch(W, "join-again", "welcome", "", G, args); assert.equal(f.sent.length, 1);
  await f.dispatch(W, "leave", "farewell", "", G, { message: undefined, event: { ...event, action: "remove" } });
  assert.equal(f.sent.length, 2); assert.equal(f.sent[1].to, P);
  const foreign = "5511888888888@s.whatsapp.net";
  assert.equal(f.scope.authorizeSocketAlias(f.sockets[W], foreign), false);
});

test("public card/profile payloads cannot forge or remove universal send authority", async t => {
  const f = await fixture(t), p = await f.create();
  await f.card(W, p.id, "groupManager", { v4: { universalEnabled: false, activatedAt: "invalid" }, execution: { version: 0 } });
  const after = await f.current(W, p.id);
  assert.equal(after.universalEnabled, true); assert.equal(after.activatedAt, null);
  const raw = await f.repository.call("profile", { workspaceId: W, profileId: p.id });
  f.store.reload(); f.store.updateProfile(W, p.id, { execution: { version: 0 } });
  assert.equal(f.store.getProfile(W, p.id).execution.version, 4);
  assert.equal(raw.execution.version, 4);
});

test("old active profiles are not adopted; universal-owned profiles never fall through the V3 bridge", async t => {
  const f = await fixture(t);
  const p = f.store.createProfile({ workspaceId: W, sessionId: f.session(W), name: "Old" });
  f.store.updateProfile(W, p.id, { active: true, destinations: [G] });
  f.store.saveCard(W, p.id, "commands", { active: true }); await f.refresh();
  assert.equal((await f.dispatch(W, "old")).handled, false);
  const duplicate = await f.api(W, "POST", "/profiles/" + p.id + "/duplicate", {});
  assert.equal(duplicate.body.profile.active, false); assert.equal(duplicate.body.profile.universalEnabled, true);
  assert.equal(duplicate.body.profile.activatedAt, null);
  assert.equal((await f.activate(W, p.id)).body.code, "legacy_review_required");
  const adopted = await f.activate(W, p.id, { confirmLegacyReview: true }); assert.equal(adopted.status, 200);
  let calls = 0;
  const ingress = createOperationalIngress({ store: f.store, bridge: { dispatch: async () => { calls++; return {}; } } });
  await ingress({ workspaceId: W, sessionId: f.session(W), card: "commands", planAllowed: true,
    sock: f.sockets[W], message: { key: { id: "no-fallback", remoteJid: G } } });
  assert.equal(calls, 0);
});

test("unconfigured sessions have no worker, transport or IO work in the universal fast path", async () => {
  const scope = new ProfileScope(); scope.configure([]);
  let calls = 0;
  const engine = new V4Engine({ scope, repository: { call() { calls++; throw new Error("unexpected IO"); } } });
  const before = process.memoryUsage().heapUsed, start = performance.now();
  for (let i = 0; i < 10000; i++)
    assert.equal((await engine.dispatchConfigured({ workspaceId: W, sessionId: W + "_none" })).handled, false);
  const elapsedMs = performance.now() - start;
  assert.equal(calls, 0); assert.ok(elapsedMs < 2000);
  console.log("UNIVERSAL_IDLE_METRICS=" + JSON.stringify({ events: 10000, workerCalls: calls,
    elapsedMs: Math.round(elapsedMs * 100) / 100, heapDelta: process.memoryUsage().heapUsed - before }));
});
