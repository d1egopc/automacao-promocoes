"use strict";

const queue = require("./universal-queue.repository");

const SKIP_REASONS = new Set(["recurso_indisponivel", "vitrine_inativa",
  "status_nao_enviado", "sem_envio_confirmado"]);

async function processVitrineProjectionBatch({ pool, publish, buildOffer,
  retentionMs, repository = queue, limit = 5, now = () => Date.now() }) {
  if (!pool || typeof publish !== "function" ||
      typeof buildOffer !== "function" ||
      !Number.isFinite(retentionMs) || retentionMs <= 0) {
    throw new Error("universal_vitrine_projector_contract_invalid");
  }
  const batch = Math.max(1, Math.min(20, Number(limit) || 5));
  const summary = { claimed: 0, completed: 0, skipped: 0, failed: 0,
    retried: 0 };
  for (let n = 0; n < batch; n++) {
    const claim = await repository.claimVitrineProjection({ pool });
    if (claim.empty) break;
    summary.claimed += 1;
    let result = "retry";
    let reason = "vitrine_projection_unavailable";
    try {
      if (now() - new Date(claim.terminalAt).getTime() > retentionMs) {
        result = "skipped";
        reason = "vitrine_retention_expired";
      } else {
        const offer = buildOffer(claim);
        const published = await publish(claim, offer);
        reason = published?.motivo || "vitrine_projection_unknown";
        if (published?.ok === true) result = "completed";
        else if (SKIP_REASONS.has(reason)) result = "skipped";
      }
    } catch (error) {
      reason = String(error?.message || error);
    }
    if (result === "retry" && claim.attempts >= 10) result = "failed";
    await repository.finishVitrineProjection({ pool, claim, result, reason });
    summary[result === "retry" ? "retried" : result] += 1;
  }
  await repository.cleanupVitrineProjections({ pool, limit: 20 });
  return summary;
}

module.exports = { processVitrineProjectionBatch };
