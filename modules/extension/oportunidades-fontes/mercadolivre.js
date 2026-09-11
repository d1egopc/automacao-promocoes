const { criarDetectorPagina } = require("./pagina-oficial");

module.exports = {
  marketplace: "mercadolivre",
  ttlMs: 5 * 60 * 1000,
  detectarOportunidade: criarDetectorPagina({
    marketplace: "mercadolivre",
    titulo: "Mercado Livre",
    mensagem: "Ofertas oficiais disponíveis agora",
    urlDestino: "https://www.mercadolivre.com.br/ofertas",
    hostsPermitidos: [/^(?:[a-z0-9-]+\.)?mercadolivre\.com\.br$/i],
    indicadores: ["todas as ofertas", "oferta do dia"],
    ttlMs: 5 * 60 * 1000
  })
};
