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

    return { suportado: false, marketplace: "", motivo: "marketplace_nao_suportado", url: url.toString() };
  }

  const api = { detectarMarketplacePorUrl, hostMercadoLivre };
  global.OptimusCaptureDetector = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
