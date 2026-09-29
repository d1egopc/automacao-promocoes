"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { performance, monitorEventLoopDelay } = require("node:perf_hooks");
const ofc = require("../modules/engine/ofc/absorption-gate.service");
const { criarClienteWorker } = require("../modules/engine/ofc/workspace-worker-client");

const NOW = Date.parse("2026-09-29T15:00:00.000Z");
const workspaceId = "workspace_viva";
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ofc-snapshot-viva-v1-"));

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

function item(id, status = "pendente", extra = {}) {
  return {
    id,
    status,
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

function resolver(paths) {
  return (_cliente, arquivo) => paths[arquivo];
}

function publishVivaProof(paths, generation = 7) {
  const stat = fs.statSync(paths["fila-viva.json"]);
  const proof = {
    proofVersion: 1,
    clienteId: workspaceId,
    arquivo: "fila-viva.json",
    generation,
    targetGeneration: generation,
    fileRevision: `revision-${generation}`,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    ctimeMs: stat.ctimeMs,
    ino: stat.ino,
    dev: stat.dev,
    publishedAt: new Date(NOW).toISOString()
  };
  writeJson(paths["fila-viva.proof.json"], proof);
  writeJson(paths["fila-v2-manifest.json"], {
    manifestVersion: 2,
    version: 2,
    clienteId: workspaceId,
    vivaGeneration: generation,
    durableCheckpointGeneration: Math.max(0, generation - 1),
    dirtyGeneration: generation,
    vivaFileProof: proof
  });
  return proof;
}

function fixture({ legacy = null, vivaEntries = null, generation = 7 } = {}) {
  const dir = fs.mkdtempSync(path.join(temp, "workspace-"));
  const paths = {
    "fila.json": path.join(dir, "fila.json"),
    "fila-viva.json": path.join(dir, "fila-viva.json"),
    "fila-viva.proof.json": path.join(dir, "fila-viva.proof.json"),
    "fila-v2-manifest.json": path.join(dir, "fila-v2-manifest.json")
  };
  const live = item("live");
  const legacyItems = legacy || [live, item("old", "enviado", { enviadoEm: new Date(NOW - 86_400_000).toISOString() })];
  const entries = vivaEntries || [{ item: live, bucket: "viva", clienteId: workspaceId }];
  writeJson(paths["fila.json"], legacyItems);
  writeJson(paths["fila-viva.json"], entries);
  publishVivaProof(paths, generation);
  return { dir, paths, live, legacyItems, entries };
}

function envViva(cliente = workspaceId) {
  return {
    OFC_SNAPSHOT_VIVA: "1",
    OFC_SNAPSHOT_VIVA_CANARY_CLIENTES: cliente
  };
}

function gateOptions(paths, overrides = {}) {
  return {
    workerOfc: false,
    agoraMs: NOW,
    clock: () => NOW,
    usuarios: [{ id: workspaceId, creditos: 100 }],
    listarClientesAtivos: () => [workspaceId],
    destinosPorCliente: { [workspaceId]: [destino] },
    configsPorCliente: { [workspaceId]: { automacaoAtiva: true } },
    configPadrao: {},
    consultarEventosAbsorcao: async () => ({ ok: true, porWorkspace: [] }),
    getClienteJsonPath: resolver(paths),
    ...overrides
  };
}

function decision(workspace) {
  return {
    estado: workspace.estado,
    pressaoEsteiraViva: workspace.pressaoEsteiraViva,
    queueDepthRaw: workspace.queueDepthRaw,
    queueDepthActionable: workspace.queueDepthActionable,
    oldestActionableAge: workspace.oldestActionableAge,
    capacityEffective: workspace.capacityEffective,
    capacidadeAbsorcaoAgora: workspace.capacidadeAbsorcaoAgora,
    filaAlvo15Min: workspace.filaAlvo15Min,
    turboAplicavel: workspace.turboAplicavel,
    topologiaOperacionalPotencial: workspace.topologiaOperacionalPotencial
  };
}

function assertLegacyOnlyRead(paths, read) {
  assert.equal(read.source, "fila_legacy");
  assert.equal(read.ok, true);
  assert.deepEqual(read.itens, JSON.parse(fs.readFileSync(paths["fila.json"], "utf8")));
}

test.after(() => fs.rmSync(temp, { recursive: true, force: true }));

test("flag OFF preserva o reader legado e não seleciona Viva", () => {
  const f = fixture();
  const selecionada = ofc.selecionarFonteSnapshotOFC(workspaceId, {
    getClienteJsonPath: resolver(f.paths),
    env: { OFC_SNAPSHOT_VIVA: "0", OFC_SNAPSHOT_VIVA_CANARY_CLIENTES: workspaceId }
  });
  assert.equal(selecionada.source, "fila_legacy");
  assert.equal(selecionada.motivo, "snapshot_viva_disabled");
  assertLegacyOnlyRead(f.paths, ofc.lerFilaWorkspaceSnapshot(workspaceId, {
    getClienteJsonPath: resolver(f.paths)
  }));
});

test("workspace fora do canary permanece no legado", () => {
  const f = fixture();
  const selecionada = ofc.selecionarFonteSnapshotOFC(workspaceId, {
    getClienteJsonPath: resolver(f.paths),
    env: envViva("outro_workspace")
  });
  assert.equal(selecionada.source, "fila_legacy");
  assert.equal(selecionada.motivo, "snapshot_viva_disabled");
});

test("proof e manifest válidos tornam a Viva elegível sem abrir fila.json", () => {
  const f = fixture();
  let legacyReads = 0;
  let vivaReads = 0;
  const originalRead = fs.readFileSync;
  try {
    fs.readFileSync = function (file, ...args) {
      if (file === f.paths["fila.json"]) legacyReads += 1;
      if (file === f.paths["fila-viva.json"]) vivaReads += 1;
      return originalRead.call(this, file, ...args);
    };
    const selecionada = ofc.selecionarFonteSnapshotOFC(workspaceId, {
      getClienteJsonPath: resolver(f.paths),
      env: envViva()
    });
    assert.equal(selecionada.eligible, true);
    const leitura = ofc.lerFilaWorkspaceSnapshot(workspaceId, {
      getClienteJsonPath: resolver(f.paths),
      source: "fila_viva",
      sourceValidated: true,
      sourceMeta: selecionada
    });
    assert.equal(leitura.ok, true);
    assert.equal(leitura.source, "fila_viva");
    assert.equal(leitura.legacyReadAvoided, true);
    assert.equal(vivaReads, 1, "fast path deve abrir fila-viva.json uma vez");
    assert.equal(legacyReads, 0, "fast path não pode abrir fila.json");
  } finally {
    fs.readFileSync = originalRead;
  }
});

for (const [nome, preparar] of [
  ["proof ausente", f => fs.rmSync(f.paths["fila-viva.proof.json"])],
  ["proof inválido", f => writeJson(f.paths["fila-viva.proof.json"], { proofVersion: 99 })],
  ["manifest incoerente", f => { const proof = JSON.parse(fs.readFileSync(f.paths["fila-viva.proof.json"], "utf8")); proof.generation += 1; writeJson(f.paths["fila-viva.proof.json"], proof); }],
  ["stat divergente", f => fs.appendFileSync(f.paths["fila-viva.json"], " ")]
]) {
  test(`${nome} força fallback ao legado`, async () => {
    const f = fixture();
    preparar(f);
    const selecionada = ofc.selecionarFonteSnapshotOFC(workspaceId, {
      getClienteJsonPath: resolver(f.paths), env: envViva()
    });
    assert.equal(selecionada.eligible, false);
    const resultado = await ofc.criarGateAbsorcaoShadowOfc(gateOptions(f.paths, { env: envViva() }));
    const legado = await ofc.criarGateAbsorcaoShadowOfc(gateOptions(f.paths));
    assert.deepEqual(decision(resultado.workspaces[0]), decision(legado.workspaces[0]));
  });
}

test("Viva corrompida depois do proof elegível cai no legado", async () => {
  const f = fixture();
  fs.writeFileSync(f.paths["fila-viva.json"], "{");
  publishVivaProof(f.paths);
  const selecionada = ofc.selecionarFonteSnapshotOFC(workspaceId, {
    getClienteJsonPath: resolver(f.paths), env: envViva()
  });
  assert.equal(selecionada.eligible, true);
  const resultado = await ofc.criarGateAbsorcaoShadowOfc(gateOptions(f.paths, { env: envViva() }));
  const legado = await ofc.criarGateAbsorcaoShadowOfc(gateOptions(f.paths));
  assert.deepEqual(decision(resultado.workspaces[0]), decision(legado.workspaces[0]));
});

test("falha na leitura de Viva faz fallback com no máximo uma leitura legada", async () => {
  const f = fixture();
  const originalRead = fs.readFileSync;
  let vivaContentReads = 0;
  let legacyContentReads = 0;
  let resultado;
  try {
    fs.readFileSync = function (file, ...args) {
      if (file === f.paths["fila-viva.json"]) {
        vivaContentReads += 1;
        const error = new Error("synthetic viva content read failure");
        error.code = "EIO";
        throw error;
      }
      if (file === f.paths["fila.json"]) legacyContentReads += 1;
      return originalRead.call(this, file, ...args);
    };
    resultado = await ofc.criarGateAbsorcaoShadowOfc(gateOptions(f.paths, { env: envViva() }));
  } finally {
    fs.readFileSync = originalRead;
  }
  const legado = await ofc.criarGateAbsorcaoShadowOfc(gateOptions(f.paths));
  assert.deepEqual(decision(resultado.workspaces[0]), decision(legado.workspaces[0]));
  assert.equal(vivaContentReads, 1, "não deve haver segunda leitura de Viva");
  assert.equal(legacyContentReads, 1, "fallback deve ler o legado uma única vez");
});

test("envelopes V2 são normalizados para entrada.item sem modificar o item", () => {
  const f = fixture({ vivaEntries: [{ item: item("envelope"), bucket: "viva", metadado: "preservado" }] });
  const selecionada = ofc.selecionarFonteSnapshotOFC(workspaceId, {
    getClienteJsonPath: resolver(f.paths), env: envViva()
  });
  const leitura = ofc.lerFilaWorkspaceSnapshot(workspaceId, {
    getClienteJsonPath: resolver(f.paths), source: "fila_viva", sourceValidated: true, sourceMeta: selecionada
  });
  assert.equal(leitura.ok, true);
  assert.equal(leitura.itens.length, 1);
  assert.equal(leitura.itens[0].id, "envelope");
  assert.equal(leitura.itens[0].metadado, undefined);
});

test("fila Viva vazia válida é diferente de ausência e não abre fila.json", () => {
  const f = fixture({ vivaEntries: [] });
  publishVivaProof(f.paths);
  const selecionada = ofc.selecionarFonteSnapshotOFC(workspaceId, {
    getClienteJsonPath: resolver(f.paths), env: envViva()
  });
  assert.equal(selecionada.eligible, true);
  const leitura = ofc.lerFilaWorkspaceSnapshot(workspaceId, {
    getClienteJsonPath: resolver(f.paths), source: "fila_viva", sourceValidated: true, sourceMeta: selecionada
  });
  assert.equal(leitura.ok, true);
  assert.deepEqual(leitura.itens, []);
});

test("paridade da decisão OFC: Viva operacional exclui apenas histórico observacional", () => {
  const f = fixture();
  const legacy = ofc.resumoFilaWorkspace(workspaceId, {
    filaItens: f.legacyItems, agoraMs: NOW, janelaAbertaAgora: true
  });
  const selected = ofc.selecionarFonteSnapshotOFC(workspaceId, {
    getClienteJsonPath: resolver(f.paths), env: envViva()
  });
  const live = ofc.lerFilaWorkspaceSnapshot(workspaceId, {
    getClienteJsonPath: resolver(f.paths), source: "fila_viva", sourceValidated: true, sourceMeta: selected
  });
  const vivaResumo = ofc.resumoFilaWorkspace(workspaceId, {
    filaItens: live.itens, agoraMs: NOW, janelaAbertaAgora: true
  });
  const common = {
    clienteId: workspaceId,
    usuario: { creditos: 100 },
    configExecutor: { automacaoAtiva: true },
    destinos: [destino],
    eventos: {},
    janelaMinutos: 15,
    agoraMs: NOW,
    emitirLogs: false
  };
  const legacyGate = ofc.montarGateWorkspace({ ...common, fila: legacy });
  const vivaGate = ofc.montarGateWorkspace({ ...common, fila: vivaResumo });
  assert.deepEqual(decision(vivaGate), decision(legacyGate));
  assert.notEqual(vivaGate.totalEnviadosHistorico, legacyGate.totalEnviadosHistorico);
  assert.equal(vivaGate.pressaoEsteiraViva, legacyGate.pressaoEsteiraViva);
});

test("Worker recebe o path Viva, calcula off-thread e não transporta o array", async () => {
  const f = fixture();
  const client = criarClienteWorker();
  let seenInput;
  const events = [];
  try {
    const resultado = await ofc.criarGateAbsorcaoShadowOfc(gateOptions(f.paths, {
      env: envViva(),
      workerOfc: true,
      clienteWorker: { executar: input => { seenInput = input; return client.executar(input); } },
      observarWorker: event => events.push(event)
    }));
    assert.equal(seenInput.source, "fila_viva");
    assert.equal(seenInput.arquivo, f.paths["fila-viva.json"]);
    assert.equal(Object.hasOwn(seenInput, "itens"), false);
    assert.equal(Object.hasOwn(seenInput, "fila"), false);
    assert.equal(events.length, 1);
    assert.equal(events[0].aceito, true);
    assert.equal(events[0].perf.leitura.source, "fila_viva");
    assert.equal(events[0].perf.leitura.legacyReadAvoided, true);
    assert.equal(resultado.workspaces[0].pressaoEsteiraViva, 1);
  } finally {
    await client.fechar();
  }
});

test("revisão Viva alterada durante Worker é rejeitada e usa o legado", async () => {
  const f = fixture();
  const client = criarClienteWorker();
  let changed = false;
  try {
    const resultado = await ofc.criarGateAbsorcaoShadowOfc(gateOptions(f.paths, {
      env: envViva(),
      workerOfc: true,
      clienteWorker: {
        executar: input => client.executar(input, {
          beforeAccept: () => {
            fs.writeFileSync(f.paths["fila-viva.json"], JSON.stringify([]));
            changed = true;
          }
        })
      }
    }));
    const legado = await ofc.criarGateAbsorcaoShadowOfc(gateOptions(f.paths));
    assert.equal(changed, true);
    assert.deepEqual(decision(resultado.workspaces[0]), decision(legado.workspaces[0]));
  } finally {
    await client.fechar();
  }
});

test("métricas fast path reportam source, bytes e estimate sem payload comercial", () => {
  const f = fixture();
  const selected = ofc.selecionarFonteSnapshotOFC(workspaceId, {
    getClienteJsonPath: resolver(f.paths), env: envViva()
  });
  const leituras = [];
  const leitura = ofc.lerFilaWorkspaceSnapshot(workspaceId, {
    getClienteJsonPath: resolver(f.paths), source: "fila_viva", sourceValidated: true,
    sourceMeta: selected, medidorCiclo: { registrarLeitura: value => leituras.push(value) }
  });
  assert.equal(leitura.ok, true);
  assert.equal(leituras.length, 1);
  assert.equal(leituras[0].source, "fila_viva");
  assert.equal(leituras[0].legacyReadAvoided, true);
  assert.ok(leituras[0].sourceBytes > 0);
  assert.ok(leituras[0].bytesAvoidedEstimate >= 0);
  assert.equal(Object.hasOwn(leituras[0], "itens"), true);
});

test("benchmark representativo opcional legacy ~300 MiB versus Viva ~30 MiB", { skip: process.env.OFC_SNAPSHOT_VIVA_BENCHMARK !== "1" }, async () => {
  const f = fixture({ legacy: [item("legacy")], vivaEntries: [{ item: item("viva"), bucket: "viva" }] });
  const legacyTarget = 300 * 1024 * 1024;
  const vivaTarget = 30 * 1024 * 1024;
  const payload = size => "x".repeat(Math.max(0, size));
  fs.writeFileSync(f.paths["fila.json"], JSON.stringify([{ ...item("legacy"), payload: payload(legacyTarget) }]));
  fs.writeFileSync(f.paths["fila-viva.json"], JSON.stringify([{ item: { ...item("viva"), payload: payload(vivaTarget) }, bucket: "viva" }]));
  publishVivaProof(f.paths);
  const read = async file => {
    const delay = monitorEventLoopDelay({ resolution: 10 });
    delay.enable();
    await new Promise(resolve => setImmediate(resolve));
    const memoryBefore = process.memoryUsage();
    const start = performance.now();
    let ticks = 0;
    const samples = [];
    let nextDue = start + 10;
    const timer = setInterval(() => {
      const now = performance.now();
      ticks += 1;
      samples.push(Math.max(0, now - nextDue));
      nextDue += 10;
    }, 10);
    const text = fs.readFileSync(file, "utf8");
    const afterRead = performance.now();
    const memoryAfterRead = process.memoryUsage();
    JSON.parse(text);
    const afterParse = performance.now();
    const memoryAfterParse = process.memoryUsage();
    await new Promise(resolve => setImmediate(resolve));
    clearInterval(timer);
    const memoryAfter = process.memoryUsage();
    const orderedSamples = [...samples].sort((a, b) => a - b);
    const sampleP95 = orderedSamples.length
      ? orderedSamples[Math.min(orderedSamples.length - 1, Math.ceil(orderedSamples.length * 0.95) - 1)]
      : delay.percentile(95) / 1e6;
    const sampleMax = orderedSamples.length ? orderedSamples[orderedSamples.length - 1] : delay.max / 1e6;
    const result = {
      bytes: Buffer.byteLength(text),
      readMs: afterRead - start,
      parseMs: afterParse - afterRead,
      wallMs: afterParse - start,
      rssBeforeBytes: memoryBefore.rss,
      rssAfterBytes: memoryAfter.rss,
      rssPeakBytes: Math.max(memoryBefore.rss, memoryAfterRead.rss, memoryAfterParse.rss, memoryAfter.rss),
      heapBeforeBytes: memoryBefore.heapUsed,
      heapAfterBytes: memoryAfter.heapUsed,
      heapPeakBytes: Math.max(memoryBefore.heapUsed, memoryAfterRead.heapUsed, memoryAfterParse.heapUsed, memoryAfter.heapUsed),
      ticks,
      samples: samples.length,
      mainLagP95Ms: sampleP95,
      mainLagMaxMs: sampleMax,
    };
    delay.disable();
    return result;
  };
  const legacy = await read(f.paths["fila.json"]);
  const selected = ofc.selecionarFonteSnapshotOFC(workspaceId, { getClienteJsonPath: resolver(f.paths), env: envViva() });
  const vivaRead = await read(f.paths["fila-viva.json"]);
  const worker = criarClienteWorker();
  let workerEvent = null;
  try {
    await ofc.criarGateAbsorcaoShadowOfc(gateOptions(f.paths, {
      env: envViva(),
      workerOfc: true,
      clienteWorker: { executar: input => worker.executar(input) },
      observarWorker: event => { workerEvent = event; }
    }));
  } finally {
    await worker.fechar();
  }
  const workerMemory = workerEvent?.perf?.memory || [];
  const workerRssPeak = workerMemory.reduce((max, point) => Math.max(max, Number(point.rss || 0)), 0);
  const workerHeapPeak = workerMemory.reduce((max, point) => Math.max(max, Number(point.heapUsed || 0)), 0);
  console.log("[OFC-SNAPSHOT-VIVA-BENCHMARK]", JSON.stringify({ legacy, viva: vivaRead,
    worker: {
      readMs: workerEvent?.perf?.leitura?.leituraMs,
      parseMs: workerEvent?.perf?.leitura?.parseMs,
      wallMs: workerEvent?.perf?.wallMs,
      rssPeakBytes: workerRssPeak,
      heapPeakBytes: workerHeapPeak,
      legacyReadAvoided: workerEvent?.perf?.leitura?.legacyReadAvoided === true
    },
    bytesAvoidedEstimate: selected.bytesAvoidedEstimate }));
  assert.ok(legacy.bytes > 290 * 1024 * 1024);
  assert.ok(vivaRead.bytes > 29 * 1024 * 1024);
  assert.ok(selected.bytesAvoidedEstimate > 250 * 1024 * 1024);
});

module.exports = { fixture, gateOptions, envViva };
