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
  executarEventosBrutosPostgresAutoClean,
  executarHistoricoDefinitivoPostgresAutoClean
} = require("../modules/engine/auto-clean/auto-clean.service");
const { projectUniversalTerminalTx, projectPreUniversalTerminalError } =
  require("../modules/engine/universal-history.repository");

const HARNESS_TIMEOUT_MS = 120_000;
const harnessTimeout = setTimeout(() => {
  console.error(`AUTO_CLEAN_POSTGRES_GUARDS_TIMEOUT: ${HARNESS_TIMEOUT_MS}ms`);
  process.exit(124);
}, HARNESS_TIMEOUT_MS);

function checkpoint(name) {
  console.log(`AUTO_CLEAN_CHECKPOINT:${name}`);
}

const schema = `auto_clean_ci_${process.pid}_${Date.now()}`.replace(/[^a-z0-9_]/gi, "_").toLowerCase();
const ddl = `
CREATE TABLE engine_jobs_cliente (
  id BIGSERIAL PRIMARY KEY, evento_id BIGINT, oferta_id BIGINT, cliente_id TEXT NOT NULL,
  status TEXT NOT NULL, motivo_final TEXT, metadata JSONB DEFAULT '{}'::jsonb,
  criado_em TIMESTAMPTZ NOT NULL, atualizado_em TIMESTAMPTZ NOT NULL
);
CREATE TABLE engine_processamentos (
  id BIGSERIAL PRIMARY KEY, job_id BIGINT, etapa TEXT, status TEXT, motivo TEXT, criado_em TIMESTAMPTZ,
  detalhes JSONB DEFAULT '{}'::jsonb
);
CREATE TABLE engine_eventos_comerciais (
  id BIGSERIAL PRIMARY KEY, tipo_evento TEXT NOT NULL, cliente_id TEXT,
  oferta_id BIGINT, job_id BIGINT, fila_item_id TEXT, destino_id TEXT,
  ocorrido_em TIMESTAMPTZ, metadata JSONB DEFAULT '{}'::jsonb
);
CREATE TABLE engine_history_items (
  history_id BIGSERIAL PRIMARY KEY, workspace_id TEXT NOT NULL,
  source_key TEXT NOT NULL, universal_item_id BIGINT, marketplace TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '', thumbnail_url TEXT, price_text TEXT, category TEXT,
  commercial_status TEXT NOT NULL CHECK (commercial_status IN ('sent','partial','error')),
  total_targets INTEGER NOT NULL DEFAULT 0, sent_targets INTEGER NOT NULL DEFAULT 0,
  failed_targets INTEGER NOT NULL DEFAULT 0, destination_summary TEXT,
  channels TEXT[] NOT NULL DEFAULT '{}', finalized_at TIMESTAMPTZ NOT NULL,
  source_origin TEXT, error_stage TEXT, error_code TEXT, error_public_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, source_key), UNIQUE (history_id, workspace_id)
);
CREATE TABLE engine_history_targets (
  history_target_id BIGSERIAL PRIMARY KEY, history_id BIGINT NOT NULL,
  workspace_id TEXT NOT NULL, destination_id TEXT NOT NULL,
  destination_name_snapshot TEXT NOT NULL, target_label_snapshot TEXT NOT NULL,
  channel TEXT NOT NULL, target_key TEXT NOT NULL, status TEXT NOT NULL,
  provider_message_id TEXT, confirmed_at TIMESTAMPTZ, error_stage TEXT,
  error_code TEXT, error_public_message TEXT,
  FOREIGN KEY (history_id, workspace_id) REFERENCES engine_history_items(history_id, workspace_id)
);
CREATE TABLE engine_universal_queue_items (
  id BIGSERIAL PRIMARY KEY, evento_id BIGINT, job_id BIGINT, oferta_id BIGINT,
  operation_epoch_started_at TIMESTAMPTZ DEFAULT NOW(), workspace_id TEXT DEFAULT 'ci',
  origem_fluxo TEXT DEFAULT 'ci', capturado_em TIMESTAMPTZ DEFAULT NOW(),
  item_payload JSONB DEFAULT '{}'::jsonb,
  status TEXT, revision BIGINT DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(), terminal_at TIMESTAMPTZ
);
CREATE TABLE engine_universal_fanout_owners (
  owner_id TEXT PRIMARY KEY, queue_item_id BIGINT NOT NULL,
  operation_epoch_started_at TIMESTAMPTZ, workspace_id TEXT NOT NULL,
  destination_id TEXT NOT NULL, target_snapshot_hash TEXT NOT NULL
);
CREATE TABLE engine_universal_queue_destinations (
  id BIGSERIAL PRIMARY KEY, queue_item_id BIGINT NOT NULL,
  operation_epoch_started_at TIMESTAMPTZ, workspace_id TEXT NOT NULL,
  destination_id TEXT NOT NULL, fanout_owner_id TEXT,
  target_key TEXT NOT NULL, connection_id TEXT, channel TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', confirmation_key TEXT,
  provider_message_id TEXT, confirmed_at TIMESTAMPTZ,
  terminal_reason TEXT, terminal_evidence TEXT,
  destination_name_snapshot TEXT NOT NULL, target_label_snapshot TEXT NOT NULL
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
CREATE INDEX engine_history_items_workspace_finalized_idx
  ON engine_history_items (workspace_id, finalized_at DESC, history_id DESC);
CREATE INDEX engine_history_targets_workspace_idx
  ON engine_history_targets (workspace_id, history_id);
`;

function isoDaysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

async function createHistory(pool, {
  workspaceId, sourceKey, finalizedAt, universalItemId = null, target = null
}) {
  const row = (await pool.query(`INSERT INTO engine_history_items
    (workspace_id,source_key,universal_item_id,marketplace,title,commercial_status,
     total_targets,sent_targets,failed_targets,finalized_at)
    VALUES ($1,$2,$3,'amazon',$4,'sent',1,1,0,$5)
    RETURNING history_id`, [workspaceId, sourceKey, universalItemId,
    sourceKey, finalizedAt])).rows[0];
  if (target) {
    await pool.query(`INSERT INTO engine_history_targets
      (history_id,workspace_id,destination_id,destination_name_snapshot,
       target_label_snapshot,channel,target_key,status,provider_message_id,confirmed_at)
      VALUES ($1,$2,$3,$4,$5,'whatsapp',$6,'sent',$7,$8)`,
    [row.history_id, workspaceId, target.destinationId, target.destinationName,
      target.targetLabel, target.targetKey, `provider-${row.history_id}`, finalizedAt]);
  }
  return Number(row.history_id);
}

async function main() {
  checkpoint("bootstrap:start");
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
    checkpoint("fixtures:ready");

    // Definitive history retention: the 7-day display window has a 24-hour
    // physical grace period. Fixtures are tenant-scoped and disposable.
    const historySixDays = await createHistory(pool, {
      workspaceId: "workspace_a", sourceKey: "history-6d",
      finalizedAt: isoDaysAgo(6)
    });
    const historyGrace = await createHistory(pool, {
      workspaceId: "workspace_a", sourceKey: "history-7d-2h",
      finalizedAt: new Date(Date.now() - (7 * 24 + 2) * 60 * 60 * 1000).toISOString()
    });
    const historyEligibleA = await createHistory(pool, {
      workspaceId: "workspace_a", sourceKey: "history-8d-a",
      finalizedAt: new Date(Date.now() - (10 * 24) * 60 * 60 * 1000).toISOString(),
      target: { destinationId: "dest-history-a", destinationName: "Destino A",
        targetLabel: "Grupo A", targetKey: "history-a" }
    });
    const historyEligibleA2 = await createHistory(pool, {
      workspaceId: "workspace_a", sourceKey: "history-8d-a2",
      finalizedAt: new Date(Date.now() - (9 * 24) * 60 * 60 * 1000).toISOString()
    });
    const historyEligibleB = await createHistory(pool, {
      workspaceId: "workspace_b", sourceKey: "history-8d-b",
      finalizedAt: new Date(Date.now() - (9 * 24) * 60 * 60 * 1000).toISOString()
    });
    const liveQueue = (await pool.query(`INSERT INTO engine_universal_queue_items
      (workspace_id,status,terminal_at) VALUES ('workspace_a','pending',NULL)
      RETURNING id`)).rows[0].id;
    const historyProtected = await createHistory(pool, {
      workspaceId: "workspace_a", sourceKey: "history-live-dependency",
      finalizedAt: new Date(Date.now() - (10 * 24) * 60 * 60 * 1000).toISOString(),
      universalItemId: liveQueue
    });

    const firstHistoryBatch = await executarHistoricoDefinitivoPostgresAutoClean({
      pool, canarioPostgres: true, workspaceId: "workspace_a"
    });
    assert.strictEqual(firstHistoryBatch.ok, true);
    assert.strictEqual(firstHistoryBatch.historicoItensRemovidos, 1,
      "canario inicial remove somente um historico elegivel da workspace escolhida");
    assert.strictEqual((await pool.query(`SELECT count(*)::int AS n
      FROM engine_history_targets WHERE history_id=$1`, [historyEligibleA])).rows[0].n, 0,
    "targets sao removidos antes do item principal");
    assert.strictEqual((await pool.query(`SELECT count(*)::int AS n
      FROM engine_history_items WHERE history_id=$1`, [historyEligibleA])).rows[0].n, 0);
    assert.strictEqual((await pool.query(`SELECT count(*)::int AS n
      FROM engine_history_items WHERE history_id IN ($1,$2)`, [historySixDays, historyGrace])).rows[0].n, 2,
    "historico dentro da janela de exibicao e da carencia permanece");
    assert.strictEqual((await pool.query(`SELECT count(*)::int AS n
      FROM engine_history_items WHERE history_id=$1`, [historyProtected])).rows[0].n, 1,
    "historico referenciado por fila viva permanece protegido");
    checkpoint("history:first-batch:done");

    const secondHistoryBatch = await executarHistoricoDefinitivoPostgresAutoClean({
      pool, canarioPostgres: true, workspaceId: "workspace_a"
    });
    assert.strictEqual(secondHistoryBatch.historicoItensRemovidos, 1,
      "segundo ciclo avanca sem ultrapassar o limite do lote");
    assert.strictEqual((await pool.query(`SELECT count(*)::int AS n
      FROM engine_history_items WHERE history_id=$1`, [historyEligibleA2])).rows[0].n, 0);
    assert.strictEqual((await pool.query(`SELECT count(*)::int AS n
      FROM engine_history_items WHERE history_id=$1`, [historyEligibleB])).rows[0].n, 1,
    "workspace B nao e afetada pela limpeza escopada em A");
    assert.strictEqual((await pool.query(`SELECT count(*)::int AS n
      FROM engine_history_targets ht LEFT JOIN engine_history_items hi
        ON hi.history_id=ht.history_id AND hi.workspace_id=ht.workspace_id
      WHERE hi.history_id IS NULL`)).rows[0].n, 0,
    "nenhum target fica orfao");
    checkpoint("history:second-batch:done");

    const rollbackHistory = await createHistory(pool, {
      workspaceId: "workspace_rollback", sourceKey: "history-rollback",
      finalizedAt: new Date(Date.now() - (9 * 24) * 60 * 60 * 1000).toISOString(),
      target: { destinationId: "dest-rollback", destinationName: "Destino rollback",
        targetLabel: "Grupo rollback", targetKey: "history-rollback" }
    });
    const failPool = {
      async connect() {
        const client = await pool.connect();
        const query = client.query.bind(client);
        // Never mutate a pooled pg client: a leaked monkeypatch can poison
        // later pool.query calls and make the rollback scenario hang.
        return {
          query: async (sql, params) => {
            if (/DELETE FROM engine_history_items/i.test(sql)) {
              throw new Error("fixture_history_delete_failure");
            }
            return query(sql, params);
          },
          release: (...args) => client.release(...args)
        };
      }
    };
    const rollback = await executarHistoricoDefinitivoPostgresAutoClean({
      pool: failPool, canarioPostgres: true, workspaceId: "workspace_rollback"
    });
    assert.strictEqual(rollback.ok, false, "falha de SQL impede sucesso do lote");
    assert.strictEqual(rollback.aplicouMudancas, false, "rollback nao relata exclusao parcial");
    assert.strictEqual((await pool.query(`SELECT count(*)::int AS n
      FROM engine_history_items WHERE history_id=$1`, [rollbackHistory])).rows[0].n, 1,
    "falha SQL preserva o item principal");
    assert.strictEqual((await pool.query(`SELECT count(*)::int AS n
      FROM engine_history_targets WHERE history_id=$1`, [rollbackHistory])).rows[0].n, 1,
    "falha SQL preserva os targets no rollback");
    checkpoint("history:rollback:done");

    // Anti-replay: after physical cleanup, the same terminal fact must not
    // recreate definitive history through either writer.
    const replayHistory = await createHistory(pool, {
      workspaceId: "workspace_replay", sourceKey: "replay-history",
      finalizedAt: new Date(Date.now() - (9 * 24) * 60 * 60 * 1000).toISOString()
    });
    const replayCleanup = await executarHistoricoDefinitivoPostgresAutoClean({
      pool, canarioPostgres: true, workspaceId: "workspace_replay"
    });
    assert.strictEqual(replayCleanup.historicoItensRemovidos, 1,
      "o fato terminal antigo deve ser removido antes da prova anti-replay");
    assert.strictEqual((await pool.query(
      "SELECT count(*)::int AS n FROM engine_history_items WHERE history_id=$1",
      [replayHistory])).rows[0].n, 0);
    const replayQueue = (await pool.query(`INSERT INTO engine_universal_queue_items
      (workspace_id,status,terminal_at,item_payload)
      VALUES ('workspace_replay','sent',$1,$2::jsonb) RETURNING id`,
    [new Date(Date.now() - (9 * 24) * 60 * 60 * 1000).toISOString(),
      JSON.stringify({ marketplace: "amazon", titulo: "Replay antigo" })])).rows[0].id;
    const replayTerminalAt = (await pool.query(
      "SELECT terminal_at FROM engine_universal_queue_items WHERE id=$1",
      [replayQueue])).rows[0].terminal_at;
    const replayUniversal = await projectUniversalTerminalTx({
      query: (sql, params) => pool.query(sql, params)
    }, { queueItemId: Number(replayQueue), workspaceId: "workspace_replay" });
    assert.deepStrictEqual(replayUniversal, { projected: false, reason: "terminal_fact_expired" },
      "writer Universal nao pode ressuscitar fato terminal fora da retenção");
    const replayPre = await projectPreUniversalTerminalError({ pool,
      job: { id: 9001, cliente_id: "workspace_replay", marketplace: "amazon",
        terminal_at: replayTerminalAt,
        metadata: { comercialCapturado: { titulo: "Replay antigo" } } },
      reason: "sem_imagem_apos_retries", stage: "importacao_final" });
    assert.deepStrictEqual(replayPre, { projected: false, reason: "terminal_fact_expired" },
      "writer pre-Universal nao pode ressuscitar fato terminal fora da retenção");
    checkpoint("history:anti-replay:done");

    const idempotent = await executarHistoricoDefinitivoPostgresAutoClean({
      pool, canarioPostgres: true, workspaceId: "workspace_a"
    });
    assert.strictEqual(idempotent.historicoItensRemovidos, 0,
      "ciclo repetido nao ressuscita nem duplica historico");
    checkpoint("history:idempotence:done");

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
    assert.strictEqual(primeira.processamentosOrfaosRemovidos, 0,
      "canario padrao nao inclui processamentos orfaos sem autorizacao explicita");
    assert.strictEqual(primeira.eventosComerciaisOrfaosRemovidos, 0,
      "canario padrao nao inclui eventos comerciais orfaos sem autorizacao explicita");
    assert.strictEqual((await pool.query("SELECT COUNT(*)::int AS n FROM engine_jobs_cliente WHERE id=$1", [livre])).rows[0].n, 0);
    assert.strictEqual((await pool.query("SELECT COUNT(*)::int AS n FROM engine_jobs_cliente WHERE id IN ($1,$2,$3)", [fila, ack, desconhecido])).rows[0].n, 3);
    assert.strictEqual((await pool.query("SELECT COUNT(*)::int AS n FROM engine_eventos_comerciais WHERE id=$1", [eventoOrfaoProtegido])).rows[0].n, 1);
    assert.strictEqual((await pool.query("SELECT COUNT(*)::int AS n FROM engine_processamentos WHERE job_id IS NULL")).rows[0].n, 1,
      "processamento orfao permanece protegido no canario padrao");
    assert.strictEqual((await pool.query("SELECT COUNT(*)::int AS n FROM engine_eventos_comerciais WHERE id=$1", [eventoOrfaoSeguro])).rows[0].n, 1,
      "evento orfao terminal permanece protegido no canario padrao");

    const orfaosAutorizados = await executarJobsPostgresAutoClean({
      pool, queryEngine, canarioPostgres: true, incluirOrfaosNoCanario: true
    });
    assert.strictEqual(orfaosAutorizados.ok, true);
    assert.strictEqual(orfaosAutorizados.jobsRemovidos, 0,
      "varredura explicita de orfaos nao remove jobs adicionais");
    assert.strictEqual(orfaosAutorizados.processamentosOrfaosRemovidos, 1,
      "varredura explicitamente autorizada remove o processamento orfao terminal");
    assert.strictEqual(orfaosAutorizados.eventosComerciaisOrfaosRemovidos, 1,
      "varredura explicitamente autorizada remove o evento orfao com marco terminal");
    assert.strictEqual((await pool.query("SELECT COUNT(*)::int AS n FROM engine_processamentos WHERE job_id IS NULL")).rows[0].n, 0);
    assert.strictEqual((await pool.query("SELECT COUNT(*)::int AS n FROM engine_eventos_comerciais WHERE id=$1", [eventoOrfaoSeguro])).rows[0].n, 0);

    const segunda = await executarJobsPostgresAutoClean({
      pool, queryEngine, canarioPostgres: true, incluirOrfaosNoCanario: true
    });
    assert.strictEqual(segunda.jobsRemovidos, 0, "segunda execucao e idempotente");
    assert.strictEqual(segunda.processamentosOrfaosRemovidos, 0, "segunda varredura de orfaos e idempotente");
    assert.strictEqual(segunda.eventosComerciaisOrfaosRemovidos, 0, "segunda varredura de eventos orfaos e idempotente");

    // A PostgreSQL-only canary must not expire leases as a side effect.  The
    // normal executor keeps the lease step enabled; this explicit opt-in is
    // restricted to canarioPostgres and must use only the terminal cleanup.
    const leasePreservada = await job("workspace_lease_preservada", "processando");
    const terminalCanario = await job("workspace_canario_sem_lease");
    const canarioSemLease = await executarJobsPostgresAutoClean({
      pool,
      canarioPostgres: true,
      pularExpiracaoLeases: true,
      queryEngine: async () => { throw new Error("queryEngine de lease nao deveria ser chamado"); }
    });
    assert.strictEqual(canarioSemLease.ok, true);
    assert.strictEqual(canarioSemLease.leasesPulados, true);
    assert.strictEqual(canarioSemLease.jobsRemovidos, 1);
    assert.strictEqual((await pool.query(
      "SELECT status FROM engine_jobs_cliente WHERE id=$1", [leasePreservada]
    )).rows[0].status, "processando", "canario nao expira lease vivo");
    assert.strictEqual((await pool.query(
      "SELECT COUNT(*)::int AS n FROM engine_jobs_cliente WHERE id=$1", [terminalCanario]
    )).rows[0].n, 0);

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
      pularExpiracaoLeases: true,
      incluirArquivos: true
    });
    assert.strictEqual(canarioResumo.totalOrigens, 5, "canario executa somente as cinco etapas PostgreSQL");
    assert.strictEqual(canarioResumo.filasRegravadas, 0, "canario nao regrava fila JSON");
    assert.strictEqual(canarioResumo.arquivosRemovidos, 0, "canario nao remove arquivos ou midias");
    assert.strictEqual(canarioResumo.compactados, 0, "canario nao compacta arquivos");
    assert.strictEqual(canarioResumo.etapas.find(etapa => etapa.origem === "postgres_jobs").leasesPulados, true,
      "canario global deve manter leases intocados");
    checkpoint("canary:done");

    console.log("AUTO_CLEAN_POSTGRES_GUARDS_PASS");
  } finally {
    clearTimeout(harnessTimeout);
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
