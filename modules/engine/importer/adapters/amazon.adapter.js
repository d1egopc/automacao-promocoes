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

function escolherLinkAmazon(links = [], evento = {}) {
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
      url: texto(candidato.url)
    }))
    .find(candidato => /amazon\.|amzn\.to/i.test(candidato.url)) || { url: "", link: null, campo: "" };
}

function categoriaGenericaAmazon(categoria = "") {
  const normalizada = texto(categoria)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();

  return !normalizada || normalizada === "amazon" || normalizada === "marketplace" || normalizada === "generica" || normalizada === "geral";
}

function resolverCategoriaAmazon(produto = {}, oferta = {}) {
  const categoria = produto.categoria || produto.categoriaProduto || oferta.categoria || "";
  if (!categoriaGenericaAmazon(categoria)) return categoria;

  const titulo = produto.titulo || produto.nome || oferta.titulo || "";
  return classificarCategoriaOferta({
    titulo,
    nome: titulo,
    marketplace: "amazon"
  }, titulo);
}

function normalizarCupomAmazon(cupom = "") {
  const codigo = texto(cupom).toUpperCase().replace(/[^A-Z0-9_-]/g, "").trim();
  const bloqueados = new Set([
    "AMAZON",
    "AMAZONBR",
    "AMAZON.COM",
    "CUPOM",
    "CODIGO",
    "CÓDIGO",
    "PROMOCAO",
    "PROMOÇÃO",
    "DESCONTO",
    "OFERTA",
    "PRIME",
    "APP",
    "SITE",
    "BRASIL",
    "COMPRE",
    "GANHE",
    "CLIENTE",
    "PARA"
  ]);

  if (!codigo || codigo.length < 4 || codigo.length > 24 || bloqueados.has(codigo)) return "";
  if (!/[A-Z]/.test(codigo)) return "";
  return codigo;
}

function extrairCupomTextoRadarAmazon(textoRadar = "") {
  const fonte = String(textoRadar || "");
  const match =
    fonte.match(/(?:cupom|use o cupom|aplique o cupom|codigo promocional|c[oó]digo promocional|com o c[oó]digo)\s*:?\s*([A-Z0-9_-]{4,24})/i) ||
    fonte.match(/\b([A-Z]{3,}[A-Z0-9_-]{1,21})\b\s*(?:na amazon|amazon|no carrinho|para ganhar|para desconto|com cupom)/i);

  const cupom = normalizarCupomAmazon(match?.[1] || "");
  if (!cupom) return { cupom: "", tipoCupom: "", cupomTipo: "", avisoCupom: "" };

  return {
    cupom,
    tipoCupom: "texto_radar",
    cupomTipo: "texto_radar",
    avisoCupom: `Aplique o cupom ${cupom} antes de finalizar.`
  };
}

function textoOriginalEvento(evento = {}) {
  return texto(evento.texto_original || evento.textoOriginal || evento.texto || "");
}

function aplicarFallbackCupomRadar(produto = {}, evento = {}) {
  if (produto.cupom) return produto;

  const cupomTexto = extrairCupomTextoRadarAmazon(textoOriginalEvento(evento));
  if (!cupomTexto.cupom) return produto;

  return {
    ...produto,
    cupom: cupomTexto.cupom,
    tipoCupom: cupomTexto.tipoCupom,
    cupomTipo: cupomTexto.cupomTipo,
    avisoCupom: produto.avisoCupom || cupomTexto.avisoCupom,
    beneficioExtra: produto.beneficioExtra || cupomTexto.avisoCupom,
    cupomOrigem: "texto_radar"
  };
}

function auditarV2Amazon({ job = {}, produto = {}, ofertaAdapter = {} } = {}) {
  try {
    const resultadoV2 = avaliarOfertaUniversal({
      titulo: ofertaAdapter.titulo || produto.titulo || produto.nome || "",
      marketplace: "amazon",
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
      parcelamento: ofertaAdapter.parcelamento || produto.parcelamento || "",
      freteGratis: ofertaAdapter.freteGratis === true || produto.freteGratis === true,
      cashback: ofertaAdapter.cashback || produto.cashback || "",
      origem: "engine_amazon"
    }, {
      clienteId: job.cliente_id || job.clienteId || "",
      origem: "engine_amazon",
      exigirLinkAfiliado: true
    });

    console.log("[ENGINE-AMAZON-V2-AUDITORIA]", JSON.stringify({
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
    console.log("[ENGINE-AMAZON-V2-AUDITORIA-ERRO]", JSON.stringify({
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
    parcelamento: primeiroValor(ofertaUniversal.parcelamento, templateInput.parcelamento, ofertaAdapter.parcelamento, produto.parcelamento),
    freteGratis: ofertaUniversal.freteGratis === true || templateInput.freteGratis === true || ofertaAdapter.freteGratis === true || produto.freteGratis === true,
    cashback: primeiroValor(ofertaUniversal.cashback, templateInput.cashback, ofertaAdapter.cashback, produto.cashback),
    categoria: primeiroValor(auditoriaV2.categoria, ofertaUniversal.categoria, ofertaAdapter.categoria),
    score: valorPresente(scoreV2) ? scoreV2 : ofertaAdapter.score
  };
}

async function importarAmazonEngine({ job = {}, evento = {}, links = [], deps = {} } = {}) {
  const clienteId = texto(job.cliente_id || job.clienteId || "");
  const linkEscolhido = escolherLinkAmazon(links, evento);
  const urlOriginalEngine = linkEscolhido.url;

  if (!clienteId) {
    return { ok: false, marketplace: "amazon", motivo: "cliente_invalido" };
  }

  if (!urlOriginalEngine) {
    return { ok: false, marketplace: "amazon", motivo: "link_amazon_nao_encontrado" };
  }

  if (typeof deps.importarAmazon !== "function") {
    return { ok: false, marketplace: "amazon", motivo: "importador_amazon_indisponivel" };
  }

  if (typeof deps.getIntegracaoCliente !== "function") {
    return { ok: false, marketplace: "amazon", motivo: "get_integracao_indisponivel" };
  }

  const integracao = deps.getIntegracaoCliente(clienteId, "amazon");
  if (!integracao) {
    return { ok: false, marketplace: "amazon", motivo: "integracao_ausente" };
  }

  console.log("[ENGINE-AMAZON-IMPORTADOR-CHAMADA]", {
    jobId: job.id,
    eventoId: job.evento_id,
    clienteId,
    urlUsada: urlOriginalEngine,
    temCookies: Boolean(integracao?.credenciais?.cookies),
    temTag: Boolean(integracao?.credenciais?.trackingId || integracao?.credenciais?.partnerTag || integracao?.credenciais?.tag || integracao?.credenciais?.appId)
  });

  const textoOriginalRadar = textoOriginalEvento(evento);
  const produtoBase = await deps.importarAmazon(urlOriginalEngine, {
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
  const produto = aplicarFallbackCupomRadar(produtoBase || {}, evento);

  console.log("[ENGINE-AMAZON-IMPORTADOR-RETORNO]", JSON.stringify({
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
    linkAfiliado: produto?.linkAfiliado || produto?.link || "",
    imagem: produto?.imagem || "",
    categoria: produto?.categoria || "",
    camposRetorno: Object.keys(produto || {})
  }));

  if (!produtoBase) {
    return { ok: false, marketplace: "amazon", motivo: "importador_sem_retorno", linkOriginal: urlOriginalEngine };
  }

  const linkAfiliado = produto.linkAfiliado || produto.linkFinal || produto.link || "";
  if (!linkAfiliado) {
    return { ok: false, marketplace: "amazon", motivo: "link_afiliado_vazio", linkOriginal: urlOriginalEngine };
  }

  const cupomTipo = produto.tipoCupom || produto.cupomTipo || "";
  const beneficioExtra = produto.beneficioExtra || produto.beneficioTexto || produto.avisoCupom || "";
  const ofertaAdapter = {
    ok: true,
    marketplace: "amazon",
    titulo: produto.titulo || produto.nome || "",
    preco: produto.precoAtual || produto.preco || "",
    precoOriginal: produto.precoOriginal || produto.precoAntigo || "",
    imagem: produto.imagem || "",
    linkOriginal: urlOriginalEngine,
    linkExpandido: produto.linkOriginal || urlOriginalEngine,
    linkAfiliado,
    categoria: resolverCategoriaAmazon(produto),
    cupom: produto.cupom || "",
    cupomTipo,
    tipoCupom: cupomTipo,
    avisoCupom: produto.avisoCupom || "",
    beneficioTexto: beneficioExtra,
    beneficioExtra,
    parcelamento: produto.parcelamento || "",
    freteGratis: produto.freteGratis === true,
    cashback: produto.cashback || "",
    descontoPix: produto.descontoPix || "",
    descontoApp: produto.descontoApp || "",
    score: produto.score || null
  };

  const auditoriaV2 = auditarV2Amazon({ job, produto, ofertaAdapter });
  const ofertaEnriquecida = enriquecerComV2(ofertaAdapter, auditoriaV2, produto);

  return {
    ...ofertaEnriquecida,
    metadata: {
      adapter: "amazon",
      jobId: job.id,
      eventoId: job.evento_id,
      linkOriginalEngine: urlOriginalEngine,
      textoRadarTemCupom: Boolean(extrairCupomTextoRadarAmazon(textoOriginalEvento(evento)).cupom),
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
  importarAmazonEngine
};


