const crypto = require("crypto");

const TRACE_WORKSPACE_ID = "user_k3phmbkf";
const TRACE_FILE = "mensageiro-gerente-trace.json";
const TRACE_MAX_RECORDS = 120;
const TRACE_MAX_BYTES = 64 * 1024;
const TRACE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const TRACE_CODES = new Set([
  "received",
  "handler_called",
  "usuario_inativo",
  "plano_nao_liberado",
  "from_me",
  "participante_nao_resolvido",
  "key_incompleta",
  "profile_resolved",
  "profile_not_resolved",
  "manager_inactive",
  "rules_empty",
  "rule_match",
  "isento",
  "bot_sem_admin",
  "delete_ok",
  "delete_erro",
  "aviso_ok",
  "aviso_erro"
]);

function traceEnabled(env = process.env) {
  return /^(1|true|sim|yes|on)$/i.test(String(env.SERVMAQ_GERENTE_TRACE_ENABLED || "").trim());
}

function traceSecret(env = process.env) {
  return String(env.SERVMAQ_GERENTE_TRACE_SECRET || env.JWT_SECRET || "").trim();
}

function hashIdentifier(value, secret) {
  if (!value || !secret) return "";
  return crypto.createHmac("sha256", secret).update(String(value)).digest("hex").slice(0, 16);
}

function idOf(value) {
  if (value && typeof value === "object") {
    return String(value.id || value.jid || value.grupoId || value.groupId || value.remoteJid || "").trim();
  }
  return String(value || "").trim();
}

function sessionOf(value) {
  return String(value?.sessaoId || value?.sessaoWhatsappId || value?.sessaoGruposId || "").trim();
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function configuredScope(config = {}) {
  const sessionIds = new Set([
    config.sessaoId,
    config.sessaoWhatsappId,
    config.sessaoGruposId,
    ...list(config.perfis).map(sessionOf),
    ...list(config.programacoes).map(sessionOf)
  ].map(value => String(value || "").trim()).filter(Boolean));
  const groupIds = new Set([
    ...list(config.grupos).map(idOf),
    ...list(config.programacoes).flatMap(program => list(program?.grupos || program?.gruposIds).map(idOf))
  ].filter(Boolean));
  for (const profile of list(config.perfis)) {
    if (!profile || profile.removido === true || profile.removed === true || profile.excluido === true || profile.ativo === false) continue;
    const manager = profile.modulos?.gerente || {};
    if (manager.ativo !== true) continue;
    const effectiveGroups = manager.gruposConfigurados === true ? list(manager.grupos) : list(profile.grupos);
    effectiveGroups.map(idOf).filter(Boolean).forEach(groupId => groupIds.add(groupId));
    const profileSession = sessionOf(profile);
    if (profileSession) sessionIds.add(profileSession);
  }
  return { sessionIds, groupIds };
}

function isTraceTarget({ clienteId, sessaoId, grupoId, config, env = process.env } = {}) {
  if (!traceEnabled(env) || String(clienteId || "") !== TRACE_WORKSPACE_ID) return false;
  const secret = traceSecret(env);
  if (!secret) return false;
  const scope = configuredScope(config);
  const session = String(sessaoId || "").trim();
  const group = String(grupoId || "").trim();
  if (!session || !group || !scope.sessionIds.has(session) || !scope.groupIds.has(group)) return false;
  const expectedSessionHash = String(env.SERVMAQ_GERENTE_TRACE_SESSION_HASH || "").trim();
  const expectedGroupHash = String(env.SERVMAQ_GERENTE_TRACE_GROUP_HASH || "").trim();
  if (!expectedSessionHash || !expectedGroupHash) return false;
  if (hashIdentifier(session, secret) !== expectedSessionHash) return false;
  if (hashIdentifier(group, secret) !== expectedGroupHash) return false;
  return true;
}

function safeCode(value) {
  return String(value || "").replace(/[^a-z0-9_:-]/gi, "_").slice(0, 80);
}

function appendTrace({
  clienteId,
  sessaoId,
  grupoId,
  perfilId,
  regraId,
  mensagemId,
  etapa = "gerente",
  codigo = "",
  config,
  readClienteJson,
  writeClienteJson,
  env = process.env,
  now = () => new Date().toISOString()
} = {}) {
  if (!TRACE_CODES.has(String(codigo)) || !isTraceTarget({ clienteId, sessaoId, grupoId, config, env })) return false;
  if (typeof readClienteJson !== "function" || typeof writeClienteJson !== "function") return false;
  const secret = traceSecret(env);
  const timestamp = now();
  const timestampMs = Date.parse(timestamp);
  const agoraMs = Number.isFinite(timestampMs) ? timestampMs : Date.now();
  const row = {
    timestamp,
    etapa: safeCode(etapa),
    codigo: safeCode(codigo),
    workspaceHash: hashIdentifier(clienteId, secret),
    sessionHash: hashIdentifier(sessaoId, secret),
    groupHash: hashIdentifier(grupoId, secret),
    profileHash: hashIdentifier(perfilId, secret),
    ruleHash: hashIdentifier(regraId, secret),
    messageHash: hashIdentifier(mensagemId, secret)
  };
  try {
    const atual = readClienteJson(TRACE_WORKSPACE_ID, TRACE_FILE, { versao: 1, eventos: [] });
    const eventos = list(atual?.eventos)
      .filter(item => {
        const itemMs = Date.parse(item?.timestamp || "");
        return Number.isFinite(itemMs) && itemMs >= agoraMs - TRACE_MAX_AGE_MS;
      })
      .slice(-(TRACE_MAX_RECORDS - 1));
    eventos.push(row);
    while (JSON.stringify({ versao: 1, eventos }).length > TRACE_MAX_BYTES && eventos.length > 1) eventos.shift();
    writeClienteJson(TRACE_WORKSPACE_ID, TRACE_FILE, { versao: 1, eventos });
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  TRACE_FILE,
  TRACE_WORKSPACE_ID,
  TRACE_MAX_RECORDS,
  TRACE_MAX_BYTES,
  TRACE_MAX_AGE_MS,
  traceEnabled,
  hashIdentifier,
  isTraceTarget,
  appendTrace
};
