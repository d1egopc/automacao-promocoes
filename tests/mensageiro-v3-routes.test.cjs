const assert = require("node:assert/strict");
const test = require("node:test");
const express = require("express");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const V3Store = require("../modules/mensageiro-v3/src/v3/store").V3Store;
const createRoutes = require("../modules/mensageiro-v3/routes");

function request(server, method, url, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const address = server.address();
    const req = http.request({ host: "127.0.0.1", port: address.port, method, path: url, headers: payload ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } : {} }, res => {
      let text = "";
      res.on("data", chunk => { text += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, body: text ? JSON.parse(text) : null }));
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

test("M3.2.1 — rotas V3 usam workspace autenticada e persistem leitura/escrita", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "m321-routes-"));
  const filePath = path.join(dir, "state.json");
  fs.writeFileSync(filePath, JSON.stringify({ schemaVersion: 3, revision: 0, workspaces: {}, deletedIds: { profiles: {}, schedules: {} } }));
  const store = new V3Store({ filePath });
  const app = express();
  app.use(express.json());
  const mounted = createRoutes({ getClienteId: () => "workspace-a", usuarioTemRecurso: () => true, store });
  app.use("/mensageiro-v3", mounted.router);
  const server = app.listen(0);
  try {
    const created = await request(server, "POST", "/mensageiro-v3/profiles", { workspaceId: "workspace-forjado", sessionId: "session-a", name: "Perfil A" });
    assert.equal(created.status, 201);
    assert.equal(created.body.profile.workspaceId, "workspace-a");
    const profileId = created.body.profile.id;
    const state = await request(server, "GET", "/mensageiro-v3/state");
    assert.equal(state.status, 200);
    assert.equal(state.body.profiles[0].id, profileId);
    const card = await request(server, "PATCH", `/mensageiro-v3/profiles/${profileId}/cards/commands`, {
      active: true,
      commands: [{ id: "cmd-v3", gatilhos: ["oi"], resposta: { tipo: "texto", texto: "olá" } }],
      expectedRevision: 1
    });
    assert.equal(card.status, 200);
    assert.equal(card.body.card.commands[0].id, "cmd-v3");
    const confirmedCard = await request(server, "GET", "/mensageiro-v3/state");
    assert.equal(confirmedCard.body.profiles[0].cards.commands.commands[0].id, "cmd-v3");
    const schedule = await request(server, "POST", `/mensageiro-v3/profiles/${profileId}/schedules`, { destinations: ["group-a"], nextRunAt: new Date(Date.now() - 1).toISOString(), content: { text: "hello" } });
    assert.equal(schedule.status, 422);
    const profile = store.getProfile("workspace-a", profileId);
    store.saveCard("workspace-a", profileId, "scheduled", { active: true });
    const createdSchedule = await request(server, "POST", `/mensageiro-v3/profiles/${profileId}/schedules`, { profileId: "other", destinations: ["group-a"], nextRunAt: new Date(Date.now() - 1).toISOString(), content: { text: "hello" } });
    assert.equal(createdSchedule.status, 201);
    assert.equal(createdSchedule.body.schedule.profileId, profile.id);
    const deleted = await request(server, "DELETE", `/mensageiro-v3/profiles/${profileId}`);
    assert.equal(deleted.status, 200);
    const after = await request(server, "GET", "/mensageiro-v3/state");
    assert.deepEqual(after.body.profiles, []);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
