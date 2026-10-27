"use strict";
const fs = require("node:fs"), path = require("node:path");
const { performance, monitorEventLoopDelay } = require("node:perf_hooks");
async function main() {
  const rows=JSON.parse(fs.readFileSync(0,"utf8"));
  const api=require(path.join(path.resolve(process.argv[2]),"modules/inteligencia-universal/categoria.service.js"));
  const log=console.log; console.log=()=>{};
  const call=row=>api.classificarCategoriaUniversal({titulo:row.titulo,marketplace:row.marketplace,categoria:"Diversos"});
  for(let i=0;i<3;i++)for(const row of rows)call(row);
  if(global.gc)global.gc();
  const before=process.memoryUsage(), cpuStart=process.cpuUsage(), usage=process.resourceUsage(), latencies=[];
  const io={syncFileCalls:0,externalRequests:0,postgresQueries:0}, restores=[];
  for(const key of ["readFileSync","writeFileSync","appendFileSync","openSync"]) {
    const previous=fs[key];fs[key]=(...xs)=>{io.syncFileCalls++;return previous(...xs);};restores.push(()=>{fs[key]=previous;});
  }
  const fetchBefore=global.fetch;global.fetch=async()=>{io.externalRequests++;throw Error("benchmark_network_forbidden");};
  const delay=monitorEventLoopDelay({resolution:1});delay.enable();
  await new Promise(r=>setTimeout(r,5));
  const started=performance.now();let ops=0;
  for(let round=0;round<15;round++)for(const row of rows) {
    const t=performance.now();call(row);latencies.push((performance.now()-t)*1000);ops++;
    if(ops%40===0)await new Promise(r=>setImmediate(r));
  }
  const elapsed=performance.now()-started,cpu=process.cpuUsage(cpuStart);
  await new Promise(r=>setTimeout(r,5));delay.disable();
  if(global.gc)global.gc();const after=process.memoryUsage(),endUsage=process.resourceUsage();
  restores.forEach(r=>r());global.fetch=fetchBefore;console.log=log;
  latencies.sort((a,b)=>a-b);const q=p=>latencies[Math.floor((latencies.length-1)*p)];
  console.log(JSON.stringify({operations:ops,wallMs:elapsed,cpuMs:(cpu.user+cpu.system)/1000,
    latencyUs:{p50:q(.5),p95:q(.95),p99:q(.99)},heapRetainedDelta:after.heapUsed-before.heapUsed,rssDelta:after.rss-before.rss,
    eventLoopMs:{p95:delay.percentile(95)/1e6,p99:delay.percentile(99)/1e6,max:delay.max/1e6},
    osFileReads:endUsage.fsRead-usage.fsRead,osFileWrites:endUsage.fsWrite-usage.fsWrite,...io}));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
