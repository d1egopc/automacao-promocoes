"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { criarPreflightFilaUniversal } =
  require("../modules/engine/universal-queue-preflight");

const NOW = Date.parse("2026-10-10T12:30:00.000Z");
const EPOCH = "2026-10-10T11:00:00.000Z";
const pool = { connect() {} };
function fixture({ t0 = "2026-10-10T12:10:00.000Z", cupom = "",
  destinationId = "dest_A", workspaceId = "ws_A" } = {}) {
  return { workspace_id: workspaceId, destination_id: destinationId,
    capturado_em: t0, operationEpochStartedAt: EPOCH,
    evento_id: 1, oferta_id: 2, origem_fluxo: "optimus",
    item_payload: { clienteId: workspaceId, engineOfertaId: 2,
      marketplace: "mercadolivre", titulo: "Oferta", cupom } };
}
function build({ lastConfirmed = null, overrides = {} } = {}) {
  const passed = async () => ({ ok: true });
  return criarPreflightFilaUniversal({ pool, now: () => NOW,
    readClock: async () => lastConfirmed,
    resolveDestination: async ({ destinationId }) => ({ ok: true,
      destination: { id: destinationId, tipo: "whatsapp",
        intervaloMinutos: 2.5 } }),
    checkWindow: passed, checkDailyLimit: passed,
    checkSession: passed, checkCredits: passed,
    checkMedia: passed, checkLinks: passed, checkDedup: passed,
    renderMessage: async () => ({ ok: true, message: "fixture" }),
    ...overrides });
}

test("original T0 is revalidated before any destination/provider call", async () => {
  const preflight = build({ overrides: {
    resolveDestination: async () => { throw new Error("must_not_resolve"); }
  } });
  const stale = await preflight(fixture({ t0: "2026-10-10T11:55:00.000Z" }));
  assert.equal(stale.ready, false);
  assert.match(stale.reason, /expirada/);
  assert.equal(stale.terminalNoSend, true);
  const oldEpoch = await preflight(fixture({ t0: "2026-10-10T10:59:59.000Z" }));
  assert.equal(oldEpoch.reason, "universal_send_identity_or_t0_invalid");
});

test("normal 20 min stays fresh, factual Turbo at 15 min expires", async () => {
  const normal = await build()(fixture());
  assert.equal(normal.ready, true);
  assert.equal(normal.turbo.turbo, false);
  const turboExpired = await build()(fixture({
    t0: "2026-10-10T12:15:00.000Z", cupom: "APP20" }));
  assert.equal(turboExpired.ready, false);
  assert.match(turboExpired.reason, /expirada/);
  assert.equal(turboExpired.terminalNoSend, true);
  const turboFresh = await build()(fixture({
    t0: "2026-10-10T12:25:00.000Z", cupom: "APP20" }));
  assert.equal(turboFresh.ready, true);
  assert.equal(turboFresh.turbo.turbo, true);
});

test("destination A clock does not consume free destination B", async () => {
  const preflight = build({ overrides: {
    readClock: async ({ destinationId }) => destinationId === "dest_A"
      ? new Date(NOW - 60000) : null
  } });
  const a = await preflight(fixture({ destinationId: "dest_A" }));
  const b = await preflight(fixture({ destinationId: "dest_B" }));
  assert.equal(a.reason, "destination_cadence_wait");
  assert.equal(b.ready, true);
});

test("mandatory destination contracts fail closed before render", async () => {
  assert.throws(() => criarPreflightFilaUniversal({ pool }),
    /dependencies_required/);
  const check = build({ overrides: {
    checkMedia: async () => ({ ok: false, reason: "sem_imagem" }),
    renderMessage: async () => { throw new Error("must_not_render"); }
  } });
  const blocked = await check(fixture());
  assert.equal(blocked.reason, "sem_imagem");
  assert.equal(blocked.terminalFailure, true);
});

test("window closure carries reopening time without crossing provider", async () => {
  const retryAt = "2026-10-10T12:35:00.000Z";
  const check = build({ overrides: {
    checkWindow: async () => ({ ok: false,
      reason: "destination_window_closed", retryAt }),
    renderMessage: async () => { throw new Error("must_not_render"); }
  } });
  assert.deepEqual(await check(fixture()), { ready: false,
    reason: "destination_window_closed", retryAt });
});

test("session, credits and dedup are independent preprovider guards", async () => {
  for (const [gate, reason] of [
    ["checkSession", "session_offline"],
    ["checkCredits", "credits_missing"]
  ]) {
    const check = build({ overrides: { [gate]: async () => ({ ok: false, reason }),
      renderMessage: async () => { throw new Error("must_not_render"); } } });
    const result = await check(fixture());
    assert.equal(result.reason, reason);
    assert.equal(result.ready, false);
  }
  let rendered = false;
  const dedup = build({ overrides: {
    checkDedup: async () => ({ ok: false,
      reason: "already_confirmed_for_target" }),
    renderMessage: async () => { rendered = true;
      return { ok: true, message: "ready" }; }
  } });
  const result = await dedup(fixture());
  assert.equal(rendered, true);
  assert.equal(result.reason, "already_confirmed_for_target");
  assert.equal(result.ready, false);
});

test("mandatory affiliate link denial is technical, not a raw-link fallback", async () => {
  const check = build({ overrides: {
    checkLinks: async () => ({ ok: false, reason: "affiliate_link_missing" }),
    renderMessage: async () => { throw new Error("must_not_render"); }
  } });
  const result = await check(fixture());
  assert.equal(result.reason, "affiliate_link_missing");
  assert.equal(result.terminalFailure, true);
});

test("same-attempt revalidation does not reacquire the commercial reservation", async () => {
  let reservations = 0;
  const check = build({ overrides: {
    checkDedup: async () => { reservations += 1; return { ok: true }; }
  } });
  assert.equal((await check(fixture())).ready, true);
  assert.equal((await check(fixture(), { skipDedup: true })).ready, true);
  assert.equal(reservations, 1);
});
