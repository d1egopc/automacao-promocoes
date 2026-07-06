const { classificarCategoriaOferta } = require("../../../../marketplaces/inteligencia/classificador-categorias");
const { avaliarOfertaUniversal } = require("../../../../modules/inteligencia-universal");
const { queryEngine } = require("../../database");
const {
  extrairIdsShopee,
  tituloShopeeValido
} = require("../../../../marketplaces/shopee/normalizacao");

function texto(valor = "") {
  return String(valor || "").trim();
}

function numeroPrecoShopeeAdapter(valor = "") {
  const bruto = texto(valor).replace(/R\$/gi, "").replace(/\s+/g, "");
  if (!bruto || /\s+a\s/i.test(texto(valor))) return null;
  let normalizado = bruto.replace(/[^\d.,]/g, "");
  if (normalizado.includes(",") && normalizado.includes(".")) normalizado = normalizado.replace(/\./g, "").replace(",", ".");
  else if (normalizado.includes(",")) normalizado = normalizado.replace(",", ".");
  const numero = Number(normalizado);
  return Number.isFinite(numero) && numero > 0 ? numero : null;
}

async function buscarImagemHistoricaShopee(shopId = "", itemId = "") {
  if (!/^\d+$/.test(texto(shopId)) || !/^\d+$/.test(texto(itemId))) {
    return { imagem: "", origem: "", motivo: "shopee_ids_ausentes" };
  }

  const resultado = await queryEngine(
    `SELECT id, imagem
       FROM engine_ofertas
      WHERE LOWER(REGEXP_REPLACE(COALESCE(marketplace, ''), '[[:space:]_-]+', '', 'g')) LIKE '%shopee%'
        AND NULLIF(TRIM(COALESCE(imagem, '')), '') IS NOT NULL
        AND (
          CONCAT_WS(' ', link_original, link_expandido, link_afiliado, COALESCE(metadata::text, '')) LIKE $1
          OR CONCAT_WS(' ', link_original, link_expandido, link_afiliado, COALESCE(metadata::text, '')) LIKE $2
          OR CONCAT_WS(' ', link_original, link_expandido, link_afiliado, COALESCE(metadata::text, '')) LIKE $3
          OR (
            COALESCE(metadata::text, '') LIKE $4
            AND COALESCE(metadata::text, '') LIKE $5
          )
        )
      ORDER BY atualizada_em DESC NULLS LAST, id DESC
      LIMIT 1`,
    [`%/product/${shopId}/${itemId}%`, `%-i.${shopId}.${itemId}%`, `%/opaanlp/${shopId}/${itemId}%`, `%${shopId}%`, `%${itemId}%`]
  );

  if (!resultado.ok) return { imagem: "", origem: "", motivo: "consulta_imagem_historica_falhou" };
  const anterior = resultado.resultado.rows[0];
  return anterior?.imagem
    ? { imagem: texto(anterior.imagem), origem: `engine_ofertas.imagem:${anterior.id}`, motivo: "imagem_historica_shop_item" }
    : { imagem: "", origem: "", motivo: "imagem_historica_nao_encontrada" };
}

function logAuditoriaShopee(dados = {}) {
  console.log("[SHOPEE-IMPORTER-AUDITORIA]", JSON.stringify({
    jobId: dados.jobId || null,
    clienteId: dados.clienteId || "",
    urlOriginal: dados.urlOriginal || "",
    urlExpandida: dados.urlExpandida || "",
    shopId: dados.shopId || "",
    itemId: dados.itemId || "",
    tituloExtraido: dados.tituloExtraido || "",
    tituloValido: dados.tituloValido === true,
    precoExtraido: dados.precoExtraido ?? null,
    precoValido: dados.precoValido === true,
    temImagem: Boolean(dados.imagem),
    origemImagem: dados.origemImagem || "nenhuma",
    motivoFalha: dados.motivoFalha || "",
    statusFinal: dados.statusFinal || ""
  }));
}

function detectarSuspeitaFator100(precoTextoRadar = "", precoAdapter = null) {
  const precoRadar = numeroPrecoShopeeAdapter(precoTextoRadar);
  const precoFinal = numeroPrecoShopeeAdapter(precoAdapter);
  if (precoRadar === null || precoFinal === null) return false;
  return Math.abs((precoFinal / precoRadar) - 100) < 0.01;
}

function logPrecoAuditoriaShopee(dados = {}) {
  console.log("[SHOPEE-PRECO-AUDITORIA]", JSON.stringify({
    etapa: dados.etapa || "adapter",
    jobId: dados.jobId || null,
    clienteId: dados.clienteId || "",
    urlOriginal: dados.urlOriginal || "",
    urlExpandida: dados.urlExpandida || "",
    shopId: dados.shopId || "",
    itemId: dados.itemId || "",
    titulo: dados.titulo || "",
    precoTextoRadar: dados.precoTextoRadar || "",
    precoApi: dados.precoApi ?? "",
    precoBruto: dados.precoBruto ?? "",
    precoNormalizado: dados.precoNormalizado ?? "",
    precoAdapter: dados.precoAdapter ?? null,
    precoEngine: dados.precoEngine ?? null,
    precoTemplate: dados.precoTemplate ?? null,
    origemPreco: dados.origemPreco || "",
    motivoEscolhaPreco: dados.motivoEscolhaPreco || "",
    campoPrecoUsado: dados.campoPrecoUsado || "",
    tipoCampoPrecoUsado: dados.tipoCampoPrecoUsado || "",
    precoAntesNormalizacao: dados.precoAntesNormalizacao ?? "",
    precoDepoisNormalizacao: dados.precoDepoisNormalizacao ?? "",
    normalizadorAplicado: dados.normalizadorAplicado || "",
    suspeitaFator100: dados.suspeitaFator100 === true
  }));
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

function contextoLinkShopee(textoCompleto = "", url = "") {
  const texto = String(textoCompleto || "");
  const idx = texto.indexOf(url);
  if (idx < 0) return { antes: "", depois: "" };
  return {
    antes: texto.slice(Math.max(0, idx - 100), idx).toLowerCase(),
    depois: texto.slice(idx + url.length, Math.min(texto.length, idx + url.length + 60)).toLowerCase()
  };
}

function contextoIndicaCupomShopee(contexto = {}) {
  return /resgate|cupom|voucher|cupom na pagina|cupom disponivel|desconto/.test(`${contexto.antes} ${contexto.depois}`);
}

function contextoIndicaProdutoShopee(contexto = {}) {
  return /produto aqui|confira aqui|link do produto|produto|comprar|oferta aqui|aqui/.test(`${contexto.antes} ${contexto.depois}`);
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

  const textoRadarOriginal = textoOriginalEvento(evento);
  const urlsTexto = Array.from(textoRadarOriginal.matchAll(/https?:\/\/[^\s]+/gi)).map(match => match[0]);
  const urlsProduto = [];
  const urlsCupom = [];

  for (const urlTexto of urlsTexto) {
    if (!/shopee/i.test(urlTexto)) continue;
    const contexto = contextoLinkShopee(textoRadarOriginal, urlTexto);
    if (contextoIndicaCupomShopee(contexto)) urlsCupom.push(urlTexto);
    if (contextoIndicaProdutoShopee(contexto)) urlsProduto.push(urlTexto);
  }

  for (const urlProduto of urlsProduto) {
    const marcado = validos.find(candidato => candidato.url === urlProduto || candidato.url.includes(urlProduto));
    if (marcado) return marcado;
  }

  const naoCupom = validos.filter(candidato => {
    if (/(?:cupom|voucher|promotion|promo)/i.test(candidato.url)) return false;
    return !urlsCupom.some(urlCupom => candidato.url === urlCupom || candidato.url.includes(urlCupom));
  });

  return naoCupom[naoCupom.length - 1] || { url: "", link: null, campo: "somente_link_cupom" };
}

function pareceCupomRealShopee(codigo = "") {
  const cupom = texto(codigo).toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Z0-9_-]/g, "").trim();
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
    "DISPON",
    "DISPONIVEL",
    "DISPONVEL",
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
      linkExpandido: ofertaAdapter.linkExpandido || produto.linkExpandido || "",
      shopId: ofertaAdapter.shopId || produto.shopId || "",
      itemId: ofertaAdapter.itemId || produto.itemId || "",
      produtoIdDetectado: ofertaAdapter.produtoIdDetectado || produto.produtoId || "",
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
      fonteFinal: false,
      tipoAvaliacao: "auditoria_adapter_sem_memoria",
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
    score: ofertaAdapter.score
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
  if (produtoBase?.ok === false) {
    const idsFalha = extrairIdsShopee(produtoBase.linkExpandido || urlOriginalEngine);
    logAuditoriaShopee({
      jobId: job.id,
      clienteId,
      urlOriginal: urlOriginalEngine,
      urlExpandida: produtoBase.linkExpandido || "",
      shopId: produtoBase.shopId || idsFalha.shopId,
      itemId: produtoBase.itemId || idsFalha.itemId,
      tituloExtraido: produtoBase.titulo || "",
      tituloValido: tituloShopeeValido(produtoBase.titulo || ""),
      precoExtraido: numeroPrecoShopeeAdapter(produtoBase.precoAtual || produtoBase.preco),
      precoValido: numeroPrecoShopeeAdapter(produtoBase.precoAtual || produtoBase.preco) !== null,
      imagem: produtoBase.imagem || "",
      origemImagem: produtoBase.imagemOrigem || "nenhuma",
      motivoFalha: produtoBase.motivo || "erro_importador_shopee",
      statusFinal: "falha_parser"
    });
    return {
      ok: false,
      marketplace: "shopee",
      motivo: produtoBase.motivo || "erro_importador_shopee",
      linkOriginal: urlOriginalEngine
    };
  }
  let produto = aplicarFallbackTextoRadar(produtoBase || {}, evento);
  const idsDetectados = extrairIdsShopee(produto.linkExpandido || produto.linkOriginal || urlOriginalEngine);
  const idsProduto = {
    shopId: produto.shopId || idsDetectados.shopId,
    itemId: produto.itemId || idsDetectados.itemId
  };
  const tituloValido = tituloShopeeValido(produto.titulo || produto.nome || "");
  const precoNumerico = numeroPrecoShopeeAdapter(produto.precoAtual || produto.preco || produto.precoMin || "");
  const precoAuditoria = produto.precoAuditoria && typeof produto.precoAuditoria === "object"
    ? produto.precoAuditoria
    : {};
  const suspeitaFator100 = detectarSuspeitaFator100(precoAuditoria.precoTextoRadar, precoNumerico);

  logPrecoAuditoriaShopee({
    etapa: "adapter",
    jobId: job.id,
    clienteId,
    urlOriginal: urlOriginalEngine,
    urlExpandida: produto.linkExpandido || produto.linkOriginal || "",
    shopId: idsProduto.shopId,
    itemId: idsProduto.itemId,
    titulo: produto.titulo || produto.nome || "",
    ...precoAuditoria,
    precoAdapter: precoNumerico,
    suspeitaFator100
  });

  if (!tituloValido || precoNumerico === null) {
    const motivo = !tituloValido ? "shopee_titulo_indisponivel" : "shopee_preco_indisponivel";
    logAuditoriaShopee({
      jobId: job.id,
      clienteId,
      urlOriginal: urlOriginalEngine,
      urlExpandida: produto.linkExpandido || produto.linkOriginal || "",
      shopId: idsProduto.shopId,
      itemId: idsProduto.itemId,
      tituloExtraido: produto.titulo || produto.nome || "",
      tituloValido,
      precoExtraido: precoNumerico,
      precoValido: precoNumerico !== null,
      imagem: produto.imagem || "",
      origemImagem: produto.imagemOrigem || "nenhuma",
      motivoFalha: motivo,
      statusFinal: "falha_parser"
    });
    return { ok: false, marketplace: "shopee", motivo, linkOriginal: urlOriginalEngine };
  }

  if (!produto.imagem) {
    const historica = await buscarImagemHistoricaShopee(idsProduto.shopId, idsProduto.itemId);
    if (historica.imagem) {
      produto = { ...produto, imagem: historica.imagem, imagemOrigem: historica.origem };
    } else if (!produto.motivoFalha) {
      produto = { ...produto, motivoFalha: historica.motivo || "shopee_imagem_indisponivel" };
    }
  }

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
    preco: precoNumerico,
    precoOriginal: produto.precoOriginal || produto.precoAntigo || "",
    imagem: produto.imagem || "",
    imagemOrigem: produto.imagemOrigem || "",
    linkOriginal: urlOriginalEngine,
    linkExpandido: produto.linkExpandido || produto.linkOriginal || urlOriginalEngine,
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
    score: produto.score || null,
    shopId: idsProduto.shopId,
    itemId: idsProduto.itemId,
    produtoIdDetectado: idsProduto.shopId && idsProduto.itemId ? `${idsProduto.shopId}/${idsProduto.itemId}` : ""
  };

  const auditoriaV2 = auditarV2Shopee({ job, produto, ofertaAdapter });
  const ofertaEnriquecida = enriquecerComV2(ofertaAdapter, auditoriaV2, produto);

  logAuditoriaShopee({
    jobId: job.id,
    clienteId,
    urlOriginal: urlOriginalEngine,
    urlExpandida: ofertaAdapter.linkExpandido,
    shopId: idsProduto.shopId,
    itemId: idsProduto.itemId,
    tituloExtraido: ofertaAdapter.titulo,
    tituloValido: true,
    precoExtraido: precoNumerico,
    precoValido: true,
    imagem: ofertaAdapter.imagem,
    origemImagem: ofertaAdapter.imagemOrigem || "nenhuma",
    motivoFalha: ofertaAdapter.imagem ? "" : (produto.motivoFalha || "shopee_imagem_indisponivel"),
    statusFinal: auditoriaV2?.status || "pronto_para_v2"
  });

  return {
    ...ofertaEnriquecida,
    metadata: {
      adapter: "shopee",
      jobId: job.id,
      eventoId: job.evento_id,
      linkOriginalEngine: urlOriginalEngine,
      url_original: urlOriginalEngine,
      url_expandida: ofertaAdapter.linkExpandido,
      shopId: idsProduto.shopId,
      itemId: idsProduto.itemId,
      produtoId: ofertaAdapter.produtoIdDetectado,
      precoAuditoria: {
        ...precoAuditoria,
        precoAdapter: precoNumerico,
        suspeitaFator100
      },
      campoLinkEscolhido: linkEscolhido.campo || "",
      textoRadarTemCupom: Boolean(extrairCupomTextoRadarShopee(textoOriginalRadar).cupom),
      camposProduto: Object.keys(produto || {}),
      produto,
      auditoriaInteligenciaUniversalV2: auditoriaV2 ? {
        fonteFinal: false,
        tipoAvaliacao: "auditoria_adapter_sem_memoria",
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




