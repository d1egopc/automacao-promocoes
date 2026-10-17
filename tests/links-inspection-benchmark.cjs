"use strict";

// Fixture-only benchmark of the shared secure resolver. No external DNS/HTTP.
const { EventEmitter } = require("node:events");
const { performance, monitorEventLoopDelay } = require("node:perf_hooks");
const path = require("node:path");

const root = path.resolve(process.argv[2] || ".");
const { resolverHttpGenerico } = require(path.join(root, "modules/radar/redirect/redirect-resolver.js"));
const samples = Number(process.argv[3] || 150);
const timeoutSamples = Math.min(samples, 30);
const concurrency = Number(process.argv[4] || 8);

function transport(url, _options, callback) {
  const req = new EventEmitter();
  req.destroyed = false;
  req.destroy = () => { req.destroyed = true; };
  req.end = () => queueMicrotask(() => {
    if (url.pathname === "/timeout") return;
    let status = 200;
    let location = "";
    let body = "<html><main>unknown destination</main></html>";
    if (url.pathname === "/redirect") {
      status = 302; location = "https://www.amazon.com.br/dp/B012345678";
    } else if (url.pathname.startsWith("/chain/")) {
      const step = Number(url.pathname.split("/").at(-1));
      status = 302;
      location = step < 3 ? `https://short.example/chain/${step + 1}` : "https://www.amazon.com.br/dp/B012345678";
    } else if (url.pathname === "/loop") {
      status = 302; location = "https://short.example/loop";
    } else if (url.pathname.startsWith("/limit/")) {
      const step = Number(url.pathname.split("/").at(-1));
      status = 302; location = `https://short.example/limit/${step + 1}`;
    } else if (url.hostname === "www.amazon.com.br") {
      body = "<html><main><h1>Product landing</h1></main></html>";
    }
    const res = new EventEmitter();
    res.statusCode = status;
    res.headers = { location };
    res.complete = true;
    res.destroyed = false;
    res.destroy = () => { res.destroyed = true; };
    callback(res);
    res.emit("data", Buffer.from(body));
    res.emit("end");
  });
  return req;
}

const safeHttpDeps = {
  lookup: async hostname => [{ address: hostname === "private.example" ? "10.0.0.2" : "8.8.8.8", family: 4 }],
  requestImpl: transport
};
const cases = [
  ["direct", "https://www.amazon.com.br/dp/B012345678", samples, 5],
  ["redirect", "https://short.example/redirect", samples, 5],
  ["chain", "https://short.example/chain/1", samples, 5],
  ["timeout", "https://short.example/timeout", timeoutSamples, 5],
  ["loop", "https://short.example/loop", samples, 5],
  ["limit", "https://short.example/limit/1", samples, 2],
  ["unknown", "https://unknown.example/page", samples, 5],
  ["security_block", "https://private.example/page", samples, 5]
];
function percentile(sorted, fraction) {
  return Number(sorted[Math.ceil(sorted.length * fraction) - 1].toFixed(3));
}
async function measure([name, url, count, maxRedirects]) {
  const latencies = [];
  let thrown = 0;
  const reasons = {};
  for (let index = 0; index < count + 5; index += 1) {
    const start = performance.now();
    try {
      const result = await resolverHttpGenerico(url, {
        adminValidation: true, secureDynamic: true, descobertaContextual: true,
        timeout: 250, maxRedirects, safeHttpDeps
      });
      if (index >= 5) reasons[result.motivo || "ok"] = (reasons[result.motivo || "ok"] || 0) + 1;
    } catch (error) {
      if (index >= 5) thrown += 1;
    }
    if (index >= 5) latencies.push(performance.now() - start);
  }
  latencies.sort((a, b) => a - b);
  return { name, samples: count, p50Ms: percentile(latencies, 0.5),
    p95Ms: percentile(latencies, 0.95), p99Ms: percentile(latencies, 0.99),
    thrownRate: Number((thrown / count).toFixed(4)), reasons };
}

async function measureRoute() {
  const express = require("express");
  const { criarRotasResolversDinamicos } = require(path.join(root,
    "modules/radar/redirect/dynamic-resolver-admin.routes.js"));
  const app = express();
  app.use(express.json());
  app.use("/admin/links/resolvers", (_req, _res, next) => next(),
    criarRotasResolversDinamicos({
      registry: { listar: () => [], adicionarRascunho: () => { throw Error("UNEXPECTED_WRITE"); } },
      safeHttpDeps
    }));
  const server = await new Promise(resolve => {
    const opened = app.listen(0, "127.0.0.1", () => resolve(opened));
  });
  const endpoint = `http://127.0.0.1:${server.address().port}/admin/links/resolvers/inspect`;
  const scenarios = [
    ["route_redirect", "https://short.example/redirect"],
    ["route_chain", "https://short.example/chain/1"],
    ["route_unknown", "https://unknown.example/page"],
    ["route_security_block", "https://private.example/page"]
  ];
  const results = [];
  try {
    for (const [name, urlExemplo] of scenarios) {
      const latencies = [];
      let httpFailures = 0;
      const task = async index => {
        const start = performance.now();
        const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ urlExemplo }) });
        const payload = await response.json();
        if (index >= 5) {
          latencies.push(performance.now() - start);
          if (![200, 400].includes(response.status) || payload.prontoComercial === true) httpFailures += 1;
        }
      };
      for (let index = 0; index < samples + 5; index += concurrency) {
        await Promise.all(Array.from({ length: Math.min(concurrency, samples + 5 - index) },
          (_, offset) => task(index + offset)));
      }
      latencies.sort((a, b) => a - b);
      results.push({ name, samples, p50Ms: percentile(latencies, 0.5),
        p95Ms: percentile(latencies, 0.95), p99Ms: percentile(latencies, 0.99),
        httpFailureRate: Number((httpFailures / samples).toFixed(4)) });
    }
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
  return results;
}

(async () => {
  const eventLoop = monitorEventLoopDelay({ resolution: 10 });
  eventLoop.enable();
  const results = [];
  for (const item of cases) results.push(await measure(item));
  const routeResults = require("node:fs").existsSync(path.join(root,
    "tests/links-admin-inspect.test.js")) ? await measureRoute() : null;
  eventLoop.disable();
  const memory = process.memoryUsage();
  console.log(JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch,
    root, samplesPerFastCase: samples, timeoutSamples, concurrency,
    eventLoopP95Ms: Number((eventLoop.percentile(95) / 1e6).toFixed(3)),
    eventLoopP99Ms: Number((eventLoop.percentile(99) / 1e6).toFixed(3)),
    memoryRssMiB: Number((memory.rss / 1024 / 1024).toFixed(2)), results, routeResults }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
