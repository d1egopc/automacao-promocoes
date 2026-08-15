const {
  readClienteJson,
  writeClienteJson,
  normalizarClienteId
} = require("../../utils/storage");
const {
  ARQUIVO_OFERTAS_MANUAL_V2
} = require("./manual-offers.storage");

const RETENCAO_DIAS_PADRAO = 7;
const RETENCAO_DIAS_MINIMO = 1;
const RETENCAO_DIAS_MAXIMO = 3650;
const MS_DIA = 24 * 60 * 60 * 1000;

function texto(valor = "") {
  return String(valor ?? "").trim();
}

function statusOferta(oferta = {}) {
  return texto(oferta.status).toLowerCase();
}

function lista(valor) {
  return Array.isArray(valor) ? valor : [];
}

function timestampMs(valor = "") {
  const ms = Date.parse(texto(valor));
  return Number.isFinite(ms) ? ms : null;
}

function resolverRetencaoDiasManualV2(valor = process.env.MANUAL_V2_RETENTION_DAYS) {
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return RETENCAO_DIAS_PADRAO;
  const inteiro = Math.floor(numero);
  if (inteiro < RETENCAO_DIAS_MINIMO) return RETENCAO_DIAS_PADRAO;
  if (inteiro > RETENCAO_DIAS_MAXIMO) return RETENCAO_DIAS_PADRAO;
  return inteiro;
}

function agoraMsManualV2(opcoes = {}) {
  const valor = typeof opcoes.now === "function" ? opcoes.now() : opcoes.now;
  const ms = timestampMs(valor || new Date().toISOString());
  return ms ?? Date.now();
}

function timestampReferenciaRetencaoManualV2(oferta = {}) {
  const status = statusOferta(oferta);
  const envioManual = oferta.envioManual && typeof oferta.envioManual === "object"
    ? oferta.envioManual
    : {};

  if (status === "enviada") {
    return timestampMs(oferta.enviadoEm) ??
      timestampMs(envioManual.concluidoEm) ??
      timestampMs(oferta.atualizadoEm);
  }

  if (status === "erro") {
    return timestampMs(envioManual.concluidoEm) ??
      timestampMs(oferta.agendamentoAtualizadoEm) ??
      timestampMs(oferta.atualizadoEm);
  }

  return null;
}

function ofertaElegivelRetencaoManualV2(oferta = {}, opcoes = {}) {
  const status = statusOferta(oferta);
  if (status !== "enviada" && status !== "erro") {
    return {
      elegivel: false,
      motivo: "status_preservado",
      status
    };
  }

  const referenciaMs = timestampReferenciaRetencaoManualV2(oferta);
  if (!Number.isFinite(referenciaMs)) {
    return {
      elegivel: false,
      motivo: "timestamp_invalido",
      status
    };
  }

  const nowMs = agoraMsManualV2(opcoes);
  if (!Number.isFinite(nowMs) || referenciaMs > nowMs) {
    return {
      elegivel: false,
      motivo: "timestamp_inconclusivo",
      status
    };
  }

  const dias = resolverRetencaoDiasManualV2(opcoes.retentionDays ?? opcoes.retencaoDias);
  const idadeMs = nowMs - referenciaMs;
  return {
    elegivel: idadeMs >= dias * MS_DIA,
    motivo: idadeMs >= dias * MS_DIA ? "retencao_expirada" : "retencao_recente",
    status,
    idadeMs,
    retencaoDias: dias
  };
}

function depsRetencao(deps = {}) {
  return {
    readClienteJson: deps.readClienteJson || readClienteJson,
    writeClienteJson: deps.writeClienteJson || writeClienteJson,
    normalizarClienteId: deps.normalizarClienteId || normalizarClienteId
  };
}

function limparRetencaoManualV2Cliente(clienteId = "admin", opcoes = {}, deps = {}) {
  const storage = depsRetencao(deps);
  const id = storage.normalizarClienteId(clienteId || "admin");
  const dados = storage.readClienteJson(id, ARQUIVO_OFERTAS_MANUAL_V2, []);
  const ofertas = lista(dados).filter((oferta) =>
    oferta &&
    typeof oferta === "object" &&
    String(oferta.clienteId || "") === String(id)
  );

  const porStatus = {};
  const preservadas = [];
  const removidas = [];

  for (const oferta of ofertas) {
    const decisao = ofertaElegivelRetencaoManualV2(oferta, opcoes);
    if (decisao.elegivel) {
      removidas.push(oferta);
      const status = decisao.status || statusOferta(oferta) || "desconhecido";
      porStatus[status] = (porStatus[status] || 0) + 1;
    } else {
      preservadas.push(oferta);
    }
  }

  if (removidas.length > 0) {
    storage.writeClienteJson(id, ARQUIVO_OFERTAS_MANUAL_V2, preservadas);
  }

  return {
    ok: true,
    clienteId: id,
    removidos: removidas.length,
    preservados: preservadas.length,
    porStatus
  };
}

module.exports = {
  RETENCAO_DIAS_PADRAO,
  resolverRetencaoDiasManualV2,
  timestampReferenciaRetencaoManualV2,
  ofertaElegivelRetencaoManualV2,
  limparRetencaoManualV2Cliente
};
