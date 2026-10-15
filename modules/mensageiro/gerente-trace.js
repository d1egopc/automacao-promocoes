const crypto = require("crypto");

const TRACE_WORKSPACE_ID = "user_k3phmbkf";
const TRACE_FILE = "mensageiro-gerente-trace.json";
const TRACE_MAX_RECORDS = 120;
const TRACE_MAX_BYTES = 64 * 1024;
const TRACE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const TEMPORARY_TRACE_UNTIL = Date.parse("2026-10-16T18:00:00Z");
const TEMPORARY_SESSION_ID = "user_k3phmbkf_Servmaq";
const TEMPORARY_PROGRAM_ID = "5b31e3c6-9aaa-481c-b5f2-a47ec2b3f618";
const TRACE_CODES = new Set([
  "received",
  "tenant_resolved",
  "tenant_mismatch",
  "usuario_inativo_listener",
  "radar_returned",
  "mensageiro_dispatched",
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

function explicitTraceEnabled(env = process.env) {
  return /^(1|true|sim|yes|on)$/i.test(String(env.SERVMAQ_GERENTE_TRACE_ENABLED || "").trim());
}

function temporaryTraceEnabled({ clienteId, sessaoId, env = process.env, now = Date.now() } = {}) {
  return now < TEMPORARY_TRACE_UNTIL && Boolean(env.JWT_SECRET) &&
    String(clienteId || "") === TRACE_WORKSPACE_ID && String(sessaoId || "") === TEMPORARY_SESSION_ID;
}

function traceEnabled(env = process.env, scope = {}) {
  return explicitTraceEnabled(env) || temporaryTraceEnabled({ ...scope, env });
}

function traceSecret(env = process.env) {
  const dedicated = String(env.SERVMAQ_GERENTE_TRACE_SECRET || "").trim();
  if (dedicated) return dedicated;
  const appSecret = String(env.JWT_SECRET || "").trim();
  if (explicitTraceEnabled(env)) return appSecret;
  return appSecret
    ? crypto.createHmac("sha256", appSecret).update("servmaq-gerente-trace-v1").digest("hex")
    : "";
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

function temporaryTargetGroup(config = {}) {
  const managers = list(config.perfis).filter(profile =>
    profile && profile.ativo === true && profile.removido !== true && !profile.removidoEm &&
    sessionOf(profile) === TEMPORARY_SESSION_ID && profile.modulos?.gerente?.ativo === true
  );
  if (managers.length !== 1) return "";
  const manager = managers[0];
  const groups = manager.modulos.gerente.gruposConfigurados === true
    ? list(manager.modulos.gerente.grupos)
    : list(manager.grupos);
  if (groups.length !== 1) return "";
  const group = idOf(groups[0]);
  const program = list(config.programacoes).find(item => item?.id === TEMPORARY_PROGRAM_ID);
  const programGroups = list(program?.grupos || program?.gruposIds).map(idOf);
  return group && programGroups.length === 1 && programGroups[0] === group ? group : "";
}

function isTraceTarget({ clienteId, sessaoId, grupoId, config, env = process.env, now = Date.now() } = {}) {
  if (!traceEnabled(env, { clienteId, sessaoId, now }) || String(clienteId || "") !== TRACE_WORKSPACE_ID) return false;
  const secret = traceSecret(env);
  if (!secret) return false;
  const scope = configuredScope(config);
  const session = String(sessaoId || "").trim();
  const group = String(grupoId || "").trim();
  if (!session || !group || !scope.sessionIds.has(session) || !scope.groupIds.has(group)) return false;
  if (!explicitTraceEnabled(env)) {
    return temporaryTraceEnabled({ clienteId, sessaoId, env, now }) && group === temporaryTargetGroup(config);
  }
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
  const timestamp = now();
  const timestampMs = Date.parse(timestamp);
  const agoraMs = Number.isFinite(timestampMs) ? timestampMs : Date.now();
  if (!TRACE_CODES.has(String(codigo)) || !isTraceTarget({ clienteId, sessaoId, grupoId, config, env, now: agoraMs })) return false;
  if (typeof readClienteJson !== "function" || typeof writeClienteJson !== "function") return false;
  const secret = traceSecret(env);
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
  temporaryTraceEnabled,
  temporaryTargetGroup,
  TEMPORARY_TRACE_UNTIL,
  hashIdentifier,
  isTraceTarget,
  appendTrace
};
