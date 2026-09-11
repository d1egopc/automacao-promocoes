const { buscarOfertasShopee: buscarOfertasShopeePadrao } = require("../../../marketplaces/shopee/api");

const TTL_MS = 5 * 60 * 1000;

function precoValido(valor) {
  const texto = String(valor ?? "").trim().replace(/[^\d,.-]/g, "");
  if (!texto) return false;

  const normalizado = texto.includes(",") && texto.includes(".")
    ? texto.replace(/\./g, "").replace(",", ".")
    : texto.replace(",", ".");
  const numero = Number(normalizado);
  return Number.isFinite(numero) && numero > 0;
}

function temOfertaComDesconto(item = {}) {
  return [item.priceMin, item.priceMax, item.precoAtual, item.preco].some(precoValido)
    && Number(item.priceDiscountRate) > 0;
}

async function detectarOportunidade({
  agora = new Date(),
  clienteId = "",
  buscarOfertasShopee = buscarOfertasShopeePadrao,
  ...deps
} = {}) {
  try {
    const ofertas = await buscarOfertasShopee(clienteId, deps);
    if (!Array.isArray(ofertas) || !ofertas.some(temOfertaComDesconto)) return null;

    return {
      marketplace: "shopee",
      ativo: true,
      quantidade: 1,
      titulo: "Shopee",
      mensagem: "Oportunidades disponíveis agora",
      urlDestino: "https://shopee.com.br/flash_sale",
      validoAte: new Date(agora.getTime() + TTL_MS).toISOString(),
      fonte: "shopee_affiliate_product_offer_v2"
    };
  } catch {
    return null;
  }
}

module.exports = {
  marketplace: "shopee",
  ttlMs: TTL_MS,
  cacheKey: ({ clienteId } = {}) => `shopee:${String(clienteId || "").trim() || "sem_cliente"}`,
  detectarOportunidade
};
