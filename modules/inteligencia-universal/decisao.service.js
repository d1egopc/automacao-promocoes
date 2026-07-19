function calcularPrioridadeUniversal(score = 0, beneficios = {}, memoria = {}) {
  let prioridade = Number(score || 0);
  if (beneficios.temBeneficio) prioridade += 10;
  if (memoria.repetida && !memoria.bloquear) prioridade += 5;
  return Math.max(0, Math.min(100, Math.round(prioridade)));
}

function decidirOfertaUniversal({ validacao, score, memoria, destino, beneficios } = {}) {
  if (!validacao?.ok) {
    return { ok: false, status: "retida", motivo: validacao.erros?.[0] || "validacao_falhou" };
  }

  if (memoria?.bloquear) {
    return { ok: false, status: "retida", motivo: memoria.motivo || "oferta_repetida" };
  }

  if (destino && destino.ok === false) {
    return { ok: false, status: "retida", motivo: destino.motivo || "sem_destino_compativel" };
  }

  const valorScore = Number(score?.score || 0);
  if (valorScore < 20 && !beneficios?.temBeneficio) {
    return { ok: false, status: "retida", motivo: "score_baixo_sem_beneficio" };
  }

  return { ok: true, status: "aprovada", motivo: "inteligencia_universal_aprovada" };
}

module.exports = {
  decidirOfertaUniversal,
  calcularPrioridadeUniversal
};
