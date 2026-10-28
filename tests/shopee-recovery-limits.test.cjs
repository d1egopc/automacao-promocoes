'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const {performance}=require('node:perf_hooks');
const file=path.resolve('modules/engine/importer/adapters/shopee.adapter.js');
const compiled=new Module(file,module);compiled.filename=file;compiled.paths=Module._nodeModulePaths(path.dirname(file));
compiled._compile(fs.readFileSync(file,'utf8')+'\nmodule.exports.fixturePrepare=prepararLinksContextuaisShopee;',file);
const prepare=compiled.exports.fixturePrepare;
const link=(suffix,role='cupom')=>({url_original:'https://s.shopee.com.br/'+suffix,metadata:{papelLink:role,papelLinkMotivo:'contexto_'+role}});
(async()=>{
 let reads=0;
 const deps={getIntegracaoCliente:()=>({credenciais:{appId:'fixture',secret:'fixture'}}),resolverRedirectContextualShopee:async()=>{reads++;return {request:{res:{responseUrl:'https://shopee.com.br/product/123/456'}}};}};
 const original=[link('APP'),link('APP'),link('SITE'),link('THIRD')];const snapshot=JSON.stringify(original);
 const prepared=await prepare(original,{},deps,'fixture');
 assert.equal(reads,2,'two unique redirects maximum, repeated URL cached');
 assert.equal(JSON.stringify(original),snapshot,'source occurrences immutable');assert.equal(prepared.links.length,4);
 assert.deepEqual(prepared.links.map(x=>x.url_original),original.map(x=>x.url_original),'order and repeated APP occurrence unchanged');
 for(let i=0;i<3;i++)assert.ok(prepared.recuperados.has(prepared.links[i]));
 assert.equal(prepared.recuperados.has(prepared.links[3]),false,'budget exhaustion fails closed');
 const before=reads;await prepare(original,{}, {...deps,getIntegracaoCliente:()=>null},'fixture');assert.equal(reads,before,'no integration, no read');
 for(const final of ['https://shopee.com.br/m/cupom','https://127.0.0.1/product/123/456','https://shopee.com.br.evil.test/product/123/456','https://user:pass@shopee.com.br/product/123/456','http://shopee.com.br/product/123/456']){
 const rejected=await prepare([link('NEGATIVE')],{},{...deps,resolverRedirectContextualShopee:async()=>({request:{res:{responseUrl:final}}})},'fixture');assert.equal(rejected.recuperados.has(rejected.links[0]),false);
 }
 const timed=await prepare([link('TIMEOUT')],{},{...deps,resolverRedirectContextualShopee:async()=>{throw Error('REDIRECT_TIMEOUT')}},'fixture');assert.equal(timed.recuperados.has(timed.links[0]),false);
 const ordinary=link('NORMAL','produto');const noRecovery=await prepare([ordinary],{},deps,'fixture');assert.equal(noRecovery.links[0],ordinary);assert.equal(reads,before,'normal product path adds no redirect');
 const known=link('KNOWN');known.url_expandida='https://shopee.com.br/product/123/456';
 const timings=[];const cpu=process.cpuUsage();const mem=process.memoryUsage().heapUsed;
 for(let i=0;i<1000;i++){const start=performance.now();await prepare([known],{},deps,'fixture');timings.push(performance.now()-start);}
 timings.sort((a,b)=>a-b);assert.equal(reads,before,'known destinations add no HTTP');
 assert.ok(timings[949]<5,'known-destination preparation p95 <5ms in isolated fixture');
 const used=process.cpuUsage(cpu);
 console.log(JSON.stringify({result:'PASS',occurrences:4,redirectBudget:2,knownDestinationHTTP:0,normalPathHTTP:0,securityNegatives:6,p50Ms:timings[499],p95Ms:timings[949],cpuMs:(used.user+used.system)/1000,heapDeltaBytes:process.memoryUsage().heapUsed-mem,productionWrites:0,network:'mocked_only'}));
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
