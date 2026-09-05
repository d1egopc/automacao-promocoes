(function publicarDetector(global) {
  function texto(valor) {
    return String(valor ?? "").trim();
  }

  function parseUrl(valor) {
    try {
      return new URL(texto(valor));
    } catch {
      return null;
    }
  }

  function hostMercadoLivre(hostname) {
    const host = texto(hostname).toLowerCase();
    return host === "mercadolivre.com.br" ||
      host.endsWith(".mercadolivre.com.br") ||
      host === "mercadolibre.com" ||
      host.endsWith(".mercadolibre.com");
  }

  function hostShopee(hostname) {
    const host = texto(hostname).toLowerCase().replace(/^www\./, "");
    return host === "shopee.com.br" || host.endsWith(".shopee.com.br");
  }

  function idsProdutoShopee(url) {
    const alvo = `${url.pathname}${url.search}`;
    if (/\/product\/\d+\/\d+/i.test(alvo)) return true;
    if (/(?:-i\.|\/i\.)\d+\.\d+/i.test(alvo)) return true;
    return Boolean(url.searchParams.get("shopId") && url.searchParams.get("itemId"));
  }

  function detectarMarketplacePorUrl(valor) {
    const url = parseUrl(valor);
    if (!url || !["http:", "https:"].includes(url.protocol)) {
      return { suportado: false, marketplace: "", motivo: "url_invalida" };
    }

    const host = url.hostname.toLowerCase();
    if (host === "meli.la" || host.endsWith(".meli.la")) {
      return {
        suportado: false,
        marketplace: "mercadolivre",
        motivo: "meli_la_requer_url_real",
        url: url.toString()
      };
    }

    if (hostMercadoLivre(host)) {
      const produto = /(?:^|[^\w])(mlb|mlbu)[-\d]/i.test(`${url.pathname}${url.search}`);
      return {
        suportado: produto,
        marketplace: "mercadolivre",
        motivo: produto ? "" : "pagina_mercadolivre_sem_produto",
        url: url.toString()
      };
    }

    if (host === "s.shopee.com.br" || host.endsWith(".s.shopee.com.br")) {
      return {
        suportado: false,
        marketplace: "shopee",
        motivo: "shopee_shortlink_requer_url_real",
        url: url.toString()
      };
    }

    if (hostShopee(host)) {
      const produto = idsProdutoShopee(url);
      return {
        suportado: produto,
        marketplace: "shopee",
        motivo: produto ? "" : "pagina_shopee_sem_produto",
        url: url.toString()
      };
    }

    return { suportado: false, marketplace: "", motivo: "marketplace_nao_suportado", url: url.toString() };
  }

  const api = { detectarMarketplacePorUrl, hostMercadoLivre, hostShopee };
  global.OptimusCaptureDetector = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
