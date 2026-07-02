const { calcularScoreOferta } = require("../../marketplaces/inteligencia/score-oferta");

function calcularScoreUniversal(ofertaUniversal = {}, contexto = {}) {
  const entrada = {
    ...ofertaUniversal,
    precoAtual: ofertaUniversal.precoAtual,
    preco: ofertaUniversal.precoAtual,
    precoAntigo: ofertaUniversal.precoOriginal,
    categoria: ofertaUniversal.categoria,
    cupom: ofertaUniversal.cupom,
    tipoCupom: ofertaUniversal.cupomTipo,
    beneficioExtra: ofertaUniversal.beneficioTexto,
    marketplace: ofertaUniversal.marketplace
  };

  const resultado = calcularScoreOferta(entrada);
  const score = Number.isFinite(Number(ofertaUniversal.score))
    ? Math.max(Number(ofertaUniversal.score), Number(resultado.score || 0))
    : Number(resultado.score || 0);

  return {
    score,
    nivel: resultado.nivel,
    descontoPercentual: resultado.desconto || 0,
    motivos: resultado.motivos || [],
    origem: "score_legado_v1",
    logs: [{ etapa: "score", status: "calculado", motivo: "score_legado_v1", score }]
  };
}

module.exports = {
  calcularScoreUniversal
};