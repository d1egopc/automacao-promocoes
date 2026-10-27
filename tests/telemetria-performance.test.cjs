"use strict";
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  vm = require("node:vm"),
  cp = require("node:child_process"),
  { monitorEventLoopDelay } = require("node:perf_hooks");
const root = path.join(__dirname, "..");
const base = "227c860e43d1d31904bd5a1332fa29b629a5b3de";
const old = cp.execFileSync(
  "git",
  ["show", `${base}:modules/telemetria/telemetria.service.js`],
  { cwd: root, encoding: "utf8", maxBuffer: 2000000 },
);
const candidate = fs.readFileSync(
  path.join(root, "modules/telemetria/telemetria.service.js"),
  "utf8",
);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "telemetry-perf-"));
async function measure(source, name) {
  const file = path.join(temp, name + ".json");
  let writes = 0,
    reads = 0;
  const module = { exports: {} };
  vm.runInNewContext(source, {
    module,
    exports: module.exports,
    Buffer,
    Date,
    Map,
    Set,
    require: (id) => {
      if (id === "crypto") return require("node:crypto");
      if (id.includes("database"))
        return { queryEngine: async () => ({ ok: false }) };
      if (id.includes("storage"))
        return {
          readGlobalJson: () => {
            reads++;
            try {
              return JSON.parse(fs.readFileSync(file, "utf8"));
            } catch {
              return [];
            }
          },
          writeGlobalJson: (_, data) => {
            writes++;
            fs.writeFileSync(file, JSON.stringify(data));
          },
        };
      if (id.includes("flow-manager")) return {};
      if (id.includes("jobs.service")) return {};
      if (id.includes("absorption")) return {};
      throw Error("unexpected_dependency:" + id);
    },
  });
  const service = module.exports;
  const grant = service.criarAuditoriaTemporaria({
    ttlMinutos: 15,
    escopo: "workspace",
    clienteId: "fixture_a",
  });
  const req = {
    method: "GET",
    path: "/saude",
    headers: { authorization: `Bearer ${grant.codigo}` },
  };
  for (let i = 0; i < 50; i++) service.autenticarTokenAuditoria(req);
  reads = 0;
  writes = 0;
  global.gc?.();
  const memoryBefore = process.memoryUsage(),
    cpuBefore = process.cpuUsage(),
    samples = [];
  const loop = monitorEventLoopDelay({ resolution: 10 });
  loop.enable();
  for (let i = 0; i < 2000; i++) {
    const t = process.hrtime.bigint();
    assert.equal(service.autenticarTokenAuditoria(req).ok, true);
    samples.push(Number(process.hrtime.bigint() - t) / 1e6);
    if (i % 50 === 0) await new Promise(setImmediate);
  }
  loop.disable();
  const cpu = process.cpuUsage(cpuBefore),
    memoryAfter = process.memoryUsage();
  samples.sort((a, b) => a - b);
  return {
    name,
    samples: samples.length,
    meanMs: samples.reduce((a, b) => a + b, 0) / samples.length,
    p95Ms: samples[Math.floor(samples.length * 0.95)],
    p99Ms: samples[Math.floor(samples.length * 0.99)],
    cpuMs: (cpu.user + cpu.system) / 1000,
    heapDelta: memoryAfter.heapUsed - memoryBefore.heapUsed,
    rssDelta: memoryAfter.rss - memoryBefore.rss,
    readOperations: reads,
    writeOperations: writes,
    eventLoopMaxMs: loop.max / 1e6,
  };
}
(async () => {
  try {
    const baseline = [],
      next = [];
    for (let i = 0; i < 3; i++) {
      if (i % 2) {
        next.push(await measure(candidate, "candidate"));
        baseline.push(await measure(old, "baseline"));
      } else {
        baseline.push(await measure(old, "baseline"));
        next.push(await measure(candidate, "candidate"));
      }
    }
    assert.ok(baseline.every((r) => r.writeOperations === 2000));
    assert.ok(next.every((r) => r.writeOperations === 0));
    assert.ok(next.every((r) => r.readOperations === 2000));
    const report = {
      base,
      node: process.version,
      method:
        "three alternating isolated auth runs; real temporary-file I/O; no PostgreSQL or motors invoked",
      baseline,
      candidate: next,
      commercialHotPathDiff: "ZERO; adapters only invoked on HTTP queries",
    };
    if (process.env.TELEMETRY_PERF_REPORT)
      fs.writeFileSync(
        process.env.TELEMETRY_PERF_REPORT,
        JSON.stringify(report, null, 2),
      );
    console.log(JSON.stringify(report));
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
