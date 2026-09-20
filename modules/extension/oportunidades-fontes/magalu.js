const { criarDetectorPagina } = require("./pagina-oficial");

const TTL_MS = 5 * 60 * 1000;

module.exports = {
  marketplace: "magalu",
  ttlMs: TTL_MS,
  detectarOportunidade: criarDetectorPagina({
    marketplace: "magalu",
    titulo: "Magalu",
    mensagem: "Ofertas do dia disponíveis agora",
    urlDestino: "https://www.magazineluiza.com.br/selecao/ofertasdodiamundo/",
    hostsPermitidos: [/^(?:[a-z0-9-]+\.)?magazineluiza\.com\.br$/i],
    indicadores: ["ofertas do dia"],
    ttlMs: TTL_MS
  })
};
