"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { statusPublico } =
  require("../modules/engine/universal-history.read-model");

test("only factual terminal statuses map into History", () => {
  assert.equal(statusPublico("sent"), "enviada");
  assert.equal(statusPublico("partial"), "parcial");
  assert.equal(statusPublico("not_sent"), "nao_enviada");
  assert.equal(statusPublico("error"), "erro");
  assert.equal(statusPublico("no_opportunity"), "nao_elegivel");
  assert.throws(() => statusPublico("pending"), /not_terminal/);
});
