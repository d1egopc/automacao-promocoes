"use strict";

// A fail-closed seam for the real provider executor. The caller must supply
// commercial/cadence/target preflight and a factual provider checkpoint.
// This is intentionally not installed in the production scheduler yet.
const queue = require("./universal-queue.repository");

function criarExecutorFilaUniversal({ pool, prepare, dispatch, checkWorkspace,
  repository = queue, oneShot = false }) {
  if (!pool || typeof pool.connect !== "function" ||
      typeof prepare !== "function" || typeof dispatch !== "function" ||
      (checkWorkspace !== undefined && typeof checkWorkspace !== "function")) {
    throw new Error("universal_executor_contract_required");
  }
  return async function processarProximo(workspaceId) {
    const workspace = String(workspaceId || "").trim();
    if (!workspace) throw new Error("queue_workspace_required");
    if (checkWorkspace) {
      const current = await checkWorkspace(workspace);
      if (current?.ok !== true) return { ok: false,
        reason: current?.reason || "workspace_not_operational" };
    }
    const preflight = await repository.preflightWorkspace({ pool,
      workspaceId: workspace });
    if (preflight.ok !== true) return { ok: false,
      reason: preflight.reason || preflight.health || "workspace_preflight_failed" };
    const claim = await repository.claimDestination({ pool,
      workspaceId: workspace });
    if (claim.ok !== true || claim.empty === true) return claim;
    let prepared;
    try {
      prepared = await prepare(claim);
    } catch (error) {
      await repository.releaseUnstarted({ pool,
        destinationId: claim.id, leaseToken: claim.leaseToken });
      throw error;
    }
    if (prepared?.ready !== true) {
      if (prepared?.terminalNoSend === true) {
        return repository.completeWithoutSend({ pool, destinationId: claim.id,
          leaseToken: claim.leaseToken, reason: prepared.reason });
      }
      if (prepared?.terminalFailure === true) {
        return repository.confirmFailure({ pool, destinationId: claim.id,
          leaseToken: claim.leaseToken, reason: prepared.reason,
          evidence: "local_before_transport" });
      }
      const released = await repository.releaseUnstarted({ pool,
        destinationId: claim.id, leaseToken: claim.leaseToken,
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
      const started = await repository.markSendStarted({ pool,
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
        await repository.releaseUnstarted({ pool, destinationId: claim.id,
          leaseToken: claim.leaseToken,
          retryAt: new Date(Date.now() + 1000).toISOString() });
        return { ok: false, reason: String(error?.message || error),
          beforeProvider: true };
      }
      return { ok: false, reason: "provider_result_ambiguous",
        ambiguous: true };
    }
    if (!crossedProviderBoundary) {
      const released = await repository.releaseUnstarted({ pool,
        destinationId: claim.id, leaseToken: claim.leaseToken,
        retryAt: result?.retryAt || new Date(Date.now() + 1000).toISOString() });
      return { ok: false, reason: result?.reason || "provider_not_started",
        released: released.ok === true };
    }
    if (result?.failureConfirmed === true) {
      return repository.confirmFailure({ pool, destinationId: claim.id,
        leaseToken: claim.leaseToken,
        reason: result.failureReason || "provider_no_effect_confirmed",
        evidence: "provider_no_effect_confirmed" });
    }
    if (result?.confirmed !== true || !String(result.confirmationKey || "").trim()) {
      return { ok: false, reason: "provider_confirmation_unproven",
        ambiguous: true };
    }
    return repository.confirmSend({ pool, destinationId: claim.id,
      leaseToken: claim.leaseToken,
      confirmationKey: result.confirmationKey,
      providerMessageId: result.providerMessageId,
      creditDebited: result.creditDebited === true });
  };
}

module.exports = { criarExecutorFilaUniversal };
