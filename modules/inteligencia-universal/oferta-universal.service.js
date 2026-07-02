const { normalizarOfertaUniversal } = require("./normalizacao.service");
const { validarOfertaUniversal } = require("./validacao.service");
const { classificarCategoriaUniversal } = require("./categoria.service");
const { calcularScoreUniversal } = require("./score.service");
const { avaliarMemoriaUniversal } = require("./memoria.service");
const { analisarBeneficiosUniversal } = require("./beneficios.service");
const { avaliarDestinoUniversal } = require("./destino.service");
const { decidirOfertaUniversal, calcularPrioridadeUniversal } = require("./decisao.service");

function montarTemplateInput(ofertaUniversal = {}, score = {}, beneficios = {}) {
  return {
    titulo: ofertaUniversal.titulo,
    marketplace: ofertaUniversal.marketplace,
    precoAtual: ofertaUniversal.precoAtual,
    precoOriginal: ofertaUniversal.precoOriginal,
    descontoPercentual: score.descontoPercentual,
    economia: null,
    parcelamento: ofertaUniversal.parcelamento,
    cupom: ofertaUniversal.cupom,
    cupomTipo: ofertaUniversal.cupomTipo,
    beneficioTexto: ofertaUniversal.beneficioTexto,
    freteGratis: ofertaUniversal.freteGratis,
    cashback: ofertaUniversal.cashback,
    linkAfiliado: ofertaUniversal.linkAfiliado,
    beneficios: beneficios.beneficios || []
  };
}

function avaliarOfertaUniversal(oferta = {}, contexto = {}) {
  const logs = [{ etapa: "inicio", status: "ok", origem: contexto.origem || oferta.origem || "" }];

  let ofertaUniversal = normalizarOfertaUniversal(oferta, contexto);
  logs.push({ etapa: "normalizacao", status: "ok", marketplace: ofertaUniversal.marketplace, titulo: ofertaUniversal.titulo });

  const categoria = classificarCategoriaUniversal(ofertaUniversal, contexto);
  logs.push(...categoria.logs);
  ofertaUniversal = { ...ofertaUniversal, categoria: categoria.categoria };

  const beneficios = analisarBeneficiosUniversal(ofertaUniversal, contexto);
  logs.push(...beneficios.logs);

  const validacao = validarOfertaUniversal(ofertaUniversal, contexto);
  logs.push(...validacao.logs);

  const score = calcularScoreUniversal(ofertaUniversal, contexto);
  logs.push(...score.logs);

  const memoria = avaliarMemoriaUniversal(ofertaUniversal, contexto);
  logs.push(...memoria.logs);

  const destino = avaliarDestinoUniversal(ofertaUniversal, contexto);
  logs.push(...destino.logs);

  const prioridade = calcularPrioridadeUniversal(score.score, beneficios, memoria);
  const decisao = decidirOfertaUniversal({ validacao, score, memoria, destino, beneficios });
  logs.push({ etapa: "decisao", status: decisao.status, motivo: decisao.motivo, prioridade });

  return {
    ok: decisao.ok,
    status: decisao.status,
    motivo: decisao.motivo,
    ofertaUniversal,
    categoria: categoria.categoria,
    score,
    prioridade,
    memoria,
    destino,
    templateInput: montarTemplateInput(ofertaUniversal, score, beneficios),
    logs
  };
}

module.exports = {
  avaliarOfertaUniversal,
  montarTemplateInput
};