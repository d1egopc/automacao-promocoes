"use strict";

// The Universal queue never interprets a pending row as permission to send.
// Reuse the classified commercial freshness and destination cadence services;
// the application supplies its existing window/session/credit/media/link/dedup
// checks and renderer. No provider is called here.
const { avaliarFrescorPosClassificacaoCandidato } =
  require("./post-classification-freshness.candidate");
const { classificarTurboComercialCandidato } =
  require("./turbo-classification.candidate");
const { resolverCadenciaDestino } = require("./cadencia.service");
const { readDestinationClock } = require("./universal-queue.repository");

const REQUIRED = ["resolveDestination", "checkWindow", "checkDailyLimit", "checkSession",
  "checkCredits", "checkMedia", "checkLinks", "checkDedup", "renderMessage"];

function criarPreflightFilaUniversal({ pool, configGlobal = {},
  readClock = readDestinationClock, now = Date.now, ...checks } = {}) {
  if (!pool || REQUIRED.some(name => typeof checks[name] !== "function") ||
      typeof readClock !== "function" || typeof now !== "function") {
    throw new Error("universal_send_preflight_dependencies_required");
  }
  return async (claim, { skipDedup = false } = {}) => {
    const workspaceId = String(claim?.workspace_id || "").trim();
    const destinationId = String(claim?.destination_id || "").trim();
    const captureMs = new Date(claim?.capturado_em).getTime();
    const epochMs = new Date(claim?.operationEpochStartedAt).getTime();
    const currentMs = Number(now());
    if (!workspaceId || !destinationId || !Number.isFinite(captureMs) ||
        !Number.isFinite(epochMs) || captureMs < epochMs ||
        !Number.isFinite(currentMs)) {
      return { ready: false, reason: "universal_send_identity_or_t0_invalid" };
    }
    const oferta = { ...(claim.item_payload || {}),
      evento_capturado_em: new Date(captureMs).toISOString(),
      evento_id: claim.evento_id,
      origemFluxo: claim.origem_fluxo };
    if (String(oferta.clienteId || "") !== workspaceId ||
        String(oferta.engineOfertaId || "") !== String(claim.oferta_id || "")) {
      return { ready: false, reason: "universal_send_offer_identity_mismatch" };
    }
    const turbo = classificarTurboComercialCandidato(oferta);
    const freshness = avaliarFrescorPosClassificacaoCandidato(oferta, currentMs);
    if (!freshness.ok) return { ready: false,
      reason: freshness.motivo || "commercial_freshness_denied",
      terminalNoSend: freshness.motivo === "captura_expirada_pos_classificacao" };
    const resolved = await checks.resolveDestination({ claim, oferta, workspaceId,
      destinationId });
    if (resolved?.ok !== true || !resolved.destination ||
        String(resolved.destination.id || resolved.destination.destinoId || "") !==
          destinationId) {
      return { ready: false, reason: resolved?.reason || "destination_not_current" };
    }
    const context = { claim, oferta, workspaceId, destinationId,
      destination: resolved.destination,
      configCliente: resolved.configCliente || {},
      turbo, freshness, nowMs: currentMs };
    const cadence = resolverCadenciaDestino({ destino: context.destination,
      configCliente: context.configCliente, configGlobal, oferta });
    const intervalMs = Number(cadence.intervaloEfetivoMin) * 60000;
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
      return { ready: false, reason: "destination_cadence_invalid" };
    }
    const lastConfirmed = await readClock({ pool, workspaceId, destinationId });
    const lastMs = lastConfirmed ? new Date(lastConfirmed).getTime() : 0;
    if (lastConfirmed && !Number.isFinite(lastMs)) {
      return { ready: false, reason: "destination_clock_invalid" };
    }
    if (lastMs && lastMs + intervalMs > currentMs) {
      return { ready: false, reason: "destination_cadence_wait",
        retryAt: new Date(lastMs + intervalMs).toISOString() };
    }
    for (const [name, reason] of [
      ["checkWindow", "destination_window_closed"],
      ["checkDailyLimit", "destination_daily_limit_reached"],
      ["checkSession", "destination_session_unavailable"],
      ["checkCredits", "workspace_credits_unavailable"],
      ["checkMedia", "required_media_unpublishable"],
      ["checkLinks", "commercial_link_unproven"]
    ]) {
      const result = await checks[name](context);
      if (result?.ok !== true) return { ready: false,
        reason: result?.reason || reason,
        ...((result?.terminalFailure === true ||
          (["checkMedia", "checkLinks"].includes(name) &&
            result?.retryAt == null && result?.terminalNoSend !== true))
          ? { terminalFailure: true } : {}),
        ...(result?.terminalNoSend === true ? { terminalNoSend: true } : {}),
        ...(result?.retryAt ? { retryAt: result.retryAt } : {}) };
    }
    const rendered = await checks.renderMessage(context);
    if (rendered?.ok !== true || !rendered.message) {
      return { ready: false,
        reason: rendered?.reason || "destination_template_unavailable",
        terminalFailure: true };
    }
    // The durable commercial reservation may hold an advisory while the
    // provider adapter prepares transport. Acquire it only after all local
    // render failures have been ruled out.
    if (!skipDedup) {
      const dedup = await checks.checkDedup(context);
      if (dedup?.ok !== true) return { ready: false,
        reason: dedup?.reason || "destination_dedup_blocked",
        ...(dedup?.terminalNoSend === true ? { terminalNoSend: true } : {}),
        ...(dedup?.retryAt ? { retryAt: dedup.retryAt } : {}) };
    }
    return { ready: true, ...context, cadence, rendered };
  };
}

module.exports = { criarPreflightFilaUniversal };
