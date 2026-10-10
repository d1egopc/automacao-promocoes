"use strict";

// Clean local fixture only. The candidate gate's legacy preflight is replaced
// by an explicit zero-duplicate preflight after fixture reconciliation; this
// is not a production migration or a live-writer cutover procedure.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { reconcileSafeGroups } = require("./universal-flow-legacy-cutover.postgres");

const config = { host: "127.0.0.1", port: 55433, user: "postgres",
  database: "optimus_universal_fixture", connectionTimeoutMillis: 5000 };
const schema = `uf_safe_index_${crypto.randomBytes(6).toString("hex")}`;

async function run() {
  const db = new Client(config);
  const workers = [];
  let installed = false;
  try {
    await db.connect();
    const identity = (await db.query(`SELECT current_database() AS db,
      host(inet_server_addr()) AS host,inet_server_port() AS port,
      current_setting('data_directory') AS data_dir`)).rows[0];
    assert.equal(identity.db, config.database);
    assert.equal(identity.host, config.host);
    assert.equal(identity.port, config.port);
    assert.equal(path.normalize(identity.data_dir).toLowerCase(),
      path.join(__dirname, "..", ".local-postgres", "data").toLowerCase());
    await db.query(`CREATE SCHEMA ${schema}`);
    installed = true;
    await db.query(`SET search_path TO ${schema},public`);
    const engineSql = fs.readFileSync(path.join(__dirname, "..", "modules",
      "engine", "schema.sql"), "utf8");
    await db.query(engineSql);
    await db.query(`CREATE TABLE fixture_checkpoint_refs (job_id bigint NOT NULL);
      CREATE TABLE fixture_viva_refs (job_id bigint NOT NULL);
      CREATE TABLE fixture_history_refs (job_id bigint NOT NULL);
      CREATE TABLE fixture_job_alias (old_job_id bigint PRIMARY KEY,
        canonical_job_id bigint NOT NULL);`);
    const eventIds = [];
    for (let i = 0; i < 2; i++) eventIds.push((await db.query(`INSERT INTO
      engine_eventos_brutos (origem,fonte,origem_tipo)
      VALUES ('radar','radar','whatsapp') RETURNING id`)).rows[0].id);
    await db.query(`INSERT INTO engine_jobs_cliente (evento_id,cliente_id,status)
      VALUES ($1,'ws_a','pendente'),($1,'ws_a','pendente'),
             ($2,'ws_b','diagnosticado'),($2,'ws_b','pendente')`, eventIds);
    const owner = (await db.query(`SELECT id FROM engine_jobs_cliente
      WHERE evento_id=$1 AND cliente_id='ws_b' AND status='diagnosticado'`,
    [eventIds[1]])).rows[0].id;
    await db.query(`INSERT INTO engine_processamentos (job_id,etapa,status)
      VALUES ($1,'diagnostico','concluido')`, [owner]);
    await db.query("BEGIN");
    assert.deepEqual(await reconcileSafeGroups(db),
      ["PRISTINE_NO_REFERENCES", "ONE_PROGRESS_OWNER"]);
    await db.query("COMMIT");
    assert.equal((await db.query(`SELECT count(*)::int AS n
      FROM fixture_job_alias`)).rows[0].n, 2);
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM (
      SELECT evento_id,cliente_id FROM engine_jobs_cliente
      GROUP BY evento_id,cliente_id HAVING count(*)>1) x`)).rows[0].n, 0);

    const sql = fs.readFileSync(path.join(__dirname, "..", "modules", "engine",
      "admission-gate.candidate.sql"), "utf8");
    const preflight = `DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM engine_jobs_cliente
        GROUP BY evento_id,cliente_id HAVING count(*)>1) THEN
        RAISE EXCEPTION 'UF_LEGACY_RECONCILIATION_REQUIRED';
      END IF;
    END $$;`;
    const migrated = sql.replace(/DO \$\$ BEGIN[\s\S]*?END \$\$;/,
      () => preflight);
    assert.notEqual(migrated, sql);
    await db.query(migrated);
    const applied = (await db.query(`SELECT to_regclass(
      'engine_jobs_event_workspace_unique_candidate') AS index_name`)).rows[0].index_name;
    assert(applied);
    await db.query(`INSERT INTO engine_hot_admission_control
      (id,hot_limit,hot_used,health,lifecycle_last_success,lifecycle_max_staleness)
      VALUES (1,3,0,'HEALTHY',now(),interval '5 minutes')`);
    // Fixture-only atomic baseline seed under exclusive lock. The production
    // cutover/backfill protocol remains a separate, unapproved gate.
    await db.query("BEGIN");
    await db.query(`LOCK TABLE engine_jobs_cliente IN ACCESS EXCLUSIVE MODE`);
    await db.query(`ALTER TABLE engine_jobs_cliente
      DISABLE TRIGGER engine_hot_membership_candidate_trigger`);
    await db.query(`ALTER TABLE engine_jobs_cliente
      DISABLE TRIGGER engine_hot_admission_candidate_trigger`);
    await db.query(`UPDATE engine_jobs_cliente SET engine_hot_accounted=true`);
    await db.query(`UPDATE engine_hot_admission_control SET hot_used=2 WHERE id=1`);
    await db.query(`ALTER TABLE engine_jobs_cliente
      ENABLE TRIGGER engine_hot_membership_candidate_trigger`);
    await db.query(`ALTER TABLE engine_jobs_cliente
      ENABLE TRIGGER engine_hot_admission_candidate_trigger`);
    await db.query("COMMIT");
    assert.equal((await db.query(`SELECT hot_used FROM engine_hot_admission_control
      WHERE id=1`)).rows[0].hot_used, 2);

    const eventId = (await db.query(`INSERT INTO engine_eventos_brutos
      (origem,fonte,origem_tipo) VALUES ('radar','radar','whatsapp')
      RETURNING id`)).rows[0].id;
    for (let i = 0; i < 6; i++) {
      const client = new Client({ ...config, options: `-c search_path=${schema},public` });
      await client.connect();
      workers.push(client);
    }
    const fanoutSql = `INSERT INTO engine_jobs_cliente
      (evento_id,cliente_id,status,metadata)
      SELECT $1,'ws_race','pendente','{}'::jsonb
      WHERE NOT EXISTS (SELECT 1 FROM engine_jobs_cliente
        WHERE evento_id=$1 AND cliente_id='ws_race') RETURNING id`;
    const race = await Promise.all(workers.map(client => client.query(fanoutSql,
      [eventId]).then(row => ({ inserted: row.rowCount, code: null }))
      .catch(error => ({ inserted: 0, code: error.code,
        constraint: error.constraint }))));
    assert.equal(race.reduce((n, item) => n + item.inserted, 0), 1);
    assert.equal(race.filter(item => item.code === "23505" &&
      item.constraint === "engine_jobs_event_workspace_unique_candidate").length, 5);
    assert.equal((await db.query(`SELECT hot_used FROM engine_hot_admission_control
      WHERE id=1`)).rows[0].hot_used, 3);
    console.log(JSON.stringify({ candidate: "legacy_safe_index_fixture",
      safeAliases: 2, unresolvedDuplicates: 0, uniqueIndexApplied: true,
      sixConnectionRace: { jobs: 1, conflicts: 5, extraHotSlots: 1 },
      productionMigration: false }));
  } finally {
    await Promise.all(workers.map(client => client.end().catch(() => {})));
    if (installed) await db.query(`DROP SCHEMA ${schema} CASCADE`).catch(() => {});
    await db.end().catch(() => {});
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
