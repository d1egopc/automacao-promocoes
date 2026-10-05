const TIPOS_CUPOM_PRIORIDADE_CONFIAVEL = new Set([
  "texto_radar",
  "texto_clonador"
]);

const CUPONS_INVALIDOS_PRIORIDADE = new Set([
  "COPIADO",
  "APPLIED",
  "APPEARANCE",
  "APPLINK",
  "SEM CUPOM"
]);

function tiposCupom(oferta = {}) {
  return [oferta.cupomTipo, oferta.tipoCupom]
    .map(tipo => String(tipo || "").trim().toLowerCase())
    .filter(Boolean);
}

function prioridadeMinimaCupomConfiavel(oferta = {}) {
  if (!oferta || typeof oferta !== "object") return 0;
  if (oferta.cupomSuspeito === true || oferta.cupomMonetarioIncompativel === true) return 0;

  const cupom = String(oferta.cupom || "").trim().toUpperCase();
  if (CUPONS_INVALIDOS_PRIORIDADE.has(cupom)) return 0;

  const tipos = tiposCupom(oferta);
  if (
    tipos.includes("real") ||
    oferta.cupomConfirmado === true ||
    oferta.cupomValidado === true
  ) {
    return 110;
  }

  const evidenciaTextoConfiavel = Boolean(cupom) && tipos.some(tipo =>
    tipo === "detectado" || TIPOS_CUPOM_PRIORIDADE_CONFIAVEL.has(tipo)
  );
  return evidenciaTextoConfiavel ? 95 : 0;
}

function resolverPrioridadeFinalCupom(oferta = {}, prioridadeDecisao = 0, prioridadesAnteriores = []) {
  const prioridadeMinimaCupom = prioridadeMinimaCupomConfiavel(oferta);
  const prioridadeV2 = Number(prioridadeDecisao);
  const anteriores = (Array.isArray(prioridadesAnteriores) ? prioridadesAnteriores : [prioridadesAnteriores])
    .map(Number)
    .filter(Number.isFinite);
  const prioridadeAnterior = anteriores.length ? Math.max(...anteriores) : 0;
  const prioridadeDecisaoValida = Number.isFinite(prioridadeV2) ? prioridadeV2 : 0;
  const prioridadeFinal = prioridadeMinimaCupom > 0
    ? Math.max(prioridadeDecisaoValida, prioridadeAnterior, prioridadeMinimaCupom)
    : prioridadeDecisaoValida;

  return {
    prioridadeFinal,
    prioridadeMinimaCupom,
    prioridadeAnterior,
    prioridadeDecisao: prioridadeDecisaoValida,
    pisoAplicado: prioridadeMinimaCupom > 0 && prioridadeFinal > prioridadeDecisaoValida
  };
}

module.exports = {
  CUPONS_INVALIDOS_PRIORIDADE,
  TIPOS_CUPOM_PRIORIDADE_CONFIAVEL,
  prioridadeMinimaCupomConfiavel,
  resolverPrioridadeFinalCupom
};
