"use strict";
const crypto=require("node:crypto");
const {fail,text}=require("./model");
const {response,payload}=require("./module-contract");
const {scheduleInput,zonedParts,zonedToTimestamp}=require("../mensageiro-v3/legacy-compat");
function recurrence(input) {
  if(!input||!["once","daily","weekly","interval"].includes(input.mode)) fail("programacao_invalida");
  const r={mode:input.mode,timezone:"America/Sao_Paulo",time:input.time||"08:00",startAt:input.startAt||null,
    days:[...new Set(input.days||[0,1,2,3,4,5,6])],intervalMinutes:Number(input.intervalMinutes||Number(input.intervalHours)*60||30),
    jitterMin:Number(input.jitterMinutes?.min||0),jitterMax:Number(input.jitterMinutes?.max||0),
    jitterSeed:input.jitterSeed||"default"};
  if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(r.time)||!r.days.length||r.days.length>7||r.days.some(d=>!Number.isInteger(d)||d<0||d>6)||
    !Number.isFinite(r.intervalMinutes)||r.intervalMinutes<1||r.intervalMinutes>10080||
    !Number.isInteger(r.jitterMin)||!Number.isInteger(r.jitterMax)||r.jitterMin<0||r.jitterMax<r.jitterMin||r.jitterMax>60||
    (r.mode==="interval"&&r.jitterMax>=r.intervalMinutes)||r.mode==="once"&&!Number.isFinite(Date.parse(r.startAt))||
    !/^(?:[a-f0-9]{32}|default)$/.test(r.jitterSeed)) fail("programacao_invalida");
  if(["daily","weekly"].includes(r.mode) && Number(r.time.slice(0,2))*60+Number(r.time.slice(3))+r.jitterMax>=1440) fail("programacao_invalida");
  return r;
}
function next(r,after,seed) {
  r=recurrence({...r,jitterMinutes:{min:r.jitterMin,max:r.jitterMax}});
  // Calendar jitter is keyed to the persisted recurrence, not the call site
  // (creation uses a different schedule ID than advancement). Otherwise the
  // same local day could be selected twice with a later random offset.
  const jitter=(key)=>60000*(r.jitterMin+crypto.createHash("sha256").update(r.jitterSeed+":"+key).digest().readUInt32BE(0)%(r.jitterMax-r.jitterMin+1));
  if(r.mode==="once") {const date=Date.parse(r.startAt)+jitter(r.startAt);return date>after?new Date(date).toISOString():null;}
  if(r.mode==="interval") return new Date(after+r.intervalMinutes*60000+jitter(seed+":"+after)).toISOString();
  const local=zonedParts(after,r.timezone), origin=Date.UTC(local.year,local.month-1,local.day);
  for(let i=0;i<9;i++) {
    const day=new Date(origin+i*86400000);
    if(r.mode==="weekly"&&!r.days.includes(day.getUTCDay())) continue;
    const date=zonedToTimestamp({year:day.getUTCFullYear(),month:day.getUTCMonth()+1,day:day.getUTCDate(),hour:Number(r.time.slice(0,2)),minute:Number(r.time.slice(3)),second:0},r.timezone);
    const value=date+jitter(date);
    if(value>after) return new Date(value).toISOString();
  }
  fail("programacao_invalida");
}
function normalizeSchedule(input,previous,now=Date.now()) {
  if(!input.recurrence && !previous?.content?.recurrenceV4) return scheduleInput(input,now,previous);
  const rawRecurrence=input.recurrence||{...previous.content.recurrenceV4,jitterMinutes:{min:previous.content.recurrenceV4.jitterMin,max:previous.content.recurrenceV4.jitterMax}};
  const r=recurrence({...rawRecurrence,jitterSeed:previous?.content?.recurrenceV4?.jitterSeed||crypto.randomBytes(16).toString("hex")});
  if(input.responses!==undefined&&!Array.isArray(input.responses)) fail("lista_invalida");
  const contents=input.responses?input.responses.map(response):previous?.content?.responses;
  if(!Array.isArray(contents)||!contents.length||contents.length>8) fail("resposta_vazia");
  const normalized={name:text(input.name||input.nome||previous?.name||"Programação",100),timezone:r.timezone,
    nextRunAt:previous&&!input.recurrence?previous.nextRunAt:next(r,now,"first"),
    intervalMs:r.mode==="once"?0:r.mode==="interval"?r.intervalMinutes*60000:86400000,
    destinations:input.grupos||previous?.destinations||[],
    content:{recurrenceV4:r,responses:contents,occurrenceIndex:previous?.content?.occurrenceIndex||0},allowInactive:true};
  if(!normalized.nextRunAt&&input.ativo===true) fail("programacao_passada");
  return normalized;
}
function schedulePayload(content) {return payload(content.responses[(Number(content.occurrenceIndex)||0)%content.responses.length]);}
function assertSchedule(profile,input) {
  if(!input.content?.recurrenceV4) return;
  recurrence({...input.content.recurrenceV4,jitterMinutes:{min:input.content.recurrenceV4.jitterMin,max:input.content.recurrenceV4.jitterMax}});
  if(!Array.isArray(input.content.responses)||!input.content.responses.length||input.content.responses.length>8) fail("resposta_vazia");
  input.content.responses.forEach(response);
  const allowed=profile.cards.scheduled.configuration?.universal?.groups||profile.destinations||[];
  if(input.destinations.some(g=>!profile.destinations.includes(g)||!allowed.includes(g))) fail("scope_invalid");
  if(Buffer.byteLength(JSON.stringify(input.content))>9*1024*1024) fail("configuracao_grande");
}
module.exports={recurrence,next,normalizeSchedule,schedulePayload,assertSchedule};
