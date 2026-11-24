"use strict";

// The host broker invokes this fixed entry point inside a digest-pinned backend.
// This file is never exposed as an HTTP endpoint or SSH command.
const { readFileSync } = require("node:fs");
const { Pool } = require("pg");
const fence = require("../../modules/engine/universal-claim-fence.service");

async function main() {
  const input = readFileSync(0);
  if (input.length > 8192) throw new Error("invalid_request");
  const { action, operation, epoch, generation, databaseUrl } = JSON.parse(input);
  if (action === "version") return { protocol: 1 };
  if (!["status", "drain", "confirm", "release"].includes(action)) throw new Error("invalid_action");
  let expected;
  let owner;
  if (action !== "status") {
    if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(operation) ||
        !Number.isSafeInteger(generation) || generation < 0 ||
        typeof epoch !== "string" || new Date(epoch).toISOString() !== epoch) {
      throw new Error("invalid_expectation");
    }
    owner = "maintenance:" + operation;
    const state = { drain: "OPEN", confirm: "DRAINING", release: "DRAINED" }[action];
    expected = { state, generation, epoch, ...(action === "drain" ? {} : { owner }) };
  }
  if (typeof databaseUrl !== "string" || !/^postgres(?:ql)?:\/\//.test(databaseUrl)) {
    throw new Error("fence_unavailable");
  }
  const pool = new Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 4000,
    options: "-c lock_timeout=2000 -c statement_timeout=5000" });
  try {
    const functions = {
      status: fence.status, drain: fence.requestDrain, confirm: fence.confirmDrain, release: fence.releaseAdmission
    };
    const result = await functions[action]({ pool, expected, ...(owner ? { requestedBy: owner } : {}) });
    return {
      ok: result.ok, state: result.state, generation: result.generation,
      epoch: result.currentOperationEpoch, fenceEpoch: result.operationEpochStartedAt,
      owner: result.requestedBy, claimed: result.claimed, sendStarted: result.sendStarted,
      epochMismatch: result.epochMismatch === true
    };
  } finally {
    await pool.end();
  }
}

main().then(result => {
  process.stdout.write("OP_MAINTENANCE_RESULT " + JSON.stringify(result) + "\n");
}, () => {
  process.stderr.write("maintenance_fence_failed\n");
  process.exitCode = 1;
});
