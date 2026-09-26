"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { EventEmitter } = require("node:events");
const { spawnSync } = require("node:child_process");
const http = require("node:http");
const { obterHttpSeguro } = require("../modules/radar/redirect/safe-redirect-http");

const url = "https://publico.example/inicio";
const lookup = async () => [{ address: "8.8.8.8", family: 4 }];
const reset = () => Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });

function fixture(action) {
  const requests = [];
  const responses = [];
  const countsBefore = [];
  const requestImpl = (_url, options, callback) => {
    const req = new EventEmitter();
    const res = new EventEmitter();
    Object.assign(req, { destroyed: false, destroy() { this.destroyed = true; } });
    Object.assign(res, { statusCode: 200, headers: {}, complete: true,
      destroyed: false, destroy() { this.destroyed = true; } });
    requests.push(req);
    responses.push(res);
    req.end = () => queueMicrotask(() => {
      countsBefore.push(req.listenerCount("error"));
      action({ req, res, callback, options, hop: requests.length });
    });
    return req;
  };
  return { requests, responses, countsBefore, requestImpl };
}

function lateErrors(f, t) {
  t.diagnostic(`response error listeners after cleanup=${f.responses.map(res => res.listenerCount("error")).join(",")}`);
  for (const req of f.requests) {
    t.diagnostic(`request error listeners: before=${f.countsBefore[0]}, after=${req.listenerCount("error")}`);
    assert.doesNotThrow(() => req.emit("error", reset()), "late ClientRequest error must stay handled");
    assert.equal(req.listenerCount("error"), 1);
    assert.equal(req.listenerCount("timeout"), 0);
  }
  for (const res of f.responses) {
    assert.doesNotThrow(() => res.emit("error", reset()), "late response error must stay handled");
    assert.equal(res.listenerCount("error"), 1);
    for (const event of ["data", "end", "aborted", "close"]) assert.equal(res.listenerCount(event), 0);
  }
}

async function child() {
  const f = fixture(({ res, callback }) => { callback(res); res.emit("end"); });
  const result = await obterHttpSeguro(url, { lookup, requestImpl: f.requestImpl });
  assert.equal(result.status, 200);
  console.log(`before=${f.countsBefore[0]} after=${f.requests[0].listenerCount("error")}`);
  // No try/catch, global handler or test runner surrounds this emission.
  setImmediate(() => {
    f.requests[0].emit("error", reset());
    console.log("LATE_ERROR_HANDLED");
  });
}

if (process.argv.includes("--late-error-child")) {
  void child();
} else {
  test("late ClientRequest error does not crash an isolated process", () => {
    const result = spawnSync(process.execPath, [__filename, "--late-error-child"], { encoding: "utf8", timeout: 5000 });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /before=1 after=1/);
    assert.match(result.stdout, /LATE_ERROR_HANDLED/);
  });

  test("normal request ECONNRESET rejects with the original error; late errors preserve it", async t => {
    const original = reset();
    const f = fixture(({ req, res, callback }) => { callback(res); req.emit("error", original); });
    const pending = obterHttpSeguro(url, { lookup, requestImpl: f.requestImpl });
    await assert.rejects(pending, error => error === original);
    lateErrors(f, t);
    await assert.rejects(pending, error => error === original);
  });

  test("completed response keeps its result after late request/response errors", async t => {
    const f = fixture(({ res, callback }) => { callback(res); res.emit("data", Buffer.from("ok")); res.emit("end"); });
    const pending = obterHttpSeguro(url, { lookup, requestImpl: f.requestImpl });
    const result = await pending;
    lateErrors(f, t);
    assert.strictEqual(await pending, result);
    assert.equal(result.data, "ok");
  });

  for (const mode of ["aborted", "close", "body-limit", "response-error", "inactivity", "deadline"]) {
    test(`${mode} rejects correctly and handles errors after cleanup`, async t => {
      const original = reset();
      const f = fixture(({ req, res, callback }) => {
        callback(res);
        if (mode === "aborted") res.emit("aborted");
        if (mode === "close") { res.complete = false; res.emit("close"); }
        if (mode === "body-limit") res.emit("data", Buffer.from("12345"));
        if (mode === "response-error") res.emit("error", original);
        if (mode === "inactivity") req.emit("timeout");
      });
      const pending = obterHttpSeguro(url, { lookup, requestImpl: f.requestImpl, maxBytes: 4,
        timeout: mode === "deadline" ? 30 : 2000 });
      const expected = mode === "body-limit" ? "REDIRECT_BODY_LIMIT"
        : ["deadline", "inactivity"].includes(mode) ? "REDIRECT_TIMEOUT"
          : mode === "response-error" ? "socket hang up" : "REDIRECT_RESPONSE_ABORTED";
      await assert.rejects(pending, error => error.message === expected);
      lateErrors(f, t);
      await assert.rejects(pending, error => mode === "response-error" ? error === original : error.message === expected);
    });
  }

  test("a response arriving after timeout also keeps an error handler before destroy", async t => {
    let deliver;
    const f = fixture(({ res, callback }) => { deliver = () => callback(res); });
    const pending = obterHttpSeguro(url, { lookup, requestImpl: f.requestImpl, timeout: 30 });
    await assert.rejects(pending, /REDIRECT_TIMEOUT/);
    deliver();
    assert.equal(f.responses[0].destroyed, true);
    lateErrors(f, t);
  });

  test("redirects retain pinning/options/result and one error handler per object, not per event", async t => {
    const f = fixture(({ res, callback, options, hop }) => {
      assert.equal(options.method, "GET");
      assert.equal(options.agent, false);
      options.lookup("publico.example", { all: true }, (error, addresses) => {
        assert.equal(error, null);
        assert.deepEqual(addresses, [{ address: "8.8.8.8", family: 4 }]);
      });
      if (hop === 1) { res.statusCode = 302; res.headers.location = "https://destino.example/final"; }
      callback(res);
      res.emit("data", Buffer.from(hop === 2 ? "final" : ""));
      res.emit("end");
    });
    const result = await obterHttpSeguro(url, { lookup, requestImpl: f.requestImpl });
    assert.equal(result.hops.length, 2);
    assert.equal(result.request.res.responseUrl, "https://destino.example/final");
    assert.equal(result.data, "final");
    for (let i = 0; i < 50; i += 1) lateErrors(f, { diagnostic() {} });
    t.diagnostic("50 late errors per hop: one retained listener per request/response; other listeners removed");
  });

  test("real local HTTP socket destroyed before headers rejects ECONNRESET and tolerates late error", async t => {
    const server = http.createServer(req => req.socket.destroy());
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    let req;
    let closed;
    try {
      const pending = obterHttpSeguro(url, { lookup, timeout: 2000,
        requestImpl: (_url, options, callback) => {
          req = http.request({ hostname: "127.0.0.1", port: server.address().port,
            path: "/", method: options.method, agent: false, timeout: options.timeout }, callback);
          closed = new Promise(resolve => req.once("close", resolve));
          return req;
        } });
      await assert.rejects(pending, error => error.code === "ECONNRESET");
      await closed;
      t.diagnostic(`real ClientRequest listeners after rejection/close=${req.listenerCount("error")}`);
      assert.doesNotThrow(() => req.emit("error", reset()));
      assert.equal(req.listenerCount("error"), 1);
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  });
}
