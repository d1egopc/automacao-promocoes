"use strict";

// This test is intentionally opt-in and refuses production-looking connections.
// It runs only against the disposable PostgreSQL service used by CI.
const assert = require("node:assert/strict");
const { Client, Pool } = require("pg");
const {
  sqlBuscarJobsPendentes,
  sqlDiagnosticarAlvosPreImporter
} = require("../modules/engine/processor.service");
const { calcularCotasFrescorPreImporter } = require("../modules/engine/frescor-pre-importer.service");

if (process.env.CI_POSTGRES_ISOLATED !== "1") {
  throw new Error("CI_POSTGRES_ISOLATED=1 is required");
}
if (process.env.PGHOST !== "127.0.0.1" && process.env.PGHOST !== "localhost") {
  throw new Error("refusing non-local PostgreSQL host");
}
if (!/^rio_trace(?:_|$)/i.test(String(process.env.PGDATABASE || ""))) {
  throw new Error("refusing non-disposable database name");
}

const config = {
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE,
  connectionTimeoutMillis: 5000
};
const schema = `rio_trace_${process.pid}_${Date.now().toString(36)}`.replace(/[^a-z0-9_]/gi, "_");
const q = value => `"${String(value).replace(/"/g, '""')}"`;

const DDL = `
CREATE TABLE engine_operation_state (
  id INTEGER PRIMARY KEY, mode TEXT NOT NULL, operation_epoch_started_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE engine_eventos_brutos (
  id BIGINT PRIMARY KEY, uuid TEXT, capturado_em TIMESTAMPTZ NOT NULL, criado_em TIMESTAMPTZ NOT NULL,
  origem TEXT, origem_tipo TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE engine_jobs_cliente (
  id BIGINT PRIMARY KEY, uuid TEXT, evento_id BIGINT NOT NULL, oferta_id BIGINT,
  cliente_id TEXT NOT NULL,
  marketplace_detectado TEXT, marketplace TEXT, status TEXT NOT NULL,
  motivo_final TEXT,
  prioridade INTEGER DEFAULT 0, metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  criado_em TIMESTAMPTZ NOT NULL, atualizado_em TIMESTAMPTZ NOT NULL
);
CREATE TABLE engine_fairness_origem_fluxo (
  cliente_id TEXT NOT NULL, etapa TEXT NOT NULL, lane TEXT NOT NULL,
  ultima_origem_atendida TEXT, ultimo_atendimento_em TIMESTAMPTZ
);
CREATE INDEX jobs_status_created ON engine_jobs_cliente(status, criado_em, id);
CREATE INDEX jobs_workspace_status_created ON engine_jobs_cliente(cliente_id, status, criado_em, id);
CREATE INDEX events_captured ON engine_eventos_brutos(capturado_em, id);
INSERT INTO engine_operation_state VALUES (1, 'UNIVERSAL', NOW() - INTERVAL '1 day');
`;

const REQUIRED_FIXTURE_COLUMNS = Object.freeze({
  engine_eventos_brutos: ["id", "uuid", "capturado_em", "criado_em", "origem", "origem_tipo", "metadata"],
  engine_jobs_cliente: [
    "id", "uuid", "evento_id", "oferta_id", "cliente_id", "marketplace_detectado", "marketplace",
    "status", "motivo_final", "metadata", "prioridade", "criado_em", "atualizado_em"
  ],
  engine_fairness_origem_fluxo: ["cliente_id", "etapa", "lane", "ultima_origem_atendida", "ultimo_atendimento_em"]
});

function assertFixtureSchemaComplete() {
  for (const [table, columns] of Object.entries(REQUIRED_FIXTURE_COLUMNS)) {
    const tableBlock = DDL.match(new RegExp(`CREATE TABLE ${table} \\(([\\s\\S]*?)\\n\\);`));
    assert(tableBlock, `fixture table missing: ${table}`);
    for (const column of columns) {
      assert(
        new RegExp(`(?:^|\\n|,)\\s*${column}\\s+`, "i").test(tableBlock[1]),
        `fixture column missing: ${table}.${column}`
      );
    }
  }
}

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return Number(sorted[index].toFixed(3));
}

async function timed(fn) {
  const start = process.hrtime.bigint();
  const result = await fn();
  return { result, ms: Number(process.hrtime.bigint() - start) / 1e6 };
}

async function insertArrivals(client, cycle) {
  const marketplaces = ["aliexpress", "mercadolivre", "amazon", "shopee", "magalu", "kabum"];
  for (let workspace = 0; workspace < 8; workspace += 1) {
    const id = 100000 + cycle * 8 + workspace;
    const captured = new Date(Date.now() - 60_000).toISOString();
    await client.query(
      `INSERT INTO engine_eventos_brutos (id, capturado_em, criado_em, metadata)
       VALUES ($1, $2, $2, $3::jsonb)`,
      [id, captured, JSON.stringify({ origemFluxo: "optimus", fixture: "arrival" })]
    );
    await client.query(
      `INSERT INTO engine_jobs_cliente
       (id, evento_id, cliente_id, marketplace_detectado, marketplace, status, prioridade, criado_em, atualizado_em)
       VALUES ($1, $1, $2, $3, $3, 'pendente', 0, $4, $4)`,
      [id, `ws_${workspace + 1}`, marketplaces[(cycle + workspace) % marketplaces.length], captured]
    );
  }
}

async function seed(client) {
  let id = 1;
  const marketplaces = ["aliexpress", "mercadolivre", "amazon", "shopee", "magalu", "kabum"];
  for (let workspace = 0; workspace < 8; workspace += 1) {
    for (let job = 0; job < 30; job += 1) {
      const captured = new Date(Date.now() - (60_000 + job * 1000)).toISOString();
      await client.query(
        `INSERT INTO engine_eventos_brutos (id, capturado_em, criado_em, metadata)
         VALUES ($1, $2, $2, $3::jsonb)`,
        [id, captured, JSON.stringify({ origemFluxo: "optimus", fixture: "fresh" })]
      );
      await client.query(
        `INSERT INTO engine_jobs_cliente
         (id, evento_id, cliente_id, marketplace_detectado, marketplace, status, prioridade, criado_em, atualizado_em)
         VALUES ($1, $1, $2, $3, $3, 'pendente', $4, $5, $5)`,
        [id, `ws_${workspace + 1}`, marketplaces[job % marketplaces.length], job === 0 ? 2 : 0, captured]
      );
      id += 1;
    }
    for (let job = 0; job < 10; job += 1) {
      const captured = new Date(Date.now() - (31 * 60_000 + job * 1000)).toISOString();
      await client.query(
        `INSERT INTO engine_eventos_brutos (id, capturado_em, criado_em, metadata)
         VALUES ($1, $2, $2, $3::jsonb)`,
        [id, captured, JSON.stringify({ origemFluxo: "optimus", fixture: "expired" })]
      );
      await client.query(
        `INSERT INTO engine_jobs_cliente
         (id, evento_id, cliente_id, marketplace_detectado, marketplace, status, criado_em, atualizado_em)
         VALUES ($1, $1, $2, 'aliexpress', 'aliexpress', 'pendente', $3, $4, $4)`,
        [id, `ws_${workspace + 1}`, 0, captured]
      );
      id += 1;
    }
  }
}

async function selection(client, limit = 20) {
  const quotas = calcularCotasFrescorPreImporter(limit);
  const result = await client.query(sqlBuscarJobsPendentes(), [
    quotas.aguaNova, quotas.frescaEmRisco, quotas.frescaCirculavel,
    quotas.limpeza, quotas.totalSelecao
  ]);
  return result.rows;
}

async function targetIds(client) {
  return (await client.query(
    "SELECT id::text FROM engine_jobs_cliente WHERE status = 'pendente' ORDER BY id LIMIT 32"
  )).rows.map(row => row.id);
}

async function diagnostic(client, ids, visibleIds, quota = 4) {
  const absent = ids.filter(id => !visibleIds.has(String(id)));
  if (!absent.length) return { rows: [], ms: 0 };
  const measured = await timed(() => client.query(sqlDiagnosticarAlvosPreImporter(), [absent, quota]));
  return { rows: measured.result.rows, ms: measured.ms };
}

function collectPlanNodes(plan, nodes = []) {
  nodes.push(plan["Node Type"]);
  for (const child of plan.Plans || []) collectPlanNodes(child, nodes);
  return nodes;
}

async function explain(client, ids) {
  const result = await client.query(
    `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sqlDiagnosticarAlvosPreImporter()}`,
    [ids, 4]
  );
  const plan = result.rows[0]["QUERY PLAN"][0];
  return {
    executionMs: plan["Execution Time"],
    planningMs: plan["Planning Time"],
    nodes: [...new Set(collectPlanNodes(plan.Plan))],
    sharedHit: plan.Plan["Shared Hit Blocks"] || 0,
    sharedRead: plan.Plan["Shared Read Blocks"] || 0,
    tempWritten: plan.Plan["Temp Written Blocks"] || 0
  };
}

async function timeoutProof(client) {
  await client.query("BEGIN");
  await client.query("SET LOCAL statement_timeout = '30ms'");
  try {
    await client.query("SELECT pg_sleep(0.2)");
    assert.fail("statement timeout was not enforced");
  } catch (error) {
    assert.equal(error.code, "57014");
  } finally {
    await client.query("ROLLBACK");
  }
}

async function poolWaitProof() {
  const pool = new Pool({ ...config, max: 1 });
  const held = await pool.connect();
  const start = process.hrtime.bigint();
  const pending = pool.connect();
  await new Promise(resolve => setTimeout(resolve, 20));
  const waitingObserved = Number(pool.waitingCount || 0);
  held.release();
  const acquired = await pending;
  acquired.release();
  const waitMs = Number(process.hrtime.bigint() - start) / 1e6;
  await pool.end();
  return { waitingObserved, waitMs: Number(waitMs.toFixed(3)) };
}

(async () => {
  const client = new Client(config);
  try {
    await client.connect();
    const identity = (await client.query(
      "SELECT current_database() AS db, version() AS version, host(inet_server_addr()) AS host, inet_server_port() AS port"
    )).rows[0];
    assert.equal(process.env.CI_POSTGRES_ISOLATED, "1");
    assert.match(String(config.host), /^(127\.0\.0\.1|localhost)$/i);
    assert.match(String(config.database), /^rio_trace(?:_|$)/i);
    assert.equal(identity.db, config.database);
    assert.match(String(identity.version), /^PostgreSQL 16(?:\D|$)/);
    assert.match(String(identity.host || ""), /^(127\.0\.0\.1|::1|10\.|192\.168\.|172\.(?:1[6-9]|2[0-9]|3[0-1])\.)/);
    assert.equal(identity.port, config.port);
    assertFixtureSchemaComplete();
    await client.query(`CREATE SCHEMA ${q(schema)}`);
    await client.query(`SET search_path TO ${q(schema)}, public`);
    await client.query(DDL);
    await seed(client);

    const offMs = [];
    const onMs = [];
    const diagnosticMs = [];
    let selectionIdentical = true;
    const warmup = 4;
    const samples = 20;
    for (let cycle = 0; cycle < warmup + samples; cycle += 1) {
      await insertArrivals(client, cycle);
      const off = await timed(() => selection(client));
      const onSelection = await timed(() => selection(client));
      const offIds = off.result.map(row => `${row.tipo_saida_pre_importer}:${row.id}`);
      const onIds = onSelection.result.map(row => `${row.tipo_saida_pre_importer}:${row.id}`);
      if (offIds.join(",") !== onIds.join(",")) selectionIdentical = false;
      const visible = new Set(onSelection.result.map(row => String(row.id)));
      const targets = await targetIds(client);
      const diag = await diagnostic(client, targets, visible);
      if (cycle >= warmup) {
        offMs.push(off.ms);
        onMs.push(onSelection.ms + diag.ms);
        diagnosticMs.push(diag.ms);
      }
    }
    assert.equal(selectionIdentical, true, "OFF and ON selection diverged");
    const explainResult = await explain(client, (await targetIds(client)).slice(0, 8));
    await timeoutProof(client);
    const poolWait = await poolWaitProof();
    const locks = Number((await client.query(
      "SELECT COUNT(*)::int AS count FROM pg_locks WHERE pid = pg_backend_pid()"
    )).rows[0].count);
    const databaseStats = (await client.query(
      "SELECT xact_commit, blks_hit, blks_read, tup_returned, tup_fetched FROM pg_stat_database WHERE datname = current_database()"
    )).rows[0];
    const cpu = process.cpuUsage();
    const memory = process.memoryUsage();
    console.log("RIO_TELEMETRY_PG_RESULT " + JSON.stringify({
      database: identity.db,
      schema,
      selectionIdentical,
      samples,
      offMs: { p50: percentile(offMs, 50), p95: percentile(offMs, 95), p99: percentile(offMs, 99) },
      onMs: { p50: percentile(onMs, 50), p95: percentile(onMs, 95), p99: percentile(onMs, 99) },
      diagnosticMs: { p50: percentile(diagnosticMs, 50), p95: percentile(diagnosticMs, 95), p99: percentile(diagnosticMs, 99) },
      throughputCyclesPerSecond: {
        off: Number((1000 / (offMs.reduce((sum, value) => sum + value, 0) / offMs.length)).toFixed(3)),
        on: Number((1000 / (onMs.reduce((sum, value) => sum + value, 0) / onMs.length)).toFixed(3))
      },
      explain: explainResult,
      poolWait,
      locks,
      databaseStats,
      runnerCpuUserMs: Math.round(cpu.user / 1000),
      runnerCpuSystemMs: Math.round(cpu.system / 1000),
      runnerHeapUsedMiB: Number((memory.heapUsed / 1024 / 1024).toFixed(2))
    }));
  } finally {
    try { await client.query(`DROP SCHEMA IF EXISTS ${q(schema)} CASCADE`); } catch (_) {}
    await client.end().catch(() => {});
  }
})().catch(error => {
  console.error("RIO_TELEMETRY_PG_FAIL", error.code || error.name, error.message);
  process.exitCode = 1;
});
