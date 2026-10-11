const { queryEngine } = require("./database");
const { STATUS_JOBS_ATIVOS_COM_LEASE } = require("./jobs.service");
const {
  calcularCotasFrescorPreImporter
} = require("./frescor-pre-importer.service");
const {
  logEngineProcessadorEtapa,
  logEngineProcessadorErro
} = require("./logger");

function limitarJobs(valor = 20) {
  const numero = Number(valor || 20);
  if (!Number.isFinite(numero) || numero <= 0) return 20;
  return Math.min(Math.floor(numero), 100);
}

function sqlBuscarJobsPendentes() {
  return `WITH base AS (
       SELECT j.id, j.uuid, j.evento_id, j.oferta_id, j.cliente_id, j.marketplace_detectado,
              j.marketplace, j.status, j.motivo_final, j.metadata, j.prioridade,
              j.criado_em, j.atualizado_em,
              e.capturado_em AS evento_capturado_em,
              e.criado_em AS evento_criado_em,
              e.origem AS evento_origem,
              e.origem_tipo AS evento_origem_tipo,
              e.metadata AS evento_metadata,
              COALESCE(NULLIF(TRIM(j.cliente_id), ''), 'workspace_desconhecido') AS workspace_chave_pre_importer,
              CASE
                WHEN LOWER(COALESCE(
                  NULLIF(j.metadata->>'origemFluxo', ''),
                  NULLIF(j.metadata->>'origem_fluxo', ''),
                  NULLIF(j.metadata #>> '{metadataEvento,origemFluxo}', ''),
                  NULLIF(j.metadata #>> '{metadataEvento,origem_fluxo}', ''),
                  NULLIF(e.metadata->>'origemFluxo', ''),
                  NULLIF(e.metadata->>'origem_fluxo', '')
                )) IN ('optimus', 'clonador_grupos')
                  THEN LOWER(COALESCE(
                    NULLIF(j.metadata->>'origemFluxo', ''),
                    NULLIF(j.metadata->>'origem_fluxo', ''),
                    NULLIF(j.metadata #>> '{metadataEvento,origemFluxo}', ''),
                    NULLIF(j.metadata #>> '{metadataEvento,origem_fluxo}', ''),
                    NULLIF(e.metadata->>'origemFluxo', ''),
                    NULLIF(e.metadata->>'origem_fluxo', '')
                  ))
                ELSE ''
              END AS origem_fluxo_explicita_pre_importer,
              COALESCE(e.capturado_em, j.criado_em) AS origem_comercial_pre_importer,
              CASE
                WHEN COALESCE(e.capturado_em, j.criado_em) < NOW() - INTERVAL '30 minutes' THEN 1
                ELSE 0
              END AS bucket_frescor_pre_importer,
              CASE
                WHEN COALESCE(e.capturado_em, j.criado_em) < NOW() - INTERVAL '30 minutes' THEN 'expirada'
                WHEN COALESCE(e.capturado_em, j.criado_em) >= NOW() - INTERVAL '5 minutes' THEN 'agua_nova'
                WHEN COALESCE(e.capturado_em, j.criado_em) < NOW() - INTERVAL '20 minutes' THEN 'fresca_em_risco'
                ELSE 'fresca_circulavel'
              END AS lane_vazao_pre_importer
         FROM engine_jobs_cliente j
         LEFT JOIN engine_eventos_brutos e ON e.id = j.evento_id
        WHERE j.status = 'pendente'
     ),
     agua_nova_ranked AS (
       SELECT *,
              ROW_NUMBER() OVER (
                PARTITION BY COALESCE(NULLIF(TRIM(cliente_id), ''), 'workspace_desconhecido')
                ORDER BY COALESCE(prioridade, 0) DESC, origem_comercial_pre_importer DESC, criado_em DESC, id ASC
              ) AS workspace_rank_pre_importer,
              ROW_NUMBER() OVER (
                PARTITION BY workspace_chave_pre_importer, origem_fluxo_explicita_pre_importer
                ORDER BY COALESCE(prioridade, 0) DESC, origem_comercial_pre_importer DESC, criado_em DESC, id ASC
              ) AS origem_head_rank_pre_importer
         FROM base
        WHERE lane_vazao_pre_importer = 'agua_nova'
     ),
     agua_nova AS (
       SELECT *, 0 AS bucket_selecao_pre_importer
         FROM agua_nova_ranked
        ORDER BY workspace_rank_pre_importer ASC, COALESCE(prioridade, 0) DESC, origem_comercial_pre_importer DESC, criado_em DESC, id ASC
        LIMIT $1
     ),
     fresca_em_risco_ranked AS (
       SELECT *,
              ROW_NUMBER() OVER (
                PARTITION BY COALESCE(NULLIF(TRIM(cliente_id), ''), 'workspace_desconhecido')
                ORDER BY COALESCE(prioridade, 0) DESC, origem_comercial_pre_importer ASC, criado_em ASC, id ASC
              ) AS workspace_rank_pre_importer,
              ROW_NUMBER() OVER (
                PARTITION BY workspace_chave_pre_importer, origem_fluxo_explicita_pre_importer
                ORDER BY COALESCE(prioridade, 0) DESC, origem_comercial_pre_importer ASC, criado_em ASC, id ASC
              ) AS origem_head_rank_pre_importer
         FROM base
        WHERE lane_vazao_pre_importer = 'fresca_em_risco'
     ),
     fresca_em_risco AS (
       SELECT *, 1 AS bucket_selecao_pre_importer
         FROM fresca_em_risco_ranked
        ORDER BY workspace_rank_pre_importer ASC, COALESCE(prioridade, 0) DESC, origem_comercial_pre_importer ASC, criado_em ASC, id ASC
        LIMIT $2
     ),
     fresca_circulavel_ranked AS (
       SELECT *,
              ROW_NUMBER() OVER (
                PARTITION BY COALESCE(NULLIF(TRIM(cliente_id), ''), 'workspace_desconhecido')
                ORDER BY COALESCE(prioridade, 0) DESC, origem_comercial_pre_importer DESC, criado_em DESC, id ASC
              ) AS workspace_rank_pre_importer,
              ROW_NUMBER() OVER (
                PARTITION BY workspace_chave_pre_importer, origem_fluxo_explicita_pre_importer
                ORDER BY COALESCE(prioridade, 0) DESC, origem_comercial_pre_importer DESC, criado_em DESC, id ASC
              ) AS origem_head_rank_pre_importer
         FROM base
        WHERE lane_vazao_pre_importer = 'fresca_circulavel'
     ),
     fresca_circulavel AS (
       SELECT *, 2 AS bucket_selecao_pre_importer
         FROM fresca_circulavel_ranked
        ORDER BY workspace_rank_pre_importer ASC, COALESCE(prioridade, 0) DESC, origem_comercial_pre_importer DESC, criado_em DESC, id ASC
        LIMIT $3
     ),
     limpeza_ranked AS (
       SELECT *,
              ROW_NUMBER() OVER (
                PARTITION BY COALESCE(NULLIF(TRIM(cliente_id), ''), 'workspace_desconhecido')
                ORDER BY origem_comercial_pre_importer ASC, criado_em ASC, id ASC
              ) AS workspace_rank_pre_importer,
              ROW_NUMBER() OVER (
                PARTITION BY workspace_chave_pre_importer, origem_fluxo_explicita_pre_importer
                ORDER BY origem_comercial_pre_importer ASC, criado_em ASC, id ASC
              ) AS origem_head_rank_pre_importer
         FROM base
        WHERE lane_vazao_pre_importer = 'expirada'
     ),
     limpeza AS (
       SELECT *, 3 AS bucket_selecao_pre_importer
         FROM limpeza_ranked
        ORDER BY workspace_rank_pre_importer ASC, origem_comercial_pre_importer ASC, criado_em ASC, id ASC
        LIMIT $4
     ),
     baseline_bruto AS (
       SELECT * FROM agua_nova
       UNION ALL
       SELECT * FROM fresca_em_risco
       UNION ALL
       SELECT * FROM fresca_circulavel
       UNION ALL
       SELECT * FROM limpeza
     ),
     baseline AS (
       SELECT *,
              ROW_NUMBER() OVER (
                ORDER BY bucket_selecao_pre_importer ASC,
                         workspace_rank_pre_importer ASC,
                         COALESCE(prioridade, 0) DESC,
                         CASE WHEN lane_vazao_pre_importer = 'fresca_em_risco' THEN origem_comercial_pre_importer END ASC NULLS LAST,
                         CASE WHEN lane_vazao_pre_importer <> 'fresca_em_risco' THEN origem_comercial_pre_importer END DESC NULLS LAST,
                         criado_em DESC,
                         id ASC
              ) AS baseline_ordem_pre_importer
         FROM baseline_bruto
        ORDER BY bucket_selecao_pre_importer ASC,
                 workspace_rank_pre_importer ASC,
                 COALESCE(prioridade, 0) DESC,
                 CASE WHEN lane_vazao_pre_importer = 'fresca_em_risco' THEN origem_comercial_pre_importer END ASC NULLS LAST,
                 CASE WHEN lane_vazao_pre_importer <> 'fresca_em_risco' THEN origem_comercial_pre_importer END DESC NULLS LAST,
                 criado_em DESC,
                 id ASC
        LIMIT $5
     ),
     grupos_representados_baseline AS (
       SELECT DISTINCT workspace_chave_pre_importer, lane_vazao_pre_importer
         FROM baseline
     ),
     heads_protegidas_brutas AS (
       SELECT ranked.*, 0 AS bucket_selecao_pre_importer, NULL::bigint AS baseline_ordem_pre_importer
         FROM agua_nova_ranked ranked
         JOIN grupos_representados_baseline grupos
           ON grupos.workspace_chave_pre_importer = ranked.workspace_chave_pre_importer
          AND grupos.lane_vazao_pre_importer = ranked.lane_vazao_pre_importer
        WHERE ranked.origem_head_rank_pre_importer = 1
          AND ranked.origem_fluxo_explicita_pre_importer IN ('optimus', 'clonador_grupos')
       UNION ALL
       SELECT ranked.*, 1 AS bucket_selecao_pre_importer, NULL::bigint AS baseline_ordem_pre_importer
         FROM fresca_em_risco_ranked ranked
         JOIN grupos_representados_baseline grupos
           ON grupos.workspace_chave_pre_importer = ranked.workspace_chave_pre_importer
          AND grupos.lane_vazao_pre_importer = ranked.lane_vazao_pre_importer
        WHERE ranked.origem_head_rank_pre_importer = 1
          AND ranked.origem_fluxo_explicita_pre_importer IN ('optimus', 'clonador_grupos')
       UNION ALL
       SELECT ranked.*, 2 AS bucket_selecao_pre_importer, NULL::bigint AS baseline_ordem_pre_importer
         FROM fresca_circulavel_ranked ranked
         JOIN grupos_representados_baseline grupos
           ON grupos.workspace_chave_pre_importer = ranked.workspace_chave_pre_importer
          AND grupos.lane_vazao_pre_importer = ranked.lane_vazao_pre_importer
        WHERE ranked.origem_head_rank_pre_importer = 1
          AND ranked.origem_fluxo_explicita_pre_importer IN ('optimus', 'clonador_grupos')
       UNION ALL
       SELECT ranked.*, 3 AS bucket_selecao_pre_importer, NULL::bigint AS baseline_ordem_pre_importer
         FROM limpeza_ranked ranked
         JOIN grupos_representados_baseline grupos
           ON grupos.workspace_chave_pre_importer = ranked.workspace_chave_pre_importer
          AND grupos.lane_vazao_pre_importer = ranked.lane_vazao_pre_importer
        WHERE ranked.origem_head_rank_pre_importer = 1
          AND ranked.origem_fluxo_explicita_pre_importer IN ('optimus', 'clonador_grupos')
     ),
     candidate_pool_bruto AS (
       SELECT *, 'baseline'::text AS candidate_pool_origem_pre_importer
         FROM baseline
       UNION ALL
       SELECT *, 'head_protegida'::text AS candidate_pool_origem_pre_importer
         FROM heads_protegidas_brutas
     ),
     candidate_pool_ranqueado AS (
       SELECT *,
              ROW_NUMBER() OVER (
                PARTITION BY id
                ORDER BY CASE WHEN candidate_pool_origem_pre_importer = 'baseline' THEN 0 ELSE 1 END,
                         baseline_ordem_pre_importer ASC NULLS LAST,
                         origem_head_rank_pre_importer ASC,
                         id ASC
              ) AS candidate_pool_dedup_rank_pre_importer
         FROM candidate_pool_bruto
     ),
     candidate_pool AS (
       SELECT *
         FROM candidate_pool_ranqueado
        WHERE candidate_pool_dedup_rank_pre_importer = 1
     ),
     saida_pre_importer AS (
       SELECT 'baseline'::text AS tipo_saida_pre_importer, baseline.*,
              NULL::text AS candidate_pool_origem_pre_importer,
              NULL::bigint AS candidate_pool_dedup_rank_pre_importer
         FROM baseline
       UNION ALL
       SELECT 'candidate_pool'::text AS tipo_saida_pre_importer, *
         FROM candidate_pool
     )
     SELECT *
       FROM saida_pre_importer
      ORDER BY CASE WHEN tipo_saida_pre_importer = 'baseline' THEN 0 ELSE 1 END,
               baseline_ordem_pre_importer ASC NULLS LAST,
               bucket_selecao_pre_importer ASC,
               workspace_rank_pre_importer ASC,
               id ASC`;
}

function removerCamposInternosPreImporter(linha = {}) {
  const {
    tipo_saida_pre_importer,
    workspace_chave_pre_importer,
    origem_fluxo_explicita_pre_importer,
    origem_head_rank_pre_importer,
    baseline_ordem_pre_importer,
    candidate_pool_origem_pre_importer,
    candidate_pool_dedup_rank_pre_importer,
    ...job
  } = linha;
  return job;
}

function separarResultadoJobsPendentes(linhas = []) {
  const resultado = Array.isArray(linhas) ? linhas : [];
  return {
    jobs: resultado
      .filter(linha => linha.tipo_saida_pre_importer === "baseline")
      .map(removerCamposInternosPreImporter),
    candidatePool: resultado
      .filter(linha => linha.tipo_saida_pre_importer === "candidate_pool")
      .map(linha => {
        const job = removerCamposInternosPreImporter(linha);
        const origemFluxo = String(linha.origem_fluxo_explicita_pre_importer || "").trim();
        return origemFluxo
          ? {
            ...job,
            origemFluxo,
            origemFluxoHead: Number(linha.origem_head_rank_pre_importer) === 1
          }
          : job;
      })
  };
}

async function buscarJobsPendentes(limite = 20) {
  const cotas = calcularCotasFrescorPreImporter(limite);
  const resultado = await queryEngine(
    sqlBuscarJobsPendentes(),
    [cotas.aguaNova, cotas.frescaEmRisco, cotas.frescaCirculavel, cotas.limpeza, cotas.totalSelecao]
  );

  if (!resultado.ok) return { ok: false, jobs: [], motivo: resultado.motivo, erro: resultado.erro };
  return { ok: true, ...separarResultadoJobsPendentes(resultado.resultado?.rows) };
}

async function marcarJobStatus(jobId, status, motivo = "", extras = {}) {
  const campos = ["status = $2", "motivo_final = $3", "atualizado_em = NOW()"];
  const params = [jobId, status, motivo || null];
  const statusEsperado = Array.isArray(extras.statusEsperado)
    ? extras.statusEsperado.map(item => String(item || "").trim()).filter(Boolean)
    : String(extras.statusEsperado || "").trim()
      ? [String(extras.statusEsperado).trim()]
      : [];

  if (Object.prototype.hasOwnProperty.call(extras, "marketplace")) {
    params.push(extras.marketplace || null);
    campos.push(`marketplace = $${params.length}`);
  }

  if (Object.prototype.hasOwnProperty.call(extras, "marketplaceDetectado")) {
    params.push(extras.marketplaceDetectado || null);
    campos.push(`marketplace_detectado = $${params.length}`);
  }

  if (Object.prototype.hasOwnProperty.call(extras, "categoria")) {
    params.push(extras.categoria || null);
    campos.push(`categoria = $${params.length}`);
  }

  if (Object.prototype.hasOwnProperty.call(extras, "score")) {
    params.push(extras.score || null);
    campos.push(`score = $${params.length}`);
  }

  const filtros = ["id = $1"];
  if (statusEsperado.length) {
    params.push(statusEsperado);
    filtros.push(`status = ANY($${params.length}::text[])`);
  }

  const resultado = await queryEngine(
    `UPDATE engine_jobs_cliente
        SET ${campos.join(", ")}
      WHERE ${filtros.join(" AND ")}
      RETURNING id, status`,
    params
  );

  if (!resultado.ok) {
    logEngineProcessadorErro({ jobId, etapa: "marcar_status", status, motivo: resultado.motivo || "update_falhou", erro: resultado.erro || "" });
  }

  if (resultado.ok && statusEsperado.length && resultado.resultado.rowCount === 0) {
    logEngineProcessadorErro({ jobId, etapa: "marcar_status", status, motivo: "status_origem_incompativel", erro: "" });
    return { ...resultado, ok: false, ignorado: true, motivo: "status_origem_incompativel" };
  }

  return resultado;
}

async function renovarHeartbeatJobAtivo(jobId) {
  const resultado = await queryEngine(
    `UPDATE engine_jobs_cliente
        SET atualizado_em = NOW()
      WHERE id = $1
        AND status = ANY($2::text[])
      RETURNING id, status`,
    [jobId, STATUS_JOBS_ATIVOS_COM_LEASE]
  );

  if (!resultado.ok) {
    logEngineProcessadorErro({ jobId, etapa: "heartbeat_job_ativo", motivo: resultado.motivo || "heartbeat_falhou", erro: resultado.erro || "" });
  }

  return resultado;
}

async function reivindicarJobsProcessandoComExecutor(executor, jobIds = []) {
  const ids = [...new Set((Array.isArray(jobIds) ? jobIds : [jobIds])
    .map(id => Number(id))
    .filter(id => Number.isSafeInteger(id) && id > 0))];
  if (!ids.length) return { ok: true, jobs: [], ignorado: true };

  const sql = `UPDATE engine_jobs_cliente
                 SET status = 'processando', atualizado_em = NOW()
               WHERE id = ANY($1::bigint[]) AND status = 'pendente'
               RETURNING id, status`;
  let resultado;
  try {
    if (executor && typeof executor.query === "function") {
      const resposta = await executor.query(sql, [ids]);
      resultado = { ok: true, resultado: resposta };
    } else {
      resultado = await queryEngine(sql, [ids]);
    }
  } catch (erro) {
    return { ok: false, motivo: "claim_falhou", erro: erro.message || String(erro), jobs: [] };
  }

  if (!resultado.ok) return { ok: false, motivo: resultado.motivo, erro: resultado.erro, jobs: [] };
  const jobs = Array.isArray(resultado.resultado?.rows) ? resultado.resultado.rows : [];
  return { ok: true, jobs, ignorado: jobs.length === 0 };
}

async function tentarMarcarProcessando(jobId) {
  const resultado = await reivindicarJobsProcessandoComExecutor(null, [jobId]);
  if (!resultado.ok) return resultado;
  return { ok: resultado.jobs.length > 0, ignorado: resultado.jobs.length === 0 };
}

async function registrarProcessamento(jobId, etapa, status, motivo = "", detalhes = {}) {
  const resultado = await queryEngine(
    `INSERT INTO engine_processamentos (job_id, etapa, status, motivo, detalhes)
     VALUES ($1, $2, $3, $4, $5::jsonb)
     RETURNING id`,
    [jobId, etapa, status, motivo || null, JSON.stringify(detalhes || {})]
  );

  logEngineProcessadorEtapa({ jobId, etapa, status, motivo });

  if (!resultado.ok) {
    logEngineProcessadorErro({ jobId, etapa, motivo: resultado.motivo || "processamento_insert_falhou", erro: resultado.erro || "" });
  } else {
    await renovarHeartbeatJobAtivo(jobId);
  }

  return resultado;
}

async function carregarEventoBruto(eventoId) {
  const resultado = await queryEngine(
    `SELECT id, uuid, origem, origem_tipo, sessao_id, grupo_id, grupo_nome,
            texto_original, links_extraidos, marketplace_detectado, metadata,
            capturado_em, criado_em
       FROM engine_eventos_brutos
      WHERE id = $1
      LIMIT 1`,
    [eventoId]
  );

  if (!resultado.ok) return { ok: false, motivo: resultado.motivo, erro: resultado.erro };
  return { ok: true, evento: resultado.resultado.rows[0] || null };
}

async function carregarLinksEvento(eventoId) {
  const resultado = await queryEngine(
     `SELECT id, uuid, evento_id, url_original, url_normalizada, url_expandida,
             dominio_original, dominio_final, redirect_ok, motivo_redirect,
             marketplace_detectado, metadata, criado_em
        FROM engine_links
      WHERE evento_id = $1
      ORDER BY id ASC`,
    [eventoId]
  );

  if (!resultado.ok) return { ok: false, motivo: resultado.motivo, erro: resultado.erro, links: [] };
  return { ok: true, links: resultado.resultado.rows };
}

module.exports = {
  limitarJobs,
  sqlBuscarJobsPendentes,
  removerCamposInternosPreImporter,
  separarResultadoJobsPendentes,
  buscarJobsPendentes,
  marcarJobStatus,
  renovarHeartbeatJobAtivo,
  reivindicarJobsProcessandoComExecutor,
  tentarMarcarProcessando,
  registrarProcessamento,
  carregarEventoBruto,
  carregarLinksEvento
};
