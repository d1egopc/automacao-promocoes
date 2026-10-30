"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const scoped = require("../modules/engine/auto-clean/recurring-admin-events");

test("OFF stays free of filesystem and database work", async () => {
  const old = process.env[scoped.RELEASE];
  delete process.env[scoped.RELEASE];
  try {
    const result = await scoped.run({ pool: { connect() { throw Error("must not connect"); } },
      dataDir: "unreachable" });
    assert.equal(result.removed, 0);
    assert.equal(result.reason, "AUTO_CLEAN_ORIGIN_NOT_RELEASED");
  } finally { old === undefined ? delete process.env[scoped.RELEASE] : process.env[scoped.RELEASE] = old; }
});

test("archive is private, verified and expires only after 72h", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "auto-clean-admin-archive-"));
  try {
    const directory = await scoped.safeDirectory(root);
    const now = Date.now();
    const saved = await scoped.archiveRow(directory, { id: "17", texto_original: "private fixture" }, now);
    const retried = await scoped.archiveRow(directory, { id: "17", texto_original: "private fixture" }, now + 1);
    assert.equal(retried.file, saved.file, "retry uses the same verified archive");
    const filename = path.basename(saved.file);
    assert.ok(scoped.validArchive(JSON.parse(fs.readFileSync(saved.file, "utf8")), filename));
    assert.equal((await scoped.inventory(directory, now + scoped.RECOVERY_MS - 1)).count, 1);
    assert.equal(fs.existsSync(saved.file), true);
    assert.equal((await scoped.inventory(directory, now + scoped.RECOVERY_MS + 1)).count, 0);
    assert.equal(fs.existsSync(saved.file), false);
    if (process.platform !== "win32") assert.equal((fs.statSync(directory).mode & 0o077), 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("unknown content blocks without deleting it", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "auto-clean-admin-archive-"));
  try {
    const directory = await scoped.safeDirectory(root);
    const foreign = path.join(directory, "protected-backup.dump");
    fs.writeFileSync(foreign, "protected");
    await assert.rejects(scoped.inventory(directory, Date.now()), {code:"AUTO_CLEAN_RECOVERY_UNKNOWN_FILE"});
    assert.equal(fs.readFileSync(foreign, "utf8"), "protected");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
