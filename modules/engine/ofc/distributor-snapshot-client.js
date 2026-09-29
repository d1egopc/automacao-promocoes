"use strict";

const path = require("node:path");
const { Worker } = require("node:worker_threads");
const { performance } = require("node:perf_hooks");
const { revisao, iguais } = require("./workspace-worker-revision");

const JOB_TYPE = "distributor_compact_v1";

const TIMEOUT_MS = 30000;
const RESOURCE_LIMITS = Object.freeze({ maxOldGenerationSizeMb: 1024, maxYoungGenerationSizeMb: 32 });

function criarClienteDistributorSnapshot({
  workerFactory = () => new Worker(path.join(__dirname, "distributor-snapshot-worker.js"), { resourceLimits: RESOURCE_LIMITS }),
  timeoutMs = TIMEOUT_MS
} = {}) {
  timeoutMs = Math.max(1, Math.min(120000, Number(timeoutMs) || TIMEOUT_MS));
  let worker = null;
  let pending = null;
  let nextId = 0;
  let tail = Promise.resolve();
  let closed = false;

  function obterWorker() {
    if (worker) return worker;
    const instance = workerFactory();
    worker = instance;
    instance.on("error", erro => { if (worker === instance && pending) pending.reject(erro); });
    instance.on("exit", code => {
      if (worker === instance) {
        worker = null;
        if (pending) pending.reject(new Error(`distributor_worker_exit_${code}`));
      }
    });
    instance.on("message", message => { if (worker === instance && pending) pending.resolve(message); });
    instance.on("messageerror", erro => { if (worker === instance && pending) pending.reject(erro); });
    instance.unref();
    return instance;
  }

  async function aposentar() {
    const instance = worker;
    worker = null;
    if (instance) await instance.terminate();
  }

  function executar(input = {}, execOpcoes = {}) {
    const job = tail.then(async () => {
      if (closed) throw new Error("distributor_worker_closed");
      const expected = revisao(input.arquivo);
      const id = ++nextId;
      if (!expected) throw new Error("distributor_source_missing");
      const instance = obterWorker();
      instance.ref();
      let timer;
      let resposta = null;
      try {
        const inicio = performance.now();
        const inputCloneBytes = Buffer.byteLength(JSON.stringify(input), "utf8");
        const enviadoPerfMs = performance.now();
        resposta = await new Promise((resolve, reject) => {
          pending = { resolve, reject };
          timer = setTimeout(() => reject(new Error("distributor_worker_timeout")), timeoutMs);
          instance.postMessage({ id, input: { ...input, type: JOB_TYPE } });
        });
        const recebidoPerfMs = performance.now();
        if (!resposta || resposta.id !== id || resposta.ok !== true || !resposta.result) {
          throw new Error(resposta?.reason || "distributor_worker_response_invalid");
        }
        if (!iguais(expected, resposta.result.before) || !iguais(resposta.result.before, resposta.result.after)) {
          throw new Error("distributor_revision_changed");
        }
        resposta.result.perf = resposta.result.perf || {};
        resposta.result.perf.inputCloneBytes = inputCloneBytes;
        resposta.result.perf.inputDispatchMs = Number.isFinite(Number(resposta.recebidoPerfMs))
          ? Math.max(0, Number(resposta.recebidoPerfMs) - enviadoPerfMs)
          : null;
        resposta.result.perf.outputCloneBytes = Number.isFinite(Number(resposta.outputCloneBytes))
          ? Number(resposta.outputCloneBytes)
          : null;
        resposta.result.perf.outputDispatchMs = Number.isFinite(Number(resposta.enviadoPerfMs))
          ? Math.max(0, recebidoPerfMs - Number(resposta.enviadoPerfMs))
          : null;
        resposta.result.perf.roundTripMs = recebidoPerfMs - inicio;
        return resposta.result;
      } catch (erro) {
        try {
          if (typeof execOpcoes.onEvent === "function") {
            const mensagem = String(erro?.message || erro?.code || "");
            const fallbackReason = mensagem.includes("timeout")
              ? "worker_timeout"
              : mensagem.includes("revision_changed")
                ? "revision_changed_worker"
                : mensagem.includes("response")
                  ? "worker_response_invalid"
                  : mensagem.includes("closed") || mensagem.includes("exit") || mensagem.includes("crash")
                    ? "worker_error"
                    : "worker_unavailable";
            execOpcoes.onEvent({
              stage: "worker_invalid",
              fallbackReason,
              revisionBefore: expected,
              revisionAfter: resposta?.result?.after
            });
          }
        } catch (_) {}
        await aposentar();
        throw erro;
      } finally {
        clearTimeout(timer);
        pending = null;
        if (worker === instance) instance.unref();
      }
    });
    tail = job.then(() => undefined, () => undefined);
    return job;
  }

  async function fechar() {
    closed = true;
    await tail;
    await aposentar();
  }

  return { executar, fechar };
}

let singleton;

async function executarDistributorSnapshot(input, opcoes = {}) {
  try {
    singleton ||= criarClienteDistributorSnapshot(opcoes);
    return await (opcoes.clienteDistributorSnapshot || singleton).executar(input, {
      onEvent: opcoes.onEvent
    });
  } catch {
    return null;
  }
}

async function fecharDistributorSnapshot() {
  if (singleton) {
    await singleton.fechar();
    singleton = null;
  }
}

module.exports = {
  TIMEOUT_MS,
  RESOURCE_LIMITS,
  criarClienteDistributorSnapshot,
  executarDistributorSnapshot,
  fecharDistributorSnapshot
};
