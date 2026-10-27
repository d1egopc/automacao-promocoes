"use strict";

// Pure evidence projection for administrative resolution. Never affiliate proof,
// never a new importer, classifier, network client or commercial authorization.
const { extrairJsonLd } = require("../../../marketplaces/mercadolivre/utils");
const { tituloComercialUniversalValido } = require("../comercial-precedencia");
const { extrairProdutoIdKabumUrl } = require("../produto-canonico");
const { produtoIdUrlMagalu } = require("../../local-worker/magalu-identity.contract");
const ml = require("../mercadolivre-social-identidade");
const mlIdentity = require("../../../optimus-capture/local-worker/mercadolivre-identity");
const { extrairIdentidadeAmazonHtml } = require("../../../marketplaces/amazon/parser");

function identidadeUrlProduto(valor) {
  try {
    const u = new URL(valor), host = u.hostname, p = u.pathname;
    if (u.protocol !== "https:" || u.username || u.password || u.port) return "";
    const oficial = dominio => host === dominio || host.endsWith(`.${dominio}`);
    if (oficial("amazon.com.br")) {
      const id = p.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:\/|$)/i)?.[1];
      return id ? `amazon:${id.toUpperCase()}` : "";
    }
    if (oficial("mercadolivre.com.br") && !p.startsWith("/social/")) {
      const id = p.match(/MLB-?(\d{6,})/i)?.[1];
      return id ? `mercadolivre:MLB${id}` : "";
    }
    if (oficial("shopee.com.br")) {
      const m = p.match(/^\/product\/(\d+)\/(\d+)(?:\/|$)/) || p.match(/-i\.(\d+)\.(\d+)(?:\/|$)/);
      return m ? `shopee:${m[1]}:${m[2]}` : "";
    }
    if (oficial("kabum.com.br")) {
      const id = extrairProdutoIdKabumUrl(u.href);
      return id ? `kabum:${id}` : "";
    }
    if (oficial("aliexpress.com")) {
      const id = p.match(/^\/item\/(\d{8,20})\.html$/i)?.[1];
      return id ? `aliexpress:${id}` : "";
    }
    if (oficial("magazineluiza.com.br")) {
      const id = produtoIdUrlMagalu(u.href);
      return id ? `magalu:${id}` : "";
    }
  } catch {}
  return "";
}

function evidenciaProdutoHtml(html, url) {
  const ausente = { confirmada: false, origem: "identidade_nao_comprovada" };
  let pagina;
  try { pagina = new URL(url); } catch { return ausente; }
  const mlOficial = pagina.hostname === "mercadolivre.com.br" || pagina.hostname.endsWith(".mercadolivre.com.br");
  if (mlOficial && pagina.pathname.startsWith("/social/")) {
    const prova = ml.extrairProvaIdentidadeMercadoLivreHtml(html);
    if (prova.ok && identidadeUrlProduto(prova.urlProduto)) return {
      confirmada: true, origem: prova.origem, chave: `mercadolivre:${prova.mlbItem}`, urlProduto: prova.urlProduto
    };
    return ausente;
  }
  // Reuse the stricter existing ML/MLBU binding, not a numeric URL guess.
  if (mlOficial) {
    try {
      const dados = mlIdentity.extrair(html, mlIdentity.normalizarMlb(pagina.pathname), pagina.href);
      if (dados.identidadeValidada) return { confirmada: true, origem: "ml_identity_jsonld",
        chave: `mercadolivre:${dados.observedMlb}`, urlProduto: pagina.href };
    } catch {}
    return ausente;
  }
  const esperado = identidadeUrlProduto(url);
  if (!esperado) return ausente;
  const principalAmazon = esperado.startsWith("amazon:") ? extrairIdentidadeAmazonHtml(html, url) : ausente;
  const $ = require("cheerio").load(String(html || ""));
  // A blocked document is not a product, even if its URL looks right.
  if (/captcha|robot check|access denied|verifica[cç][aã]o de seguran[cç]a/i.test($("title,h1,form[action*=captcha]").text())) return ausente;
  const canonicos = $("link[rel=canonical]").toArray().map(el => {
    try { return identidadeUrlProduto(new URL($(el).attr("href"), url).href); } catch { return ""; }
  });
  if (canonicos.some(chave => chave !== esperado)) return ausente;
  const produtos = [];
  let nodes = 0;
  function visitar(item, depth = 0) {
    if (!item || depth > 8 || ++nodes > 2048) return;
    if (Array.isArray(item)) { item.forEach(x => visitar(x, depth + 1)); return; }
    if (typeof item !== "object") return;
    const tipos = [item["@type"]].flat();
    if (tipos.some(tipo => String(tipo).toLowerCase() === "product")) { produtos.push(item); return; }
    Object.values(item).forEach(x => visitar(x, depth + 1));
  }
  $("script[type='application/ld+json']").slice(0, 24).each((_i, el) => {
    try { visitar(JSON.parse($(el).text())); } catch {}
  });
  // Multiple products/recommendations or divergent IDs never establish identity.
  if (nodes > 2048 || produtos.length > 1) return ausente;
  if (!produtos.length) return principalAmazon;
  const produto = extrairJsonLd(`<script type="application/ld+json">${JSON.stringify(produtos[0])}</script>`);
  if (!produto || !tituloComercialUniversalValido(produto.name) || String(produto.name).length < 6) return ausente;
  const urls = [produto.url, produto["@id"], ...[produto.offers].flat().map(x => x?.url)]
    .filter(x => typeof x === "string" && /^https?:/.test(x));
  const chaves = urls.map(x => identidadeUrlProduto(x));
  if (chaves.some(chave => chave !== esperado)) return ausente;
  if (!chaves.length) return principalAmazon.confirmada && produto.name.trim() === $("#productTitle").text().trim() ? principalAmazon : ausente;
  return { confirmada: true, origem: "jsonld_product_url_factual", chave: esperado, urlProduto: url };
}

module.exports = { identidadeUrlProduto, evidenciaProdutoHtml };
