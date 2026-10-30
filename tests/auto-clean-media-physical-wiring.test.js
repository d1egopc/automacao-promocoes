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

async function capture(physical, execute) {
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
  console.log("AUTO_CLEAN_MEDIA_PHYSICAL_WIRING_TESTS_PASS");
}

run().catch(error => { console.error(error); process.exitCode = 1; });
