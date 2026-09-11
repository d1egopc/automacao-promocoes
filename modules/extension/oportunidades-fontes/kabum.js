const { criarDetectorPagina } = require("./pagina-oficial");

module.exports = {
  marketplace: "kabum_awin",
  ttlMs: 5 * 60 * 1000,
  detectarOportunidade: criarDetectorPagina({
    marketplace: "kabum_awin",
    titulo: "KaBuM / AWIN",
    mensagem: "Promoções oficiais disponíveis agora",
    urlDestino: "https://www.kabum.com.br/promocao/LOJASOFICIAIS",
    hostsPermitidos: [/^(?:[a-z0-9-]+\.)?kabum\.com\.br$/i],
    indicadores: ["promoções", "ofertas", "produto"],
    ttlMs: 5 * 60 * 1000
  })
};
