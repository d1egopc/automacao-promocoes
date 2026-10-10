"use strict";

// Read-only classification after fixture setup. No duplicate is deleted or
// remapped. Real queue/history references remain outside this fixture.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

const config = { host: "127.0.0.1", port: 55433, user: "postgres",
  database: "optimus_universal_fixture", connectionTimeoutMillis: 5000 };
const schema = `uf_legacy_dup_${crypto.randomBytes(6).toString("hex")}`;

function classify(rows) {
  const progressed = rows.filter(row => row.status !== "pendente" ||
    row.tentativas > 0 || row.oferta_id !== null || row.processamentos > 0 ||
    row.comerciais > 0 || Object.keys(row.metadata || {}).length > 0);
  const pristine = rows.filter(row => !progressed.includes(row));
  if (pristine.length === rows.length) {
    return { category: "PRISTINE_NO_REFERENCES", canonicalJobId: Math.min(...rows.map(row => row.id)),
      safeToDeleteNow: false };
  }
  if (progressed.length === 1 && pristine.length === rows.length - 1) {
    return { category: "ONE_PROGRESS_OWNER", canonicalJobId: progressed[0].id,
      safeToDeleteNow: false };
  }
  return { category: "CONFLICTING_FACTS_UNSAFE", canonicalJobId: null,
    safeToDeleteNow: false };
}

async function run() {
  const db = new Client(config);
  let installed = false;
  try {
    await db.connect();
    const identity = (await db.query(`SELECT current_database() AS db,
      host(inet_server_addr()) AS host, inet_server_port() AS port,
      current_setting('data_directory') AS data_dir`)).rows[0];
    assert.equal(identity.db, config.database);
    assert.equal(identity.host, config.host);
    assert.equal(identity.port, config.port);
    assert.equal(path.normalize(identity.data_dir).toLowerCase(),
      path.join(__dirname, "..", ".local-postgres", "data").toLowerCase());
    await db.query(`CREATE SCHEMA ${schema}`);
    installed = true;
    await db.query(`SET search_path TO ${schema},public`);
    await db.query(fs.readFileSync(path.join(__dirname, "..", "modules", "engine", "schema.sql"), "utf8"));

    const events = [];
    for (let i = 0; i < 4; i++) {
      events.push((await db.query(`INSERT INTO engine_eventos_brutos
        (origem,fonte,origem_tipo) VALUES ('radar','radar','whatsapp') RETURNING id`)).rows[0].id);
    }
    const insertJob = async (eventId, workspace, status = "pendente", extras = {}) =>
      (await db.query(`INSERT INTO engine_jobs_cliente
        (evento_id,cliente_id,status,tentativas,metadata)
        VALUES ($1,$2,$3,$4,$5::jsonb) RETURNING id`, [eventId, workspace,
        status, extras.tentativas || 0, JSON.stringify(extras.metadata || {})])).rows[0].id;

    const pristineA = await insertJob(events[0], "ws_a");
    const pristineB = await insertJob(events[0], "ws_a");
    assert.notEqual(pristineA, pristineB);
    const progressOwner = await insertJob(events[1], "ws_a", "diagnosticado");
    await insertJob(events[1], "ws_a");
    await db.query(`INSERT INTO engine_processamentos (job_id,etapa,status)
      VALUES ($1,'diagnostico','concluido')`, [progressOwner]);
    const conflictA = await insertJob(events[2], "ws_a", "diagnosticado");
    const conflictB = await insertJob(events[2], "ws_a", "oferta_criada");
    await db.query(`INSERT INTO engine_processamentos (job_id,etapa,status)
      VALUES ($1,'diagnostico','concluido')`, [conflictA]);
    await db.query(`INSERT INTO engine_eventos_comerciais
      (tipo_evento,cliente_id,workspace_id,job_id,chave_idempotencia)
      VALUES ('oferta_criada','ws_a','ws_a',$1,'fixture_conflict_b')`, [conflictB]);
    await insertJob(events[3], "ws_a");
    await insertJob(events[3], "ws_b"); // same event, distinct workspace is valid

    const duplicateGroups = (await db.query(`SELECT evento_id,cliente_id,count(*)::int AS n
      FROM engine_jobs_cliente GROUP BY evento_id,cliente_id HAVING count(*)>1
      ORDER BY evento_id,cliente_id`)).rows;
    assert.equal(duplicateGroups.length, 3);
    const classifications = [];
    for (const group of duplicateGroups) {
      const rows = (await db.query(`SELECT j.id,j.status,j.tentativas,j.oferta_id,j.metadata,
        (SELECT count(*)::int FROM engine_processamentos p WHERE p.job_id=j.id) AS processamentos,
        (SELECT count(*)::int FROM engine_eventos_comerciais c WHERE c.job_id=j.id) AS comerciais
        FROM engine_jobs_cliente j WHERE j.evento_id=$1 AND j.cliente_id=$2 ORDER BY j.id`,
      [group.evento_id, group.cliente_id])).rows;
      classifications.push({ eventId: group.evento_id, workspace: group.cliente_id,
        count: group.n, ...classify(rows) });
    }
    assert.deepEqual(classifications.map(item => item.category), [
      "PRISTINE_NO_REFERENCES", "ONE_PROGRESS_OWNER", "CONFLICTING_FACTS_UNSAFE"
    ]);
    assert.equal(classifications[1].canonicalJobId, progressOwner);
    assert(classifications.every(item => item.safeToDeleteNow === false));
    await assert.rejects(db.query(`CREATE UNIQUE INDEX test_unique_event_workspace
      ON engine_jobs_cliente(evento_id,cliente_id)`), error => error.code === "23505");
    const candidateSql = fs.readFileSync(path.join(__dirname, "..", "modules", "engine",
      "admission-gate.candidate.sql"), "utf8");
    await assert.rejects(db.query(candidateSql),/UF_LEGACY_RECONCILIATION_REQUIRED/);
    console.log(JSON.stringify({ candidate: "legacy_duplicate_classification",
      duplicateGroups: classifications.map(item => ({ category: item.category,
        count: item.count, canonicalJobId: item.canonicalJobId,
        safeToDeleteNow: item.safeToDeleteNow })),
      crossWorkspaceSameEventAllowed: true, uniqueIndexBlockedByDuplicates: true,
      migrationFailsClosed: true, rowsDeleted: 0 }));
  } finally {
    if (installed) await db.query(`DROP SCHEMA ${schema} CASCADE`).catch(() => {});
    await db.end().catch(() => {});
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
