"use strict";

const { createHash, createPublicKey, KeyObject, randomUUID, verify } = require("node:crypto");
const digest = /^sha256:[a-f0-9]{64}$/;
const sha = /^[a-f0-9]{40}$/;
const releaseId = /^[a-z0-9][a-z0-9-]{0,63}$/;
const opId = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const imageRef = /^[a-z0-9][a-z0-9./:-]{0,150}@sha256:[a-f0-9]{64}$/;

function requireOk(condition, reason) {
  if (!condition) throw Object.assign(new Error(reason), { maintenanceReason: reason });
}

function approvedRelease(envelope, publicKey, id, policy, now = Date.now()) {
  requireOk(releaseId.test(id), "invalid_release_id");
  requireOk(typeof envelope.payload === "string" && typeof envelope.signature === "string", "invalid_approval");
  const key = publicKey instanceof KeyObject ? publicKey : createPublicKey(publicKey);
  const payload = Buffer.from(envelope.payload, "base64");
  requireOk(payload.length > 0 && payload.length <= 16384 &&
    key.type === "public" && key.asymmetricKeyType === "ed25519" &&
    verify(null, payload, key, Buffer.from(envelope.signature, "base64")), "invalid_signature");
  const release = JSON.parse(payload.toString("utf8"));
  const checkedAt = Date.parse(release.approvedAt);
  const expires = Date.parse(release.expiresAt);
  const validArtifact = item => item && digest.test(item.digest) && digest.test(item.imageId) && imageRef.test(item.ref) &&
    item.ref.endsWith("@" + item.digest);
  requireOk(release.version === 1 && release.id === id &&
    sha.test(release.sourceSha) && sha.test(release.baseSha) &&
    validArtifact(release.base) && validArtifact(release.candidate) &&
    release.base.digest !== release.candidate.digest &&
    release.purpose === policy.purpose && release.profile === policy.profile &&
    checkedAt <= now && now < expires && expires - checkedAt <= 7 * 86400000 &&
    Array.isArray(release.runtimeFiles) && release.runtimeFiles.length > 0 &&
    release.runtimeFiles.every(file => /^[a-zA-Z0-9_-]+(?:[./-][a-zA-Z0-9_-]+)*$/.test(file)) &&
    new Set(release.runtimeFiles).size === release.runtimeFiles.length,
    "invalid_release");
  const gates = release.gates;
  requireOk(Array.isArray(policy.requiredChecks) && policy.requiredChecks.includes("golden") &&
    gates?.sourceSha === release.sourceSha && gates?.baseDigest === release.base.digest &&
    gates?.candidateDigest === release.candidate.digest &&
    /^[1-9][0-9]{0,19}$/.test(gates.runId) && gates.runtimeDiffVerified === true &&
    policy.requiredChecks.every(check => Object.hasOwn(gates.results || {}, check) && gates.results[check] === "pass"),
    "required_checks_not_approved");
  return release;
}

const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const owner = operation => "maintenance:" + operation.id;
const sameEpoch = (status, operation) => status.ok === true && !status.epochMismatch &&
  status.epoch === operation.epoch && (!status.fenceEpoch || status.fenceEpoch === operation.epoch);
const drained = status => status.state === "DRAINED" && status.claimed === 0 && status.sendStarted === 0;
const terminal = new Set(["open", "rolled_back", "abandoned"]);

function createDeployment({ host, journal, audit, wait, attempts = 24, healthAttempts = 12 }) {
  function save(op, phase) {
    const next = { ...op, phase };
    journal.write(next);
    audit({ operation: op.id, release: op.release.id, phase, epoch: op.epoch, generation: op.generation });
    return next;
  }

  function state(op, status) {
    requireOk(sameEpoch(status, op) && status.generation === op.generation &&
      status.owner === owner(op), "fence_ownership_or_epoch_changed");
    return status;
  }

  async function awaitDrained(op) {
    for (let attempt = 0; attempt < attempts; attempt++) {
      const s = state(op, host.fence("status"));
      if (drained(s)) return;
      requireOk(s.state === "DRAINING", "unexpected_fence_state");
      if (s.claimed === 0 && s.sendStarted === 0) {
        const confirmed = state(op, host.fence("confirm", op));
        requireOk(drained(confirmed), "drain_not_confirmed");
        return;
      }
      await wait();
    }
    throw new Error("drain_timeout");
  }

  async function awaitHealth(op, target) {
    for (let attempt = 0; attempt < healthAttempts; attempt++) {
      state(op, host.fence("status"));
      try { host.health(target, op.baseline); return; }
      catch (error) {
        if (attempt + 1 === healthAttempts) throw error;
        await wait();
      }
    }
  }

  function releaseFence(op, target) {
    requireOk(drained(state(op, host.fence("status"))), "fence_not_drained");
    host.health(target, op.baseline);
    op = save({ ...op, target: target.digest }, "release_pending");
    const opened = state(op, host.fence("release", op));
    requireOk(opened.state === "OPEN", "release_not_confirmed");
    requireOk(state(op, host.fence("status")).state === "OPEN", "release_not_verified");
    return save(op, target.digest === op.release.base.digest ? "rolled_back" : "open");
  }

  return {
    status(id) {
      requireOk(id === "current" || opId.test(id), "invalid_operation_id");
      const op = journal.read();
      requireOk(op && (id === "current" || op.id === id), "operation_not_found");
      return { id: op.id, phase: op.phase, epoch: op.epoch, generation: op.generation, target: op.target || null };
    },
    async deploy(release) {
      const current = journal.read();
      requireOk(!current || terminal.has(current.phase), "recovery_required");
      const prepared = host.preflight(release);
      const s = host.fence("status");
      requireOk(s.ok === true && s.state === "OPEN" && !s.epochMismatch &&
        typeof s.epoch === "string" && (!s.fenceEpoch || s.fenceEpoch === s.epoch) &&
        Number.isSafeInteger(s.generation) && s.generation >= 0, "fence_not_open");
      const op = save({
        id: randomUUID(), release, epoch: s.epoch, generation: s.generation + 1,
        baseline: prepared.baseline, originalOverride: prepared.originalOverride,
        candidateOverride: prepared.candidateOverride
      }, "drain_pending");
      const applied = state(op, host.fence("drain", { ...op, generation: s.generation }));
      requireOk(applied.state === "DRAINING", "drain_not_requested");
      await awaitDrained(op);
      save(op, "switch_pending");
      host.switchImage(op, release.candidate);
      await awaitHealth(op, release.candidate);
      return releaseFence(op, release.candidate);
    },
    async recover(id) {
      requireOk(opId.test(id), "invalid_operation_id");
      const op = journal.read();
      requireOk(op?.id === id && !terminal.has(op.phase), "operation_not_recoverable");
      host.recoveryPreflight(op);
      const s = host.fence("status");
      if (op.phase === "drain_pending" && sameEpoch(s, op) && s.state === "OPEN" &&
          s.generation === op.generation - 1) {
        host.health(op.release.base, op.baseline);
        return save(op, "abandoned");
      }
      state(op, s);
      if (op.phase === "release_pending" && s.state === "OPEN") {
        const target = [op.release.base, op.release.candidate].find(item => item.digest === op.target);
        requireOk(target, "invalid_release_target");
        host.health(target, op.baseline);
        return save(op, target.digest === op.release.base.digest ? "rolled_back" : "open");
      }
      await awaitDrained(op);
      save(op, "rollback_pending");
      host.switchImage(op, op.release.base);
      await awaitHealth(op, op.release.base);
      return releaseFence(op, op.release.base);
    }
  };
}

module.exports = { approvedRelease, createDeployment, hash, requireOk, releaseId, opId };
