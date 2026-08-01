"use strict";

const crypto = require("crypto");
const {
  BUCKET_STATUS,
  classificarStatusFila,
  itemVivoFila,
  timestampFila,
  tipoOperacionalFila,
  TTL_ESTEIRA_MS
} = require("../ofc/absorption-gate.service");

const DEFAULT_LOTE_TAMANHO = 100;
const MAX_LOTE_TAMANHO = 1000;

const GRUPOS_ESTEIRA = Object.freeze({
  PRESERVAR_HISTORICO: "preservar_historico",
  PRESERVAR_ATIVO: "preservar_ativo",
  EXPIRAR: "expirar_esteira",
  AUDITAR: "aguardando_auditoria"
});

const STATUS_FINAL_EXPIRADO = "expirado_fluxo_vivo";

const CAMPOS_ID = ["id", "filaItemId", "fila_item_id", "itemFilaId", "item_fila_id"];
const CAMPOS_OFERTA_ID = ["ofertaId", "oferta_id", "idOferta"];
const CAMPOS_JOB_ID = ["jobId", "job_id", "engineJobId"];
const CAMPOS_DESTINO_ID = ["destinoId", "destino_id", "destino", "chatId", "grupoId", "jid", "canalId"];
const CAMPOS_TIMESTAMP = ["dataEntradaFila", "criadoEm", "adicionadoEm", "entradaFilaEm", "dataFila", "createdAt"];

const CHAVES_SENSIVEIS = /token|secret|senha|password|cookie|authorization|jwt|access[_-]?token|refresh[_-]?token|client[_-]?secret/i;

function texto(valor = "") {
  return String(valor ?? "").trim();
}

function normalizarStatus(item = {}) {
  return texto(item.status || item.situacao || "").toLowerCase();
}

function primeiroValor(item = {}, campos = []) {
  for (const campo of campos) {
    const valor = texto(item?.[campo]);
    if (valor) return { campo, valor };
  }
  return { campo: "", valor: "" };
}

function stableStringify(valor) {
  if (valor === null || typeof valor !== "object") return JSON.stringify(valor);
  if (Array.isArray(valor)) return `[${valor.map(stableStringify).join(",")}]`;
  return `{${Object.keys(valor).sort().map(chave => `${JSON.stringify(chave)}:${stableStringify(valor[chave])}`).join(",")}}`;
}

function sanitizarItem(valor, profundidade = 0) {
  if (profundidade > 8) return "[limite_profundidade]";
  if (valor === null || typeof valor !== "object") return valor;
  if (Array.isArray(valor)) return valor.slice(0, 80).map(item => sanitizarItem(item, profundidade + 1));

  const saida = {};
  for (const [chave, conteudo] of Object.entries(valor)) {
    if (CHAVES_SENSIVEIS.test(chave)) continue;
    saida[chave] = sanitizarItem(conteudo, profundidade + 1);
  }
  return saida;
}

function hashObjeto(valor) {
  return crypto.createHash("sha256").update(stableStringify(sanitizarItem(valor))).digest("hex");
}

function hashCurto(valor) {
  return hashObjeto(valor).slice(0, 16);
}

function ttlItemMs(item = {}) {
  return TTL_ESTEIRA_MS[tipoOperacionalFila(item)] || TTL_ESTEIRA_MS.desconhecido;
}

function parseData(valor) {
  const data = new Date(valor || "");
  const ms = data.getTime();
  return Number.isFinite(ms) ? ms : null;
}

function limitarLote(valor = DEFAULT_LOTE_TAMANHO) {
  const numero = Number(valor || DEFAULT_LOTE_TAMANHO);
  if (!Number.isFinite(numero) || numero <= 0) return DEFAULT_LOTE_TAMANHO;
  return Math.max(1, Math.min(MAX_LOTE_TAMANHO, Math.floor(numero)));
}

function gerarOperationId() {
  const base = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  return `esteiras-reset-${base}-${crypto.randomUUID().slice(0, 8)}`;
}

function identidadeItem(item = {}) {
  const id = primeiroValor(item, CAMPOS_ID);
  const oferta = primeiroValor(item, CAMPOS_OFERTA_ID);
  const job = primeiroValor(item, CAMPOS_JOB_ID);
  const destino = primeiroValor(item, CAMPOS_DESTINO_ID);
  const entrada = primeiroValor(item, CAMPOS_TIMESTAMP);
  const status = normalizarStatus(item);
  const itemHash = hashObjeto(item);

  const componentes = {
    id: id.valor,
    ofertaId: oferta.valor,
    jobId: job.valor,
    destinoId: destino.valor,
    dataEntradaFila: entrada.valor,
    status,
    hash: itemHash.slice(0, 24)
  };

  let tipo = "composta";
  let chave = "";
  if (id.valor) {
    tipo = "id";
    chave = `id:${id.valor}`;
  } else if (oferta.valor) {
    tipo = "ofertaId";
    chave = `oferta:${oferta.valor}|destino:${destino.valor}|entrada:${entrada.valor}|status:${status}`;
  } else if (job.valor) {
    tipo = "jobId";
    chave = `job:${job.valor}|destino:${destino.valor}|entrada:${entrada.valor}|status:${status}`;
  } else {
    chave = `comp:${destino.valor}|entrada:${entrada.valor}|status:${status}|hash:${itemHash.slice(0, 24)}`;
  }

  return {
    tipo,
    chave,
    componentes,
    camposUsados: Object.entries({ id: id.campo, ofertaId: oferta.campo, jobId: job.campo, destinoId: destino.campo, dataEntradaFila: entrada.campo })
      .filter(([, campo]) => campo)
      .map(([nome, campo]) => ({ nome, campo })),
    hashIndividual: itemHash
  };
}

function itemModificadoAposSnapshot(item = {}, cutoffMs = null) {
  const candidatos = ["atualizadoEm", "atualizado_em", "modificadoEm", "updatedAt", "retidaEm", "enviadoEm", "dataEnvio"];
  if (!cutoffMs) return false;
  for (const campo of candidatos) {
    const ms = parseData(item?.[campo]);
    if (ms !== null && ms > cutoffMs) return true;
  }
  return false;
}

function classificarItemResetEsteira(item = {}, { agoraMs = Date.now(), cutoffMs = Date.now(), colidiu = false } = {}) {
  const bucket = classificarStatusFila(item);
  const status = normalizarStatus(item) || "sem_status";
  const identidade = identidadeItem(item);

  if (colidiu) {
    return { grupo: GRUPOS_ESTEIRA.AUDITAR, motivo: "identidade_ambigua", bucket, status, identidade };
  }

  if (bucket === BUCKET_STATUS.STATUS_DESCONHECIDO) {
    return { grupo: GRUPOS_ESTEIRA.AUDITAR, motivo: "status_desconhecido", bucket, status, identidade };
  }

  if (!itemVivoFila(item)) {
    return { grupo: GRUPOS_ESTEIRA.PRESERVAR_HISTORICO, motivo: "fora_pressao_viva", bucket, status, identidade };
  }

  if (bucket === BUCKET_STATUS.EM_TENTATIVA || bucket === BUCKET_STATUS.ERRO_TEMPORARIO_RECUPERAVEL) {
    return { grupo: GRUPOS_ESTEIRA.PRESERVAR_ATIVO, motivo: "em_tentativa_ou_retry", bucket, status, identidade };
  }

  const timestamp = timestampFila(item);
  if (timestamp.ms === null) {
    return { grupo: GRUPOS_ESTEIRA.AUDITAR, motivo: "sem_timestamp", bucket, status, identidade };
  }

  if (timestamp.ms > cutoffMs || itemModificadoAposSnapshot(item, cutoffMs)) {
    return { grupo: GRUPOS_ESTEIRA.PRESERVAR_ATIVO, motivo: "novo_ou_modificado_apos_cutoff", bucket, status, identidade, timestamp };
  }

  const idadeMs = Math.max(0, agoraMs - timestamp.ms);
  const ttlMs = ttlItemMs(item);
  if (idadeMs >= ttlMs) {
    return { grupo: GRUPOS_ESTEIRA.EXPIRAR, motivo: "pendente_vencido_fluxo_vivo", bucket, status, identidade, timestamp, idadeMs, ttlMs };
  }

  return { grupo: GRUPOS_ESTEIRA.PRESERVAR_ATIVO, motivo: "dentro_ttl", bucket, status, identidade, timestamp, idadeMs, ttlMs };
}

function resumoLeveItem(item = {}, classificacao = {}) {
  const titulo = texto(item.titulo || item.nome || item.produto || item.descricao || "").slice(0, 180);
  return {
    titulo,
    marketplace: texto(item.marketplace || item.marketplaceDetectado || item.loja || ""),
    ofertaId: primeiroValor(item, CAMPOS_OFERTA_ID).valor,
    jobId: primeiroValor(item, CAMPOS_JOB_ID).valor,
    destinoId: primeiroValor(item, CAMPOS_DESTINO_ID).valor,
    dataEntradaFila: primeiroValor(item, CAMPOS_TIMESTAMP).valor,
    motivo: classificacao.motivo || "expirado_fluxo_vivo",
    statusFinal: STATUS_FINAL_EXPIRADO,
    workspaceId: texto(item.clienteId || item.workspaceId || "")
  };
}

module.exports = {
  DEFAULT_LOTE_TAMANHO,
  GRUPOS_ESTEIRA,
  STATUS_FINAL_EXPIRADO,
  limitarLote,
  gerarOperationId,
  stableStringify,
  sanitizarItem,
  hashObjeto,
  hashCurto,
  identidadeItem,
  classificarItemResetEsteira,
  resumoLeveItem
};
