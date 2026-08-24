const { hashCopyV2 } = require("./contexto-v2");

const TTL_COPY_V2_MS = 24 * 60 * 60 * 1000;
const MAX_ENTRIES_COPY_V2 = 1000;
const PROMPT_VERSION_COPY_V2 = "copy-v2-prompt-v1";

const cacheV2 = new Map();

function agoraMs() {
  return Date.now();
}

function hashFatosComerciais(contexto = {}) {
  return hashCopyV2(JSON.stringify(contexto.fatosPermitidos || {}));
}

function chaveCacheCopyV2(contexto = {}, opcoes = {}) {
  if (!contexto.workspaceHash || !contexto.ofertaKeyHash) return "";
  const base = {
    workspaceHash: contexto.workspaceHash,
    ofertaKeyHash: contexto.ofertaKeyHash,
    tituloOriginalHash: hashCopyV2(contexto.tituloOriginalSanitizado || ""),
    marketplace: contexto.marketplace || "",
    categoria: contexto.categoriaNormalizada || "",
    intencao: contexto.intencao || "oportunidade",
    fatosComerciaisHash: hashFatosComerciais(contexto),
    estilo: contexto.estilo || "direta",
    promptVersion: opcoes.promptVersion || PROMPT_VERSION_COPY_V2,
    providerAlias: opcoes.providerAlias || "fake",
    modelAlias: opcoes.modelAlias || "fake-copy-v2"
  };
  return hashCopyV2(JSON.stringify(base));
}

function removerExpiradasCopyV2(now = agoraMs()) {
  for (const [id, item] of cacheV2.entries()) {
    if (Number(item?.expiraEm || 0) <= now) cacheV2.delete(id);
  }
}

function limitarCacheCopyV2() {
  removerExpiradasCopyV2();
  while (cacheV2.size > MAX_ENTRIES_COPY_V2) {
    const primeira = cacheV2.keys().next().value;
    if (!primeira) break;
    cacheV2.delete(primeira);
  }
}

function lerCacheCopyV2(chave = "") {
  const id = String(chave || "");
  if (!id) return null;
  const item = cacheV2.get(id);
  if (!item) return null;
  if (Number(item.expiraEm || 0) <= agoraMs()) {
    cacheV2.delete(id);
    return null;
  }
  return item.valor || null;
}

function salvarCacheCopyV2(chave = "", valor = {}, ttlMs = TTL_COPY_V2_MS) {
  const id = String(chave || "");
  if (!id || !valor || typeof valor !== "object") return null;
  limitarCacheCopyV2();
  if (!cacheV2.has(id) && cacheV2.size >= MAX_ENTRIES_COPY_V2) {
    const primeira = cacheV2.keys().next().value;
    if (primeira) cacheV2.delete(primeira);
  }
  const expiraEm = agoraMs() + Math.max(1000, Number(ttlMs) || TTL_COPY_V2_MS);
  if (cacheV2.has(id)) cacheV2.delete(id);
  cacheV2.set(id, { valor, expiraEm });
  return valor;
}

function limparCacheCopyV2() {
  cacheV2.clear();
}

function tamanhoCacheCopyV2() {
  removerExpiradasCopyV2();
  return cacheV2.size;
}

module.exports = {
  TTL_COPY_V2_MS,
  MAX_ENTRIES_COPY_V2,
  PROMPT_VERSION_COPY_V2,
  hashFatosComerciais,
  chaveCacheCopyV2,
  lerCacheCopyV2,
  salvarCacheCopyV2,
  removerExpiradasCopyV2,
  limparCacheCopyV2,
  tamanhoCacheCopyV2
};
