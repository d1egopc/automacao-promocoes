const { texto } = require("./normalizacao.service");

function cupomValido(cupom = "") {
  const valor = texto(cupom).toLowerCase();
  return Boolean(valor && valor !== "copiado" && valor !== "cupom copiado" && valor !== "sem cupom");
}

function analisarBeneficiosUniversal(ofertaUniversal = {}) {
  const beneficios = [];
  const logs = [];

  if (cupomValido(ofertaUniversal.cupom)) beneficios.push({ tipo: "cupom", valor: ofertaUniversal.cupom });
  if (texto(ofertaUniversal.cupomTipo)) beneficios.push({ tipo: "cupom_tipo", valor: ofertaUniversal.cupomTipo });
  if (texto(ofertaUniversal.beneficioTexto)) beneficios.push({ tipo: "beneficio_texto", valor: ofertaUniversal.beneficioTexto });
  if (ofertaUniversal.freteGratis === true) beneficios.push({ tipo: "frete_gratis", valor: true });
  if (texto(ofertaUniversal.cashback)) beneficios.push({ tipo: "cashback", valor: ofertaUniversal.cashback });
  if (texto(ofertaUniversal.parcelamento)) beneficios.push({ tipo: "parcelamento", valor: ofertaUniversal.parcelamento });

  logs.push({ etapa: "beneficios", status: "avaliado", total: beneficios.length });

  return {
    temBeneficio: beneficios.length > 0,
    beneficios,
    cupomValido: cupomValido(ofertaUniversal.cupom),
    logs
  };
}

module.exports = {
  analisarBeneficiosUniversal,
  cupomValido
};
