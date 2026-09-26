"use strict";
const fs = require("node:fs");
const { parentPort } = require("node:worker_threads");
const { performance } = require("node:perf_hooks");
const { identidade, revisao, iguais } = require("./workspace-worker-revision");
// Reuse the actual helpers; repository imports are lazy and never reached here.
const ofc = require("./absorption-gate.service");

function calcular(input) {
  if (!Number.isFinite(input.agoraMs) || input.agoraMs <= 0) throw new Error("ofc_worker_clock_invalid");
  const inicio = performance.now(), cpu = process.cpuUsage();
  const memory = [{ etapa: "antes", ...process.memoryUsage() }];
  const before = revisao(input.arquivo);
  let fd, leituraPerf = {}, revisionFailure;
  try {
    if (before) {
      fd = fs.openSync(input.arquivo, "r");
      if (!iguais(before, identidade(fs.fstatSync(fd, { bigint: true })))) throw new Error("ofc_revision_changed");
    }
    const preview = ofc.avaliarDestinosWorkspace(input.destinos, input.janelaMinutos, [], input.agoraMs);
    const leitura = ofc.lerFilaWorkspaceSnapshot(input.workspaceId, {
      getClienteJsonPath: () => input.arquivo,
      ...(input.coletaTesteMs === undefined ? {} : { clock: () => input.coletaTesteMs }),
      readFileSync: () => {
        // Missing at entry is handled by the same legacy reader error contract.
        if (fd === undefined) { const e = new Error("missing"); e.code = "ENOENT"; throw e; }
        const text = fs.readFileSync(fd, "utf8");
        memory.push({ etapa: "apos_read", ...process.memoryUsage() });
        try {
          if (!iguais(before, identidade(fs.fstatSync(fd, { bigint: true })))) throw new Error("ofc_revision_changed");
        } catch (e) { revisionFailure = e; throw e; }
        fs.closeSync(fd); fd = undefined;
        return text;
      },
      medidorCiclo: { clock: () => performance.now(), registrarLeitura: d => { leituraPerf = d; } }
    });
    // The legacy reader deliberately converts read errors to metadata. Revision
    // uncertainty is different: reject it, never accept it as a source error.
    if (revisionFailure) throw revisionFailure;
    leituraPerf.bytesArquivoObservados = before ? Number(before.size) : null;
    memory.push({ etapa: "apos_parse", ...process.memoryUsage() });
    const calcInicio = performance.now();
    const fila = ofc.resumoFilaWorkspace(input.workspaceId, {
      agoraMs: input.agoraMs, filaItens: leitura.itens,
      fonteFilaValida: leitura.ok, fonteFilaMotivo: leitura.motivo,
      fonteFilaColetadaEmMs: leitura.collectedAtMs,
      janelaMinutos: input.janelaMinutos, finalizacoesAgoraMs: input.finalizacoesAgoraMs,
      janelaAbertaAgora: preview.janelaAbertaAgora
    });
    const workspace = ofc.montarGateWorkspace({ clienteId: input.workspaceId,
      usuario: input.usuario, configExecutor: input.configExecutor, destinos: input.destinos,
      fila, eventos: input.eventos, janelaMinutos: input.janelaMinutos,
      agoraMs: input.agoraMs, emitirLogs: false });
    memory.push({ etapa: "apos_calculo", ...process.memoryUsage() });
    if (fd !== undefined && !iguais(before, identidade(fs.fstatSync(fd, { bigint: true })))) throw new Error("ofc_revision_changed");
    const after = revisao(input.arquivo);
    if (!iguais(before, after)) throw new Error("ofc_revision_changed");
    const cpuUsed = process.cpuUsage(cpu);
    // Neither text, parsed items nor full fila crosses the message boundary.
    return { agoraMs: input.agoraMs, workspace, destinosPreview: { topologiaOperacionalPotencial: preview.topologiaOperacionalPotencial },
      leitura: { ok: leitura.ok, motivo: leitura.motivo, collectedAtMs: leitura.collectedAtMs },
      before, after, perf: { leitura: leituraPerf, calcMs: performance.now() - calcInicio,
        wallMs: performance.now() - inicio, cpuMs: (cpuUsed.user + cpuUsed.system) / 1000,
        memory, heapFinal: process.memoryUsage().heapUsed } };
  } finally { if (fd !== undefined) fs.closeSync(fd); }
}

parentPort.on("message", ({ id, input }) => {
  let message;
  try { message = { id, ok: true, result: calcular(input) }; }
  catch (e) { message = { id, ok: false, reason: e.code || e.message || "ofc_worker_failed" }; }
  message.enviadoPerfMs = performance.now();
  message.enviadoTimeOrigin = performance.timeOrigin;
  parentPort.postMessage(message);
  // Only modules/functions survive between jobs; no queue/result references retained.
});
module.exports = { calcular };
