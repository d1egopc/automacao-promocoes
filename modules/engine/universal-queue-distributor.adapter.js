"use strict";

// Inject as the Distributor's queue callback only in UNIVERSAL mode. The
// legacy callback ignores the optional third argument and stays unchanged.
const { enqueue } = require("./universal-queue.repository");
const { normalizarAlvosDestino, chaveAlvo } =
  require("../../utils/destinos-multialvo");

function normalizarDestinosAplicaveis(destinations, {
  workspaceId, resolveTelegramTargets
} = {}) {
  if (!Array.isArray(destinations)) throw new Error("distributor_destinations_missing");
  return destinations.flatMap(destination => {
    const destinationId = String(destination?.id || destination?.destinoId || "").trim();
    const channel = String(destination?.canal || destination?.tipo || "").trim().toLowerCase();
    if (!destinationId) throw new Error("distributor_destination_identity_missing");
    const targets = channel === "telegram"
      ? (typeof resolveTelegramTargets === "function"
        ? resolveTelegramTargets(workspaceId, destination) : null)
      : normalizarAlvosDestino(destination);
    if (!Array.isArray(targets) || targets.length === 0) {
      throw new Error("distributor_target_snapshot_unproven");
    }
    return targets.map(target => {
      const targetKey = String(target?.targetKey || chaveAlvo(target) || "").trim();
      const connectionId = String(target?.connectionId || target?.conexaoId ||
        target?.sessao || "").trim();
      if (!targetKey) throw new Error("distributor_target_identity_missing");
      return { destinationId, channel, targetKey, connectionId };
    });
  });
}

function criarCallbackFilaUniversal({ pool, enqueueFn = enqueue,
  resolveTelegramTargets }) {
  if (!pool || typeof pool.connect !== "function") throw new Error("queue_pool_required");
  return async (clienteId, itemFila, contexto = {}) => {
    const offer = contexto.oferta;
    if (!offer || String(itemFila?.clienteId || "") !== String(clienteId || "") ||
        String(itemFila?.engineOfertaId || "") !== String(offer.id || "") ||
        String(itemFila?.engineJobId || "") !== String(offer.job_id || "")) {
      return { ok: false, motivo: "queue_distributor_identity_unproven" };
    }
    try {
      const result = await enqueueFn({ pool, workspaceId: clienteId,
        jobId: Number(offer.job_id), ofertaId: Number(offer.id),
        itemPayload: itemFila,
        destinations: normalizarDestinosAplicaveis(contexto.destinosCompativeis,
          { workspaceId: clienteId, resolveTelegramTargets }) });
      return { ok: true, itemFila: { ...itemFila,
        id: `universal_${result.itemId}`,
        operationEpochStartedAt: result.operationEpochStartedAt } };
    } catch (error) {
      return { ok: false, motivo: String(error.message || error) };
    }
  };
}

module.exports = { criarCallbackFilaUniversal, normalizarDestinosAplicaveis };
