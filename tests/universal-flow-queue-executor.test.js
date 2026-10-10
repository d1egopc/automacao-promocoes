"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { criarExecutorFilaUniversal } =
  require("../modules/engine/universal-queue-executor.adapter");

const pool = { connect() {} };
const claim = { ok: true, empty: false, id: 9, leaseToken: "lease_1",
  workspace_id: "ws_A", target_key: "group_1" };

test("workspace registry denial does not claim or block another workspace", async () => {
  const claimed = [];
  const run = criarExecutorFilaUniversal({ pool,
    repository: { preflightWorkspace: async () => ({ ok: true }),
      claimDestination: async ({ workspaceId }) => {
        claimed.push(workspaceId); return { ok: true, empty: true };
      } },
    checkWorkspace: async workspaceId => ({ ok: workspaceId === "ws_B",
      reason: "workspace_inactive" }),
    prepare: async () => { throw new Error("must_not_prepare"); },
    dispatch: async () => { throw new Error("must_not_send"); } });
  assert.equal((await run("ws_A")).reason, "workspace_inactive");
  assert.deepEqual(await run("ws_B"), { ok: true, empty: true });
  assert.deepEqual(claimed, ["ws_B"]);
});

test("commercial preflight denial never crosses the provider boundary", async () => {
  const calls = [];
  const repository = {
    preflightWorkspace: async () => ({ ok: true }),
    claimDestination: async () => claim,
    releaseUnstarted: async args => { calls.push(["release", args]);
      return { ok: true }; },
    markSendStarted: async () => { throw new Error("must_not_start"); }
  };
  const run = criarExecutorFilaUniversal({ pool, repository,
    prepare: async () => ({ ready: false, reason: "commercial_deadline" }),
    dispatch: async () => { throw new Error("must_not_send"); } });
  assert.deepEqual(await run("ws_A"), { ok: false,
    reason: "commercial_deadline", released: true });
  assert.equal(calls.length, 1);
});

test("temporary destination closure defers only this target without provider", async () => {
  const calls = [];
  const run = criarExecutorFilaUniversal({ pool,
    repository: {
      preflightWorkspace: async () => ({ ok: true }),
      claimDestination: async () => claim,
      releaseUnstarted: async args => { calls.push(args); return { ok: true }; },
      markSendStarted: async () => { throw new Error("must_not_start"); }
    },
    prepare: async () => ({ ready: false, reason: "destination_window_closed",
      retryAt: "2099-01-01T00:00:00.000Z" }),
    dispatch: async () => { throw new Error("must_not_send"); } });
  assert.equal((await run("ws_A")).released, true);
  assert.equal(calls[0].retryAt, "2099-01-01T00:00:00.000Z");
});

test("factual non-technical terminal does not become provider failure", async () => {
  const calls = [];
  const run = criarExecutorFilaUniversal({ pool,
    repository: {
      preflightWorkspace: async () => ({ ok: true }),
      claimDestination: async () => claim,
      completeWithoutSend: async args => { calls.push(args);
        return { ok: true, itemStatus: "not_sent" }; },
      markSendStarted: async () => { throw new Error("must_not_start"); }
    },
    prepare: async () => ({ ready: false, terminalNoSend: true,
      reason: "commercially_expired" }),
    dispatch: async () => { throw new Error("must_not_send"); } });
  assert.equal((await run("ws_A")).itemStatus, "not_sent");
  assert.equal(calls[0].reason, "commercially_expired");
});

test("only a factual ACK may terminalize a target", async () => {
  const calls = [];
  const repository = {
    preflightWorkspace: async () => ({ ok: true }),
    claimDestination: async () => claim,
    markSendStarted: async () => { calls.push("started"); return { ok: true }; },
    confirmSend: async args => { calls.push(["confirmed", args]);
      return { ok: true, terminal: true }; }
  };
  const run = criarExecutorFilaUniversal({ pool, repository,
    prepare: async () => ({ ready: true, message: "fixture" }),
    dispatch: async (_claim, _prepared, { startAttempt }) => {
      await startAttempt(); calls.push("provider"); return {
      confirmed: true, confirmationKey: "checkpoint_1",
      providerMessageId: "p1", creditDebited: true
    }; } });
  assert.deepEqual(await run("ws_A"), { ok: true, terminal: true });
  assert.deepEqual(calls.map(item => typeof item === "string" ? item : item[0]),
    ["started", "provider", "confirmed"]);
});

test("missing ACK remains ambiguous, never released for automatic resend", async () => {
  let released = false;
  const repository = {
    preflightWorkspace: async () => ({ ok: true }),
    claimDestination: async () => claim,
    markSendStarted: async () => ({ ok: true }),
    releaseUnstarted: async () => { released = true; },
    confirmSend: async () => { throw new Error("must_not_confirm"); }
  };
  const run = criarExecutorFilaUniversal({ pool, repository,
    prepare: async () => ({ ready: true }),
    dispatch: async (_claim, _prepared, { startAttempt }) => {
      await startAttempt(); return { confirmed: false }; } });
  assert.deepEqual(await run("ws_A"), { ok: false,
    reason: "provider_confirmation_unproven", ambiguous: true });
  assert.equal(released, false);
});

test("unhealthy workspace never claims work", async () => {
  const run = criarExecutorFilaUniversal({ pool,
    repository: {
      preflightWorkspace: async () => ({ ok: false, health: "AMBIGUOUS" }),
      claimDestination: async () => { throw new Error("must_not_claim"); }
    },
    prepare: async () => { throw new Error("must_not_prepare"); },
    dispatch: async () => { throw new Error("must_not_send"); } });
  assert.deepEqual(await run("ws_A"), { ok: false, reason: "AMBIGUOUS" });
});

test("technical failure before transport is factual, without provider call", async () => {
  const calls = [];
  const run = criarExecutorFilaUniversal({ pool,
    repository: {
      preflightWorkspace: async () => ({ ok: true }),
      claimDestination: async () => claim,
      confirmFailure: async args => { calls.push(args);
        return { ok: true, itemStatus: "error" }; },
      markSendStarted: async () => { throw new Error("must_not_start"); }
    },
    prepare: async () => ({ ready: false, terminalFailure: true,
      reason: "required_media_unpublishable" }),
    dispatch: async () => { throw new Error("must_not_send"); } });
  assert.equal((await run("ws_A")).itemStatus, "error");
  assert.equal(calls[0].evidence, "local_before_transport");
});

test("confirmed provider no-effect is a failure, not an ambiguous resend", async () => {
  const calls = [];
  const run = criarExecutorFilaUniversal({ pool,
    repository: {
      preflightWorkspace: async () => ({ ok: true }),
      claimDestination: async () => claim,
      markSendStarted: async () => ({ ok: true }),
      confirmFailure: async args => { calls.push(args);
        return { ok: true, itemStatus: "error" }; }
    },
    prepare: async () => ({ ready: true }),
    dispatch: async (_claim, _prepared, { startAttempt }) => {
      await startAttempt(); return { failureConfirmed: true,
        failureReason: "provider_http_4xx" }; } });
  assert.equal((await run("ws_A")).itemStatus, "error");
  assert.equal(calls[0].evidence, "provider_no_effect_confirmed");
});

test("provider adapter denial before transport keeps SEND_STARTED absent", async () => {
  const calls = [];
  const run = criarExecutorFilaUniversal({ pool,
    repository: {
      preflightWorkspace: async () => ({ ok: true }),
      claimDestination: async () => claim,
      markSendStarted: async () => { throw new Error("must_not_start"); },
      releaseUnstarted: async () => { calls.push("release"); return { ok: true }; }
    },
    prepare: async () => ({ ready: true }),
    dispatch: async () => ({ reason: "session_closed", retryAt: "2099-01-01T00:00:00.000Z" }) });
  assert.equal((await run("ws_A")).reason, "session_closed");
  assert.deepEqual(calls, ["release"]);
});
