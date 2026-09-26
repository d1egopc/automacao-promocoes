"use strict";
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict"),{spawnSync}=require("node:child_process");
const root=path.resolve(__dirname,".."), mode=process.argv[2], output=path.resolve(process.env.OFC_LINUX_EVIDENCE_DIR||path.join(require("node:os").tmpdir(),"ofc-linux-evidence"));
fs.mkdirSync(output,{recursive:true});
const env={...process.env,DATABASE_URL:"",FILA_CHECKPOINT_TEST_DATABASE_URL:"",OFC_READONLY_WORKER:"false",NODE_PATH:path.join(root,"node_modules")};
function execute(file,dir=root,extra={}) {const r=spawnSync(process.execPath,[path.join(dir,"tests",file)],{cwd:dir,env:{...env,...extra},encoding:"utf8",timeout:120000,maxBuffer:16*1024*1024});assert.equal(r.error,undefined);return r;}
function save(name,value){fs.writeFileSync(path.join(output,name),JSON.stringify(value,null,2));}
if(mode==="fixtures") {
  assert.equal(process.platform,"linux");
  const directory=path.resolve(process.env.OFC_LINUX_FIXTURES_DIR);fs.mkdirSync(directory,{recursive:true});
  const now=Date.parse("2026-09-26T15:00:00Z"), report=[];
  for(const size of [50,170,345]) {
    const file=path.join(directory,`synthetic-${size}MB.json`),fd=fs.openSync(file,"wx");let bytes=1,n=0;fs.writeSync(fd,"[");
    try {while(bytes<size*1000000-110000) {
      const historical=n%6!==1,created=new Date(now-(historical?80*3600000:60000)).toISOString();
      const row=JSON.stringify({id:"synthetic-"+n,status:historical?"enviado":"pendente",criadoEm:created,dataEntradaFila:created,destinoId:"synthetic-destination",marketplace:"mercadolivre",titulo:"Synthetic fixture only",_syntheticPayload:"x".repeat(100000)});
      bytes+=fs.writeSync(fd,(n?",":"")+row);n++;
    } bytes+=fs.writeSync(fd,"]");}finally{fs.closeSync(fd);}
    report.push({size,fileBytes:fs.statSync(file).size,records:n,synthetic:true});
  }save("fixtures.json",report);console.log(JSON.stringify(report));
} else if(mode==="regressions") {
  const files=["ofc-workspace-worker.test.js","ofc-workspace-temporal.test.js","ofc-fase-1d-observabilidade.test.js","safe-redirect-http-lifecycle.test.js","dynamic-link-resolvers.test.js","clean-install-bootstrap.test.js","financeiro-bootstrap-schema.test.js","platform-variables-v1.test.js","google-platform-config.test.js","mercadopago-platform-variables.test.js","financeiro-mercadopago-pix-v1.test.js","financeiro-checkout-pix-publico-v1.test.js","link-optimus-repository.test.js","link-optimus-admin-config.test.js","ofc-absorption-gate-shadow.test.js","ofc-buffer-vivo-workspace-shadow.test.js","auto-gate-shadow.test.js","ofc-active-queue-shadow.test.js","ofc-commercial-flow-shadow.test.js","ofc-live-flow-shadow.test.js","ofc-operacional-v2-shadow.test.js","ofc-gate-ativo-piloto.test.js","ofc-v24-fundacao.test.js","ofc-v24-normalizador-comercial.test.js","ofc-v24-espelho-comercial.test.js"];
  const report={node:process.version,platform:process.platform,tests:[],known:[]};
  for(const file of files) {
    const r=execute(file,root,file==="ofc-workspace-temporal.test.js"?{OFC_TEMPORAL_BASELINE_ROOT:process.env.OFC_CLOCK_BASELINE_ROOT}:{});
    fs.writeFileSync(path.join(output,file+".log"),r.stdout+r.stderr);
    report.tests.push({file,exit:r.status,summary:r.stdout.split(/\r?\n/).filter(l=>/^# (tests|pass|fail|skipped)|^ℹ (tests|pass|fail|skipped)/.test(l))});
    console.log(JSON.stringify(report.tests.at(-1)));save("regressions.json",report);
    assert.equal(r.status,0,file+" failed: "+r.stderr.slice(-1500));
  }
  const baseline=path.resolve(process.env.OFC_WORKER_BASELINE_ROOT);
  for(const [file,marker] of [["ofc-shadow-planner.test.js","Fase 0 nao pode alterar a busca atual do Worker"],["ofc-renderer-oficial-isolamento.test.js","Universal vazio reutiliza mensagem existente"],["ofc-v24-espelho-piloto.test.js",'assert(mensagem.includes("Resgate:"))']]) {
    assert.equal(fs.readFileSync(path.join(root,"tests",file),"utf8"),fs.readFileSync(path.join(baseline,"tests",file),"utf8"));
    const rows=[baseline,root].map(dir=>{const r=execute(file,dir);assert.equal(r.status,1);const start=r.stderr.indexOf("AssertionError");assert.ok(start>=0&&r.stderr.includes(marker));return {exit:r.status,signature:r.stderr.slice(start).split(dir).join("<ROOT>").replaceAll("\r\n","\n")};});
    assert.equal(rows[0].signature,rows[1].signature);
    report.known.push({file,marker,baselineExit:rows[0].exit,candidateExit:rows[1].exit,identical:true});console.log(JSON.stringify(report.known.at(-1)));
  }save("regressions.json",report);
} else if(mode==="stress") {
  assert.equal(process.platform,"linux");
  const fixture=path.join(process.env.OFC_LINUX_FIXTURES_DIR,"synthetic-345MB.json");
  const r=spawnSync(process.execPath,["--expose-gc",path.join(root,"scripts/benchmark-ofc-workspace-worker.cjs"),"--child","on",fixture,"100"],{cwd:root,env,encoding:"utf8",timeout:900000,maxBuffer:16*1024*1024});
  assert.equal(r.error,undefined);assert.equal(r.status,0,r.stderr);const data=JSON.parse(r.stdout);
  assert.equal(data.created,1);assert.equal(data.repeats,100);assert.deepEqual(data.databaseModules,[]);
  // An exception/fallback leaves perf.memory/heapFinal absent and must fail this proof.
  for(const row of data.rows){assert.equal(row.resultHash,data.rows[0].resultHash);assert.ok(Array.isArray(row.perf.memory));assert.ok(Number.isFinite(row.perf.heapFinal));}
  data.proof={sameWorker:true,completedJobs:100,fallbacks:0,unexpectedExits:0,timeouts:0,allSummaryHashesEqual:true};save("stress-100.json",data);
  console.log(JSON.stringify({proof:data.proof,baseline:data.baseline,maxRssBytes:Math.max(...data.rows.map(r=>r.processHighWaterRssBytes)),afterWorkerExit:data.afterWorkerExit,memoryFirst:data.memory[0],memoryMiddle:data.memory[49],memoryLast:data.memory[99],maxLagMs:Math.max(...data.rows.map(r=>r.lagMaxMs)),eventLoopDelayP95Ms:data.eventLoopDelayP95Ms,wallAccumulatedMs:data.rows.reduce((s,r)=>s+r.wallMs,0)}));
} else throw new Error("unknown validation mode");
