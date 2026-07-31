"use strict";

const {
  GRUPOS_RESET,
  STATUS_PRESERVAR,
  STATUS_EXPIRAR,
  STATUS_ARQUIVAR,
  STATUS_EXPIRADO_OPERACIONAL,
  MOTIVO_RESET_FLUXO_VIVO
} = require("./criterios.service");

function classificacaoSql() {
  return `
    WITH params AS (SELECT $1::timestamptz AS cutoff),
    base AS (
      SELECT
        j.*,
        COALESCE(NULLIF(TRIM(j.marketplace), ''), NULLIF(TRIM(j.marketplace_detectado), ''), 'desconhecido') AS marketplace_reset,
        CASE
          WHEN j.status = ANY($2::text[]) THEN '${GRUPOS_RESET.PRESERVAR}'
          WHEN j.criado_em >= (SELECT cutoff FROM params) THEN '${GRUPOS_RESET.PRESERVAR}'
          WHEN j.status = ANY($3::text[]) AND j.criado_em < (SELECT cutoff FROM params) THEN '${GRUPOS_RESET.EXPIRAR}'
          WHEN j.status = ANY($4::text[]) AND j.criado_em < (SELECT cutoff FROM params) THEN '${GRUPOS_RESET.ARQUIVAR}'
          ELSE '${GRUPOS_RESET.NAO_CLASSIFICADO}'
        END AS grupo_acao
      FROM engine_jobs_cliente j
    )
  `;
}

function paramsClassificacao(cutoffCongelado) {
  return [cutoffCongelado, STATUS_PRESERVAR, STATUS_EXPIRAR, STATUS_ARQUIVAR];
}

async function consultarDryRunReset(client, { cutoffCongelado }) {
  const params = paramsClassificacao(cutoffCongelado);
  const prefixo = classificacaoSql();

  async function q(sql) {
    const resultado = await client.query(prefixo + sql, params);
    return resultado.rows;
  }

  const totais = await q(`
    SELECT grupo_acao AS grupo, COUNT(*)::int AS total,
           MIN(criado_em) AS criado_min, MAX(criado_em) AS criado_max,
           MIN(id)::bigint AS id_min, MAX(id)::bigint AS id_max
      FROM base
     GROUP BY grupo_acao
     ORDER BY grupo_acao
  `);

  const porStatus = await q(`
    SELECT grupo_acao AS grupo, status, COUNT(*)::int AS total
      FROM base
     GROUP BY grupo_acao, status
     ORDER BY grupo_acao, total DESC, status
  `);

  const porMarketplace = await q(`
    SELECT grupo_acao AS grupo, marketplace_reset AS marketplace, COUNT(*)::int AS total
      FROM base
     GROUP BY grupo_acao, marketplace_reset
     ORDER BY grupo_acao, total DESC, marketplace_reset
  `);

  const porCliente = await q(`
    SELECT grupo_acao AS grupo, cliente_id, COUNT(*)::int AS total
      FROM base
     GROUP BY grupo_acao, cliente_id
     ORDER BY grupo_acao, total DESC, cliente_id
  `);

  const recentes = await q(`
    SELECT grupo_acao AS grupo, COUNT(*)::int AS total_criado_apos_cutoff
      FROM base, params
     WHERE criado_em >= params.cutoff
     GROUP BY grupo_acao
     ORDER BY grupo_acao
  `);

  const idsHash = await q(`
    SELECT grupo_acao AS grupo,
           COUNT(*)::int AS total,
           md5(string_agg(id::text, ',' ORDER BY id)) AS ids_hash
      FROM base
     WHERE grupo_acao IN ('${GRUPOS_RESET.EXPIRAR}', '${GRUPOS_RESET.ARQUIVAR}', '${GRUPOS_RESET.NAO_CLASSIFICADO}')
     GROUP BY grupo_acao
     ORDER BY grupo_acao
  `);

  const naoClassificados = await q(`
    SELECT status, COUNT(*)::int AS total,
           MIN(id)::bigint AS id_min, MAX(id)::bigint AS id_max,
           MIN(criado_em) AS criado_min, MAX(criado_em) AS criado_max
      FROM base
     WHERE grupo_acao = '${GRUPOS_RESET.NAO_CLASSIFICADO}'
     GROUP BY status
     ORDER BY total DESC, status
  `);

  return {
    totais,
    porStatus,
    porMarketplace,
    porCliente,
    recentes,
    idsHash,
    naoClassificados
  };
}

async function limparSnapshotOperacao(client, operationId) {
  await client.query("DELETE FROM engine_reset_operacional_lotes WHERE operation_id = $1", [operationId]);
  await client.query("DELETE FROM engine_reset_operacional_snapshot WHERE operation_id = $1", [operationId]);
}

async function materializarSnapshotReset(client, { operationId, cutoffCongelado, criterioHash, loteTamanho }) {
  await limparSnapshotOperacao(client, operationId);

  const params = [
    cutoffCongelado,
    STATUS_PRESERVAR,
    STATUS_EXPIRAR,
    STATUS_ARQUIVAR,
    operationId,
    criterioHash,
    Number(loteTamanho) || 1000
  ];

  const resultadoSnapshot = await client.query(`
    ${classificacaoSql()},
    candidatos AS (
      SELECT
        base.*,
        CEIL((ROW_NUMBER() OVER (
          ORDER BY
            CASE grupo_acao
              WHEN '${GRUPOS_RESET.EXPIRAR}' THEN 1
              WHEN '${GRUPOS_RESET.ARQUIVAR}' THEN 2
              ELSE 3
            END,
            id ASC
        ))::numeric / $7::numeric)::int AS lote_numero
      FROM base
      WHERE grupo_acao IN ('${GRUPOS_RESET.EXPIRAR}', '${GRUPOS_RESET.ARQUIVAR}', '${GRUPOS_RESET.NAO_CLASSIFICADO}')
    )
    INSERT INTO engine_reset_operacional_snapshot (
      operation_id, lote_numero, job_id, grupo_acao, status_anterior,
      motivo_anterior, criado_em_original, atualizado_em_original,
      cliente_id, marketplace, job_payload, criterio_hash
    )
    SELECT
      $5,
      lote_numero,
      id,
      grupo_acao,
      status,
      motivo_final,
      criado_em,
      atualizado_em,
      cliente_id,
      marketplace_reset,
      to_jsonb(candidatos),
      $6
    FROM candidatos
    ORDER BY lote_numero, id
    RETURNING lote_numero, grupo_acao, job_id
  `, params);

  await client.query(`
    INSERT INTO engine_reset_operacional_lotes (
      operation_id, lote_numero, grupo_acao, status, total_snapshot
    )
    SELECT operation_id, lote_numero, grupo_acao, 'pendente', COUNT(*)::int
      FROM engine_reset_operacional_snapshot
     WHERE operation_id = $1
     GROUP BY operation_id, lote_numero, grupo_acao
     ORDER BY lote_numero
  `, [operationId]);

  return {
    totalSnapshot: resultadoSnapshot.rowCount,
    lotes: resultadoSnapshot.rows.reduce((acc, row) => {
      acc[row.lote_numero] = (acc[row.lote_numero] || 0) + 1;
      return acc;
    }, {})
  };
}

async function calcularIdsHashSnapshot(client, operationId) {
  const resultado = await client.query(
    `SELECT grupo_acao AS grupo,
            COUNT(*)::int AS total,
            md5(string_agg(job_id::text, ',' ORDER BY job_id)) AS ids_hash
       FROM engine_reset_operacional_snapshot
      WHERE operation_id = $1
        AND grupo_acao IN ($2, $3, $4)
      GROUP BY grupo_acao
      ORDER BY grupo_acao`,
    [operationId, GRUPOS_RESET.EXPIRAR, GRUPOS_RESET.ARQUIVAR, GRUPOS_RESET.NAO_CLASSIFICADO]
  );

  return resultado.rows.reduce((acc, item) => {
    acc[item.grupo] = {
      total: Number(item.total || 0),
      idsHash: item.ids_hash || ""
    };
    return acc;
  }, {});
}

async function carregarSnapshotLote(client, { operationId, loteNumero, grupoAcao }) {
  const resultado = await client.query(
    `SELECT job_id, grupo_acao, status_anterior, motivo_anterior,
            criado_em_original, atualizado_em_original, job_payload
       FROM engine_reset_operacional_snapshot
      WHERE operation_id = $1
        AND lote_numero = $2
        AND grupo_acao = $3
      ORDER BY job_id ASC
      FOR UPDATE`,
    [operationId, loteNumero, grupoAcao]
  );
  return resultado.rows;
}

async function validarSnapshotContraJobsAtuais(client, { operationId, loteNumero, grupoAcao, cutoffCongelado }) {
  const resultado = await client.query(
    `SELECT COUNT(*)::int AS total_ok
       FROM engine_reset_operacional_snapshot s
       JOIN engine_jobs_cliente j ON j.id = s.job_id
      WHERE s.operation_id = $1
        AND s.lote_numero = $2
        AND s.grupo_acao = $3
        AND s.criterio_hash = (SELECT criterio_hash FROM engine_reset_operacional_operacoes WHERE operation_id = $1)
        AND j.status = s.status_anterior
        AND j.criado_em = s.criado_em_original
        AND j.criado_em < $4::timestamptz`,
    [operationId, loteNumero, grupoAcao, cutoffCongelado]
  );
  return Number(resultado.rows[0]?.total_ok || 0);
}

async function expirarLoteSnapshot(client, { operationId, loteNumero, grupoAcao }) {
  const resultado = await client.query(
    `UPDATE engine_jobs_cliente j
        SET status = $4,
            motivo_final = $5,
            atualizado_em = NOW()
       FROM engine_reset_operacional_snapshot s
      WHERE s.operation_id = $1
        AND s.lote_numero = $2
        AND s.grupo_acao = $3
        AND j.id = s.job_id
        AND j.status = s.status_anterior
        AND j.criado_em = s.criado_em_original
      RETURNING j.id`,
    [operationId, loteNumero, grupoAcao, STATUS_EXPIRADO_OPERACIONAL, MOTIVO_RESET_FLUXO_VIVO]
  );

  await client.query(
    `UPDATE engine_reset_operacional_snapshot
        SET estado_reset = 'expirado',
            atualizado_em = NOW()
      WHERE operation_id = $1
        AND lote_numero = $2
        AND grupo_acao = $3
        AND job_id = ANY($4::bigint[])`,
    [operationId, loteNumero, grupoAcao, resultado.rows.map(row => row.id)]
  );

  return resultado.rowCount;
}

async function arquivarProcessamentosLote(client, { operationId, loteNumero, grupoAcao }) {
  const resultado = await client.query(
    `INSERT INTO engine_processamentos_arquivo (
       operation_id, lote_numero, processamento_id_original, job_id_original, processamento_payload
     )
     SELECT $1, $2, p.id, p.job_id, to_jsonb(p)
       FROM engine_processamentos p
       JOIN engine_reset_operacional_snapshot s ON s.job_id = p.job_id
      WHERE s.operation_id = $1
        AND s.lote_numero = $2
        AND s.grupo_acao = $3
     ON CONFLICT (operation_id, processamento_id_original) DO NOTHING`,
    [operationId, loteNumero, grupoAcao]
  );
  return resultado.rowCount;
}

async function contarProcessamentosOriginaisLote(client, { operationId, loteNumero, grupoAcao }) {
  const resultado = await client.query(
    `SELECT COUNT(*)::int AS total
       FROM engine_processamentos p
       JOIN engine_reset_operacional_snapshot s ON s.job_id = p.job_id
      WHERE s.operation_id = $1
        AND s.lote_numero = $2
        AND s.grupo_acao = $3`,
    [operationId, loteNumero, grupoAcao]
  );
  return Number(resultado.rows[0]?.total || 0);
}

async function arquivarJobsLote(client, { operationId, loteNumero, grupoAcao }) {
  const resultado = await client.query(
    `INSERT INTO engine_jobs_cliente_arquivo (
       operation_id, lote_numero, job_id_original, status_original,
       cliente_id, marketplace, criado_em_original, job_payload
     )
     SELECT $1, $2, j.id, j.status, j.cliente_id,
            COALESCE(NULLIF(TRIM(j.marketplace), ''), NULLIF(TRIM(j.marketplace_detectado), ''), 'desconhecido'),
            j.criado_em, to_jsonb(j)
       FROM engine_jobs_cliente j
       JOIN engine_reset_operacional_snapshot s ON s.job_id = j.id
      WHERE s.operation_id = $1
        AND s.lote_numero = $2
        AND s.grupo_acao = $3
        AND j.status = s.status_anterior
        AND j.criado_em = s.criado_em_original
     ON CONFLICT (operation_id, job_id_original) DO NOTHING`,
    [operationId, loteNumero, grupoAcao]
  );
  return resultado.rowCount;
}

async function removerJobsArquivadosLote(client, { operationId, loteNumero, grupoAcao }) {
  const resultado = await client.query(
    `DELETE FROM engine_jobs_cliente j
      USING engine_reset_operacional_snapshot s,
            engine_jobs_cliente_arquivo a
      WHERE s.operation_id = $1
        AND s.lote_numero = $2
        AND s.grupo_acao = $3
        AND a.operation_id = s.operation_id
        AND a.job_id_original = s.job_id
        AND j.id = s.job_id
        AND j.status = s.status_anterior
        AND j.criado_em = s.criado_em_original
      RETURNING j.id`,
    [operationId, loteNumero, grupoAcao]
  );

  await client.query(
    `UPDATE engine_reset_operacional_snapshot
        SET estado_reset = 'arquivado',
            atualizado_em = NOW()
      WHERE operation_id = $1
        AND lote_numero = $2
        AND grupo_acao = $3
        AND job_id = ANY($4::bigint[])`,
    [operationId, loteNumero, grupoAcao, resultado.rows.map(row => row.id)]
  );

  return resultado.rowCount;
}

module.exports = {
  arquivarJobsLote,
  arquivarProcessamentosLote,
  calcularIdsHashSnapshot,
  carregarSnapshotLote,
  consultarDryRunReset,
  contarProcessamentosOriginaisLote,
  expirarLoteSnapshot,
  materializarSnapshotReset,
  removerJobsArquivadosLote,
  validarSnapshotContraJobsAtuais
};
