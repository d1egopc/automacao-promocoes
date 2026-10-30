"use strict";

// Disposable PostgreSQL 17 fixture only. Never accepts a production URL.
process.env.OPTIMUS_AUTO_CLEAN_DB_DELETE_RELEASE = "approved"; // disposable PostgreSQL fixture
const assert = require("node:assert/strict");
const { Pool } = require("pg");
const clean = require("../modules/engine/auto-clean/auto-clean.service");

const url = process.env.AUTO_CLEAN_TEST_DATABASE_URL;
if (!url || !/^postgresql:\/\/[^/]*@127\.0\.0\.1:\d+\/auto_clean_fixture$/.test(url)) {
  throw new Error("isolated_loopback_fixture_required");
}
const pool = new Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 1000 });
const old = "now() - interval '10 days'";
const recent = "now() - interval '1 hour'";
const tables = ["engine_history_targets", "engine_history_items", "engine_universal_queue_items",
  "engine_eventos_comerciais", "engine_processamentos", "engine_jobs_cliente", "engine_ofertas",
  "engine_links", "engine_eventos_brutos"];

async function query(sql) { return pool.query(sql); }
async function reset() { await query(`TRUNCATE ${tables.join(", ")}`); }
async function count(table, id) {
  const result = await query(`SELECT count(*)::int AS n FROM ${table} WHERE id = ${Number(id)}`);
  return result.rows[0].n;
}
async function stage(name, fn, removedField, removedId, protectedId, table) {
  const result = await fn({ pool, canarioPostgres: true, loteLimite: 1, lotesDbPorCiclo: 1,
    limiteTotalMutacoes: 1, pularExpiracaoLeases: true, incluirOrfaosNoCanario: false });
  assert.equal(result.ok, true, `${name}: ${JSON.stringify({motivo:result.motivo,erroTipo:result.erroTipo})}`);
  assert.equal(result[removedField], 1, `${name}: expected one eligible row`);
  assert.equal(await count(table, removedId), 0, `${name}: expired row`);
  assert.equal(await count(table, protectedId), 1, `${name}: protected row`);
  const repeat = await fn({ pool, canarioPostgres: true, loteLimite: 1, lotesDbPorCiclo: 1,
    limiteTotalMutacoes: 1, pularExpiracaoLeases: true, incluirOrfaosNoCanario: false });
  assert.equal(repeat.ok, true, `${name}: idempotent run`);
  assert.equal(repeat[removedField], 0, `${name}: no second deletion`);
}

(async () => {
  try {
    const version = await query("SHOW server_version_num");
    assert.ok(Number(version.rows[0].server_version_num) >= 170000);
    await query(`
      CREATE TABLE engine_eventos_brutos(id bigint PRIMARY KEY, criado_em timestamptz);
      CREATE TABLE engine_links(id bigint PRIMARY KEY, evento_id bigint, criado_em timestamptz);
      CREATE TABLE engine_ofertas(id bigint PRIMARY KEY, evento_id bigint, link_id bigint,
        status text, motivo_status text, metadata jsonb DEFAULT '{}'::jsonb,
        criada_em timestamptz, atualizada_em timestamptz);
      CREATE TABLE engine_jobs_cliente(id bigint PRIMARY KEY, evento_id bigint, oferta_id bigint,
        cliente_id text, status text, criado_em timestamptz, atualizado_em timestamptz);
      CREATE TABLE engine_processamentos(id bigint PRIMARY KEY, job_id bigint,
        status text, criado_em timestamptz);
      CREATE TABLE engine_eventos_comerciais(id bigint PRIMARY KEY, job_id bigint,
        oferta_id bigint, fila_item_id text, destino_id text, tipo_evento text,
        metadata jsonb DEFAULT '{}'::jsonb, ocorrido_em timestamptz);
      CREATE TABLE engine_universal_queue_items(id bigint PRIMARY KEY, workspace_id text,
        evento_id bigint, job_id bigint, oferta_id bigint, status text, terminal_at timestamptz);
      CREATE TABLE engine_history_items(history_id bigint PRIMARY KEY, workspace_id text,
        universal_item_id bigint, finalized_at timestamptz);
      CREATE TABLE engine_history_targets(history_id bigint, workspace_id text);
    `);

    await reset();
    await query(`INSERT INTO engine_jobs_cliente VALUES
      (1,101,NULL,'tenant_a','concluido',${old},${old}),
      (2,102,NULL,'tenant_b','pendente',${old},${old})`);
    await stage("jobs", clean.executarJobsPostgresAutoClean, "jobsRemovidos", 1, 2, "engine_jobs_cliente");

    await reset();
    await query(`INSERT INTO engine_ofertas(id,status,criada_em,atualizada_em) VALUES
      (11,'enviado',${old},${old}),(12,'distribuindo',${old},${old})`);
    await stage("ofertas", clean.executarOfertasPostgresAutoClean, "ofertasRemovidas", 11, 12, "engine_ofertas");

    await reset();
    await query(`INSERT INTO engine_links VALUES (21,201,${old}),(22,202,${recent})`);
    await stage("links", clean.executarLinksPostgresAutoClean, "linksRemovidos", 21, 22, "engine_links");

    await reset();
    await query(`INSERT INTO engine_eventos_brutos VALUES (31,${old}),(32,${recent})`);
    await stage("eventos_brutos", clean.executarEventosBrutosPostgresAutoClean,
      "eventosBrutosRemovidos", 31, 32, "engine_eventos_brutos");

    await reset();
    await query(`INSERT INTO engine_history_items VALUES
      (41,'tenant_a',NULL,${old}),(42,'tenant_b',NULL,${old})`);
    const history = await clean.executarHistoricoDefinitivoPostgresAutoClean({pool,canarioPostgres:true,
      loteLimite:1,lotesDbPorCiclo:1,limiteTotalMutacoes:1,workspaceId:"tenant_a"});
    assert.equal(history.ok,true,JSON.stringify({motivo:history.motivo,erroTipo:history.erroTipo}));
    assert.equal(history.historicoItensRemovidos,1);
    assert.equal((await query("SELECT count(*)::int AS n FROM engine_history_items WHERE history_id=42")).rows[0].n,1);

    await reset();
    await query(`INSERT INTO engine_processamentos VALUES
      (51,NULL,'concluido',${old}),(52,999,'concluido',${old})`);
    const orphanP = await clean.executarOrfaosPostgresAutoClean({pool,canarioPostgres:true,
      tipoOrfaos:"processamentos",limiteTotalMutacoes:1});
    assert.equal(orphanP.ok,true,JSON.stringify({motivo:orphanP.motivo,erroTipo:orphanP.erroTipo}));
    assert.equal(orphanP.processamentosOrfaosRemovidos,1);
    assert.equal(await count("engine_processamentos",52),1);

    await reset();
    await query(`INSERT INTO engine_eventos_comerciais(id,tipo_evento,metadata,ocorrido_em) VALUES
      (61,'diagnostico','{"terminalOcorridoEm":"2026-01-01"}'::jsonb,${old}),
      (62,'ack','{"terminalOcorridoEm":"2026-01-01"}'::jsonb,${old})`);
    const orphanE = await clean.executarOrfaosPostgresAutoClean({pool,canarioPostgres:true,
      tipoOrfaos:"eventos_comerciais",limiteTotalMutacoes:1});
    assert.equal(orphanE.ok,true,JSON.stringify({motivo:orphanE.motivo,erroTipo:orphanE.erroTipo}));
    assert.equal(orphanE.eventosComerciaisOrfaosRemovidos,1);
    assert.equal(await count("engine_eventos_comerciais",62),1,"ACK protected");

    // Two workers cannot remove the same row twice; the advisory lock may
    // cause one to skip, which is a safe concurrent outcome.
    await reset();
    await query(`INSERT INTO engine_ofertas(id,status,criada_em,atualizada_em)
      VALUES (65,'enviado',${old},${old})`);
    const concurrent = await Promise.all([1,2].map(() => clean.executarOfertasPostgresAutoClean({
      pool,canarioPostgres:true,loteLimite:1,lotesDbPorCiclo:1,limiteTotalMutacoes:1
    })));
    assert.equal(concurrent.reduce((n,r)=>n+Number(r.ofertasRemovidas||0),0),1);
    assert.equal(await count("engine_ofertas",65),0);

    // Exercise the actual recurring dispatcher and its bounded pool wrapper.
    await reset();
    await query(`INSERT INTO engine_jobs_cliente VALUES
      (71,701,NULL,'tenant_a','concluido',${old},${old})`);
    const recurring = await clean.executarAutoCleanPostgresRecorrenteSeguro({recorrente:true,pool,
      logger:{log(){}},intervaloRecorrenteMinutos:10});
    assert.equal(recurring.ok,true,JSON.stringify({motivo:recurring.motivo,stage:recurring.stage}));
    assert.equal(recurring.stage,"jobs");
    assert.equal(await count("engine_jobs_cliente",71),0);
    const returned = await pool.connect();
    try { assert.equal((await returned.query("SELECT 1 AS n")).rows[0].n,1); }
    finally { returned.release(); }

    console.log("AUTO_CLEAN_SEVEN_STAGES_POSTGRES17_PASS");
  } finally { await pool.end(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
