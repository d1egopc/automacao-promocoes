"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { criarExecutorFilaUniversal, sanitizarMotivoPreflight } =
  require("../modules/engine/universal-queue-executor.adapter");
const { criarPreflightFilaUniversal } =
  require("../modules/engine/universal-queue-preflight");

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
  assert.equal(calls[0][1].preflightReason, "commercial_deadline");
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
  assert.equal(calls[0].preflightReason, "destination_window_closed");
});

test("preflight reason is bounded to sanitized fixed metadata", () => {
  assert.equal(sanitizarMotivoPreflight("destination_session_unavailable"),
    "destination_session_unavailable");
  assert.equal(sanitizarMotivoPreflight("session failed for +5511999999999"),
    "send_preflight_denied");
  assert.equal(sanitizarMotivoPreflight("x".repeat(97)),
    "send_preflight_denied");
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

test("pool rotation keeps claim, transport boundary and durable ACK on current pool", async () => {
  const makePool = name => ({ name, ended: false, connect() {},
    end() { this.ended = true; } });
  const first = makePool("first");
  const second = makePool("second");
  const third = makePool("third");
  const fourth = makePool("fourth");
  let active = first;
  const seen = [];
  const expectCurrent = (step, candidate) => {
    assert.equal(candidate, active, `${step} must use the current pool`);
    assert.equal(candidate.ended, false, `${step} must not use an ended pool`);
    seen.push([step, candidate.name]);
  };
  const run = criarExecutorFilaUniversal({ pool: first, getPool: () => active,
    repository: {
      retireExpiredDestinations: async ({ pool: current }) => {
        expectCurrent("retire", current);
        first.end(); active = second;
      },
      preflightWorkspace: async ({ pool: current }) => {
        expectCurrent("preflight", current); return { ok: true };
      },
      claimDestination: async ({ pool: current }) => {
        expectCurrent("claim", current); return claim;
      },
      markSendStarted: async ({ pool: current }) => {
        expectCurrent("start", current); return { ok: true };
      },
      confirmSend: async ({ pool: current }) => {
        expectCurrent("ack", current); return { ok: true, terminal: true };
      }
    },
    prepare: async () => {
      second.end(); active = third;
      return { ready: true };
    },
    dispatch: async (_claim, _prepared, { startAttempt }) => {
      await startAttempt();
      third.end(); active = fourth;
      return { confirmed: true, confirmationKey: "durable_ack",
        providerMessageId: "provider_1", creditDebited: true };
    } });
  assert.deepEqual(await run("ws_A"), { ok: true, terminal: true });
  assert.deepEqual(seen, [["retire", "first"], ["preflight", "second"],
    ["claim", "second"], ["start", "third"], ["ack", "fourth"]]);
});

test("missing current pool fails before claim or transport", async () => {
  let active = pool;
  const run = criarExecutorFilaUniversal({ pool, getPool: () => active,
    repository: {
      preflightWorkspace: async () => { throw new Error("must_not_preflight"); },
      claimDestination: async () => { throw new Error("must_not_claim"); }
    },
    prepare: async () => { throw new Error("must_not_prepare"); },
    dispatch: async () => { throw new Error("must_not_send"); } });
  active = null;
  await assert.rejects(run("ws_A"), /queue_pool_required/);
});

for (const scenario of ["prepare_exception", "prepare_exception_unknown_stage",
  "dispatch_exception", "not_started"]) {
  test(`unstarted release persists sanitized decision: ${scenario}`, async () => {
    const releases = [];
    let sent = 0;
    const repository = {
      preflightWorkspace: async () => ({ ok: true }),
      claimDestination: async ({ workspaceId }) => ({ ...claim, workspace_id: workspaceId }),
      releaseUnstarted: async args => { releases.push(args); return { ok: true }; },
      markSendStarted: async () => ({ ok: true }),
      confirmSend: async () => { sent++; return { ok: true }; }
    };
    const run = criarExecutorFilaUniversal({ pool, repository,
      prepare: async c => {
        if (c.workspace_id === "ws_A" && scenario.startsWith("prepare_exception")) {
          const error = new Error("private_payload");
          if (scenario === "prepare_exception") error.preflightStage = "check_session";
          if (scenario === "prepare_exception_unknown_stage") error.preflightStage = "private_payload";
          throw error;
        }
        return { ready: true };
      },
      dispatch: async (c, _p, { startAttempt }) => {
        if (c.workspace_id === "ws_B") {
          await startAttempt(); return { confirmed: true, confirmationKey: "ack_B" };
        }
        if (scenario === "dispatch_exception") throw new Error("private_payload");
        return { reason: "destination_session_unavailable" };
      }
    });
    if (scenario.startsWith("prepare_exception")) await assert.rejects(run("ws_A"), /private_payload/);
    else await run("ws_A");
    assert.equal(releases.length, 1);
    assert.equal(releases[0].preflightReason, {
      prepare_exception: "send_prepare_exception_check_session",
      prepare_exception_unknown_stage: "send_prepare_exception",
      dispatch_exception: "send_dispatch_exception_before_transport",
      not_started: "destination_session_unavailable"
    }[scenario]);
    await run("ws_B");
    assert.equal(sent, 1, "another workspace continues normally");
  });
}

test("second preflight session denial is persisted; next target in same workspace continues", async () => {
  const releases=[];let attempt=0,sends=0;
  const run=criarExecutorFilaUniversal({pool,repository:{
    preflightWorkspace:async()=>({ok:true}),
    claimDestination:async()=>({...claim,id:++attempt,target_key:`target_${attempt}`}),
    releaseUnstarted:async x=>{releases.push(x);return {ok:true};},
    markSendStarted:async()=>({ok:true}),confirmSend:async()=>{sends++;return {ok:true};}
  },prepare:async()=>({ready:true}),dispatch:async(c,_p,{startAttempt})=>{
    if(c.id===1)throw new Error("destination_session_unavailable");
    await startAttempt();return {confirmed:true,confirmationKey:"ack_other_target"};
  }});
  await run("ws_A");await run("ws_A");
  assert.equal(releases[0].preflightReason,"destination_session_unavailable");assert.equal(sends,1);
});

test("preflight exception persists only its fixed stage on the claimed target", async () => {
  const releases = [];
  const target = { ...claim, destination_id: "dest_A", channel: "whatsapp",
    oferta_id: 2, evento_id: 1, capturado_em: "2026-10-10T12:10:00.000Z",
    operationEpochStartedAt: "2026-10-10T11:00:00.000Z",
    item_payload: { clienteId: "ws_A", engineOfertaId: 2,
      marketplace: "mercadolivre", titulo: "fixture" } };
  const prepare = criarPreflightFilaUniversal({ pool, now: () => Date.parse("2026-10-10T12:30:00.000Z"),
    readClock: async () => null,
    resolveDestination: async () => ({ ok: true,
      destination: { id: "dest_A", tipo: "whatsapp", intervaloMinutos: 2.5 } }),
    checkWindow: async () => ({ ok: true }),
    checkDailyLimit: async () => ({ ok: true }),
    checkSession: async () => { throw new Error("private destination state"); },
    checkCredits: async () => ({ ok: true }),
    checkMedia: async () => ({ ok: true }),
    checkLinks: async () => ({ ok: true }),
    checkDedup: async () => ({ ok: true }),
    renderMessage: async () => ({ ok: true, message: "fixture" }) });
  const run = criarExecutorFilaUniversal({ pool,
    repository: { preflightWorkspace: async () => ({ ok: true }),
      claimDestination: async () => target,
      releaseUnstarted: async args => { releases.push(args); return { ok: true }; } },
    prepare,
    dispatch: async () => { throw new Error("must_not_send"); } });
  await assert.rejects(run("ws_A"), /private destination state/);
  assert.equal(releases.length, 1);
  assert.equal(releases[0].destinationId, target.id);
  assert.equal(releases[0].preflightReason, "send_prepare_exception_check_session");
});
