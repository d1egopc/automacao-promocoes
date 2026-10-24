"use strict";

const crypto = require("node:crypto");

const GROUP_CARDS = new Set(["commands", "groupManager", "welcome", "farewell"]);
const PRIVATE_CARDS = new Set(["attendance", "faq", "flows", "quickReplies"]);

function cardActive(profile, card) {
  if (card === "attendance") return [...PRIVATE_CARDS].some(name => profile.cards?.[name]?.active === true);
  return profile.cards?.[card]?.active === true;
}

function allowedGroups(profile, card) {
  const config = profile.cards?.[card]?.configuration || {};
  const own = Array.isArray(config.grupos) ? config.grupos : [];
  const inherited = Array.isArray(profile.destinations) ? profile.destinations : [];
  return (config.gruposConfigurados === true || own.length ? own : inherited).map(String);
}

function selectProfile(store, { workspaceId, sessionId, card, groupId = "" }) {
  store.reload();
  const profiles = Object.values(store.snapshot().workspaces?.[String(workspaceId)]?.profiles || {});
  const anyActive = profiles.some(profile => profile.workspaceId === String(workspaceId) && profile.active === true);
  const session = profiles.filter(profile => profile.workspaceId === String(workspaceId) &&
    profile.sessionId === String(sessionId) && profile.active === true);
  const active = session.filter(profile => cardActive(profile, card));
  const eligible = GROUP_CARDS.has(card)
    ? active.filter(profile => groupId && allowedGroups(profile, card).includes(String(groupId)))
    : PRIVATE_CARDS.has(card) ? active : [];
  if (eligible.length !== 1) return {
    profileId: "",
    reason: !session.length ? (anyActive ? "SESSAO_INCORRETA" : "PERFIL_INATIVO") : !active.length ? "CARD_INATIVO" :
      !eligible.length ? "GRUPO_NAO_AUTORIZADO" : "PERFIL_AMBIGUO"
  };
  return { profileId: eligible[0].id, reason: "" };
}

function eventIdentity({ message, event, card, now = Date.now() }) {
  if (message?.key?.id) return String(message.key.id);
  if (!event?.id || !event?.action || !Array.isArray(event.participants) || !event.participants.length) return "";
  // Baileys participant updates do not always carry an event ID. A bounded
  // bucket avoids the old permanent group-ID claim and absorbs quick replays.
  const instant = Number(event.timestamp) || Math.floor(now / 30_000);
  return crypto.createHash("sha256").update(JSON.stringify([
    card, event.id, event.action, [...event.participants].map(String).sort(), instant
  ])).digest("hex");
}

function scheduledPayload(content) {
  const raw = content && typeof content === "object" && !Array.isArray(content) ? content : {};
  const entries = Array.isArray(raw.conteudos) && raw.conteudos.length ? raw.conteudos : [raw];
  const index = Math.max(0, Number(raw.indiceAtual) || 0) % entries.length;
  const selected = entries[index] && typeof entries[index] === "object" ? entries[index] : {};
  const tipo = selected.tipo || (selected.imagem ? "imagem" : "texto");
  const texto = typeof selected.texto === "string" ? selected.texto :
    typeof selected.text === "string" ? selected.text : "";
  const imagem = typeof selected.imagem === "string" ? selected.imagem : "";
  if (tipo === "texto" && texto.trim()) return { text: texto };
  if (!["imagem", "imagem_texto"].includes(tipo) || !imagem) throw new Error("conteudo_programacao_invalido");
  const image = imagem.startsWith("data:image/")
    ? Buffer.from(imagem.split(",", 2)[1] || "", "base64")
    : { url: imagem };
  if (Buffer.isBuffer(image) && !image.length) throw new Error("imagem_programacao_invalida");
  return tipo === "imagem_texto" && texto ? { image, caption: texto } : { image };
}

function authorizedDestination({ workspaceId, sessionId, destination, sessionMeta, groups, belongsToWorkspace }) {
  if (!sessionId || !destination || !sessionMeta || typeof belongsToWorkspace !== "function" ||
    belongsToWorkspace(sessionMeta, workspaceId) !== true) return false;
  return Array.isArray(groups) && groups.some(group =>
    String(group?.id || group?.jid || group?.grupoId || "") === String(destination));
}

function createOperationalIngress({ store, bridge, recoveryDisabled = () => false, clock = () => Date.now(), diagnostic = () => {} }) {
  if (!store || !bridge || typeof bridge.dispatch !== "function") throw new Error("ingress_v3_dependencias_obrigatorias");
  return async ({ workspaceId, sessionId, card, message, event, sock, planAllowed }) => {
    const groupId = message?.key?.remoteJid || event?.id || "";
    const report = (stage, reason, profileId = "") => diagnostic({ workspaceId, sessionId, groupId, card, stage, reason, profileId });
    const blocked = reason => { report("blocked", reason); return { blocked: true, reason }; };
    if (recoveryDisabled()) return blocked("TRANSPORTE_INDISPONIVEL");
    if (planAllowed !== true) return blocked("PLANO_BLOQUEADO");
    const selected = selectProfile(store, { workspaceId, sessionId, card, groupId });
    if (!selected.profileId) return blocked(selected.reason);
    const eventId = eventIdentity({ message, event, card, now: clock() });
    if (!eventId) return blocked("EVENTO_NAO_RECEBIDO");
    report("profile_selected", "", selected.profileId);
    let outcome;
    try {
      outcome = await bridge.dispatch({
        workspaceId, profileId: selected.profileId, card, eventId,
        args: { clienteId: workspaceId, sessaoId: sessionId, sock, mensagem: message, evento: event, planoLiberado: planAllowed }
      });
    } catch (error) {
      report("handler_error", error?.code || "handler_error", selected.profileId);
      throw error;
    }
    if (outcome.ok === true) { report("handler_returned", "", selected.profileId); return outcome.result; }
    return blocked(outcome.reason === "claim_existente" ? "CLAIM_EXISTENTE" : outcome.reason || "CONFIGURACAO_NAO_AUTORIZADA");
  };
}

module.exports = { selectProfile, eventIdentity, scheduledPayload, authorizedDestination, createOperationalIngress };
