"use strict";
const {performance,monitorEventLoopDelay}=require("node:perf_hooks");
const fs=require("node:fs/promises"),os=require("node:os"),path=require("node:path");
const {createSensorJournal}=require("../modules/radar/ingress-sensor-journal");
const {createRadarIngressObservation}=require("../modules/radar/ingress-observation-v1");
async function main(){
  const sock={ev:{}},context={workspaceId:"admin",sessionId:"admin_ZOIAO",groupId:"123@g.us",sock,generation:1,scopeValidated:true,listenerRegistered:true};
  const journal={onError(){},status:()=>({available:true}),open:async()=>true,append:()=>true,close:async()=>{}};
  const results=[];
  for(const mode of ["off","control","magalu"]){
    const o=createRadarIngressObservation({sensorEnabled:true,journal});if(mode!=="off")await o.startSensor(context);
    const samples=[],count=mode==="magalu"?32:10000,before=process.memoryUsage().heapUsed;
    for(let i=0;i<count;i++){
      const m={key:{id:String(i),remoteJid:context.groupId},message:{conversation:mode==="magalu"?"oferta https://magazineluiza.onelink.me/abc":"controle https://s.shopee.com.br/abc"}};
      const at=performance.now();o.observeUpsert({...context,emitter:sock.ev,current:true,messages:[m],type:"notify"});samples.push(performance.now()-at);
    }
    o.stop();samples.sort((a,b)=>a-b);results.push({mode,count,p50ms:samples[Math.floor(count*.5)],p95ms:samples[Math.floor(count*.95)],maxms:samples.at(-1),heapDelta:process.memoryUsage().heapUsed-before});
  }
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),"sensor-benchmark-"));
  let durability;
  try {
    const j=createSensorJournal({directory:dir,log:()=>{}});await j.open();
    const delay=monitorEventLoopDelay({resolution:10});delay.enable();
    const at=performance.now(),cpu=process.cpuUsage(),mem=process.memoryUsage();
    j.append({kind:"start",at:Date.now()});
    for(let i=0;i<32;i++) for(let n=0;n<16;n++)j.append({kind:"stage",at:Date.now(),stage:"radar_gate",eventRef:i.toString(16).padStart(16,"0"),reason:"accepted"});
    await j.flush();const elapsedMs=performance.now()-at;
    delay.disable();durability={elapsedMs,lines:j.status().lines,bytes:j.status().bytes,cpuMicros:process.cpuUsage(cpu),rssDelta:process.memoryUsage().rss-mem.rss,eventLoopMaxMs:delay.max/1e6};
    if(j.status().failed)throw Error("journal_benchmark_failed");await j.close();
  }finally{await fs.rm(dir,{recursive:true,force:true});}
  console.log(JSON.stringify({node:process.version,scope:"synthetic bounded CPU + 513 durable journal writes; not production load proof",results,durability},null,2));
  if(results.some(r=>r.p95ms>5))process.exitCode=1;
}
main();
