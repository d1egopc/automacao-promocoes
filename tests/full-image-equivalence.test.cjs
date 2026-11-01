"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { createManifest, shouldRunAsCli } = require("../scripts/full-image-runtime-manifest.cjs");
const { compare } = require("../scripts/verify-full-image-equivalence.cjs");
const tempRoot = path.join(__dirname, "..", "tmp", "test-tmp");
fs.mkdirSync(tempRoot, { recursive: true });
const fixtures = [];
test.after(() => { for (const item of fixtures) fs.rmSync(item, { recursive: true, force: true }); });

test("manifesto executa ao receber código via node stdin", () => {
  assert.equal(shouldRunAsCli({ isMainModule: false, stdinMarker: "-" }), true);
  assert.equal(shouldRunAsCli({ isMainModule: true, stdinMarker: undefined }), true);
  assert.equal(shouldRunAsCli({ isMainModule: false, stdinMarker: "scripts/full-image-runtime-manifest.cjs" }), false);
});

function fixture() {
  const directory = fs.mkdtempSync(path.join(tempRoot, "full-image-"));
  fixtures.push(directory);
  return directory;
}
function hash(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function file(pathValue, content, mode = 0o644) {
  return { path: pathValue, type: "file", mode, uid: 1000, gid: 1000, size: Buffer.byteLength(content), sha256: hash(content) };
}
function manifest(entries, metadata = { dependencyTreeSha256: "a".repeat(64), nodeVersion: "v24.0.0" }) {
  return { schemaVersion: 1, metadata, entries: entries.slice().sort((a, b) => a.path.localeCompare(b.path)), summary: { runtimeFileCount: entries.length } };
}
function writeManifest(directory, name, value) {
  const target = path.join(directory, `${name}.json`);
  fs.writeFileSync(target, JSON.stringify(value));
  return target;
}

test("manifesto inclui código runtime e hash de dependências, omitindo conteúdo e ferramentas de release", async () => {
  const root = fixture();
  fs.mkdirSync(path.join(root, "node_modules", "pkg"), { recursive: true });
  fs.mkdirSync(path.join(root, "docs"), { recursive: true });
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(root, "index.js"), "secret-like app content is represented only by hash");
  fs.writeFileSync(path.join(root, "node_modules", "pkg", "index.js"), "dependency bytes");
  fs.writeFileSync(path.join(root, "docs", "note.md"), "doc");
  fs.writeFileSync(path.join(root, "scripts", "guardian-v1.cjs"), "build control");
  const facts = `${root}-host-facts`;
  fixtures.push(facts);
  fs.mkdirSync(facts, { recursive: true });
  const osRelease = path.join(facts, "os-release");
  const dpkgStatus = path.join(facts, "dpkg-status");
  fs.writeFileSync(osRelease, "ID=debian\nVERSION_ID=12\n");
  fs.writeFileSync(dpkgStatus, "Package: base-files\nStatus: install ok installed\nVersion: 12.4\nArchitecture: amd64\n\n");
  const result = await createManifest({ root, osReleasePath: osRelease, dpkgStatusPath: dpkgStatus, npmVersion: "10.8.0" });
  assert.deepEqual(result.entries.map(entry => entry.path), ["index.js"]);
  assert.equal(result.entries[0].sha256, hash("secret-like app content is represented only by hash"));
  assert.equal(result.metadata.dependencyEntryCount, 2);
  assert.equal(result.metadata.installedPackageCount, 1);
  assert.equal(JSON.stringify(result).includes("secret-like app content"), false);
});

test("paridade exata active/base e delta aprovado candidato/base passam", () => {
  const dir = fixture();
  const meta = { dependencyTreeSha256: "a".repeat(64), nodeVersion: "v24.0.0", installedPackagesSha256: "b".repeat(64) };
  const active = manifest([file("index.js", "base"), file("modules/whatsapp/observer.js", "old")], meta);
  const base = manifest(active.entries, meta);
  const candidate = manifest([
    file("index.js", "candidate"),
    file("modules/whatsapp/observer.js", "new"),
    file("modules/whatsapp/journal.js", "new-file")
  ], meta);
  const result = compare({
    active: writeManifest(dir, "active", active), base: writeManifest(dir, "base", base), candidate: writeManifest(dir, "candidate", candidate),
    approvedChanges: [
      { path: "index.js", status: "M" },
      { path: "modules/whatsapp/observer.js", status: "M" },
      { path: "modules/whatsapp/journal.js", status: "A" }
    ]
  });
  assert.equal(result.result, "PASS");
  assert.deepEqual(result.changedRuntimeFiles, ["M:index.js", "A:modules/whatsapp/journal.js", "M:modules/whatsapp/observer.js"]);
});

test("divergência active/base, alteração extra, exclusão e dependências diferentes bloqueiam", () => {
  const dir = fixture();
  const meta = { dependencyTreeSha256: "a".repeat(64), nodeVersion: "v24.0.0" };
  const active = manifest([file("index.js", "base")], meta);
  const goodBase = manifest(active.entries, meta);
  const candidateExtra = manifest([file("index.js", "candidate"), file("modules/other.js", "extra")], meta);
  const paths = {
    active: writeManifest(dir, "active", active),
    base: writeManifest(dir, "base", goodBase),
    candidate: writeManifest(dir, "candidate", candidateExtra)
  };
  const approved = [{ path: "index.js", status: "M" }];
  assert.throws(() => compare({ ...paths, approvedChanges: approved }), /candidate_runtime_delta_mismatch/);
  assert.throws(() => compare({
    ...paths,
    active: writeManifest(dir, "active-mismatch", manifest([file("index.js", "other")], meta)),
    approvedChanges: approved
  }), /active_base_runtime_tree_mismatch/);
  assert.throws(() => compare({
    ...paths,
    candidate: writeManifest(dir, "candidate-dependency-mismatch", manifest([file("index.js", "candidate")], { ...meta, dependencyTreeSha256: "c".repeat(64) })),
    approvedChanges: approved
  }), /candidate_runtime_metadata_mismatch/);
  assert.throws(() => compare({
    ...paths,
    candidate: writeManifest(dir, "candidate-deleted", manifest([], meta)),
    approvedChanges: approved
  }), /candidate_runtime_delta_mismatch/);
});

test("manifesto rejeita caminhos maliciosos e entradas duplicadas", () => {
  const dir = fixture();
  const badPath = writeManifest(dir, "bad-path", manifest([{ ...file("../outside", "x") }]));
  assert.throws(() => compare({ active: badPath, base: badPath, candidate: badPath, approvedChanges: [] }), /invalid_manifest_path/);
  const duplicate = writeManifest(dir, "duplicate", {
    schemaVersion: 1,
    metadata: {},
    entries: [file("index.js", "one"), file("index.js", "two")]
  });
  assert.throws(() => compare({ active: duplicate, base: duplicate, candidate: duplicate, approvedChanges: [] }), /invalid_manifest_path/);
});
