"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  path = require("node:path"),
  crypto = require("node:crypto");
const express = require("express");
const root = path.join(__dirname, "..");
let stored = [],
  writes = 0,
  reads = 0;
const dbCalls = [];
const result = (rows) => ({ ok: true, resultado: { rows } });
const query = async (sql, params) => {
  dbCalls.push({ sql, params });
  return result([]);
};
require.cache[require.resolve("../utils/storage")] = {
  id: "storage",
  filename: path.join(root, "utils/storage.js"),
  loaded: true,
  exports: {
    readGlobalJson: () => {
      reads++;
      return structuredClone(stored);
    },
    writeGlobalJson: (_, value) => {
      writes++;
      stored = structuredClone(value);
    },
  },
};
require.cache[require.resolve("../modules/engine/database")] = {
  id: "db",
  filename: path.join(root, "modules/engine/database.js"),
  loaded: true,
  exports: { queryEngine: query, queryEngineShadow: query },
};
require.cache[
  require.resolve("../modules/engine/ofc/absorption-gate.service")
] = {
  loaded: true,
  exports: { criarGateAbsorcaoShadowOfc: async () => ({ workspaces: [] }) },
};
const service = require("../modules/telemetria/telemetria.service");
const {
  createAuditRequests,
  digest,
} = require("../modules/telemetria/auditoria-request");
const {
  createOperationalView,
  project,
} = require("../modules/telemetria/operational-view");
const {
  criarRotasTelemetria,
} = require("../modules/telemetria/telemetria.routes");
const {
  createRadarIngressObservation,
} = require("../modules/radar/ingress-observation-v1");
const { run: runClient } = require("../modules/telemetria/codex-client.cjs");
const auth = (req, res, next) => {
  if (req.headers.authorization === "Bearer fixture-master")
    req.usuario = { id: "admin", papel: "admin_master" };
  else if (req.headers.authorization === "Bearer fixture-user")
    req.usuario = { id: "user_a", papel: "cliente" };
  else return res.status(401).json({ ok: false, erro: "nao_autorizado" });
  next();
};
const grant = (scope) =>
  service.criarAuditoriaTemporaria({
    escopo: scope || "workspace",
    clienteId: "user_a",
    criadoPor: "admin",
  });
const req = (token) => ({
  method: "GET",
  path: "/operacional",
  headers: { authorization: `Bearer ${token}` },
});
async function fixture(options = {}) {
  const app = express();
  app.use(express.json());
  app.use(
    "/telemetria",
    criarRotasTelemetria({ authNormal: auth, query, ...options }),
  );
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  async function call(endpoint, token, body) {
    const response = await fetch(`${base}/telemetria${endpoint}`, {
      method: body ? "POST" : "GET",
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return {
      status: response.status,
      headers: response.headers,
      body: await response.json(),
    };
  }
  return { base, call, close: () => new Promise((r) => server.close(r)) };
}

test("tel_ defaults to 15 minutes, hashes only, zero writes on GET, immediate revoke/expiry", () => {
  const g = grant();
  assert.equal(g.ok, true);
  assert.equal(new Date(g.expiraEm) - new Date(g.criadoEm), 900000);
  assert.ok(!JSON.stringify(stored).includes(g.codigo));
  const baselineWrites = writes;
  for (let i = 0; i < 1000; i++)
    assert.equal(service.autenticarTokenAuditoria(req(g.codigo)).ok, true);
  assert.equal(writes, baselineWrites);
  assert.ok(reads >= 1000);
  assert.equal(
    service
      .listarAuditoriasSanitizadas()
      .find((a) => a.auditoriaId === g.auditoriaId).consultas,
    1000,
  );
  service.revogarAuditoriaTemporaria({ auditoriaId: g.auditoriaId });
  assert.equal(
    service.autenticarTokenAuditoria(req(g.codigo)).motivo,
    "token_revogado",
  );
  const e = grant();
  stored.find((a) => a.auditoriaId === e.auditoriaId).expiraEm = new Date(
    0,
  ).toISOString();
  assert.equal(
    service.autenticarTokenAuditoria(req(e.codigo)).motivo,
    "token_expirado",
  );
  assert.equal(
    service.extrairTokenAuditoria({ query: { auditoriaToken: e.codigo } }),
    "",
  );
  assert.equal(service.criarAuditoriaTemporaria({ escopo: "typo" }).ok, false);
});

test("authorization delivery is challenge-bound, one-use, expires and restarts empty", () => {
  let now = 1000000;
  const requests = createAuditRequests({
    now: () => now,
    createGrant: service.criarAuditoriaTemporaria,
    grantActive: () => true,
    maxPending: 2,
  });
  const verifier = crypto.randomBytes(32).toString("base64url"),
    pending = requests.request(digest(verifier));
  assert.equal(requests.collect(pending.requestId, "wrong").ok, false);
  assert.equal(requests.collect(pending.requestId, verifier).state, "pending");
  const approved = requests.approve(pending.requestId, {
    escopo: "workspace",
    clienteId: "user_a",
  });
  assert.equal(approved.ok, true);
  assert.ok(!JSON.stringify(approved).includes("tel_"));
  assert.equal(
    requests.collect(pending.requestId, verifier).error,
    "poll_too_frequent",
  );
  now += 5001;
  assert.equal(
    requests.collect(pending.requestId, verifier).state,
    "authorized",
  );
  assert.equal(requests.collect(pending.requestId, verifier).ok, false);
  const p = requests.request(digest(verifier));
  now += 300001;
  assert.equal(requests.approve(p.requestId, {}).ok, false);
  assert.equal(
    createAuditRequests({
      createGrant: grant,
      grantActive: () => true,
    }).collect(p.requestId, verifier).ok,
    false,
  );
});

test("real HTTP: only Admin Master approves; delegated token cannot write or authorize", async () => {
  const f = await fixture();
  try {
    const verifier = crypto.randomBytes(32).toString("base64url");
    const p = await f.call("/auditoria/solicitar", null, {
      challenge: digest(verifier),
    });
    assert.equal(p.status, 201);
    const body = {
      requestId: p.body.requestId,
      escopo: "workspace",
      clienteId: "user_a",
      ttlMinutos: 15,
    };
    assert.equal(
      (await f.call("/auditoria/autorizar", null, body)).status,
      401,
    );
    assert.equal(
      (await f.call("/auditoria/autorizar", "fixture-user", body)).status,
      403,
    );
    const a = await f.call("/auditoria/autorizar", "fixture-master", body);
    assert.equal(a.status, 201);
    assert.ok(!JSON.stringify(a.body).includes("tel_"));
    const c = await f.call("/auditoria/coletor", null, {
      requestId: p.body.requestId,
      verifier,
    });
    assert.equal(c.body.state, "authorized");
    assert.equal(c.headers.get("cache-control"), "no-store");
    const token = c.body.codigo;
    assert.equal(
      (await f.call("/operacional?clienteId=user_b", token)).body.workspace,
      "user_a",
    );
    assert.equal((await f.call("/auditorias", token)).status, 403);
    for (const endpoint of [
      "/auditoria/ativar",
      "/auditoria/autorizar",
      "/auditoria/revogar",
      "/sonda-radar/iniciar",
      "/sonda-radar/encerrar",
    ])
      assert.equal((await f.call(endpoint, token, body)).status, 403);
    await f.call("/auditoria/revogar", "fixture-master", {
      auditoriaId: a.body.auditoriaId,
    });
    assert.equal((await f.call("/operacional", token)).status, 401);
    assert.equal(
      (await f.call("/operacional?auditoriaToken=fixture", token)).status,
      400,
    );
  } finally {
    await f.close();
  }
});

test("workspace scope is applied inside every trace SQL and shared workers do not leak", async () => {
  const calls = [];
  const q = async (sql, params) => {
    calls.push({ sql, params });
    return result([]);
  };
  const v = createOperationalView({
    query: q,
    getRuntime: () => [
      {
        workspaceId: "user_a",
        sessionId: "private_5511111111111",
        status: "open",
        socketPresent: true,
      },
      { workspaceId: "user_b", sessionId: "other" },
    ],
  });
  const snapshot = await v.snapshot(
    { clienteId: "user_b" },
    { tipo: "workspace", clienteId: "user_a" },
  );
  assert.equal(snapshot.workspace, "user_a");
  assert.equal(snapshot.runtime.length, 1);
  assert.ok(!JSON.stringify(snapshot).includes("5511111111111"));
  assert.equal(snapshot.magaluWorker.state, "INDISPONIVEL");
  assert.equal(snapshot.probe.reason, "outside_authorized_workspace");
  calls.length = 0;
  await v.trace("evento", "1", {}, { tipo: "workspace", clienteId: "user_a" });
  assert.equal(calls.length, 6);
  for (const c of calls) {
    assert.equal(c.params[1], "user_a");
    assert.match(c.sql, /\$2/);
  }
  assert.ok(
    calls.every((c) => !/INSERT|UPDATE |DELETE|CREATE |FOR UPDATE/.test(c.sql)),
  );
});

test("all missing stages remain unknown/not-observed; closed projection excludes private data", async () => {
  let calls = 0;
  const v = createOperationalView({
    query: async () => {
      calls++;
      return result([]);
    },
  });
  assert.equal(calls, 0);
  const snapshot = await v.snapshot({}, { tipo: "plataforma" });
  assert.equal(calls, 3);
  assert.ok(
    snapshot.motors.every(
      (m) => m.state === "NAO_OBSERVADO" && m.callback === "DESCONHECIDO",
    ),
  );
  const projected = project({
    origem: {
      grupoId: "5511111111111@g.us",
      grupoNome: "private",
      origem: "radar",
    },
    metadata: { token: "secret" },
    items: [{ eventoId: "12", motivo: "tel_sensitive", texto: "private" }],
    links: [
      {
        dominioOriginal: "magazineluiza.onelink.me",
        original: { urlSanitizada: "private" },
        redirectOk: false,
      },
    ],
  });
  const text = JSON.stringify(projected);
  for (const bad of [
    "5511111111111",
    "grupoNome",
    "token",
    "tel_sensitive",
    "urlSanitizada",
    "private",
  ])
    assert.ok(!text.includes(bad));
  assert.ok(text.includes("magazineluiza.onelink.me"));
});

test("existing probe adapter is read-only on GET, maps socket correctly and expires without actions", async () => {
  let now = 1000000,
    starts = 0,
    stops = 0;
  const socket = {
    ev: {
      on() {
        throw Error("no new listener");
      },
    },
  };
  socket.__optimusListeners = {
    "messages.upsert": {
      emissor: socket.ev,
      evento: "messages.upsert",
      handler: () => {},
    },
  };
  const probe = createRadarIngressObservation({
    now: () => now,
    setTimer: () => ({ unref() {} }),
    clearTimer() {},
  });
  const f = await fixture({
    getProbeStatus: probe.status,
    validateProbeTarget: () => ({
      ok: true,
      workspaceId: "admin",
      sessionId: "admin_ZOIAO",
      groupId: "private@g.us",
      socket,
      generation: 1,
    }),
    startProbe: (t) => {
      starts++;
      return probe.start(t);
    },
    stopProbe: () => {
      stops++;
      return probe.stop("manual");
    },
  });
  try {
    const p = await f.call("/sonda-radar", "fixture-master");
    assert.equal(starts, 0);
    assert.equal(p.body.preflight.physicalAttachment, "DESCONHECIDO");
    assert.equal(
      (await f.call("/sonda-radar/iniciar", "fixture-master", {})).body.state,
      "active",
    );
    assert.equal(starts, 1);
    probe.observeUpsert({
      workspaceId: "admin",
      sessionId: "admin_ZOIAO",
      sock: socket,
      emitter: socket.ev,
      current: true,
      generation: 1,
      messages: [{ key: { id: "test", remoteJid: "other@g.us" } }],
      type: "notify",
    });
    assert.equal(probe.status().events, 0);
    assert.equal(probe.status().counters.nonTargetGroups, 1);
    now += 300001;
    assert.equal(
      (await f.call("/sonda-radar", "fixture-master")).body.report.state,
      "expired",
    );
    assert.equal(stops, 0);
    assert.equal(
      probe.isActiveFor({
        workspaceId: "admin",
        sessionId: "admin_ZOIAO",
        groupId: "private@g.us",
        sock: socket,
      }),
      false,
    );
  } finally {
    await f.close();
  }
});

test("delegated read rate is bounded and concurrency does not multiply queries", async () => {
  const f = await fixture();
  const g = grant();
  try {
    let last;
    for (let i = 0; i < 31; i++) last = await f.call("/sonda-radar", g.codigo);
    assert.equal(last.status, 429);
    assert.equal(last.headers.get("retry-after"), "5");
  } finally {
    await f.close();
  }
});

test("official collector uses HTTPS by default and fixture E2E never outputs any credential", async () => {
  const f = await fixture(),
    output = [];
  let requestId = "";
  try {
    await assert.rejects(
      runClient({ base: "https://other.invalid", output: () => {} }),
      /unapproved_origin/,
    );
    await runClient({
      base: f.base,
      fixture: true,
      path: "/operacional",
      output: (text) => {
        output.push(text);
        if (text.startsWith("REQUEST_ID=")) requestId = text.slice(11);
      },
      wait: async () => {
        const result = await f.call("/auditoria/autorizar", "fixture-master", {
          requestId,
          escopo: "workspace",
          clienteId: "user_a",
          ttlMinutos: 15,
        });
        assert.equal(result.status, 201);
      },
    });
    const text = output.join("\n");
    assert.ok(text.includes("AUTHORIZED=YES"));
    assert.ok(text.includes('"workspace":"user_a"'));
    assert.ok(!text.includes("tel_"));
    assert.ok(!text.includes("fixture-master"));
  } finally {
    await f.close();
  }
});

test("two inflight delegated reads are the ceiling; the third triggers no SQL", async () => {
  let n = 0,
    ready;
  const started = new Promise((r) => {
    ready = r;
  });
  const release = [];
  const f = await fixture({
    query: () =>
      new Promise((resolve) => {
        n++;
        release.push(() => resolve(result([])));
        if (n === 6) ready();
      }),
  });
  const g = grant("plataforma");
  let a, b;
  try {
    a = f.call("/operacional", g.codigo);
    b = f.call("/operacional", g.codigo);
    await Promise.race([
      started,
      new Promise((_, reject) =>
        setTimeout(() => reject(Error("fixture_wait_timeout")), 2000),
      ),
    ]);
    assert.equal((await f.call("/operacional", g.codigo)).status, 429);
    assert.equal(n, 6);
    for (const fn of release) fn();
    assert.equal((await a).status, 200);
    assert.equal((await b).status, 200);
  } finally {
    for (const fn of release) fn();
    await f.close();
  }
});
