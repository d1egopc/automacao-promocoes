"use strict";

// Delivery of an existing tel_ grant, never an alternative identity provider.
const crypto = require("node:crypto");
const valid = (value) =>
  typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
const digest = (value) =>
  crypto.createHash("sha256").update(value).digest("base64url");

function createAuditRequests({
  now = Date.now,
  createGrant,
  grantActive,
  maxPending = 20,
} = {}) {
  const pending = new Map();
  function prune() {
    for (const [id, item] of pending)
      if (item.expiresAt <= now()) pending.delete(id);
  }
  function request(challenge) {
    prune();
    if (!valid(challenge)) return { ok: false, error: "invalid_challenge" };
    if (pending.size >= maxPending)
      return { ok: false, error: "request_capacity" };
    const id = crypto.randomBytes(32).toString("base64url");
    const expiresAt = now() + 5 * 60_000;
    pending.set(id, { challenge, expiresAt, state: "pending", lastPoll: 0 });
    return { ok: true, requestId: id, expiresAt, pollAfterMs: 5000 };
  }
  function approve(id, options) {
    prune();
    const item = pending.get(id);
    if (!item || item.state !== "pending")
      return { ok: false, error: "request_unavailable" };
    const grant = createGrant(options);
    if (!grant.ok) return grant;
    item.state = "approved";
    item.grant = grant;
    return {
      ok: true,
      requestId: id,
      auditoriaId: grant.auditoriaId,
      expiraEm: grant.expiraEm,
      escopo: grant.escopo,
      clienteId: grant.clienteId,
    };
  }
  function collect(id, verifier) {
    prune();
    const item = pending.get(id);
    if (!item || !valid(verifier))
      return { ok: false, error: "request_unavailable" };
    const expected = Buffer.from(item.challenge);
    const actual = Buffer.from(digest(verifier));
    if (
      expected.length !== actual.length ||
      !crypto.timingSafeEqual(expected, actual)
    )
      return { ok: false, error: "request_unavailable" };
    if (item.lastPoll && now() - item.lastPoll < 5000)
      return { ok: false, error: "poll_too_frequent" };
    item.lastPoll = now();
    if (item.state === "pending") return { ok: true, state: "pending" };
    pending.delete(id); // one delivery; restart discards every pending request
    if (!grantActive(item.grant.codigo))
      return { ok: false, error: "grant_unavailable" };
    return { ok: true, state: "authorized", ...item.grant };
  }
  return { request, approve, collect };
}

module.exports = { createAuditRequests, digest };
