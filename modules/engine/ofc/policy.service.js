const TEMPERATURA_OPERACIONAL = {
  HOT: "HOT",
  WARM: "WARM",
  COLD: "COLD"
};

const ESTADO_OPERACIONAL = {
  ATIVA: "ATIVA",
  RESERVA: "RESERVA",
  EXPIRADA: "EXPIRADA"
};

const TTL_OPERACIONAL_MS = {
  CUPOM: 4 * 60 * 60 * 1000,
  CASHBACK: 6 * 60 * 60 * 1000,
  RADAR: 4 * 60 * 60 * 1000,
  COMUM: 12 * 60 * 60 * 1000
};

const JANELA_AGUA_NOVA_MS = 30 * 60 * 1000;

function objetoSeguro(valor) {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) return {};
  return valor;
}

function texto(valor) {
  return String(valor || "").trim();
}

function normalizar(valor) {
  return texto(valor).toLowerCase();
}

function dataMs(valor, agoraMs = Date.now()) {
  const ms = new Date(valor || 0).getTime();
  return Number.isFinite(ms) && ms > 0 ? ms : agoraMs;
}

function idadeOperacionalMs(job = {}, agoraMs = Date.now()) {
  return Math.max(0, agoraMs - dataMs(job.criado_em || job.criadoEm, agoraMs));
}

function containersMetadata(job = {}) {
  const metadata = objetoSeguro(job.metadata);
  const metadataEvento = objetoSeguro(metadata.metadataEvento);
  const contratoComercial = objetoSeguro(metadata.contratoComercial || metadataEvento.contratoComercial);
  const radarMirror = objetoSeguro(metadata.radarMirror || metadataEvento.radarMirror);
  return [metadata, metadataEvento, contratoComercial, radarMirror];
}

function possuiValorComercialPreservado(containers = [], campos = []) {
  for (const container of containers) {
    for (const campo of campos) {
      const valor = container?.[campo];
      if (Array.isArray(valor) && valor.length > 0) return true;
      if (texto(valor)) return true;
    }
  }
  return false;
}

function detectarSinaisOperacionais(job = {}) {
  const containers = containersMetadata(job);
  const origem = containers.map(item => [
    item.origem,
    item.fonte,
    item.origemTipo,
    item.tipoOrigem
  ].map(normalizar).join(" ")).join(" ");

  const origemRadar = Boolean(
    /radar|whatsapp|telegram/.test(origem) ||
    containers.some(item => item.radarMirror || item.espelhoComercial || item.fonteComercial === "radar")
  );
  const cupom = possuiValorComercialPreservado(containers, [
    "cupom",
    "codigoCupom",
    "codigosCupom",
    "cupons",
    "cupomTexto",
    "instrucaoCupom"
  ]);
  const cashback = possuiValorComercialPreservado(containers, [
    "cashback",
    "cashbackValor",
    "cashbackPercentual"
  ]);
  const quedaPreco = containers.some(item => item.quedaPreco === true || item.precoMenor === true);

  return {
    origemRadar,
    cupom,
    cashback,
    quedaPreco
  };
}

function tipoOperacional(sinais = {}) {
  if (sinais.cashback) return "cashback";
  if (sinais.cupom) return "cupom";
  if (sinais.origemRadar) return "radar";
  return "comum";
}

function ttlOperacionalSugeridoMs(sinais = {}) {
  const tipo = tipoOperacional(sinais);
  if (tipo === "cashback") return TTL_OPERACIONAL_MS.CASHBACK;
  if (tipo === "cupom") return TTL_OPERACIONAL_MS.CUPOM;
  if (tipo === "radar") return TTL_OPERACIONAL_MS.RADAR;
  return TTL_OPERACIONAL_MS.COMUM;
}

function temperaturaOperacionalSugerida({ idadeMs = 0, ttlMs = TTL_OPERACIONAL_MS.COMUM, sinais = {} } = {}) {
  if (idadeMs >= ttlMs) return TEMPERATURA_OPERACIONAL.COLD;
  if (sinais.origemRadar && idadeMs <= JANELA_AGUA_NOVA_MS) return TEMPERATURA_OPERACIONAL.HOT;
  if ((sinais.cupom || sinais.cashback || sinais.quedaPreco) && idadeMs <= ttlMs * 0.5) {
    return TEMPERATURA_OPERACIONAL.HOT;
  }
  if (idadeMs <= ttlMs * 0.7) return TEMPERATURA_OPERACIONAL.WARM;
  return TEMPERATURA_OPERACIONAL.COLD;
}

function avaliarOportunidadeOperacional(job = {}, contexto = {}) {
  const agoraMs = Number(contexto.agoraMs || Date.now());
  const selecionada = Boolean(contexto.selecionada);
  const sinais = detectarSinaisOperacionais(job);
  const idadeMs = idadeOperacionalMs(job, agoraMs);
  const ttlMs = ttlOperacionalSugeridoMs(sinais);
  const temperatura = temperaturaOperacionalSugerida({ idadeMs, ttlMs, sinais });
  const candidataExpiracao = idadeMs >= ttlMs;
  const estado = candidataExpiracao
    ? ESTADO_OPERACIONAL.EXPIRADA
    : selecionada
      ? ESTADO_OPERACIONAL.ATIVA
      : ESTADO_OPERACIONAL.RESERVA;

  return {
    id: job.id,
    estado,
    temperatura,
    ttlMs,
    idadeMs,
    tipoOperacional: tipoOperacional(sinais),
    candidataExpiracao,
    motivoExpiracao: candidataExpiracao ? "ttl_operacional_excedido_shadow" : "",
    aguaNova: sinais.origemRadar && idadeMs <= JANELA_AGUA_NOVA_MS,
    sinais
  };
}

module.exports = {
  TEMPERATURA_OPERACIONAL,
  ESTADO_OPERACIONAL,
  TTL_OPERACIONAL_MS,
  JANELA_AGUA_NOVA_MS,
  detectarSinaisOperacionais,
  ttlOperacionalSugeridoMs,
  temperaturaOperacionalSugerida,
  avaliarOportunidadeOperacional
};
