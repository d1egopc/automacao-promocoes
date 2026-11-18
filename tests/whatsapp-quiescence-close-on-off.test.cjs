"use strict";

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const {
  waitForSocketClose,
  SOCKET_CLOSE_REASON_CODES
} = require("../modules/whatsapp/session-quiescence.service.js");

function socket({ generation = 1, end } = {}) {
  const ev = new EventEmitter();
  ev.off = ev.removeListener.bind(ev);
  return {
    __optimusSocketGeracao: generation,
    ev,
    ws: { isClosed: false },
    end: end || (() => {
      queueMicrotask(() => ev.emit("connection.update", { connection: "close" }));
    })
  };
}

async function expectCode(promise, code) {
  await assert.rejects(promise, error => {
    assert.equal(error.code, code);
    return true;
  });
}

(async () => {
  {
    const events = [];
    const current = socket();
    const result = await waitForSocketClose(current, {
      expectedGeneration: 1,
      getCurrentGeneration: () => 1,
      logger: event => events.push(event)
    });
    assert.deepEqual(result, { closed: true, reason: "connection_update_close" });
    assert.equal(current.ev.listenerCount("connection.update"), 0);
    assert.ok(events.some(event => event.reasonCode === SOCKET_CLOSE_REASON_CODES.CONFIRMED));
    assert.ok(events.some(event => event.phase === "socket_end_started"));
  }

  {
    const current = socket({ end: () => {} });
    await expectCode(
      waitForSocketClose(current, { timeoutMs: 5 }),
      SOCKET_CLOSE_REASON_CODES.TIMEOUT
    );
    assert.equal(current.ev.listenerCount("connection.update"), 0);
  }

  {
    const current = socket({ end: () => Promise.reject(new Error("synthetic end failure")) });
    await expectCode(
      waitForSocketClose(current),
      SOCKET_CLOSE_REASON_CODES.END_ERROR
    );
    assert.equal(current.ev.listenerCount("connection.update"), 0);
  }

  {
    const current = socket({ generation: 1 });
    await expectCode(
      waitForSocketClose(current, {
        expectedGeneration: 1,
        getCurrentGeneration: () => 2
      }),
      SOCKET_CLOSE_REASON_CODES.GENERATION_MISMATCH
    );
    assert.equal(current.ev.listenerCount("connection.update"), 0);
  }

  {
    const current = { __optimusSocketGeracao: 1, ev: { on() {}, off() {} }, end() {} };
    // The observer contract is intentionally stricter than a generic emitter:
    // Baileys needs a real event source to prove the close event.
    current.ev.on = undefined;
    await expectCode(
      waitForSocketClose(current),
      SOCKET_CLOSE_REASON_CODES.OBSERVER_UNAVAILABLE
    );
  }

  console.log("whatsapp-quiescence-close-on-off: PASS");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
