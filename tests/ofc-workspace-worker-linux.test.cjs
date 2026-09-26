"use strict";
const test=require("node:test"), assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const {Worker}=require("node:worker_threads");
const ofc=require("../modules/engine/ofc/absorption-gate.service");
const {criarClienteWorker,fecharWorkerOfc}=require("../modules/engine/ofc/workspace-worker-client");
const {revisao,iguais}=require("../modules/engine/ofc/workspace-worker-revision");
assert.equal(process.platform,"linux","This proof requires actual Linux, not an emulation of POSIX APIs");
const temp=fs.mkdtempSync(path.join(os.tmpdir(),"ofc-posix-proof-")), now=Date.parse("2026-09-26T15:00:00Z");
const original=JSON.stringify([{id:"old",status:"pendente",criadoEm:new Date(now-60000).toISOString(),dataEntradaFila:new Date(now-60000).toISOString(),destinoId:"d",marketplace:"mercadolivre"}]);
function options(file,on) {return {workerOfc:on,agoraMs:now,clock:()=>now,usuarios:[{id:"w",creditos:100}],listarClientesAtivos:()=>["w"],destinosPorCliente:{w:[{id:"d",tipo:"telegram",botToken:"synthetic",chatId:"synthetic",ativo:true,intervaloMinutos:3}]},configsPorCliente:{w:{automacaoAtiva:true}},configPadrao:{},consultarEventosAbsorcao:async()=>({ok:true,porWorkspace:[]}),getClienteJsonPath:()=>file};}
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function fallback(file,client,extra={}) {
  let reads=0,jobs=0; const events=[], read=fs.readFileSync;
  fs.readFileSync=function(...args){if(args[0]===file)reads++;return read.apply(this,args);};
  let on;
  try {on=await ofc.criarGateAbsorcaoShadowOfc({...options(file,true),clienteWorker:{executar:input=>{jobs++;return client.executar({...input,coletaTesteMs:now},extra);}},observarWorker:e=>events.push(e)});}
  finally {fs.readFileSync=read;}
  assert.equal(jobs,1);assert.equal(reads,1,"exactly one fresh legacy read, not a retry loop");
  assert.equal(events.length,1);assert.equal(events[0].aceito,false,"no stale Worker result accepted");
  assert.deepEqual(on,await ofc.criarGateAbsorcaoShadowOfc(options(file,false)));
  return {jobs,legacyReads:reads,accepted:false};
}
test.after(async()=>{await fecharWorkerOfc();fs.rmSync(temp,{recursive:true,force:true});});
for(const mode of ["temp-write-rename","rename-original","unlink","unlink-recreate","replace-new-inode","content-size","metadata"]) {
  test("real POSIX descriptor and fresh fallback: "+mode,async()=>{
    const file=path.join(temp,mode+".json");fs.writeFileSync(file,original);
    const before=revisao(file),barrier=new SharedArrayBuffer(12),signal=new Int32Array(barrier);
    const client=criarClienteWorker({workerFactory:()=>new Worker(path.join(__dirname,"fixtures/ofc-worker-posix-barrier.cjs"),{workerData:{barrier,original}})});
    let changed=false, error, next;
    const poll=setInterval(()=>{
      if(changed||error||Atomics.load(signal,0)!==1)return;
      try {
        if(mode==="temp-write-rename"||mode==="replace-new-inode") {next=file+".tmp";fs.writeFileSync(next,"[]");fs.renameSync(next,file);}
        else if(mode==="rename-original")fs.renameSync(file,file+".old");
        else if(mode==="unlink")fs.unlinkSync(file);
        else if(mode==="unlink-recreate"){fs.unlinkSync(file);fs.writeFileSync(file,"[]");}
        else if(mode==="content-size")fs.writeFileSync(file,"[]");
        else {const s=fs.statSync(file);fs.utimesSync(file,s.atime,new Date(s.mtimeMs+10000));}
        changed=true;
      } catch(e) {error=e;}
      finally {Atomics.store(signal,0,2);Atomics.notify(signal,0);}
    },1);
    try {
      const result=await fallback(file,client);assert.equal(error,undefined);assert.equal(changed,true);
      const after=revisao(file);assert.equal(iguais(before,after),false);
      assert.equal(Atomics.load(signal,2),1,"open descriptor retains original inode");
      if(mode!=="content-size")assert.equal(Atomics.load(signal,1),1,"pinned descriptor reads exactly original bytes, never replacement bytes");
      if(["temp-write-rename","unlink-recreate","replace-new-inode"].includes(mode))assert.notEqual(before.ino,after.ino);
      console.log("LINUX_POSIX_EVIDENCE",JSON.stringify({mode,...result,before,after,pinnedOriginalBytes:Atomics.load(signal,1)===1,pinnedOriginalInode:Atomics.load(signal,2)===1}));
    } finally {clearInterval(poll);Atomics.store(signal,0,2);Atomics.notify(signal,0);await client.fechar();}
  });
}
for(const mode of ["crash","terminate","timeout","invalid","exit"])test("actual Linux Worker failsafe: "+mode,async()=>{
  const file=path.join(temp,"fail-"+mode+".json");fs.writeFileSync(file,original);let instance,termination;
  const client=criarClienteWorker({timeoutMs:500,workerFactory:()=>{
    instance=new Worker(path.join(__dirname,"fixtures/ofc-worker-linux-failure.cjs"),{workerData:{mode}});
    if(mode==="terminate")termination=(async()=>{await pause(100);await instance.terminate();})();
    return instance;
  }});
  try {const result=await fallback(file,client);await termination;
    assert.ok(instance.listenerCount("error")>=1);assert.doesNotThrow(()=>instance.emit("error",new Error("intentional late error")));
    console.log("LINUX_FAILSAFE_EVIDENCE",JSON.stringify({mode,...result,mainAlive:true}));
  } finally {await client.fechar();await termination;}
});
test("revision changed at consumer after client validates",async()=>{
  const file=path.join(temp,"consumer.json");fs.writeFileSync(file,original);const client=criarClienteWorker();let reads=0;const read=fs.readFileSync,events=[];
  fs.readFileSync=function(...args){if(args[0]===file)reads++;return read.apply(this,args);};
  try {
    const on=await ofc.criarGateAbsorcaoShadowOfc({...options(file,true),clienteWorker:{executar:async input=>{const result=await client.executar({...input,coletaTesteMs:now});queueMicrotask(()=>{const next=file+".tmp";fs.writeFileSync(next,"[]");fs.renameSync(next,file);});return result;}},observarWorker:e=>events.push(e)});
    assert.equal(reads,1);assert.equal(events[0].aceito,false);fs.readFileSync=read;
    assert.deepEqual(on,await ofc.criarGateAbsorcaoShadowOfc(options(file,false)));
  } finally {fs.readFileSync=read;await client.fechar();}
});
for(const [mode,content] of [["absent",null],["corrupt","{"],["non-array","{}"]])test("Linux source contract equivalent: "+mode,async()=>{
  const file=path.join(temp,"source-"+mode+".json");if(content!==null)fs.writeFileSync(file,content);const client=criarClienteWorker();const events=[];
  try {const off=await ofc.criarGateAbsorcaoShadowOfc(options(file,false));const on=await ofc.criarGateAbsorcaoShadowOfc({...options(file,true),clienteWorker:{executar:input=>client.executar({...input,coletaTesteMs:now})},observarWorker:e=>events.push(e)});
    assert.deepEqual(on,off);assert.equal(events[0].aceito,true);assert.equal(on.workspaces[0].fonteFilaValida,false);
    // Invalid source is a legacy data contract, not a Worker crash: no unnecessary fallback.
  } finally {await client.fechar();}
});
