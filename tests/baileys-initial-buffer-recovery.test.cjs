"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os"), vm = require("node:vm");
const { pathToFileURL } = require("node:url");
const { EventEmitter } = require("node:events");
const { createBufferRecovery } = require("../modules/whatsapp/baileys-buffer-recovery.service");
const patch = require("../modules/whatsapp/baileys-buffer-hotfix.service");
const { registrarListenerUnicoSocket } = require("../modules/whatsapp/socket-listener-lifecycle.service");
const W="user_k3phmbkf", S=W+"_ServCel", G="fixture@g.us", logger={info(){},warn(){},trace(){},debug(){},log(){}};
const dir=path.join(__dirname,"../node_modules/@whiskeysockets/baileys/lib");
const source=file=>fs.readFileSync(path.join(dir,file.replace(/^lib\//,"")),"utf8");
const imported=(async()=>{
  await import(pathToFileURL(path.join(dir,"index.js")).href);
  return { ...(await import(pathToFileURL(path.join(dir,"Utils/event-buffer.js")).href)),
    ...(await import(pathToFileURL(path.join(dir,"Types/State.js")).href)) };
})();
function clock() {
  let now=0,wall=1000000,id=0; const timers=new Map();
  return { now:()=>now,wall:()=>wall, schedule:(fn,ms)=>{const key=++id;timers.set(key,{fn,at:now+ms});return key;},cancel:key=>timers.delete(key),
    advance(ms){now+=ms;wall+=ms;for(const [key,t]of [...timers])if(t.at<=now){timers.delete(key);t.fn();}},count:()=>timers.size };
}
async function fixture(t,{history=true,current=true}={}) {
  const { makeEventBuffer,SyncState }=await imported,c=clock(),ev=makeEventBuffer(logger),ws=new EventEmitter();ws.isOpen=true;
  const phases=[],business=[],ingress=[],participantBusiness=[];
  const recovery=createBufferRecovery({workspaceId:W,sessionId:S,isCurrent:()=>current,
    now:c.wall,monotonic:c.now,schedule:c.schedule,cancel:c.cancel,report:stage=>phases.push(stage)});
  t.after(()=>recovery.stop());
  const config={optimusInitialBufferRecovery:recovery,options:{}};
  const ctx=vm.createContext({ev,ws,config,creds:{me:{id:"FAKE@s.whatsapp.net"}},logger,SyncState,
    proto:{Message:{HistorySyncNotification:{fromObject:x=>x}},HistorySync:{HistorySyncType:{RECENT:1}}},
    process:{nextTick:fn=>fn()},setTimeout:c.schedule,clearTimeout:c.cancel,getBinaryNodeChild:n=>n.child,
    fireInitQueries:false,markOnlineOnConnect:false,executeInitQueries:async()=>{},sendPresenceUpdate:async()=>{},onUnexpectedError(){},
    shouldSyncHistoryMessage:()=>history,getHistoryMsg:()=>null,PROCESSABLE_HISTORY_TYPES:[],placeholderResendCache:{},
    authState:{creds:{me:{id:"FAKE@s.whatsapp.net"}},keys:{}},ALL_WA_PATCH_NAMES:[],resyncAppState:async()=>{},
    processMessage:async msg=>{if(msg.fixtureParticipant)ev.emit("group-participants.update",{id:G,action:"add",participants:["FAKE@lid"]});}});
  const chats=source("Socket/chats.js"),socket=source("Socket/socket.js");
  const up=chats.indexOf("    const upsertMessage = ev.createBufferedFunction("),upEnd=chats.indexOf("    ws.on('CB:presence'",up);
  const conn=chats.indexOf("    ev.on('connection.update', ({ connection, receivedPendingNotifications }) => {"),connEnd=chats.indexOf("    return {",conn);
  const start=socket.indexOf("    let didStartBuffer = false;"),end=socket.indexOf("    // update credentials when required",start);
  assert.ok(up>=0&&upEnd>up&&conn>=0&&connEnd>conn&&start>=0&&end>start);
  vm.runInContext("let syncState=SyncState.Connecting;let awaitingSyncTimeout;"+chats.slice(up,upEnd)+chats.slice(conn,connEnd)+"globalThis.upsert=upsertMessage;",ctx);
  vm.runInContext(socket.slice(start,end),ctx);
  ev.emit("connection.update",{connection:"open"});
  const sock={ev};
  registrarListenerUnicoSocket({sock,evento:"messages.upsert",logger,handler:({messages,type})=>{
    for(const m of messages){ingress.push({id:m.key.id,type});if(!recovery.shouldSuppressMessage(m))business.push(m.key.id);}
  }});
  ev.on("group-participants.update",()=>{if(!recovery.suppressCurrentContext())participantBusiness.push("welcome");});
  const msg=(id,stamp=999)=>({key:{id,remoteJid:G},messageTimestamp:stamp,message:{conversation:"FAKE ONLY"}});
  const online=async m=>{ev.buffer();await ctx.upsert(m,"notify");ev.flush();};
  return {c,ev,ws,recovery,config,ctx,business,ingress,phases,participantBusiness,msg,online,upsert:ctx.upsert};
}

test("version-pinned installation is exact and idempotent; foreign content/version fail before writes",()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"buffer-hotfix-fixture-"));
  try {
    const pkg=path.join(root,patch.ROOT);fs.mkdirSync(pkg,{recursive:true});fs.writeFileSync(path.join(pkg,"package.json"),JSON.stringify({version:patch.VERSION}));
    const originals={};
    for(const [file,edits]of Object.entries(patch.EDITS)) {
      let text=source(file);for(const [before,after]of [...edits].reverse())text=text.replace(after,before);
      originals[file]=text;fs.mkdirSync(path.dirname(path.join(pkg,file)),{recursive:true});fs.writeFileSync(path.join(pkg,file),text);
    }
    assert.equal(patch.applyPatch({rootDir:root,log(){}}).status,"applied");
    assert.equal(patch.applyPatch({rootDir:root,log(){}}).status,"already_applied");
    for(const file of Object.keys(originals))assert.equal(fs.readFileSync(path.join(pkg,file),"utf8"),patch.transform(file,originals[file]));
    fs.writeFileSync(path.join(pkg,"package.json"),JSON.stringify({version:"7.0.0"}));
    assert.throws(()=>patch.applyPatch({rootDir:root,log(){}}),/version_mismatch/);
    fs.writeFileSync(path.join(pkg,"package.json"),JSON.stringify({version:patch.VERSION}));
    fs.appendFileSync(path.join(pkg,"lib/Socket/chats.js"),"\n// tampered");
    const before=Object.keys(originals).map(f=>fs.readFileSync(path.join(pkg,f),"utf8"));
    assert.throws(()=>patch.applyPatch({rootDir:root,log(){}}),/hash_mismatch/);
    assert.deepEqual(Object.keys(originals).map(f=>fs.readFileSync(path.join(pkg,f),"utf8")),before);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});

test("offline zero/missing go through real normal processor; offline one keeps serial historical queue",async()=>{
  const recv=source("Socket/messages-recv.js");
  const a=recv.indexOf("    const processNode = (type, node, identifier, exec) => {"),b=recv.indexOf("    // Handles newsletter notifications",a);
  assert.ok(a>=0&&b>a);const normal=[],offline=[];
  const recovery=createBufferRecovery({workspaceId:W,sessionId:S,isCurrent:()=>true});
  const ctx=vm.createContext({config:{optimusInitialBufferRecovery:recovery},offlineNodeProcessor:{enqueue:(type,node)=>offline.push(node.attrs.offline)},
    processNodeWithBuffer:(node)=>normal.push(node.attrs.offline)});
  vm.runInContext(recv.slice(a,b)+"globalThis.call=processNode;",ctx);
  for(const value of ["0",undefined,"1"])ctx.call("message",{attrs:{offline:value}},"fixture",()=>{});
  assert.deepEqual(normal,["0",undefined]);assert.deepEqual(offline,["1"]);
  const line=recv.split("\n").find(l=>l.includes("await upsertMessage(msg,"));
  const call=new (Object.getPrototypeOf(async function(){}).constructor)("node","config","msg","upsertMessage",line);
  const types=[];for(const offline of ["0","1",undefined])await call({attrs:{offline}},{optimusInitialBufferRecovery:recovery},{},async(_m,type)=>types.push(type));
  assert.deepEqual(types,["notify","append","notify"]);
  ctx.config.optimusInitialBufferRecovery=null;ctx.call("message",{attrs:{offline:"0"}},"fixture",()=>{});
  assert.deepEqual(offline,["1","0"],"other sessions retain their original path");
});

test("missing offline completion recovers once; accumulated messages observable but never commercial",async t=>{
  const f=await fixture(t);await f.upsert(f.msg("old"),"append");await f.upsert(f.msg("during-bootstrap",1005),"notify");
  assert.equal(f.ev.isBuffering(),true);assert.equal(f.ingress.length,0);
  f.c.advance(19999);assert.equal(f.ingress.length,0);
  f.c.advance(1);assert.equal(f.ev.isBuffering(),false);
  assert.equal(f.ingress.length,2);assert.deepEqual(f.business,[]);
  f.c.advance(900000);assert.equal(f.ingress.length,2);assert.equal(f.phases.filter(p=>p==="initial_timeout_recovery").length,1);
});

test("normal fresh messages work after recovery; old pending work and redelivery never replay business",async t=>{
  const f=await fixture(t),old=f.msg("old",1001);await f.upsert(old,"notify");f.c.advance(20000);
  f.c.advance(2000);await f.online(f.msg("fresh",1022));assert.deepEqual(f.business,["fresh"]);
  await f.online(old);await f.online(f.msg("old-pending-decrypt",1005));await f.upsert(f.msg("server-offline",9999),"append");f.ev.flush();
  assert.deepEqual(f.business,["fresh"]);
  const noStamp=f.msg("unknown",undefined);delete noStamp.messageTimestamp;await f.online(noStamp);
  assert.deepEqual(f.business,["fresh"]);
});

test("real completion cancels recovery; native initial flush still fences historical entries",async t=>{
  const f=await fixture(t);await f.upsert(f.msg("old"),"append");
  f.ws.emit("CB:ib,,offline",{child:{attrs:{count:"1"}}});
  assert.deepEqual(f.business,[]);assert.equal(f.recovery.snapshot().pending,false);
  f.c.advance(20001);assert.ok(!f.phases.includes("initial_timeout_recovery"));
  await f.online(f.msg("fresh",1021));assert.deepEqual(f.business,["fresh"]);
});

test("historical participant events and async pending work cannot emit welcome/replies",async t=>{
  const f=await fixture(t),old=f.msg("old-participant");old.fixtureParticipant=true;
  await f.upsert(old,"append");assert.deepEqual(f.participantBusiness,[]);
  let release;const pending=new Promise(r=>release=r);
  const work=f.recovery.runMessage(old,async()=>{await pending;f.ev.emit("group-participants.update",{});});
  f.c.advance(20000);release();await work;assert.deepEqual(f.participantBusiness,[]);
  f.c.advance(2000);const fresh=f.msg("fresh-participant",1022);fresh.fixtureParticipant=true;
  await f.online(fresh);assert.deepEqual(f.participantBusiness,["welcome"]);
});

test("stale/closed socket, stop and failure never flush another generation; no extra listeners",async t=>{
  const f=await fixture(t,{current:false});await f.upsert(f.msg("old"),"append");f.c.advance(20000);
  assert.equal(f.ev.isBuffering(),true);assert.equal(f.ingress.length,0);assert.equal(f.recovery.snapshot().closed,true);
  const x=await fixture(t);x.recovery.stop();x.c.advance(900000);assert.equal(x.ingress.length,0);
  const y=await fixture(t);y.ws.isOpen=false;y.c.advance(20000);assert.equal(y.ev.isBuffering(),true);
  assert.equal(createBufferRecovery({workspaceId:"other",sessionId:S}),null);
  assert.equal(createBufferRecovery({workspaceId:W,sessionId:W+"_ClaroTeste"}),null);
  assert.equal(y.ws.listenerCount("CB:ib,,offline"),1,"original native listener only");
});

test("actual shared callback gates backlog before Radar/Gerente/commands/credits/clone; fresh event reaches consumers",async t=>{
  const f=await fixture(t),text=fs.readFileSync(path.join(__dirname,"../index.js"),"utf8");
  const a=text.indexOf('registrarListenerUnicoSocket({\n  sock,\n  evento: "messages.upsert"');
  const b=text.indexOf('registrarListenerUnicoSocket({\n  sock,\n  evento: "messages.update"',a);
  assert.ok(a>=0&&b>a);const reached=[];const sock={ev:f.ev,__optimusBufferRecovery:f.recovery};
  const noop=()=>{};const ctx={sock,id:S,socketGeracao:1,sessoes:{[S]:sock},force:false,clienteIdMensageiro:W,
    registrarListenerUnicoSocket,socketEhAtual:(s,id,sock)=>s[id]===sock,
    mensageiroV4Diagnostics:{observe:noop,observeListener:noop},mensageiroV4Canary:{ingress:noop,stop:noop},diagnosticarEntradaUpsert:noop,
    gerenteObservabilityV2:{isActiveFor:()=>false},diagnosticoMensageiroV3:noop,
    coberturaRadar:{flagAtiva:()=>false,registrar:noop,criarCoberturaTraceId:()=>"fixture",extrairFidelidadeTraceId:()=>"",extrairMensagemId:()=>""},
    obterNomeGrupoRadar:()=>"",gerenteTraceEnabled:()=>false,usuarioAtivoOperacional:()=>true,
    executarConsumidorMensagemIsolado:async({consumidor,executar})=>{reached.push(consumidor);return {ok:true,resultado:await executar()};},
    processarMensagemRadarAutomatica:async()=>({}),dispatchMensageiroV3Ingress:async()=>({}),clienteTemRecursoMensageiro:()=>true,
    resolverClienteClonePorSessao:()=>({valido:false}),clonadorGruposService:{},console:{log:noop}};
  vm.runInNewContext(text.slice(a,b),ctx);
  await f.upsert(f.msg("old"),"append");f.c.advance(20000);await new Promise(r=>setImmediate(r));
  assert.deepEqual(reached,[]);
  f.c.advance(2000);await f.online(f.msg("fresh",1022));await new Promise(r=>setImmediate(r));
  assert.ok(reached.includes("radar"));assert.ok(reached.includes("mensageiro_gerente"));assert.ok(reached.includes("mensageiro_comando"));
  assert.ok(reached.includes("clonador_grupos"));
  assert.equal((text.match(/sock\.ev\.on\("group-participants.update"/g)||[]).length,1);
});
