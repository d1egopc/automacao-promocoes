"use strict";

const fs = require("fs");
const path = require("path");
const { parentPort, threadId } = require("worker_threads");
const {
  OP_PREPARE,
  OP_PUBLISH,
  OP_CLEANUP,
  OP_TERMINAL_INDEX_BOOTSTRAP,
  OP_TERMINAL_INDEX_DELTA,
  OP_VIVA_MUTATION,
  OP_VIVA_SNAPSHOT_PROBE,
  RESPONSE_OK,
  RESPONSE_ERROR,
  RESPONSE_PROGRESS,
  workspaceSeguro,
  revisionSegura,
  normalizarDataDir,
  erroSanitizado,
  sameIdentity
} = require("./persistence-protocol");
const {
  lerArrayJsonIncremental,
  escreverArrayJsonIncremental
} = require("./json-array-incremental");
const { construirTerminalIndex, construirTerminalIndexDelta } = require("./terminal-index-worker");
const mutationIntent = require("./viva-mutation-intent");
const removalFence = require("./viva-removal-fence");
const { classificarItemFilaV2 } = require("./fila-v2-shadow");

let filaOperacionalV2 = null;

function agoraMs() {
  return Date.now();
}

function diagnosticoMemoriaAtivo() {
  const valor = String(process.env.FILA_PERSISTENCIA_DIAGNOSTICO_MEMORIA || "").toLowerCase();
  return ["1", "true", "on", "yes"].includes(valor);
}

function memoriaAtual() {
  const valor = process.memoryUsage();
  return {
    rssBytes: valor.rss,
    heapUsedBytes: valor.heapUsed,
    heapTotalBytes: valor.heapTotal,
    externalBytes: valor.external
  };
}

function obterFilaOperacionalV2(dataDir) {
  if (!filaOperacionalV2) {
    process.env.DATA_DIR = normalizarDataDir(dataDir);
    filaOperacionalV2 = require("./fila-operacional-v2");
  }
  return filaOperacionalV2;
}

function caminhoWorkspace(dataDir, workspace) {
  const raiz = path.resolve(normalizarDataDir(dataDir));
  const cliente = workspaceSeguro(workspace);
  const diretorio = path.resolve(raiz, "clientes", cliente);
  const arquivo = path.resolve(diretorio, "fila.json");
  const viva = path.resolve(diretorio, "fila-viva.json");
  const proof = path.resolve(diretorio, "fila.proof.json");
  if (!diretorio.startsWith(`${path.resolve(raiz, "clientes")}${path.sep}`) ||
      path.dirname(arquivo) !== diretorio ||
      path.dirname(viva) !== diretorio ||
      path.dirname(proof) !== diretorio) {
    throw new Error("caminho_workspace_inseguro");
  }
  return { raiz, cliente, diretorio, arquivo, viva, proof };
}

function identityFromStat(file, stat) {
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
}

function statIdentity(file) {
  return identityFromStat(file, fs.statSync(file));
}

function statOptional(file) {
  try {
    return statIdentity(file);
  } catch (erro) {
    if (erro?.code === "ENOENT") return null;
    throw erro;
  }
}

function sameOptionalIdentity(esperada, atual) {
  return !esperada && !atual ? true : sameIdentity(esperada, atual);
}

function readArray(file, { absentOk = false } = {}) {
  let fd;
  try {
    fd = fs.openSync(file, "r");
  } catch (erro) {
    if (erro?.code === "ENOENT" && absentOk) {
      return { value: [], identity: null, bytes: 0, parseMs: 0, readMs: 0 };
    }
    throw erro;
  }
  try {
    const inicial = identityFromStat(file, fs.fstatSync(fd));
    const value = [];
    const leitura = lerArrayJsonIncremental(fd, {
      onItem: item => value.push(item)
    });
    const finalDescriptor = identityFromStat(file, fs.fstatSync(fd));
    fs.closeSync(fd);
    fd = null;
    const finalPathname = statOptional(file);
    if (!finalPathname ||
        !sameIdentity(inicial, finalDescriptor) ||
        !sameIdentity(inicial, finalPathname)) {
      const erro = new Error("checkpoint_source_changed_during_read");
      erro.code = "STALE_REVISION";
      throw erro;
    }
    return {
      value,
      identity: finalPathname,
      bytes: leitura.bytes,
      parseMs: leitura.parseMs,
      readMs: leitura.readMs
    };
  } finally {
    if (fd !== null && fd !== undefined) {
      try { fs.closeSync(fd); } catch {}
    }
  }
}

function backupFileAtomic(file) {
  const storage = require("../../utils/storage");
  return storage.criarBackupArquivoAtomic(file, `${file}.bak`, { preferirHardlink: true });
}

function writeTempAtomic(tempPath, value, onStringifyCompleted) {
  const started = process.hrtime.bigint();
  const partialPath = `${tempPath}.partial`;
  try {
    try { fs.unlinkSync(partialPath); } catch (erro) {
      if (erro?.code !== "ENOENT") throw erro;
    }
    const escrita = escreverArrayJsonIncremental(partialPath, value, {
      onStringifyCompleted
    });
    fs.renameSync(partialPath, tempPath);
    return {
      bytes: escrita.bytes,
      stringifyMs: escrita.stringifyMs,
      physicalWriteMs: escrita.writeMs,
      writeMs: Number(process.hrtime.bigint() - started) / 1e6
    };
  } catch (erro) {
    try { fs.unlinkSync(partialPath); } catch {}
    throw erro;
  }
}

function ensureRevisionTemp(paths, revision) {
  const tempPath = path.resolve(paths.diretorio, `fila.json.tmp.${revision}`);
  if (path.dirname(tempPath) !== paths.diretorio || path.basename(tempPath) !== `fila.json.tmp.${revision}`) {
    throw new Error("checkpoint_temp_inseguro");
  }
  return tempPath;
}

function sourceRead(paths, nowMs, dataDir, targetGeneration, progress = () => {}, expectedVivaHash = null) {
  const intent = mutationIntent.ler(dataDir, paths.cliente);
  if (!intent.ok || intent.exists) throw new Error(intent.motivo || "checkpoint_viva_intent_pending");
  const legacy = readArray(paths.arquivo, { absentOk: true });
  progress("legacy_read_completed", { legacyBytes: legacy.bytes });
  const viva = readArray(paths.viva, { absentOk: true });
  progress("viva_read_completed", { legacyBytes: legacy.bytes, vivaBytes: viva.bytes });
  const legacyAfter = statOptional(paths.arquivo);
  const vivaAfter = statOptional(paths.viva);
  const legacyChanged = !sameOptionalIdentity(legacy.identity, legacyAfter);
  const vivaChanged = !sameOptionalIdentity(viva.identity, vivaAfter);
  if (legacyChanged || vivaChanged) {
    const erro = new Error("checkpoint_source_changed_during_read");
    erro.code = "STALE_REVISION";
    throw erro;
  }
  if (expectedVivaHash) {
    const vivaHash = mutationIntent.hashArquivo(paths.viva);
    const vivaAfterHash = statOptional(paths.viva);
    if (!sameOptionalIdentity(vivaAfter, vivaAfterHash)) {
      const erro = new Error("checkpoint_source_changed_during_hash");
      erro.code = "STALE_REVISION";
      throw erro;
    }
    if (vivaHash !== expectedVivaHash) {
      const erro = new Error("checkpoint_viva_hash_mismatch");
      erro.code = "VIVA_HASH_MISMATCH";
      throw erro;
    }
  }
  const operacional = obterFilaOperacionalV2(dataDir);
  const mergeStarted = process.hrtime.bigint();
  const merge = operacional.mesclarFilaLegadaComViva(paths.cliente, legacy.value, viva.value, {
    agora: nowMs, removalFenceDataDir: dataDir
  });
  const filaCliente = operacional.filtrarItensCercadosCheckpoint(
    paths.cliente, merge.filaCliente, targetGeneration, { removalFenceDataDir: dataDir }
  );
  progress("merge_completed", { legacyBytes: legacy.bytes, vivaBytes: viva.bytes });
  return {
    filaCliente,
    sourceRevisions: { legacy: legacyAfter, viva: vivaAfter },
    sourceBytes: { legacy: legacy.bytes, viva: viva.bytes },
    sourceReadMs: legacy.readMs + viva.readMs,
    sourceParseMs: legacy.parseMs + viva.parseMs,
    calculateMs: Number(process.hrtime.bigint() - mergeStarted) / 1e6,
    merge
  };
}

function prepare(job) {
  const started = process.hrtime.bigint();
  let lastStageAt = started;
  let staleStage = "during_read";
  const progress = (stage, values = {}) => {
    const now = process.hrtime.bigint();
    try {
      parentPort.postMessage({
        type: RESPONSE_PROGRESS,
        jobId: job.jobId,
        operation: OP_PREPARE,
        stage,
        elapsedMs: Number(now - started) / 1e6,
        stageMs: Number(now - lastStageAt) / 1e6,
        targetGeneration: Number(job.targetGeneration || 0),
        ...values
      });
    } catch (_) {
      // Diagnostics must never change the checkpoint result.
    }
    lastStageAt = now;
  };
  const memoryStages = diagnosticoMemoriaAtivo() ? { beforeRead: memoriaAtual() } : null;
  const dataDir = normalizarDataDir(job.dataDir);
  const paths = caminhoWorkspace(dataDir, job.clienteId);
  const revision = revisionSegura(job.checkpointRevision);
  progress("prepare_started");
  try {
    fs.mkdirSync(paths.diretorio, { recursive: true });
    const source = sourceRead(paths, Number(job.nowMs) || agoraMs(), dataDir,
      Number(job.targetGeneration || 0), progress, job.expectedVivaHash || null);
    staleStage = "before_backup";
    if (memoryStages) memoryStages.afterMerge = memoriaAtual();
    const currentLegacy = statOptional(paths.arquivo);
    const currentViva = statOptional(paths.viva);
    if (!sameOptionalIdentity(source.sourceRevisions.legacy, currentLegacy) ||
        !sameOptionalIdentity(source.sourceRevisions.viva, currentViva)) {
      const erro = new Error("checkpoint_source_changed_before_backup");
      erro.code = "STALE_REVISION";
      throw erro;
    }
    progress("source_revalidated", { legacyBytes: source.sourceBytes.legacy, vivaBytes: source.sourceBytes.viva });
    const backup = currentLegacy
      ? backupFileAtomic(paths.arquivo)
      : { backupOk: true, backupMetodo: "arquivo_ausente", backupMs: 0 };
    if (currentLegacy && backup.backupOk !== true) {
      const erro = new Error("checkpoint_backup_failed");
      erro.code = "BACKUP_FAILED";
      throw erro;
    }
    progress("backup_completed", { legacyBytes: source.sourceBytes.legacy, vivaBytes: source.sourceBytes.viva });
    const tempPath = ensureRevisionTemp(paths, revision);
    if (memoryStages) memoryStages.beforeWriter = memoriaAtual();
    const escrita = writeTempAtomic(tempPath, source.filaCliente, ({ stringifyMs, writeMs }) => {
      progress("stringify_completed", { legacyBytes: source.sourceBytes.legacy,
        vivaBytes: source.sourceBytes.viva, stringifyMs, writeMs });
    });
    progress("temp_write_completed", { legacyBytes: source.sourceBytes.legacy,
      vivaBytes: source.sourceBytes.viva, outputBytes: escrita.bytes,
      stringifyMs: escrita.stringifyMs, writeMs: escrita.physicalWriteMs });
    if (memoryStages) memoryStages.afterWriter = memoriaAtual();
    const tempIdentity = statIdentity(tempPath);
    progress("prepare_completed", { legacyBytes: source.sourceBytes.legacy,
      vivaBytes: source.sourceBytes.viva, outputBytes: escrita.bytes });
    return {
      ok: true,
      operation: OP_PREPARE,
      clienteId: paths.cliente,
      checkpointRevision: revision,
      tempPath,
      tempIdentity,
      sourceRevisions: source.sourceRevisions,
      itens: source.filaCliente.length,
      bytes: escrita.bytes,
      merge: {
        itensInseridos: source.merge.itensInseridos || 0,
        itensAtualizados: source.merge.itensAtualizados || 0,
        duplicatasEvitadas: source.merge.duplicatasEvitadas || 0,
        statusPreservados: source.merge.statusPreservados || 0,
        totalLegado: source.merge.totalLegado || 0,
        totalViva: source.merge.totalViva || 0,
        totalFinal: source.merge.totalFinal || 0
      },
      metrics: {
        workerThreadId: threadId,
        processRssBytesAtJob: process.memoryUsage().rss,
        workerHeapUsedBytes: process.memoryUsage().heapUsed,
        readMs: source.sourceReadMs,
        parseMs: source.sourceParseMs,
        calculateMs: source.calculateMs,
        stringifyMs: escrita.stringifyMs,
        writeMs: escrita.writeMs,
        backupMs: backup.backupMs,
        backupMetodo: backup.backupMetodo,
        totalWorkerMs: Number(process.hrtime.bigint() - started) / 1e6,
        bytes: escrita.bytes,
        ...(memoryStages ? { memoryStages } : {})
      }
    };
  } catch (erro) {
    if (erro?.code === "STALE_REVISION") progress("prepare_stale", { staleStage });
    throw erro;
  }
}

function publish(job) {
  const started = process.hrtime.bigint();
  const dataDir = normalizarDataDir(job.dataDir);
  const paths = caminhoWorkspace(dataDir, job.clienteId);
  const revision = revisionSegura(job.checkpointRevision);
  const tempPath = ensureRevisionTemp(paths, revision);
  const tempIdentity = statOptional(tempPath);
  if (!tempIdentity || (job.tempIdentity && !sameIdentity(tempIdentity, job.tempIdentity))) {
    return { ok: false, operation: OP_PUBLISH, motivo: "checkpoint_temp_stale" };
  }
  const vivaCurrent = statOptional(paths.viva);
  if (job.expectedSourceRevisions &&
      !sameOptionalIdentity(job.expectedSourceRevisions.viva, vivaCurrent)) {
    return { ok: false, operation: OP_PUBLISH, motivo: "checkpoint_source_revision_changed" };
  }
  const operacional = obterFilaOperacionalV2(dataDir);
  if (removalFence.listar(dataDir, paths.cliente).some(fence =>
    fence.generation <= Number(job.targetGeneration || 0))) {
    const candidato = readArray(tempPath);
    if (operacional.contemIdentidadeCercadaCheckpoint(paths.cliente, candidato.value,
      Number(job.targetGeneration || 0), { removalFenceDataDir: dataDir })) {
      return { ok: false, operation: OP_PUBLISH, motivo: "checkpoint_removal_fence_not_covered" };
    }
  }
  const renameStarted = process.hrtime.bigint();
  fs.renameSync(tempPath, paths.arquivo);
  const renameMs = Number(process.hrtime.bigint() - renameStarted) / 1e6;
  const finalStat = statIdentity(paths.arquivo);
  if (removalFence.listar(dataDir, paths.cliente).some(fence =>
    fence.generation <= Number(job.targetGeneration || 0))) {
    const publicado = readArray(paths.arquivo);
    if (operacional.contemIdentidadeCercadaCheckpoint(paths.cliente, publicado.value,
      Number(job.targetGeneration || 0), { removalFenceDataDir: dataDir })) {
      return { ok: false, operation: OP_PUBLISH, motivo: "checkpoint_removal_fence_not_covered" };
    }
  }
  const proof = operacional.publicarProofFilaLegada(paths.cliente, {
    targetGeneration: job.targetGeneration,
    fileRevision: revision
  }, { agora: agoraMs(), logger: console });
  if (proof.ok !== true) {
    return {
      ok: false,
      operation: OP_PUBLISH,
      motivo: proof.motivo || "checkpoint_proof_write_error",
      motivoDetalhado: proof.motivo || "checkpoint_proof_write_error"
    };
  }
  return {
    ok: true,
    operation: OP_PUBLISH,
    clienteId: paths.cliente,
    checkpointRevision: revision,
    legacyFileProof: proof.proof,
    proof: proof.proof,
    fenceCoverageVerified: true,
    sourceRevisions: { viva: statOptional(paths.viva) },
    finalIdentity: finalStat,
    bytes: Number(finalStat.size || 0),
    metrics: {
      workerThreadId: threadId,
      processRssBytesAtJob: process.memoryUsage().rss,
      workerHeapUsedBytes: process.memoryUsage().heapUsed,
      renameMs,
      proofMs: Number(process.hrtime.bigint() - started) / 1e6,
      bytes: Number(finalStat.size || 0)
    }
  };
}

function cleanup(job) {
  const dataDir = normalizarDataDir(job.dataDir);
  const paths = caminhoWorkspace(dataDir, job.clienteId);
  const revision = revisionSegura(job.checkpointRevision);
  const tempPath = ensureRevisionTemp(paths, revision);
  const partialPath = `${tempPath}.partial`;
  let removed = false;
  try {
    fs.unlinkSync(tempPath);
    removed = true;
  } catch (erro) {
    if (erro?.code !== "ENOENT") throw erro;
  }
  try {
    fs.unlinkSync(partialPath);
    removed = true;
  } catch (erro) {
    if (erro?.code !== "ENOENT") throw erro;
  }
  return { ok: true, operation: OP_CLEANUP, removed };
}

function mutateViva(job) {
  const started = process.hrtime.bigint();
  const dataDir = normalizarDataDir(job.dataDir);
  const operacional = obterFilaOperacionalV2(dataDir);
  const paths = caminhoWorkspace(dataDir, job.clienteId);
  const pendente = mutationIntent.ler(dataDir, job.clienteId);
  if (!pendente.ok || pendente.exists) {
    const erro = new Error(pendente.motivo || "viva_mutation_intent_pending");
    erro.code = "VIVA_MUTATION_INTENT_PENDING";
    throw erro;
  }
  const previousHash = job.requiresCommit === true ? mutationIntent.hashArquivo(paths.viva) : null;
  if (job.requiresCommit === true && job.expectedCurrentVivaHash &&
      previousHash !== job.expectedCurrentVivaHash) {
    return { ok: false, operation: OP_VIVA_MUTATION, motivo: "viva_precondition_hash_mismatch" };
  }
  const mutationType = String(job.mutationType || "");
  const inputHash = job.requiresCommit === true ? mutationIntent.digest(JSON.stringify(job.item || {})) : "";
  const terminal = job.requiresCommit === true && mutationType === "update" &&
    classificarItemFilaV2(job.item || {}, { agora: Number(job.nowMs) || agoraMs() }).bucket === "historico";
  const removedIdentityHashes = job.requiresCommit === true && (mutationType === "remove" || terminal)
    ? operacional.identidadesItemFilaV2(job.item || {}).map(value => mutationIntent.digest(value))
    : [];
  const { writeClienteJson } = require("../../utils/storage");
  const deps = {
    agora: Number(job.nowMs) || agoraMs(),
    generation: Number(job.targetGeneration || 0),
    fileRevision: revisionSegura(job.checkpointRevision),
    publicarFileProof: false,
    posicaoLegada: job.posicaoLegada,
    permitirRegressaoStatus: job.permitirRegressaoStatus === true,
    caller: job.caller,
    motivo: job.motivo,
    rodadaId: job.rodadaId,
    cicloId: job.cicloId,
    mutationId: job.mutationId,
    transactionId: job.transactionId,
    correlationId: job.correlationId
  };
  if (job.requiresCommit === true) deps.writeClienteJson = (cliente, nome, valor) => {
    if (nome !== "fila-viva.json") return writeClienteJson(cliente, nome, valor);
    let intentPublicado;
    const escrito = writeClienteJson(cliente, nome, valor, {
      preparePublication: ({ conteudo }) => {
        intentPublicado = {
          schema: 1,
          clienteId: cliente,
          jobId: job.jobId,
          expectedGeneration: Number(job.targetGeneration) - 1,
          targetGeneration: Number(job.targetGeneration),
          mutationType,
          fileRevision: deps.fileRevision,
          previousHash,
          targetHash: mutationIntent.digest(conteudo),
          inputHash,
          itemCount: Array.isArray(valor) ? valor.length : 0,
          checkpointSincronizado: job.checkpointSincronizado === true,
          removalOperation: mutationType === "remove" ? "remove" : terminal ? "terminal" : null,
          removedIdentityHashes,
          motivo: String(job.motivo || "viva_mutation").slice(0, 120)
        };
        mutationIntent.escrever(dataDir, cliente, intentPublicado);
      }
    });
    if (escrito === true && removedIdentityHashes.length) {
      removalFence.garantirDoIntent(dataDir, cliente, intentPublicado);
    }
    return escrito;
  };

  let resultado;
  if (mutationType === "insert") {
    resultado = operacional.inserirItemFilaVivaIncremental(job.clienteId, job.item, deps);
  } else if (mutationType === "update") {
    resultado = operacional.atualizarItemFilaVivaIncremental(job.clienteId, job.item, deps);
  } else if (mutationType === "remove") {
    resultado = operacional.removerItemFilaVivaIncremental(job.clienteId, job.item, deps);
  } else {
    return { ok: false, operation: OP_VIVA_MUTATION, motivo: "viva_mutation_type_invalid" };
  }

  if (job.exigirMutacao === true &&
      resultado?.atualizouViva !== true &&
      resultado?.removeuDaViva !== true &&
      resultado?.terminalHistorico !== true) {
    resultado = {
      ...resultado,
      ok: false,
      tipoFalha: "mutacao_viva_nao_confirmada",
      motivo: "mutacao_viva_nao_confirmada"
    };
  }

  // The VIVA snapshot is published before this ACK; GC refs remain best-effort.
  // Keep scheduled thumbnails inside this worker, outside the response DTO.
  return {
    ok: resultado?.ok === true,
    operation: OP_VIVA_MUTATION,
    motivo: String(resultado?.motivo || ""),
    itemPosition: Number.isSafeInteger(resultado?.item?.posicaoLegada)
      ? resultado.item.posicaoLegada : null,
    atualizouViva: resultado?.atualizouViva === true,
    removeuDaViva: resultado?.removeuDaViva === true,
    ...(resultado?.terminalHistorico === true ? { terminalHistorico: true } : {}),
    idempotente: resultado?.idempotente === true,
    fallbackLegado: resultado?.fallbackLegado === true,
    tipoFalha: String(resultado?.tipoFalha || ""),
    etapa: String(resultado?.etapa || ""),
    codigoErro: String(resultado?.codigoErro || ""),
    errno: typeof resultado?.errno === "number" || typeof resultado?.errno === "string"
      ? resultado.errno : null,
    path: String(resultado?.path || ""),
    itemId: String(resultado?.itemId || ""),
    statusAntes: String(resultado?.statusAntes || ""),
    statusDepois: String(resultado?.statusDepois || ""),
    causaInterna: String(resultado?.causaInterna || ""),
    totalViva: Number(resultado?.totalViva || 0),
    bytesLidosViva: Number(resultado?.bytesLidosViva || 0),
    bytesFilaViva: Number(resultado?.bytesFilaViva || 0),
    bytesHistorico: Number(resultado?.bytesHistorico || 0),
    insertVivaMs: Number(resultado?.insertVivaMs || 0),
    updateVivaMs: Number(resultado?.updateVivaMs || 0),
    removalVivaMs: Number(resultado?.removalVivaMs || 0),
    ...(resultado?.terminalHistoricoFonte ? { terminalHistoricoFonte: String(resultado.terminalHistoricoFonte) } : {}),
    ...(resultado?.rodadaId ? { rodadaId: String(resultado.rodadaId) } : {}),
    metrics: {
      workerThreadId: threadId,
      workerHeapUsedBytes: process.memoryUsage().heapUsed,
      totalWorkerMs: Number(process.hrtime.bigint() - started) / 1e6,
      bytes: Number(resultado?.bytesFilaViva || 0),
      writes: resultado?.ok === true && resultado?.idempotente !== true ? 1 : 0
    }
  };
}

function probeVivaSnapshot(job) {
  const dataDir = normalizarDataDir(job.dataDir);
  const paths = caminhoWorkspace(dataDir, job.clienteId);
  const vivaBefore = statOptional(paths.viva);
  const currentHash = job.probeViva === false ? null : mutationIntent.hashArquivo(paths.viva);
  const vivaAfterHash = statOptional(paths.viva);
  if (!sameOptionalIdentity(vivaBefore, vivaAfterHash)) {
    return { ok: false, operation: OP_VIVA_SNAPSHOT_PROBE, motivo: "viva_snapshot_changed_during_probe" };
  }
  let legacyFenceCovered = null;
  const probeVivaFence = Array.isArray(job.vivaFenceHashes) && job.vivaFenceHashes.length > 0;
  let vivaFenceCovered = null;
  let vivaFenceCandidates = [];
  let vivaFenceRelatedCandidates = [];
  let vivaItemCount = null;
  if (probeVivaFence) {
    const hashes = new Set(job.vivaFenceHashes);
    const viva = readArray(paths.viva, { absentOk: true });
    if (!sameOptionalIdentity(vivaAfterHash, viva.identity)) {
      return { ok: false, operation: OP_VIVA_SNAPSHOT_PROBE, motivo: "viva_snapshot_changed_during_probe" };
    }
    const operacional = obterFilaOperacionalV2(dataDir);
    vivaItemCount = viva.value.length;
    if (job.includeFenceCandidates === true) {
      vivaFenceCandidates = viva.value.filter(entrada =>
        operacional.identidadesItemFilaV2(entrada?.item || entrada)
          .some(id => hashes.has(mutationIntent.digest(id))));
      vivaFenceCovered = vivaFenceCandidates.length === 0;
    } else {
      vivaFenceCovered = !viva.value.some(entrada =>
        operacional.identidadesItemFilaV2(entrada?.item || entrada)
          .some(id => hashes.has(mutationIntent.digest(id))));
    }
    if (vivaFenceCovered === false && job.includeFenceCandidates === true) {
      const identidadesCandidatas = new Set(vivaFenceCandidates.flatMap(entrada =>
        operacional.identidadesEntradaFilaV2(entrada)));
      vivaFenceRelatedCandidates = viva.value.filter(entrada =>
        operacional.identidadesEntradaFilaV2(entrada)
          .some(identidade => identidadesCandidatas.has(identidade)));
    }
  }
  if (Array.isArray(job.legacyFenceHashes) && job.legacyFenceHashes.length) {
    const hashes = new Set(job.legacyFenceHashes);
    const legacy = readArray(paths.arquivo, { absentOk: true });
    const operacional = obterFilaOperacionalV2(dataDir);
    legacyFenceCovered = !legacy.value.some(item =>
      operacional.identidadesItemFilaV2(item).some(id => hashes.has(mutationIntent.digest(id))));
  }
  return {
    ok: true,
    operation: OP_VIVA_SNAPSHOT_PROBE,
    workerThreadId: threadId,
    currentHash,
    matchPrevious: currentHash === job.previousHash,
    matchTarget: currentHash === job.targetHash,
    legacyFenceCovered,
    ...(probeVivaFence ? {
      currentIdentity: vivaAfterHash ? {
        size: Number(vivaAfterHash.size || 0),
        mtimeMs: Number(vivaAfterHash.mtimeMs || 0)
      } : null,
      vivaFenceCovered,
      vivaItemCount,
      ...(job.includeFenceCandidates === true ? {
        vivaFenceCandidates,
        vivaFenceRelatedCandidates
      } : {})
    } : {})
  };
}

async function executar(job) {
  if (!job || typeof job !== "object") throw new Error("persistence_job_invalido");
  if (job.operation === OP_PREPARE) return prepare(job);
  if (job.operation === OP_PUBLISH) return publish(job);
  if (job.operation === OP_CLEANUP) return cleanup(job);
  if (job.operation === OP_VIVA_MUTATION) return mutateViva(job);
  if (job.operation === OP_VIVA_SNAPSHOT_PROBE) return probeVivaSnapshot(job);
  if (job.operation === OP_TERMINAL_INDEX_BOOTSTRAP) {
    const dataDir = normalizarDataDir(job.dataDir);
    try {
      return construirTerminalIndex(job, { operacional: obterFilaOperacionalV2(dataDir) });
    } catch (erro) {
      return {
        ok: false,
        operation: OP_TERMINAL_INDEX_BOOTSTRAP,
        motivo: erro?.code || "terminal_index_bootstrap_failed",
        erro: erroSanitizado(erro)
      };
    }
  }
  if (job.operation === OP_TERMINAL_INDEX_DELTA) {
    const dataDir = normalizarDataDir(job.dataDir);
    try {
      return construirTerminalIndexDelta(job, { operacional: obterFilaOperacionalV2(dataDir) });
    } catch (erro) {
      return {
        ok: false,
        operation: OP_TERMINAL_INDEX_DELTA,
        motivo: erro?.code || "terminal_index_delta_failed",
        erro: erroSanitizado(erro)
      };
    }
  }
  throw new Error("persistence_operation_invalida");
}

if (!parentPort) throw new Error("persistence_worker_parent_port_indisponivel");

let jobEmAndamento = false;
parentPort.on("message", message => {
  if (jobEmAndamento) {
    parentPort.postMessage({
      type: RESPONSE_ERROR,
      jobId: message?.jobId || "",
      error: { code: "WORKER_BUSY", message: "persistence_worker_busy" }
    });
    return;
  }
  jobEmAndamento = true;
  Promise.resolve()
    .then(() => executar(message))
    .then(resultado => {
      parentPort.postMessage({ type: RESPONSE_OK, jobId: message.jobId, result: resultado });
    })
    .catch(erro => {
      parentPort.postMessage({
        type: RESPONSE_ERROR,
        jobId: message?.jobId || "",
        error: { ...erroSanitizado(erro), code: erro?.code || erro?.codigo || "WORKER_JOB_FAILED" }
      });
    })
    .finally(() => {
      jobEmAndamento = false;
    });
});
