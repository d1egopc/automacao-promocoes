function htmlDecode(text = "") {
  return String(text)
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function extrairMeta(html = "", property = "") {
  const alvo = String(property || "").trim().toLowerCase();
  if (!alvo) return "";

  const tags = String(html || "").match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const atributos = {};
    const regexAtributo = /([:\w-]+)\s*=\s*(["'])([\s\S]*?)\2/g;
    let match;

    while ((match = regexAtributo.exec(tag)) !== null) {
      atributos[match[1].toLowerCase()] = match[3];
    }

    const chave = String(atributos.property || atributos.name || "").trim().toLowerCase();
    if (chave === alvo && atributos.content) return htmlDecode(atributos.content).trim();
  }

  return "";
}

function extrairJsonLd(html = "") {
  const matches = [
    ...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)
  ];

  for (const match of matches) {
    try {
      const raw = htmlDecode(match[1]);
      const data = JSON.parse(raw);

      const product = encontrarProdutoJsonLd(data);
      if (product) return product;
    } catch {}
  }

  return null;
}

function encontrarProdutoJsonLd(valor, profundidade = 0) {
  if (!valor || profundidade > 8) return null;
  if (Array.isArray(valor)) {
    for (const item of valor) {
      const product = encontrarProdutoJsonLd(item, profundidade + 1);
      if (product) return product;
    }
    return null;
  }
  if (typeof valor !== "object") return null;

  const tipos = Array.isArray(valor["@type"]) ? valor["@type"] : [valor["@type"]];
  if (tipos.some(tipo => String(tipo || "").toLowerCase() === "product")) return valor;

  for (const item of Object.values(valor)) {
    const product = encontrarProdutoJsonLd(item, profundidade + 1);
    if (product) return product;
  }

  return null;
}

function limparPreco(valor = "") {
  return String(valor)
    .replace("R$", "")
    .replace(/\./g, "")
    .replace(",", ".")
    .trim();
}


function corrigirImagemUrl(url = "") {
  if (!url) return "";

  return String(url)
    .replace(/\\u002F/g, "/")
    .replace(/\\\//g, "/")
    .replace("&amp;", "&");
}

function urlCatalogoTecnicoMercadoLivre(valor) {
  try {
    const url = new URL(String(valor || ""));
    if (url.protocol !== "https:" || !["www.mercadolivre.com.br", "mercadolivre.com.br"].includes(url.hostname) ||
        url.username || url.password || url.port || url.search || url.hash) return null;
    const id = url.pathname.match(/^\/(?:[a-z0-9-]+\/)?p\/(MLB-?\d{6,})\/?$/i)?.[1];
    return id ? id.replace("-", "").toUpperCase() : null;
  } catch { return null; }
}

function urlRedirectDiretoCatalogoMl(resolucao, original) {
  try {
    const origem = new URL(original);
    if (origem.protocol !== "https:" || origem.hostname !== "meli.la" || origem.username || origem.password ||
        origem.port || resolucao?.ok !== true || resolucao.tipoLinkRadar !== "shortlink_meli" ||
        resolucao.metodoResolucaoMeli || Number(resolucao.statusHttp) !== 200 ||
        resolucao.urlCapturada !== original || resolucao.linkOriginalRadar !== original) return "";
    return urlCatalogoTecnicoMercadoLivre(resolucao.urlResolvida) ? resolucao.urlResolvida : "";
  } catch { return ""; }
}

// Prova técnica do produto de catálogo. Não representa anúncio, vendedor ou condições comerciais.
function extrairCatalogoTecnicoMercadoLivre({ html = "", entrada, final }) {
  const id = urlCatalogoTecnicoMercadoLivre(entrada);
  if (!id || urlCatalogoTecnicoMercadoLivre(final) !== id) return null;
  const canonicas = (html.match(/<link\b[^>]*\brel\s*=\s*["']canonical["'][^>]*>/gi) || []);
  const canonical = canonicas[0]?.match(/\bhref\s*=\s*(["'])(.*?)\1/i)?.[2];
  if (canonicas.length !== 1 || urlCatalogoTecnicoMercadoLivre(htmlDecode(canonical || "")) !== id) return null;
  const produtos = [];
  let ambigua = false;
  function visitar(obj, profundidade = 0) {
    if (!obj || typeof obj !== "object") return;
    if (profundidade > 8) { ambigua = true; return; }
    const tipos = [obj["@type"]].flat().map(tipo => String(tipo || "").toLowerCase());
    if (tipos.includes("productgroup") || ["hasVariant", "isVariantOf", "variesBy", "inProductGroupWithID",
      "variationId", "variation_id", "variantId", "variants"].some(campo => Object.hasOwn(obj, campo))) ambigua = true;
    if (tipos.includes("product")) produtos.push(obj);
    for (const valor of Object.values(obj)) visitar(valor, profundidade + 1);
  }
  for (const script of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { visitar(JSON.parse(script[1])); }
    catch { try { visitar(JSON.parse(htmlDecode(script[1]))); } catch { return null; } }
  }
  if (ambigua || produtos.length !== 1) return null;
  const produto = produtos[0];
  const ids = [produto.productID, produto.productId, produto.catalogProductId, produto.catalog_product_id, produto.sku];
  if (ids[0] == null || ids.some(valor => valor != null && String(valor).trim().replace("-", "").toUpperCase() !== id) ||
      produto.itemId != null || produto.item_id != null) return null;
  if ([produto.url, produto["@id"]].some(url => url != null && urlCatalogoTecnicoMercadoLivre(url) !== id)) return null;
  const { tituloFactual } = require("../../optimus-capture/local-worker/mercadolivre-identity");
  const titulo = tituloFactual(htmlDecode(produto.name || ""));
  if (!titulo || /^(?:loja|store)\b|\b(?:official store|loja oficial)\b/i.test(titulo)) return null;
  const imagem = [produto.image].flat().map(valor => {
    try {
      const url = new URL(typeof valor === "string" ? valor : valor?.url);
      return url.protocol === "https:" && /(?:^|\.)mlstatic\.com$/i.test(url.hostname) &&
        !url.username && !url.password && !url.port ? url.href : "";
    } catch { return ""; }
  }).find(Boolean) || "";
  return { titulo, imagem };
}

module.exports = {
  urlCatalogoTecnicoMercadoLivre,
  urlRedirectDiretoCatalogoMl,
  extrairCatalogoTecnicoMercadoLivre,
  htmlDecode,
  extrairMeta,
  extrairJsonLd,
  limparPreco,
  corrigirImagemUrl
};
