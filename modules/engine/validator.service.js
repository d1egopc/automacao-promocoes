const { queryEngine } = require("./database");
const {
  marcarJobStatus,
  registrarProcessamento,
  limitarJobs
} = require("./processor.service");
const {
  calcularCotasFrescorPreImporter
} = require("./frescor-pre-importer.service");
const { minutosLeaseJobsAtivos } = require("./jobs.service");
const { normalizarTexto } = require("./normalizers");
const { resolverOrigemFluxo } = require("../../utils/origem-fluxo");

function normalizarMarketplaceEngine(marketplace = "") {
  return normalizarTexto(marketplace).toLowerCase();
}

function chavesPossiveisIntegracaoEngine(marketplace = "") {
  const mp = normalizarMarketplaceEngine(marketplace);
  const chaves = new Set([mp]);

  if (mp === "mercadolivre") {
    chaves.add("mercadoLivre");
    chaves.add("mercado_livre");
    chaves.add("ml");
  }

  if (mp === "aliexpress") {
    chaves.add("aliExpress");
    chaves.add("ali_express");
  }

  if (mp === "magalu") {
    chaves.add("magazineluiza");
    chaves.add("magazine_luiza");
  }

  if (mp === "awin" || mp === "kabum") {
    ["awin", "feed_awin", "feedAwin", "feedkabum", "feed_kabum"].forEach(chave => chaves.add(chave));
    chaves.add("kabum");
  }

  return [...chaves].filter(Boolean);
}

function marketplacesEquivalentesEngine(marketplace = "") {
  const mp = normalizarMarketplaceEngine(marketplace);
  const equivalentes = new Set([mp]);
  if (mp === "kabum" || mp === "awin") {
    ["kabum", "awin", "feed_awin", "feedAwin", "feedkabum", "feed_kabum"].forEach(chave => equivalentes.add(normalizarMarketplaceEngine(chave)));
  }
  return [...equivalentes].filter(Boolean);
}

function obterIntegracaoClienteEngine(integracoesPorCliente = {}, clienteId = "", marketplace = "") {
  const cid = normalizarTexto(clienteId);
  if (!cid) return null;

  const integracoesCliente = integracoesPorCliente?.[cid] || null;
  if (!integracoesCliente) return null;

  for (const chave of chavesPossiveisIntegracaoEngine(marketplace)) {
    if (integracoesCliente[chave]) return integracoesCliente[chave];
  }

  return null;
}

function credenciaisValidasEngine(integracao = {}, marketplace = "") {
  const mp = normalizarMarketplaceEngine(marketplace);
  if (!integracao || integracao.ativo === false) return false;

  const cred = integracao.credenciais || {};

  if (mp === "amazon") {
    return Boolean(cred.tag || cred.trackingId || cred.partnerTag || cred.appId || cred.cookies);
  }

  if (mp === "mercadolivre") {
    return Boolean(cred.tag || cred.cookies);
  }

  if (mp === "shopee") {
    return Boolean(cred.appId && cred.secret);
  }

  if (mp === "aliexpress") {
    return Boolean(cred.appKey && (cred.secret || cred.appSecret) && cred.trackingId);
  }

  if (mp === "awin") {
    return Boolean(cred.publisherId && cred.apiToken);
  }

  return Object.values(cred).some(valor => String(valor || "").trim());
}

function clienteValidoEngine(clienteId = "", clientesValidos = [], opcoes = {}) {
  const cid = normalizarTexto(clienteId);
  if (!cid) return false;
  if (opcoes.origemFluxo === "clonador_grupos" && typeof opcoes.avaliarWorkspaceParaEngine === "function") {
    return opcoes.avaliarWorkspaceParaEngine(cid, {
      log: false,
      origemFluxo: "clonador_grupos"
    }).elegivelEngine === true;
  }
  const lista = Array.isArray(clientesValidos) ? clientesValidos.map(id => normalizarTexto(id)).filter(Boolean) : [];
  if (!lista.length) return false;
  return lista.includes(cid);
}

function marketplaceAtivoClienteEngine(clienteId = "", marketplace = "", marketplacesAtivosPorCliente = {}) {
  const cid = normalizarTexto(clienteId);
  const mp = normalizarMarketplaceEngine(marketplace);
  if (!cid || !mp) return false;

  const ativos = marketplacesAtivosPorCliente?.[cid];
  if (!ativos) return true;
  const equivalentes = marketplacesEquivalentesEngine(mp);
  if (Array.isArray(ativos)) {
    const normalizados = ativos.map(normalizarMarketplaceEngine);
    return equivalentes.some(chave => normalizados.includes(chave));
  }
  if (typeof ativos === "object") {
    let config;
    for (const chave of equivalentes) {
      if (ativos[chave] !== undefined) {
        config = ativos[chave];
        break;
      }
    }
    if (config === undefined) return true;
    if (typeof config === "boolean") return config;
    return config?.ativo !== false;
  }

  return true;
}

function sqlBuscarJobsDiagnosticados() {
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
        WHERE j.status = 'diagnosticado'
     ),
     agua_nova_ranked AS (
       SELECT *,
              ROW_NUMBER() OVER (
                PARTITION BY COALESCE(NULLIF(TRIM(cliente_id), ''), 'workspace_desconhecido')
                ORDER BY COALESCE(prioridade, 0) DESC, origem_comercial_pre_importer DESC, atualizado_em DESC NULLS LAST, id ASC
              ) AS workspace_rank_pre_importer,
              ROW_NUMBER() OVER (
                PARTITION BY workspace_chave_pre_importer, origem_fluxo_explicita_pre_importer
                ORDER BY COALESCE(prioridade, 0) DESC, origem_comercial_pre_importer DESC, atualizado_em DESC NULLS LAST, id ASC
              ) AS origem_head_rank_pre_importer
         FROM base
        WHERE lane_vazao_pre_importer = 'agua_nova'
     ),
     agua_nova AS (
       SELECT *, 0 AS bucket_selecao_pre_importer
         FROM agua_nova_ranked
        ORDER BY workspace_rank_pre_importer ASC, COALESCE(prioridade, 0) DESC, origem_comercial_pre_importer DESC, atualizado_em DESC NULLS LAST, id ASC
        LIMIT $1
     ),
     fresca_em_risco_ranked AS (
       SELECT *,
              ROW_NUMBER() OVER (
                PARTITION BY COALESCE(NULLIF(TRIM(cliente_id), ''), 'workspace_desconhecido')
                ORDER BY COALESCE(prioridade, 0) DESC, origem_comercial_pre_importer ASC, atualizado_em ASC NULLS FIRST, id ASC
              ) AS workspace_rank_pre_importer,
              ROW_NUMBER() OVER (
                PARTITION BY workspace_chave_pre_importer, origem_fluxo_explicita_pre_importer
                ORDER BY COALESCE(prioridade, 0) DESC, origem_comercial_pre_importer ASC, atualizado_em ASC NULLS FIRST, id ASC
              ) AS origem_head_rank_pre_importer
         FROM base
        WHERE lane_vazao_pre_importer = 'fresca_em_risco'
     ),
     fresca_em_risco AS (
       SELECT *, 1 AS bucket_selecao_pre_importer
         FROM fresca_em_risco_ranked
        ORDER BY workspace_rank_pre_importer ASC, COALESCE(prioridade, 0) DESC, origem_comercial_pre_importer ASC, atualizado_em ASC NULLS FIRST, id ASC
        LIMIT $2
     ),
     fresca_circulavel_ranked AS (
       SELECT *,
              ROW_NUMBER() OVER (
                PARTITION BY COALESCE(NULLIF(TRIM(cliente_id), ''), 'workspace_desconhecido')
                ORDER BY COALESCE(prioridade, 0) DESC, origem_comercial_pre_importer DESC, atualizado_em DESC NULLS LAST, id ASC
              ) AS workspace_rank_pre_importer,
              ROW_NUMBER() OVER (
                PARTITION BY workspace_chave_pre_importer, origem_fluxo_explicita_pre_importer
                ORDER BY COALESCE(prioridade, 0) DESC, origem_comercial_pre_importer DESC, atualizado_em DESC NULLS LAST, id ASC
              ) AS origem_head_rank_pre_importer
         FROM base
        WHERE lane_vazao_pre_importer = 'fresca_circulavel'
     ),
     fresca_circulavel AS (
       SELECT *, 2 AS bucket_selecao_pre_importer
         FROM fresca_circulavel_ranked
        ORDER BY workspace_rank_pre_importer ASC, COALESCE(prioridade, 0) DESC, origem_comercial_pre_importer DESC, atualizado_em DESC NULLS LAST, id ASC
        LIMIT $3
     ),
     limpeza_ranked AS (
       SELECT *,
              ROW_NUMBER() OVER (
                PARTITION BY COALESCE(NULLIF(TRIM(cliente_id), ''), 'workspace_desconhecido')
                ORDER BY origem_comercial_pre_importer ASC, atualizado_em ASC NULLS FIRST, id ASC
              ) AS workspace_rank_pre_importer,
              ROW_NUMBER() OVER (
                PARTITION BY workspace_chave_pre_importer, origem_fluxo_explicita_pre_importer
                ORDER BY origem_comercial_pre_importer ASC, atualizado_em ASC NULLS FIRST, id ASC
              ) AS origem_head_rank_pre_importer
         FROM base
        WHERE lane_vazao_pre_importer = 'expirada'
     ),
     limpeza AS (
       SELECT *, 3 AS bucket_selecao_pre_importer
         FROM limpeza_ranked
        ORDER BY workspace_rank_pre_importer ASC, origem_comercial_pre_importer ASC, atualizado_em ASC NULLS FIRST, id ASC
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
                         atualizado_em DESC NULLS LAST,
                         id ASC
              ) AS baseline_ordem_pre_importer
         FROM baseline_bruto
        ORDER BY bucket_selecao_pre_importer ASC,
                 workspace_rank_pre_importer ASC,
                 COALESCE(prioridade, 0) DESC,
                 CASE WHEN lane_vazao_pre_importer = 'fresca_em_risco' THEN origem_comercial_pre_importer END ASC NULLS LAST,
                 CASE WHEN lane_vazao_pre_importer <> 'fresca_em_risco' THEN origem_comercial_pre_importer END DESC NULLS LAST,
                 atualizado_em DESC NULLS LAST,
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
       SELECT *, 'baseline'::text AS candidate_pool_origem_pre_importer FROM baseline
       UNION ALL
       SELECT *, 'head_protegida'::text AS candidate_pool_origem_pre_importer FROM heads_protegidas_brutas
     ),
     candidate_pool_ranqueado AS (
       SELECT *, ROW_NUMBER() OVER (
         PARTITION BY id
         ORDER BY CASE WHEN candidate_pool_origem_pre_importer = 'baseline' THEN 0 ELSE 1 END,
                  baseline_ordem_pre_importer ASC NULLS LAST,
                  origem_head_rank_pre_importer ASC,
                  id ASC
       ) AS candidate_pool_dedup_rank_pre_importer
       FROM candidate_pool_bruto
     ),
     candidate_pool AS (
       SELECT * FROM candidate_pool_ranqueado
        WHERE candidate_pool_dedup_rank_pre_importer = 1
     ),
     saida_pre_importer AS (
       SELECT 'baseline'::text AS tipo_saida_pre_importer, baseline.*,
              NULL::text AS candidate_pool_origem_pre_importer,
              NULL::bigint AS candidate_pool_dedup_rank_pre_importer
         FROM baseline
       UNION ALL
       SELECT 'candidate_pool'::text AS tipo_saida_pre_importer, * FROM candidate_pool
     )
     SELECT * FROM saida_pre_importer
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

function separarResultadoJobsDiagnosticados(linhas = []) {
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
          ? { ...job, origemFluxo, origemFluxoHead: Number(linha.origem_head_rank_pre_importer) === 1 }
          : job;
      })
  };
}

async function buscarJobsDiagnosticados(limite = 20) {
  const cotas = calcularCotasFrescorPreImporter(limite);
  const resultado = await queryEngine(
    sqlBuscarJobsDiagnosticados(),
    [cotas.aguaNova, cotas.frescaEmRisco, cotas.frescaCirculavel, cotas.limpeza, cotas.totalSelecao]
  );

  if (!resultado.ok) return { ok: false, jobs: [], motivo: resultado.motivo, erro: resultado.erro };
  return { ok: true, ...separarResultadoJobsDiagnosticados(resultado.resultado?.rows) };
}

async function reivindicarJobsValidandoComExecutor(executor, jobIds = []) {
  const ids = [...new Set((Array.isArray(jobIds) ? jobIds : [jobIds])
    .map(id => Number(id))
    .filter(id => Number.isSafeInteger(id) && id > 0))];
  if (!ids.length) return { ok: true, jobs: [], ignorado: true };

  const sql = `UPDATE engine_jobs_cliente
                SET status = 'validando', atualizado_em = NOW()
              WHERE id = ANY($1::bigint[])
                AND status = 'diagnosticado'
              RETURNING id, status, atualizado_em`;
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

async function tentarMarcarValidando(jobId) {
  const resultado = await reivindicarJobsValidandoComExecutor(null, [jobId]);
  if (!resultado.ok) return { ...resultado, claimed: false, job: null };
  const job = resultado.jobs[0] || null;
  return { ...resultado, claimed: Boolean(job), job };
}

async function recuperarJobsValidandoStale(limite = 20) {
  const limiteFinal = limitarJobs(limite);
  const leaseMinutos = minutosLeaseJobsAtivos();
  const resultado = await queryEngine(
    `WITH candidatos AS (
       SELECT id
         FROM engine_jobs_cliente
        WHERE status = 'validando'
          AND COALESCE(atualizado_em, criado_em) < NOW() - ($1::int * INTERVAL '1 minute')
        ORDER BY COALESCE(atualizado_em, criado_em) ASC, id ASC
        LIMIT $2
        FOR UPDATE SKIP LOCKED
     ), recuperados AS (
       UPDATE engine_jobs_cliente j
          SET status = 'diagnosticado',
              motivo_final = 'validacao_lease_recuperado',
              atualizado_em = NOW()
         FROM candidatos c
        WHERE j.id = c.id
          AND j.status = 'validando'
       RETURNING j.id
     ), auditoria AS (
       INSERT INTO engine_processamentos (job_id, etapa, status, motivo, detalhes)
       SELECT id,
              'validacao_recovery',
              'ok',
              'validacao_lease_recuperado',
              jsonb_build_object(
                'fase', 'validacao',
                'leaseMinutos', $1,
                'statusAnterior', 'validando'
              )
         FROM recuperados
       RETURNING job_id
     )
     SELECT COUNT(*)::int AS recuperados,
            COALESCE(array_agg(id ORDER BY id), ARRAY[]::bigint[]) AS ids
       FROM recuperados`,
    [leaseMinutos, limiteFinal]
  );

  if (!resultado.ok) return { ...resultado, recuperados: 0, ids: [], leaseMinutos };
  const linha = resultado.resultado?.rows?.[0] || {};
  return {
    ...resultado,
    recuperados: Number(linha.recuperados || 0),
    ids: Array.isArray(linha.ids) ? linha.ids : [],
    leaseMinutos
  };
}

async function registrarEtapaValidacao(jobId, etapa, status, motivo = "", detalhes = {}) {
  return registrarProcessamento(jobId, etapa, status, motivo, {
    ...detalhes,
    fase: "validacao"
  });
}

async function finalizarValidacaoJob(job = {}, status = "erro_validacao", motivo = "", detalhes = {}, observarHistoricoClonadorTerminal = null) {
  const transicao = await marcarJobStatus(job.id, status, motivo || status, {
    statusEsperado: "validando"
  });
  if (!transicao.ok) {
    return {
      status: "ignorado_concorrencia",
      motivo: transicao.motivo || "status_origem_incompativel",
      ignorado: true
    };
  }
  await registrarEtapaValidacao(job.id, "validacao_final", status === "pronto_para_importar" ? "ok" : "erro", motivo || status, detalhes);
  if (status !== "pronto_para_importar" && typeof observarHistoricoClonadorTerminal === "function") {
    try { await observarHistoricoClonadorTerminal({ job, motivo: motivo || status, etapa: "validacao_final" }); } catch (_) {}
  }
  return { status, motivo: motivo || status };
}

async function validarJobDiagnosticadoEngine(job = {}, contexto = {}) {
  const clienteId = normalizarTexto(job.cliente_id);
  const marketplace = normalizarMarketplaceEngine(job.marketplace || job.marketplace_detectado);
  const origemFluxo = resolverOrigemFluxo(job);

  await registrarEtapaValidacao(job.id, "validacao_inicio", "ok", "validacao_iniciada", {
    clienteId,
    marketplace
  });

  const clienteOk = clienteValidoEngine(clienteId, contexto.clientesValidos || [], {
    origemFluxo,
    avaliarWorkspaceParaEngine: contexto.avaliarWorkspaceParaEngine
  });
  await registrarEtapaValidacao(job.id, "validar_cliente", clienteOk ? "ok" : "erro", clienteOk ? "cliente_validado" : "cliente_invalido", {
    clienteId
  });

  if (!clienteOk) {
    return finalizarValidacaoJob(job, "cliente_invalido", "cliente_invalido", { clienteId }, contexto.observarHistoricoClonadorTerminal);
  }

  await registrarEtapaValidacao(job.id, "validar_marketplace", marketplace ? "ok" : "erro", marketplace ? "marketplace_validado" : "marketplace_nao_detectado", {
    marketplace
  });

  if (!marketplace) {
    return finalizarValidacaoJob(job, "erro_validacao", "marketplace_nao_detectado", { clienteId }, contexto.observarHistoricoClonadorTerminal);
  }

  const marketplaceAtivo = marketplaceAtivoClienteEngine(clienteId, marketplace, contexto.marketplacesAtivosPorCliente || {});
  await registrarEtapaValidacao(job.id, "validar_marketplace_ativo", marketplaceAtivo ? "ok" : "erro", marketplaceAtivo ? "marketplace_ativo" : "marketplace_bloqueado", {
    clienteId,
    marketplace
  });

  if (!marketplaceAtivo) {
    return finalizarValidacaoJob(job, "marketplace_bloqueado", "marketplace_bloqueado", { clienteId, marketplace }, contexto.observarHistoricoClonadorTerminal);
  }

  const integracao = obterIntegracaoClienteEngine(contexto.integracoesPorCliente || {}, clienteId, marketplace);
  const integracaoOk = credenciaisValidasEngine(integracao, marketplace);
  await registrarEtapaValidacao(job.id, "validar_integracao", integracaoOk ? "ok" : "erro", integracaoOk ? "integracao_validada" : "integracao_ausente", {
    clienteId,
    marketplace,
    temIntegracao: Boolean(integracao),
    campos: Object.keys(integracao?.credenciais || {})
  });

  if (!integracaoOk) {
    return finalizarValidacaoJob(job, "integracao_ausente", "integracao_ausente", { clienteId, marketplace }, contexto.observarHistoricoClonadorTerminal);
  }

  return finalizarValidacaoJob(job, "pronto_para_importar", "validacao_ok", { clienteId, marketplace });
}

module.exports = {
  sqlBuscarJobsDiagnosticados,
  separarResultadoJobsDiagnosticados,
  buscarJobsDiagnosticados,
  reivindicarJobsValidandoComExecutor,
  tentarMarcarValidando,
  recuperarJobsValidandoStale,
  validarJobDiagnosticadoEngine,
  finalizarValidacaoJob,
  clienteValidoEngine,
  marketplaceAtivoClienteEngine,
  obterIntegracaoClienteEngine,
  credenciaisValidasEngine
};
