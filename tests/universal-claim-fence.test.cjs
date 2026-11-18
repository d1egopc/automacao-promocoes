"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { authorizeRequest, createUniversalClaimFenceAdminCaller } =
  require("../modules/engine/universal-claim-fence.service");

function req(overrides = {}) {
  return {
    socket: { remoteAddress: "127.0.0.1" },
    headers: {},
    usuario: { papel: "admin_master" },
    ...overrides
  };
}

test("claim fence accepts only loopback admin_master without a narrower target", () => {
  assert.deepEqual(authorizeRequest(req()), {
    ok: true, scope: "universal_claim_admission"
  });
  assert.deepEqual(authorizeRequest(req({ usuario: { papel: "usuario" } })), {
    ok: false, reason: "admin_master_required"
  });
  assert.deepEqual(authorizeRequest(req({ socket: { remoteAddress: "10.0.0.5" } })), {
    ok: false, reason: "loopback_required"
  });
  assert.deepEqual(authorizeRequest(req({ headers: { "x-forwarded-for": "10.0.0.5" } })), {
    ok: false, reason: "forwarded_client_not_loopback"
  });
  assert.deepEqual(authorizeRequest(req({ body: { workspaceId: "user_a" } })), {
    ok: false, reason: "global_target_only"
  });
});

test("admin caller fails closed when the persistent store is unavailable", async () => {
  const caller = createUniversalClaimFenceAdminCaller({
    getPool: () => { throw new Error("fence_store_unavailable"); }
  });
  assert.deepEqual(await caller.status(), {
    ok: false, reason: "fence_store_unavailable"
  });
  assert.deepEqual(await caller.release(), {
    ok: false, reason: "fence_store_unavailable"
  });
});
