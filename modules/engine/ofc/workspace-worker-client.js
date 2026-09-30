"use strict";
const path = require("node:path");
const { Worker } = require("node:worker_threads");
const { performance } = require("node:perf_hooks");
const { revisao, iguais } = require("./workspace-worker-revision");
const TIMEOUT_MS = 30000;
const RESOURCE_LIMITS = Object.freeze({ maxOldGenerationSizeMb: 1024, maxYoungGenerationSizeMb: 32 });
// Only destination configuration read by the shared classification helpers.
const DESTINO_FIELDS = ("id destinoId jid value chatId tipo canal nome ativo intervaloMinutos intervalo intervaloEnvioMinutos intervaloConfiguradoMinutos " +
  "cupomTurbo cupom_turbo turboCupom turbo prioridadeCupomAtiva modo modoEnvio " +
  "integracaoApta integracao_apta statusIntegracao integracaoStatus statusSessao status cookieVencido cookiesVencidos cookies_expirados erroIntegracao motivoInapto motivoBloqueio " +
  "limiteDiario limite_diario limiteEnviosDia limiteDiarioEnvios enviadosHoje enviosHoje enviosRealizadosHoje limiteDiarioRestante limite_diario_restante enviosRestantesHoje " +
  "horarioInicio horaInicio horaInicial inicio horarioInicial horarioFim horaFim horaFinal fim horarioFinal").split(" ");
function projetarDestinoWorker(destino) {
  const projected = Object.fromEntries(DESTINO_FIELDS.filter(k => Object.hasOwn(destino, k)).map(k => [k, destino[k]]));
  // The integration helper reads only truthiness, never the credential contents.
  if (Object.hasOwn(destino, "botToken")) projected.botToken = Boolean(destino.botToken);
  return projected;
}

function classificarRespostaWorker(message, id, input) {
  if (!message || typeof message !== "object" || message.id !== id || message.ok !== true ||
      !Number.isFinite(message.enviadoPerfMs) || !Number.isFinite(message.enviadoTimeOrigin)) {
    return "ofc_worker_message_invalid";
  }
  const r = message.result;
  const w = r?.workspace;
  if (!w || typeof w !== "object" || w.workspaceId !== input.workspaceId) {
    return "ofc_worker_workspace_mismatch";
  }
  if (!r || r.agoraMs !== input.agoraMs) return "ofc_worker_payload_invalid";
  if (typeof r.leitura?.ok !== "boolean" || typeof r.leitura.motivo !== "string" ||
      !Number.isFinite(r.leitura.collectedAtMs) ||
      w.fonteFilaValida !== r.leitura.ok || w.fonteFilaMotivo !== r.leitura.motivo ||
      w.fonteFilaColetadaEmMs !== r.leitura.collectedAtMs ||
      typeof r.destinosPreview?.topologiaOperacionalPotencial !== "boolean" ||
      !w.bufferVivoShadow || !w.bufferVivoDivergencia || !Array.isArray(w.capacidadePorDestino) ||
      !["queueDepthActionable", "queueDepthRaw", "oldestActionableAge", "capacityEffective"]
        .every(k => Number.isFinite(w[k]) && w[k] >= 0) ||
      Object.hasOwn(r, "itens") || Object.hasOwn(r, "fila") ||
      Object.hasOwn(w, "itens") || !r.perf || typeof r.perf.leitura !== "object") {
    return "ofc_worker_payload_invalid";
  }
  if (!iguais(r.before, r.after)) return "ofc_worker_before_after_changed";
  return "";
}

function valido(message, id, input) {
  return classificarRespostaWorker(message, id, input) === "";
}

function criarClienteWorker({ workerFactory = () => new Worker(path.join(__dirname, "workspace-worker.js"), { resourceLimits: RESOURCE_LIMITS }), timeoutMs = TIMEOUT_MS } = {}) {
  timeoutMs = Math.max(1, Math.min(120000, Number(timeoutMs) || TIMEOUT_MS));
  let worker = null, pending = null, nextId = 0, tail = Promise.resolve(), closed = false;
  function obter() {
    if (worker) return worker;
    const instance = workerFactory(); worker = instance;
    // Keep error/exit listeners for the entire object lifecycle, including late events.
    instance.on("error", e => { if (worker === instance && pending) pending.reject(e); });
    instance.on("exit", code => {
      if (worker === instance) {
        worker = null;
        if (pending) pending.reject(new Error("ofc_worker_exit_" + code));
      }
    });
    instance.on("message", message => { if (worker === instance && pending) pending.resolve(message); });
    instance.on("messageerror", e => { if (worker === instance && pending) pending.reject(e); });
    instance.unref();
    return instance;
  }
  async function aposentar() {
    const instance = worker; worker = null;
    if (instance) await instance.terminate();
  }
  function executar(input, { beforeAccept } = {}) {
    const job = tail.then(async () => {
      if (closed) throw new Error("ofc_worker_closed");
      const expected = revisao(input.arquivo), id = ++nextId;
      const instance = obter(); instance.ref();
      let timer, inputCloneMs;
      try {
        const start = performance.now();
        const message = await new Promise((resolve, reject) => {
          pending = { resolve, reject };
          timer = setTimeout(() => reject(new Error("ofc_worker_timeout")), timeoutMs);
          const cloneInicio = performance.now();
          instance.postMessage({ id, input });
          inputCloneMs = performance.now() - cloneInicio;
        });
        const motivoResposta = classificarRespostaWorker(message, id, input);
        if (motivoResposta) throw new Error(motivoResposta);
        if (!iguais(expected, message.result.before)) throw new Error("ofc_revision_changed_before_worker");
        // Test barrier only; no hook is installed in the production singleton.
        if (beforeAccept) await beforeAccept(message);
        if (!iguais(message.result.after, revisao(input.arquivo))) throw new Error("ofc_revision_changed");
        message.result.perf.roundTripMs = performance.now() - start;
        message.result.perf.inputCloneMs = inputCloneMs;
        message.result.perf.returnCloneAndDispatchMs = Math.max(0, performance.timeOrigin + performance.now() - message.enviadoTimeOrigin - message.enviadoPerfMs);
        return message.result;
      } catch (e) {
        // Termination finishes before another queued job creates a replacement.
        await aposentar();
        throw e;
      } finally {
        clearTimeout(timer); pending = null;
        if (worker === instance) instance.unref();
      }
    });
    tail = job.then(() => undefined, () => undefined);
    return job;
  }
  async function fechar() { closed = true; await tail; await aposentar(); }
  return { executar, fechar };
}

let singleton;
async function observar(opcoes, input, event) {
  // Diagnostic only; it must never turn an accepted classification into fallback.
  try {
    if (opcoes.observarWorker) await opcoes.observarWorker(event);
    else console.log("[OFC-WORKSPACE-WORKER]", JSON.stringify({ workspaceId: input.workspaceId,
      ...(opcoes.subcallerTag ? { subcallerTag: opcoes.subcallerTag, observationId: opcoes.observationId || "" } : {}),
      aceito: event.aceito, fallback: !event.aceito,
      source: event.perf?.leitura?.source || input.source || "fila_legacy",
      sourceBytes: event.perf?.leitura?.sourceBytes,
      proofValidationMs: event.perf?.leitura?.proofValidationMs,
      legacyReadAvoided: event.perf?.leitura?.legacyReadAvoided === true,
      bytesAvoidedEstimate: event.perf?.leitura?.bytesAvoidedEstimate || 0,
      fallbackReason: event.perf?.leitura?.fallbackReason || event.motivo || "",
      revisionChanged: event.perf?.leitura?.revisionChanged === true,
      wallMs: event.perf?.wallMs, leituraMs: event.perf?.leitura?.leituraMs,
      parseMs: event.perf?.leitura?.parseMs, calculoMs: event.perf?.calcMs,
      inputCloneMs: event.perf?.inputCloneMs, returnCloneAndDispatchMs: event.perf?.returnCloneAndDispatchMs }));
  } catch (_) { /* An optional observer has no decision authority. */ }
}
async function avaliarComWorker(input, opcoes = {}) {
  try {
    // Function-based reader fixtures cannot cross structured clone; use fresh legacy fallback.
    if (opcoes.readFilaSnapshot || opcoes.readFileSync) throw new Error("ofc_worker_injected_reader");
    singleton ||= criarClienteWorker();
    const result = await (opcoes.clienteWorker || singleton).executar(input);
    return result;
  } catch (e) {
    await observar(opcoes, input, { aceito: false, motivo: e.message || "ofc_worker_failed" });
    return null;
  }
}
async function registrarResultadoWorker(result, opcoes, workspaceId) {
  opcoes.medidorCiclo?.registrarLeitura(result.perf.leitura);
  require("./absorption-gate.service").logBufferVivoGateShadow(result.workspace.bufferVivoShadow, result.workspace.bufferVivoDivergencia);
  await observar(opcoes, { workspaceId }, { aceito: true, perf: result.perf });
}
async function registrarFallbackWorker(opcoes, workspaceId) {
  await observar(opcoes, { workspaceId }, { aceito: false, motivo: "ofc_revision_changed_at_consumer",
    perf: { leitura: { source: "fila_legacy", fallbackReason: "ofc_revision_changed_at_consumer", revisionChanged: true } } });
}
async function fecharWorkerOfc() { if (singleton) { await singleton.fechar(); singleton = null; } }
module.exports = { TIMEOUT_MS, RESOURCE_LIMITS, criarClienteWorker, avaliarComWorker, fecharWorkerOfc,
  valido, classificarRespostaWorker, projetarDestinoWorker, registrarResultadoWorker, registrarFallbackWorker };
