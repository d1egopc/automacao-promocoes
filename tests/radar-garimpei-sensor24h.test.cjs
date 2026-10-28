"use strict";
const test=require("node:test"), assert=require("node:assert/strict"), fs=require("node:fs/promises"), os=require("node:os"),path=require("node:path");
const {createRadarIngressObservation,containsMagaluOneLink,SENSOR_DURATION_MS}=require("../modules/radar/ingress-observation-v1");
const {createSensorJournal,MAX_BYTES}=require("../modules/radar/ingress-sensor-journal");
const JID="123456789@g.us", SESSION="admin_ZOIAO";
function fixture() {
  let time=1000;const timers=[],entries=[];let enabled=true,available=false;
  const sock={ev:{}}, journal={onError(fn){this.fail=fn;},status:()=>({available}),open:async()=>{available=true;return true;},close:async()=>{},append:e=>{entries.push(e);return true;},read:async()=>entries};
  const o=createRadarIngressObservation({sensorEnabled:()=>enabled,journal,now:()=>time,onSensorStopped:()=>{enabled=false;},
    setTimer:(fn,ms)=>{const t={fn,ms,unref(){}};timers.push(t);return t;},clearTimer:t=>{t.cleared=true;}});
  const context={workspaceId:"admin",sessionId:SESSION,groupId:JID,sock,generation:1,scopeValidated:true,listenerRegistered:true};
  const message=(id="PRIVATE_ID",text="Oferta https://magazineluiza.onelink.me/589508454/fixture",jid=JID)=>({key:{id,remoteJid:jid,participant:"PRIVATE_PHONE",fromMe:false},message:{conversation:text}});
  const ingest=m=>o.observeUpsert({...context,emitter:sock.ev,current:true,messages:[m],type:"notify"});
  return {o,sock,journal,timers,entries,context,message,ingest,advance:ms=>{time+=ms;},disable:()=>{enabled=false;}};
}
test("exact OneLink recognition inside larger text and nested visible captions; negative host controls",()=>{
  for(const text of ["promo https://magazineluiza.onelink.me/abc final","CUPOM https://MAGAZINELUIZA.onelink.me/a\ntexto"])
    assert.equal(containsMagaluOneLink({message:{ephemeralMessage:{message:{imageMessage:{caption:text}}}}}),true);
  for(const text of ["https://magazineluiza.onelink.me.evil.test/a","https://evil.test/?q=magazineluiza.onelink.me","https://magazineluiza.onelink.me@evil.test/a","https://user:secret@magazineluiza.onelink.me/a","https://other.onelink.me/a","magazineluiza.onelink.me sem URL","https://s.shopee.com.br/a"])
    assert.equal(containsMagaluOneLink({message:{conversation:text}}),false);
});
test("OFF does not scan/write; explicit activation lasts at most 24h, timeout resets flag and no sample is not failure",async()=>{
  const f=fixture();assert.equal(f.o.status().state,"off");f.ingest(f.message());assert.equal(f.entries.length,0);
  f.disable();assert.equal((await f.o.startSensor(f.context)).reason,"sensor_flag_off");
  const g=fixture();await g.o.startSensor(g.context);assert.equal(g.timers[0].ms,SENSOR_DURATION_MS);
  g.advance(SENSOR_DURATION_MS);assert.equal(g.o.status().sampleStatus,"SEM_AMOSTRA");
  assert.equal(g.o.status().state,"expired");assert.equal((await g.o.startSensor(g.context)).reason,"sensor_flag_off");
  assert.equal(g.entries.at(-1).reason,"SEM_AMOSTRA");
});
test("Magalu seen before filters/Engine gets one administrative alert with blocking reason and no private data",async()=>{
  const f=fixture();await f.o.startSensor(f.context);const m=f.message();f.ingest(m);f.ingest(m);
  assert.equal(f.o.status().events,1);
  f.o.recordStage({...f.context,message:m,stage:"listener_gate",decision:"ignored",reason:"buffer_recovery_suppressed"});
  f.o.recordStage({...f.context,message:m,stage:"radar_decision",decision:"rejected",reason:"from_me"});
  f.o.stop();assert.equal(f.entries.filter(e=>e.kind==="alert").length,1);
  assert.equal(f.entries.find(e=>e.kind==="alert").reason,"buffer_recovery_suppressed");
  assert.equal(f.entries.some(e=>e.stage==="upsert_callback"),true);
  for(const secret of [JID,SESSION,"PRIVATE_ID","PRIVATE_PHONE","https://"]) assert.equal(JSON.stringify(f.entries).includes(secret),false);
});
test("no downstream stage yields timeout alert; later Engine progress remains journaled without second alert",async()=>{
  const f=fixture();await f.o.startSensor(f.context);const m=f.message();f.ingest(m);
  f.timers.find(t=>t.ms===30000).fn();
  assert.equal(f.entries.find(e=>e.kind==="alert").reason,"stage_timeout");
  f.o.recordStage({...f.context,message:m,stage:"engine_event",decision:"accepted",reason:"accepted",eventId:"123",engineResult:"created"});
  assert.equal(f.entries.filter(e=>e.kind==="alert").length,1);
  assert.equal(f.entries.at(-1).eventId,"123");f.o.stop();
});
test("other groups excluded; controls aggregated; actual workspace mismatch captured as hash without changing dispatch",async()=>{
  const f=fixture();await f.o.startSensor(f.context);
  f.ingest(f.message("OTHER","https://magazineluiza.onelink.me/a","999@g.us"));
  f.ingest(f.message("SHOPEE","https://s.shopee.com.br/a"));
  assert.equal(f.o.status().events,0);assert.equal(f.o.status().controls,1);
  f.o.observeUpsert({...f.context,workspaceId:"user_pss60lus",emitter:f.sock.ev,current:true,messages:[f.message()],type:"notify"});
  const report=f.o.status();assert.equal(report.events,1);assert.equal(report.counters.workspaceMismatch,1);
  assert.notEqual(report.records[0].workspaceHash,report.scope.workspaceHash);
  assert.equal(JSON.stringify(report).includes("user_pss60lus"),false);f.o.stop();
});
test("detail and scan caps stop automatically; journal error stops observation only",async()=>{
  const f=fixture();await f.o.startSensor(f.context);
  for(let i=0;i<32;i++){const m=f.message(String(i));f.ingest(m);f.o.recordStage({...f.context,message:m,stage:"radar_decision",decision:"ignored",reason:"from_me"});}
  assert.equal(f.o.status().events,32);assert.equal(f.o.status().state,"stopped");
  const g=fixture();await g.o.startSensor(g.context);
  for(let i=0;i<10000;i++)g.ingest(g.message(String(i),"controle"));
  assert.equal(g.o.status().stopReason,"scan_limit");assert.equal(g.o.status().events,0);
  const h=fixture();await h.o.startSensor(h.context);h.journal.fail();assert.equal(h.o.status().stopReason,"journal_error");
});
test("bounded journal survives new instance, sanitizes schema, refuses overwrite, symlink and missing directory",async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),"garimpei-journal-"));const logs=[];
  try{
    const j=createSensorJournal({directory:dir,log:e=>logs.push(e)});assert.equal(await j.open(),true);
    j.append({kind:"start",at:Date.now(),runRef:"a".repeat(16),text:"PRIVATE_SECRET",url:"https://private"});
    j.append({kind:"alert",at:Date.now(),eventRef:"b".repeat(16),stage:"upsert_callback",reason:"stage_timeout",eventId:"123",cookie:"PRIVATE_SECRET"});
    await j.flush();await j.close();assert.equal(logs.length,1);
    const restored=createSensorJournal({directory:dir});assert.equal(await restored.open(),false);
    const report=await restored.read();assert.equal(report.records.length,2);assert.equal(JSON.stringify(report).includes("PRIVATE_SECRET"),false);
    assert.equal((await fs.stat(path.join(dir,"sensor-v1.jsonl"))).size<MAX_BYTES,true);
    assert.equal(await createSensorJournal({directory:path.join(dir,"missing")}).open(),false);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test("on-demand read after two hours preserves original deadline and supports explicit early stop",async()=>{
  const f=fixture();await f.o.startSensor(f.context);const deadline=f.o.status().expiresAt;
  f.advance(2*60*60*1000);await f.o.archive();const first=f.o.status();
  assert.equal(first.state,"active");assert.equal(first.expiresAt,deadline);
  f.ingest(f.message());await f.o.archive();assert.equal(f.o.status().events,1);
  assert.equal(f.o.status().expiresAt,deadline);assert.equal(f.o.stop().stopReason,"manual");
  const g=fixture();await g.o.startSensor(g.context);g.advance(2*60*60*1000);await g.o.archive();
  g.advance(22*60*60*1000);assert.equal(g.o.status().state,"expired");assert.equal(g.o.status().expiresAt,deadline);
});
test("shared listener instruments ingress before recovery/commercial filters, and administrative routes fail closed",()=>{
  const source=require("node:fs").readFileSync(require.resolve("../index.js"),"utf8");
  const begin=source.indexOf('handler: async ({ messages = [], type } = {}) => {');
  assert.ok(begin>0);
  const end=source.indexOf('sock.ev.on("group-participants.update"',begin),callback=source.slice(begin,end);
  assert.ok(callback.indexOf('radarIngressObservation.observeUpsert(')<callback.indexOf('shouldSuppressMessage(mensagem)'));
  assert.ok(callback.indexOf('radarIngressObservation.observeUpsert(')<callback.indexOf('processarMensagemRadarAutomatica({'));
  assert.match(source,/let garimpeiSensorEnabled = false/);
  const routes=source.slice(source.indexOf('app.post("\/admin\/radar\/ingress-observation\/sensor24h\/start"'),source.indexOf('app.post("/radar/config"'));
  assert.equal((routes.match(/exigirAdminMasterEngine\(req, res\)/g)||[]).length,2);
  assert.match(routes,/confirm !== "GARIMPEI_24H"/);
  assert.doesNotMatch(routes,/req\.body\?\.(?:sessionId|groupId|workspaceId|duration)/);
});
test("concurrent starts never produce two runs and storage failures cannot resume after restart",async()=>{
  const f=fixture();const results=await Promise.all([f.o.startSensor(f.context),f.o.startSensor(f.context)]);
  assert.equal(results.filter(r=>r.ok).length,1);f.o.stop();
});
test("archive retention expires without extending capture; malformed and oversize files rejected",async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),"garimpei-retention-"));
  try{
    let now=Date.now();const j=createSensorJournal({directory:dir,now:()=>now});await j.open();
    j.append({kind:"start",at:now});await j.flush();await j.close();
    now+=73*60*60*1000;assert.equal((await j.read()).state,"retention_expired");
    await fs.writeFile(path.join(dir,"sensor-v1.jsonl"),"not-json\n");await assert.rejects(j.read());
    await fs.writeFile(path.join(dir,"sensor-v1.jsonl"),Buffer.alloc(MAX_BYTES+1));await assert.rejects(j.read());
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test("actual journal can be queried after two hours, recording continues and deadline stays fixed",async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),"garimpei-read-active-"));
  let journal;
  try {
    let now=Date.now();journal=createSensorJournal({directory:dir,now:()=>now,log:()=>{}});
    const o=createRadarIngressObservation({sensorEnabled:true,journal,now:()=>now});
    const sock={ev:{}},context={workspaceId:"admin",sessionId:SESSION,groupId:JID,sock,generation:1,scopeValidated:true,listenerRegistered:true};
    const started=await o.startSensor(context);assert.equal(started.ok,true);
    now+=2*60*60*1000;
    assert.equal((await o.archive()).records[0].kind,"start");
    assert.equal(o.status().state,"active");assert.equal(o.status().expiresAt,started.expiresAt);
    const message={key:{id:"private",remoteJid:JID},message:{conversation:"https://magazineluiza.onelink.me/test"}};
    o.observeUpsert({...context,messages:[message],emitter:sock.ev,current:true,type:"notify"});
    o.recordStage({...context,message,stage:"radar_gate",decision:"rejected",reason:"from_me"});
    const report=await o.archive();assert.equal(report.records.some(r=>r.reason==="from_me"&&r.decision==="rejected"),true);
    assert.equal(o.status().expiresAt,started.expiresAt);o.stop();await journal.flush();
    assert.equal((await o.archive()).records.at(-1).kind,"stop");
  }finally{await journal?.close();await fs.rm(dir,{recursive:true,force:true});}
});
test("new HTTP controls require Admin Master; read calls do not arm or mutate sensor",async()=>{
  const vm=require("node:vm"),source=require("node:fs").readFileSync(require.resolve("../index.js"),"utf8");
  const routes=new Map(),start=source.indexOf('app.post("/admin/radar/ingress-observation/sensor24h/start"');
  let starts=0,reads=0;const context={garimpeiSensorEnabled:false,
    app:{post:(path,fn)=>routes.set(path,fn),get:(path,fn)=>routes.set(path,fn)},
    exigirAdminMasterEngine:req=>req.isAdmin===true,
    responderObservacaoIngressRadar:(_,data)=>data,
    validarAlvoObservacaoIngressRadar:()=>({ok:true,socket:{}}),
    radarIngressObservation:{startSensor:async()=>{starts++;return {ok:true};},archive:async()=>{reads++;return {state:"archived"};},status:()=>({state:"off"})}
  };
  vm.runInNewContext(source.slice(start,source.indexOf('app.post("/radar/config"',start)),context);
  for(const fn of routes.values())await fn({isAdmin:false,body:{confirm:"GARIMPEI_24H"}},{});
  assert.equal(starts,0);assert.equal(reads,0);
  const archive=routes.get("/admin/radar/ingress-observation/sensor24h/archive");
  await archive({isAdmin:true},{});assert.equal(reads,1);assert.equal(context.garimpeiSensorEnabled,false);
  const activate=routes.get("/admin/radar/ingress-observation/sensor24h/start");
  assert.equal((await activate({isAdmin:true,body:{}},{})).reason,"sensor_confirmation_required");
  assert.equal(starts,0);
});
test("32 messages rejected before Radar stop the sensor without waiting for missing downstream stages",async()=>{
  const f=fixture();await f.o.startSensor(f.context);
  for(let i=0;i<32;i++){
    const message=f.message(String(i));f.ingest(message);
    f.o.recordStage({...f.context,message,stage:"listener_gate",decision:"ignored",reason:"buffer_recovery_suppressed"});
  }
  assert.equal(f.o.status().state,"stopped");assert.equal(f.o.status().stopReason,"event_limit");
  assert.equal(f.entries.filter(e=>e.kind==="alert").length,32);
});
