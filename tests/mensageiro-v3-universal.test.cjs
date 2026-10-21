const assert = require("node:assert/strict");
const test = require("node:test");
const express = require("express");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { V3Store } = require("../modules/mensageiro-v3/src/v3/store");
const createRoutes = require("../modules/mensageiro-v3/routes");
const { createPersistentWorkspaceFence } = require("../modules/mensageiro-v3/workspace-fence");
const { CARD_NAMES, createHandlerBridge } = require("../modules/mensageiro-v3/handler-bridge");

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "m34-universal-"));
  const filePath = path.join(dir, "state.json");
  fs.writeFileSync(filePath, JSON.stringify({
    schemaVersion: 3,
    revision: 0,
    workspaces: {},
    deletedIds: { profiles: {}, schedules: {} },
    workspaceFences: {}
  }));
  return { dir, filePath, store: new V3Store({ filePath }) };
}

function request(server, method, url, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const address = server.address();
    const req = http.request({
      host: "127.0.0.1",
      port: address.port,
      method,
      path: url,
      headers: payload ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } : {}
    }, res => {
      let text = "";
      res.on("data", chunk => { text += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, body: text ? JSON.parse(text) : null }));
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

test("M3.4 universal — workspaces existentes e novas começam V3 vazias", () => {
  const f = fixture();
  try {
    const first = createPersistentWorkspaceFence({ store: f.store, universal: true });
    assert.equal(first.universal, true);
    assert.equal(first.status("workspace-existente"), "V3_MIGRATED");
    assert.equal(first.status("workspace-nova"), "V3_MIGRATED");
    assert.equal(first.legacyAllowed("workspace-existente"), false);
    assert.equal(first.v3Required("workspace-nova"), true);
    assert.throws(() => first.markPreparing("workspace-nova"), /fence_universal_sem_migracao/);

    const restarted = createPersistentWorkspaceFence({ store: new V3Store({ filePath: f.filePath }), universal: true });
    assert.equal(restarted.status("workspace-nova"), "V3_MIGRATED");
    assert.deepEqual(restarted.isMigrated("workspace-nova"), true);
    assert.deepEqual(new V3Store({ filePath: f.filePath }).snapshot().workspaces, {});
  } finally {
    fs.rmSync(f.dir, { recursive: true, force: true });
  }
});

test("M3.4 universal — bridge nunca chama legado e exige perfil/card V3", async () => {
  const f = fixture();
  try {
    const profile = f.store.createProfile({ workspaceId: "workspace-nova", sessionId: "sess-a", name: "Perfil novo" });
    f.store.updateProfile("workspace-nova", profile.id, { active: true });
    f.store.saveCard("workspace-nova", profile.id, "commands", { active: true });
    const fence = createPersistentWorkspaceFence({ store: f.store, universal: true });
    const calls = [];
    const bridge = createHandlerBridge({
      fence,
      store: f.store,
      legacyHandlers: { commands: async () => calls.push("legacy") },
      v3Handlers: { commands: async () => { calls.push("v3"); return { confirmed: true }; } }
    });

    const current = await bridge.dispatch({ workspaceId: "workspace-nova", profileId: profile.id, card: "commands", eventId: "novo-1" });
    assert.equal(current.mode, "v3");
    assert.deepEqual(calls, ["v3"]);

    const noProfile = await bridge.dispatch({ workspaceId: "workspace-existente", profileId: "legado", card: "commands", eventId: "legado-1" });
    assert.deepEqual(noProfile, { ok: false, blocked: true, reason: "card_v3_inativo" });
    assert.deepEqual(calls, ["v3"]);
  } finally {
    fs.rmSync(f.dir, { recursive: true, force: true });
  }
});

test("M3.4 universal — painel inicia vazio e lista todas as conexões da própria workspace", async () => {
  const f = fixture();
  const app = express();
  app.use(express.json());
  const mounted = createRoutes({
    universal: true,
    store: f.store,
    getClienteId: () => "workspace-a",
    usuarioTemRecurso: () => true,
    listSessoes: workspaceId => workspaceId === "workspace-a"
      ? [{ id: "sess-a1" }, { id: "sess-a2" }]
      : [{ id: "sess-b1" }],
    listGrupos: (workspaceId, sessionId) => workspaceId === "workspace-a"
      ? [{ id: `${sessionId}-group`, name: sessionId }]
      : [{ id: "sess-b1-group", name: "B" }]
  });
  app.use("/mensageiro-v3", mounted.router);
  const server = app.listen(0);
  try {
    const state = await request(server, "GET", "/mensageiro-v3/state");
    assert.equal(state.status, 200);
    assert.equal(state.body.universal, true);
    assert.equal(state.body.migrated, true);
    assert.deepEqual(state.body.profiles, []);

    const destinations = await request(server, "GET", "/mensageiro-v3/destinations");
    assert.equal(destinations.status, 200);
    assert.deepEqual(destinations.body.destinations.map(item => item.sessionId).sort(), ["sess-a1", "sess-a2"]);
    assert.equal(destinations.body.destinations.some(item => item.sessionId === "sess-b1"), false);
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(f.dir, { recursive: true, force: true });
  }
});

test("M3.4 universal — todos os cards possuem autoridade V3 explícita", () => {
  assert.deepEqual(CARD_NAMES, [
    "scheduled", "commands", "attendance", "groupManager",
    "welcome", "farewell", "faq", "flows", "quickReplies"
  ]);
});

test("M3.4 universal — scheduler legado falha fechado quando desativado", async () => {
  const legacyScheduler = require("../modules/mensageiro/programacoes.scheduler");
  assert.deepEqual(await legacyScheduler.rodarProgramacoesMensageiroPendentes({ legacyDisabled: true }), {
    ok: false,
    blocked: true,
    reason: "mensageiro_legado_desativado"
  });
  assert.equal(legacyScheduler.iniciarSchedulerProgramacoesMensageiro({ legacyDisabled: true }), null);
});
