"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { getClientePath } = require("../../utils/storage");
const { sameIdentity } = require("./persistence-protocol");

const TERMINAL_INDEX_VERSION = 1;
const TERMINAL_INDEX_PROOF_VERSION = 1;
const TERMINAL_INDEX_FILE = "fila-terminal-index.json";
const TERMINAL_INDEX_PROOF_FILE = "fila-terminal-index.proof.json";
const TERMINAL_INDEX_INCREMENTAL_DIR = "fila-historico-incremental";
const TERMINAL_INDEX_LEGACY_FILE = "fila-historico.json";
const TERMINAL_INDEX_SHADOW_FLAG = "FILA_TERMINAL_INDEX_SHADOW";
const TAG_TERMINAL_INDEX_SHADOW = "[FILA-TERMINAL-INDEX-SHADOW]";
const DEFAULT_BOOTSTRAP_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_LOG_INTERVAL_MS = 30 * 1000;
const DEFAULT_MAX_INDEX_BYTES = 32 * 1024 * 1024;

const bootstrapEmAndamento = new Map();
const ultimoBootstrap = new Map();
const ultimoLog = new Map();

function texto(valor = "") {
  return String(valor == null ? "" : valor).trim();
}

function flagAtiva(env = process.env) {
  return ["1", "true", "on", "yes"].includes(texto(env?.[TERMINAL_INDEX_SHADOW_FLAG]).toLowerCase());
}

function workspaceHash(clienteId = "admin") {
  return crypto.createHash("sha256").update(texto(clienteId || "admin")).digest("hex").slice(0, 12);
}

function hashConteudo(conteudo) {
  return crypto.createHash("sha256").update(conteudo).digest("hex");
}

function identityFromStat(file, stat) {
  return {
    pathKind: path.basename(file),
    dev: Number.isFinite(Number(stat.dev)) ? Number(stat.dev) : null,
    ino: Number.isFinite(Number(stat.ino)) ? Number(stat.ino) : null,
    size: Number(stat.size || 0),
    mtimeMs: Number(stat.mtimeMs || 0),
    ctimeMs: Number.isFinite(Number(stat.ctimeMs)) ? Number(stat.ctimeMs) : null,
    mtimeNs: stat.mtimeNs == null ? null : String(stat.mtimeNs),
    ctimeNs: stat.ctimeNs == null ? null : String(stat.ctimeNs)
  };
}

function statOptional(file, fsImpl = fs) {
  try {
    return identityFromStat(file, fsImpl.statSync(file, { bigint: false }));
  } catch (erro) {
    if (erro?.code === "ENOENT") return null;
    throw erro;
  }
}

function diretorioCliente(clienteId, deps = {}) {
  const obter = deps.getClientePath || getClientePath;
  return path.resolve(obter(texto(clienteId || "admin")));
}

function caminhosTerminalIndex(clienteId, deps = {}) {
  const diretorio = diretorioCliente(clienteId, deps);
  const resolver = nome => {
    const resolved = path.resolve(diretorio, nome);
    if (path.dirname(resolved) !== diretorio) throw new Error("terminal_index_path_inseguro");
    return resolved;
  };
  return {
    diretorio,
    legacy: resolver(TERMINAL_INDEX_LEGACY_FILE),
    incrementalDir: resolver(TERMINAL_INDEX_INCREMENTAL_DIR),
    index: resolver(TERMINAL_INDEX_FILE),
    proof: resolver(TERMINAL_INDEX_PROOF_FILE)
  };
}

function nomesJsonl(dir, fsImpl = fs) {
  return fsImpl.readdirSync(dir, { withFileTypes: true })
    .filter(item => item.isFile() && /^[a-zA-Z0-9_.-]+\.jsonl$/i.test(item.name) && !item.name.includes(".."))
    .map(item => item.name)
    .sort();
}

function capturarSourceProof(clienteId, deps = {}) {
  const fsImpl = deps.fs || fs;
  const caminhos = caminhosTerminalIndex(clienteId, deps);
  const legacy = statOptional(caminhos.legacy, fsImpl);
  const incrementalDir = statOptional(caminhos.incrementalDir, fsImpl);
  if (!legacy) return { ok: false, motivo: "terminal_index_legacy_source_ausente", caminhos };
  if (!incrementalDir) return { ok: false, motivo: "terminal_index_incremental_source_ausente", caminhos };

  let nomes;
  try {
    nomes = nomesJsonl(caminhos.incrementalDir, fsImpl);
  } catch (erro) {
    return { ok: false, motivo: "terminal_index_incremental_source_inacessivel", erro, caminhos };
  }
  const incremental = [];
  for (const nome of nomes) {
    const file = path.resolve(caminhos.incrementalDir, nome);
    if (path.dirname(file) !== caminhos.incrementalDir) {
      return { ok: false, motivo: "terminal_index_incremental_path_inseguro", caminhos };
    }
    const identity = statOptional(file, fsImpl);
    if (!identity) return { ok: false, motivo: "terminal_index_incremental_source_stale", caminhos };
    incremental.push({ name: nome, identity });
  }
  const proof = { legacy, incrementalDir, incremental };
  return {
    ok: true,
    proof,
    sourceRevision: hashConteudo(JSON.stringify(proof)),
    caminhos
  };
}

function sourceProofIgual(esperado = {}, atual = {}) {
  if (!sameIdentity(esperado.legacy, atual.legacy)) return false;
  if (!sameIdentity(esperado.incrementalDir, atual.incrementalDir)) return false;
  const a = Array.isArray(esperado.incremental) ? esperado.incremental : [];
  const b = Array.isArray(atual.incremental) ? atual.incremental : [];
  if (a.length !== b.length) return false;
  for (let indice = 0; indice < a.length; indice += 1) {
    if (a[indice]?.name !== b[indice]?.name || !sameIdentity(a[indice]?.identity, b[indice]?.identity)) return false;
  }
  return true;
}

function lerJsonCompacto(file, fsImpl = fs, maxBytes = DEFAULT_MAX_INDEX_BYTES) {
  const identity = statOptional(file, fsImpl);
  if (!identity) return { ok: false, motivo: "arquivo_ausente" };
  if (Number(identity.size || 0) > maxBytes) return { ok: false, motivo: "arquivo_excede_limite", identity };
  try {
    const raw = fsImpl.readFileSync(file);
    const after = statOptional(file, fsImpl);
    if (!after || !sameIdentity(identity, after)) return { ok: false, motivo: "arquivo_mudou_durante_leitura" };
    return { ok: true, raw, valor: JSON.parse(raw.toString("utf8")), identity: after };
  } catch (erro) {
    return { ok: false, motivo: "arquivo_invalido", erro, identity };
  }
}

function validarTerminalIndex(clienteId = "admin", deps = {}) {
  const fsImpl = deps.fs || fs;
  const env = deps.env || process.env;
  let caminhos;
  try {
    caminhos = caminhosTerminalIndex(clienteId, deps);
  } catch (erro) {
    return { valido: false, motivo: erro?.message || "terminal_index_path_error" };
  }
  const maxBytesEnv = Number(env.FILA_TERMINAL_INDEX_MAX_BYTES);
  const maxBytes = Number.isFinite(maxBytesEnv) && maxBytesEnv > 0 ? maxBytesEnv : DEFAULT_MAX_INDEX_BYTES;
  const indexRead = lerJsonCompacto(caminhos.index, fsImpl, maxBytes);
  if (!indexRead.ok) return { valido: false, motivo: `terminal_index_${indexRead.motivo}` };
  const proofRead = lerJsonCompacto(caminhos.proof, fsImpl, 1024 * 1024);
  if (!proofRead.ok) return { valido: false, motivo: `terminal_index_proof_${proofRead.motivo}` };

  const index = indexRead.valor;
  const proof = proofRead.valor;
  if (index?.version !== TERMINAL_INDEX_VERSION || proof?.proofVersion !== TERMINAL_INDEX_PROOF_VERSION) {
    return { valido: false, motivo: "terminal_index_version_invalida" };
  }
  if (index?.complete !== true || proof?.complete !== true) {
    return { valido: false, motivo: "terminal_index_incompleto" };
  }
  if (index?.mode !== "shadow" || proof?.mode !== "shadow" || index?.authorityEligible !== false || proof?.authorityEligible !== false) {
    return { valido: false, motivo: "terminal_index_shadow_contract_invalido" };
  }
  if (!texto(index.revision) || index.revision !== proof.revision || Number(index.generation) !== Number(proof.generation)) {
    return { valido: false, motivo: "terminal_index_revision_divergente" };
  }
  if (Number(index.totalTerminais) !== Object.keys(index.entries || {}).length || Number(index.totalTerminais) !== Number(proof.totalTerminais)) {
    return { valido: false, motivo: "terminal_index_total_divergente" };
  }
  if (!sameIdentity(indexRead.identity, proof.indexIdentity)) {
    return { valido: false, motivo: "terminal_index_identity_divergente" };
  }
  if (hashConteudo(indexRead.raw) !== proof.indexSha256) {
    return { valido: false, motivo: "terminal_index_hash_divergente" };
  }

  const sources = capturarSourceProof(clienteId, deps);
  if (!sources.ok) return { valido: false, motivo: sources.motivo };
  if (!sourceProofIgual(proof.sources, sources.proof) || proof.sourceRevision !== sources.sourceRevision || index.sourceRevision !== sources.sourceRevision) {
    return { valido: false, motivo: "terminal_index_source_stale" };
  }

  return {
    valido: true,
    motivo: "terminal_index_valido",
    index,
    proof,
    bytes: Number(indexRead.identity.size || 0)
  };
}

function logShadow(logger, payload) {
  try {
    if (typeof logger?.log === "function") logger.log(TAG_TERMINAL_INDEX_SHADOW, JSON.stringify(payload));
  } catch {}
}

function deveLogar(chave, agora, intervaloMs) {
  const ultimo = ultimoLog.get(chave) || 0;
  if (agora - ultimo < intervaloMs) return false;
  ultimoLog.set(chave, agora);
  return true;
}

function revisionBootstrap() {
  return `terminal-${Date.now().toString(36)}-${crypto.randomBytes(4).toString("hex")}`;
}

function agendarBootstrap(clienteId, deps = {}) {
  const agendar = deps.agendarTerminalIndexBootstrap;
  if (typeof agendar !== "function") return { agendado: false, motivo: "bootstrap_callback_ausente" };
  const cliente = texto(clienteId || "admin");
  if (bootstrapEmAndamento.has(cliente)) return { agendado: false, motivo: "bootstrap_em_andamento" };
  const env = deps.env || process.env;
  const intervaloConfigurado = Number(env.FILA_TERMINAL_INDEX_BOOTSTRAP_INTERVAL_MS);
  const intervalo = Number.isFinite(intervaloConfigurado) && intervaloConfigurado >= 0
    ? intervaloConfigurado
    : DEFAULT_BOOTSTRAP_INTERVAL_MS;
  const agora = Date.now();
  if (agora - (ultimoBootstrap.get(cliente) || 0) < intervalo) {
    return { agendado: false, motivo: "bootstrap_throttle" };
  }
  ultimoBootstrap.set(cliente, agora);
  const promise = Promise.resolve().then(() => agendar({
    clienteId: cliente,
    checkpointRevision: revisionBootstrap(),
    targetGeneration: Number(deps.targetGeneration || 0)
  })).catch(erro => ({ ok: false, motivo: erro?.message || "terminal_index_bootstrap_error" }))
    .finally(() => bootstrapEmAndamento.delete(cliente));
  bootstrapEmAndamento.set(cliente, promise);
  return { agendado: true, motivo: "bootstrap_agendado" };
}

function avaliarTerminalIndexShadow(clienteId = "admin", itemId = "", autoridade = {}, deps = {}) {
  const env = deps.env || process.env;
  if (!flagAtiva(env)) return { ativo: false, motivo: "terminal_index_shadow_disabled" };
  const cliente = texto(clienteId || "admin");
  const identidade = texto(itemId);
  const validacao = validarTerminalIndex(cliente, deps);
  const bootstrap = validacao.valido ? { agendado: false, motivo: "indice_valido" } : agendarBootstrap(cliente, deps);
  const entrada = validacao.valido && identidade && !identidade.startsWith("indice:")
    ? validacao.index.entries?.[identidade]
    : undefined;
  const hit = Array.isArray(entrada);
  const status = hit ? texto(entrada[0]).toLowerCase() : "";
  const provadoAtual = autoridade?.provado === true;
  const concorda = validacao.valido ? hit === provadoAtual : null;
  const statusConcorda = validacao.valido && hit && provadoAtual
    ? status === texto(autoridade.status).toLowerCase()
    : null;
  const agora = Date.now();
  const logIntervaloConfigurado = Number(env.FILA_TERMINAL_INDEX_SHADOW_LOG_INTERVAL_MS);
  const logIntervalo = Number.isFinite(logIntervaloConfigurado) && logIntervaloConfigurado >= 0
    ? logIntervaloConfigurado
    : DEFAULT_LOG_INTERVAL_MS;
  const chaveLog = `${cliente}|${validacao.motivo}|${hit}|${provadoAtual}|${concorda}|${statusConcorda}`;
  if (deveLogar(chaveLog, agora, logIntervalo)) {
    logShadow(deps.logger || console, {
      versao: 1,
      workspaceKey: workspaceHash(cliente),
      itemKey: identidade ? hashConteudo(identidade).slice(0, 12) : "",
      indiceValido: validacao.valido === true,
      complete: validacao.proof?.complete === true,
      generation: validacao.index?.generation ?? null,
      revisionKey: validacao.index?.revision ? hashConteudo(validacao.index.revision).slice(0, 12) : "",
      hit,
      autoridadeHit: provadoAtual,
      concorda,
      statusConcorda,
      motivo: validacao.motivo,
      bootstrap: bootstrap.motivo
    });
  }
  return { ativo: true, ...validacao, hit, status, concorda, statusConcorda, bootstrap };
}

function resetarTerminalIndexShadowParaTeste() {
  bootstrapEmAndamento.clear();
  ultimoBootstrap.clear();
  ultimoLog.clear();
}

module.exports = {
  TERMINAL_INDEX_VERSION,
  TERMINAL_INDEX_PROOF_VERSION,
  TERMINAL_INDEX_FILE,
  TERMINAL_INDEX_PROOF_FILE,
  TERMINAL_INDEX_INCREMENTAL_DIR,
  TERMINAL_INDEX_LEGACY_FILE,
  TERMINAL_INDEX_SHADOW_FLAG,
  TAG_TERMINAL_INDEX_SHADOW,
  flagAtiva,
  workspaceHash,
  hashConteudo,
  identityFromStat,
  statOptional,
  caminhosTerminalIndex,
  capturarSourceProof,
  sourceProofIgual,
  validarTerminalIndex,
  avaliarTerminalIndexShadow,
  resetarTerminalIndexShadowParaTeste
};
