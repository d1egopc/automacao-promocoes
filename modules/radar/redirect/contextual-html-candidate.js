"use strict";

const CTA = /^(?:ver|ir para|acessar|comprar)(?: a)? (?:na loja|oferta|produto)$/;
const EXCLUIDOS = "nav,aside,header,footer,[role=banner],[class*=advert],[class*=sponsor],[class*=publicidade],[id*=advert]";

function normalizarTexto(valor) {
  return String(valor || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ").trim().toLowerCase();
}

function linksDoBloco($, bloco, base, detectarMarketplace) {
  const links = [];
  let origem;
  try { origem = new URL(base); } catch { return links; }
  bloco.find("a[href]").each((_indice, elemento) => {
    const ancora = $(elemento);
    if (ancora.closest(EXCLUIDOS).length) return;
    const href = String(ancora.attr("href") || "").trim();
    let url;
    try { url = new URL(href, base); } catch { return; }
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.href.length > 4096) return;
    const marketplace = Boolean(detectarMarketplace(url.href));
    const relativoMesmaOrigem = /^(?:\/(?!\/)|\.{1,2}\/)/.test(href) && url.origin === origem.origin;
    if (!marketplace && !relativoMesmaOrigem) return;
    links.push({ url: url.href, marketplace, cta: CTA.test(normalizarTexto(ancora.text())) });
  });
  return links;
}

// Seletor opt-in do diagnóstico administrativo. Ambiguidade nunca vira destino.
function extrairCandidatoContextual(html, base, detectarMarketplace) {
  const cheerio = require("cheerio"); // somente no diagnóstico administrativo opt-in
  const $ = cheerio.load(String(html || ""));
  $("script,style,template").remove();
  const mains = $("main");
  const articles = mains.length === 1 ? mains.find("article") : $("article");
  if (mains.length > 1 || articles.length > 1) return null;
  const raiz = articles.length === 1 ? articles.first() : mains.length === 1 ? mains.first() : null;
  if (!raiz || raiz.find("a[href]").length > 256) return null;
  const titulosPrincipais = raiz.find("h1").toArray().filter(elemento =>
    !$(elemento).closest(EXCLUIDOS).length && normalizarTexto($(elemento).text()).length >= 4);
  if (titulosPrincipais.length > 1) return null;
  const titulos = titulosPrincipais.length ? titulosPrincipais : raiz.find("h2,h3,[itemprop=name]").toArray()
    .filter(elemento => !$(elemento).closest(EXCLUIDOS).length && normalizarTexto($(elemento).text()).length >= 4);
  if (titulos.length !== 1) return null;

  const linksRaiz = linksDoBloco($, raiz, base, detectarMarketplace);
  let escolhido = null;
  let bloco = $(titulos[0]).parent();
  for (let nivel = 0; bloco.length && nivel < 12; nivel += 1, bloco = bloco.parent()) {
    const links = linksDoBloco($, bloco, base, detectarMarketplace);
    const destinos = new Set(links.filter(link => link.marketplace).map(link => link.url));
    const chamadas = new Set(links.filter(link => link.cta).map(link => link.url));
    if (chamadas.size === 1 && destinos.size <= 1 &&
        (!destinos.size || destinos.has([...chamadas][0]))) {
      escolhido = [...chamadas][0];
      break;
    }
    if (bloco[0] === raiz[0]) break;
  }
  if (!escolhido || linksRaiz.some(link => link.marketplace && link.cta && link.url !== escolhido)) return null;
  const url = escolhido;
  return { url, metodo: "html_contextual", evidencia: "cta_unica_em_produto" };
}

module.exports = { extrairCandidatoContextual };
