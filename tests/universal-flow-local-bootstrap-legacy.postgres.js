"use strict";

// Three reserved worker connections plus one observer, all in a disposable schema.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Client, Pool } = require("pg");
const { projectionDdl } = require("../modules/engine/lifecycle-steady.candidate");
const { criarBootstrapLocalCandidato } =
  require("../modules/engine/universal-flow-local-bootstrap.candidate");

const config = { host: "127.0.0.1", port: 55433, user: "postgres",
  database: "optimus_universal_fixture", connectionTimeoutMillis: 5000 };
const schema = `uf_boot_legacy_${crypto.randomBytes(6).toString("hex")}`;

async function run() {
  const admin = new Client(config);
  let commercial, steady, legacy, bootstrap, installed = false;
  try {
    await admin.connect();
    const identity = (await admin.query(`SELECT current_database() AS db,
      host(inet_server_addr()) AS host,inet_server_port() AS port,
      current_setting('data_directory') AS data_dir`)).rows[0];
    assert.equal(identity.db, config.database);
    assert.equal(identity.host, config.host);
    assert.equal(identity.port, config.port);
    assert.equal(path.normalize(identity.data_dir).toLowerCase(),
      path.join(__dirname, "..", ".local-postgres", "data").toLowerCase());
    await admin.query(`CREATE SCHEMA ${schema}`);
    installed = true;
    await admin.query(`SET search_path TO ${schema},public`);
    for (const file of ["schema.sql", "admission-gate.candidate.sql"]) {
      await admin.query(fs.readFileSync(path.join(__dirname, "..", "modules",
        "engine", file), "utf8"));
    }
    await admin.query(projectionDdl());
    await admin.query(`INSERT INTO engine_hot_admission_control
      (id,hot_limit,hot_used,health,lifecycle_max_staleness)
      VALUES (1,25,0,'UNKNOWN',interval '1 minute')`);
    // Synthetic segregated legacy reservoir: this proves scheduling and budget,
    // not a migration from the production engine_jobs_cliente table.
    await admin.query(`CREATE TABLE legacy_due_fixture (
      id bigint PRIMARY KEY, cliente_id text NOT NULL,
      status text NOT NULL, due_at timestamptz NOT NULL)`);
    await admin.query(`CREATE INDEX legacy_due_fixture_idx
      ON legacy_due_fixture(due_at,id) WHERE status='pending'`);
    await admin.query(`INSERT INTO legacy_due_fixture
      SELECT g,'ws_'||(g%25),'pending',now()-interval '1 hour'
      FROM generate_series(1,100000) AS g`);
    const opts = { ...config, options: `-c search_path=${schema},public`, max: 1 };
    commercial = new Pool(opts);
    steady = new Pool(opts);
    legacy = new Pool(opts);
    const drain = async ({ limit }) => {
      const client = await legacy.connect();
      let tx = false;
      try {
        await client.query("BEGIN"); tx = true;
        const rows = await client.query(`SELECT id FROM legacy_due_fixture
          WHERE status='pending' AND due_at<=now()
          ORDER BY due_at,id LIMIT $1 FOR UPDATE SKIP LOCKED`, [limit]);
        const ids = rows.rows.map(row => row.id);
        if (ids.length) await client.query(`UPDATE legacy_due_fixture
          SET status='expired' WHERE id=ANY($1::bigint[])`, [ids]);
        await client.query("COMMIT"); tx = false;
        return { ok: true, processed: ids.length };
      } finally {
        if (tx) await client.query("ROLLBACK").catch(() => {});
        client.release();
      }
    };
    const persist = async snapshot => admin.query(`UPDATE engine_hot_admission_control
      SET health=$1,lifecycle_last_success=$2 WHERE id=1`, [
      snapshot.lastSuccess ? "HEALTHY" : "UNKNOWN",
      snapshot.lastSuccess ? new Date(snapshot.lastSuccess) : null]);
    bootstrap = criarBootstrapLocalCandidato({ lifecyclePool: steady,
      lifecycleLimit: 4, lifecycleIntervalMs: 300000,
      replayIntervalMs: 300000, cloneIntervalMs: 300000,
      legacyDrainIntervalMs: 300000, legacyDrainLimit: 100,
      // Scheduling-only fixture: a separate table has no Engine cutover state.
      legacyDrainCompletionRequired: false,
      persistWatchdog: persist, runLegacyDrain: drain });
    const started = await bootstrap.start();
    assert.equal(started.ok, true, JSON.stringify(started));
    assert.equal(started.legacy.processed, 100);
    assert.equal((await admin.query(`SELECT health FROM engine_hot_admission_control`))
      .rows[0].health, "HEALTHY");
    const event = (await admin.query(`INSERT INTO engine_eventos_brutos
      (origem,fonte,origem_tipo,capturado_em)
      VALUES ('radar','radar','whatsapp',now()) RETURNING id`)).rows[0].id;
    await commercial.query(`INSERT INTO engine_jobs_cliente
      (evento_id,cliente_id,status)
      SELECT $1,'fresh_'||g,'pendente' FROM generate_series(1,25) AS g`, [event]);
    const peakHot = (await admin.query(`SELECT hot_used FROM engine_hot_admission_control`))
      .rows[0].hot_used;
    assert.equal(peakHot,25);
    const begin = Date.now();
    const drainProgress = Promise.all(Array.from({ length: 10 }, () =>
      bootstrap.legacyTick()));
    const freshProgress = commercial.query(`UPDATE engine_jobs_cliente
      SET status='oferta_criada' WHERE cliente_id LIKE 'fresh_%'
      RETURNING id`);
    const [batches, fresh] = await Promise.all([drainProgress, freshProgress]);
    assert.equal(fresh.rowCount,25);
    // Coalescing may skip concurrent calls; drain continues via bounded ticks.
    for (let i = 0; i < 9; i++) await bootstrap.legacyTick();
    const counts = (await admin.query(`SELECT
      count(*) FILTER (WHERE status='expired')::int AS drained,
      count(*) FILTER (WHERE status='pending')::int AS remaining
      FROM legacy_due_fixture`)).rows[0];
    assert(counts.drained >= 200 && counts.drained <= 2000);
    assert.equal(counts.drained + counts.remaining,100000);
    assert.equal((await admin.query(`SELECT hot_used FROM engine_hot_admission_control`))
      .rows[0].hot_used,0);
    const steadyPass = await bootstrap.lifecycleTick();
    assert.equal(steadyPass.ok,true);
    assert.equal(steadyPass.selected,0);
    const health = (await admin.query(`SELECT health,lifecycle_last_success,
      EXTRACT(EPOCH FROM (clock_timestamp()-lifecycle_last_success))*1000 AS lag_ms
      FROM engine_hot_admission_control`)).rows[0];
    assert.equal(health.health,"HEALTHY");
    console.log(JSON.stringify({ candidate: "local_bootstrap_legacy_budget",
      initialLegacyDue: 100000, legacyDrained: counts.drained,
      legacyRemaining: counts.remaining, freshAdmitted: 25,
      freshProcessed: fresh.rowCount, peakHot,
      steadyProcessed: steadyPass.terminalizados.length,
      lifecycleLagMs: Math.round(Number(health.lag_ms)),
      commercialBudget: 1, steadyBudget: 1, legacyBudget: 1,
      workerPoolTotal: commercial.totalCount + steady.totalCount + legacy.totalCount,
      observerConnections: 1, elapsedMs: Date.now()-begin,
      productionMigration: false, engineCutoverProven: false }));
    bootstrap.stop();
    bootstrap = criarBootstrapLocalCandidato({ lifecyclePool: steady,
      lifecycleLimit: 4, lifecycleIntervalMs: 300000,
      replayIntervalMs: 300000, cloneIntervalMs: 300000,
      legacyDrainIntervalMs: 300000, legacyDrainLimit: 100,
      persistWatchdog: persist,
      runLegacyDrain: async () => ({ ok: false, processed: 0 }) });
    const failed = await bootstrap.start();
    assert.equal(failed.ok, false);
    assert.equal((await admin.query(`SELECT health FROM engine_hot_admission_control`))
      .rows[0].health, "UNKNOWN");
    console.log(JSON.stringify({ candidate: "legacy_drain_fail_closed",
      startupOk: failed.ok, health: "UNKNOWN" }));
  } finally {
    bootstrap?.stop();
    await commercial?.end().catch(() => {});
    await steady?.end().catch(() => {});
    await legacy?.end().catch(() => {});
    if (installed) await admin.query(`DROP SCHEMA ${schema} CASCADE`).catch(() => {});
    await admin.end().catch(() => {});
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
