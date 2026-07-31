"use strict";

const { GRUPOS_RESET, STATUS_EXPIRADO_OPERACIONAL } = require("./criterios.service");
const { logResetRollback } = require("./logs.service");

async function rollbackLoteExpirado(client, { operationId, loteNumero }) {
  const resultado = await client.query(
    `UPDATE engine_jobs_cliente j
        SET status = s.status_anterior,
            motivo_final = s.motivo_anterior,
            atualizado_em = COALESCE(s.atualizado_em_original, NOW())
       FROM engine_reset_operacional_snapshot s
      WHERE s.operation_id = $1
        AND s.lote_numero = $2
        AND s.grupo_acao = $3
        AND s.estado_reset = 'expirado'
        AND j.id = s.job_id
        AND j.status = $4
      RETURNING j.id`,
    [operationId, loteNumero, GRUPOS_RESET.EXPIRAR, STATUS_EXPIRADO_OPERACIONAL]
  );

  await client.query(
    `UPDATE engine_reset_operacional_snapshot
        SET estado_reset = 'rollback',
            atualizado_em = NOW()
      WHERE operation_id = $1
        AND lote_numero = $2
        AND grupo_acao = $3
        AND job_id = ANY($4::bigint[])`,
    [operationId, loteNumero, GRUPOS_RESET.EXPIRAR, resultado.rows.map(row => row.id)]
  );

  return {
    restaurados: resultado.rowCount,
    pulados: 0
  };
}

async function restaurarJobsArquivados(client, { operationId, loteNumero }) {
  const resultado = await client.query(
    `INSERT INTO engine_jobs_cliente (
       id, uuid, evento_id, oferta_id, cliente_id, marketplace_detectado,
       marketplace, categoria, score, prioridade, link_afiliado, status,
       tentativas, motivo_final, metadata, criado_em, atualizado_em
     )
     SELECT
       (a.job_payload->>'id')::bigint,
       (a.job_payload->>'uuid')::uuid,
       (a.job_payload->>'evento_id')::bigint,
       NULLIF(a.job_payload->>'oferta_id', '')::bigint,
       a.job_payload->>'cliente_id',
       a.job_payload->>'marketplace_detectado',
       a.job_payload->>'marketplace',
       a.job_payload->>'categoria',
       NULLIF(a.job_payload->>'score', '')::numeric,
       COALESCE(NULLIF(a.job_payload->>'prioridade', '')::int, 0),
       a.job_payload->>'link_afiliado',
       a.job_payload->>'status',
       COALESCE(NULLIF(a.job_payload->>'tentativas', '')::int, 0),
       a.job_payload->>'motivo_final',
       COALESCE(a.job_payload->'metadata', '{}'::jsonb),
       (a.job_payload->>'criado_em')::timestamptz,
       (a.job_payload->>'atualizado_em')::timestamptz
      FROM engine_jobs_cliente_arquivo a
      LEFT JOIN engine_jobs_cliente j ON j.id = a.job_id_original
     WHERE a.operation_id = $1
       AND a.lote_numero = $2
       AND j.id IS NULL
     ON CONFLICT (id) DO NOTHING
     RETURNING id`,
    [operationId, loteNumero]
  );

  return resultado.rows.map(row => Number(row.id));
}

async function restaurarProcessamentosArquivados(client, { operationId, loteNumero }) {
  const resultado = await client.query(
    `INSERT INTO engine_processamentos (
       id, uuid, job_id, etapa, status, motivo, detalhes, criado_em
     )
     SELECT
       (a.processamento_payload->>'id')::bigint,
       (a.processamento_payload->>'uuid')::uuid,
       (a.processamento_payload->>'job_id')::bigint,
       a.processamento_payload->>'etapa',
       a.processamento_payload->>'status',
       a.processamento_payload->>'motivo',
       COALESCE(a.processamento_payload->'detalhes', '{}'::jsonb),
       (a.processamento_payload->>'criado_em')::timestamptz
      FROM engine_processamentos_arquivo a
      JOIN engine_jobs_cliente j ON j.id = a.job_id_original
      LEFT JOIN engine_processamentos p ON p.id = a.processamento_id_original
     WHERE a.operation_id = $1
       AND a.lote_numero = $2
       AND p.id IS NULL
     ON CONFLICT (id) DO NOTHING
     RETURNING id`,
    [operationId, loteNumero]
  );

  return resultado.rowCount;
}

async function rollbackLoteArquivado(client, { operationId, loteNumero }) {
  const restauradosIds = await restaurarJobsArquivados(client, { operationId, loteNumero });
  const processamentosRestaurados = await restaurarProcessamentosArquivados(client, { operationId, loteNumero });

  await client.query(
    `UPDATE engine_reset_operacional_snapshot
        SET estado_reset = 'rollback',
            atualizado_em = NOW()
      WHERE operation_id = $1
        AND lote_numero = $2
        AND grupo_acao = $3
        AND job_id = ANY($4::bigint[])`,
    [operationId, loteNumero, GRUPOS_RESET.ARQUIVAR, restauradosIds]
  );

  const totalSnapshot = await client.query(
    `SELECT COUNT(*)::int AS total
       FROM engine_reset_operacional_snapshot
      WHERE operation_id = $1
        AND lote_numero = $2
        AND grupo_acao = $3`,
    [operationId, loteNumero, GRUPOS_RESET.ARQUIVAR]
  );

  return {
    restaurados: restauradosIds.length,
    processamentosRestaurados,
    pulados: Math.max(0, Number(totalSnapshot.rows[0]?.total || 0) - restauradosIds.length)
  };
}

async function rollbackLoteReset(client, lote = {}) {
  let resultado;
  if (lote.grupo_acao === GRUPOS_RESET.EXPIRAR) {
    resultado = await rollbackLoteExpirado(client, {
      operationId: lote.operation_id,
      loteNumero: lote.lote_numero
    });
  } else if (lote.grupo_acao === GRUPOS_RESET.ARQUIVAR) {
    resultado = await rollbackLoteArquivado(client, {
      operationId: lote.operation_id,
      loteNumero: lote.lote_numero
    });
  } else {
    resultado = { restaurados: 0, pulados: Number(lote.total_snapshot || 0) };
  }

  const status = resultado.pulados > 0 ? "rollback_parcial" : "rollback";
  await client.query(
    `UPDATE engine_reset_operacional_lotes
        SET status = $3,
            total_pulados_concorrencia = $4,
            atualizado_em = NOW()
      WHERE operation_id = $1
        AND lote_numero = $2`,
    [lote.operation_id, lote.lote_numero, status, resultado.pulados || 0]
  );

  logResetRollback({
    operationId: lote.operation_id,
    loteNumero: lote.lote_numero,
    grupoAcao: lote.grupo_acao,
    restaurados: resultado.restaurados || 0,
    processamentosRestaurados: resultado.processamentosRestaurados || 0,
    pulados: resultado.pulados || 0
  });

  return resultado;
}

module.exports = {
  rollbackLoteArquivado,
  rollbackLoteExpirado,
  rollbackLoteReset
};
