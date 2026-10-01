"use strict";

const { AsyncLocalStorage } = require("async_hooks");

const TAG_VIVA_PROOF_TELEMETRIA = "[FILA-V2-VIVA-PROOF]";
const FLAG_EXECUTOR_GENERATION_AUTHORITY = "FILA_V2_EXECUTOR_GENERATION_AUTHORITY";
const FLAG_EXECUTOR_GENERATION_CANARY_CLIENTES = "FILA_V2_EXECUTOR_GENERATION_CANARY_CLIENTES";
const contextoAsync = new AsyncLocalStorage();
const ultimaPublicacaoPorProcessoWorkspace = new Map();
let sequenciaLocal = 0;

function texto(valor = "") {
  return String(valor || "").trim();
}

function clienteSeguro(clienteId = "admin") {
  return texto(clienteId || "admin") || "admin";
}

function canarioAtivo(clienteId = "admin", env = process.env) {
  if (String(env?.[FLAG_EXECUTOR_GENERATION_AUTHORITY] || "0").trim() !== "1") return false;
  const cliente = clienteSeguro(clienteId);
  return String(env?.[FLAG_EXECUTOR_GENERATION_CANARY_CLIENTES] || "")
    .split(/[\s,;|]+/)
    .map(valor => valor.trim())
    .filter(Boolean)
    .includes(cliente);
}

function origemReal(valor = "", padrao = "normal_mutation") {
  const origem = texto(valor).toLowerCase();
  if (["normal_mutation", "terminal_transition", "recovery", "shadow", "checkpoint"].includes(origem)) {
    return origem;
  }
  if (/recovery|recuper/.test(origem)) return "recovery";
  if (/shadow/.test(origem)) return "shadow";
  if (/terminal|historico/.test(origem)) return "terminal_transition";
  return padrao;
}

function novoIdLocal(clienteId = "admin") {
  sequenciaLocal += 1;
  return `viva-proof-${process.pid}-${Date.now()}-${sequenciaLocal}-${clienteSeguro(clienteId)}`;
}

function criarContexto(clienteId = "admin", deps = {}, opcoes = {}) {
  const env = deps?.env || process.env;
  const cliente = clienteSeguro(clienteId);
  if (!canarioAtivo(cliente, env)) return null;
  const idExistente = texto(
    opcoes.mutationId ||
    opcoes.transactionId ||
    opcoes.correlationId ||
    deps.mutationId ||
    deps.transactionId ||
    deps.correlationId
  );
  const id = idExistente || novoIdLocal(cliente);
  return {
    clienteId: cliente,
    pid: process.pid,
    mutationId: id,
    transactionId: id,
    correlationId: id,
    caller: origemReal(opcoes.caller || opcoes.origem || deps.caller || deps.origem || opcoes.motivo || deps.motivo),
    logger: deps.logger || null,
    env
  };
}

function chaveContexto(clienteId = "admin") {
  return `${process.pid}:${clienteSeguro(clienteId)}`;
}

function obterContextoAtivo(clienteId = "admin") {
  const contextoAsyncAtual = contextoAsync.getStore();
  if (contextoAsyncAtual && contextoAsyncAtual.clienteId === clienteSeguro(clienteId)) {
    return contextoAsyncAtual;
  }
  return null;
}

function obterOuCriarContexto(clienteId = "admin", deps = {}, opcoes = {}) {
  const contextoExplicito = deps?.vivaProofTelemetry;
  if (contextoExplicito && contextoExplicito.clienteId === clienteSeguro(clienteId)) {
    return contextoExplicito;
  }
  return obterContextoAtivo(clienteId) || criarContexto(clienteId, deps, opcoes);
}

function executarComContexto(contexto, callback) {
  if (!contexto || typeof callback !== "function") return callback();
  return contextoAsync.run(contexto, callback);
}

function numero(valor) {
  const resultado = Number(valor);
  return Number.isFinite(resultado) ? resultado : null;
}

function erroSeguro(erro) {
  if (!erro) return null;
  return {
    name: texto(erro.name || "Error").slice(0, 80),
    code: texto(erro.code || erro.codigo).slice(0, 80),
    message: texto(erro.message || "erro").replace(/[\r\n]+/g, " ").slice(0, 160)
  };
}

function agoraMonotonicNs() {
  try {
    return typeof process.hrtime?.bigint === "function"
      ? process.hrtime.bigint().toString()
      : null;
  } catch {
    return null;
  }
}

function provaPayload(contexto, etapa, valores = {}) {
  const proof = valores.proof && typeof valores.proof === "object" ? valores.proof : {};
  const generation = valores.generation ?? valores.targetGeneration ?? null;
  const fileRevision = valores.fileRevision ?? null;
  return {
    versao: 1,
    evento: valores.evento || "viva_proof_writer_telemetry",
    etapa,
    clienteId: contexto.clienteId,
    workspace: contexto.clienteId,
    pid: contexto.pid,
    mutationId: contexto.mutationId,
    transactionId: contexto.transactionId,
    correlationId: contexto.correlationId,
    caller: origemReal(valores.caller || contexto.caller),
    generation: numero(generation),
    generationPretendida: numero(generation),
    fileRevision: texto(fileRevision) || null,
    vivaFileProofGeneration: numero(valores.vivaFileProofGeneration ?? proof.generation),
    vivaFileProofRevision: texto(valores.vivaFileProofRevision ?? proof.fileRevision) || null,
    timestampUtc: new Date().toISOString(),
    monotonicNs: agoraMonotonicNs(),
    sucesso: valores.sucesso !== false,
    ...(valores.detalhes && typeof valores.detalhes === "object"
      ? { diagnostico: valores.detalhes }
      : {}),
    ...(valores.error ? { erro: erroSeguro(valores.error) } : {})
  };
}

function emitir(contexto, etapa, valores = {}, deps = {}) {
  if (!contexto) return null;
  const payload = provaPayload(contexto, etapa, valores);
  try {
    const logger = deps?.logger && typeof deps.logger.log === "function"
      ? deps.logger
      : contexto.logger && typeof contexto.logger.log === "function"
        ? contexto.logger
        : console;
    logger.log(TAG_VIVA_PROOF_TELEMETRIA, JSON.stringify(payload));
  } catch {}
  return payload;
}

function registrarPublicacao(contexto, proof, deps = {}) {
  if (!contexto) return;
  const generation = numero(proof?.generation ?? proof?.targetGeneration);
  if (generation === null) return;
  const chave = chaveContexto(contexto.clienteId);
  const anterior = ultimaPublicacaoPorProcessoWorkspace.get(chave);
  if (anterior && generation < anterior.generation) {
    emitir(contexto, "proof_publish_regression_attempt", {
      evento: "viva_proof_generation_regression_attempt",
      generation,
      fileRevision: proof?.fileRevision,
      vivaFileProofGeneration: anterior.generation,
      vivaFileProofRevision: anterior.fileRevision,
      caller: contexto.caller,
      sucesso: false,
      detalhes: {
        previousGeneration: anterior.generation,
        previousFileRevision: anterior.fileRevision
      }
    }, deps);
  }
  if (!anterior || generation > anterior.generation) {
    ultimaPublicacaoPorProcessoWorkspace.set(chave, {
      generation,
      fileRevision: texto(proof?.fileRevision) || null
    });
  }
}

function resetarParaTeste() {
  ultimaPublicacaoPorProcessoWorkspace.clear();
  sequenciaLocal = 0;
}

module.exports = {
  TAG_VIVA_PROOF_TELEMETRIA,
  FLAG_EXECUTOR_GENERATION_AUTHORITY,
  FLAG_EXECUTOR_GENERATION_CANARY_CLIENTES,
  canarioAtivo,
  criarContexto,
  obterContextoAtivo,
  obterOuCriarContexto,
  executarComContexto,
  monotonicNs: agoraMonotonicNs,
  emit: emitir,
  emitir,
  registrarPublicacao,
  resetarParaTeste
};
