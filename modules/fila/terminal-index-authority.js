"use strict";

const terminalIndexShadow = require("./terminal-index-shadow");
const terminalAuthorityFence = require("./terminal-index-authority-fence");

const AUTHORITY_FLAG = "FILA_TERMINAL_INDEX_AUTHORITY";
const CANARY_FLAG = "FILA_TERMINAL_INDEX_AUTHORITY_CANARY_CLIENTES";
const TAG = "[FILA-TERMINAL-INDEX-AUTHORITY]";
const COORDINATED_MARKER = Symbol("terminal-index-authority-coordinated");
const metricas = new Map();

function texto(valor = "") {
  return String(valor == null ? "" : valor).trim();
}

function clienteSeguro(clienteId = "admin") {
  return texto(clienteId || "admin") || "admin";
}

function autoridadeHabilitada(env = process.env) {
  return texto(env?.[AUTHORITY_FLAG]) === "1";
}

function clientesCanary(env = process.env) {
  return new Set(texto(env?.[CANARY_FLAG])
    .split(",")
    .map(cliente => texto(cliente))
    .filter(Boolean));
}

function marcarCoordenada(deps = {}) {
  return { ...deps, [COORDINATED_MARKER]: true };
}

function coordenada(deps = {}) {
  return deps?.[COORDINATED_MARKER] === true;
}

function metricaInicial() {
  return {
    authorityRequests: 0,
    authorityDecisions: 0,
    authorityHits: 0,
    authorityMisses: 0,
    authorityFallbacks: 0,
    reasonCode: "",
    indexBytesRead: 0,
    validationPreMs: 0,
    validationPostMs: 0,
    lookupMs: 0,
    fenceEpoch: null,
    legacyReadAvoided: 0,
    bytesAvoidedEstimate: 0
  };
}

function obterMetrica(cliente) {
  const chave = terminalIndexShadow.workspaceHash(cliente);
  if (!metricas.has(chave)) metricas.set(chave, metricaInicial());
  return { chave, metrica: metricas.get(chave) };
}

function registrarMetrica(cliente, resultado, deps = {}) {
  const { chave, metrica } = obterMetrica(cliente);
  metrica.authorityRequests += 1;
  if (resultado.decision === "authority") {
    metrica.authorityDecisions += 1;
    if (resultado.hit === true) metrica.authorityHits += 1;
    else metrica.authorityMisses += 1;
  } else {
    metrica.authorityFallbacks += 1;
  }
  metrica.reasonCode = resultado.reasonCode;
  metrica.indexBytesRead += Number(resultado.indexBytesRead || 0);
  metrica.validationPreMs += Number(resultado.validationPreMs || 0);
  metrica.validationPostMs += Number(resultado.validationPostMs || 0);
  metrica.lookupMs += Number(resultado.lookupMs || 0);
  if (Number.isSafeInteger(resultado.fenceEpoch)) metrica.fenceEpoch = resultado.fenceEpoch;
  if (resultado.legacyReadAvoided === true) metrica.legacyReadAvoided += 1;
  metrica.bytesAvoidedEstimate += Number(resultado.bytesAvoidedEstimate || 0);

  try {
    if (typeof deps.logger?.log === "function") {
      deps.logger.log(TAG, JSON.stringify({
        versao: 1,
        workspaceKey: chave,
        authorityRequests: metrica.authorityRequests,
        authorityDecisions: metrica.authorityDecisions,
        authorityHits: metrica.authorityHits,
        authorityMisses: metrica.authorityMisses,
        authorityFallbacks: metrica.authorityFallbacks,
        reasonCode: resultado.reasonCode,
        indexBytesRead: resultado.indexBytesRead,
        validationPreMs: resultado.validationPreMs,
        validationPostMs: resultado.validationPostMs,
        lookupMs: resultado.lookupMs,
        fenceEpoch: resultado.fenceEpoch,
        legacyReadAvoided: resultado.legacyReadAvoided,
        bytesAvoidedEstimate: resultado.bytesAvoidedEstimate
      }));
    }
  } catch (_) {}
}

function metricasAuthority() {
  return Array.from(metricas.entries()).map(([workspaceKey, metrica]) => ({
    workspaceKey,
    ...metrica
  }));
}

function resetarMetricasAuthorityParaTeste() {
  metricas.clear();
}

function resultadoLegado(cliente, reasonCode, extras = {}) {
  return {
    decision: "legacy",
    proved: false,
    hit: false,
    status: "",
    reasonCode,
    sourceRevision: "",
    generation: null,
    revision: "",
    fenceEpoch: null,
    indexBytes: 0,
    indexBytesRead: 0,
    validationMs: 0,
    validationPreMs: 0,
    validationPostMs: 0,
    lookupMs: 0,
    legacyReadAvoided: false,
    bytesAvoidedEstimate: 0,
    workspaceKey: terminalIndexShadow.workspaceHash(cliente),
    ...extras
  };
}

function resultadoAutoridade(cliente, fields) {
  return {
    decision: "authority",
    proved: fields.hit === true,
    hit: fields.hit === true,
    status: fields.status || "",
    reasonCode: fields.hit === true ? "authority_hit" : "authority_miss",
    sourceRevision: fields.sourceRevision,
    generation: fields.generation,
    revision: fields.revision,
    fenceEpoch: fields.fenceEpoch,
    indexBytes: fields.indexBytes,
    indexBytesRead: fields.indexBytes,
    validationMs: fields.validationPreMs + fields.validationPostMs,
    validationPreMs: fields.validationPreMs,
    validationPostMs: fields.validationPostMs,
    lookupMs: fields.lookupMs,
    legacyReadAvoided: true,
    bytesAvoidedEstimate: fields.bytesAvoidedEstimate,
    workspaceKey: terminalIndexShadow.workspaceHash(cliente)
  };
}

function snapshotElegivel(snapshot) {
  return snapshot?.ok === true &&
    snapshot.eligible === true &&
    snapshot.pending === false &&
    snapshot.metadataLockPresent === false &&
    Number.isSafeInteger(snapshot.epoch) &&
    snapshot.epoch >= 0;
}

function capturarProva(validacao) {
  if (validacao?.valido !== true || !validacao.index || !validacao.proof) return null;
  const index = validacao.index;
  const proof = validacao.proof;
  const indexBytes = Number(validacao.bytes);
  if (!Number.isSafeInteger(indexBytes) || indexBytes < 0 ||
      !index.entries || typeof index.entries !== "object" || Array.isArray(index.entries)) return null;
  const sourceRevision = String(index.sourceRevision == null ? "" : index.sourceRevision);
  const proofSourceRevision = String(proof.sourceRevision == null ? "" : proof.sourceRevision);
  const generation = Number(index.generation);
  const proofGeneration = Number(proof.generation);
  const revision = String(index.revision == null ? "" : index.revision);
  const proofRevision = String(proof.revision == null ? "" : proof.revision);
  if (!sourceRevision || sourceRevision !== proofSourceRevision ||
      !Number.isSafeInteger(generation) || generation < 0 || generation !== proofGeneration ||
      !revision || revision !== proofRevision) return null;
  return { sourceRevision, generation, revision, indexBytes };
}

function mesmasProvas(a, b) {
  return Boolean(a && b) &&
    a.sourceRevision === b.sourceRevision &&
    a.generation === b.generation &&
    a.revision === b.revision;
}

function bytesDeSources(node, vistos = new Set()) {
  if (!node || typeof node !== "object" || vistos.has(node)) return 0;
  vistos.add(node);
  let total = 0;
  if (Number.isFinite(Number(node.size)) && Number(node.size) >= 0) total += Number(node.size);
  for (const valor of Object.values(node)) total += bytesDeSources(valor, vistos);
  return total;
}

function extrairStatus(entry) {
  if (Array.isArray(entry)) return texto(entry[0]);
  if (entry && typeof entry === "object") return texto(entry.status || entry.statusFinal);
  return texto(entry);
}

function decidirAuthority(clienteId = "admin", item = {}, deps = {}) {
  const cliente = clienteSeguro(clienteId);
  let resultado;
  const finalizar = valor => {
    resultado = valor;
    registrarMetrica(cliente, resultado, deps);
    return resultado;
  };

  try {
    if (!autoridadeHabilitada(deps.env || process.env)) return finalizar(resultadoLegado(cliente, "authority_disabled"));
    if (!clientesCanary(deps.env || process.env).has(cliente)) return finalizar(resultadoLegado(cliente, "workspace_not_canary"));
    if (!coordenada(deps)) return finalizar(resultadoLegado(cliente, "not_coordinated"));
    if (!terminalAuthorityFence.habilitado(deps.env || process.env)) {
      return finalizar(resultadoLegado(cliente, "fence_disabled"));
    }

    const identidadeFn = deps.identidadePrimariaExataFilaV2;
    if (typeof identidadeFn !== "function") return finalizar(resultadoLegado(cliente, "identity_provider_missing"));
    const identidade = identidadeFn(item);
    if (typeof identidade !== "string" || !identidade.trim()) {
      return finalizar(resultadoLegado(cliente, "identity_missing"));
    }

    const fenceSnapshot = typeof deps.fenceSnapshot === "function"
      ? deps.fenceSnapshot
      : terminalAuthorityFence.snapshot;
    const validar = typeof deps.validarTerminalIndex === "function"
      ? deps.validarTerminalIndex
      : terminalIndexShadow.validarTerminalIndex;
    const preFence = fenceSnapshot(cliente, deps);
    if (!snapshotElegivel(preFence)) {
      return finalizar(resultadoLegado(cliente, preFence?.reasonCode || "fence_snapshot_ineligible"));
    }

    const inicioPre = Date.now();
    const preValidacao = validar(cliente, deps);
    const validationPreMs = Math.max(0, Date.now() - inicioPre);
    const preProva = capturarProva(preValidacao);
    if (!preProva) return finalizar(resultadoLegado(cliente, preValidacao?.motivo || "terminal_index_invalid", {
      validationPreMs
    }));

    const inicioLookup = Date.now();
    const entries = preValidacao.index?.entries;
    const hit = Boolean(entries && Object.prototype.hasOwnProperty.call(entries, identidade));
    const status = hit ? extrairStatus(entries[identidade]) : "";
    const lookupMs = Math.max(0, Date.now() - inicioLookup);
    const bytesAvoidedEstimate = bytesDeSources(preValidacao.proof?.sources);

    const inicioPost = Date.now();
    const postValidacao = validar(cliente, deps);
    const validationPostMs = Math.max(0, Date.now() - inicioPost);
    const postFence = fenceSnapshot(cliente, deps);
    const postProva = capturarProva(postValidacao);
    if (!snapshotElegivel(postFence) ||
        postFence.epoch !== preFence.epoch ||
        !mesmasProvas(preProva, postProva)) {
      return finalizar(resultadoLegado(cliente, "authority_snapshot_changed", {
        validationPreMs,
        validationPostMs,
        lookupMs,
        fenceEpoch: preFence.epoch
      }));
    }

    return finalizar(resultadoAutoridade(cliente, {
      hit,
      status,
      sourceRevision: preProva.sourceRevision,
      generation: preProva.generation,
      revision: preProva.revision,
      fenceEpoch: preFence.epoch,
      indexBytes: preProva.indexBytes,
      validationPreMs,
      validationPostMs,
      lookupMs,
      bytesAvoidedEstimate
    }));
  } catch (_) {
    return finalizar(resultadoLegado(cliente, "authority_exception"));
  }
}

module.exports = {
  AUTHORITY_FLAG,
  CANARY_FLAG,
  autoridadeHabilitada,
  marcarCoordenada,
  decidirAuthority,
  metricasAuthority,
  resetarMetricasAuthorityParaTeste
};
