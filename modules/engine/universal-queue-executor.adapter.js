"use strict";

// A fail-closed seam for the real provider executor. The caller must supply
// commercial/cadence/target preflight and a factual provider checkpoint.
// This is intentionally not installed in the production scheduler yet.
const queue = require("./universal-queue.repository");

function sanitizarMotivoPreflight(reason = "") {
  const value = String(reason || "").trim();
  return /^[a-z0-9_]{1,96}$/.test(value)
    ? value
    : "send_preflight_denied";
}

// Only fixed operational codes may be persisted from provider revalidation.
const RELEASE_REASONS = new Set([
  "destination_session_unavailable", "destination_window_closed", "destination_daily_limit_reached",
  "destination_cadence_wait", "destination_cadence_invalid", "destination_clock_invalid",
  "destination_not_current", "workspace_inactive", "workspace_not_operational",
  "workspace_credits_unavailable", "required_media_unpublishable", "commercial_link_unproven",
  "destination_template_unavailable", "destination_dedup_blocked", "destination_channel_invalid",
  "universal_send_identity_or_t0_invalid", "universal_send_offer_identity_mismatch",
  "captura_expirada_pos_classificacao", "commercial_freshness_denied",
  "universal_commercial_claim_missing", "commercial_reservation_unavailable",
  "universal_preprovider_context_changed", "universal_commercial_owner_not_current"
]);
function motivoLiberacao(reason, fallback) {
  const code = String(reason || "").trim();
  return RELEASE_REASONS.has(code) ? code : fallback;
}

function criarExecutorFilaUniversal({ pool, getPool = null, prepare, dispatch, checkWorkspace,
  repository = queue, oneShot = false }) {
  if (!pool || typeof pool.connect !== "function" ||
      typeof prepare !== "function" || typeof dispatch !== "function" ||
      (checkWorkspace !== undefined && typeof checkWorkspace !== "function")) {
    throw new Error("universal_executor_contract_required");
  }
  const poolAtual = () => {
    const current = typeof getPool === "function" ? getPool() : pool;
    if (!current || typeof current.connect !== "function") {
      throw new Error("queue_pool_required");
    }
    return current;
  };
  return async function processarProximo(workspaceId) {
    const workspace = String(workspaceId || "").trim();
    if (!workspace) throw new Error("queue_workspace_required");
    if (checkWorkspace) {
      const current = await checkWorkspace(workspace);
      if (current?.ok !== true) return { ok: false,
        reason: current?.reason || "workspace_not_operational" };
    }
    if (typeof repository.retireExpiredDestinations === "function") {
      await repository.retireExpiredDestinations({ pool: poolAtual(),
        workspaceId: workspace });
    }
    const preflight = await repository.preflightWorkspace({ pool: poolAtual(),
      workspaceId: workspace });
    if (preflight.ok !== true) return { ok: false,
      reason: preflight.reason || preflight.health || "workspace_preflight_failed" };
    const claim = await repository.claimDestination({ pool: poolAtual(),
      workspaceId: workspace });
    if (claim.ok !== true || claim.empty === true) return claim;
    let prepared;
    try {
      prepared = await prepare(claim);
    } catch (error) {
      await repository.releaseUnstarted({ pool: poolAtual(),
        destinationId: claim.id, leaseToken: claim.leaseToken,
        preflightReason: "send_prepare_exception" });
      throw error;
    }
    if (prepared?.ready !== true) {
      if (prepared?.terminalNoSend === true) {
        return repository.completeWithoutSend({ pool: poolAtual(), destinationId: claim.id,
          leaseToken: claim.leaseToken, reason: prepared.reason });
      }
      if (prepared?.terminalFailure === true) {
        return repository.confirmFailure({ pool: poolAtual(), destinationId: claim.id,
          leaseToken: claim.leaseToken, reason: prepared.reason,
          evidence: "local_before_transport" });
      }
      const released = await repository.releaseUnstarted({ pool: poolAtual(),
        destinationId: claim.id, leaseToken: claim.leaseToken,
        preflightReason: sanitizarMotivoPreflight(prepared?.reason),
        // A denied preflight is not a free destination. Without an explicit
        // reopening time, bound the retry loop; an actually free destination
        // never enters this branch and has no artificial wait.
        retryAt: prepared?.retryAt || new Date(Date.now() + 1000).toISOString() });
      return { ok: false, reason: prepared?.reason || "send_preflight_denied",
        released: released.ok === true };
    }
    let crossedProviderBoundary = false;
    const startAttempt = async () => {
      if (crossedProviderBoundary) {
        if (oneShot) throw new Error("smoke_provider_call_budget_exhausted");
        return { ok: true, duplicate: true };
      }
      const started = await repository.markSendStarted({ pool: poolAtual(),
        destinationId: claim.id, leaseToken: claim.leaseToken,
        commercialCta: prepared.rendered?.vitrineCta || {} });
      if (started.ok !== true) throw new Error(started.reason || "send_claim_lost");
      crossedProviderBoundary = true;
      return started;
    };
    // The installed provider adapter must call startAttempt immediately before
    // external transport, after its last local denial. Once called, any absent
    // ACK is ambiguous and the target must never be requeued automatically.
    let result;
    try {
      result = await dispatch(claim, prepared, { startAttempt });
    } catch (error) {
      if (!crossedProviderBoundary) {
        await repository.releaseUnstarted({ pool: poolAtual(), destinationId: claim.id,
          leaseToken: claim.leaseToken,
          preflightReason: motivoLiberacao(error?.message, "send_dispatch_exception_before_transport"),
          retryAt: new Date(Date.now() + 1000).toISOString() });
        return { ok: false, reason: String(error?.message || error),
          beforeProvider: true };
      }
      return { ok: false, reason: "provider_result_ambiguous",
        ambiguous: true };
    }
    if (!crossedProviderBoundary) {
      const released = await repository.releaseUnstarted({ pool: poolAtual(),
        destinationId: claim.id, leaseToken: claim.leaseToken,
        preflightReason: motivoLiberacao(result?.reason, "provider_not_started"),
        retryAt: result?.retryAt || new Date(Date.now() + 1000).toISOString() });
      return { ok: false, reason: result?.reason || "provider_not_started",
        released: released.ok === true };
    }
    if (result?.failureConfirmed === true) {
      return repository.confirmFailure({ pool: poolAtual(), destinationId: claim.id,
        leaseToken: claim.leaseToken,
        reason: result.failureReason || "provider_no_effect_confirmed",
        evidence: "provider_no_effect_confirmed" });
    }
    if (result?.confirmed !== true || !String(result.confirmationKey || "").trim()) {
      return { ok: false, reason: "provider_confirmation_unproven",
        ambiguous: true };
    }
    return repository.confirmSend({ pool: poolAtual(), destinationId: claim.id,
      leaseToken: claim.leaseToken,
      confirmationKey: result.confirmationKey,
      providerMessageId: result.providerMessageId,
      creditDebited: result.creditDebited === true });
  };
}

module.exports = { criarExecutorFilaUniversal, sanitizarMotivoPreflight };
