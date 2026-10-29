"use strict";
const {randomBytes,createHmac}=require("node:crypto");
const MAX_MS=300000,MAX_CALLS=1000,MAX_RECORDS=64,MAX_GENERATIONS=4,RETENTION_MS=900000,MAX_MESSAGES=10;
const REASONS=new Set(["socket_stale","user_inactive","buffer_recovery_suppressed","from_me","not_group","accepted","mensagem_nao_monitoravel","other","group_not_monitored","stale_message","wrong_upsert_type","no_links","marketplace_unidentified","duplicate","ignored","rejected","consumer_error","engine_error","engine_not_awaited","radar_monitoramento_inativo","fora_do_horario_monitoramento","sessao_whatsapp_nao_monitorada","grupo_whatsapp_nao_monitorado","whatsapp_upsert_historico","whatsapp_timestamp_ausente","radar_ativacao_invalida","whatsapp_mensagem_anterior_ativacao","whatsapp_mensagem_anterior_janela","remotejid_ausente","origem_tipo_invalida","grupo_ou_chat_ausente","captura_sem_tempo_factual","tamanho_maximo_atingido","usuario_inativo","workspace_mismatch"]);
const TARGET_GROUP_ID="120363408782037034@g.us",TARGET_SESSION_ID="admin_Zoiao Claro";
function createIngressBoundaryObservation({now=Date.now,setTimer=setTimeout,clearTimer=clearTimeout,secret=randomBytes(32)}={}) {
 let run=null,timer=null;const bindings=new Map();
 const ref=(kind,value)=>createHmac("sha256",secret).update(`${kind}:${value}`).digest("hex").slice(0,16);
 const safe=fn=>{try{fn();}catch{/* diagnostic never changes dispatch */}};
 function stop(reason="manual") {
  if(!run?.active)return status();run.active=false;run.finishedAt=now();run.reason=reason;
  if(timer)clearTimer(timer);timer=null;
  for(const b of bindings.values())for(const [name,pair]of Object.entries(b.originals))safe(()=>{if(b.ev[name]===pair.wrapped)b.ev[name]=pair.original;});
  for(const b of bindings.values())safe(()=>{if(b.wsOriginal&&b.ws.emit===b.wsOriginal.wrapped)b.ws.emit=b.wsOriginal.original;});
  bindings.clear();return status();
 }
 function active(){if(run?.active&&now()>=run.expiresAt)stop("expired");return run?.active===true;}
 function add(b,kind){if(run.records.length<MAX_RECORDS)run.records.push({at:now(),generation:b.generation,kind});else run.recordsDropped++;}
 function buffering(b){let value=null;try{if(typeof b.ev.isBuffering==="function")value=b.ev.isBuffering()===true;}catch{}
  if(value!==b.buffering){if(b.buffering!==null){b.counters.bufferTransitions++;add(b,value?"buffer_active":"buffer_released");}b.buffering=value;}return value;}
 function physical(b){const entry=b.sock.__optimusListeners?.["messages.upsert"];
  if(!entry||entry.emissor!==b.ev)return {state:"ABSENT_OR_REGISTRY_MISMATCH",evidence:"application_registry"};
  try{if(typeof b.ev.listeners==="function")return {state:b.ev.listeners("messages.upsert").includes(entry.handler)?"ATTACHED":"ABSENT",evidence:"native_introspection"};}catch{}
  if(b.added.has(entry.handler))return {state:"ATTACHED",evidence:"observed_public_registration"};
  if(b.removed.has(entry.handler)||b.removedAll)return {state:"ABSENT",evidence:"observed_public_removal"};
  if(b.invoked)return {state:"ATTACHED",evidence:"wrapper_invocation"};
  return {state:"UNKNOWN",evidence:"private_emitter_no_history"};
 }
 function messageStage(kind,{sock,emitter,sessionId,workspaceId,message,reason}={}) {
  if(!active())return;
  const b=bindings.get(emitter||sock?.ev);
  if(!b||sessionId!==run.sessionId||workspaceId!==undefined&&workspaceId!==run.workspaceId)return;
  if(!message||message.key?.remoteJid!==run.groupId)return;
  const id=message.key?.id;
  if(typeof id!=="string"||!id||id.length>200){run.unkeyed++;return;}
  const messageRef=ref("message",id);let row=run.messages.get(messageRef);
  if(!row){if(run.messages.size>=MAX_MESSAGES){stop("message_limit");return;}
   row={messageRef,fromMe:typeof message.key.fromMe==="boolean"?message.key.fromMe:null,stages:[]};run.messages.set(messageRef,row);}
  if(row.stages.length>=12){run.stagesDropped++;return;}
  const safeReason=REASONS.has(reason)?reason:reason?"other":"";
  row.stages.push({at:now(),generation:b.generation,kind,...(safeReason?{reason:safeReason}:{})});
 }
 function packetStage(kind,ctx,packet){
  if(!active()||!Array.isArray(packet?.messages))return;
  if(packet.messages.length>64)run.batchesTruncated++;
  for(const message of packet.messages.slice(0,64))safe(()=>messageStage(kind,{...ctx,message}));
 }
 function trackSocket({workspaceId,sessionId,generation,sock}={}) {
  if(!active()||sessionId!==run.sessionId||workspaceId!==run.workspaceId)return false;
  if(!sock?.ev||!Number.isSafeInteger(generation)||generation<1)return false;
  if(bindings.has(sock.ev))return true;
  if(bindings.size>=MAX_GENERATIONS){stop("generation_limit");return false;}
  const b={sock,ev:sock.ev,generation,buffering:null,added:new Set(),removed:new Set(),removedAll:false,invoked:false,originals:{},counters:{wsMessages:0,decodedFrames:0,messageNodes:0,wsOpens:0,wsCloses:0,emitAttempts:0,emitCompleted:0,emitErrors:0,bufferedAttempts:0,bufferedAccepted:0,wrapperCalls:0,callbackCalls:0,radarEntries:0,earlyReturns:0,sessionMismatch:0,workspaceMismatch:0,staleSocket:0,bufferTransitions:0,removals:0}};
  bindings.set(b.ev,b);run.generations.push(b);run.current=b;add(b,"socket_current");buffering(b);
  for(const name of ["emit","on","off","removeAllListeners","buffer","flush"]){
   const original=b.ev[name];if(typeof original!=="function")continue;
   const wrapped=function(...args){
    const observing=active()&&bindings.get(b.ev)===b;
    let wasBuffered=false;
    if(observing)safe(()=>{
     if(name==="emit"&&args[0]==="messages.upsert"){b.counters.emitAttempts++;packetStage("emit_attempt",{sock,emitter:b.ev,workspaceId,sessionId},args[1]);if(buffering(b)){b.counters.bufferedAttempts++;wasBuffered=true;}run.calls++;if(run.calls>=MAX_CALLS)stop("call_limit");}
    });
    // Native return, thrown error, receiver and arguments are preserved exactly.
    let result,completed=false;try{result=Reflect.apply(original,this,args);completed=true;}finally{
     if(observing&&active())safe(()=>{
      if(name==="emit"&&args[0]==="messages.upsert"){if(completed){packetStage("emit_completed",{sock,emitter:b.ev,workspaceId,sessionId},args[1]);b.counters.emitCompleted++;if(wasBuffered)b.counters.bufferedAccepted++;}else b.counters.emitErrors++;}
      if(!completed)return;
      if(name==="on"&&args[0]==="messages.upsert"&&b.added.size<8){b.added.add(args[1]);b.removed.delete(args[1]);add(b,"listener_registered");}
      if(name==="off"&&args[0]==="messages.upsert"){b.added.delete(args[1]);if(b.removed.size<8)b.removed.add(args[1]);b.counters.removals++;add(b,"listener_removed");}
      if(name==="removeAllListeners"&&(args[0]===undefined||args[0]==="messages.upsert")){b.added.clear();b.removedAll=true;b.counters.removals++;add(b,"listeners_removed");}
      buffering(b);
     });
    }return result;
   };
   try{b.ev[name]=wrapped;if(b.ev[name]===wrapped)b.originals[name]={original,wrapped};}catch{}
  }
  // Observe public socket dispatch without subscribing or reading packet arguments.
  const ws=b.sock.ws;
  if(ws&&typeof ws.emit==="function"){
   const original=ws.emit;
   const wrapped=function(...args){if(active()&&bindings.get(b.ev)===b)safe(()=>{
    const counter={message:"wsMessages",frame:"decodedFrames","CB:message":"messageNodes",open:"wsOpens",close:"wsCloses"}[args[0]];
    if(counter&&Object.hasOwn(b.counters,counter))b.counters[counter]++;
   });return Reflect.apply(original,this,args);};
   try{ws.emit=wrapped;if(ws.emit===wrapped){b.ws=ws;b.wsOriginal={original,wrapped};}}catch{}
  }
  return true;
 }
 function mark(kind,{sock,emitter,workspaceId,sessionId,current,reason,message,messages}={}){
  if(!active())return;const b=bindings.get(emitter||sock?.ev);if(!b)return;
  if(sessionId!==run.sessionId)b.counters.sessionMismatch++;
  if(workspaceId!==undefined&&workspaceId!==run.workspaceId)b.counters.workspaceMismatch++;
  if(current===false)b.counters.staleSocket++;
  if(kind==="wrapper"){b.counters.wrapperCalls++;b.invoked=true;}
  if(kind==="callback")b.counters.callbackCalls++;
  if(kind==="radar")b.counters.radarEntries++;
  if(kind==="early"){b.counters.earlyReturns++;add(b,["socket_stale","user_inactive","buffer_recovery_suppressed"].includes(reason)?reason:"early_other");}
  if(kind==="callback")packetStage("callback",{sock,emitter:b.ev,workspaceId,sessionId},{messages});
  if(kind==="early"&&messages)packetStage("early",{sock,emitter:b.ev,workspaceId,sessionId,reason},{messages});
  if(message)safe(()=>messageStage(({listener:"listener",radar:"radar_entry",result:"radar_result",early:"early"})[kind]||"other",{sock,emitter:b.ev,workspaceId,sessionId,message,reason}));
  buffering(b);
 }
 function snapshot(b){const buffered=buffering(b),c={...b.counters},p=physical(b);return {generation:b.generation,isCurrent:run.current===b,buffering:buffered,listener:p,socketCoverage:b.wsOriginal?"public_emit_observed":"unavailable",counters:c,
  distinction:c.wrapperCalls?c.callbackCalls?c.radarEntries?"radar_reached":c.earlyReturns?"early_return_observed":"callback_without_radar":"wrapper_without_callback":c.emitAttempts?c.emitCompleted>0&&c.bufferedAccepted===c.emitCompleted&&!c.emitErrors&&b.buffering?"buffer_retained_observed":p.state==="ABSENT"?"listener_absent_observed":"emit_without_wrapper_unknown":"no_upsert_emit_observed_not_transport_proof"};}
 function status(){
  if(run?.active&&now()>=run.expiresAt)stop("expired");
  if(run&&!run.active&&now()-run.finishedAt>=RETENTION_MS)run=null;
  if(!run)return {state:"off"};
  return {state:run.active?"active":"stopped",startedAt:run.startedAt,expiresAt:run.expiresAt,finishedAt:run.finishedAt||null,reason:run.reason||"",scope:{sessionRef:ref("session",run.sessionId),workspaceRef:ref("workspace",run.workspaceId),groupRef:ref("group",run.groupId)},generations:run.active?run.generations.map(snapshot):run.finalSnapshots||[],records:run.records.map(x=>({...x})),recordsDropped:run.recordsDropped,messages:[...run.messages.values()].map(x=>({...x,stages:x.stages.map(s=>({...s}))})),unkeyed:run.unkeyed,stagesDropped:run.stagesDropped,batchesTruncated:run.batchesTruncated,limits:{durationMs:MAX_MS,calls:MAX_CALLS,generations:MAX_GENERATIONS,records:MAX_RECORDS,messages:MAX_MESSAGES},coverage:"Session-only aggregate public socket counts; target-group key metadata at public upsert/callback. No packet content, participants, private emitter introspection or transport-delivery proof."};
 }
 function start({workspaceId,sessionId,sock,generation,groupId,scopeValidated=false}={}){
  if(active()||run)return {ok:false,reason:"observation_exists"};
  if(scopeValidated!==true||workspaceId!=="admin"||sessionId!==TARGET_SESSION_ID||groupId!==TARGET_GROUP_ID||!sock?.ev||!Number.isSafeInteger(generation)||generation<1)return {ok:false,reason:"target_unverified"};
  const at=now();run={active:true,workspaceId,sessionId,groupId,messages:new Map(),unkeyed:0,stagesDropped:0,batchesTruncated:0,startedAt:at,expiresAt:at+MAX_MS,records:[],recordsDropped:0,generations:[],calls:0};
  trackSocket({workspaceId,sessionId,sock,generation});timer=setTimer(()=>stop("expired"),MAX_MS);timer?.unref?.();return {ok:true,...status()};
 }
 // Preserve immutable snapshots before releasing socket references on stop.
 const finish=stop;
 stop=function(reason="manual"){if(run?.active)run.finalSnapshots=run.generations.map(snapshot);const result=finish(reason);if(run&&!run.active){run.generations=[];run.current=null;}return result;};
 return Object.freeze({start,stop,status,trackSocket,mark});
}
module.exports={createIngressBoundaryObservation,MAX_MS,MAX_CALLS,MAX_RECORDS,MAX_GENERATIONS,MAX_MESSAGES,TARGET_GROUP_ID,TARGET_SESSION_ID};
