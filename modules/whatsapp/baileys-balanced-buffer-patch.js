"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const FILE = "node_modules/@whiskeysockets/baileys/lib/Utils/event-buffer.js";
const BASE_HASH = "d2d9a7b26868de3086bf444576f41beb296c0867767cb5782fcd34ab6281a37c";
const edits = [
  ["    let isBuffering = false;", `    let isBuffering = false;
    // Explicit synchronization holds are independent of async operation holds.
    let explicitHold = false, pendingWorks = 0, releaseTimer;
    const cancelRelease = () => { if (releaseTimer) clearTimeout(releaseTimer); releaseTimer = undefined; };
    const deferRelease = () => {
        if (explicitHold || pendingWorks || !isBuffering || releaseTimer) return;
        releaseTimer = setTimeout(() => {
            releaseTimer = undefined;
            if (!explicitHold && !pendingWorks) flush();
        }, 100);
    };`],
  ["    function buffer() {\n        if (!isBuffering)", "    function buffer() {\n        explicitHold = true;\n        cancelRelease();\n        if (!isBuffering)"],
  ["    function flush() {\n        if (!isBuffering)", `    function flush() {
        explicitHold = false;
        cancelRelease();
        // Initial sync may finish while an async upsert is still running.
        if (pendingWorks) return false;
        if (!isBuffering)`],
  [`                buffer();
                try {
                    return await work(...args);
                }
                finally {
                    // Flushing is now controlled centrally by the state machine.
                }`, `                cancelRelease();
                pendingWorks++;
                isBuffering = true;
                try {
                    return await work(...args);
                }
                finally {
                    pendingWorks--;
                    deferRelease();
                }`]
];
const hash = s => crypto.createHash("sha256").update(s).digest("hex");
function transform(source) {
  if (hash(source) !== BASE_HASH) throw new Error("balanced_buffer_base_hash_mismatch");
  for (const [before, after] of edits) {
    if (source.split(before).length !== 2) throw new Error("balanced_buffer_signature_mismatch");
    source = source.replace(before, after);
  }
  return source;
}
function applyPatch({rootDir = process.cwd()} = {}) {
  const root = path.join(rootDir, "node_modules/@whiskeysockets/baileys");
  if (JSON.parse(fs.readFileSync(path.join(root,"package.json"),"utf8")).version !== "6.7.22") throw new Error("balanced_buffer_version_mismatch");
  const file = path.join(rootDir, FILE), stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("balanced_buffer_not_regular");
  const source = fs.readFileSync(file,"utf8");
  if (hash(source) !== BASE_HASH) {
    let original = source;
    for (const [before, after] of [...edits].reverse()) {
      if (original.split(after).length !== 2) throw new Error("balanced_buffer_foreign_content");
      original = original.replace(after,before);
    }
    if (transform(original) !== source) throw new Error("balanced_buffer_foreign_content");
    return {status:"already_applied",hash:hash(source)};
  }
  const result = transform(source);
  fs.writeFileSync(file,result,"utf8");
  return {status:"applied",hash:hash(result)};
}
module.exports = {transform, applyPatch, BASE_HASH, FILE};
