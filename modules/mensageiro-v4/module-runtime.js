"use strict";
// Optional configuration contract inside the existing V4 dispatch. No listener,
// timer loop, financial ledger or transport of its own.
const crypto = require("node:crypto");
const { body } = require("./moderation");
const { normalize } = require("./intelligence");
const { choose, payload } = require("./module-contract");
const { aplicarDelayAtendimento } = require("../mensageiro/service");
function contactRef(p, sessionId, contact) {
  return crypto.createHash("sha256").update(JSON.stringify([p.workspaceId,p.id,sessionId,contact])).digest("hex");
}
function withinHours(hours, now) {
  if(!hours) return true;
  const parts=Object.fromEntries(new Intl.DateTimeFormat("en-US",{timeZone:"America/Sao_Paulo",weekday:"short",hour:"2-digit",minute:"2-digit",hourCycle:"h23"})
    .formatToParts(now).filter(p=>p.type!=="literal").map(p=>[p.type,p.value]));
  const day=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].indexOf(parts.weekday), current=parts.hour+":"+parts.minute;
  if(hours.start <= hours.end) return hours.days.includes(day)&&current>=hours.start&&current<=hours.end;
  return (hours.days.includes(day)&&current>=hours.start)||(hours.days.includes((day+6)%7)&&current<=hours.end);
}
function matches(value, terms, mode="exact") {
  return terms.some(t=> {const n=normalize(t); return mode==="contains" ? (" "+normalize(value).replace(/[^\p{L}\p{N}]+/gu," ")+" ").includes(" "+n+" ") : mode==="starts" ? normalize(value).startsWith(n) : normalize(value)===n;});
}
async function executeModule({profile:p,card,message,event,sessionId,groupId,send,repository,revalidate,now=Date.now(),delay=aplicarDelayAtendimento}) {
  const c=p.cards[card]?.configuration?.universal;
  if(!c || !["welcome","farewell","commands","attendance"].includes(card)) return null;
  const base={workspaceId:p.workspaceId,profileId:p.id,sessionId,expectedRevision:p.revision};
  const eventKey=message?.key?.id || JSON.stringify([event?.id,event?.action,event?.timestamp,event?.participants]);
  const variables={grupo:"grupo",negocio:p.name,nome:message?.pushName || "participante",saudacao:"Olá"};
  const transmit=async (destination,values,key,extra={})=> {
    if(c.delaySeconds) await delay(c.delaySeconds);
    await revalidate();
    const result=await send(destination,payload(choose(values,key),{...variables,...extra}));
    return {processada:true,transportAccepted:!!result?.key?.id,deliveryConfirmed:false};
  };
  if(["welcome","farewell"].includes(card)) {
    const action=event?.action;
    if((card==="welcome"&&action!=="add")||(card==="farewell"&&!["remove","leave"].includes(action))) return {blocked:true,reason:"event_mismatch"};
    const participants=[...new Set((event.participants||[]).map(v=>typeof v==="string"?v:v.id||v.lid).filter(v=>/^[A-Za-z0-9_:-]+@(?:s\.whatsapp\.net|lid)$/.test(v||"")))];
    if(participants.length>8) return {blocked:true,reason:"participant_limit"};
    let result={processada:false};
    for(const participant of participants) result=await transmit(c.destination==="private"?participant:groupId,c.responses,eventKey+participant,{nome:"participante"});
    return result;
  }
  const contact=message?.key?.participant || groupId;
  const ref=contactRef(p,sessionId,contact);
  if(card==="commands") {
    const command=c.commands.find(cmd=>matches(body(message),cmd.triggers)&&(!cmd.groups||cmd.groups.includes(groupId)));
    if(!command) return {processada:false,reason:"no_match"};
    const admitted=await repository.call("interaction",{...base,contactRef:ref,slot:"command:"+command.id,cooldownSeconds:command.cooldownSeconds});
    if(!admitted.allowed) return {blocked:true,reason:admitted.reason};
    return transmit(groupId,command.responses,eventKey);
  }
  if(groupId.endsWith("@g.us")||!withinHours(c.hours,now)) return {blocked:true,reason:"outside_private_hours"};
  const state=await repository.call("conversation",{...base,contactRef:ref});
  if(state.humanUntil>Date.now()) return {blocked:true,reason:"human_paused"};
  const value=body(message);
  const node=state.node && c.nodes.find(n=>n.id===state.node);
  let selected=node?.options.find(o=>matches(value,o.terms));
  if(!selected) selected=[...c.rules].sort((a,b)=>b.priority-a.priority).find(r=>matches(value,r.terms,r.match));
  const human=matches(value,c.humanTerms,"contains")||selected?.human===true;
  const next=selected?.next ? c.nodes.find(n=>n.id===selected.next) : null;
  const values=next?.responses || selected?.responses || (/^(oi|ola|bom dia|boa tarde|boa noite)[!.\s]*$/.test(normalize(value))?c.greeting:[]) || [];
  const output=values.length?values:c.fallback;
  const admit=await repository.call("interaction",{...base,contactRef:ref,slot:"attendance",cooldownSeconds:human?0:c.cooldownSeconds,
    ...(human?{humanPauseMinutes:c.humanPauseMinutes}:{}),...(selected?{node:next?.id||null}:{} )});
  if(!admit.allowed) return {blocked:true,reason:admit.reason};
  if(human) return {processada:true,reason:"human_handoff",robotPaused:true};
  if(!output.length) return {processada:false,reason:"no_match"};
  return transmit(groupId,output,eventKey);
}
module.exports={executeModule,contactRef,withinHours,matches};
