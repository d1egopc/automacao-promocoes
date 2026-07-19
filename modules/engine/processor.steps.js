const {
  carregarEventoBruto,
  carregarLinksEvento,
  marcarJobStatus,
  registrarProcessamento
} = require("./processor.service");
const { detectarMarketplaceLink } = require("./normalizers");

function clienteExiste(job = {}, contexto = {}) {
  const clienteId = String(job.cliente_id || job.clienteId || "").trim();
  if (!clienteId) return false;

  const clientesValidos = Array.isArray(contexto.clientesValidos)
    ? contexto.clientesValidos.map(id => String(id || "").trim()).filter(Boolean)
    : [];

  if (!clientesValidos.length) return true;
  return clientesValidos.includes(clienteId);
}

function detectarMarketplaceJob(job = {}, evento = {}, links = []) {
  const direto = String(job.marketplace || job.marketplace_detectado || evento.marketplace_detectado || "").trim();
  if (direto) return direto;

  for (const link of links) {
    const marketplace = detectarMarketplaceLink(
      link.url_expandida ||
      link.url_normalizada ||
      link.url_original ||
      ""
    );
    if (marketplace) return marketplace;
  }

  const linksEvento = Array.isArray(evento.links_extraidos) ? evento.links_extraidos : [];
  for (const link of linksEvento) {
    const marketplace = detectarMarketplaceLink(link);
    if (marketplace) return marketplace;
  }

  return "";
}

async function finalizarErro(job, motivo, detalhes = {}) {
  await registrarProcessamento(job.id, "diagnostico_final", "erro", motivo, detalhes);
  await marcarJobStatus(job.id, "erro", motivo);
  return { ok: false, status: "erro", motivo };
}

async function processarJobEngine(job = {}, contexto = {}) {
  await registrarProcessamento(job.id, "inicio", "ok", "processamento_iniciado", {
    jobId: job.id,
    eventoId: job.evento_id,
    clienteId: job.cliente_id
  });

  const eventoResultado = await carregarEventoBruto(job.evento_id);
  await registrarProcessamento(job.id, "carregar_evento", eventoResultado.evento ? "ok" : "erro", eventoResultado.evento ? "evento_carregado" : "evento_nao_encontrado", {
    eventoId: job.evento_id,
    erro: eventoResultado.erro || ""
  });

  if (!eventoResultado.ok || !eventoResultado.evento) {
    return finalizarErro(job, "evento_nao_encontrado", { eventoId: job.evento_id });
  }

  const linksResultado = await carregarLinksEvento(job.evento_id);
  await registrarProcessamento(job.id, "carregar_links", linksResultado.ok ? "ok" : "erro", linksResultado.ok ? "links_carregados" : "links_nao_carregados", {
    totalLinks: linksResultado.links.length,
    erro: linksResultado.erro || ""
  });

  if (!linksResultado.ok) {
    return finalizarErro(job, "links_nao_carregados", { eventoId: job.evento_id });
  }

  const marketplace = detectarMarketplaceJob(job, eventoResultado.evento, linksResultado.links);
  await registrarProcessamento(job.id, "detectar_marketplace", marketplace ? "ok" : "erro", marketplace ? "marketplace_detectado" : "marketplace_nao_detectado", {
    marketplace,
    links: linksResultado.links.map(link => link.url_expandida || link.url_normalizada || link.url_original).filter(Boolean)
  });

  if (!marketplace) {
    return finalizarErro(job, "marketplace_nao_detectado", { eventoId: job.evento_id });
  }

  const clienteOk = clienteExiste(job, contexto);
  await registrarProcessamento(job.id, "validar_cliente", clienteOk ? "ok" : "erro", clienteOk ? "cliente_validado" : "cliente_nao_encontrado", {
    clienteId: job.cliente_id
  });

  if (!clienteOk) {
    return finalizarErro(job, "cliente_nao_encontrado", { clienteId: job.cliente_id });
  }

  await registrarProcessamento(job.id, "diagnostico_final", "ok", "job_diagnosticado", {
    eventoId: job.evento_id,
    clienteId: job.cliente_id,
    marketplace,
    totalLinks: linksResultado.links.length
  });

  await marcarJobStatus(job.id, "diagnosticado", "job_diagnosticado", {
    marketplace,
    marketplaceDetectado: marketplace
  });

  return { ok: true, status: "diagnosticado", marketplace };
}

module.exports = {
  processarJobEngine,
  detectarMarketplaceJob,
  clienteExiste
};
