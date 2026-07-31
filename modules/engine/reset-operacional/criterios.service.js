"use strict";

const crypto = require("crypto");

const GRUPOS_RESET = Object.freeze({
  PRESERVAR: "PRESERVAR_INTACTOS",
  EXPIRAR: "EXPIRAR_OPERACIONALMENTE",
  ARQUIVAR: "ARQUIVAR_FORA_DA_TABELA_OPERACIONAL",
  NAO_CLASSIFICADO: "NAO_CLASSIFICADOS"
});

const STATUS_PRESERVAR = Object.freeze(["processando", "importando", "oferta_criada"]);
const STATUS_EXPIRAR = Object.freeze(["pendente", "pronto_para_importar"]);
const STATUS_ARQUIVAR = Object.freeze([
  "erro",
  "erro_importacao",
  "ignorado",
  "cancelado",
  "retida_v2",
  "integracao_ausente"
]);

const MOTIVO_RESET_FLUXO_VIVO = "fluxo_vivo_cutoff_30min";
const STATUS_EXPIRADO_OPERACIONAL = "expirada_operacional";
const DEFAULT_LOTE_TAMANHO = 1000;

function normalizarStatus(status = "") {
  return String(status || "").trim().toLowerCase();
}

function dataValida(valor) {
  const data = valor instanceof Date ? valor : new Date(valor);
  return Number.isFinite(data.getTime()) ? data : null;
}

function criadoAposOuNoCutoff(job = {}, cutoffCongelado) {
  const criadoEm = dataValida(job.criado_em || job.criadoEm);
  const cutoff = dataValida(cutoffCongelado);
  if (!criadoEm || !cutoff) return false;
  return criadoEm.getTime() >= cutoff.getTime();
}

function classificarJobReset(job = {}, cutoffCongelado) {
  const status = normalizarStatus(job.status);

  if (STATUS_PRESERVAR.includes(status)) {
    return {
      grupoAcao: GRUPOS_RESET.PRESERVAR,
      acao: "preservar",
      motivo: "status_protegido"
    };
  }

  if (criadoAposOuNoCutoff(job, cutoffCongelado)) {
    return {
      grupoAcao: GRUPOS_RESET.PRESERVAR,
      acao: "preservar",
      motivo: "job_posterior_ao_cutoff"
    };
  }

  if (STATUS_EXPIRAR.includes(status)) {
    return {
      grupoAcao: GRUPOS_RESET.EXPIRAR,
      acao: "expirar_operacionalmente",
      statusFinal: STATUS_EXPIRADO_OPERACIONAL,
      motivo: MOTIVO_RESET_FLUXO_VIVO
    };
  }

  if (STATUS_ARQUIVAR.includes(status)) {
    return {
      grupoAcao: GRUPOS_RESET.ARQUIVAR,
      acao: "arquivar_fora_operacional",
      motivo: MOTIVO_RESET_FLUXO_VIVO
    };
  }

  return {
    grupoAcao: GRUPOS_RESET.NAO_CLASSIFICADO,
    acao: "bloquear",
    motivo: "status_ou_data_nao_previsto"
  };
}

function matrizStatusAcao() {
  const pares = [];
  for (const status of STATUS_PRESERVAR) pares.push({ status, grupoAcao: GRUPOS_RESET.PRESERVAR, acao: "preservar" });
  for (const status of STATUS_EXPIRAR) pares.push({ status, grupoAcao: GRUPOS_RESET.EXPIRAR, acao: "expirar_operacionalmente" });
  for (const status of STATUS_ARQUIVAR) pares.push({ status, grupoAcao: GRUPOS_RESET.ARQUIVAR, acao: "arquivar_fora_operacional" });
  return pares;
}

function criterioResetFluxoVivo({ cutoffCongelado, loteTamanho = DEFAULT_LOTE_TAMANHO } = {}) {
  const cutoff = dataValida(cutoffCongelado);
  const payload = {
    versao: "fluxo_vivo_v1",
    cutoffCongelado: cutoff ? cutoff.toISOString() : "",
    loteTamanho: Number(loteTamanho) || DEFAULT_LOTE_TAMANHO,
    preservar: STATUS_PRESERVAR,
    expirar: STATUS_EXPIRAR,
    arquivar: STATUS_ARQUIVAR,
    statusExpiradoOperacional: STATUS_EXPIRADO_OPERACIONAL,
    motivo: MOTIVO_RESET_FLUXO_VIVO
  };
  return {
    ...payload,
    criterioHash: crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex")
  };
}

function hashIds(ids = []) {
  const normalizados = [...ids]
    .map(id => Number(id))
    .filter(id => Number.isFinite(id))
    .sort((a, b) => a - b)
    .join(",");
  return crypto.createHash("md5").update(normalizados).digest("hex");
}

function validarSemNaoClassificados(resumo = {}) {
  const total = Number(resumo?.naoClassificados || resumo?.NAO_CLASSIFICADOS || 0);
  if (total > 0) {
    const erro = new Error("reset_operacional_status_nao_classificado");
    erro.codigo = "status_nao_classificado";
    erro.total = total;
    throw erro;
  }
  return true;
}

module.exports = {
  GRUPOS_RESET,
  STATUS_PRESERVAR,
  STATUS_EXPIRAR,
  STATUS_ARQUIVAR,
  MOTIVO_RESET_FLUXO_VIVO,
  STATUS_EXPIRADO_OPERACIONAL,
  DEFAULT_LOTE_TAMANHO,
  classificarJobReset,
  criterioResetFluxoVivo,
  criadoAposOuNoCutoff,
  hashIds,
  matrizStatusAcao,
  normalizarStatus,
  validarSemNaoClassificados
};
