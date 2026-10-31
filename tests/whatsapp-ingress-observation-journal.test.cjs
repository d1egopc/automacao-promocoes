"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  createIngressObservationJournal,
  MAX_BYTES,
  SLOT_BYTES,
  RETENTION_MS
} = require("../modules/whatsapp/ingress-observation-journal");

async function tempDirectory(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "optimus-ingress-journal-"));
  return directory;
}

function record(at, extra = {}) {
  return {
    kind: "stage", stage: "callback", at,
    workspaceRef: "a".repeat(16), sessionRef: "b".repeat(16),
    groupRef: "c".repeat(16), eventRef: "d".repeat(16),
    generation: 7, upsertType: "notify", fromMe: false, decision: "received",
    ...extra
  };
}

test("append is queued without synchronous filesystem output and sanitizer drops payload/identities", async t => {
  const directory = await tempDirectory(t);
  const scheduled = [];
  const journal = createIngressObservationJournal({ directory, now: () => 1_800_000_000_000, schedule: callback => scheduled.push(callback) });
  t.after(async () => { await journal.close(); await fs.rm(directory, { recursive: true, force: true }); });
  assert.equal(journal.append(record(1_800_000_000_000, {
    rawJid: "120363408782037034@g.us", workspaceId: "admin", sessionId: "admin_Zoiao Claro",
    phone: "+5511999999999", body: "PRIVATE MESSAGE", token: "SECRET", cookie: "COOKIE"
  })), true);
  assert.equal((await fs.readdir(directory)).length, 0);
  assert.equal(scheduled.length, 1);
  const pending = journal.flush();
  scheduled.shift()();
  await pending;
  const archive = await journal.read();
  assert.equal(archive.records.length, 1);
  const serialized = JSON.stringify(archive);
  for (const forbidden of ["120363408782037034@g.us", "admin_Zoiao Claro", "+5511999999999", "PRIVATE MESSAGE", "SECRET", "COOKIE"]) assert.equal(serialized.includes(forbidden), false, forbidden);
  assert.equal(journal.status().available, true);
});

test("journal has a hard physical cap and rotates the oldest bounded slot instead of stopping continuous capture", async t => {
  const directory = await tempDirectory(t);
  let now = 1_800_000_000_000;
  const journal = createIngressObservationJournal({ directory, now: () => now });
  t.after(async () => { await journal.close(); await fs.rm(directory, { recursive: true, force: true }); });
  assert.equal(await journal.open(), true);
  let batch = 0;
  while (journal.status().bytes < MAX_BYTES && batch < 30) {
    now += 1;
    for (let index = 0; index < 1000; index++) journal.append(record(now, { count: index }));
    await journal.flush();
    batch++;
  }
  const files = await fs.readdir(directory);
  const stats = await Promise.all(files.map(file => fs.stat(path.join(directory, file))));
  const physicalBytes = stats.reduce((sum, stat) => sum + stat.size, 0);
  assert.ok(physicalBytes <= MAX_BYTES);
  assert.equal(files.length, 4);
  assert.ok(stats.every(stat => stat.size <= SLOT_BYTES));
  assert.equal(journal.status().dropped, 0);
  assert.ok(journal.status().rotatedSlots > 0);
  journal.append(record(now + 1, { count: 987654 }));
  await journal.flush();
  assert.ok(journal.status().bytes <= MAX_BYTES);
  assert.ok(journal.status().rotatedSlots > 0);
  const newest = await journal.read();
  assert.ok(newest.records.some(item => item.count === 987654));
});

test("expired journal slots are physically removed at the next safe initialization", async t => {
  const directory = await tempDirectory(t);
  let now = 1_800_000_000_000;
  const first = createIngressObservationJournal({ directory, now: () => now });
  await first.open();
  first.append(record(now));
  await first.flush();
  await first.close();
  assert.equal((await fs.readdir(directory)).length, 1);
  now += RETENTION_MS + 1;
  const second = createIngressObservationJournal({ directory, now: () => now });
  t.after(async () => { await second.close(); await fs.rm(directory, { recursive: true, force: true }); });
  assert.equal(await second.open(), true);
  const files = await fs.readdir(directory);
  assert.equal(files.length, 1);
  assert.equal((await fs.stat(path.join(directory, files[0]))).size, 0);
  assert.equal((await second.read()).records.length, 0);
});

test("slot symlinks fail closed", async t => {
  const directory = await tempDirectory(t);
  const target = path.join(directory, "target.jsonl");
  await fs.writeFile(target, "{}");
  try { await fs.symlink(target, path.join(directory, "radar-whatsapp-ingress-slot-0.jsonl")); }
  catch (error) { if (["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) return t.skip("symlink creation not available"); throw error; }
  const journal = createIngressObservationJournal({ directory });
  t.after(async () => { await journal.close(); await fs.rm(directory, { recursive: true, force: true }); });
  assert.equal(await journal.open(), false);
  assert.equal(journal.status().failed, true);
});
