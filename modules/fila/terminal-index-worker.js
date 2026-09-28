"use strict";

const fs = require("fs");
const path = require("path");
const { StringDecoder } = require("string_decoder");
const { lerArrayJsonIncremental } = require("./json-array-incremental");
const {
  workspaceSeguro,
  revisionSegura,
  normalizarDataDir,
  sameIdentity
} = require("./persistence-protocol");
const {
  TERMINAL_INDEX_VERSION,
  TERMINAL_INDEX_PROOF_VERSION,
  TERMINAL_INDEX_MAINTENANCE_VERSION,
  TERMINAL_INDEX_FILE,
  TERMINAL_INDEX_PROOF_FILE,
  TERMINAL_INDEX_INCREMENTAL_DIR,
  TERMINAL_INDEX_LEGACY_FILE,
  hashConteudo,
  identityFromStat,
  statOptional,
  capturarSourceProof,
  sourceProofIgual,
  cursorsSourceProof
} = require("./terminal-index-shadow");

const DEFAULT_CHUNK_BYTES = 1024 * 1024;
const DEFAULT_MAX_JSONL_LINE_BYTES = 64 * 1024 * 1024;

function erroCodigo(code, message = code) {
  const erro = new Error(message);
  erro.code = code;
  return erro;
}

function caminhosWorker(dataDir, clienteId) {
  const raiz = path.resolve(normalizarDataDir(dataDir));
  const cliente = workspaceSeguro(clienteId);
  const clientesDir = path.resolve(raiz, "clientes");
  const diretorio = path.resolve(clientesDir, cliente);
  if (!diretorio.startsWith(`${clientesDir}${path.sep}`)) throw erroCodigo("TERMINAL_INDEX_PATH_INVALID");
  const resolver = nome => {
    const result = path.resolve(diretorio, nome);
    if (path.dirname(result) !== diretorio) throw erroCodigo("TERMINAL_INDEX_PATH_INVALID");
    return result;
  };
  return {
    cliente,
    diretorio,
    legacy: resolver(TERMINAL_INDEX_LEGACY_FILE),
    incrementalDir: resolver(TERMINAL_INDEX_INCREMENTAL_DIR),
    index: resolver(TERMINAL_INDEX_FILE),
    proof: resolver(TERMINAL_INDEX_PROOF_FILE)
  };
}

function sourceProofWorker(paths) {
  return capturarSourceProof(paths.cliente, {
    fs,
    getClientePath: () => paths.diretorio
  });
}

function garantirSourceEstavel(inicial, atual, motivo = "terminal_index_source_changed") {
  if (!atual?.ok || !sourceProofIgual(inicial?.proof, atual?.proof) || inicial?.sourceRevision !== atual?.sourceRevision) {
    throw erroCodigo("STALE_REVISION", motivo);
  }
}

function lerArrayEstavel(file, identidadeEsperada, onItem) {
  let fd;
  try {
    fd = fs.openSync(file, "r");
    const inicial = identityFromStat(file, fs.fstatSync(fd));
    if (!sameIdentity(inicial, identidadeEsperada)) throw erroCodigo("STALE_REVISION", "terminal_index_source_changed_before_read");
    const leitura = lerArrayJsonIncremental(fd, { onItem });
    const finalFd = identityFromStat(file, fs.fstatSync(fd));
    fs.closeSync(fd);
    fd = null;
    const finalPath = statOptional(file, fs);
    if (!finalPath || !sameIdentity(inicial, finalFd) || !sameIdentity(inicial, finalPath)) {
      throw erroCodigo("STALE_REVISION", "terminal_index_source_changed_during_read");
    }
    return leitura;
  } finally {
    if (fd !== null && fd !== undefined) {
      try { fs.closeSync(fd); } catch {}
    }
  }
}

function lerJsonlEstavel(file, identidadeEsperada, onItem, opcoes = {}) {
  const chunkBytes = Math.max(1024, Number(opcoes.chunkBytes || DEFAULT_CHUNK_BYTES));
  const maxLineBytes = Math.max(1024, Number(opcoes.maxLineBytes || DEFAULT_MAX_JSONL_LINE_BYTES));
  const decoder = new StringDecoder("utf8");
  const buffer = Buffer.allocUnsafe(chunkBytes);
  let fd;
  let pendente = "";
  let bytes = 0;
  let linhas = 0;
  let readMs = 0;
  let parseMs = 0;

  function processarLinha(linha) {
    const limpa = linha.endsWith("\r") ? linha.slice(0, -1) : linha;
    if (!limpa.trim()) return;
    const inicio = process.hrtime.bigint();
    let valor;
    try {
      valor = JSON.parse(limpa);
    } finally {
      parseMs += Number(process.hrtime.bigint() - inicio) / 1e6;
    }
    linhas += 1;
    onItem(valor, linhas - 1);
  }

  function processarTexto(texto) {
    pendente += texto;
    if (Buffer.byteLength(pendente, "utf8") > maxLineBytes && !pendente.includes("\n")) {
      throw erroCodigo("JSONL_LINE_TOO_LARGE", "terminal_index_jsonl_line_too_large");
    }
    let quebra;
    while ((quebra = pendente.indexOf("\n")) >= 0) {
      const linha = pendente.slice(0, quebra);
      pendente = pendente.slice(quebra + 1);
      processarLinha(linha);
    }
    if (Buffer.byteLength(pendente, "utf8") > maxLineBytes) {
      throw erroCodigo("JSONL_LINE_TOO_LARGE", "terminal_index_jsonl_line_too_large");
    }
  }

  try {
    fd = fs.openSync(file, "r");
    const inicial = identityFromStat(file, fs.fstatSync(fd));
    if (!sameIdentity(inicial, identidadeEsperada)) throw erroCodigo("STALE_REVISION", "terminal_index_source_changed_before_read");
    while (true) {
      const inicio = process.hrtime.bigint();
      const lidos = fs.readSync(fd, buffer, 0, buffer.length, null);
      readMs += Number(process.hrtime.bigint() - inicio) / 1e6;
      if (!lidos) break;
      bytes += lidos;
      processarTexto(decoder.write(buffer.subarray(0, lidos)));
    }
    processarTexto(decoder.end());
    if (pendente.trim()) processarLinha(pendente);
    pendente = "";
    const finalFd = identityFromStat(file, fs.fstatSync(fd));
    fs.closeSync(fd);
    fd = null;
    const finalPath = statOptional(file, fs);
    if (!finalPath || !sameIdentity(inicial, finalFd) || !sameIdentity(inicial, finalPath)) {
      throw erroCodigo("STALE_REVISION", "terminal_index_source_changed_during_read");
    }
    return { bytes, linhas, readMs, parseMs };
  } finally {
    if (fd !== null && fd !== undefined) {
      try { fs.closeSync(fd); } catch {}
    }
  }
}

function lerJsonCompactoWorker(file, maxBytes = 32 * 1024 * 1024) {
  const identity = statOptional(file, fs);
  if (!identity) throw erroCodigo("TERMINAL_INDEX_DELTA_INDEX_MISSING");
  if (Number(identity.size || 0) > maxBytes) throw erroCodigo("TERMINAL_INDEX_DELTA_INDEX_TOO_LARGE");
  const raw = fs.readFileSync(file);
  const after = statOptional(file, fs);
  if (!after || !sameIdentity(identity, after)) throw erroCodigo("STALE_REVISION", "terminal_index_delta_index_changed");
  try {
    return { value: JSON.parse(raw.toString("utf8")), raw, identity: after };
  } catch {
    throw erroCodigo("TERMINAL_INDEX_DELTA_INDEX_INVALID");
  }
}

function lerJsonlDesdeCursorEstavel(file, identidadeEsperada, cursorBytes, onItem, opcoes = {}) {
  const chunkBytes = Math.max(1024, Number(opcoes.chunkBytes || DEFAULT_CHUNK_BYTES));
  const maxLineBytes = Math.max(1024, Number(opcoes.maxLineBytes || DEFAULT_MAX_JSONL_LINE_BYTES));
  const decoder = new StringDecoder("utf8");
  const buffer = Buffer.allocUnsafe(chunkBytes);
  let fd;
  let pendente = "";
  let bytes = 0;
  let linhas = 0;
  let readMs = 0;
  let parseMs = 0;
  const offset = Math.max(0, Number(cursorBytes || 0));

  function processarLinha(linha) {
    const limpa = linha.endsWith("\r") ? linha.slice(0, -1) : linha;
    if (!limpa.trim()) return;
    const inicio = process.hrtime.bigint();
    let valor;
    try {
      valor = JSON.parse(limpa);
    } finally {
      parseMs += Number(process.hrtime.bigint() - inicio) / 1e6;
    }
    linhas += 1;
    onItem(valor);
  }

  function processarTexto(texto) {
    if (!texto) return;
    pendente += texto;
    if (Buffer.byteLength(pendente, "utf8") > maxLineBytes) {
      throw erroCodigo("JSONL_LINE_TOO_LARGE", "terminal_index_jsonl_line_too_large");
    }
    let indice;
    while ((indice = pendente.indexOf("\n")) >= 0) {
      const linha = pendente.slice(0, indice);
      pendente = pendente.slice(indice + 1);
      processarLinha(linha);
    }
  }

  try {
    fd = fs.openSync(file, "r");
    const inicial = identityFromStat(file, fs.fstatSync(fd));
    if (!sameIdentity(inicial, identidadeEsperada) || inicial.size < offset) {
      throw erroCodigo("STALE_REVISION", "terminal_index_delta_source_changed_before_read");
    }
    let posicao = offset;
    while (true) {
      const inicio = process.hrtime.bigint();
      const lidos = fs.readSync(fd, buffer, 0, buffer.length, posicao);
      readMs += Number(process.hrtime.bigint() - inicio) / 1e6;
      if (!lidos) break;
      posicao += lidos;
      bytes += lidos;
      processarTexto(decoder.write(buffer.subarray(0, lidos)));
    }
    processarTexto(decoder.end());
    if (pendente.trim()) throw erroCodigo("STALE_REVISION", "terminal_index_delta_partial_line");
    const finalFd = identityFromStat(file, fs.fstatSync(fd));
    fs.closeSync(fd);
    fd = null;
    const finalPath = statOptional(file, fs);
    if (!finalPath || !sameIdentity(inicial, finalFd) || !sameIdentity(inicial, finalPath)) {
      throw erroCodigo("STALE_REVISION", "terminal_index_delta_source_changed_during_read");
    }
    return { bytes, linhas, readMs, parseMs };
  } finally {
    if (fd !== null && fd !== undefined) {
      try { fs.closeSync(fd); } catch {}
    }
  }
}

function escreverArquivoCompleto(file, conteudo) {
  const fd = fs.openSync(file, "wx");
  try {
    const buffer = Buffer.isBuffer(conteudo) ? conteudo : Buffer.from(conteudo, "utf8");
    let offset = 0;
    while (offset < buffer.length) {
      const escritos = fs.writeSync(fd, buffer, offset, buffer.length - offset, null);
      if (!escritos) throw erroCodigo("TERMINAL_INDEX_WRITE_ZERO");
      offset += escritos;
    }
    fs.fsyncSync(fd);
    return buffer.length;
  } finally {
    fs.closeSync(fd);
  }
}

function removerSeExiste(file) {
  try { fs.unlinkSync(file); } catch (erro) {
    if (erro?.code !== "ENOENT") throw erro;
  }
}

function construirTerminalIndex(job = {}, deps = {}) {
  const started = process.hrtime.bigint();
  const paths = caminhosWorker(job.dataDir, job.clienteId);
  const revision = revisionSegura(job.checkpointRevision);
  const operacional = deps.operacional;
  if (!operacional || typeof operacional.normalizarEntradasViva !== "function" ||
      typeof operacional.identidadePrimariaExataFilaV2 !== "function") {
    throw erroCodigo("TERMINAL_INDEX_OPERATIONAL_API_MISSING");
  }
  const hooks = deps.hooks || {};
  const nowMs = Number(job.nowMs) || Date.now();
  const generation = Number(job.targetGeneration) > 0 ? Number(job.targetGeneration) : nowMs;
  const indexPartial = `${paths.index}.partial.${revision}`;
  const proofPartial = `${paths.proof}.partial.${revision}`;
  removerSeExiste(indexPartial);
  removerSeExiste(proofPartial);

  const memoriaAntes = process.memoryUsage();
  const cpuAntes = process.cpuUsage();
  let heapPico = memoriaAntes.heapUsed;
  const sourceInicial = sourceProofWorker(paths);
  if (!sourceInicial.ok) throw erroCodigo("TERMINAL_INDEX_SOURCE_MISSING", sourceInicial.motivo);
  const entradas = new Map();
  let legadoTerminais = 0;
  let incrementalTerminais = 0;
  let duplicados = 0;

  function adicionar(raw, sourceMask) {
    const item = raw?.item && typeof raw.item === "object" ? raw.item : raw;
    const entrada = operacional.normalizarEntradasViva([item], nowMs)[0];
    if (!entrada || entrada.bucket !== "historico") return false;
    const identidade = operacional.identidadePrimariaExataFilaV2(item);
    if (!identidade) return false;
    const status = String(entrada.status || item?.status || item?.estado || "").trim().toLowerCase();
    const atual = entradas.get(identidade);
    if (!atual) {
      entradas.set(identidade, [status, sourceMask]);
      return true;
    }
    duplicados += 1;
    const rankAtual = operacional.rankStatusFilaV2(atual[0]);
    const rankNovo = operacional.rankStatusFilaV2(status);
    if (rankNovo > rankAtual) atual[0] = status;
    atual[1] |= sourceMask;
    return true;
  }

  let readMs = 0;
  let parseMs = 0;
  let sourceBytes = 0;
  const legacyRead = lerArrayEstavel(paths.legacy, sourceInicial.proof.legacy, item => {
    if (adicionar(item, 1)) legadoTerminais += 1;
  });
  readMs += legacyRead.readMs;
  parseMs += legacyRead.parseMs;
  sourceBytes += legacyRead.bytes;

  for (const source of sourceInicial.proof.incremental) {
    const file = path.resolve(paths.incrementalDir, source.name);
    if (path.dirname(file) !== paths.incrementalDir) throw erroCodigo("TERMINAL_INDEX_PATH_INVALID");
    const leitura = lerJsonlEstavel(file, source.identity, registro => {
      const item = registro?.item && typeof registro.item === "object" ? registro.item : registro;
      if (adicionar(item, 2)) incrementalTerminais += 1;
    });
    readMs += leitura.readMs;
    parseMs += leitura.parseMs;
    sourceBytes += leitura.bytes;
  }

  if (typeof hooks.afterScan === "function") hooks.afterScan({ paths, sourceInicial, entradas });
  const sourceDepoisScan = sourceProofWorker(paths);
  garantirSourceEstavel(sourceInicial, sourceDepoisScan, "terminal_index_source_changed_during_scan");
  heapPico = Math.max(heapPico, process.memoryUsage().heapUsed);

  const entries = Object.create(null);
  for (const identidade of [...entradas.keys()].sort()) entries[identidade] = entradas.get(identidade);
  const builtAt = new Date(nowMs).toISOString();
  const index = {
    version: TERMINAL_INDEX_VERSION,
    maintenanceVersion: TERMINAL_INDEX_MAINTENANCE_VERSION,
    complete: true,
    authorityEligible: false,
    mode: "shadow",
    generation,
    revision,
    builtAt,
    totalTerminais: entradas.size,
    sourceRevision: sourceInicial.sourceRevision,
    entries
  };
  const stringifyStarted = process.hrtime.bigint();
  const indexBuffer = Buffer.from(JSON.stringify(index), "utf8");
  const stringifyMs = Number(process.hrtime.bigint() - stringifyStarted) / 1e6;

  try {
    escreverArquivoCompleto(indexPartial, indexBuffer);
    if (typeof hooks.afterIndexPartial === "function") hooks.afterIndexPartial({ paths, indexPartial });
    garantirSourceEstavel(sourceInicial, sourceProofWorker(paths), "terminal_index_source_changed_before_publish");
    if (typeof hooks.beforeIndexRename === "function") hooks.beforeIndexRename({ paths, indexPartial });
    fs.renameSync(indexPartial, paths.index);
    const indexIdentity = statOptional(paths.index, fs);
    if (!indexIdentity) throw erroCodigo("TERMINAL_INDEX_PUBLISH_FAILED");
    garantirSourceEstavel(sourceInicial, sourceProofWorker(paths), "terminal_index_source_changed_after_index_publish");

    const proof = {
      proofVersion: TERMINAL_INDEX_PROOF_VERSION,
      maintenanceVersion: TERMINAL_INDEX_MAINTENANCE_VERSION,
      indexVersion: TERMINAL_INDEX_VERSION,
      complete: true,
      authorityEligible: false,
      mode: "shadow",
      generation,
      revision,
      builtAt,
      totalTerminais: entradas.size,
      sourceRevision: sourceInicial.sourceRevision,
      sources: sourceInicial.proof,
      sourceCursors: cursorsSourceProof(sourceInicial.proof),
      indexIdentity,
      indexSha256: hashConteudo(indexBuffer)
    };
    escreverArquivoCompleto(proofPartial, JSON.stringify(proof));
    if (typeof hooks.beforeProofRename === "function") hooks.beforeProofRename({ paths, proofPartial });
    garantirSourceEstavel(sourceInicial, sourceProofWorker(paths), "terminal_index_source_changed_before_proof_publish");
    fs.renameSync(proofPartial, paths.proof);
    const sourceFinal = sourceProofWorker(paths);
    if (!sourceFinal.ok || !sourceProofIgual(sourceInicial.proof, sourceFinal.proof)) {
      removerSeExiste(paths.proof);
      throw erroCodigo("STALE_REVISION", "terminal_index_source_changed_after_publish");
    }
    if (typeof hooks.afterPublish === "function") hooks.afterPublish({ paths, index, proof });

    const memoriaDepois = process.memoryUsage();
    heapPico = Math.max(heapPico, memoriaDepois.heapUsed);
    const cpuDepois = process.cpuUsage(cpuAntes);
    return {
      ok: true,
      operation: "terminal_index_bootstrap",
      clienteId: paths.cliente,
      checkpointRevision: revision,
      generation,
      totalTerminais: entradas.size,
      legadoTerminais,
      incrementalTerminais,
      duplicados,
      bytes: indexBuffer.length,
      sourceRevision: sourceInicial.sourceRevision,
      metrics: {
        messageBytes: Buffer.byteLength(JSON.stringify(job), "utf8"),
        sourceBytes,
        readMs,
        parseMs,
        stringifyMs: Math.max(0, stringifyMs),
        totalWorkerMs: Number(process.hrtime.bigint() - started) / 1e6,
        processRssBytesAtJob: memoriaDepois.rss,
        workerHeapUsedBytes: memoriaDepois.heapUsed,
        heapDeltaBytes: memoriaDepois.heapUsed - memoriaAntes.heapUsed,
        workerHeapBeforeBytes: memoriaAntes.heapUsed,
        workerHeapPeakBytes: heapPico,
        workerHeapAfterBytes: memoriaDepois.heapUsed,
        workerCpuUserMs: cpuDepois.user / 1000,
        workerCpuSystemMs: cpuDepois.system / 1000,
        indexBytes: indexBuffer.length
      }
    };
  } catch (erro) {
    removerSeExiste(indexPartial);
    removerSeExiste(proofPartial);
    throw erro;
  }
}

function construirTerminalIndexDelta(job = {}, deps = {}) {
  const started = process.hrtime.bigint();
  const memoriaAntes = process.memoryUsage();
  const cpuAntes = process.cpuUsage();
  let heapPico = memoriaAntes.heapUsed;
  const paths = caminhosWorker(job.dataDir, job.clienteId);
  const revision = revisionSegura(job.checkpointRevision);
  const indexRead = lerJsonCompactoWorker(paths.index);
  const proofRead = lerJsonCompactoWorker(paths.proof, 1024 * 1024);
  const index = indexRead.value;
  const proof = proofRead.value;
  if (index?.complete !== true || proof?.complete !== true || index?.mode !== "shadow" || proof?.mode !== "shadow" ||
      index?.authorityEligible !== false || proof?.authorityEligible !== false) {
    throw erroCodigo("TERMINAL_INDEX_DELTA_BASELINE_INVALID");
  }
  if (index.maintenanceVersion !== TERMINAL_INDEX_MAINTENANCE_VERSION ||
      proof.maintenanceVersion !== TERMINAL_INDEX_MAINTENANCE_VERSION ||
      !Array.isArray(proof.sourceCursors)) {
    throw erroCodigo("TERMINAL_INDEX_DELTA_BASELINE_UNSUPPORTED");
  }
  if (index.revision !== proof.revision || Number(index.generation) !== Number(proof.generation) ||
      index.sourceRevision !== proof.sourceRevision || hashConteudo(indexRead.raw) !== proof.indexSha256) {
    throw erroCodigo("STALE_REVISION", "terminal_index_delta_index_proof_divergent");
  }

  const sourceInicial = sourceProofWorker(paths);
  if (!sourceInicial.ok) throw erroCodigo("TERMINAL_INDEX_SOURCE_MISSING", sourceInicial.motivo);
  if (!sameIdentity(proof.sources?.legacy, sourceInicial.proof.legacy)) {
    throw erroCodigo("TERMINAL_INDEX_LEGACY_CHANGED", "terminal_index_delta_requires_bootstrap");
  }
  const operacional = deps.operacional;
  if (!operacional || typeof operacional.normalizarEntradasViva !== "function" ||
      typeof operacional.identidadePrimariaExataFilaV2 !== "function" ||
      typeof operacional.rankStatusFilaV2 !== "function") {
    throw erroCodigo("TERMINAL_INDEX_OPERATIONAL_API_MISSING");
  }

  const cursors = new Map(proof.sourceCursors.map(item => [item.name, item]));
  const proofSources = new Map((proof.sources?.incremental || []).map(item => [item.name, item]));
  for (const cursor of cursors.values()) {
    const source = proofSources.get(cursor.name);
    if (!source || !sameIdentity(cursor.identity, source.identity) ||
        Number(cursor.cursorBytes) !== Number(source.identity?.size || 0)) {
      throw erroCodigo("STALE_REVISION", "terminal_index_delta_cursor_proof_divergent");
    }
  }
  const currentNames = new Set(sourceInicial.proof.incremental.map(item => item.name));
  for (const cursor of cursors.values()) {
    if (!currentNames.has(cursor.name)) {
      throw erroCodigo("STALE_REVISION", "terminal_index_delta_source_removed_requires_bootstrap");
    }
  }
  const entradas = new Map();
  for (const [identidade, valor] of Object.entries(index.entries || {})) {
    if (Array.isArray(valor) && valor.length >= 2) entradas.set(identidade, [valor[0], valor[1]]);
  }
  let incrementalTerminais = 0;
  let duplicados = 0;
  let sourceBytes = 0;
  let readMs = 0;
  let parseMs = 0;

  function adicionar(raw) {
    const item = raw?.item && typeof raw.item === "object" ? raw.item : raw;
    const entrada = operacional.normalizarEntradasViva([item], Number(job.nowMs) || Date.now())[0];
    if (!entrada || entrada.bucket !== "historico") return;
    const identidade = operacional.identidadePrimariaExataFilaV2(item);
    if (!identidade) return;
    const status = String(entrada.status || item?.status || item?.estado || "").trim().toLowerCase();
    const atual = entradas.get(identidade);
    incrementalTerminais += 1;
    if (!atual) {
      entradas.set(identidade, [status, 2]);
      return;
    }
    duplicados += 1;
    if (operacional.rankStatusFilaV2(status) > operacional.rankStatusFilaV2(atual[0])) atual[0] = status;
    atual[1] |= 2;
  }

  for (const source of sourceInicial.proof.incremental) {
    const baseline = cursors.get(source.name);
    const cursor = Number(baseline?.cursorBytes || 0);
    if (baseline && (Number(baseline.identity?.dev) !== Number(source.identity?.dev) ||
        Number(baseline.identity?.ino) !== Number(source.identity?.ino) ||
        cursor > Number(source.identity?.size || 0))) {
      throw erroCodigo("STALE_REVISION", "terminal_index_delta_cursor_incompatible");
    }
    const leitura = lerJsonlDesdeCursorEstavel(path.resolve(paths.incrementalDir, source.name), source.identity, cursor, adicionar);
    sourceBytes += leitura.bytes;
    readMs += leitura.readMs;
    parseMs += leitura.parseMs;
  }

  const sourceDepoisScan = sourceProofWorker(paths);
  garantirSourceEstavel(sourceInicial, sourceDepoisScan, "terminal_index_delta_source_changed_during_scan");
  heapPico = Math.max(heapPico, process.memoryUsage().heapUsed);
  const entries = Object.create(null);
  for (const identidade of [...entradas.keys()].sort()) entries[identidade] = entradas.get(identidade);
  const nowMs = Number(job.nowMs) || Date.now();
  const generation = Math.max(Number(index.generation || 0) + 1, Number(job.targetGeneration || 0));
  const builtAt = new Date(nowMs).toISOString();
  const nextIndex = {
    version: TERMINAL_INDEX_VERSION,
    maintenanceVersion: TERMINAL_INDEX_MAINTENANCE_VERSION,
    complete: true,
    authorityEligible: false,
    mode: "shadow",
    generation,
    revision,
    builtAt,
    totalTerminais: entradas.size,
    sourceRevision: sourceInicial.sourceRevision,
    entries
  };
  const indexBuffer = Buffer.from(JSON.stringify(nextIndex), "utf8");
  const indexPartial = `${paths.index}.partial.${revision}`;
  const proofPartial = `${paths.proof}.partial.${revision}`;
  removerSeExiste(indexPartial);
  removerSeExiste(proofPartial);
  try {
    escreverArquivoCompleto(indexPartial, indexBuffer);
    if (typeof deps.hooks?.afterIndexPartial === "function") deps.hooks.afterIndexPartial({ paths, indexPartial });
    garantirSourceEstavel(sourceInicial, sourceProofWorker(paths), "terminal_index_delta_source_changed_before_publish");
    if (typeof deps.hooks?.beforeIndexRename === "function") deps.hooks.beforeIndexRename({ paths, indexPartial });
    fs.renameSync(indexPartial, paths.index);
    const indexIdentity = statOptional(paths.index, fs);
    if (!indexIdentity) throw erroCodigo("TERMINAL_INDEX_PUBLISH_FAILED");
    garantirSourceEstavel(sourceInicial, sourceProofWorker(paths), "terminal_index_delta_source_changed_after_index_publish");
    const nextProof = {
      proofVersion: TERMINAL_INDEX_PROOF_VERSION,
      maintenanceVersion: TERMINAL_INDEX_MAINTENANCE_VERSION,
      indexVersion: TERMINAL_INDEX_VERSION,
      complete: true,
      authorityEligible: false,
      mode: "shadow",
      generation,
      revision,
      builtAt,
      totalTerminais: entradas.size,
      sourceRevision: sourceInicial.sourceRevision,
      sources: sourceInicial.proof,
      sourceCursors: sourceInicial.proof.incremental.map(item => ({ name: item.name, identity: item.identity, cursorBytes: Number(item.identity.size || 0) })),
      indexIdentity,
      indexSha256: hashConteudo(indexBuffer)
    };
    escreverArquivoCompleto(proofPartial, JSON.stringify(nextProof));
    if (typeof deps.hooks?.beforeProofRename === "function") deps.hooks.beforeProofRename({ paths, proofPartial });
    garantirSourceEstavel(sourceInicial, sourceProofWorker(paths), "terminal_index_delta_source_changed_before_proof");
    fs.renameSync(proofPartial, paths.proof);
    const sourceFinal = sourceProofWorker(paths);
    if (!sourceFinal.ok || !sourceProofIgual(sourceInicial.proof, sourceFinal.proof)) {
      removerSeExiste(paths.proof);
      throw erroCodigo("STALE_REVISION", "terminal_index_delta_source_changed_after_publish");
    }
    if (typeof deps.hooks?.afterPublish === "function") deps.hooks.afterPublish({ paths, index: nextIndex, proof: nextProof });
    const memoriaDepois = process.memoryUsage();
    heapPico = Math.max(heapPico, memoriaDepois.heapUsed);
    const cpuDepois = process.cpuUsage(cpuAntes);
    return {
      ok: true,
      operation: "terminal_index_delta",
      clienteId: paths.cliente,
      checkpointRevision: revision,
      generation,
      totalTerminais: entradas.size,
      deltaRecords: incrementalTerminais,
      duplicados,
      bytes: indexBuffer.length,
      sourceRevision: sourceInicial.sourceRevision,
      metrics: {
        messageBytes: Buffer.byteLength(JSON.stringify(job), "utf8"),
        sourceBytes,
        deltaScanBytes: sourceBytes,
        readMs,
        parseMs,
        totalWorkerMs: Number(process.hrtime.bigint() - started) / 1e6,
        processRssBytesAtJob: memoriaDepois.rss,
        workerHeapBeforeBytes: memoriaAntes.heapUsed,
        workerHeapPeakBytes: heapPico,
        workerHeapAfterBytes: memoriaDepois.heapUsed,
        workerCpuUserMs: cpuDepois.user / 1000,
        workerCpuSystemMs: cpuDepois.system / 1000,
        indexBytes: indexBuffer.length,
        scanMode: "tail"
      }
    };
  } catch (erro) {
    removerSeExiste(indexPartial);
    removerSeExiste(proofPartial);
    throw erro;
  }
}

module.exports = {
  DEFAULT_CHUNK_BYTES,
  DEFAULT_MAX_JSONL_LINE_BYTES,
  caminhosWorker,
  lerJsonlEstavel,
  construirTerminalIndex,
  construirTerminalIndexDelta
};
