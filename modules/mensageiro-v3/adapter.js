"use strict";

// M3.2 isolated integration seam. This module deliberately does not replace
// the production Mensageiro routes or scheduler. It gives the four real cards
// one explicit contract for a later, feature-gated cutover.
const { INTEGRATION_MATRIX } = require("./src/v3/integration-matrix");

const REAL_CARD_ADAPTERS = Object.freeze({
  scheduledMessages: Object.freeze({
    card: "scheduled",
    existingRoute: "/mensageiro/config",
    existingExecutor: "programacoes.scheduler.js",
    v3Status: INTEGRATION_MATRIX.scheduledMessages.status
  }),
  commands: Object.freeze({
    card: "commands",
    existingRoute: "/mensageiro/config",
    existingExecutor: "tratarMensagemGrupoComando",
    v3Status: INTEGRATION_MATRIX.commands.status
  }),
  attendance: Object.freeze({
    card: "attendance",
    existingRoute: "/mensageiro/perfis/:perfilId/atendimento",
    existingExecutor: "tratarMensagemPrivadaAtendimento",
    v3Status: INTEGRATION_MATRIX.attendance.status
  }),
  groupManager: Object.freeze({
    card: "groupManager",
    existingRoute: "/mensageiro/gerente/status",
    existingExecutor: "tratarMensagemGrupoGerente",
    v3Status: INTEGRATION_MATRIX.groupManager.status
  })
});

function buildCardIntegrationMatrix() {
  return Object.fromEntries(Object.entries(REAL_CARD_ADAPTERS).map(([name, value]) => [name, { ...value }]));
}

function assertSimulatedAdapter(adapter, name) {
  if (!adapter || typeof adapter.authorize !== "function" || typeof adapter.send !== "function") {
    throw new Error(`adapter_simulado_invalido:${name}`);
  }
  return {
    authorize: adapter.authorize,
    send: adapter.send
  };
}

// The scheduler is intentionally injectable. Production transports are never
// imported here; tests provide simulated adapters with no WhatsApp session.
function createSimulatedCardAdapters(adapters = {}) {
  return Object.fromEntries(Object.keys(REAL_CARD_ADAPTERS).map(name => [
    name,
    assertSimulatedAdapter(adapters[name], name)
  ]));
}

function createCardRuntime({ store, adapters = {} } = {}) {
  if (!store || typeof store.canExecuteCard !== "function") throw new Error("store_v3_obrigatorio");
  const simulated = createSimulatedCardAdapters(adapters);
  return async function executeCardAction({ workspaceId, profileId, card, payload = {}, claimKey }) {
    const descriptor = Object.values(REAL_CARD_ADAPTERS).find(item => item.card === card);
    if (!descriptor) return { ok: false, reason: "card_invalido" };
    const profile = store.getProfile(workspaceId, profileId);
    if (!profile || profile.active !== true || profile.cards?.[card]?.active !== true) {
      return { ok: false, reason: "card_inativo" };
    }
    const adapterName = Object.keys(REAL_CARD_ADAPTERS).find(name => REAL_CARD_ADAPTERS[name].card === card);
    const adapter = simulated[adapterName];
    if ((await adapter.authorize({ workspaceId, profileId, card, payload })) !== true) {
      return { ok: false, reason: "autorizacao_negada" };
    }
    store.reload();
    const fresh = store.getProfile(workspaceId, profileId);
    if (!fresh || fresh.active !== true || fresh.cards?.[card]?.active !== true || fresh.revision !== profile.revision) {
      return { ok: false, reason: "configuracao_alterada" };
    }
    const key = String(claimKey || `${workspaceId}:${profileId}:${card}:${payload.id || payload.eventId || "once"}`);
    if (!store.claimExecution(workspaceId, key, { profileId, card })) return { ok: false, duplicate: true, reason: "claim_existente" };
    store.reload();
    const beforeSend = store.getProfile(workspaceId, profileId);
    if (!beforeSend || beforeSend.active !== true || beforeSend.cards?.[card]?.active !== true || beforeSend.revision !== fresh.revision) {
      return { ok: false, reason: "configuracao_alterada" };
    }
    try {
      const result = await adapter.send({ workspaceId, profileId, card, ...payload });
      if (typeof store.completeExecution === "function") store.completeExecution(workspaceId, key, { status: result?.ambiguous === true || result?.confirmed === false ? "ambiguous" : "confirmed" });
      return { ok: true, card, profileId, workspaceId, ambiguous: result?.ambiguous === true || result?.confirmed === false };
    } catch (error) {
      if (typeof store.completeExecution === "function") store.completeExecution(workspaceId, key, { status: "failed" });
      throw error;
    }
  };
}

module.exports = { REAL_CARD_ADAPTERS, buildCardIntegrationMatrix, createSimulatedCardAdapters, createCardRuntime };
