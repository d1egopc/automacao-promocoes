const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { V3Store } = require("../modules/mensageiro-v3/src/v3/store");
const { V3Scheduler } = require("../modules/mensageiro-v3/src/v3/scheduler");
const { buildCardIntegrationMatrix, createSimulatedCardAdapters, createCardRuntime } = require("../modules/mensageiro-v3/adapter");
const { createWorkspaceFence, createPersistentWorkspaceFence } = require("../modules/mensageiro-v3/workspace-fence");
const { createHandlerBridge } = require("../modules/mensageiro-v3/handler-bridge");

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "m32-mensageiro-"));
  const now = Date.parse("2026-10-20T12:00:00.000Z");
  const filePath = path.join(dir, "state.json");
  // Seed an existing valid file so the Windows disposable harness uses its
  // copy/replace fallback instead of rename-over-open-file semantics.
  fs.writeFileSync(filePath, JSON.stringify({ schemaVersion: 3, revision: 0, workspaces: {}, deletedIds: { profiles: {}, schedules: {} } }));
  return { dir, now: () => now, store: new V3Store({ filePath, clock: () => now }) };
}

function activeProfile(store, workspaceId) {
  const profile = store.createProfile({ workspaceId, sessionId: `session-${workspaceId}`, name: "Perfil isolado" });
  store.updateProfile(workspaceId, profile.id, { active: true });
  store.saveCard(workspaceId, profile.id, "scheduled", { active: true });
  return profile.id;
}

test("M3.2 — quatro cards têm adapters reais inventariados e adapters simulados injetáveis", () => {
  const matrix = buildCardIntegrationMatrix();
  assert.deepEqual(Object.keys(matrix).sort(), ["attendance", "commands", "groupManager", "scheduledMessages"]);
  assert.equal(matrix.scheduledMessages.existingExecutor, "programacoes.scheduler.js");
  assert.equal(matrix.commands.existingExecutor, "tratarMensagemGrupoComando");
  assert.equal(matrix.attendance.existingExecutor, "tratarMensagemPrivadaAtendimento");
  assert.equal(matrix.groupManager.existingExecutor, "tratarMensagemGrupoGerente");
  const calls = [];
  const adapters = createSimulatedCardAdapters(Object.fromEntries(Object.keys(matrix).map(name => [name, {
    authorize: async () => true,
    send: async payload => calls.push({ name, payload })
  }])));
  assert.equal(Object.keys(adapters).length, 4);
  assert.equal(calls.length, 0);
});

test("M3.2 — Mensagens Programadas usa V3 em fixture e não executa legado", async () => {
  const f = fixture();
  const profileId = activeProfile(f.store, "workspace-a");
  const schedule = f.store.createSchedule("workspace-a", profileId, {
    destinations: ["group-a"],
    nextRunAt: "2026-10-20T11:59:00.000Z",
    content: { type: "text", text: "teste" }
  });
  f.store.activateSchedule("workspace-a", schedule.id);
  const sent = [];
  const result = await new V3Scheduler({
    store: f.store,
    clock: f.now,
    transport: {
      authorizeSend: async () => true,
      sendMessage: async payload => sent.push(payload)
    }
  }).tick();
  assert.equal(result.sent.length, 1);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].workspaceId, "workspace-a");
});

test("M3.2.1 — scheduler V3 respeita fence e só envia após migração durável", async () => {
  const f = fixture();
  const profileId = activeProfile(f.store, "workspace-fence");
  const schedule = f.store.createSchedule("workspace-fence", profileId, {
    destinations: ["group-fence"],
    nextRunAt: "2026-10-20T11:59:00.000Z",
    content: { type: "text", text: "teste fence" }
  });
  f.store.activateSchedule("workspace-fence", schedule.id);
  const sent = [];
  const scheduler = new V3Scheduler({
    store: f.store,
    clock: f.now,
    isWorkspaceMigrated: () => false,
    transport: { authorizeSend: async () => true, sendMessage: async payload => sent.push(payload) }
  });
  assert.equal((await scheduler.tick()).sent.length, 0);
  assert.equal(sent.length, 0);
  scheduler.isWorkspaceMigrated = () => true;
  assert.equal((await scheduler.tick()).sent.length, 1);
  assert.equal(sent[0].destination, "group-fence");
});

test("M3.2 — cards não integrados ficam explicitamente bloqueados no corte", () => {
  const matrix = buildCardIntegrationMatrix();
  for (const card of ["commands", "attendance", "groupManager"]) {
    assert.equal(matrix[card].v3Status, "v3_config_adapter_real_handler");
  }
});

test("M3.2 — Comandos, Atendimento e Gerente usam a mesma autoridade persistida", async () => {
  const f = fixture();
  const profileId = activeProfile(f.store, "workspace-a");
  const calls = [];
  const adapters = Object.fromEntries(["scheduledMessages", "commands", "attendance", "groupManager"].map(name => [name, {
    authorize: async () => true,
    send: async payload => calls.push(payload)
  }]));
  const execute = createCardRuntime({ store: f.store, adapters });
  for (const card of ["commands", "attendance", "groupManager"]) {
    f.store.saveCard("workspace-a", profileId, card, { active: true });
    const result = await execute({ workspaceId: "workspace-a", profileId, card, payload: { eventId: card } });
    assert.equal(result.ok, true);
  }
  assert.equal(calls.length, 3);
  f.store.saveCard("workspace-a", profileId, "commands", { active: false });
  assert.deepEqual(await execute({ workspaceId: "workspace-a", profileId, card: "commands", payload: { eventId: "off" } }), { ok: false, reason: "card_inativo" });
  f.store.deleteProfile("workspace-a", profileId);
  assert.deepEqual(await execute({ workspaceId: "workspace-a", profileId, card: "attendance", payload: { eventId: "deleted" } }), { ok: false, reason: "card_inativo" });
});

test("M3.2 — cards e claims permanecem isolados entre workspaces e instâncias", async () => {
  const f = fixture();
  const a = activeProfile(f.store, "workspace-a");
  const b = activeProfile(f.store, "workspace-b");
  f.store.saveCard("workspace-a", a, "commands", { active: true });
  f.store.saveCard("workspace-b", b, "commands", { active: true });
  const calls = [];
  const adapters = Object.fromEntries(["scheduledMessages", "commands", "attendance", "groupManager"].map(name => [name, {
    authorize: async () => true,
    send: async payload => calls.push(payload)
  }]));
  const first = createCardRuntime({ store: f.store, adapters });
  const second = createCardRuntime({ store: new V3Store({ filePath: path.join(f.dir, "state.json"), clock: f.now }), adapters });
  const results = await Promise.all([
    first({ workspaceId: "workspace-a", profileId: a, card: "commands", payload: { eventId: "same" } }),
    second({ workspaceId: "workspace-a", profileId: a, card: "commands", payload: { eventId: "same" } }),
    first({ workspaceId: "workspace-b", profileId: b, card: "commands", payload: { eventId: "same" } })
  ]);
  assert.equal(results.filter(item => item.ok).length, 2);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map(item => item.workspaceId).sort(), ["workspace-a", "workspace-b"]);
});

test("M3.2 — fence de migração separa legado e V3 sem ativar workspace real", () => {
  const fence = createWorkspaceFence({ migratedWorkspaceIds: ["workspace-v3"] });
  assert.equal(fence.v3Required("workspace-v3"), true);
  assert.equal(fence.legacyAllowed("workspace-v3"), false);
  assert.equal(fence.legacyAllowed("workspace-legada"), true);
  assert.equal(fence.v3Required("workspace-legada"), false);
});

test("M3.2.1 — fence persistente sobrevive ao restart e não migra por padrão", () => {
  const f = fixture();
  const fencePath = path.join(f.dir, "workspace-fence.json");
  const first = createPersistentWorkspaceFence({ filePath: fencePath });
  assert.equal(first.isMigrated("workspace-a"), false);
  first.markMigrated("workspace-a", { source: "test" });
  const restarted = createPersistentWorkspaceFence({ filePath: fencePath });
  assert.equal(restarted.isMigrated("workspace-a"), true);
  assert.throws(() => restarted.markLegacy("workspace-a"), /fence_reversao_bloqueada/);
  assert.equal(createPersistentWorkspaceFence({ filePath: fencePath }).isMigrated("workspace-a"), true);
});

test("M3.2.1 — ingressos reais usam V3 para workspace migrada e nunca fazem fallback silencioso", async () => {
  const f = fixture();
  const profileId = activeProfile(f.store, "workspace-v3");
  f.store.saveCard("workspace-v3", profileId, "commands", { active: true });
  const fence = createWorkspaceFence({ migratedWorkspaceIds: ["workspace-v3"] });
  const calls = [];
  const bridge = createHandlerBridge({
    fence,
    store: f.store,
    legacyHandlers: { commands: async () => calls.push("legacy") },
    v3Handlers: { commands: async payload => calls.push({ mode: "v3", workspaceId: payload.workspaceId }) }
  });
  const v3 = await bridge.dispatch({ workspaceId: "workspace-v3", profileId, card: "commands", eventId: "evt-1" });
  assert.equal(v3.ok, true);
  assert.equal(v3.mode, "v3");
  assert.deepEqual(calls, [{ mode: "v3", workspaceId: "workspace-v3" }]);
  f.store.saveCard("workspace-v3", profileId, "commands", { active: false });
  assert.deepEqual(await bridge.dispatch({ workspaceId: "workspace-v3", profileId, card: "commands", eventId: "evt-2" }), { ok: false, blocked: true, reason: "card_v3_inativo" });
  assert.deepEqual(calls, [{ mode: "v3", workspaceId: "workspace-v3" }]);
  const missing = createHandlerBridge({ fence, store: f.store, legacyHandlers: { commands: async () => "legacy" } });
  f.store.saveCard("workspace-v3", profileId, "commands", { active: true });
  assert.deepEqual(await missing.dispatch({ workspaceId: "workspace-v3", profileId, card: "commands", eventId: "evt-3" }), { ok: false, blocked: true, reason: "handler_v3_indisponivel" });
  const legacyProfile = activeProfile(f.store, "workspace-legacy");
  f.store.saveCard("workspace-legacy", legacyProfile, "commands", { active: true });
  assert.equal((await bridge.dispatch({ workspaceId: "workspace-legacy", profileId: legacyProfile, card: "commands", eventId: "evt-4" })).mode, "legacy");
});

test("M3.2.1 — cards secundários seguem a mesma autoridade persistida", () => {
  const f = fixture();
  const profile = f.store.createProfile({ workspaceId: "workspace-a", sessionId: "session-a", name: "Perfil" });
  f.store.updateProfile("workspace-a", profile.id, { active: true });
  for (const card of ["welcome", "farewell", "faq", "flows", "quickReplies"]) {
    const saved = f.store.saveCard("workspace-a", profile.id, card, { active: true, configuration: { source: "v3" } });
    assert.equal(saved.active, true);
    assert.equal(f.store.canExecuteCard("workspace-a", profile.id, card), true);
    f.store.saveCard("workspace-a", profile.id, card, { active: false });
    assert.equal(f.store.canExecuteCard("workspace-a", profile.id, card), false);
  }
});
