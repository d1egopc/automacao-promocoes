const { queryEngine } = require("../../database");
const { classificarCategoriaOferta } = require("../../../../marketplaces/inteligencia/classificador-categorias");
const { avaliarOfertaUniversal } = require("../../../../modules/inteligencia-universal");

function resumoTemplateInputAuditoria(templateInput = {}) {
  return {
    precoAtual: templateInput.precoAtual ?? "",
    precoOriginal: templateInput.precoOriginal ?? "",
    descontoPercentual: templateInput.descontoPercentual ?? "",
    economia: templateInput.economia ?? "",
    parcelamento: templateInput.parcelamento || "",
    cupom: templateInput.cupom || "",
    cupomTipo: templateInput.cupomTipo || "",
    beneficioTexto: templateInput.beneficioTexto || "",
    freteGratis: templateInput.freteGratis === true,
    cashback: templateInput.cashback || "",
    linkAfiliado: templateInput.linkAfiliado || ""
  };
}

function auditarInteligenciaUniversalMlEngine({ job = {}, produto = {}, ofertaAdapter = {}, linkAfiliado = "" } = {}) {
  const antes = {
    preco: produto.precoAtual || produto.preco || "",
    precoOriginal: produto.precoAntigo || produto.precoOriginal || "",
    cupom: produto.cupom || "",
    avisoCupom: produto.avisoCupom || "",
    tipoCupom: produto.tipoCupom || produto.cupomTipo || "",
    linkAfiliado,
    imagem: produto.imagem || "",
    categoria: produto.categoria || produto.categoriaProduto || "",
    score: produto.score || null,
    templateInput: {
      precoAtual: produto.precoAtual || produto.preco || "",
      precoOriginal: produto.precoAntigo || produto.precoOriginal || "",
      cupom: produto.cupom || "",
      cupomTipo: produto.tipoCupom || produto.cupomTipo || "",
      beneficioTexto: ofertaAdapter.beneficioTexto || ofertaAdapter.beneficioExtra || produto.beneficioTexto || produto.beneficioExtra || produto.avisoCupom || "",
      linkAfiliado
    }
  };

  try {
    const resultadoV2 = avaliarOfertaUniversal({
      titulo: ofertaAdapter.titulo || produto.titulo || produto.nome || "",
      marketplace: "mercadolivre",
      precoAtual: ofertaAdapter.preco || produto.precoAtual || produto.preco || "",
      precoOriginal: ofertaAdapter.precoOriginal || produto.precoAntigo || produto.precoOriginal || "",
      cupom: ofertaAdapter.cupom || produto.cupom || "",
      cupomTipo: ofertaAdapter.cupomTipo || produto.tipoCupom || produto.cupomTipo || "",
      beneficioTexto: ofertaAdapter.beneficioTexto || ofertaAdapter.beneficioExtra || produto.beneficioTexto || produto.beneficioExtra || produto.avisoCupom || "",
      linkAfiliado: ofertaAdapter.linkAfiliado || linkAfiliado,
      linkOriginal: ofertaAdapter.linkOriginal || produto.linkOriginal || "",
      imagem: ofertaAdapter.imagem || produto.imagem || "",
      categoria: ofertaAdapter.categoria || produto.categoria || produto.categoriaProduto || "",
      score: ofertaAdapter.score || produto.score || null,
      descontoPercentual: ofertaAdapter.descontoPercentual || produto.descontoPercentual || "",
      economia: ofertaAdapter.economia || produto.economia || "",
      parcelamento: ofertaAdapter.parcelamento || produto.parcelamento || "",
      freteGratis: ofertaAdapter.freteGratis === true || produto.freteGratis === true,
      cashback: ofertaAdapter.cashback || produto.cashback || "",
      origem: "engine_ml"
    }, {
      clienteId: job.cliente_id || job.clienteId || "",
      origem: "engine_ml",
      exigirLinkAfiliado: true
    });

    const depois = {
      preco: resultadoV2.ofertaUniversal?.precoAtual ?? "",
      precoOriginal: resultadoV2.ofertaUniversal?.precoOriginal ?? "",
      cupom: resultadoV2.ofertaUniversal?.cupom || "",
      avisoCupom: resultadoV2.ofertaUniversal?.beneficioTexto || "",
      tipoCupom: resultadoV2.ofertaUniversal?.cupomTipo || "",
      linkAfiliado: resultadoV2.ofertaUniversal?.linkAfiliado || "",
      imagem: resultadoV2.ofertaUniversal?.imagem || "",
      categoria: resultadoV2.categoria || "",
      score: resultadoV2.score?.score ?? null,
      templateInput: resumoTemplateInputAuditoria(resultadoV2.templateInput || {})
    };

    console.log("[ENGINE-ML-V2-AUDITORIA]", JSON.stringify({
      jobId: job.id,
      eventoId: job.evento_id,
      clienteId: job.cliente_id || job.clienteId || "",
      titulo: ofertaAdapter.titulo || produto.titulo || produto.nome || "",
      okV2: resultadoV2.ok,
      statusV2: resultadoV2.status,
      motivoV2: resultadoV2.motivo,
      antes,
      depois,
      diferencas: {
        preco: String(antes.preco || "") !== String(depois.preco || ""),
        precoOriginal: String(antes.precoOriginal || "") !== String(depois.precoOriginal || ""),
        cupom: String(antes.cupom || "") !== String(depois.cupom || ""),
        avisoCupom: String(antes.avisoCupom || "") !== String(depois.avisoCupom || ""),
        tipoCupom: String(antes.tipoCupom || "") !== String(depois.tipoCupom || ""),
        linkAfiliado: String(antes.linkAfiliado || "") !== String(depois.linkAfiliado || ""),
        imagem: String(antes.imagem || "") !== String(depois.imagem || ""),
        categoria: String(antes.categoria || "") !== String(depois.categoria || ""),
        score: String(antes.score ?? "") !== String(depois.score ?? "")
      },
      logsV2: resultadoV2.logs || []
    }));

    return resultadoV2;
  } catch (e) {
    console.log("[ENGINE-ML-V2-AUDITORIA-ERRO]", JSON.stringify({
      jobId: job.id,
      eventoId: job.evento_id,
      clienteId: job.cliente_id || job.clienteId || "",
      erro: e.message,
      antes
    }));
    return null;
  }
}
function categoriaGenericaMercadoLivre(categoria = "") {
  const texto = String(categoria || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();

  return !texto || texto === "mercadolivre" || texto === "ml" || texto === "marketplace" || texto === "generica" || texto === "geral";
}

function resolverCategoriaMercadoLivre(produto = {}) {
  const categoria = produto.categoria || produto.categoriaProduto || "";
  if (!categoriaGenericaMercadoLivre(categoria)) return categoria;

  return classificarCategoriaOferta({
    titulo: produto.titulo || produto.nome || "",
    nome: produto.nome || produto.titulo || ""
  }, produto.titulo || produto.nome || "");
}

function escolherLinkMercadoLivreDetalhado(links = [], evento = {}) {
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

  return candidatos
    .map(candidato => ({
      ...candidato,
      url: String(candidato.url || "").trim()
    }))
    .find(candidato => /mercadolivre\.com|meli\.la/i.test(candidato.url)) || { url: "", link: null, campo: "" };
}

function isMeliLa(url = "") {
  return /(^|\/\/)meli\.la\//i.test(String(url || ""));
}

function isSocialMercadoLivre(url = "") {
  try {
    const parsed = new URL(String(url || "").trim());
    return parsed.hostname.toLowerCase().includes("mercadolivre.com.br") && parsed.pathname.toLowerCase().startsWith("/social/");
  } catch {
    return false;
  }
}

function isUrlProdutoMercadoLivre(url = "") {
  try {
    const parsed = new URL(String(url || "").trim());
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname || "";

    if (!host.endsWith("mercadolivre.com.br")) return false;
    if (host.includes("produto.mercadolivre.com.br") && /\/MLB-?\d+/i.test(path)) return true;
    if (/\/p\/MLB/i.test(path)) return true;
    if (/\/permalink\/MLB/i.test(path)) return true;
    if (/MLB-?\d+/i.test(path) && !path.toLowerCase().startsWith("/social/")) return true;

    return false;
  } catch {
    return false;
  }
}

function dominioUrl(url = "") {
  try {
    return new URL(String(url || "")).hostname.toLowerCase();
  } catch {
    return "";
  }
}

async function atualizarLinkExpandidoEngine(link = null, urlExpandida = "", contexto = {}) {
  if (!link?.id || !urlExpandida) return;

  const resultado = await queryEngine(
    `UPDATE engine_links
        SET url_expandida = $2,
            dominio_final = $3,
            redirect_ok = TRUE,
            motivo_redirect = NULL,
            metadata = COALESCE(metadata, '{}'::jsonb) || $4::jsonb
      WHERE id = $1`,
    [
      link.id,
      urlExpandida,
      dominioUrl(urlExpandida),
      JSON.stringify({
        usouResolverRadarMl: true,
        linkOriginalEngine: link.url_original || link.url_normalizada || "",
        linkExpandidoEngine: urlExpandida
      })
    ]
  );

  if (!resultado.ok) {
    console.log("[ENGINE-ML-URL-PRODUTO-RESOLVIDA]", {
      ...contexto,
      linkId: link.id,
      urlExpandida,
      ok: false,
      motivo: "engine_links_update_falhou",
      erro: resultado.erro || resultado.motivo || ""
    });
  }
}

function escolherProdutoResolvido(resolucao = {}, urlOriginal = "") {
  const candidatos = [
    resolucao.linkOriginalLimpo,
    resolucao.linkResolvido,
    resolucao.urlResolvida,
    urlOriginal
  ];

  return candidatos
    .map(url => String(url || "").trim())
    .find(isUrlProdutoMercadoLivre) || "";
}

async function resolverUrlProdutoMercadoLivreEngine(urlOriginalEngine = "", deps = {}, contexto = {}) {
  if (isUrlProdutoMercadoLivre(urlOriginalEngine)) {
    console.log("[ENGINE-ML-URL-PRODUTO-RESOLVIDA]", {
      ...contexto,
      linkOriginalEngine: urlOriginalEngine,
      linkExpandidoEngine: urlOriginalEngine,
      usouResolverRadar: false,
      ok: true,
      motivo: "url_produto_direta"
    });

    return {
      ok: true,
      urlProduto: urlOriginalEngine,
      linkExpandidoEngine: urlOriginalEngine,
      expandiuMeliLa: false,
      resolucaoRadar: null
    };
  }

  if (typeof deps.resolverLinkOriginalRadar !== "function") {
    console.log("[ENGINE-ML-URL-PRODUTO-RESOLVIDA]", {
      ...contexto,
      linkOriginalEngine: urlOriginalEngine,
      ok: false,
      motivo: "resolver_radar_indisponivel"
    });

    return { ok: false, motivo: "ml_url_produto_nao_resolvida", detalhe: "resolver_radar_indisponivel" };
  }

  let resolucao;
  try {
    resolucao = await deps.resolverLinkOriginalRadar(urlOriginalEngine);
  } catch (e) {
    console.log("[ENGINE-ML-URL-PRODUTO-RESOLVIDA]", {
      ...contexto,
      linkOriginalEngine: urlOriginalEngine,
      ok: false,
      motivo: "resolver_radar_erro",
      erro: e.message
    });

    return { ok: false, motivo: "ml_url_produto_nao_resolvida", detalhe: e.message };
  }

  const urlSocial = [urlOriginalEngine, resolucao?.urlResolvida, resolucao?.linkResolvido]
    .map(url => String(url || "").trim())
    .find(isSocialMercadoLivre) || "";

  if (urlSocial) {
    console.log("[ENGINE-ML-URL-SOCIAL-DETECTADA]", {
      ...contexto,
      linkOriginalEngine: urlOriginalEngine,
      urlSocial,
      motivoRadar: resolucao?.motivo || resolucao?.motivoTecnico || ""
    });
  }

  const urlProduto = escolherProdutoResolvido(resolucao || {}, urlOriginalEngine);
  if (!urlProduto) {
    console.log("[ENGINE-ML-URL-PRODUTO-RESOLVIDA]", {
      ...contexto,
      linkOriginalEngine: urlOriginalEngine,
      urlResolvidaRadar: resolucao?.urlResolvida || "",
      linkResolvidoRadar: resolucao?.linkResolvido || "",
      tipoLinkRadar: resolucao?.tipoLinkRadar || "",
      ok: false,
      motivo: "ml_url_produto_nao_resolvida"
    });

    return {
      ok: false,
      motivo: "ml_url_produto_nao_resolvida",
      resolucaoRadar: resolucao || null
    };
  }

  console.log("[ENGINE-ML-URL-PRODUTO-RESOLVIDA]", {
    ...contexto,
    linkOriginalEngine: urlOriginalEngine,
    linkExpandidoEngine: urlProduto,
    urlResolvidaRadar: resolucao?.urlResolvida || "",
    tipoLinkRadar: resolucao?.tipoLinkRadar || "",
    usouResolverRadar: true,
    ok: true,
    motivo: "url_produto_resolvida_radar"
  });

  return {
    ok: true,
    urlProduto,
    linkExpandidoEngine: urlProduto,
    expandiuMeliLa: isMeliLa(urlOriginalEngine) && urlProduto !== urlOriginalEngine,
    resolucaoRadar: resolucao || null
  };
}

async function importarMercadoLivreEngine({ job = {}, evento = {}, links = [], deps = {} } = {}) {
  const clienteId = String(job.cliente_id || "").trim();
  const linkEscolhido = escolherLinkMercadoLivreDetalhado(links, evento);
  const urlOriginalEngine = linkEscolhido.url;

  if (!clienteId) {
    return { ok: false, motivo: "cliente_invalido", marketplace: "mercadolivre" };
  }

  if (!urlOriginalEngine) {
    return { ok: false, motivo: "link_mercadolivre_nao_encontrado", marketplace: "mercadolivre" };
  }

  if (typeof deps.importarMercadoLivre !== "function") {
    return { ok: false, motivo: "importador_ml_indisponivel", marketplace: "mercadolivre" };
  }

  if (typeof deps.getIntegracaoCliente !== "function") {
    return { ok: false, motivo: "get_integracao_indisponivel", marketplace: "mercadolivre" };
  }

  const integracao = deps.getIntegracaoCliente(clienteId, "mercadolivre");
  if (!integracao) {
    return { ok: false, motivo: "integracao_ausente", marketplace: "mercadolivre" };
  }

  const credenciais = integracao?.credenciais || {};
  const temCookies = Boolean(credenciais.cookies);
  const temTag = Boolean(credenciais.tag);
  const resolucaoProduto = await resolverUrlProdutoMercadoLivreEngine(urlOriginalEngine, deps, {
    jobId: job.id,
    eventoId: job.evento_id,
    clienteId
  });

  if (!resolucaoProduto.ok) {
    return {
      ok: false,
      motivo: "ml_url_produto_nao_resolvida",
      marketplace: "mercadolivre",
      linkOriginal: urlOriginalEngine,
      metadata: {
        linkOriginalEngine: urlOriginalEngine,
        linkExpandidoEngine: resolucaoProduto.linkExpandidoEngine || "",
        expandiuMeliLa: false,
        resolucaoRadar: resolucaoProduto.resolucaoRadar || null,
        detalheResolucao: resolucaoProduto.detalhe || ""
      }
    };
  }

  const urlImportador = resolucaoProduto.urlProduto;
  const linkExpandidoEngine = resolucaoProduto.linkExpandidoEngine || urlImportador;
  const expandiuMeliLa = resolucaoProduto.expandiuMeliLa === true;

  await atualizarLinkExpandidoEngine(linkEscolhido.link, linkExpandidoEngine, {
    jobId: job.id,
    eventoId: job.evento_id,
    clienteId
  });

  console.log("[ENGINE-ML-IMPORTADOR-CHAMADA]", {
    clienteId,
    urlUsada: urlImportador,
    temCookies,
    temTag
  });

  const produto = await deps.importarMercadoLivre(urlImportador, clienteId, {
    getIntegracaoCliente: deps.getIntegracaoCliente,
    gerarLinkAfiliadoMercadoLivre: deps.gerarLinkAfiliadoMercadoLivre,
    contextoEngine: {
      jobId: job.id,
      eventoId: job.evento_id,
      clienteId
    }
  });

  console.log("[ENGINE-ML-IMPORTADOR-RETORNO]", JSON.stringify({
    jobId: job.id,
    eventoId: job.evento_id,
    clienteId,
    ok: Boolean(produto),
    titulo: produto?.titulo || produto?.nome || "",
    precoAtual: produto?.precoAtual || produto?.preco || "",
    precoOriginal: produto?.precoOriginal || produto?.precoAntigo || "",
    cupom: produto?.cupom || "",
    avisoCupom: produto?.avisoCupom || "",
    tipoCupom: produto?.tipoCupom || produto?.cupomTipo || "",
    linkAfiliado: produto?.linkAfiliado || "",
    linkFinal: produto?.linkFinal || "",
    link: produto?.link || "",
    imagem: produto?.imagem || "",
    categoria: produto?.categoria || produto?.categoriaProduto || "",
    score: produto?.score || null,
    camposRetorno: Object.keys(produto || {}),
    temLinkAfiliado: Boolean(produto?.linkAfiliado),
    temLinkFinal: Boolean(produto?.linkFinal),
    temLink: Boolean(produto?.link)
  }));

  if (!produto) {
    return { ok: false, motivo: "importador_sem_retorno", marketplace: "mercadolivre", linkOriginal: urlOriginalEngine };
  }

  const linkAfiliado = produto.linkAfiliado || produto.linkFinal || produto.link || "";
  if (!linkAfiliado) {
    console.log("[ENGINE-ML-LINK-AFILIADO-VAZIO]", {
      jobId: job.id,
      eventoId: job.evento_id,
      clienteId,
      urlUsada: urlImportador,
      linkOriginalEngine: urlOriginalEngine,
      linkExpandidoEngine,
      expandiuMeliLa,
      temCookies,
      temTag,
      motivo: "link_afiliado_vazio",
      camposProduto: Object.keys(produto || {})
    });

    return {
      ok: false,
      motivo: "link_afiliado_vazio",
      marketplace: "mercadolivre",
      linkOriginal: urlOriginalEngine,
      linkExpandido: linkExpandidoEngine,
      metadata: {
        linkOriginalEngine: urlOriginalEngine,
        linkExpandidoEngine,
        expandiuMeliLa,
        resolucaoRadar: resolucaoProduto.resolucaoRadar || null,
        camposProduto: Object.keys(produto || {}),
        produto
      }
    };
  }

  const beneficioExtra = produto.beneficioExtra || produto.beneficioTexto || "";
  const avisoCupom = produto.avisoCupom || "";
  const cupomTipo = produto.tipoCupom || produto.cupomTipo || "";

  const ofertaAdapter = {
    ok: true,
    marketplace: "mercadolivre",
    titulo: produto.titulo || produto.nome || "",
    preco: produto.precoAtual || produto.preco || "",
    precoOriginal: produto.precoOriginal || produto.precoAntigo || "",
    descontoPercentual: produto.descontoPercentual || "",
    economia: produto.economia || "",
    imagem: produto.imagem || "",
    linkOriginal: produto.linkOriginal || urlOriginalEngine,
    linkExpandido: produto.urlFinal || linkExpandidoEngine || urlImportador,
    linkAfiliado,
    categoria: resolverCategoriaMercadoLivre(produto),
    cupom: produto.cupom || "",
    cupomTipo,
    tipoCupom: cupomTipo,
    avisoCupom,
    beneficioTexto: beneficioExtra || avisoCupom,
    beneficioExtra,
    parcelamento: produto.parcelamento || "",
    freteGratis: produto.freteGratis === true,
    cashback: produto.cashback || "",
    score: produto.score || null
  };

  const auditoriaV2 = auditarInteligenciaUniversalMlEngine({
    job,
    produto,
    ofertaAdapter,
    linkAfiliado
  });

  return {
    ...ofertaAdapter,
    metadata: {
      auditoriaInteligenciaUniversalV2: auditoriaV2 ? {
        ok: auditoriaV2.ok,
        status: auditoriaV2.status,
        motivo: auditoriaV2.motivo,
        categoria: auditoriaV2.categoria,
        score: auditoriaV2.score?.score ?? null,
        prioridade: auditoriaV2.prioridade,
        templateInput: auditoriaV2.templateInput
      } : null,
      adapter: "mercadolivre",
      jobId: job.id,
      eventoId: job.evento_id,
      linkOriginalEngine: urlOriginalEngine,
      linkExpandidoEngine,
      expandiuMeliLa,
      resolucaoRadar: resolucaoProduto.resolucaoRadar || null,
      camposProduto: Object.keys(produto || {}),
      produto
    }
  };
}

module.exports = {
  importarMercadoLivreEngine
};