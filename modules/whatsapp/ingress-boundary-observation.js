"use strict";
const {randomBytes,createHmac}=require("node:crypto");
const MAX_MS=300000,NEXT_BOOTSTRAP_ARM_MS=86400000,NEXT_BOOTSTRAP_CAPTURE_MS=1800000,MAX_CALLS=1000,MAX_RECORDS=64,MAX_GENERATIONS=4,RETENTION_MS=900000,MAX_MESSAGES=10,MAX_BOOTSTRAP_SIGNALS=1000;
const REASONS=new Set(["socket_stale","user_inactive","buffer_recovery_suppressed","from_me","not_group","accepted","mensagem_nao_monitoravel","other","group_not_monitored","stale_message","wrong_upsert_type","no_links","marketplace_unidentified","duplicate","ignored","rejected","consumer_error","engine_error","engine_not_awaited","radar_monitoramento_inativo","fora_do_horario_monitoramento","sessao_whatsapp_nao_monitorada","grupo_whatsapp_nao_monitorado","whatsapp_upsert_historico","whatsapp_timestamp_ausente","radar_ativacao_invalida","whatsapp_mensagem_anterior_ativacao","whatsapp_mensagem_anterior_janela","remotejid_ausente","origem_tipo_invalida","grupo_ou_chat_ausente","captura_sem_tempo_factual","tamanho_maximo_atingido","usuario_inativo","workspace_mismatch"]);
const TARGET_GROUP_ID="120363408782037034@g.us",TARGET_SESSION_ID="admin_Zoiao Claro";
// Categories describe the public stanza tag, not its private content/purpose.
const CONTROL_TAGS=new Set(["iq","ack","receipt","notification","presence","chatstate","call"]);
const SYNC_TAGS=new Set(["ib","success"]);
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
 function active(){if(run?.active&&now()>=run.expiresAt)stop(run.phase==="armed"?"arm_expired":run.mode==="next_bootstrap"?"capture_window_expired":"expired");return run?.active===true;}
 function scheduleStop(duration){if(timer)clearTimer(timer);timer=setTimer(()=>stop(run?.phase==="armed"?"arm_expired":run?.mode==="next_bootstrap"?"capture_window_expired":"expired"),duration);timer?.unref?.();}
 function add(b,kind){if(run.records.length<MAX_RECORDS)run.records.push({at:now(),generation:b.generation,kind});else run.recordsDropped++;}
 const bootstrapReasons=new Set(["socket_initial_bootstrap","initial_sync_started","process_node","process_node_complete","offline_completion","history_sync_skipped","app_state_sync_complete","history_sync_disabled","initial_sync_timeout","deferred_work_complete","unspecified"]);
 const flushReasons=new Set(["offline_completion","history_sync_skipped","app_state_sync_complete","history_sync_disabled","initial_sync_timeout","process_node_complete","deferred_work_complete","servcel_initial_timeout_recovery","unspecified"]);
 const syncStates=new Set(["Connecting","AwaitingInitialSync","Syncing","Online"]);
 function newBootstrap(generation){return {generation,observations:0,truncated:false,records:[],recordsDropped:0,
  offlineBatch:{previewReceived:0,requestsStarted:0,requestsSent:0,requestSendFailures:0,completionSignals:0,connectionFailureSignals:0,state:"NOT_OBSERVED"},
  offlineAttribute:{absent:0,"0":0,"1":0,other:0},
  offlineTasks:{queued:0,started:0,completed:0,errors:0,pending:0},
  synchronization:{state:"NOT_OBSERVED",transitions:0},
  buffer:{buffering:null,explicitHold:null,pendingWorks:null,transitions:0,flushesByReason:{}},
  delivery:{wrapperCalls:0,callbackCalls:0,radarEntries:0}};}
 function getBootstrap(generation){let row=run?.bootstrapGenerations?.get(generation);if(!row&&run){row=newBootstrap(generation);run.bootstrapGenerations.set(generation,row);}return row||null;}
 function bootstrapObserver({workspaceId,sessionId,generation}={}){
  if(!active()||workspaceId!==run.workspaceId||sessionId!==run.sessionId||workspaceId!=="admin"||sessionId!==TARGET_SESSION_ID||!Number.isSafeInteger(generation)||generation<1)return null;
  if(run.mode==="next_bootstrap"){
   if(run.phase==="armed"){
    if(generation<=run.armedAfterGeneration)return null;
    run.phase="capturing";run.captureGeneration=generation;run.captureStartedAt=now();run.expiresAt=run.captureStartedAt+NEXT_BOOTSTRAP_CAPTURE_MS;scheduleStop(NEXT_BOOTSTRAP_CAPTURE_MS);
   }else if(run.phase!=="capturing"||run.captureGeneration!==generation)return null;
  }
  const owner=run,row=getBootstrap(generation);
  const record=(kind,fields={})=>safe(()=>{
   if(!active()||run!==owner||!owner.active)return;
   if(row.observations>=MAX_BOOTSTRAP_SIGNALS){row.truncated=true;return;}
   row.observations++;
   const entry={at:now(),generation,kind,...fields};
   if(row.records.length<MAX_RECORDS)row.records.push(entry);else row.recordsDropped++;
  });
  return Object.freeze({
   offlineBatch(kind){if(!active()||run!==owner||!["preview_received","request_started","request_sent","request_send_failed","completion_signal","connection_failure"].includes(kind))return;record("offline_batch",{stage:kind});if(kind==="preview_received")row.offlineBatch.previewReceived++;if(kind==="request_started"){row.offlineBatch.requestsStarted++;row.offlineBatch.state="STARTED";}if(kind==="request_sent")row.offlineBatch.requestsSent++;if(kind==="request_send_failed"){row.offlineBatch.requestSendFailures++;row.offlineBatch.state="SEND_FAILED";}if(kind==="completion_signal"){row.offlineBatch.completionSignals++;row.offlineBatch.state="COMPLETION_RECEIVED";}if(kind==="connection_failure"){row.offlineBatch.connectionFailureSignals++;if(row.offlineBatch.state==="STARTED")row.offlineBatch.state="CONNECTION_FAILURE_OBSERVED";}},
   offlineAttribute(value){if(!active()||run!==owner)return;const key=value==="absent"?"absent":value==="0"?"0":value==="1"?"1":"other";record("offline_attribute",{class:key});row.offlineAttribute[key]++;},
   offlineTask(kind){if(!active()||run!==owner||!["queued","started","completed","failed"].includes(kind))return;record("offline_task",{stage:kind});if(kind==="queued"){row.offlineTasks.queued++;row.offlineTasks.pending++;}if(kind==="started")row.offlineTasks.started++;if(kind==="completed"){row.offlineTasks.completed++;row.offlineTasks.pending=Math.max(0,row.offlineTasks.pending-1);}if(kind==="failed"){row.offlineTasks.errors++;row.offlineTasks.pending=Math.max(0,row.offlineTasks.pending-1);}},
   syncState(value){if(!active()||run!==owner||!syncStates.has(value))return;if(row.synchronization.state!==value){row.synchronization.state=value;row.synchronization.transitions++;record("sync_state",{state:value});}},
   recordBufferObservation(event){if(!active()||run!==owner||!event||typeof event!=="object")return;const kind=["buffer_requested","flush_requested","flush_completed","work_started","work_completed"].includes(event.kind)?event.kind:"other";const reason=bootstrapReasons.has(event.reason)?event.reason:"unspecified";const buffering=typeof event.buffering==="boolean"?event.buffering:null;const explicitHold=typeof event.explicitHold==="boolean"?event.explicitHold:null;const pendingWorks=Number.isSafeInteger(event.pendingWorks)&&event.pendingWorks>=0?Math.min(event.pendingWorks,1000000):null;const b=row.buffer;if(b.buffering!==buffering||b.explicitHold!==explicitHold||b.pendingWorks!==pendingWorks)b.transitions++;b.buffering=buffering;b.explicitHold=explicitHold;b.pendingWorks=pendingWorks;if(kind==="flush_requested"){b.flushesByReason[reason]=Math.min(1000000,(b.flushesByReason[reason]||0)+1);}record("buffer_state",{operation:kind,reason,buffering,explicitHold,pendingWorks});}
  });
 }
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
 function targetNode(node){
  const attrs=node&&typeof node==="object"?Object.getOwnPropertyDescriptor(node,"attrs")?.value:null;
  const from=attrs&&typeof attrs==="object"?Object.getOwnPropertyDescriptor(attrs,"from")?.value:undefined;
  return typeof from==="string"?from===run.groupId:null;
 }
 function observeFrame(b,frame){
  if(ArrayBuffer.isView(frame)||frame instanceof ArrayBuffer){b.counters.binaryFrames++;return;}
  // Plain tag plus equality of approved group routing only. No content/getters.
  let tag;
  try{tag=frame&&typeof frame==="object"?Object.getOwnPropertyDescriptor(frame,"tag")?.value:undefined;}
  catch{b.counters.frameMetadataUnavailable++;}
  const kind=tag==="message"?"messageFrames":CONTROL_TAGS.has(tag)?"controlFrames":SYNC_TAGS.has(tag)?"syncFrames":"otherFrames";
  b.counters[kind]++;
  if(kind==="messageFrames")safe(()=>{const target=targetNode(frame);if(target===true)b.counters.targetMessageFrames++;if(target===null)b.counters.messageFramesUnattributed++;});
 }
 function trackSocket({workspaceId,sessionId,generation,sock}={}) {
  if(!active()||sessionId!==run.sessionId||workspaceId!==run.workspaceId)return false;
  if(run.mode==="next_bootstrap"&&(run.phase!=="capturing"||run.captureGeneration!==generation))return false;
  if(!sock?.ev||!Number.isSafeInteger(generation)||generation<1)return false;
  if(bindings.has(sock.ev))return true;
  if(bindings.size>=MAX_GENERATIONS){stop("generation_limit");return false;}
  const b={sock,ev:sock.ev,generation,buffering:null,lastSyncSignal:"NOT_OBSERVED",bootstrap:getBootstrap(generation),added:new Set(),removed:new Set(),removedAll:false,invoked:false,originals:{},counters:{wsMessages:0,decodedFrames:0,messageNodes:0,wsOpens:0,wsCloses:0,messageFrames:0,controlFrames:0,syncFrames:0,otherFrames:0,binaryFrames:0,frameMetadataUnavailable:0,socketErrorEvents:0,streamErrorEvents:0,publicDispatchThrows:0,emitAttempts:0,emitCompleted:0,emitErrors:0,bufferedAttempts:0,bufferedAccepted:0,wrapperCalls:0,callbackCalls:0,radarEntries:0,earlyReturns:0,sessionMismatch:0,workspaceMismatch:0,staleSocket:0,bufferTransitions:0,removals:0}};
  Object.assign(b.counters,{wsBinaryMessages:0,targetMessageFrames:0,targetMessageNodes:0,messageFramesUnattributed:0,frameDispatchThrows:0,messageDispatchThrows:0});
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
  // Existing public dispatch only; fixed tag metadata, never raw packet contents.
  const ws=b.sock.ws;
  if(ws&&typeof ws.emit==="function"){
   const original=ws.emit;
   const wrapped=function(...args){const observing=active()&&bindings.get(b.ev)===b;if(observing)safe(()=>{
    const counter={message:"wsMessages",frame:"decodedFrames","CB:message":"messageNodes",open:"wsOpens",close:"wsCloses",error:"socketErrorEvents","CB:stream:error":"streamErrorEvents"}[args[0]];
    if(counter&&Object.hasOwn(b.counters,counter))b.counters[counter]++;
    if(args[0]==="frame")observeFrame(b,args[1]);
    if(args[0]==="message"&&(ArrayBuffer.isView(args[1])||args[1] instanceof ArrayBuffer))b.counters.wsBinaryMessages++;
    if(args[0]==="CB:message"&&targetNode(args[1])===true)b.counters.targetMessageNodes++;
    if(args[0]==="CB:success")b.lastSyncSignal="AUTHENTICATED";
    if(args[0]==="CB:ib,,offline")b.lastSyncSignal="OFFLINE_COMPLETION_DISPATCHED";
   });try{return Reflect.apply(original,this,args);}catch(error){if(observing&&active())safe(()=>{b.counters.publicDispatchThrows++;if(args[0]==="frame")b.counters.frameDispatchThrows++;if(args[0]==="CB:message")b.counters.messageDispatchThrows++;});throw error;}};
   try{ws.emit=wrapped;if(ws.emit===wrapped){b.ws=ws;b.wsOriginal={original,wrapped};}}catch{}
  }
  return true;
 }
 function mark(kind,{sock,emitter,workspaceId,sessionId,current,reason,message,messages}={}){
  if(!active())return;const b=bindings.get(emitter||sock?.ev);if(!b)return;
  if(sessionId!==run.sessionId)b.counters.sessionMismatch++;
  if(workspaceId!==undefined&&workspaceId!==run.workspaceId)b.counters.workspaceMismatch++;
  if(current===false)b.counters.staleSocket++;
  if(kind==="wrapper"){b.counters.wrapperCalls++;b.invoked=true;if(b.bootstrap)b.bootstrap.delivery.wrapperCalls++;}
  if(kind==="callback"){b.counters.callbackCalls++;if(b.bootstrap)b.bootstrap.delivery.callbackCalls++;}
  if(kind==="radar"){b.counters.radarEntries++;if(b.bootstrap)b.bootstrap.delivery.radarEntries++;}
  if(kind==="early"){b.counters.earlyReturns++;add(b,["socket_stale","user_inactive","buffer_recovery_suppressed"].includes(reason)?reason:"early_other");}
  if(kind==="callback")packetStage("callback",{sock,emitter:b.ev,workspaceId,sessionId},{messages});
  if(kind==="early"&&messages)packetStage("early",{sock,emitter:b.ev,workspaceId,sessionId,reason},{messages});
  if(message)safe(()=>messageStage(({listener:"listener",radar:"radar_entry",result:"radar_result",early:"early"})[kind]||"other",{sock,emitter:b.ev,workspaceId,sessionId,message,reason}));
  buffering(b);
 }
 function snapshot(b){const buffered=buffering(b),c={...b.counters},p=physical(b);let messageReceiver="UNKNOWN";safe(()=>{if(typeof b.sock.ws?.listenerCount==="function")messageReceiver=b.sock.ws.listenerCount("CB:message")>0?"PRESENT":"ABSENT";});return {generation:b.generation,isCurrent:run.current===b,buffering:buffered,listener:p,socketCoverage:b.wsOriginal?"public_emit_observed":"unavailable",counters:c,bootstrap:b.bootstrap?{...b.bootstrap,offlineBatch:{...b.bootstrap.offlineBatch},offlineAttribute:{...b.bootstrap.offlineAttribute},offlineTasks:{...b.bootstrap.offlineTasks},synchronization:{...b.bootstrap.synchronization},buffer:{...b.bootstrap.buffer,flushesByReason:{...b.bootstrap.buffer.flushesByReason}},delivery:{...b.bootstrap.delivery},records:b.bootstrap.records.map(x=>({...x}))}:null,
  messageReceiver,synchronization:{lastPublicSignal:b.lastSyncSignal,pendingNotificationsObserved:typeof b.sock.__optimusMessengerLiveReady==="boolean"?b.sock.__optimusMessengerLiveReady:null,initialSyncState:"UNAVAILABLE_PUBLIC_INTERFACE"},failureCoverage:{decodeFailures:null,decryptFailures:null,reason:"no_dedicated_public_failure_event; socket/stream errors and dispatch throws are distinct"},
  distinction:c.wrapperCalls?c.callbackCalls?c.radarEntries?"radar_reached":c.earlyReturns?"early_return_observed":"callback_without_radar":"wrapper_without_callback":c.emitAttempts?c.emitCompleted>0&&c.bufferedAccepted===c.emitCompleted&&!c.emitErrors&&b.buffering?"buffer_retained_observed":p.state==="ABSENT"?"listener_absent_observed":"emit_without_wrapper_unknown":"no_upsert_emit_observed_not_transport_proof"};}
 function status(){
  if(run?.active&&now()>=run.expiresAt)stop(run.phase==="armed"?"arm_expired":run.mode==="next_bootstrap"?"capture_window_expired":"expired");
  if(run&&!run.active&&now()-run.finishedAt>=RETENTION_MS)run=null;
  if(!run)return {state:"off"};
  const state=run.active?(run.mode==="next_bootstrap"&&run.phase==="armed"?"armed":"active"):"stopped";
  return {state,startedAt:run.startedAt,expiresAt:run.expiresAt,finishedAt:run.finishedAt||null,reason:run.reason||"",capture:run.mode==="next_bootstrap"?{mode:run.mode,phase:run.phase,armedAfterGeneration:run.armedAfterGeneration,observedGeneration:run.captureGeneration||null,captureStartedAt:run.captureStartedAt||null}:{mode:"current_window"},scope:{sessionRef:ref("session",run.sessionId),workspaceRef:ref("workspace",run.workspaceId),groupRef:ref("group",run.groupId)},generations:run.active?run.generations.map(snapshot):run.finalSnapshots||[],records:run.records.map(x=>({...x})),recordsDropped:run.recordsDropped,messages:[...run.messages.values()].map(x=>({...x,stages:x.stages.map(s=>({...s}))})),unkeyed:run.unkeyed,stagesDropped:run.stagesDropped,batchesTruncated:run.batchesTruncated,limits:{durationMs:run.mode==="next_bootstrap"?(run.phase==="armed"?NEXT_BOOTSTRAP_ARM_MS:NEXT_BOOTSTRAP_CAPTURE_MS):MAX_MS,calls:MAX_CALLS,generations:MAX_GENERATIONS,records:MAX_RECORDS,messages:MAX_MESSAGES,armWaitMs:run.mode==="next_bootstrap"?NEXT_BOOTSTRAP_ARM_MS:0,captureAfterGenerationMs:run.mode==="next_bootstrap"?NEXT_BOOTSTRAP_CAPTURE_MS:0},coverage:"Session-only aggregate public socket counts; target-group key metadata at public upsert/callback. No packet content, participants, private emitter introspection or transport-delivery proof."};
 }
 function start({workspaceId,sessionId,sock,generation,groupId,scopeValidated=false,mode="current_window"}={}){
  if(active()||run)return {ok:false,reason:"observation_exists"};
  if(!["current_window","next_bootstrap"].includes(mode)||scopeValidated!==true||workspaceId!=="admin"||sessionId!==TARGET_SESSION_ID||groupId!==TARGET_GROUP_ID||!sock?.ev||!Number.isSafeInteger(generation)||generation<1)return {ok:false,reason:"target_unverified"};
  const at=now(),duration=mode==="next_bootstrap"?NEXT_BOOTSTRAP_ARM_MS:MAX_MS;run={active:true,mode,phase:mode==="next_bootstrap"?"armed":"capturing",armedAfterGeneration:generation,captureGeneration:mode==="current_window"?generation:null,captureStartedAt:mode==="current_window"?at:null,workspaceId,sessionId,groupId,messages:new Map(),unkeyed:0,stagesDropped:0,batchesTruncated:0,startedAt:at,expiresAt:at+duration,records:[],recordsDropped:0,generations:[],bootstrapGenerations:new Map(),calls:0};
  if(mode==="current_window")trackSocket({workspaceId,sessionId,sock,generation});scheduleStop(duration);return {ok:true,...status()};
 }
 // Preserve immutable snapshots before releasing socket references on stop.
 const finish=stop;
 stop=function(reason="manual"){if(run?.active)run.finalSnapshots=run.generations.map(snapshot);const result=finish(reason);if(run&&!run.active){run.generations=[];run.current=null;}return result;};
 return Object.freeze({start,stop,status,trackSocket,mark,bootstrapObserver});
}
module.exports={createIngressBoundaryObservation,MAX_MS,NEXT_BOOTSTRAP_ARM_MS,NEXT_BOOTSTRAP_CAPTURE_MS,MAX_CALLS,MAX_RECORDS,MAX_GENERATIONS,MAX_MESSAGES,MAX_BOOTSTRAP_SIGNALS,TARGET_GROUP_ID,TARGET_SESSION_ID};
