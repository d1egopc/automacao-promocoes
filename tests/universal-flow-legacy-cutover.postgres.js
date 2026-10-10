"use strict";

// Fixture-only rehearsal. External queue/VIVA/history tables here are stand-ins
// for an inventory gate, not proof that production's file references are known.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

const config = { host: "127.0.0.1", port: 55433, user: "postgres",
  database: "optimus_universal_fixture", connectionTimeoutMillis: 5000 };
const schema = `uf_cutover_${crypto.randomBytes(6).toString("hex")}`;
const referenceTables = ["engine_processamentos", "engine_eventos_comerciais",
  "fixture_checkpoint_refs", "fixture_viva_refs", "fixture_history_refs"];

async function inspectGroup(db, eventId, workspace) {
  const rows = (await db.query(`SELECT j.id,j.status,j.tentativas,j.oferta_id,j.metadata,
    (SELECT count(*)::int FROM engine_processamentos p WHERE p.job_id=j.id) AS processamentos,
    (SELECT count(*)::int FROM engine_eventos_comerciais c WHERE c.job_id=j.id) AS comerciais,
    (SELECT count(*)::int FROM fixture_checkpoint_refs x WHERE x.job_id=j.id) AS checkpoint,
    (SELECT count(*)::int FROM fixture_viva_refs x WHERE x.job_id=j.id) AS viva,
    (SELECT count(*)::int FROM fixture_history_refs x WHERE x.job_id=j.id) AS historico
    FROM engine_jobs_cliente j WHERE j.evento_id=$1 AND j.cliente_id=$2
    ORDER BY j.id`, [eventId, workspace])).rows;
  const progressed = row => row.status !== "pendente" || row.tentativas > 0 ||
    row.oferta_id !== null || Object.keys(row.metadata || {}).length > 0 ||
    row.processamentos > 0 || row.comerciais > 0 || row.checkpoint > 0 ||
    row.viva > 0 || row.historico > 0;
  const owners = rows.filter(progressed);
  if (owners.length === 0) return { kind: "PRISTINE_NO_REFERENCES",
    canonical: rows[0].id, duplicates: rows.slice(1).map(row => row.id), rows };
  if (owners.length === 1 && rows.every(row => row.id === owners[0].id || !progressed(row))) {
    return { kind: "ONE_PROGRESS_OWNER", canonical: owners[0].id,
      duplicates: rows.filter(row => row.id !== owners[0].id).map(row => row.id), rows };
  }
  return { kind: "CONFLICTING_FACTS_UNSAFE", canonical: null,
    duplicates: [], rows };
}

async function reconcileSafeGroups(db, hook = async () => {}) {
  const groups = (await db.query(`SELECT evento_id,cliente_id
    FROM engine_jobs_cliente GROUP BY evento_id,cliente_id HAVING count(*)>1
    ORDER BY evento_id,cliente_id`)).rows;
  const result = [];
  for (const group of groups) {
    const classification = await inspectGroup(db, group.evento_id, group.cliente_id);
    result.push(classification.kind);
    if (classification.kind === "CONFLICTING_FACTS_UNSAFE") continue;
    for (const oldId of classification.duplicates) {
      const removed = await db.query(`DELETE FROM engine_jobs_cliente j
        WHERE j.id=$1 AND j.status='pendente' AND j.tentativas=0
          AND j.oferta_id IS NULL AND j.metadata='{}'::jsonb
          AND NOT EXISTS (SELECT 1 FROM engine_processamentos x WHERE x.job_id=j.id)
          AND NOT EXISTS (SELECT 1 FROM engine_eventos_comerciais x WHERE x.job_id=j.id)
          AND NOT EXISTS (SELECT 1 FROM fixture_checkpoint_refs x WHERE x.job_id=j.id)
          AND NOT EXISTS (SELECT 1 FROM fixture_viva_refs x WHERE x.job_id=j.id)
          AND NOT EXISTS (SELECT 1 FROM fixture_history_refs x WHERE x.job_id=j.id)
        RETURNING id`, [oldId]);
      if (removed.rowCount !== 1) throw new Error("cutover_reference_changed");
      await db.query(`INSERT INTO fixture_job_alias (old_job_id,canonical_job_id)
        VALUES ($1,$2) ON CONFLICT (old_job_id) DO NOTHING`,
      [oldId, classification.canonical]);
      await hook({ oldId, canonical: classification.canonical });
    }
  }
  return result;
}

async function run() {
  const db = new Client(config);
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
    await db.query(fs.readFileSync(path.join(__dirname, "..", "modules",
      "engine", "schema.sql"), "utf8"));
    await db.query(`CREATE TABLE fixture_checkpoint_refs (job_id bigint NOT NULL);
      CREATE TABLE fixture_viva_refs (job_id bigint NOT NULL);
      CREATE TABLE fixture_history_refs (job_id bigint NOT NULL);
      CREATE TABLE fixture_job_alias (old_job_id bigint PRIMARY KEY,
        canonical_job_id bigint NOT NULL);`);
    const eventIds = [];
    for (let i = 0; i < 4; i++) eventIds.push((await db.query(`INSERT INTO
      engine_eventos_brutos (origem,fonte,origem_tipo)
      VALUES ('radar','radar','whatsapp') RETURNING id`)).rows[0].id);
    const job = async (eventId, status = "pendente") => (await db.query(`INSERT INTO
      engine_jobs_cliente (evento_id,cliente_id,status)
      VALUES ($1,'ws_a',$2) RETURNING id`, [eventId,status])).rows[0].id;
    const pristineA = await job(eventIds[0]);
    const pristineB = await job(eventIds[0]);
    const owner = await job(eventIds[1], "diagnosticado");
    const ownerDuplicate = await job(eventIds[1]);
    await db.query(`INSERT INTO engine_processamentos (job_id,etapa,status)
      VALUES ($1,'diagnostico','concluido')`, [owner]);
    const conflictA = await job(eventIds[2], "diagnosticado");
    const conflictB = await job(eventIds[2], "oferta_criada");
    await db.query(`INSERT INTO engine_processamentos (job_id,etapa,status)
      VALUES ($1,'diagnostico','concluido')`, [conflictA]);
    await db.query(`INSERT INTO engine_eventos_comerciais
      (tipo_evento,cliente_id,workspace_id,job_id,chave_idempotencia)
      VALUES ('oferta_criada','ws_a','ws_a',$1,'fixture_conflict')`, [conflictB]);
    const externalA = await job(eventIds[3]);
    const externalB = await job(eventIds[3]);
    for (const table of ["fixture_checkpoint_refs", "fixture_viva_refs", "fixture_history_refs"]) {
      await db.query(`INSERT INTO ${table} VALUES ($1)`, [externalB]);
    }
    const before = (await db.query(`SELECT count(*)::int AS n FROM engine_jobs_cliente`)).rows[0].n;
    const groupsBefore = [];
    for (const eventId of eventIds) groupsBefore.push(
      (await inspectGroup(db,eventId,"ws_a")).kind);
    assert.deepEqual(groupsBefore, ["PRISTINE_NO_REFERENCES","ONE_PROGRESS_OWNER",
      "CONFLICTING_FACTS_UNSAFE","ONE_PROGRESS_OWNER"]);

    await db.query("BEGIN");
    await assert.rejects(reconcileSafeGroups(db, async () => {
      throw new Error("simulated_cutover_crash");
    }), /simulated_cutover_crash/);
    await db.query("ROLLBACK");
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM engine_jobs_cliente`)).rows[0].n,
      before);
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM fixture_job_alias`)).rows[0].n,
      0);

    // The only referenced row in this fixture is the preserved owner. This
    // proves the local rollback/idempotency mechanism, not the completeness of
    // a real external-reference inventory.
    await db.query("BEGIN");
    const classified = await reconcileSafeGroups(db);
    await db.query("COMMIT");
    assert.deepEqual(classified, groupsBefore);
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM fixture_job_alias`)).rows[0].n,
      3);
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM engine_jobs_cliente`)).rows[0].n,
      before - 3);
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM fixture_checkpoint_refs
      WHERE job_id=$1`, [externalB])).rows[0].n, 1);
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM fixture_viva_refs
      WHERE job_id=$1`, [externalB])).rows[0].n, 1);
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM fixture_history_refs
      WHERE job_id=$1`, [externalB])).rows[0].n, 1);
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM engine_processamentos
      WHERE job_id=$1`, [owner])).rows[0].n, 1);
    await db.query("BEGIN");
    assert.deepEqual(await reconcileSafeGroups(db), ["CONFLICTING_FACTS_UNSAFE"]);
    await db.query("COMMIT");
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM fixture_job_alias`)).rows[0].n,
      3);
    const unresolved = (await db.query(`SELECT count(*)::int AS n FROM (
      SELECT evento_id,cliente_id FROM engine_jobs_cliente
      GROUP BY evento_id,cliente_id HAVING count(*)>1) x`)).rows[0].n;
    assert.equal(unresolved, 1);
    await assert.rejects(db.query(`CREATE UNIQUE INDEX fixture_unique_event_workspace
      ON engine_jobs_cliente(evento_id,cliente_id)`), error => error.code === "23505");
    console.log(JSON.stringify({ candidate: "legacy_cutover_partial_fixture",
      classified: groupsBefore, aliasesCreated: 3, unsafeGroupsUnresolved: unresolved,
      rollbackPreservesFacts: true, rerunIdempotent: true,
      ownerReferencesPreserved: true, uniqueIndexApplied: false,
      referenceTables }));
  } finally {
    if (installed) await db.query(`DROP SCHEMA ${schema} CASCADE`).catch(() => {});
    await db.end().catch(() => {});
  }
}

module.exports = { inspectGroup, reconcileSafeGroups };
if (require.main === module) {
  run().catch(error => { console.error(error); process.exitCode = 1; });
}
