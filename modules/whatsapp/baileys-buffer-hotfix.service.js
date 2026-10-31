"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const VERSION = "6.7.22";
const ROOT = "node_modules/@whiskeysockets/baileys/";
// Baselines include the already-homologated retry hotfix, not another tarball.
const ORIGINAL_HASHES = {"lib/Socket/socket.js": "2d16ab13464a155a3441f497ae7625d1760a0654659ae422a361e0c99fb1cc0c", "lib/Socket/messages-recv.js": "2a754ae09c8ad053486ae3b9743db6868e60f2e77e8fa695c4138e9667a76dd5", "lib/Socket/chats.js": "9eef48356529d9078e0a09ae94d443e29c2795a0c86c64f3d47580994884add4"};
const LEGACY_EDITS = {
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
const OBSERVATION_EDITS = {
  "lib/Socket/socket.js": [
    ["    const ev = makeEventBuffer(logger);", "    const ev = makeEventBuffer(logger, config.optimusBootstrapObserver);"],
    ["            ev.buffer();", "            ev.buffer('socket_initial_bootstrap');"],
    ["    ws.on('CB:failure', (node) => {\n        const reason", "    ws.on('CB:failure', (node) => {\n        try { config.optimusBootstrapObserver?.offlineBatch('connection_failure'); } catch {}\n        const reason"],
    ["    ws.on('CB:stream:error', (node) => {\n        logger.error", "    ws.on('CB:stream:error', (node) => {\n        try { config.optimusBootstrapObserver?.offlineBatch('connection_failure'); } catch {}\n        logger.error"],
    ["    ws.on('CB:ib,,offline_preview', (node) => {\n        logger.info('offline preview received', JSON.stringify(node));\n        sendNode({\n            tag: 'ib',\n            attrs: {},\n            content: [{ tag: 'offline_batch', attrs: { count: '100' } }]\n        });\n    });", "    ws.on('CB:ib,,offline_preview', (node) => {\n        logger.info('offline preview received', JSON.stringify(node));\n        try { config.optimusBootstrapObserver?.offlineBatch('preview_received'); } catch {}\n        try { config.optimusBootstrapObserver?.offlineBatch('request_started'); } catch {}\n        let offlineBatchRequest;\n        try {\n            offlineBatchRequest = sendNode({\n                tag: 'ib',\n                attrs: {},\n                content: [{ tag: 'offline_batch', attrs: { count: '100' } }]\n            });\n        } catch (error) {\n            try { config.optimusBootstrapObserver?.offlineBatch('request_send_failed'); } catch {}\n            throw error;\n        }\n        if (typeof offlineBatchRequest?.then === 'function' && config.optimusBootstrapObserver) {\n            offlineBatchRequest.then(\n                () => { try { config.optimusBootstrapObserver?.offlineBatch('request_sent'); } catch {} },\n                error => { try { config.optimusBootstrapObserver?.offlineBatch('request_send_failed'); } catch {} throw error; }\n            );\n        }\n    });"],
    ["    ws.on('CB:ib,,offline', (node) => {\n        const child", "    ws.on('CB:ib,,offline', (node) => {\n        try { config.optimusBootstrapObserver?.offlineBatch('completion_signal'); } catch {}\n        const child"],
    ["            ev.flush();\n            logger.trace('flushed events for initial buffer');", "            ev.flush('offline_completion');\n            logger.trace('flushed events for initial buffer');"],
  ],
  "lib/Socket/messages-recv.js": [
    ["        ev.buffer();\n        await execTask();\n        ev.flush();", "        ev.buffer('process_node');\n        await execTask();\n        ev.flush('process_node_complete');"],
    ["            nodes.push({ type, node });", "            nodes.push({ type, node });\n            try { config.optimusBootstrapObserver?.offlineTask('queued'); } catch {}"],
    ["                    const { type, node } = nodes.shift();\n                    const nodeProcessor", "                    const { type, node } = nodes.shift();\n                    try { config.optimusBootstrapObserver?.offlineTask('started'); } catch {}\n                    const nodeProcessor"],
    ["                        onUnexpectedError(new Error(`unknown offline node type: ${type}`), 'processing offline node');\n                        continue;", "                        try { config.optimusBootstrapObserver?.offlineTask('failed'); } catch {}\n                        onUnexpectedError(new Error(`unknown offline node type: ${type}`), 'processing offline node');\n                        continue;"],
    ["                    await nodeProcessor(node);", "                    try {\n                        await nodeProcessor(node);\n                        try { config.optimusBootstrapObserver?.offlineTask('completed'); } catch {}\n                    } catch (error) {\n                        try { config.optimusBootstrapObserver?.offlineTask('failed'); } catch {}\n                        throw error;\n                    }"],
    ["        const isOffline = config.optimusInitialBufferRecovery ? config.optimusInitialBufferRecovery.isOffline(node) : !!node.attrs.offline;", "        if (type === 'message') {\n            let offlineClass = 'other';\n            try {\n                if (!Object.prototype.hasOwnProperty.call(node.attrs || {}, 'offline')) offlineClass = 'absent';\n                else if (node.attrs.offline === '0') offlineClass = '0';\n                else if (node.attrs.offline === '1') offlineClass = '1';\n            } catch {}\n            try { config.optimusBootstrapObserver?.offlineAttribute(offlineClass); } catch {}\n        }\n        const isOffline = config.optimusInitialBufferRecovery ? config.optimusInitialBufferRecovery.isOffline(node) : !!node.attrs.offline;"],
  ],
  "lib/Socket/chats.js": [
    ["    let syncState = SyncState.Connecting;", "    let syncState = SyncState.Connecting;\n    try { config.optimusBootstrapObserver?.syncState('Connecting'); } catch {}"],
    ["                syncState = SyncState.Syncing;", "                syncState = SyncState.Syncing;\n                try { config.optimusBootstrapObserver?.syncState('Syncing'); } catch {}"],
    ["                syncState = SyncState.Online;\n                logger.info('History sync skipped", "                syncState = SyncState.Online;\n                try { config.optimusBootstrapObserver?.syncState('Online'); } catch {}\n                logger.info('History sync skipped"],
    ["                logger.info('History sync skipped, transitioning to Online state and flushing buffer');\n                ev.flush();", "                logger.info('History sync skipped, transitioning to Online state and flushing buffer');\n                ev.flush('history_sync_skipped');"],
    ["                syncState = SyncState.Online;\n                logger.info('App state sync complete", "                syncState = SyncState.Online;\n                try { config.optimusBootstrapObserver?.syncState('Online'); } catch {}\n                logger.info('App state sync complete"],
    ["                logger.info('App state sync complete, transitioning to Online state and flushing buffer');\n                ev.flush();", "                logger.info('App state sync complete, transitioning to Online state and flushing buffer');\n                ev.flush('app_state_sync_complete');"],
    ["        syncState = SyncState.AwaitingInitialSync;", "        syncState = SyncState.AwaitingInitialSync;\n        try { config.optimusBootstrapObserver?.syncState('AwaitingInitialSync'); } catch {}"],
    ["        ev.buffer();\n        const willSyncHistory", "        ev.buffer('initial_sync_started');\n        const willSyncHistory"],
    ["            syncState = SyncState.Online;\n            setTimeout(() => ev.flush(), 0);", "            syncState = SyncState.Online;\n            try { config.optimusBootstrapObserver?.syncState('Online'); } catch {}\n            setTimeout(() => ev.flush('history_sync_disabled'), 0);"],
    ["                syncState = SyncState.Online;\n                ev.flush();", "                syncState = SyncState.Online;\n                try { config.optimusBootstrapObserver?.syncState('Online'); } catch {}\n                ev.flush('initial_sync_timeout');"],
  ]
};
const EDITS = Object.fromEntries(Object.keys(LEGACY_EDITS).map(file => [file, [...LEGACY_EDITS[file], ...OBSERVATION_EDITS[file]]]));
const LEGACY_HASHES = {"lib/Socket/socket.js":"b0b8d041b930c4f0264766e8de06ffce78398ecb4d27ef58482de75484f23443","lib/Socket/messages-recv.js":"2dd660356f4f469a6dfe1be895720acbf3f02794c5273bb83c1a867c409ab299","lib/Socket/chats.js":"30457f342ac27afa8a211cbfddd1bd428b00a41175acf187aaff7ab8d376d776"};
const PATCH_HASHES = {"lib/Socket/socket.js":"2289b2abed814dea660fb42f87f1f51e88ef78bfc4fb367b3742aef045dbc442","lib/Socket/messages-recv.js":"89e99f0a402f123a90353392575363521f07531aba9ed1eae42bafc7b0056bc8","lib/Socket/chats.js":"a043d5d03fc63371ca69eee9a652a3c06c0af2352632123e67163a94277aedf1"};
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
  let upgraded = false;
  for (const file of Object.keys(EDITS)) {
    const target = path.join(rootDir, ROOT, file), stat = fs.lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("buffer_patch_not_regular:" + file);
    const source = fs.readFileSync(target, "utf8");
    const currentHash=hash(source);
    if (currentHash === PATCH_HASHES[file]) continue;
    if (currentHash === ORIGINAL_HASHES[file]) { writes.push([target, transform(file, source)]); continue; }
    if (currentHash !== LEGACY_HASHES[file]) throw new Error("buffer_patch_hash_mismatch:" + file);
    let original=source;
    for (const [before,after] of [...LEGACY_EDITS[file]].reverse()) {
      if(original.split(after).length!==2)throw new Error("buffer_patch_hash_mismatch:"+file);
      original=original.replace(after,before);
    }
    if(hash(original)!==ORIGINAL_HASHES[file])throw new Error("buffer_patch_hash_mismatch:"+file);
    writes.push([target,transform(file,original)]);upgraded=true;
  }
  // All files validated before any write. Failure aborts image installation.
  for (const [target, text] of writes) fs.writeFileSync(target, text, "utf8");
  const status=writes.length?(upgraded?"upgraded":"applied"):"already_applied";
  log("[BAILEYS-BUFFER-HOTFIX] " + status + " version=" + VERSION);
  return { status, files: Object.keys(EDITS) };
}
module.exports = { applyPatch, transform, EDITS, LEGACY_EDITS, OBSERVATION_EDITS, ORIGINAL_HASHES, LEGACY_HASHES, PATCH_HASHES, VERSION, ROOT };
