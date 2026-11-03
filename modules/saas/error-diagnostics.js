"use strict";

const { randomUUID } = require("node:crypto");

const REQUEST_ID_VALIDO = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CAMPO_SEGURO = /^[a-z0-9_.:-]{1,80}$/i;
const CODIGO_APP_SEGURO = /^[a-z][a-z0-9]*(?:_[a-z0-9]+){1,8}$/i;
const CODIGO_POSTGRES = /^[0-9A-Z]{5}$/i;
const CODIGO_NODE = /^E[A-Z0-9_]{2,31}$/;

function obterRequestIdSaas(req = {}) {
  const recebido = String(req.requestId || req.get?.("x-request-id") || "").trim();
  const requestId = REQUEST_ID_VALIDO.test(recebido) ? recebido : randomUUID();
  req.requestId = requestId;
  return requestId;
}

function diagnosticoErroSaas({ req, etapa, erro, codigoFallback = "internal_error" } = {}) {
  const requestId = obterRequestIdSaas(req);
  const codigoAplicacao = String(erro?.codigo || "");
  const codigoInfra = String(erro?.code || "");
  const fallbackSeguro = CAMPO_SEGURO.test(String(codigoFallback || ""))
    ? String(codigoFallback)
    : "internal_error";
  const codigoCandidato = CODIGO_APP_SEGURO.test(codigoAplicacao)
    ? codigoAplicacao
    : CODIGO_POSTGRES.test(codigoInfra) || CODIGO_NODE.test(codigoInfra)
      ? codigoInfra
      : fallbackSeguro;
  const classeCandidata = String(erro?.constructor?.name || "Error");
  return {
    requestId,
    etapa: CAMPO_SEGURO.test(String(etapa || "")) ? String(etapa) : "unknown",
    codigo: codigoCandidato,
    classeExcecao: /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(classeCandidata)
      ? classeCandidata
      : "Error"
  };
}

function registrarErroSaas({ req, etapa, erro, codigoFallback, logger = console } = {}) {
  const diagnostico = diagnosticoErroSaas({ req, etapa, erro, codigoFallback });
  logger.error("[SAAS-ERROR]", JSON.stringify(diagnostico));
  return diagnostico;
}

module.exports = {
  obterRequestIdSaas,
  diagnosticoErroSaas,
  registrarErroSaas
};
