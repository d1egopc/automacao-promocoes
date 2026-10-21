"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");

test("release includes the commercial bootstrap modules from the active image", () => {
  const diagnostic = require(path.join(root, "modules/radar/redirect/redirect-diagnostic-code"));
  assert.equal(typeof diagnostic.normalizarMotivoTecnicoRedirect, "function");
  assert.equal(diagnostic.normalizarMotivoTecnicoRedirect("redirect_timeout"), "redirect_timeout");

  const contextual = require(path.join(root, "modules/radar/redirect/contextual-html-candidate"));
  assert.equal(typeof contextual, "object");

  const capture = require(path.join(root, "modules/links/engine-capture-diagnostic.routes"));
  assert.equal(typeof capture, "object");

  assert.doesNotThrow(() => require(path.join(root, "modules/engine/inbox.service")));
});
