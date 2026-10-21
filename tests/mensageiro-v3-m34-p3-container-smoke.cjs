"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { V3Store } = require("../modules/mensageiro-v3/src/v3/store");
const { createPersistentWorkspaceFence } = require("../modules/mensageiro-v3/workspace-fence");
const { createHandlerBridge } = require("../modules/mensageiro-v3/handler-bridge");

const root = path.resolve(process.env.V3_SMOKE_ROOT || "/data/mensageiro-v3");
const statePath = path.join(root, "state.json");
const mode = process.env.V3_SMOKE_MODE || "verify";
const workspaceId = "workspace-container-smoke";

fs.mkdirSync(root, { recursive: true });

function bridge({ store, fence, withV3, legacyCalls, v3Calls }) {
  return createHandlerBridge({
    store,
    fence,
    legacyHandlers: { commands: async () => { legacyCalls.push("legacy"); } },
    v3Handlers: withV3 ? { commands: async () => { v3Calls.push("v3"); } } : {}
  });
}

async function seed() {
  if (fs.existsSync(statePath)) throw new Error("volume_nao_descartavel");
  fs.writeFileSync(statePath, JSON.stringify({ schemaVersion: 3, revision: 0, workspaces: {}, deletedIds: { profiles: {}, schedules: {} }, workspaceFences: {} }));
  const store = new V3Store({ filePath: statePath });
  const profile = store.createProfile({ workspaceId, sessionId: "session-container-smoke", name: "Smoke" });
  store.updateProfile(workspaceId, profile.id, { active: true });
  store.saveCard(workspaceId, profile.id, "commands", { active: true });
  const fence = createPersistentWorkspaceFence({ store });
  fence.markMigrated(workspaceId, { source: "m34-p3-container-smoke" });
  const result = await bridge({ store, fence, withV3: true, legacyCalls: [], v3Calls: [] }).dispatch({
    workspaceId, profileId: profile.id, card: "commands", eventId: "container-smoke"
  });
  assert.equal(result.ok, true);
  assert.equal(result.mode, "v3");
  process.stdout.write(JSON.stringify({ mode, workspaceId, profileId: profile.id, fence: fence.status(workspaceId) }));
}

async function verify() {
  const store = new V3Store({ filePath: statePath });
  const fence = createPersistentWorkspaceFence({ store });
  assert.equal(fence.status(workspaceId), "V3_MIGRATED");
  const profileId = Object.keys(store.snapshot().workspaces[workspaceId]?.profiles || {})[0];
  assert.ok(profileId);
  const legacyCalls = [];
  const blocked = await bridge({ store, fence, withV3: false, legacyCalls, v3Calls: [] }).dispatch({
    workspaceId, profileId, card: "commands", eventId: "rollback-smoke"
  });
  assert.deepEqual(blocked, { ok: false, blocked: true, reason: "handler_v3_indisponivel" });
  assert.deepEqual(legacyCalls, []);
  const duplicate = await bridge({ store, fence, withV3: true, legacyCalls, v3Calls: [] }).dispatch({
    workspaceId, profileId, card: "commands", eventId: "container-smoke"
  });
  assert.equal(duplicate.duplicate, true);
  process.stdout.write(JSON.stringify({ mode, workspaceId, profileId, fence: fence.status(workspaceId), legacyCalls: legacyCalls.length, duplicate: duplicate.duplicate === true }));
}

(mode === "seed" ? seed() : verify()).catch(error => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
