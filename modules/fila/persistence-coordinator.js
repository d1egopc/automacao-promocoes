"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { Worker } = require("worker_threads");
const {
  OP_PREPARE,
  OP_PUBLISH,
  OP_CLEANUP,
  OP_TERMINAL_INDEX_BOOTSTRAP,
  OP_TERMINAL_INDEX_DELTA,
  OP_VIVA_MUTATION,
  OP_VIVA_SNAPSHOT_PROBE,
  RESPONSE_OK,
  RESPONSE_PROGRESS,
  flagWorkerAtiva,
  decisaoPersistenciaWorkspace,
  decisaoPersistenciaVivaWorkspace,
  timeoutWorkerMs,
  normalizarDataDir,
  workspaceSeguro,
  revisionSegura,
  jobId,
  erroSanitizado,
  sameIdentity
} = require("./persistence-protocol");
const {
  flagAtiva: terminalIndexShadowAtivo,
  registrarManutencaoTerminalIndex,
  validarTerminalIndex,
  classificarRecuperacaoTerminalIndex
} = require("./terminal-index-shadow");

function agoraMs() {
  return Date.now();
}

function rejeicao(motivo, detalhe = "", extras = {}) {
  return { ok: false, motivo, motivoDetalhado: detalhe || motivo, ...extras };
}

function numeroLimite(env, chave, padrao) {
  const valor = Number(env?.[chave]);
  return Number.isFinite(valor) && valor > 0 ? Math.floor(valor) : padrao;
}

function hashWorkspace(workspace) {
  return crypto.createHash("sha256").update(String(workspace)).digest("hex").slice(0, 12);
}

// The existing wall-clock timestamps are retained for log correlation with the
// process panel. They are not used for scheduling, timeout, ACK, or retry logic.
function metricasJob(job = {}, finishedAt = agoraMs()) {
  const terminou = Number(finishedAt) || agoraMs();
  const queuedAt = Number(job.queuedAt) || terminou;
  const startedAt = Number(job.startedAt) || queuedAt;
  return {
    checkpointKey: hashWorkspace(job.checkpointRevision),
    queuedAt,
    startedAt,
    finishedAt: terminou,
    queueWaitMs: Math.max(0, startedAt - queuedAt),
    workerServiceMs: Math.max(0, terminou - startedAt),
    jobTotalMs: Math.max(0, terminou - queuedAt)
  };
}

function erroGlobalWorker(motivo = "") {
  return new Set([
    "worker_error",
    "worker_exit",
    "worker_timeout",
    "worker_post_message_error",
    "worker_terminated_for_test",
    "WORKER_BUSY",
    "persistence_job_invalido",
    "persistence_operation_invalida",
    "persistence_worker_parent_port_indisponivel"
  ]).has(String(motivo));
}

function erroRevisionStale(motivo = "") {
  return String(motivo) === "STALE_REVISION";
}

function criarCoordenadorPersistencia(opcoes = {}) {
  const env = opcoes.env || process.env;
  const logger = opcoes.logger || console;
  const workerPath = opcoes.workerPath || path.join(__dirname, "persistence-worker.js");
  const estado = {
    worker: null,
    workerEnding: null,
    lanes: new Map(),
    readyWorkspaces: [],
    readySet: new Set(),
    ativo: null,
    seq: 0,
    aberto: false,
    falhas: 0,
    ultimaFalha: null,
    encerrando: false,
    signalHandlers: [],
    backpressureRejections: 0,
    loggedRoutingReasons: new Set(),
    completedByWorkspace: new Map(),
    maxQueueWaitByWorkspace: new Map(),
    errorsByWorkspace: new Map(),
    terminalIndexIntents: new Map(),
    terminalIndexRetryTimer: null,
    terminalIndexRetryCount: 0
  };

  function globalAtivo() {
    return flagWorkerAtiva(env);
  }

  function decisao(clienteId = "admin") {
    return decisaoPersistenciaWorkspace(env, clienteId);
  }

  function modoFor(clienteId = "admin") {
    return decisao(clienteId).mode;
  }

  function modoForViva(clienteId = "admin") {
    return decisaoPersistenciaVivaWorkspace(env, clienteId).mode;
  }

  function log(payload = {}) {
    try {
      if (typeof logger.log === "function") logger.log("[FILA-PERSISTENCIA-WORKER]", JSON.stringify(payload));
    } catch {}
  }

  function logRoteamento(decisaoAtual) {
    if (decisaoAtual.motivo === "worker_canary_match") return;
    if (estado.loggedRoutingReasons.has(decisaoAtual.motivo)) return;
    estado.loggedRoutingReasons.add(decisaoAtual.motivo);
    log({ evento: decisaoAtual.motivo });
  }

  function obterLane(clienteId, criar = true) {
    const cliente = workspaceSeguro(clienteId);
    let lane = estado.lanes.get(cliente);
    if (!lane && criar) {
      lane = {
        clienteId: cliente,
        workspaceKey: hashWorkspace(cliente),
        fila: [],
        // Compatibility aliases: circuitoAberto/falhas/ultimaFalha remain
        // the operational checkpoint circuit consumed by existing callers.
        circuitoAberto: false,
        falhas: 0,
        ultimaFalha: null,
        terminalIndexCircuitOpen: false,
        terminalIndexFailures: 0,
        terminalIndexLastFailure: null,
        bytesPendentes: 0,
      };
      estado.lanes.set(cliente, lane);
    }
    return lane;
  }

  function profundidadeLane(lane) {
    return lane.fila.length + (estado.ativo?.lane === lane ? 1 : 0);
  }

  function profundidadeGlobal() {
    let total = estado.ativo ? 1 : 0;
    for (const lane of estado.lanes.values()) total += lane.fila.length;
    return total;
  }

  function bytesPendentesGlobal() {
    let total = Number(estado.ativo?.bytesEstimados || 0);
    for (const lane of estado.lanes.values()) total += lane.bytesPendentes;
    return total;
  }

  function ehManutencaoTerminalIndex(operation) {
    return operation === OP_TERMINAL_INDEX_BOOTSTRAP || operation === OP_TERMINAL_INDEX_DELTA;
  }

  function itemPermitidoPeloCircuito(lane, item) {
    if (!lane || !item) return false;
    const terminalIndex = ehManutencaoTerminalIndex(item.job.operation);
    if (terminalIndex) return !lane.terminalIndexCircuitOpen || item.probeTerminalIndexCircuit === true;
    return !lane.circuitoAberto;
  }

  function laneTemItemElegivel(lane) {
    return Boolean(lane?.fila.some(item => itemPermitidoPeloCircuito(lane, item)));
  }

  function hashSourceRevision(payload = {}) {
    const revision = String(payload.sourceRevision || payload.expectedSourceRevisions?.sourceRevision || "");
    return revision ? crypto.createHash("sha256").update(revision).digest("hex").slice(0, 12) : "";
  }

  function estimarBytes(job) {
    return Buffer.byteLength(JSON.stringify({
      operation: job.operation,
      clienteId: job.clienteId,
      checkpointRevision: job.checkpointRevision,
      targetGeneration: job.targetGeneration,
      expectedSourceRevisions: job.expectedSourceRevisions,
      tempIdentity: job.tempIdentity,
      dataDir: job.dataDir,
      nowMs: job.nowMs,
      mutationType: job.mutationType,
      item: job.item
    }), "utf8");
  }

  function marcarPronto(lane) {
    if (!laneTemItemElegivel(lane)) return;
    if (estado.readySet.has(lane.clienteId)) return;
    estado.readySet.add(lane.clienteId);
    estado.readyWorkspaces.push(lane.clienteId);
  }

  function rejeitarFilaLane(lane, motivo, predicate = () => true) {
    if (!lane) return;
    const pendentes = [];
    const retidos = [];
    for (const item of lane.fila) (predicate(item) ? pendentes : retidos).push(item);
    lane.fila = retidos;
    lane.bytesPendentes = retidos.reduce((total, item) => total + item.bytesEstimados, 0);
    estado.readyWorkspaces = estado.readyWorkspaces.filter(cliente => cliente !== lane.clienteId);
    estado.readySet.delete(lane.clienteId);
    for (const item of pendentes) {
      item.resolve(rejeicao(motivo, motivo, {
        persistenceMode: "worker",
        workspaceKey: lane.workspaceKey
      }));
    }
    marcarPronto(lane);
  }

  function rejeitarFilas(motivo) {
    for (const lane of estado.lanes.values()) rejeitarFilaLane(lane, motivo);
  }

  function registrarFalhaGlobal(motivo, erro = null) {
    estado.aberto = true;
    estado.falhas += 1;
    estado.ultimaFalha = {
      motivo,
      erro: erroSanitizado(erro || {}),
      em: new Date().toISOString()
    };
    log({ estado: "circuit_open", escopo: "global", motivo, falhas: estado.falhas });
    if (estado.terminalIndexRetryTimer) {
      clearTimeout(estado.terminalIndexRetryTimer);
      estado.terminalIndexRetryTimer = null;
    }
    for (const intent of estado.terminalIndexIntents.values()) {
      intent.blockedGlobal = true;
      intent.retryAt = null;
    }
    rejeitarFilas(motivo);
  }

  function registrarFalhaLocal(lane, motivo, erro = null) {
    if (!lane) return;
    lane.circuitoAberto = true;
    lane.falhas += 1;
    lane.ultimaFalha = {
      motivo,
      erro: erroSanitizado(erro || {}),
      em: new Date().toISOString()
    };
    estado.errorsByWorkspace.set(lane.workspaceKey, (estado.errorsByWorkspace.get(lane.workspaceKey) || 0) + 1);
    log({
      estado: "circuit_open",
      escopo: "workspace",
      workspaceKey: lane.workspaceKey,
      motivo,
      falhas: lane.falhas
    });
    rejeitarFilaLane(lane, motivo, item => !ehManutencaoTerminalIndex(item.job.operation));
  }

  function registrarFalhaTerminalIndex(lane, motivo, erro = null) {
    if (!lane) return;
    lane.terminalIndexCircuitOpen = true;
    lane.terminalIndexFailures += 1;
    lane.terminalIndexLastFailure = {
      motivo,
      erro: erroSanitizado(erro || {}),
      em: new Date().toISOString()
    };
    log({
      estado: "circuit_open",
      escopo: "workspace_terminal_index",
      workspaceKey: lane.workspaceKey,
      motivo,
      falhas: lane.terminalIndexFailures
    });
    rejeitarFilaLane(lane, motivo, item => ehManutencaoTerminalIndex(item.job.operation));
  }

  function estadoPublico() {
    const queueDepthByWorkspace = {};
    const circuitByWorkspace = {};
    const lanes = [];
    for (const lane of estado.lanes.values()) {
      queueDepthByWorkspace[lane.workspaceKey] = profundidadeLane(lane);
      circuitByWorkspace[lane.workspaceKey] = lane.circuitoAberto;
      lanes.push({
        workspaceKey: lane.workspaceKey,
        queued: lane.fila.length,
        queueDepth: profundidadeLane(lane),
        circuitOpen: lane.circuitoAberto,
        checkpointCircuitOpen: lane.circuitoAberto,
        terminalIndexCircuitOpen: lane.terminalIndexCircuitOpen,
        failures: lane.falhas,
        lastFailure: lane.ultimaFalha,
        checkpointFailures: lane.falhas,
        checkpointLastFailure: lane.ultimaFalha,
        terminalIndexFailures: lane.terminalIndexFailures,
        terminalIndexLastFailure: lane.terminalIndexLastFailure,
        maintenancePending: estado.terminalIndexIntents.has(lane.clienteId)
      });
    }
    const completedByWorkspace = Object.fromEntries(estado.completedByWorkspace);
    const maxQueueWaitByWorkspace = Object.fromEntries(estado.maxQueueWaitByWorkspace);
    const errorsByWorkspace = Object.fromEntries(estado.errorsByWorkspace);
    return {
      enabled: globalAtivo(),
      workerCreated: Boolean(estado.worker),
      busy: Boolean(estado.ativo),
      queued: estado.lanes.size ? [...estado.lanes.values()].reduce((total, lane) => total + lane.fila.length, 0) : 0,
      queueDepthGlobal: profundidadeGlobal(),
      queueDepthByWorkspace,
      pendingBytes: bytesPendentesGlobal(),
      circuitOpen: estado.aberto,
      globalCircuitOpen: estado.aberto,
      circuitByWorkspace,
      checkpointCircuitByWorkspace: circuitByWorkspace,
      terminalIndexCircuitByWorkspace: Object.fromEntries([...estado.lanes.values()].map(lane => [lane.workspaceKey, lane.terminalIndexCircuitOpen])),
      failures: estado.falhas,
      lastFailure: estado.ultimaFalha,
      backpressureRejections: estado.backpressureRejections,
      completedByWorkspace,
      maxQueueWaitByWorkspace,
      errorsByWorkspace,
      retries: estado.terminalIndexRetryCount,
      terminalIndexPending: estado.terminalIndexIntents.size,
      terminalIndexIntents: [...estado.terminalIndexIntents.values()].map(intent => ({
        workspaceKey: intent.lane.workspaceKey,
        operation: intent.operation,
        attempt: intent.attempt,
        inFlight: intent.inFlight,
        queued: intent.queued,
        blockedGlobal: intent.blockedGlobal,
        queueDepth: profundidadeLane(intent.lane),
        retryInMs: intent.retryAt ? Math.max(0, intent.retryAt - agoraMs()) : null
      })),
      lanes
    };
  }

  function instalarSinais() {
    if (estado.signalHandlers.length) return;
    for (const signal of ["SIGTERM", "SIGINT"]) {
      const handler = () => {
        process.removeListener(signal, handler);
        estado.signalHandlers = estado.signalHandlers.filter(item => item.signal !== signal);
        void shutdown({ timeoutMs: timeoutWorkerMs(env) }).finally(() => {
          process.kill(process.pid, signal);
        });
      };
      process.once(signal, handler);
      estado.signalHandlers.push({ signal, handler });
    }
  }

  function criarWorker() {
    if (estado.worker || estado.encerrando) return estado.worker;
    const worker = new Worker(workerPath, { env: { ...process.env, ...env } });
    estado.worker = worker;
    instalarSinais();
    worker.on("message", mensagem => {
      const atual = estado.ativo;
      if (!atual || mensagem?.jobId !== atual.job.jobId) {
        log({ evento: "resposta_ignorada", motivo: "job_id_desconhecido" });
        return;
      }
      if (mensagem.type === RESPONSE_PROGRESS) {
        const progress = mensagem;
        atual.lastProgressStage = String(progress.stage || "").slice(0, 80);
        atual.lastProgressAt = agoraMs();
        log({
          evento: "job_progress",
          operacao: atual.job.operation,
          jobKey: hashWorkspace(atual.job.jobId),
          workspaceKey: atual.lane.workspaceKey,
          stage: atual.lastProgressStage,
          elapsedMs: Number(progress.elapsedMs || 0),
          stageMs: Number(progress.stageMs || 0),
          legacyBytes: Number(progress.legacyBytes || 0),
          vivaBytes: Number(progress.vivaBytes || 0),
          outputBytes: Number(progress.outputBytes || 0),
          stringifyMs: Number(progress.stringifyMs || 0),
          writeMs: Number(progress.writeMs || 0),
          targetGeneration: Number(progress.targetGeneration || 0),
          ...(progress.staleStage ? { staleStage: String(progress.staleStage).slice(0, 40) } : {})
        });
        return;
      }
      clearTimeout(atual.timer);
      estado.ativo = null;
      if (mensagem.type === RESPONSE_OK) {
        const metricas = metricasJob(atual.job);
        if (ehManutencaoTerminalIndex(atual.job.operation) && mensagem.result?.ok !== true) {
          registrarFalhaTerminalIndex(
            atual.lane,
            mensagem.result?.motivo || "terminal_index_maintenance_failed",
            { code: mensagem.result?.motivo || "terminal_index_maintenance_failed" }
          );
          log({
            evento: "job_rejected",
            operacao: atual.job.operation,
            jobKey: hashWorkspace(atual.job.jobId),
            workspaceKey: atual.lane.workspaceKey,
            motivo: mensagem.result?.motivo || "terminal_index_maintenance_failed",
            ...metricas
          });
          atual.resolve({
            ...(mensagem.result || {}),
            persistenceMode: "worker",
            workspaceKey: atual.lane.workspaceKey,
            coordinatorMetrics: metricas
          });
          bombear();
          return;
        }
        if (ehManutencaoTerminalIndex(atual.job.operation)) {
          atual.lane.terminalIndexCircuitOpen = false;
          atual.lane.terminalIndexLastFailure = null;
        }
        const previousMaxWait = estado.maxQueueWaitByWorkspace.get(atual.lane.workspaceKey) || 0;
        estado.maxQueueWaitByWorkspace.set(
          atual.lane.workspaceKey,
          Math.max(previousMaxWait, metricas.queueWaitMs)
        );
        estado.completedByWorkspace.set(
          atual.lane.workspaceKey,
          (estado.completedByWorkspace.get(atual.lane.workspaceKey) || 0) + 1
        );
        log({
          evento: "job_ok",
          operacao: atual.job.operation,
          jobKey: hashWorkspace(atual.job.jobId),
          workspaceKey: atual.lane.workspaceKey,
          ...(mensagem.result?.metrics || {}),
          ...metricas
        });
        if (atual.job.operation === OP_TERMINAL_INDEX_DELTA && mensagem.result?.ok === true) {
          registrarManutencaoTerminalIndex(atual.lane.clienteId, "delta_applied");
        }
        if (atual.job.operation === OP_TERMINAL_INDEX_BOOTSTRAP && mensagem.result?.ok === true) {
          logTerminalIndex("bootstrap_executed", {
            lane: atual.lane,
            operation: atual.job.operation,
            attempt: 0,
            payload: { sourceRevision: mensagem.result?.sourceRevision || "" }
          }, { generation: Number(mensagem.result?.generation || 0) });
        }
        atual.resolve({
          ...(mensagem.result || {}),
          persistenceMode: "worker",
          workspaceKey: atual.lane.workspaceKey,
          coordinatorMetrics: metricas
        });
      } else {
        const motivo = mensagem.error?.code || "worker_job_failed";
        const metricas = metricasJob(atual.job);
        log({
          evento: "job_error",
          operacao: atual.job.operation,
          jobId: atual.job.jobId,
          jobKey: hashWorkspace(atual.job.jobId),
          workspaceKey: atual.lane.workspaceKey,
          motivo,
          errorName: String(mensagem.error?.name || "").slice(0, 80),
          errorCode: String(mensagem.error?.code ?? "").slice(0, 80),
          errorMessage: mensagem.error?.name === "DataCloneError"
            ? "response_not_cloneable"
            : String(mensagem.error?.message || "").replace(/[\r\n]+/g, " ").slice(0, 120),
          targetGeneration: Number(atual.job.targetGeneration || 0),
          ...metricas
        });
        if (erroRevisionStale(motivo) && !ehManutencaoTerminalIndex(atual.job.operation)) {
          log({
            evento: "job_stale_revision",
            operacao: atual.job.operation,
            jobKey: hashWorkspace(atual.job.jobId),
            workspaceKey: atual.lane.workspaceKey,
            checkpointGeneration: Number(atual.job.checkpointGeneration || 0),
            checkpointMutations: Number(atual.job.checkpointMutations || 0),
            retryable: true,
            circuitOpened: false,
            ...metricas
          });
          atual.resolve(rejeicao(motivo, mensagem.error?.message, {
            retryable: true,
            circuitOpened: false,
            persistenceMode: "worker",
            workspaceKey: atual.lane.workspaceKey
          }));
        } else if (erroGlobalWorker(motivo)) {
          estado.errorsByWorkspace.set(atual.lane.workspaceKey, (estado.errorsByWorkspace.get(atual.lane.workspaceKey) || 0) + 1);
          registrarFalhaGlobal(motivo, mensagem.error);
          atual.resolve(rejeicao(motivo, mensagem.error?.message, {
            persistenceMode: "worker",
            workspaceKey: atual.lane.workspaceKey
          }));
        } else if (ehManutencaoTerminalIndex(atual.job.operation)) {
          registrarFalhaTerminalIndex(atual.lane, motivo, mensagem.error);
          atual.resolve(rejeicao(motivo, mensagem.error?.message, {
            persistenceMode: "worker",
            workspaceKey: atual.lane.workspaceKey
          }));
        } else {
          if (erroGlobalWorker(motivo)) {
            estado.errorsByWorkspace.set(atual.lane.workspaceKey, (estado.errorsByWorkspace.get(atual.lane.workspaceKey) || 0) + 1);
            registrarFalhaGlobal(motivo, mensagem.error);
          } else {
            registrarFalhaLocal(atual.lane, motivo, mensagem.error);
          }
          atual.resolve(rejeicao(motivo, mensagem.error?.message, {
            persistenceMode: "worker",
            workspaceKey: atual.lane.workspaceKey
          }));
        }
      }
      bombear();
    });
    worker.on("error", erro => {
      const atual = estado.ativo;
      if (atual) {
        clearTimeout(atual.timer);
        estado.ativo = null;
        atual.resolve(rejeicao("worker_error", erro?.message, {
          persistenceMode: "worker",
          workspaceKey: atual.lane.workspaceKey
        }));
      }
      registrarFalhaGlobal("worker_error", erro);
      void encerrarWorker(worker);
    });
    worker.on("exit", code => {
      const esperado = estado.encerrando || estado.workerEnding === worker;
      if (estado.worker === worker) estado.worker = null;
      if (estado.workerEnding === worker) estado.workerEnding = null;
      const atual = estado.ativo;
      if (atual && atual.worker === worker) {
        clearTimeout(atual.timer);
        estado.ativo = null;
        atual.resolve(rejeicao(esperado ? "worker_terminated" : "worker_exit", "", {
          persistenceMode: "worker",
          workspaceKey: atual.lane.workspaceKey
        }));
      }
      if (!esperado) {
        registrarFalhaGlobal("worker_exit", { code });
        rejeitarFilas("worker_exit");
      }
      bombear();
    });
    return worker;
  }

  async function encerrarWorker(workerAtual = estado.worker) {
    const worker = workerAtual;
    if (!worker) return;
    if (estado.worker === worker) estado.worker = null;
    estado.workerEnding = worker;
    try { await worker.terminate(); } catch {}
    if (estado.workerEnding === worker) estado.workerEnding = null;
  }

  function proximoItem() {
    while (estado.readyWorkspaces.length) {
      const cliente = estado.readyWorkspaces.shift();
      estado.readySet.delete(cliente);
      const lane = estado.lanes.get(cliente);
      if (!lane || !lane.fila.length) continue;
      const indiceElegivel = lane.fila.findIndex(item => itemPermitidoPeloCircuito(lane, item));
      if (indiceElegivel < 0) continue;
      const [item] = lane.fila.splice(indiceElegivel, 1);
      lane.bytesPendentes = Math.max(0, lane.bytesPendentes - item.bytesEstimados);
      if (laneTemItemElegivel(lane)) marcarPronto(lane);
      return item;
    }
    return null;
  }

  function bombear() {
    if (estado.ativo || estado.encerrando || estado.aberto) return;
    const atual = proximoItem();
    if (!atual) return;
    const worker = criarWorker();
    if (!worker) {
      atual.resolve(rejeicao("worker_encerrando", "", {
        persistenceMode: "worker",
        workspaceKey: atual.lane.workspaceKey
      }));
      return;
    }
    const timeout = timeoutWorkerMs(env);
    const timer = setTimeout(() => {
      if (!estado.ativo || estado.ativo.job.jobId !== atual.job.jobId) return;
      const lastProgressStage = estado.ativo.lastProgressStage || "";
      const lastProgressAt = estado.ativo.lastProgressAt || null;
      const totalElapsedMs = Math.max(0, agoraMs() - Number(atual.job.startedAt || agoraMs()));
      const elapsedSinceLastProgressMs = lastProgressAt === null ? null : Math.max(0, agoraMs() - lastProgressAt);
      estado.ativo = null;
      const terminalIndexShadow = ehManutencaoTerminalIndex(atual.job.operation);
      log({
        evento: "job_timeout",
        operacao: atual.job.operation,
        jobKey: hashWorkspace(atual.job.jobId),
        workspaceKey: atual.lane.workspaceKey,
        motivo: terminalIndexShadow ? "terminal_index_worker_timeout" : "worker_timeout",
        lastProgressStage,
        lastProgressAt,
        elapsedSinceLastProgressMs,
        totalElapsedMs,
        ...metricasJob(atual.job)
      });
      if (terminalIndexShadow) {
        // The timeout kills the shared Worker thread; this is a global health
        // failure, not merely a Terminal Index maintenance rejection.
        registrarFalhaGlobal("worker_timeout");
      } else {
        registrarFalhaGlobal("worker_timeout");
      }
      atual.resolve(rejeicao("worker_timeout", "", {
        persistenceMode: "worker",
        workspaceKey: atual.lane.workspaceKey
      }));
      void encerrarWorker(worker);
      bombear();
    }, timeout);
    atual.job.queuedAt = Number(atual.job.queuedAt || agoraMs());
    atual.job.startedAt = agoraMs();
    estado.ativo = { ...atual, worker, timer };
    try {
      worker.postMessage(atual.job);
    } catch (erro) {
      clearTimeout(timer);
      estado.ativo = null;
      registrarFalhaGlobal("worker_post_message_error", erro);
      atual.resolve(rejeicao("worker_post_message_error", erro?.message, {
        persistenceMode: "worker",
        workspaceKey: atual.lane.workspaceKey
      }));
      void encerrarWorker(worker);
      bombear();
    }
  }

  function enfileirarInterno(operation, payload = {}, { probeTerminalIndexCircuit = false } = {}) {
    let workspace;
    let revision;
    try {
      workspace = workspaceSeguro(payload.clienteId);
      revision = revisionSegura(payload.checkpointRevision);
    } catch (erro) {
      return Promise.resolve(rejeicao(erro.message || "payload_invalido"));
    }
    const persistenceMode = payload.persistenceMode || modoFor(workspace);
    const route = payload.persistenceMode ? { mode: persistenceMode, motivo: "checkpoint_mode_pinned" } : decisao(workspace);
    if (persistenceMode !== "worker") {
      logRoteamento(route);
      return Promise.resolve(rejeicao(
        globalAtivo() ? "persistence_worker_canary_not_selected" : "persistence_worker_disabled",
        route.motivo,
        { persistenceMode: "legacy", workspaceKey: hashWorkspace(workspace) }
      ));
    }
    if (estado.encerrando) return Promise.resolve(rejeicao("persistence_worker_shutting_down"));
    if (estado.aberto) return Promise.resolve(rejeicao("persistence_worker_circuit_open"));
    const lane = obterLane(workspace);
    if (ehManutencaoTerminalIndex(operation) && lane.terminalIndexCircuitOpen && !probeTerminalIndexCircuit) {
      return Promise.resolve(rejeicao("persistence_worker_terminal_index_circuit_open", "", {
        retryable: true,
        circuitClass: "terminal_index",
        persistenceMode: "worker",
        workspaceKey: lane.workspaceKey
      }));
    }
    if (!ehManutencaoTerminalIndex(operation) && lane.circuitoAberto) {
      return Promise.resolve(rejeicao("persistence_worker_workspace_circuit_open", "", {
        persistenceMode: "worker",
        workspaceKey: lane.workspaceKey,
        circuitClass: "checkpoint"
      }));
    }
    const seq = ++estado.seq;
    const job = {
      operation,
      jobId: jobId(seq, workspace, payload.targetGeneration || 0),
      clienteId: workspace,
      checkpointRevision: revision,
      targetGeneration: Number(payload.targetGeneration || 0),
      checkpointGeneration: Number(payload.checkpointGeneration ?? payload.targetGeneration ?? 0),
      checkpointMutations: Number(payload.checkpointMutations || 0),
      expectedSourceRevisions: payload.expectedSourceRevisions || undefined,
      tempIdentity: payload.tempIdentity || undefined,
      dataDir: normalizarDataDir(payload.dataDir || env.DATA_DIR || "/data"),
      nowMs: Number(payload.nowMs) || agoraMs(),
      persistenceMode: "worker",
      queuedAt: agoraMs()
    };
    if (operation === OP_VIVA_MUTATION) {
      job.mutationType = String(payload.mutationType || "");
      job.item = payload.item && typeof payload.item === "object" ? payload.item : {};
      job.posicaoLegada = Number.isInteger(Number(payload.posicaoLegada))
        ? Number(payload.posicaoLegada)
        : null;
      job.permitirRegressaoStatus = payload.permitirRegressaoStatus === true;
      job.exigirMutacao = payload.exigirMutacao === true;
      job.checkpointSincronizado = payload.checkpointSincronizado === true;
      job.requiresCommit = payload.requiresCommit === true;
      job.caller = String(payload.caller || payload.origem || payload.motivo || "").slice(0, 120);
      job.motivo = String(payload.motivo || "viva_mutation").slice(0, 120);
      job.rodadaId = String(payload.rodadaId || "").slice(0, 160);
      job.cicloId = String(payload.cicloId || "").slice(0, 160);
      job.mutationId = String(payload.mutationId || "").slice(0, 200);
      job.transactionId = String(payload.transactionId || payload.mutationId || "").slice(0, 200);
      job.correlationId = String(payload.correlationId || payload.mutationId || "").slice(0, 200);
    }
    if (operation === OP_VIVA_SNAPSHOT_PROBE) {
      job.probeViva = payload.probeViva !== false;
      job.previousHash = payload.previousHash || null;
      job.targetHash = payload.targetHash || null;
      job.legacyFenceHashes = Array.isArray(payload.legacyFenceHashes) ? payload.legacyFenceHashes : [];
    }
    const bytesEstimados = estimarBytes(job);
    const maxGlobal = numeroLimite(env, "FILA_PERSISTENCIA_MAX_PENDING_JOBS", 100);
    const maxWorkspace = numeroLimite(env, "FILA_PERSISTENCIA_MAX_PENDING_JOBS_WORKSPACE", 25);
    const maxBytes = numeroLimite(env, "FILA_PERSISTENCIA_MAX_PENDING_BYTES", 8 * 1024 * 1024);
    const maxWorkspaceBytes = numeroLimite(env, "FILA_PERSISTENCIA_MAX_PENDING_BYTES_WORKSPACE", 1024 * 1024);
    if (
      profundidadeGlobal() >= maxGlobal ||
      profundidadeLane(lane) >= maxWorkspace ||
      bytesPendentesGlobal() + bytesEstimados > maxBytes ||
      lane.bytesPendentes + bytesEstimados > maxWorkspaceBytes
    ) {
      estado.backpressureRejections += 1;
      return Promise.resolve(rejeicao("persistence_worker_backpressure_retryable", "fila_persistencia_backpressure", {
        retryable: true,
        persistenceMode: "worker",
        workspaceKey: lane.workspaceKey,
        queueDepthGlobal: profundidadeGlobal(),
        queueDepthWorkspace: profundidadeLane(lane)
      }));
    }
    const promise = new Promise(resolve => {
      const item = { job, resolve, reject: resolve, lane, bytesEstimados, probeTerminalIndexCircuit };
      lane.fila.push(item);
      lane.bytesPendentes += bytesEstimados;
      marcarPronto(lane);
      bombear();
    });
    promise.accepted = true;
    return promise;
  }

  const RETRY_DELAYS_MS = [1000, 2000, 5000, 10000, 15000];

  function logTerminalIndex(evento, intent, extras = {}) {
    log({
      evento,
      operacao: intent?.operation || "",
      workspaceKey: intent?.lane?.workspaceKey || "",
      attempt: Number(intent?.attempt || 0),
      circuitClass: "terminal_index",
      queueDepth: intent?.lane ? profundidadeLane(intent.lane) : 0,
      sourceRevision: hashSourceRevision(intent?.payload || {}),
      ...extras
    });
  }

  function terminalIndexDeps(intent) {
    const dataDir = normalizarDataDir(intent.payload.dataDir || env.DATA_DIR || "/data");
    return {
      env,
      getClientePath: clienteId => path.resolve(dataDir, "clientes", workspaceSeguro(clienteId))
    };
  }

  function classificarIntent(intent) {
    try {
      const deps = terminalIndexDeps(intent);
      const validacao = validarTerminalIndex(intent.lane.clienteId, deps);
      if (validacao.valido) return { valido: true, validacao, recuperacao: { tipo: "valid" } };
      return {
        valido: false,
        validacao,
        recuperacao: classificarRecuperacaoTerminalIndex(intent.lane.clienteId, deps, validacao)
      };
    } catch (erro) {
      return { valido: false, recuperacao: { tipo: "bootstrap_required", motivo: erro?.code || "validation_error" } };
    }
  }

  function agendarRetryTerminalIndex() {
    if (estado.encerrando || estado.aberto) return;
    let proximo = Infinity;
    for (const intent of estado.terminalIndexIntents.values()) {
      if (intent.inFlight || intent.blockedGlobal || !Number.isFinite(intent.retryAt)) continue;
      proximo = Math.min(proximo, intent.retryAt);
    }
    if (!Number.isFinite(proximo)) return;
    const restante = Math.max(0, proximo - agoraMs());
    if (estado.terminalIndexRetryTimer) {
      clearTimeout(estado.terminalIndexRetryTimer);
      estado.terminalIndexRetryTimer = null;
    }
    estado.terminalIndexRetryTimer = setTimeout(() => {
      estado.terminalIndexRetryTimer = null;
      if (estado.encerrando || estado.aberto) return;
      const due = [...estado.terminalIndexIntents.values()]
        .filter(intent => !intent.inFlight && !intent.blockedGlobal && intent.retryAt <= agoraMs())
        .sort((a, b) => a.retryAt - b.retryAt || a.createdAt - b.createdAt);
      const intent = due[0];
      if (intent) tentarIntentTerminalIndex(intent, true);
      else agendarRetryTerminalIndex();
    }, restante);
    estado.terminalIndexRetryTimer.unref?.();
  }

  function programarRetry(intent, motivo) {
    if (estado.aberto) {
      intent.blockedGlobal = true;
      intent.retryAt = null;
      logTerminalIndex("delta_signal_rejected", intent, { motivo: "global_circuit_open" });
      return;
    }
    intent.attempt += 1;
    estado.terminalIndexRetryCount += 1;
    const delay = RETRY_DELAYS_MS[Math.min(intent.attempt - 1, RETRY_DELAYS_MS.length - 1)];
    intent.retryAt = agoraMs() + delay;
    logTerminalIndex(intent.operation === OP_TERMINAL_INDEX_DELTA ? "delta_retry_scheduled" : "bootstrap_retry_scheduled", intent, {
      motivo: String(motivo || "maintenance_retry").slice(0, 80),
      delayMs: delay,
      queueDepth: profundidadeGlobal()
    });
    agendarRetryTerminalIndex();
  }

  function concluirIntentTerminalIndex(intent, versaoEnviada, resultado) {
    if (estado.terminalIndexIntents.get(intent.lane.clienteId) !== intent) return;
    intent.inFlight = false;
    intent.queued = false;
    intent.blockedGlobal = false;
    if (estado.aberto || resultado?.motivo === "persistence_worker_circuit_open") {
      intent.blockedGlobal = true;
      intent.retryAt = null;
      logTerminalIndex("delta_signal_rejected", intent, { motivo: "global_circuit_open" });
      return;
    }
    const outcome = classificarIntent(intent);
    if (outcome.valido || (resultado?.ok === true && !terminalIndexShadowAtivo(env))) {
      intent.lane.terminalIndexCircuitOpen = false;
      intent.lane.terminalIndexLastFailure = null;
      estado.terminalIndexIntents.delete(intent.lane.clienteId);
      if (outcome.valido) logTerminalIndex("delta_catchup_complete", intent, {
        motivo: resultado?.ok === true ? "source_revision_converged" : "already_converged_after_job_result",
        sourceRevision: hashSourceRevision({ sourceRevision: outcome.validacao.index.sourceRevision }),
        generation: Number(outcome.validacao.index.generation)
      });
      agendarRetryTerminalIndex();
      return;
    }

    if (!terminalIndexShadowAtivo(env)) {
      estado.terminalIndexIntents.delete(intent.lane.clienteId);
      agendarRetryTerminalIndex();
      return;
    }

    if (outcome.recuperacao?.tipo === "delta_safe") {
      intent.operation = OP_TERMINAL_INDEX_DELTA;
    } else if (outcome.recuperacao?.tipo === "bootstrap_required") {
      intent.operation = OP_TERMINAL_INDEX_BOOTSTRAP;
    }
    if (resultado?.ok === true && versaoEnviada !== intent.version) {
      intent.retryAt = agoraMs();
      logTerminalIndex(intent.operation === OP_TERMINAL_INDEX_DELTA ? "delta_retry_scheduled" : "bootstrap_retry_scheduled", intent, {
        motivo: "source_advanced_during_maintenance",
        delayMs: 0
      });
      agendarRetryTerminalIndex();
      return;
    }

    const motivo = String(resultado?.motivo || (resultado?.ok ? "source_still_stale" : "maintenance_rejected"));
    if (["persistence_worker_disabled", "persistence_worker_canary_not_selected", "persistence_worker_shutting_down", "workspace_invalido", "checkpoint_revision_invalido", "payload_invalido"].includes(motivo)) {
      estado.terminalIndexIntents.delete(intent.lane.clienteId);
      logTerminalIndex("delta_signal_rejected", intent, { motivo: motivo.slice(0, 80) });
      agendarRetryTerminalIndex();
      return;
    }
    logTerminalIndex("delta_signal_rejected", intent, { motivo: motivo.slice(0, 80), retryable: true });
    programarRetry(intent, motivo);
  }

  function tentarIntentTerminalIndex(intent, retry = false) {
    if (estado.terminalIndexIntents.get(intent.lane.clienteId) !== intent || intent.inFlight || estado.encerrando) {
      return Promise.resolve({ ok: true, accepted: true, coalesced: true, motivo: "intent_in_flight" });
    }
    if (estado.aberto) {
      intent.blockedGlobal = true;
      intent.retryAt = null;
      return Promise.resolve(rejeicao("persistence_worker_circuit_open", "", { circuitClass: "global" }));
    }
    const versaoEnviada = intent.version;
    const operation = intent.operation;
    const payload = { ...intent.payload, clienteId: intent.lane.clienteId };
    intent.inFlight = true;
    intent.queued = false;
    intent.blockedGlobal = false;
    intent.retryAt = null;
    const promise = enfileirarInterno(operation, payload, { probeTerminalIndexCircuit: true });
    intent.queued = promise.accepted === true;
    if (promise.accepted === true) {
      logTerminalIndex(retry ? "delta_retry_applied" : "delta_signal_accepted", intent, {
        motivo: promise.accepted === true && intent.lane.terminalIndexCircuitOpen ? "terminal_index_circuit_probe" : "queued",
        queueDepth: profundidadeGlobal()
      });
    }
    promise.then(
      resultado => concluirIntentTerminalIndex(intent, versaoEnviada, resultado),
      erro => concluirIntentTerminalIndex(intent, versaoEnviada, rejeicao(erro?.code || "maintenance_promise_rejected"))
    );
    return promise;
  }

  function solicitarManutencaoTerminalIndex(operation, payload = {}) {
    let workspace;
    let revision;
    try {
      workspace = workspaceSeguro(payload.clienteId);
      revision = revisionSegura(payload.checkpointRevision);
    } catch (erro) {
      return Promise.resolve(rejeicao(erro.message || "payload_invalido"));
    }
    const lane = obterLane(workspace);
    let intent = estado.terminalIndexIntents.get(workspace);
    if (intent) {
      intent.version += 1;
      intent.payload = { ...intent.payload, ...payload, clienteId: workspace, checkpointRevision: revision };
      // Do not replace an in-flight Delta with a Bootstrap request: a reader
      // can observe the brief index/proof publication boundary and classify
      // that transient mismatch as bootstrap-required. The post-job source
      // validation is authoritative and upgrades to Bootstrap if it persists.
      if (operation === OP_TERMINAL_INDEX_BOOTSTRAP && !intent.inFlight && !intent.queued) {
        intent.operation = operation;
      }
      if (intent.inFlight || intent.queued) {
        logTerminalIndex(operation === OP_TERMINAL_INDEX_DELTA ? "delta_signal_coalesced" : "bootstrap_signal_coalesced", intent, {
          motivo: "workspace_intent_pending"
        });
        return Promise.resolve({ ok: true, accepted: true, coalesced: true, operation, workspaceKey: lane.workspaceKey });
      }
      if (intent.blockedGlobal && !estado.aberto) {
        intent.blockedGlobal = false;
        intent.retryAt = agoraMs();
      }
      if (intent.retryAt && intent.retryAt > agoraMs()) {
        logTerminalIndex(operation === OP_TERMINAL_INDEX_DELTA ? "delta_signal_coalesced" : "bootstrap_signal_coalesced", intent, {
          motivo: "retry_already_scheduled"
        });
        return Promise.resolve({ ok: true, accepted: true, coalesced: true, operation, workspaceKey: lane.workspaceKey });
      }
    } else {
      intent = {
        lane,
        operation,
        payload: { ...payload, clienteId: workspace, checkpointRevision: revision },
        version: 1,
        attempt: 0,
        createdAt: agoraMs(),
        retryAt: null,
        inFlight: false,
        queued: false,
        blockedGlobal: false
      };
      estado.terminalIndexIntents.set(workspace, intent);
    }
    return tentarIntentTerminalIndex(intent, false);
  }

  function identidadeArquivo(file) {
    try {
      const stat = fs.statSync(file);
      return {
        pathKind: path.basename(file),
        dev: Number.isFinite(Number(stat.dev)) ? Number(stat.dev) : null,
        ino: Number.isFinite(Number(stat.ino)) ? Number(stat.ino) : null,
        size: Number(stat.size || 0),
        mtimeMs: Number(stat.mtimeMs || 0),
        ctimeMs: Number.isFinite(Number(stat.ctimeMs)) ? Number(stat.ctimeMs) : null,
        mtimeNs: stat.mtimeNs == null ? null : String(stat.mtimeNs),
        ctimeNs: stat.ctimeNs == null ? null : String(stat.ctimeNs)
      };
    } catch (erro) {
      if (erro?.code === "ENOENT") return null;
      return { erro: erroSanitizado(erro) };
    }
  }

  function revalidarSources(clienteId = "admin", sourceRevisions = {}, { incluirLegacy = true, dataDir } = {}) {
    let cliente;
    try {
      cliente = workspaceSeguro(clienteId);
      const raiz = path.resolve(normalizarDataDir(dataDir || env.DATA_DIR || "/data"));
      const diretorio = path.resolve(raiz, "clientes", cliente);
      const atuais = {
        legacy: incluirLegacy ? identidadeArquivo(path.join(diretorio, "fila.json")) : null,
        viva: identidadeArquivo(path.join(diretorio, "fila-viva.json"))
      };
      const mesmaOuAusente = (esperada, atual) =>
        !esperada && !atual ? true : sameIdentity(esperada, atual);
      const legacyOk = !incluirLegacy || mesmaOuAusente(sourceRevisions.legacy, atuais.legacy);
      const vivaOk = mesmaOuAusente(sourceRevisions.viva, atuais.viva);
      return {
        ok: legacyOk && vivaOk,
        motivo: legacyOk && vivaOk ? "revisao_confirmada" : "checkpoint_source_revision_changed",
        atuais,
        esperadas: sourceRevisions
      };
    } catch (erro) {
      return { ok: false, motivo: "checkpoint_source_revision_error", erro: erroSanitizado(erro), clienteId: cliente || "" };
    }
  }

  async function shutdown({ timeoutMs = timeoutWorkerMs(env) } = {}) {
    estado.encerrando = true;
    if (estado.terminalIndexRetryTimer) clearTimeout(estado.terminalIndexRetryTimer);
    estado.terminalIndexRetryTimer = null;
    rejeitarFilas("persistence_worker_shutdown");
    const started = agoraMs();
    while (estado.ativo && agoraMs() - started < timeoutMs) {
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    if (estado.ativo) {
      clearTimeout(estado.ativo.timer);
      estado.ativo.resolve(rejeicao("persistence_worker_shutdown_timeout"));
      estado.ativo = null;
    }
    await encerrarWorker();
    for (const item of estado.signalHandlers) process.removeListener(item.signal, item.handler);
    estado.signalHandlers = [];
    return { ok: true };
  }

  function recover(clienteId = null) {
    if (estado.ativo) return rejeicao("persistence_worker_recovery_busy");
    if (clienteId) {
      let lane;
      try { lane = obterLane(clienteId, false); } catch { return rejeicao("workspace_invalido"); }
      if (!lane || lane.fila.length || estado.worker) return rejeicao("persistence_worker_recovery_busy");
      lane.circuitoAberto = false;
      lane.ultimaFalha = null;
      log({ estado: "circuit_recovery_manual", escopo: "workspace", workspaceKey: lane.workspaceKey });
      marcarPronto(lane);
      bombear();
      return { ok: true, motivo: "persistence_worker_recovery_manual", persistenceMode: "worker" };
    }
    if (estado.readyWorkspaces.length || estado.worker) return rejeicao("persistence_worker_recovery_busy");
    estado.aberto = false;
    estado.ultimaFalha = null;
    log({ estado: "circuit_recovery_manual", escopo: "global" });
    for (const intent of estado.terminalIndexIntents.values()) {
      intent.blockedGlobal = false;
      if (!intent.inFlight) intent.retryAt = agoraMs();
    }
    agendarRetryTerminalIndex();
    return { ok: true, motivo: "persistence_worker_recovery_manual" };
  }

  return {
    enabled: globalAtivo,
    enabledFor: clienteId => modoFor(clienteId) === "worker",
    modeFor: modoFor,
    modeForViva: modoForViva,
    getState: estadoPublico,
    prepare: payload => enfileirarInterno(OP_PREPARE, payload),
    publish: payload => enfileirarInterno(OP_PUBLISH, payload),
    cleanup: payload => enfileirarInterno(OP_CLEANUP, payload),
    mutateViva: payload => enfileirarInterno(OP_VIVA_MUTATION, {
      ...payload,
      persistenceMode: payload?.persistenceMode || modoForViva(payload?.clienteId)
    }),
    probeVivaSnapshot: payload => enfileirarInterno(OP_VIVA_SNAPSHOT_PROBE, {
      ...payload,
      persistenceMode: payload?.persistenceMode || modoForViva(payload?.clienteId)
    }),
    bootstrapTerminalIndex: payload => solicitarManutencaoTerminalIndex(OP_TERMINAL_INDEX_BOOTSTRAP, payload),
    deltaTerminalIndex: payload => solicitarManutencaoTerminalIndex(OP_TERMINAL_INDEX_DELTA, payload),
    revalidarSources,
    shutdown,
    recover,
    terminateForTest: async () => {
      if (estado.worker) await encerrarWorker();
      registrarFalhaGlobal("worker_terminated_for_test");
    }
  };
}

module.exports = { criarCoordenadorPersistencia };
