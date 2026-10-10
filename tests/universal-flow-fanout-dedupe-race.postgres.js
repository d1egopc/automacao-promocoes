"use strict";

// Diagnostic: the production fan-out SQL uses NOT EXISTS without a unique
// (evento_id,cliente_id) key. This measures its behavior under concurrent
// calls in an isolated local schema; it does not change product SQL.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

const config = { host: "127.0.0.1", port: 55433, user: "postgres",
  database: "optimus_universal_fixture", connectionTimeoutMillis: 5000 };
const schema = `uf_fanout_race_${crypto.randomBytes(6).toString("hex")}`;

async function run() {
  const admin = new Client(config);
  const workers = [];
  let installed = false;
  try {
    await admin.connect();
    const identity = (await admin.query(`SELECT current_database() AS db,
      host(inet_server_addr()) AS host, inet_server_port() AS port,
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
    await admin.query(fs.readFileSync(path.join(__dirname, "..", "modules", "engine", "admission-gate.candidate.sql"), "utf8"));
    await admin.query(`DROP INDEX engine_jobs_event_workspace_unique_candidate`);
    await admin.query(`INSERT INTO engine_hot_admission_control
      (id,hot_limit,hot_used,health,lifecycle_last_success,lifecycle_max_staleness)
      VALUES (1,6,0,'HEALTHY',now(),interval '5 minutes')`);
    const eventId = (await admin.query(`INSERT INTO engine_eventos_brutos
      (origem,fonte,origem_tipo) VALUES ('radar','radar','whatsapp') RETURNING id`)).rows[0].id;
    for (let i = 0; i < 6; i++) {
      const worker = new Client({ ...config, options: `-c search_path=${schema},public` });
      await worker.connect();
      workers.push(worker);
    }
    const sql = `INSERT INTO engine_jobs_cliente
      (evento_id,cliente_id,status,metadata)
      SELECT $1,$2,'pendente','{}'::jsonb
      WHERE NOT EXISTS (
        SELECT 1 FROM engine_jobs_cliente WHERE evento_id=$1 AND cliente_id=$2
      ) RETURNING id`;
    const results = await Promise.all(workers.map(worker =>
      worker.query(sql, [eventId, "ws_same"])));
    const count = (await admin.query(`SELECT count(*)::int AS n
      FROM engine_jobs_cliente WHERE evento_id=$1 AND cliente_id='ws_same'`,
    [eventId])).rows[0].n;
    const used = (await admin.query(`SELECT hot_used FROM engine_hot_admission_control
      WHERE id=1`)).rows[0].hot_used;
    assert.equal(used, count, "admission accounting must not drift");
    assert.equal(results.reduce((sum, result) => sum + result.rowCount, 0), count);
    assert(count > 1, "baseline must reproduce duplicate race");

    await admin.query(`DELETE FROM engine_jobs_cliente WHERE evento_id=$1`, [eventId]);
    await admin.query(`CREATE UNIQUE INDEX engine_jobs_event_workspace_unique_candidate
      ON engine_jobs_cliente (evento_id,cliente_id)`);
    const guardedEventId = (await admin.query(`INSERT INTO engine_eventos_brutos
      (origem,fonte,origem_tipo) VALUES ('radar','radar','whatsapp') RETURNING id`)).rows[0].id;
    const guarded = await Promise.all(workers.map(worker =>
      worker.query(sql, [guardedEventId, "ws_same"])
        .then(result => ({ inserted: result.rowCount, code: null }))
        .catch(error => ({ inserted: 0, code: error.code, constraint: error.constraint }))));
    const guardedCount = (await admin.query(`SELECT count(*)::int AS n
      FROM engine_jobs_cliente WHERE evento_id=$1 AND cliente_id='ws_same'`,
    [guardedEventId])).rows[0].n;
    const guardedUsed = (await admin.query(`SELECT hot_used FROM engine_hot_admission_control
      WHERE id=1`)).rows[0].hot_used;
    assert.equal(guardedCount, 1);
    assert.equal(guardedUsed, 1);
    assert(guarded.every(result => result.inserted === 1 ||
      (result.code === "23505" && result.constraint === "engine_jobs_event_workspace_unique_candidate")));

    const twoEvent = (await admin.query(`INSERT INTO engine_eventos_brutos
      (origem,fonte,origem_tipo) VALUES ('radar','radar','whatsapp') RETURNING id`)).rows[0].id;
    const two = await Promise.all(workers.slice(0, 2).map(worker =>
      worker.query(sql, [twoEvent, "ws_two"])
        .then(result => ({ inserted: result.rowCount, code: null }))
        .catch(error => ({ inserted: 0, code: error.code }))));
    assert.equal(two.reduce((sum, result) => sum + result.inserted, 0), 1);
    assert.equal(two.filter(result => result.code === "23505").length, 1);
    const usedAfterTwo = (await admin.query(`SELECT hot_used FROM engine_hot_admission_control
      WHERE id=1`)).rows[0].hot_used;
    assert.equal(usedAfterTwo, 2);

    const rollbackEvent = (await admin.query(`INSERT INTO engine_eventos_brutos
      (origem,fonte,origem_tipo) VALUES ('radar','radar','whatsapp') RETURNING id`)).rows[0].id;
    await workers[0].query("BEGIN");
    await workers[0].query(sql, [rollbackEvent, "ws_rollback"]);
    await workers[0].query("ROLLBACK");
    assert.equal((await admin.query(`SELECT hot_used FROM engine_hot_admission_control
      WHERE id=1`)).rows[0].hot_used, 2);
    assert.equal((await admin.query(`SELECT count(*)::int AS n FROM engine_jobs_cliente
      WHERE evento_id=$1`, [rollbackEvent])).rows[0].n, 0);

    await workers[0].query("BEGIN");
    await workers[0].query(sql, [rollbackEvent, "ws_later_error"]);
    await assert.rejects(workers[0].query("SELECT 1/0"), error => error.code === "22012");
    await workers[0].query("ROLLBACK");
    assert.equal((await admin.query(`SELECT hot_used FROM engine_hot_admission_control
      WHERE id=1`)).rows[0].hot_used, 2);

    for (let i = 0; i < 10; i++) {
      const replay = await workers[i % workers.length].query(sql, [guardedEventId, "ws_same"]);
      assert.equal(replay.rowCount, 0);
    }
    assert.equal((await admin.query(`SELECT hot_used FROM engine_hot_admission_control
      WHERE id=1`)).rows[0].hot_used, 2);
    console.log(JSON.stringify({ candidate: "fanout_dedupe_race_diagnostic",
      connections: workers.length, withoutUniqueIndex: { jobs: count, hotUsed: used },
      withUniqueIndex: { jobs: guardedCount, hotUsed: guardedUsed,
        conflicts: guarded.filter(result => result.code === "23505").length },
      twoConnectionConflictSafe: true, rollbackReleasesSlot: true,
      laterErrorReleasesSlot: true, tenReplaysCreateNoJob: true }));
  } finally {
    await Promise.all(workers.map(worker => worker.end().catch(() => {})));
    if (installed) await admin.query(`DROP SCHEMA ${schema} CASCADE`).catch(() => {});
    await admin.end().catch(() => {});
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
