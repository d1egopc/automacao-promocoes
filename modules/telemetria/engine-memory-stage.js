"use strict";

const TAG_ENGINE_MEMORY_STAGE = "[ENGINE-MEMORY-STAGE]";
const NAO_MEDIDO = "nao_medido";

const CAMPOS_SEGUROS = new Set([
  "etapa",
  "etapaOrquestrador",
  "horario",
  "duracaoMs",
  "heapUsedAntes",
  "heapUsedDepois",
  "heapUsedDelta",
  "rssAntes",
  "rssDepois",
  "rssDelta",
  "jobId",
  "ofertaId",
  "eventoId",
  "rodadaId",
  "marketplace",
  "limite",
  "maxCandidatos",
  "ok",
  "motivo",
  "erroEtapa",
  "usarMetadata",
  "metadataSerializada",
  "ofertaUniversalValida",
  "rowsMemoriaV2PorJob",
  "bytesMemoriaHistorica",
  "bytesMetadataFinal",
  "bytesOfertaUniversal",
  "bytesFilaGlobal",
  "filaTotal",
  "filaPendentes",
  "filaEnviados",
  "filaErro",
  "jobsPorEtapa",
  "filaPorStatus",
  "ofcAmostraCirculavelRows",
  "ofcAmostraCirculavelBytes",
  "autoCleanShadowBytesLidos",
  "autoCleanShadowBytesSerializados",
  "autoCleanItensLidos",
  "autoCleanWorkspaces",
  "workspacesVistos",
  "workspacesPulados",
  "workspacesStatOnly",
  "workspacesDeepRead",
  "bytesFilaJsonLidos",
  "duracaoFilaJsonMs",
  "processados",
  "processadas",
  "ofertaCriada",
  "adicionadasFila",
  "retidas",
  "retidasV2",
  "erros",
  "ofertasNovas",
  "candidatosProcessados",
  "destinosCompativeis",
  "destinosTotal",
  "filaOk",
  "duplicada",
  "salvou"
]);

const CAMPOS_OBJETO_SEGURO = new Set([
  "jobsPorEtapa",
  "filaPorStatus"
]);
const SENSIVEL_RE = /(token|cookie|secret|senha|password|bearer|database_url|jid|telefone|phone|whatsapp\.net|@g\.us|https?:\/\/|\+?\d{10,})/i;

function memoriaAtual() {
  const memoria = process.memoryUsage();
  return {
    heapUsed: memoria.heapUsed,
    rss: memoria.rss
  };
}

function limitarStringSegura(valor) {
  const texto = String(valor || "");
  if (SENSIVEL_RE.test(texto)) return "[redacted]";
  if (texto.length > 80) return texto.slice(0, 80);
  return texto;
}

function valorSeguro(chave, valor) {
  if (valor === NAO_MEDIDO) return NAO_MEDIDO;
  if (valor === null || valor === undefined) return valor;
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : null;
  if (typeof valor === "boolean") return valor;
  if (typeof valor === "string") return limitarStringSegura(valor);
  if (CAMPOS_OBJETO_SEGURO.has(chave) && valor && typeof valor === "object" && !Array.isArray(valor)) {
    return Object.entries(valor).reduce((acc, [subChave, subValor]) => {
      if (subValor === null || subValor === undefined) {
        acc[limitarStringSegura(subChave)] = subValor;
      } else if (typeof subValor === "number") {
        acc[limitarStringSegura(subChave)] = Number.isFinite(subValor) ? subValor : null;
      } else if (typeof subValor === "boolean") {
        acc[limitarStringSegura(subChave)] = subValor;
      }
      return acc;
    }, {});
  }
  return undefined;
}

function sanearPayload(extra = {}) {
  const seguro = {};
  for (const [chave, valor] of Object.entries(extra || {})) {
    if (!CAMPOS_SEGUROS.has(chave)) continue;
    const seguroValor = valorSeguro(chave, valor);
    if (seguroValor !== undefined) seguro[chave] = seguroValor;
  }
  return seguro;
}

function logEngineMemoryStage(etapa, antes = memoriaAtual(), depois = memoriaAtual(), extra = {}, opcoes = {}) {
  try {
    const logger = opcoes.logger || console;
    const payload = sanearPayload({
      ...extra,
      etapa: String(etapa || "engine_v2"),
      horario: new Date().toISOString(),
      heapUsedAntes: antes.heapUsed,
      heapUsedDepois: depois.heapUsed,
      heapUsedDelta: depois.heapUsed - antes.heapUsed,
      rssAntes: antes.rss,
      rssDepois: depois.rss,
      rssDelta: depois.rss - antes.rss,
      duracaoMs: Number(extra?.duracaoMs || 0)
    });
    if (typeof logger.log === "function") {
      logger.log(TAG_ENGINE_MEMORY_STAGE, JSON.stringify(payload));
    }
    return payload;
  } catch {
    return null;
  }
}

function criarMedidorEngineMemoryStage(etapa, extraInicio = {}, opcoes = {}) {
  const antes = memoriaAtual();
  const inicioHr = process.hrtime.bigint();
  let finalizado = false;
  return {
    fim(extraFim = {}) {
      if (finalizado) return null;
      finalizado = true;
      const depois = memoriaAtual();
      const duracaoMs = Math.round(Number(process.hrtime.bigint() - inicioHr) / 1e6);
      return logEngineMemoryStage(etapa, antes, depois, {
        ...extraInicio,
        ...extraFim,
        duracaoMs
      }, opcoes);
    }
  };
}

function registrarPontoEngineMemoryStage(etapa, extra = {}, opcoes = {}) {
  const memoria = memoriaAtual();
  return logEngineMemoryStage(etapa, memoria, memoria, { ...extra, duracaoMs: 0 }, opcoes);
}

function medirBytesJsonSeguro(valor, opcoes = {}) {
  try {
    if (valor === null || valor === undefined) return 0;
    if (typeof valor === "string") return Buffer.byteLength(valor, "utf8");
    if (Buffer.isBuffer(valor)) return valor.length;

    const permitirSerializar = opcoes.permitirSerializar === true;
    if (!permitirSerializar) return NAO_MEDIDO;

    if (Array.isArray(valor)) {
      const maxItens = Number(opcoes.maxItens || 300);
      if (valor.length > maxItens) return NAO_MEDIDO;
    } else if (typeof valor === "object") {
      const maxChaves = Number(opcoes.maxChaves || 80);
      if (Object.keys(valor).length > maxChaves) return NAO_MEDIDO;
    }

    return Buffer.byteLength(JSON.stringify(valor), "utf8");
  } catch {
    return NAO_MEDIDO;
  }
}

function resumirFilaPorStatus(fila = []) {
  const itens = Array.isArray(fila) ? fila : [];
  const porStatus = {};
  for (const item of itens) {
    const status = String(item?.status || item?.estado || "pendente").trim().toLowerCase() || "pendente";
    porStatus[status] = (porStatus[status] || 0) + 1;
  }
  return {
    filaTotal: itens.length,
    filaPendentes: Number(porStatus.pendente || porStatus.pendentes || 0),
    filaEnviados: Number(porStatus.enviado || porStatus.enviada || porStatus.enviados || 0),
    filaErro: Number(porStatus.erro || porStatus.falha || 0),
    filaPorStatus: porStatus
  };
}

function resumirJobsPorEtapaEngineMemory(resultado = {}) {
  const dados = resultado?.resultado || resultado || {};
  return {
    processados: Number(dados.processados || dados.processadas || 0),
    diagnosticados: Number(dados.diagnosticados || 0),
    ofertaCriada: Number(dados.ofertaCriada || 0),
    adicionadasFila: Number(dados.adicionadasFila || 0),
    retidas: Number(dados.retidas || dados.retidasV2 || 0),
    erros: Number(dados.erros || 0)
  };
}

module.exports = {
  TAG_ENGINE_MEMORY_STAGE,
  NAO_MEDIDO,
  criarMedidorEngineMemoryStage,
  registrarPontoEngineMemoryStage,
  logEngineMemoryStage,
  medirBytesJsonSeguro,
  resumirFilaPorStatus,
  resumirJobsPorEtapaEngineMemory,
  sanearPayload
};
