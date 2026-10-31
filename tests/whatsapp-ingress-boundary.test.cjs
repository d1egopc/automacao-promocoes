"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const {pathToFileURL}=require("node:url");
const {createIngressBoundaryObservation,MAX_MS,MAX_CALLS}=require("../modules/whatsapp/ingress-boundary-observation");
const {registrarListenerUnicoSocket,marcarSocketAtual}=require("../modules/whatsapp/socket-listener-lifecycle.service");
const {EventEmitter}=require("node:events");
let makeBuffer;
test.before(async()=>{const base=path.resolve(__dirname,"../node_modules/@whiskeysockets/baileys/lib");await import(pathToFileURL(path.join(base,"index.js")).href);makeBuffer=(await import(pathToFileURL(path.join(base,"Utils/event-buffer.js")).href)).makeEventBuffer;});
const logger={log(){},debug(){},trace(){}};
function fixture(){let time=1000;const timers=[];const o=createIngressBoundaryObservation({now:()=>time,setTimer:(fn,ms)=>{const t={fn,ms,unref(){}};timers.push(t);return t;},clearTimer:t=>{t.cleared=true;}});
 const sock={ev:makeBuffer(logger)},ctx={workspaceId:"admin",sessionId:"admin_Zoiao Claro",sock,generation:1,groupId:"120363408782037034@g.us",scopeValidated:true};
 return {o,sock,ctx,timers,advance:ms=>time+=ms};}
function wire(f,sock=f.sock,{sessionId="admin_Zoiao Claro",workspaceId="admin",early=false,noRadar=false}={}){
 let radar=0;
 registrarListenerUnicoSocket({sock,evento:"messages.upsert",sessaoId:sessionId,handler:()=>{
  f.o.mark("callback",{sock,sessionId,workspaceId});
  if(early){f.o.mark("early",{sock,sessionId,workspaceId,reason:"user_inactive"});return;}
  if(!noRadar){radar++;f.o.mark("radar",{sock,sessionId,workspaceId});}
 },onInvoke:()=>f.o.mark("wrapper",{sock,sessionId}),logger});
 return ()=>radar;
}
const message={type:"notify",messages:[{key:{remoteJid:"PRIVATE_PHONE@g.us",id:"PRIVATE_ID"},message:{conversation:"https://example.test/SECRET token secret_message"}}]};
test("OFF leaves emitter untouched and performs no metadata reads or timers",()=>{
 let reads=0;const sock={get ev(){reads++;throw Error("must_not_read");}};const o=createIngressBoundaryObservation({setTimer:()=>{throw Error("timer_off");}});
 for(let i=0;i<10000;i++){o.trackSocket({sock});o.mark("wrapper",{sock});}
 assert.equal(reads,0);assert.deepEqual(o.status(),{state:"off"});
});
test("no Baileys emit is distinguished from buffering and does not claim absence at transport",()=>{
 const f=fixture();wire(f);assert.equal(f.o.start(f.ctx).ok,true);
 const s=f.o.status();assert.equal(s.generations[0].listener.state,"UNKNOWN");
 assert.equal(s.generations[0].distinction,"no_upsert_emit_observed_not_transport_proof");
 f.o.stop();
});

test("real Baileys WebSocket public dispatch exposes aggregate stages without network, payload access or new listener",async()=>{
 const {WebSocketClient}=await import(pathToFileURL(path.resolve(__dirname,"../node_modules/@whiskeysockets/baileys/lib/Socket/Client/websocket.js")).href);
 const f=fixture(),ws=new WebSocketClient(new URL("wss://fixture.invalid"),{});f.sock.ws=ws;
 const original=ws.emit,listenerCount=ws.eventNames().length;
 const payload=new Proxy({}, {get(){throw Error("payload_must_not_be_read");}});
 f.o.start(f.ctx);
 assert.equal(ws.emit("message",payload),false);ws.emit("frame",payload);ws.emit("CB:message",payload);ws.emit("open");ws.emit("close");
 const s=f.o.status().generations[0];assert.equal(s.socketCoverage,"public_emit_observed");
 for(const name of ["wsMessages","decodedFrames","messageNodes","wsOpens","wsCloses"])assert.equal(s.counters[name],1);
 assert.equal(s.counters.emitAttempts,0);assert.equal(ws.eventNames().length,listenerCount);assert.equal(ws.socket,null);
 f.o.stop();assert.equal(ws.emit,original);
});
test("real Baileys buffer entry/release, listener public registration and wrapper/Radar delivery",()=>{
 const f=fixture();f.o.start(f.ctx);const count=wire(f);const ev=f.sock.ev;
 assert.equal(f.o.status().generations[0].listener.state,"ATTACHED");
 ev.buffer();ev.emit("messages.upsert",message);
 let s=f.o.status().generations[0];assert.equal(s.counters.emitAttempts,1);assert.equal(s.counters.wrapperCalls,0);assert.equal(s.distinction,"buffer_retained_observed");
 ev.flush();s=f.o.status().generations[0];assert.equal(s.counters.wrapperCalls,1);assert.equal(s.counters.callbackCalls,1);assert.equal(count(),1);assert.equal(s.distinction,"radar_reached");assert.ok(s.counters.bufferTransitions>=2);
 f.o.stop();
});
test("native private-emitter removal is observed without a probe event or reinstalling listener",()=>{
 const f=fixture();f.o.start(f.ctx);wire(f);f.sock.ev.removeAllListeners("messages.upsert");
 assert.equal(f.o.status().generations[0].listener.state,"ABSENT");
 f.sock.ev.emit("messages.upsert",message);
 const s=f.o.status().generations[0];assert.equal(s.counters.emitAttempts,1);assert.equal(s.counters.wrapperCalls,0);assert.equal(s.distinction,"listener_absent_observed");f.o.stop();
});
test("wrong session/workspace and early return before Radar are separate counters",()=>{
 const f=fixture();f.o.start(f.ctx);wire(f,f.sock,{sessionId:"wrong_session",workspaceId:"other_workspace",early:true});f.sock.ev.emit("messages.upsert",message);
 const s=f.o.status().generations[0];assert.equal(s.counters.wrapperCalls,1);assert.equal(s.counters.callbackCalls,1);assert.equal(s.counters.sessionMismatch,3);assert.equal(s.counters.workspaceMismatch,2);assert.equal(s.counters.earlyReturns,1);assert.equal(s.counters.radarEntries,0);assert.equal(s.distinction,"early_return_observed");f.o.stop();
});
test("generation1 to2 tracks new socket, same generation emitter replacement, old socket and no deadline renewal",()=>{
 const f=fixture(),sessions={},generations={};marcarSocketAtual({sessoes:sessions,geracoes:generations,sessaoId:f.ctx.sessionId,sock:f.sock,logger});f.o.start(f.ctx);wire(f);
 const expiry=f.o.status().expiresAt;f.sock.ev.emit("messages.upsert",message);
 const second={ev:makeBuffer(logger)};const gen=marcarSocketAtual({sessoes:sessions,geracoes:generations,sessaoId:f.ctx.sessionId,sock:second,logger}).socketGeracao;
 assert.equal(gen,2);assert.equal(f.o.trackSocket({...f.ctx,sock:second,generation:gen}),true);wire(f,second);second.ev.emit("messages.upsert",message);
 const old=second.ev;second.ev=makeBuffer(logger);f.o.trackSocket({...f.ctx,sock:second,generation:gen});wire(f,second);second.ev.emit("messages.upsert",message);
 const s=f.o.status();assert.equal(s.generations.length,3);assert.equal(s.generations[2].isCurrent,true);assert.equal(s.expiresAt,expiry);assert.equal(s.generations[1].listener.state,"ABSENT_OR_REGISTRY_MISMATCH");assert.notEqual(old,second.ev);f.o.stop();
});
test("foreign workspace/session is not intercepted; snapshots redact all message values",()=>{
 const f=fixture();f.o.start(f.ctx);const other={ev:makeBuffer(logger)},before=other.ev.emit;
 assert.equal(f.o.trackSocket({...f.ctx,sock:other,workspaceId:"other"}),false);assert.equal(other.ev.emit,before);
 wire(f);f.sock.ev.emit("messages.upsert",message);
 // The bootstrap observer now exposes the fixed enum class `other`; reject
 // only fixture secrets and real session identifiers from the snapshot.
 assert.doesNotMatch(JSON.stringify(f.o.status()),/PRIVATE|SECRET|example\.test|secret_message|admin_Zoiao Claro/);f.o.stop();
});
test("expiry restores methods, preserves callbacks, never flushes and reads do not extend",()=>{
 const f=fixture(),before={emit:f.sock.ev.emit,on:f.sock.ev.on,off:f.sock.ev.off,flush:f.sock.ev.flush};wire(f);const handler=f.sock.__optimusListeners["messages.upsert"].handler;
 f.o.start(f.ctx);const expiry=f.o.status().expiresAt;f.sock.ev.buffer();f.sock.ev.emit("messages.upsert",message);f.advance(MAX_MS-1);assert.equal(f.o.status().expiresAt,expiry);f.advance(1);
 const s=f.o.status();assert.equal(s.state,"stopped");assert.equal(s.reason,"expired");assert.equal(s.generations[0].buffering,true);assert.equal(f.sock.ev.isBuffering(),true);assert.equal(f.sock.__optimusListeners["messages.upsert"].handler,handler);for(const key of Object.keys(before))assert.equal(f.sock.ev[key],before[key]);
 assert.equal(f.o.start(f.ctx).ok,false);
});
test("call and generation caps bound data, native return/exception semantics are preserved",()=>{
 const f=fixture();const ev=f.sock.ev,nativeReturn=ev.on("baseline",()=>{});f.o.start(f.ctx);assert.equal(ev.on("other",()=>{}),nativeReturn); // Preserve private native emitter return.
 for(let i=0;i<MAX_CALLS;i++)ev.emit("messages.upsert",message);
 assert.equal(f.o.status().reason,"call_limit");assert.ok(f.o.status().records.length<=64);
 const g=fixture();g.o.start(g.ctx);for(let i=2;i<=5;i++)g.o.trackSocket({...g.ctx,sock:{ev:makeBuffer(logger)},generation:i});assert.equal(g.o.status().reason,"generation_limit");
 const n=fixture();n.sock.ev=new EventEmitter();n.o.start(n.ctx);const error=new Error("native_error");n.sock.ev.on("other",()=>{throw error;});assert.throws(()=>n.sock.ev.emit("other"),e=>e===error);n.o.stop();
});

test("failed native emit is not reported as retained buffer; stop preserves foreign method replacements",()=>{
 const f=fixture();f.sock.ev=new EventEmitter();f.sock.ev.isBuffering=()=>true;
 f.o.start(f.ctx);const error=new Error("native_failure");f.sock.ev.on("messages.upsert",()=>{throw error;});
 assert.throws(()=>f.sock.ev.emit("messages.upsert",message),e=>e===error);
 const s=f.o.status().generations[0];assert.equal(s.counters.emitErrors,1);assert.equal(s.counters.emitCompleted,0);
 assert.notEqual(s.distinction,"buffer_retained_observed");
 const replacement=()=>false;f.sock.ev.emit=replacement;f.o.stop();assert.equal(f.sock.ev.emit,replacement);
});

test("old emitter wrapper is attributed to its original binding, and retained snapshots expire",()=>{
 const f=fixture();f.o.start(f.ctx);wire(f);const old=f.sock.ev;
 f.sock.ev=makeBuffer(logger);f.o.trackSocket({...f.ctx});wire(f);
 f.o.mark("wrapper",{sock:f.sock,emitter:old,sessionId:f.ctx.sessionId,current:false});
 const s=f.o.status();assert.equal(s.generations[0].counters.wrapperCalls,1);assert.equal(s.generations[0].counters.staleSocket,1);assert.equal(s.generations[1].counters.wrapperCalls,0);
 f.o.stop();f.advance(900000);assert.deepEqual(f.o.status(),{state:"off"});
});
test("Admin Master routes are explicit and independent from Garimpei sensor controls",()=>{
 const code=fs.readFileSync(path.resolve(__dirname,"../index.js"),"utf8");const start=code.indexOf('app.get("/admin/whatsapp/ingress-boundary"'),end=code.indexOf('app.get("/admin/radar/ingress-observation"',start);const routes=code.slice(start,end);
 assert.equal((routes.match(/exigirAdminMasterEngine\(req, res\)/g)||[]).length,3);assert.match(routes,/OP_TEST_RADAR_BOUNDARY_5M/);assert.match(routes,/validarAlvoObservacaoOpTesteRadar/);assert.doesNotMatch(routes,/radarIngressObservation\.(start|stop)|garimpeiSensorEnabled\s*=/);
});

test("exact production registration reaches mocked Radar/Engine across generations and isolates early returns",async()=>{
 const vm=require("node:vm"),{socketEhAtual}=require("../modules/whatsapp/socket-listener-lifecycle.service");
 const code=fs.readFileSync(path.resolve(__dirname,"../index.js"),"utf8");
 const begin=code.indexOf('registrarListenerUnicoSocket({\n  sock,\n  evento: "messages.upsert"');
 const end=code.indexOf('registrarListenerUnicoSocket({\n  sock,\n  evento: "messages.update"',begin);
 assert.ok(begin>0&&end>begin);const registration=code.slice(begin,end);
 const f=fixture(),sessions={},generations={},engine=[];
 const tick=()=>new Promise(resolve=>setImmediate(resolve));
 const observation={observeWrapper(){},observeUpsert(){}};
 function install(sock,{sessionId="admin_Zoiao Claro",workspaceId="admin",userActive=true}={}){
  const generation=marcarSocketAtual({sessoes:sessions,geracoes:generations,sessaoId:sessionId,sock,logger}).socketGeracao;
  f.o.trackSocket({sock,sessionId,workspaceId,generation});
  vm.runInNewContext(registration,{sock,id:sessionId,socketGeracao:generation,sessoes:sessions,force:false,
   clienteIdMensageiro:workspaceId,whatsappIngressEmitter:sock.ev,whatsappIngressBoundary:f.o,
   registrarListenerUnicoSocket,socketEhAtual,radarIngressObservation:observation,
   mensageiroV4Diagnostics:{observeListener(){},observe(){}},mensageiroV4Canary:{ingress(){},stop(){}},
   diagnosticarEntradaUpsert(){},diagnosticoMensageiroV3(){},gerenteObservabilityV2:{isActiveFor:()=>false},
   gerenteTraceEnabled:()=>false,usuarioAtivoOperacional:()=>userActive,
   coberturaRadar:{flagAtiva:()=>false,registrar(){},criarCoberturaTraceId:()=>"",extrairFidelidadeTraceId:()=>"",extrairMensagemId:()=>""},
   obterNomeGrupoRadar:()=>"",executarConsumidorMensagemIsolado:async({executar})=>({ok:true,resultado:await executar()}),
   processarMensagemRadarAutomatica:async({mensagem,diagnosticoWorkspaceId})=>{engine.push({kind:mensagem.fixtureKind,workspaceId:diagnosticoWorkspaceId});return {ok:true};},
   dispatchMensageiroV3Ingress:async()=>({}),clienteTemRecursoMensageiro:()=>true,
   resolverClienteClonePorSessao:()=>({valido:false}),clonadorGruposService:{},console:logger});
 }
 const emit=async(sock)=>{for(const kind of ["magalu","mercadolivre","shopee"]){
  sock.ev.emit("messages.upsert",{type:"notify",messages:[{fixtureKind:kind,key:{id:kind,remoteJid:"fixture@g.us",fromMe:false},message:{conversation:"local fixture"}}]});await tick();await tick();
 }};
 install(f.sock);f.o.start(f.ctx);await emit(f.sock);assert.equal(engine.length,3);
 const second={ev:makeBuffer(logger)};install(second);second.ev.buffer();await emit(second);
 assert.equal(engine.length,3);assert.equal(f.o.status().generations[1].distinction,"buffer_retained_observed");
 second.ev.flush();await tick();await tick();assert.equal(engine.length,6);
 assert.equal(f.o.status().generations[1].counters.wrapperCalls,1,"real buffer releases one consolidated batch");
 second.ev.removeAllListeners("messages.upsert");await emit(second);assert.equal(engine.length,6);
 assert.equal(f.o.status().generations[1].distinction,"radar_reached","aggregate retains earlier progress; removals remain explicit");
 assert.equal(f.o.status().generations[1].listener.state,"ABSENT");
 const third={ev:makeBuffer(logger)};install(third,{userActive:false});await emit(third);
 const s=f.o.status().generations[2];assert.equal(s.counters.callbackCalls,3);assert.equal(s.counters.earlyReturns,3);assert.equal(s.counters.radarEntries,0);
 assert.ok(f.o.status().records.some(x=>x.kind==="user_inactive"));assert.equal(engine.length,6);
 f.o.stop();assert.deepEqual(engine.map(x=>x.kind),["magalu","mercadolivre","shopee","magalu","mercadolivre","shopee"]);
});
const TARGET_JID='120363408782037034@g.us';
const targetMessage=(id,fromMe=false)=>({key:{id,remoteJid:TARGET_JID,fromMe},get message(){throw Error('content_not_allowed');}});

test('target message metadata survives a retained buffer without reading content; foreign groups stay absent',()=>{
 const f=fixture();f.o.start(f.ctx);
 registrarListenerUnicoSocket({sock:f.sock,evento:'messages.upsert',sessaoId:f.ctx.sessionId,logger,
  onInvoke:()=>f.o.mark('wrapper',{sock:f.sock,sessionId:f.ctx.sessionId}),
  handler:packet=>{f.o.mark('callback',{sock:f.sock,sessionId:f.ctx.sessionId,workspaceId:'admin',messages:packet.messages});
   for(const message of packet.messages)f.o.mark('listener',{sock:f.sock,sessionId:f.ctx.sessionId,workspaceId:'admin',message});}});
 f.sock.ev.buffer();f.sock.ev.emit('messages.upsert',{type:'notify',messages:[targetMessage('private-message-id',true),{key:{id:'foreign',remoteJid:'other@g.us',fromMe:false},get message(){throw Error('no_content');}}]});
 let s=f.o.status();assert.equal(s.messages.length,1);assert.equal(s.messages[0].fromMe,true);assert.equal(s.messages[0].stages[0].kind,'emit_attempt');assert.equal(s.generations[0].counters.callbackCalls,0);
 f.sock.ev.flush();s=f.o.status();assert.equal(s.messages.length,1);assert.ok(s.messages[0].stages.some(x=>x.kind==='callback'));assert.ok(s.messages[0].stages.some(x=>x.kind==='listener'));
 assert.doesNotMatch(JSON.stringify(s),/private-message-id|other@g.us|120363408782037034|foreign/);f.o.stop();
});

test('unchanged production fromMe gate records a scoped early return before commercial Radar processing',async()=>{
 const vm=require('node:vm');const code=fs.readFileSync(path.resolve(__dirname,'../index.js'),'utf8');
 const begin=code.indexOf('async function processarMensagemRadarAutomatica(');const end=code.indexOf('  const grupoNome =',begin);
 assert.ok(end>begin);const f=fixture();f.o.start(f.ctx);
 const context={radarIngressObservation:{recordStage(){}},whatsappIngressBoundary:f.o};vm.runInNewContext(code.slice(begin,end)+' return {ok:true};\n}\nthis.call=processarMensagemRadarAutomatica;',context);
 const result=await context.call({mensagem:targetMessage('own',true),sessaoId:f.ctx.sessionId,sock:f.sock,diagnosticoWorkspaceId:'admin'});
 assert.equal(result.motivo,'mensagem_nao_monitoravel');assert.equal(f.o.status().messages[0].fromMe,true);assert.equal(f.o.status().messages[0].stages[0].reason,'from_me');f.o.stop();
});

test('ten-message cap, immutable readout, exact target and unkeyed coverage are explicit',()=>{
 const f=fixture();assert.equal(f.o.start({...f.ctx,groupId:'wrong@g.us'}).ok,false);f.o.start(f.ctx);
 for(let i=0;i<11;i++)f.sock.ev.emit('messages.upsert',{messages:[targetMessage('m'+i)]});
 let s=f.o.status();assert.equal(s.state,'stopped');assert.equal(s.reason,'message_limit');assert.equal(s.messages.length,10);
 s.messages[0].stages[0].kind='tampered';assert.notEqual(f.o.status().messages[0].stages[0].kind,'tampered');
 const g=fixture();g.o.start(g.ctx);g.sock.ev.emit('messages.upsert',{messages:[{key:{remoteJid:TARGET_JID,fromMe:false}}]});assert.ok(g.o.status().unkeyed>0);g.o.stop();
});

test('existing listener without physical introspection remains UNKNOWN until a real wrapper invocation',()=>{
 const f=fixture();wire(f);f.o.start(f.ctx);assert.equal(f.o.status().generations[0].listener.state,'UNKNOWN');
 f.sock.ev.emit('messages.upsert',{messages:[targetMessage('real-invocation')]});assert.equal(f.o.status().generations[0].listener.evidence,'wrapper_invocation');f.o.stop();
});
test('production target validator fails closed for wrong workspace, selection, socket and attachment',()=>{
 const vm=require('node:vm'),crypto=require('node:crypto');const code=fs.readFileSync(path.resolve(__dirname,'../index.js'),'utf8');
 const begin=code.indexOf('const OP_TEST_RADAR_BOUNDARY_TARGET ='),end=code.indexOf('function responderObservacaoIngressRadar',begin);
 function validate(mode){const ev=new EventEmitter(),sock={ev},handler=()=>{};ev.on('messages.upsert',handler);sock.__optimusListeners={'messages.upsert':{emissor:ev,evento:'messages.upsert',handler}};
  const group={id:TARGET_JID,grupoId:TARGET_JID,remoteJid:TARGET_JID,sessaoId:'admin_Zoiao Claro',ativo:mode!=='unselected'};
  if(mode==='conflicting_id')group.grupoId='wrong@g.us';if(mode==='missing')ev.removeAllListeners('messages.upsert');
  const context={createHash:crypto.createHash,carregarRadarConfigCliente:()=>({monitoramentoAtivo:true,sessoesWhatsappMonitoradas:[{sessaoId:'admin_Zoiao Claro',gruposMonitorados:[group]}]}),
   obterGrupoWhatsappIdTecnicoRadar:g=>g.remoteJid,resolverSessaoWhatsappRadarCliente:()=> 'admin_Zoiao Claro',sessoesMeta:{'admin_Zoiao Claro':{workspaceId:mode==='wrong_workspace'?'other':'admin',clienteId:'admin'}},resolverClienteMensageiroPorSessao:()=>({clienteIdMensageiro:'admin'}),sessoes:{'admin_Zoiao Claro':sock},statusSessao:{'admin_Zoiao Claro':mode==='closed'?'closed':'open'},socketEhAtual:()=>mode!=='stale',geracoesSocketWhatsapp:{'admin_Zoiao Claro':2}};
  vm.runInNewContext(code.slice(begin,end)+'this.result=validarAlvoObservacaoOpTesteRadar();',context);return context.result;}
 assert.equal(validate('ok').ok,true);for(const mode of ['unselected','conflicting_id','missing','wrong_workspace','closed','stale'])assert.equal(validate(mode).ok,false,mode);
});
