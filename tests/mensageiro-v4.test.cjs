"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os");
const suiteData = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-v4-suite-"));
process.env.DATA_DIR = suiteData;
fs.writeFileSync(
  path.join(suiteData, "usuarios.json"),
  JSON.stringify([
    { id: "fixture_A", ativo: true },
    { id: "fixture_B", ativo: true },
  ]),
);
test.after(() => fs.rmSync(suiteData, { recursive: true, force: true }));
const express = require("express");
const { monitorEventLoopDelay } = require("node:perf_hooks");
const { V3Store } = require("../modules/mensageiro-v3/src/v3/store");
const { V4Repository } = require("../modules/mensageiro-v4/repository");
const { V4Engine } = require("../modules/mensageiro-v4/engine");
const { Diagnostics } = require("../modules/mensageiro-v4/diagnostics");
const { Moderator } = require("../modules/mensageiro-v4/moderation");
const { reply } = require("../modules/mensageiro-v4/intelligence");
const {
  normalizeModeration,
  normalizeIntelligence,
  publicUrl,
  validateImages,
} = require("../modules/mensageiro-v4/model");
const { createV4Routes } = require("../modules/mensageiro-v4/routes");
const { createPublicResources } = require("../modules/mensageiro-v4/resources");
const W = "fixture_A",
  B = "fixture_B",
  S = "fixture_A_phone",
  SB = "fixture_B_phone",
  G = "a@g.us",
  GB = "b@g.us";
function fixture(t, migrated = true) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-v4-")),
    file = path.join(root, "mensageiro-v3", "state.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const store = new V3Store({ filePath: file });
  const p = store.createProfile({
    workspaceId: W,
    sessionId: S,
    name: "Equipe A",
  });
  store.updateProfile(W, p.id, { active: true, destinations: [G] });
  store.saveCard(W, p.id, "groupManager", {
    active: true,
    configuration: {
      ...(migrated ? { v4: { migrationVersion: 4 } } : {}),
      isentarAdmins: true,
      isentarDono: true,
      regras: [
        {
          id: "links",
          ativo: true,
          tipo: "links_externos",
          parametros: { dominiosPermitidos: [] },
          acao: "apagar_avisar",
        },
      ],
    },
  });
  for (const card of ["attendance", "commands", "welcome", "farewell"])
    store.saveCard(W, p.id, card, {
      active: true,
      configuration: {
        mensagem: "Olá",
        imagem: "",
        envio: { destino: "grupo" },
      },
    });
  const b = store.createProfile({
    workspaceId: B,
    sessionId: SB,
    name: "Equipe B",
  });
  store.updateProfile(B, b.id, { active: true, destinations: [GB] });
  const repository = new V4Repository({ filePath: file });
  t.after(async () => {
    await repository.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, file, store, p: store.getProfile(W, p.id), b, repository };
}
function socket({
  admin = true,
  senderAdmin = false,
  failSend = false,
  metadata = true,
} = {}) {
  const sent = [];
  return {
    sent,
    user: { id: "bot@s.whatsapp.net" },
    groupMetadata: async () => {
      if (!metadata) throw new Error("unavailable");
      return {
        participants: [
          { id: "bot@s.whatsapp.net", admin: admin ? "admin" : null },
          {
            id: "sender@lid",
            phoneNumber: "sender@s.whatsapp.net",
            admin: senderAdmin ? "admin" : null,
          },
        ],
      };
    },
    sendMessage: async (to, content) => {
      sent.push({ to, content });
      if (failSend) throw new Error("uncertain");
      return { key: { id: "transport-fixture" } };
    },
  };
}
const message = (id = "one", text = "https://vt.tiktok.com/ZSgHTok6D/") => ({
  key: { id, remoteJid: G, participant: "sender@lid", fromMe: false },
  message: { conversation: text },
});
function engine(f, sock, extra = {}) {
  return new V4Engine({
    repository: f.repository,
    enabled: (w) => w === W,
    contextValid: (w, s, sk) => w === W && s === S && sk === sock,
    ...extra,
  });
}
const dispatch = (e, sock, m = message(), card = "groupManager") =>
  e.dispatch({
    workspaceId: W,
    sessionId: S,
    card,
    message: m,
    sock,
    planAllowed: true,
  });

test("V4 defaults are passive, validate links and never trust arbitrary image payloads", () => {
  assert.equal(normalizeIntelligence().enabled, false);
  assert.equal(normalizeModeration().rules.length, 0);
  for (const url of [
    "javascript:alert(1)",
    "http://example.com",
    "https://127.0.0.1",
    "https://172.16.0.1",
    "https://user:secret@example.com",
  ])
    assert.throws(() => publicUrl(url));
  assert.throws(() =>
    normalizeModeration({
      rules: [{ id: "a", category: "politica", action: "remove_member" }],
    }),
  );
  assert.throws(() =>
    validateImages({ imagem: "data:image/png;base64,PHNjcmlwdD4=" }),
  );
  assert.throws(() => validateImages({ imagem: "file:///private" }));
});
test("private intentions use authorized resources, no group loop or invented links", () => {
  const c = { enabled: true };
  assert.equal(reply({ text: "oi", configuration: c, group: true }), null);
  assert.equal(reply({ text: "Vitrine", configuration: c }), null);
  assert.match(
    reply({
      text: "Vitrine",
      configuration: c,
      resources: { storefront: "https://example.com/v/a" },
    }).text,
    /example.com\/v\/a/,
  );
  assert.match(
    reply({
      text: "oi",
      configuration: c,
      now: Date.parse("2026-10-25T10:00:00Z"),
    }).text,
    /Bom dia/,
  );
  assert.equal(reply({ text: "desconhecido", configuration: c }), null);
  assert.equal(
    reply({ text: "contato", configuration: { enabled: false } }),
    null,
  );
});
test("versioned migration preserves cards, images, schedules and other workspace, is idempotent", async (t) => {
  const f = fixture(t, false),
    before = JSON.parse(fs.readFileSync(f.file));
  const migrated = await f.repository.call("migrate", {
    workspaceId: W,
    profileId: f.p.id,
    expectedRevision: f.p.revision,
  });
  assert.equal(migrated.profile.migrationVersion, 4);
  const next = JSON.parse(fs.readFileSync(f.file));
  assert.deepEqual(next.workspaces[B], before.workspaces[B]);
  assert.deepEqual(
    next.workspaces[W].schedules,
    before.workspaces[W].schedules,
  );
  const original = before.workspaces[W].profiles[f.p.id],
    current = next.workspaces[W].profiles[f.p.id];
  for (const card of Object.keys(original.cards)) {
    assert.equal(current.cards[card].active, original.cards[card].active);
    for (const [k, v] of Object.entries(
      original.cards[card].configuration || {},
    ))
      assert.deepEqual(current.cards[card].configuration[k], v);
  }
  const bytes = fs.readFileSync(f.file);
  assert.equal(
    (
      await f.repository.call("migrate", {
        workspaceId: W,
        profileId: f.p.id,
        expectedRevision: 0,
      })
    ).alreadyMigrated,
    true,
  );
  // V3 transaction persists the same JSON, without another migration/audit.
  assert.deepEqual(JSON.parse(fs.readFileSync(f.file)), JSON.parse(bytes));
});
test("foreign profile cannot be read or modified; stale revision rolls back the entire transaction", async (t) => {
  const f = fixture(t);
  await assert.rejects(
    f.repository.call("profile", { workspaceId: B, profileId: f.p.id }),
  );
  const bytes = fs.readFileSync(f.file);
  await assert.rejects(
    f.repository.call("save", {
      workspaceId: W,
      profileId: f.p.id,
      input: {
        name: "lost",
        sessionId: S,
        destinations: [G],
        active: true,
        expectedRevision: 0,
      },
    }),
  );
  assert.deepEqual(fs.readFileSync(f.file), bytes);
});
test("copy is inactive and carries no claims, occurrences or duplicate schedules", async (t) => {
  const f = fixture(t);
  const duplicate = await f.repository.call("duplicate", {
    workspaceId: W,
    profileId: f.p.id,
  });
  assert.notEqual(duplicate.id, f.p.id);
  assert.equal(duplicate.active, false);
  assert.ok(Object.values(duplicate.cards).every((c) => !c.active));
  assert.equal(
    (await f.repository.call("state", { workspaceId: W })).schedules.length,
    0,
  );
});
test("conflicting active profiles cannot activate the same moderation scope", async (t) => {
  const f = fixture(t);
  const p = await f.repository.call("duplicate", {
    workspaceId: W,
    profileId: f.p.id,
  });
  await f.repository.call("card", {
    workspaceId: W,
    profileId: p.id,
    card: "groupManager",
    expectedRevision: p.revision,
    active: true,
    configuration: {},
  });
  const current = await f.repository.call("profile", {
    workspaceId: W,
    profileId: p.id,
  });
  await assert.rejects(
    f.repository.call("save", {
      workspaceId: W,
      profileId: p.id,
      input: {
        name: p.name,
        sessionId: S,
        destinations: [G],
        active: true,
        expectedRevision: current.revision,
      },
    }),
    /perfis_conflitantes/,
  );
});
test("links are moderated once, preserve warning, never claim confirmed deletion", async (t) => {
  const f = fixture(t),
    sock = socket(),
    e = engine(f, sock);
  const result = await dispatch(e, sock);
  assert.equal(result.transportAccepted, true);
  assert.equal(result.deletionConfirmed, false);
  assert.equal(sock.sent.length, 2);
  assert.deepEqual(sock.sent[0].content.delete, message().key);
  await dispatch(e, sock);
  assert.equal(sock.sent.length, 2);
});
test("administrator exemption, missing metadata and bot permission fail closed", async (t) => {
  const f = fixture(t);
  for (const options of [
    { senderAdmin: true },
    { metadata: false },
    { admin: false },
  ]) {
    const sock = socket(options),
      e = engine(f, sock);
    const result = await dispatch(e, sock, message(JSON.stringify(options)));
    assert.equal(result.blocked, true);
    assert.equal(sock.sent.length, 0);
  }
});
test("own messages, stale sockets, blocked plan and OFF runtime never send", async (t) => {
  const f = fixture(t),
    sock = socket(),
    e = engine(f, sock);
  assert.equal(
    (
      await dispatch(e, sock, {
        ...message(),
        key: { ...message().key, fromMe: true },
      })
    ).blocked,
    true,
  );
  await dispatch(e, socket());
  await e.dispatch({
    workspaceId: W,
    sessionId: S,
    card: "groupManager",
    message: message(),
    sock,
    planAllowed: false,
  });
  e.enabled = () => false;
  await dispatch(e, sock);
  assert.equal(sock.sent.length, 0);
});
test("transport failure is durable ambiguous and not retried after restart", async (t) => {
  const f = fixture(t),
    sock = socket({ failSend: true });
  await dispatch(engine(f, sock), sock);
  assert.equal(sock.sent.length, 1);
  await dispatch(engine(f, sock), sock);
  assert.equal(sock.sent.length, 1);
  const state = JSON.parse(fs.readFileSync(f.file));
  assert.equal(
    Object.values(state.workspaces[W].claims)[0].status,
    "ambiguous",
  );
});
test("business words do not bypass forbidden terms; domain alone does not infer politics", (t) => {
  const f = fixture(t),
    p = structuredClone(f.p);
  p.cards.groupManager.configuration.regras = [];
  p.cards.groupManager.configuration.v4 = {
    professionalTopics: ["refrigeração"],
    rules: [
      {
        id: "policy",
        category: "politica",
        enabled: true,
        action: "observe",
        terms: ["termo eleitoral"],
      },
    ],
  };
  const moderator = new Moderator();
  assert.equal(
    moderator.evaluate(p, message("a", "refrigeração termo eleitoral")).id,
    "policy",
  );
  assert.equal(
    moderator.evaluate(p, message("b", "https://vt.tiktok.com/example")),
    null,
  );
});
test("commands, attendance and participant handlers are delegated once with correct profile", async (t) => {
  const f = fixture(t),
    sock = socket(),
    called = [];
  const handlers = Object.fromEntries(
    ["commands", "attendance", "welcome", "farewell"].map((card) => [
      card,
      async (args) => {
        called.push({ card, args });
        return { processada: true };
      },
    ]),
  );
  const e = engine(f, sock, { handlers });
  await dispatch(e, sock, message("command", "!pix"), "commands");
  await dispatch(
    e,
    sock,
    {
      key: { id: "pv", remoteJid: "peer@lid" },
      message: { conversation: "oi" },
    },
    "attendance",
  );
  for (const card of ["welcome", "farewell"])
    await e.dispatch({
      workspaceId: W,
      sessionId: S,
      card,
      event: {
        id: G,
        action: card === "welcome" ? "add" : "remove",
        participants: ["peer@lid"],
        timestamp: 1234,
      },
      sock,
      planAllowed: true,
    });
  assert.deepEqual(
    called.map((c) => c.card),
    ["commands", "attendance", "welcome", "farewell"],
  );
  assert.ok(
    called.every(
      (c) => c.args.profileId === f.p.id && c.args.workspaceId === W,
    ),
  );
});
test("schedule uses existing future-time conversion and deletion is definitive", async (t) => {
  const f = fixture(t);
  const input = {
    nome: "Noite",
    ativo: true,
    tipo: "horario",
    horario: "19:30",
    timezone: "America/Sao_Paulo",
    grupos: [G],
    conteudos: [{ tipo: "texto", texto: "Boa noite" }],
  };
  const s = await f.repository.call("schedule", {
    workspaceId: W,
    profileId: f.p.id,
    input,
  });
  assert.ok(Date.parse(s.nextRunAt) > Date.now());
  assert.match(s.nextRunAt, /T22:30:00\.000Z$/);
  await f.repository.call("schedule", {
    workspaceId: W,
    profileId: f.p.id,
    scheduleId: s.id,
    expectedRevision: s.revision,
    remove: true,
  });
  assert.equal(
    (
      await f.repository.call("schedules", {
        workspaceId: W,
        profileId: f.p.id,
      })
    ).length,
    0,
  );
  assert.equal(
    JSON.parse(fs.readFileSync(f.file)).deletedIds.schedules[s.id].workspaceId,
    W,
  );
});
test("diagnostic observes captured-workspace mismatch without capturing the other tenant", () => {
  let now = 0;
  const d = new Diagnostics({
    ownsSession: (w, s) => w === W && s === S,
    clock: () => now,
    secret: Buffer.alloc(32, 1),
  });
  assert.equal(d.status(W).state, "off");
  d.start({
    workspaceId: W,
    sessionId: S,
    groupId: G,
    durationMs: 1000,
    maxEvents: 1,
  });
  d.observe({
    sessionId: SB,
    capturedWorkspaceId: B,
    current: true,
    messages: [message()],
    generation: 1,
    type: "notify",
  });
  assert.equal(d.status(W).events, 0);
  d.observe({
    sessionId: S,
    capturedWorkspaceId: B,
    current: true,
    messages: [message()],
    generation: 2,
    type: "notify",
  });
  const s = d.status(W);
  assert.equal(s.events, 1);
  assert.ok(s.records.some((r) => r.code === "workspace_mismatch"));
  const raw = JSON.stringify(s);
  for (const secret of [B, S, G, "sender@lid", "tiktok"])
    assert.ok(!raw.includes(secret));
  assert.equal(d.status(B).records.length, 0);
  now = 1001;
  assert.equal(d.status(W).state, "finished");
  now += 300001;
  assert.equal(d.status(W).state, "off");
});
test("diagnostic OFF has no clock, IO or ownership lookup; capacity stays bounded", () => {
  const d = new Diagnostics({
    ownsSession: () => {
      throw Error("off_lookup");
    },
    clock: () => {
      throw Error("off_clock");
    },
  });
  assert.doesNotThrow(() => d.observe({ messages: [message()] }));
  const on = new Diagnostics({ ownsSession: () => true });
  on.start({ workspaceId: W, sessionId: S, groupId: G });
  for (let i = 0; i < 100; i++)
    on.observe({
      sessionId: S,
      capturedWorkspaceId: W,
      current: true,
      messages: [message(String(i))],
    });
  const s = on.stop(W);
  assert.equal(s.events, 10);
  assert.ok(s.records.length <= 120);
});
test("worker backpressure rejects extra work without blocking the loop", async (t) => {
  const f = fixture(t),
    r = new V4Repository({ filePath: f.file, maxPending: 1 });
  t.after(() => r.close());
  const first = r.call("state", { workspaceId: W });
  await assert.rejects(r.call("state", { workspaceId: W }), /backpressure/);
  await first;
});
test("private API enforces auth, plan, connected session and workspace ownership", async (t) => {
  const f = fixture(t),
    sock = socket(),
    e = engine(f, sock),
    d = new Diagnostics({ ownsSession: (w, s) => w === W && s === S });
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    const w = req.headers["x-fixture-workspace"];
    if (w) {
      req.usuario = { id: w };
      req.clienteId = w;
    }
    next();
  });
  app.use(
    "/mensageiro-v4",
    createV4Routes({
      repository: f.repository,
      engine: e,
      diagnostics: d,
      getWorkspace: (req) => req.clienteId,
      hasFeature: (req) => req.headers["x-fixture-plan"] === "yes",
      listSessions: (w) =>
        w === W ? [{ id: S, connected: true }] : [{ id: SB, connected: true }],
      listGroups: (w, s) =>
        w === W && s === S ? [{ id: G, name: "Grupo A" }] : [],
    }),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  t.after(
    () =>
      new Promise((resolve) =>
        server.listening ? server.close(resolve) : resolve(),
      ),
  );
  const origin = "http://127.0.0.1:" + server.address().port;
  const get = (headers = {}) =>
    fetch(origin + "/mensageiro-v4/state", { headers });
  assert.equal((await get()).status, 401);
  assert.equal((await get({ "x-fixture-workspace": W })).status, 403);
  const headers = {
    "x-fixture-workspace": W,
    "x-fixture-plan": "yes",
    "content-type": "application/json",
  };
  assert.equal((await get(headers)).status, 200);
  const cross = await fetch(origin + "/mensageiro-v4/profiles", {
    method: "POST",
    headers,
    body: JSON.stringify({ name: "bad", sessionId: SB, destinations: [GB] }),
  });
  assert.equal(cross.status, 422);
});
test("real adapters preserve commands, private replies and PN/LID mentions with images", async (t) => {
  const f = fixture(t),
    sock = socket();
  sock.sendPresenceUpdate = async () => {};
  f.store.saveCard(W, f.p.id, "commands", {
    active: true,
    configuration: {
      comandos: [
        {
          id: "pix",
          ativo: true,
          perfilId: f.p.id,
          gatilhos: ["!pix"],
          correspondencia: "exato",
          grupos: [G],
          gruposConfigurados: true,
          resposta: { tipo: "texto", texto: "chave pública de teste" },
        },
      ],
    },
  });
  f.store.saveCard(W, f.p.id, "attendance", {
    active: true,
    configuration: {
      escopo: "privado",
      delaySegundos: 0,
      gatilhos: [
        {
          id: "pv",
          ativo: true,
          modo: "todas",
          palavrasObrigatorias: ["oi"],
          respostas: [
            {
              tipo: "texto",
              conteudo: "Atendimento de teste",
              delaySegundos: 0,
            },
          ],
        },
      ],
    },
  });
  const png =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aE2kAAAAASUVORK5CYII=";
  for (const card of ["welcome", "farewell"])
    f.store.saveCard(W, f.p.id, card, {
      active: true,
      configuration: {
        mensagem: "Olá {numero}",
        imagem: png,
        envio: { destino: "grupo", modoGrupo: "imagem_texto" },
      },
    });
  const e = engine(f, sock);
  await dispatch(e, sock, message("real-command", "!pix"), "commands");
  assert.ok(sock.sent.some((s) => s.content.text === "chave pública de teste"));
  await dispatch(
    e,
    sock,
    {
      key: { id: "real-pv", remoteJid: "peer@s.whatsapp.net", fromMe: false },
      message: { conversation: "oi" },
    },
    "attendance",
  );
  assert.ok(
    sock.sent.some(
      (s) =>
        s.to === "peer@s.whatsapp.net" &&
        s.content.text === "Atendimento de teste",
    ),
  );
  for (const [card, participant] of [
    ["welcome", "member@lid"],
    ["farewell", "member@s.whatsapp.net"],
  ]) {
    await e.dispatch({
      workspaceId: W,
      sessionId: S,
      card,
      event: {
        id: G,
        action: card === "welcome" ? "add" : "remove",
        participants: [participant],
        timestamp: 111,
      },
      sock,
      planAllowed: true,
    });
    assert.ok(
      sock.sent.some(
        (s) =>
          s.to === G &&
          s.content.image &&
          s.content.mentions?.includes(participant),
      ),
    );
  }
});
test("simultaneous private greetings produce one reply and keep self messages silent", async (t) => {
  const f = fixture(t),
    sock = socket();
  f.store.saveCard(W, f.p.id, "attendance", {
    active: true,
    configuration: { v4: { enabled: true } },
  });
  const e = engine(f, sock),
    pv = (id) => ({
      key: { id, remoteJid: "private@lid" },
      message: { conversation: "oi" },
    });
  const results = await Promise.all([
    dispatch(e, sock, pv("greet1"), "attendance"),
    dispatch(e, sock, pv("greet2"), "attendance"),
  ]);
  assert.equal(sock.sent.length, 1);
  assert.ok(results.some((r) => r.reason === "cooldown"));
});
test("legacy flood/repetition keep message dedupe and tenant-separated windows", (t) => {
  const f = fixture(t),
    p = structuredClone(f.p);
  p.cards.groupManager.configuration.regras = [
    {
      id: "flood",
      ativo: true,
      tipo: "flood",
      acao: "apagar",
      parametros: { maxMensagens: 2, janelaSegundos: 30 },
    },
  ];
  const moderator = new Moderator();
  assert.equal(moderator.evaluate(p, message("a")), null);
  assert.equal(moderator.evaluate(p, message("a")), null);
  assert.equal(moderator.evaluate(p, message("b")), null);
  assert.equal(
    moderator.evaluate({ ...p, workspaceId: B }, message("c")),
    null,
  );
  assert.equal(moderator.evaluate(p, message("c")).action, "delete");
});
test("old diagnostic callbacks cannot pollute a new capture; restart erases results", () => {
  let now = 0;
  const d = new Diagnostics({ ownsSession: () => true, clock: () => now });
  d.start({ workspaceId: W, sessionId: S, groupId: G, durationMs: 1000 });
  const m = message();
  d.observe({
    sessionId: S,
    capturedWorkspaceId: W,
    current: true,
    messages: [m],
  });
  const old = d.trace(m);
  d.stop(W);
  now = 300001;
  d.start({ workspaceId: W, sessionId: S, groupId: G });
  old("result", "transport_accepted");
  assert.equal(d.status(W).records.length, 0);
  d.stop(W);
  assert.equal(
    new Diagnostics({ ownsSession: () => true }).status(W).state,
    "off",
  );
});
test("public links require published owner pointers; drafts and other tenants never leak", async (t) => {
  const f = fixture(t),
    publicId = "a".repeat(32),
    root = path.join(f.root, "landing-pages");
  fs.mkdirSync(path.join(root, "workspaces"), { recursive: true });
  fs.mkdirSync(path.join(root, "public"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "workspaces", W + ".json"),
    JSON.stringify({
      workspaceId: W,
      publicId,
      draft: { slug: "draft" },
      published: null,
    }),
  );
  assert.deepEqual(
    await createPublicResources({ dataDir: f.root, canUse: () => true })(W),
    {},
  );
  fs.writeFileSync(
    path.join(root, "workspaces", W + ".json"),
    JSON.stringify({
      workspaceId: W,
      publicId,
      published: {
        config: {
          slug: "loja-a",
          name: "Loja A",
          buttons: [{ url: "https://chat.whatsapp.com/publicinvite" }],
        },
      },
    }),
  );
  fs.writeFileSync(
    path.join(root, "public", publicId + ".json"),
    JSON.stringify({ workspaceId: B }),
  );
  assert.deepEqual(
    await createPublicResources({ dataDir: f.root, canUse: () => true })(W),
    {},
  );
  fs.writeFileSync(
    path.join(root, "public", publicId + ".json"),
    JSON.stringify({ workspaceId: W }),
  );
  const resources = await createPublicResources({
    dataDir: f.root,
    canUse: () => true,
  })(W);
  assert.equal(resources.landing, "https://www.optimuspromo.com.br/l/loja-a");
  assert.equal(resources.groupInvites.length, 1);
});
test("1404 concurrent events preserve HTTP responsiveness with explicit backpressure", async (t) => {
  const f = fixture(t),
    sock = socket(),
    e = engine(f, sock),
    delays = monitorEventLoopDelay({ resolution: 10 });
  delays.enable();
  sock.sendMessage = async (to, content) => {
    await new Promise((r) => setTimeout(r, 15));
    sock.sent.push({ to, content });
    return {};
  };
  const app = express();
  app.get("/health", (req, res) => res.json({ ok: true }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  t.after(
    () =>
      new Promise((resolve) =>
        server.listening ? server.close(resolve) : resolve(),
      ),
  );
  const jobs = Promise.all(
    Array.from({ length: 1404 }, (_, i) =>
      dispatch(e, sock, message("storm_" + i)),
    ),
  );
  const durations = [];
  for (let i = 0; i < 12; i++) {
    const start = performance.now();
    assert.equal(
      (await fetch("http://127.0.0.1:" + server.address().port + "/health"))
        .status,
      200,
    );
    durations.push(performance.now() - start);
  }
  const results = await jobs;
  delays.disable();
  assert.equal(results.length, 1404);
  assert.equal(results.filter((r) => r.reason === "backpressure").length, 1400);
  assert.ok(Math.max(...durations) < 1000);
  assert.ok(delays.max / 1e6 < 1000);
  console.log(
    "V4_STORM_METRICS=" +
      JSON.stringify({
        events: 1404,
        explicitBackpressure: 1400,
        httpMaxMs: Math.round(Math.max(...durations) * 100) / 100,
        eventLoopMaxMs: Math.round(delays.max / 1e4) / 100,
      }),
  );
});
