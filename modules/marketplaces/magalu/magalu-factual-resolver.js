"use strict";

const {
  consultarProdutoMagalu,
  produtoIdPorUrl,
  hostMagaluValido
} = require("./magalu-parser");
const {
  normalizarPromoterIdMagalu,
  normalizarSlugLojaMagalu,
  slugsLojaMagalu
} = require("./magalu-affiliate-link");

const MAGALU_FACTUAL_CACHE_TTL_MS_PADRAO = 10 * 60 * 1000;
const MAGALU_FACTUAL_CACHE_MAX_ENTRADAS_PADRAO = 200;
const cacheFatosComprovados = new Map();

function texto(valor = "") {
  return String(valor || "").trim();
}

function listaUnica(valores = []) {
  return [...new Set((Array.isArray(valores) ? valores : [])
    .map(texto)
    .filter(Boolean))];
}

function parseUrlSegura(url = "") {
  try {
    const parsed = new URL(texto(url));
    if (!/^https?:$/.test(parsed.protocol)) return null;
    return parsed;
  } catch (_) {
    return null;
  }
}

function primeiroSegmento(pathname = "") {
  return String(pathname || "")
    .split("/")
    .filter(Boolean)[0] || "";
}

function removerSegmentoLojaMagazineVoce(parsed) {
  if (!parsed) return "";
  const partes = parsed.pathname.split("/").filter(Boolean);
  if (!partes.length) return "";
  return "/" + partes.slice(1).join("/") + (parsed.pathname.endsWith("/") ? "/" : "");
}

function sellerIdPorUrl(url = "") {
  const parsed = parseUrlSegura(url);
  if (!parsed) return "";
  return texto(parsed.searchParams.get("seller_id") || parsed.searchParams.get("sellerId") || parsed.searchParams.get("seller") || "");
}

function normalizarSeller(valor = "") {
  return texto(valor).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function sellersCompativeis(a = "", b = "") {
  const x = normalizarSeller(a);
  const y = normalizarSeller(b);
  if (!x || !y) return true;
  if (x === y) return true;
  return x.replace(/\d+$/g, "") === y.replace(/\d+$/g, "");
}

function host(parsed) {
  return parsed?.hostname?.toLowerCase?.() || "";
}

function caminhoProdutoBase(urlOriginal = "") {
  const parsed = parseUrlSegura(urlOriginal);
  if (!parsed) return { pathname: "", search: "" };
  const hostname = host(parsed);
  const pathname = hostname.includes("magazinevoce.com.br")
    ? removerSegmentoLojaMagazineVoce(parsed)
    : parsed.pathname;
  return { pathname, search: parsed.search || "" };
}

function caminhoPdpPorDivulgadorOferta(pathname = "") {
  const partes = String(pathname || "").split("/").filter(Boolean);
  const indiceDivulgador = partes.findIndex(parte => parte.toLowerCase() === "divulgador");
  if (indiceDivulgador < 0) return "";
  if ((partes[indiceDivulgador + 1] || "").toLowerCase() !== "oferta") return "";

  const produtoId = texto(partes[indiceDivulgador + 2] || "");
  const categoria = texto(partes[indiceDivulgador + 3] || "");
  const subcategoria = texto(partes[indiceDivulgador + 4] || "");
  if (!produtoId || !categoria || !subcategoria) return "";

  const slug = partes.slice(0, indiceDivulgador).join("/");
  return `/${slug}/p/${produtoId}/${categoria}/${subcategoria}/`;
}

function caminhoFactualMagalu(urlOriginal = "") {
  const base = caminhoProdutoBase(urlOriginal);
  const pdpDivulgador = caminhoPdpPorDivulgadorOferta(base.pathname);
  return {
    pathname: pdpDivulgador || base.pathname,
    search: pdpDivulgador ? "" : base.search,
    origem: pdpDivulgador ? "divulgador_oferta_para_pdp" : "url_original"
  };
}

function ttlCacheFactualMs(opcoes = {}) {
  const numero = Number(opcoes.cacheTtlMs ?? process.env.MAGALU_FACTUAL_CACHE_TTL_MS);
  if (!Number.isFinite(numero) || numero <= 0) return MAGALU_FACTUAL_CACHE_TTL_MS_PADRAO;
  return Math.floor(numero);
}

function limiteCacheFactual(opcoes = {}) {
  const numero = Number(opcoes.cacheMaxEntradas ?? process.env.MAGALU_FACTUAL_CACHE_MAX_ENTRADAS);
  if (!Number.isFinite(numero) || numero <= 0) return MAGALU_FACTUAL_CACHE_MAX_ENTRADAS_PADRAO;
  return Math.floor(numero);
}

function cacheFactualHabilitado(opcoes = {}) {
  if (opcoes.cacheFactual === false) return false;
  if (typeof opcoes.consultarProdutoMagalu === "function") return false;
  if (opcoes.parserOptions && Object.prototype.hasOwnProperty.call(opcoes.parserOptions, "html")) return false;
  return true;
}

function agoraMs(opcoes = {}) {
  if (typeof opcoes.now === "function") {
    const valor = opcoes.now();
    const data = typeof valor === "number" ? valor : Date.parse(valor);
    if (Number.isFinite(data)) return data;
  }
  return Date.now();
}

function clonar(valor) {
  return JSON.parse(JSON.stringify(valor || null));
}

function removerCamposSensiveisCache(objeto) {
  if (!objeto || typeof objeto !== "object") return objeto;
  if (Array.isArray(objeto)) {
    for (const item of objeto) removerCamposSensiveisCache(item);
    return objeto;
  }
  for (const chave of Object.keys(objeto)) {
    if (/^(linkAfiliado|urlAfiliada|promoterId|partnerId|token|secret|credenciais)$/i.test(chave)) {
      delete objeto[chave];
      continue;
    }
    removerCamposSensiveisCache(objeto[chave]);
  }
  return objeto;
}

function valorSeguroParaCache(valor = {}) {
  return removerCamposSensiveisCache(clonar(valor));
}

function chaveCacheFactualMagalu({ urlOriginal = "", promoterId = "" } = {}) {
  const produtoId = produtoIdPorUrl(urlOriginal);
  if (!produtoId) return "";
  const base = caminhoFactualMagalu(urlOriginal);
  return [
    normalizarPromoterIdMagalu(promoterId),
    produtoId,
    base.pathname,
    base.search
  ].map(texto).join("|");
}

function varrerCacheFactualMagalu(opcoes = {}) {
  const agora = agoraMs(opcoes);
  for (const [chave, item] of cacheFatosComprovados.entries()) {
    if (!item || item.expiraEmMs <= agora) cacheFatosComprovados.delete(chave);
  }

  const limite = limiteCacheFactual(opcoes);
  while (cacheFatosComprovados.size > limite) {
    const primeira = cacheFatosComprovados.keys().next().value;
    if (!primeira) break;
    cacheFatosComprovados.delete(primeira);
  }
}

function lerCacheFactualMagalu(chave = "", opcoes = {}) {
  if (!chave) return null;
  varrerCacheFactualMagalu(opcoes);
  const item = cacheFatosComprovados.get(chave);
  if (!item) return null;
  if (item.expiraEmMs <= agoraMs(opcoes)) {
    cacheFatosComprovados.delete(chave);
    return null;
  }
  const retorno = clonar(item.valor);
  retorno.cache = { hit: true };
  retorno.fatos = retorno.fatos && typeof retorno.fatos === "object" ? retorno.fatos : {};
  retorno.fatos.metadata = retorno.fatos.metadata && typeof retorno.fatos.metadata === "object"
    ? retorno.fatos.metadata
    : {};
  retorno.fatos.metadata.factualCache = { hit: true };
  return retorno;
}

function salvarCacheFactualMagalu(chave = "", valor = {}, opcoes = {}) {
  if (!chave || !valor?.ok) return;
  varrerCacheFactualMagalu(opcoes);
  cacheFatosComprovados.set(chave, {
    expiraEmMs: agoraMs(opcoes) + ttlCacheFactualMs(opcoes),
    valor: valorSeguroParaCache(valor)
  });
  varrerCacheFactualMagalu(opcoes);
}

function limparCacheFactualMagalu() {
  cacheFatosComprovados.clear();
}

function resumoCacheFactualMagalu(opcoes = {}) {
  varrerCacheFactualMagalu(opcoes);
  return {
    entradas: cacheFatosComprovados.size,
    limite: limiteCacheFactual(opcoes)
  };
}

function cacheFallbackPermitido(avisos = []) {
  const lista = listaUnica(avisos);
  const bloqueado = [
    "magalu_http_403",
    "magalu_captcha_detectado",
    "magalu_pagina_indisponivel",
    "magalu_produto_divergente_ignorado",
    "magalu_url_factual_produto_divergente",
    "magalu_conteudo_produto_divergente_ignorado",
    "magalu_jsonld_produto_divergente_ignorado"
  ].some(aviso => lista.includes(aviso));
  if (bloqueado) return false;
  return lista.some(aviso =>
    aviso === "magalu_timeout" ||
    aviso === "magalu_fetch_falhou" ||
    /^magalu_http_5\d\d$/.test(aviso)
  );
}

function urlComHost(hostname = "", pathname = "", search = "") {
  if (!hostname || !pathname || !/\/p\/[^/]+/i.test(pathname)) return "";
  const destino = new URL(`https://${hostname}${pathname}`);
  destino.search = search || "";
  return destino.toString();
}

function adicionarCandidata(candidatas = [], vistos = new Set(), fonte = "", url = "") {
  const limpa = texto(url);
  if (!limpa) return;
  const parsed = parseUrlSegura(limpa);
  if (!parsed || !hostMagaluValido(parsed.toString())) return;
  const chave = parsed.toString();
  if (vistos.has(chave)) return;
  vistos.add(chave);
  candidatas.push({ fonte, url: chave });
}

function construirFontesMagalu({ urlOriginal = "", promoterId = "" } = {}) {
  const candidatas = [];
  const vistos = new Set();
  const original = parseUrlSegura(urlOriginal);
  const base = caminhoFactualMagalu(urlOriginal);
  const produtoIdOriginal = produtoIdPorUrl(urlOriginal);
  if (!produtoIdOriginal) return candidatas;

  adicionarCandidata(
    candidatas,
    vistos,
    "pdp_www",
    urlComHost("www.magazineluiza.com.br", base.pathname, base.search)
  );
  adicionarCandidata(
    candidatas,
    vistos,
    "pdp_m",
    urlComHost("m.magazineluiza.com.br", base.pathname, base.search)
  );

  const id = normalizarPromoterIdMagalu(promoterId);
  const aliases = id ? slugsLojaMagalu(id) : [];
  const ordenados = [
    id,
    normalizarSlugLojaMagalu(id),
    ...aliases
  ].filter(Boolean);

  for (const slug of listaUnica(ordenados)) {
    adicionarCandidata(
      candidatas,
      vistos,
      slug === id ? "magazinevoce_promoter" : "magazinevoce_magazine_promoter",
      urlComHost("www.magazinevoce.com.br", `/${slug}${base.pathname}`, base.search)
    );
  }

  if (original && host(original).includes("magazinevoce.com.br")) {
    adicionarCandidata(candidatas, vistos, "magazinevoce_original", original.toString());
  }

  return candidatas;
}

function lojaOriginalDivergente(urlOriginal = "", promoterId = "") {
  const parsed = parseUrlSegura(urlOriginal);
  const id = normalizarPromoterIdMagalu(promoterId);
  if (!parsed || !id || !host(parsed).includes("magazinevoce.com.br")) return false;
  return !slugsLojaMagalu(id).includes(primeiroSegmento(parsed.pathname).toLowerCase());
}

function temAvisoBloqueante(avisos = []) {
  return avisos.includes("magalu_captcha_detectado") ||
    avisos.includes("magalu_http_403") ||
    avisos.includes("magalu_pagina_indisponivel") ||
    avisos.includes("magalu_conteudo_produto_divergente_ignorado") ||
    avisos.includes("magalu_jsonld_produto_divergente_ignorado");
}

function temEvidenciaFactual(fatos = {}) {
  return Boolean(
    texto(fatos.titulo) ||
    texto(fatos.precoAtual) ||
    texto(fatos.precoAnterior) ||
    texto(fatos.imagem) ||
    texto(fatos.categoria) ||
    texto(fatos.seller) ||
    texto(fatos.parcelamento) ||
    texto(fatos.cupom)
  );
}

function resumoTentativa(fonte = "", statusFactual = "", motivo = "") {
  return {
    fonte,
    statusFactual,
    motivo: texto(motivo)
  };
}

function resultadoVazio({ urlOriginal = "", produtoIdOriginal = "", sellerIdOriginal = "", tentativas = [], avisos = [] } = {}) {
  return {
    ok: false,
    produtoId: produtoIdOriginal,
    sellerIdOriginal,
    fonteUsada: "",
    tentativas,
    fatos: {
      urlOriginal,
      urlCanonica: "",
      produtoId: produtoIdOriginal,
      codigo: produtoIdOriginal,
      titulo: "",
      precoAtual: "",
      precoAnterior: "",
      imagem: "",
      categoria: "",
      seller: "",
      parcelamento: "",
      cupom: "",
      avisos: listaUnica(avisos)
    },
    avisos: listaUnica(avisos)
  };
}

function limparPrecosPorSellerDivergente(fatos = {}, avisos = []) {
  return {
    ...fatos,
    precoAtual: "",
    precoAnterior: "",
    parcelamento: "",
    cupom: "",
    avisos: listaUnica([...(fatos.avisos || []), ...avisos])
  };
}

function urlsIdentidadeFactual(fatos = {}) {
  return listaUnica([
    fatos.urlCanonica,
    fatos.urlFinal,
    fatos.finalUrl,
    fatos.response?.url,
    fatos.resposta?.url
  ]);
}

function avaliarIdentidadeFactual({ fatos = {}, fonte = {}, produtoIdOriginal = "" } = {}) {
  const produtoIdCandidata = produtoIdPorUrl(fonte.url);
  const produtoIdDeclarado = texto(fatos.produtoId || fatos.codigo);

  if (produtoIdOriginal && produtoIdCandidata && produtoIdCandidata !== produtoIdOriginal) {
    return {
      ok: false,
      motivo: "produto_divergente",
      avisos: ["magalu_produto_divergente_ignorado", "magalu_candidata_produto_divergente"]
    };
  }

  if (produtoIdOriginal && produtoIdDeclarado && produtoIdDeclarado !== produtoIdOriginal) {
    return {
      ok: false,
      motivo: "produto_divergente",
      avisos: ["magalu_produto_divergente_ignorado"]
    };
  }

  for (const url of urlsIdentidadeFactual(fatos)) {
    const produtoIdUrl = produtoIdPorUrl(url);
    if (!produtoIdUrl) continue;
    if (produtoIdOriginal && produtoIdUrl !== produtoIdOriginal) {
      return {
        ok: false,
        motivo: "url_factual_produto_divergente",
        avisos: ["magalu_produto_divergente_ignorado", "magalu_url_factual_produto_divergente"]
      };
    }
    if (produtoIdCandidata && produtoIdUrl !== produtoIdCandidata) {
      return {
        ok: false,
        motivo: "url_factual_produto_divergente",
        avisos: ["magalu_produto_divergente_ignorado", "magalu_url_factual_produto_divergente"]
      };
    }
  }

  return {
    ok: true,
    produtoIdFonte: produtoIdDeclarado || produtoIdPorUrl(fatos.urlCanonica) || produtoIdPorUrl(fatos.urlFinal) || produtoIdPorUrl(fatos.response?.url) || produtoIdCandidata || produtoIdOriginal
  };
}

function avaliarFatos({ fatos = {}, fonte = {}, urlOriginal = "", produtoIdOriginal = "", sellerIdOriginal = "" } = {}) {
  const avisos = listaUnica(fatos.avisos || []);
  const identidade = avaliarIdentidadeFactual({ fatos, fonte, produtoIdOriginal });
  const produtoIdFonte = texto(identidade.produtoIdFonte || "");

  if (!identidade.ok) {
    return { aceito: false, motivo: identidade.motivo, avisos: identidade.avisos };
  }

  if (temAvisoBloqueante(avisos)) {
    return { aceito: false, motivo: "fonte_bloqueada_ou_divergente", avisos };
  }

  if (!temEvidenciaFactual(fatos)) {
    return { aceito: false, motivo: "sem_evidencia_factual", avisos: listaUnica([...avisos, "magalu_produto_nao_comprovado"]) };
  }

  const sellerFonteUrl = sellerIdPorUrl(fonte.url || fatos.urlCanonica || fatos.urlOriginal || "");
  let fatosSeguros = {
    ...fatos,
    produtoId: produtoIdFonte || produtoIdOriginal,
    codigo: produtoIdFonte || produtoIdOriginal
  };
  const avisosSeller = [];

  if (sellerIdOriginal && sellerFonteUrl && sellerFonteUrl !== sellerIdOriginal) {
    avisosSeller.push("magalu_seller_divergente");
  }

  if (sellerIdOriginal && texto(fatos.seller) && !sellersCompativeis(fatos.seller, sellerIdOriginal)) {
    avisosSeller.push("magalu_seller_divergente");
  }

  if (avisosSeller.length) {
    fatosSeguros = limparPrecosPorSellerDivergente(fatosSeguros, avisosSeller);
  }

  return {
    aceito: true,
    motivo: avisosSeller.length ? "aceito_sem_preco_por_seller_divergente" : "aceito",
    fatos: fatosSeguros,
    avisos: listaUnica([...avisos, ...avisosSeller])
  };
}

async function resolverFatosMagalu({ urlOriginal = "", promoterId = "" } = {}, opcoes = {}) {
  const consultar = typeof opcoes.consultarProdutoMagalu === "function"
    ? opcoes.consultarProdutoMagalu
    : consultarProdutoMagalu;
  const produtoIdOriginal = produtoIdPorUrl(urlOriginal);
  const sellerIdOriginal = sellerIdPorUrl(urlOriginal);
  const usarCache = cacheFactualHabilitado(opcoes);
  const chaveCache = usarCache ? chaveCacheFactualMagalu({ urlOriginal, promoterId }) : "";
  const tentativas = [];
  const avisos = [];
  if (lojaOriginalDivergente(urlOriginal, promoterId)) {
    avisos.push("magalu_link_loja_divergente");
  }

  if (!produtoIdOriginal) {
    return resultadoVazio({
      urlOriginal,
      produtoIdOriginal,
      sellerIdOriginal,
      tentativas: [resumoTentativa("entrada", "erro", "produto_id_ausente")],
      avisos: ["magalu_produto_id_ausente", "magalu_produto_nao_comprovado"]
    });
  }

  const fontes = construirFontesMagalu({ urlOriginal, promoterId });
  if (!fontes.length) {
    return resultadoVazio({
      urlOriginal,
      produtoIdOriginal,
      sellerIdOriginal,
      tentativas: [resumoTentativa("entrada", "erro", "fonte_indisponivel")],
      avisos: ["magalu_fonte_indisponivel"]
    });
  }

  for (const fonte of fontes) {
    let fatos;
    try {
      fatos = await consultar(fonte.url, {
        ...(opcoes.parserOptions || {}),
        fonteFactual: fonte.fonte,
        urlOriginalEntrada: urlOriginal
      });
    } catch (_) {
      tentativas.push(resumoTentativa(fonte.fonte, "erro", "consulta_falhou"));
      continue;
    }

    const avaliacao = avaliarFatos({
      fatos: fatos && typeof fatos === "object" ? fatos : {},
      fonte,
      urlOriginal,
      produtoIdOriginal,
      sellerIdOriginal
    });

    avisos.push(...(avaliacao.avisos || []));
    if (!avaliacao.aceito) {
      tentativas.push(resumoTentativa(fonte.fonte, "rejeitada", avaliacao.motivo));
      continue;
    }

    tentativas.push(resumoTentativa(fonte.fonte, "aceita", avaliacao.motivo));
    const retorno = {
      ok: true,
      produtoId: produtoIdOriginal,
      sellerIdOriginal,
      fonteUsada: fonte.fonte,
      tentativas,
      fatos: {
        ...avaliacao.fatos,
        urlAfiliavelComprovada: fonte.url,
        urlOriginal,
        avisos: listaUnica([...(avaliacao.fatos.avisos || []), ...(avaliacao.avisos || [])])
      },
      avisos: listaUnica(avisos)
    };
    if (usarCache) salvarCacheFactualMagalu(chaveCache, retorno, opcoes);
    return retorno;
  }

  const avisosFinais = listaUnica([...avisos, "magalu_factual_resolver_sem_fonte_segura"]);
  if (usarCache && cacheFallbackPermitido(avisosFinais)) {
    const cacheFallback = lerCacheFactualMagalu(chaveCache, opcoes);
    if (cacheFallback) {
      cacheFallback.cache = { hit: true, modo: "fallback_transitorio" };
      return cacheFallback;
    }
  }

  return resultadoVazio({
    urlOriginal,
    produtoIdOriginal,
    sellerIdOriginal,
    tentativas,
    avisos: avisosFinais
  });
}

module.exports = {
  resolverFatosMagalu,
  construirFontesMagalu,
  chaveCacheFactualMagalu,
  limparCacheFactualMagalu,
  resumoCacheFactualMagalu,
  sellerIdPorUrl
};
