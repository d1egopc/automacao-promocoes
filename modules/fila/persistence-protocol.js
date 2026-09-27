"use strict";

const OP_PREPARE = "checkpoint_prepare";
const OP_PUBLISH = "checkpoint_publish";
const OP_CLEANUP = "checkpoint_cleanup";

const RESPONSE_OK = "persistence_result";
const RESPONSE_ERROR = "persistence_error";

function texto(valor = "") {
  return String(valor == null ? "" : valor).trim();
}

function workspaceSeguro(valor = "admin") {
  const workspace = texto(valor || "admin");
  if (!workspace || !/^[a-zA-Z0-9_.-]+$/.test(workspace) || workspace.includes("..")) {
    throw new Error("workspace_invalido");
  }
  return workspace;
}

function revisionSegura(valor = "") {
  const revision = texto(valor);
  if (!revision || !/^[a-zA-Z0-9_.-]{8,128}$/.test(revision)) {
    throw new Error("checkpoint_revision_invalido");
  }
  return revision;
}

function normalizarDataDir(valor = process.env.DATA_DIR || "/data") {
  const dataDir = texto(valor || "/data");
  if (!dataDir) throw new Error("data_dir_invalido");
  return dataDir;
}

function flagWorkerAtiva(env = process.env) {
  const valor = texto(env?.FILA_PERSISTENCE_WORKER || "").toLowerCase();
  return ["1", "true", "on", "yes"].includes(valor);
}

function timeoutWorkerMs(env = process.env) {
  const valor = Number(env?.FILA_PERSISTENCE_WORKER_TIMEOUT_MS || 120000);
  return Number.isFinite(valor) && valor >= 1000 ? Math.floor(valor) : 120000;
}

function jobId(seq = 0, workspace = "admin", generation = 0) {
  return `fila-persistence-${Number(seq) || 0}-${workspaceSeguro(workspace)}-${Number(generation) || 0}`;
}

function erroSanitizado(erro = {}) {
  return {
    code: texto(erro.code || erro.codigo || erro.name).slice(0, 80),
    name: texto(erro.name).slice(0, 80),
    message: texto(erro.message || erro).replace(/[\r\n]+/g, " ").slice(0, 180)
  };
}

function identityComparable(identity = {}) {
  if (!identity || typeof identity !== "object") return "";
  return ["dev", "ino", "size", "mtimeMs", "ctimeMs", "mtimeNs", "ctimeNs"]
    .map(chave => `${chave}=${identity[chave] ?? ""}`)
    .join("|");
}

function sameIdentity(a = {}, b = {}) {
  return Boolean(a && b && identityComparable(a) === identityComparable(b));
}

module.exports = {
  OP_PREPARE,
  OP_PUBLISH,
  OP_CLEANUP,
  RESPONSE_OK,
  RESPONSE_ERROR,
  workspaceSeguro,
  revisionSegura,
  normalizarDataDir,
  flagWorkerAtiva,
  timeoutWorkerMs,
  jobId,
  erroSanitizado,
  identityComparable,
  sameIdentity
};
