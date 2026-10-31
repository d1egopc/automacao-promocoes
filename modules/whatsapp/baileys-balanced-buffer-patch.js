"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const FILE = "node_modules/@whiskeysockets/baileys/lib/Utils/event-buffer.js";
const BASE_HASH = "d2d9a7b26868de3086bf444576f41beb296c0867767cb5782fcd34ab6281a37c";
const LEGACY_HASH = "aaee6567218d513a254503b472a3497b0c39e9836e25893247e23db2a548aff4";
const legacyEdits = [
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
const edits = [
  ...legacyEdits,
  ["export const makeEventBuffer = (logger) => {", "export const makeEventBuffer = (logger, observer) => {"],
  ["    };\n    // take the generic event and fire it as a baileys event", `    };
    const observe = (kind, reason) => {
        try {
            if (typeof observer?.recordBufferObservation === 'function') {
                observer.recordBufferObservation({ kind, reason, buffering: isBuffering, explicitHold, pendingWorks });
            }
        }
        catch { /* diagnostics never alter buffer behavior */ }
    };
    // take the generic event and fire it as a baileys event`],
  ["    function buffer() {\n        explicitHold = true;", "    function buffer(reason = 'unspecified') {\n        explicitHold = true;"],
  ["            isBuffering = true;\n        }\n    }\n    function flush() {", "            isBuffering = true;\n        }\n        observe('buffer_requested', reason);\n    }\n    function flush(reason = 'unspecified') {"],
  ["        cancelRelease();\n        // Initial sync may finish while an async upsert is still running.\n        if (pendingWorks) return false;", "        cancelRelease();\n        observe('flush_requested', reason);\n        // Initial sync may finish while an async upsert is still running.\n        if (pendingWorks) return false;"],
  ["        logger.trace({ conditionalChatUpdatesLeft }, 'released buffered events');\n        return true;", "        logger.trace({ conditionalChatUpdatesLeft }, 'released buffered events');\n        observe('flush_completed', reason);\n        return true;"],
  ["                isBuffering = true;\n                try {\n                    return await work(...args);", "                isBuffering = true;\n                observe('work_started', 'buffered_work');\n                try {\n                    return await work(...args);"],
  ["                    pendingWorks--;\n                    deferRelease();", "                    pendingWorks--;\n                    observe('work_completed', 'buffered_work');\n                    deferRelease();"],
  ["if (!explicitHold && !pendingWorks) flush();", "if (!explicitHold && !pendingWorks) flush('deferred_work_complete');"]
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
function transformLegacy(source) {
  if (hash(source) !== BASE_HASH) throw new Error("balanced_buffer_base_hash_mismatch");
  for (const [before, after] of legacyEdits) {
    if (source.split(before).length !== 2) throw new Error("balanced_buffer_signature_mismatch");
    source=source.replace(before,after);
  }
  return source;
}
function applyPatch({rootDir = process.cwd()} = {}) {
  const root = path.join(rootDir, "node_modules/@whiskeysockets/baileys");
  if (JSON.parse(fs.readFileSync(path.join(root,"package.json"),"utf8")).version !== "6.7.22") throw new Error("balanced_buffer_version_mismatch");
  const file = path.join(rootDir, FILE), stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("balanced_buffer_not_regular");
  const source = fs.readFileSync(file,"utf8");
  if (hash(source) === PATCH_HASH) return {status:"already_applied",hash:hash(source)};
  if (hash(source) !== BASE_HASH) {
    let original = source;
    const reverseEdits = hash(source) === LEGACY_HASH ? legacyEdits : edits;
    for (const [before, after] of [...reverseEdits].reverse()) {
      if (original.split(after).length !== 2) throw new Error("balanced_buffer_foreign_content");
      original = original.replace(after,before);
    }
    if (hash(original) !== BASE_HASH) throw new Error("balanced_buffer_foreign_content");
    const result = transform(original);
    fs.writeFileSync(file,result,"utf8");
    return {status:"upgraded",hash:hash(result)};
  }
  const result = transform(source);
  fs.writeFileSync(file,result,"utf8");
  return {status:"applied",hash:hash(result)};
}
const PATCH_HASH = "786a23aa9681d029dbce8bbd8841378d419ed3b8bb6cf6a9884a3b0b691bc4b5";
module.exports = {transform, transformLegacy, applyPatch, BASE_HASH, LEGACY_HASH, PATCH_HASH, FILE};
