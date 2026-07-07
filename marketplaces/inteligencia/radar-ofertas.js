const {
  calcularScoreOferta,
  calcularDescontoPercentual,
  precoParaNumero
} = require("./score-oferta");

const {
  classificarCategoriaOferta
} = require("./classificador-categorias");

function normalizarTexto(texto = "") {
  return String(texto || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function nivelRadar(score) {
  if (score >= 75) return "excelente";
  if (score >= 50) return "boa";
  if (score >= 25) return "media";
  return "fraca";
}

function decisaoRadar(score, alertas = []) {
  if (score >= 60 && !alertas.includes("desconto baixo")) return "destacar";
  if (score >= 30) return "observar";
  return "ignorar";
}

function categoriaGenerica(categoria = "") {
  const texto = normalizarTexto(categoria);
  return !texto || [
    "diversos",
    "geral",
    "amazon",
    "shopee",
    "mercadolivre",
    "mercado livre",
    "aliexpress",
    "kabum"
  ].includes(texto);
}

function marketplaceForte(marketplace = "") {
  const texto = normalizarTexto(marketplace);
  return (
    texto.includes("mercadolivre") ||
    texto.includes("mercado livre") ||
    texto.includes("amazon") ||
    texto.includes("kabum")
  );
}

function categoriaQuente(categoria = "") {
  const texto = normalizarTexto(categoria);
  return (
    texto.includes("gamer") ||
    texto.includes("hardware") ||
    texto.includes("celulares") ||
    texto.includes("smartphones") ||
    texto.includes("computadores")
  );
}

function avaliarOfertaRadar(oferta = {}, contexto = {}) {
  const ofertaRadar = { ...(oferta || {}) };
  const precoAtual = precoParaNumero(ofertaRadar.precoAtual || ofertaRadar.preco);
  const precoAntigo = precoParaNumero(ofertaRadar.precoAntigo);
  const descontoPercentual = calcularDescontoPercentual(
    ofertaRadar.precoAntigo,
    ofertaRadar.precoAtual || ofertaRadar.preco
  );

  const categoria = classificarCategoriaOferta(
    ofertaRadar,
    contexto.termo || ofertaRadar.termo || ""
  );

  ofertaRadar.categoria = categoria;

  const resultadoScore = calcularScoreOferta(ofertaRadar);
  const radarScore = Math.max(0, Math.min(100, Number(resultadoScore.score || 0)));
  const marketplace = normalizarTexto(ofertaRadar.marketplace || ofertaRadar.mercado || "");
  const temCupom = Boolean(ofertaRadar.cupom);
  const temAvisoCupom = Boolean(ofertaRadar.avisoCupom);
  const motivos = [];
  const alertas = [];

  if (descontoPercentual >= 30) motivos.push("desconto alto");
  else if (descontoPercentual >= 10) motivos.push("desconto relevante");

  if (temCupom) motivos.push("tem cupom");
  if (temAvisoCupom) motivos.push("tem aviso de cupom");
  if (marketplaceForte(marketplace)) motivos.push("marketplace forte");
  if (categoriaQuente(categoria)) motivos.push("categoria quente");
  if (precoAtual > 0 && precoAtual <= 100) motivos.push("preco baixo");

  for (const motivo of resultadoScore.motivos || []) {
    if (motivo && !motivos.includes(motivo)) motivos.push(motivo);
  }

  if (!precoAtual) alertas.push("sem preco atual");
  if (!precoAntigo) alertas.push("sem preco antigo");
  if (descontoPercentual > 0 && descontoPercentual < 10) alertas.push("desconto baixo");
  if (!descontoPercentual) alertas.push("sem desconto calculado");
  if (categoriaGenerica(categoria)) alertas.push("categoria generica");
  if (contexto.possivelRepeticao || ofertaRadar.possivelRepeticao) {
    alertas.push("possivel repeticao");
  }

  return {
    radarScore,
    nivel: nivelRadar(radarScore),
    categoria,
    descontoPercentual,
    temCupom,
    temAvisoCupom,
    marketplace,
    precoAtual,
    precoAntigo,
    motivos,
    alertas,
    decisao: decisaoRadar(radarScore, alertas)
  };
}

module.exports = {
  avaliarOfertaRadar
};
