const {
  carregarEventoBruto,
  carregarLinksEvento,
  marcarJobStatus,
  registrarProcessamento
} = require("./processor.service");
const { detectarMarketplaceLink } = require("./normalizers");
const { avaliarWorkspaceParaEngine } = require("../workspace");

// DEPRECATED — compatibilidade temporaria.
// Origem legada: engine_jobs_cliente expõe cliente_id como coluna fisica.
// Destino oficial: JobWorkspace com workspaceId canonico na aplicacao.
// Consumidor atual: processarJobEngine.
// Remover na Fase: 3, sem migrar schema nesta Fase 1.
function avaliarClienteEngine(job = {}, contexto = {}) {
  const clienteId = String(job.cliente_id || job.clienteId || "").trim();
  if (!clienteId) {
    return { ok: false, motivo: "workspace_inexistente", motivos: ["workspace_inexistente"] };
  }

  const clientesValidos = Array.isArray(contexto.clientesValidos)
    ? contexto.clientesValidos.map(id => String(id || "").trim()).filter(Boolean)
    : [];

  if (clientesValidos.includes(clienteId)) {
    return { ok: true, motivo: "elegivel", motivos: [] };
  }

  const avaliacao = typeof contexto.avaliarWorkspaceParaEngine === "function"
    ? contexto.avaliarWorkspaceParaEngine(clienteId)
    : avaliarWorkspaceParaEngine(clienteId, { log: false });

  if (avaliacao.elegivelEngine) {
    return { ok: true, motivo: "elegivel", motivos: [] };
  }

  return {
    ok: false,
    motivo: avaliacao.motivo || "workspace_nao_operacional",
    motivos: avaliacao.motivos || []
  };
}

// DEPRECATED — compatibilidade temporaria.
// Origem legada: testes/modulos ainda importam clienteExiste().
// Destino oficial: avaliarClienteEngine()/avaliarWorkspaceParaEngine().
// Consumidor atual: export publico de processor.steps.
// Remover na Fase: 3, apos troca dos consumidores para Workspace.
function clienteExiste(job = {}, contexto = {}) {
  return avaliarClienteEngine(job, contexto).ok;
}

function avaliacaoPermiteSkipCedo(avaliacao = {}) {
  const motivos = Array.isArray(avaliacao.motivos) ? avaliacao.motivos : [];
  const motivo = avaliacao.motivo || motivos[0] || "";
  return ["workspace_inativo", "workspace_inexistente"].includes(motivo) ||
    motivos.some(item => ["workspace_inativo", "workspace_inexistente"].includes(item));
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

async function finalizarErro(job, motivo, detalhes = {}, etapa = "diagnostico_final") {
  await registrarProcessamento(job.id, "diagnostico_final", "erro", motivo, detalhes);
  await marcarJobStatus(job.id, "erro", motivo, { statusEsperado: "processando" });
  return {
    ok: false,
    status: "erro",
    etapa,
    motivo,
    erro: detalhes.erro || motivo || "",
    stack: detalhes.stack || ""
  };
}

async function processarJobEngine(job = {}, contexto = {}) {
  await registrarProcessamento(job.id, "inicio", "ok", "processamento_iniciado", {
    jobId: job.id,
    eventoId: job.evento_id,
    clienteId: job.cliente_id
  });

  const avaliacaoClienteCedo = avaliarClienteEngine(job, contexto);
  if (!avaliacaoClienteCedo.ok && avaliacaoPermiteSkipCedo(avaliacaoClienteCedo)) {
    await registrarProcessamento(job.id, "validar_cliente", "erro", avaliacaoClienteCedo.motivo, {
      clienteId: job.cliente_id,
      motivos: avaliacaoClienteCedo.motivos || [],
      skipCedo: true
    });
    return finalizarErro(job, avaliacaoClienteCedo.motivo || "workspace_nao_operacional", {
      clienteId: job.cliente_id,
      clientesValidosTotal: Array.isArray(contexto.clientesValidos) ? contexto.clientesValidos.length : 0,
      motivos: avaliacaoClienteCedo.motivos || [],
      skipCedo: true
    }, "validar_cliente");
  }

  const eventoResultado = await carregarEventoBruto(job.evento_id);
  await registrarProcessamento(job.id, "carregar_evento", eventoResultado.evento ? "ok" : "erro", eventoResultado.evento ? "evento_carregado" : "evento_nao_encontrado", {
    eventoId: job.evento_id,
    erro: eventoResultado.erro || ""
  });

  if (!eventoResultado.ok || !eventoResultado.evento) {
    return finalizarErro(job, "evento_nao_encontrado", {
      eventoId: job.evento_id,
      erro: eventoResultado.erro || ""
    }, "carregar_evento");
  }

  const linksResultado = await carregarLinksEvento(job.evento_id);
  await registrarProcessamento(job.id, "carregar_links", linksResultado.ok ? "ok" : "erro", linksResultado.ok ? "links_carregados" : "links_nao_carregados", {
    totalLinks: linksResultado.links.length,
    erro: linksResultado.erro || ""
  });

  if (!linksResultado.ok) {
    return finalizarErro(job, "links_nao_carregados", {
      eventoId: job.evento_id,
      erro: linksResultado.erro || ""
    }, "carregar_links");
  }

  const marketplace = detectarMarketplaceJob(job, eventoResultado.evento, linksResultado.links);
  await registrarProcessamento(job.id, "detectar_marketplace", marketplace ? "ok" : "erro", marketplace ? "marketplace_detectado" : "marketplace_nao_detectado", {
    marketplace,
    links: linksResultado.links.map(link => link.url_expandida || link.url_normalizada || link.url_original).filter(Boolean)
  });

  if (!marketplace) {
    return finalizarErro(job, "marketplace_nao_detectado", { eventoId: job.evento_id }, "detectar_marketplace");
  }

  const avaliacaoCliente = avaliarClienteEngine(job, contexto);
  const clienteOk = avaliacaoCliente.ok;
  await registrarProcessamento(job.id, "validar_cliente", clienteOk ? "ok" : "erro", clienteOk ? "cliente_validado" : avaliacaoCliente.motivo, {
    clienteId: job.cliente_id,
    motivos: avaliacaoCliente.motivos || []
  });

  if (!clienteOk) {
    return finalizarErro(job, avaliacaoCliente.motivo || "workspace_nao_operacional", {
      clienteId: job.cliente_id,
      clientesValidosTotal: Array.isArray(contexto.clientesValidos) ? contexto.clientesValidos.length : 0,
      motivos: avaliacaoCliente.motivos || []
    }, "validar_cliente");
  }

  await registrarProcessamento(job.id, "diagnostico_final", "ok", "job_diagnosticado", {
    eventoId: job.evento_id,
    clienteId: job.cliente_id,
    marketplace,
    totalLinks: linksResultado.links.length
  });

  await marcarJobStatus(job.id, "diagnosticado", "job_diagnosticado", {
    statusEsperado: "processando",
    marketplace,
    marketplaceDetectado: marketplace
  });

  return { ok: true, status: "diagnosticado", marketplace };
}

module.exports = {
  processarJobEngine,
  detectarMarketplaceJob,
  clienteExiste,
  avaliarClienteEngine,
  avaliacaoPermiteSkipCedo
};
