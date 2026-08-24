const TTL_PADRAO_MS = 45 * 60 * 1000;
const LIMITE_HISTORICO = 20;
const MAX_ENTRIES = 1000;

const cache = new Map();
const historico = new Map();

function agoraMs() {
  return Date.now();
}

function removerExpiradas(now = agoraMs()) {
  for (const [id, item] of cache.entries()) {
    if (Number(item?.expiraEm || 0) <= now) {
      cache.delete(id);
    }
  }
}

function limitarCache() {
  removerExpiradas();
  while (cache.size > MAX_ENTRIES) {
    const maisAntiga = cache.keys().next().value;
    if (!maisAntiga) break;
    cache.delete(maisAntiga);
  }
}

function lerCacheCopy(chave = "") {
  const id = String(chave || "");
  if (!id) return null;
  const item = cache.get(id);
  if (!item) return null;
  if (Number(item.expiraEm || 0) <= agoraMs()) {
    cache.delete(id);
    return null;
  }
  return item.valor || null;
}

function salvarCacheCopy(chave = "", valor = {}, ttlMs = TTL_PADRAO_MS) {
  const id = String(chave || "");
  if (!id || !valor || typeof valor !== "object") return null;
  limitarCache();
  if (!cache.has(id) && cache.size >= MAX_ENTRIES) {
    const maisAntiga = cache.keys().next().value;
    if (maisAntiga) cache.delete(maisAntiga);
  }
  const expiraEm = agoraMs() + Math.max(1000, Number(ttlMs) || TTL_PADRAO_MS);
  if (cache.has(id)) cache.delete(id);
  cache.set(id, { valor, expiraEm });
  return valor;
}

function ultimasFrases(chave = "") {
  return historico.get(String(chave || "")) || [];
}

function fraseImediatamenteAnterior(chave = "") {
  const lista = ultimasFrases(chave);
  return lista[0] || "";
}

function registrarFrase(chave = "", frase = "") {
  const id = String(chave || "");
  const texto = String(frase || "").trim();
  if (!id || !texto) return;
  const lista = [texto, ...ultimasFrases(id).filter(item => item !== texto)].slice(0, LIMITE_HISTORICO);
  historico.set(id, lista);
}

function limparCacheCopyInteligente() {
  cache.clear();
  historico.clear();
}

function tamanhoCacheCopyInteligente() {
  removerExpiradas();
  return cache.size;
}

module.exports = {
  TTL_PADRAO_MS,
  LIMITE_HISTORICO,
  MAX_ENTRIES,
  lerCacheCopy,
  salvarCacheCopy,
  removerExpiradas,
  fraseImediatamenteAnterior,
  registrarFrase,
  limparCacheCopyInteligente,
  tamanhoCacheCopyInteligente
};
