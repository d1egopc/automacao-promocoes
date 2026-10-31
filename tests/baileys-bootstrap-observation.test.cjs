"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path"),vm=require("node:vm"),crypto=require("node:crypto");
const {EventEmitter}=require("node:events");
const retry=require("../scripts/apply-baileys-retry-hotfix.cjs");
const hotfix=require("../modules/whatsapp/baileys-buffer-hotfix.service");
const balanced=require("../modules/whatsapp/baileys-balanced-buffer-patch");
const {createIngressBoundaryObservation,TARGET_GROUP_ID,TARGET_SESSION_ID,MAX_MS,NEXT_BOOTSTRAP_ARM_MS,NEXT_BOOTSTRAP_CAPTURE_MS,MAX_BOOTSTRAP_SIGNALS}=require("../modules/whatsapp/ingress-boundary-observation");
const baseEventBuffer=require("./fixtures/baileys-6.7.22-event-buffer.json");
const sourceRoot=path.resolve(__dirname,"../node_modules/@whiskeysockets/baileys");
const logger={debug(){},trace(){},info(){},warn(){},error(){}};
const hash=value=>crypto.createHash("sha256").update(value).digest("hex");

function replaceEdits(source,edits){for(const [before,after]of edits){assert.equal(source.split(before).length,2,"fixture patch signature");source=source.replace(before,after);}return source;}
function reverseEdits(source,edits){for(const [before,after]of [...edits].reverse()){assert.equal(source.split(after).length,2,"fixture reverse signature");source=source.replace(after,before);}return source;}
function upstreamSources(){
 const files={};
 for(const file of Object.keys(hotfix.EDITS)){
  let text=fs.readFileSync(path.join(sourceRoot,file),"utf8"),current=hash(text);
  if(current===hotfix.PATCH_HASHES[file])text=reverseEdits(text,hotfix.EDITS[file]);
  else if(current===hotfix.LEGACY_HASHES[file])text=reverseEdits(text,hotfix.LEGACY_EDITS[file]);
  else if(current!==hotfix.ORIGINAL_HASHES[file]&&!(file.endsWith("messages-recv.js")&&text.includes(retry.ORIGINAL_BLOCK)))throw new Error("baileys_fixture_source_unrecognized:"+file);
  if(file.endsWith("messages-recv.js")){
   if(text.includes(retry.PATCHED_BLOCK))text=text.replace(retry.PATCHED_BLOCK,retry.ORIGINAL_BLOCK);
   assert.equal(text.split(retry.ORIGINAL_BLOCK).length,2,"retry base signature");
  }
  files[file]=text;
 }
 return files;
}
function tempInstallRoot(sources){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"baileys-bootstrap-install-"));
 const pkg=path.join(root,"node_modules/@whiskeysockets/baileys");fs.mkdirSync(pkg,{recursive:true});
 fs.writeFileSync(path.join(pkg,"package.json"),JSON.stringify({version:"6.7.22"}));
 for(const [file,text]of Object.entries(sources)){const target=path.join(pkg,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,text);}
 const eventBuffer=path.join(pkg,"lib/Utils/event-buffer.js");fs.mkdirSync(path.dirname(eventBuffer),{recursive:true});fs.writeFileSync(eventBuffer,baseEventBuffer);
 return root;
}
function buildFresh(root){
 retry.aplicarPatch({rootDir:root,log(){}});
 hotfix.applyPatch({rootDir:root,log(){}});
 balanced.applyPatch({rootDir:root});
}
function installedHash(root,file){return hash(fs.readFileSync(path.join(root,"node_modules/@whiskeysockets/baileys",file)));}
function loadEventBuffer(source,observer){
 const code=source.replace(/^import .*;\r?\n/gm,"").replace("export const makeEventBuffer","const makeEventBuffer");
 const context=vm.createContext({EventEmitter,logger,setTimeout,clearTimeout,WAMessageStatus:{},proto:{}});
 vm.runInContext(code+"\nglobalThis.makeEventBuffer=makeEventBuffer;",context);
 return context.makeEventBuffer(logger,observer);
}
function smallEmitter(){
 const ev=new EventEmitter();let buffering=false;
 ev.isBuffering=()=>buffering;ev.buffer=()=>{buffering=true;};ev.flush=()=>{buffering=false;return true;};
 return ev;
}
function startObservation(){
 let now=1000;const o=createIngressBoundaryObservation({now:()=>now,setTimer:()=>({unref(){}}),clearTimer(){}});
 const sock={ev:smallEmitter()};const ctx={workspaceId:"admin",sessionId:TARGET_SESSION_ID,sock,generation:1,groupId:TARGET_GROUP_ID,scopeValidated:true};
 assert.equal(o.start(ctx).ok,true);return {o,ctx,sock};
}

test("bootstrap telemetry is exact-session scoped, bounded, and emits only fixed metadata",()=>{
 const {o,ctx}=startObservation();
 assert.equal(o.bootstrapObserver({workspaceId:"other",sessionId:TARGET_SESSION_ID,generation:2}),null);
 assert.equal(o.bootstrapObserver({workspaceId:"admin",sessionId:"admin_other",generation:2}),null);
 const hook=o.bootstrapObserver({workspaceId:"admin",sessionId:TARGET_SESSION_ID,generation:2});assert.ok(hook);
 const sock2={ev:smallEmitter()};assert.equal(o.trackSocket({...ctx,sock:sock2,generation:2}),true);
 hook.syncState("Connecting");hook.syncState("AwaitingInitialSync");hook.syncState("Syncing");hook.syncState("Online");
 for(const value of ["absent","0","1","raw-sensitive-attribute"])hook.offlineAttribute(value);
 hook.offlineBatch("preview_received");hook.offlineBatch("request_started");hook.offlineBatch("request_sent");hook.offlineBatch("completion_signal");
 hook.offlineTask("queued");hook.offlineTask("queued");hook.offlineTask("started");hook.offlineTask("completed");hook.offlineTask("queued");hook.offlineTask("started");hook.offlineTask("failed");
 hook.recordBufferObservation({kind:"buffer_requested",reason:"initial_sync_started",buffering:true,explicitHold:true,pendingWorks:0});
 hook.recordBufferObservation({kind:"flush_requested",reason:"offline_completion",buffering:true,explicitHold:false,pendingWorks:2});
 hook.recordBufferObservation({kind:"flush_completed",reason:"untrusted-secret-reason",buffering:false,explicitHold:false,pendingWorks:0});
 o.mark("wrapper",{workspaceId:"admin",sessionId:TARGET_SESSION_ID,sock:sock2});
 o.mark("callback",{workspaceId:"admin",sessionId:TARGET_SESSION_ID,sock:sock2});
 o.mark("radar",{workspaceId:"admin",sessionId:TARGET_SESSION_ID,sock:sock2});
 const status=o.stop(),g=status.generations.find(x=>x.generation===2),b=g.bootstrap;
 assert.deepEqual([b.offlineBatch.previewReceived,b.offlineBatch.requestsStarted,b.offlineBatch.requestsSent,b.offlineBatch.completionSignals],[1,1,1,1]);
 assert.deepEqual([b.offlineAttribute.absent,b.offlineAttribute["0"],b.offlineAttribute["1"],b.offlineAttribute.other],[1,1,1,1]);
 assert.deepEqual([b.offlineTasks.queued,b.offlineTasks.started,b.offlineTasks.completed,b.offlineTasks.errors,b.offlineTasks.pending],[3,2,1,1,1]);
 assert.equal(b.synchronization.state,"Online");assert.equal(b.buffer.explicitHold,false);assert.equal(b.buffer.pendingWorks,0);
 assert.equal(b.buffer.flushesByReason.offline_completion,1);assert.equal(b.delivery.wrapperCalls,1);assert.equal(b.delivery.callbackCalls,1);assert.equal(b.delivery.radarEntries,1);
 const json=JSON.stringify(status);
 for(const forbidden of ["admin_Zoiao Claro",TARGET_GROUP_ID,"raw-sensitive-attribute","untrusted-secret-reason","message body","credential-value"])assert.equal(json.includes(forbidden),false,forbidden);
 assert.ok(b.records.length<=64);assert.equal(status.state,"stopped");
});

test("bootstrap signal and record caps never retain per-message data",()=>{
 const {o,ctx}=startObservation(),hook=o.bootstrapObserver({...ctx,generation:2});
 const sock2={ev:smallEmitter()};o.trackSocket({...ctx,sock:sock2,generation:2});
 for(let i=0;i<MAX_BOOTSTRAP_SIGNALS+50;i++)hook.offlineAttribute("absent");
 const b=o.status().generations.find(x=>x.generation===2).bootstrap;
 assert.equal(b.observations,MAX_BOOTSTRAP_SIGNALS);assert.equal(b.truncated,true);assert.equal(b.records.length,64);assert.equal(b.recordsDropped,MAX_BOOTSTRAP_SIGNALS-64);
 assert.equal(JSON.stringify(b).includes("message"),false);o.stop();
});

test("next natural socket generation is armed beyond the legacy five-minute window and self-expires after capture",()=>{
 let now=1000;const timers=[],o=createIngressBoundaryObservation({now:()=>now,setTimer:(fn,ms)=>{const t={fn,ms,cleared:false,unref(){}};timers.push(t);return t;},clearTimer:t=>{t.cleared=true;}});
 const first={ev:smallEmitter()},ctx={workspaceId:"admin",sessionId:TARGET_SESSION_ID,sock:first,generation:1,groupId:TARGET_GROUP_ID,scopeValidated:true};
 assert.equal(o.start({...ctx,mode:"next_bootstrap"}).ok,true);let status=o.status();assert.equal(status.state,"armed");assert.equal(status.capture.armedAfterGeneration,1);assert.equal(status.generations.length,0);assert.equal(status.limits.armWaitMs,NEXT_BOOTSTRAP_ARM_MS);assert.equal(timers.at(-1).ms,NEXT_BOOTSTRAP_ARM_MS);
 now+=MAX_MS+60000;assert.equal(o.status().state,"armed");assert.equal(o.bootstrapObserver({...ctx,generation:1}),null);
 const second={ev:smallEmitter()},hook=o.bootstrapObserver({...ctx,sock:second,generation:2});assert.ok(hook);status=o.status();assert.equal(status.state,"active");assert.equal(status.capture.phase,"capturing");assert.equal(status.capture.observedGeneration,2);assert.equal(status.limits.captureAfterGenerationMs,NEXT_BOOTSTRAP_CAPTURE_MS);assert.equal(timers.at(-1).ms,NEXT_BOOTSTRAP_CAPTURE_MS);assert.equal(timers[0].cleared,true);
 assert.equal(o.trackSocket({...ctx,sock:second,generation:2}),true);assert.equal(o.trackSocket({...ctx,generation:3,sock:{ev:smallEmitter()}}),false);
 hook.offlineBatch("preview_received");hook.syncState("Syncing");const generation=o.status().generations[0];assert.equal(generation.generation,2);assert.equal(generation.bootstrap.offlineBatch.previewReceived,1);
 const deadline=status.expiresAt;now+=60000;assert.equal(o.status().expiresAt,deadline);now=deadline;status=o.status();assert.equal(status.state,"stopped");assert.equal(status.reason,"capture_window_expired");assert.equal(status.generations[0].generation,2);
});

test("instrumented event buffer is behavior-equivalent when observer is absent and reports fixed flush causes when enabled",async()=>{
 const legacy=loadEventBuffer(balanced.transformLegacy(baseEventBuffer)),observed=[],newBuffer=loadEventBuffer(balanced.transform(baseEventBuffer),{recordBufferObservation:event=>observed.push(event)});
 const run=ev=>{const rows=[];ev.process(map=>rows.push(map));ev.buffer();ev.emit("messages.upsert",{messages:[{key:{remoteJid:"fixture@g.us",id:"id-1",fromMe:false}}],type:"notify"});const flushed=ev.flush();return {rows,flushed,buffering:ev.isBuffering()};};
 assert.equal(JSON.stringify(run(newBuffer)),JSON.stringify(run(legacy)));
 const records=[];const instrumented=loadEventBuffer(balanced.transform(baseEventBuffer),{recordBufferObservation:event=>records.push({...event})});
 instrumented.buffer("initial_sync_started");instrumented.emit("messages.upsert",{messages:[{key:{remoteJid:"fixture@g.us",id:"id-2",fromMe:false}}],type:"notify"});
 assert.equal(instrumented.flush("offline_completion"),true);
 assert.ok(records.some(x=>x.kind==="buffer_requested"&&x.explicitHold===true));
 assert.ok(records.some(x=>x.kind==="flush_requested"&&x.reason==="offline_completion"));
 assert.ok(records.some(x=>x.kind==="flush_completed"&&x.buffering===false));
 assert.equal(JSON.stringify(records).includes("id-2"),false);
});

test("pinned Baileys install applies on clean npm inputs and upgrades the previous approved artifact atomically",()=>{
 const sources=upstreamSources(),clean=tempInstallRoot(sources),legacy=tempInstallRoot(sources),foreign=tempInstallRoot(sources);
 try{
  buildFresh(clean);
  for(const [file,expected]of Object.entries(hotfix.PATCH_HASHES))assert.equal(installedHash(clean,file),expected);
  assert.equal(installedHash(clean,"lib/Utils/event-buffer.js"),balanced.PATCH_HASH);
  assert.equal(hotfix.applyPatch({rootDir:clean,log(){}}).status,"already_applied");assert.equal(balanced.applyPatch({rootDir:clean}).status,"already_applied");
  retry.aplicarPatch({rootDir:legacy,log(){}});
  for(const [file,edits]of Object.entries(hotfix.LEGACY_EDITS)){const p=path.join(legacy,"node_modules/@whiskeysockets/baileys",file);fs.writeFileSync(p,replaceEdits(fs.readFileSync(p,"utf8"),edits));}
  const eb=path.join(legacy,"node_modules/@whiskeysockets/baileys/lib/Utils/event-buffer.js");fs.writeFileSync(eb,balanced.transformLegacy(fs.readFileSync(eb,"utf8")));
  for(const [file,expected]of Object.entries(hotfix.LEGACY_HASHES))assert.equal(installedHash(legacy,file),expected);
  assert.equal(installedHash(legacy,"lib/Utils/event-buffer.js"),balanced.LEGACY_HASH);
  assert.equal(hotfix.applyPatch({rootDir:legacy,log(){}}).status,"upgraded");assert.equal(balanced.applyPatch({rootDir:legacy}).status,"upgraded");
  for(const [file,expected]of Object.entries(hotfix.PATCH_HASHES))assert.equal(installedHash(legacy,file),expected);
  assert.equal(installedHash(legacy,"lib/Utils/event-buffer.js"),balanced.PATCH_HASH);
  retry.aplicarPatch({rootDir:foreign,log(){}});const untouched=installedHash(foreign,"lib/Socket/socket.js");
  const bad=path.join(foreign,"node_modules/@whiskeysockets/baileys/lib/Socket/chats.js");fs.appendFileSync(bad,"\n// foreign fixture\n");
  assert.throws(()=>hotfix.applyPatch({rootDir:foreign,log(){}}),/buffer_patch_hash_mismatch/);assert.equal(installedHash(foreign,"lib/Socket/socket.js"),untouched);
 } finally {for(const root of [clean,legacy,foreign])fs.rmSync(root,{recursive:true,force:true});}
});

test("the actual patched offline queue reports pending, completion, and error counts without exposing nodes",async()=>{
 const sources=upstreamSources(),root=tempInstallRoot(sources);
 try{
  buildFresh(root);const recv=fs.readFileSync(path.join(root,"node_modules/@whiskeysockets/baileys/lib/Socket/messages-recv.js"),"utf8");
  const start=recv.indexOf("    const makeOfflineNodeProcessor = () => {"),end=recv.indexOf("    const offlineNodeProcessor = makeOfflineNodeProcessor();",start);assert.ok(start>=0&&end>start);
  const observed=[],calls=[];let release;
  const gate=new Promise(resolve=>{release=resolve;});
  const context=vm.createContext({config:{optimusBootstrapObserver:{offlineTask:stage=>observed.push(stage)}},ws:{isOpen:true},
   handleMessage:async node=>{calls.push(node.fixture);if(node.fixture==="slow")await gate;if(node.fixture==="fail")throw new Error("fixture failure");},
   handleCall:async()=>{},handleReceipt:async()=>{},handleNotification:async()=>{},onUnexpectedError(){}});
  vm.runInContext(recv.slice(start,end)+"\nglobalThis.makeOfflineNodeProcessor=makeOfflineNodeProcessor;",context);
  const queue=context.makeOfflineNodeProcessor();queue.enqueue("message",{fixture:"slow"});queue.enqueue("message",{fixture:"ok"});
  assert.deepEqual(observed,["queued","started","queued"]);release();await new Promise(resolve=>setImmediate(resolve));await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(calls,["slow","ok"]);assert.deepEqual(observed,["queued","started","queued","completed","started","completed"]);
  const failed=[];const failContext=vm.createContext({config:{optimusBootstrapObserver:{offlineTask:stage=>failed.push(stage)}},ws:{isOpen:true},handleMessage:async()=>{throw Error("fixture failure");},handleCall:async()=>{},handleReceipt:async()=>{},handleNotification:async()=>{},onUnexpectedError(){}});
  vm.runInContext(recv.slice(start,end)+"\nglobalThis.makeOfflineNodeProcessor=makeOfflineNodeProcessor;",failContext);failContext.makeOfflineNodeProcessor().enqueue("message",{fixture:"secret-node"});
  await new Promise(resolve=>setImmediate(resolve));await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(failed,["queued","started","failed"]);
  assert.equal(JSON.stringify([observed,failed]).includes("secret-node"),false);
 } finally {fs.rmSync(root,{recursive:true,force:true});}
});

test("offline_batch request, completion callback, and synchronous send failure use fixed sanitized states",async()=>{
 const sources=upstreamSources(),root=tempInstallRoot(sources);
 try{
  buildFresh(root);const socket=fs.readFileSync(path.join(root,"node_modules/@whiskeysockets/baileys/lib/Socket/socket.js"),"utf8");
  const previewStart=socket.indexOf("    ws.on('CB:ib,,offline_preview'"),previewEnd=socket.indexOf("    ws.on('CB:ib,,edge_routing'",previewStart);assert.ok(previewStart>=0&&previewEnd>previewStart);
  const stages=[],sent=[],ws=new EventEmitter();const context=vm.createContext({ws,logger,config:{optimusBootstrapObserver:{offlineBatch:stage=>stages.push(stage)}},sendNode:frame=>{sent.push(frame);return Promise.resolve();}});
  vm.runInContext(socket.slice(previewStart,previewEnd),context);ws.emit("CB:ib,,offline_preview",{tag:"offline_preview",attrs:{sensitive:"not retained"}});
  await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(stages,["preview_received","request_started","request_sent"]);
  assert.equal(sent.length,1);assert.equal(sent[0].content[0].tag,"offline_batch");
  const offlineStart=socket.indexOf("    ws.on('CB:ib,,offline', (node) => {"),offlineEnd=socket.indexOf("    // update credentials when required",offlineStart);assert.ok(offlineStart>=0&&offlineEnd>offlineStart);
  const completed=[],flushes=[],ev={flush:reason=>flushes.push(reason),emit(){return true;}};
  const done=vm.createContext({ws,logger,config:{optimusBootstrapObserver:{offlineBatch:stage=>completed.push(stage)},optimusInitialBufferRecovery:null},getBinaryNodeChild:()=>({attrs:{count:"100"}}),didStartBuffer:true,ev});
  vm.runInContext(socket.slice(offlineStart,offlineEnd),done);ws.emit("CB:ib,,offline",{tag:"offline",attrs:{private:"not retained"}});
  assert.deepEqual(completed,["completion_signal"]);assert.deepEqual(flushes,["offline_completion"]);
  const failed=[],failedWs=new EventEmitter(),failure=vm.createContext({ws:failedWs,logger,config:{optimusBootstrapObserver:{offlineBatch:stage=>failed.push(stage)}},sendNode:()=>{throw new Error("fixture send failure");}});
  vm.runInContext(socket.slice(previewStart,previewEnd),failure);assert.throws(()=>failedWs.emit("CB:ib,,offline_preview",{}),/fixture send failure/);
  assert.deepEqual(failed,["preview_received","request_started","request_send_failed"]);
  assert.equal(JSON.stringify([stages,completed,failed,flushes]).includes("sensitive"),false);
 } finally {fs.rmSync(root,{recursive:true,force:true});}
});

test("asynchronous offline_batch send failure is counted without changing its rejection semantics",async()=>{
 const sources=upstreamSources(),root=tempInstallRoot(sources),failure=new Error("fixture send failure");let propagated;
 try{
  buildFresh(root);const socket=fs.readFileSync(path.join(root,"node_modules/@whiskeysockets/baileys/lib/Socket/socket.js"),"utf8");
  const start=socket.indexOf("    ws.on('CB:ib,,offline_preview'"),end=socket.indexOf("    ws.on('CB:ib,,edge_routing'",start);assert.ok(start>=0&&end>start);
  const stages=[],ws=new EventEmitter(),context=vm.createContext({ws,logger,config:{optimusBootstrapObserver:{offlineBatch:stage=>stages.push(stage)}},sendNode:()=>{
   const promise=Promise.reject(failure),nativeThen=promise.then;
   promise.then=function(...args){const child=nativeThen.apply(this,args);child.catch(error=>{propagated=error;});return child;};return promise;
  }});
  vm.runInContext(socket.slice(start,end),context);ws.emit("CB:ib,,offline_preview",{});await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(stages,["preview_received","request_started","request_send_failed"]);
  assert.equal(propagated,failure);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test("message offline attribute is reduced to four fixed classes before the existing processor",()=>{
 const sources=upstreamSources(),root=tempInstallRoot(sources);
 try{
  buildFresh(root);const recv=fs.readFileSync(path.join(root,"node_modules/@whiskeysockets/baileys/lib/Socket/messages-recv.js"),"utf8");
  const start=recv.indexOf("    const processNode = (type, node, identifier, exec) => {"),end=recv.indexOf("    // Handles newsletter notifications",start);assert.ok(start>=0&&end>start);
  const attrs=[],normal=[],offline=[];const context=vm.createContext({config:{optimusInitialBufferRecovery:null,optimusBootstrapObserver:{offlineAttribute:value=>attrs.push(value)}},
   offlineNodeProcessor:{enqueue:(type,node)=>offline.push(node.attrs.offline)},processNodeWithBuffer:node=>normal.push(node.attrs.offline)});
  vm.runInContext(recv.slice(start,end)+"\nglobalThis.call=processNode;",context);
  for(const value of [undefined,"0","1","sensitive-value"])context.call("message",{attrs:value===undefined?{}:{offline:value}},"fixture",()=>{});
  assert.deepEqual(attrs,["absent","0","1","other"]);assert.deepEqual(normal,[undefined]);assert.deepEqual(offline,["0","1","sensitive-value"]);
  assert.equal(JSON.stringify(attrs).includes("sensitive-value"),false);
 } finally {fs.rmSync(root,{recursive:true,force:true});}
});
