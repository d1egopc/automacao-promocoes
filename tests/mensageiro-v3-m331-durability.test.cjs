const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { V3Store } = require("../modules/mensageiro-v3/src/v3/store");
const { createPersistentWorkspaceFence, createWorkspaceFence } = require("../modules/mensageiro-v3/workspace-fence");
const { createHandlerBridge } = require("../modules/mensageiro-v3/handler-bridge");
const { resolveDurablePath, assertDurableStorage } = require("../modules/mensageiro-v3/durable-path");

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "m331-v3-"));
  const filePath = path.join(dir, "state.json");
  fs.writeFileSync(filePath, JSON.stringify({ schemaVersion: 3, revision: 0, workspaces: {}, deletedIds: { profiles: {}, schedules: {} }, workspaceFences: {} }));
  return { dir, filePath };
}

function activeProfile(store, workspaceId) {
  const profile = store.createProfile({ workspaceId, sessionId: `session-${workspaceId}`, name: "Perfil" });
  store.updateProfile(workspaceId, profile.id, { active: true });
  store.saveCard(workspaceId, profile.id, "commands", { active: true });
  store.saveCard(workspaceId, profile.id, "scheduled", { active: true });
  return profile.id;
}

test("M3.3.1 — V3 usa autoridade durável explícita, nunca process.cwd", () => {
  const f = fixture();
  try {
    assert.equal(path.isAbsolute(resolveDurablePath({ statePath: f.filePath }).statePath), true);
    assert.throws(() => resolveDurablePath({ env: {} }), /storage_path_required|storage_path_invalido/);
    assert.doesNotThrow(() => assertDurableStorage(f.filePath));
  } finally { fs.rmSync(f.dir, { recursive: true, force: true }); }
});

test("M3.3.1 — fence monotônico impede reativação do legado e preserva workspace não migrada", () => {
  const f = fixture();
  try {
    const store = new V3Store({ filePath: f.filePath });
    const fence = createPersistentWorkspaceFence({ store });
    assert.equal(fence.status("legacy"), "LEGACY");
    fence.markPreparing("v3");
    assert.equal(fence.legacyAllowed("v3"), false);
    assert.equal(fence.v3Required("v3"), false);
    fence.markQuiesced("v3");
    fence.markMigrated("v3");
    assert.equal(fence.v3Required("v3"), true);
    assert.throws(() => fence.markLegacy("v3"), /fence_reversao_bloqueada/);
    assert.equal(createPersistentWorkspaceFence({ store: new V3Store({ filePath: f.filePath }) }).v3Required("v3"), true);
  } finally { fs.rmSync(f.dir, { recursive: true, force: true }); }
});

test("M3.3.1 — falha de leitura, fence ausente ou corrompido bloqueia, não reativa legado", () => {
  const f = fixture();
  try {
    const store = new V3Store({ filePath: f.filePath });
    const profileId = activeProfile(store, "workspace-a");
    const fence = createPersistentWorkspaceFence({ store });
    fence.markMigrated("workspace-a");
    fs.rmSync(f.filePath);
    assert.throws(() => new V3Store({ filePath: f.filePath }), /authority_missing/);
    const isolatedFencePath = path.join(f.dir, "fence.json");
    const isolated = createPersistentWorkspaceFence({ filePath: isolatedFencePath });
    isolated.markMigrated("workspace-a");
    fs.rmSync(isolatedFencePath);
    assert.throws(() => createPersistentWorkspaceFence({ filePath: isolatedFencePath }).v3Required("workspace-a"), /fence_missing/);
    fs.writeFileSync(isolatedFencePath, "{broken");
    assert.throws(() => createPersistentWorkspaceFence({ filePath: isolatedFencePath }).v3Required("workspace-a"), /fence_corrompido|Unexpected token/);
    assert.equal(profileId.startsWith("profile_"), true);
  } finally { fs.rmSync(f.dir, { recursive: true, force: true }); }
});

test("M3.3.1 — estados intermediários bloqueiam legado até o corte completo", async () => {
  const f = fixture();
  try {
    const store = new V3Store({ filePath: f.filePath });
    const profileId = activeProfile(store, "workspace-a");
    const fence = createPersistentWorkspaceFence({ store });
    const calls = [];
    const bridge = createHandlerBridge({
      fence,
      store,
      legacyHandlers: { commands: async () => calls.push("legacy") },
      v3Handlers: { commands: async () => calls.push("v3") }
    });
    fence.markPreparing("workspace-a");
    assert.equal((await bridge.dispatch({ workspaceId: "workspace-a", profileId, card: "commands", eventId: "p" })).blocked, true);
    fence.markQuiesced("workspace-a");
    assert.equal((await bridge.dispatch({ workspaceId: "workspace-a", profileId, card: "commands", eventId: "q" })).blocked, true);
    fence.markMigrated("workspace-a");
    assert.equal((await bridge.dispatch({ workspaceId: "workspace-a", profileId, card: "commands", eventId: "m" })).ok, true);
    assert.deepEqual(calls, ["v3"]);
  } finally { fs.rmSync(f.dir, { recursive: true, force: true }); }
});

test("M3.3.1 — dois processos independentes compartilham o volume sem claim duplicado", async () => {
  const f = fixture();
  const ready = [path.join(f.dir, "p1.ready"), path.join(f.dir, "p2.ready")];
  const start = path.join(f.dir, "start.signal");
  try {
    const store = new V3Store({ filePath: f.filePath });
    const profile = activeProfile(store, "workspace-processes");
    const modulePath = path.resolve(__dirname, "../modules/mensageiro-v3/src/v3/store.js");
    const script = [
      "const fs = require('node:fs');",
      "const { V3Store } = require(process.env.V3_STORE_MODULE);",
      "fs.writeFileSync(process.env.V3_READY, String(process.pid), { flag: 'wx' });",
      "while (!fs.existsSync(process.env.V3_START)) {}",
      "const claim = new V3Store({ filePath: process.env.V3_STATE }).claimExecution(process.env.V3_WORKSPACE, 'same-event', { source: String(process.pid) });",
      "process.stdout.write(JSON.stringify({ claim, pid: process.pid }));"
    ].join("\n");
    const children = ready.map((readyPath) => spawn(process.execPath, ["-e", script], {
      env: {
        ...process.env,
        V3_STORE_MODULE: modulePath,
        V3_STATE: f.filePath,
        V3_WORKSPACE: "workspace-processes",
        V3_READY: readyPath,
        V3_START: start
      },
      stdio: ["ignore", "pipe", "pipe"]
    }));
    const resultPromises = children.map((child) => new Promise((resolve, reject) => {
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.on("error", reject);
      child.on("close", (code) => code === 0
        ? resolve(JSON.parse(stdout))
        : reject(new Error(`processo filho terminou com ${code}: ${stderr}`)));
    }));
    const deadline = Date.now() + 5000;
    while (!ready.every((readyPath) => fs.existsSync(readyPath))) {
      if (Date.now() > deadline) throw new Error("processos não sinalizaram prontidão");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    fs.writeFileSync(start, "go");
    const results = await Promise.all(resultPromises);
    assert.equal(results.filter((result) => result.claim).length, 1);
    assert.equal(new V3Store({ filePath: f.filePath }).snapshot().workspaces["workspace-processes"].claims["same-event"] !== undefined, true);
    assert.equal(results.every((result) => Number.isInteger(result.pid)), true);
    assert.equal(profile.startsWith("profile_"), true);
  } finally {
    fs.rmSync(f.dir, { recursive: true, force: true });
  }
});

test("M3.3.1 — configuração, exclusão e perfil recriado não ressuscitam após recriar container", () => {
  const f = fixture();
  try {
    const first = new V3Store({ filePath: f.filePath });
    const oldProfile = activeProfile(first, "workspace-a");
    const schedule = first.createSchedule("workspace-a", oldProfile, { destinations: ["group"], content: { text: "old" }, nextRunAt: new Date(Date.now() - 1).toISOString() });
    first.activateSchedule("workspace-a", schedule.id);
    first.deleteSchedule("workspace-a", schedule.id);
    first.deleteProfile("workspace-a", oldProfile);
    const recreated = new V3Store({ filePath: f.filePath });
    assert.equal(recreated.getProfile("workspace-a", oldProfile), null);
    assert.equal(recreated.getSchedule("workspace-a", schedule.id), null);
    assert.equal(recreated.snapshot().deletedIds.profiles[oldProfile] !== undefined, true);
    assert.equal(recreated.snapshot().deletedIds.schedules[schedule.id] !== undefined, true);
    const freshProfile = activeProfile(recreated, "workspace-a");
    assert.notEqual(freshProfile, oldProfile);
  } finally { fs.rmSync(f.dir, { recursive: true, force: true }); }
});

test("M3.3.1 — rollback incompatível é bloqueado e workspace legada continua no caminho legado", async () => {
  const f = fixture();
  try {
    const store = new V3Store({ filePath: f.filePath });
    const legacyProfile = activeProfile(store, "legacy");
    const legacyFence = createWorkspaceFence();
    const calls = [];
    const bridge = createHandlerBridge({ fence: legacyFence, store, legacyHandlers: { commands: async () => calls.push("legacy") } });
    assert.equal((await bridge.dispatch({ workspaceId: "legacy", profileId: legacyProfile, card: "commands", eventId: "legacy" })).mode, "legacy");
    const persistent = createPersistentWorkspaceFence({ store });
    assert.throws(() => persistent.markLegacy("legacy"), /fence_reversao_bloqueada/);
    assert.deepEqual(calls, ["legacy"]);
  } finally { fs.rmSync(f.dir, { recursive: true, force: true }); }
});
