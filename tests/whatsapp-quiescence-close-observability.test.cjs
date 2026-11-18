"use strict";

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const {
  SOCKET_CLOSE_REASON_CODES,
  createSessionQuiescenceRegistry,
  waitForSocketClose
} = require("../modules/whatsapp/session-quiescence.service");

async function makeBaileysEventBuffer() {
  const baileysRoot = path.join(__dirname, "..", "node_modules", "@whiskeysockets", "baileys", "lib");
  const packageJson = require(path.join(__dirname, "..", "node_modules", "@whiskeysockets", "baileys", "package.json"));
  assert.equal(packageJson.version, "6.7.22");
  await import(pathToFileURL(path.join(baileysRoot, "index.js")).href);
  const { makeEventBuffer } = await import(pathToFileURL(path.join(baileysRoot, "Utils", "event-buffer.js")).href);
  return makeEventBuffer({ log() {}, debug() {}, trace() {} });
}

function codes(logs) {
  return logs.map(entry => entry.reasonCode).filter(Boolean);
}

(async () => {
  const realBaileysLogs = [];
  const realBaileysEmitter = await makeBaileysEventBuffer();
  assert.equal(typeof realBaileysEmitter.once, "undefined",
    "Baileys 6.7.22 event buffer does not expose EventEmitter.once");
  assert.equal(typeof realBaileysEmitter.on, "function");
  assert.equal(typeof realBaileysEmitter.off, "function");
  let realOffCalls = 0;
  const realOff = realBaileysEmitter.off.bind(realBaileysEmitter);
  realBaileysEmitter.off = (...args) => {
    realOffCalls += 1;
    return realOff(...args);
  };
  const realConfirmed = await waitForSocketClose({
    ev: realBaileysEmitter,
    __optimusSocketGeracao: 6,
    end() {
      setImmediate(() => realBaileysEmitter.emit("connection.update", { connection: "close" }));
      return Promise.resolve();
    }
  }, { expectedGeneration: 6, getCurrentGeneration: () => 6, logger: event => realBaileysLogs.push(event) });
  assert.deepEqual(realConfirmed, { closed: true, reason: "connection_update_close" });
  assert.equal(realOffCalls, 1, "Baileys on/off listener must be removed exactly once");
  assert.ok(codes(realBaileysLogs).includes(SOCKET_CLOSE_REASON_CODES.CONFIRMED));

  const logs = [];
  const ev = new EventEmitter();
  const socket = {
    ev,
    __optimusSocketGeracao: 7,
    end() {
      setImmediate(() => ev.emit("connection.update", { connection: "close" }));
      return Promise.resolve();
    }
  };
  const confirmed = await waitForSocketClose(socket, {
    expectedGeneration: 7,
    getCurrentGeneration: () => 7,
    timeoutMs: 100,
    logger: event => logs.push(event)
  });
  assert.deepEqual(confirmed, { closed: true, reason: "connection_update_close" });
  assert.ok(codes(logs).includes(SOCKET_CLOSE_REASON_CODES.CONFIRMED));
  assert.ok(logs.some(entry => entry.phase === "socket_end_started"));
  assert.ok(logs.some(entry => entry.phase === "socket_end_returned"));
  assert.ok(logs.some(entry => entry.phase === "close_event" && entry.closeEvent === true));
  assert.equal(JSON.stringify(logs).includes("credential"), false);

  const endErrorLogs = [];
  const endErrorEv = new EventEmitter();
  await assert.rejects(
    () => waitForSocketClose({
      ev: endErrorEv,
      __optimusSocketGeracao: 8,
      end() { throw new Error("secret_signal_detail"); }
    }, { expectedGeneration: 8, timeoutMs: 100, logger: entry => endErrorLogs.push(entry) }),
    error => error.code === SOCKET_CLOSE_REASON_CODES.END_ERROR
  );
  assert.ok(codes(endErrorLogs).includes(SOCKET_CLOSE_REASON_CODES.END_ERROR));
  assert.equal(JSON.stringify(endErrorLogs).includes("secret_signal_detail"), false);
  assert.equal(endErrorEv.listenerCount("connection.update"), 0);

  const timeoutLogs = [];
  const timeoutEv = new EventEmitter();
  await assert.rejects(
    () => waitForSocketClose({
      ev: timeoutEv,
      __optimusSocketGeracao: 9,
      end() {}
    }, { expectedGeneration: 9, timeoutMs: 2, logger: entry => timeoutLogs.push(entry) }),
    error => error.code === SOCKET_CLOSE_REASON_CODES.TIMEOUT && error.message === "socket_close_not_confirmed"
  );
  assert.ok(codes(timeoutLogs).includes(SOCKET_CLOSE_REASON_CODES.TIMEOUT));
  assert.equal(timeoutEv.listenerCount("connection.update"), 0);

  const unavailableLogs = [];
  await assert.rejects(
    () => waitForSocketClose({ __optimusSocketGeracao: 10, end() {} }, { logger: entry => unavailableLogs.push(entry) }),
    error => error.code === SOCKET_CLOSE_REASON_CODES.OBSERVER_UNAVAILABLE
  );
  assert.ok(codes(unavailableLogs).includes(SOCKET_CLOSE_REASON_CODES.OBSERVER_UNAVAILABLE));

  let endCalled = false;
  const mismatchLogs = [];
  const mismatchEv = new EventEmitter();
  await assert.rejects(
    () => waitForSocketClose({
      ev: mismatchEv,
      __optimusSocketGeracao: 11,
      end() { endCalled = true; }
    }, {
      expectedGeneration: 11,
      getCurrentGeneration: () => 12,
      logger: entry => mismatchLogs.push(entry)
    }),
    error => error.code === SOCKET_CLOSE_REASON_CODES.GENERATION_MISMATCH
  );
  assert.equal(endCalled, false);
  assert.ok(codes(mismatchLogs).includes(SOCKET_CLOSE_REASON_CODES.GENERATION_MISMATCH));
  assert.equal(mismatchEv.listenerCount("connection.update"), 0);

  const lateMismatchLogs = [];
  const lateMismatchEv = new EventEmitter();
  let lateCurrentGeneration = 11;
  await assert.rejects(
    () => waitForSocketClose({
      ev: lateMismatchEv,
      __optimusSocketGeracao: 11,
      end() {
        lateCurrentGeneration = 12;
        setImmediate(() => lateMismatchEv.emit("connection.update", { connection: "close" }));
      }
    }, {
      expectedGeneration: 11,
      getCurrentGeneration: () => lateCurrentGeneration,
      timeoutMs: 100,
      logger: entry => lateMismatchLogs.push(entry)
    }),
    error => error.code === SOCKET_CLOSE_REASON_CODES.GENERATION_MISMATCH
  );
  assert.ok(codes(lateMismatchLogs).includes(SOCKET_CLOSE_REASON_CODES.GENERATION_MISMATCH));
  assert.equal(lateMismatchEv.listenerCount("connection.update"), 0);

  const registry = createSessionQuiescenceRegistry();
  const failedEv = new EventEmitter();
  const failed = await registry.quiesce("admin_Radar Zap Claro", {
    endSocket: async () => {
      await waitForSocketClose({ ev: failedEv, end() {} }, { timeoutMs: 2 });
    },
    timeoutMs: 20,
    quietWindowMs: 0
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.reason, SOCKET_CLOSE_REASON_CODES.TIMEOUT);
  assert.equal(failed.errorCode, SOCKET_CLOSE_REASON_CODES.TIMEOUT);
  assert.equal(registry.status("admin_Radar Zap Claro").state, "failed");
  assert.equal(registry.resume("admin_Radar Zap Claro", failed.epoch).ok, false);

  console.log("whatsapp-quiescence-close-observability.test.cjs OK");
})().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
