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

function normalizarComparacao(valor = "") {
  return texto(valor)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function numeroMemoria(valor) {
  const numero = Number(valor || 0);
  return Number.isFinite(numero) ? numero : 0;
}

function mesmoPreco(precoAtual, precoAnterior) {
  const atual = numeroMemoria(precoAtual);
  const anterior = numeroMemoria(precoAnterior);
  if (!atual || !anterior) return false;
  return Math.abs(atual - anterior) < 0.01;
}

function mesmoCupom(cupomAtual = "", cupomAnterior = "") {
  return texto(cupomAtual).toLowerCase() === texto(cupomAnterior).toLowerCase();
}

function assinaturaBeneficio(oferta = {}) {
  return [
    texto(oferta.cupomTipo || oferta.tipoCupom),
    texto(oferta.beneficioTexto || oferta.beneficioExtra || oferta.avisoCupom),
    oferta.freteGratis === true ? "frete_gratis" : "",
    texto(oferta.cashback),
    texto(oferta.parcelamento)
  ].filter(Boolean).join("|").toLowerCase();
}

function beneficioMelhorou(ofertaAtual = {}, ofertaAnterior = {}) {
  const atual = assinaturaBeneficio(ofertaAtual);
  const anterior = assinaturaBeneficio(ofertaAnterior);
  if (!atual) return false;
  if (!anterior) return true;
  return atual !== anterior;
}

function horasDesdeOferta(oferta = {}) {
  const data = oferta.criadaEm || oferta.criada_em || oferta.capturadaEm || oferta.capturada_em || oferta.vistoEm || "";
  const timestamp = data ? new Date(data).getTime() : 0;
  if (!timestamp || Number.isNaN(timestamp)) return null;
  return (Date.now() - timestamp) / 36e5;
}

function dentroJanelaCurta(oferta = {}, contexto = {}) {
  const janelaHoras = Number(contexto.janelaRepeticaoHoras || 2);
  const horas = horasDesdeOferta(oferta);
  if (horas === null) return false;
  return horas >= 0 && horas <= janelaHoras;
}

function encontrarAnteriorRelevante(ofertaUniversal = {}, anteriores = []) {
  const chave = chaveMemoriaUniversal(ofertaUniversal);
  const linkAtual = texto(ofertaUniversal.linkOriginal || ofertaUniversal.linkAfiliado).toLowerCase();
  const tituloAtual = normalizarComparacao(ofertaUniversal.titulo);
  const marketplaceAtual = normalizarComparacao(ofertaUniversal.marketplace);

  return anteriores.find(item => {
    const chaveItem = texto(item.chave) || chaveMemoriaUniversal(item);
    const linkItem = texto(item.linkOriginal || item.linkAfiliado).toLowerCase();
    const tituloItem = normalizarComparacao(item.titulo || item.tituloNormalizado);
    const marketplaceItem = normalizarComparacao(item.marketplace);

    if (chaveItem && chaveItem === chave) return true;
    if (linkAtual && linkItem && linkAtual === linkItem) return true;
    return Boolean(tituloAtual && tituloItem && tituloAtual === tituloItem && marketplaceAtual === marketplaceItem);
  });
}

function avaliarMemoriaUniversal(ofertaUniversal = {}, contexto = {}) {
  const chave = chaveMemoriaUniversal(ofertaUniversal);
  const anteriores = Array.isArray(contexto.memoriaAnteriores) ? contexto.memoriaAnteriores : [];
  const anterior = encontrarAnteriorRelevante(ofertaUniversal, anteriores);

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
  const beneficioNovoOuMelhor = beneficioMelhorou(ofertaUniversal, anterior);
  const temBeneficio = Boolean(cupomNovo || beneficioNovoOuMelhor || texto(ofertaUniversal.beneficioTexto) || ofertaUniversal.freteGratis || texto(ofertaUniversal.cashback));
  const origemRadar = texto(ofertaUniversal.origem).toLowerCase() === "radar" || contexto.origem === "radar";
  const dentroJanela = dentroJanelaCurta(anterior, contexto);
  const precoIgual = mesmoPreco(ofertaUniversal.precoAtual, anterior.precoAtual || anterior.preco);
  const cupomIgual = mesmoCupom(ofertaUniversal.cupom, anterior.cupom);
  const repeticaoRigida = Boolean(dentroJanela && precoIgual && cupomIgual && !cupomNovo && !precoCaiu && !beneficioNovoOuMelhor);

  const bloquear = repeticaoRigida || !(cupomNovo || precoCaiu || temBeneficio || origemRadar);
  const motivo = repeticaoRigida ? "repeticao_rigida_janela_curta" : (bloquear ? "repeticao_identica_sem_beneficio" : "repeticao_flexivel_liberada");

  return {
    chave,
    repetida: true,
    bloquear,
    motivo,
    detalhes: {
      repeticaoRigida,
      dentroJanelaCurta: dentroJanela,
      precoIgual,
      cupomIgual,
      cupomNovo,
      precoCaiu,
      beneficioMelhorou: beneficioNovoOuMelhor,
      temBeneficio,
      origemRadar,
      anteriorId: anterior.id || null
    },
    logs: [{ etapa: "memoria", status: bloquear ? "bloqueada" : "liberada", motivo }]
  };
}

module.exports = {
  avaliarMemoriaUniversal,
  chaveMemoriaUniversal
};
