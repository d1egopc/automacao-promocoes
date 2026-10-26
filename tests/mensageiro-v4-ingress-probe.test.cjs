"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { Diagnostics } = require("../modules/mensageiro-v4/diagnostics");
const { registrarListenerUnicoSocket, marcarSocketAtual, socketEhAtual } = require("../modules/whatsapp/socket-listener-lifecycle.service");
const W = "fixture_workspace", S = W + "_ServCel", G = "fixture-target@g.us";
const logger = { log() {}, trace() {}, debug() {} };
const baileys = (async () => {
  const root = path.dirname(require.resolve("@whiskeysockets/baileys"));
  await import(pathToFileURL(path.join(root, "index.js")).href);
  assert.equal(require("@whiskeysockets/baileys/package.json").version, "6.7.22");
  return import(pathToFileURL(path.join(root, "Utils/event-buffer.js")).href);
})();
async function fixture(t, options = {}) {
  const { makeEventBuffer } = await baileys;
  const create = () => ({ ev: makeEventBuffer(logger) });
  const sessions = {}, generations = {}, sock = create();
  const generation = marcarSocketAtual({ sessoes: sessions, geracoes: generations, sessaoId: S, sock, logger }).socketGeracao;
  let now = 0, lookups = 0, clockCalls = 0, handled = 0;
  let authorized = true;
  const d = new Diagnostics({
    ownsSession: (w, s) => w === W && s === S,
    authorizeTarget: () => { if (authorized === "throws") throw new Error("PRIVATE_ERROR"); return authorized; },
    clock: () => { clockCalls++; return now; },
    getCurrentSocket: s => { lookups++; assert.equal(s, S); return sessions[s]; },
  });
  t.after(() => d.stop(W));
  const install = (socket = sock, gen = generation) => registrarListenerUnicoSocket({
    sock: socket, evento: "messages.upsert", sessaoId: S, logger,
    onInvoke: ({ emitter, emitterCurrent, callbackCurrent }) => d.observeListener({
      sessionId: S, sock: socket, emitter, emitterCurrent, callbackCurrent, generation: gen }),
    handler: ({ messages = [], type } = {}) => {
      d.observe({ sessionId: S, capturedWorkspaceId: options.capturedWorkspaceId || W, sock: socket,
        current: socketEhAtual(sessions, S, socket), generation: gen, messages, type });
      if (socketEhAtual(sessions, S, socket)) handled++;
    },
  });
  const message = (id = "target-message", jid = G) => ({ key: { id, remoteJid: jid, fromMe: false },
    message: { conversation: "PRIVATE_CONTENT_NOT_RECORDED" } });
  const emit = (messages = [message()], socket = sock) => socket.ev.emit("messages.upsert", { messages, type: "notify" });
  const start = () => d.start({ workspaceId: W, sessionId: S, groupId: G });
  const status = () => d.status(W);
  return { d, sock, create, sessions, generations, generation, install, emit, start, status, message,
    setNow: value => { now = value; }, setAuthorized: value => { authorized = value; },
    metrics: () => ({ lookups, clockCalls, handled }) };
}

test("registered OFF callback sees runtime start without re-registration; OFF adds no clock/hash/socket lookup", async t => {
  const f = await fixture(t); f.install();
  const original = f.sock.__optimusListeners["messages.upsert"].handler;
  f.d.hash = () => assert.fail("OFF must not hash");
  f.emit();
  assert.deepEqual(f.metrics(), { lookups: 0, clockCalls: 0, handled: 1 });
  delete f.d.hash;
  f.start(); f.emit();
  assert.equal(f.sock.__optimusListeners["messages.upsert"].handler, original);
  const s = f.status(), p = s.ingressProbe;
  assert.equal(s.coverage.matchingMessages, 1);
  assert.equal(p.counters.wrapperCalls, 1); assert.equal(p.counters.observerCalls, 1);
  assert.equal(p.bindingCurrent.socketId, p.lastWrapper.socketId);
  assert.equal(p.bindingCurrent.emitterId, p.lastCallback.emitterId);
  assert.equal(p.bindingCurrent.registryEmitterMatches, true);
  assert.equal(p.bindingCurrent.attachmentVerified, null, "Baileys has no listener introspection");
  assert.equal(p.lastCallback.current, true);
});

test("replacement emitter and superseded callback are counted before wrapper fences, without reaching handler", async t => {
  const f = await fixture(t); f.install(); f.start();
  const oldEmitter = f.sock.ev, old = f.sock.__optimusListeners["messages.upsert"].handler;
  f.sock.ev = f.create().ev;
  oldEmitter.emit("messages.upsert", { messages: [f.message()], type: "notify" });
  assert.equal(f.metrics().handled, 0);
  assert.equal(f.status().ingressProbe.counters.rejectedEmitter, 1);
  assert.equal(f.status().ingressProbe.bindingCurrent.registryEmitterMatches, false);
  f.install(); old({ messages: [f.message()], type: "notify" });
  assert.equal(f.status().ingressProbe.counters.rejectedCallback, 1);
  f.emit(); assert.equal(f.metrics().handled, 1);
});

test("repeated registration, removeAllListeners and new generation preserve exactly one active handler", async t => {
  const f = await fixture(t); f.install(); f.install(); f.start(); f.emit();
  assert.equal(f.metrics().handled, 1);
  f.sock.ev.removeAllListeners("messages.upsert"); f.emit();
  const p = f.status().ingressProbe;
  assert.equal(p.counters.wrapperCalls, 1);
  assert.equal(p.bindingCurrent.registryPresent, true);
  assert.equal(p.bindingCurrent.attachmentVerified, null, "registry is not proof of attachment");
  f.install(); f.emit(); assert.equal(f.metrics().handled, 2);
  const next = f.create();
  const gen = marcarSocketAtual({ sessoes: f.sessions, geracoes: f.generations, sessaoId: S, sock: next, logger }).socketGeracao;
  f.install(next, gen); f.emit();
  assert.equal(f.status().ingressProbe.counters.staleSocket, 1);
  f.emit([f.message("new")], next);
  assert.equal(f.metrics().handled, 3);
  assert.equal(f.status().ingressProbe.lastCallback.generation, gen);
});

test("real Baileys buffer can retain before callback; snapshot observes without flushing or adding listeners", async t => {
  const f = await fixture(t); f.install(); f.start();
  f.sock.ev.buffer(); f.emit();
  assert.equal(f.status().ingressProbe.bindingCurrent.buffering, true);
  assert.equal(f.status().ingressProbe.counters.wrapperCalls, 0);
  assert.equal(f.status().coverage.matchingMessages, 0);
  // Fixture-only simulation of the Baileys state machine. Never flush production.
  f.sock.ev.flush();
  assert.equal(f.status().ingressProbe.counters.wrapperCalls, 1);
  assert.equal(f.status().ingressProbe.bindingCurrent.buffering, false);
  assert.equal(f.status().coverage.matchingMessages, 1);
});

test("other destinations are aggregate counts only; alternative/normalized JID is diagnostic, never scope expansion", async t => {
  const f = await fixture(t); f.install(); f.start();
  const other = "OTHER_PRIVATE_GROUP@g.us", peer = "PRIVATE_PHONE@s.whatsapp.net";
  const alt = f.message("secret-alt", other); alt.key.remoteJidAlt = G;
  f.emit([f.message("secret-id", other), f.message("secret-peer", peer), alt,
    f.message("secret-normalized", " " + G.toUpperCase() + " ")]);
  const s = f.status(), c = s.ingressProbe.counters;
  assert.equal(c.messagesSeen, 4); assert.equal(c.nonTargetMessages, 4);
  assert.equal(c.alternateTargetMatches, 1); assert.equal(c.normalizedTargetMatches, 1);
  assert.equal(s.events, 0); assert.equal(s.records.length, 0);
  for (const secret of [other, peer, G, S, W, "PRIVATE_CONTENT_NOT_RECORDED", "secret-id", "secret-alt"])
    assert.ok(!JSON.stringify(s).includes(secret), secret);
});

test("other session has zero probe effects; captured workspace mismatch is a boolean, not foreign identity", async t => {
  const f = await fixture(t, { capturedWorkspaceId: "FOREIGN_PRIVATE_WORKSPACE" }); f.install(); f.start();
  const before = f.status().ingressProbe.counters;
  f.d.observe({ sessionId: "another-session", messages: [f.message()] });
  f.d.observeListener({ sessionId: "another-session" });
  assert.deepEqual(f.status().ingressProbe.counters, before);
  f.emit();
  assert.equal(f.status().ingressProbe.counters.workspaceMismatch, 1);
  assert.ok(f.status().records.some(r => r.code === "workspace_mismatch"));
  assert.ok(!JSON.stringify(f.status()).includes("FOREIGN_PRIVATE_WORKSPACE"));
  assert.deepEqual(f.d.status("another-workspace"), { state: "off", records: [], events: 0 });
});

test("participant events remain separate from upsert probe; malformed and empty batches have explicit counts", async t => {
  const f = await fixture(t); f.install(); f.start();
  const before = f.status().ingressProbe.counters;
  f.d.observeParticipants({ sessionId: S, capturedWorkspaceId: W, current: true, generation: 1,
    event: { id: G, action: "add", participants: ["PRIVATE_PARTICIPANT@lid"] } });
  assert.deepEqual(f.status().ingressProbe.counters, before);
  f.emit([]); f.emit(null);
  assert.equal(f.status().ingressProbe.counters.batchesEmpty, 1);
  assert.equal(f.status().ingressProbe.counters.invalidBatch, 1);
});

test("authorization/error/expiry fail closed; failures never expose exceptions or stop the original handler", async t => {
  const f = await fixture(t); f.install(); f.start(); f.setAuthorized("throws");
  assert.doesNotThrow(() => f.emit()); assert.equal(f.metrics().handled, 1);
  assert.equal(f.status().ingressProbe.counters.observerErrors, 1);
  assert.ok(!JSON.stringify(f.status()).includes("PRIVATE_ERROR"));
  f.setAuthorized(false); f.emit(); assert.equal(f.status().state, "finished");
  assert.equal(f.status().ingressProbe.counters.authorizationRejected, 1);
  const final = f.status().ingressProbe;
  f.emit(); assert.deepEqual(f.status().ingressProbe, final);
  const x = await fixture(t); x.install(); x.start(); x.setNow(900001); x.emit();
  assert.equal(x.status().state, "finished");
  assert.equal(x.status().ingressProbe.counters.wrapperCalls, 0);
  assert.equal(new Diagnostics().status(W).state, "off");
});

test("optional hook cannot change wrapper fences or commercial handler return values", () => {
  const { EventEmitter } = require("node:events");
  const sock = { ev: new EventEmitter() };
  let calls = 0;
  registrarListenerUnicoSocket({ sock, evento: "messages.upsert", logger,
    onInvoke() { throw new Error("unavailable"); }, handler: () => ++calls });
  assert.equal(sock.__optimusListeners["messages.upsert"].handler({}), 1);
  sock.ev = new EventEmitter();
  assert.equal(sock.__optimusListeners["messages.upsert"].handler({}), undefined);
  assert.equal(calls, 1);
});
