"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { normalizarDataDir, workspaceSeguro } = require("./persistence-protocol");

const NAME = "fila-viva.mutation-intent.json";
const HASH = /^[a-f0-9]{64}$/;

function caminho(dataDir, clienteId) {
  const root = path.resolve(normalizarDataDir(dataDir), "clientes");
  const file = path.resolve(root, workspaceSeguro(clienteId), NAME);
  if (!file.startsWith(`${root}${path.sep}`)) throw new Error("intent_path_invalido");
  return file;
}

function digest(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function validar(intent, clienteId) {
  return Boolean(intent && intent.schema === 1 && intent.clienteId === workspaceSeguro(clienteId) &&
    typeof intent.jobId === "string" && intent.jobId.length > 0 && intent.jobId.length <= 160 &&
    Number.isSafeInteger(intent.expectedGeneration) && intent.expectedGeneration >= 0 &&
    intent.targetGeneration === intent.expectedGeneration + 1 &&
    ["insert", "update", "remove"].includes(intent.mutationType) &&
    HASH.test(intent.targetHash) && (intent.previousHash === null || HASH.test(intent.previousHash)) &&
    typeof intent.fileRevision === "string" && intent.fileRevision.length > 0 && intent.fileRevision.length <= 160 &&
    Number.isSafeInteger(intent.itemCount) && intent.itemCount >= 0 &&
    typeof intent.checkpointSincronizado === "boolean" &&
    typeof intent.inputHash === "string" && HASH.test(intent.inputHash) &&
    (intent.removalOperation === null || intent.removalOperation === "remove" ||
      intent.removalOperation === "terminal") &&
    (intent.mutationType !== "remove" || intent.removalOperation === "remove") &&
    (intent.removalOperation !== "terminal" || intent.mutationType === "update") &&
    Array.isArray(intent.removedIdentityHashes) &&
    intent.removedIdentityHashes.every(value => typeof value === "string" && HASH.test(value)) &&
    (intent.removalOperation === null
      ? intent.removedIdentityHashes.length === 0
      : intent.removedIdentityHashes.length > 0));
}

function ler(dataDir, clienteId) {
  const file = caminho(dataDir, clienteId);
  let bytes;
  try {
    bytes = fs.readFileSync(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return { ok: true, exists: false };
    return { ok: false, motivo: "intent_read_error" };
  }
  try {
    const intent = JSON.parse(bytes);
    return validar(intent, clienteId)
      ? { ok: true, exists: true, intent }
      : { ok: false, exists: true, motivo: "intent_invalid" };
  } catch {
    return { ok: false, exists: true, motivo: "intent_corrupt" };
  }
}

function escrever(dataDir, clienteId, intent) {
  if (!validar(intent, clienteId)) throw new Error("intent_invalid");
  const file = caminho(dataDir, clienteId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  const fd = fs.openSync(tmp, "w");
  try {
    fs.writeFileSync(fd, JSON.stringify(intent));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
  if (process.platform !== "win32") {
    const dirFd = fs.openSync(path.dirname(file), "r");
    try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
  }
}

function limpar(dataDir, clienteId, jobId) {
  const atual = ler(dataDir, clienteId);
  if (!atual.ok || !atual.exists || atual.intent.jobId !== jobId) return false;
  fs.unlinkSync(caminho(dataDir, clienteId));
  return true;
}

function hashArquivo(file) {
  let fd;
  try {
    fd = fs.openSync(file, "r");
    const hash = crypto.createHash("sha256");
    const chunk = Buffer.allocUnsafe(1024 * 1024);
    let bytes;
    while ((bytes = fs.readSync(fd, chunk, 0, chunk.length, null)) > 0) {
      hash.update(chunk.subarray(0, bytes));
    }
    return hash.digest("hex");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

module.exports = { NAME, caminho, digest, ler, escrever, limpar, hashArquivo };
