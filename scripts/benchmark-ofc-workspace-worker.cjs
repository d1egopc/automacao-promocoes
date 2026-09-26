"use strict";
// Local synthetic fixtures only. Output goes to stdout for an evidence artifact.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { Worker } = require("node:worker_threads");
const { performance, monitorEventLoopDelay } = require("node:perf_hooks");
const ofc = require("../modules/engine/ofc/absorption-gate.service");
const { criarClienteWorker, fecharWorkerOfc, RESOURCE_LIMITS } = require("../modules/engine/ofc/workspace-worker-client");
const crypto = require("node:crypto");
console.log = () => {}; // Suppress synthetic Buffer logs, not exceptions/results.
const sleep = ms => new Promise(resolve => setTimeout(resolve,ms));
const destinations = [{ id: "synthetic-destination", tipo: "telegram", botToken: "synthetic", chatId: "synthetic", ativo:true, intervaloMinutos:3 }];
function opts(file, now, enabled) {
  return { agoraMs:now, clock:()=>now, workerOfc:enabled,
    usuarios:[{id:"w",creditos:100}], listarClientesAtivos:()=>["w"],
    destinosPorCliente:{w:destinations}, configsPorCliente:{w:{automacaoAtiva:true}},configPadrao:{},
    consultarEventosAbsorcao:async()=>({ok:true,porWorkspace:[]}),getClienteJsonPath:()=>file };
}
async function child(mode,file,repeats) {
  // Recover synthetic generation time from the first (80h-old) item without parsing the queue.
  const fd=fs.openSync(file,"r"), prefix=Buffer.alloc(2048);fs.readSync(fd,prefix,0,prefix.length,0);fs.closeSync(fd);
  const now=Date.parse(prefix.toString().match(/"criadoEm":"([^"]+)"/)[1])+80*3600000;
  let created=0;
  const client=criarClienteWorker({workerFactory:()=>{created++;return new Worker(path.join(__dirname,"../modules/engine/ofc/workspace-worker.js"),{resourceLimits:RESOURCE_LIMITS});}});
  const rows=[], lag=[], memory=[]; let due=performance.now()+10, output;
  const histogram=monitorEventLoopDelay({resolution:10}); histogram.enable();
  const timer=setInterval(()=>{const actual=performance.now();lag.push(Math.max(0,actual-due));due=actual+10;},10);
  try {
    global.gc?.(); const baseline=process.memoryUsage(); await sleep(30);
    for(let n=0;n<repeats;n++) {
      let perf; const phases=[], originalRead=fs.readFileSync, originalParse=JSON.parse;
      if(mode==="off") {
        fs.readFileSync=function(...args){const t=performance.now(), result=originalRead.apply(this,args);if(args[0]===file)phases.push({etapa:"apos_read",ms:performance.now()-t,...process.memoryUsage()});return result;};
        JSON.parse=function(...args){const t=performance.now(), result=originalParse.apply(this,args);if(args[0]?.length>1000000)phases.push({etapa:"apos_parse",ms:performance.now()-t,...process.memoryUsage()});return result;};
      }
      const cpu=process.cpuUsage(), before=process.memoryUsage(), start=performance.now(), offset=lag.length;
      let result;
      try {
        const o=opts(file,now,mode==="on");
        o.medidorCiclo={clock:()=>performance.now(),registrarLeitura:d=>{if(mode==="off")perf={leitura:d};}};
        if(mode==="on")o.clienteWorker={executar:async input=>{const r=await client.executar({...input,coletaTesteMs:now});perf=r.perf;return r;}};
        result=await ofc.criarGateAbsorcaoShadowOfc(o);
      } finally {fs.readFileSync=originalRead;JSON.parse=originalParse;}
      const wallMs=performance.now()-start, used=process.cpuUsage(cpu);
      assert.equal(result.ok,true); assert.equal(result.aplicouMudancas,false);
      const after=process.memoryUsage();
      const encoded=JSON.stringify(result), resultHash=crypto.createHash("sha256").update(encoded).digest("hex"),payloadBytes=Buffer.byteLength(encoded);
      if(repeats>2)result=null; // Do not retain 20 summaries and mistake harness retention for a Worker leak.
      await sleep(30);
      const samples=lag.slice(offset).sort((a,b)=>a-b);
      global.gc?.(); const afterGC=process.memoryUsage();
      const phasesAll=mode==="on"?perf.memory:phases;
      rows.push({n,wallMs,cpuMs:(used.user+used.system)/1000,lagMaxMs:Math.max(...samples),
        lagP95Ms:samples[Math.min(samples.length-1,Math.floor(samples.length*.95))],lagSamples:samples.length,
        perf,before,after,afterGC,phaseSamples:phasesAll,
        processHighWaterRssBytes:process.resourceUsage().maxRSS*1024,
        payloadBytes,resultHash,...(repeats<=2?{result}: {})});
      memory.push({n,mainHeapAfterGC:afterGC.heapUsed,rssAfterGC:afterGC.rss,workerHeap:perf?.heapFinal});
    }
    return (output = {mode,fileBytes:fs.statSync(file).size,repeats,created,baseline,rows,memory,
      eventLoopDelayMaxMs:histogram.max/1e6,eventLoopDelayP95Ms:histogram.percentile(95)/1e6,
      databaseModules:Object.keys(require.cache).filter(k=>k.includes("absorption-gate.repository")||k.includes("drainage-metrics.repository")),
      rssNote:"RSS is process-wide/shared, not additive main+Worker. Phase samples may miss transient peaks; maxRSS is cumulative. main GC does not force Worker GC."});
  } finally {clearInterval(timer);histogram.disable();await client.fechar();await fecharWorkerOfc();global.gc?.();if(output)output.afterWorkerExit=process.memoryUsage();}
}
async function main() {
  if(process.argv[2]==="--child") {process.stdout.write(JSON.stringify(await child(process.argv[3],process.argv[4],Number(process.argv[5])))+"\n");return;}
  if(process.argv[2]==="--long") {
    const file=path.resolve(process.argv[3]);
    const long=spawnSync(process.execPath,["--expose-gc",__filename,"--child","on",file,"100"],{encoding:"utf8",timeout:180000,maxBuffer:8*1024*1024});
    if(long.error||long.status!==0)throw new Error(long.error?.message||long.stderr);
    const data=JSON.parse(long.stdout);assert.equal(data.created,1);
    for(const row of data.rows)assert.equal(row.resultHash,data.rows[0].resultHash);
    const selected=[data.rows[0],data.rows[49],data.rows[99]], maxRss=Math.max(...data.rows.map(r=>r.processHighWaterRssBytes));
    const wall=data.rows.reduce((n,r)=>n+r.wallMs,0), cpu=data.rows.reduce((n,r)=>n+r.cpuMs,0);
    process.stdout.write(JSON.stringify({node:process.version,created:data.created,repeats:data.repeats,allSummaryHashesEqual:true,wallAccumulatedMs:wall,cpuAccumulatedMs:cpu,
      baseline:data.baseline,maxRssBytes:maxRss,maxLagMs:Math.max(...data.rows.map(r=>r.lagMaxMs)),eventLoopDelayP95Ms:data.eventLoopDelayP95Ms,
      selectedRows:selected,memory:data.memory,afterWorkerExit:data.afterWorkerExit,rssNote:data.rssNote})+"\n");return;
  }
  const fixtures=path.resolve(process.argv[2]||"../p2b-w1-local/fixtures");
  const report={node:process.version,startedUTC:new Date().toISOString(),base:"0d80258eb740f92563180fc015dc77e37742a430",comparisons:[]};
  for(const size of [50,170,345]) {
    const file=path.join(fixtures,`synthetic-${size}MB.json`), pair={size};
    for(const mode of ["off","on"]) {
      const run=spawnSync(process.execPath,["--expose-gc",__filename,"--child",mode,file,"2"],{encoding:"utf8",timeout:120000,maxBuffer:4*1024*1024});
      if(run.error||run.status!==0)throw new Error(run.error?.message||run.stderr);
      pair[mode]=JSON.parse(run.stdout);
    }
    for(let n=0;n<2;n++){assert.deepEqual(pair.off.rows[n].result,pair.on.rows[n].result);delete pair.off.rows[n].result;delete pair.on.rows[n].result;}
    pair.deepEqual=2;report.comparisons.push(pair);
  }
  const file=path.join(fixtures,"synthetic-345MB.json");
  const long=spawnSync(process.execPath,["--expose-gc",__filename,"--child","on",file,"20"],{encoding:"utf8",timeout:180000,maxBuffer:8*1024*1024});
  if(long.error||long.status!==0)throw new Error(long.error?.message||long.stderr);
  report.sequential=JSON.parse(long.stdout);
  for(const row of report.sequential.rows){assert.equal(row.resultHash,report.sequential.rows[0].resultHash);}
  for(const row of report.sequential.rows)delete row.result;
  assert.equal(report.sequential.created,1);assert.deepEqual(report.sequential.databaseModules,[]);
  report.finishedUTC=new Date().toISOString();process.stdout.write(JSON.stringify(report)+"\n");
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
