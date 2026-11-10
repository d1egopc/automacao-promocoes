"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {planoRetryImagemMagaluLocal:plan}=require("../modules/engine/importer/importer.service");
const contract=require("../modules/local-worker/magalu-identity.contract");
const start=Date.parse("2026-11-10T12:00:00Z");
const job={id:"job_A",evento_id:"event_A",cliente_id:"workspace_A",evento_capturado_em:new Date(start).toISOString(),metadata:{localWorkerImageRetry:{tentativas:3,etapa:"identidade",capability:"magalu_identity_v1"}}};
const task={taskId:"task_A",jobId:"job_A",eventoId:"event_A",workspaceId:"workspace_A",linkId:"link_A",identityKey:"url_synthetic",status:"leased",createdAt:new Date(start).toISOString(),expiresAt:new Date(start+900000).toISOString()};
const details=t=>({capability:"magalu_identity_v1",motivo:"aguardando_identidade_local",identidadeTask:t});
test("after retry budget a bound live task gets finite asynchronous wait",()=>{
 const r=plan(job,new Date(start+600000),details(task));assert.equal(r.reagendar,true);assert.equal(r.atrasoMs,30000);assert.equal(r.identidadeTask.deadline,task.expiresAt);
 const later={...job,metadata:{localWorkerImageRetry:{tentativas:r.tentativa,etapa:"identidade",capability:"magalu_identity_v1",identidadeTask:r.identidadeTask}}};
 assert.equal(plan(later,new Date(start+900000),details(task)).reagendar,false);
 assert.equal(plan(later,new Date(start+600001),details({...task,taskId:"task_B",expiresAt:new Date(start+1800000).toISOString()})).reagendar,false);
});
for(const field of ["jobId","eventoId","workspaceId"])test("crossed "+field+" denied",()=>assert.equal(plan(job,new Date(start+600000),details({...task,[field]:"other"})).reagendar,false));
for(const status of ["failed","expired","completed"])test(status+" task cannot extend a job",()=>assert.equal(plan(job,new Date(start+600000),details({...task,status})).reagendar,false));
test("commercial expiration limits live task, without renewing any clock",()=>{
 const old={...job,evento_capturado_em:new Date(start-3600000).toISOString()};assert.equal(plan(old,new Date(start+600000),details(task)).reagendar,false);
});
const sourceUrl="https://magazineluiza.onelink.me/589508454/synthetic";
const finalUrl="https://www.magazineluiza.com.br/produto/p/123456789/ud/ud/";
function result(at){const identityKey=contract.chaveIdentidadeMagalu(sourceUrl);return {capability:"magalu_identity_v1",contractVersion:1,marketplace:"magalu",identityKey,sourceUrl,finalUrl,canonicalUrl:finalUrl,observedProductId:"123456789",identidadeValidada:true,collectedAt:at,provaTecnica:{capability:"magalu_identity_v1",contractVersion:1,source:"local_first_party",provenance:"local_worker.magalu_identity_v1",identityKey,observedProductId:"123456789",redirected:true,finalUrl,collectedAt:at,statusHttp:200}};}
for(const [at,sub] of [["invalid","timestamp_invalido"],[new Date(start+31000).toISOString(),"timestamp_futuro"],[new Date(start-600000).toISOString(),"timestamp_expirado"]])test("backend exposes fixed "+sub,()=>assert.throws(()=>contract.validarResultadoMagaluIdentity(result(at),{agoraMs:start,sourceUrl,identityKey:contract.chaveIdentidadeMagalu(sourceUrl)}),e=>e.codigo==="magalu_identity_resultado_stale"&&e.submotivo===sub));
test("valid original collection timestamp is preserved",()=>{const at=new Date(start-1000).toISOString();assert.equal(contract.validarResultadoMagaluIdentity(result(at),{agoraMs:start,sourceUrl,identityKey:contract.chaveIdentidadeMagalu(sourceUrl)}).collectedAt,at);});

test("service preserves the backend subreason and never writes invalid identity",async()=>{
 const {criarLocalWorkerService}=require("../modules/local-worker/local-worker.service");
 const payload=result(new Date(start+31000).toISOString());let writes=0;
 const svc=criarLocalWorkerService({agora:()=>new Date(start),dedicatedOwnerIds:["synthetic_owner"],repository:{
 obterTask:async()=>({id:"synthetic_task",marketplace:"magalu",capability:"magalu_identity_v1",productId:payload.identityKey,sourceUrl}),
 completarIdentidade:async()=>{writes++;}
 }});
 await assert.rejects(svc.resultado({worker:{ok:true,workerType:"dedicated",ownerId:"synthetic_owner",workerId:"worker",capabilities:["magalu_identity_v1"]},taskId:"synthetic_task",leaseToken:"synthetic_lease",...payload}),e=>e.submotivo==="timestamp_futuro");
 assert.equal(writes,0);
});
test("Chrome retains fixed backend subreason even when its own clock considers the result fresh",()=>{
 const fs=require("node:fs"),vm=require("node:vm");
 const source=fs.readFileSync(require.resolve("../optimus-capture/local-worker/task-runner.js"),"utf8").replace("classificarFrescorMagaluIdentity, ML_CAPABILITY", "classificarFrescorMagaluIdentity, motivoFrescorResultadoMagaluIdentity, ML_CAPABILITY");
 const context={module:{exports:{}},console};vm.runInNewContext(source,context);
 const error=new Error("magalu_identity_resultado_stale");error.body={submotivo:"timestamp_futuro"};
 assert.equal(context.module.exports.motivoFrescorResultadoMagaluIdentity(error,new Date().toISOString()),"magalu_identity_resultado_stale_timestamp_futuro");
 error.body.submotivo="private_payload";
 assert.equal(context.module.exports.motivoFrescorResultadoMagaluIdentity(error,new Date().toISOString()),"magalu_identity_resultado_stale_backend");
});
