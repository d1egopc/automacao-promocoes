"use strict";
// Offline only. No production datasets, imports, database or URLs are fetched.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { performance, monitorEventLoopDelay } = require("node:perf_hooks");
const { createHash } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const fixtures = require("./fixtures/classificador-v3-real-20261027.json");
function dataset() {
  const source = fs.readFileSync(path.join(__dirname, "categorias-reducao-diversos.test.js"), "utf8");
  const anteriores = ["casos", "casosOnda1", "negativosOnda1"].flatMap(nome => {
    const literal = source.match(new RegExp(`const ${nome} = (\\[[\\s\\S]*?\\n\\]);`));
    if (!literal) throw new Error(`fixture_array_missing:${nome}`);
    return vm.runInNewContext(`(${literal[1]})`).map(([titulo, marketplaceOuCategoria, categoria]) => ({
      titulo, marketplace: categoria ? marketplaceOuCategoria : "mercadolivre", categoria: categoria || marketplaceOuCategoria, proveniencia: "regressao_curada_anterior"
    }));
  });
  return [...fixtures.real.map(x => ({ ...x, marketplace: x.marketplace || "mercadolivre", proveniencia: "relato_proprietario_20261027" })),
    ...fixtures.controls.map(x => ({ ...x, marketplace: x.marketplace || "mercadolivre", proveniencia: "controle_sintetico" })), ...anteriores];
}
function quantile(values, q) { const v = values.slice().sort((a,b) => a-b); return v[Math.min(v.length-1, Math.floor(v.length*q))]; }
async function main() {
  const args = process.argv.slice(2), baseline = args[args.indexOf("--baseline") + 1];
  if (!args.includes("--baseline") || !baseline) throw new Error("baseline_directory_required");
  const base = require(path.join(path.resolve(baseline), "modules/inteligencia-universal/categoria.service.js"));
  const candidate = require("../modules/inteligencia-universal/categoria.service");
  const rows = dataset(), originalLog = console.log;
  console.log = () => {};
  const classify = (api, row) => api.classificarCategoriaUniversal({ titulo: row.titulo, marketplace: row.marketplace, categoria: "Diversos" }).categoria;
  let report;
  try {
    const changes = rows.map((row, i) => ({ id: i, ...row, before: classify(base,row), after: classify(candidate,row) }));
    const errors = changes.filter(x => x.categoria ? x.after !== x.categoria : x.after === x.forbidden);
    report = { cohortSha256: createHash("sha256").update(JSON.stringify(rows)).digest("hex"), total: rows.length,
      real: changes.filter(x=>x.proveniencia==="relato_proprietario_20261027"),
      baselineDiversos: changes.filter(x=>x.before==="Diversos").length, candidateDiversos: changes.filter(x=>x.after==="Diversos").length,
      changed: changes.filter(x=>x.before!==x.after), errors,
      old2000Replay: "NOT_EXECUTED: raw cohort not stored locally; prior aggregate is not a new replay" };
    if (args.includes("--benchmark")) {
      const unchanged = changes.filter(x=>x.before===x.after).map(x=>rows[x.id]);
      const counters = { fileIO:0, externalRequests:0 };
      const restore = [];
      for (const key of ["readFileSync", "writeFileSync", "appendFileSync", "openSync"]) {
        const old = fs[key]; fs[key] = (...xs) => { counters.fileIO++; return old(...xs); }; restore.push(()=>{fs[key]=old;});
      }
      const oldFetch = global.fetch; global.fetch = async () => { counters.externalRequests++; throw new Error("benchmark_network_forbidden"); };
      try {
        for (let i=0;i<3;i++) for(const row of unchanged) {classify(base,row);classify(candidate,row);}
        if (global.gc) global.gc();
        const beforeMem = process.memoryUsage(), cpuStart = process.cpuUsage(), samples={ baseline:[], candidate:[] };
        const delay = monitorEventLoopDelay({ resolution: 10 }); delay.enable();
        for(let round=0;round<24;round++) {
          for(const [name,api] of round%2 ? [["candidate",candidate],["baseline",base]] : [["baseline",base],["candidate",candidate]]) {
            const start = performance.now();
            for(let n=0;n<3;n++) for(const row of unchanged) classify(api,row);
            samples[name].push((performance.now()-start)*1000/(unchanged.length*3));
          }
          await new Promise(r=>setImmediate(r));
        }
        delay.disable(); if(global.gc)global.gc();
        const afterMem=process.memoryUsage(), cpu=process.cpuUsage(cpuStart);
        report.benchmark={kind:"local synthetic unchanged cases; balanced alternating order; not production performance",
          unchangedCases:unchanged.length,rounds:24,operationsPerVariant:unchanged.length*3*24,
          microsecondsPerOperation:Object.fromEntries(Object.entries(samples).map(([name,x])=>[name,{mean:x.reduce((a,b)=>a+b,0)/x.length,p50:quantile(x,.5),p95:quantile(x,.95),p99:quantile(x,.99)}])),
          combinedCpuMs:(cpu.user+cpu.system)/1000,heapRetainedDelta:afterMem.heapUsed-beforeMem.heapUsed,rssDelta:afterMem.rss-beforeMem.rss,
          eventLoopDelayMs:{p95:delay.percentile(95)/1e6,p99:delay.percentile(99)/1e6,max:delay.max/1e6},...counters,
          postgresQueries:0,queryProof:"classifier modules contain no DB client or external IO"};
      } finally { restore.forEach(fn=>fn()); global.fetch=oldFetch; }
      report.benchmark.isolatedResourceTrials={baseline:[],candidate:[]};
      for(let trial=0;trial<2;trial++)for(const name of trial%2?["candidate","baseline"]:["baseline","candidate"]) {
        const run=spawnSync(process.execPath,["--expose-gc",path.join(__dirname,"classificador-v3-benchmark.cjs"),name==="baseline"?path.resolve(baseline):path.resolve(__dirname,"..")],
          {input:JSON.stringify(unchanged),encoding:"utf8",windowsHide:true,timeout:60000});
        if(run.status!==0)throw new Error(`isolated_benchmark_failed:${name}:${run.stderr}`);
        report.benchmark.isolatedResourceTrials[name].push(JSON.parse(run.stdout));
      }
    }
  } finally { console.log=originalLog; }
  const outArg = args.indexOf("--out");
  if(outArg>=0) fs.writeFileSync(args[outArg+1],JSON.stringify(report,null,2)+"\n");
  console.log(JSON.stringify(report,null,2));
  if(report.errors.length)process.exitCode=1;
}
if(require.main===module)main().catch(err=>{console.error(err.message);process.exitCode=1;});
module.exports={dataset};
