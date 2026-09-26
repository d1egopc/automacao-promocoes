"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { Worker } = require("node:worker_threads");
const ofc = require("../modules/engine/ofc/absorption-gate.service");
const { criarClienteWorker, fecharWorkerOfc } = require("../modules/engine/ofc/workspace-worker-client");
const { revisao } = require("../modules/engine/ofc/workspace-worker-revision");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ofc-worker-"));
const now = Date.parse("2026-09-26T15:00:00Z");
const destination = { id: "d", tipo: "telegram", botToken: "synthetic", chatId: "synthetic",
  horarioInicio: "00:00", horarioFim: "23:59", ativo: true, intervaloMinutos: 3 };
function item(age, extra = {}) { return { id: "x", status: "pendente", criadoEm: new Date(now-age).toISOString(),
  dataEntradaFila: new Date(now-age).toISOString(), destinoId: "d", marketplace: "mercadolivre", ...extra }; }
function options(file, enabled, clock = now, destinations = [destination]) {
  return { workerOfc: enabled, agoraMs: clock, clock: () => clock,
    usuarios: [{ id: "w", creditos: 100 }], listarClientesAtivos: () => ["w"],
    destinosPorCliente: { w: destinations }, configsPorCliente: { w: { automacaoAtiva: true } },
    configPadrao: {}, consultarEventosAbsorcao: async () => ({ ok: true, porWorkspace: [] }),
    getClienteJsonPath: () => file };
}
function fixedClient(client, time, hook) { return { executar: input => client.executar({ ...input, coletaTesteMs: time }, { beforeAccept: hook }) }; }
async function equivalent(file, time = now, destinations = [destination]) {
  const client = criarClienteWorker(), events = [];
  try {
    const off = await ofc.criarGateAbsorcaoShadowOfc(options(file, false, time, destinations));
    const on = await ofc.criarGateAbsorcaoShadowOfc({ ...options(file, true, time, destinations),
      clienteWorker: fixedClient(client, time), observarWorker: e => events.push(e) });
    assert.deepEqual(on, off); assert.equal(events.length, 1); assert.equal(events[0].aceito, true);
    assert.equal(on.modo, "shadow"); assert.equal(on.aplicouMudancas, false);
    return { result: on, perf: events[0].perf };
  } finally { await client.fechar(); }
}
test.after(async () => { await fecharWorkerOfc(); fs.rmSync(temp, { recursive: true, force: true }); });

for (const [name, content] of [["empty", "[]"], ["invalid-json", "{"], ["invalid-format", "{}"], ["blank", ""], ["missing", null]]) {
  test("full OFF/ON deepEqual " + name, async () => {
    const file = path.join(temp, name + ".json"); if (content !== null) fs.writeFileSync(file, content);
    await equivalent(file);
  });
}
for (const ttl of [600000,1800000]) for (const delta of [-1,0,1]) {
  test("TTL " + ttl + " boundary " + delta, async () => {
    const file = path.join(temp, "ttl.json"); fs.writeFileSync(file, JSON.stringify([item(ttl+delta, { cupomTurbo: ttl === 600000 })]));
    const { result } = await equivalent(file); assert.equal(result.workspaces[0].queueDepthActionable, delta < 0 ? 1 : 0);
  });
}
for (const timezone of ["UTC", "America/Sao_Paulo"]) for (const iso of ["2026-09-26T14:59:59.999Z", "2026-09-26T15:00:00Z", "2026-09-26T15:01:59.999Z", "2026-09-26T15:02:00Z", "2026-09-27T02:59:59.999Z", "2026-09-27T03:00:00Z"]) {
  test(timezone + " window/minute/day " + iso, async () => {
    const previous = process.env.TZ; process.env.TZ = timezone;
    try {
      const file = path.join(temp, "window.json"); fs.writeFileSync(file, JSON.stringify([item(60000)]));
      await equivalent(file, Date.parse(iso), [{ ...destination, horarioInicio: "12:00", horarioFim: "12:01" }]);
    } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
  });
}

class FakeWorker extends EventEmitter {
  ref() {} unref() {} async terminate() { this.emit("exit", 1); }
}
for (const mode of ["crash", "exit", "timeout", "invalid", "post-fails", "messageerror"]) {
  test("one fresh legacy fallback: " + mode, async () => {
    const file = path.join(temp, mode + ".json"); fs.writeFileSync(file, JSON.stringify([item(60000)]));
    let jobs = 0, reads = 0, instance;
    const client = criarClienteWorker({ timeoutMs: 30, workerFactory: () => {
      instance = new FakeWorker(); instance.postMessage = () => {
        jobs++; if (mode === "post-fails") throw new Error("clone_error");
        if (mode !== "timeout") queueMicrotask(() => mode === "crash" ? instance.emit("error", new Error("crash"))
          : mode === "exit" ? instance.emit("exit", 0) : mode === "messageerror" ? instance.emit("messageerror", new Error("clone error")) : instance.emit("message", { ok: true }));
      }; return instance;
    }});
    const originalRead = fs.readFileSync;
    try {
      const expected = await ofc.criarGateAbsorcaoShadowOfc(options(file, false));
      fs.readFileSync = function(...args) { if (args[0] === file) reads++; return originalRead.apply(this,args); };
      const result = await ofc.criarGateAbsorcaoShadowOfc({ ...options(file, true), clienteWorker: fixedClient(client, now) });
      assert.deepEqual(result, expected); assert.equal(jobs, 1); assert.equal(reads, 1);
      assert.doesNotThrow(() => instance.emit("error", new Error("late error after cleanup")));
    } finally { fs.readFileSync = originalRead; await client.fechar(); }
  });
}

for (const mode of ["mutate", "rename", "delete", "appear"]) {
  test("discard revision changed before acceptance + fresh fallback: " + mode, async () => {
    const file = path.join(temp, mode + "-revision.json");
    if (mode !== "appear") fs.writeFileSync(file, JSON.stringify([item(60000)]));
    const client = criarClienteWorker(); let jobs = 0;
    try {
      const barrier = () => {
        jobs++;
        if (mode === "delete") fs.unlinkSync(file);
        else if (mode === "rename") { const next = file + ".tmp"; fs.writeFileSync(next, "[]"); fs.renameSync(next,file); }
        else fs.writeFileSync(file, "[]");
      };
      const on = await ofc.criarGateAbsorcaoShadowOfc({ ...options(file,true), clienteWorker: fixedClient(client,now,barrier) });
      const off = await ofc.criarGateAbsorcaoShadowOfc(options(file,false));
      assert.deepEqual(on,off); assert.equal(jobs,1);
    } finally { await client.fechar(); }
  });
}

test("same Worker reused, jobs serial, no database modules imported", async () => {
  const file=path.join(temp,"serial.json");fs.writeFileSync(file,"[]");
  let created=0;
  const client=criarClienteWorker({workerFactory:()=>{created++;return new Worker(path.join(__dirname,"../modules/engine/ofc/workspace-worker.js"));}});
  try {
    const jobs=Array.from({length:12},(_,i)=>ofc.criarGateAbsorcaoShadowOfc({...options(file,true,now+i),clienteWorker:fixedClient(client,now+i)}));
    const results=await Promise.all(jobs); assert.equal(created,1);
    for(let i=0;i<results.length;i++)assert.deepEqual(results[i],await ofc.criarGateAbsorcaoShadowOfc(options(file,false,now+i)));
    assert.ok(!Object.keys(require.cache).some(k=>k.includes("absorption-gate.repository")||k.includes("drainage-metrics.repository")));
  } finally {await client.fechar();}
});

module.exports={options,fixedClient,equivalent};

test("Worker has no database/write capability use and receives no user secrets", async () => {
  const file=path.join(temp,"guard.json");fs.writeFileSync(file,JSON.stringify([item(60000)]));
  const client=criarClienteWorker({workerFactory:()=>new Worker(path.join(__dirname,"fixtures/ofc-worker-readonly-guard.js"))});
  try {
    let seen;
    const on=await ofc.criarGateAbsorcaoShadowOfc({...options(file,true),
      usuarios:[{id:"w",creditos:100,passwordHash:"must-not-cross",email:"must-not-cross"}],
      clienteWorker:{executar:input=>{seen=input;return client.executar({...input,coletaTesteMs:now});}}});
    assert.deepEqual(on,await ofc.criarGateAbsorcaoShadowOfc(options(file,false)));
    assert.equal(seen.usuario.passwordHash,undefined);assert.equal(seen.usuario.email,undefined);
    assert.equal(seen.destinos[0].botToken,true);
  } finally {await client.fechar();}
});

test("destination projection preserves aliases and disabled/limited/Turbo configurations", async () => {
  const file=path.join(temp,"destinations.json");fs.writeFileSync(file,JSON.stringify([item(60000)]));
  await equivalent(file,now,[destination,
    {id:"wa",tipo:"whatsapp",ativo:true,intervalo:2.5,turbo:true,horarioInicial:"12:00",horarioFinal:"12:01",enviosRestantesHoje:5},
    {destinoId:"limit",canal:"telegram",botToken:"synthetic",limite_diario:1,enviadosHoje:1,horaInicial:"12:00",horaFinal:"12:01"},
    {id:"inactive",tipo:"discord",ativo:false,cookiesVencidos:true},
    {id:"expired",tipo:"telegram",botToken:"synthetic",statusIntegracao:"vencido"}]);
});

test("consumer revalidates again after async return, before using summary", async () => {
  const file=path.join(temp,"consumer.json");fs.writeFileSync(file,JSON.stringify([item(60000)]));
  const client=criarClienteWorker();let pathCalls=0;const events=[];
  try {
    const on=await ofc.criarGateAbsorcaoShadowOfc({...options(file,true),
      clienteWorker:{executar:async input=>{const r=await client.executar({...input,coletaTesteMs:now});queueMicrotask(()=>fs.writeFileSync(file,"[]"));return r;}},
      observarWorker:e=>events.push(e),getClienteJsonPath:()=>{pathCalls++;return file;}});
    assert.deepEqual(on,await ofc.criarGateAbsorcaoShadowOfc(options(file,false)));
    assert.equal(pathCalls,2);assert.equal(events.length,1);assert.equal(events[0].aceito,false);
  } finally {await client.fechar();}
});

test("observer rejection cannot change accepted result or leave orphan promise", async () => {
  const file=path.join(temp,"observer.json");fs.writeFileSync(file,"[]");const client=criarClienteWorker();
  try {
    const on=await ofc.criarGateAbsorcaoShadowOfc({...options(file,true),clienteWorker:fixedClient(client,now),observarWorker:async()=>{throw new Error("diagnostic unavailable");}});
    assert.deepEqual(on,await ofc.criarGateAbsorcaoShadowOfc(options(file,false)));
  } finally {await client.fechar();}
});

test("default flag OFF never creates a Worker", async () => {
  const file=path.join(temp,"default-off.json");fs.writeFileSync(file,"[]");
  const o=options(file,false);delete o.workerOfc;
  const previous=process.env.OFC_READONLY_WORKER;delete process.env.OFC_READONLY_WORKER;
  let attempts=0, observations=0;
  try {
    const on=await ofc.criarGateAbsorcaoShadowOfc({...o,clienteWorker:{executar:()=>{attempts++;throw new Error("must not reach Worker");}},observarWorker:()=>{observations++;}});
    assert.deepEqual(on,await ofc.criarGateAbsorcaoShadowOfc(options(file,false)));
    assert.equal(attempts,0);assert.equal(observations,0);
  } finally {if(previous===undefined)delete process.env.OFC_READONLY_WORKER;else process.env.OFC_READONLY_WORKER=previous;}
});

test("environment flag ON enables one job; explicit OFF overrides it", async () => {
  const file=path.join(temp,"flag.json");fs.writeFileSync(file,"[]");const client=criarClienteWorker();let attempts=0;
  const previous=process.env.OFC_READONLY_WORKER;process.env.OFC_READONLY_WORKER="true";
  try {
    const o=options(file,true);delete o.workerOfc;
    const wrapped={executar:input=>{attempts++;return client.executar({...input,coletaTesteMs:now});}};
    const on=await ofc.criarGateAbsorcaoShadowOfc({...o,clienteWorker:wrapped});
    const off=await ofc.criarGateAbsorcaoShadowOfc({...options(file,false),clienteWorker:wrapped});
    assert.deepEqual(on,off);assert.equal(attempts,1);
  } finally {await client.fechar();if(previous===undefined)delete process.env.OFC_READONLY_WORKER;else process.env.OFC_READONLY_WORKER=previous;}
});

test("concurrent jobs from distinct workspaces cannot cross results", async () => {
  const file=path.join(temp,"distinct-workspaces.json");fs.writeFileSync(file,JSON.stringify([item(60000)]));const client=criarClienteWorker();
  const make=(id,enabled,credits)=>({...options(file,enabled),usuarios:[{id,creditos:credits}],listarClientesAtivos:()=>[id],
    destinosPorCliente:{[id]:[destination]},configsPorCliente:{[id]:{automacaoAtiva:true}},clienteWorker:fixedClient(client,now)});
  try {
    const [a,b]=await Promise.all([ofc.criarGateAbsorcaoShadowOfc(make("a",true,100)),ofc.criarGateAbsorcaoShadowOfc(make("b",true,0))]);
    assert.deepEqual(a,await ofc.criarGateAbsorcaoShadowOfc(make("a",false,100)));
    assert.deepEqual(b,await ofc.criarGateAbsorcaoShadowOfc(make("b",false,0)));
  } finally {await client.fechar();}
});

test("executor classification config changes during job => legacy fallback", async () => {
  const file=path.join(temp,"config-change.json");fs.writeFileSync(file,JSON.stringify([item(60000)]));
  const client=criarClienteWorker(), config={w:{automacaoAtiva:true}};const events=[];
  try {
    const o={...options(file,true),configsPorCliente:config,
      clienteWorker:fixedClient(client,now,()=>{config.w.automacaoAtiva=false;}),observarWorker:e=>events.push(e)};
    const on=await ofc.criarGateAbsorcaoShadowOfc(o);
    assert.deepEqual(on,await ofc.criarGateAbsorcaoShadowOfc({...options(file,false),configsPorCliente:config}));
    assert.equal(events[0].aceito,false);
  } finally {await client.fechar();}
});

test("uncertain descriptor revision is discarded, not accepted as source failure", async () => {
  const file=path.join(temp,"revision-uncertain.json");fs.writeFileSync(file,JSON.stringify([item(60000)]));
  const client=criarClienteWorker({workerFactory:()=>new Worker(path.join(__dirname,"fixtures/ofc-worker-readonly-guard.js"),{workerData:{revisionFault:true}})});
  const events=[];
  try {
    const on=await ofc.criarGateAbsorcaoShadowOfc({...options(file,true),clienteWorker:fixedClient(client,now),observarWorker:e=>events.push(e)});
    assert.deepEqual(on,await ofc.criarGateAbsorcaoShadowOfc(options(file,false)));
    assert.equal(events.length,1);assert.equal(events[0].aceito,false);
  } finally {await client.fechar();}
});

for (const mode of ["rename", "mutate"]) test("revision changes during descriptor read: " + mode, async () => {
  const file = path.join(temp, "during-" + mode + ".json"); fs.writeFileSync(file, JSON.stringify([item(60000)]));
  const barrier = new SharedArrayBuffer(4), flag = new Int32Array(barrier);
  // Windows forbids rename of an open descriptor. Pause after close/before parse there;
  // POSIX tests rename between open and read on the pinned descriptor.
  const stage = mode === "rename" && process.platform === "win32" ? "afterClose" : "beforeRead";
  const client = criarClienteWorker({ workerFactory: () => new Worker(path.join(__dirname,"fixtures/ofc-worker-read-barrier.js"), { workerData: { barrier, stage } }) });
  let changed = false;
  let fixtureError;
  const poll = setInterval(() => {
    if (changed || fixtureError || Atomics.load(flag,0) !== 1) return;
    try {
      if (mode === "rename") { const next = file + ".next"; fs.writeFileSync(next,"[]"); fs.renameSync(next,file); }
      else fs.writeFileSync(file,"[]");
      changed = true;
    } catch (e) { fixtureError = e; }
    finally { Atomics.store(flag,0,2); Atomics.notify(flag,0); }
  }, 1);
  try {
    const events = [];
    const on = await ofc.criarGateAbsorcaoShadowOfc({ ...options(file,true), clienteWorker: fixedClient(client,now), observarWorker: e=>events.push(e) });
    assert.equal(fixtureError,undefined); assert.equal(changed,true); assert.equal(events[0].aceito,false);
    assert.deepEqual(on,await ofc.criarGateAbsorcaoShadowOfc(options(file,false)));
  } finally { clearInterval(poll); await client.fechar(); }
});
