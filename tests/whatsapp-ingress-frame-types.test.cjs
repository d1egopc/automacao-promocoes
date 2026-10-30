"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm"),{EventEmitter}=require("node:events");
const {createIngressBoundaryObservation,MAX_MS}=require("../modules/whatsapp/ingress-boundary-observation");
const {registrarListenerUnicoSocket}=require("../modules/whatsapp/socket-listener-lifecycle.service");
const SESSION="admin_Zoiao Claro",GROUP="120363408782037034@g.us";
function fixture({active=true,generation=1}={}){
 let now=1000,buffering=false;const ws=new EventEmitter(),ev=new EventEmitter(),sock={ws,ev},timers=[];
 ev.isBuffering=()=>buffering;
 const o=createIngressBoundaryObservation({now:()=>now,setTimer:fn=>{timers.push(fn);return {unref(){}};},clearTimer(){}});
 const ctx={workspaceId:"admin",sessionId:SESSION,groupId:GROUP,generation,sock,scopeValidated:true};
 if(active)assert.equal(o.start(ctx).ok,true);
 return {ws,ev,sock,o,ctx,timers,snapshot:()=>o.status().generations[0],buffer:value=>buffering=value,advance:ms=>now+=ms};
}
test("fixed frame categories and binaries contain no content, attrs or unknown tag strings",()=>{
 const f=fixture();for(const tag of ["message","iq","receipt","notification","ib","success","PRIVATE_UNKNOWN_TAG"]){
  const frame={tag,get attrs(){throw Error("private attrs");},get content(){throw Error("private content");}};f.ws.emit("frame",frame);
 }
 f.ws.emit("frame",Buffer.from("PRIVATE_PAYLOAD"));f.ws.emit("frame",new Uint8Array([1]));f.ws.emit("frame",new ArrayBuffer(2));
 let reads=0;f.ws.emit("frame",{get tag(){reads++;throw Error("getter");}});
 const s=f.snapshot(),c=s.counters;assert.equal(reads,0);assert.equal(c.decodedFrames,11);
 assert.deepEqual([c.messageFrames,c.controlFrames,c.syncFrames,c.otherFrames,c.binaryFrames],[1,3,2,2,3]);
 assert.equal(c.messageFrames+c.controlFrames+c.syncFrames+c.otherFrames+c.binaryFrames,c.decodedFrames);
 assert.doesNotMatch(JSON.stringify(s),/PRIVATE_|private content|private attrs/);f.o.stop();
});
test("four control nodes reproduce 4/4/0; actual Baileys public router dispatches message before upsert",()=>{
 const f=fixture();const source=fs.readFileSync(require("node:path").join(__dirname,"../node_modules/@whiskeysockets/baileys/lib/Socket/socket.js"),"utf8");
 const a=source.indexOf("    const onMessageReceived = (data) => {"),b=source.indexOf("    const end = (error)",a);assert.ok(a>0&&b>a);
 const ctx={ws:f.ws,noise:{decodeFrame:(node,callback)=>callback(node)},Uint8Array,Date,DEF_TAG_PREFIX:"TAG:",DEF_CALLBACK_PREFIX:"CB:",logger:{level:"warn"},lastDateRecv:null};
 vm.runInNewContext(source.slice(a,b)+";globalThis.receive=onMessageReceived",ctx);f.ws.on("message",ctx.receive);
 for(const tag of ["iq","iq","receipt","notification"])f.ws.emit("message",{tag,attrs:{id:"fixture"},content:[]});
 let c=f.snapshot().counters;assert.deepEqual([c.wsMessages,c.decodedFrames,c.messageNodes,c.emitAttempts],[4,4,0,0]);assert.equal(c.controlFrames,4);
 assert.equal(f.snapshot().messageReceiver,"ABSENT");
 f.ws.on("CB:message",()=>f.ev.emit("messages.upsert",{messages:[{key:{id:"fixture-message",remoteJid:GROUP,fromMe:false}}]}));
 registrarListenerUnicoSocket({sock:f.sock,evento:"messages.upsert",sessaoId:SESSION,logger:{log(){}},onInvoke:()=>f.o.mark("wrapper",{sock:f.sock,sessionId:SESSION}),handler:({messages})=>{
  f.o.mark("callback",{sock:f.sock,sessionId:SESSION,workspaceId:"admin",messages});
  f.o.mark("radar",{sock:f.sock,sessionId:SESSION,workspaceId:"admin",message:messages[0]});
 }});
 f.ws.emit("message",{tag:"message",attrs:{id:"fixture",from:GROUP},content:[]});
 const s=f.snapshot();c=s.counters;assert.equal(s.messageReceiver,"PRESENT");assert.deepEqual([c.messageFrames,c.messageNodes,c.emitAttempts,c.wrapperCalls,c.callbackCalls,c.radarEntries],[1,1,1,1,1,1]);assert.equal(c.targetMessageFrames,1);assert.equal(c.targetMessageNodes,1);f.o.stop();
});
test("OFF preserves dispatch, receiver, arguments, return and exceptions without reading metadata",()=>{
 const f=fixture({active:false}),before=f.ws.emit;let calls=0;const frame=new Proxy({},{get(){throw Error("unreadable");},getOwnPropertyDescriptor(){throw Error("unreadable");}});
 f.ws.on("frame",arg=>{assert.equal(arg,frame);calls++;});assert.equal(f.ws.emit("frame",frame),true);assert.equal(calls,1);assert.equal(f.ws.emit,before);assert.deepEqual(f.o.status(),{state:"off"});
 const g=fixture(),error=new Error("fixture");g.ws.on("error",arg=>{assert.equal(arg,error);throw error;});assert.throws(()=>g.ws.emit("error",error),e=>e===error);
 assert.equal(g.snapshot().counters.socketErrorEvents,1);assert.equal(g.snapshot().counters.publicDispatchThrows,1);
 assert.equal(g.snapshot().failureCoverage.decodeFailures,null);assert.equal(g.snapshot().failureCoverage.decryptFailures,null);g.o.stop();
});
test("sync signals are observations, not a fabricated Online state; generation and TTL remain bounded",()=>{
 const f=fixture();f.sock.__optimusMessengerLiveReady=true;f.ws.emit("CB:success");f.buffer(true);
 let s=f.snapshot();assert.equal(s.synchronization.lastPublicSignal,"AUTHENTICATED");assert.equal(s.synchronization.initialSyncState,"UNAVAILABLE_PUBLIC_INTERFACE");assert.equal(s.buffering,true);
 f.ws.emit("CB:ib,,offline");assert.equal(f.snapshot().synchronization.lastPublicSignal,"OFFLINE_COMPLETION_DISPATCHED");
 const second={ws:new EventEmitter(),ev:new EventEmitter()};second.ev.isBuffering=()=>false;
 assert.equal(f.o.trackSocket({...f.ctx,sock:second,generation:2}),true);second.ws.emit("frame",{tag:"message"});
 let r=f.o.status();assert.equal(r.generations[1].counters.messageFrames,1);assert.equal(r.generations[0].counters.messageFrames,0);
 const expiry=r.expiresAt;f.advance(MAX_MS);r=f.o.status();assert.equal(r.reason,"expired");assert.equal(r.expiresAt,expiry);second.ws.emit("frame",{tag:"message"});assert.equal(f.o.status().generations[1].counters.messageFrames,1);
});
test("no listeners are added and metadata failure cannot change public dispatch",()=>{
 const f=fixture(),before=f.ws.eventNames().length;const frame=new Proxy({},{getOwnPropertyDescriptor(){throw Error("PRIVATE");}});
 assert.equal(f.ws.emit("frame",frame),false);assert.equal(f.snapshot().counters.frameMetadataUnavailable,1);assert.equal(f.snapshot().counters.otherFrames,1);
 assert.equal(f.ws.eventNames().length,before);assert.doesNotMatch(JSON.stringify(f.o.status()),/PRIVATE/);f.o.stop();
});
test("group equality never reads participants; foreign nodes are aggregate only",()=>{
 const f=fixture();for(const from of [GROUP,"PRIVATE_FOREIGN_GROUP"]){const node={tag:"message",attrs:{from,get participant(){throw Error("private");}},get content(){throw Error("private");}};f.ws.emit("frame",node);f.ws.emit("CB:message",node);}
 f.ws.emit("message",Buffer.from("PRIVATE_BINARY"));
 const c=f.snapshot().counters;assert.equal(c.messageFrames,2);assert.equal(c.messageNodes,2);assert.equal(c.targetMessageFrames,1);assert.equal(c.targetMessageNodes,1);assert.equal(c.wsBinaryMessages,1);assert.doesNotMatch(JSON.stringify(f.o.status()),/PRIVATE_|120363408782037034/);f.o.stop();
});
test("throwing frame receiver is distinct from decode failure and prevents downstream dispatch",()=>{
 const f=fixture(),error=new Error("fixture");f.ws.on("frame",()=>{throw error;});assert.throws(()=>f.ws.emit("frame",{tag:"message",attrs:{from:GROUP}}),e=>e===error);
 const c=f.snapshot().counters;assert.equal(c.targetMessageFrames,1);assert.equal(c.targetMessageNodes,0);assert.equal(c.frameDispatchThrows,1);assert.equal(f.snapshot().failureCoverage.decodeFailures,null);f.o.stop();
});
