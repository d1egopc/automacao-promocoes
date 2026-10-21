const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { V3Store } = require("../modules/mensageiro-v3/src/v3/store");
const { createPersistentWorkspaceFence } = require("../modules/mensageiro-v3/workspace-fence");
const { createHandlerBridge } = require("../modules/mensageiro-v3/handler-bridge");

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "m34-p3-rollback-"));
  const filePath = path.join(dir, "state.json");
  fs.writeFileSync(filePath, JSON.stringify({
    schemaVersion: 3,
    revision: 0,
    workspaces: {},
    deletedIds: { profiles: {}, schedules: {} },
    workspaceFences: {}
  }));
  return { dir, filePath };
}

function activeProfile(store, workspaceId) {
  const profile = store.createProfile({ workspaceId, sessionId: `session-${workspaceId}`, name: "Perfil V3" });
  store.updateProfile(workspaceId, profile.id, { active: true });
  store.saveCard(workspaceId, profile.id, "commands", { active: true });
  store.saveCard(workspaceId, profile.id, "scheduled", { active: true });
  return profile.id;
}

function bridge({ store, fence, legacyCalls, v3Calls, withV3 = true }) {
  return createHandlerBridge({
    store,
    fence,
    legacyHandlers: { commands: async () => { legacyCalls.push("legacy"); return "legacy"; } },
    v3Handlers: withV3 ? { commands: async () => { v3Calls.push("v3"); return "v3"; } } : {}
  });
}

test("M3.4-P3 — fence V3_MIGRATED sobrevive reinício e impede rollback legado", async () => {
  const f = fixture();
  try {
    const firstStore = new V3Store({ filePath: f.filePath });
    const profileId = activeProfile(firstStore, "workspace-migrated");
    const firstFence = createPersistentWorkspaceFence({ store: firstStore });
    firstFence.markMigrated("workspace-migrated", { source: "m34-p3-test" });

    const legacyCalls = [];
    const v3Calls = [];
    const first = bridge({ store: firstStore, fence: firstFence, legacyCalls, v3Calls });
    const initial = await first.dispatch({ workspaceId: "workspace-migrated", profileId, card: "commands", eventId: "evt-1" });
    assert.equal(initial.mode, "v3");
    assert.deepEqual(legacyCalls, []);
    assert.deepEqual(v3Calls, ["v3"]);

    // Simulate a container recreation: only the durable files survive.
    const restartedStore = new V3Store({ filePath: f.filePath });
    const restartedFence = createPersistentWorkspaceFence({ store: restartedStore });
    assert.equal(restartedFence.status("workspace-migrated"), "V3_MIGRATED");

    // A rollback image without V3 handlers must fail closed, never fall back
    // to a legacy handler for a migrated workspace.
    const rollback = bridge({
      store: restartedStore,
      fence: restartedFence,
      legacyCalls,
      v3Calls,
      withV3: false
    });
    const blocked = await rollback.dispatch({ workspaceId: "workspace-migrated", profileId, card: "commands", eventId: "evt-rollback" });
    assert.deepEqual(blocked, { ok: false, blocked: true, reason: "handler_v3_indisponivel" });
    assert.deepEqual(legacyCalls, []);

    // A V3-aware recreation also retains the claim fence, so the same event
    // cannot be delivered a second time after restart.
    const recreated = bridge({ store: restartedStore, fence: restartedFence, legacyCalls, v3Calls });
    const duplicate = await recreated.dispatch({ workspaceId: "workspace-migrated", profileId, card: "commands", eventId: "evt-1" });
    assert.equal(duplicate.duplicate, true);
    assert.deepEqual(v3Calls, ["v3"]);
  } finally {
    fs.rmSync(f.dir, { recursive: true, force: true });
  }
});

test("M3.4-P3 — workspace legada continua no caminho legado e não herda V3", async () => {
  const f = fixture();
  try {
    const store = new V3Store({ filePath: f.filePath });
    const migratedProfile = activeProfile(store, "workspace-migrated");
    const legacyProfile = activeProfile(store, "workspace-legacy");
    const fence = createPersistentWorkspaceFence({ store });
    fence.markMigrated("workspace-migrated");
    const legacyCalls = [];
    const v3Calls = [];
    const bridgeInstance = bridge({ store, fence, legacyCalls, v3Calls });

    const migrated = await bridgeInstance.dispatch({ workspaceId: "workspace-migrated", profileId: migratedProfile, card: "commands", eventId: "migrated" });
    const legacy = await bridgeInstance.dispatch({ workspaceId: "workspace-legacy", profileId: legacyProfile, card: "commands", eventId: "legacy" });
    assert.equal(migrated.mode, "v3");
    assert.equal(legacy.mode, "legacy");
    assert.deepEqual(v3Calls, ["v3"]);
    assert.deepEqual(legacyCalls, ["legacy"]);
  } finally {
    fs.rmSync(f.dir, { recursive: true, force: true });
  }
});

test("M3.4-P3 — estado V3 vazio permanece fail-closed e não importa legado", async () => {
  const f = fixture();
  try {
    const store = new V3Store({ filePath: f.filePath });
    const fence = createPersistentWorkspaceFence({ store });
    fence.markMigrated("workspace-empty");
    const legacyCalls = [];
    const v3Calls = [];
    const instance = bridge({ store, fence, legacyCalls, v3Calls, withV3: false });
    const blocked = await instance.dispatch({ workspaceId: "workspace-empty", profileId: "profile-from-legacy", card: "commands", eventId: "legacy-artifact" });
    assert.deepEqual(blocked, { ok: false, blocked: true, reason: "card_v3_inativo" });
    assert.deepEqual(legacyCalls, []);
    assert.deepEqual(v3Calls, []);
    assert.deepEqual(new V3Store({ filePath: f.filePath }).snapshot().workspaces["workspace-empty"].profiles, {});
  } finally {
    fs.rmSync(f.dir, { recursive: true, force: true });
  }
});

test("M3.4-P3 — perda do estado com autoridade V3 persistida bloqueia inicialização", () => {
  const f = fixture();
  try {
    const store = new V3Store({ filePath: f.filePath });
    const fence = createPersistentWorkspaceFence({ store });
    fence.markMigrated("workspace-migrated");
    assert.equal(fs.existsSync(`${f.filePath}.migration-authority`), true);
    fs.rmSync(f.filePath);
    assert.throws(() => new V3Store({ filePath: f.filePath }), /mensageiro_v3_authority_missing/);
  } finally {
    fs.rmSync(f.dir, { recursive: true, force: true });
  }
});
