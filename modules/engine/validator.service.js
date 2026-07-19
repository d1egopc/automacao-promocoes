const { queryEngine } = require("./database");
const {
  marcarJobStatus,
  registrarProcessamento,
  limitarJobs
} = require("./processor.service");
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

  if (mp === "awin") {
    ["awin", "feed_awin", "feedAwin", "feedkabum", "feed_kabum"].forEach(chave => chaves.add(chave));
  }

  return [...chaves].filter(Boolean);
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
  if (Array.isArray(ativos)) return ativos.map(normalizarMarketplaceEngine).includes(mp);
  if (typeof ativos === "object") {
    const config = ativos[mp];
    if (config === undefined) return true;
    if (typeof config === "boolean") return config;
    return config?.ativo !== false;
  }

  return true;
}

async function buscarJobsDiagnosticados(limite = 20) {
  const resultado = await queryEngine(
    `SELECT id, uuid, evento_id, oferta_id, cliente_id, marketplace_detectado,
            marketplace, status, motivo_final, criado_em, atualizado_em
       FROM engine_jobs_cliente
      WHERE status = 'diagnosticado'
      ORDER BY atualizado_em ASC NULLS FIRST, id ASC
      LIMIT $1`,
    [limitarJobs(limite)]
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
