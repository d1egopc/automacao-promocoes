"use strict";

// Só é executável no service PostgreSQL 17 descartável do GitHub-hosted CI.
// Nunca usa DATABASE_URL, Engine pool, .env ou credenciais externas.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

function validarAmbiente() {
  assert.equal(process.env.GITHUB_ACTIONS, "true", "exige GitHub Actions");
  assert.equal(process.env.FILA_CHECKPOINT_TEST_ISOLATED, "github-actions-service-17");
  assert.equal(process.env.GITHUB_REF, "refs/heads/validation/fase-1d-postgres-17");
  assert.equal(process.env.GITHUB_EVENT_NAME, "push");
  assert.equal(process.env.DATABASE_URL || "", "", "sem URL externa do Engine");
  const url = new URL(process.env.FILA_CHECKPOINT_TEST_DATABASE_URL || "");
  assert.equal(url.protocol, "postgresql:");
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.port, "5432");
  assert.equal(url.pathname, "/ofc_fase1d_disposable");
  assert.equal(url.username, "fase1d_ci");
  assert.equal(url.password, "fase1d_ci_disposable_only");
  assert.equal(url.search, "");
  assert(process.env.RUNNER_TEMP, "exige diretório temporário do runner");
  return url.href;
}

const databaseUrl = validarAmbiente();
const { Pool } = require("pg");
const repo = require("../modules/fila/fila-checkpoints-entrega.repository");
const mode = process.argv[2];
assert(["prepare", "verify", "verify-reapply"].includes(mode), "modo obrigatório");
const pool = new Pool({ connectionString: databaseUrl, max: 8,
  options: "-c timezone=UTC -c application_name=phase1d_disposable_validation" });
const statePath = path.join(process.env.RUNNER_TEMP, "phase1d-postgres-evidence.json");
const migrationPath = path.join(__dirname, "..", "modules", "fila", "observabilidade-confirmacao.sql");
const migrationSha256 = crypto.createHash("sha256").update(fs.readFileSync(migrationPath)).digest("hex");
const ATTEMPT = "33333333-3333-4333-8333-333333333333";

function entrada(item, extra = {}) {
  return { clienteId: "phase1d_ci_workspace", filaItemId: item,
    destinoChave: "telegram:fixture", alvoChave: "chat:fixture",
    attemptId: ATTEMPT, ...extra };
}
function evidence(name, detail = {}) {
  console.log("POSTGRES_FASE_1D", JSON.stringify({ check: name, result: "PASS", ...detail }));
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      "- PASS " + name + ": " + JSON.stringify(detail) + "\n");
  }
}
async function row(e, executor = pool) {
  const result = await executor.query(
    `SELECT estado, provider_message_id, credito_debitado,
            confirmado_em::text AS confirmado_em, atualizado_em::text AS atualizado_em
       FROM fila_checkpoints_entrega
      WHERE cliente_id=$1 AND fila_item_id=$2 AND destino_chave=$3 AND alvo_chave=$4`,
    [e.clienteId, e.filaItemId, e.destinoChave, e.alvoChave]);
  assert.equal(result.rowCount, 1);
  return result.rows[0];
}
async function start(e) {
  assert.equal((await repo.criarCheckpointEntrega(e, { pool })).criado, true);
  const prepared = await row(e);
  assert.equal(prepared.estado, "preparado");
  assert.equal(prepared.confirmado_em, null);
  assert.equal((await repo.transicionarCheckpointEntrega({
    ...e, deEstado: "preparado", paraEstado: "envio_iniciado" }, { pool })).transicionado, true);
  assert.equal((await row(e)).confirmado_em, null);
}
async function columnAndIndex() {
  const column = await pool.query(
    `SELECT data_type, udt_name, is_nullable, column_default
       FROM information_schema.columns
      WHERE table_schema='public' AND table_name='fila_checkpoints_entrega'
        AND column_name='confirmado_em'`);
  assert.equal(column.rowCount, 1);
  assert.deepEqual(column.rows[0], {
    data_type: "timestamp with time zone", udt_name: "timestamptz",
    is_nullable: "YES", column_default: null
  });
  const index = await pool.query(
    `SELECT c.oid::text AS oid, i.indisvalid, i.indisready, i.indisunique,
            pg_get_indexdef(i.indexrelid) AS definition,
            pg_get_expr(i.indpred, i.indrelid) AS predicate
       FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
       JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname='idx_fila_checkpoint_confirmado_em'
        AND i.indrelid='public.fila_checkpoints_entrega'::regclass`);
  assert.equal(index.rowCount, 1);
  const detail = index.rows[0];
  assert.equal(detail.indisvalid, true);
  assert.equal(detail.indisready, true);
  assert.equal(detail.indisunique, false);
  assert.match(detail.definition, /USING btree \(confirmado_em\)/);
  assert.match(detail.predicate, /estado = 'enviado'::text/);
  assert.match(detail.predicate, /confirmado_em IS NOT NULL/);
  evidence("COLUMN_TIMESTAMPTZ_NULLABLE_NO_DEFAULT", column.rows[0]);
  evidence("PARTIAL_INDEX_VALID_READY", detail);
  return { column: column.rows[0], index: detail };
}
async function snapshot() {
  return (await pool.query(
    `SELECT cliente_id, fila_item_id, destino_chave, alvo_chave, estado,
            confirmado_em::text AS confirmado_em, atualizado_em::text AS atualizado_em,
            credito_debitado, provider_message_id
       FROM fila_checkpoints_entrega
      ORDER BY cliente_id,fila_item_id,destino_chave,alvo_chave`)).rows;
}
async function version() {
  const result = await pool.query(
    "SELECT version() AS version, current_setting('server_version_num')::int AS version_num, current_database() AS db, current_user AS username, current_schema() AS schema");
  const info = result.rows[0];
  assert.equal(Math.floor(info.version_num / 10000), 17);
  assert.equal(info.db, "ofc_fase1d_disposable");
  assert.equal(info.username, "fase1d_ci");
  assert.equal(info.schema, "public");
  evidence("POSTGRESQL_REAL_17", info);
  return info;
}

async function prepare() {
  assert.equal((await pool.query("SELECT to_regclass('public.fila_checkpoints_entrega') AS rel")).rows[0].rel, null,
    "não reutiliza tabela/banco existente");
  const schema = fs.readFileSync(path.join(__dirname, "..", "modules", "engine", "schema.sql"), "utf8");
  const legacy = schema.match(/CREATE TABLE IF NOT EXISTS fila_checkpoints_entrega \([\s\S]*?\r?\n\);/);
  assert(legacy, "schema homologado anterior precisa existir");
  assert.doesNotMatch(legacy[0], /confirmado_em/);
  await pool.query(legacy[0]);
  const historic = entrada("A_historical_sent_before_migration");
  await pool.query(
    `INSERT INTO fila_checkpoints_entrega
     (cliente_id,fila_item_id,destino_chave,alvo_chave,attempt_id,estado,provider_message_id)
     VALUES ($1,$2,$3,$4,$5,'enviado','historical-fixture')`,
    [historic.clienteId, historic.filaItemId, historic.destinoChave, historic.alvoChave, historic.attemptId]);
  assert.equal((await pool.query(
    "SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema='public' AND table_name='fila_checkpoints_entrega' AND column_name='confirmado_em'")).rows[0].n, 0);
  evidence("PRE_EXTENSION_HISTORICAL_SENT_FIXTURE", { migrationSha256 });
}

async function verify() {
  const schema = await columnAndIndex();
  const historic = entrada("A_historical_sent_before_migration");
  const historicRepo = await repo.obterCheckpointEntrega(historic, { pool });
  assert.equal(historicRepo.estado, "enviado");
  assert.equal(historicRepo.confirmadoEm, null);
  assert.equal((await repo.registrarCreditoDebitadoCheckpointEntrega(historic, { pool })).registrado, true);
  assert.equal((await row(historic)).confirmado_em, null);
  evidence("A_HISTORICAL_SENT_REMAINS_NULL");

  const e = entrada("B_C_D_E_F_transition");
  const created = await repo.criarCheckpointEntrega(e, { pool });
  assert.equal(created.criado, true);
  assert.equal(created.checkpoint.confirmadoEm, null);
  assert.equal((await row(e)).confirmado_em, null);
  evidence("B_PREPARED_NULL");

  assert.equal((await repo.transicionarCheckpointEntrega({
    ...e, deEstado: "preparado", paraEstado: "envio_iniciado" }, { pool })).transicionado, true);
  assert.equal((await row(e)).confirmado_em, null);
  evidence("C_SEND_STARTED_NULL");

  const before = (await pool.query("SELECT clock_timestamp()::text AS t")).rows[0].t;
  const sent = await repo.transicionarCheckpointEntrega({
    ...e, deEstado: "envio_iniciado", paraEstado: "enviado", providerMessageId: "fixture-success"
  }, { pool });
  assert.equal(sent.transicionado, true);
  assert(sent.checkpoint.confirmadoEm instanceof Date);
  const first = await row(e);
  assert(first.confirmado_em);
  assert.equal((await pool.query(
    "SELECT $1::timestamptz >= $2::timestamptz AND $1::timestamptz <= clock_timestamp() AS valid",
    [first.confirmado_em, before])).rows[0].valid, true);
  evidence("D_FIRST_PERSISTED_SENT_TIMESTAMP", { confirmadoEm: first.confirmado_em });

  await pool.query("SELECT pg_sleep(0.05)");
  assert.equal((await repo.transicionarCheckpointEntrega({
    ...e, deEstado: "envio_iniciado", paraEstado: "enviado", providerMessageId: "replay-fixture"
  }, { pool })).transicionado, false);
  assert.equal((await repo.criarCheckpointEntrega(e, { pool })).criado, false);
  assert.equal((await row(e)).confirmado_em, first.confirmado_em);
  await assert.rejects(repo.transicionarCheckpointEntrega({
    ...e, deEstado: "enviado", paraEstado: "enviado" }, { pool }), /transicao_invalida/);
  assert.equal((await row(e)).confirmado_em, first.confirmado_em);
  evidence("E_REPLAY_IDEMPOTENT_TIMESTAMP_UNCHANGED");

  await pool.query("SELECT pg_sleep(0.05)");
  assert.equal((await repo.registrarCreditoDebitadoCheckpointEntrega(e, { pool })).registrado, true);
  assert.equal((await row(e)).confirmado_em, first.confirmado_em);
  assert.equal((await row(e)).credito_debitado, true);
  assert.notEqual((await row(e)).atualizado_em, first.atualizado_em);
  assert.equal((await repo.registrarCreditoDebitadoCheckpointEntrega(e, { pool })).registrado, true);
  assert.equal((await row(e)).confirmado_em, first.confirmado_em);
  evidence("F_LATER_DEBIT_TIMESTAMP_UNCHANGED");

  const concurrent = entrada("G_concurrent_CAS");
  await start(concurrent);
  const winner = await pool.connect();
  const loser = await pool.connect();
  try {
    await winner.query("BEGIN");
    await loser.query("BEGIN");
    const loserPid = (await loser.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    const a = await repo.transicionarCheckpointEntrega({
      ...concurrent, deEstado: "envio_iniciado", paraEstado: "enviado", providerMessageId: "winner-fixture"
    }, { client: winner });
    assert.equal(a.transicionado, true);
    const winningTimestamp = (await row(concurrent, winner)).confirmado_em;
    const second = repo.transicionarCheckpointEntrega({
      ...concurrent, deEstado: "envio_iniciado", paraEstado: "enviado", providerMessageId: "loser-fixture"
    }, { client: loser });
    // Não é só Promise.all sequencial: comprova bloqueio real de linha/transação.
    let lockObserved = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      const state = (await pool.query("SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1", [loserPid])).rows[0];
      if (state?.wait_event_type === "Lock") { lockObserved = true; break; }
      await pool.query("SELECT pg_sleep(0.02)");
    }
    assert.equal(lockObserved, true, "exige contenção real entre duas conexões");
    await winner.query("COMMIT");
    const b = await second;
    assert.equal(b.transicionado, false);
    await loser.query("COMMIT");
    const saved = await row(concurrent);
    assert.equal(saved.confirmado_em, winningTimestamp);
    assert.equal(saved.provider_message_id, "winner-fixture");
    assert.equal((await pool.query(
      "SELECT count(*)::int AS n FROM fila_checkpoints_entrega WHERE cliente_id=$1 AND fila_item_id=$2 AND estado='enviado' AND confirmado_em IS NOT NULL",
      [concurrent.clienteId, concurrent.filaItemId])).rows[0].n, 1);
    evidence("G_CONCURRENT_CAS_ONE_CONFIRMATION", { lockObserved, successes: 1, rejected: 1,
      confirmadoEm: winningTimestamp });
  } finally {
    await Promise.allSettled([winner.query("ROLLBACK"), loser.query("ROLLBACK")]);
    winner.release();
    loser.release();
  }

  const rollback = entrada("H_rolled_back_transition");
  await start(rollback);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const changed = await repo.transicionarCheckpointEntrega({
      ...rollback, deEstado: "envio_iniciado", paraEstado: "enviado", providerMessageId: "rollback-fixture"
    }, { client });
    assert.equal(changed.transicionado, true);
    assert((await row(rollback, client)).confirmado_em);
    assert.equal((await row(rollback)).confirmado_em, null);
    assert.equal((await row(rollback)).estado, "envio_iniciado");
    await client.query("ROLLBACK");
    assert.equal((await row(rollback)).confirmado_em, null);
    assert.equal((await row(rollback)).estado, "envio_iniciado");
    evidence("H_TRANSACTION_ROLLBACK_NO_SURVIVING_CONFIRMATION");
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
  assert.equal((await row(historic)).confirmado_em, null);
  const state = { migrationSha256, column: schema.column, indexOid: schema.index.oid,
    rows: await snapshot() };
  fs.writeFileSync(statePath, JSON.stringify(state));
  evidence("REPOSITORY_WITH_MIGRATED_COLUMN");
}

async function verifyReapply() {
  const previous = JSON.parse(fs.readFileSync(statePath, "utf8"));
  assert.equal(previous.migrationSha256, migrationSha256);
  const schema = await columnAndIndex();
  assert.deepEqual(schema.column, previous.column);
  assert.equal(schema.index.oid, previous.indexOid);
  assert.deepEqual(await snapshot(), previous.rows, "migration replay não muda dados/timestamps");
  assert.equal((await row(entrada("A_historical_sent_before_migration"))).confirmado_em, null);
  evidence("MIGRATION_REAPPLY_SAFE_NO_BACKFILL_NO_TIMESTAMP_CHANGE", { migrationSha256,
    sameIndexOid: true, identicalRows: true });
}

(async () => {
  try {
    const info = await version();
    console.log("POSTGRES_FASE_1D_CONTEXT", JSON.stringify({ branch: process.env.GITHUB_REF,
      commit: process.env.GITHUB_SHA, mode, migrationSha256, postgres: info.version }));
    if (mode === "prepare") await prepare();
    if (mode === "verify") await verify();
    if (mode === "verify-reapply") await verifyReapply();
    console.log("fila-confirmacao-migration.postgres.test.js " + mode + " OK");
  } finally { await pool.end(); }
})().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
