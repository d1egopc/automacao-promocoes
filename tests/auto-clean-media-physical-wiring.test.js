"use strict";

process.env.OPTIMUS_AUTO_CLEAN_MEDIA_DELETE_RELEASE = "approved"; // wiring fixture only
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  autoCleanMediaPhysicalAutorizado,
  executarAutoCleanShadow
} = require("../modules/engine/auto-clean/auto-clean.service");

async function capture(physical, execute, shadowReadOnly = false) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-media-wiring-"));
  const oldPhysical = process.env.OPTIMUS_AUTO_CLEAN_MEDIA_PHYSICAL;
  const oldExecute = process.env.OPTIMUS_AUTO_CLEAN_MEDIA_EXECUTE;
  let captured;
  try {
    if (physical === undefined) delete process.env.OPTIMUS_AUTO_CLEAN_MEDIA_PHYSICAL;
    else process.env.OPTIMUS_AUTO_CLEAN_MEDIA_PHYSICAL = physical;
    if (execute === undefined) delete process.env.OPTIMUS_AUTO_CLEAN_MEDIA_EXECUTE;
    else process.env.OPTIMUS_AUTO_CLEAN_MEDIA_EXECUTE = execute;
    await executarAutoCleanShadow({
      dataDir,
      incluirPostgres: false,
      incluirArquivos: true,
      shadowReadOnly,
      // Deliberately attempt to bypass the gates; the wiring must override it.
      gcRelayOptions: { mediaPhysicalEnabled: true, execute: true, mediaDeleteEnabled: true },
      gcRelay: async options => { captured = options; return { dryRun: true, mediaPhysical: { dryRun: true } }; },
      logger: { log() {} }
    });
    return captured;
  } finally {
    if (oldPhysical === undefined) delete process.env.OPTIMUS_AUTO_CLEAN_MEDIA_PHYSICAL;
    else process.env.OPTIMUS_AUTO_CLEAN_MEDIA_PHYSICAL = oldPhysical;
    if (oldExecute === undefined) delete process.env.OPTIMUS_AUTO_CLEAN_MEDIA_EXECUTE;
    else process.env.OPTIMUS_AUTO_CLEAN_MEDIA_EXECUTE = oldExecute;
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

async function assertCase(physical, execute, expectedPhysical, expectedExecute) {
  const result = await capture(physical, execute);
  assert.equal(result.mediaPhysicalEnabled, expectedPhysical);
  assert.equal(result.execute, expectedExecute);
  assert.equal(result.mediaDeleteEnabled, expectedExecute);
}

async function run() {
  assert.deepEqual(autoCleanMediaPhysicalAutorizado(), { physical: false, execute: false });
  await assertCase(undefined, undefined, false, false);
  await assertCase("true", undefined, true, false);
  await assertCase(undefined, "true", false, false);
  await assertCase("1", "true", false, false);
  await assertCase("true", "1", true, false);
  await assertCase("true", "true", true, true);
  const detachedShadow = await capture("true", "true", true);
  assert.equal(detachedShadow.mediaPhysicalEnabled, true);
  assert.equal(detachedShadow.execute, false,
    "detached Shadow never inherits physical delete authorization");
  assert.equal(detachedShadow.mediaDeleteEnabled, false);

  const oldGlobal = process.env.OPTIMUS_AUTO_CLEAN_MEDIA_DELETE_RELEASE;
  const oldScoped = process.env.OPTIMUS_AUTO_CLEAN_MEDIA_SCOPED_RELEASE;
  const oldScopes = process.env.OPTIMUS_AUTO_CLEAN_MEDIA_SCOPES;
  try {
    delete process.env.OPTIMUS_AUTO_CLEAN_MEDIA_DELETE_RELEASE;
    process.env.OPTIMUS_AUTO_CLEAN_MEDIA_SCOPED_RELEASE = "approved";
    process.env.OPTIMUS_AUTO_CLEAN_MEDIA_SCOPES = "identity:user_safe";
    const scoped = await capture("true", "true");
    assert.equal(scoped.execute, true, "explicit workspace release reaches the recurring relay");
    assert.equal(scoped.mediaDeleteEnabled, true);

    process.env.OPTIMUS_AUTO_CLEAN_MEDIA_SCOPES = "identity:*";
    const wildcard = await capture("true", "true");
    assert.equal(wildcard.execute, false, "wildcard never grants physical authorization");
    assert.equal(wildcard.mediaDeleteEnabled, false);

    process.env.OPTIMUS_AUTO_CLEAN_MEDIA_SCOPES = "identity:user_safe,identity:*";
    assert.equal((await capture("true", "true")).execute, false,
      "a malformed mixed scope list fails closed");
  } finally {
    if (oldGlobal === undefined) delete process.env.OPTIMUS_AUTO_CLEAN_MEDIA_DELETE_RELEASE;
    else process.env.OPTIMUS_AUTO_CLEAN_MEDIA_DELETE_RELEASE = oldGlobal;
    if (oldScoped === undefined) delete process.env.OPTIMUS_AUTO_CLEAN_MEDIA_SCOPED_RELEASE;
    else process.env.OPTIMUS_AUTO_CLEAN_MEDIA_SCOPED_RELEASE = oldScoped;
    if (oldScopes === undefined) delete process.env.OPTIMUS_AUTO_CLEAN_MEDIA_SCOPES;
    else process.env.OPTIMUS_AUTO_CLEAN_MEDIA_SCOPES = oldScopes;
  }
  console.log("AUTO_CLEAN_MEDIA_PHYSICAL_WIRING_TESTS_PASS");
}

run().catch(error => { console.error(error); process.exitCode = 1; });
