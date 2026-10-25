"use strict";
// Fixed loopback disposable PostgreSQL only: no DATABASE_URL, secrets or VPS.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { randomBytes } = require("node:crypto");
const { Client, Pool } = require("pg");
const { SQL_SCHEMA_FINANCEIRO_V1 } = require("../modules/financeiro/financeiro.schema");
const { prepararModoOperacionalReal } = require("../modules/engine/universal-runtime-bootstrap");
const balance = require("../modules/engine/universal-credits.repository");
const official = require("../modules/manual-v2/manual-universal-credit");
const { V3Store } = require("../modules/mensageiro-v3/src/v3/store");
const { V4Repository } = require("../modules/mensageiro-v4/repository");
const { V4Engine } = require("../modules/mensageiro-v4/engine");
const { Credits } = require("../modules/mensageiro-v4/credits");
const { Scope } = require("../modules/mensageiro-v4/scope");
const { Diagnostics } = require("../modules/mensageiro-v4/diagnostics");
const config = { host: "127.0.0.1", port: 55439, user: "postgres",
  database: "optimus_messenger_v4_fixture", connectionTimeoutMillis: 5000 };
const schema = "v4_credit_" + randomBytes(6).toString("hex");
const epoch = "2026-10-25T10:00:00.000Z", G = "authorized@g.us", OTHER = "other@g.us";
let admin, pool, created = false, serial = 0;
test.before(async () => {
  assert.ok(!process.env.DATABASE_URL, "Production-style connection strings forbidden");
  admin = new Client(config); await admin.connect();
  const id = (await admin.query("SELECT current_database() AS db, host(inet_server_addr()) AS host, inet_server_port() AS port, current_setting('server_version') AS version")).rows[0];
  // Docker publishes loopback:55439 to the service's exact private IP:5432.
  // The CI workflow obtains that IP from its own service container; do not
  // confuse the server endpoint with the client's mapped loopback endpoint.
  const dockerFixture = process.env.GITHUB_ACTIONS === "true" && process.env.RUNNER_ENVIRONMENT === "github-hosted";
  const serverHost = dockerFixture ? process.env.V4_FIXTURE_SERVER_HOST : config.host;
  assert.equal(admin.connection.stream.remoteAddress, config.host);
  assert.match(serverHost || "", /^\d{1,3}(?:\.\d{1,3}){3}$/);
  assert.equal(id.db, config.database); assert.equal(id.host, serverHost);
  assert.equal(id.port, dockerFixture ? 5432 : config.port); assert.match(id.version, /^17\./);
  await admin.query(`CREATE SCHEMA ${schema}`); created = true;
  await admin.query(`SET search_path TO ${schema},public`);
  await admin.query(fs.readFileSync(path.join(__dirname, "../modules/engine/schema.sql"), "utf8"));
  for (const sql of SQL_SCHEMA_FINANCEIRO_V1) await admin.query(sql);
  await prepararModoOperacionalReal({ pool: admin });
  await admin.query("UPDATE engine_operation_state SET mode='CUTOVER_PREPARED' WHERE id=1");
  await admin.query("UPDATE engine_operation_state SET mode='UNIVERSAL',operation_epoch_started_at=$1 WHERE id=1", [epoch]);
  pool = new Pool({ ...config, max: 8, options: `-c search_path=${schema},public` });
});
test.after(async () => {
  await pool?.end();
  if (created) await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin?.end();
});
async function fixture(t, money = 3) {
  const w = "v4_fixture_" + (++serial), s = w + "_phone";
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "v4-finance-"));
  const file = path.join(root, "state.json"), store = new V3Store({ filePath: file });
  const p = store.createProfile({ workspaceId: w, sessionId: s, name: "Fixture" });
  store.updateProfile(w, p.id, { active: true, destinations: [G, OTHER] });
  store.saveCard(w, p.id, "groupManager", { active: true, configuration: {
    v4: { migrationVersion: 4 }, regras: [{ id: "links", ativo: true,
      tipo: "links_externos", acao: "apagar_avisar", parametros: { dominiosPermitidos: [] } }] } });
  store.saveCard(w, p.id, "commands", { active: true, configuration: {} });
  const scope = new Scope([{ workspaceId: w, sessionId: s, groupId: G, profileId: p.id,
    cards: ["groupManager", "commands"] }]);
  const repository = new V4Repository({ filePath: file });
  const f = { w, s, p, root, store, scope, repository, sent: [] };
  await balance.openBalance({ pool, workspaceId: w, operationEpochStartedAt: epoch,
    openingBalance: money, sourceHash: "a".repeat(64) });
  f.sock = { user: { id: "bot@lid" }, groupMetadata: async () => ({ participants: [
    { id: "bot@lid", admin: "admin" }, { id: "peer@lid", admin: null }] }),
    sendMessage: async (to, content, options) => { const id = options?.messageId || "delete_" + (f.sent.length + 1);
      f.sent.push({ to, content, id }); return { key: { id } }; } };
  f.credits = new Credits({ repository, scope, getPool: () => pool, allowed: () => true });
  f.engine = new V4Engine({ repository, scope, enabled: () => true, credits: f.credits,
    actionAllowed: () => true, contextValid: (workspaceId, sessionId, sock) =>
      workspaceId === w && sessionId === s && sock === f.sock,
    handlers: { commands: args => args.sock.sendMessage(G, { text: "fixture response" }) } });
  f.message = (id = "input", groupId = G) => ({ key: { id, remoteJid: groupId,
    fromMe: false, participant: "peer@lid" }, message: { conversation: "https://example.org/fixture" } });
  f.dispatch = (card = "commands", message = f.message(), extra = {}) => f.engine.dispatch({
    workspaceId: w, sessionId: s, sock: f.sock, planAllowed: true, card, message, ...extra });
  f.ack = (status = 3, id = f.sent.at(-1)?.id, groupId = G) => ({ sessionId: s,
    updates: [{ key: { id, remoteJid: groupId, fromMe: true }, update: { status } }] });
  f.balance = () => balance.readBalance({ pool, workspaceId: w });
  t.after(async () => { await f.repository.close(); fs.rmSync(root, { recursive: true, force: true }); });
  return f;
}
test("zero official balance prevents a billable response before transport", async t => {
  const f = await fixture(t, 0), r = await f.dispatch();
  assert.equal(r.reason, "sem_creditos"); assert.equal(f.sent.length, 0);
  assert.equal((await f.balance()).reserved, 0);
});
test("hold before send; local return/server ACK never debit; delivery ACK debits exactly once", async t => {
  const f = await fixture(t, 1); await f.dispatch();
  assert.equal(f.sent.length, 1);
  assert.equal((await f.balance()).balance, 1); assert.equal((await f.balance()).reserved, 1);
  await f.credits.observe(f.ack(2)); assert.equal((await f.balance()).balance, 1);
  await Promise.all([f.credits.observe(f.ack()), f.credits.observe(f.ack(4))]);
  assert.equal((await f.balance()).balance, 0); assert.equal((await f.balance()).reserved, 0);
  await f.dispatch(); assert.equal(f.sent.length, 1);
  const rows = (await pool.query("SELECT amount, metadata FROM financial_credit_ledger WHERE cliente_id=$1 AND universal_movement_type='TARGET_DEBIT'", [f.w])).rows;
  assert.equal(rows.length, 1); assert.equal(rows[0].amount, -1);
  assert.equal(rows[0].metadata.origin, "mensageiro_v4");
});
test("restart plus repeated ACK settles the durable correlation without resend or duplicate debit", async t => {
  const f = await fixture(t); await f.dispatch();
  await f.repository.close(); f.repository = new V4Repository({ filePath: f.repository.filePath });
  const recovered = new Credits({ repository: f.repository, scope: f.scope, getPool: () => pool });
  await recovered.observe(f.ack()); await recovered.observe(f.ack());
  assert.equal((await f.balance()).balance, 2); assert.equal(f.sent.length, 1);
});
test("ACK before binding is correlated, and failed settlement persistence can be repeated safely", async t => {
  const f = await fixture(t);
  const original = f.sock.sendMessage;
  f.sock.sendMessage = async (...args) => { const value = await original(...args);
    await f.credits.observe(f.ack()); return value; };
  await f.dispatch(); assert.equal((await f.balance()).balance, 2);
  const g = await fixture(t); await g.dispatch();
  const call = g.repository.call.bind(g.repository); let fail = true;
  g.repository.call = (op, a) => op === "outbound_patch" && a.stage === "settled" && fail
    ? (fail = false, Promise.reject(new Error("fixture_after_debit"))) : call(op, a);
  await assert.rejects(g.credits.observe(g.ack()), /fixture_after_debit/);
  await g.credits.recover(); assert.equal((await g.balance()).balance, 2);
});
test("proven failure before transport releases hold; ambiguous transport retains hold without replay", async t => {
  const f = await fixture(t), key = "parent";
  const current = await f.repository.call("profile", { workspaceId: f.w, profileId: f.p.id });
  await f.repository.call("claim", { workspaceId: f.w, profileId: f.p.id,
    expectedRevision: current.revision, key, card: "commands" });
  await assert.rejects(f.credits.send({ workspaceId: f.w, sessionId: f.s, profileId: f.p.id,
    groupId: G, parentKey: key, slot: 1, revalidate: async () => { throw new Error("fixture_context_changed"); },
    transport: () => assert.fail("must not send") }), /fixture_context_changed/);
  assert.equal((await f.balance()).reserved, 0);
  const g = await fixture(t); g.sock.sendMessage = async () => { throw new Error("uncertain"); };
  await g.dispatch(); await g.dispatch();
  assert.equal((await g.balance()).reserved, 1); assert.equal((await g.balance()).balance, 3);
});
test("group-only, exact profile, session and workspace gates forbid all out-of-scope effects", async t => {
  const f = await fixture(t);
  for (const extra of [{ message: f.message("other", OTHER) }, { workspaceId: "other_workspace" },
    { sessionId: "other_session" }, { planAllowed: false }]) {
    const r = await f.dispatch("groupManager", f.message(), extra); assert.equal(r.blocked, true);
  }
  f.engine.scope = new Scope([{ ...f.scope.targets[0], profileId: "wrong_profile" }]);
  assert.equal((await f.dispatch("groupManager")).reason, "profile_unauthorized");
  assert.equal(f.sent.length, 0); assert.equal((await f.balance()).reserved, 0);
});
test("a legacy adapter cannot redirect a canary reply into another group or private chat", async t => {
  const f = await fixture(t);
  f.engine.handlers.commands = args => args.sock.sendMessage(OTHER, { text: "fixture" });
  assert.equal((await f.dispatch()).reason, "scope_unauthorized"); assert.equal(f.sent.length, 0);
  assert.equal((await f.balance()).reserved, 0);
});
test("authorized group deletes and warns; deletion is nonbillable and never falsely remote-confirmed", async t => {
  const f = await fixture(t); const r = await f.dispatch("groupManager");
  assert.equal(f.sent.length, 2); assert.equal(r.deleteAttempted, true);
  assert.equal(r.deleteResult, "local_resolved"); assert.equal(r.remoteDeletionConfirmed, false);
  await f.credits.observe(f.ack()); assert.equal((await f.balance()).balance, 2);
  const g = await fixture(t, 0); const zero = await g.dispatch("groupManager");
  assert.equal(g.sent.length, 1); assert.ok(g.sent[0].content.delete);
  assert.equal(zero.noticeResult, "sem_creditos"); assert.equal((await g.balance()).balance, 0);
});
test("delete error differs from not attempted and does not send a warning", async t => {
  const f = await fixture(t); f.sock.sendMessage = async () => { throw new Error("fixture_delete_failure"); };
  const error = await f.dispatch("groupManager");
  assert.equal(error.deleteAttempted, true); assert.equal(error.deleteResult, "error");
  assert.equal(error.remoteDeletionConfirmed, false); assert.equal((await f.balance()).reserved, 0);
  f.engine.enabled = () => false;
  const off = await f.dispatch("groupManager", f.message("off"));
  assert.equal(off.deleteAttempted, false); assert.equal(off.deleteResult, "not_attempted");
});
test("wrong-group/fromMe=false ACK cannot debit; OFF never starts worker or finance", async t => {
  const f = await fixture(t); f.engine.enabled = () => false;
  await f.dispatch(); assert.equal(f.repository.worker, null);
  assert.equal((await f.balance()).reserved, 0);
  f.engine.enabled = () => true; await f.dispatch();
  await f.credits.observe(f.ack(3, f.sent[0].id, OTHER));
  const forged = f.ack(); forged.updates[0].key.fromMe = false;
  await f.credits.observe(forged); assert.equal((await f.balance()).balance, 3);
});
test("workspace-only activation is invalid; malformed/duplicate targets fail closed", () => {
  assert.equal(Scope.fromEnvironment('[{"workspaceId":"fixture"}]').targets.length, 0);
  const t = { workspaceId: "w", sessionId: "s", groupId: G, profileId: "p", cards: ["commands"] };
  assert.throws(() => new Scope([t, { ...t, workspaceId: "other" }]));
  assert.throws(() => new Scope([{ ...t, groupId: "private@lid" }]));
  assert.equal(new Scope([t]).match({ ...t, workspaceId: "other" }), null);
});
test("pre-filter ingress records wrong workspace independently of routing, sanitizes and expires", () => {
  const target = { workspaceId: "fixture", sessionId: "phone", groupId: G, profileId: "p", cards: ["commands"] };
  const scope = new Scope([target]); let now = 0;
  const d = new Diagnostics({ ownsSession: () => true, authorizeTarget: c => !!scope.match(c), clock: () => now });
  assert.throws(() => d.start({ ...target, groupId: OTHER }));
  d.start({ ...target, durationMs: 1000 });
  assert.equal(d.status(target.workspaceId).coverage.ingress, "not_observed_at_original_callback");
  d.observe({ sessionId: target.sessionId, capturedWorkspaceId: "wrong_workspace", current: true,
    generation: 3, messages: [{ key: { id: "raw_message_id", remoteJid: G, fromMe: false },
      message: { conversation: "private_content" } }] });
  const status = d.status(target.workspaceId);
  assert.equal(status.coverage.ingress, "observed_at_original_callback");
  assert.ok(status.records.some(r => r.code === "workspace_mismatch"));
  for (const raw of [G, "phone", "private_content", "raw_message_id", "wrong_workspace"])
    assert.ok(!JSON.stringify(status).includes(raw));
  now = 1001; assert.equal(d.status(target.workspaceId).state, "finished");
});
test("Manual V2 keeps original keys and official ledger contract", async t => {
  const f = await fixture(t);
  const args = { pool, workspaceId: f.w, operationId: "manual-fixture", destinationId: G };
  const hold = await official.reservarCreditoManualUniversal(args);
  assert.match(hold.idempotencyKey, /^manual-universal:/);
  await official.confirmarCreditoManualUniversal({ pool, reserva: hold });
  await official.confirmarCreditoManualUniversal({ pool, reserva: hold });
  assert.equal((await f.balance()).balance, 2);
  const row = (await pool.query("SELECT metadata,reason FROM financial_credit_ledger WHERE idempotency_key=$1", [hold.idempotencyKey])).rows[0];
  assert.equal(row.metadata.origin, "manual_v2"); assert.equal(row.reason, "manual_v2_target_confirmed");
  await assert.rejects(official.reservarCreditoManualUniversal({ ...args, origin: "unapproved" }), /credit_origin_invalid/);
});
test("two concurrent billable replies cannot overspend the last credit", async t => {
  const f = await fixture(t, 1);
  await Promise.all([f.dispatch("commands", f.message("one")), f.dispatch("commands", f.message("two"))]);
  assert.equal(f.sent.length, 1); assert.equal((await f.balance()).reserved, 1);
  await f.credits.observe(f.ack()); assert.equal((await f.balance()).balance, 0);
});
test("Baileys real message generation respects the pre-persisted provider id", async () => {
  const { generateWAMessage, generateMessageIDV2 } = require("@whiskeysockets/baileys");
  const id = generateMessageIDV2();
  const generated = await generateWAMessage(G, { text: "isolated fixture" }, {
    userJid: "fixture@s.whatsapp.net", messageId: id,
    upload: () => assert.fail("no upload/network in this fixture") });
  assert.equal(generated.key.id, id);
});
test("1404 real credit-gated operations keep HTTP responsive with bounded admission", async t => {
  const http = require("node:http"), { monitorEventLoopDelay, performance } = require("node:perf_hooks");
  const f = await fixture(t, 4), delays = monitorEventLoopDelay({ resolution: 10 });
  const server = http.createServer((_req, res) => res.end("ok"));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  delays.enable();
  const jobs = Promise.all(Array.from({ length: 1404 }, (_, i) => f.dispatch("commands", f.message("storm_" + i))));
  const timings = [];
  for (let i = 0; i < 12; i++) {
    const start = performance.now();
    assert.equal((await fetch(`http://127.0.0.1:${server.address().port}`)).status, 200);
    timings.push(performance.now() - start);
  }
  const results = await jobs; delays.disable();
  assert.equal(results.filter(r => r.reason === "backpressure").length, 1400);
  assert.equal(f.sent.length, 4); assert.equal((await f.balance()).reserved, 4);
  assert.ok(Math.max(...timings) < 1000); assert.ok(delays.max / 1e6 < 1000);
  for (const message of f.sent) await f.credits.observe(f.ack(3, message.id));
  assert.equal((await f.balance()).balance, 0);
  console.log("V4_CREDIT_STORM=" + JSON.stringify({ events: 1404, rejected: 1400,
    httpMaxMs: Math.round(Math.max(...timings) * 100) / 100,
    eventLoopMaxMs: Math.round(delays.max / 1e4) / 100 }));
});
