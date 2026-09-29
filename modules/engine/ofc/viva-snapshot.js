"use strict";

const fs = require("node:fs");
const { performance } = require("node:perf_hooks");
const { getClienteJsonPath } = require("../../../utils/storage");

const FILA_VIVA = "fila-viva.json";
const FILA_VIVA_PROOF = "fila-viva.proof.json";
const FILA_V2_MANIFEST = "fila-v2-manifest.json";
const PROOF_VERSION = 1;
const MANIFEST_VERSION = 2;

function texto(valor) {
  return typeof valor === "string" ? valor.trim() : "";
}

function clienteSeguro(clienteId = "admin") {
  return texto(clienteId) || "admin";
}

function inteiroNaoNegativo(valor) {
  return Number.isInteger(Number(valor)) && Number(valor) >= 0 ? Number(valor) : null;
}

function statArquivo(arquivo, fsImpl = fs) {
  try {
    const stat = fsImpl.statSync(arquivo);
    return {
      existe: true,
      size: Number(stat.size),
      mtimeMs: Number(stat.mtimeMs),
      ctimeMs: Number.isFinite(Number(stat.ctimeMs)) ? Number(stat.ctimeMs) : null,
      ino: Number.isFinite(Number(stat.ino)) ? Number(stat.ino) : null,
      dev: Number.isFinite(Number(stat.dev)) ? Number(stat.dev) : null
    };
  } catch {
    return { existe: false, size: 0, mtimeMs: 0, ctimeMs: null, ino: null, dev: null };
  }
}

function identidadeFisica(stat = {}) {
  return {
    size: Number(stat.size),
    mtimeMs: Number(stat.mtimeMs),
    ctimeMs: stat.ctimeMs === null ? null : Number(stat.ctimeMs),
    ino: stat.ino === null ? null : Number(stat.ino),
    dev: stat.dev === null ? null : Number(stat.dev)
  };
}

function mesmaIdentidadeFisica(a = {}, b = {}) {
  if (!a || !b || Number(a.size) !== Number(b.size) || Math.abs(Number(a.mtimeMs) - Number(b.mtimeMs)) > 1) {
    return false;
  }
  for (const campo of ["ino", "dev"]) {
    if (a[campo] !== null && b[campo] !== null && Number(a[campo]) !== Number(b[campo])) return false;
  }
  return true;
}

function lerJsonPequeno(arquivo, fsImpl = fs) {
  try {
    const textoArquivo = fsImpl.readFileSync(arquivo, "utf8");
    if (typeof textoArquivo !== "string" || textoArquivo.trim() === "") {
      return { ok: false, motivo: "arquivo_vazio" };
    }
    return { ok: true, valor: JSON.parse(textoArquivo) };
  } catch (erro) {
    return { ok: false, motivo: erro?.code === "ENOENT" ? "arquivo_ausente" : "json_corrompido" };
  }
}

function normalizarProof(valor = null) {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) return null;
  const proofVersion = inteiroNaoNegativo(valor.proofVersion);
  const generation = inteiroNaoNegativo(valor.generation ?? valor.targetGeneration);
  const size = inteiroNaoNegativo(valor.size);
  const mtimeMs = Number(valor.mtimeMs);
  const fileRevision = texto(valor.fileRevision);
  if (proofVersion !== PROOF_VERSION || generation === null || size === null ||
      !Number.isFinite(mtimeMs) || !fileRevision) return null;
  return {
    proofVersion,
    clienteId: texto(valor.clienteId),
    arquivo: texto(valor.arquivo),
    generation,
    fileRevision,
    size,
    mtimeMs,
    ctimeMs: Number.isFinite(Number(valor.ctimeMs)) ? Number(valor.ctimeMs) : null,
    ino: Number.isFinite(Number(valor.ino)) ? Number(valor.ino) : null,
    dev: Number.isFinite(Number(valor.dev)) ? Number(valor.dev) : null
  };
}

function proofsIguais(a, b) {
  return !!a && !!b && a.clienteId === b.clienteId && a.arquivo === b.arquivo &&
    a.generation === b.generation && a.fileRevision === b.fileRevision &&
    a.size === b.size && Math.abs(a.mtimeMs - b.mtimeMs) <= 1 &&
    (a.ino === null || b.ino === null || a.ino === b.ino) &&
    (a.dev === null || b.dev === null || a.dev === b.dev);
}

function caminhos(clienteId = "admin", deps = {}) {
  const cliente = clienteSeguro(clienteId);
  const resolver = typeof deps.getClienteJsonPath === "function" ? deps.getClienteJsonPath : getClienteJsonPath;
  return {
    cliente,
    viva: resolver(cliente, FILA_VIVA),
    proof: resolver(cliente, FILA_VIVA_PROOF),
    manifest: resolver(cliente, FILA_V2_MANIFEST),
    legacy: resolver(cliente, "fila.json")
  };
}

function validarElegibilidadeViva(clienteId = "admin", deps = {}) {
  const inicio = performance.now();
  const fsImpl = deps.fs || fs;
  let paths;
  try {
    paths = caminhos(clienteId, deps);
  } catch {
    return { eligible: false, motivo: "fila_viva_path_indisponivel", proofValidationMs: performance.now() - inicio };
  }

  const vivaStat = statArquivo(paths.viva, fsImpl);
  if (!vivaStat.existe) return { eligible: false, motivo: "fila_viva_ausente", proofValidationMs: performance.now() - inicio, paths };

  const proofLeitura = lerJsonPequeno(paths.proof, fsImpl);
  if (!proofLeitura.ok) return { eligible: false, motivo: "fila_viva_proof_ausente", proofValidationMs: performance.now() - inicio, paths };
  const proof = normalizarProof(proofLeitura.valor);
  if (!proof) return { eligible: false, motivo: "fila_viva_proof_invalido", proofValidationMs: performance.now() - inicio, paths };

  const manifestLeitura = lerJsonPequeno(paths.manifest, fsImpl);
  if (!manifestLeitura.ok) return { eligible: false, motivo: "fila_viva_manifest_ausente", proofValidationMs: performance.now() - inicio, paths };
  const manifest = manifestLeitura.valor;
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return { eligible: false, motivo: "fila_viva_manifest_invalido", proofValidationMs: performance.now() - inicio, paths };
  }

  const manifestVersion = inteiroNaoNegativo(manifest.manifestVersion ?? manifest.version);
  const vivaGeneration = inteiroNaoNegativo(manifest.vivaGeneration);
  const manifestProof = normalizarProof(manifest.vivaFileProof);
  if (manifestVersion === null || manifestVersion < MANIFEST_VERSION ||
      texto(manifest.clienteId) !== paths.cliente || vivaGeneration === null ||
      proof.clienteId !== paths.cliente || proof.arquivo !== FILA_VIVA ||
      proof.generation !== vivaGeneration || !proofsIguais(proof, manifestProof)) {
    return { eligible: false, motivo: "fila_viva_manifest_proof_mismatch", proofValidationMs: performance.now() - inicio, paths };
  }

  if (vivaStat.size !== proof.size || Math.abs(vivaStat.mtimeMs - proof.mtimeMs) > 1 ||
      (proof.ino !== null && vivaStat.ino !== null && proof.ino !== vivaStat.ino) ||
      (proof.dev !== null && vivaStat.dev !== null && proof.dev !== vivaStat.dev)) {
    return { eligible: false, motivo: "fila_viva_stat_mismatch", proofValidationMs: performance.now() - inicio, paths };
  }

  const legacyStat = statArquivo(paths.legacy, fsImpl);
  return {
    eligible: true,
    source: "fila_viva",
    arquivo: paths.viva,
    proof,
    manifest,
    beforeIdentity: identidadeFisica(vivaStat),
    sourceBytes: vivaStat.size,
    legacyBytes: legacyStat.existe ? legacyStat.size : 0,
    bytesAvoidedEstimate: Math.max(0, (legacyStat.existe ? legacyStat.size : 0) - vivaStat.size),
    proofValidationMs: performance.now() - inicio,
    paths
  };
}

function normalizarItensViva(valor) {
  if (!Array.isArray(valor)) return { ok: false, motivo: "fila_viva_formato_invalido", itens: [] };
  const itens = [];
  for (const entrada of valor) {
    if (!entrada || typeof entrada !== "object" || Array.isArray(entrada)) {
      return { ok: false, motivo: "fila_viva_item_invalido", itens: [] };
    }
    const item = entrada.item && typeof entrada.item === "object" && !Array.isArray(entrada.item)
      ? entrada.item : entrada;
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return { ok: false, motivo: "fila_viva_item_invalido", itens: [] };
    }
    itens.push(item);
  }
  return { ok: true, motivo: "", itens };
}

module.exports = {
  FILA_VIVA,
  FILA_VIVA_PROOF,
  FILA_V2_MANIFEST,
  caminhos,
  statArquivo,
  identidadeFisica,
  mesmaIdentidadeFisica,
  validarElegibilidadeViva,
  normalizarItensViva
};
