const { queryEngine } = require("./database");
const {
  marcarJobStatus,
  registrarProcessamento,
  limitarJobs
} = require("./processor.service");
const {
  calcularCotasFrescorPreImporter
} = require("./frescor-pre-importer.service");
const { normalizarTexto } = require("./normalizers");

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

function clienteValidoEngine(clienteId = "", clientesValidos = []) {
  const cid = normalizarTexto(clienteId);
  if (!cid) return false;
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

async function buscarJobsDiagnosticados(limite = 20) {
  const cotas = calcularCotasFrescorPreImporter(limite);
  const resultado = await queryEngine(
    `WITH base AS (
       SELECT j.id, j.uuid, j.evento_id, j.oferta_id, j.cliente_id, j.marketplace_detectado,
              j.marketplace, j.status, j.motivo_final, j.metadata, j.prioridade,
              j.criado_em, j.atualizado_em,
              e.capturado_em AS evento_capturado_em,
              e.criado_em AS evento_criado_em,
              e.origem AS evento_origem,
              e.origem_tipo AS evento_origem_tipo,
              e.metadata AS evento_metadata,
              COALESCE(e.capturado_em, j.criado_em) AS origem_comercial_pre_importer,
              CASE
                WHEN COALESCE(e.capturado_em, j.criado_em) < NOW() - INTERVAL '30 minutes' THEN 1
                ELSE 0
              END AS bucket_frescor_pre_importer
         FROM engine_jobs_cliente j
         LEFT JOIN engine_eventos_brutos e ON e.id = j.evento_id
        WHERE j.status = 'diagnosticado'
     ),
     frescos AS (
       SELECT *, 0 AS bucket_selecao_pre_importer
         FROM base
        WHERE bucket_frescor_pre_importer = 0
        ORDER BY COALESCE(prioridade, 0) DESC, origem_comercial_pre_importer ASC, atualizado_em ASC NULLS FIRST, id ASC
        LIMIT $1
     ),
     limpeza AS (
       SELECT *, 1 AS bucket_selecao_pre_importer
         FROM base
        WHERE bucket_frescor_pre_importer = 1
        ORDER BY origem_comercial_pre_importer ASC, atualizado_em ASC NULLS FIRST, id ASC
        LIMIT $2
     )
     SELECT *
       FROM (
         SELECT * FROM frescos
         UNION ALL
         SELECT * FROM limpeza
       ) selecionados
      ORDER BY bucket_selecao_pre_importer ASC,
               COALESCE(prioridade, 0) DESC,
               origem_comercial_pre_importer ASC,
               atualizado_em ASC NULLS FIRST,
               id ASC
      LIMIT $3`,
    [cotas.frescos, cotas.limpeza, cotas.limite]
  );

  if (!resultado.ok) return { ok: false, jobs: [], motivo: resultado.motivo, erro: resultado.erro };
  return { ok: true, jobs: resultado.resultado.rows };
}

async function registrarEtapaValidacao(jobId, etapa, status, motivo = "", detalhes = {}) {
  return registrarProcessamento(jobId, etapa, status, motivo, {
    ...detalhes,
    fase: "validacao"
  });
}

async function finalizarValidacaoJob(job = {}, status = "erro_validacao", motivo = "", detalhes = {}) {
  await registrarEtapaValidacao(job.id, "validacao_final", status === "pronto_para_importar" ? "ok" : "erro", motivo || status, detalhes);
  await marcarJobStatus(job.id, status, motivo || status);
  return { status, motivo: motivo || status };
}

async function validarJobDiagnosticadoEngine(job = {}, contexto = {}) {
  const clienteId = normalizarTexto(job.cliente_id);
  const marketplace = normalizarMarketplaceEngine(job.marketplace || job.marketplace_detectado);

  await registrarEtapaValidacao(job.id, "validacao_inicio", "ok", "validacao_iniciada", {
    clienteId,
    marketplace
  });

  const clienteOk = clienteValidoEngine(clienteId, contexto.clientesValidos || []);
  await registrarEtapaValidacao(job.id, "validar_cliente", clienteOk ? "ok" : "erro", clienteOk ? "cliente_validado" : "cliente_invalido", {
    clienteId
  });

  if (!clienteOk) {
    return finalizarValidacaoJob(job, "cliente_invalido", "cliente_invalido", { clienteId });
  }

  await registrarEtapaValidacao(job.id, "validar_marketplace", marketplace ? "ok" : "erro", marketplace ? "marketplace_validado" : "marketplace_nao_detectado", {
    marketplace
  });

  if (!marketplace) {
    return finalizarValidacaoJob(job, "erro_validacao", "marketplace_nao_detectado", { clienteId });
  }

  const marketplaceAtivo = marketplaceAtivoClienteEngine(clienteId, marketplace, contexto.marketplacesAtivosPorCliente || {});
  await registrarEtapaValidacao(job.id, "validar_marketplace_ativo", marketplaceAtivo ? "ok" : "erro", marketplaceAtivo ? "marketplace_ativo" : "marketplace_bloqueado", {
    clienteId,
    marketplace
  });

  if (!marketplaceAtivo) {
    return finalizarValidacaoJob(job, "marketplace_bloqueado", "marketplace_bloqueado", { clienteId, marketplace });
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
    return finalizarValidacaoJob(job, "integracao_ausente", "integracao_ausente", { clienteId, marketplace });
  }

  return finalizarValidacaoJob(job, "pronto_para_importar", "validacao_ok", { clienteId, marketplace });
}

module.exports = {
  buscarJobsDiagnosticados,
  validarJobDiagnosticadoEngine,
  clienteValidoEngine,
  marketplaceAtivoClienteEngine,
  obterIntegracaoClienteEngine,
  credenciaisValidasEngine
};
