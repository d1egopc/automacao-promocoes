"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Client, Pool } = require("pg");
const { projectionDdl, selectorSql, runSteadyLifecycle } =
  require("../modules/engine/lifecycle-steady.candidate");

const config = { host: "127.0.0.1", port: 55433, user: "postgres",
  database: "optimus_universal_fixture", connectionTimeoutMillis: 5000 };
const schema = `uf_lifecycle_focal_${crypto.randomBytes(6).toString("hex")}`;

async function run() {
  const admin = new Client(config);
  let pool;
  let leaseClient;
  let installed = false;
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
    await admin.query(fs.readFileSync(path.join(__dirname, "..", "modules", "engine", "schema.sql"), "utf8"));
    await admin.query(projectionDdl());
    pool = new Pool({ ...config, max: 3, options: `-c search_path=${schema},public` });

    async function event(minutes, origin = "radar") {
      return (await admin.query(`INSERT INTO engine_eventos_brutos
        (origem,fonte,origem_tipo,capturado_em,metadata)
        VALUES ($1,$1,'whatsapp',now()-$2::int*interval '1 minute','{}'::jsonb)
        RETURNING id`, [origin, minutes])).rows[0].id;
    }
    async function job(eventId, workspace, metadata = {}) {
      return (await admin.query(`INSERT INTO engine_jobs_cliente
        (evento_id,cliente_id,status,metadata)
        VALUES ($1,$2,'pendente',$3::jsonb)
        RETURNING id,terminal_due_at`, [eventId, workspace, JSON.stringify(metadata)])).rows[0];
    }

    const dueA = await job(await event(35), "ws_due_a");
    const dueB = await job(await event(15, "clonador_grupos"), "ws_due_b", { cupomTurbo: true });
    const futureA = await job(await event(20), "ws_future_a");
    const futureB = await job(await event(5, "clonador_grupos"), "ws_future_b", { cupomTurbo: true });
    const dueCreated = (await admin.query(`SELECT count(*)::int AS n FROM engine_jobs_cliente
      WHERE terminal_due_at<=now()`)).rows[0].n;
    assert.equal(dueCreated, 2);

    leaseClient = await pool.connect();
    await leaseClient.query("BEGIN");
    assert.equal((await leaseClient.query(`SELECT pg_try_advisory_xact_lock(
      hashtext('engine'),hashtext('steady_lifecycle')) AS acquired`)).rows[0].acquired, true);
    const leased = await runSteadyLifecycle({ pool, limit: 1 });
    assert.equal(leased.ok, true);
    assert.equal(leased.skipped, true);
    await leaseClient.query("ROLLBACK");
    leaseClient.release();
    leaseClient = null;

    const first = await runSteadyLifecycle({ pool, limit: 1 });
    assert.equal(first.ok, true, JSON.stringify(first));
    assert.equal(first.selected, 1);
    assert.equal(first.terminalized.length, 1);

    await admin.query(`UPDATE engine_jobs_cliente SET terminal_due_at=now()-interval '1 day'
      WHERE id=$1`, [futureA.id]);
    const repaired = await runSteadyLifecycle({ pool, limit: 1 });
    assert.equal(repaired.ok, true, JSON.stringify(repaired));
    assert.equal(repaired.terminalized.length, 0);
    assert.deepEqual(repaired.repaired.map(Number), [Number(futureA.id)]);
    assert.equal((await admin.query(`SELECT terminal_due_at>now() AS future
      FROM engine_jobs_cliente WHERE id=$1`, [futureA.id])).rows[0].future, true);

    const finalBatch = await runSteadyLifecycle({ pool, limit: 1 });
    assert.equal(finalBatch.ok, true, JSON.stringify(finalBatch));
    assert.equal(finalBatch.selected, 1);
    assert.equal(finalBatch.terminalized.length, 1);
    const dueProcessed = (await admin.query(`SELECT count(*)::int AS n
      FROM engine_eventos_comerciais WHERE tipo_evento='job_expirada_operacional'`)).rows[0].n;
    assert.equal(dueProcessed, 2);
    const states = (await admin.query(`SELECT id,status FROM engine_jobs_cliente
      WHERE id=ANY($1::bigint[]) ORDER BY id`, [[dueA.id, dueB.id, futureA.id, futureB.id]])).rows;
    assert.equal(states.filter(row => row.status === "expirada_operacional").length, 2);
    assert(states.find(row => String(row.id) === String(futureA.id)).status === "pendente");
    assert(states.find(row => String(row.id) === String(futureB.id)).status === "pendente");
    const wrongProcessed = (await admin.query(`SELECT count(*)::int AS n FROM engine_jobs_cliente
      WHERE id=ANY($1::bigint[]) AND status='expirada_operacional'`, [[futureA.id, futureB.id]])).rows[0].n;
    assert.equal(wrongProcessed, 0);
    const selector = await admin.query(selectorSql(), [1]);
    assert(selector.rowCount <= 1);

    console.log(JSON.stringify({ candidate: "lifecycle_due_focal",
      LIFECYCLE_DUE_CREATED: dueCreated,
      LIFECYCLE_DUE_PROCESSED: dueProcessed,
      LIFECYCLE_FUTURE_PRESERVED: 2,
      LIFECYCLE_WRONG_PROCESSED: wrongProcessed,
      selectorBounded: true,
      canonicalRevalidation: true,
      leaseSingleFlight: true,
      commercialInterference: false }));
  } finally {
    if (leaseClient) {
      await leaseClient.query("ROLLBACK").catch(() => {});
      leaseClient.release();
    }
    if (pool) await pool.end().catch(() => {});
    if (installed) await admin.query(`DROP SCHEMA ${schema} CASCADE`).catch(() => {});
    await admin.end().catch(() => {});
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
