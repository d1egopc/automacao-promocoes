(function publicarRegistry(global) {
  const detector = global.OptimusCaptureDetector || require("../core/marketplace-detector");
  const mercadoLivre = global.OptimusCaptureMercadoLivre || require("./mercadolivre");
  const amazon = global.OptimusCaptureAmazon || require("./amazon");
  const shopee = global.OptimusCaptureShopee || require("./shopee");

  function capturarPaginaAtual(documento, locationObjeto) {
    const url = locationObjeto?.href || documento?.location?.href || "";
    const deteccao = detector.detectarMarketplacePorUrl(url);
    if (!deteccao.suportado) {
      return {
        ok: false,
        motivo: deteccao.motivo,
        marketplace: deteccao.marketplace || "",
        url
      };
    }

    if (deteccao.marketplace === "mercadolivre") {
      const produto = mercadoLivre.capturarMercadoLivreDaPagina(documento, locationObjeto);
      return {
        ok: produto.completo === true,
        motivo: produto.completo ? "" : "captura_incompleta",
        produto
      };
    }

    if (deteccao.marketplace === "shopee") {
      const produto = shopee.capturarShopeeDaPagina(documento, locationObjeto);
      return {
        ok: produto.completo === true,
        motivo: produto.completo ? "" : "captura_incompleta",
        produto
      };
    }

    if (deteccao.marketplace === "amazon") {
      const produto = amazon.capturarAmazonDaPagina(documento, locationObjeto);
      return {
        ok: produto.completo === true,
        motivo: produto.completo ? "" : "captura_incompleta",
        produto
      };
    }

    return {
      ok: false,
      motivo: "marketplace_nao_suportado",
      marketplace: deteccao.marketplace,
      url
    };
  }

  const api = { capturarPaginaAtual };
  global.OptimusCaptureRegistry = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
