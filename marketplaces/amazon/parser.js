// ================= PARSER AMAZON =================

function extrairLinksAmazon(html = "") {

  const linksExtraidos = [
    ...html.matchAll(
      /href="([^"]*\/dp\/[A-Z0-9]{10}[^"]*)"/g
    ),

    ...html.matchAll(
      /href="([^"]*\/gp\/product\/[A-Z0-9]{10}[^"]*)"/g
    )
  ]
    .map(m => m[1])
    .map(link => {

      let limpo = String(link)
        .replace(/&amp;/g, "&")
        .split("?")[0];

      if (limpo.startsWith("/")) {
        limpo =
          "https://www.amazon.com.br" +
          limpo;
      }

      return limpo;

    })
    .filter(link =>
      link.includes("amazon.com.br") &&
      !link.includes("/sspa/") &&
      !link.includes("/gp/slredirect")
    );

  return [
    ...new Set(linksExtraidos)
  ];

}

// Read-only primary-product proof, reused by the administrative resolver.
// It never fetches a page, converts a link or prepares an affiliate offer.
function extrairIdentidadeAmazonHtml(html = "", url = "") {
  const { extrairAsinAmazonManual, detectarBloqueioAmazon } = require("../../modules/manual-v2/adapters/amazon.manual.adapter");
  const { tituloComercialUniversalValido } = require("../../modules/radar/comercial-precedencia");
  const ausente = { confirmada: false };
  let pagina;
  try { pagina = new URL(url); } catch { return ausente; }
  if (pagina.protocol !== "https:" || pagina.username || pagina.password || pagina.port ||
      !(pagina.hostname === "amazon.com.br" || pagina.hostname.endsWith(".amazon.com.br")) ||
      !/^\/(?:dp|gp\/product)\/[a-z0-9]{10}(?:\/|$)/i.test(pagina.pathname)) return ausente;
  const esperado = extrairAsinAmazonManual(url).toUpperCase();
  const $ = require("cheerio").load(String(html));
  if (detectarBloqueioAmazon({
    temCaptcha: $("form[action*=validateCaptcha],input#captchacharacters").length > 0,
    temRobotCheck: /robot check|automated access|access denied/i.test($("title,h1").text())
  })) return ausente;
  const titulos = $("#productTitle");
  const asins = $("input[name=ASIN],input#ASIN").toArray().map(el => String($(el).attr("value") || "").toUpperCase());
  const canonicos = $("link[rel=canonical]").toArray().map(el => {
    try {
      const u = new URL($(el).attr("href"), pagina);
      return u.protocol === "https:" && (u.hostname === "amazon.com.br" || u.hostname.endsWith(".amazon.com.br"))
        ? extrairAsinAmazonManual(u.href).toUpperCase() : "";
    } catch { return ""; }
  });
  if (titulos.length !== 1 || titulos.text().trim().length < 6 ||
      !tituloComercialUniversalValido(titulos.text()) || !asins.length || asins.some(asin => asin !== esperado) ||
      canonicos.length !== 1 || canonicos[0] !== esperado) return ausente;
  return { confirmada: true, origem: "amazon_primary_title_asin_canonical", chave: `amazon:${esperado}`, urlProduto: pagina.href };
}

module.exports = { extrairLinksAmazon, extrairIdentidadeAmazonHtml };
