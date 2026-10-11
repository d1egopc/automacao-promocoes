"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { classificarFilaUniversal } =
  require("../modules/engine/universal-queue-status");

test("terminal public outcomes reflect confirmed destinations", () => {
  assert.deepEqual(classificarFilaUniversal([]),
    { status: "no_opportunity", terminal: true });
  assert.equal(classificarFilaUniversal(["sent", "sent"]).status, "sent");
  assert.deepEqual(classificarFilaUniversal(["sent", "pending"]).terminal, false);
  assert.deepEqual(classificarFilaUniversal(["sent", "skipped"]).status, "partial");
  assert.deepEqual(classificarFilaUniversal(["failed", "skipped"]).status, "error");
  assert.deepEqual(classificarFilaUniversal(["skipped"]).status, "not_sent");
});

test("ambiguous provider outcome stays open and never becomes a false terminal", () => {
  assert.deepEqual(classificarFilaUniversal(["sent", "ambiguous"]).terminal, false);
  assert.deepEqual(classificarFilaUniversal(["ambiguous"]).terminal, false);
  assert.throws(() => classificarFilaUniversal(["invented"]), /unknown/);
});
