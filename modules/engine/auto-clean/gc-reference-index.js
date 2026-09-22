"use strict";

const fs = require("fs");
const path = require("path");

const DEFAULT_MAX_REFERENCE_BYTES = 16 * 1024 * 1024;
const VITRINE_RETENTION_MS = 72 * 60 * 60 * 1000;
const HISTORY_DAYS = 7;
const HISTORY_RETENTION_MS = HISTORY_DAYS * 24 * 60 * 60 * 1000;
const REFERENCE_REASON = Object.freeze({
  BUDGET_EXCEEDED: "REFERENCE_BUDGET_EXCEEDED",
  FILE_TOO_LARGE: "REFERENCE_FILE_TOO_LARGE",
  FILE_INVALID_JSON: "REFERENCE_FILE_INVALID_JSON",
  JSONL_PARSE_ERROR: "REFERENCE_JSONL_PARSE_ERROR",
  READ_ERROR: "REFERENCE_READ_ERROR",
  SOURCE_CHANGED: "REFERENCE_SOURCE_CHANGED",
  SOURCE_NOT_REGULAR: "REFERENCE_SOURCE_NOT_REGULAR",
  FORMAT_INVALID: "REFERENCE_FILE_FORMAT_INVALID",
  COMPLEXITY_LIMIT: "REFERENCE_INDEX_COMPLEXITY_LIMIT"
});
const TERMINAL_QUEUE_STATUS = new Set([
  "enviado", "enviada", "historico", "terminal", "expirada", "expirado", "expirada_operacional",
  "expirado_operacional", "erro_final", "erro_permanente", "falha_final", "cancelada",
  "cancelado", "descartada", "descartado", "duplicada", "duplicado"
]);

function hashRenderEmValor(value, workspaceId) {
  const escaped = workspaceId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(?:^|/)clientes/${escaped}/renderizados/([a-f0-9]{32,64})\\.png(?:$|[?#])`, "ig");
  const found = [];
  for (const match of String(value || "").replace(/\\/g, "/").matchAll(pattern)) found.push(match[1].toLowerCase());
  return found;
}

function coletarObjeto(value, workspaceId, source, refs, budget, depth = 0) {
  if (depth > 32 || ++budget.nodes > 300000) {
    const error = new Error(REFERENCE_REASON.COMPLEXITY_LIMIT);
    error.code = REFERENCE_REASON.COMPLEXITY_LIMIT;
    throw error;
  }
  if (typeof value === "string") {
    for (const hash of hashRenderEmValor(value, workspaceId)) {
      if (!refs.has(hash)) refs.set(hash, new Set());
      refs.get(hash).add(source);
    }
  } else if (Array.isArray(value)) {
    for (const item of value) coletarObjeto(item, workspaceId, source, refs, budget, depth + 1);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) coletarObjeto(item, workspaceId, source, refs, budget, depth + 1);
  }
}

function erroReferencia(reasonCode, file, source, extra = {}) {
  const error = new Error(reasonCode);
  error.code = reasonCode;
  error.referenceSource = String(source || "unknown");
  error.referenceFile = path.basename(String(file || ""));
  if (Number.isSafeInteger(extra.lineNumber) && extra.lineNumber > 0) error.lineNumber = extra.lineNumber;
  return error;
}

function erroComContexto(error, fallbackCode, file, source, extra = {}) {
  const reasonCode = String(error?.code || "").startsWith("REFERENCE_") ? error.code : fallbackCode;
  const contextual = erroReferencia(reasonCode, file, source, extra);
  if (error?.lineNumber && !contextual.lineNumber) contextual.lineNumber = error.lineNumber;
  return contextual;
}

function ofertasVitrineVivas(documento, nowMs) {
  const ofertas = Array.isArray(documento?.ofertas) ? documento.ofertas : [];
  return ofertas.filter(oferta => {
    const when = Date.parse(oferta?.ultimoEnvioEm || oferta?.enviadoEm || oferta?.dataEnvio || oferta?.atualizadoEm || oferta?.criadoEm || "");
    return !Number.isFinite(when) || nowMs - when <= VITRINE_RETENTION_MS;
  });
}

function timestampRegistro(value = {}) {
  for (const key of ["finalizadoEm", "enviadoEm", "dataEnvio", "updatedAt", "atualizadoEm", "criadoEm", "createdAt"]) {
    const ms = Date.parse(value?.[key] || "");
    if (Number.isFinite(ms)) return ms;
  }
  return null;
}

function dentroRetencao(value, nowMs, retentionMs = HISTORY_RETENTION_MS) {
  const ms = timestampRegistro(value);
  return !Number.isFinite(ms) || nowMs - ms <= retentionMs;
}

function selecionarConteudoVivo(parsed, file, source, nowMs) {
  if (source === "vitrine") return ofertasVitrineVivas(parsed, nowMs);
  const base = path.basename(file);
  if (base === "manual_ofertas_v2.json") {
    return parsed.filter(item => !["enviada", "erro"].includes(String(item?.status || "").toLowerCase()));
  }
  if (base === "fila.json") {
    return parsed.filter(item => {
      const status = String(item?.status || item?.estado || "pendente").toLowerCase();
      return !TERMINAL_QUEUE_STATUS.has(status) || dentroRetencao(item, nowMs);
    });
  }
  if (base === "fila-historico.json") return parsed.filter(item => dentroRetencao(item?.item || item, nowMs));
  if (base === "fila-projecao-leve.json") {
    return parsed.itens.filter(item => {
      const status = String(item?.statusOperacional || item?.status || item?.estado || "pendente").toLowerCase();
      return !TERMINAL_QUEUE_STATUS.has(status) || dentroRetencao(item, nowMs);
    });
  }
  return parsed;
}

async function lerFonte(file, source, workspaceId, refs, budget, fsApi, nowMs) {
  let before;
  try { before = await fsApi.lstat(file); }
  catch (error) {
    if (error?.code === "ENOENT") return false;
    throw erroReferencia(REFERENCE_REASON.READ_ERROR, file, source);
  }
  if (!before.isFile() || before.isSymbolicLink()) {
    throw erroReferencia(REFERENCE_REASON.SOURCE_NOT_REGULAR, file, source);
  }
  if (before.size > budget.remaining) {
    const reason = before.size > budget.max
      ? REFERENCE_REASON.FILE_TOO_LARGE
      : REFERENCE_REASON.BUDGET_EXCEEDED;
    throw erroReferencia(reason, file, source);
  }
  budget.remaining -= before.size;
  let content;
  let after;
  try {
    content = await fsApi.readFile(file, "utf8");
    after = await fsApi.lstat(file);
  } catch {
    throw erroReferencia(REFERENCE_REASON.READ_ERROR, file, source);
  }
  if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
    throw erroReferencia(REFERENCE_REASON.SOURCE_CHANGED, file, source);
  }
  if (file.endsWith(".jsonl")) {
    let lineNumber = 0;
    for (const line of content.split(/\r?\n/)) {
      lineNumber += 1;
      if (!line.trim()) continue;
      try {
        coletarObjeto(JSON.parse(line), workspaceId, source, refs, budget);
      } catch (error) {
        throw erroComContexto(error, REFERENCE_REASON.JSONL_PARSE_ERROR, file, source, { lineNumber });
      }
    }
  } else {
    let parsed;
    try { parsed = JSON.parse(content); }
    catch { throw erroReferencia(REFERENCE_REASON.FILE_INVALID_JSON, file, source); }
    if (source === "vitrine" && (!parsed || !Array.isArray(parsed.ofertas))) {
      throw erroReferencia(REFERENCE_REASON.FORMAT_INVALID, file, source);
    }
    const projection = path.basename(file) === "fila-projecao-leve.json";
    if (projection && (!parsed || !Array.isArray(parsed.itens))) {
      throw erroReferencia(REFERENCE_REASON.FORMAT_INVALID, file, source);
    }
    if (source !== "vitrine" && !projection && !Array.isArray(parsed)) {
      throw erroReferencia(REFERENCE_REASON.FORMAT_INVALID, file, source);
    }
    try {
      coletarObjeto(selecionarConteudoVivo(parsed, file, source, nowMs), workspaceId, source, refs, budget);
    } catch (error) {
      throw erroComContexto(error, REFERENCE_REASON.READ_ERROR, file, source);
    }
  }
  budget.sources += 1;
  budget.bytes += before.size;
  return true;
}

function fontesWorkspace(dataDir, workspaceId, nowMs) {
  const root = path.join(dataDir, "clientes", workspaceId);
  const sources = [
    ["fila.json", "fila"], ["fila-viva.json", "fila"],
    ["fila-historico.json", "historico"], ["fila-projecao-leve.json", "historico"],
    ["vitrine.json", "vitrine"], ["manual_ofertas_v2.json", "manual"],
    ["social-agendamentos.json", "social"], ["social-rascunhos.json", "social"],
    ["social-publicacoes.json", "social"], ["social-oportunidades.json", "social"]
  ].map(([name, source]) => ({ file: path.join(root, name), source }));
  // Um dia adicional cobre a borda UTC/Sao_Paulo sem importar historico remoto.
  for (let day = 0; day <= HISTORY_DAYS; day += 1) {
    const date = new Date(nowMs - day * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    for (const folder of ["fila-historico-leve-incremental", "fila-historico-incremental"]) {
      sources.push({ file: path.join(root, folder, `${date}.jsonl`), source: "historico" });
    }
  }
  return sources;
}

async function inventariarReferenciasVivas({ dataDir, workspaceId, nowMs = Date.now(),
  maxBytes = DEFAULT_MAX_REFERENCE_BYTES, fsApi = fs.promises } = {}) {
  if (!/^[a-zA-Z0-9_-]+$/.test(String(workspaceId || ""))) throw new Error("GC_WORKSPACE_INVALID");
  const refs = new Map();
  const budget = { max: maxBytes, remaining: maxBytes, bytes: 0, sources: 0, nodes: 0 };
  try {
    for (const { file, source } of fontesWorkspace(dataDir, workspaceId, nowMs)) {
      await lerFonte(file, source, workspaceId, refs, budget, fsApi, nowMs);
    }
    return { complete: true, refs, bytesRead: budget.bytes, sourcesRead: budget.sources };
  } catch (error) {
    // Inventario incompleto jamais autoriza declarar um render orfao.
    return { complete: false, refs, bytesRead: budget.bytes, sourcesRead: budget.sources,
      errorCode: error?.code || REFERENCE_REASON.READ_ERROR,
      reasonCode: error?.code || REFERENCE_REASON.READ_ERROR,
      referenceSource: error?.referenceSource || "unknown",
      referenceFile: error?.referenceFile || "",
      lineNumber: Number.isSafeInteger(error?.lineNumber) ? error.lineNumber : undefined };
  }
}

module.exports = { inventariarReferenciasVivas, hashRenderEmValor, ofertasVitrineVivas,
  selecionarConteudoVivo, DEFAULT_MAX_REFERENCE_BYTES, VITRINE_RETENTION_MS, HISTORY_RETENTION_MS,
  REFERENCE_REASON };
