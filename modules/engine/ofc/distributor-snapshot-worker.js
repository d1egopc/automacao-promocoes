"use strict";

const fs = require("node:fs");
const { parentPort } = require("node:worker_threads");
const { performance } = require("node:perf_hooks");
const { identidade, revisao, iguais } = require("./workspace-worker-revision");
const {
  lerFilaWorkspaceSnapshot,
  resumoFilaWorkspace,
  avaliarDestinosWorkspace
} = require("./absorption-gate.service");
const {
  calcularBufferAtualShadow,
  coberturaFluxoMinutos,
  nivelAlvoPorCobertura
} = require("../flow-manager/flow-manager.service");
const {
  calcularBufferVivoWorkspace,
  resumirDivergenciaBufferVivo
} = require("./buffer-vivo-workspace.service");

const JOB_TYPE = "distributor_compact_v1";

function compactarResumoFila(fila = {}) {
  const { itens: _itens, itensPressaoViva: _itensPressaoViva, ...compacto } = fila || {};
  if (Array.isArray(_itensPressaoViva)) compacto.itensPressaoVivaTotal = _itensPressaoViva.length;
  return compacto;
}

function compactarComReferencia(valor, referencia, outroValor) {
  return JSON.stringify(valor) === JSON.stringify(outroValor)
    ? { sameAs: referencia }
    : valor;
}

function calcular(input = {}) {
  if (input.type !== JOB_TYPE) throw new Error("distributor_worker_job_invalid");
  if (!Number.isFinite(input.agoraMs) || input.agoraMs <= 0) throw new Error("distributor_worker_clock_invalid");

  const inicio = performance.now();
  const memoria = [{ etapa: "antes", ...process.memoryUsage() }];
  const before = revisao(input.arquivo);
  if (!before) throw new Error("distributor_source_missing");

  let fd;
  let leituraPerf = {};
  let revisionFailure;
  try {
    fd = fs.openSync(input.arquivo, "r");
    if (!iguais(before, identidade(fs.fstatSync(fd, { bigint: true })))) {
      throw new Error("distributor_revision_changed");
    }

    const leitura = lerFilaWorkspaceSnapshot(input.workspaceId, {
      arquivo: input.arquivo,
      source: "fila_viva",
      sourceValidated: true,
      sourceMeta: input.sourceMeta || {},
      revisionGuardHandled: true,
      readFileSync: () => {
        const texto = fs.readFileSync(fd, "utf8");
        memoria.push({ etapa: "apos_read", ...process.memoryUsage() });
        try {
          if (!iguais(before, identidade(fs.fstatSync(fd, { bigint: true })))) {
            throw new Error("distributor_revision_changed");
          }
        } catch (erro) {
          revisionFailure = erro;
          throw erro;
        }
        fs.closeSync(fd);
        fd = undefined;
        return texto;
      },
      medidorCiclo: {
        clock: () => performance.now(),
        registrarLeitura: dados => { leituraPerf = dados; }
      }
    });

    if (revisionFailure) throw revisionFailure;
    if (leitura.ok !== true) throw new Error(leitura.motivo || "distributor_source_invalid");

    memoria.push({ etapa: "apos_parse", ...process.memoryUsage() });
    const calculoInicio = performance.now();
    const destinos = Array.isArray(input.destinosFlow) ? input.destinosFlow : (Array.isArray(input.destinos) ? input.destinos : []);
    const destinosGate = Array.isArray(input.destinosGate) ? input.destinosGate : destinos;
    const tipoFluxo = input.tipoFluxo || (input.cupomTurbo === true ? "cupom_turbo" : "oferta_comum");
    const flowCoberturaMinutos = Number(input.flowCoberturaMinutos) || coberturaFluxoMinutos(tipoFluxo);
    const gateCoberturaMinutos = Number(input.gateCoberturaMinutos) || 15;
    const flowDestinosResumo = avaliarDestinosWorkspace(destinos, flowCoberturaMinutos, leitura.itens, input.agoraMs);
    const gateDestinosResumo = avaliarDestinosWorkspace(destinosGate, gateCoberturaMinutos, leitura.itens, input.agoraMs);
    const filaFlow = resumoFilaWorkspace(input.workspaceId, {
      agoraMs: input.agoraMs,
      filaItens: leitura.itens,
      fonteFilaValida: true,
      fonteFilaMotivo: "",
      fonteFilaColetadaEmMs: leitura.collectedAtMs,
      janelaMinutos: flowCoberturaMinutos,
      finalizacoesAgoraMs: input.agoraMs,
      janelaAbertaAgora: flowDestinosResumo.janelaAbertaAgora
    });
    const filaGate = resumoFilaWorkspace(input.workspaceId, {
      agoraMs: input.agoraMs,
      filaItens: leitura.itens,
      fonteFilaValida: true,
      fonteFilaMotivo: "",
      fonteFilaColetadaEmMs: leitura.collectedAtMs,
      janelaMinutos: gateCoberturaMinutos,
      finalizacoesAgoraMs: input.agoraMs,
      janelaAbertaAgora: gateDestinosResumo.janelaAbertaAgora
    });
    const bufferShadow = calcularBufferAtualShadow(leitura.itens, flowDestinosResumo, { agoraMs: input.agoraMs });
    const bufferVivoShadow = calcularBufferVivoWorkspace({
      workspaceId: input.workspaceId,
      ofertaId: input.ofertaId ?? null,
      marketplace: input.marketplace || "",
      categoria: input.categoria || "",
      tipoMidia: input.tipoMidia || "",
      tipoFluxo,
      destinosCompativeis: destinos,
      destinosResumo: flowDestinosResumo,
      filaItens: leitura.itens,
      agoraMs: input.agoraMs
    });
    const bufferVivoDivergencia = resumirDivergenciaBufferVivo(bufferVivoShadow);
    memoria.push({ etapa: "apos_calculo", ...process.memoryUsage() });

    const after = revisao(input.arquivo);
    if (!iguais(before, after)) throw new Error("distributor_revision_changed");

    const result = {
      type: JOB_TYPE,
      workspaceId: input.workspaceId,
      source: "fila_viva",
      before,
      after,
      facts: {
        flow: {
          fila: compactarResumoFila(filaFlow),
          destinosResumo: flowDestinosResumo,
          bufferShadow,
          bufferVivoShadow,
          bufferVivoDivergencia,
          nivelAlvoCalculado: nivelAlvoPorCobertura(flowDestinosResumo, tipoFluxo)
        },
        gate: {
          fila: compactarComReferencia(compactarResumoFila(filaGate), "flow.fila", compactarResumoFila(filaFlow)),
          destinosResumo: compactarComReferencia(gateDestinosResumo, "flow.destinosResumo", flowDestinosResumo)
        }
      },
      perf: {
        leitura: leituraPerf,
        contentReads: 1,
        legacyContentReads: 0,
        wallMs: performance.now() - inicio,
        calcMs: performance.now() - calculoInicio,
        memory: memoria,
        heapFinal: process.memoryUsage().heapUsed
      }
    };
    result.perf.compactResponseBytes = Buffer.byteLength(JSON.stringify(result.facts), "utf8");
    return result;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

parentPort.on("message", ({ id, input }) => {
  const recebidoPerfMs = performance.now();
  let message;
  try {
    message = { id, ok: true, result: calcular(input) };
  } catch (erro) {
    message = { id, ok: false, reason: erro?.code || erro?.message || "distributor_worker_failed" };
  }
  message.enviadoPerfMs = performance.now();
  message.enviadoTimeOrigin = performance.timeOrigin;
  message.recebidoPerfMs = recebidoPerfMs;
  message.outputCloneBytes = Buffer.byteLength(JSON.stringify(message), "utf8");
  parentPort.postMessage(message);
});

module.exports = { JOB_TYPE, calcular, compactarResumoFila };
