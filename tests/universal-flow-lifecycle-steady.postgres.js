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
const schema = `uf_steady_${crypto.randomBytes(6).toString("hex")}`;

function planMetrics(plan) {
  const scans = [];
  const walk = node => {
    if (/Scan$/.test(node["Node Type"])) scans.push({
      type: node["Node Type"], index: node["Index Name"] || null,
      rows: node["Actual Rows"], loops: node["Actual Loops"],
      removed: node["Rows Removed by Filter"] || 0 });
    for (const child of node.Plans || []) walk(child);
  };
  walk(plan.Plan);
  return { actualRows: plan.Plan["Actual Rows"], scans,
    sharedHit: plan.Plan["Shared Hit Blocks"] || 0,
    sharedRead: plan.Plan["Shared Read Blocks"] || 0,
    tempRead: plan.Plan["Temp Read Blocks"] || 0,
    tempWritten: plan.Plan["Temp Written Blocks"] || 0,
    planningMs: plan["Planning Time"], executionMs: plan["Execution Time"] };
}

async function run() {
  const admin = new Client(config);
  let pool;
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
    await admin.query(fs.readFileSync(path.join(__dirname, "..", "modules",
      "engine", "schema.sql"), "utf8"));
    await admin.query(projectionDdl());
    pool = new Pool({ ...config, max: 1,
      options: `-c search_path=${schema},public` });
    const event = async (minutes, origin = "radar", metadata = {}) =>
      (await admin.query(`INSERT INTO engine_eventos_brutos
        (origem,fonte,origem_tipo,capturado_em,metadata)
        VALUES ($1,$1,'whatsapp',now()-$2::int*interval '1 minute',$3::jsonb)
        RETURNING id`, [origin,minutes,JSON.stringify(metadata)])).rows[0].id;
    const job = async (eventId, workspace, metadata = {}) =>
      (await admin.query(`INSERT INTO engine_jobs_cliente
        (evento_id,cliente_id,status,metadata)
        VALUES ($1,$2,'pendente',$3::jsonb)
        RETURNING id,terminal_due_at`,
      [eventId,workspace,JSON.stringify(metadata)])).rows[0];
    const normal20 = await job(await event(20), "ws_normal20");
    const normal35 = await job(await event(35), "ws_normal35");
    const turbo5 = await job(await event(5), "ws_turbo5", { cupomTurbo: true });
    const turbo15Event = await event(15);
    const turbo15 = await job(turbo15Event, "ws_turbo15");
    // Classification happens after ingress; the job projection shortens the
    // deadline using the ORIGINAL event clock, not classification time.
    await admin.query(`UPDATE engine_jobs_cliente
      SET metadata=jsonb_set(metadata,'{cupomTurbo}','true'::jsonb,true)
      WHERE id=$1`, [turbo15.id]);
    const manual = await job(await event(100, "manual_v2"), "ws_manual");
    const retryFuture = await job(await event(35), "ws_retryfuture",
      { afiliacaoWorkspaceRetry: { proximaTentativaEmMs: Date.now() + 3600000 } });
    const retryDue = await job(await event(35), "ws_retrydue",
      { afiliacaoWorkspaceRetry: { proximaTentativaEmMs: Date.now() - 1000 } });
    const projections = (await admin.query(`SELECT id,cliente_id,terminal_due_at,
      terminal_due_at <= now() AS due FROM engine_jobs_cliente
      ORDER BY id`)).rows;
    const byName = Object.fromEntries(projections.map(row => [row.cliente_id,row]));
    assert.equal(byName.ws_normal20.due,false);
    assert.equal(byName.ws_normal35.due,true);
    assert.equal(byName.ws_turbo5.due,false);
    assert.equal(byName.ws_turbo15.due,true);
    assert.equal(byName.ws_manual.terminal_due_at,null);
    assert.equal(byName.ws_retryfuture.due,false);
    assert.equal(byName.ws_retrydue.due,true);
    await assert.rejects(admin.query(`UPDATE engine_eventos_brutos
      SET capturado_em=now() WHERE id=$1`, [turbo15Event]),
    /UF_CAPTURE_CLOCK_IMMUTABLE/);
    const first = await runSteadyLifecycle({ pool, limit: 10 });
    assert.equal(first.ok,true,JSON.stringify(first));
    assert.equal(first.terminalized.length,3);
    assert.equal((await admin.query(`SELECT count(*)::int AS n FROM engine_eventos_comerciais
      WHERE tipo_evento='job_expirada_operacional'`)).rows[0].n,3);
    assert.equal((await runSteadyLifecycle({ pool,limit: 10 })).terminalized.length,0);

    // Stale projection must be repaired under lock, never terminalized.
    await admin.query(`UPDATE engine_jobs_cliente SET terminal_due_at=now()-interval '1 day'
      WHERE id=$1`, [normal20.id]);
    const repaired = await runSteadyLifecycle({ pool,limit: 1 });
    assert.equal(repaired.terminalized.length,0);
    assert.equal(repaired.repaired.length,1);
    assert.equal((await admin.query(`SELECT terminal_due_at>now() AS future
      FROM engine_jobs_cliente WHERE id=$1`, [normal20.id])).rows[0].future,true);

    const futureEvent = await event(0);
    // This 100k active scenario is intentionally adversarial and exceeds any
    // admission H; it measures only the query plan, not an allowed hot set.
    await admin.query(`INSERT INTO engine_jobs_cliente
      (evento_id,cliente_id,status,metadata)
      SELECT $1,'ws_future_'||g,'pendente','{}'::jsonb
      FROM generate_series(1,100000) AS g`, [futureEvent]);
    const terminalEvent = await event(100);
    await admin.query(`INSERT INTO engine_jobs_cliente
      (evento_id,cliente_id,status,metadata)
      SELECT $1,'ws_terminal_'||g,'expirada_operacional','{}'::jsonb
      FROM generate_series(1,100000) AS g`, [terminalEvent]);
    const dueEvent = await event(35);
    for (let i = 0; i < 100; i++) await job(dueEvent, `ws_due_${i}`);
    await admin.query("VACUUM (ANALYZE) engine_jobs_cliente");
    const measured = [];
    for (const limit of [1,10,50,100]) {
      const plan = (await admin.query(selectorSql({ explain: true }), [limit]))
        .rows[0]["QUERY PLAN"][0];
      const metrics = planMetrics(plan);
      assert.equal(metrics.actualRows,limit);
      assert(metrics.scans.some(scan => scan.index === "engine_terminal_due_candidate_idx"));
      assert(metrics.scans.every(scan => scan.rows * scan.loops <= limit + 8),
        JSON.stringify(metrics));
      assert.equal(metrics.tempRead,0);
      assert.equal(metrics.tempWritten,0);
      measured.push({ limit,...metrics });
    }
    const batch = await runSteadyLifecycle({ pool,limit: 100 });
    assert.equal(batch.ok,true,JSON.stringify(batch));
    assert.equal(batch.terminalized.length,100);
    const zeroPlan = (await admin.query(selectorSql({ explain: true }), [100]))
      .rows[0]["QUERY PLAN"][0];
    const zero = planMetrics(zeroPlan);
    assert.equal(zero.actualRows,0);
    assert(zero.scans.some(scan => scan.index === "engine_terminal_due_candidate_idx"));
    assert(zero.scans.every(scan => scan.rows === 0));
    console.log(JSON.stringify({ candidate: "lifecycle_steady_projection",
      normal20Live: true, normal35Due: true, turbo5Live: true,
      turbo15ClassifiedLaterDue: true, manualNoTtl: true,
      retryFutureNotDue: true, retryPastDue: true,
      captureClockImmutable: true, staleProjectionRepairedUnderLock: true,
      historicalTerminalRows: 100000, adversarialFutureRows: 100000,
      dueRows: 100, plans: measured,zeroDuePlan: zero,
      terminalizedWithFacts: 103 }));
  } finally {
    if (pool) await pool.end().catch(() => {});
    if (installed) await admin.query(`DROP SCHEMA ${schema} CASCADE`).catch(() => {});
    await admin.end().catch(() => {});
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
