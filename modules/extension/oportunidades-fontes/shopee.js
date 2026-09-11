const { criarDetectorPagina } = require("./pagina-oficial");

module.exports = {
  marketplace: "shopee",
  ttlMs: 5 * 60 * 1000,
  detectarOportunidade: criarDetectorPagina({
    marketplace: "shopee",
    titulo: "Shopee",
    mensagem: "Ofertas Relâmpago disponíveis agora",
    urlDestino: "https://shopee.com.br/flash_sale",
    hostsPermitidos: [/^(?:[a-z0-9-]+\.)?shopee\.com\.br$/i],
    indicadores: ["ofertas relâmpago", "preço atual", "promoção"],
    ttlMs: 5 * 60 * 1000
  })
};
