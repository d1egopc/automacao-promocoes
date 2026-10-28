"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const express = require("express");
const createV3Routes = require("../modules/mensageiro-v3/routes");
const { V3Store } = require("../modules/mensageiro-v3/src/v3/store");
const { createV4Routes } = require("../modules/mensageiro-v4/routes");
const { V4Engine } = require("../modules/mensageiro-v4/engine");

// Real HTTP routers and durable V3 store; only identity/transport boundaries
// are fixtures. No browser, experimental panel, WhatsApp socket or production API.
async function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "messenger-readiness-"));
  const filePath = path.join(dir, "state.json");
  const store = new V3Store({ filePath });
  let repositoryCalls = 0;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.clienteId = req.headers["x-fixture-workspace"];
    if (req.clienteId) req.usuario = { id: req.clienteId };
    next();
  });
  const hasFeature = req => req.headers["x-fixture-plan"] === "yes";
  const listSessions = w => [{ id: w + "_fixture", connected: true }];
  app.use("/mensageiro-v3", createV3Routes({ store, universal: true,
    getClienteId: req => req.clienteId, usuarioTemRecurso: hasFeature,
    listSessoes: listSessions }).router);
  app.use("/mensageiro-v4", createV4Routes({
    engine: new V4Engine(),
    repository: { call() { repositoryCalls++; throw new Error("OFF must not reach worker"); } },
    diagnostics: { status: () => ({ state: "off" }) },
    getWorkspace: req => req.clienteId, hasFeature, listSessions, listGroups: () => [],
  }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { filePath, store, repositoryCalls: () => repositoryCalls,
    request: (w, url, method = "GET", body) => fetch(
      "http://127.0.0.1:" + server.address().port + url,
      { method, headers: { "x-fixture-workspace": w, "x-fixture-plan": "yes",
        "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }) };
}

test("operational V3 persists via HTTP without a ServCel panel or V4 activation", async t => {
  const f = await fixture(t);
  const response = await f.request("fixture-owner", "/mensageiro-v3/profiles", "POST", {
    name: "Isolated Vivo fixture", sessionId: "fixture-owner_fixture", workspaceId: "foreign" });
  assert.equal(response.status, 201);
  const { profile } = await response.json();
  assert.equal(profile.workspaceId, "fixture-owner");
  const card = await f.request("fixture-owner", `/mensageiro-v3/profiles/${profile.id}/cards/commands`, "PATCH", {
    active: true, commands: [{ id: "hello", gatilhos: ["hello"], resposta: { tipo: "texto", texto: "Fixture" } }],
    expectedRevision: profile.revision });
  assert.equal(card.status, 200);
  const restarted = new V3Store({ filePath: f.filePath });
  assert.equal(restarted.getProfile("fixture-owner", profile.id).cards.commands.commands[0].id, "hello");
  assert.equal((await f.request("foreign", `/mensageiro-v3/profiles/${profile.id}`)).status, 404);
  const own = await (await f.request("fixture-owner", "/mensageiro-v3/state")).json();
  assert.equal(own.profiles.length, 1);
  assert.equal(f.repositoryCalls(), 0);
});

test("V4 OFF rejects its editor API before workers and cannot be enabled by the customer UI", async t => {
  const f = await fixture(t);
  for (const [method, url, body] of [
    ["GET", "/state"], ["GET", "/groups?sessionId=fixture-owner_fixture"],
    ["POST", "/profiles", { name: "Must not persist", sessionId: "fixture-owner_fixture" }],
  ]) {
    const response = await f.request("fixture-owner", "/mensageiro-v4" + url, method, body);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, "v4_off");
  }
  assert.equal((await f.request("fixture-owner", "/mensageiro-v4/canary/start", "POST", {})).status, 403);
  assert.equal(f.repositoryCalls(), 0);
  assert.deepEqual(f.store.snapshot().workspaces, {});
});
