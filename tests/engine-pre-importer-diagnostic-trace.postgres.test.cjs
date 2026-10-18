"use strict";

// This test is intentionally opt-in and refuses production-looking connections.
// It runs only against the disposable PostgreSQL service used by CI.
const assert = require("node:assert/strict");
let Client;
let Pool;
const {
  sqlBuscarJobsPendentes,
  sqlDiagnosticarAlvosPreImporter
} = require("../modules/engine/processor.service");
const { calcularCotasFrescorPreImporter } = require("../modules/engine/frescor-pre-importer.service");
const { instalarEstadoIngressReal } = require("../modules/engine/universal-ingress-fence");

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
  id BIGINT PRIMARY KEY, uuid UUID, capturado_em TIMESTAMPTZ NOT NULL, criado_em TIMESTAMPTZ NOT NULL,
  origem TEXT, origem_tipo TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE engine_jobs_cliente (
  id BIGINT PRIMARY KEY, uuid UUID, evento_id BIGINT NOT NULL REFERENCES engine_eventos_brutos(id), oferta_id BIGINT,
  cliente_id TEXT NOT NULL,
  marketplace_detectado TEXT, marketplace TEXT, status TEXT NOT NULL,
  motivo_final TEXT,
  prioridade INTEGER DEFAULT 0, metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  criado_em TIMESTAMPTZ NOT NULL, atualizado_em TIMESTAMPTZ NOT NULL
);
CREATE TABLE engine_fairness_origem_fluxo (
  cliente_id TEXT NOT NULL, etapa TEXT NOT NULL, lane TEXT NOT NULL,
  ultima_origem_atendida TEXT, ultimo_atendimento_em TIMESTAMPTZ,
  PRIMARY KEY (cliente_id, etapa, lane)
);
CREATE INDEX jobs_status ON engine_jobs_cliente(status);
CREATE INDEX jobs_workspace ON engine_jobs_cliente(cliente_id);
CREATE INDEX jobs_workspace_status_created ON engine_jobs_cliente(cliente_id, status, criado_em);
CREATE INDEX jobs_event ON engine_jobs_cliente(evento_id);
CREATE INDEX jobs_priority ON engine_jobs_cliente(prioridade);
CREATE INDEX jobs_created ON engine_jobs_cliente(criado_em);
CREATE INDEX events_captured ON engine_eventos_brutos(capturado_em);
CREATE INDEX events_created ON engine_eventos_brutos(criado_em);
INSERT INTO engine_operation_state VALUES (1, 'UNIVERSAL', NOW() - INTERVAL '1 day');
`;

const REQUIRED_FIXTURE_COLUMNS = Object.freeze({
  engine_operation_state: ["id", "mode", "operation_epoch_started_at"],
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

function assertOperationalSqlCoveredByFixture() {
  const required = new Map(Object.entries(REQUIRED_FIXTURE_COLUMNS)
    .map(([table, columns]) => [table, new Set(columns)]));
  const aliases = { j: "engine_jobs_cliente", e: "engine_eventos_brutos" };
  const sql = `${sqlBuscarJobsPendentes()}\n${sqlDiagnosticarAlvosPreImporter()}`;
  for (const match of sql.matchAll(/\b([je])\.([a-z_][a-z0-9_]*)\b/gi)) {
    const table = aliases[match[1].toLowerCase()];
    assert(required.get(table)?.has(match[2].toLowerCase()),
      `operational SQL column missing from fixture: ${table}.${match[2]}`);
  }
  assert(sql.includes("FROM engine_fairness_origem_fluxo"), "fairness table must be exercised");
  assert(sql.includes("FROM engine_operation_state"), "Universal epoch filter must be exercised");
}

function fixtureInsert(table, row, casts = {}) {
  assert(/^[a-z_][a-z0-9_]*$/i.test(table), "invalid fixture table");
  const allowedColumns = new Set(REQUIRED_FIXTURE_COLUMNS[table] || []);
  assert(allowedColumns.size > 0, `unknown fixture table: ${table}`);
  const entries = Object.entries(row);
  assert(entries.length > 0, "empty fixture insert");
  for (const [column, value] of entries) {
    assert(/^[a-z_][a-z0-9_]*$/i.test(column), `invalid fixture column: ${column}`);
    assert(allowedColumns.has(column), `unknown fixture column: ${table}.${column}`);
    assert.notEqual(value, undefined, `undefined fixture value: ${table}.${column}`);
  }
  for (const column of Object.keys(casts)) {
    assert(allowedColumns.has(column), `cast for unknown fixture column: ${table}.${column}`);
  }
  const columns = entries.map(([column]) => column);
  const values = entries.map(([, value]) => value);
  const placeholders = columns.map((column, index) => `$${index + 1}${casts[column] || ""}`);
  return {
    text: `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders.join(", ")})`,
    values
  };
}

async function insertFixtureRow(client, table, row, casts = {}) {
  const query = fixtureInsert(table, row, casts);
  assert.equal((query.text.match(/\$\d+/g) || []).length, query.values.length,
    `fixture placeholder mismatch: ${table}`);
  return client.query(query.text, query.values);
}

function assertFixtureInsertBuilder() {
  const query = fixtureInsert("engine_jobs_cliente", {
    id: 1, cliente_id: "workspace_fixture", metadata: "{}"
  }, { metadata: "::jsonb" });
  assert.equal(query.text,
    "INSERT INTO engine_jobs_cliente (id, cliente_id, metadata) VALUES ($1, $2, $3::jsonb)");
  assert.deepEqual(query.values, [1, "workspace_fixture", "{}"]);
  assert.throws(() => fixtureInsert("engine_jobs_cliente", {
    id: 1, coluna_inexistente: "erro"
  }), /unknown fixture column/);
}

async function assertFixtureSeedQueries() {
  const queries = [];
  const fakeClient = {
    async query(text, values) {
      queries.push({ text, values });
      return { rows: [], rowCount: 1 };
    }
  };
  const targets = await seed(fakeClient);
  await insertArrivals(fakeClient, 0);
  assert.equal(queries.length, 656, "all seed and continuous-arrival INSERTs must be generated");
  assert.equal(targets.length, 32);
  for (const query of queries) {
    assert.match(query.text, /^INSERT INTO (engine_eventos_brutos|engine_jobs_cliente) /);
    assert.equal((query.text.match(/\$\d+/g) || []).length, query.values.length,
      "generated fixture query must keep columns, placeholders and values aligned");
  }
}

async function runStaticHarnessValidations() {
  instalarEstadoIngressReal({
    mode: "UNIVERSAL",
    operationEpochStartedAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  });
  assertFixtureSchemaComplete();
  assertFixtureInsertBuilder();
  assertOperationalSqlCoveredByFixture();
  await assertFixtureSeedQueries();
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
    const marketplace = marketplaces[(cycle + workspace) % marketplaces.length];
    await insertFixtureRow(client, "engine_eventos_brutos", {
      id, capturado_em: captured, criado_em: captured, origem: "radar", origem_tipo: "whatsapp",
      metadata: JSON.stringify({ origemFluxo: "optimus", fixture: "arrival" })
    }, { metadata: "::jsonb" });
    await insertFixtureRow(client, "engine_jobs_cliente", {
      id, evento_id: id, cliente_id: `ws_${workspace + 1}`,
      marketplace_detectado: marketplace, marketplace, status: "pendente", prioridade: 0,
      criado_em: captured, atualizado_em: captured
    });
  }
}

async function seed(client) {
  let id = 1;
  const targetIds = [];
  const marketplaces = ["aliexpress", "mercadolivre", "amazon", "shopee", "magalu", "kabum"];
  for (let workspace = 0; workspace < 8; workspace += 1) {
    for (let job = 0; job < 30; job += 1) {
      const captured = new Date(Date.now() - (60_000 + job * 1000)).toISOString();
      const marketplace = marketplaces[job % marketplaces.length];
      await insertFixtureRow(client, "engine_eventos_brutos", {
        id, capturado_em: captured, criado_em: captured, origem: "radar", origem_tipo: "whatsapp",
        metadata: JSON.stringify({ origemFluxo: "optimus", fixture: "fresh" })
      }, { metadata: "::jsonb" });
      await insertFixtureRow(client, "engine_jobs_cliente", {
        id, evento_id: id, cliente_id: `ws_${workspace + 1}`,
        marketplace_detectado: marketplace, marketplace, status: "pendente",
        prioridade: job === 0 ? 2 : 0, criado_em: captured, atualizado_em: captured
      });
      if (job >= 9 && job <= 12) targetIds.push(String(id));
      id += 1;
    }
    for (let job = 0; job < 10; job += 1) {
      const captured = new Date(Date.now() - (31 * 60_000 + job * 1000)).toISOString();
      await insertFixtureRow(client, "engine_eventos_brutos", {
        id, capturado_em: captured, criado_em: captured, origem: "radar", origem_tipo: "whatsapp",
        metadata: JSON.stringify({ origemFluxo: "optimus", fixture: "expired" })
      }, { metadata: "::jsonb" });
      await insertFixtureRow(client, "engine_jobs_cliente", {
        id, evento_id: id, cliente_id: `ws_${workspace + 1}`,
        marketplace_detectado: "aliexpress", marketplace: "aliexpress", status: "pendente",
        prioridade: 0, criado_em: captured, atualizado_em: captured
      });
      id += 1;
    }
  }
  assert.equal(targetIds.length, 32, "fixture must provide exactly 32 diagnostic targets");
  return targetIds;
}

async function selection(client, limit = 20) {
  const quotas = calcularCotasFrescorPreImporter(limit);
  const result = await client.query(sqlBuscarJobsPendentes(), [
    quotas.aguaNova, quotas.frescaEmRisco, quotas.frescaCirculavel,
    quotas.limpeza, quotas.totalSelecao
  ]);
  return result.rows;
}

async function assertTargetCoverage(client, ids) {
  const result = await client.query(
    `SELECT COUNT(DISTINCT cliente_id)::int AS workspaces,
            COUNT(DISTINCT marketplace)::int AS marketplaces
       FROM engine_jobs_cliente
      WHERE id = ANY($1::bigint[])`, [ids]
  );
  assert.equal(result.rows[0].workspaces, 8, "targets must cover eight workspaces");
  assert(result.rows[0].marketplaces >= 4, "targets must cover at least four marketplaces");
}

async function diagnostic(client, ids, visibleIds, quota = 4) {
  const absent = ids.filter(id => !visibleIds.has(String(id)));
  assert(absent.length > 0, "fixture must exercise the diagnostic SQL");
  const measured = await timed(() => client.query(sqlDiagnosticarAlvosPreImporter(), [absent, quota]));
  assert.equal(measured.result.rows.length, absent.length,
    "diagnostic SQL must classify every absent target");
  return { rows: measured.result.rows, ms: measured.ms, targetCount: absent.length, executed: true };
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
  assert.equal(waitingObserved, 1, "node-postgres pool must expose the queued acquisition");
  assert(waitMs >= 15, "queued acquisition must have a measurable wait");
  return {
    source: "node_pg_pool_synthetic_contention",
    waitingObserved,
    waitMs: Number(waitMs.toFixed(3))
  };
}

(async () => {
  await runStaticHarnessValidations();
  if (process.env.CI_POSTGRES_STATIC_ONLY === "1") {
    console.log("OK engine-pre-importer-diagnostic-trace postgres static harness");
    return;
  }
  ({ Client, Pool } = require("pg"));
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
    await client.query(`CREATE SCHEMA ${q(schema)}`);
    await client.query(`SET search_path TO ${q(schema)}, public`);
    await client.query(DDL);
    const targets = await seed(client);
    await assertTargetCoverage(client, targets);

    const offMs = [];
    const onMs = [];
    const diagnosticMs = [];
    const diagnosticTargetCounts = [];
    let selectionIdentical = true;
    let lastDiagnosticIds = [];
    const warmup = 10;
    const samples = 100;
    for (let cycle = 0; cycle < warmup + samples; cycle += 1) {
      await insertArrivals(client, cycle);
      const runOff = () => timed(() => selection(client));
      const runOn = async () => {
        const selected = await timed(() => selection(client));
        const visible = new Set(selected.result.map(row => String(row.id)));
        const diag = await diagnostic(client, targets, visible);
        lastDiagnosticIds = targets.filter(id => !visible.has(String(id)));
        return {
          result: selected.result,
          selectionMs: selected.ms,
          diagnosticMs: diag.ms,
          diagnosticTargetCount: diag.targetCount,
          totalMs: selected.ms + diag.ms
        };
      };
      let off;
      let on;
      if (cycle % 2 === 0) {
        off = await runOff();
        on = await runOn();
      } else {
        on = await runOn();
        off = await runOff();
      }
      const onSelection = { result: on.result };
      const offIds = off.result.map(row => `${row.tipo_saida_pre_importer}:${row.id}`);
      const onIds = onSelection.result.map(row => `${row.tipo_saida_pre_importer}:${row.id}`);
      if (offIds.join(",") !== onIds.join(",")) selectionIdentical = false;
      if (cycle >= warmup) {
        offMs.push(off.ms);
        onMs.push(on.totalMs);
        diagnosticMs.push(on.diagnosticMs);
        diagnosticTargetCounts.push(on.diagnosticTargetCount);
      }
    }
    assert.equal(selectionIdentical, true, "OFF and ON selection diverged");
    assert.equal(offMs.length, samples);
    assert.equal(onMs.length, samples);
    assert.equal(diagnosticMs.length, samples);
    assert(diagnosticMs.every(value => Number.isFinite(value) && value >= 0));
    assert(diagnosticTargetCounts.every(value => Number.isInteger(value) && value > 0),
      "every ON sample must execute diagnostic SQL for at least one target");
    assert(percentile(diagnosticMs, 95) < 750,
      "diagnostic SQL p95 must remain below its operational 750ms statement timeout");
    assert(lastDiagnosticIds.length > 0, "EXPLAIN requires actual absent targets");
    const explainResult = await explain(client, lastDiagnosticIds.slice(0, 8));
    assert(explainResult.nodes.includes("WindowAgg"), "diagnostic plan must execute its ranking window");
    await timeoutProof(client);
    const poolWait = await poolWaitProof();
    const lockSnapshot = (await client.query(
      `SELECT COUNT(*) FILTER (WHERE granted)::int AS granted,
              COUNT(*) FILTER (WHERE NOT granted)::int AS waiting
         FROM pg_locks WHERE pid = pg_backend_pid()`
    )).rows[0];
    assert.equal(lockSnapshot.waiting, 0, "benchmark connection must not remain waiting on a lock");
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
      metricSources: {
        offOnDiagnosticLatency: "node_client_observed_postgresql_round_trip",
        explainAndDatabaseStats: "postgresql_server",
        poolWait: "node_pg_pool_synthetic_contention",
        cpuMemory: "node_runner_process_not_postgresql_server"
      },
      targetCoverage: {
        targetCount: targets.length,
        diagnosticTargetsMin: Math.min(...diagnosticTargetCounts),
        diagnosticTargetsMax: Math.max(...diagnosticTargetCounts)
      },
      offMs: { p50: percentile(offMs, 50), p95: percentile(offMs, 95), p99: percentile(offMs, 99) },
      onMs: { p50: percentile(onMs, 50), p95: percentile(onMs, 95), p99: percentile(onMs, 99) },
      diagnosticMs: { p50: percentile(diagnosticMs, 50), p95: percentile(diagnosticMs, 95), p99: percentile(diagnosticMs, 99) },
      overheadMs: {
        p50: Number((percentile(onMs, 50) - percentile(offMs, 50)).toFixed(3)),
        p95: Number((percentile(onMs, 95) - percentile(offMs, 95)).toFixed(3)),
        p99: Number((percentile(onMs, 99) - percentile(offMs, 99)).toFixed(3))
      },
      throughputCyclesPerSecond: {
        off: Number((1000 / (offMs.reduce((sum, value) => sum + value, 0) / offMs.length)).toFixed(3)),
        on: Number((1000 / (onMs.reduce((sum, value) => sum + value, 0) / onMs.length)).toFixed(3))
      },
      explain: explainResult,
      poolWait,
      lockSnapshot: {
        source: "postgresql_pg_locks_point_in_time",
        granted: Number(lockSnapshot.granted),
        waiting: Number(lockSnapshot.waiting)
      },
      databaseStats,
      nodeRunnerProcess: {
        cpuUserMs: Math.round(cpu.user / 1000),
        cpuSystemMs: Math.round(cpu.system / 1000),
        heapUsedMiB: Number((memory.heapUsed / 1024 / 1024).toFixed(2))
      },
      postgresCpuMemory: "not_measured"
    }));
  } finally {
    try { await client.query(`DROP SCHEMA IF EXISTS ${q(schema)} CASCADE`); } catch (_) {}
    await client.end().catch(() => {});
  }
})().catch(error => {
  console.error("RIO_TELEMETRY_PG_FAIL", error.code || error.name, error.message);
  process.exitCode = 1;
});
