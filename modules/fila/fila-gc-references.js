"use strict";

const fs = require("fs");
const crypto = require("crypto");
const { hashRenderEmValor } = require("../engine/auto-clean/gc-reference-index");

const FILA_GC_REFERENCES_ARQUIVO = "fila-gc-references.json";
const FILA_GC_REFERENCES_VERSION = 1;

function identidadeArquivo(stat = {}) {
  const dev = stat.dev;
  const ino = stat.ino;
  const devValido = typeof dev === "bigint" ? dev >= 0n : Number.isFinite(Number(dev)) && Number(dev) >= 0;
  const inoValido = typeof ino === "bigint" ? ino > 0n : Number.isFinite(Number(ino)) && Number(ino) > 0;
  return devValido && inoValido ? `${dev}:${ino}` : "";
}

function coberturaArquivo(stat = {}) {
  return {
    size: Number(stat.size),
    mtimeMs: Math.trunc(Number(stat.mtimeMs)),
    identity: identidadeArquivo(stat)
  };
}

function hashesFilaViva(entradas = [], workspaceId = "") {
  const hashes = new Set();
  let nodes = 0;
  function visitar(valor, profundidade) {
    if (profundidade > 32 || ++nodes > 300000) {
      throw new Error("FILA_GC_REFERENCES_COMPLEXITY_LIMIT");
    }
    if (typeof valor === "string") {
      for (const hash of hashRenderEmValor(valor, workspaceId)) hashes.add(hash);
    } else if (Array.isArray(valor)) {
      for (const item of valor) visitar(item, profundidade + 1);
    } else if (valor && typeof valor === "object") {
      for (const item of Object.values(valor)) visitar(item, profundidade + 1);
    }
  }
  visitar(entradas, 0);
  return [...hashes].sort();
}

function checksumProjecao(documento = {}) {
  return crypto.createHash("sha256").update(JSON.stringify({
    versao: documento.versao,
    clienteId: documento.clienteId,
    filaViva: documento.filaViva,
    totalItens: documento.totalItens,
    totalRefs: documento.totalRefs,
    hashes: documento.hashes
  })).digest("hex");
}

function projetarReferenciasFilaViva(entradas, workspaceId, stat) {
  if (!Array.isArray(entradas) || !/^[a-zA-Z0-9_-]+$/.test(String(workspaceId || ""))) {
    throw new Error("FILA_GC_REFERENCES_INPUT_INVALID");
  }
  const coverage = coberturaArquivo(stat);
  if (!Number.isSafeInteger(coverage.size) || coverage.size < 0 ||
      !Number.isSafeInteger(coverage.mtimeMs) || coverage.mtimeMs <= 0) {
    throw new Error("FILA_GC_REFERENCES_GUARD_INVALID");
  }
  const hashes = hashesFilaViva(entradas, workspaceId);
  const documento = {
    versao: FILA_GC_REFERENCES_VERSION,
    clienteId: workspaceId,
    filaViva: coverage,
    totalItens: entradas.length,
    totalRefs: hashes.length,
    hashes
  };
  return { ...documento, checksum: checksumProjecao(documento) };
}

function projecaoCobreFilaViva(projecao, workspaceId, guard) {
  if (!projecao || projecao.versao !== FILA_GC_REFERENCES_VERSION ||
      projecao.clienteId !== workspaceId || !Array.isArray(projecao.hashes) ||
      !Number.isSafeInteger(projecao.totalItens) || projecao.totalItens < 0 ||
      projecao.totalRefs !== projecao.hashes.length ||
      !projecao.hashes.every(hash => typeof hash === "string" && /^[a-f0-9]{32,64}$/.test(hash)) ||
      new Set(projecao.hashes).size !== projecao.hashes.length ||
      !/^[a-f0-9]{64}$/.test(String(projecao.checksum || "")) ||
      projecao.checksum !== checksumProjecao(projecao)) return false;
  const covered = projecao.filaViva;
  return Boolean(guard && covered && covered.identity && guard.identity &&
    covered.size === guard.size && covered.mtimeMs === guard.mtimeMs &&
    String(covered.identity || "") === String(guard.identity || ""));
}

function publicarReferenciasFilaViva(clienteId, entradas, deps = {}) {
  const resolver = deps.getClienteJsonPath;
  const escritor = deps.writeClienteJson;
  const fsImpl = deps.fs || fs;
  if (typeof resolver !== "function" || typeof escritor !== "function") {
    return { ok: false, motivo: "gc_references_storage_unavailable" };
  }
  try {
    const filaPath = resolver(clienteId, "fila-viva.json");
    const before = fsImpl.lstatSync(filaPath, { bigint: true });
    if (!before.isFile() || before.isSymbolicLink()) return { ok: false, motivo: "gc_references_guard_invalid" };
    if (!identidadeArquivo(before)) return { ok: false, motivo: "gc_references_identity_unavailable" };
    const documento = projetarReferenciasFilaViva(entradas, clienteId, before);
    if (escritor(clienteId, FILA_GC_REFERENCES_ARQUIVO, documento) === false) {
      return { ok: false, motivo: "gc_references_write_failed" };
    }
    const after = fsImpl.lstatSync(filaPath, { bigint: true });
    if (!projecaoCobreFilaViva(documento, clienteId, coberturaArquivo(after))) {
      return { ok: false, motivo: "gc_references_guard_changed" };
    }
    return { ok: true, totalRefs: documento.totalRefs,
      bytes: Buffer.byteLength(JSON.stringify(documento)) };
  } catch {
    return { ok: false, motivo: "gc_references_projection_failed" };
  }
}

module.exports = {
  FILA_GC_REFERENCES_ARQUIVO,
  FILA_GC_REFERENCES_VERSION,
  coberturaArquivo,
  hashesFilaViva,
  projetarReferenciasFilaViva,
  projecaoCobreFilaViva,
  publicarReferenciasFilaViva
};
