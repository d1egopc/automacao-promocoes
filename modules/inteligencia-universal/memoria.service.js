const { texto } = require("./normalizacao.service");
const { cupomValido } = require("./beneficios.service");

function chaveMemoriaUniversal(ofertaUniversal = {}) {
  return [
    texto(ofertaUniversal.clienteId),
    texto(ofertaUniversal.marketplace),
    texto(ofertaUniversal.linkOriginal || ofertaUniversal.linkAfiliado || ofertaUniversal.titulo).toLowerCase(),
    texto(ofertaUniversal.titulo).toLowerCase()
  ].filter(Boolean).join("|");
}

function precoMenor(precoAtual, precoAnterior) {
  const atual = Number(precoAtual || 0);
  const anterior = Number(precoAnterior || 0);
  if (!atual || !anterior || atual >= anterior) return false;
  const diff = anterior - atual;
  return diff >= 5 || diff / anterior >= 0.08;
}

function avaliarMemoriaUniversal(ofertaUniversal = {}, contexto = {}) {
  const chave = chaveMemoriaUniversal(ofertaUniversal);
  const anteriores = Array.isArray(contexto.memoriaAnteriores) ? contexto.memoriaAnteriores : [];
  const anterior = anteriores.find(item => texto(item.chave) === chave || texto(item.linkOriginal || item.linkAfiliado).toLowerCase() === texto(ofertaUniversal.linkOriginal || ofertaUniversal.linkAfiliado).toLowerCase());

  if (!anterior) {
    return {
      chave,
      repetida: false,
      bloquear: false,
      motivo: "sem_historico",
      logs: [{ etapa: "memoria", status: "ok", motivo: "sem_historico" }]
    };
  }

  const cupomNovo = cupomValido(ofertaUniversal.cupom) && texto(ofertaUniversal.cupom).toLowerCase() !== texto(anterior.cupom).toLowerCase();
  const precoCaiu = precoMenor(ofertaUniversal.precoAtual, anterior.precoAtual || anterior.preco);
  const temBeneficio = Boolean(cupomNovo || texto(ofertaUniversal.beneficioTexto) || ofertaUniversal.freteGratis || texto(ofertaUniversal.cashback));
  const origemRadar = texto(ofertaUniversal.origem).toLowerCase() === "radar" || contexto.origem === "radar";

  const bloquear = !(cupomNovo || precoCaiu || temBeneficio || origemRadar);
  const motivo = bloquear ? "repeticao_identica_sem_beneficio" : "repeticao_flexivel_liberada";

  return {
    chave,
    repetida: true,
    bloquear,
    motivo,
    detalhes: { cupomNovo, precoCaiu, temBeneficio, origemRadar },
    logs: [{ etapa: "memoria", status: bloquear ? "bloqueada" : "liberada", motivo }]
  };
}

module.exports = {
  avaliarMemoriaUniversal,
  chaveMemoriaUniversal
};