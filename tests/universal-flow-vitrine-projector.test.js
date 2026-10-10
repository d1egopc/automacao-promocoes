"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { processVitrineProjectionBatch } =
  require("../modules/engine/universal-vitrine-projector");

test("post-send projection handles success, retry, and expired offer", async () => {
  const current = Date.parse("2026-10-10T12:00:00Z");
  const claims = [
    { queueItemId: 1, attempts: 1,
      terminalAt: "2026-10-10T11:00:00Z" },
    { queueItemId: 2, attempts: 1,
      terminalAt: "2026-10-10T11:00:00Z" },
    { queueItemId: 3, attempts: 1,
      terminalAt: "2026-10-01T11:00:00Z" }
  ];
  const finished = [];
  const published = [];
  let cleanup = 0;
  const repository = {
    claimVitrineProjection: async () => claims.shift() || { empty: true },
    finishVitrineProjection: async args => {
      finished.push(args);
      return { ok: true };
    },
    cleanupVitrineProjections: async () => { cleanup += 1; }
  };
  const result = await processVitrineProjectionBatch({ pool: {}, repository,
    now: () => current, retentionMs: 72 * 60 * 60 * 1000,
    buildOffer: claim => ({ id: claim.queueItemId }),
    publish: async (claim, offer) => {
      published.push([claim.queueItemId, offer.id]);
      return claim.queueItemId === 1
        ? { ok: true, motivo: "publicada" }
        : { ok: false, motivo: "vitrine_hook_falhou" };
    } });
  assert.deepEqual(result, { claimed: 3, completed: 1, skipped: 1,
    failed: 0, retried: 1 });
  assert.deepEqual(published, [[1, 1], [2, 2]]);
  assert.deepEqual(finished.map(item => item.result),
    ["completed", "retry", "skipped"]);
  assert.equal(finished[2].reason, "vitrine_retention_expired");
  assert.equal(cleanup, 1);
});

test("repeated transient failure is bounded and terminal", async () => {
  const finished = [];
  const repository = {
    claimVitrineProjection: async () => finished.length
      ? { empty: true }
      : { queueItemId: 7, attempts: 10,
        terminalAt: "2026-10-10T11:00:00Z" },
    finishVitrineProjection: async args => { finished.push(args); },
    cleanupVitrineProjections: async () => {}
  };
  const result = await processVitrineProjectionBatch({ pool: {}, repository,
    now: () => Date.parse("2026-10-10T12:00:00Z"),
    retentionMs: 72 * 60 * 60 * 1000,
    buildOffer: claim => claim,
    publish: async () => { throw new Error("fixture_failure"); } });
  assert.equal(result.failed, 1);
  assert.equal(finished[0].result, "failed");
  assert.equal(finished[0].reason, "fixture_failure");
});
