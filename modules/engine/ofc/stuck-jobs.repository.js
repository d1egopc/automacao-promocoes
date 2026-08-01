const { queryEngine } = require("../database");

async function consultarJobsEmCursoSuspeitos({ limite = 100 } = {}) {
  const totalLimite = Math.max(1, Math.min(500, Math.floor(Number(limite) || 100)));
  return queryEngine(
    `WITH ultimo AS (
       SELECT DISTINCT ON (job_id)
              job_id, etapa, status, motivo, criado_em
         FROM engine_processamentos
        ORDER BY job_id, criado_em DESC, id DESC
     )
     SELECT j.id AS job_id,
            j.status,
            COALESCE(NULLIF(TRIM(j.marketplace), ''), NULLIF(TRIM(j.marketplace_detectado), ''), 'desconhecido') AS marketplace,
            j.cliente_id AS workspace,
            j.criado_em,
            j.atualizado_em,
            j.oferta_id,
            u.etapa AS ultimo_processamento_etapa,
            u.status AS ultimo_processamento_status,
            u.motivo AS ultimo_processamento_motivo,
            u.criado_em AS ultimo_processamento_em,
            EXTRACT(EPOCH FROM (NOW() - j.criado_em))::bigint AS idade_segundos,
            CASE
              WHEN j.criado_em <= NOW() - INTERVAL '30 minutes' THEN 'suspeito_lock'
              ELSE 'em_curso_recente'
            END AS classificacao_suspeita
       FROM engine_jobs_cliente j
       LEFT JOIN ultimo u ON u.job_id = j.id
      WHERE j.status IN ('processando', 'importando')
      ORDER BY j.criado_em ASC, j.id ASC
      LIMIT $1`,
    [totalLimite]
  );
}

module.exports = {
  consultarJobsEmCursoSuspeitos
};
