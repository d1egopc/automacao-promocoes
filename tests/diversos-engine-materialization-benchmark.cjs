"use strict";
const fs=require("node:fs"),path=require("node:path"),Module=require("node:module"),{execFileSync}=require("node:child_process"),{performance}=require("node:perf_hooks");
const root=path.resolve(__dirname,".."),file=path.join(root,"modules/engine/importer/importer.service.js");
const base=new Module(file,module);base.filename=file;base.paths=Module._nodeModulePaths(path.dirname(file));
base._compile(execFileSync("git",["show","5dd99da80233ab9a49162e02e215b75982e3da28:modules/engine/importer/importer.service.js"],{cwd:root,encoding:"utf8",windowsHide:true}),file);
const apis={baseline:base.exports.aplicarSombraInteligenciaUniversalV2,candidate:require(file).aplicarSombraInteligenciaUniversalV2};
const offers=["Ração furadinha para pesca em anzol","Roteador WiFi dual band","Caixa amplificada 400W RMS"].map(titulo=>({titulo,categoria:"Diversos",marketplace:"mercadolivre",preco:83.51,precoOriginal:145.90,cupom:"FIXTURE20",linkAfiliado:"https://example.test/fixture"}));
const saved=console.log,fetch=global.fetch;let externalRequests=0;
const samples={baseline:[],candidate:[]};
const context=()=>({consultaMemoriaHistoricaPromise:Promise.resolve({ok:true,memoria:[]})});
const percentile=(xs,q)=>xs.slice().sort((a,b)=>a-b)[Math.min(xs.length-1,Math.floor(xs.length*q))];
(async()=>{
 console.log=()=>{};global.fetch=async()=>{externalRequests++;throw Error("NETWORK_FORBIDDEN");};
 try{
  for(const api of Object.values(apis))for(let i=0;i<20;i++)for(const offer of offers)await api(offer,{}, {cliente_id:"benchmark_fixture"},context());
  const cpu=process.cpuUsage(),memory=process.memoryUsage();
  for(let round=0;round<20;round++)for(const name of round%2?["candidate","baseline"]:["baseline","candidate"]){
   const start=performance.now();
   for(let i=0;i<20;i++)for(const offer of offers)await apis[name](offer,{}, {cliente_id:"benchmark_fixture"},context());
   samples[name].push((performance.now()-start)*1000/(20*offers.length));
  }
  const usage=process.cpuUsage(cpu),after=process.memoryUsage();
  const report={kind:"isolated async Engine function; same current classifier in both variants, only materialization differs; not production latency",operationsPerVariant:1200,
   microsecondsPerOperation:Object.fromEntries(Object.entries(samples).map(([name,x])=>[name,{p50:percentile(x,.5),p95:percentile(x,.95),max:Math.max(...x)}])),
   combinedCpuMs:(usage.user+usage.system)/1000,heapDelta:after.heapUsed-memory.heapUsed,rssDelta:after.rss-memory.rss,externalRequests,
   databaseQueries:0,databaseProof:"historical-memory promise injected; no persistence/queue function invoked"};
  const args=process.argv.slice(2),out=args.indexOf("--out");if(out>=0)fs.writeFileSync(args[out+1],JSON.stringify(report,null,2)+"\n");
  saved(JSON.stringify(report,null,2));if(externalRequests)process.exitCode=1;
 }finally{console.log=saved;global.fetch=fetch;}
})().catch(e=>{console.log=saved;console.error(e);process.exitCode=1;});
