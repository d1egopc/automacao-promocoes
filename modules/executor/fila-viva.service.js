"use strict";

const TTL_COMERCIAL_PADRAO_MS = 30 * 60 * 1000;
const AGUA_NOVA_MS = 5 * 60 * 1000;
const FRESCA_EM_RISCO_MS = 22 * 60 * 1000;

function limitarNumero(valor, minimo, maximo) {
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return minimo;
  return Math.max(minimo, Math.min(maximo, numero));
}

function timestampFilaViva(valor) {
  if (valor instanceof Date) return valor.getTime();
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : NaN;

  const texto = String(valor || "").trim();
  if (!texto) return NaN;

  const brasileiro = texto.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (brasileiro) {
    const [, dia, mes, ano, hora, minuto, segundo] = brasileiro;
    return new Date(
      Number(ano),
      Number(mes) - 1,
      Number(dia),
      Number(hora),
      Number(minuto),
      Number(segundo || 0)
    ).getTime();
  }

  const direto = Date.parse(texto);
  return Number.isFinite(direto) ? direto : NaN;
}

function timestampReferenciaOfertaFilaViva(oferta = {}) {
  const candidatos = [
    oferta.capturadoEm,
    oferta.capturadaEm,
    oferta.dataCaptura,
    oferta.radarCapturadoEm,
    oferta.criadoEmRadar,
    oferta.dataEntradaFila,
    oferta.criadoEm,
    oferta.dataCriacao
  ];

  for (const candidato of candidatos) {
    const ms = timestampFilaViva(candidato);
    if (Number.isFinite(ms)) return ms;
  }

  return 0;
}

function cupomComercialFilaViva(oferta = {}) {
  if (oferta.cupomConfirmado === true || oferta.cupomValidado === true) return true;
  if (oferta.cupomDetectado === true || oferta.cupomDetectadoTexto === true) return true;

  const tipo = String(oferta.cupomTipo || oferta.tipoCupom || "").toLowerCase();
  if (["real", "detectado", "radar", "explicito"].includes(tipo)) return true;

  const cupom = String(oferta.cupom || oferta.codigoCupom || oferta.cupomCodigo || "").trim();
  if (!cupom) return false;

  return !/(pagina|p[a\u00e1]gina|api|prov[a\u00e1]vel|indispon[i\u00ed]vel|sem cupom)/i.test(cupom);
}

function prioridadeComercialFilaViva(oferta = {}) {
  const prioridade = limitarNumero(
    oferta.prioridadeEnvio ??
    oferta.prioridadeFila ??
    oferta.prioridade ??
    oferta.inteligenciaUniversalV2?.prioridade ??
    40,
    0,
    100
  );
  const turbo = oferta.turbo === true || oferta.cupomTurbo === true || oferta.turboElegivel === true;
  const cupom = cupomComercialFilaViva(oferta);

  return limitarNumero(prioridade + (cupom ? 18 : 0) + (turbo ? 10 : 0), 0, 100);
}

function scoreComercialFilaViva(oferta = {}) {
  return limitarNumero(
    oferta.radarScore ??
    oferta.score ??
    oferta.scoreFinal ??
    oferta.inteligenciaUniversalV2?.score ??
    0,
    0,
    100
  );
}

function laneFrescorFilaViva(idadeMs, ttlMs = TTL_COMERCIAL_PADRAO_MS) {
  if (!Number.isFinite(idadeMs) || idadeMs < 0) return "agua_nova";
  if (idadeMs >= ttlMs) return "expirada";
  if (idadeMs <= AGUA_NOVA_MS) return "agua_nova";
  if (idadeMs >= FRESCA_EM_RISCO_MS) return "fresca_em_risco";
  return "fresca_circulavel";
}

function calcularScoreFilaViva(oferta = {}, contexto = {}) {
  const agora = Number(contexto.agora || Date.now());
  const ttlMs = Number(contexto.ttlMs || TTL_COMERCIAL_PADRAO_MS);
  const referenciaMs = timestampReferenciaOfertaFilaViva(oferta);
  const idadeMs = referenciaMs > 0 ? Math.max(0, agora - referenciaMs) : ttlMs;
  const lane = laneFrescorFilaViva(idadeMs, ttlMs);

  const destinosCompativeis = Math.max(0, Number(contexto.destinosCompativeis || 0));
  const destinosDisponiveis = Math.max(0, Number(contexto.destinosDisponiveis || 0));
  const compatibilidade = destinosCompativeis > 0
    ? limitarNumero((destinosDisponiveis / destinosCompativeis) * 100, 0, 100)
    : 0;

  const frescor = limitarNumero((1 - idadeMs / ttlMs) * 100, 0, 100);
  const prioridade = prioridadeComercialFilaViva(oferta);
  const score = scoreComercialFilaViva(oferta);
  const penalidadeIdade = idadeMs > ttlMs * 0.55
    ? Math.pow((idadeMs - ttlMs * 0.55) / (ttlMs * 0.45), 2) * 70
    : 0;

  const scoreFinal =
    frescor * 0.48 +
    prioridade * 0.26 +
    score * 0.16 +
    compatibilidade * 0.10 -
    penalidadeIdade;

  return {
    scoreFinal,
    lane,
    idadeMs,
    frescor,
    prioridade,
    score,
    compatibilidade,
    destinosCompativeis,
    destinosDisponiveis,
    cupomComercial: cupomComercialFilaViva(oferta)
  };
}

function ordenarOfertasFilaViva(candidatos = [], contexto = {}) {
  return [...candidatos].sort((a, b) => {
    const rankingA = a.ranking || calcularScoreFilaViva(a.oferta || a, contexto);
    const rankingB = b.ranking || calcularScoreFilaViva(b.oferta || b, contexto);
    if (rankingB.scoreFinal !== rankingA.scoreFinal) return rankingB.scoreFinal - rankingA.scoreFinal;
    if (rankingA.idadeMs !== rankingB.idadeMs) return rankingA.idadeMs - rankingB.idadeMs;
    return String((a.oferta || a).id || "").localeCompare(String((b.oferta || b).id || ""));
  });
}

module.exports = {
  TTL_COMERCIAL_PADRAO_MS,
  AGUA_NOVA_MS,
  FRESCA_EM_RISCO_MS,
  calcularScoreFilaViva,
  cupomComercialFilaViva,
  laneFrescorFilaViva,
  ordenarOfertasFilaViva,
  prioridadeComercialFilaViva,
  scoreComercialFilaViva,
  timestampReferenciaOfertaFilaViva,
  timestampFilaViva
};
