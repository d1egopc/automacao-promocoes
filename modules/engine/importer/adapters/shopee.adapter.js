const { classificarCategoriaOferta } = require("../../../../marketplaces/inteligencia/classificador-categorias");
const { avaliarOfertaUniversal } = require("../../../../modules/inteligencia-universal");

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

function textoOriginalEvento(evento = {}) {
  return texto(evento.texto_original || evento.textoOriginal || evento.texto || "");
}

function escolherLinkShopee(links = [], evento = {}) {
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
    .filter(candidato => /(?:^|\.)shopee\.com\.br|s\.shopee\.com\.br/i.test(candidato.url));

  if (!validos.length) return { url: "", link: null, campo: "" };

  const textoRadar = textoOriginalEvento(evento).toLowerCase();
  const urlsTexto = Array.from(textoOriginalEvento(evento).matchAll(/https?:\/\/[^\s]+/gi)).map(match => match[0]);
  const urlProdutoMarcada = urlsTexto.find((url) => {
    const idx = textoOriginalEvento(evento).indexOf(url);
    const antes = idx >= 0 ? textoRadar.slice(Math.max(0, idx - 80), idx) : "";
    return /produto aqui|confira aqui|produto|comprar|link da oferta|oferta aqui/.test(antes) && /shopee/i.test(url);
  });

  if (urlProdutoMarcada) {
    const marcado = validos.find(candidato => candidato.url === urlProdutoMarcada || candidato.url.includes(urlProdutoMarcada));
    if (marcado) return marcado;
  }

  const naoCupom = validos.filter(candidato => !/(?:cupom|voucher|promotion|promo)/i.test(candidato.url));
  return naoCupom[naoCupom.length - 1] || validos[validos.length - 1];
}

function pareceCupomRealShopee(codigo = "") {
  const cupom = texto(codigo).toUpperCase().replace(/[^A-Z0-9_-]/g, "").trim();
  if (cupom.length < 5 || cupom.length > 40) return false;
  if (!/[A-Z]/.test(cupom)) return false;

  const bloqueados = new Set([
    "SHOPEE",
    "CUPOM",
    "CUPONS",
    "CODIGO",
    "CODIGO",
    "VOUCHER",
    "RESGATE",
    "RESGATAR",
    "APLIQUE",
    "DISPONIVEL",
    "DISPONIVEL",
    "CLIENTE",
    "PARA",
    "PRODUTO",
    "LINK",
    "PAGINA",
    "PAGINA"
  ]);

  if (bloqueados.has(cupom)) return false;
  return /[A-Z]{3,}/.test(cupom) && /[A-Z0-9_-]/.test(cupom);
}

function extrairBeneficioTextoShopee(textoRadar = "") {
  const fonte = String(textoRadar || "");
  const beneficio =
    fonte.match(/(?:cupom\s+de\s+)?R\$\s*\d{1,5}(?:[.,]\d{1,2})?\s*OFF/i)?.[0] ||
    fonte.match(/\d{1,3}%\s*OFF/i)?.[0] ||
    fonte.match(/(?:no pix|pague via pix|\d{1,2}x\s+no\s+(?:cartao|cart.o))/i)?.[0] ||
    "";

  return texto(beneficio);
}

function extrairCupomTextoRadarShopee(textoRadar = "") {
  const fonte = String(textoRadar || "");
  const match = fonte.match(/(?:cupom|use o cupom|aplique o cupom|(?:codigo|c.digo))\s*:?[\s\n]*([A-Z0-9_-]{5,40})/i);
  const cupom = pareceCupomRealShopee(match?.[1] || "")
    ? String(match[1]).toUpperCase().replace(/[^A-Z0-9_-]/g, "").trim()
    : "";

  if (cupom) {
    return {
      cupom,
      tipoCupom: "texto_radar",
      cupomTipo: "texto_radar",
      avisoCupom: `Use o cupom ${cupom} antes de finalizar a compra.`,
      beneficioExtra: ""
    };
  }

  const beneficio = extrairBeneficioTextoShopee(fonte);
  if (beneficio) {
    return {
      cupom: "",
      tipoCupom: "beneficio_texto_radar",
      cupomTipo: "beneficio_texto_radar",
      avisoCupom: beneficio,
      beneficioExtra: beneficio
    };
  }

  if (/resgate\s+o\s+cupom|cupom\s+(?:disponivel|dispon.vel)|aplique\s+o\s+cupom\s+(?:disponivel|dispon.vel)/i.test(fonte)) {
    return {
      cupom: "",
      tipoCupom: "resgate_pagina_shopee",
      cupomTipo: "resgate_pagina_shopee",
      avisoCupom: "Cupom disponivel na pagina. Resgate antes de finalizar.",
      beneficioExtra: "Cupom disponivel na pagina. Resgate antes de finalizar."
    };
  }

  return { cupom: "", tipoCupom: "", cupomTipo: "", avisoCupom: "", beneficioExtra: "" };
}

function categoriaGenericaShopee(categoria = "") {
  const normalizada = texto(categoria)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();

  return !normalizada || normalizada === "shopee" || normalizada === "marketplace" || normalizada === "generica" || normalizada === "geral";
}

function resolverCategoriaShopee(produto = {}, oferta = {}) {
  const categoria = produto.categoria || produto.categoriaProduto || oferta.categoria || "";
  if (!categoriaGenericaShopee(categoria)) return categoria;

  const titulo = produto.titulo || produto.nome || oferta.titulo || "";
  return classificarCategoriaOferta({
    titulo,
    nome: titulo,
    marketplace: "shopee"
  }, titulo);
}

function aplicarFallbackTextoRadar(produto = {}, evento = {}) {
  const cupomTexto = extrairCupomTextoRadarShopee(textoOriginalEvento(evento));
  if (!cupomTexto.cupom && !cupomTexto.avisoCupom && !cupomTexto.beneficioExtra) return produto;

  return {
    ...produto,
    cupom: produto.cupom || cupomTexto.cupom,
    tipoCupom: produto.tipoCupom || produto.cupomTipo || cupomTexto.tipoCupom,
    cupomTipo: produto.cupomTipo || produto.tipoCupom || cupomTexto.cupomTipo,
    avisoCupom: produto.avisoCupom || cupomTexto.avisoCupom,
    beneficioExtra: produto.beneficioExtra || produto.beneficioTexto || cupomTexto.beneficioExtra || cupomTexto.avisoCupom,
    beneficioTexto: produto.beneficioTexto || produto.beneficioExtra || cupomTexto.beneficioExtra || cupomTexto.avisoCupom
  };
}

function auditarV2Shopee({ job = {}, produto = {}, ofertaAdapter = {} } = {}) {
  try {
    const resultadoV2 = avaliarOfertaUniversal({
      titulo: ofertaAdapter.titulo || produto.titulo || produto.nome || "",
      marketplace: "shopee",
      precoAtual: ofertaAdapter.preco || produto.precoAtual || produto.preco || "",
      precoOriginal: ofertaAdapter.precoOriginal || produto.precoAntigo || produto.precoOriginal || "",
      cupom: ofertaAdapter.cupom || produto.cupom || "",
      cupomTipo: ofertaAdapter.cupomTipo || produto.tipoCupom || produto.cupomTipo || "",
      beneficioTexto: ofertaAdapter.beneficioTexto || ofertaAdapter.beneficioExtra || produto.beneficioTexto || produto.beneficioExtra || produto.avisoCupom || "",
      linkAfiliado: ofertaAdapter.linkAfiliado || produto.linkAfiliado || produto.link || "",
      linkOriginal: ofertaAdapter.linkOriginal || produto.linkOriginal || "",
      imagem: ofertaAdapter.imagem || produto.imagem || "",
      categoria: ofertaAdapter.categoria || produto.categoria || produto.categoriaProduto || "",
      score: ofertaAdapter.score || produto.score || null,
      parcelamento: ofertaAdapter.parcelamento || produto.parcelamento || produto.avisoVariacaoPreco || "",
      freteGratis: ofertaAdapter.freteGratis === true || produto.freteGratis === true,
      cashback: ofertaAdapter.cashback || produto.cashback || "",
      origem: "engine_shopee"
    }, {
      clienteId: job.cliente_id || job.clienteId || "",
      origem: "engine_shopee",
      exigirLinkAfiliado: true
    });

    console.log("[ENGINE-SHOPEE-V2-AUDITORIA]", JSON.stringify({
      jobId: job.id,
      eventoId: job.evento_id,
      clienteId: job.cliente_id || job.clienteId || "",
      titulo: ofertaAdapter.titulo || produto.titulo || produto.nome || "",
      okV2: resultadoV2.ok,
      statusV2: resultadoV2.status,
      motivoV2: resultadoV2.motivo,
      antes: {
        preco: produto.precoAtual || produto.preco || "",
        precoOriginal: produto.precoAntigo || produto.precoOriginal || "",
        cupom: produto.cupom || "",
        tipoCupom: produto.tipoCupom || produto.cupomTipo || "",
        avisoCupom: produto.avisoCupom || "",
        beneficioExtra: produto.beneficioExtra || produto.beneficioTexto || "",
        linkAfiliado: produto.linkAfiliado || produto.link || "",
        categoria: produto.categoria || ""
      },
      depois: {
        preco: resultadoV2.ofertaUniversal?.precoAtual ?? "",
        precoOriginal: resultadoV2.ofertaUniversal?.precoOriginal ?? "",
        cupom: resultadoV2.ofertaUniversal?.cupom || "",
        tipoCupom: resultadoV2.ofertaUniversal?.cupomTipo || "",
        beneficioTexto: resultadoV2.ofertaUniversal?.beneficioTexto || "",
        linkAfiliado: resultadoV2.ofertaUniversal?.linkAfiliado || "",
        categoria: resultadoV2.categoria || "",
        score: resultadoV2.score?.score ?? null,
        templateInput: resultadoV2.templateInput || {}
      }
    }));

    return resultadoV2;
  } catch (e) {
    console.log("[ENGINE-SHOPEE-V2-AUDITORIA-ERRO]", JSON.stringify({
      jobId: job.id,
      eventoId: job.evento_id,
      clienteId: job.cliente_id || job.clienteId || "",
      erro: e.message
    }));
    return null;
  }
}

function enriquecerComV2(ofertaAdapter = {}, auditoriaV2 = null, produto = {}) {
  if (!auditoriaV2) return ofertaAdapter;

  const ofertaUniversal = auditoriaV2.ofertaUniversal || {};
  const templateInput = auditoriaV2.templateInput || {};
  const scoreV2 = auditoriaV2.score?.score;
  const beneficioTexto = primeiroValor(
    ofertaUniversal.beneficioTexto,
    templateInput.beneficioTexto,
    ofertaAdapter.beneficioTexto,
    ofertaAdapter.beneficioExtra,
    produto.beneficioTexto,
    produto.beneficioExtra,
    produto.avisoCupom
  );
  const cupomTipo = primeiroValor(ofertaUniversal.cupomTipo, templateInput.cupomTipo, ofertaAdapter.cupomTipo, produto.tipoCupom, produto.cupomTipo);

  return {
    ...ofertaAdapter,
    preco: primeiroValor(ofertaUniversal.precoAtual, templateInput.precoAtual, ofertaAdapter.preco),
    precoOriginal: primeiroValor(ofertaUniversal.precoOriginal, templateInput.precoOriginal, ofertaAdapter.precoOriginal),
    cupom: primeiroValor(ofertaUniversal.cupom, templateInput.cupom, ofertaAdapter.cupom, produto.cupom),
    cupomTipo,
    tipoCupom: cupomTipo,
    avisoCupom: primeiroValor(ofertaUniversal.avisoCupom, ofertaUniversal.beneficioTexto, templateInput.beneficioTexto, ofertaAdapter.avisoCupom, produto.avisoCupom),
    beneficioTexto,
    beneficioExtra: beneficioTexto,
    parcelamento: primeiroValor(ofertaUniversal.parcelamento, templateInput.parcelamento, ofertaAdapter.parcelamento, produto.parcelamento, produto.avisoVariacaoPreco),
    freteGratis: ofertaUniversal.freteGratis === true || templateInput.freteGratis === true || ofertaAdapter.freteGratis === true || produto.freteGratis === true,
    cashback: primeiroValor(ofertaUniversal.cashback, templateInput.cashback, ofertaAdapter.cashback, produto.cashback),
    categoria: primeiroValor(auditoriaV2.categoria, ofertaUniversal.categoria, ofertaAdapter.categoria),
    score: valorPresente(scoreV2) ? scoreV2 : ofertaAdapter.score
  };
}

async function importarShopeeEngine({ job = {}, evento = {}, links = [], deps = {} } = {}) {
  const clienteId = texto(job.cliente_id || job.clienteId || "");
  const linkEscolhido = escolherLinkShopee(links, evento);
  const urlOriginalEngine = linkEscolhido.url;

  if (!clienteId) {
    return { ok: false, marketplace: "shopee", motivo: "cliente_invalido" };
  }

  if (!urlOriginalEngine) {
    return { ok: false, marketplace: "shopee", motivo: "link_shopee_nao_encontrado" };
  }

  if (typeof deps.importarShopee !== "function") {
    return { ok: false, marketplace: "shopee", motivo: "importador_shopee_indisponivel" };
  }

  if (typeof deps.getIntegracaoCliente !== "function") {
    return { ok: false, marketplace: "shopee", motivo: "get_integracao_indisponivel" };
  }

  const integracao = deps.getIntegracaoCliente(clienteId, "shopee");
  if (!integracao) {
    return { ok: false, marketplace: "shopee", motivo: "integracao_ausente" };
  }

  console.log("[ENGINE-SHOPEE-IMPORTADOR-CHAMADA]", {
    jobId: job.id,
    eventoId: job.evento_id,
    clienteId,
    urlUsada: urlOriginalEngine,
    temAppId: Boolean(integracao?.credenciais?.appId),
    temSecret: Boolean(integracao?.credenciais?.secret)
  });

  const textoOriginalRadar = textoOriginalEvento(evento);
  const produtoBase = await deps.importarShopee(urlOriginalEngine, {
    ...integracao,
    textoOriginal: textoOriginalRadar,
    contextoRadar: {
      textoOriginal: textoOriginalRadar,
      grupoId: evento.grupo_id || "",
      grupoNome: evento.grupo_nome || "",
      origem: evento.origem || "engine"
    },
    contextoEngine: {
      jobId: job.id,
      eventoId: job.evento_id,
      clienteId
    }
  });
  const produto = aplicarFallbackTextoRadar(produtoBase || {}, evento);

  console.log("[ENGINE-SHOPEE-IMPORTADOR-RETORNO]", JSON.stringify({
    jobId: job.id,
    eventoId: job.evento_id,
    clienteId,
    ok: Boolean(produtoBase),
    titulo: produto?.titulo || produto?.nome || "",
    precoAtual: produto?.precoAtual || produto?.preco || "",
    precoOriginal: produto?.precoOriginal || produto?.precoAntigo || "",
    cupom: produto?.cupom || "",
    avisoCupom: produto?.avisoCupom || "",
    tipoCupom: produto?.tipoCupom || produto?.cupomTipo || "",
    beneficioExtra: produto?.beneficioExtra || produto?.beneficioTexto || "",
    linkAfiliado: produto?.linkAfiliado || produto?.link || "",
    imagem: produto?.imagem || "",
    categoria: produto?.categoria || "",
    camposRetorno: Object.keys(produto || {})
  }));

  if (!produtoBase) {
    return { ok: false, marketplace: "shopee", motivo: "importador_sem_retorno", linkOriginal: urlOriginalEngine };
  }

  const linkAfiliado = produto.linkAfiliado || produto.linkFinal || produto.link || "";
  if (!linkAfiliado) {
    return { ok: false, marketplace: "shopee", motivo: "link_afiliado_vazio", linkOriginal: urlOriginalEngine };
  }

  const cupomTipo = produto.tipoCupom || produto.cupomTipo || "";
  const beneficioExtra = produto.beneficioExtra || produto.beneficioTexto || produto.avisoCupom || produto.avisoVariacaoPreco || "";
  const ofertaAdapter = {
    ok: true,
    marketplace: "shopee",
    titulo: produto.titulo || produto.nome || "",
    preco: produto.precoAtual || produto.preco || produto.precoMin || "",
    precoOriginal: produto.precoOriginal || produto.precoAntigo || "",
    imagem: produto.imagem || "",
    linkOriginal: urlOriginalEngine,
    linkExpandido: produto.linkOriginal || urlOriginalEngine,
    linkAfiliado,
    categoria: resolverCategoriaShopee(produto),
    cupom: produto.cupom || "",
    cupomTipo,
    tipoCupom: cupomTipo,
    avisoCupom: produto.avisoCupom || "",
    beneficioTexto: beneficioExtra,
    beneficioExtra,
    parcelamento: produto.parcelamento || produto.avisoVariacaoPreco || "",
    freteGratis: produto.freteGratis === true,
    cashback: produto.cashback || "",
    descontoPix: produto.descontoPix || "",
    descontoApp: produto.descontoApp || "",
    score: produto.score || null
  };

  const auditoriaV2 = auditarV2Shopee({ job, produto, ofertaAdapter });
  const ofertaEnriquecida = enriquecerComV2(ofertaAdapter, auditoriaV2, produto);

  return {
    ...ofertaEnriquecida,
    metadata: {
      adapter: "shopee",
      jobId: job.id,
      eventoId: job.evento_id,
      linkOriginalEngine: urlOriginalEngine,
      campoLinkEscolhido: linkEscolhido.campo || "",
      textoRadarTemCupom: Boolean(extrairCupomTextoRadarShopee(textoOriginalRadar).cupom),
      camposProduto: Object.keys(produto || {}),
      produto,
      auditoriaInteligenciaUniversalV2: auditoriaV2 ? {
        ok: auditoriaV2.ok,
        status: auditoriaV2.status,
        motivo: auditoriaV2.motivo,
        categoria: auditoriaV2.categoria,
        score: auditoriaV2.score?.score ?? null,
        prioridade: auditoriaV2.prioridade,
        templateInput: auditoriaV2.templateInput
      } : null
    }
  };
}

module.exports = {
  importarShopeeEngine
};
