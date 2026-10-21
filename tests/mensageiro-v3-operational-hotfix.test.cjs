"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { V3Store } = require("../modules/mensageiro-v3/src/v3/store");
const { V3Scheduler } = require("../modules/mensageiro-v3/src/v3/scheduler");
const { createHandlerBridge } = require("../modules/mensageiro-v3/handler-bridge");
const { selectProfile, eventIdentity, scheduledPayload, authorizedDestination, createOperationalIngress } = require("../modules/mensageiro-v3/operational-gates");

const root = fs.mkdtempSync(path.join(__dirname, ".m3-hotfix-"));
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

function fixture(now = Date.now()) {
  const filePath = path.join(root, `${Math.random().toString(16).slice(2)}.json`);
  const store = new V3Store({ filePath, clock: () => now });
  const profile = store.createProfile({ workspaceId: "ws-a", sessionId: "session-a", name: "A" });
  store.updateProfile("ws-a", profile.id, { active: true });
  return { store, profileId: profile.id };
}

test("ingress selects only the active card, same session, same group and workspace", () => {
  const { store, profileId } = fixture();
  store.saveCard("ws-a", profileId, "commands", { active: true, configuration: { gruposConfigurados: true, grupos: ["a@g.us"] } });
  store.saveCard("ws-a", profileId, "groupManager", { active: true, configuration: { gruposConfigurados: true, grupos: ["a@g.us"] } });
  for (const card of ["commands", "groupManager"]) {
    assert.equal(selectProfile(store, { workspaceId: "ws-a", sessionId: "session-a", card, groupId: "a@g.us" }).profileId, profileId);
    assert.equal(selectProfile(store, { workspaceId: "ws-a", sessionId: "session-a", card, groupId: "b@g.us" }).reason, "GRUPO_NAO_AUTORIZADO");
    assert.equal(selectProfile(store, { workspaceId: "ws-b", sessionId: "session-a", card, groupId: "a@g.us" }).reason, "PERFIL_INATIVO");
    assert.equal(selectProfile(store, { workspaceId: "ws-a", sessionId: "session-b", card, groupId: "a@g.us" }).reason, "SESSAO_INCORRETA");
  }
  store.saveCard("ws-a", profileId, "commands", { active: false });
  assert.equal(selectProfile(store, { workspaceId: "ws-a", sessionId: "session-a", card: "commands", groupId: "a@g.us" }).reason, "CARD_INATIVO");
});

test("private attendance, FAQ, flows and quick replies require a unique active profile", () => {
  const { store, profileId } = fixture();
  for (const card of ["attendance", "faq", "flows", "quickReplies"]) {
    store.saveCard("ws-a", profileId, card, { active: true });
    assert.equal(selectProfile(store, { workspaceId: "ws-a", sessionId: "session-a", card }).profileId, profileId);
  }
  const second = store.createProfile({ workspaceId: "ws-a", sessionId: "session-a", name: "B" });
  store.updateProfile("ws-a", second.id, { active: true });
  store.saveCard("ws-a", second.id, "attendance", { active: true });
  assert.equal(selectProfile(store, { workspaceId: "ws-a", sessionId: "session-a", card: "attendance" }).reason, "PERFIL_AMBIGUO");
});

test("participant event identity is not a permanent group claim and quick replay is stable", () => {
  const event = { id: "a@g.us", action: "add", participants: ["member@s.whatsapp.net"] };
  assert.equal(eventIdentity({ event, card: "welcome", now: 60_001 }), eventIdentity({ event, card: "welcome", now: 61_000 }));
  assert.notEqual(eventIdentity({ event, card: "welcome", now: 60_001 }), eventIdentity({ event, card: "welcome", now: 120_001 }));
  assert.notEqual(eventIdentity({ event, card: "welcome", now: 60_001 }), eventIdentity({ event, card: "farewell", now: 60_001 }));
  assert.equal(eventIdentity({ message: { key: { id: "message-1" } }, card: "commands" }), "message-1");
});

test("Baileys-like ingress reaches authorized V3 handlers, but not wrong group/workspace or duplicates", async () => {
  const { store, profileId } = fixture();
  const calls = [];
  const handlers = Object.fromEntries(["commands", "groupManager", "welcome", "farewell", "attendance", "faq", "flows", "quickReplies"]
    .map(card => [card, async args => { calls.push({ card, profileId: args.profileId }); return { handled: true }; }]));
  const bridge = createHandlerBridge({ fence: { universal: true, v3Required: () => true, legacyAllowed: () => false }, store, v3Handlers: handlers });
  const ingress = createOperationalIngress({ store, bridge, clock: () => 60_000 });
  for (const card of ["commands", "groupManager", "welcome", "farewell"]) {
    store.saveCard("ws-a", profileId, card, { active: true, configuration: { gruposConfigurados: true, grupos: ["a@g.us"] } });
  }
  for (const card of ["attendance", "faq", "flows", "quickReplies"]) store.saveCard("ws-a", profileId, card, { active: true });
  const sock = { sendMessage: async () => ({ key: { id: "mock" } }) };
  const groupMessage = id => ({ key: { id, remoteJid: "a@g.us" } });
  for (const card of ["commands", "groupManager"]) {
    assert.deepEqual(await ingress({ workspaceId: "ws-a", sessionId: "session-a", card, message: groupMessage(`m-${card}`), sock, planAllowed: true }), { handled: true });
  }
  for (const [card, action] of [["welcome", "add"], ["farewell", "remove"]]) {
    assert.deepEqual(await ingress({ workspaceId: "ws-a", sessionId: "session-a", card, event: { id: "a@g.us", action, participants: ["member@s.whatsapp.net"] }, sock, planAllowed: true }), { handled: true });
  }
  assert.deepEqual(await ingress({ workspaceId: "ws-a", sessionId: "session-a", card: "attendance", message: { key: { id: "private-1", remoteJid: "member@s.whatsapp.net" } }, sock, planAllowed: true }), { handled: true });
  assert.equal(calls.length, 5);
  assert.equal((await ingress({ workspaceId: "ws-a", sessionId: "session-a", card: "commands", message: groupMessage("m-commands"), sock, planAllowed: true })).reason, "CLAIM_EXISTENTE");
  assert.equal((await ingress({ workspaceId: "ws-a", sessionId: "session-a", card: "welcome", event: { id: "b@g.us", action: "add", participants: ["member@s.whatsapp.net"] }, sock, planAllowed: true })).reason, "GRUPO_NAO_AUTORIZADO");
  assert.equal((await ingress({ workspaceId: "ws-b", sessionId: "session-a", card: "commands", message: groupMessage("m-other"), sock, planAllowed: true })).reason, "PERFIL_INATIVO");
  assert.equal(calls.length, 5);
});

test("V3 transport receives a Baileys payload, never the persisted legacy configuration object", () => {
  assert.deepEqual(scheduledPayload({ conteudos: [{ tipo: "texto", texto: "hello" }], intervaloMinutos: 12 }), { text: "hello" });
  assert.deepEqual(scheduledPayload({ text: "V3" }), { text: "V3" });
  assert.deepEqual(scheduledPayload({ conteudos: [{ tipo: "imagem_texto", texto: "caption", imagem: "https://example.test/art.png" }] }), { image: { url: "https://example.test/art.png" }, caption: "caption" });
  assert.throws(() => scheduledPayload({ conteudos: [{ tipo: "texto", texto: "" }] }), /conteudo_programacao_invalido/);
});

test("scheduled transport rechecks session ownership and exact group before sending", () => {
  const base = { workspaceId: "ws-a", sessionId: "session-a", destination: "a@g.us", sessionMeta: { owner: "ws-a" }, groups: [{ id: "a@g.us" }], belongsToWorkspace: (meta, id) => meta.owner === id };
  assert.equal(authorizedDestination(base), true);
  assert.equal(authorizedDestination({ ...base, workspaceId: "ws-b" }), false);
  assert.equal(authorizedDestination({ ...base, destination: "b@g.us" }), false);
  assert.equal(authorizedDestination({ ...base, groups: [] }), false);
  assert.equal(authorizedDestination({ ...base, sessionMeta: null }), false);
  const source = fs.readFileSync(path.join(__dirname, "../index.js"), "utf8");
  assert.match(source, /authorizeSend:[\s\S]*?destinoMensageiroV3Autorizado/);
  assert.match(source, /sendMessage: async \(\{ workspaceId[\s\S]*?destinoMensageiroV3Autorizado/);
});

test("12/15 minute schedules execute once, advance, survive restart and never replay stale occurrences", async () => {
  const now = Date.parse("2026-10-21T12:00:00.000Z");
  const { store, profileId } = fixture(now);
  store.saveCard("ws-a", profileId, "scheduled", { active: true });
  const calls = [];
  const clock = { now };
  const transport = { authorizeSend: async () => true, sendMessage: async args => { calls.push(args); return { confirmed: false, ambiguous: true }; } };
  const scheduler = new V3Scheduler({ store, transport, clock: () => clock.now });
  for (const minutes of [12, 15]) {
    const s = store.createSchedule("ws-a", profileId, { nextRunAt: new Date(now).toISOString(), intervalMs: minutes * 60_000, destinations: [`${minutes}@g.us`], content: { text: String(minutes) } });
    store.activateSchedule("ws-a", s.id);
  }
  await scheduler.tick();
  assert.equal(calls.length, 2);
  assert.ok(store.listSchedules("ws-a").every(s => Date.parse(s.nextRunAt) > now));
  await new V3Scheduler({ store: new V3Store({ filePath: store.filePath }), transport, clock: () => clock.now }).tick();
  assert.equal(calls.length, 2, "restart cannot resend a claimed occurrence");
  clock.now = now + 60 * 60_000;
  await scheduler.tick();
  assert.equal(calls.length, 2, "missed occurrences must not be replayed after downtime");
  assert.ok(store.listSchedules("ws-a").every(s => Date.parse(s.nextRunAt) > clock.now));
  store.saveCard("ws-a", profileId, "scheduled", { active: false });
  clock.now += 15 * 60_000;
  await scheduler.tick();
  assert.equal(calls.length, 2, "OFF blocks transport");
});

test("production ingress uses the V3 bridge instead of direct legacy handlers", () => {
  const source = fs.readFileSync(path.join(__dirname, "../index.js"), "utf8");
  const block = source.slice(source.indexOf('evento: "messages.upsert"'), source.indexOf('evento: "messages.update"'));
  assert.match(block, /dispatchMensageiroV3Ingress/);
  assert.doesNotMatch(block, /mensageiro\.tratarMensagem(?:GrupoGerente|GrupoComando|PrivadaAtendimento)/);
  const group = source.slice(source.indexOf('sock.ev.on("group-participants.update"'), source.indexOf('sock.ev.on("connection.update"'));
  assert.match(group, /dispatchMensageiroV3Ingress/);
  assert.doesNotMatch(group, /mensageiro\.tratarEventoGrupoMensageiro/);
});
