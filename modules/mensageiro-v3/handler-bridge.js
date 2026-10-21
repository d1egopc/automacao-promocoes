"use strict";

// Candidate-only ingress gate for the real Mensageiro handlers.  Unmigrated
// workspaces keep the existing handlers unchanged.  Once a workspace is
// durably marked as V3, every ingress must pass the V3 profile/card gate; a
// missing V3 handler fails closed instead of silently falling back to legacy.

const CARD_NAMES = Object.freeze([
  "scheduled",
  "commands",
  "attendance",
  "groupManager",
  "welcome",
  "farewell",
  "faq",
  "flows",
  "quickReplies"
]);

function createHandlerBridge({ fence, store, legacyHandlers = {}, v3Handlers = {}, logger = () => {} } = {}) {
  if (!fence || typeof fence.v3Required !== "function") throw new Error("fence_v3_obrigatorio");
  if (!store || typeof store.getProfile !== "function") throw new Error("store_v3_obrigatorio");

  const invoke = async ({ workspaceId, profileId, card, args = {}, eventId = "", claimKey = "" } = {}) => {
    const workspace = String(workspaceId || "").trim();
    const profile = String(profileId || "").trim();
    const cardName = String(card || "").trim();
    if (!workspace || !profile || !CARD_NAMES.includes(cardName)) return { ok: false, blocked: true, reason: "contexto_v3_invalido" };

    let v3Required;
    let legacyAllowed;
    try {
      v3Required = fence.v3Required(workspace) === true;
      legacyAllowed = typeof fence.legacyAllowed === "function" ? fence.legacyAllowed(workspace) === true : !v3Required;
    } catch (error) {
      logger({ workspaceId: workspace, profileId: profile, card: cardName, reason: "fence_indisponivel", error: error?.message || String(error) });
      return { ok: false, blocked: true, reason: "fence_indisponivel" };
    }

    if (!v3Required && legacyAllowed) {
      const legacy = legacyHandlers[cardName];
      if (typeof legacy !== "function") return { ok: false, blocked: true, reason: "handler_legado_indisponivel" };
      return { ok: true, mode: "legacy", result: await legacy(args) };
    }

    if (!v3Required) return { ok: false, blocked: true, reason: "fence_transicao_incompleta" };

    const cardAtivo = current => cardName === "attendance"
      ? ["attendance", "faq", "flows", "quickReplies"].some(name => current?.cards?.[name]?.active === true)
      : current?.cards?.[cardName]?.active === true;
    store.reload();
    let current = store.getProfile(workspace, profile);
    if (!current || current.workspaceId !== workspace || current.active !== true || !cardAtivo(current)) {
      return { ok: false, blocked: true, reason: "card_v3_inativo" };
    }

    const v3 = v3Handlers[cardName];
    if (typeof v3 !== "function") {
      logger({ workspaceId: workspace, profileId: profile, card: cardName, reason: "handler_v3_indisponivel" });
      return { ok: false, blocked: true, reason: "handler_v3_indisponivel" };
    }

    const key = String(claimKey || `${workspace}:${profile}:${cardName}:${eventId || "once"}`);
    if (typeof store.claimExecution === "function" && !store.claimExecution(workspace, key, { profileId: profile, card: cardName })) {
      return { ok: false, blocked: true, duplicate: true, reason: "claim_existente" };
    }

    // The real handler is invoked only after an immediate durable re-read.
    store.reload();
    current = store.getProfile(workspace, profile);
    if (!current || current.workspaceId !== workspace || current.active !== true || !cardAtivo(current)) {
      return { ok: false, blocked: true, reason: "configuracao_alterada" };
    }
    try {
      const result = await v3({ ...args, workspaceId: workspace, profileId: profile, card: cardName });
      if (typeof store.completeExecution === "function") store.completeExecution(workspace, key, { status: result?.ambiguous === true || result?.confirmed === false ? "ambiguous" : "confirmed" });
      return { ok: true, mode: "v3", result };
    } catch (error) {
      if (typeof store.completeExecution === "function") store.completeExecution(workspace, key, { status: "failed" });
      throw error;
    }
  };

  return Object.freeze({
    cards: CARD_NAMES,
    dispatch: invoke,
    legacyAllowed(workspaceId) { return fence.legacyAllowed(workspaceId); },
    v3Required(workspaceId) { return fence.v3Required(workspaceId); }
  });
}

module.exports = { CARD_NAMES, createHandlerBridge };
