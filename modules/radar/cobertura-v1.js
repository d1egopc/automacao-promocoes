const crypto = require("crypto");

const TAG_COBERTURA_RADAR_V1 = "[RADAR-COBERTURA-V1]";
const CAMPOS_PADRAO = [
  "coberturaTraceId",
  "fidelidadeTraceId",
  "etapa",
  "decisao",
  "motivo",
  "mensagemId",
  "clienteId",
  "sessaoId",
  "remoteJid",
  "grupoId",
  "grupoNome",
  "marketplace",
  "links",
  "link",
  "eventoEngineId",
  "jobId",
  "ofertaId",
  "filaItemId",
  "destinoId",
  "destinoNome",
  "destinoEncontrado",
  "filaRecebeu",
  "statusFilaAntes",
  "statusFilaDepois",
  "tentativaEnvio",
  "enviadoEm",
  "erroEnvio",
  "registradoEm"
];

function flagAtiva() {
  const valor = String(process.env.RADAR_COBERTURA_AUDITORIA_ENABLED || "")
    .trim()
    .toLowerCase();
  return ["1", "true", "sim", "yes", "on"].includes(valor);
}

function texto(valor = "") {
  return String(valor || "").trim();
}

function hashCurto(valor = "") {
  return crypto.createHash("sha256").update(String(valor || "")).digest("hex").slice(0, 16);
}

function extrairMensagemId(mensagem = {}, contexto = {}) {
  return texto(
    contexto.mensagemId ||
    mensagem?.key?.id ||
    mensagem?.id ||
    mensagem?.messageId ||
    ""
  );
}

function extrairFidelidadeTraceId(...fontes) {
  for (const fonte of fontes) {
    if (!fonte || typeof fonte !== "object") continue;
    const direto = texto(fonte.fidelidadeTraceId || fonte.fidelidade_trace_id || "");
    if (direto) return direto;
    const metadata = fonte.metadata && typeof fonte.metadata === "object" ? fonte.metadata : {};
    const metaTrace = texto(metadata.fidelidadeTraceId || metadata.fidelidade_trace_id || "");
    if (metaTrace) return metaTrace;
  }
  return "";
}

function criarCoberturaTraceId(mensagem = {}, contexto = {}) {
  if (!flagAtiva()) return "";

  const existente = texto(
    contexto.coberturaTraceId ||
    mensagem?.coberturaTraceId ||
    mensagem?.metadata?.coberturaTraceId ||
    ""
  );
  if (existente) return existente;

  const mensagemId = extrairMensagemId(mensagem, contexto);
  if (mensagemId) return `cov_${hashCurto(`mensagem:${mensagemId}`)}`;

  const key = mensagem?.key || {};
  const assinatura = {
    remoteJid: texto(contexto.remoteJid || key.remoteJid || ""),
    participant: texto(key.participant || mensagem?.participant || ""),
    timestamp: texto(mensagem?.messageTimestamp || mensagem?.timestamp || contexto.messageTimestamp || ""),
    tipo: Object.keys(mensagem?.message || {}).sort(),
    status: texto(mensagem?.status || ""),
    stubType: texto(mensagem?.messageStubType || ""),
    loteTraceId: texto(contexto.loteTraceId || ""),
    indiceLote: Number.isFinite(Number(contexto.indiceLote)) ? Number(contexto.indiceLote) : null
  };

  return `cov_${hashCurto(JSON.stringify(assinatura))}`;
}

function sanitizarUrl(url = "") {
  const valor = texto(url);
  if (!valor) return "";
  if (/^data:/i.test(valor)) return "data_uri";

  try {
    const parsed = new URL(valor);
    const temBusca = parsed.search || parsed.hash;
    parsed.search = temBusca ? "?[params]" : "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return valor.length > 220 ? `${valor.slice(0, 220)}...` : valor;
  }
}

function sanitizarLinks(links = []) {
  const lista = Array.isArray(links) ? links : [links].filter(Boolean);
  return lista.map(sanitizarUrl);
}

function normalizarPayload(etapa = "", dados = {}) {
  const payload = {};
  const links = dados.links || dados.linksExtraidos || dados.linksEncontrados || [];

  for (const campo of CAMPOS_PADRAO) {
    payload[campo] = dados[campo] ?? "";
  }

  payload.etapa = texto(etapa || dados.etapa);
  payload.decisao = texto(dados.decisao || "");
  payload.motivo = texto(dados.motivo || "");
  payload.coberturaTraceId = texto(dados.coberturaTraceId || "");
  payload.fidelidadeTraceId = texto(dados.fidelidadeTraceId || "");
  payload.mensagemId = texto(dados.mensagemId || "");
  payload.clienteId = texto(dados.clienteId || "");
  payload.sessaoId = texto(dados.sessaoId || "");
  payload.remoteJid = texto(dados.remoteJid || "");
  payload.grupoId = texto(dados.grupoId || "");
  payload.grupoNome = texto(dados.grupoNome || "");
  payload.marketplace = texto(dados.marketplace || "");
  payload.links = sanitizarLinks(links);
  payload.link = sanitizarUrl(dados.link || "");
  payload.eventoEngineId = dados.eventoEngineId ?? dados.eventoId ?? "";
  payload.jobId = dados.jobId ?? dados.job_id ?? "";
  payload.ofertaId = dados.ofertaId ?? dados.oferta_id ?? "";
  payload.filaItemId = dados.filaItemId ?? dados.itemFilaId ?? dados.itemId ?? "";
  payload.destinoId = dados.destinoId ?? "";
  payload.destinoNome = texto(dados.destinoNome || "");
  payload.destinoEncontrado = dados.destinoEncontrado === true;
  payload.filaRecebeu = dados.filaRecebeu === true;
  payload.statusFilaAntes = texto(dados.statusFilaAntes || "");
  payload.statusFilaDepois = texto(dados.statusFilaDepois || "");
  payload.tentativaEnvio = dados.tentativaEnvio ?? "";
  payload.enviadoEm = texto(dados.enviadoEm || "");
  payload.erroEnvio = texto(dados.erroEnvio || "");
  payload.registradoEm = dados.registradoEm || new Date().toISOString();

  for (const [chave, valor] of Object.entries(dados)) {
    if (Object.prototype.hasOwnProperty.call(payload, chave)) continue;
    if (chave === "linksExtraidos" || chave === "linksEncontrados") continue;
    if (chave === "linkOriginal" || chave === "linkAfiliado" || chave === "linkFinal") {
      payload[chave] = sanitizarUrl(valor);
      continue;
    }
    payload[chave] = valor;
  }

  return payload;
}

function registrar(etapa = "", dados = {}) {
  if (!flagAtiva()) return false;
  const payload = normalizarPayload(etapa, dados);
  try {
    console.log(TAG_COBERTURA_RADAR_V1, JSON.stringify(payload));
  } catch {
    console.log(TAG_COBERTURA_RADAR_V1);
  }
  return true;
}

function anexarContexto(destino = {}, contexto = {}) {
  if (!flagAtiva() || !destino || typeof destino !== "object") return destino;
  const coberturaTraceId = texto(contexto.coberturaTraceId || "");
  if (!coberturaTraceId) return destino;
  destino.coberturaTraceId = coberturaTraceId;
  destino.metadata = {
    ...(destino.metadata && typeof destino.metadata === "object" ? destino.metadata : {}),
    coberturaTraceId
  };
  return destino;
}

module.exports = {
  TAG_COBERTURA_RADAR_V1,
  flagAtiva,
  criarCoberturaTraceId,
  extrairMensagemId,
  extrairFidelidadeTraceId,
  registrar,
  anexarContexto,
  sanitizarUrl,
  sanitizarLinks
};
