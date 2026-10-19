"use strict";

// Destructive by design only inside a disposable CI database. Never point this
// test at DATABASE_URL or a production connection string.
const assert = require("assert");
const connectionString = process.env.AUTO_CLEAN_TEST_DATABASE_URL;

if (!connectionString) {
  console.log("AUTO_CLEAN_POSTGRES_GUARDS_SKIPPED: AUTO_CLEAN_TEST_DATABASE_URL ausente");
  process.exit(0);
}

const disposableUrl = new URL(connectionString);
const disposableDatabase = disposableUrl.pathname.replace(/^\//, "");
const disposableHost = String(disposableUrl.hostname || "").toLowerCase();
if (!new Set(["127.0.0.1", "localhost", "::1", "[::1]"]).has(disposableHost) ||
    !/(^|[-_])(ci|test|disposable)([-_]|$)/i.test(disposableDatabase)) {
  throw new Error("AUTO_CLEAN_TEST_DATABASE_URL deve apontar somente para PostgreSQL CI descartavel em loopback");
}

const { Pool } = require("pg");
const {
  executarAutoCleanExecute,
  executarJobsPostgresAutoClean,
  executarOfertasPostgresAutoClean,
  executarLinksPostgresAutoClean,
  executarEventosBrutosPostgresAutoClean
} = require("../modules/engine/auto-clean/auto-clean.service");

const schema = `auto_clean_ci_${process.pid}_${Date.now()}`.replace(/[^a-z0-9_]/gi, "_").toLowerCase();
const ddl = `
CREATE TABLE engine_jobs_cliente (
  id BIGSERIAL PRIMARY KEY, evento_id BIGINT, oferta_id BIGINT, cliente_id TEXT NOT NULL,
  status TEXT NOT NULL, motivo_final TEXT, metadata JSONB DEFAULT '{}'::jsonb,
  criado_em TIMESTAMPTZ NOT NULL, atualizado_em TIMESTAMPTZ NOT NULL
);
CREATE TABLE engine_processamentos (
  id BIGSERIAL PRIMARY KEY, job_id BIGINT, status TEXT, criado_em TIMESTAMPTZ,
  detalhes JSONB DEFAULT '{}'::jsonb
);
CREATE TABLE engine_eventos_comerciais (
  id BIGSERIAL PRIMARY KEY, tipo_evento TEXT NOT NULL, cliente_id TEXT,
  oferta_id BIGINT, job_id BIGINT, fila_item_id TEXT, destino_id TEXT,
  ocorrido_em TIMESTAMPTZ, metadata JSONB DEFAULT '{}'::jsonb
);
CREATE TABLE engine_universal_queue_items (
  id BIGSERIAL PRIMARY KEY, evento_id BIGINT, job_id BIGINT, oferta_id BIGINT,
  operation_epoch_started_at TIMESTAMPTZ DEFAULT NOW(), workspace_id TEXT DEFAULT 'ci',
  capturado_em TIMESTAMPTZ DEFAULT NOW(), item_payload JSONB DEFAULT '{}'::jsonb,
  status TEXT, revision BIGINT DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(), terminal_at TIMESTAMPTZ
);
CREATE TABLE engine_ofertas (
  id BIGSERIAL PRIMARY KEY, evento_id BIGINT, link_id BIGINT, status TEXT,
  motivo_status TEXT, metadata JSONB DEFAULT '{}'::jsonb,
  criada_em TIMESTAMPTZ, atualizada_em TIMESTAMPTZ
);
CREATE TABLE engine_links (
  id BIGSERIAL PRIMARY KEY, evento_id BIGINT, criado_em TIMESTAMPTZ
);
CREATE TABLE engine_eventos_brutos (
  id BIGSERIAL PRIMARY KEY, criado_em TIMESTAMPTZ
);
CREATE INDEX engine_jobs_cleanup_idx ON engine_jobs_cliente (status, atualizado_em, id);
CREATE INDEX engine_processamentos_cleanup_idx ON engine_processamentos (job_id, status, criado_em, id);
CREATE INDEX engine_commercial_events_cleanup_idx ON engine_eventos_comerciais (job_id, oferta_id, ocorrido_em, id);
CREATE INDEX engine_queue_job_cleanup_idx ON engine_universal_queue_items (job_id, id);
CREATE INDEX engine_queue_offer_cleanup_idx ON engine_universal_queue_items (oferta_id, id);
CREATE INDEX engine_queue_event_cleanup_idx ON engine_universal_queue_items (evento_id, id);
`;

function isoDaysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

async function main() {
  const poolOptions = {
    connectionString,
    max: 2,
    connectionTimeoutMillis: 1000,
    idleTimeoutMillis: 1000,
    statement_timeout: 5000
  };
  const bootstrap = new Pool(poolOptions);
  await bootstrap.query(`CREATE SCHEMA ${schema}`);
  await bootstrap.end();

  const pool = new Pool({ ...poolOptions, options: `-c search_path=${schema}` });
  const queryEngine = async (sql, params = []) => ({ ok: true, resultado: await pool.query(sql, params) });
  try {
    await pool.query(ddl);

    const old = isoDaysAgo(8);
    const now = new Date().toISOString();
    const job = async (clienteId, status = "concluido") => (await pool.query(
      `INSERT INTO engine_jobs_cliente (evento_id,cliente_id,status,criado_em,atualizado_em)
       VALUES (NULL,$1,$2,$3,$3) RETURNING id`, [clienteId, status, old]
    )).rows[0].id;

    const livre = await job("workspace_livre");
    const fila = await job("workspace_fila");
    await pool.query("INSERT INTO engine_universal_queue_items (job_id,status,terminal_at) VALUES ($1,'pending',NULL)", [fila]);
    const ack = await job("workspace_ack");
    await pool.query(
      `INSERT INTO engine_eventos_comerciais (tipo_evento,job_id,fila_item_id,ocorrido_em)
       VALUES ('envio_confirmado',$1,'fila_1',$2)`, [ack, old]
    );
    const desconhecido = await job("workspace_desconhecido");
    await pool.query(
      "INSERT INTO engine_processamentos (job_id,status,criado_em) VALUES ($1,'estado_novo',$2)",
      [desconhecido, old]
    );
    await pool.query(
      "INSERT INTO engine_processamentos (job_id,status,criado_em) VALUES (NULL,'concluido',$1)",
      [old]
    );
    const eventoOrfaoProtegido = (await pool.query(
      `INSERT INTO engine_eventos_comerciais (tipo_evento,job_id,ocorrido_em,metadata)
       VALUES ('historico_legado',NULL,$1,'{}'::jsonb) RETURNING id`, [old]
    )).rows[0].id;
    const eventoOrfaoSeguro = (await pool.query(
      `INSERT INTO engine_eventos_comerciais (tipo_evento,job_id,ocorrido_em,metadata)
       VALUES ('job_expirada_operacional',NULL,$1,$2::jsonb) RETURNING id`,
      [old, JSON.stringify({ terminalOcorridoEm: old })]
    )).rows[0].id;

    const primeira = await executarJobsPostgresAutoClean({
      pool, queryEngine, canarioPostgres: true
    });
    assert.strictEqual(primeira.ok, true);
    assert.strictEqual(primeira.jobsRemovidos, 1, "somente job terminal sem dependencias e removido");
    assert.strictEqual(primeira.processamentosOrfaosRemovidos, 1, "um processamento orfao terminal e removido no lote");
    assert.strictEqual(primeira.eventosComerciaisOrfaosRemovidos, 1, "somente evento orfao com marco terminal e removido");
    assert.strictEqual((await pool.query("SELECT COUNT(*)::int AS n FROM engine_jobs_cliente WHERE id=$1", [livre])).rows[0].n, 0);
    assert.strictEqual((await pool.query("SELECT COUNT(*)::int AS n FROM engine_jobs_cliente WHERE id IN ($1,$2,$3)", [fila, ack, desconhecido])).rows[0].n, 3);
    assert.strictEqual((await pool.query("SELECT COUNT(*)::int AS n FROM engine_eventos_comerciais WHERE id=$1", [eventoOrfaoProtegido])).rows[0].n, 1);
    assert.strictEqual((await pool.query("SELECT COUNT(*)::int AS n FROM engine_eventos_comerciais WHERE id=$1", [eventoOrfaoSeguro])).rows[0].n, 0);

    const segunda = await executarJobsPostgresAutoClean({ pool, queryEngine, canarioPostgres: true });
    assert.strictEqual(segunda.jobsRemovidos, 0, "segunda execucao e idempotente");

    const ofertaLivre = (await pool.query(
      `INSERT INTO engine_ofertas (status,criada_em,atualizada_em) VALUES ('erro_final',$1,$1) RETURNING id`, [old]
    )).rows[0].id;
    const ofertaFila = (await pool.query(
      `INSERT INTO engine_ofertas (status,criada_em,atualizada_em) VALUES ('erro_final',$1,$1) RETURNING id`, [old]
    )).rows[0].id;
    await pool.query("INSERT INTO engine_universal_queue_items (oferta_id,status,terminal_at) VALUES ($1,'sent',$2)", [ofertaFila, now]);
    const ofertas = await executarOfertasPostgresAutoClean({ pool, canarioPostgres: true });
    assert.strictEqual(ofertas.ofertasRemovidas, 1, "oferta sem fila e removida");
    assert.strictEqual((await pool.query("SELECT COUNT(*)::int AS n FROM engine_ofertas WHERE id=$1", [ofertaFila])).rows[0].n, 1);
    assert.strictEqual((await pool.query("SELECT COUNT(*)::int AS n FROM engine_ofertas WHERE id=$1", [ofertaLivre])).rows[0].n, 0);

    const evento = (await pool.query("INSERT INTO engine_eventos_brutos (criado_em) VALUES ($1) RETURNING id", [old])).rows[0].id;
    const link = (await pool.query("INSERT INTO engine_links (evento_id,criado_em) VALUES ($1,$2) RETURNING id", [evento, old])).rows[0].id;
    const links = await executarLinksPostgresAutoClean({ pool, canarioPostgres: true });
    assert.strictEqual(links.linksRemovidos, 1);
    assert.strictEqual((await pool.query("SELECT COUNT(*)::int AS n FROM engine_links WHERE id=$1", [link])).rows[0].n, 0);
    const brutos = await executarEventosBrutosPostgresAutoClean({ pool, canarioPostgres: true });
    assert.strictEqual(brutos.eventosBrutosRemovidos, 1);

    // The canary orchestration is explicitly DB-only.  Passing incluirArquivos
    // must not enable fila.json, media, or GC without the separate production
    // opt-in permitirLimpezaArquivos.
    const canarioResumo = await executarAutoCleanExecute({
      pool,
      queryEngine,
      canarioPostgres: true,
      incluirArquivos: true
    });
    assert.strictEqual(canarioResumo.totalOrigens, 4, "canario executa somente as quatro etapas PostgreSQL");
    assert.strictEqual(canarioResumo.filasRegravadas, 0, "canario nao regrava fila JSON");
    assert.strictEqual(canarioResumo.arquivosRemovidos, 0, "canario nao remove arquivos ou midias");
    assert.strictEqual(canarioResumo.compactados, 0, "canario nao compacta arquivos");

    console.log("AUTO_CLEAN_POSTGRES_GUARDS_PASS");
  } finally {
    await pool.end();
    const cleanup = new Pool(poolOptions);
    await cleanup.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await cleanup.end();
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
