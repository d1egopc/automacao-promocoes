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
  const base = caminhoProdutoBase(urlOriginal);
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

function avaliarFatos({ fatos = {}, fonte = {}, urlOriginal = "", produtoIdOriginal = "", sellerIdOriginal = "" } = {}) {
  const avisos = listaUnica(fatos.avisos || []);
  const produtoIdFonte = texto(fatos.produtoId || fatos.codigo || produtoIdPorUrl(fatos.urlCanonica) || produtoIdPorUrl(fonte.url));

  if (produtoIdOriginal && produtoIdFonte && produtoIdFonte !== produtoIdOriginal) {
    return { aceito: false, motivo: "produto_divergente", avisos: ["magalu_produto_divergente_ignorado"] };
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
    return {
      ok: true,
      produtoId: produtoIdOriginal,
      sellerIdOriginal,
      fonteUsada: fonte.fonte,
      tentativas,
      fatos: {
        ...avaliacao.fatos,
        urlOriginal,
        avisos: listaUnica([...(avaliacao.fatos.avisos || []), ...(avaliacao.avisos || [])])
      },
      avisos: listaUnica(avisos)
    };
  }

  return resultadoVazio({
    urlOriginal,
    produtoIdOriginal,
    sellerIdOriginal,
    tentativas,
    avisos: listaUnica([...avisos, "magalu_factual_resolver_sem_fonte_segura"])
  });
}

module.exports = {
  resolverFatosMagalu,
  construirFontesMagalu,
  sellerIdPorUrl
};
