"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const terminalIndex = require("../modules/fila/terminal-index-shadow");
const { construirTerminalIndex } = require("../modules/fila/terminal-index-worker");
const { criarCoordenadorPersistencia } = require("../modules/fila/persistence-coordinator");
const { OP_PREPARE, RESPONSE_OK, RESPONSE_ERROR } = require("../modules/fila/persistence-protocol");

const operational = {
  normalizarEntradasViva(items) {
    const item = items[0] || {};
    const status = String(item.status || item.estado || "").toLowerCase();
    return [{ bucket: ["retida", "erro", "enviado", "cancelado"].includes(status) ? "historico" : "viva", status }];
  },
  identidadePrimariaExataFilaV2(item = {}) {
    return item.id ? `id:${item.id}` : "";
  },
  rankStatusFilaV2(status = "") {
    return { retida: 1, erro: 2, enviado: 3, cancelado: 4 }[String(status).toLowerCase()] || 0;
  }
};

function fixture(prefix = "terminal-index-v111-", cliente = "workspace_wolf_test") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const dir = path.join(root, "clientes", cliente);
  const incremental = path.join(dir, terminalIndex.TERMINAL_INDEX_INCREMENTAL_DIR);
  fs.mkdirSync(incremental, { recursive: true });
  const legacy = path.join(dir, terminalIndex.TERMINAL_INDEX_LEGACY_FILE);
  const jsonl = path.join(incremental, "2026-09-28.jsonl");
  fs.writeFileSync(legacy, JSON.stringify([{ id: "legacy-retida", status: "retida" }]), "utf8");
  fs.writeFileSync(jsonl, `${JSON.stringify({ item: { id: "seed", status: "enviado" } })}\n`, "utf8");
  return { root, cliente, dir, incremental, legacy, jsonl, limpar: () => fs.rmSync(root, { recursive: true, force: true }) };
}

function bootstrap(f, revision = "v111-bootstrap-0001") {
  return construirTerminalIndex({
    operation: "terminal_index_bootstrap",
    clienteId: f.cliente,
    checkpointRevision: revision,
    targetGeneration: 10,
    dataDir: f.root,
    nowMs: Date.parse("2026-09-28T12:00:00.000Z")
  }, { operacional: operational });
}

function deps(f, extra = {}) {
  return {
    env: { FILA_TERMINAL_INDEX_SHADOW: "1" },
    fs,
    getClientePath: () => f.dir,
    ...extra
  };
}

function replaceFile(file, content) {
  const renamed = `${file}.saved-${process.pid}`;
  fs.renameSync(file, renamed);
  fs.writeFileSync(file, content, "utf8");
  fs.rmSync(renamed, { force: true });
}

async function testDeltaSafetyClassification() {
  const appendOnly = fixture("ti111-append-");
  try {
    bootstrap(appendOnly);
    fs.appendFileSync(appendOnly.jsonl, `${JSON.stringify({ item: { id: "tail-safe", status: "retida" } })}\n`);
    const validation = terminalIndex.validarTerminalIndex(appendOnly.cliente, deps(appendOnly));
    const result = terminalIndex.classificarRecuperacaoTerminalIndex(appendOnly.cliente, deps(appendOnly), validation);
    assert.strictEqual(result.tipo, "delta_safe");
    assert.strictEqual(result.motivo, "append_only_sources");
  } finally { appendOnly.limpar(); }

  const rotation = fixture("ti111-rotation-");
  try {
    bootstrap(rotation);
    fs.writeFileSync(path.join(rotation.incremental, "2026-09-29.jsonl"), `${JSON.stringify({ item: { id: "rotated", status: "enviado" } })}\n`);
    assert.strictEqual(terminalIndex.classificarRecuperacaoTerminalIndex(rotation.cliente, deps(rotation)).tipo, "delta_safe");
  } finally { rotation.limpar(); }

  const truncated = fixture("ti111-truncate-");
  try {
    bootstrap(truncated);
    fs.writeFileSync(truncated.jsonl, "");
    assert.strictEqual(terminalIndex.classificarRecuperacaoTerminalIndex(truncated.cliente, deps(truncated)).tipo, "bootstrap_required");
  } finally { truncated.limpar(); }

  const replaced = fixture("ti111-replace-");
  try {
    bootstrap(replaced);
    replaceFile(replaced.jsonl, `${JSON.stringify({ item: { id: "replacement", status: "enviado" } })}\n`);
    const result = terminalIndex.classificarRecuperacaoTerminalIndex(replaced.cliente, deps(replaced));
    assert.strictEqual(result.tipo, "bootstrap_required", "replace/inode change deve exigir bootstrap");
  } finally { replaced.limpar(); }

  const legacyChanged = fixture("ti111-legacy-");
  try {
    bootstrap(legacyChanged);
    fs.writeFileSync(legacyChanged.legacy, JSON.stringify([{ id: "legacy-retida", status: "enviado" }, { id: "new", status: "retida" }]));
    assert.strictEqual(terminalIndex.classificarRecuperacaoTerminalIndex(legacyChanged.cliente, deps(legacyChanged)).motivo, "legacy_source_changed");
  } finally { legacyChanged.limpar(); }

  const proofMissing = fixture("ti111-no-proof-");
  try {
    bootstrap(proofMissing);
    fs.rmSync(path.join(proofMissing.dir, terminalIndex.TERMINAL_INDEX_PROOF_FILE));
    assert.strictEqual(terminalIndex.classificarRecuperacaoTerminalIndex(proofMissing.cliente, deps(proofMissing)).tipo, "bootstrap_required");
  } finally { proofMissing.limpar(); }

  const corruptIndex = fixture("ti111-corrupt-index-");
  try {
    bootstrap(corruptIndex);
    fs.writeFileSync(path.join(corruptIndex.dir, terminalIndex.TERMINAL_INDEX_FILE), "{bad json");
    assert.strictEqual(terminalIndex.classificarRecuperacaoTerminalIndex(corruptIndex.cliente, deps(corruptIndex)).tipo, "bootstrap_required");
  } finally { corruptIndex.limpar(); }
}

async function testShadowRecoveryCoalescesAndKeepsAuthorityOff() {
  const f = fixture("ti111-shadow-");
  const logs = [];
  let deltaCalls = 0;
  let bootstrapCalls = 0;
  let resolveDelta;
  try {
    const initial = bootstrap(f);
    assert.strictEqual(initial.ok, true);
    fs.appendFileSync(f.jsonl, `${JSON.stringify({ item: { id: "natural-tail", status: "retida" } })}\n`);
    const injected = deps(f, {
      logger: { log: (_tag, line) => logs.push(String(line)) },
      agendarTerminalIndexDelta: () => {
        deltaCalls += 1;
        return new Promise(resolve => { resolveDelta = resolve; });
      },
      agendarTerminalIndexBootstrap: () => { bootstrapCalls += 1; return Promise.resolve({ ok: true }); }
    });
    let last;
    for (let i = 0; i < 100; i += 1) {
      last = terminalIndex.avaliarTerminalIndexShadow(f.cliente, "sensitive-commercial-id", { provado: false }, injected);
    }
    assert.strictEqual(last.maintenance.tipo, "delta");
    assert.strictEqual(deltaCalls, 1, "100 avaliações stale devem coalescer em um sinal");
    assert.strictEqual(bootstrapCalls, 0, "append-only stale não deve pedir bootstrap");
    assert.strictEqual(last.validacao?.index?.authorityEligible, undefined);
    resolveDelta({ ok: true, accepted: true });
    await new Promise(resolve => setImmediate(resolve));
    const records = logs.filter(line => line.includes("delta_signal_") || line.includes("delta_signal_recovery")).join("\n");
    assert(records.includes(terminalIndex.workspaceHash(f.cliente)));
    assert.strictEqual(records.includes(f.cliente), false, "telemetria não registra clienteId literal");
    assert.strictEqual(records.includes("sensitive-commercial-id"), false, "telemetria não registra identidade comercial");
  } finally {
    terminalIndex.resetarTerminalIndexShadowParaTeste();
    f.limpar();
  }
}

async function testShadowOffSchedulesNothing() {
  const f = fixture("ti111-shadow-off-");
  let deltaCalls = 0;
  let bootstrapCalls = 0;
  try {
    const result = terminalIndex.avaliarTerminalIndexShadow(f.cliente, "id", {}, deps(f, {
      env: { FILA_TERMINAL_INDEX_SHADOW: "0" },
      agendarTerminalIndexDelta: () => { deltaCalls += 1; return Promise.resolve({ ok: true }); },
      agendarTerminalIndexBootstrap: () => { bootstrapCalls += 1; return Promise.resolve({ ok: true }); }
    }));
    assert.strictEqual(result.ativo, false);
    assert.strictEqual(deltaCalls, 0);
    assert.strictEqual(bootstrapCalls, 0);
  } finally { f.limpar(); }
}

async function testBootstrapThrottleOnlyAfterAcceptance() {
  const f = fixture("ti111-throttle-");
  let calls = 0;
  try {
    const injected = deps(f, {
      env: { FILA_TERMINAL_INDEX_SHADOW: "1", FILA_TERMINAL_INDEX_BOOTSTRAP_INTERVAL_MS: "60000" },
      agendarTerminalIndexBootstrap: () => {
        calls += 1;
        return Promise.resolve(calls === 1 ? { ok: false, motivo: "backpressure" } : { ok: true, accepted: true });
      }
    });
    terminalIndex.avaliarTerminalIndexShadow(f.cliente, "", {}, injected);
    terminalIndex.avaliarTerminalIndexShadow(f.cliente, "", {}, injected);
    assert.strictEqual(calls, 1, "bootstrap em avaliação não deve duplicar enquanto a Promise está pendente");
    await new Promise(resolve => setImmediate(resolve));
    terminalIndex.avaliarTerminalIndexShadow(f.cliente, "", {}, injected);
    assert.strictEqual(calls, 2, "rejeição lógica não deve iniciar throttle de bootstrap");
    await new Promise(resolve => setImmediate(resolve));
    terminalIndex.avaliarTerminalIndexShadow(f.cliente, "", {}, injected);
    assert.strictEqual(calls, 2, "bootstrap aceito deve iniciar throttle e evitar storm");
  } finally {
    terminalIndex.resetarTerminalIndexShadowParaTeste();
    f.limpar();
  }
}

async function testCheckpointAndTerminalCircuitsAreIndependent() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ti111-circuits-"));
  const workerFile = path.join(root, "worker.cjs");
  fs.writeFileSync(workerFile, `"use strict"; const {parentPort}=require("worker_threads"); parentPort.on("message", job => { const bad=job.operation==="terminal_index_delta"; parentPort.postMessage({type: bad?"persistence_result":"persistence_result",jobId:job.jobId,result:bad?{ok:false,motivo:"EXPECTED_SHADOW_FAILURE"}:{ok:true,operation:job.operation}}); });\n`);
  const coordinator = criarCoordenadorPersistencia({
    env: { FILA_PERSISTENCE_WORKER: "1", FILA_PERSISTENCIA_CANARY_CLIENTES: "workspace_circuit", FILA_TERMINAL_INDEX_SHADOW: "0", DATA_DIR: root },
    workerPath: workerFile,
    logger: { log() {} }
  });
  try {
    const failedTerminal = await coordinator.deltaTerminalIndex({ clienteId: "workspace_circuit", checkpointRevision: "ti-circuit-0001", dataDir: root });
    assert.strictEqual(failedTerminal.ok, false);
    let lane = coordinator.getState().lanes[0];
    assert.strictEqual(lane.terminalIndexCircuitOpen, true);
    assert.strictEqual(lane.checkpointCircuitOpen, false);
    const checkpoint = await coordinator.prepare({ clienteId: "workspace_circuit", checkpointRevision: "cp-circuit-0001", dataDir: root, persistenceMode: "worker" });
    assert.strictEqual(checkpoint.ok, true, "circuito Terminal Index não deve bloquear checkpoint");

    await coordinator.terminateForTest();
    const checkpointAfterGlobal = await coordinator.prepare({ clienteId: "workspace_circuit", checkpointRevision: "cp-global-0001", dataDir: root, persistenceMode: "worker" });
    const terminalAfterGlobal = await coordinator.deltaTerminalIndex({ clienteId: "workspace_circuit", checkpointRevision: "ti-global-0001", dataDir: root });
    assert.strictEqual(checkpointAfterGlobal.motivo, "persistence_worker_circuit_open");
    assert.strictEqual(terminalAfterGlobal.motivo, "persistence_worker_circuit_open");
    lane = coordinator.getState().lanes[0];
    assert.strictEqual(coordinator.getState().globalCircuitOpen, true);
    assert.strictEqual(lane.terminalIndexCircuitOpen, true, "circuito global não apaga estado local de manutenção");
  } finally {
    await coordinator.shutdown({ timeoutMs: 1000 });
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function testSharedWorkerTimeoutRemainsGlobal() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ti111-global-timeout-"));
  const workerFile = path.join(root, "worker.cjs");
  fs.writeFileSync(workerFile, `"use strict"; const {parentPort}=require("worker_threads"); parentPort.on("message", job => { if(job.operation!=="terminal_index_delta") parentPort.postMessage({type:"persistence_result",jobId:job.jobId,result:{ok:true}}); });\n`);
  const coordinator = criarCoordenadorPersistencia({
    env: {
      FILA_PERSISTENCE_WORKER: "1",
      FILA_PERSISTENCIA_CANARY_CLIENTES: "workspace_timeout",
      FILA_PERSISTENCE_WORKER_TIMEOUT_MS: "1000",
      DATA_DIR: root
    },
    workerPath: workerFile,
    logger: { log() {} }
  });
  try {
    const timedOut = await coordinator.deltaTerminalIndex({
      clienteId: "workspace_timeout",
      checkpointRevision: "ti-timeout-0001",
      dataDir: root
    });
    assert.strictEqual(timedOut.motivo, "worker_timeout");
    const state = coordinator.getState();
    assert.strictEqual(state.globalCircuitOpen, true, "timeout encerra a Worker compartilhada e abre circuito global");
    assert.strictEqual(state.lanes[0].checkpointCircuitOpen, false);
    assert.strictEqual(state.lanes[0].terminalIndexCircuitOpen, false, "falha global não deve ser reclassificada como circuito local");
    const checkpoint = await coordinator.prepare({
      clienteId: "workspace_timeout",
      checkpointRevision: "cp-after-ti-timeout-0001",
      dataDir: root,
      persistenceMode: "worker"
    });
    assert.strictEqual(checkpoint.motivo, "persistence_worker_circuit_open");
  } finally {
    await coordinator.shutdown({ timeoutMs: 1000 });
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function testStructuralTerminalIndexWorkerErrorRemainsGlobal() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ti111-global-structural-"));
  const workerFile = path.join(root, "worker.cjs");
  fs.writeFileSync(workerFile, `"use strict"; const {parentPort}=require("worker_threads"); parentPort.on("message", job => parentPort.postMessage({type:"persistence_error",jobId:job.jobId,error:{code:"persistence_operation_invalida",message:"structural worker error"}}));\n`);
  const coordinator = criarCoordenadorPersistencia({
    env: { FILA_PERSISTENCE_WORKER: "1", FILA_PERSISTENCIA_CANARY_CLIENTES: "workspace_structural", DATA_DIR: root },
    workerPath: workerFile,
    logger: { log() {} }
  });
  try {
    const failed = await coordinator.deltaTerminalIndex({
      clienteId: "workspace_structural",
      checkpointRevision: "ti-structural-0001",
      dataDir: root
    });
    assert.strictEqual(failed.motivo, "persistence_operation_invalida");
    assert.strictEqual(coordinator.getState().globalCircuitOpen, true, "erro estrutural do Worker deve bloquear todas as operações");
    assert.strictEqual(coordinator.getState().lanes[0].terminalIndexCircuitOpen, false);
  } finally {
    await coordinator.shutdown({ timeoutMs: 1000 });
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function testResolvedFalseAndRejectedAppendSignalsAreObservedWithoutWaiting() {
  const filaOperacional = require("../modules/fila/fila-operacional-v2");
  const f = fixture("ti111-hook-");
  const initial = bootstrap(f);
  assert.strictEqual(initial.ok, true);
  const logs = [];
  let calls = 0;
  const baseDeps = {
    env: { FILA_TERMINAL_INDEX_SHADOW: "1" },
    fs,
    dataDir: f.root,
    getClientePath: () => f.dir,
    logger: { log: (_tag, line) => logs.push(String(line)) },
    agendarTerminalIndexDelta: () => {
      calls += 1;
      if (calls === 1) return Promise.resolve({ ok: true });
      if (calls === 2) return Promise.resolve({ ok: true, coalesced: true });
      if (calls === 3) return Promise.resolve({ ok: false, retryable: true, motivo: "persistence_worker_backpressure_retryable" });
      if (calls === 4) return Promise.reject(new Error("private detail must not be logged"));
      return new Promise(() => {});
    }
  };
  try {
    const items = ["signal-ok", "signal-coalesced", "signal-backpressure", "signal-rejected", "signal-missing", "signal-pending"];
    for (let index = 0; index < items.length; index += 1) {
      const depsForCall = index === 4 ? { ...baseDeps, agendarTerminalIndexDelta: undefined } : baseDeps;
      const result = filaOperacional.appendHistoricoIncremental(f.cliente, {
        id: items[index], status: "enviado", marketplace: "mercadolivre",
        enviadoEm: `2026-09-28T12:10:${String(index).padStart(2, "0")}.000Z`
      }, depsForCall);
      assert.strictEqual(result.ok, true, "sinal de manutenção nunca desfaz append factual");
      assert.strictEqual(result.idempotente, false);
    }
    assert.strictEqual(calls, 5, "callback ausente não deve ser chamado");
    await new Promise(resolve => setImmediate(resolve));
    const signals = logs.filter(line => /delta_signal_/.test(line)).join("\n");
    assert(signals.includes("delta_signal_primary"));
    assert(signals.includes("delta_signal_accepted"));
    assert(signals.includes("delta_signal_coalesced"));
    assert(signals.includes("delta_signal_rejected"));
    assert(signals.includes(terminalIndex.workspaceHash(f.cliente)));
    for (const sensitive of [f.cliente, "signal-backpressure", "private detail must not be logged"]) {
      assert.strictEqual(signals.includes(sensitive), false, `telemetria não deve conter ${sensitive}`);
    }
  } finally { f.limpar(); }
}

async function testBackpressureKeepsOneIntentAndRetriesOnSingleScheduler() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ti111-retry-"));
  const workspaceA = "workspace_retry_a";
  const workspaceB = "workspace_retry_b";
  const makeWorkspace = cliente => {
    const f = fixture("ti111-retry-fixture-", cliente);
    // Keep both workspaces beneath the coordinator's single DATA_DIR.
    const destination = path.join(root, "clientes", cliente);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.cpSync(f.dir, destination, { recursive: true });
    f.limpar();
    const mapped = {
      root,
      cliente,
      dir: destination,
      incremental: path.join(destination, terminalIndex.TERMINAL_INDEX_INCREMENTAL_DIR),
      legacy: path.join(destination, terminalIndex.TERMINAL_INDEX_LEGACY_FILE),
      jsonl: path.join(destination, terminalIndex.TERMINAL_INDEX_INCREMENTAL_DIR, "2026-09-28.jsonl")
    };
    const built = construirTerminalIndex({
      operation: "terminal_index_bootstrap", clienteId: cliente,
      checkpointRevision: `retry-bootstrap-${cliente.endsWith("a") ? "a" : "b"}`,
      targetGeneration: 10, dataDir: root, nowMs: Date.now()
    }, { operacional: operational });
    assert.strictEqual(built.ok, true);
    return mapped;
  };
  const a = makeWorkspace(workspaceA);
  const b = makeWorkspace(workspaceB);
  fs.appendFileSync(b.jsonl, `${JSON.stringify({ item: { id: "retry-b-new", status: "enviado" } })}\n`, "utf8");
  const workerFile = path.join(root, "slow-worker.cjs");
  const terminalWorkerPath = JSON.stringify(path.resolve(__dirname, "../modules/fila/terminal-index-worker.js"));
  const protocolPath = JSON.stringify(path.resolve(__dirname, "../modules/fila/persistence-protocol.js"));
  fs.writeFileSync(workerFile, `"use strict";
const {parentPort}=require("worker_threads"); const protocol=require(${protocolPath}); const ti=require(${terminalWorkerPath});
const operational={normalizarEntradasViva(items){const item=items[0]||{};const status=String(item.status||item.estado||"").toLowerCase();return [{bucket:["retida","erro","enviado","cancelado"].includes(status)?"historico":"viva",status}];},identidadePrimariaExataFilaV2(item={}){return item.id?"id:"+item.id:"";},rankStatusFilaV2(status=""){return {retida:1,erro:2,enviado:3,cancelado:4}[String(status).toLowerCase()]||0;}};
parentPort.on("message",job=>{const delay=job.clienteId==="${workspaceA}"?180:1;setTimeout(()=>{try{const result=ti.construirTerminalIndexDelta(job,{operacional:operational});parentPort.postMessage({type:protocol.RESPONSE_OK,jobId:job.jobId,result});}catch(error){parentPort.postMessage({type:protocol.RESPONSE_ERROR,jobId:job.jobId,error:{code:error.code||"WORKER_ERROR",message:error.message}});}},delay);});
`);
  const logs = [];
  const env = {
    ...process.env,
    FILA_PERSISTENCE_WORKER: "1",
    FILA_PERSISTENCIA_CANARY_CLIENTES: `${workspaceA},${workspaceB}`,
    FILA_PERSISTENCIA_MAX_PENDING_JOBS: "1",
    FILA_PERSISTENCIA_MAX_PENDING_JOBS_WORKSPACE: "10",
    FILA_TERMINAL_INDEX_SHADOW: "1",
    DATA_DIR: root
  };
  const coordinator = criarCoordenadorPersistencia({ env, workerPath: workerFile, logger: { log: (_tag, line) => logs.push(String(line)) } });
  try {
    const first = coordinator.deltaTerminalIndex({ clienteId: workspaceA, checkpointRevision: "retry-delta-a-0001", dataDir: root });
    const untilActive = Date.now() + 1000;
    while (!coordinator.getState().busy && Date.now() < untilActive) await new Promise(resolve => setTimeout(resolve, 5));
    assert.strictEqual(coordinator.getState().busy, true);
    const rejectedFirstTry = await coordinator.deltaTerminalIndex({ clienteId: workspaceB, checkpointRevision: "retry-delta-b-0001", dataDir: root });
    assert.strictEqual(rejectedFirstTry.ok, false);
    assert.strictEqual(rejectedFirstTry.retryable, true);
    const pendingAfterBackpressure = coordinator.getState().terminalIndexIntents;
    assert.strictEqual(coordinator.getState().terminalIndexPending, 2, "backpressure preserva B enquanto A continua ativa");
    assert(pendingAfterBackpressure.some(intent => intent.workspaceKey === crypto.createHash("sha256").update(workspaceB).digest("hex").slice(0, 12)));
    await first;

    const deadline = Date.now() + 5000;
    while (coordinator.getState().terminalIndexPending > 0 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
    const parsed = logs.map(line => { try { return JSON.parse(line); } catch { return {}; } });
    assert.strictEqual(coordinator.getState().terminalIndexPending, 0, `retry aceito e validado deve limpar intenção: ${parsed.map(entry => `${entry.evento}:${entry.motivo || entry.operacao || ""}`).join(",")}; failures=${JSON.stringify(coordinator.getState().lanes.map(lane => lane.terminalIndexLastFailure))}`);
    assert(coordinator.getState().retries >= 1);
    assert(parsed.some(entry => entry.evento === "delta_retry_scheduled" && entry.delayMs === 1000));
    assert(parsed.some(entry => entry.evento === "delta_retry_applied"));
    assert.strictEqual(coordinator.getState().globalCircuitOpen, false);
  } finally {
    await coordinator.shutdown({ timeoutMs: 1000 });
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function testSourceAdvanceDuringDeltaSchedulesOneCatchup() {
  const filaOperacional = require("../modules/fila/fila-operacional-v2");
  const f = fixture("ti111-catchup-");
  const workerFile = path.join(f.root, "catchup-worker.cjs");
  const marker = path.join(f.root, "delta-paused.marker");
  const release = path.join(f.root, "delta-release.marker");
  const terminalWorkerPath = JSON.stringify(path.resolve(__dirname, "../modules/fila/terminal-index-worker.js"));
  const protocolPath = JSON.stringify(path.resolve(__dirname, "../modules/fila/persistence-protocol.js"));
  fs.writeFileSync(workerFile, `"use strict";
const fs=require("fs"); const {parentPort}=require("worker_threads");
const protocol=require(${protocolPath}); const ti=require(${terminalWorkerPath}); let paused=false;
const operational={
 normalizarEntradasViva(items){const item=items[0]||{};const status=String(item.status||item.estado||"").toLowerCase();return [{bucket:["retida","erro","enviado","cancelado"].includes(status)?"historico":"viva",status}];},
 identidadePrimariaExataFilaV2(item={}){return item.id?"id:"+item.id:"";},
 rankStatusFilaV2(status=""){return {retida:1,erro:2,enviado:3,cancelado:4}[String(status).toLowerCase()]||0;}
};
parentPort.on("message",job=>{try{
 const hooks=job.operation===protocol.OP_TERMINAL_INDEX_DELTA?{afterIndexPartial(){if(paused)return;paused=true;fs.writeFileSync(${JSON.stringify(marker)},"paused");const wait=new Int32Array(new SharedArrayBuffer(4));const until=Date.now()+4000;while(!fs.existsSync(${JSON.stringify(release)})&&Date.now()<until)Atomics.wait(wait,0,0,10);}}:{};
 const result=job.operation===protocol.OP_TERMINAL_INDEX_BOOTSTRAP?ti.construirTerminalIndex(job,{operacional:operational}):ti.construirTerminalIndexDelta(job,{operacional:operational,hooks});
 parentPort.postMessage({type:protocol.RESPONSE_OK,jobId:job.jobId,result});
}catch(error){parentPort.postMessage({type:protocol.RESPONSE_ERROR,jobId:job.jobId,error:{code:error.code||"WORKER_ERROR",message:error.message}});}});
`, "utf8");
  const env = {
    ...process.env,
    FILA_PERSISTENCE_WORKER: "1",
    FILA_PERSISTENCIA_CANARY_CLIENTES: f.cliente,
    FILA_TERMINAL_INDEX_SHADOW: "1",
    DATA_DIR: f.root
  };
  const logs = [];
  const coordinator = criarCoordenadorPersistencia({ env, workerPath: workerFile, logger: { log: (_tag, line) => logs.push(String(line)) } });
  const hookDeps = {
    env, fs, dataDir: f.root, getClientePath: () => f.dir,
    logger: { log() {} },
    agendarTerminalIndexBootstrap: payload => coordinator.bootstrapTerminalIndex({ ...payload, dataDir: f.root }),
    agendarTerminalIndexDelta: payload => coordinator.deltaTerminalIndex({ ...payload, dataDir: f.root })
  };
  try {
    assert.strictEqual((await coordinator.bootstrapTerminalIndex({
      clienteId: f.cliente, checkpointRevision: "catchup-bootstrap-0001", dataDir: f.root
    })).ok, true);
    const firstAppend = filaOperacional.appendHistoricoIncremental(f.cliente, {
      id: "catchup-first", status: "enviado", marketplace: "mercadolivre", enviadoEm: "2026-09-28T13:00:01.000Z"
    }, hookDeps);
    assert.strictEqual(firstAppend.ok, true);
    const markerDeadline = Date.now() + 3000;
    while (!fs.existsSync(marker) && Date.now() < markerDeadline) await new Promise(resolve => setTimeout(resolve, 10));
    assert.strictEqual(fs.existsSync(marker), true, "primeiro Delta deve pausar depois de ler o tail inicial");

    const secondAppend = filaOperacional.appendHistoricoIncremental(f.cliente, {
      id: "catchup-second", status: "enviado", marketplace: "mercadolivre", enviadoEm: "2026-09-28T13:00:02.000Z"
    }, hookDeps);
    assert.strictEqual(secondAppend.ok, true, "append concorrente continua factual e não espera o Worker");
    fs.writeFileSync(release, "release");

    const deadline = Date.now() + 7000;
    let validation;
    while (Date.now() < deadline) {
      validation = terminalIndex.validarTerminalIndex(f.cliente, { env, getClientePath: () => f.dir });
      if (validation.valido && validation.index.entries["id:catchup-first"] && validation.index.entries["id:catchup-second"]) break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.strictEqual(validation?.valido, true);
    assert(validation.index.entries["id:catchup-first"]);
    assert(validation.index.entries["id:catchup-second"]);
    assert.strictEqual(coordinator.getState().terminalIndexPending, 0);
    const parsed = logs.map(line => { try { return JSON.parse(line); } catch { return {}; } });
    assert(parsed.some(entry => entry.evento === "job_error" && entry.operacao === "terminal_index_delta" && entry.motivo === "STALE_REVISION"),
      "mudança durante publish deve ser detectada, sem promover índice stale");
    assert(parsed.some(entry => entry.evento === "delta_retry_scheduled" && entry.motivo === "STALE_REVISION"));
    assert(parsed.some(entry => entry.evento === "delta_retry_applied"));
    assert(parsed.some(entry => entry.evento === "delta_catchup_complete"));
    assert.strictEqual(coordinator.getState().globalCircuitOpen, false);
  } finally {
    await coordinator.shutdown({ timeoutMs: 2000 });
    f.limpar();
  }
}

async function testWolfCheckpointFailureThenThreeFactualAppendsHealIndex() {
  let filaOperacional;
  try {
    filaOperacional = require("../modules/fila/fila-operacional-v2");
  } catch (erro) {
    if (erro?.code === "MODULE_NOT_FOUND" && String(erro?.message || "").includes("sharp")) {
      console.log("terminal-index-v1-1-1-self-healing: WOLF SKIP (sharp ausente localmente; CI Linux instala dependências)");
      return;
    }
    throw erro;
  }

  const f = fixture("ti111-wolf-");
  const workerFile = path.join(f.root, "wolf-worker.cjs");
  const pauseNextDelta = path.join(f.root, "pause-next-delta");
  const deltaPaused = path.join(f.root, "delta-paused");
  const releaseDelta = path.join(f.root, "release-delta");
  const terminalWorkerPath = JSON.stringify(path.resolve(__dirname, "../modules/fila/terminal-index-worker.js"));
  const protocolPath = JSON.stringify(path.resolve(__dirname, "../modules/fila/persistence-protocol.js"));
  fs.writeFileSync(workerFile, `"use strict";
const fs = require("fs");
const { parentPort } = require("worker_threads");
const protocol = require(${protocolPath});
const ti = require(${terminalWorkerPath});
const operational = {
  normalizarEntradasViva(items) {
    const item = items[0] || {}; const status = String(item.status || item.estado || "").toLowerCase();
    return [{ bucket: ["retida", "erro", "enviado", "cancelado"].includes(status) ? "historico" : "viva", status }];
  },
  identidadePrimariaExataFilaV2(item = {}) { return item.id ? "id:" + item.id : ""; },
  rankStatusFilaV2(status = "") { return { retida: 1, erro: 2, enviado: 3, cancelado: 4 }[String(status).toLowerCase()] || 0; }
};
parentPort.on("message", job => {
  if (job.operation === protocol.OP_PREPARE) {
    parentPort.postMessage({ type: protocol.RESPONSE_ERROR, jobId: job.jobId, error: { code: "STALE_REVISION", message: "stale checkpoint fixture" } });
    return;
  }
  try {
    const hooks = job.operation === protocol.OP_TERMINAL_INDEX_DELTA ? {
      afterIndexPartial() {
        if (!fs.existsSync(${JSON.stringify(pauseNextDelta)})) return;
        fs.unlinkSync(${JSON.stringify(pauseNextDelta)});
        fs.writeFileSync(${JSON.stringify(deltaPaused)}, "paused");
        const wait = new Int32Array(new SharedArrayBuffer(4));
        const deadline = Date.now() + 4000;
        while (!fs.existsSync(${JSON.stringify(releaseDelta)}) && Date.now() < deadline) Atomics.wait(wait, 0, 0, 10);
      }
    } : undefined;
    const result = job.operation === protocol.OP_TERMINAL_INDEX_BOOTSTRAP
      ? ti.construirTerminalIndex(job, { operacional: operational })
      : ti.construirTerminalIndexDelta(job, { operacional: operational, hooks });
    parentPort.postMessage({ type: protocol.RESPONSE_OK, jobId: job.jobId, result });
  } catch (error) {
    parentPort.postMessage({ type: protocol.RESPONSE_ERROR, jobId: job.jobId, error: { code: error.code || "WORKER_ERROR", message: error.message } });
  }
});
`, "utf8");
  const env = {
    ...process.env,
    FILA_PERSISTENCE_WORKER: "1",
    FILA_PERSISTENCIA_CANARY_CLIENTES: f.cliente,
    FILA_TERMINAL_INDEX_SHADOW: "1",
    DATA_DIR: f.root
  };
  const logs = [];
  const coordinator = criarCoordenadorPersistencia({ env, workerPath: workerFile, logger: { log: (_tag, line) => logs.push(String(line)) } });
  const getClientePath = () => f.dir;
  try {
    const initial = await coordinator.bootstrapTerminalIndex({ clienteId: f.cliente, checkpointRevision: "wolf-bootstrap-0001", targetGeneration: 1, dataDir: f.root });
    assert.strictEqual(initial.ok, true, "bootstrap factual inicial conclui");
    assert.strictEqual(terminalIndex.validarTerminalIndex(f.cliente, { env, getClientePath }).valido, true);

    const depsHook = {
      env,
      fs,
      dataDir: f.root,
      getClientePath,
      logger: { log: (_tag, line) => logs.push(String(line)) },
      agendarTerminalIndexBootstrap: payload => coordinator.bootstrapTerminalIndex({ ...payload, dataDir: f.root }),
      agendarTerminalIndexDelta: payload => coordinator.deltaTerminalIndex({ ...payload, dataDir: f.root })
    };
    const priorDeltaAppend = filaOperacional.appendHistoricoIncremental(f.cliente, {
      id: "wolf-prior-delta",
      status: "enviado",
      marketplace: "mercadolivre",
      enviadoEm: "2026-09-28T11:59:59.000Z"
    }, depsHook);
    assert.strictEqual(priorDeltaAppend.ok, true, "delta prévio também parte de append factual bem-sucedido");
    const priorDeadline = Date.now() + 5000;
    let priorValidation;
    while (Date.now() < priorDeadline) {
      priorValidation = terminalIndex.validarTerminalIndex(f.cliente, { env, getClientePath });
      if (priorValidation.valido && priorValidation.index.entries["id:wolf-prior-delta"]) break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.strictEqual(priorValidation?.valido, true, "um Delta válido antecede a falha de checkpoint reproduzida");
    assert(priorValidation.index.entries["id:wolf-prior-delta"]);

    const checkpoint = await coordinator.prepare({ clienteId: f.cliente, checkpointRevision: "wolf-prepare-0001", dataDir: f.root, persistenceMode: "worker" });
    assert.strictEqual(checkpoint.motivo, "STALE_REVISION");
    assert.strictEqual(coordinator.getState().lanes[0].checkpointCircuitOpen, false);
    fs.writeFileSync(pauseNextDelta, "1");
    const items = [
      { id: "wolf-terminal-a", enviadoEm: "2026-09-28T12:00:01.000Z" },
      { id: "wolf-terminal-b", enviadoEm: "2026-09-28T12:00:02.000Z" },
      { id: "wolf-terminal-c", enviadoEm: "2026-09-28T12:00:03.000Z" }
    ];
    const appendResults = [filaOperacional.appendHistoricoIncremental(f.cliente, {
      id: items[0].id,
      status: "enviado",
      marketplace: "mercadolivre",
      enviadoEm: items[0].enviadoEm
    }, depsHook)];
    const pauseDeadline = Date.now() + 3000;
    while (!fs.existsSync(deltaPaused) && Date.now() < pauseDeadline) await new Promise(resolve => setTimeout(resolve, 10));
    assert.strictEqual(fs.existsSync(deltaPaused), true, "Delta deve parar no partial antes de publicar para reproduzir append concorrente");
    for (const { id, enviadoEm } of items.slice(1)) {
      appendResults.push(filaOperacional.appendHistoricoIncremental(f.cliente, {
        id,
        status: "enviado",
        marketplace: "mercadolivre",
        enviadoEm
      }, depsHook));
    }
    assert(appendResults.every(result => result.ok === true && result.idempotente === false), "as três gravações factuais devem concluir sem esperar retry");
    fs.writeFileSync(releaseDelta, "release");

    const deadline = Date.now() + 6000;
    let validation;
    while (Date.now() < deadline) {
      validation = terminalIndex.validarTerminalIndex(f.cliente, { env, getClientePath });
      if (validation.valido && ["wolf-terminal-a", "wolf-terminal-b", "wolf-terminal-c"].every(id => validation.index.entries[`id:${id}`])) break;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert.strictEqual(validation?.valido, true, "tail do Wolf deve convergir depois do STALE_REVISION");
    const identities = Object.keys(validation.index.entries).sort();
    assert.deepStrictEqual(identities, [
      "id:legacy-retida",
      "id:seed",
      "id:wolf-prior-delta",
      "id:wolf-terminal-a",
      "id:wolf-terminal-b",
      "id:wolf-terminal-c"
    ].sort(), "auditoria independente do fixture: nenhuma identidade factual ausente ou extra");
    for (const id of ["wolf-terminal-a", "wolf-terminal-b", "wolf-terminal-c"]) {
      assert.deepStrictEqual(validation.index.entries[`id:${id}`][0], "enviado", `status terminal de ${id} preservado`);
    }
    assert.strictEqual(validation.index.mode, "shadow");
    assert.strictEqual(validation.index.authorityEligible, false, "Terminal Index segue sem autoridade");
    const state = coordinator.getState();
    assert.strictEqual(state.globalCircuitOpen, false);
    assert.strictEqual(state.lanes[0].checkpointCircuitOpen, false, "STALE_REVISION de checkpoint não deve abrir circuito local");
    assert.strictEqual(state.lanes[0].terminalIndexCircuitOpen, false, "Delta bem-sucedido recupera somente seu circuito");
    const events = logs.join("\n");
    assert(events.includes('"operacao":"terminal_index_bootstrap"'));
    assert(events.includes('"operacao":"terminal_index_delta"'));
    assert(events.includes('"motivo":"STALE_REVISION"'));
    const parsedLogs = logs.map(line => { try { return JSON.parse(line); } catch { return {}; } });
    assert.strictEqual(parsedLogs.filter(entry => entry.evento === "job_ok" && entry.operacao === "terminal_index_bootstrap").length, 1,
      `deve haver apenas o bootstrap inicial e nenhum rebuild no catch-up; eventos=${parsedLogs.filter(entry => entry.evento).map(entry => `${entry.evento}:${entry.operacao || ""}:${entry.motivo || ""}`).join(",")}`);
  } finally {
    await coordinator.shutdown({ timeoutMs: 2000 });
    f.limpar();
  }
}

async function main() {
  await testDeltaSafetyClassification();
  await testShadowRecoveryCoalescesAndKeepsAuthorityOff();
  await testShadowOffSchedulesNothing();
  await testBootstrapThrottleOnlyAfterAcceptance();
  await testCheckpointAndTerminalCircuitsAreIndependent();
  await testSharedWorkerTimeoutRemainsGlobal();
  await testStructuralTerminalIndexWorkerErrorRemainsGlobal();
  await testResolvedFalseAndRejectedAppendSignalsAreObservedWithoutWaiting();
  await testBackpressureKeepsOneIntentAndRetriesOnSingleScheduler();
  await testSourceAdvanceDuringDeltaSchedulesOneCatchup();
  await testWolfCheckpointFailureThenThreeFactualAppendsHealIndex();
  console.log("terminal-index-v1-1-1-self-healing: OK (delta-safe/bootstrap-required/coalescing/retry-contract/circuits/Wolf-3-appends/authority-off)");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
