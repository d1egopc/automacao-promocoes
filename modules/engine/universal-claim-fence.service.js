"use strict";

const { validarEstadoOperacional } = require("./operation-epoch");

const FENCE_ID = 1;
const STATES = Object.freeze({ OPEN: "OPEN", DRAINING: "DRAINING", DRAINED: "DRAINED" });
const LOOPBACK_ADDRESSES = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

function text(value = "", limit = 160) {
  return String(value == null ? "" : value).trim().slice(0, limit);
}

function safeActor(value = "") {
  const actor = text(value, 120);
  return /^[a-zA-Z0-9_.:@-]{1,120}$/.test(actor) ? actor : "admin_master";
}

function fenceError(reason, sqlState = "") {
  const error = new Error(reason);
  error.code = sqlState || reason;
  error.fenceReason = reason;
  return error;
}

function requirePool(pool) {
  if (!pool || typeof pool.connect !== "function") throw new Error("claim_fence_pool_required");
  return pool;
}

async function transaction(pool, action) {
  const client = await requirePool(pool).connect();
  let open = false;
  try {
    await client.query("BEGIN");
    open = true;
    const result = await action(client);
    await client.query("COMMIT");
    open = false;
    return result;
  } catch (error) {
    if (open) await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function readUniversalEpoch(client) {
  const result = await client.query(`SELECT mode,operation_epoch_started_at
    FROM engine_operation_state WHERE id=1 FOR SHARE`);
  const state = validarEstadoOperacional(result.rows[0]);
  if (state.mode !== "UNIVERSAL" || !state.operationEpochStartedAt) {
    throw fenceError("universal_mode_not_active");
  }
  return state.operationEpochStartedAt;
}

async function readFence(client, lock = "") {
  const suffix = lock === "update" ? " FOR UPDATE" : " FOR SHARE";
  const result = await client.query(`SELECT id,state,generation,
      operation_epoch_started_at,requested_at,requested_by,released_at,changed_at
    FROM engine_universal_claim_fence WHERE id=$1${suffix}`, [FENCE_ID]);
  if (!result.rows[0]) throw fenceError("claim_fence_state_missing");
  const row = result.rows[0];
  if (!Object.values(STATES).includes(row.state)) throw fenceError("claim_fence_state_invalid");
  return row;
}

async function countOpen(client, epoch) {
  const result = await client.query(`SELECT
      count(*) FILTER (WHERE status='claimed')::int AS claimed,
      count(*) FILTER (WHERE status='send_started')::int AS send_started
    FROM engine_universal_queue_destinations
    WHERE operation_epoch_started_at=$1`, [epoch]);
  const row = result.rows[0] || {};
  const claimed = Number(row.claimed || 0);
  const sendStarted = Number(row.send_started || 0);
  return { claimed, sendStarted, open: claimed + sendStarted };
}

function publicState(fence, epoch, counts, extra = {}) {
  return {
    ok: true,
    state: fence.state,
    generation: Number(fence.generation),
    operationEpochStartedAt: fence.operation_epoch_started_at || null,
    currentOperationEpoch: epoch || null,
    requestedAt: fence.requested_at || null,
    changedAt: fence.changed_at || null,
    releasedAt: fence.released_at || null,
    requestedBy: fence.requested_by || "",
    claimed: counts.claimed,
    sendStarted: counts.sendStarted,
    open: counts.open,
    admissionOpen: fence.state === STATES.OPEN,
    ...extra
  };
}

// Called inside the same claim transaction. The shared row lock makes the
// requestDrain UPDATE wait for an already-admitted claim, while a drain that
// acquired the row first makes this read observe DRAINING/DRAINED.
async function readClaimFenceForClaim(client, epoch) {
  const fence = await readFence(client, "share");
  if (fence.operation_epoch_started_at &&
      String(fence.operation_epoch_started_at.toISOString?.() || fence.operation_epoch_started_at) !== String(epoch)) {
    throw fenceError("claim_fence_epoch_mismatch");
  }
  if (fence.state !== STATES.OPEN) throw fenceError("universal_claim_fence_active", "55P03");
  return fence;
}

async function status({ pool }) {
  return transaction(pool, async client => {
    const epochResult = await client.query(`SELECT mode,operation_epoch_started_at
      FROM engine_operation_state WHERE id=1 FOR SHARE`);
    const state = validarEstadoOperacional(epochResult.rows[0]);
    const epoch = state.operationEpochStartedAt;
    const fence = await readFence(client, "share");
    const counts = epoch ? await countOpen(client, epoch) : { claimed: 0, sendStarted: 0, open: 0 };
    return publicState(fence, epoch, counts, {
      epochMismatch: Boolean(fence.operation_epoch_started_at && epoch &&
        String(fence.operation_epoch_started_at.toISOString?.() || fence.operation_epoch_started_at) !== String(epoch))
    });
  });
}

async function requestDrain({ pool, requestedBy = "admin_master" }) {
  return transaction(pool, async client => {
    const epoch = await readUniversalEpoch(client);
    const fence = await readFence(client, "update");
    if (fence.operation_epoch_started_at &&
        String(fence.operation_epoch_started_at.toISOString?.() || fence.operation_epoch_started_at) !== String(epoch)) {
      throw fenceError("claim_fence_epoch_mismatch");
    }
    let current = fence;
    if (fence.state === STATES.OPEN) {
      current = (await client.query(`UPDATE engine_universal_claim_fence
        SET state='DRAINING',generation=generation+1,
            operation_epoch_started_at=$2,requested_at=clock_timestamp(),
            requested_by=$3,released_at=NULL,changed_at=clock_timestamp()
        WHERE id=$1 RETURNING *`, [FENCE_ID, epoch, safeActor(requestedBy)])).rows[0];
    }
    const counts = await countOpen(client, epoch);
    return publicState(current, epoch, counts, {
      idempotent: fence.state !== STATES.OPEN,
      drainComplete: current.state === STATES.DRAINED && counts.open === 0
    });
  });
}

async function confirmDrain({ pool }) {
  return transaction(pool, async client => {
    const epoch = await readUniversalEpoch(client);
    const fence = await readFence(client, "update");
    if (fence.operation_epoch_started_at &&
        String(fence.operation_epoch_started_at.toISOString?.() || fence.operation_epoch_started_at) !== String(epoch)) {
      throw fenceError("claim_fence_epoch_mismatch");
    }
    if (fence.state === STATES.OPEN) {
      const counts = await countOpen(client, epoch);
      return publicState(fence, epoch, counts, { ok: false, reason: "drain_not_requested", drainComplete: false });
    }
    const counts = await countOpen(client, epoch);
    if (counts.open !== 0) {
      return publicState(fence, epoch, counts, { ok: false, reason: "claims_still_open", drainComplete: false });
    }
    const current = (await client.query(`UPDATE engine_universal_claim_fence
      SET state='DRAINED',changed_at=clock_timestamp()
      WHERE id=$1 AND state='DRAINING' RETURNING *`, [FENCE_ID])).rows[0] || fence;
    return publicState(current, epoch, counts, { drainComplete: true });
  });
}

async function releaseAdmission({ pool }) {
  return transaction(pool, async client => {
    const epoch = await readUniversalEpoch(client);
    const fence = await readFence(client, "update");
    if (fence.operation_epoch_started_at &&
        String(fence.operation_epoch_started_at.toISOString?.() || fence.operation_epoch_started_at) !== String(epoch)) {
      throw fenceError("claim_fence_epoch_mismatch");
    }
    if (fence.state !== STATES.DRAINED) {
      const counts = await countOpen(client, epoch);
      return publicState(fence, epoch, counts, { ok: false, reason: "drain_not_confirmed" });
    }
    const counts = await countOpen(client, epoch);
    if (counts.open !== 0) return publicState(fence, epoch, counts, {
      ok: false, reason: "claims_still_open"
    });
    const current = (await client.query(`UPDATE engine_universal_claim_fence
      SET state='OPEN',operation_epoch_started_at=$2,
          released_at=clock_timestamp(),changed_at=clock_timestamp()
      WHERE id=$1 AND state='DRAINED' RETURNING *`, [FENCE_ID, epoch])).rows[0];
    return publicState(current || fence, epoch, counts, { released: true });
  });
}

function authorizeRequest(req = {}) {
  const remote = text(req.socket?.remoteAddress || req.connection?.remoteAddress, 80);
  if (!LOOPBACK_ADDRESSES.has(remote)) return { ok: false, reason: "loopback_required" };
  const forwarded = text(req.headers?.["x-forwarded-for"] || req.headers?.["x-real-ip"], 200);
  if (forwarded && !LOOPBACK_ADDRESSES.has(forwarded.split(",", 1)[0].trim())) {
    return { ok: false, reason: "forwarded_client_not_loopback" };
  }
  if (req.usuario?.papel !== "admin_master") return { ok: false, reason: "admin_master_required" };
  if (req.body?.workspaceId || req.body?.sessaoId || req.query?.workspaceId || req.query?.sessaoId) {
    return { ok: false, reason: "global_target_only" };
  }
  return { ok: true, scope: "universal_claim_admission" };
}

function createUniversalClaimFenceAdminCaller({ getPool, logger = () => {} } = {}) {
  if (typeof getPool !== "function") throw new TypeError("claim_fence_get_pool_required");
  const audit = (operation, result = {}) => {
    try {
      logger("[UNIVERSAL-CLAIM-FENCE-ADMIN]", JSON.stringify({
        operation, ok: result.ok === true, reason: result.reason || "",
        state: result.state || "", generation: result.generation ?? null,
        claimed: result.claimed ?? null, sendStarted: result.sendStarted ?? null
      }));
    } catch {}
  };
  const run = async (operation, fn) => {
    try {
      const result = await fn({ pool: getPool() });
      audit(operation, result);
      return result;
    } catch (error) {
      const result = { ok: false, reason: error.code || error.message || "claim_fence_operation_failed" };
      audit(operation, result);
      return result;
    }
  };
  return Object.freeze({
    authorizeRequest,
    status: () => run("status", status),
    requestDrain: requestedBy => run("request_drain", ({ pool }) => requestDrain({ pool, requestedBy })),
    confirmDrain: () => run("confirm_drain", confirmDrain),
    release: () => run("release", releaseAdmission)
  });
}

module.exports = {
  FENCE_ID,
  STATES,
  LOOPBACK_ADDRESSES,
  readClaimFenceForClaim,
  status,
  requestDrain,
  confirmDrain,
  releaseAdmission,
  authorizeRequest,
  createUniversalClaimFenceAdminCaller
};
