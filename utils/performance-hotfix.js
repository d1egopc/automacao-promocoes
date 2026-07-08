function numeroSeguro(valor, fallback = 0) {
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : fallback;
}

function texto(valor = "") {
  return String(valor || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function limitarInteiro(valor, fallback = 100, min = 1, max = 500) {
  const numero = Math.floor(numeroSeguro(valor, fallback));
  return Math.max(min, Math.min(max, numero));
}

function paginaLimiteSeguro(query = {}, padrao = 100, max = 500) {
  return {
    limit: limitarInteiro(query.limit, padrao, 1, max),
    offset: Math.max(0, Math.floor(numeroSeguro(query.offset, 0)))
  };
}

function aplicarLimiteLista(lista = [], query = {}, padrao = 100, max = 500) {
  const { limit, offset } = paginaLimiteSeguro(query, padrao, max);
  const origem = Array.isArray(lista) ? lista : [];
  return {
    itens: origem.slice(offset, offset + limit),
    total: origem.length,
    limit,
    offset,
    hasMore: offset + limit < origem.length
  };
}

function cupomRealOuForte(oferta = {}) {
  const tipoCupom = texto(oferta.tipoCupom || oferta.cupomTipo || "");
  const tipoRadar = texto(oferta.tipoRadar || "");
  return Boolean(
    oferta.cupomConfirmado === true ||
    oferta.cupomDetectado === true ||
    oferta.cupomDetectadoTexto === true ||
    oferta.possivelCupom === true ||
    String(oferta.cupom || "").trim() ||
    String(oferta.avisoCupom || oferta.beneficioExtra || "").trim() ||
    (tipoCupom && tipoCupom !== "nenhum") ||
    tipoRadar === "radarcomcupom"
  );
}

function contarPendentesCliente(fila = [], clienteId = "admin") {
  return (Array.isArray(fila) ? fila : []).filter(item =>
    String(item?.clienteId || "admin") === String(clienteId || "admin") &&
    String(item?.status || "pendente") === "pendente"
  ).length;
}

function avaliarLimiteFilaHotfix(fila = [], oferta = {}, clienteId = "admin") {
  const origem = texto(oferta.origem || oferta.origemDetalhe || "");
  const manual = oferta.manual === true || origem.includes("manual");
  const pendentes = contarPendentesCliente(fila, clienteId);
  const prioridade = numeroSeguro(oferta.prioridadeEnvio || oferta.prioridadeFila || oferta.prioridade || oferta.radarScore || oferta.score, 0);
  const cupomForte = cupomRealOuForte(oferta);

  if (manual) return { permitido: true, pendentes, motivo: "manual", prioridade, cupomForte };
  if (pendentes >= 60) {
    return { permitido: false, pendentes, motivo: "fila_60_bloqueio_auto", prioridade, cupomForte };
  }
  if (pendentes >= 40 && !(cupomForte || prioridade >= 80)) {
    return { permitido: false, pendentes, motivo: "fila_40_bloqueio_comum", prioridade, cupomForte };
  }

  return { permitido: true, pendentes, motivo: "permitido", prioridade, cupomForte };
}

const runnerLocks = new Map();

function iniciarRunnerHotfix(runner = "", clienteId = "admin", logger = console) {
  const chave = `${runner || "runner"}:${clienteId || "admin"}`;
  if (runnerLocks.has(chave)) {
    logger.log("[PERFORMANCE-RUNNER-SKIP]", {
      runner,
      clienteId,
      motivo: "runner_em_execucao",
      iniciadoEm: runnerLocks.get(chave)?.iniciadoEm || ""
    });
    return "";
  }
  runnerLocks.set(chave, { runner, clienteId, iniciadoEm: new Date().toISOString() });
  return chave;
}

function finalizarRunnerHotfix(chave = "") {
  if (chave) runnerLocks.delete(chave);
}

module.exports = {
  aplicarLimiteLista,
  avaliarLimiteFilaHotfix,
  contarPendentesCliente,
  finalizarRunnerHotfix,
  iniciarRunnerHotfix,
  paginaLimiteSeguro
};
