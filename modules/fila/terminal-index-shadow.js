"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { getClientePath } = require("../../utils/storage");
const { definirTerminalIndexBootstrapAtivo } = require("../../utils/painel-latencia");
const { sameIdentity } = require("./persistence-protocol");

const TERMINAL_INDEX_VERSION = 1;
const TERMINAL_INDEX_PROOF_VERSION = 1;
const TERMINAL_INDEX_MAINTENANCE_VERSION = 1;
const TERMINAL_INDEX_FILE = "fila-terminal-index.json";
const TERMINAL_INDEX_PROOF_FILE = "fila-terminal-index.proof.json";
const TERMINAL_INDEX_INCREMENTAL_DIR = "fila-historico-incremental";
const TERMINAL_INDEX_LEGACY_FILE = "fila-historico.json";
const TERMINAL_INDEX_SHADOW_FLAG = "FILA_TERMINAL_INDEX_SHADOW";
const TAG_TERMINAL_INDEX_SHADOW = "[FILA-TERMINAL-INDEX-SHADOW]";
const DEFAULT_BOOTSTRAP_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_LOG_INTERVAL_MS = 30 * 1000;
const DEFAULT_MAX_INDEX_BYTES = 32 * 1024 * 1024;

const bootstrapEmAndamento = new Map();
const bootstrapAceitoEmAndamento = new Set();
const deltaSignalEmAndamento = new Map();
const ultimoBootstrap = new Map();
const ultimoLog = new Map();
const metricasComparacao = new Map();
const ultimaMetricaEmitida = new Map();

function texto(valor = "") {
  return String(valor == null ? "" : valor).trim();
}

function flagAtiva(env = process.env) {
  return ["1", "true", "on", "yes"].includes(texto(env?.[TERMINAL_INDEX_SHADOW_FLAG]).toLowerCase());
}

function workspaceHash(clienteId = "admin") {
  return crypto.createHash("sha256").update(texto(clienteId || "admin")).digest("hex").slice(0, 12);
}

function hashConteudo(conteudo) {
  return crypto.createHash("sha256").update(conteudo).digest("hex");
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

function statOptional(file, fsImpl = fs) {
  try {
    return identityFromStat(file, fsImpl.statSync(file, { bigint: false }));
  } catch (erro) {
    if (erro?.code === "ENOENT") return null;
    throw erro;
  }
}

function diretorioCliente(clienteId, deps = {}) {
  const obter = deps.getClientePath || getClientePath;
  return path.resolve(obter(texto(clienteId || "admin")));
}

function caminhosTerminalIndex(clienteId, deps = {}) {
  const diretorio = diretorioCliente(clienteId, deps);
  const resolver = nome => {
    const resolved = path.resolve(diretorio, nome);
    if (path.dirname(resolved) !== diretorio) throw new Error("terminal_index_path_inseguro");
    return resolved;
  };
  return {
    diretorio,
    legacy: resolver(TERMINAL_INDEX_LEGACY_FILE),
    incrementalDir: resolver(TERMINAL_INDEX_INCREMENTAL_DIR),
    index: resolver(TERMINAL_INDEX_FILE),
    proof: resolver(TERMINAL_INDEX_PROOF_FILE)
  };
}

function nomesJsonl(dir, fsImpl = fs) {
  return fsImpl.readdirSync(dir, { withFileTypes: true })
    .filter(item => item.isFile() && /^[a-zA-Z0-9_.-]+\.jsonl$/i.test(item.name) && !item.name.includes(".."))
    .map(item => item.name)
    .sort();
}

function capturarSourceProof(clienteId, deps = {}) {
  const fsImpl = deps.fs || fs;
  const caminhos = caminhosTerminalIndex(clienteId, deps);
  const legacy = statOptional(caminhos.legacy, fsImpl);
  const incrementalDir = statOptional(caminhos.incrementalDir, fsImpl);
  if (!legacy) return { ok: false, motivo: "terminal_index_legacy_source_ausente", caminhos };
  if (!incrementalDir) return { ok: false, motivo: "terminal_index_incremental_source_ausente", caminhos };

  let nomes;
  try {
    nomes = nomesJsonl(caminhos.incrementalDir, fsImpl);
  } catch (erro) {
    return { ok: false, motivo: "terminal_index_incremental_source_inacessivel", erro, caminhos };
  }
  const incremental = [];
  for (const nome of nomes) {
    const file = path.resolve(caminhos.incrementalDir, nome);
    if (path.dirname(file) !== caminhos.incrementalDir) {
      return { ok: false, motivo: "terminal_index_incremental_path_inseguro", caminhos };
    }
    const identity = statOptional(file, fsImpl);
    if (!identity) return { ok: false, motivo: "terminal_index_incremental_source_stale", caminhos };
    incremental.push({ name: nome, identity });
  }
  const proof = { legacy, incrementalDir, incremental };
  return {
    ok: true,
    proof,
    sourceRevision: hashConteudo(JSON.stringify(proof)),
    caminhos
  };
}

function sourceProofIgual(esperado = {}, atual = {}) {
  if (!sameIdentity(esperado.legacy, atual.legacy)) return false;
  if (!sameIdentity(esperado.incrementalDir, atual.incrementalDir)) return false;
  const a = Array.isArray(esperado.incremental) ? esperado.incremental : [];
  const b = Array.isArray(atual.incremental) ? atual.incremental : [];
  if (a.length !== b.length) return false;
  for (let indice = 0; indice < a.length; indice += 1) {
    if (a[indice]?.name !== b[indice]?.name || !sameIdentity(a[indice]?.identity, b[indice]?.identity)) return false;
  }
  return true;
}

function cursorsSourceProof(sourceProof = {}) {
  return Array.isArray(sourceProof.incremental)
    ? sourceProof.incremental.map(item => ({
        name: item.name,
        identity: item.identity,
        cursorBytes: Number(item.identity?.size || 0)
      }))
    : [];
}

function lerJsonCompacto(file, fsImpl = fs, maxBytes = DEFAULT_MAX_INDEX_BYTES) {
  const identity = statOptional(file, fsImpl);
  if (!identity) return { ok: false, motivo: "arquivo_ausente" };
  if (Number(identity.size || 0) > maxBytes) return { ok: false, motivo: "arquivo_excede_limite", identity };
  try {
    const raw = fsImpl.readFileSync(file);
    const after = statOptional(file, fsImpl);
    if (!after || !sameIdentity(identity, after)) return { ok: false, motivo: "arquivo_mudou_durante_leitura" };
    return { ok: true, raw, valor: JSON.parse(raw.toString("utf8")), identity: after };
  } catch (erro) {
    return { ok: false, motivo: "arquivo_invalido", erro, identity };
  }
}

function baselineDeltaPronto(clienteId = "admin", deps = {}) {
  let caminhos;
  try {
    caminhos = caminhosTerminalIndex(clienteId, deps);
  } catch {
    return false;
  }
  const indexRead = lerJsonCompacto(caminhos.index, deps.fs || fs);
  const proofRead = lerJsonCompacto(caminhos.proof, deps.fs || fs, 1024 * 1024);
  if (!indexRead.ok || !proofRead.ok) return false;
  const index = indexRead.valor;
  const proof = proofRead.valor;
  return index?.complete === true && proof?.complete === true &&
    index?.maintenanceVersion === TERMINAL_INDEX_MAINTENANCE_VERSION &&
    proof?.maintenanceVersion === TERMINAL_INDEX_MAINTENANCE_VERSION &&
    index?.mode === "shadow" && proof?.mode === "shadow" &&
    index?.authorityEligible === false && proof?.authorityEligible === false &&
    index.revision === proof.revision && Number(index.generation) === Number(proof.generation) &&
    sameIdentity(indexRead.identity, proof.indexIdentity) &&
    hashConteudo(indexRead.raw) === proof.indexSha256 &&
    Array.isArray(proof.sourceCursors);
}

function classificarRecuperacaoTerminalIndex(clienteId = "admin", deps = {}, validacao = null) {
  const atual = validacao || validarTerminalIndex(clienteId, deps);
  const bootstrap = motivo => ({ tipo: "bootstrap_required", motivo });
  if (atual?.motivo !== "terminal_index_source_stale") return bootstrap(atual?.motivo || "validacao_indisponivel");

  const index = atual.index;
  const proof = atual.proof;
  if (!index || !proof || index.complete !== true || proof.complete !== true ||
      index.version !== TERMINAL_INDEX_VERSION || proof.proofVersion !== TERMINAL_INDEX_PROOF_VERSION ||
      index.maintenanceVersion !== TERMINAL_INDEX_MAINTENANCE_VERSION ||
      proof.maintenanceVersion !== TERMINAL_INDEX_MAINTENANCE_VERSION ||
      index.mode !== "shadow" || proof.mode !== "shadow" ||
      index.authorityEligible !== false || proof.authorityEligible !== false ||
      !texto(index.revision) || index.revision !== proof.revision ||
      Number(index.generation) !== Number(proof.generation) ||
      index.sourceRevision !== proof.sourceRevision ||
      !Array.isArray(proof.sourceCursors)) {
    return bootstrap("baseline_index_proof_or_cursor_invalid");
  }

  const sources = capturarSourceProof(clienteId, deps);
  if (!sources.ok) return bootstrap(sources.motivo || "source_unavailable");
  if (!sameIdentity(proof.sources?.legacy, sources.proof.legacy)) return bootstrap("legacy_source_changed");

  const oldDir = proof.sources?.incrementalDir;
  const currentDir = sources.proof.incrementalDir;
  if (!oldDir || !currentDir || oldDir.dev == null || oldDir.ino == null ||
      Number(oldDir.dev) !== Number(currentDir.dev) || Number(oldDir.ino) !== Number(currentDir.ino)) {
    return bootstrap("incremental_directory_replaced");
  }

  const cursors = proof.sourceCursors;
  const oldSources = Array.isArray(proof.sources?.incremental) ? proof.sources.incremental : [];
  if (cursors.length !== oldSources.length || cursors.some((cursor, indexCursor) =>
    cursor?.name !== oldSources[indexCursor]?.name ||
    Number(cursor?.cursorBytes) !== Number(oldSources[indexCursor]?.identity?.size) ||
    !sameIdentity(cursor?.identity, oldSources[indexCursor]?.identity))) {
    return bootstrap("source_cursor_baseline_mismatch");
  }

  const currentByName = new Map(sources.proof.incremental.map(source => [source.name, source.identity]));
  // The existing writer uses appendFileSync for these JSONL segments. Here
  // dev/ino stability plus monotonic byte size is the inexpensive append-only
  // eligibility check; the Worker revalidates source identity before publish.
  for (const cursor of cursors) {
    const identity = cursor?.identity;
    const current = currentByName.get(cursor?.name);
    if (!identity || !current) return bootstrap("incremental_source_removed");
    if (identity.dev == null || identity.ino == null ||
        Number(identity.dev) !== Number(current.dev) || Number(identity.ino) !== Number(current.ino)) {
      return bootstrap("incremental_source_replaced");
    }
    const offset = Number(cursor.cursorBytes);
    const size = Number(current.size);
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(size) || size < offset) {
      return bootstrap("incremental_source_truncated");
    }
    // Same-size metadata changes cannot be proven append-only from stat data.
    if (size === offset && !sameIdentity(identity, current)) return bootstrap("incremental_source_rewritten");
  }

  return {
    tipo: "delta_safe",
    motivo: "append_only_sources",
    baselineSourceRevision: texto(proof.sourceRevision),
    currentSourceRevision: texto(sources.sourceRevision),
    generation: Number(index.generation),
    sourceProof: sources.proof
  };
}

function validarTerminalIndex(clienteId = "admin", deps = {}) {
  const fsImpl = deps.fs || fs;
  const env = deps.env || process.env;
  let caminhos;
  try {
    caminhos = caminhosTerminalIndex(clienteId, deps);
  } catch (erro) {
    return { valido: false, motivo: erro?.message || "terminal_index_path_error" };
  }
  const maxBytesEnv = Number(env.FILA_TERMINAL_INDEX_MAX_BYTES);
  const maxBytes = Number.isFinite(maxBytesEnv) && maxBytesEnv > 0 ? maxBytesEnv : DEFAULT_MAX_INDEX_BYTES;
  const indexRead = lerJsonCompacto(caminhos.index, fsImpl, maxBytes);
  if (!indexRead.ok) return { valido: false, motivo: `terminal_index_${indexRead.motivo}` };
  const proofRead = lerJsonCompacto(caminhos.proof, fsImpl, 1024 * 1024);
  if (!proofRead.ok) return { valido: false, motivo: `terminal_index_proof_${proofRead.motivo}` };

  const index = indexRead.valor;
  const proof = proofRead.valor;
  if (index?.version !== TERMINAL_INDEX_VERSION || proof?.proofVersion !== TERMINAL_INDEX_PROOF_VERSION) {
    return { valido: false, motivo: "terminal_index_version_invalida" };
  }
  if (index?.complete !== true || proof?.complete !== true) {
    return { valido: false, motivo: "terminal_index_incompleto" };
  }
  if (proof?.maintenanceVersion != null && proof.maintenanceVersion !== TERMINAL_INDEX_MAINTENANCE_VERSION) {
    return { valido: false, motivo: "terminal_index_maintenance_version_invalida" };
  }
  if (index?.maintenanceVersion != null && index.maintenanceVersion !== TERMINAL_INDEX_MAINTENANCE_VERSION) {
    return { valido: false, motivo: "terminal_index_maintenance_version_invalida" };
  }
  if (proof?.maintenanceVersion === TERMINAL_INDEX_MAINTENANCE_VERSION) {
    if (index?.maintenanceVersion !== TERMINAL_INDEX_MAINTENANCE_VERSION || !Array.isArray(proof.sourceCursors)) {
      return { valido: false, motivo: "terminal_index_source_cursor_invalido" };
    }
    const fontes = Array.isArray(proof.sources?.incremental) ? proof.sources.incremental : [];
    if (fontes.length !== proof.sourceCursors.length || proof.sourceCursors.some((cursor, indice) =>
      cursor?.name !== fontes[indice]?.name ||
      Number(cursor?.cursorBytes) !== Number(fontes[indice]?.identity?.size || 0) ||
      !sameIdentity(cursor?.identity, fontes[indice]?.identity))) {
      return { valido: false, motivo: "terminal_index_source_cursor_invalido" };
    }
  }
  if (index?.mode !== "shadow" || proof?.mode !== "shadow" || index?.authorityEligible !== false || proof?.authorityEligible !== false) {
    return { valido: false, motivo: "terminal_index_shadow_contract_invalido" };
  }
  if (!texto(index.revision) || index.revision !== proof.revision || Number(index.generation) !== Number(proof.generation)) {
    return { valido: false, motivo: "terminal_index_revision_divergente" };
  }
  if (Number(index.totalTerminais) !== Object.keys(index.entries || {}).length || Number(index.totalTerminais) !== Number(proof.totalTerminais)) {
    return { valido: false, motivo: "terminal_index_total_divergente" };
  }
  if (!sameIdentity(indexRead.identity, proof.indexIdentity)) {
    return { valido: false, motivo: "terminal_index_identity_divergente" };
  }
  if (hashConteudo(indexRead.raw) !== proof.indexSha256) {
    return { valido: false, motivo: "terminal_index_hash_divergente" };
  }

  const sources = capturarSourceProof(clienteId, deps);
  if (!sources.ok) return { valido: false, motivo: sources.motivo };
  if (!sourceProofIgual(proof.sources, sources.proof) || proof.sourceRevision !== sources.sourceRevision || index.sourceRevision !== sources.sourceRevision) {
    return { valido: false, motivo: "terminal_index_source_stale", index, proof, sources: sources.proof, currentSourceRevision: sources.sourceRevision };
  }

  return {
    valido: true,
    motivo: "terminal_index_valido",
    index,
    proof,
    bytes: Number(indexRead.identity.size || 0)
  };
}

function logShadow(logger, payload) {
  try {
    if (typeof logger?.log === "function") logger.log(TAG_TERMINAL_INDEX_SHADOW, JSON.stringify(payload));
  } catch {}
}

function deveLogar(chave, agora, intervaloMs) {
  const ultimo = ultimoLog.get(chave) || 0;
  if (agora - ultimo < intervaloMs) return false;
  ultimoLog.set(chave, agora);
  return true;
}

function obterMetricaComparacao(cliente) {
  if (!metricasComparacao.has(cliente)) {
    metricasComparacao.set(cliente, {
      comparisons: 0,
      indexValid: 0,
      indexInvalid: 0,
      indexHits: 0,
      authorityHits: 0,
      agreements: 0,
      disagreements: 0,
      statusDisagreements: 0,
      stale: 0,
      deltasApplied: 0,
      rebuildsRequested: 0
    });
  }
  return metricasComparacao.get(cliente);
}

function registrarManutencaoTerminalIndex(clienteId, tipo = "") {
  const cliente = texto(clienteId || "admin");
  const metrica = obterMetricaComparacao(cliente);
  if (tipo === "delta_applied") metrica.deltasApplied += 1;
  if (tipo === "rebuild_requested") metrica.rebuildsRequested += 1;
}

function registrarResumoComparacao(cliente, validacao, hit, provadoAtual, concorda, statusConcorda, logger, env, agora) {
  const metrica = obterMetricaComparacao(cliente);
  metrica.comparisons += 1;
  if (validacao.valido) metrica.indexValid += 1;
  else metrica.indexInvalid += 1;
  if (hit) metrica.indexHits += 1;
  if (provadoAtual) metrica.authorityHits += 1;
  if (concorda === true) metrica.agreements += 1;
  if (concorda === false) metrica.disagreements += 1;
  if (statusConcorda === false) metrica.statusDisagreements += 1;
  if (String(validacao.motivo || "").includes("stale")) metrica.stale += 1;

  const configurado = Number(env?.FILA_TERMINAL_INDEX_SHADOW_AGGREGATE_INTERVAL_MS);
  const intervalo = Number.isFinite(configurado) && configurado >= 0 ? configurado : 60 * 1000;
  const ultima = ultimaMetricaEmitida.get(cliente) || 0;
  if (agora - ultima < intervalo) return;
  ultimaMetricaEmitida.set(cliente, agora);
  logShadow(logger || console, {
    versao: 1,
    resumo: true,
    workspaceKey: workspaceHash(cliente),
    ...metrica
  });
  for (const chave of Object.keys(metrica)) metrica[chave] = 0;
}

function revisionBootstrap() {
  return `terminal-${Date.now().toString(36)}-${crypto.randomBytes(4).toString("hex")}`;
}

function logSignal(deps, evento, cliente, extras = {}) {
  if ((evento === "delta_signal_recovery" || evento === "delta_signal_coalesced") &&
      !deveLogar(`${workspaceHash(cliente)}|${evento}`, Date.now(), 5000)) return;
  logShadow(deps.logger || console, {
    versao: 1,
    evento,
    workspaceKey: workspaceHash(cliente),
    ...extras
  });
}

function prometerSinal(callback, payload, deps, cliente, tipo) {
  if (typeof callback !== "function") {
    logSignal(deps, `${tipo}_signal_rejected`, cliente, { motivo: "callback_ausente", attempt: 0 });
    return { promise: Promise.resolve({ ok: false, motivo: "callback_ausente" }), accepted: false };
  }
  let retorno;
  try {
    retorno = callback(payload);
  } catch (erro) {
    logSignal(deps, `${tipo}_signal_rejected`, cliente, {
      motivo: texto(erro?.code || "callback_exception").slice(0, 80),
      attempt: 0
    });
    return { promise: Promise.resolve({ ok: false, motivo: "callback_exception" }), accepted: false };
  }
  const aceitoImediato = retorno?.accepted === true;
  const promise = Promise.resolve(retorno).then(resultado => {
    const aceito = aceitoImediato || resultado?.accepted === true || resultado?.ok === true || resultado?.coalesced === true;
    logSignal(deps, aceito ? (resultado?.coalesced ? `${tipo}_signal_coalesced` : `${tipo}_signal_accepted`) : `${tipo}_signal_rejected`, cliente, {
      motivo: texto(resultado?.motivo || (aceito ? "accepted" : "rejected")).slice(0, 80),
      attempt: Number(resultado?.attempt || 0),
      circuitClass: texto(resultado?.circuitClass || "terminal_index"),
      queueDepth: Number.isFinite(Number(resultado?.queueDepthGlobal)) ? Number(resultado.queueDepthGlobal) : null,
      sourceRevision: texto(resultado?.sourceRevisionHash || "").slice(0, 12)
    });
    return resultado;
  }, erro => {
    logSignal(deps, `${tipo}_signal_rejected`, cliente, {
      motivo: texto(erro?.code || "callback_rejected").slice(0, 80),
      attempt: 0,
      circuitClass: "terminal_index"
    });
    return { ok: false, motivo: "callback_rejected" };
  });
  return { promise, accepted: aceitoImediato };
}

function solicitarDelta(cliente, deps = {}, extras = {}) {
  if (deltaSignalEmAndamento.has(cliente)) {
    logSignal(deps, "delta_signal_coalesced", cliente, { motivo: "signal_in_flight", circuitClass: "terminal_index", ...extras });
    return { agendado: true, coalesced: true, motivo: "delta_sinal_coalescido" };
  }
  const sinal = prometerSinal(deps.agendarTerminalIndexDelta, {
    clienteId: cliente,
    checkpointRevision: revisionBootstrap(),
    targetGeneration: Number(deps.targetGeneration || 0),
    sourceRevision: texto(extras.sourceRevision || "")
  }, deps, cliente, "delta");
  deltaSignalEmAndamento.set(cliente, sinal.promise);
  sinal.promise.finally(() => {
    if (deltaSignalEmAndamento.get(cliente) === sinal.promise) deltaSignalEmAndamento.delete(cliente);
  });
  return { agendado: sinal.accepted, motivo: sinal.accepted ? "delta_aceito" : "delta_solicitado", promise: sinal.promise };
}

function agendarBootstrap(clienteId, deps = {}) {
  const agendar = deps.agendarTerminalIndexBootstrap;
  const cliente = texto(clienteId || "admin");
  if (typeof agendar !== "function") {
    logSignal(deps, "bootstrap_signal_requested", cliente, { motivo: "bootstrap_required", circuitClass: "terminal_index", attempt: 0 });
    logSignal(deps, "bootstrap_signal_rejected", cliente, { motivo: "callback_ausente", circuitClass: "terminal_index", attempt: 0 });
    return { agendado: false, motivo: "bootstrap_callback_ausente" };
  }
  if (bootstrapEmAndamento.has(cliente)) {
    logSignal(deps, "bootstrap_signal_coalesced", cliente, { motivo: "bootstrap_em_andamento", circuitClass: "terminal_index", attempt: 0 });
    return { agendado: false, motivo: "bootstrap_em_andamento" };
  }
  const env = deps.env || process.env;
  const intervaloConfigurado = Number(env.FILA_TERMINAL_INDEX_BOOTSTRAP_INTERVAL_MS);
  const intervalo = Number.isFinite(intervaloConfigurado) && intervaloConfigurado >= 0
    ? intervaloConfigurado
    : DEFAULT_BOOTSTRAP_INTERVAL_MS;
  const agora = Date.now();
  if (agora - (ultimoBootstrap.get(cliente) || 0) < intervalo) {
    logSignal(deps, "bootstrap_signal_coalesced", cliente, { motivo: "bootstrap_throttle_accepted_attempt", circuitClass: "terminal_index", attempt: 0 });
    return { agendado: false, motivo: "bootstrap_throttle" };
  }
  logSignal(deps, "bootstrap_signal_requested", cliente, { motivo: "bootstrap_required", circuitClass: "terminal_index", attempt: 0 });
  definirTerminalIndexBootstrapAtivo(true);
  const sinal = prometerSinal(agendar, {
    clienteId: cliente,
    checkpointRevision: revisionBootstrap(),
    targetGeneration: Number(deps.targetGeneration || 0)
  }, deps, cliente, "bootstrap");
  const promessaExecucao = sinal.promise.then(resultado => {
    const aceito = sinal.accepted || resultado?.accepted === true || resultado?.ok === true || resultado?.coalesced === true;
    if (aceito && !sinal.accepted) {
      ultimoBootstrap.set(cliente, agora);
      registrarManutencaoTerminalIndex(cliente, "rebuild_requested");
      bootstrapAceitoEmAndamento.add(cliente);
      definirTerminalIndexBootstrapAtivo(true);
    }
    return resultado;
  }).finally(() => {
      bootstrapEmAndamento.delete(cliente);
      bootstrapAceitoEmAndamento.delete(cliente);
      definirTerminalIndexBootstrapAtivo(bootstrapAceitoEmAndamento.size > 0);
    });
  bootstrapEmAndamento.set(cliente, promessaExecucao);
  if (sinal.accepted) {
    ultimoBootstrap.set(cliente, agora);
    registrarManutencaoTerminalIndex(cliente, "rebuild_requested");
    bootstrapAceitoEmAndamento.add(cliente);
    definirTerminalIndexBootstrapAtivo(true);
  }
  return { agendado: sinal.accepted, solicitado: true, motivo: sinal.accepted ? "bootstrap_aceito" : "bootstrap_solicitado", promise: promessaExecucao };
}

function avaliarTerminalIndexShadow(clienteId = "admin", itemId = "", autoridade = {}, deps = {}) {
  const env = deps.env || process.env;
  if (!flagAtiva(env)) return { ativo: false, motivo: "terminal_index_shadow_disabled" };
  const cliente = texto(clienteId || "admin");
  const identidade = texto(itemId);
  const validacao = validarTerminalIndex(cliente, deps);
  let manutencao = { agendado: false, motivo: "indice_valido", tipo: "none" };
  if (!validacao.valido) {
    const recuperacao = classificarRecuperacaoTerminalIndex(cliente, deps, validacao);
    if (recuperacao.tipo === "delta_safe") {
      manutencao = { ...solicitarDelta(cliente, deps, { motivo: "source_stale", sourceRevision: recuperacao.currentSourceRevision }), tipo: "delta", recuperacao };
      logSignal(deps, "delta_signal_recovery", cliente, {
        motivo: recuperacao.motivo,
        sourceRevision: recuperacao.currentSourceRevision.slice(0, 12),
        generation: recuperacao.generation,
        circuitClass: "terminal_index"
      });
    } else {
      manutencao = { ...agendarBootstrap(cliente, deps), tipo: "bootstrap", recuperacao };
    }
  }
  const entrada = validacao.valido && identidade && !identidade.startsWith("indice:")
    ? validacao.index.entries?.[identidade]
    : undefined;
  const hit = Array.isArray(entrada);
  const status = hit ? texto(entrada[0]).toLowerCase() : "";
  const provadoAtual = autoridade?.provado === true;
  const concorda = validacao.valido ? hit === provadoAtual : null;
  const statusConcorda = validacao.valido && hit && provadoAtual
    ? status === texto(autoridade.status).toLowerCase()
    : null;
  const agora = Date.now();
  registrarResumoComparacao(cliente, validacao, hit, provadoAtual, concorda, statusConcorda, deps.logger || console, env, agora);
  const logIntervaloConfigurado = Number(env.FILA_TERMINAL_INDEX_SHADOW_LOG_INTERVAL_MS);
  const logIntervalo = Number.isFinite(logIntervaloConfigurado) && logIntervaloConfigurado >= 0
    ? logIntervaloConfigurado
    : DEFAULT_LOG_INTERVAL_MS;
  const chaveLog = `${cliente}|${validacao.motivo}|${hit}|${provadoAtual}|${concorda}|${statusConcorda}`;
  if (deveLogar(chaveLog, agora, logIntervalo)) {
    logShadow(deps.logger || console, {
      versao: 1,
      workspaceKey: workspaceHash(cliente),
      itemKey: identidade ? hashConteudo(identidade).slice(0, 12) : "",
      indiceValido: validacao.valido === true,
      complete: validacao.proof?.complete === true,
      generation: validacao.index?.generation ?? null,
      revisionKey: validacao.index?.revision ? hashConteudo(validacao.index.revision).slice(0, 12) : "",
      hit,
      autoridadeHit: provadoAtual,
      concorda,
      statusConcorda,
      motivo: validacao.motivo,
      bootstrap: manutencao.tipo === "bootstrap" ? manutencao.motivo : "not_selected",
      maintenance: manutencao.tipo,
      maintenanceReason: manutencao.motivo
    });
  }
  return { ativo: true, ...validacao, hit, status, concorda, statusConcorda, bootstrap: manutencao, maintenance: manutencao };
}

function resetarTerminalIndexShadowParaTeste() {
  bootstrapEmAndamento.clear();
  bootstrapAceitoEmAndamento.clear();
  deltaSignalEmAndamento.clear();
  ultimoBootstrap.clear();
  ultimoLog.clear();
  metricasComparacao.clear();
  ultimaMetricaEmitida.clear();
}

module.exports = {
  TERMINAL_INDEX_VERSION,
  TERMINAL_INDEX_PROOF_VERSION,
  TERMINAL_INDEX_MAINTENANCE_VERSION,
  TERMINAL_INDEX_FILE,
  TERMINAL_INDEX_PROOF_FILE,
  TERMINAL_INDEX_INCREMENTAL_DIR,
  TERMINAL_INDEX_LEGACY_FILE,
  TERMINAL_INDEX_SHADOW_FLAG,
  TAG_TERMINAL_INDEX_SHADOW,
  flagAtiva,
  workspaceHash,
  hashConteudo,
  identityFromStat,
  statOptional,
  caminhosTerminalIndex,
  capturarSourceProof,
  sourceProofIgual,
  cursorsSourceProof,
  baselineDeltaPronto,
  classificarRecuperacaoTerminalIndex,
  validarTerminalIndex,
  avaliarTerminalIndexShadow,
  registrarManutencaoTerminalIndex,
  resetarTerminalIndexShadowParaTeste
};
