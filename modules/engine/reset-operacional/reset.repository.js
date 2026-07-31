"use strict";

const { getEnginePool } = require("../database");

const RESET_LOCK_ID = 902260731;

function poolObrigatorio() {
  const pool = getEnginePool();
  if (!pool) {
    const erro = new Error("engine_db_pool_indisponivel");
    erro.codigo = "pool_indisponivel";
    throw erro;
  }
  return pool;
}

async function comTransacao(callback) {
  const client = await poolObrigatorio().connect();
  try {
    await client.query("BEGIN");
    const resultado = await callback(client);
    await client.query("COMMIT");
    return resultado;
  } catch (erro) {
    try {
      await client.query("ROLLBACK");
    } catch (_) {}
    throw erro;
  } finally {
    client.release();
  }
}

async function inicializarSchemaReset(client) {
  await client.query(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;

    CREATE TABLE IF NOT EXISTS engine_reset_operacional_operacoes (
      operation_id TEXT PRIMARY KEY,
      modo TEXT NOT NULL,
      status TEXT NOT NULL,
      operation_started_at TIMESTAMPTZ NOT NULL,
      cutoff_congelado TIMESTAMPTZ NOT NULL,
      criterio_hash TEXT NOT NULL,
      lote_tamanho INTEGER NOT NULL DEFAULT 1000,
      totais JSONB NOT NULL DEFAULT '{}'::jsonb,
      ids_hash_por_grupo JSONB NOT NULL DEFAULT '{}'::jsonb,
      erro TEXT,
      criada_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      atualizada_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS engine_reset_operacional_lotes (
      operation_id TEXT NOT NULL REFERENCES engine_reset_operacional_operacoes(operation_id) ON DELETE CASCADE,
      lote_numero INTEGER NOT NULL,
      grupo_acao TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pendente',
      total_snapshot INTEGER NOT NULL DEFAULT 0,
      total_alterado INTEGER NOT NULL DEFAULT 0,
      total_arquivado INTEGER NOT NULL DEFAULT 0,
      total_processamentos_arquivados INTEGER NOT NULL DEFAULT 0,
      total_pulados_concorrencia INTEGER NOT NULL DEFAULT 0,
      erro TEXT,
      iniciado_em TIMESTAMPTZ,
      finalizado_em TIMESTAMPTZ,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (operation_id, lote_numero, grupo_acao)
    );

    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
          FROM pg_constraint
         WHERE conrelid = 'engine_reset_operacional_lotes'::regclass
           AND conname = 'engine_reset_operacional_lotes_pkey'
           AND pg_get_constraintdef(oid) NOT ILIKE '%grupo_acao%'
      ) THEN
        ALTER TABLE engine_reset_operacional_lotes
          DROP CONSTRAINT engine_reset_operacional_lotes_pkey;
        ALTER TABLE engine_reset_operacional_lotes
          ADD PRIMARY KEY (operation_id, lote_numero, grupo_acao);
      END IF;
    END;
    $$;

    CREATE TABLE IF NOT EXISTS engine_reset_operacional_snapshot (
      operation_id TEXT NOT NULL REFERENCES engine_reset_operacional_operacoes(operation_id) ON DELETE CASCADE,
      lote_numero INTEGER NOT NULL,
      job_id BIGINT NOT NULL,
      grupo_acao TEXT NOT NULL,
      status_anterior TEXT NOT NULL,
      motivo_anterior TEXT,
      criado_em_original TIMESTAMPTZ NOT NULL,
      atualizado_em_original TIMESTAMPTZ,
      cliente_id TEXT,
      marketplace TEXT,
      job_payload JSONB NOT NULL,
      criterio_hash TEXT NOT NULL,
      estado_reset TEXT NOT NULL DEFAULT 'snapshot',
      criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (operation_id, job_id)
    );

    CREATE TABLE IF NOT EXISTS engine_jobs_cliente_arquivo (
      arquivo_id BIGSERIAL PRIMARY KEY,
      operation_id TEXT NOT NULL,
      lote_numero INTEGER NOT NULL,
      job_id_original BIGINT NOT NULL,
      status_original TEXT NOT NULL,
      cliente_id TEXT,
      marketplace TEXT,
      criado_em_original TIMESTAMPTZ,
      job_payload JSONB NOT NULL,
      arquivado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (operation_id, job_id_original)
    );

    CREATE TABLE IF NOT EXISTS engine_processamentos_arquivo (
      arquivo_id BIGSERIAL PRIMARY KEY,
      operation_id TEXT NOT NULL,
      lote_numero INTEGER NOT NULL,
      processamento_id_original BIGINT NOT NULL,
      job_id_original BIGINT NOT NULL,
      processamento_payload JSONB NOT NULL,
      arquivado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (operation_id, processamento_id_original)
    );

    CREATE INDEX IF NOT EXISTS idx_engine_reset_snapshot_lote
      ON engine_reset_operacional_snapshot (operation_id, lote_numero, grupo_acao);
    CREATE INDEX IF NOT EXISTS idx_engine_reset_snapshot_estado
      ON engine_reset_operacional_snapshot (operation_id, estado_reset);
    CREATE INDEX IF NOT EXISTS idx_engine_jobs_cliente_arquivo_job
      ON engine_jobs_cliente_arquivo (job_id_original);
    CREATE INDEX IF NOT EXISTS idx_engine_processamentos_arquivo_job
      ON engine_processamentos_arquivo (job_id_original);
  `);
}

async function adquirirLockReset(client) {
  const resultado = await client.query("SELECT pg_try_advisory_xact_lock($1) AS locked", [RESET_LOCK_ID]);
  return resultado.rows[0]?.locked === true;
}

async function inserirOperacao(client, operacao = {}) {
  await client.query(
    `INSERT INTO engine_reset_operacional_operacoes (
       operation_id, modo, status, operation_started_at, cutoff_congelado,
       criterio_hash, lote_tamanho, totais, ids_hash_por_grupo
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb)
     ON CONFLICT (operation_id) DO NOTHING`,
    [
      operacao.operationId,
      operacao.modo || "dry-run",
      operacao.status || "dry_run_iniciado",
      operacao.operationStartedAt,
      operacao.cutoffCongelado,
      operacao.criterioHash,
      operacao.loteTamanho,
      JSON.stringify(operacao.totais || {}),
      JSON.stringify(operacao.idsHashPorGrupo || {})
    ]
  );
}

async function atualizarOperacao(client, operationId, campos = {}) {
  const status = campos.status || null;
  const totais = campos.totais ? JSON.stringify(campos.totais) : null;
  const idsHash = campos.idsHashPorGrupo ? JSON.stringify(campos.idsHashPorGrupo) : null;
  const erro = campos.erro || null;
  await client.query(
    `UPDATE engine_reset_operacional_operacoes
        SET status = COALESCE($2, status),
            totais = COALESCE($3::jsonb, totais),
            ids_hash_por_grupo = COALESCE($4::jsonb, ids_hash_por_grupo),
            erro = COALESCE($5, erro),
            atualizada_em = NOW()
      WHERE operation_id = $1`,
    [operationId, status, totais, idsHash, erro]
  );
}

async function carregarOperacao(client, operationId) {
  const resultado = await client.query(
    `SELECT operation_id, modo, status, operation_started_at, cutoff_congelado,
            criterio_hash, lote_tamanho, totais, ids_hash_por_grupo
       FROM engine_reset_operacional_operacoes
      WHERE operation_id = $1
      LIMIT 1`,
    [operationId]
  );
  return resultado.rows[0] || null;
}

async function marcarLoteInicio(client, { operationId, loteNumero, grupoAcao }) {
  await client.query(
    `UPDATE engine_reset_operacional_lotes
        SET status = 'em_execucao',
            iniciado_em = NOW(),
            atualizado_em = NOW()
      WHERE operation_id = $1
        AND lote_numero = $2
        AND grupo_acao = $3`,
    [operationId, loteNumero, grupoAcao]
  );
}

async function marcarLoteFim(client, dados = {}) {
  await client.query(
    `UPDATE engine_reset_operacional_lotes
        SET status = $4,
            total_alterado = $5,
            total_arquivado = $6,
            total_processamentos_arquivados = $7,
            total_pulados_concorrencia = $8,
            erro = $9,
            finalizado_em = NOW(),
            atualizado_em = NOW()
      WHERE operation_id = $1
        AND lote_numero = $2
        AND grupo_acao = $3`,
    [
      dados.operationId,
      dados.loteNumero,
      dados.grupoAcao,
      dados.status || "concluido",
      dados.totalAlterado || 0,
      dados.totalArquivado || 0,
      dados.totalProcessamentosArquivados || 0,
      dados.totalPuladosConcorrencia || 0,
      dados.erro || null
    ]
  );
}

async function buscarProximoLotePendente(client, operationId) {
  const resultado = await client.query(
    `SELECT operation_id, lote_numero, grupo_acao, status, total_snapshot
       FROM engine_reset_operacional_lotes
      WHERE operation_id = $1
        AND status IN ('pendente', 'em_execucao')
      ORDER BY lote_numero ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED`,
    [operationId]
  );
  return resultado.rows[0] || null;
}

async function listarLotesRollback(client, operationId) {
  const resultado = await client.query(
    `SELECT operation_id, lote_numero, grupo_acao, status, total_snapshot
       FROM engine_reset_operacional_lotes
      WHERE operation_id = $1
        AND status IN ('concluido', 'rollback_parcial')
      ORDER BY lote_numero DESC`,
    [operationId]
  );
  return resultado.rows;
}

module.exports = {
  RESET_LOCK_ID,
  adquirirLockReset,
  atualizarOperacao,
  buscarProximoLotePendente,
  carregarOperacao,
  comTransacao,
  inicializarSchemaReset,
  inserirOperacao,
  listarLotesRollback,
  marcarLoteFim,
  marcarLoteInicio
};
