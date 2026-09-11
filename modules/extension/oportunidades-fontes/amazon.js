const { criarDetectorPagina } = require("./pagina-oficial");

module.exports = {
  marketplace: "amazon",
  ttlMs: 7 * 60 * 1000,
  detectarOportunidade: criarDetectorPagina({
    marketplace: "amazon",
    titulo: "Amazon",
    mensagem: "Ofertas do Dia disponíveis agora",
    urlDestino: "https://www.amazon.com.br/gp/goldbox",
    hostsPermitidos: [/^(?:[a-z0-9-]+\.)?amazon\.com\.br$/i],
    indicadores: ["ofertas do dia", "deal"],
    ttlMs: 7 * 60 * 1000
  })
};
