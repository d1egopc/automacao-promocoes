"use strict";
const {randomBytes,createHmac}=require("node:crypto");
const {sanitizarTraceRef}=require("../telemetria/trace-ref");
const MAX_MS=300000,NEXT_BOOTSTRAP_ARM_MS=86400000,NEXT_BOOTSTRAP_CAPTURE_MS=1800000,MAX_CALLS=1000,MAX_RECORDS=64,MAX_GENERATIONS=4,RETENTION_MS=900000,MAX_MESSAGES=10,MAX_BOOTSTRAP_SIGNALS=1000,MAX_CONTINUOUS_GENERATIONS=512,MAX_CONTINUOUS_MESSAGES=500,MAX_BOOTSTRAP_ROWS=512,MAX_GROUP_ROWS=512;
const REASONS=new Set(["socket_stale","user_inactive","buffer_recovery_suppressed","from_me","not_group","accepted","mensagem_nao_monitoravel","other","group_not_monitored","stale_message","wrong_upsert_type","no_links","marketplace_unidentified","duplicate","ignored","rejected","consumer_error","engine_error","engine_not_awaited","radar_monitoramento_inativo","fora_do_horario_monitoramento","sessao_whatsapp_nao_monitorada","grupo_whatsapp_nao_monitorado","whatsapp_upsert_historico","whatsapp_timestamp_ausente","radar_ativacao_invalida","whatsapp_mensagem_anterior_ativacao","whatsapp_mensagem_anterior_janela","remotejid_ausente","origem_tipo_invalida","grupo_ou_chat_ausente","captura_sem_tempo_factual","tamanho_maximo_atingido","usuario_inativo","workspace_mismatch"]);
const TARGET_GROUP_ID="120363408782037034@g.us",TARGET_SESSION_ID="admin_Zoiao Claro";
const MAX_CONTINUOUS_SCOPES=512,MAX_GROUP_IDS_PER_SCOPE=128;
const WORKSPACE_ID=/^[\w-]{1,100}$/;
const SESSION_ID=/^[^\u0000-\u001f\u007f]{1,150}$/;
const GROUP_ID=/^[A-Za-z0-9_:-]{1,100}@g\.us$/;
const INGRESS_GROUP_CARDS=Object.freeze(["groupManager","commands","welcome","farewell"]);
function exactGroupId(value){
 const candidates=typeof value==="string"||typeof value==="number"?[value]:
  value&&typeof value==="object"?[value.remoteJid,value.grupoId,value.jid,value.chatId,value.value,value.id]:[];
 for(const candidate of candidates){if(typeof candidate!=="string"&&typeof candidate!=="number")continue;const id=String(candidate).trim();if(GROUP_ID.test(id))return id;}
 return "";
}
function resolveConfiguredObservationGroups({workspaceId,sessionId,sessionBelongsToWorkspace,sessionWorkspaceId,actualGroupIds,radarConfig,resolveRadarSessionId,messengerProfiles}={}){
 if(!WORKSPACE_ID.test(String(workspaceId||""))||!SESSION_ID.test(String(sessionId||""))||sessionBelongsToWorkspace!==true||
  sessionWorkspaceId&&sessionWorkspaceId!==workspaceId||!Array.isArray(actualGroupIds))return [];
 const actual=new Set(actualGroupIds.map(exactGroupId).filter(Boolean));if(!actual.size)return [];
 const groups=new Set();let tooManyGroups=false;
 const add=(value)=>{const id=exactGroupId(value);if(!id||!actual.has(id)||groups.has(id))return;if(groups.size>=MAX_GROUP_IDS_PER_SCOPE){tooManyGroups=true;return;}groups.add(id);};
 if(radarConfig?.monitoramentoAtivo===true){
  const configured=[];
  const sessionConfigs=Array.isArray(radarConfig.sessoesWhatsappMonitoradas)?radarConfig.sessoesWhatsappMonitoradas:[];
  for(const item of sessionConfigs){
   const input=String(item?.sessaoId||item?.sessionId||item?.id||"").trim();
   let resolved="";try{resolved=typeof resolveRadarSessionId==="function"?String(resolveRadarSessionId(input)||""):input;}catch{resolved="";}
   if(resolved===sessionId)configured.push(...(Array.isArray(item?.gruposMonitorados)?item.gruposMonitorados:[]));
  }
  let legacySession=String(radarConfig.sessaoWhatsappId||"").trim();
  try{if(legacySession&&typeof resolveRadarSessionId==="function")legacySession=String(resolveRadarSessionId(legacySession)||"");}catch{legacySession="";}
  if(!sessionConfigs.length&&legacySession===sessionId){
   for(const group of Array.isArray(radarConfig.gruposMonitorados)?radarConfig.gruposMonitorados:[])
    if(!String(group?.sessaoId||group?.origemSessaoId||group?.sessionId||"").trim()||String(group?.sessaoId||group?.origemSessaoId||group?.sessionId)===sessionId)configured.push(group);
  }
  for(const group of configured)if(group?.ativo!==false)add(group);
 }
 for(const profile of Array.isArray(messengerProfiles)?messengerProfiles:[]){
  if(profile?.workspaceId!==workspaceId||String(profile?.sessionId||"")!==sessionId||profile?.active!==true)continue;
  for(const cardName of INGRESS_GROUP_CARDS){
   const card=profile.cards?.[cardName];if(card?.active!==true)continue;
   const config=card.configuration&&typeof card.configuration==="object"?card.configuration:{};
   const own=Array.isArray(config.grupos)?config.grupos:Array.isArray(config.universal?.groups)?config.universal.groups:[];
   const selected=config.gruposConfigurados===true||own.length>0?own:Array.isArray(profile.destinations)?profile.destinations:[];
   for(const group of selected)add(group);
  }
 }
 return tooManyGroups?[]:[...groups];
}
// Categories describe the public stanza tag, not its private content/purpose.
const CONTROL_TAGS=new Set(["iq","ack","receipt","notification","presence","chatstate","call"]);
const SYNC_TAGS=new Set(["ib","success"]);
const UPDATES=new Set(["notify","append","replace","read","other"]);
const GROUP_COUNTERS=Object.freeze(["upsertNotify","upsertAppend","upsertOther","fromMeTrue","fromMeFalse","fromMeUnknown","buffered","emitCompleted","callback","listener","radar","radarAccepted","radarRejected","mensageiroGerente","mensageiroComando","mensageiroAtendimento"]);
function createIngressBoundaryObservation({now=Date.now,setTimer=setTimeout,clearTimer=clearTimeout,secret=randomBytes(32),journal=null,resolveContinuousScope=()=>({verified:false,groupIds:[]})}={}) {
 let run=null,timer=null;const bindings=new Map();
 const ref=(kind,value)=>createHmac("sha256",secret).update(`${kind}:${value}`).digest("hex").slice(0,16);
 const sessionReference=(workspaceId,sessionId)=>ref("session",run?.mode==="continuous"?`${workspaceId}:${sessionId}`:sessionId);
 const groupReference=(workspaceId,sessionId,groupId)=>ref("group",run?.mode==="continuous"?`${workspaceId}:${sessionId}:${groupId}`:groupId);
 const safe=fn=>{try{fn();}catch{/* diagnostic never changes dispatch */}};
 function stop(reason="manual") {
  if(!run?.active)return status();run.active=false;run.finishedAt=now();run.reason=reason;
  if(timer)clearTimer(timer);timer=null;
  for(const b of bindings.values())for(const [name,pair]of Object.entries(b.originals))safe(()=>{if(b.ev[name]===pair.wrapped)b.ev[name]=pair.original;});
  for(const b of bindings.values())safe(()=>{if(b.wsOriginal&&b.ws.emit===b.wsOriginal.wrapped)b.ws.emit=b.wsOriginal.original;});
  bindings.clear();return status();
 }
 function active(){if(run?.active&&run.mode!=="continuous"&&now()>=run.expiresAt)stop(run.phase==="armed"?"arm_expired":run.mode==="next_bootstrap"?"capture_window_expired":"expired");return run?.active===true;}
 function scheduleStop(duration){if(timer)clearTimer(timer);timer=setTimer(()=>stop(run?.phase==="armed"?"arm_expired":run?.mode==="next_bootstrap"?"capture_window_expired":"expired"),duration);timer?.unref?.();}
 function continuousScope(workspaceId,sessionId){
  if(run?.mode!=="continuous"||!WORKSPACE_ID.test(String(workspaceId||""))||!SESSION_ID.test(String(sessionId||"")))return null;
  const key=JSON.stringify([workspaceId,sessionId]);
  let resolved;try{resolved=resolveContinuousScope({workspaceId,sessionId});}catch{run.targets.delete(key);run.scopeCache.delete(key);return null;}
  const cached=run.scopeCache.get(key);
  if(cached?.resolved===resolved&&!(cached.capacity===true&&run.targets.size<MAX_CONTINUOUS_SCOPES)){run.scopeCache.delete(key);run.scopeCache.set(key,cached);return cached.scope;}
  if(cached?.capacity===true)run.scopeCache.delete(key);
  if(resolved?.verified!==true||!Array.isArray(resolved.groupIds)||resolved.groupIds.length>MAX_GROUP_IDS_PER_SCOPE){
   run.targets.delete(key);if(run.scopeCache.size>=MAX_CONTINUOUS_SCOPES*4)run.scopeCache.delete(run.scopeCache.keys().next().value);
   run.scopeCache.set(key,{resolved,scope:null});return null;
  }
  const groupIds=[...new Set(resolved.groupIds.map(exactGroupId).filter(Boolean))];
  let scope=null;
  if(groupIds.length&&run.targets.has(key)){const prior=run.targets.get(key);if(prior.groupIds.length!==groupIds.length||prior.groupIds.some((id,index)=>id!==groupIds[index]))run.targets.set(key,{workspaceId,sessionId,groupIds});}
  else if(groupIds.length){if(run.targets.size<MAX_CONTINUOUS_SCOPES)run.targets.set(key,{workspaceId,sessionId,groupIds});else {run.scopesDropped=Math.min(1000000,run.scopesDropped+1);if(run.scopeCache.size>=MAX_CONTINUOUS_SCOPES*4)run.scopeCache.delete(run.scopeCache.keys().next().value);run.scopeCache.set(key,{resolved,scope:null,capacity:true});return null;}}
  else run.targets.delete(key);
  if(groupIds.length)scope={workspaceId,sessionId,groupIds};
  if(run.scopeCache.size>=MAX_CONTINUOUS_SCOPES*4)run.scopeCache.delete(run.scopeCache.keys().next().value);
  run.scopeCache.set(key,{resolved,scope});return scope;
 }
 function targetFor(workspaceId,sessionId,groupId){
  if(!run)return null;
  if(run.mode!=="continuous")return workspaceId===run.workspaceId&&sessionId===run.sessionId&&(!groupId||groupId===run.groupId)?{workspaceId:run.workspaceId,sessionId:run.sessionId,groupIds:[run.groupId]}:null;
  const target=continuousScope(workspaceId,sessionId);
  if(!target||groupId&&(!String(groupId).endsWith("@g.us")||Array.isArray(target.groupIds)&&!target.groupIds.includes(groupId)))return null;
  return target;
 }
const JOURNAL_STAGE_MAP=Object.freeze({socket_current:"listener_registered",socket_replaced:"listener_removed",listener_registered:"listener_registered",listener_removed:"listener_removed",listeners_removed:"listener_removed",buffer_active:"buffer_state",buffer_released:"buffer_state",emit_attempt:"emit_attempt",emit_completed:"emit_completed",message_node:"message_node",callback:"callback",listener:"listener",radar_entry:"radar",radar_result:"radar_result",early:"listener_gate",mensageiro_gerente:"mensageiro_gerente",mensageiro_comando:"mensageiro_comando",mensageiro_atendimento:"mensageiro_atendimento"});
 function persist(b,{stage,groupId,messageId,traceRef,upsertType,fromMe,reason,decision,operation,offlineAttribute,syncState,count,buffering,explicitHold,pendingWorks}={}){
  if(run?.mode!=="continuous"||!journal?.append)return;
  const target=targetFor(b.workspaceId,b.sessionId,groupId);if(!target)return;
  const mapped=JOURNAL_STAGE_MAP[stage]||stage;
  safe(()=>journal.append({kind:["offline_batch","offline_attribute","offline_task","sync_state","buffer_state"].includes(mapped)?"bootstrap":mapped==="listener_registered"||mapped==="listener_removed"?"listener":mapped==="buffer_state"?"buffer":"stage",
    at:now(),stage:mapped,workspaceRef:ref("workspace",b.workspaceId),sessionRef:sessionReference(b.workspaceId,b.sessionId),groupRef:groupId?groupReference(b.workspaceId,b.sessionId,groupId):undefined,
    eventRef:messageId?ref("message",run.mode==="continuous"?`${b.workspaceId}:${b.sessionId}:${messageId}`:messageId):undefined,traceRef:sanitizarTraceRef(traceRef,{messageId}),generation:b.generation,upsertType,fromMe,reason,decision,operation,offlineAttribute,syncState,count,buffering,explicitHold,pendingWorks}));
 }
 function groupCounter(workspaceId,sessionId,groupId,key,amount=1){
  if(run?.mode!=="continuous"||!groupId||!GROUP_COUNTERS.includes(key)||!targetFor(workspaceId,sessionId,groupId))return;
  const mapKey=`${workspaceId}\0${sessionId}\0${groupId}`;let row=run.groupStats.get(mapKey);
  if(!row){if(run.groupStats.size>=MAX_GROUP_ROWS){run.groupsDropped++;return;}row={workspaceRef:ref("workspace",workspaceId),sessionRef:sessionReference(workspaceId,sessionId),groupRef:groupReference(workspaceId,sessionId,groupId),counts:Object.fromEntries(GROUP_COUNTERS.map(name=>[name,0]))};run.groupStats.set(mapKey,row);}
  row.counts[key]=Math.min(1000000,row.counts[key]+amount);row.lastAt=now();if(key==="upsertNotify"||key==="upsertAppend"||key==="upsertOther")row.lastIngressAt=row.lastAt;
 }
 function add(b,kind){if(run.records.length<MAX_RECORDS)run.records.push({at:now(),generation:b.generation,kind});else run.recordsDropped++;persist(b,{stage:kind});}
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
 function getBootstrap(generation,sessionId=run?.sessionId){const key=run?.mode==="continuous"?`${sessionId}:${generation}`:generation;let row=run?.bootstrapGenerations?.get(key);if(!row&&run){row=newBootstrap(generation);run.bootstrapGenerations.set(key,row);while(run.bootstrapGenerations.size>MAX_BOOTSTRAP_ROWS){run.bootstrapGenerations.delete(run.bootstrapGenerations.keys().next().value);run.bootstrapRowsDropped=Math.min(1000000,(run.bootstrapRowsDropped||0)+1);}}return row||null;}
 function bootstrapObserver({workspaceId,sessionId,generation}={}){
  if(!active()||!targetFor(workspaceId,sessionId)||!Number.isSafeInteger(generation)||generation<1)return null;
  if(run.mode!=="continuous"&&(workspaceId!=="admin"||sessionId!==TARGET_SESSION_ID))return null;
  if(run.mode==="next_bootstrap"){
   if(run.phase==="armed"){
    if(generation<=run.armedAfterGeneration)return null;
    run.phase="capturing";run.captureGeneration=generation;run.captureStartedAt=now();run.expiresAt=run.captureStartedAt+NEXT_BOOTSTRAP_CAPTURE_MS;scheduleStop(NEXT_BOOTSTRAP_CAPTURE_MS);
   }else if(run.phase!=="capturing"||run.captureGeneration!==generation)return null;
  }
  const owner=run,row=getBootstrap(generation,sessionId);
  const record=(kind,fields={})=>safe(()=>{
   if(!active()||run!==owner||!owner.active)return;
   if(row.observations>=MAX_BOOTSTRAP_SIGNALS){row.truncated=true;return;}
   row.observations++;
   const entry={at:now(),generation,kind,...fields};
   if(row.records.length<MAX_RECORDS)row.records.push(entry);else row.recordsDropped++;
   const stage=kind==="offline_batch"?"offline_batch":kind==="offline_attribute"?"offline_attribute":kind==="offline_task"?"offline_task":kind==="sync_state"?"sync_state":"buffer_state";
   persist({workspaceId,sessionId,generation},{stage,groupId:fields.groupId,operation:fields.stage,offlineAttribute:fields.class,syncState:fields.state,
    reason:fields.reason,buffering:fields.buffering,explicitHold:fields.explicitHold,pendingWorks:fields.pendingWorks});
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
 function messageStage(kind,{sock,emitter,sessionId,workspaceId,message,reason,upsertType,decision,buffering:bufferState,traceRef}={}) {
  if(!active())return;
  const b=bindings.get(emitter||sock?.ev);
  if(!b||sessionId!==b.sessionId||workspaceId!==undefined&&workspaceId!==b.workspaceId)return;
  const groupId=message?.key?.remoteJid;
  if(!message||!targetFor(b.workspaceId,b.sessionId,groupId))return;
  const id=message.key?.id;
  if(typeof id!=="string"||!id||id.length>200){run.unkeyed++;return;}
  const messageRef=ref("message",run.mode==="continuous"?`${b.workspaceId}:${b.sessionId}:${id}`:id);let row=run.messages.get(messageRef);
  if(!row){const limit=run.mode==="continuous"?MAX_CONTINUOUS_MESSAGES:MAX_MESSAGES;if(run.messages.size>=limit){if(run.mode!=="continuous"){stop("message_limit");return;}run.messages.delete(run.messages.keys().next().value);run.stagesDropped++;}
  row={messageRef,traceRef:sanitizarTraceRef(messageRef),fromMe:typeof message.key.fromMe==="boolean"?message.key.fromMe:null,upsertType:UPDATES.has(upsertType)?upsertType:"other",groupRef:groupReference(b.workspaceId,b.sessionId,groupId),stages:[]};run.messages.set(messageRef,row);
   groupCounter(b.workspaceId,b.sessionId,groupId,row.upsertType==="notify"?"upsertNotify":row.upsertType==="append"?"upsertAppend":"upsertOther");
   groupCounter(b.workspaceId,b.sessionId,groupId,row.fromMe===true?"fromMeTrue":row.fromMe===false?"fromMeFalse":"fromMeUnknown");
  }
  if(row.stages.length>=12){run.stagesDropped++;return;}
  const safeReason=REASONS.has(reason)?reason:reason?"other":"";
  const safeDecision=["received","accepted","ignored","rejected","error","pending","unknown"].includes(decision)?decision:"";
  if(!row.traceRef)row.traceRef=sanitizarTraceRef(messageRef);
  row.stages.push({at:now(),generation:b.generation,kind,traceRef:row.traceRef,...(safeReason?{reason:safeReason}:{}),...(safeDecision?{decision:safeDecision}:{})});
  const counters={emit_completed:"emitCompleted",callback:"callback",listener:"listener",radar_entry:"radar",mensageiro_gerente:"mensageiroGerente",mensageiro_comando:"mensageiroComando",mensageiro_atendimento:"mensageiroAtendimento"};
  if(counters[kind])groupCounter(b.workspaceId,b.sessionId,groupId,counters[kind]);
  if(kind==="emit_attempt"&&bufferState===true)groupCounter(b.workspaceId,b.sessionId,groupId,"buffered");
  if(kind==="radar_result")groupCounter(b.workspaceId,b.sessionId,groupId,decision==="accepted"?"radarAccepted":"radarRejected");
  const journalStage=({emit_attempt:"emit_attempt",emit_completed:"emit_completed",callback:"callback",listener:"listener",radar:"radar",radar_entry:"radar",result:"radar_result",radar_result:"radar_result",early:"listener_gate",mensageiro_gerente:"mensageiro_gerente",mensageiro_comando:"mensageiro_comando",mensageiro_atendimento:"mensageiro_atendimento"})[kind]||"listener";
  persist(b,{stage:journalStage,groupId,messageId:id,traceRef:row.traceRef,upsertType:row.upsertType,fromMe:row.fromMe,reason:safeReason||undefined,decision:safeDecision||undefined,buffering:bufferState});
 }
 function packetStage(kind,ctx,packet){
  if(!active()||!Array.isArray(packet?.messages))return;
  if(packet.messages.length>64)run.batchesTruncated++;
  for(const message of packet.messages.slice(0,64))safe(()=>messageStage(kind,{...ctx,message,upsertType:ctx.upsertType}));
 }
 function packetHasTarget(b,packet){
  if(!Array.isArray(packet?.messages))return false;
  return packet.messages.slice(0,64).some(message=>{
   const groupId=message?.key?.remoteJid;
   return typeof groupId==="string"&&targetFor(b.workspaceId,b.sessionId,groupId)!==null;
  });
 }
 function targetNode(node,b){
  const attrs=node&&typeof node==="object"?Object.getOwnPropertyDescriptor(node,"attrs")?.value:null;
  const from=attrs&&typeof attrs==="object"?Object.getOwnPropertyDescriptor(attrs,"from")?.value:undefined;
  return typeof from==="string"?Boolean(b&&targetFor(b.workspaceId,b.sessionId,from)):null;
 }
 function observeFrame(b,frame){
  if(ArrayBuffer.isView(frame)||frame instanceof ArrayBuffer){b.counters.binaryFrames++;return;}
  // Plain tag plus equality of approved group routing only. No content/getters.
  let tag;
  try{tag=frame&&typeof frame==="object"?Object.getOwnPropertyDescriptor(frame,"tag")?.value:undefined;}
  catch{b.counters.frameMetadataUnavailable++;}
  const kind=tag==="message"?"messageFrames":CONTROL_TAGS.has(tag)?"controlFrames":SYNC_TAGS.has(tag)?"syncFrames":"otherFrames";
  b.counters[kind]++;
  if(kind==="messageFrames")safe(()=>{const target=targetNode(frame,b);if(target===true){b.counters.targetMessageFrames++;const attrs=Object.getOwnPropertyDescriptor(frame,"attrs")?.value;const groupId=Object.getOwnPropertyDescriptor(attrs||{},"from")?.value;const messageId=Object.getOwnPropertyDescriptor(attrs||{},"id")?.value;persist(b,{stage:"ws_frame",groupId,messageId:typeof messageId==="string"?messageId:undefined});}if(target===null)b.counters.messageFramesUnattributed++;});
 }
 function trackSocket({workspaceId,sessionId,generation,sock}={}) {
  if(!active())return false;
  if(run.mode==="continuous"&&!continuousScope(workspaceId,sessionId))return false;
  else if(!targetFor(workspaceId,sessionId))return false;
  if(run.mode==="next_bootstrap"&&(run.phase!=="capturing"||run.captureGeneration!==generation))return false;
  if(!sock?.ev||!Number.isSafeInteger(generation)||generation<1)return false;
  if(bindings.has(sock.ev))return true;
  if(run.mode==="continuous")for(const old of [...bindings.values()])if(old.workspaceId===workspaceId&&old.sessionId===sessionId&&old.generation<generation){
   const snap=snapshot(old);run.finishedGenerations.push(snap);if(run.finishedGenerations.length>MAX_CONTINUOUS_GENERATIONS){run.finishedGenerations.shift();run.generationsDropped=Math.min(1000000,(run.generationsDropped||0)+1);}
   add(old,"socket_replaced");for(const [name,pair]of Object.entries(old.originals))safe(()=>{if(old.ev[name]===pair.wrapped)old.ev[name]=pair.original;});
   safe(()=>{if(old.wsOriginal&&old.ws.emit===old.wsOriginal.wrapped)old.ws.emit=old.wsOriginal.original;});bindings.delete(old.ev);run.generations=run.generations.filter(item=>item!==old);
  }
  const generationLimit=run.mode==="continuous"?MAX_CONTINUOUS_GENERATIONS:MAX_GENERATIONS;
  if(bindings.size>=generationLimit){if(run.mode!=="continuous")stop("generation_limit");else run.generationsDropped=(run.generationsDropped||0)+1;return false;}
  const b={sock,ev:sock.ev,workspaceId,sessionId,generation,buffering:null,lastSyncSignal:"NOT_OBSERVED",bootstrap:getBootstrap(generation,sessionId),added:new Set(),removed:new Set(),removedAll:false,invoked:false,originals:{},counters:{wsMessages:0,decodedFrames:0,messageNodes:0,wsOpens:0,wsCloses:0,messageFrames:0,controlFrames:0,syncFrames:0,otherFrames:0,binaryFrames:0,frameMetadataUnavailable:0,socketErrorEvents:0,streamErrorEvents:0,publicDispatchThrows:0,emitAttempts:0,emitCompleted:0,emitErrors:0,bufferedAttempts:0,bufferedAccepted:0,wrapperCalls:0,callbackCalls:0,radarEntries:0,offlineCompletionEvents:0,mensageiroGerenteCalls:0,mensageiroComandoCalls:0,mensageiroAtendimentoCalls:0,earlyReturns:0,sessionMismatch:0,workspaceMismatch:0,staleSocket:0,bufferTransitions:0,removals:0}};
  Object.assign(b.counters,{wsBinaryMessages:0,targetMessageFrames:0,targetMessageNodes:0,messageFramesUnattributed:0,frameDispatchThrows:0,messageDispatchThrows:0});
  bindings.set(b.ev,b);run.generations.push(b);run.current=b;run.currentBySession?.set(sessionId,b);add(b,"socket_current");buffering(b);
  for(const name of ["emit","on","off","removeAllListeners","buffer","flush"]){
   const original=b.ev[name];if(typeof original!=="function")continue;
   const wrapped=function(...args){
    const observing=active()&&bindings.get(b.ev)===b&&(run.mode!=="continuous"||continuousScope(b.workspaceId,b.sessionId)!==null);
    let wasBuffered=false,targetedPacket=false;
    if(observing)safe(()=>{
     if(name==="emit"&&args[0]==="messages.upsert"&&(targetedPacket=packetHasTarget(b,args[1]))){b.counters.emitAttempts++;const isBuffered=buffering(b);packetStage("emit_attempt",{sock,emitter:b.ev,workspaceId,sessionId,upsertType:args[1]?.type,buffering:isBuffered},args[1]);if(isBuffered){b.counters.bufferedAttempts++;wasBuffered=true;}run.calls++;if(run.mode!=="continuous"&&run.calls>=MAX_CALLS)stop("call_limit");}
    });
    // Native return, thrown error, receiver and arguments are preserved exactly.
    let result,completed=false;try{result=Reflect.apply(original,this,args);completed=true;}finally{
     if(observing&&active())safe(()=>{
     if(name==="emit"&&args[0]==="messages.upsert"&&targetedPacket){if(completed){packetStage("emit_completed",{sock,emitter:b.ev,workspaceId,sessionId,upsertType:args[1]?.type},args[1]);b.counters.emitCompleted++;if(wasBuffered)b.counters.bufferedAccepted++;}else b.counters.emitErrors++;}
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
   const wrapped=function(...args){const observing=active()&&bindings.get(b.ev)===b&&(run.mode!=="continuous"||continuousScope(b.workspaceId,b.sessionId)!==null);if(observing)safe(()=>{
    const counter={message:"wsMessages",frame:"decodedFrames","CB:message":"messageNodes",open:"wsOpens",close:"wsCloses",error:"socketErrorEvents","CB:stream:error":"streamErrorEvents"}[args[0]];
    if(counter&&Object.hasOwn(b.counters,counter))b.counters[counter]++;
    if(args[0]==="frame")observeFrame(b,args[1]);
    if(args[0]==="message"&&(ArrayBuffer.isView(args[1])||args[1] instanceof ArrayBuffer))b.counters.wsBinaryMessages++;
    if(args[0]==="CB:message"&&targetNode(args[1],b)===true){b.counters.targetMessageNodes++;const attrs=Object.getOwnPropertyDescriptor(args[1],"attrs")?.value;const groupId=Object.getOwnPropertyDescriptor(attrs||{},"from")?.value;const messageId=Object.getOwnPropertyDescriptor(attrs||{},"id")?.value;persist(b,{stage:"message_node",groupId,messageId:typeof messageId==="string"?messageId:undefined});}
   if(args[0]==="CB:success")b.lastSyncSignal="AUTHENTICATED";
   if(args[0]==="CB:ib,,offline"){b.lastSyncSignal="OFFLINE_COMPLETION_DISPATCHED";b.counters.offlineCompletionEvents++;persist(b,{stage:"offline_batch",operation:"cb_offline_received"});}
   });try{return Reflect.apply(original,this,args);}catch(error){if(observing&&active())safe(()=>{b.counters.publicDispatchThrows++;if(args[0]==="frame")b.counters.frameDispatchThrows++;if(args[0]==="CB:message")b.counters.messageDispatchThrows++;});throw error;}};
   try{ws.emit=wrapped;if(ws.emit===wrapped){b.ws=ws;b.wsOriginal={original,wrapped};}}catch{}
  }
  return true;
 }
 function mark(kind,{sock,emitter,workspaceId,sessionId,current,reason,decision,message,messages,upsertType,traceRef}={}){
  if(!active())return;const b=bindings.get(emitter||sock?.ev);if(!b)return;
  if(sessionId&&sessionId!==b.sessionId){b.counters.sessionMismatch++;if(run.mode==="continuous")return;}
  if(workspaceId!==undefined&&workspaceId!==b.workspaceId){b.counters.workspaceMismatch++;if(run.mode==="continuous")return;}
  if(current===false)b.counters.staleSocket++;
  if(kind==="wrapper"){b.counters.wrapperCalls++;b.invoked=true;if(b.bootstrap)b.bootstrap.delivery.wrapperCalls++;}
  if(kind==="callback"){b.counters.callbackCalls++;if(b.bootstrap)b.bootstrap.delivery.callbackCalls++;}
  if(kind==="radar"){b.counters.radarEntries++;if(b.bootstrap)b.bootstrap.delivery.radarEntries++;}
  if(kind==="early"){b.counters.earlyReturns++;add(b,["socket_stale","user_inactive","buffer_recovery_suppressed"].includes(reason)?reason:"early_other");}
  const observedWorkspace=run.mode==="continuous"?b.workspaceId:workspaceId,observedSession=run.mode==="continuous"?b.sessionId:sessionId;
  if(kind==="callback")packetStage("callback",{sock,emitter:b.ev,workspaceId:observedWorkspace,sessionId:observedSession,upsertType,traceRef},{messages});
  if(kind==="early"&&messages)packetStage("early",{sock,emitter:b.ev,workspaceId:observedWorkspace,sessionId:observedSession,reason,upsertType,traceRef},{messages});
  if(kind==="mensageiro_gerente")b.counters.mensageiroGerenteCalls++;
  if(kind==="mensageiro_comando")b.counters.mensageiroComandoCalls++;
  if(kind==="mensageiro_atendimento")b.counters.mensageiroAtendimentoCalls++;
  if(message)safe(()=>messageStage(({listener:"listener",radar:"radar_entry",result:"radar_result"})[kind]||kind,{sock,emitter:b.ev,workspaceId:b.workspaceId,sessionId:b.sessionId,message,reason,decision,upsertType,traceRef}));
  else if(["wrapper","callback"].includes(kind))persist(b,{stage:kind,decision:"received"});
  buffering(b);
 }
 function snapshot(b){const buffered=buffering(b),c={...b.counters},p=physical(b);let messageReceiver="UNKNOWN";safe(()=>{if(typeof b.sock.ws?.listenerCount==="function")messageReceiver=b.sock.ws.listenerCount("CB:message")>0?"PRESENT":"ABSENT";});return {generation:b.generation,workspaceRef:ref("workspace",b.workspaceId),sessionRef:ref("session",b.sessionId),isCurrent:run.mode==="continuous"?run.currentBySession?.get(b.sessionId)===b:run.current===b,buffering:buffered,listener:p,socketCoverage:b.wsOriginal?"public_emit_observed":"unavailable",counters:c,bootstrap:b.bootstrap?{...b.bootstrap,offlineBatch:{...b.bootstrap.offlineBatch},offlineAttribute:{...b.bootstrap.offlineAttribute},offlineTasks:{...b.bootstrap.offlineTasks},synchronization:{...b.bootstrap.synchronization},buffer:{...b.bootstrap.buffer,flushesByReason:{...b.bootstrap.buffer.flushesByReason}},delivery:{...b.bootstrap.delivery},records:b.bootstrap.records.map(x=>({...x}))}:null,
  messageReceiver,synchronization:{lastPublicSignal:b.lastSyncSignal,pendingNotificationsObserved:typeof b.sock.__optimusMessengerLiveReady==="boolean"?b.sock.__optimusMessengerLiveReady:null,initialSyncState:"UNAVAILABLE_PUBLIC_INTERFACE"},failureCoverage:{decodeFailures:null,decryptFailures:null,reason:"no_dedicated_public_failure_event; socket/stream errors and dispatch throws are distinct"},
  distinction:c.wrapperCalls?c.callbackCalls?c.radarEntries?"radar_reached":c.earlyReturns?"early_return_observed":"callback_without_radar":"wrapper_without_callback":c.emitAttempts?c.emitCompleted>0&&c.bufferedAccepted===c.emitCompleted&&!c.emitErrors&&b.buffering?"buffer_retained_observed":p.state==="ABSENT"?"listener_absent_observed":"emit_without_wrapper_unknown":"no_upsert_emit_observed_not_transport_proof"};}
 function status(){
  if(run?.active&&run.mode!=="continuous"&&now()>=run.expiresAt)stop(run.phase==="armed"?"arm_expired":run.mode==="next_bootstrap"?"capture_window_expired":"expired");
  if(run&&!run.active&&now()-run.finishedAt>=RETENTION_MS)run=null;
  if(!run)return {state:"off"};
  const state=run.active?(run.mode==="next_bootstrap"&&run.phase==="armed"?"armed":"active"):"stopped";
  const continuous=run.mode==="continuous";
  const journalStatus=continuous?journal?.status?.()||{available:false,failed:false,dropped:0,queued:0,bytes:0,maxBytes:0,retentionMs:0}:undefined;
  const journalOpening=continuous&&run.journalState==="opening"&&!journalStatus.available&&!journalStatus.failed;
  const observerCapacityLimited=continuous&&(run.scopesDropped>0||run.groupsDropped>0||run.generationsDropped>0||run.bootstrapRowsDropped>0);
  const coverageState=continuous?(journalOpening?"STARTING_JOURNAL":journalStatus.failed||!journalStatus.available?"DEGRADED_JOURNAL":journalStatus.dropped>0?"DEGRADED_JOURNAL_CAPACITY":observerCapacityLimited?"DEGRADED_OBSERVER_CAPACITY":run.generations.length?(journalStatus.rotatedSlots>0?"ACTIVE_ROTATING":"ACTIVE"):"WAITING_FOR_SOCKET"):"WINDOWED";
  return {state,mode:run.mode,startedAt:run.startedAt,expiresAt:run.expiresAt||null,finishedAt:run.finishedAt||null,reason:run.reason||"",journalState:continuous?(journalOpening?"opening":journalStatus.failed||!journalStatus.available?"unavailable":journalStatus.dropped>0?"capacity_limited":journalStatus.rotatedSlots>0?"rotating":"available"):run.journalState||null,coverageState,
   capture:continuous?{mode:"continuous",retentionMs:journalStatus.retentionMs||0}:run.mode==="next_bootstrap"?{mode:run.mode,phase:run.phase,armedAfterGeneration:run.armedAfterGeneration,observedGeneration:run.captureGeneration||null,captureStartedAt:run.captureStartedAt||null}:{mode:"current_window"},
   scope:continuous?[...run.targets.values()].map(target=>({workspaceRef:ref("workspace",target.workspaceId),sessionRef:sessionReference(target.workspaceId,target.sessionId),groups:target.groupIds.map(groupId=>groupReference(target.workspaceId,target.sessionId,groupId))})):{sessionRef:ref("session",run.sessionId),workspaceRef:ref("workspace",run.workspaceId),groupRef:ref("group",run.groupId)},
   generations:run.active?run.generations.map(snapshot):run.finalSnapshots||[],finishedGenerations:continuous?run.finishedGenerations.map(item=>({...item})):[],groupStats:continuous?[...run.groupStats.values()].map(item=>({workspaceRef:item.workspaceRef,sessionRef:item.sessionRef,groupRef:item.groupRef,lastAt:item.lastAt||null,lastIngressAt:item.lastIngressAt||null,counts:{...item.counts}})):[],groupsDropped:continuous?run.groupsDropped:0,
   records:run.records.map(x=>({...x})),recordsDropped:run.recordsDropped,messages:[...run.messages.values()].map(x=>({...x,stages:x.stages.map(s=>({...s}))})),unkeyed:run.unkeyed,stagesDropped:run.stagesDropped,batchesTruncated:run.batchesTruncated,scopesDropped:continuous?run.scopesDropped:0,generationsDropped:continuous?(run.generationsDropped||0):0,bootstrapRowsDropped:continuous?(run.bootstrapRowsDropped||0):0,
   journal:continuous?journalStatus:undefined,
   limits:continuous?{scopes:MAX_CONTINUOUS_SCOPES,groupsPerScope:MAX_GROUP_IDS_PER_SCOPE,generations:MAX_CONTINUOUS_GENERATIONS,messages:MAX_CONTINUOUS_MESSAGES,bootstrapRows:MAX_BOOTSTRAP_ROWS,groupRows:MAX_GROUP_ROWS,journalBytes:journalStatus.maxBytes||0,retentionMs:journalStatus.retentionMs||0}: {durationMs:run.mode==="next_bootstrap"?(run.phase==="armed"?NEXT_BOOTSTRAP_ARM_MS:NEXT_BOOTSTRAP_CAPTURE_MS):MAX_MS,calls:MAX_CALLS,generations:MAX_GENERATIONS,records:MAX_RECORDS,messages:MAX_MESSAGES,armWaitMs:run.mode==="next_bootstrap"?NEXT_BOOTSTRAP_ARM_MS:0,captureAfterGenerationMs:run.mode==="next_bootstrap"?NEXT_BOOTSTRAP_CAPTURE_MS:0},
   coverage:"Sanitized fixed counters at existing public socket and callback boundaries; group/message references are workspace-scoped HMACs. No message content, participant identifiers, raw JIDs, credential material or additional WhatsApp listeners."};
 }
 function start({workspaceId,sessionId,sock,generation,groupId,scopeValidated=false,mode="current_window"}={}){
  if(active()||run)return {ok:false,reason:"observation_exists"};
  if(!["current_window","next_bootstrap"].includes(mode)||scopeValidated!==true||workspaceId!=="admin"||sessionId!==TARGET_SESSION_ID||groupId!==TARGET_GROUP_ID||!sock?.ev||!Number.isSafeInteger(generation)||generation<1)return {ok:false,reason:"target_unverified"};
  const at=now(),duration=mode==="next_bootstrap"?NEXT_BOOTSTRAP_ARM_MS:MAX_MS;run={active:true,mode,phase:mode==="next_bootstrap"?"armed":"capturing",armedAfterGeneration:generation,captureGeneration:mode==="current_window"?generation:null,captureStartedAt:mode==="current_window"?at:null,workspaceId,sessionId,groupId,messages:new Map(),unkeyed:0,stagesDropped:0,batchesTruncated:0,startedAt:at,expiresAt:at+duration,records:[],recordsDropped:0,generations:[],bootstrapGenerations:new Map(),calls:0};
  if(mode==="current_window")trackSocket({workspaceId,sessionId,sock,generation});scheduleStop(duration);return {ok:true,...status()};
 }
 function startContinuous(){
  if(run?.active)return run.mode==="continuous"?{ok:true,alreadyActive:true,...status()}:{ok:false,reason:"observation_exists"};
  if(run)return {ok:false,reason:"observation_retained"};
  const at=now();run={active:true,mode:"continuous",startedAt:at,targets:new Map(),scopeCache:new Map(),scopesDropped:0,journalState:journal?.open?"opening":"unavailable",
   messages:new Map(),groupStats:new Map(),groupsDropped:0,unkeyed:0,stagesDropped:0,batchesTruncated:0,records:[],recordsDropped:0,generations:[],finishedGenerations:[],bootstrapGenerations:new Map(),currentBySession:new Map(),calls:0};
  const owner=run;if(journal?.open)Promise.resolve().then(()=>journal.open()).then(ok=>{if(run===owner)owner.journalState=ok===true?"available":"unavailable";}).catch(()=>{if(run===owner)owner.journalState="unavailable";});
  return {ok:true,...status()};
 }
 // Preserve immutable snapshots before releasing socket references on stop.
 const finish=stop;
 stop=function(reason="manual"){if(run?.active)run.finalSnapshots=run.generations.map(snapshot);const result=finish(reason);if(run&&!run.active){run.generations=[];run.current=null;if(run.mode==="continuous")Promise.resolve(journal?.close?.()).catch(()=>{});}return result;};
 return Object.freeze({start,startContinuous,stop,status,trackSocket,mark,bootstrapObserver});
}
module.exports={createIngressBoundaryObservation,resolveConfiguredObservationGroups,MAX_MS,NEXT_BOOTSTRAP_ARM_MS,NEXT_BOOTSTRAP_CAPTURE_MS,MAX_CALLS,MAX_RECORDS,MAX_GENERATIONS,MAX_MESSAGES,MAX_BOOTSTRAP_SIGNALS,MAX_CONTINUOUS_GENERATIONS,MAX_CONTINUOUS_MESSAGES,MAX_BOOTSTRAP_ROWS,MAX_GROUP_ROWS,MAX_CONTINUOUS_SCOPES,MAX_GROUP_IDS_PER_SCOPE,TARGET_GROUP_ID,TARGET_SESSION_ID};
