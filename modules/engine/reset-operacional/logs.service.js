"use strict";

const LOGS_RESET = Object.freeze({
  INICIO: "[ENGINE-RESET-INICIO]",
  DRY_RUN: "[ENGINE-RESET-DRY-RUN]",
  SNAPSHOT: "[ENGINE-RESET-SNAPSHOT]",
  LOTE_INICIO: "[ENGINE-RESET-LOTE-INICIO]",
  LOTE_FIM: "[ENGINE-RESET-LOTE-FIM]",
  RETOMADA: "[ENGINE-RESET-RETOMADA]",
  CONCORRENCIA_BLOQUEADA: "[ENGINE-RESET-CONCORRENCIA-BLOQUEADA]",
  ROLLBACK: "[ENGINE-RESET-ROLLBACK]",
  RESUMO: "[ENGINE-RESET-RESUMO]",
  FINALIZADO: "[ENGINE-RESET-FINALIZADO]",
  ERRO: "[ENGINE-RESET-ERRO]"
});

function sanitizarTexto(valor = "") {
  return String(valor || "")
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/token|secret|password|senha|cookie/gi, "[sensivel]")
    .slice(0, 220);
}

function sanitizarPayload(payload = {}) {
  if (!payload || typeof payload !== "object") return {};
  const saida = {};
  for (const [chave, valor] of Object.entries(payload)) {
    if (/token|secret|password|senha|cookie|authorization/i.test(chave)) {
      saida[chave] = "[sensivel]";
      continue;
    }
    if (typeof valor === "string") {
      saida[chave] = sanitizarTexto(valor);
      continue;
    }
    if (Array.isArray(valor)) {
      saida[chave] = valor.slice(0, 20).map(item => typeof item === "string" ? sanitizarTexto(item) : item);
      continue;
    }
    saida[chave] = valor;
  }
  return saida;
}

function logReset(tag, payload = {}) {
  try {
    console.log(tag, JSON.stringify(sanitizarPayload(payload)));
  } catch {
    console.log(tag, sanitizarPayload(payload));
  }
}

function logResetInicio(payload = {}) {
  logReset(LOGS_RESET.INICIO, payload);
}

function logResetDryRun(payload = {}) {
  logReset(LOGS_RESET.DRY_RUN, payload);
}

function logResetSnapshot(payload = {}) {
  logReset(LOGS_RESET.SNAPSHOT, payload);
}

function logResetLoteInicio(payload = {}) {
  logReset(LOGS_RESET.LOTE_INICIO, payload);
}

function logResetLoteFim(payload = {}) {
  logReset(LOGS_RESET.LOTE_FIM, payload);
}

function logResetRetomada(payload = {}) {
  logReset(LOGS_RESET.RETOMADA, payload);
}

function logResetConcorrenciaBloqueada(payload = {}) {
  logReset(LOGS_RESET.CONCORRENCIA_BLOQUEADA, payload);
}

function logResetRollback(payload = {}) {
  logReset(LOGS_RESET.ROLLBACK, payload);
}

function logResetResumo(payload = {}) {
  logReset(LOGS_RESET.RESUMO, payload);
}

function logResetFinalizado(payload = {}) {
  logReset(LOGS_RESET.FINALIZADO, payload);
}

function logResetErro(payload = {}) {
  logReset(LOGS_RESET.ERRO, payload);
}

module.exports = {
  LOGS_RESET,
  logReset,
  logResetInicio,
  logResetDryRun,
  logResetSnapshot,
  logResetLoteInicio,
  logResetLoteFim,
  logResetRetomada,
  logResetConcorrenciaBloqueada,
  logResetRollback,
  logResetResumo,
  logResetFinalizado,
  logResetErro,
  sanitizarPayload
};
