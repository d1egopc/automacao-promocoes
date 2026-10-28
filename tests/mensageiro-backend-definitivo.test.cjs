"use strict";
const test=require("node:test"), assert=require("node:assert/strict"), fs=require("node:fs"),path=require("node:path");
const {fixture,W,B,G,P,image}=require("./mensageiro-universal.test.cjs");
const {V3Store}=require("../modules/mensageiro-v3/src/v3/store");
const {V3Scheduler}=require("../modules/mensageiro-v3/src/v3/scheduler");
const {scheduledPayload}=require("../modules/mensageiro-v3/operational-gates");
const {media,normalizeModule}=require("../modules/mensageiro-v4/module-contract");
const {normalizeSchedule,next,recurrence}=require("../modules/mensageiro-v4/schedule-options");
const {contactRef,withinHours}=require("../modules/mensageiro-v4/module-runtime");
const video={type:"video",dataUri:"data:video/mp4;base64,"+fs.readFileSync(path.join(__dirname,"fixtures/messenger-flower-cc0.mp4")).toString("base64")};
async function moduleSave(f,id,name,configuration,active=false,w=W) {
  const p=await f.current(w,id);
  const r=await f.api(w,"PUT",`/profiles/${id}/modules/${name}`,{expectedRevision:p.revision,configuration,active});
  assert.equal(r.status,200,JSON.stringify(r.body));return r.body.profile;
}
function rule(action="delete_warn",extra={}) {return {rules:[{id:"spam_link",category:"links_externos",enabled:true,action,warning:"Regra do grupo.",strikes:2,...extra}]};}
function adminSocket(f, admin=true, participantAdmin=false) {
  const bot="5511888888888@s.whatsapp.net",sock=f.sockets[W];sock.user={id:bot};
  sock.groupMetadata=async()=>({participants:[{id:bot,admin:admin?"admin":null},{id:P,admin:participantAdmin?"admin":null}]});
  sock.groupParticipantsUpdate=async(g,participants,action)=> {f.bans||=[];f.bans.push({g,participants,action});return [{status:"200"}];};
}
test("backend contract: every profile/card OFF, templates copy independently, niche and duplicate persist",async t=> {
  const f=await fixture(t),p=await f.create();
  assert.equal(p.active,false);assert.ok(Object.values(p.cards).every(c=>!c.active));
  const templates=await f.api(W,"GET","/templates");assert.equal(templates.body.templates.length,6);
  const result=await f.api(W,"POST",`/profiles/${p.id}/template`,{templateId:"refrigeration",expectedRevision:p.revision});
  assert.equal(result.status,200);assert.equal(result.body.profile.niche,"Refrigeração");
  const copied=await f.api(W,"GET",`/profiles/${p.id}/modules`);assert.ok(Object.values(copied.body.modules).every(m=>!m.active));
  const config=copied.body.modules.welcome.configuration;config.responses=[{text:"Meu texto próprio"}];
  await moduleSave(f,p.id,"welcome",config);
  const other=await f.create(B);await f.api(B,"POST",`/profiles/${other.id}/template`,{templateId:"refrigeration",expectedRevision:other.revision});
  const otherModules=(await f.api(B,"GET",`/profiles/${other.id}/modules`)).body.modules;
  assert.notEqual(otherModules.welcome.configuration.responses[0].text,"Meu texto próprio");
  const dup=await f.api(W,"POST",`/profiles/${p.id}/duplicate`,{});assert.equal(dup.status,200);assert.equal(dup.body.profile.active,false);
  assert.ok(Object.values(dup.body.profile.cards).every(c=>!c.active));
  const persisted=new V3Store({filePath:f.filePath}).getProfile(W,p.id);
  assert.equal(persisted.cards.welcome.configuration.universal.responses[0].text,"Meu texto próprio");
  assert.equal(persisted.niche,"Refrigeração");assert.equal(f.sent.length,0);
});
test("HTTP: module CAS, ownership, plan, authenticated media and subset boundaries",async t=> {
  const f=await fixture(t),p=await f.create();
  await moduleSave(f,p.id,"commands",{commands:[]});
  assert.equal((await f.api(W,"PUT",`/profiles/${p.id}/modules/commands`,{expectedRevision:p.revision,configuration:{commands:[]}})).status,409);
  assert.equal((await f.api(B,"GET",`/profiles/${p.id}/modules`)).body.code,"perfil_nao_encontrado");
  assert.equal((await f.api(null,"GET","/templates")).status,401);
  assert.equal((await f.api(W,"GET","/templates",null,"blocked")).status,403);
  const current=await f.current(W,p.id);
  assert.equal((await f.api(W,"PUT",`/profiles/${p.id}/modules/welcome`,{expectedRevision:current.revision,configuration:{groups:["foreign@g.us"]}})).body.code,"scope_invalid");
  const uploaded=await f.api(W,"POST",`/profiles/${p.id}/media`,{media:{type:"image",dataUri:image}});
  assert.equal(uploaded.status,200);assert.equal(uploaded.body.persisted,false);
  assert.equal((await f.api(B,"POST",`/profiles/${p.id}/media`,{media:{type:"image",dataUri:image}})).body.code,"perfil_nao_encontrado");
});
test("canonical commands: alternative response, per-contact cooldown, self/history rejection, same ledger fence",async t=> {
  const f=await fixture(t),p=await f.create();
  await moduleSave(f,p.id,"commands",{commands:[{id:"rules",triggers:["!regras"],cooldownSeconds:60,responses:[{text:"Regra A"},{text:"Regra B"}]}]},true);
  await f.activate(W,p.id);await f.dispatch(W,"canonical-1","commands","!regras");
  assert.equal(f.sent.length,1);assert.match(f.sent[0].content.text,/Regra [AB]/);
  await f.dispatch(W,"canonical-2","commands","!regras");assert.equal(f.sent.length,1);
  await f.dispatch(W,"own","commands","!regras",G,{message:{key:{id:"own",fromMe:true,remoteJid:G},messageTimestamp:Math.ceil(Date.now()/1000)}});
  assert.equal(f.sent.length,1);assert.equal(f.debits.length,1);
  await f.dispatch(W,"canonical-1","commands","!regras");assert.equal(f.sent.length,1);
});
test("welcome/farewell: independent content, delay, media, repeated participant events and bootstrap",async t=> {
  const f=await fixture(t),p=await f.create();
  await moduleSave(f,p.id,"welcome",{destination:"private",delaySeconds:0.001,responses:[{text:"Olá {nome}",media:{type:"image",dataUri:image}}]},true);
  await moduleSave(f,p.id,"farewell",{responses:[{text:"Até logo"}]},true);await f.activate(W,p.id);
  const event={id:G,action:"add",participants:[P],timestamp:123};
  await f.dispatch(W,"join","welcome","",G,{message:undefined,event});
  await f.dispatch(W,"join","welcome","",G,{message:undefined,event});
  assert.equal(f.sent.length,1);assert.equal(f.sent[0].to,P);assert.ok(Buffer.isBuffer(f.sent[0].content.image));
  await f.dispatch(W,"leave","farewell","",G,{message:undefined,event:{...event,action:"remove"}});
  assert.equal(f.sent.length,2);assert.equal(f.sent[1].content.text,"Até logo");
  f.sockets[W].__optimusMessengerLiveReady=false;
  await f.dispatch(W,"bootstrap","welcome","",G,{message:undefined,event:{...event,timestamp:456}});assert.equal(f.sent.length,2);
});
test("attendance: deterministic tree, priority, human pause/resume, no cross-profile or workspace reply",async t=> {
  const f=await fixture(t),p=await f.create();
  await moduleSave(f,p.id,"attendance",{cooldownSeconds:0,rules:[{id:"start",terms:["ajuda"],priority:2,responses:[{text:"início"}],next:"menu"}],
    nodes:[{id:"menu",responses:[{text:"Escolha entrega ou atendente"}],options:[{terms:["entrega"],next:"delivery"},{terms:["atendente"],human:true}]},
      {id:"delivery",responses:[{text:"Resposta entrega"}],options:[]}],fallback:[{text:"Como ajudar?"}]},true);
  await f.activate(W,p.id);
  await f.dispatch(W,"private-start","attendance","ajuda",P);assert.equal(f.sent[0].content.text,"Escolha entrega ou atendente");
  await f.dispatch(W,"private-option","attendance","entrega",P);assert.equal(f.sent[1].content.text,"Resposta entrega");
  const handoff=await f.dispatch(W,"human","attendance","quero falar com atendente",P);assert.equal(handoff.result.robotPaused,true);
  await f.dispatch(W,"paused","attendance","ajuda",P);assert.equal(f.sent.length,2);
  const cur=await f.current(W,p.id);
  assert.equal((await f.api(W,"POST",`/profiles/${p.id}/human`,{expectedRevision:cur.revision,contactId:P,paused:false})).status,200);
  await f.dispatch(W,"resumed","attendance","ajuda",P);assert.equal(f.sent.length,3);
  const duplicate=await f.create();await moduleSave(f,duplicate.id,"attendance",{fallback:[{text:"duplicada"}]},true);
  assert.equal((await f.activate(W,duplicate.id)).body.code,"perfis_conflitantes");
  await f.dispatch(B,"cross","attendance","ajuda",P);assert.equal(f.sent.length,3);
  const persisted=new V3Store({filePath:f.filePath});assert.ok(Object.keys(persisted.state.workspaces[W].messengerRuntime).every(k=>/^[a-f0-9]{64}$/.test(k)));
});
test("private hours use São Paulo including overnight; unknown values and cycles are bounded",()=> {
  const h={days:[1],start:"22:00",end:"02:00"};
  assert.equal(withinHours(h,Date.parse("2026-10-26T23:00:00-03:00")),true);
  assert.equal(withinHours(h,Date.parse("2026-10-27T01:00:00-03:00")),true);
  assert.equal(withinHours(h,Date.parse("2026-10-27T23:00:00-03:00")),false);
  assert.throws(()=>normalizeModule("attendance",{nodes:[{id:"x",responses:[{text:"oi"}],options:[{terms:["x"],next:"missing"}]}]}),/fluxo_invalido/);
  assert.throws(()=>normalizeModule("welcome",{delaySeconds:600}),/limites_invalidos/);
});
test("moderation: first warning, second violation ban, duplicate never repeats; rule and local result recorded",async t=> {
  const f=await fixture(t),p=await f.create();adminSocket(f);
  await moduleSave(f,p.id,"groupManager",rule("warn_ban"),true);await f.activate(W,p.id);
  let result=await f.dispatch(W,"violation-1","groupManager","https://example.com");
  assert.equal(result.result.banAttempted,false);assert.equal(f.sent.length,1);
  result=await f.dispatch(W,"violation-2","groupManager","https://example.com");
  assert.equal(result.result.banResult,"local_resolved");assert.equal(f.bans.length,1);assert.deepEqual(f.bans[0].participants,[P]);
  await f.dispatch(W,"violation-2","groupManager","https://example.com");assert.equal(f.bans.length,1);
  const records=await f.api(W,"GET",`/profiles/${p.id}/history?limit=100`);assert.ok(records.body.records.some(r=>r.event==="messenger_strike"&&r.ruleId==="spam_link"));
  assert.ok(records.body.records.some(r=>r.result?.banResult==="local_resolved"));
  const diagnostic=await f.api(W,"GET",`/profiles/${p.id}/diagnostic`);assert.equal(diagnostic.body.readOnly,true);
  assert.equal((await f.api(B,"GET",`/profiles/${p.id}/diagnostic`)).body.code,"perfil_nao_encontrado");
});
test("four-strike policy and expired window; private OFF cannot be bypassed by old FAQ flags",async t=> {
  const f=await fixture(t),p=await f.create();adminSocket(f);
  await moduleSave(f,p.id,"groupManager",rule("warn_ban",{strikes:4,strikeWindowMinutes:1}),true);
  await moduleSave(f,p.id,"attendance",{fallback:[{text:"Não enviar"}]},false);
  await f.card(W,p.id,"faq",{gatilhos:[]});await f.activate(W,p.id);
  await f.dispatch(W,"private-off","attendance","oi",P);assert.equal(f.sent.length,0);
  for(let i=1;i<=3;i++) await f.dispatch(W,"four-"+i,"groupManager","https://example.com");
  assert.equal(f.bans,undefined);
  const storage=new V3Store({filePath:f.filePath});
  for(const row of Object.values(storage.state.workspaces[W].messengerRuntime)) for(const entries of Object.values(row.strikes||{})) for(const entry of entries) entry.at-=120000;
  storage._persist();
  await f.dispatch(W,"after-window","groupManager","https://example.com");assert.equal(f.bans,undefined);
  for(let i=1;i<=3;i++) await f.dispatch(W,"new-window-"+i,"groupManager","https://example.com");
  assert.equal(f.bans.length,1);
});
test("canonical responses cannot send with zero credits, disabled module or lost plan",async t=> {
  const f=await fixture(t),p=await f.create();
  await moduleSave(f,p.id,"commands",{commands:[{triggers:["!teste"],cooldownSeconds:0,responses:[{text:"Nunca grátis"}]}]},true);
  await f.activate(W,p.id);f.engine.credits.send=async()=>{throw new Error("sem_creditos");};
  const r=await f.dispatch(W,"empty-balance","commands","!teste");assert.equal(r.result.reason,"sem_creditos");assert.equal(f.sent.length,0);
  await moduleSave(f,p.id,"commands",undefined,false);
  await f.dispatch(W,"disabled","commands","!teste");await f.dispatch(W,"plan","commands","!teste",G,{planAllowed:false});assert.equal(f.sent.length,0);
});
test("ban rechecks lost administration and never acts in another group",async t=> {
  const f=await fixture(t),p=await f.create();adminSocket(f);
  await moduleSave(f,p.id,"groupManager",rule("warn_ban"),true);await f.activate(W,p.id);
  await f.dispatch(W,"ban-first","groupManager","https://example.com");
  const sock=f.sockets[W];sock.groupMetadata=async()=>({participants:[{id:sock.user.id},{id:P}]});
  const result=await f.dispatch(W,"ban-second","groupManager","https://example.com");
  assert.equal(result.result.reason,"ban_permission_unproven");assert.equal(f.bans,undefined);
  await f.dispatch(W,"foreign-ban","groupManager","https://example.com","other@g.us");assert.equal(f.bans,undefined);assert.equal(f.sent.length,1);
});
for(const option of ["no_admin","sender_admin","zero_balance"]) test("moderation protection: "+option,async t=> {
  const f=await fixture(t),p=await f.create();adminSocket(f,option!=="no_admin",option==="sender_admin");
  await moduleSave(f,p.id,"groupManager",rule("delete_warn"),true);await f.activate(W,p.id);
  if(option==="zero_balance") f.engine.credits.send=async()=>{throw new Error("sem_creditos");};
  const result=await f.dispatch(W,option,"groupManager","https://example.com");
  if(option==="zero_balance") {assert.equal(result.result.deleteResult,"local_resolved");assert.equal(result.result.noticeResult,"sem_creditos");assert.equal(f.sent.filter(s=>s.content.delete).length,1);}
  else assert.equal(f.sent.length,0);
});
test("video MP4 and image validate, persist, prepare via Baileys and reach the single guarded transport",async t=> {
  const f=await fixture(t),p=await f.create();assert.ok(media(video).bytes>1000000);
  assert.throws(()=>media({type:"video",dataUri:"https://example.com/movie.mp4"}),/midia_invalida/);
  assert.throws(()=>media({type:"video",dataUri:"data:video/mp4;base64,"+Buffer.alloc(40).toString("base64")}),/midia_invalida/);
  assert.throws(()=>media({type:"image",dataUri:video.dataUri}),/midia_invalida/);
  assert.throws(()=>media({type:"video",dataUri:"data:video/mp4;base64,"+Buffer.alloc(6*1024*1024+1).toString("base64")}),/midia_invalida/);
  await moduleSave(f,p.id,"commands",{commands:[{triggers:["!video"],cooldownSeconds:0,responses:[{text:"Vídeo teste",media:video}]}]},true);
  await f.activate(W,p.id);await f.dispatch(W,"media","commands","!video");assert.ok(Buffer.isBuffer(f.sent[0].content.video));
  const {prepareWAMessageMedia}=require("@whiskeysockets/baileys");let uploads=0;
  const prepared=await prepareWAMessageMedia(f.sent[0].content,{upload:async stream=>{for await(const _ of stream){}uploads++;return {mediaUrl:"https://fixture.invalid/media",directPath:"/fixture"};},logger:{debug(){},warn(){},info(){},error(){}}});
  assert.equal(uploads,1);assert.ok(prepared.videoMessage?.fileSha256);assert.equal(Number(prepared.videoMessage.fileLength),1128375);
  const persisted=new V3Store({filePath:f.filePath}).getProfile(W,p.id);assert.equal(persisted.cards.commands.configuration.universal.commands[0].responses[0].media.type,"video");
  const selected=await f.repository.call("select",{workspaceId:W,sessionId:f.session(W),groupId:G,card:"commands"});
  const preparedMedia=selected.profile.cards.commands.configuration.universal.commands[0].responses[0].media;
  assert.equal(preparedMedia.dataUri,undefined);assert.ok(preparedMedia.prepared instanceof Uint8Array);
  assert.throws(()=>media({type:"video",prepared:preparedMedia.prepared}),/midia_invalida/);
  const png=await require("sharp")({create:{width:2,height:2,channels:4,background:{r:255,g:20,b:0,alpha:1}}}).png().toBuffer();
  await moduleSave(f,p.id,"commands",{commands:[{triggers:["!imagem"],cooldownSeconds:0,responses:[{text:"PNG real",media:{type:"image",dataUri:"data:image/png;base64,"+png.toString("base64")}}]}]},true);
  await f.dispatch(W,"image-real","commands","!imagem");
  const preparedImage=await prepareWAMessageMedia(f.sent[1].content,{upload:async stream=>{for await(const _ of stream){}return {mediaUrl:"https://fixture.invalid/image",directPath:"/fixture-image"};},logger:{debug(){},warn(){},info(){},error(){}}});
  const dimensions=await require("sharp")(f.sent[1].content.image).metadata();
  assert.equal(dimensions.width,2);assert.equal(dimensions.height,2);
  assert.ok(preparedImage.imageMessage.fileSha256);assert.equal(Number(preparedImage.imageMessage.fileLength),png.length);
});
test("weekly, daily, once, hour intervals and bounded jitter use V3 scheduler with controlled clock; pause/edit/delete",async t=> {
  const f=await fixture(t),p=await f.create();await moduleSave(f,p.id,"scheduled",{},true);await f.activate(W,p.id);
  let now=Date.parse("2026-11-02T10:00:00-03:00"), store=new V3Store({filePath:f.filePath,clock:()=>now});
  const r={mode:"weekly",days:[1,3],time:"10:01",jitterMinutes:{min:1,max:2}};
  const normalized=normalizeSchedule({recurrence:r,responses:[{text:"A"},{text:"B",media:video}],grupos:[G]},null,now);
  let s=store.createSchedule(W,p.id,normalized);s=store.updateSchedule(W,s.id,{active:true});now=Date.parse(s.nextRunAt);
  const sent=[];const scheduler=new V3Scheduler({store,clock:()=>now,transport:{sendMessage:async a=>{sent.push(scheduledPayload(a.content));return {ambiguous:true,confirmed:false};}}});
  await scheduler.tick();await scheduler.tick();assert.equal(sent.length,1);assert.equal(sent[0].text,"A");
  const nextSchedule=store.getSchedule(W,s.id);assert.match(nextSchedule.nextRunAt,/2026-11-04T13:0[23]:00/);now=Date.parse(nextSchedule.nextRunAt);
  await scheduler.tick();assert.equal(sent.length,2);assert.ok(Buffer.isBuffer(sent[1].video));
  let current=store.getSchedule(W,s.id);store.updateSchedule(W,s.id,{active:false});await scheduler.tick();assert.equal(sent.length,2);
  current=store.getSchedule(W,s.id);store.deleteSchedule(W,s.id,{expectedRevision:current.revision});assert.equal(store.getSchedule(W,s.id),null);
  const once=recurrence({mode:"once",startAt:"2026-11-03T15:00:00Z",jitterMinutes:{min:1,max:2}}), due=next(once,Date.parse("2026-11-02"),"first");
  assert.equal(next(once,Date.parse(due),"schedule_x"),null);
  assert.equal(next(recurrence({mode:"interval",intervalHours:2}),now,"x"),new Date(now+7200000).toISOString());
  assert.throws(()=>recurrence({mode:"interval",intervalMinutes:1,jitterMinutes:{max:10}}),/programacao_invalida/);
});
test("schedule HTTP supports recurrence, image/video response, inactive creation, pause and revision-safe removal",async t=> {
  const f=await fixture(t),p=await f.create();
  const created=await f.api(W,"POST",`/profiles/${p.id}/schedules`,{name:"Futura",ativo:false,grupos:[G],recurrence:{mode:"interval",intervalHours:1},responses:[{text:"Vídeo",media:video}]});
  assert.equal(created.status,200,JSON.stringify(created.body));const s=created.body.schedule;assert.equal(s.active,false);
  const patched=await f.api(W,"PATCH",`/profiles/${p.id}/schedules/${s.id}`,{expectedRevision:s.revision,ativo:true});assert.equal(patched.status,200);
  assert.equal((await f.api(B,"GET",`/profiles/${p.id}/schedules`)).body.code,"perfil_nao_encontrado");
  const removed=await f.api(W,"DELETE",`/profiles/${p.id}/schedules/${s.id}`,{expectedRevision:patched.body.schedule.revision});assert.equal(removed.status,200);
});
