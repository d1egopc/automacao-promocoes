"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { fork } = require("node:child_process");
const { once } = require("node:events");
const { test } = require("node:test");
const { V3Store } = require("../modules/mensageiro-v3/src/v3/store");

if (process.argv[2]?.startsWith("docker-")) {
  assert.equal(process.pid, 1, "Docker proof requires Node itself as PID 1");
  const mode = process.argv[2];
  const dir = process.argv[3];
  const filePath = path.join(dir, "state.json");
  fs.mkdirSync(dir, { recursive: true });
  if (mode === "docker-legacy-exit" || mode === "docker-legacy-live") {
    const store = new V3Store({ filePath });
    store.transaction(() => {});
    // Original lock wire format; real creation time, no fabricated mtime.
    const fd = fs.openSync(store.lockPath, "wx", 0o600);
    fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
    fs.fsyncSync(fd);
    console.log(JSON.stringify({ mode, pid: process.pid, persistedLegacyLock: true }));
    if (mode === "docker-legacy-live") setInterval(() => {}, 1000);
    else process.exit(0); // Simulate terminated instance leaving the durable lock.
  } else if (mode === "docker-blocked") {
    const store = new V3Store({ filePath });
    const before = fs.readFileSync(filePath);
    const lockBefore = fs.readFileSync(store.lockPath);
    const started = performance.now();
    for (let i = 0; i < 1404; i++) {
      assert.throws(() => store.transaction(() => assert.fail("unproven legacy owner")), error =>
        error.code === "MENSAGEIRO_V3_LOCK_BUSY" && error.reason === "legacy_or_unidentified_owner");
    }
    assert.ok(performance.now() - started < 2000, "1404 failures must not wait 10 seconds each");
    assert.deepEqual(fs.readFileSync(filePath), before);
    assert.deepEqual(fs.readFileSync(store.lockPath), lockBefore);
    console.log(JSON.stringify({ mode, pid: process.pid, blocked: 1404, lockPreserved: true, elapsedMs: performance.now() - started }));
  } else if (mode === "docker-valid") {
    const store = new V3Store({ filePath });
    store.transaction(() => { store.state.revision++; });
    const committed = fs.readFileSync(filePath);
    assert.throws(() => store.transaction(() => { store.state.revision++; throw new Error("rollback"); }), /rollback/);
    assert.deepEqual(fs.readFileSync(filePath), committed);
    assert.equal(new V3Store({ filePath }).snapshot().revision, 1);
    assert.equal(fs.existsSync(store.lockPath), false);
    console.log(JSON.stringify({ mode, pid: process.pid, committed: true, rollback: true }));
  } else throw new Error("unknown_docker_proof_mode");
} else if (process.argv[2] === "compete") {
  const store = new V3Store({ filePath: process.argv[3] });
  let committed = 0;
  let attempts = 0;
  function step() {
    try {
      store.transaction(() => { store.state.revision++; });
      committed++;
    } catch (error) {
      if (error.code !== "MENSAGEIRO_V3_LOCK_BUSY") throw error;
    }
    if (committed === 30) { process.send({ committed }); process.disconnect(); }
    else if (++attempts > 5000) throw new Error("bounded_contention_exceeded");
    else setTimeout(step, 1);
  }
  step();
} else if (process.argv[2] === "hold") {
  const store = new V3Store({ filePath: process.argv[3] });
  store._withFileLock(() => {
    process.send({ locked: true });
    // Isolated child only: keep the critical section open until parent kills it.
    fs.readSync(0, Buffer.alloc(1), 0, 1, null);
  });
} else {
  function fixture(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "v3-lock-"));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const store = new V3Store({ filePath: path.join(dir, "state.json") });
    return store;
  }
  const busy = error => error.code === "MENSAGEIRO_V3_LOCK_BUSY" && !!error.reason;

  test("legacy reused PID stays fail-closed: timestamps do not prove original owner death", t => {
    const store = fixture(t);
    const old = new Date(Date.now() - process.uptime() * 1000 - 60000);
    fs.writeFileSync(store.lockPath, JSON.stringify({ pid: process.pid, at: old.toISOString() }));
    fs.utimesSync(store.lockPath, old, old);
    assert.throws(() => store._withFileLock(() => assert.fail("unproven legacy owner")), busy);
    assert.equal(fs.existsSync(store.lockPath), true);
    fs.writeFileSync(store.lockPath, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
    assert.throws(() => store._withFileLock(() => assert.fail("active owner")), busy);
  });

  test("partial, ancient empty and ambiguous owners fail closed without deletion", t => {
    const store = fixture(t);
    for (const record of ["", "{", JSON.stringify({ pid: 1 }), JSON.stringify({ pid: process.pid, token: "x", identity: {} })]) {
      fs.writeFileSync(store.lockPath, record);
      fs.utimesSync(store.lockPath, new Date(0), new Date(0));
      assert.throws(() => store._withFileLock(() => assert.fail("ambiguous")), busy);
      assert.equal(fs.readFileSync(store.lockPath, "utf8"), record);
    }
  });

  test("token and inode protect release against replacement; write failure releases safely", t => {
    const store = fixture(t);
    assert.throws(() => store._withFileLock(() => { throw new Error("write_failure"); }), /write_failure/);
    assert.equal(fs.existsSync(store.lockPath), false);
    assert.throws(() => store._withFileLock(() => {
      fs.unlinkSync(store.lockPath);
      fs.writeFileSync(store.lockPath, JSON.stringify({ token: "other-owner" }));
    }), busy);
    assert.equal(JSON.parse(fs.readFileSync(store.lockPath)).token, "other-owner");
  });

  test("live v2 lock and interrupted metadata transition remain fail-closed", t => {
    const store = fixture(t);
    store._withFileLock(() => {
      const owner = JSON.parse(fs.readFileSync(store.lockPath));
      assert.equal(owner.version, 2);
      assert.ok(owner.token && owner.instance && owner.processStartedAt);
      assert.throws(() => new V3Store({ filePath: store.filePath })._withFileLock(() => assert.fail("live")), busy);
      assert.equal(JSON.parse(fs.readFileSync(store.lockPath)).token, owner.token);
    });
    fs.mkdirSync(`${store.lockPath}.guard`);
    assert.throws(() => store._withFileLock(() => assert.fail("interrupted guard")), busy);
    assert.equal(fs.existsSync(`${store.lockPath}.guard`), true);
  });

  test("failed persistence rolls memory back and does not strand lock", t => {
    const store = fixture(t);
    const before = JSON.stringify(store.snapshot());
    const persist = store._persist;
    store._persist = () => { throw new Error("disk_failure"); };
    assert.throws(() => store.transaction(() => { store.state.revision++; }), /disk_failure/);
    assert.equal(JSON.stringify(store.snapshot()), before);
    assert.equal(fs.existsSync(store.lockPath), false);
    store._persist = persist;
    store.transaction(() => { store.state.revision++; });
    assert.equal(new V3Store({ filePath: store.filePath }).snapshot().revision, 1);
  });

  test("failure publishing the temporary state preserves durable bytes and permits next write", t => {
    const store = fixture(t);
    store.transaction(() => {});
    const before = fs.readFileSync(store.filePath);
    const method = process.platform === "win32" ? "copyFileSync" : "renameSync";
    const publish = fs[method];
    fs[method] = function (source, target, ...options) {
      if (target === store.filePath) throw Object.assign(new Error("publication_failed"), { code: "EIO" });
      return publish.call(fs, source, target, ...options);
    };
    try {
      assert.throws(() => store.transaction(() => { store.state.revision++; }), /publication_failed/);
    } finally { fs[method] = publish; }
    assert.deepEqual(fs.readFileSync(store.filePath), before);
    assert.equal(store.snapshot().revision, 0);
    assert.equal(fs.existsSync(store.lockPath), false);
    store.transaction(() => { store.state.revision++; });
    assert.equal(new V3Store({ filePath: store.filePath }).snapshot().revision, 1);
  });

  test("two OS processes cannot write concurrently; dead owner recovered only with OS proof", async t => {
    const store = fixture(t);
    const child = fork(__filename, ["hold", store.filePath], { stdio: ["pipe", "ignore", "inherit", "ipc"] });
    t.after(() => { if (!child.killed) child.kill(); });
    await once(child, "message");
    assert.throws(() => store._withFileLock(() => assert.fail("second writer")), busy);
    child.kill();
    await once(child, "exit");
    if (process.platform === "linux") assert.equal(store._withFileLock(() => "recovered"), "recovered");
    else assert.throws(() => store._withFileLock(() => assert.fail("no OS birth proof")), busy);
  });

  test("two competing writers preserve all 60 commits without duplicate writes", async t => {
    const store = fixture(t);
    store.transaction(() => {});
    const children = [0, 1].map(() => fork(__filename, ["compete", store.filePath], { stdio: ["ignore", "ignore", "inherit", "ipc"] }));
    t.after(() => children.forEach(child => { if (!child.killed) child.kill(); }));
    await Promise.all(children.map(child => once(child, "exit").then(([code]) => assert.equal(code, 0))));
    assert.equal(store.reload().revision, 60);
    assert.equal(fs.existsSync(store.lockPath), false);
  });

  test("1404 simulated contended ingress calls never wait and HTTP remains responsive", async t => {
    const store = fixture(t);
    const server = http.createServer((req, res) => res.end("ok"));
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    t.after(() => new Promise(resolve => server.close(resolve)));
    fs.writeFileSync(store.lockPath, "{}");
    let completed = 0;
    const started = performance.now();
    // Submit HTTP before one uninterrupted burst; its latency includes the
    // entire contention burst, not just a probe sent after the load finished.
    const probe = new Promise((resolve, reject) => http.get(`http://127.0.0.1:${server.address().port}`, res => {
      res.resume(); res.on("end", resolve);
    }).on("error", reject));
    for (let i = 0; i < 1404; i++) {
      assert.throws(() => store._withFileLock(() => assert.fail("contention")), busy);
      completed++;
    }
    const burstMs = performance.now() - started;
    await probe;
    const maxMs = performance.now() - started;
    assert.equal(completed, 1404);
    assert.ok(maxMs < (process.platform === "linux" ? 500 : 2000), `HTTP during full burst ${maxMs}ms`);
    assert.ok(performance.now() - started < 10000, "no 10-second synchronous waits");
    console.log(JSON.stringify({ simulatedContendedEvents: completed, burstMs, httpMaxMs: maxMs }));
  });
}
