"use strict";
const fs=require("node:fs"),{performance}=require("node:perf_hooks"),{createHash}=require("node:crypto");
const data=require("./fixtures/diversos-v4-whatsapp-20261029.json"),labels=require("./fixtures/diversos-v4-labels.json"),multi=require("./fixtures/diversos-v4-multiworkspace-20261029.json");
const base=require("./diversos-v4-baseline.cjs"),candidate=require("../modules/inteligencia-universal/categoria.service");
const originalLog=console.log;console.log=()=>{};
const classify=(api,row)=>api.classificarCategoriaUniversal({...row,categoria:row.categoriaRegistrada||row.persisted_category||"Diversos"}).categoria;
try{
 const rows=data.offers.map(row=>({...row,expected:labels.whatsapp[row.sampleId]||labels.additionalSpecific[row.sampleId]||null,excluded:labels.excluded[row.sampleId]||null,before:classify(base.universal,row),after:classify(candidate,row)}));
 const errors=rows.filter(x=>x.expected&&x.after!==x.expected);
 const broad=require("./classificador-v3-replay.cjs").dataset().map(x=>({...x,before:classify(base.universal,x),after:classify(candidate,x)}));
 const broadErrors=broad.filter(x=>x.categoria?x.after!==x.categoria:x.after===x.forbidden);
 const multiRows=multi.rows.map(row=>({...row,before:classify(base.universal,row),after:classify(candidate,row)}));
 const multiErrors=multiRows.filter(x=>x.expected&&x.after!==x.expected);
 const report={baseSha:base.BASE,source:data.source,scope:"Sent WhatsApp sample plus separately labeled bounded multiworkspace snapshot; not population accuracy",whatsapp:{total:rows.length,recordedDiversos:30,eligibleDiversos:29,excludedDiversos:1,
  correctedPublications:rows.filter(x=>x.categoriaRegistrada==="Diversos"&&x.expected&&x.expected!=="Diversos"&&x.after===x.expected).length,
  correctedUniqueTitles:new Set(rows.filter(x=>x.categoriaRegistrada==="Diversos"&&x.expected&&x.expected!=="Diversos"&&x.after===x.expected).map(x=>x.titulo)).size,
  remainingDiversosValid:rows.filter(x=>x.categoriaRegistrada==="Diversos"&&!x.excluded&&x.after==="Diversos").length,
  remainingDiversosIncludingExcluded:rows.filter(x=>x.categoriaRegistrada==="Diversos"&&x.after==="Diversos").length,errors,unlabeledNonDiversos:149,
  changesOutsideDiversos:rows.filter(x=>x.categoriaRegistrada!=="Diversos"&&x.before!==x.after),rows},
  replay147:{total:broad.length,cohortSha256:createHash("sha256").update(JSON.stringify(require("./classificador-v3-replay.cjs").dataset())).digest("hex"),changes:broad.filter(x=>x.before!==x.after),errors:broadErrors},
  multiworkspace:{total:multiRows.length,tenants:new Set(multiRows.map(x=>x.tenant_ref)).size,marketplaces:[...new Set(multiRows.map(x=>x.marketplace))],excluded:multiRows.filter(x=>!x.expected).length,corrected:multiRows.filter(x=>x.expected&&x.expected!=="Diversos"&&x.after===x.expected).length,errors:multiErrors,rows:multiRows}};
 const benchmarkRows=data.offers.filter(x=>!labels.excluded[x.sampleId]);const samples={baseline:[],candidate:[]};const originalFetch=global.fetch;let network=0;
 global.fetch=async()=>{network++;throw Error("NETWORK_FORBIDDEN");};
 try{for(let r=0;r<12;r++)for(const [name,api]of r%2?[["candidate",candidate],["baseline",base.universal]]:[["baseline",base.universal],["candidate",candidate]]){
  const start=performance.now();for(const row of benchmarkRows)classify(api,row);samples[name].push((performance.now()-start)*1000/benchmarkRows.length);
 }}finally{global.fetch=originalFetch;}
 const q=(a,n)=>a.slice().sort((a,b)=>a-b)[Math.floor(a.length*n)];
 report.benchmark={kind:"bounded synthetic classifier; alternating order; no production load claim",operationsPerVariant:benchmarkRows.length*12,microsecondsPerOperation:Object.fromEntries(Object.entries(samples).map(([k,v])=>[k,{p50:q(v,.5),p95:q(v,.95)}])),externalRequests:network};
 const out=process.argv[process.argv.indexOf("--out")+1];if(process.argv.includes("--out"))fs.writeFileSync(out,JSON.stringify(report,null,2)+"\n");
 originalLog(JSON.stringify({whatsappCorrections:report.whatsapp.correctedPublications,remaining:report.whatsapp.remainingDiversosValid,changedNonDiversos:report.whatsapp.changesOutsideDiversos,replay147:report.replay147,multi:{total:multiRows.length,excluded:report.multiworkspace.excluded,corrected:report.multiworkspace.corrected,errors:multiErrors},benchmark:report.benchmark,errors},null,2));
 if(errors.length||broadErrors.length||multiErrors.length)process.exitCode=1;
}finally{console.log=originalLog;}
