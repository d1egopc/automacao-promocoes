"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { performance } = require("node:perf_hooks");
const {
  obterDistributorSnapshot,
  validarDistributorSnapshot,
  decidirGateComSnapshotSeguro,
  fecharCoordenadorDistributorSnapshot
} = require("../modules/engine/ofc/distributor-snapshot-coordinator");
const { criarClienteDistributorSnapshot } = require("../modules/engine/ofc/distributor-snapshot-client");
const { avaliarFluxoWorkspaceShadow } = require("../modules/engine/flow-manager/flow-manager.service");
const { decidirAbsorcaoWorkspace } = require("../modules/engine/ofc/active-gate.service");

const NOW = Date.parse("2026-09-29T15:00:00.000Z");
const WORKSPACE = "user_pss60lus";
const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), "distributor-compact-"));

const destino = {
  id: "destino_viva",
  tipo: "telegram",
  botToken: "synthetic",
  chatId: "synthetic",
  horarioInicio: "00:00",
  horarioFim: "23:59",
  ativo: true,
  intervaloMinutos: 3
};

function item(id, extra = {}) {
  return {
    id,
    status: "pendente",
    criadoEm: new Date(NOW - 60_000).toISOString(),
    dataEntradaFila: new Date(NOW - 60_000).toISOString(),
    destinoId: destino.id,
    marketplace: "mercadolivre",
    ...extra
  };
}

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value));
}

function fixture({ entries = [item("live")], legacy = entries } = {}) {
  const dir = fs.mkdtempSync(path.join(TEMP, "workspace-"));
  const paths = {
    "fila.json": path.join(dir, "fila.json"),
    "fila-viva.json": path.join(dir, "fila-viva.json"),
    "fila-viva.proof.json": path.join(dir, "fila-viva.proof.json"),
    "fila-v2-manifest.json": path.join(dir, "fila-v2-manifest.json")
  };
  writeJson(paths["fila.json"], legacy);
  writeJson(paths["fila-viva.json"], entries.map(itemAtual => ({ item: itemAtual, bucket: "viva" })));
  const stat = fs.statSync(paths["fila-viva.json"]);
  const proof = {
    proofVersion: 1,
    clienteId: WORKSPACE,
    arquivo: "fila-viva.json",
    generation: 7,
    fileRevision: "revision-7",
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    ctimeMs: stat.ctimeMs,
    ino: stat.ino,
    dev: stat.dev
  };
  writeJson(paths["fila-viva.proof.json"], proof);
  writeJson(paths["fila-v2-manifest.json"], {
    manifestVersion: 2,
    version: 2,
    clienteId: WORKSPACE,
    vivaGeneration: 7,
    vivaFileProof: proof
  });
  return { dir, paths, entries, legacy };
}

function resolver(paths) {
  return (_cliente, arquivo) => paths[arquivo];
}

function compactEnv() {
  return {
    OFC_SNAPSHOT_VIVA: "1",
    OFC_SNAPSHOT_VIVA_CANARY_CLIENTES: WORKSPACE,
    OFC_DISTRIBUTOR_VIVA_COMPACT: "1",
    OFC_DISTRIBUTOR_VIVA_COMPACT_CANARY_CLIENTES: WORKSPACE
  };
}

function entrada(extra = {}) {
  return {
    workspaceId: WORKSPACE,
    ofertaId: 123,
    marketplace: "mercadolivre",
    tipoOperacional: "",
    cupomTurbo: false,
    oferta: {
      id: 123,
      cliente_id: WORKSPACE,
      marketplace: "mercadolivre",
      categoria: "geral",
      criada_em: new Date(NOW - 60_000).toISOString()
    },
    destinosCompativeis: [destino],
    agoraMs: NOW,
    ...extra
  };
}

function camposFlow(decisao) {
  return {
    aceitarAgora: decisao.aceitarAgora,
    motivo: decisao.motivo,
    nivelAlvo: decisao.nivelAlvo,
    bufferAtual: decisao.bufferAtual,
    vagasDisponiveis: decisao.vagasDisponiveis,
    destinosAptos: decisao.destinosAptos,
    itensBufferContados: decisao.itensBufferContados,
    itensBufferIgnorados: decisao.itensBufferIgnorados
  };
}

function camposGate(decisao) {
  return {
    permitir: decisao.permitir,
    quantidadeAceitaAgora: decisao.quantidadeAceitaAgora,
    estadoDaEsteira: decisao.estadoDaEsteira,
    motivo: decisao.motivo,
    capacidadeAtual: decisao.capacidadeAtual,
    pressaoEsteiraViva: decisao.pressaoEsteiraViva,
    filaAlvo: decisao.filaAlvo
  };
}

function quantile(values = [], q = 0.95) {
  const ordenados = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!ordenados.length) return 0;
  const indice = Math.min(ordenados.length - 1, Math.max(0, Math.ceil(q * ordenados.length) - 1));
  return ordenados[indice];
}

async function medirEventLoop(run, intervaloMs = 5) {
  const amostras = [];
  let anterior = performance.now();
  const memoriaAntes = process.memoryUsage();
  let rssPeakBytes = memoriaAntes.rss;
  let heapPeakBytes = memoriaAntes.heapUsed;
  const timer = setInterval(() => {
    const agora = performance.now();
    amostras.push(Math.max(0, agora - anterior - intervaloMs));
    anterior = agora;
    const memoria = process.memoryUsage();
    rssPeakBytes = Math.max(rssPeakBytes, memoria.rss);
    heapPeakBytes = Math.max(heapPeakBytes, memoria.heapUsed);
  }, intervaloMs);
  const cpuAntes = process.cpuUsage();
  const inicio = performance.now();
  const resultado = await run();
  await new Promise(resolve => setTimeout(resolve, intervaloMs * 2));
  clearInterval(timer);
  const memoriaDepois = process.memoryUsage();
  rssPeakBytes = Math.max(rssPeakBytes, memoriaDepois.rss);
  heapPeakBytes = Math.max(heapPeakBytes, memoriaDepois.heapUsed);
  const cpu = process.cpuUsage(cpuAntes);
  return {
    resultado,
    wallMs: performance.now() - inicio,
    mainCpuMs: (cpu.user + cpu.system) / 1000,
    rssBeforeBytes: memoriaAntes.rss,
    rssPeakBytes,
    rssAfterBytes: memoriaDepois.rss,
    heapBeforeBytes: memoriaAntes.heapUsed,
    heapPeakBytes,
    heapAfterBytes: memoriaDepois.heapUsed,
    eventLoopP50Ms: quantile(amostras, 0.50),
    eventLoopP95Ms: quantile(amostras, 0.95),
    eventLoopMaxMs: amostras.length ? Math.max(...amostras) : 0,
    eventLoopSamples: amostras.length
  };
}

test.after(async () => {
  await fecharCoordenadorDistributorSnapshot();
  fs.rmSync(TEMP, { recursive: true, force: true });
});

test("flag OFF e workspace fora do canário preservam fallback sem Worker", async () => {
  const f = fixture();
  const off = await obterDistributorSnapshot(entrada(), {
    env: { ...compactEnv(), OFC_DISTRIBUTOR_VIVA_COMPACT: "0" },
    getClienteJsonPath: resolver(f.paths),
    clienteDistributorSnapshot: { executar: async () => { throw new Error("worker_nao_deve_ser_chamado"); } }
  });
  const fora = await obterDistributorSnapshot(entrada({ workspaceId: "user_fora_canary" }), {
    env: compactEnv(),
    getClienteJsonPath: resolver(f.paths),
    clienteDistributorSnapshot: { executar: async () => { throw new Error("worker_nao_deve_ser_chamado"); } }
  });
  assert.equal(off.ok, false);
  assert.equal(off.motivo, "distributor_compact_disabled");
  assert.equal(fora.ok, false);
  assert.equal(fora.motivo, "distributor_workspace_not_canary");
});

test("snapshot compacto tem uma leitura Viva, zero array integral na resposta e paridade Flow/Gate", async () => {
  const f = fixture();
  const snapshot = await obterDistributorSnapshot(entrada(), {
    env: compactEnv(),
    getClienteJsonPath: resolver(f.paths)
  });
  assert.equal(snapshot.ok, true);
  assert.equal(snapshot.source, "fila_viva");
  assert.equal(snapshot.perf.contentReads, 1);
  assert.equal(snapshot.perf.legacyContentReads, 0);
  assert.equal(Object.hasOwn(snapshot.facts.flow.fila, "itens"), false);
  assert.equal(Object.hasOwn(snapshot.facts.gate.fila, "itens"), false);
  assert.equal(snapshot.facts.gate.fila.sameAs, "flow.fila");
  assert.equal(snapshot.facts.gate.destinosResumo.sameAs, "flow.destinosResumo");
  assert.equal(Object.hasOwn(snapshot.facts, "itens"), false);
  assert.ok(snapshot.perf.compactResponseBytes > 0);
  assert.ok(snapshot.perf.inputCloneBytes > 0);
  assert.ok(snapshot.perf.outputCloneBytes > 0);
  assert.ok(Number.isFinite(snapshot.perf.inputDispatchMs));
  assert.ok(Number.isFinite(snapshot.perf.outputDispatchMs));

  let legacyFlowReads = 0;
  const flowOptions = {
    agoraMs: NOW,
    validarCreditos: async () => ({ ok: true }),
    readClienteJson: (_cliente, arquivo) => {
      if (arquivo === "fila.json") legacyFlowReads += 1;
      return f.legacy;
    }
  };
  const flowEntrada = entrada();
  const legacyFlow = await avaliarFluxoWorkspaceShadow(flowEntrada, flowOptions);
  const compactFlow = await avaliarFluxoWorkspaceShadow(flowEntrada, {
    ...flowOptions,
    distributorSnapshot: snapshot,
    validarDistributorSnapshot: async () => true
  });
  assert.deepEqual(camposFlow(compactFlow), camposFlow(legacyFlow));
  assert.equal(legacyFlowReads, 1);

  let gateLegacyReads = 0;
  const gateBase = {
    workspacesAtivos: new Set([WORKSPACE]),
    usuarios: [{ id: WORKSPACE, papel: "usuario" }],
    agoraMs: NOW,
    readClienteJson: (_cliente, arquivo) => {
      if (arquivo === "fila.json") gateLegacyReads += 1;
      return f.legacy;
    }
  };
  const gateEntrada = {
    workspaceId: WORKSPACE,
    ofertaId: 123,
    marketplace: "mercadolivre",
    tipoOperacional: "",
    cupomTurbo: false,
    destinosCompativeis: [destino],
    quantidadeSolicitada: 1
  };
  const legacyGate = await decidirAbsorcaoWorkspace(gateEntrada, gateBase);
  const compactGateReadsBefore = gateLegacyReads;
  const compactGate = await decidirAbsorcaoWorkspace(gateEntrada, {
    ...gateBase,
    distributorSnapshot: snapshot
  });
  assert.deepEqual(camposGate(compactGate), camposGate(legacyGate));
  assert.equal(compactGateReadsBefore, 1);
  assert.equal(gateLegacyReads, compactGateReadsBefore);
  assert.equal(compactGate.fallbackAplicado, false);
});

test("Race A: revisão muda durante Flow e rejeição usa legado fresco", async () => {
  const f = fixture();
  const snapshot = await obterDistributorSnapshot(entrada(), {
    env: compactEnv(),
    getClienteJsonPath: resolver(f.paths)
  });
  assert.equal(snapshot.ok, true);
  let legacyReads = 0;
  const legacy = await avaliarFluxoWorkspaceShadow(entrada(), {
    agoraMs: NOW,
    validarCreditos: async () => ({ ok: true }),
    readClienteJson: (_cliente, arquivo) => {
      if (arquivo === "fila.json") legacyReads += 1;
      return f.legacy;
    }
  });
  const fallback = await avaliarFluxoWorkspaceShadow(entrada(), {
    agoraMs: NOW,
    validarCreditos: async () => ({ ok: true }),
    readClienteJson: (_cliente, arquivo) => {
      if (arquivo === "fila.json") legacyReads += 1;
      return f.legacy;
    },
    distributorSnapshot: snapshot,
    validarDistributorSnapshot: async () => {
      fs.appendFileSync(f.paths["fila-viva.json"], " ");
      return false;
    }
  });
  assert.deepEqual(camposFlow(fallback), camposFlow(legacy));
  assert.ok(legacyReads >= 2);
  assert.equal(await validarDistributorSnapshot(snapshot, { getClienteJsonPath: resolver(f.paths) }), false);
});

test("proof inválido ou Worker indisponível nunca ganham autoridade compacta", async () => {
  const f = fixture();
  fs.rmSync(f.paths["fila-viva.proof.json"]);
  const proofMissing = await obterDistributorSnapshot(entrada(), {
    env: compactEnv(),
    getClienteJsonPath: resolver(f.paths),
    clienteDistributorSnapshot: { executar: async () => { throw new Error("nao_deve_executar"); } }
  });
  assert.equal(proofMissing.ok, false);
  assert.equal(proofMissing.motivo, "fila_viva_proof_ausente");

  const valid = fixture();
  const workerFailed = await obterDistributorSnapshot(entrada(), {
    env: compactEnv(),
    getClienteJsonPath: resolver(valid.paths),
    clienteDistributorSnapshot: { executar: async () => null }
  });
  assert.equal(workerFailed.ok, false);
  assert.equal(workerFailed.motivo, "distributor_compact_response_invalid");
});

test("manifest mismatch e stat mismatch permanecem fallback legado", async () => {
  const manifest = fixture();
  const manifestAtual = JSON.parse(fs.readFileSync(manifest.paths["fila-v2-manifest.json"], "utf8"));
  manifestAtual.vivaGeneration = 8;
  writeJson(manifest.paths["fila-v2-manifest.json"], manifestAtual);
  const manifestMismatch = await obterDistributorSnapshot(entrada(), {
    env: compactEnv(),
    getClienteJsonPath: resolver(manifest.paths),
    clienteDistributorSnapshot: { executar: async () => { throw new Error("nao_deve_executar"); } }
  });
  assert.equal(manifestMismatch.ok, false);

  const stat = fixture();
  fs.appendFileSync(stat.paths["fila-viva.json"], " ");
  const statMismatch = await obterDistributorSnapshot(entrada(), {
    env: compactEnv(),
    getClienteJsonPath: resolver(stat.paths),
    clienteDistributorSnapshot: { executar: async () => { throw new Error("nao_deve_executar"); } }
  });
  assert.equal(statMismatch.ok, false);
});

function workerFalso(configurar) {
  const worker = new EventEmitter();
  worker.ref = () => worker;
  worker.unref = () => worker;
  worker.terminate = async () => 0;
  worker.postMessage = () => configurar(worker);
  return worker;
}

test("Worker crash e timeout são fallback sem retry", async () => {
  const f = fixture();
  const crashClient = criarClienteDistributorSnapshot({
    workerFactory: () => workerFalso(worker => setImmediate(() => worker.emit("error", new Error("synthetic_worker_crash")))),
    timeoutMs: 50
  });
  await assert.rejects(
    crashClient.executar({ arquivo: f.paths["fila-viva.json"] }),
    /synthetic_worker_crash/
  );
  await crashClient.fechar();

  const timeoutClient = criarClienteDistributorSnapshot({
    workerFactory: () => workerFalso(() => {}),
    timeoutMs: 10
  });
  await assert.rejects(
    timeoutClient.executar({ arquivo: f.paths["fila-viva.json"] }),
    /distributor_worker_timeout/
  );
  await timeoutClient.fechar();
});

function gateResposta({ permitir, motivo }) {
  return {
    ativo: true,
    permitir,
    motivo,
    quantidadeAceitaAgora: permitir ? 1 : 0,
    estadoDaEsteira: permitir ? "LIVRE" : "SATURADA",
    capacidadeAtual: permitir ? 1 : 0,
    pressaoEsteiraViva: permitir ? 0 : 1,
    filaAlvo: 1
  };
}

test("Race B: revisão muda entre decisão compacta e consumo do Gate", async () => {
  const snapshot = { ok: true, facts: { gate: { fila: {}, destinosResumo: {} } } };
  const chamadas = [];
  const coordenado = await decidirGateComSnapshotSeguro({
    entrada: { workspaceId: WORKSPACE },
    snapshot,
    validarSnapshot: async () => false,
    decidirGate: async (_entrada, opcoes) => {
      chamadas.push(opcoes.distributorSnapshot);
      return gateResposta({
        permitir: Boolean(opcoes.distributorSnapshot),
        motivo: opcoes.distributorSnapshot ? "compacto" : "legado_fresco"
      });
    }
  });
  assert.equal(coordenado.gate.permitir, false);
  assert.equal(coordenado.gate.motivo, "legado_fresco");
  assert.equal(coordenado.usouSnapshot, false);
  assert.deepEqual(chamadas, [snapshot, null]);
  const final = await coordenado.revalidarAntesDaMutacao();
  assert.equal(final.alterado, false);
});

test("Race C: revisão muda depois do Gate e antes da mutação", async () => {
  const snapshot = { ok: true, facts: { gate: { fila: {}, destinosResumo: {} } } };
  const chamadas = [];
  let validacoes = 0;
  let mutou = false;
  const coordenado = await decidirGateComSnapshotSeguro({
    entrada: { workspaceId: WORKSPACE },
    snapshot,
    validarSnapshot: async () => {
      validacoes += 1;
      return validacoes === 1;
    },
    decidirGate: async (_entrada, opcoes) => {
      chamadas.push(opcoes.distributorSnapshot);
      return gateResposta({
        permitir: Boolean(opcoes.distributorSnapshot),
        motivo: opcoes.distributorSnapshot ? "compacto" : "legado_fresco"
      });
    }
  });
  assert.equal(coordenado.gate.permitir, true);
  const final = await coordenado.revalidarAntesDaMutacao();
  if (final.gate.permitir) mutou = true;
  assert.equal(final.alterado, true);
  assert.equal(final.gate.permitir, false);
  assert.equal(mutou, false);
  assert.deepEqual(chamadas, [snapshot, null]);
});

test("Flow rejeitado mantém paridade sem abrir Gate", async () => {
  const entries = [item("a"), item("b"), item("c"), item("d")];
  const f = fixture({ entries });
  const snapshot = await obterDistributorSnapshot(entrada(), {
    env: compactEnv(),
    getClienteJsonPath: resolver(f.paths)
  });
  assert.equal(snapshot.ok, true);
  let legacyReads = 0;
  const flow = await avaliarFluxoWorkspaceShadow(entrada(), {
    agoraMs: NOW,
    validarCreditos: async () => ({ ok: true }),
    readClienteJson: (_cliente, arquivo) => {
      if (arquivo === "fila.json") legacyReads += 1;
      return f.legacy;
    },
    distributorSnapshot: snapshot,
    validarDistributorSnapshot: async () => true
  });
  assert.equal(flow.aceitarAgora, false);
  assert.equal(flow.motivo, "esteira_saturada");
  assert.equal(snapshot.perf.contentReads, 1);
  assert.equal(legacyReads, 0);
  let gateCalls = 0;
  if (flow.aceitarAgora) gateCalls += 1;
  assert.equal(gateCalls, 0);
});

test("Flow compacto rejeitado revalida antes de retornar e cai no legado se houver race", async () => {
  const entries = [item("a"), item("b"), item("c"), item("d")];
  const f = fixture({ entries });
  const snapshot = await obterDistributorSnapshot(entrada(), {
    env: compactEnv(),
    getClienteJsonPath: resolver(f.paths)
  });
  assert.equal(snapshot.ok, true);
  let legacyReads = 0;
  const legado = await avaliarFluxoWorkspaceShadow(entrada(), {
    agoraMs: NOW,
    validarCreditos: async () => ({ ok: true }),
    readClienteJson: (_cliente, arquivo) => {
      if (arquivo === "fila.json") legacyReads += 1;
      return f.legacy;
    }
  });
  const compacto = await avaliarFluxoWorkspaceShadow(entrada(), {
    agoraMs: NOW,
    validarCreditos: async () => ({ ok: true }),
    readClienteJson: (_cliente, arquivo) => {
      if (arquivo === "fila.json") legacyReads += 1;
      return f.legacy;
    },
    distributorSnapshot: snapshot,
    validarDistributorSnapshot: async () => {
      fs.appendFileSync(f.paths["fila-viva.json"], " ");
      return false;
    }
  });
  assert.equal(compacto.aceitarAgora, false);
  assert.deepEqual(camposFlow(compacto), camposFlow(legado));
  assert.equal(legacyReads, 2);
  assert.equal(snapshot.perf.contentReads, 1);
});

test("benchmark local legado versus compacto coordenado", async () => {
  const payload = "x".repeat(10 * 1024);
  const entries = Array.from({ length: 4000 }, (_, i) => item(`bench_${i}`, { payload }));
  const f = fixture({ entries });
  const legacy = await medirEventLoop(async () => {
    let bytes = 0;
    let readMs = 0;
    let parseMs = 0;
    let items = 0;
    for (let i = 0; i < 2; i += 1) {
      const readStart = performance.now();
      const legacyText = fs.readFileSync(f.paths["fila-viva.json"], "utf8");
      readMs += performance.now() - readStart;
      bytes += Buffer.byteLength(legacyText);
      const parseStart = performance.now();
      const legacyParsed = JSON.parse(legacyText);
      parseMs += performance.now() - parseStart;
      items = legacyParsed.length;
    }
    return { bytes, readMs, parseMs, items, contentReads: 2 };
  });
  const compact = await medirEventLoop(() => obterDistributorSnapshot(entrada(), {
    env: compactEnv(),
    getClienteJsonPath: resolver(f.paths)
  }));
  const compactResult = compact.resultado;
  const facts = compactResult.facts;
  const responsePartes = {
    "facts.flow.fila": facts.flow.fila,
    "facts.flow.destinosResumo": facts.flow.destinosResumo,
    "facts.flow.bufferShadow": facts.flow.bufferShadow,
    "facts.flow.bufferVivoShadow": facts.flow.bufferVivoShadow,
    "facts.flow.nivelAlvoCalculado": facts.flow.nivelAlvoCalculado,
    "facts.gate.fila": facts.gate.fila,
    "facts.gate.destinosResumo": facts.gate.destinosResumo,
    "metadados/revisao/perf": {
      before: compactResult.before,
      after: compactResult.after,
      source: compactResult.source,
      workspaceId: compactResult.workspaceId,
      perf: compactResult.perf
    }
  };
  const responseBytes = Object.fromEntries(Object.entries(responsePartes).map(([campo, valor]) => [
    campo,
    Buffer.byteLength(JSON.stringify(valor), "utf8")
  ]));
  const responseTotalBytes = Buffer.byteLength(JSON.stringify(facts), "utf8");
  const responsePercent = Object.fromEntries(Object.entries(responseBytes).map(([campo, bytes]) => [
    campo,
    Number(((bytes / responseTotalBytes) * 100).toFixed(2))
  ]));
  const duplicacoes = [
    ["facts.flow.fila", "facts.gate.fila"],
    ["facts.flow.destinosResumo", "facts.gate.destinosResumo"]
  ].map(([a, b]) => ({
    a,
    b,
    identicos: JSON.stringify(responsePartes[a]) === JSON.stringify(responsePartes[b]),
    alias: responsePartes[b]?.sameAs === a.replace(/^facts\./, ""),
    duplicacaoEliminada: responsePartes[b]?.sameAs === a.replace(/^facts\./, ""),
    bytesA: responseBytes[a],
    bytesB: responseBytes[b]
  }));
  const arrayDiagnostics = [
    ["facts.flow.bufferShadow.itensContados", facts.flow.bufferShadow.itensContados],
    ["facts.flow.bufferShadow.itensIgnorados", facts.flow.bufferShadow.itensIgnorados],
    ["facts.flow.bufferVivoShadow.itensBufferUtil", facts.flow.bufferVivoShadow.itensBufferUtil],
    ["facts.flow.bufferVivoShadow.itensIgnorados", facts.flow.bufferVivoShadow.itensIgnorados],
    ["facts.flow.destinosResumo.capacidadePorDestino", facts.flow.destinosResumo.capacidadePorDestino],
    ["facts.gate.destinosResumo.capacidadePorDestino", facts.gate.destinosResumo.capacidadePorDestino]
  ].map(([campo, valor]) => ({
    campo,
    length: Array.isArray(valor) ? valor.length : null,
    bytes: Array.isArray(valor) ? Buffer.byteLength(JSON.stringify(valor), "utf8") : 0,
    consumidoPeloMain: [
      "facts.flow.bufferShadow.itensContados",
      "facts.flow.bufferVivoShadow.itensBufferUtil"
    ].includes(campo)
  }));
  assert.equal(compactResult.ok, true);
  console.log("[DISTRIBUTOR-COMPACT-BENCHMARK]", JSON.stringify({
    fixtureBytes: fs.statSync(f.paths["fila-viva.json"]).size,
    legacy,
    compact: {
      wallMs: compact.wallMs,
      mainCpuMs: compact.mainCpuMs,
      mainLagP50Ms: compact.eventLoopP50Ms,
      mainLagP95Ms: compact.eventLoopP95Ms,
      mainLagMaxMs: compact.eventLoopMaxMs,
      ticks: compact.eventLoopSamples,
      bytes: compactResult.perf.leitura?.bytesLidos,
      readMs: compactResult.perf.leitura?.leituraMs,
      parseMs: compactResult.perf.leitura?.parseMs,
      workerCalcMs: compactResult.perf.calcMs,
      roundTripMs: compactResult.perf.roundTripMs,
      inputCloneBytes: compactResult.perf.inputCloneBytes,
      outputCloneBytes: compactResult.perf.outputCloneBytes,
      inputDispatchMs: compactResult.perf.inputDispatchMs,
      outputDispatchMs: compactResult.perf.outputDispatchMs,
      compactResponseBytes: compactResult.perf.compactResponseBytes,
      contentReads: compactResult.perf.contentReads,
      rssBeforeBytes: compactResult.perf.memory?.[0]?.rss,
      rssPeakBytes: Math.max(...(compactResult.perf.memory || []).map(itemMem => Number(itemMem.rss || 0))),
      rssAfterBytes: compactResult.perf.memory?.at(-1)?.rss,
      workerHeapBeforeBytes: compactResult.perf.memory?.[0]?.heapUsed,
      workerHeapPeakBytes: Math.max(...(compactResult.perf.memory || []).map(itemMem => Number(itemMem.heapUsed || 0))),
      workerHeapAfterBytes: compactResult.perf.heapFinal
    },
    responsePartes: responseBytes,
    responsePercent,
    responseTotalBytes,
    duplicacoes,
    arrayDiagnostics,
    compactMaiorOuIgualLegacy: compact.wallMs >= legacy.wallMs,
    eventLoopCompactMuitoMenor: compact.eventLoopP95Ms < legacy.eventLoopP95Ms
  }));
});
