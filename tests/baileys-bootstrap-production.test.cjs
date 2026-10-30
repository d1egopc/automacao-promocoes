"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm"),{EventEmitter}=require("node:events");
const patch=require("../modules/whatsapp/baileys-balanced-buffer-patch");
const original=require("./fixtures/baileys-6.7.22-event-buffer.json");
const {registrarListenerUnicoSocket}=require("../modules/whatsapp/socket-listener-lifecycle.service");
const captured=require("./fixtures/baileys-bootstrap-production-20261030.json");
function slice(file,start,end){const key=file==="Socket/socket.js"?"bootstrap":start.includes("const upsertMessage")?"upsert":"sync";return captured.blocks[key];}
function fixture({history=false,resync=async()=>{}}={}){
 const ws=new EventEmitter(),timers=new Map(),rows=[],logger={info(){},warn(){},debug(){},trace(){},log(){}};let id=0;
 const ctx=vm.createContext({EventEmitter,logger,WAMessageStatus:{},setTimeout:fn=>{timers.set(++id,fn);return id;},clearTimeout:i=>timers.delete(i),
  ws,config:{options:{}},creds:{me:{id:"FAKE@s.whatsapp.net"}},process:{nextTick:fn=>fn()},getBinaryNodeChild:n=>n.child,
  SyncState:{Connecting:0,AwaitingInitialSync:1,Syncing:2,Online:3},fireInitQueries:false,markOnlineOnConnect:false,
  sendPresenceUpdate:async()=>{},onUnexpectedError(){},shouldSyncHistoryMessage:()=>history,
  proto:{Message:{HistorySyncNotification:{fromObject:x=>x}},HistorySync:{HistorySyncType:{RECENT:1}}},
  getHistoryMsg:m=>m?.fixtureHistory?{syncType:1}:null,PROCESSABLE_HISTORY_TYPES:[1],placeholderResendCache:{},
  authState:{creds:{me:{id:"FAKE@s.whatsapp.net"}}},ALL_WA_PATCH_NAMES:[],resyncAppState:resync,processMessage:async()=>{}});
 const code=patch.transform(original).replace(/^import .*;\r?\n/gm,"").replace("export const makeEventBuffer","const makeEventBuffer");
 vm.runInContext(code+"\nglobalThis.ev=makeEventBuffer(logger);let syncState=SyncState.Connecting;let awaitingSyncTimeout;",ctx);
 vm.runInContext(slice("Socket/chats.js","    const upsertMessage = ev.createBufferedFunction(","    ws.on('CB:presence'")+slice("Socket/chats.js","    ev.on('connection.update', ({ connection, receivedPendingNotifications }) => {","    return {")+"globalThis.upsert=upsertMessage;globalThis.state=()=>syncState;",ctx);
 vm.runInContext(slice("Socket/socket.js","    let didStartBuffer = false;","    // update credentials when required"),ctx);
 const sock={ev:ctx.ev};
 registrarListenerUnicoSocket({sock,evento:"messages.upsert",sessaoId:"isolated",logger,handler:p=>rows.push(...p.messages.map(m=>m.key.id))});
 const tick=()=>{for(const [i,fn]of [...timers]){timers.delete(i);fn();}};
 const send=(id,history=false)=>ctx.upsert({key:{id,remoteJid:"FAKE@g.us",fromMe:false},message:history?{fixtureHistory:true}:{},messageTimestamp:2000},"notify");
 return {ev:ctx.ev,ws,rows,tick,send,state:ctx.state,complete:()=>ws.emit("CB:ib,,offline",{child:{attrs:{count:"0"}}})};
}
test("missing offline completion reproduces retained explicit bootstrap hold despite settled work",async()=>{
 const f=fixture();await f.send("one");await f.send("two");for(let i=0;i<20;i++)f.tick();
 assert.equal(f.state(),0);assert.equal(f.ev.isBuffering(),true);assert.deepEqual(f.rows,[]);
});
test("native offline completion plus configured history skip releases bootstrap and post-sync messages",async()=>{
 const f=fixture();f.complete();f.tick();assert.equal(f.state(),3);
 await f.send("common");await f.send("magalu-equivalent");f.tick();
 assert.deepEqual(f.rows,["common","magalu-equivalent"]);assert.equal(f.ev.isBuffering(),false);
});
test("completed initial app-state sync releases the explicit hold only after successful await",async()=>{
 let release;const wait=new Promise(r=>release=r),f=fixture({history:true,resync:()=>wait});
 f.complete();const pending=f.send("history",true);assert.equal(f.state(),2);
 await f.send("during-sync");f.tick();assert.equal(f.ev.isBuffering(),true);
 const before=f.rows.length;release();await pending;f.tick();assert.equal(f.state(),3);
 assert.deepEqual(f.rows.slice(before),["history","during-sync"]);
 await f.send("after-sync");f.tick();assert.equal(f.rows.at(-1),"after-sync");assert.equal(f.ev.isBuffering(),false);
});
test("incomplete or failed app-state sync never receives an artificial completion",async()=>{
 const err=new Error("isolated sync failure"),f=fixture({history:true,resync:async()=>{throw err;}});
 f.complete();await assert.rejects(f.send("history",true),e=>e===err);await f.send("later");
 for(let i=0;i<20;i++)f.tick();assert.equal(f.state(),2);assert.equal(f.ev.isBuffering(),true);assert.ok(!f.rows.includes("later"));
});
test("concurrent work and exceptions after valid sync finish preserve release and original errors",async()=>{
 const f=fixture();f.complete();f.tick();let release;const wait=new Promise(r=>release=r),err=new Error("isolated work failure");
 const p=f.ev.createBufferedFunction(async()=>{await f.send("a");await wait;})();
 await assert.rejects(f.ev.createBufferedFunction(async()=>{await f.send("b");throw err;})(),e=>e===err);
 f.tick();assert.deepEqual(f.rows,[]);release();await p;f.tick();assert.deepEqual(f.rows,["a","b"]);f.tick();assert.equal(f.rows.length,2);
});
test("completion and callbacks remain isolated between socket generations",async()=>{
 const old=fixture(),current=fixture();await old.send("old");await current.send("new");current.complete();current.tick();
 assert.deepEqual(old.rows,[]);assert.deepEqual(current.rows,["new"]);assert.equal(old.ev.isBuffering(),true);
});

test("ZOIAO has no ServCel recovery; offline zero takes historical queue and append",async()=>{
 const {createBufferRecovery}=require("../modules/whatsapp/baileys-buffer-recovery.service");
 assert.equal(createBufferRecovery({workspaceId:"admin",sessionId:"admin_Zoiao Claro",isCurrent:()=>true}),null);
 const normal=[],offline=[];
 const ctx=vm.createContext({config:{optimusInitialBufferRecovery:null},offlineNodeProcessor:{enqueue:(t,n)=>offline.push(n.attrs.offline)},processNodeWithBuffer:n=>normal.push(n.attrs.offline)});
 vm.runInContext(captured.blocks.processNode+"globalThis.call=processNode;",ctx);
 for(const value of [undefined,"0","1"])ctx.call("message",{attrs:{offline:value}},"fixture",()=>{});
 assert.deepEqual(normal,[undefined]);assert.deepEqual(offline,["0","1"]);
 const fn=new (Object.getPrototypeOf(async function(){}).constructor)("node","config","msg","upsertMessage",captured.blocks.upsertType);
 const types=[];for(const value of [undefined,"0","1"])await fn({attrs:{offline:value}},{optimusInitialBufferRecovery:null},{},async(m,t)=>types.push(t));
 assert.deepEqual(types,["notify","append","append"]);
});
test("semantic correction alone cannot release the initial explicit hold",async()=>{
 const f=fixture();await f.send("buffered-live");f.tick();
 assert.equal(f.ev.isBuffering(),true);assert.deepEqual(f.rows,[]);
 // Even a genuine live notify upsert remains held until the native completion.
 // No inferred bootstrap completion or timeout flush is introduced.
 f.complete();f.tick();assert.deepEqual(f.rows,["buffered-live"]);
});
test("two tenant emitters retain and release independently without crossing callbacks",async()=>{
 const tenants=new Map([["tenant_a",fixture()],["tenant_b",fixture()]]);
 await tenants.get("tenant_a").send("a-only");await tenants.get("tenant_b").send("b-only");
 tenants.get("tenant_a").complete();tenants.get("tenant_a").tick();
 assert.deepEqual(tenants.get("tenant_a").rows,["a-only"]);
 assert.deepEqual(tenants.get("tenant_b").rows,[]);
 tenants.get("tenant_b").complete();tenants.get("tenant_b").tick();
 assert.deepEqual(tenants.get("tenant_b").rows,["b-only"]);
});
