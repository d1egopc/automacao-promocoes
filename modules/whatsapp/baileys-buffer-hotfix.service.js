"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const VERSION = "6.7.22";
const ROOT = "node_modules/@whiskeysockets/baileys/";
// Baselines include the already-homologated retry hotfix, not another tarball.
const ORIGINAL_HASHES = {"lib/Socket/socket.js": "2d16ab13464a155a3441f497ae7625d1760a0654659ae422a361e0c99fb1cc0c", "lib/Socket/messages-recv.js": "2a754ae09c8ad053486ae3b9743db6868e60f2e77e8fa695c4138e9667a76dd5", "lib/Socket/chats.js": "9eef48356529d9078e0a09ae94d443e29c2795a0c86c64f3d47580994884add4"};
const EDITS = {
  "lib/Socket/socket.js": [
    ["            didStartBuffer = true;", "            didStartBuffer = true;\n            config.optimusInitialBufferRecovery?.start({ ev, ws });"],
    ["        if (didStartBuffer) {\n            ev.flush();", "        config.optimusInitialBufferRecovery?.complete();\n        if (didStartBuffer) {\n            ev.flush();"],
    ["        ev.removeAllListeners('connection.update');", "        config.optimusInitialBufferRecovery?.stop();\n        ev.removeAllListeners('connection.update');"],
  ],
  "lib/Socket/messages-recv.js": [
    ["const isOffline = !!node.attrs.offline;", "const isOffline = config.optimusInitialBufferRecovery ? config.optimusInitialBufferRecovery.isOffline(node) : !!node.attrs.offline;"],
    ["await upsertMessage(msg, node.attrs.offline ? 'append' : 'notify');", "await upsertMessage(msg, (config.optimusInitialBufferRecovery ? config.optimusInitialBufferRecovery.isOffline(node) : !!node.attrs.offline) ? 'append' : 'notify');"],
  ],
  "lib/Socket/chats.js": [
    ["        if (connection === 'open') {\n            if (fireInitQueries)", "        if (connection === 'open') {\n            config.optimusInitialBufferRecovery?.open();\n            if (fireInitQueries)"],
    ["        ev.emit('messages.upsert', { messages: [msg], type });", "        config.optimusInitialBufferRecovery?.observeMessage(msg, type);\n        ev.emit('messages.upsert', { messages: [msg], type });"],
    ["            processMessage(msg, {", "            (config.optimusInitialBufferRecovery ? config.optimusInitialBufferRecovery.runMessage(msg, () => processMessage(msg, {"],
    ["                options: config.options\n            })", "                options: config.options\n            })) : processMessage(msg, { shouldProcessHistoryMsg, placeholderResendCache, ev, creds: authState.creds, keyStore: authState.keys, logger, options: config.options }))"],
  ],
};
function hash(text) { return crypto.createHash("sha256").update(text).digest("hex"); }
function transform(file, source) {
  let result = source;
  for (const [before, after] of EDITS[file]) {
    if (result.split(before).length !== 2 || result.includes(after)) throw new Error("buffer_patch_signature:" + file);
    result = result.replace(before, after);
  }
  return result;
}
function applyPatch({ rootDir = process.cwd(), log = console.log } = {}) {
  const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, ROOT, "package.json"), "utf8"));
  if (pkg.version !== VERSION) throw new Error("buffer_patch_version_mismatch");
  const writes = [];
  for (const file of Object.keys(EDITS)) {
    const target = path.join(rootDir, ROOT, file), stat = fs.lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("buffer_patch_not_regular:" + file);
    const source = fs.readFileSync(target, "utf8");
    if (hash(source) === ORIGINAL_HASHES[file]) writes.push([target, transform(file, source)]);
    else {
      // Validate idempotence against the exact result of the pinned original.
      let original = source;
      for (const [before, after] of [...EDITS[file]].reverse()) {
        if (original.split(after).length !== 2) throw new Error("buffer_patch_hash_mismatch:" + file);
        original = original.replace(after, before);
      }
      if (hash(original) !== ORIGINAL_HASHES[file] || transform(file, original) !== source) throw new Error("buffer_patch_hash_mismatch:" + file);
    }
  }
  // All files validated before any write. Failure aborts image installation.
  for (const [target, text] of writes) fs.writeFileSync(target, text, "utf8");
  log("[BAILEYS-BUFFER-HOTFIX] " + (writes.length ? "applied" : "already_applied") + " version=" + VERSION);
  return { status: writes.length ? "applied" : "already_applied", files: Object.keys(EDITS) };
}
module.exports = { applyPatch, transform, EDITS, ORIGINAL_HASHES, VERSION, ROOT };
