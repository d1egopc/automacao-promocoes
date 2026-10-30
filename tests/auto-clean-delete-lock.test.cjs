"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const clean = require("../modules/engine/auto-clean/auto-clean.service");
const { deleteEnabled, runMediaPhysical, RETENTION_MS, OBSERVATION_DELAY_MS } =
  require("../modules/engine/auto-clean/gc-media-physical.service");
const { DB_RELEASE, FILE_RELEASE, MEDIA_RELEASE } = require("../modules/engine/auto-clean/deletion-release");

async function withoutRelease(fn) {
  const names = [DB_RELEASE, FILE_RELEASE, MEDIA_RELEASE];
  const prior = names.map(name => process.env[name]);
  try {
    for (const name of names) delete process.env[name];
    return await fn();
  } finally {
    names.forEach((name, index) => {
      if (prior[index] === undefined) delete process.env[name];
      else process.env[name] = prior[index];
    });
  }
}

test("existing flags and caller options cannot bypass the productive delete lock", async () => withoutRelease(async () => {
  let dbAccesses = 0;
  const options = {execute: true, recorrente: true,
    pool: {connect: async () => { dbAccesses++; throw Error("database accessed"); }} };
  assert.equal(clean.autoCleanExecuteAtivo(options), false);
  for (const name of ["executarJobsPostgresAutoClean", "executarOrfaosPostgresAutoClean",
    "executarHistoricoDefinitivoPostgresAutoClean", "executarOfertasPostgresAutoClean",
    "executarLinksPostgresAutoClean", "executarEventosBrutosPostgresAutoClean",
    "executarAutoCleanExecute", "executarAutoCleanPostgresRecorrenteSeguro"]) {
    await assert.rejects(clean[name](options), {code: "AUTO_CLEAN_DELETE_LOCKED"}, name);
  }
  assert.equal(dbAccesses, 0);
  for (const name of ["executarCompactacaoFilaWorkspace", "executarFilaJsonAutoClean",
    "executarArquivosAutoClean", "executarFilaThumbnailsAutoClean"]) {
    assert.throws(() => clean[name](options), {code: "AUTO_CLEAN_DELETE_LOCKED"}, name);
  }
  assert.equal(deleteEnabled({execute: true, mediaDeleteEnabled: true}), false);
  process.env.OPTIMUS_AUTO_CLEAN_MEDIA_EXECUTE = "true";
  process.env.OPTIMUS_AUTO_CLEAN_MEDIA_PHYSICAL = "true";
  try {
    assert.equal(deleteEnabled({execute: true, mediaDeleteEnabled: true}), false);
    assert.deepEqual(clean.autoCleanMediaPhysicalAutorizado(), {physical: true, execute: false});
  } finally {
    delete process.env.OPTIMUS_AUTO_CLEAN_MEDIA_EXECUTE;
    delete process.env.OPTIMUS_AUTO_CLEAN_MEDIA_PHYSICAL;
  }
}));

test("each release is exact and independent", async () => withoutRelease(async () => {
  process.env[DB_RELEASE] = "true";
  process.env[MEDIA_RELEASE] = "true";
  assert.equal(clean.autoCleanExecuteAtivo({execute: true}), false);
  assert.equal(deleteEnabled({execute: true, mediaDeleteEnabled: true}), false);
  process.env[DB_RELEASE] = "approved";
  assert.equal(clean.autoCleanExecuteAtivo({execute: true}), true);
  assert.equal(deleteEnabled({execute: true, mediaDeleteEnabled: true}), false);
  process.env[MEDIA_RELEASE] = "approved";
  assert.equal(deleteEnabled({execute: true, mediaDeleteEnabled: true}), true);
  assert.throws(() => clean.executarArquivosAutoClean({}), {code: "AUTO_CLEAN_DELETE_LOCKED"});
}));

test("media GC keeps an eligible file with the old flag and respects mid-run revocation", async () => withoutRelease(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "auto-clean-lock-"));
  const mediaDir = path.join(dataDir, "identidade-visual-ofertas", "clientes", "user_test", "renderizados");
  const file = path.join(mediaDir, `${"a".repeat(64)}.png`);
  const nowMs = Date.now();
  try {
    fs.mkdirSync(mediaDir, {recursive: true});
    fs.writeFileSync(file, "fixture");
    const old = new Date(nowMs - RETENTION_MS - 60_000);
    fs.utimesSync(file, old, old);
    const options = {dataDir, execute: true, mediaDeleteEnabled: true,
      referenceLoader: async () => ({complete: true, refs: new Map(), generation: "fixture"})};
    await runMediaPhysical({...options, nowMs});
    process.env.OPTIMUS_AUTO_CLEAN_MEDIA_EXECUTE = "true";
    const locked = await runMediaPhysical({...options, nowMs: nowMs + OBSERVATION_DELAY_MS + 1});
    assert.equal(locked.dryRun, true);
    assert.equal(locked.removed, 0);
    assert.equal(fs.existsSync(file), true);
    process.env[MEDIA_RELEASE] = "approved";
    const revoked = await runMediaPhysical({...options, nowMs: nowMs + 2 * OBSERVATION_DELAY_MS + 2,
      beforeRevalidate: async () => { delete process.env[MEDIA_RELEASE]; }});
    assert.equal(revoked.stopReason, "delete_release_revoked");
    assert.equal(revoked.removed, 0);
    assert.equal(fs.existsSync(file), true);
  } finally {
    delete process.env.OPTIMUS_AUTO_CLEAN_MEDIA_EXECUTE;
    fs.rmSync(dataDir, {recursive: true, force: true});
  }
}));
