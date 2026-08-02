const { normalizarNumeroMoeda } = require("../../../../utils/moeda");
const {
  escolherProdutoPrincipal,
  resumoLinksClassificados
} = require("../../link-role.service");
function texto(valor = "") {
  return String(valor || "").trim();
}

function valorPresente(valor) {
  return valor !== null && valor !== undefined && texto(valor) !== "";
}

function primeiroValor(...valores) {
  for (const valor of valores) {
    if (valorPresente(valor)) return valor;
  }
  return "";
}

function numeroPreco(valor = "") {
  return normalizarNumeroMoeda(valor);
}

function extrairUrlKabumDeAwin(url = "") {
  try {
    const parsed = new URL(texto(url));
    const candidatos = [
      parsed.searchParams.get("ued"),
      parsed.searchParams.get("url"),
      parsed.searchParams.get("u"),
      parsed.searchParams.get("destination"),
      parsed.searchParams.get("dest")
    ].filter(Boolean);

    for (const candidato of candidatos) {
      let atual = candidato;
      for (let i = 0; i < 3; i += 1) {
        try {
          const decodificado = decodeURIComponent(atual);
          if (decodificado === atual) break;
          atual = decodificado;
        } catch {
          break;
        }
      }

      if (/kabum\.com\.br/i.test(atual)) return atual;
    }
  } catch {}

  return "";
}

function escolherLinkAwinKabum(links = [], evento = {}) {
  const candidatos = [];

  for (const link of Array.isArray(links) ? links : []) {
    candidatos.push({ url: link.url_expandida, link, campo: "url_expandida" });
    candidatos.push({ url: link.url_normalizada, link, campo: "url_normalizada" });
    candidatos.push({ url: link.url_original, link, campo: "url_original" });
  }

  if (Array.isArray(evento.links_extraidos)) {
    for (const url of evento.links_extraidos) {
      candidatos.push({ url, link: null, campo: "links_extraidos" });
    }
  }

  const validos = candidatos
    .map(candidato => ({
      ...candidato,
      url: texto(candidato.url)
    }))
    .map(candidato => ({
      ...candidato,
      urlProduto: extrairUrlKabumDeAwin(candidato.url) || candidato.url
    }))
    .filter(candidato => /kabum\.com\.br|awin1\.com|awin\.com/i.test(candidato.url));

  if (!validos.length) return { url: "", urlProduto: "", link: null, campo: "" };
  return escolherProdutoPrincipal(validos, "kabum", evento);
}

function normalizarMarketplaceAwinKabum(produto = {}, url = "") {
  const marketplace = texto(produto.marketplace || produto.mercado || "").toLowerCase();
  if (marketplace.includes("kabum") || /kabum\.com\.br/i.test(url)) return "kabum";
  if (marketplace.includes("awin")) return "awin";
  return "awin";
}

function calcularEconomia(precoAtual, precoOriginal) {
  const atual = numeroPreco(precoAtual);
  const original = numeroPreco(precoOriginal);

  if (atual === null || original === null || original <= atual) {
    return { economia: "", percentual: "" };
  }

  const economia = Number((original - atual).toFixed(2));
  const percentual = Math.round((economia / original) * 100);

  return { economia, percentual };
}

function extrairBeneficioComercial(produto = {}) {
  return primeiroValor(
    produto.beneficioComercial,
    produto.beneficioTexto,
    produto.beneficioExtra,
    produto.avisoPagamento,
    produto.avisoCupom,
    produto.parcelamento,
    produto.cashback,
    produto.descontoPix,
    produto.descontoApp
  );
}

function logAwinAdapter(evento, payload = {}) {
  console.log(evento, JSON.stringify(payload));
}

function logAwinV272(tag = "", payload = {}) {
  try {
    console.log(tag, JSON.stringify({
      workspaceId: payload.clienteId || payload.workspaceId || "",
      eventoId: payload.eventoId || null,
      jobId: payload.jobId || null,
      ofertaId: payload.ofertaId || null,
      marketplace: payload.marketplace || "kabum",
      adapter: "awin.adapter",
      contrato: "kabum-awin",
      totalLinksEntrada: payload.totalLinksEntrada || 0,
      papeisDetectados: Array.isArray(payload.papeisDetectados) ? payload.papeisDetectados.slice(0, 12) : [],
      totalLinksSeguros: payload.totalLinksSeguros || 0,
      houveConversao: payload.houveConversao === true,
      statusEtapa: payload.statusEtapa || "",
      motivo: payload.motivo || "",
      aplicouMudancasOperacionais: false
    }));
  } catch (_) {
    // Observabilidade V2.7.2 nunca interfere no importador.
  }
}

async function importarAwinEngine({ job = {}, evento = {}, links = [], deps = {} } = {}) {
  const clienteId = texto(job.cliente_id || job.clienteId || "");
  const linkEscolhido = escolherLinkAwinKabum(links, evento);
  const urlOriginalEngine = linkEscolhido.urlProduto || linkEscolhido.url;
  const urlCapturadaEngine = linkEscolhido.url;
  const linksClassificados = resumoLinksClassificados(links, evento, "kabum");
  const papeisDetectados = [...new Set(linksClassificados.map(item => item.papelLink).filter(Boolean))];
  const destinoExtraido = Boolean(linkEscolhido.urlProduto && linkEscolhido.urlProduto !== linkEscolhido.url);

  if (!clienteId) {
    return { ok: false, marketplace: "awin", motivo: "cliente_invalido" };
  }

  if (!urlOriginalEngine) {
    logAwinV272("[OFC-V2.7.2-CTA-SEGURO-INDISPONIVEL]", {
      jobId: job.id,
      eventoId: job.evento_id,
      clienteId,
      totalLinksEntrada: linksClassificados.length,
      papeisDetectados,
      statusEtapa: "adapter_link_produto_indisponivel",
      motivo: linkEscolhido.papelLinkMotivo || "link_produto_kabum_nao_confirmado"
    });
    return {
      ok: false,
      marketplace: "awin",
      motivo: linkEscolhido.papelLinkMotivo || "link_produto_kabum_nao_confirmado",
      metadata: {
        adapter: "awin_kabum",
        linksClassificados
      }
    };
  }

  if (typeof deps.importarProdutoKabumViaAwin !== "function") {
    return { ok: false, marketplace: "awin", motivo: "importador_kabum_awin_indisponivel", linkOriginal: urlOriginalEngine };
  }

  if (typeof deps.gerarDeepLinkAwin !== "function") {
    return { ok: false, marketplace: "awin", motivo: "gerar_deeplink_awin_indisponivel", linkOriginal: urlOriginalEngine };
  }

  if (typeof deps.getIntegracaoCliente !== "function") {
    return { ok: false, marketplace: "awin", motivo: "get_integracao_indisponivel", linkOriginal: urlOriginalEngine };
  }

  const integracaoAwin = deps.getIntegracaoCliente(clienteId, "awin");
  const integracaoKabum = deps.getIntegracaoCliente(clienteId, "kabum");
  const integracao = integracaoAwin || integracaoKabum;

  if (!integracao) {
    logAwinV272("[OFC-V2.7.2-CTA-SEGURO-INDISPONIVEL]", {
      jobId: job.id,
      eventoId: job.evento_id,
      clienteId,
      totalLinksEntrada: linksClassificados.length,
      papeisDetectados,
      statusEtapa: "integracao_indisponivel",
      motivo: "integracao_ausente"
    });
    return { ok: false, marketplace: "awin", motivo: "integracao_ausente", linkOriginal: urlOriginalEngine };
  }

  if (destinoExtraido) {
    logAwinV272("[OFC-V2.7.2-AWIN-DESTINO-EXTRAIDO]", {
      jobId: job.id,
      eventoId: job.evento_id,
      clienteId,
      totalLinksEntrada: linksClassificados.length,
      papeisDetectados,
      statusEtapa: "destino_kabum_extraido",
      motivo: "ued_kabum_extraido"
    });
  }

  logAwinAdapter("[ENGINE-AWIN-KABUM-IMPORTADOR-CHAMADA]", {
    jobId: job.id,
    eventoId: job.evento_id,
    clienteId,
    urlUsada: urlOriginalEngine,
    urlCapturada: urlCapturadaEngine,
    campoLink: linkEscolhido.campo || "",
    papelLink: linkEscolhido.papelLink || "",
    papelLinkMotivo: linkEscolhido.papelLinkMotivo || "",
    temPublisherId: Boolean(integracao?.credenciais?.publisherId || integracao?.credenciais?.publisher_id),
    temApiToken: Boolean(integracao?.credenciais?.apiToken || integracao?.credenciais?.token)
  });

  let produto;
  try {
    produto = await deps.importarProdutoKabumViaAwin(urlOriginalEngine, clienteId, {
      gerarDeepLinkAwin: (url, clienteIdAlvo = clienteId) => deps.gerarDeepLinkAwin(url, clienteIdAlvo || clienteId),
      integracao,
      contextoEngine: {
        jobId: job.id,
        eventoId: job.evento_id,
        clienteId
      }
    });
  } catch (e) {
    logAwinAdapter("[ENGINE-AWIN-KABUM-IMPORTADOR-ERRO]", {
      jobId: job.id,
      eventoId: job.evento_id,
      clienteId,
      motivo: "erro_importador_kabum_awin",
      erro: e.message
    });

    return {
      ok: false,
      marketplace: "awin",
      motivo: e.status === 403 ? "kabum_http_403" : "erro_importador_kabum_awin",
      erro: e.message,
      linkOriginal: urlOriginalEngine
    };
  }

  if (!produto || produto.ok === false) {
    return {
      ok: false,
      marketplace: "awin",
      motivo: produto?.motivo || "importador_sem_retorno",
      linkOriginal: urlOriginalEngine
    };
  }

  const marketplace = normalizarMarketplaceAwinKabum(produto, urlOriginalEngine);
  const precoAtual = primeiroValor(produto.precoAtual, produto.preco);
  const precoOriginal = primeiroValor(produto.precoOriginal, produto.precoAntigo);
  const precoNumerico = numeroPreco(precoAtual);
  const economiaCalculada = calcularEconomia(precoAtual, precoOriginal);
  const linkAfiliado = primeiroValor(produto.linkAfiliado, produto.linkFinal, produto.link);

  logAwinAdapter("[ENGINE-AWIN-KABUM-IMPORTADOR-RETORNO]", {
    jobId: job.id,
    eventoId: job.evento_id,
    clienteId,
    ok: true,
    marketplace,
    titulo: produto.titulo || produto.nome || "",
    precoAtual,
    precoOriginal,
    cupom: produto.cupom || "",
    beneficioComercial: extrairBeneficioComercial(produto),
    linkAfiliado,
    imagem: produto.imagem || "",
    categoria: produto.categoria || "",
    camposRetorno: Object.keys(produto || {})
  });

  if (!produto.titulo && !produto.nome) {
    return { ok: false, marketplace, motivo: "titulo_indisponivel", linkOriginal: urlOriginalEngine };
  }

  if (precoNumerico === null) {
    return { ok: false, marketplace, motivo: "preco_indisponivel", linkOriginal: urlOriginalEngine };
  }

  if (!linkAfiliado) {
    logAwinV272("[OFC-V2.7.2-CTA-SEGURO-INDISPONIVEL]", {
      jobId: job.id,
      eventoId: job.evento_id,
      clienteId,
      marketplace,
      totalLinksEntrada: linksClassificados.length,
      papeisDetectados,
      statusEtapa: "cta_seguro_indisponivel",
      motivo: "link_afiliado_vazio"
    });
    return { ok: false, marketplace, motivo: "link_afiliado_vazio", linkOriginal: urlOriginalEngine };
  }

  logAwinV272("[OFC-V2.7.2-AWIN-RECONVERTIDO]", {
    jobId: job.id,
    eventoId: job.evento_id,
    clienteId,
    marketplace,
    totalLinksEntrada: linksClassificados.length,
    papeisDetectados,
    totalLinksSeguros: 1,
    houveConversao: true,
    statusEtapa: "cta_workspace_reconvertido",
    motivo: integracaoAwin ? "awin_workspace_reconvertido" : "kabum_workspace_reconvertido"
  });

  const cupomTipo = primeiroValor(produto.tipoCupom, produto.cupomTipo);
  const beneficioComercial = extrairBeneficioComercial(produto);

  return {
    ok: true,
    marketplace,
    titulo: produto.titulo || produto.nome || "",
    preco: precoNumerico,
    precoAtual: precoNumerico,
    precoOriginal,
    precoAntigo: precoOriginal,
    economia: primeiroValor(produto.economia, economiaCalculada.economia),
    percentual: primeiroValor(produto.percentual, produto.descontoPercentual, economiaCalculada.percentual),
    descontoPercentual: primeiroValor(produto.descontoPercentual, produto.percentual, economiaCalculada.percentual),
    imagem: produto.imagem || "",
    linkOriginal: urlOriginalEngine,
    linkExpandido: primeiroValor(produto.linkOriginal, produto.linkExpandido, urlOriginalEngine),
    linkAfiliado,
    categoria: produto.categoria || "",
    cupom: produto.cupom || "",
    cupomTipo,
    tipoCupom: cupomTipo,
    avisoCupom: produto.avisoCupom || "",
    beneficioComercial,
    beneficioTexto: beneficioComercial,
    beneficioExtra: beneficioComercial,
    valorEfetivo: primeiroValor(produto.valorEfetivo, produto.precoFinalConfirmado),
    valorEfetivoOrigem: primeiroValor(produto.valorEfetivoOrigem, produto.precoFinalConfirmadoOrigem),
    parcelamento: produto.parcelamento || "",
    freteGratis: produto.freteGratis === true,
    cashback: produto.cashback || "",
    descontoPix: produto.descontoPix || "",
    descontoApp: produto.descontoApp || "",
    origem: "engine_importer_awin_kabum",
    clienteId,
    metadata: {
      adapter: "awin_kabum",
      jobId: job.id,
      eventoId: job.evento_id,
      clienteId,
      linkOriginalEngine: urlOriginalEngine,
      linkCapturadoEngine: urlCapturadaEngine,
      campoLinkEscolhido: linkEscolhido.campo || "",
      papelLinkEscolhido: linkEscolhido.papelLink || "",
      papelLinkMotivo: linkEscolhido.papelLinkMotivo || "",
      linksClassificados,
      integracaoUsada: integracaoAwin ? "awin" : "kabum",
      camposProduto: Object.keys(produto || {}),
      produto
    }
  };
}

module.exports = {
  importarAwinEngine
};
