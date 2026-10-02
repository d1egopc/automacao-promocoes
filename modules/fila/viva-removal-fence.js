"use strict";

const fs = require("fs");
const path = require("path");
const { normalizarDataDir, workspaceSeguro } = require("./persistence-protocol");
const { digest } = require("./viva-mutation-intent");

const DIRECTORY = "fila-viva-removal-fences";
const HASH = /^[a-f0-9]{64}$/;

function diretorio(dataDir, clienteId) {
  return path.join(normalizarDataDir(dataDir), "clientes", workspaceSeguro(clienteId), DIRECTORY);
}

function caminho(dataDir, clienteId, jobId) {
  return path.join(diretorio(dataDir, clienteId), `${digest(jobId)}.json`);
}

function validar(fence, clienteId) {
  return Boolean(fence && fence.schema === 1 && fence.clienteId === workspaceSeguro(clienteId) &&
    typeof fence.jobId === "string" && fence.jobId.length > 0 && fence.jobId.length <= 160 &&
    Number.isSafeInteger(fence.generation) && fence.generation > 0 &&
    ["remove", "terminal"].includes(fence.operation) &&
    Array.isArray(fence.identityHashes) && fence.identityHashes.length > 0 &&
    fence.identityHashes.every(value => typeof value === "string" && HASH.test(value)) &&
    typeof fence.createdAt === "string" && !Number.isNaN(Date.parse(fence.createdAt)));
}

function listar(dataDir, clienteId) {
  const dir = diretorio(dataDir, clienteId);
  let names;
  try { names = fs.readdirSync(dir); } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  return names.filter(name => name.endsWith(".json")).map(name => {
    if (!HASH.test(name.slice(0, -5))) throw new Error("removal_fence_filename_invalid");
    let fence;
    try { fence = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")); }
    catch { throw new Error("removal_fence_corrupt"); }
    if (!validar(fence, clienteId) || `${digest(fence.jobId)}.json` !== name) {
      throw new Error("removal_fence_invalid");
    }
    return fence;
  });
}

function escrever(dataDir, clienteId, fence) {
  if (!validar(fence, clienteId)) throw new Error("removal_fence_invalid");
  const file = caminho(dataDir, clienteId, fence.jobId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) {
    const anterior = listar(dataDir, clienteId).find(value => value.jobId === fence.jobId);
    if (anterior && anterior.generation === fence.generation && anterior.operation === fence.operation &&
        JSON.stringify(anterior.identityHashes) === JSON.stringify(fence.identityHashes)) return false;
    throw new Error("removal_fence_job_conflict");
  }
  const tmp = `${file}.tmp.${process.pid}`;
  const fd = fs.openSync(tmp, "w");
  try { fs.writeFileSync(fd, JSON.stringify(fence)); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
  if (process.platform !== "win32") {
    const dirFd = fs.openSync(path.dirname(file), "r");
    try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
  }
  return true;
}

function garantirDoIntent(dataDir, clienteId, intent) {
  if (intent.removalOperation === null) return false;
  if (!["remove", "terminal"].includes(intent.removalOperation) ||
      !Array.isArray(intent.removedIdentityHashes) || !intent.removedIdentityHashes.length) {
    throw new Error("removal_fence_intent_invalid");
  }
  return escrever(dataDir, clienteId, {
    schema: 1, clienteId: workspaceSeguro(clienteId), jobId: intent.jobId,
    generation: intent.targetGeneration,
    operation: intent.removalOperation,
    identityHashes: intent.removedIdentityHashes,
    createdAt: new Date().toISOString()
  });
}

function limparAte(dataDir, clienteId, generation) {
  if (!Number.isSafeInteger(generation) || generation < 0) throw new Error("removal_fence_checkpoint_invalid");
  let removed = 0;
  for (const fence of listar(dataDir, clienteId)) {
    if (fence.generation > generation) continue;
    fs.unlinkSync(caminho(dataDir, clienteId, fence.jobId));
    removed += 1;
  }
  return removed;
}

module.exports = { DIRECTORY, caminho, listar, escrever, garantirDoIntent, limparAte };
