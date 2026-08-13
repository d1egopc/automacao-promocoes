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

function urlCapturadaOcorrenciaAwin(link = {}) {
  return texto(
    link.urlOriginal ||
    link.url_original ||
    link.original ||
    link.href ||
    link.urlExpandida ||
    link.url_expandida ||
    link.resolvido ||
    link.url ||
    ""
  );
}

function publisherIdAwin(integracao = {}) {
  const credenciais = integracao && typeof integracao.credenciais === "object"
    ? integracao.credenciais
    : {};
  return texto(
    credenciais.publisherId ||
    credenciais.publisher_id ||
    credenciais.awinaffid ||
    credenciais.awinAffId ||
    integracao.publisherId ||
    integracao.publisher_id ||
    ""
  );
}

function awinComUedValido(url = "") {
  if (!/awin1?\.com|awin\.com/i.test(texto(url))) return false;
  return Boolean(extrairUrlKabumDeAwin(url));
}

function normalizarDestinoKabumComparacao(url = "") {
  const destino = texto(url);
  if (!destino) return "";
  try {
    const parsed = new URL(destino);
    parsed.protocol = "https:";
    parsed.hostname = parsed.hostname.toLowerCase().replace(/^kabum\.com\.br$/i, "www.kabum.com.br");
    parsed.hash = "";
    parsed.pathname = parsed.pathname.replace(/\/+$/g, "");
    return parsed.toString().replace(/\/+$/g, "").toLowerCase();
  } catch {
    return destino.replace(/\/+$/g, "").toLowerCase();
  }
}

function destinosKabumEquivalentes(a = "", b = "") {
  const destinoA = normalizarDestinoKabumComparacao(a);
  const destinoB = normalizarDestinoKabumComparacao(b);
  return Boolean(destinoA && destinoB && destinoA === destinoB);
}

function diagnosticarDestinoAwin(urlAfiliada = "", destinoEsperado = "") {
  const destinoFinal = extrairUrlKabumDeAwin(urlAfiliada);
  if (!destinoFinal) {
    return { temUed: false, destinoFinal: "", bateDestino: false };
  }
  return {
    temUed: true,
    destinoFinal,
    bateDestino: destinosKabumEquivalentes(destinoFinal, destinoEsperado)
  };
}

function conversaoAwinRenderizavel(urlAfiliada = "", destinoEsperado = "") {
  const afiliada = texto(urlAfiliada);
  if (!afiliada) return { ok: false, motivo: "awin_sem_conversao_workspace", destinoFinal: "" };
  const diagnostico = diagnosticarDestinoAwin(afiliada, destinoEsperado);
  if (diagnostico.temUed && !diagnostico.bateDestino) {
    return {
      ok: false,
      motivo: "awin_ued_final_divergente",
      destinoFinal: diagnostico.destinoFinal
    };
  }
  return { ok: true, motivo: "", destinoFinal: diagnostico.destinoFinal };
}

function substituirAwinaffidPreservandoDeeplink(url = "", publisherId = "") {
  const original = texto(url);
  const novoPublisher = texto(publisherId);
  if (!original || !novoPublisher || !awinComUedValido(original)) {
    return { ok: false, url: "", motivo: "awin_original_sem_ued_ou_publisher" };
  }

  const destinoAntes = extrairUrlKabumDeAwin(original);
  let convertido = original;
  if (/[?&]awinaffid=/i.test(convertido)) {
    convertido = convertido.replace(/([?&]awinaffid=)[^&#]*/i, `$1${encodeURIComponent(novoPublisher)}`);
  } else {
    const separador = convertido.includes("?") ? "&" : "?";
    convertido = `${convertido}${separador}awinaffid=${encodeURIComponent(novoPublisher)}`;
  }

  const destinoDepois = extrairUrlKabumDeAwin(convertido);
  if (!destinoAntes || destinoAntes !== destinoDepois) {
    return { ok: false, url: "", motivo: "awin_ued_alterado_na_preservacao" };
  }

  return {
    ok: true,
    url: convertido,
    motivo: "awin_original_preservado_trocou_awinaffid",
    destino: destinoAntes
  };
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

async function converterOcorrenciasAwinKabum({ linksClassificados = [], clienteId = "", deps = {}, integracao = null, linkAfiliadoPrincipal = "", urlOriginalEngine = "", job = {}, evento = {} } = {}) {
  const cache = new Map();
  const saida = [];
  const publisherId = publisherIdAwin(integracao || {});
  for (const [indice, link] of (Array.isArray(linksClassificados) ? linksClassificados : []).entries()) {
    const urlOriginal = urlCapturadaOcorrenciaAwin(link) || texto(link.urlProduto || "");
    const urlDestinoFuncional = extrairUrlKabumDeAwin(urlOriginal) || texto(link.urlProduto || urlOriginal);
    const urlParaConverter = awinComUedValido(urlOriginal) ? urlOriginal : urlDestinoFuncional;
    const uedOriginal = extrairUrlKabumDeAwin(urlOriginal);
    if (!urlOriginal || !/kabum\.com\.br|awin1?\.com|awin\.com/i.test(urlOriginal)) {
      saida.push(link);
      continue;
    }
    const papel = texto(link.papelLink || "produto");
    const chave = `awin:${clienteId}:${papel}:${urlOriginal.toLowerCase()}`;
    let conversao = cache.get(chave);
    if (!conversao) {
      const awinPreservado = substituirAwinaffidPreservandoDeeplink(urlOriginal, publisherId);
      if (awinPreservado.ok) {
        conversao = {
          urlAfiliada: awinPreservado.url,
          renderizavel: true,
          status: "convertida",
          motivo: awinPreservado.motivo,
          destinoFuncional: awinPreservado.destino
        };
      } else if (texto(urlOriginalEngine) && destinosKabumEquivalentes(urlDestinoFuncional, urlOriginalEngine) && linkAfiliadoPrincipal) {
        const diagnosticoPrincipal = conversaoAwinRenderizavel(linkAfiliadoPrincipal, urlDestinoFuncional);
        conversao = diagnosticoPrincipal.ok
          ? {
            urlAfiliada: linkAfiliadoPrincipal,
            renderizavel: true,
            status: "convertida",
            motivo: "deeplink_principal_workspace_convertido",
            destinoFuncional: diagnosticoPrincipal.destinoFinal || urlDestinoFuncional
          }
          : null;
      } else {
        conversao = null;
      }

      if (!conversao) {
        try {
          const urlAfiliada = typeof deps.gerarDeepLinkAwin === "function"
            ? await deps.gerarDeepLinkAwin(urlParaConverter, clienteId)
            : "";
          const diagnosticoGerado = conversaoAwinRenderizavel(urlAfiliada, urlDestinoFuncional);
          conversao = {
            urlAfiliada: diagnosticoGerado.ok ? texto(urlAfiliada) : "",
            renderizavel: diagnosticoGerado.ok,
            status: diagnosticoGerado.ok ? "convertida" : "falhou",
            motivo: diagnosticoGerado.motivo || "awin_workspace_convertido_por_ocorrencia",
            destinoFuncional: diagnosticoGerado.destinoFinal || urlDestinoFuncional
          };
        } catch (_) {
          conversao = { urlAfiliada: "", renderizavel: false, status: "falhou", motivo: "falha_tecnica_conversao_awin" };
        }
      }
      cache.set(chave, conversao);
    }
    const ordemCaptura = Number(link.ordemCaptura || link.ordem || indice + 1) || (indice + 1);
    const ocorrenciaId = texto(link.ocorrenciaId || link.idOcorrencia || link.id || `awin:${papel}:${ordemCaptura}`);
    const uedFinalDecodificado = extrairUrlKabumDeAwin(conversao.urlAfiliada);
    const convertido = {
      ...link,
      url: urlOriginal,
      urlOriginal,
      url_original: urlOriginal,
      urlProduto: urlDestinoFuncional,
      urlDestinoFuncional,
      papelLink: papel,
      papel,
      tipo: papel,
      ordemCaptura,
      ocorrenciaId,
      urlAfiliada: conversao.urlAfiliada,
      urlAfiliadaWorkspace: conversao.urlAfiliada,
      renderizavel: conversao.renderizavel,
      convertidoWorkspace: conversao.renderizavel,
      conversaoStatus: conversao.status,
      motivoConversao: conversao.motivo,
      urlUsadaNaConversao: urlParaConverter,
      uedOriginal,
      uedFinalDecodificado
    };
    logAwinAdapter("[KABUM-AWIN-CONVERSAO-OCORRENCIA]", {
      jobId: job.id || null,
      eventoId: job.evento_id || evento.id || null,
      clienteId,
      ocorrenciaId,
      ordemCaptura,
      papel,
      urlOriginal,
      uedOriginal,
      urlUsadaNaConversao: urlParaConverter,
      urlAfiliadaWorkspace: conversao.urlAfiliada,
      uedFinalDecodificado,
      conversaoStatus: conversao.status,
      renderizavel: conversao.renderizavel,
      motivo: conversao.motivo
    });
    saida.push(convertido);
  }
  return saida;
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
  const linksClassificadosComConversao = await converterOcorrenciasAwinKabum({
    linksClassificados,
    clienteId,
    deps,
    integracao,
    linkAfiliadoPrincipal: linkAfiliado,
    urlOriginalEngine,
    job,
    evento
  });

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
      linksClassificados: linksClassificadosComConversao,
      linksComerciais: linksClassificadosComConversao,
      integracaoUsada: integracaoAwin ? "awin" : "kabum",
      camposProduto: Object.keys(produto || {}),
      produto
    }
  };
}

module.exports = {
  importarAwinEngine
};
