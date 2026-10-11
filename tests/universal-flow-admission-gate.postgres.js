"use strict";

// Candidate proof only. Creates and removes its own schema in the disposable
// PostgreSQL fixture; it does not install a product migration.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const path = require("node:path");
const { Client } = require("pg");

const config = {
  host: "127.0.0.1",
  port: 55433,
  user: "postgres",
  database: "optimus_universal_fixture",
  connectionTimeoutMillis: 5000
};
const schema = `uf_gate_${crypto.randomBytes(6).toString("hex")}`;
const hotStatuses = [
  "pendente", "diagnosticado", "validando", "pronto", "pronto_para_importar",
  "processando", "importando", "distribuindo", "executando", "retry",
  "agendado", "claimed", "bloqueado", "pronto_sem_utilidade"
];

async function connect() {
  const client = new Client(config);
  await client.connect();
  return client;
}

async function verifyDisposable(client) {
  const result = await client.query(`SELECT current_database() AS db,
    host(inet_server_addr()) AS host, inet_server_port() AS port,
    current_setting('data_directory') AS data_dir`);
  const identity = result.rows[0];
  assert.equal(identity.db, config.database);
  assert.equal(identity.host, config.host);
  assert.equal(identity.port, config.port);
  assert.equal(path.normalize(identity.data_dir).toLowerCase(),
    path.join(__dirname, "..", ".local-postgres", "data").toLowerCase());
}

async function installCandidate(client) {
  await client.query(`CREATE SCHEMA ${schema}`);
  await client.query(`CREATE TABLE ${schema}.control (
    id integer PRIMARY KEY CHECK (id = 1),
    hot_used integer NOT NULL DEFAULT 0 CHECK (hot_used >= 0),
    hot_limit integer NOT NULL CHECK (hot_limit > 0),
    health text NOT NULL CHECK (health IN ('HEALTHY','PRESSURED','CRITICAL','UNKNOWN')),
    lifecycle_last_success timestamptz,
    lifecycle_max_staleness interval NOT NULL
  )`);
  await client.query(`INSERT INTO ${schema}.control
    (id,hot_limit,health,lifecycle_last_success,lifecycle_max_staleness)
    VALUES (1,1,'HEALTHY',now(),interval '1 minute')`);
  await client.query(`CREATE TABLE ${schema}.jobs (
    id bigint PRIMARY KEY,
    workspace text NOT NULL,
    origin text NOT NULL,
    status text NOT NULL,
    manual boolean NOT NULL DEFAULT false,
    captured_at timestamptz NOT NULL,
    expires_at timestamptz,
    retry_ready_at timestamptz
  )`);
  await client.query(`CREATE FUNCTION ${schema}.account_hot_change()
    RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE old_hot boolean := false;
    DECLARE new_hot boolean := false;
    BEGIN
      IF TG_OP <> 'INSERT' THEN
        old_hot := NOT OLD.manual AND OLD.status = ANY(ARRAY[${hotStatuses.map(s => `'${s}'`).join(",")}]);
      END IF;
      IF TG_OP <> 'DELETE' THEN
        new_hot := NOT NEW.manual AND NEW.status = ANY(ARRAY[${hotStatuses.map(s => `'${s}'`).join(",")}]);
      END IF;
      IF new_hot AND NOT old_hot THEN
        UPDATE ${schema}.control SET hot_used = hot_used + 1
          WHERE id = 1 AND health IN ('HEALTHY','PRESSURED')
            AND lifecycle_last_success >= clock_timestamp() - lifecycle_max_staleness
            AND hot_used < hot_limit;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'UF_HOT_ADMISSION_DENIED' USING ERRCODE = 'P0001';
        END IF;
      ELSIF old_hot AND NOT new_hot THEN
        UPDATE ${schema}.control SET hot_used = hot_used - 1
          WHERE id = 1 AND hot_used > 0;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'UF_HOT_ACCOUNTING_DRIFT' USING ERRCODE = 'P0001';
        END IF;
      END IF;
      RETURN NULL;
    END $$`);
  // AFTER does not fire for INSERT ... ON CONFLICT DO NOTHING. Counter and job
  // mutation commit or roll back together, including a rejected admission.
  await client.query(`CREATE TRIGGER account_hot_change
    AFTER INSERT OR UPDATE OR DELETE ON ${schema}.jobs
    FOR EACH ROW EXECUTE FUNCTION ${schema}.account_hot_change()`);
}

async function state(client) {
  const result = await client.query(`SELECT c.hot_used, c.hot_limit, c.health,
    (SELECT count(*)::int FROM ${schema}.jobs j WHERE NOT j.manual
      AND j.status = ANY($1::text[])) AS actual_hot
    FROM ${schema}.control c WHERE c.id=1`, [hotStatuses]);
  assert.equal(result.rows[0].hot_used, result.rows[0].actual_hot);
  return result.rows[0];
}

async function attempt(client, id, origin = "radar") {
  try {
    await client.query(`INSERT INTO ${schema}.jobs
      (id,workspace,origin,status,captured_at,expires_at)
      VALUES ($1,$2,$3,'pendente',now()-interval '40 minutes',now()-interval '10 minutes')`,
    [id, `ws_${id % 3}`, origin]);
    return true;
  } catch (error) {
    assert.match(error.message, /UF_HOT_ADMISSION_DENIED/);
    return false;
  }
}

async function run() {
  const admin = await connect();
  const workers = [];
  let installed = false;
  try {
    await verifyDisposable(admin);
    await installCandidate(admin);
    installed = true;
    for (let i = 0; i < 8; i++) workers.push(await connect());

    const two = await Promise.all([
      attempt(workers[0], 1, "radar"),
      attempt(workers[1], 2, "clonador_grupos")
    ]);
    assert.equal(two.filter(Boolean).length, 1);
    assert.equal((await state(admin)).hot_used, 1);

    const winner = (await admin.query(`SELECT id FROM ${schema}.jobs`)).rows[0].id;
    await admin.query(`INSERT INTO ${schema}.jobs
      (id,workspace,origin,status,captured_at) VALUES ($1,'ws_1','radar','pendente',now())
      ON CONFLICT (id) DO NOTHING`, [winner]);
    assert.equal((await state(admin)).hot_used, 1);

    await admin.query(`UPDATE ${schema}.control SET health='UNKNOWN', hot_limit=4`);
    assert.equal(await attempt(workers[0], 3), false);
    await admin.query(`UPDATE ${schema}.jobs SET status='expirada_operacional' WHERE id=$1`, [winner]);
    assert.equal((await state(admin)).hot_used, 0);
    await admin.query(`UPDATE ${schema}.control SET health='HEALTHY'`);

    const many = await Promise.all(workers.map((client, i) =>
      attempt(client, 10 + i, i % 2 ? "clonador_grupos" : "radar")));
    assert.equal(many.filter(Boolean).length, 4);
    assert.equal((await state(admin)).hot_used, 4);

    const admittedIds = (await admin.query(`SELECT id FROM ${schema}.jobs
      WHERE status='pendente' AND NOT manual ORDER BY id`)).rows.map(row => row.id);
    await workers[0].query("BEGIN");
    await workers[0].query(`UPDATE ${schema}.jobs SET status='expirada_operacional'
      WHERE id=$1`, [admittedIds[0]]);
    assert.equal((await state(workers[0])).hot_used, 3);
    await workers[0].query("ROLLBACK");
    assert.equal((await state(admin)).hot_used, 4);

    await assert.rejects(admin.query(`UPDATE ${schema}.jobs
      SET status='pendente' WHERE id=$1`, [winner]), /UF_HOT_ADMISSION_DENIED/);
    assert.equal((await state(admin)).hot_used, 4);

    await admin.query(`INSERT INTO ${schema}.jobs
      (id,workspace,origin,status,manual,captured_at)
      VALUES (100,'ws_manual','manual','pendente',true,now()-interval '2 days')`);
    assert.equal((await state(admin)).hot_used, 4);
    await admin.query(`UPDATE ${schema}.jobs SET retry_ready_at=now()+interval '1 day'
      WHERE id=$1`, [admittedIds[0]]);
    const due = await admin.query(`SELECT count(*)::int AS n FROM ${schema}.jobs
      WHERE NOT manual AND status = ANY($1::text[])
        AND expires_at <= now()
        AND (retry_ready_at IS NULL OR retry_ready_at <= now())`, [hotStatuses]);
    assert.equal(due.rows[0].n, 3);

    await admin.query(`UPDATE ${schema}.control SET health='CRITICAL'`);
    assert.equal(await attempt(workers[0], 200), false);
    await admin.query(`UPDATE ${schema}.jobs SET status='expirada_operacional'
      WHERE id=$1`, [admittedIds[1]]);
    await admin.query(`UPDATE ${schema}.control
      SET health='HEALTHY', lifecycle_last_success=now()-interval '1 day'`);
    assert.equal(await attempt(workers[0], 201), false);
    const afterFailure = await state(admin);
    assert.equal(afterFailure.hot_used, 3);

    await admin.query(`UPDATE ${schema}.control
      SET health='HEALTHY', lifecycle_last_success=now()`);
    for (const status of hotStatuses) {
      await admin.query(`UPDATE ${schema}.jobs SET status=$2 WHERE id=$1`, [winner, status]);
      assert.equal((await state(admin)).hot_used, 4, status);
      await admin.query(`UPDATE ${schema}.jobs SET status='expirada_operacional'
        WHERE id=$1`, [winner]);
      assert.equal((await state(admin)).hot_used, 3, status);
    }

    console.log(JSON.stringify({
      candidate: "db_after_trigger_atomic_headroom",
      twoConnections: two.filter(Boolean).length,
      eightConnections: many.filter(Boolean).length,
      limit: 4,
      maxHotObserved: 4,
      finalHot: afterFailure.hot_used,
      dueLive: due.rows[0].n,
      duplicateCounterDrift: false,
      unknownDenied: true,
      criticalDenied: true,
      staleLifecycleDeniedWithHeadroom: true,
      rollbackToHotDeniedAtCap: true,
      transactionRollbackCounterSafe: true,
      futureRetryNotDue: true,
      testedHotStatuses: hotStatuses.length,
      manualNotAutoExpired: true
    }));
  } finally {
    await Promise.all(workers.map(client => client.end().catch(() => {})));
    if (installed) await admin.query(`DROP SCHEMA ${schema} CASCADE`).catch(() => {});
    await admin.end().catch(() => {});
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
