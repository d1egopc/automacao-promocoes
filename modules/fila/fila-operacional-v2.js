"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const {
  getClienteJsonPath,
  getClientePath,
  readClienteJson,
  writeClienteJson
} = require("../../utils/storage");
const {
  FILA_VIVA_ARQUIVO,
  FILA_LEGADA_ARQUIVO,
  classificarItemFilaV2,
  projetarFilaV2
} = require("./fila-v2-shadow");
const manifestStateRepository = require("./fila-manifest-state.repository");

const FILA_V2_MANIFEST_ARQUIVO = "fila-v2-manifest.json";
const FILA_V2_MANIFEST_VERSION_ATUAL = 2;
const FLAG_OPERACIONAL_ATIVA = "FILA_V2_OPERACIONAL_ATIVA";
const FLAG_ROLLOUT_ATIVO = "FILA_V2_OPERACIONAL_ROLLOUT";
const FLAG_CANARY_CLIENTES = "FILA_V2_OPERACIONAL_CANARY_CLIENTES";
const FLAG_2B1_SHADOW_ATIVA = "FILA_V2_2B1_SHADOW_ATIVA";
const HISTORICO_INCREMENTAL_DIR = "fila-historico-incremental";
const TAG_TELEMETRIA = "[FILA-V2-OPERACIONAL]";
const TAG_MANIFEST = "[FILA-V2-MANIFEST]";
const TAG_CANARY_WRITER = "[FILA-V2-CANARY-WRITE]";
const TAG_2C = "[FILA-V2-2C]";
const TAG_RECOVERY_COMPARACAO = "[FILA-V2-RECOVERY-COMPARACAO]";
const TAG_MANIFEST_STATE = "[FILA-V2-MANIFEST-STATE]";
const FLAG_CHECKPOINT_MUTACOES = "FILA_V2_CHECKPOINT_MUTACOES";
const FLAG_CHECKPOINT_INTERVALO_MS = "FILA_V2_CHECKPOINT_INTERVALO_MS";
const FLAG_CHECKPOINT_MAX_DIRTY_MS = "FILA_V2_CHECKPOINT_MAX_DIRTY_MS";
const DEFAULT_CHECKPOINT_MUTACOES = 25;
const DEFAULT_CHECKPOINT_INTERVALO_MS = 60_000;
const DEFAULT_CHECKPOINT_MAX_DIRTY_MS = 120_000;
const RECOVERY_COMPARACAO_THROTTLE_MS = 5 * 60 * 1000;
const RECOVERY_COMPARACAO_THROTTLE_MAX_ENTRADAS = 2048;
const RECOVERY_COMPARACAO_THROTTLE_TARGET_ENTRADAS = 1536;
const MANIFEST_STATE_THROTTLE_MS = 5 * 60 * 1000;
const MANIFEST_STATE_THROTTLE_MAX_ENTRADAS = 2048;
const MANIFEST_STATE_THROTTLE_TARGET_ENTRADAS = 1536;
const cacheChavesHistorico = new Map();
const recoveryComparacaoLogThrottle = new Map();
const manifestStateLogThrottle = new Map();

function texto(valor = "") {
  return String(valor || "").trim();
}

function clienteSeguro(clienteId = "admin") {
  return texto(clienteId || "admin") || "admin";
}

function agoraIso(agora = Date.now()) {
  const ms = Number(agora || Date.now());
  return new Date(Number.isFinite(ms) ? ms : Date.now()).toISOString();
}

function statusItem(item = {}) {
  return texto(item.status || item.estado || "pendente").toLowerCase();
}

function idItem(item = {}, indice = -1) {
  return texto(
    item.id ||
    item.ofertaId ||
    item.oferta_id ||
    item.engineOfertaId ||
    item.engine_oferta_id ||
    item.idOferta
  ) || `indice:${indice}`;
}

function normalizarEntradaViva(valor = {}, indice = 0, agora = Date.now()) {
  if (valor && typeof valor === "object" && valor.item && typeof valor.item === "object") {
    return {
      posicaoLegada: Number.isInteger(Number(valor.posicaoLegada)) ? Number(valor.posicaoLegada) : indice,
      bucket: valor.bucket || "viva",
      motivoBucket: valor.motivoBucket || "",
      status: valor.status || statusItem(valor.item),
      id: valor.id || idItem(valor.item, indice),
      item: valor.item
    };
  }

  const item = valor && typeof valor === "object" ? valor : {};
  const classificacao = classificarItemFilaV2(item, { agora });
  return {
    posicaoLegada: indice,
    bucket: classificacao.bucket || "viva",
    motivoBucket: classificacao.motivo || "normalizado_operacional",
    status: statusItem(item),
    id: idItem(item, indice),
    item
  };
}

function lista(valor) {
  return Array.isArray(valor) ? valor : [];
}

function modoRollout(valor = "") {
  const modo = texto(valor).toLowerCase();
  if (["legacy", "canary", "global"].includes(modo)) return modo;
  return "legacy";
}

function listaCanaryClientes(valor = "") {
  return [...new Set(
    texto(valor)
      .split(/[\s,;|]+/)
      .map(clienteSeguro)
      .filter(Boolean)
  )];
}

function resolverModoOperacional(env = process.env) {
  return {
    operacionalAtivo: flagAtiva(FLAG_OPERACIONAL_ATIVA, env),
    shadow2B1Ativo: flagAtiva(FLAG_2B1_SHADOW_ATIVA, env),
    rolloutOperacional: modoRollout(env?.[FLAG_ROLLOUT_ATIVO] || ""),
    canaryClientes: listaCanaryClientes(env?.[FLAG_CANARY_CLIENTES] || "")
  };
}

function deveUsarFilaV2Operacional(clienteId = "admin", env = process.env) {
  const modo = resolverModoOperacional(env);
  if (modo.operacionalAtivo) return true;
  if (modo.rolloutOperacional === "global") return true;
  if (modo.rolloutOperacional === "canary") {
    return modo.canaryClientes.includes(clienteSeguro(clienteId));
  }
  return false;
}

function normalizarEntradasViva(valor = [], agora = Date.now()) {
  return lista(valor).map((item, indice) => normalizarEntradaViva(item, indice, agora));
}

function caminhoJsonCliente(clienteId = "admin", arquivo = "", deps = {}) {
  const resolver = deps.getClienteJsonPath || getClienteJsonPath;
  return typeof resolver === "function" ? resolver(clienteSeguro(clienteId), arquivo) : "";
}

function caminhoDirCliente(clienteId = "admin", deps = {}) {
  const resolver = deps.getClientePath || getClientePath;
  if (typeof resolver === "function") return resolver(clienteSeguro(clienteId));
  const filaPath = caminhoJsonCliente(clienteId, FILA_VIVA_ARQUIVO, deps);
  return filaPath ? path.dirname(filaPath) : "";
}

function tamanhoArquivo(file = "", fsImpl = fs) {
  try {
    return file && fsImpl.existsSync(file) ? fsImpl.statSync(file).size : 0;
  } catch {
    return 0;
  }
}

function statArquivoSeguro(file = "", fsImpl = fs) {
  try {
    if (!file || !fsImpl.existsSync(file)) return { existe: false, bytes: 0, mtimeMs: 0 };
    const stat = fsImpl.statSync(file);
    return {
      existe: true,
      bytes: Number(stat.size || 0),
      mtimeMs: Number(stat.mtimeMs || 0)
    };
  } catch {
    return { existe: false, bytes: 0, mtimeMs: 0 };
  }
}

function tamanhoJsonBytes(valor) {
  try {
    return Buffer.byteLength(JSON.stringify(valor), "utf8");
  } catch {
    return 0;
  }
}

function numeroLimite(valor, padrao, minimo, maximo) {
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return padrao;
  return Math.min(maximo, Math.max(minimo, Math.floor(numero)));
}

function politicaCheckpointLegado(env = process.env) {
  return {
    mutacoes: numeroLimite(env?.[FLAG_CHECKPOINT_MUTACOES], DEFAULT_CHECKPOINT_MUTACOES, 1, 1000),
    intervaloMs: numeroLimite(env?.[FLAG_CHECKPOINT_INTERVALO_MS], DEFAULT_CHECKPOINT_INTERVALO_MS, 5_000, 3_600_000),
    maxDirtyMs: numeroLimite(env?.[FLAG_CHECKPOINT_MAX_DIRTY_MS], DEFAULT_CHECKPOINT_MAX_DIRTY_MS, 5_000, 3_600_000)
  };
}

function logOperacional(logger = console, payload = {}) {
  try {
    const destino = logger && typeof logger.log === "function" ? logger : console;
    destino.log(TAG_TELEMETRIA, JSON.stringify(payload));
  } catch {}
}

function log2C(logger = console, payload = {}) {
  try {
    const destino = logger && typeof logger.log === "function" ? logger : console;
    destino.log(TAG_2C, JSON.stringify(payload));
  } catch {}
}

function logManifest(logger = console, payload = {}) {
  try {
    const destino = logger && typeof logger.log === "function" ? logger : console;
    destino.log(TAG_MANIFEST, JSON.stringify(payload));
  } catch {}
}

function logRecoveryComparacao(logger = console, payload = {}) {
  try {
    const destino = logger && typeof logger.log === "function" ? logger : console;
    destino.log(TAG_RECOVERY_COMPARACAO, JSON.stringify(payload));
  } catch {}
}

function logManifestState(logger = console, payload = {}) {
  try {
    const destino = logger && typeof logger.log === "function" ? logger : console;
    destino.log(TAG_MANIFEST_STATE, JSON.stringify(payload));
  } catch {}
}

function hashCurto(valor = "") {
  return crypto.createHash("sha1").update(String(valor || "")).digest("hex").slice(0, 12);
}

function lerJsonArquivoDireto(file = "", fallback = null, fsImpl = fs) {
  if (!file) return { ok: false, motivo: "caminho_indisponivel", valor: fallback, bytes: 0 };
  try {
    if (!fsImpl.existsSync(file)) {
      const tmpExiste = fsImpl.existsSync(`${file}.tmp`);
      return {
        ok: false,
        motivo: tmpExiste ? "arquivo_principal_ausente_tmp_presente" : "arquivo_ausente",
        valor: fallback,
        bytes: 0
      };
    }
    const textoArquivo = fsImpl.readFileSync(file, "utf8");
    const bytes = Buffer.byteLength(textoArquivo || "", "utf8");
    if (!textoArquivo.trim()) {
      return { ok: false, motivo: "arquivo_vazio", valor: fallback, bytes };
    }
    const valor = JSON.parse(textoArquivo);
    const stat = statArquivoSeguro(file, fsImpl);
    return { ok: true, motivo: "ok", valor, bytes, mtimeMs: stat.mtimeMs || 0 };
  } catch (erro) {
    const stat = statArquivoSeguro(file, fsImpl);
    return {
      ok: false,
      motivo: "json_corrompido",
      erro: erro?.message || "erro_json",
      valor: fallback,
      bytes: stat.bytes || tamanhoArquivo(file, fsImpl),
      mtimeMs: stat.mtimeMs || 0
    };
  }
}

function lerFilaLegada(clienteId = "admin", deps = {}) {
  const leitor = deps.readClienteJson || readClienteJson;
  try {
    const valor = typeof leitor === "function"
      ? leitor(clienteSeguro(clienteId), FILA_LEGADA_ARQUIVO, [])
      : [];
    return Array.isArray(valor) ? valor : [];
  } catch {
    return [];
  }
}

function numeroManifesto(valor, padrao = 0) {
  const numero = Number(valor);
  if (!Number.isFinite(numero) || numero < 0) return padrao;
  return Math.floor(numero);
}

function numeroManifestoEstrito(valor) {
  return Number.isInteger(valor) && valor >= 0 ? valor : null;
}

function normalizarManifestoFilaV2(valor = {}, clienteId = "admin", agora = Date.now()) {
  const bruto = valor && typeof valor === "object" ? valor : {};
  const manifestVersion = numeroManifesto(bruto.manifestVersion ?? bruto.version, 1);
  const vivaGeneration = numeroManifesto(bruto.vivaGeneration, 0);
  const temDurableCheckpointGeneration = Object.prototype.hasOwnProperty.call(
    bruto,
    "durableCheckpointGeneration"
  );
  const durableCheckpointGeneration = Math.min(
    vivaGeneration,
    temDurableCheckpointGeneration
      ? numeroManifesto(bruto.durableCheckpointGeneration, 0)
      : 0
  );
  const dirtyGeneration = vivaGeneration > durableCheckpointGeneration
    ? Math.min(
        vivaGeneration,
        Math.max(
          durableCheckpointGeneration + 1,
          numeroManifesto(bruto.dirtyGeneration, durableCheckpointGeneration + 1)
        )
      )
    : null;
  return {
    version: manifestVersion,
    manifestVersion,
    clienteId: clienteSeguro(clienteId),
    vivaGeneration,
    checkpointGeneration: durableCheckpointGeneration,
    durableCheckpointGeneration,
    dirtyGeneration,
    itemCount: numeroManifesto(bruto.itemCount, 0),
    lastMutationAt: texto(bruto.lastMutationAt || ""),
    lastCheckpointAt: texto(bruto.lastCheckpointAt || ""),
    lastDurableCheckpointAt: texto(bruto.lastDurableCheckpointAt || bruto.lastCheckpointAt || ""),
    lastVivaWriteReason: texto(bruto.lastVivaWriteReason || ""),
    lastCheckpointReason: texto(bruto.lastCheckpointReason || ""),
    updatedAt: texto(bruto.updatedAt || agoraIso(agora))
  };
}

function lerManifestoFilaV2(clienteId = "admin", deps = {}) {
  const cliente = clienteSeguro(clienteId);
  const fsImpl = deps.fs || fs;
  const file = caminhoJsonCliente(cliente, FILA_V2_MANIFEST_ARQUIVO, deps);
  const leitura = lerJsonArquivoDireto(file, null, fsImpl);
  if (!leitura.ok) {
    if (!["arquivo_ausente", "arquivo_vazio"].includes(leitura.motivo)) {
      logManifest(deps.logger, {
        evento: "manifest_read_error",
        clienteId: cliente,
        motivo: leitura.motivo,
        erro: leitura.erro || "",
        bytes: leitura.bytes || 0
      });
    }
    return {
      ok: false,
      motivo: leitura.motivo,
      erro: leitura.erro || "",
      manifesto: normalizarManifestoFilaV2({}, cliente, deps.agora || Date.now()),
      bytes: leitura.bytes || 0
    };
  }
  return {
    ok: true,
    motivo: "ok",
    manifesto: normalizarManifestoFilaV2(leitura.valor, cliente, deps.agora || Date.now()),
    bytes: leitura.bytes || 0,
    mtimeMs: leitura.mtimeMs || 0
  };
}

function avaliarRecoveryPeloManifesto(clienteId = "admin", deps = {}) {
  const cliente = clienteSeguro(clienteId);
  const fsImpl = deps.fs || fs;
  const file = caminhoJsonCliente(cliente, FILA_V2_MANIFEST_ARQUIVO, deps);
  const leitura = lerJsonArquivoDireto(file, null, fsImpl);
  if (!leitura.ok) {
    return {
      available: false,
      motivo: leitura.motivo,
      recoveryNeeded: false,
      vivaGeneration: 0,
      checkpointGeneration: 0,
      manifesto: null
    };
  }

  const bruto = leitura.valor && typeof leitura.valor === "object" ? leitura.valor : {};
  const manifestVersion = numeroManifestoEstrito(bruto.manifestVersion ?? bruto.version);
  const vivaGeneration = numeroManifestoEstrito(bruto.vivaGeneration);
  const durableCheckpointGeneration = numeroManifestoEstrito(bruto.durableCheckpointGeneration);
  const valido = manifestVersion !== null &&
    manifestVersion >= FILA_V2_MANIFEST_VERSION_ATUAL &&
    vivaGeneration !== null &&
    durableCheckpointGeneration !== null &&
    durableCheckpointGeneration <= vivaGeneration;

  if (!valido) {
    return {
      available: false,
      motivo: manifestVersion !== null && manifestVersion < FILA_V2_MANIFEST_VERSION_ATUAL
        ? "manifesto_v1_sem_durable"
        : "manifesto_invalido",
      recoveryNeeded: false,
      vivaGeneration: 0,
      checkpointGeneration: 0,
      durableCheckpointGeneration: 0,
      manifesto: null
    };
  }

  return {
    available: true,
    motivo: "ok",
    recoveryNeeded: vivaGeneration > durableCheckpointGeneration,
    vivaGeneration,
    checkpointGeneration: durableCheckpointGeneration,
    durableCheckpointGeneration,
    manifesto: {
      manifestVersion,
      vivaGeneration,
      checkpointGeneration: durableCheckpointGeneration,
      durableCheckpointGeneration,
      dirtyGeneration: bruto.dirtyGeneration === null
        ? null
        : numeroManifestoEstrito(bruto.dirtyGeneration)
    }
  };
}

function classificarComparacaoRecovery(mtimeRecoveryNeeded = false, manifestDecision = {}) {
  if (!manifestDecision.available) return "manifest_indisponivel";
  if (Boolean(mtimeRecoveryNeeded) === Boolean(manifestDecision.recoveryNeeded)) return "equivalente";
  if (manifestDecision.recoveryNeeded && !mtimeRecoveryNeeded) return "manifest_recuperaria_mtime_nao";
  return "mtime_recuperaria_manifest_nao";
}

function podarThrottleRecoveryComparacao(agora = Date.now()) {
  if (recoveryComparacaoLogThrottle.size < RECOVERY_COMPARACAO_THROTTLE_MAX_ENTRADAS) return;
  for (const [chave, timestamp] of recoveryComparacaoLogThrottle.entries()) {
    if (agora - timestamp >= RECOVERY_COMPARACAO_THROTTLE_MS) {
      recoveryComparacaoLogThrottle.delete(chave);
    }
  }
  if (recoveryComparacaoLogThrottle.size < RECOVERY_COMPARACAO_THROTTLE_MAX_ENTRADAS) return;
  const ordenadas = [...recoveryComparacaoLogThrottle.entries()]
    .sort((a, b) => a[1] - b[1]);
  const remover = Math.max(0, recoveryComparacaoLogThrottle.size - RECOVERY_COMPARACAO_THROTTLE_TARGET_ENTRADAS);
  for (let i = 0; i < remover; i += 1) {
    recoveryComparacaoLogThrottle.delete(ordenadas[i][0]);
  }
}

function deveLogarComparacaoRecovery(clienteId = "admin", resultadoComparacao = "", agora = Date.now()) {
  if (resultadoComparacao !== "equivalente" && resultadoComparacao !== "manifest_indisponivel") return true;
  const chave = `${clienteSeguro(clienteId)}|${resultadoComparacao}`;
  const ultimo = recoveryComparacaoLogThrottle.get(chave) || 0;
  if (agora - ultimo < RECOVERY_COMPARACAO_THROTTLE_MS) return false;
  podarThrottleRecoveryComparacao(agora);
  recoveryComparacaoLogThrottle.set(chave, agora);
  return true;
}

function resetarThrottleRecoveryComparacaoParaTeste() {
  recoveryComparacaoLogThrottle.clear();
}

function tamanhoThrottleRecoveryComparacaoParaTeste() {
  return recoveryComparacaoLogThrottle.size;
}

function podarThrottleManifestState(agora = Date.now()) {
  if (manifestStateLogThrottle.size < MANIFEST_STATE_THROTTLE_MAX_ENTRADAS) return;
  for (const [chave, timestamp] of manifestStateLogThrottle.entries()) {
    if (agora - timestamp >= MANIFEST_STATE_THROTTLE_MS) {
      manifestStateLogThrottle.delete(chave);
    }
  }
  if (manifestStateLogThrottle.size < MANIFEST_STATE_THROTTLE_MAX_ENTRADAS) return;
  const ordenadas = [...manifestStateLogThrottle.entries()]
    .sort((a, b) => a[1] - b[1]);
  const remover = Math.max(0, manifestStateLogThrottle.size - MANIFEST_STATE_THROTTLE_TARGET_ENTRADAS);
  for (let i = 0; i < remover; i += 1) {
    manifestStateLogThrottle.delete(ordenadas[i][0]);
  }
}

function deveLogarManifestState(clienteId = "admin", resultado = "", agora = Date.now()) {
  if (resultado !== "db_json_equivalente" && resultado !== "db_indisponivel") return true;
  const chave = `${clienteSeguro(clienteId)}|${resultado}`;
  const ultimo = manifestStateLogThrottle.get(chave) || 0;
  if (agora - ultimo < MANIFEST_STATE_THROTTLE_MS) return false;
  podarThrottleManifestState(agora);
  manifestStateLogThrottle.set(chave, agora);
  return true;
}

function resetarThrottleManifestStateParaTeste() {
  manifestStateLogThrottle.clear();
}

function tamanhoThrottleManifestStateParaTeste() {
  return manifestStateLogThrottle.size;
}

function repositoryManifestState(deps = {}) {
  return deps.manifestStateRepository || manifestStateRepository;
}

function deveUsarManifestStatePostgres(clienteId = "admin", deps = {}) {
  if (deps.manifestStatePostgres === false) return false;
  if (!deveUsarFilaV2Operacional(clienteId, deps.env || process.env)) return false;
  if (deps.manifestStateRepository) return true;
  return Boolean(process.env.DATABASE_URL);
}

function compararDbJsonManifestState(clienteId = "admin", dbResultado = {}, jsonManifest = {}, contexto = {}, deps = {}) {
  const cliente = clienteSeguro(clienteId);
  const repo = repositoryManifestState(deps);
  const dbState = dbResultado?.state || null;
  const comparacao = typeof repo.compararDbJson === "function"
    ? repo.compararDbJson(dbState, jsonManifest)
    : { resultado: dbState ? "db_json_indisponivel" : "db_indisponivel" };
  const resultado = dbResultado?.ok === false
    ? "db_indisponivel"
    : comparacao.resultado;
  const agora = contexto.agora || deps.agora || Date.now();

  if (deveLogarManifestState(cliente, resultado, agora)) {
    logManifestState(deps.logger, {
      versao: 1,
      evento: contexto.evento || "db_json_comparacao",
      clienteId: cliente,
      resultado,
      motivo: contexto.motivo || dbResultado?.motivo || "",
      mtimeRecoveryNeeded: contexto.mtimeRecoveryNeeded,
      dbRevision: dbState?.revision ?? null,
      dbVivaGeneration: dbState?.vivaGeneration ?? null,
      dbDurableCheckpointGeneration: dbState?.durableCheckpointGeneration ?? null,
      dbDirtyGeneration: dbState?.dirtyGeneration ?? null,
      jsonVivaGeneration: jsonManifest?.vivaGeneration ?? null,
      jsonDurableCheckpointGeneration: jsonManifest?.durableCheckpointGeneration ?? null,
      jsonDirtyGeneration: jsonManifest?.dirtyGeneration ?? null
    });
  }

  return { ...comparacao, resultado };
}

function executarManifestStateAsync(clienteId = "admin", operacao = "", payload = {}, deps = {}) {
  const cliente = clienteSeguro(clienteId);
  if (!deveUsarManifestStatePostgres(cliente, deps)) {
    return { ok: true, pulou: true, motivo: "manifest_state_desabilitado" };
  }
  const repo = repositoryManifestState(deps);
  const logger = deps.logger || console;

  Promise.resolve()
    .then(async () => {
      let resultado;
      if (operacao === "checkpoint") {
        resultado = await repo.confirmarCheckpointDuravel(cliente, payload, deps);
      } else if (operacao === "legacy_sync") {
        resultado = await repo.registrarLegacySyncDuravel(cliente, payload, deps);
      } else if (operacao === "read") {
        resultado = await repo.lerStateObservacional(cliente, deps);
      } else {
        resultado = await repo.registrarMutacaoDuravel(cliente, payload, deps);
      }
      compararDbJsonManifestState(cliente, resultado, payload.jsonManifest, {
        evento: payload.evento || `db_${operacao}`,
        motivo: payload.motivo || operacao,
        mtimeRecoveryNeeded: payload.mtimeRecoveryNeeded,
        agora: payload.agora
      }, { ...deps, logger });
    })
    .catch(erro => {
      if (deveLogarManifestState(cliente, "db_indisponivel", deps.agora || Date.now())) {
        logManifestState(logger, {
          versao: 1,
          evento: payload.evento || `db_${operacao}`,
          clienteId: cliente,
          resultado: "db_indisponivel",
          motivo: erro?.message || "manifest_state_async_error"
        });
      }
    });

  return { ok: true, observacional: true, motivo: "manifest_state_agendado" };
}

function mesclarManifestoFilaV2(atual = {}, patch = {}, clienteId = "admin", agora = Date.now()) {
  const base = normalizarManifestoFilaV2(atual, clienteId, agora);
  const temViva = Object.prototype.hasOwnProperty.call(patch, "vivaGeneration");
  const temDurable = Object.prototype.hasOwnProperty.call(patch, "durableCheckpointGeneration") ||
    Object.prototype.hasOwnProperty.call(patch, "checkpointGeneration");
  const vivaGeneration = Math.max(base.vivaGeneration, temViva ? numeroManifesto(patch.vivaGeneration, base.vivaGeneration) : base.vivaGeneration);
  const durableDesejado = temDurable
    ? numeroManifesto(
        patch.durableCheckpointGeneration ?? patch.checkpointGeneration,
        base.durableCheckpointGeneration
      )
    : base.durableCheckpointGeneration;
  const durableCheckpointGeneration = Math.min(vivaGeneration, Math.max(base.durableCheckpointGeneration, durableDesejado));

  let dirtyGeneration = base.dirtyGeneration;
  if (Object.prototype.hasOwnProperty.call(patch, "dirtyGeneration")) {
    if (patch.dirtyGeneration === null) {
      dirtyGeneration = null;
    } else {
      const dirtyPatch = numeroManifesto(patch.dirtyGeneration, vivaGeneration);
      dirtyGeneration = dirtyGeneration === null ? dirtyPatch : Math.min(dirtyGeneration, dirtyPatch);
    }
  }
  if (durableCheckpointGeneration >= vivaGeneration) {
    dirtyGeneration = null;
  } else if (dirtyGeneration === null) {
    dirtyGeneration = Math.max(1, durableCheckpointGeneration + 1);
  } else if (dirtyGeneration <= durableCheckpointGeneration) {
    dirtyGeneration = durableCheckpointGeneration + 1;
  } else if (dirtyGeneration > vivaGeneration) {
    dirtyGeneration = vivaGeneration;
  }

  return {
    version: FILA_V2_MANIFEST_VERSION_ATUAL,
    manifestVersion: FILA_V2_MANIFEST_VERSION_ATUAL,
    clienteId: clienteSeguro(clienteId),
    vivaGeneration,
    checkpointGeneration: durableCheckpointGeneration,
    durableCheckpointGeneration,
    dirtyGeneration,
    itemCount: Object.prototype.hasOwnProperty.call(patch, "itemCount")
      ? numeroManifesto(patch.itemCount, base.itemCount)
      : base.itemCount,
    lastMutationAt: texto(patch.lastMutationAt || base.lastMutationAt || ""),
    lastCheckpointAt: texto(patch.lastCheckpointAt || base.lastCheckpointAt || ""),
    lastDurableCheckpointAt: texto(patch.lastDurableCheckpointAt || base.lastDurableCheckpointAt || ""),
    lastVivaWriteReason: texto(patch.lastVivaWriteReason || base.lastVivaWriteReason || ""),
    lastCheckpointReason: texto(patch.lastCheckpointReason || base.lastCheckpointReason || ""),
    updatedAt: agoraIso(agora)
  };
}

function escreverManifestoFilaV2(clienteId = "admin", patch = {}, deps = {}, evento = "manifest_write") {
  const cliente = clienteSeguro(clienteId);
  const agora = deps.agora || Date.now();
  const leitura = lerManifestoFilaV2(cliente, deps);
  const manifesto = mesclarManifestoFilaV2(leitura.manifesto, patch, cliente, agora);
  const escritor = deps.writeClienteJson || writeClienteJson;
  try {
    const ok = typeof escritor === "function"
      ? escritor(cliente, FILA_V2_MANIFEST_ARQUIVO, manifesto)
      : false;
    if (ok === false) throw new Error("write_retorno_false");
    logManifest(deps.logger, {
      evento,
      clienteId: cliente,
      vivaGeneration: manifesto.vivaGeneration,
      checkpointGeneration: manifesto.checkpointGeneration,
      durableCheckpointGeneration: manifesto.durableCheckpointGeneration,
      dirtyGeneration: manifesto.dirtyGeneration,
      itemCount: manifesto.itemCount,
      motivo: patch.motivo || ""
    });
    return { ok: true, motivo: "manifesto_escrito", manifesto, leitura };
  } catch (erro) {
    logManifest(deps.logger, {
      evento: "manifest_write_error",
      clienteId: cliente,
      vivaGeneration: manifesto.vivaGeneration,
      checkpointGeneration: manifesto.checkpointGeneration,
      durableCheckpointGeneration: manifesto.durableCheckpointGeneration,
      dirtyGeneration: manifesto.dirtyGeneration,
      itemCount: manifesto.itemCount,
      motivo: patch.motivo || "",
      erro: erro?.message || "erro_manifesto"
    });
    return {
      ok: false,
      motivo: "erro_escrita_manifesto",
      erro: erro?.message || "erro_manifesto",
      manifesto,
      leitura
    };
  }
}

function registrarManifestoMutacaoObservacional(clienteId = "admin", dados = {}, deps = {}) {
  const leituraAtual = lerManifestoFilaV2(clienteId, deps);
  const base = leituraAtual.manifesto || normalizarManifestoFilaV2({}, clienteId, deps.agora || Date.now());
  const generation = base.vivaGeneration + 1;
  const checkpointSincronizado = dados.checkpointSincronizado === true;
  const durableCheckpointGeneration = checkpointSincronizado
    ? generation
    : base.durableCheckpointGeneration;
  const patch = {
    vivaGeneration: generation,
    durableCheckpointGeneration,
    checkpointGeneration: durableCheckpointGeneration,
    dirtyGeneration: checkpointSincronizado ? null : Math.min(generation, durableCheckpointGeneration + 1),
    itemCount: dados.itemCount,
    lastMutationAt: agoraIso(deps.agora || Date.now()),
    lastVivaWriteReason: dados.motivo || "mutacao_viva",
    motivo: dados.motivo || "mutacao_viva"
  };
  if (checkpointSincronizado) {
    patch.lastCheckpointAt = patch.lastMutationAt;
    patch.lastDurableCheckpointAt = patch.lastMutationAt;
    patch.lastCheckpointReason = dados.motivo || "mutacao_viva_sincronizada";
  }
  const resultado = escreverManifestoFilaV2(clienteId, patch, deps, "manifest_write");
  if (resultado.ok === true) {
    executarManifestStateAsync(clienteId, checkpointSincronizado ? "legacy_sync" : "mutacao", {
      bootstrapManifest: base,
      checkpointSincronizado,
      itemCount: dados.itemCount,
      motivo: dados.motivo || "mutacao_viva",
      jsonManifest: resultado.manifesto,
      evento: "db_manifest_mutacao",
      agora: deps.agora || Date.now()
    }, deps);
  }
  return resultado;
}

function registrarManifestoCheckpointObservacional(clienteId = "admin", dados = {}, deps = {}) {
  const leituraAtual = lerManifestoFilaV2(clienteId, deps);
  const base = leituraAtual.manifesto || normalizarManifestoFilaV2({}, clienteId, deps.agora || Date.now());
  const generationAlvo = numeroManifesto(
    dados.targetGeneration ??
      dados.vivaGenerationAlvo ??
      dados.durableCheckpointGeneration ??
      dados.checkpointGeneration ??
      dados.generation,
    0
  );
  if (generationAlvo <= 0) {
    return { ok: true, pulou: true, motivo: "checkpoint_generation_indisponivel" };
  }
  const durableCheckpointGeneration = Math.min(
    base.vivaGeneration,
    Math.max(base.durableCheckpointGeneration, generationAlvo)
  );
  const resultado = escreverManifestoFilaV2(clienteId, {
    vivaGeneration: base.vivaGeneration,
    durableCheckpointGeneration,
    checkpointGeneration: durableCheckpointGeneration,
    dirtyGeneration: base.vivaGeneration > durableCheckpointGeneration
      ? durableCheckpointGeneration + 1
      : null,
    itemCount: dados.itemCount,
    lastCheckpointAt: agoraIso(deps.agora || Date.now()),
    lastDurableCheckpointAt: agoraIso(deps.agora || Date.now()),
    lastCheckpointReason: dados.motivo || "checkpoint",
    motivo: dados.motivo || "checkpoint"
  }, deps, "manifest_checkpoint");
  if (resultado.ok === true) {
    executarManifestStateAsync(clienteId, "checkpoint", {
      bootstrapManifest: base,
      targetGeneration: generationAlvo,
      itemCount: dados.itemCount,
      motivo: dados.motivo || "checkpoint",
      jsonManifest: resultado.manifesto,
      evento: "db_manifest_checkpoint",
      agora: deps.agora || Date.now()
    }, deps);
  }
  return resultado;
}

function cloneSet(set = new Set()) {
  return new Set(Array.from(set || []));
}

function resumosEntradasHistorico(clienteId = "admin", entradas = [], agora = Date.now()) {
  const resumo = {
    total: 0,
    ids: new Set(),
    chaves: new Set(),
    status: {},
    vivosEssenciais: 0,
    enviadosRecentes: 0,
    terminais: 0
  };

  for (const entrada of lista(entradas)) {
    const normalizada = normalizarEntradaViva(entrada, entrada?.posicaoLegada || 0, agora);
    const item = normalizada.item || {};
    const classificacao = classificarItemFilaV2(item, { agora });
    const chave = chaveHistorico(clienteId, item, normalizada.posicaoLegada);
    const id = normalizada.id;
    resumo.total += 1;
    resumo.ids.add(id);
    resumo.chaves.add(chave);
    resumo.status[normalizada.status || "desconhecido"] = (resumo.status[normalizada.status || "desconhecido"] || 0) + 1;
    if (classificacao.bucket === "viva") resumo.vivosEssenciais += 1;
    if (classificacao.motivo === "enviado_recente_executor_2h") resumo.enviadosRecentes += 1;
    if (classificacao.bucket === "historico") resumo.terminais += 1;
  }

  return resumo;
}

function chaveHistoricoLegada(clienteId = "admin", item = {}, posicaoLegada = -1) {
  const base = [
    clienteSeguro(clienteId),
    idItem(item, posicaoLegada),
    statusItem(item),
    texto(item.enviadoEm || item.dataEnvio || item.finalizadoEm || item.retidaEm || item.erroEm || item.expiradaEm || ""),
    String(posicaoLegada)
  ].join("|");
  return crypto.createHash("sha1").update(base).digest("hex");
}

function chaveHistoricoAtual(clienteId = "admin", item = {}, posicaoLegada = -1) {
  const base = [
    clienteSeguro(clienteId),
    idItem(item, posicaoLegada),
    statusItem(item),
    texto(item.enviadoEm || item.dataEnvio || item.finalizadoEm || item.retidaEm || item.erroEm || item.expiradaEm || "")
  ].join("|");
  return crypto.createHash("sha1").update(base).digest("hex");
}

function normalizarChave(valor = "") {
  return texto(valor)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function numeroComparavel(valor) {
  if (valor === null || valor === undefined || valor === "") return "";
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero.toFixed(2) : texto(valor);
}

function identidadesItemFilaV2(item = {}) {
  const identidades = [];
  const camposId = [
    item.id,
    item.ofertaId,
    item.oferta_id,
    item.engineOfertaId,
    item.engine_oferta_id,
    item.idOferta
  ];

  for (const valor of camposId) {
    const id = texto(valor);
    if (id) identidades.push(`id:${id}`);
  }

  const produtoId = normalizarChave(item.produtoId || item.produto_id || item.sku || "");
  if (produtoId) identidades.push(`produto:${produtoId}`);

  const linkOriginal = normalizarChave(item.linkOriginal || item.link_original || "");
  const linkAfiliado = normalizarChave(item.linkAfiliado || item.link || item.linkFinal || "");
  if (linkOriginal) identidades.push(`link:${linkOriginal}`);
  if (linkAfiliado) identidades.push(`link:${linkAfiliado}`);

  const titulo = normalizarChave(item.titulo || item.nome || "");
  const preco = numeroComparavel(item.preco || item.precoAtual);
  if (titulo && preco) identidades.push(`titulo_preco:${titulo}|${preco}`);

  return [...new Set(identidades)];
}

function identidadesEntradaFilaV2(entrada = {}) {
  const normalizada = normalizarEntradaViva(entrada, entrada?.posicaoLegada || -1, Date.now());
  return [
    normalizada.id ? `id:${normalizada.id}` : "",
    ...identidadesItemFilaV2(normalizada.item || {})
  ].filter(Boolean);
}

function entradasReferemMesmoItemFilaV2(entrada = {}, item = {}) {
  const identidadesEntrada = new Set(identidadesEntradaFilaV2(entrada));
  const identidadesAlvo = [
    idItem(item, item?.posicaoLegada || -1) ? `id:${idItem(item, item?.posicaoLegada || -1)}` : "",
    ...identidadesItemFilaV2(item)
  ].filter(Boolean);
  return identidadesAlvo.some(chave => identidadesEntrada.has(chave));
}

function itemTerminal(item = {}, agora = Date.now()) {
  return classificarItemFilaV2(item, { agora }).bucket === "historico";
}

function preservarTerminalContraRegressao(atual = {}, candidato = {}, permitirRegressao = false, agora = Date.now()) {
  if (permitirRegressao) return candidato;
  if (itemTerminal(atual, agora) && !itemTerminal(candidato, agora)) return atual;
  return candidato;
}

function identidadePrincipalItemFilaV2(item = {}, indice = -1) {
  return identidadesItemFilaV2(item)[0] || `indice:${indice}`;
}

function rankStatusFilaV2(status = "") {
  const valor = statusItem({ status });
  if (["enviado", "enviada", "finalizado", "concluido", "concluida"].includes(valor)) return 60;
  if (["expirada_operacional", "expirado", "expirada", "cancelada", "descartada"].includes(valor)) return 55;
  if (["enviando", "processando"].includes(valor)) return 45;
  if (["erro", "falha", "retida"].includes(valor)) return 35;
  if (["pendente", "novo", "nova"].includes(valor)) return 20;
  return 10;
}

function escolherItemMaisAvancadoFilaV2(atual = {}, candidato = {}) {
  const rankAtual = rankStatusFilaV2(statusItem(atual));
  const rankCandidato = rankStatusFilaV2(statusItem(candidato));
  if (rankCandidato > rankAtual) return { item: candidato, trocou: true, motivo: "status_mais_avancado" };
  return { item: atual, trocou: false, motivo: "preservar_legado_ou_empate" };
}

function mesclarFilaLegadaComViva(clienteId = "admin", filaLegadaCliente = [], entradasViva = [], opcoes = {}) {
  const cliente = clienteSeguro(clienteId);
  const agora = opcoes.agora || Date.now();
  const filaFinal = [];
  const indicePorIdentidade = new Map();
  let itensInseridos = 0;
  let itensAtualizados = 0;
  let duplicatasEvitadas = 0;
  let statusPreservados = 0;

  for (const item of lista(filaLegadaCliente)) {
    if (clienteSeguro(item?.clienteId || "admin") !== cliente) continue;
    const indice = filaFinal.length;
    filaFinal.push(item);
    for (const identidade of identidadesItemFilaV2(item)) {
      if (!indicePorIdentidade.has(identidade)) indicePorIdentidade.set(identidade, indice);
    }
  }

  for (const entrada of normalizarEntradasViva(entradasViva, agora)) {
    if (entrada.bucket !== "viva") continue;
    const itemViva = entrada.item || {};
    if (clienteSeguro(itemViva?.clienteId || cliente) !== cliente) continue;
    const identidades = identidadesItemFilaV2(itemViva);
    let indiceExistente = -1;
    for (const identidade of identidades) {
      if (indicePorIdentidade.has(identidade)) {
        indiceExistente = indicePorIdentidade.get(identidade);
        break;
      }
    }

    if (indiceExistente >= 0) {
      duplicatasEvitadas += 1;
      const itemLegado = filaFinal[indiceExistente] || {};
      const itemVivaComIndice = {
        ...itemViva,
        posicaoLegada: Number.isInteger(Number(itemLegado.posicaoLegada))
          ? Number(itemLegado.posicaoLegada)
          : indiceExistente
      };
      const escolhido = escolherItemMaisAvancadoFilaV2(itemLegado, itemVivaComIndice);
      if (escolhido.trocou) {
        filaFinal[indiceExistente] = escolhido.item;
        itensAtualizados += 1;
      } else {
        statusPreservados += 1;
      }
      for (const identidade of identidades) {
        if (!indicePorIdentidade.has(identidade)) indicePorIdentidade.set(identidade, indiceExistente);
      }
      continue;
    }

    const indiceNovo = filaFinal.length;
    filaFinal.push({
      ...itemViva,
      posicaoLegada: Number.isInteger(Number(entrada.posicaoLegada)) ? Number(entrada.posicaoLegada) : indiceNovo
    });
    itensInseridos += 1;
    for (const identidade of identidades) indicePorIdentidade.set(identidade, indiceNovo);
    if (!identidades.length) indicePorIdentidade.set(identidadePrincipalItemFilaV2(itemViva, indiceNovo), indiceNovo);
  }

  return {
    ok: true,
    clienteId: cliente,
    filaCliente: filaFinal,
    totalLegado: lista(filaLegadaCliente).length,
    totalViva: normalizarEntradasViva(entradasViva, agora).filter(entrada => entrada.bucket === "viva").length,
    totalFinal: filaFinal.length,
    itensInseridos,
    itensAtualizados,
    duplicatasEvitadas,
    statusPreservados
  };
}

function lerFilaVivaParaMerge(clienteId = "admin", deps = {}) {
  const cliente = clienteSeguro(clienteId);
  const fsImpl = deps.fs || fs;
  const caminhoViva = caminhoJsonCliente(cliente, FILA_VIVA_ARQUIVO, deps);
  const leitura = lerJsonArquivoDireto(caminhoViva, [], fsImpl);
  if (!leitura.ok && !["arquivo_ausente", "arquivo_vazio"].includes(leitura.motivo)) {
    return {
      ok: false,
      motivo: leitura.motivo,
      erro: leitura.erro,
      entradas: [],
      bytes: leitura.bytes || 0,
      mtimeMs: leitura.mtimeMs || 0
    };
  }

  return {
    ok: true,
    motivo: leitura.motivo,
    entradas: normalizarEntradasViva(leitura.valor, deps.agora || Date.now()),
    bytes: leitura.bytes || 0,
    mtimeMs: leitura.mtimeMs || 0
  };
}

function filaVivaMaisNovaQueLegado(clienteId = "admin", deps = {}) {
  const cliente = clienteSeguro(clienteId);
  const fsImpl = deps.fs || fs;
  const agora = deps.agora || Date.now();
  const viva = statArquivoSeguro(caminhoJsonCliente(cliente, FILA_VIVA_ARQUIVO, deps), fsImpl);
  const legado = statArquivoSeguro(caminhoJsonCliente(cliente, FILA_LEGADA_ARQUIVO, deps), fsImpl);
  const maisNova = viva.existe && (!legado.existe || viva.mtimeMs > legado.mtimeMs);
  let manifestDecision = {
    available: false,
    recoveryNeeded: false,
    vivaGeneration: 0,
    checkpointGeneration: 0,
    durableCheckpointGeneration: 0
  };
  let resultadoComparacao = "telemetria_desativada";
  const compararManifesto = deveUsarFilaV2Operacional(cliente, deps.env || process.env);
  if (compararManifesto) {
    manifestDecision = avaliarRecoveryPeloManifesto(cliente, deps);
    resultadoComparacao = classificarComparacaoRecovery(maisNova, manifestDecision);
    executarManifestStateAsync(cliente, "read", {
      jsonManifest: manifestDecision.manifesto,
      evento: "db_manifest_recovery_comparacao",
      motivo: resultadoComparacao,
      mtimeRecoveryNeeded: maisNova,
      agora
    }, deps);
    if (deveLogarComparacaoRecovery(cliente, resultadoComparacao, agora)) {
      logRecoveryComparacao(deps.logger, {
        versao: 1,
        clienteId: cliente,
        mtimeRecoveryNeeded: maisNova,
        manifestRecoveryNeeded: manifestDecision.available ? manifestDecision.recoveryNeeded : false,
        manifestDecisionAvailable: manifestDecision.available,
        resultadoComparacao,
        vivaGeneration: manifestDecision.vivaGeneration || 0,
        checkpointGeneration: manifestDecision.checkpointGeneration || 0,
        durableCheckpointGeneration: manifestDecision.durableCheckpointGeneration || 0,
        mtimeViva: viva.mtimeMs,
        mtimeLegado: legado.mtimeMs
      });
    }
  }
  return {
    ok: true,
    clienteId: cliente,
    vivaExiste: viva.existe,
    legadoExiste: legado.existe,
    vivaMtimeMs: viva.mtimeMs,
    legadoMtimeMs: legado.mtimeMs,
    bytesFilaViva: viva.bytes,
    bytesLegado: legado.bytes,
    maisNova,
    recoveryComparacaoManifesto: {
      manifestDecisionAvailable: manifestDecision.available,
      manifestRecoveryNeeded: manifestDecision.available ? manifestDecision.recoveryNeeded : false,
      resultadoComparacao,
      vivaGeneration: manifestDecision.vivaGeneration || 0,
      checkpointGeneration: manifestDecision.checkpointGeneration || 0,
      durableCheckpointGeneration: manifestDecision.durableCheckpointGeneration || 0
    }
  };
}

function escreverFilaViva(clienteId = "admin", entradas = [], deps = {}) {
  const escritor = deps.writeClienteJson || writeClienteJson;
  if (typeof escritor !== "function") {
    return { ok: false, motivo: "writeClienteJson_indisponivel" };
  }
  const normalizada = normalizarEntradasViva(entradas, deps.agora || Date.now())
    .filter(entrada => entrada.bucket === "viva");
  try {
    const ok = escritor(clienteSeguro(clienteId), FILA_VIVA_ARQUIVO, normalizada);
    return {
      ok: ok !== false,
      motivo: ok === false ? "write_retorno_false" : "fila_viva_escrita",
      totalViva: normalizada.length,
      bytesFilaViva: tamanhoJsonBytes(normalizada)
    };
  } catch (erro) {
    return {
      ok: false,
      motivo: "erro_escrita_fila_viva",
      erro: erro?.message || "erro_escrita"
    };
  }
}

function inserirItemFilaVivaIncremental(clienteId = "admin", item = {}, deps = {}) {
  const inicio = process.hrtime.bigint();
  const cliente = clienteSeguro(clienteId);
  const agora = deps.agora || Date.now();
  const fsImpl = deps.fs || fs;
  const caminhoViva = caminhoJsonCliente(cliente, FILA_VIVA_ARQUIVO, deps);
  const leitura = lerJsonArquivoDireto(caminhoViva, [], fsImpl);

  if (!leitura.ok && !["arquivo_ausente", "arquivo_vazio"].includes(leitura.motivo)) {
    const duracaoMs = Math.round(Number(process.hrtime.bigint() - inicio) / 1e6);
    log2C(deps.logger, {
      versao: 1,
      evento: "insert_viva_incremental",
      clienteId: cliente,
      ok: false,
      fallbackLegado: true,
      motivo: leitura.motivo,
      bytesLidosViva: leitura.bytes || 0,
      insertVivaMs: duracaoMs
    });
    return {
      ok: false,
      motivo: leitura.motivo,
      erro: leitura.erro,
      fallbackLegado: true,
      bytesLidosViva: leitura.bytes || 0,
      insertVivaMs: duracaoMs
    };
  }

  const entradasExistentes = normalizarEntradasViva(leitura.valor, agora)
    .filter(entrada => entrada.bucket === "viva");
  const posicaoLegada = Number.isInteger(Number(deps.posicaoLegada))
    ? Number(deps.posicaoLegada)
    : entradasExistentes.length;
  const entradaNova = normalizarEntradaViva(item, posicaoLegada, agora);

  if (entradaNova.bucket !== "viva") {
    const historico = appendHistoricoIncremental(cliente, entradaNova, { ...deps, agora });
    const duracaoMs = Math.round(Number(process.hrtime.bigint() - inicio) / 1e6);
    log2C(deps.logger, {
      versao: 1,
      evento: "insert_terminal_historico_incremental",
      clienteId: cliente,
      ok: historico.ok === true,
      motivo: historico.motivo,
      bytesHistorico: historico.bytes || 0,
      insertVivaMs: duracaoMs
    });
    return {
      ok: historico.ok === true,
      motivo: historico.motivo,
      entrada: entradaNova,
      item: entradaNova.item,
      terminalHistorico: true,
      bytesHistorico: historico.bytes || 0,
      insertVivaMs: duracaoMs
    };
  }

  const idNovo = entradaNova.id;
  const jaExiste = entradasExistentes.some(entrada => entrada.id === idNovo);
  const entradasAtualizadas = jaExiste
    ? entradasExistentes.map(entrada => entrada.id === idNovo ? entradaNova : entrada)
    : entradasExistentes.concat(entradaNova);
  const escrita = escreverFilaViva(cliente, entradasAtualizadas, { ...deps, agora });
  const duracaoMs = Math.round(Number(process.hrtime.bigint() - inicio) / 1e6);

  if (escrita.ok !== true || deps.logSucesso === true) {
    log2C(deps.logger, {
      versao: 1,
      evento: "insert_viva_incremental",
      clienteId: cliente,
      ok: escrita.ok === true,
      fallbackLegado: escrita.ok !== true,
      idempotente: jaExiste,
      totalViva: escrita.totalViva || entradasAtualizadas.length,
      bytesLidosViva: leitura.bytes || 0,
      bytesFilaViva: escrita.bytesFilaViva || 0,
      insertVivaMs: duracaoMs
    });
  }

  return {
    ok: escrita.ok === true,
    motivo: escrita.motivo,
    entrada: entradaNova,
    item: entradaNova.item,
    idempotente: jaExiste,
    totalViva: escrita.totalViva || entradasAtualizadas.length,
    bytesLidosViva: leitura.bytes || 0,
    bytesFilaViva: escrita.bytesFilaViva || 0,
    insertVivaMs: duracaoMs,
    fallbackLegado: escrita.ok !== true
  };
}

function atualizarItemFilaVivaIncremental(clienteId = "admin", item = {}, deps = {}) {
  const inicio = process.hrtime.bigint();
  const cliente = clienteSeguro(clienteId);
  const agora = deps.agora || Date.now();
  const fsImpl = deps.fs || fs;
  const caminhoViva = caminhoJsonCliente(cliente, FILA_VIVA_ARQUIVO, deps);
  const leitura = lerJsonArquivoDireto(caminhoViva, [], fsImpl);

  if (!leitura.ok && !["arquivo_ausente", "arquivo_vazio"].includes(leitura.motivo)) {
    const duracaoMs = Math.round(Number(process.hrtime.bigint() - inicio) / 1e6);
    log2C(deps.logger, {
      versao: 1,
      evento: "update_viva_incremental",
      clienteId: cliente,
      ok: false,
      fallbackLegado: true,
      motivo: leitura.motivo,
      bytesLidosViva: leitura.bytes || 0,
      updateVivaMs: duracaoMs
    });
    return {
      ok: false,
      motivo: leitura.motivo,
      erro: leitura.erro,
      fallbackLegado: true,
      atualizouViva: false,
      removeuDaViva: false,
      bytesLidosViva: leitura.bytes || 0,
      updateVivaMs: duracaoMs
    };
  }

  const entradasExistentes = normalizarEntradasViva(leitura.valor, agora)
    .filter(entrada => entrada.bucket === "viva");
  const indice = entradasExistentes.findIndex(entrada => entradasReferemMesmoItemFilaV2(entrada, item));
  if (indice < 0) {
    const duracaoMs = Math.round(Number(process.hrtime.bigint() - inicio) / 1e6);
    return {
      ok: true,
      idempotente: true,
      motivo: "item_nao_encontrado_na_viva",
      atualizouViva: false,
      removeuDaViva: false,
      totalViva: entradasExistentes.length,
      bytesLidosViva: leitura.bytes || 0,
      updateVivaMs: duracaoMs
    };
  }

  const entradaAtual = entradasExistentes[indice];
  const posicaoFinal = Number.isInteger(Number(deps.posicaoLegada))
    ? Number(deps.posicaoLegada)
    : entradaAtual.posicaoLegada;
  const itemAtualizado = preservarTerminalContraRegressao(
    entradaAtual.item || {},
    { ...item, posicaoLegada: item.posicaoLegada ?? posicaoFinal },
    deps.permitirRegressaoStatus === true,
    agora
  );
  const classificacao = classificarItemFilaV2(itemAtualizado, { agora });

  if (classificacao.bucket === "historico") {
    const transicao = moverTerminalParaHistorico(cliente, entradasExistentes, {
      ...entradaAtual,
      item: itemAtualizado,
      status: statusItem(itemAtualizado),
      bucket: "historico",
      motivoBucket: classificacao.motivo || "status_terminal"
    }, { ...deps, agora });
    const duracaoMs = Math.round(Number(process.hrtime.bigint() - inicio) / 1e6);
    return {
      ok: transicao.ok === true,
      motivo: transicao.motivo,
      atualizouViva: false,
      removeuDaViva: transicao.removeuDaViva === true,
      totalViva: transicao.filaViva?.length ?? entradasExistentes.length,
      bytesLidosViva: leitura.bytes || 0,
      bytesFilaViva: transicao.escrita?.bytesFilaViva || 0,
      updateVivaMs: duracaoMs,
      fallbackLegado: transicao.ok !== true,
      historico: transicao.historico
    };
  }

  const entradaAtualizada = normalizarEntradaViva({
    ...entradaAtual,
    posicaoLegada: posicaoFinal,
    bucket: "viva",
    motivoBucket: classificacao.motivo || entradaAtual.motivoBucket || "",
    status: statusItem(itemAtualizado),
    item: itemAtualizado
  }, posicaoFinal, agora);
  const entradasAtualizadas = entradasExistentes.map((entrada, i) => i === indice ? entradaAtualizada : entrada);
  const escrita = escreverFilaViva(cliente, entradasAtualizadas, { ...deps, agora });
  const duracaoMs = Math.round(Number(process.hrtime.bigint() - inicio) / 1e6);

  if (escrita.ok !== true || deps.logSucesso === true) {
    log2C(deps.logger, {
      versao: 1,
      evento: "update_viva_incremental",
      clienteId: cliente,
      ok: escrita.ok === true,
      fallbackLegado: escrita.ok !== true,
      status: entradaAtualizada.status,
      totalViva: escrita.totalViva || entradasAtualizadas.length,
      bytesLidosViva: leitura.bytes || 0,
      bytesFilaViva: escrita.bytesFilaViva || 0,
      updateVivaMs: duracaoMs
    });
  }

  return {
    ok: escrita.ok === true,
    motivo: escrita.motivo,
    entrada: entradaAtualizada,
    item: entradaAtualizada.item,
    atualizouViva: escrita.ok === true,
    removeuDaViva: false,
    totalViva: escrita.totalViva || entradasAtualizadas.length,
    bytesLidosViva: leitura.bytes || 0,
    bytesFilaViva: escrita.bytesFilaViva || 0,
    updateVivaMs: duracaoMs,
    fallbackLegado: escrita.ok !== true
  };
}

function removerItemFilaVivaIncremental(clienteId = "admin", item = {}, deps = {}) {
  const inicio = process.hrtime.bigint();
  const cliente = clienteSeguro(clienteId);
  const agora = deps.agora || Date.now();
  const fsImpl = deps.fs || fs;
  const caminhoViva = caminhoJsonCliente(cliente, FILA_VIVA_ARQUIVO, deps);
  const leitura = lerJsonArquivoDireto(caminhoViva, [], fsImpl);

  if (!leitura.ok && !["arquivo_ausente", "arquivo_vazio"].includes(leitura.motivo)) {
    const duracaoMs = Math.round(Number(process.hrtime.bigint() - inicio) / 1e6);
    log2C(deps.logger, {
      versao: 1,
      evento: "removal_viva_incremental",
      clienteId: cliente,
      ok: false,
      fallbackLegado: true,
      motivo: leitura.motivo,
      bytesLidosViva: leitura.bytes || 0,
      removalVivaMs: duracaoMs
    });
    return {
      ok: false,
      motivo: leitura.motivo,
      erro: leitura.erro,
      fallbackLegado: true,
      removeuDaViva: false,
      bytesLidosViva: leitura.bytes || 0,
      removalVivaMs: duracaoMs
    };
  }

  const entradasExistentes = normalizarEntradasViva(leitura.valor, agora)
    .filter(entrada => entrada.bucket === "viva");
  const entradasAtualizadas = entradasExistentes.filter(entrada => !entradasReferemMesmoItemFilaV2(entrada, item));
  const removeu = entradasAtualizadas.length !== entradasExistentes.length;

  if (!removeu) {
    const duracaoMs = Math.round(Number(process.hrtime.bigint() - inicio) / 1e6);
    return {
      ok: true,
      idempotente: true,
      motivo: "item_ausente_na_viva",
      removeuDaViva: false,
      totalViva: entradasExistentes.length,
      bytesLidosViva: leitura.bytes || 0,
      removalVivaMs: duracaoMs
    };
  }

  const escrita = escreverFilaViva(cliente, entradasAtualizadas, { ...deps, agora });
  const duracaoMs = Math.round(Number(process.hrtime.bigint() - inicio) / 1e6);

  if (escrita.ok !== true || deps.logSucesso === true) {
    log2C(deps.logger, {
      versao: 1,
      evento: "removal_viva_incremental",
      clienteId: cliente,
      ok: escrita.ok === true,
      fallbackLegado: escrita.ok !== true,
      totalVivaAntes: entradasExistentes.length,
      totalVivaDepois: escrita.totalViva || entradasAtualizadas.length,
      bytesLidosViva: leitura.bytes || 0,
      bytesFilaViva: escrita.bytesFilaViva || 0,
      removalVivaMs: duracaoMs
    });
  }

  return {
    ok: escrita.ok === true,
    motivo: escrita.motivo,
    removeuDaViva: escrita.ok === true,
    totalViva: escrita.totalViva || entradasAtualizadas.length,
    bytesLidosViva: leitura.bytes || 0,
    bytesFilaViva: escrita.bytesFilaViva || 0,
    removalVivaMs: duracaoMs,
    fallbackLegado: escrita.ok !== true
  };
}

function recuperarFilaVivaDoLegado(clienteId = "admin", deps = {}) {
  const inicio = process.hrtime.bigint();
  const cliente = clienteSeguro(clienteId);
  const filaLegada = Array.isArray(deps.filaLegada)
    ? deps.filaLegada.filter(item => clienteSeguro(item?.clienteId || "admin") === cliente)
    : lerFilaLegada(cliente, deps);
  const projecao = projetarFilaV2(filaLegada, { agora: deps.agora || Date.now() });
  const escrita = escreverFilaViva(cliente, projecao.viva, deps);
  const duracaoMs = Math.round(Number(process.hrtime.bigint() - inicio) / 1e6);

  logOperacional(deps.logger, {
    versao: 1,
    evento: "recovery_viva",
    clienteId: cliente,
    ok: escrita.ok === true,
    fonte: "fila_json_legado",
    motivo: escrita.motivo,
    totalLegado: projecao.totalLegado,
    totalViva: projecao.totalViva,
    totalHistorico: projecao.totalHistorico,
    divergencias: projecao.comparacao?.divergencias || 0,
    bytesFilaViva: escrita.bytesFilaViva || 0,
    duracaoMs
  });

  return {
    ok: escrita.ok === true,
    fonte: "fila_json_legado",
    motivo: escrita.motivo,
    recovery: true,
    entradas: projecao.viva,
    itens: projecao.viva.map(entrada => entrada.item),
    projecao,
    escrita
  };
}

function mapaPorId(entradas = []) {
  const mapa = new Map();
  for (const entrada of lista(entradas)) {
    const normalizada = normalizarEntradaViva(entrada, entrada?.posicaoLegada || 0, Date.now());
    const chave = normalizada.id;
    if (!mapa.has(chave)) {
      mapa.set(chave, normalizada);
    }
  }
  return mapa;
}

function compararVivaComLegadoInterno(clienteId = "admin", entradasViva = [], filaLegada = [], deps = {}) {
  const cliente = clienteSeguro(clienteId);
  const legadoCliente = lista(filaLegada).filter(item => clienteSeguro(item?.clienteId || "admin") === cliente);
  const projecao = projetarFilaV2(legadoCliente, { agora: deps.agora || Date.now() });
  const vivaNormalizada = normalizarEntradasViva(entradasViva, deps.agora || Date.now());
  const idsEsperados = projecao.viva.map(entrada => entrada.id);
  const idsViva = vivaNormalizada.map(entrada => entrada.id);
  const mapaEsperado = mapaPorId(projecao.viva);
  const mapaAtual = mapaPorId(vivaNormalizada);
  const idsAusentes = [];
  const idsExtras = [];
  const statusDivergentes = [];
  const idsDuplicados = [];
  const idsRecentesAusentes = [];

  const contagemViva = new Map();
  for (const id of idsViva) {
    contagemViva.set(id, (contagemViva.get(id) || 0) + 1);
  }
  for (const [id, quantidade] of contagemViva.entries()) {
    if (quantidade > 1) idsDuplicados.push(id);
  }

  for (const id of idsEsperados) {
    const esperado = mapaEsperado.get(id);
    const atual = mapaAtual.get(id);
    if (!atual) {
      idsAusentes.push(id);
      if (esperado && esperado.bucket === "viva" && esperado.motivoBucket === "enviado_recente_executor_2h") {
        idsRecentesAusentes.push(id);
      }
      continue;
    }
    if (statusItem(esperado.item) !== statusItem(atual.item) || esperado.bucket !== atual.bucket) {
      statusDivergentes.push(id);
    }
    if ((esperado.motivoBucket || "") !== (atual.motivoBucket || "")) {
      statusDivergentes.push(id);
    }
  }

  for (const id of idsViva) {
    if (!mapaEsperado.has(id)) idsExtras.push(id);
  }

  const amostrarDivergencias = (ids = [], mapa = new Map(), limite = 5) => ids.slice(0, limite).map(id => {
    const entrada = mapa.get(id) || {};
    return {
      id,
      status: entrada.status || statusItem(entrada.item || {}),
      posicaoLegada: Number.isInteger(Number(entrada.posicaoLegada)) ? Number(entrada.posicaoLegada) : null,
      bucket: entrada.bucket || "",
      motivoBucket: entrada.motivoBucket || ""
    };
  });

  const divergencias =
    idsAusentes.length +
    idsExtras.length +
    statusDivergentes.length +
    idsDuplicados.length +
    idsRecentesAusentes.length;

  return {
    ok: divergencias === 0,
    totalLegado: legadoCliente.length,
    totalVivaEsperado: idsEsperados.length,
    totalVivaAtual: idsViva.length,
    idsAusentes: idsAusentes.slice(0, 20),
    idsExtras: idsExtras.slice(0, 20),
    statusDivergentes: Array.from(new Set(statusDivergentes)).slice(0, 20),
    idsDuplicados: idsDuplicados.slice(0, 20),
    idsRecentesAusentes: idsRecentesAusentes.slice(0, 20),
    amostraExtrasNaViva: amostrarDivergencias(idsExtras, mapaAtual),
    amostraAusentesNaViva: amostrarDivergencias(idsAusentes, mapaEsperado),
    amostraDuplicadosNaViva: amostrarDivergencias(idsDuplicados, mapaAtual),
    divergencias
  };
}

function lerFilaViva(clienteId = "admin", deps = {}) {
  const inicio = process.hrtime.bigint();
  const cliente = clienteSeguro(clienteId);
  const fsImpl = deps.fs || fs;
  const file = caminhoJsonCliente(cliente, FILA_VIVA_ARQUIVO, deps);
  const leitura = lerJsonArquivoDireto(file, null, fsImpl);
  const permitirRecovery = deps.permitirRecovery !== false;

  if (leitura.ok && Array.isArray(leitura.valor)) {
    const entradas = normalizarEntradasViva(leitura.valor, deps.agora || Date.now())
      .filter(entrada => entrada.bucket === "viva");
    const legado = deps.filaLegada || lerFilaLegada(cliente, deps);
    const comparacao = compararVivaComLegado(cliente, entradas, legado, deps);
    if (!comparacao.ok) {
      const duracaoMs = Math.round(Number(process.hrtime.bigint() - inicio) / 1e6);
      if (!permitirRecovery) {
        logOperacional(deps.logger, {
          versao: 1,
          evento: "divergencia_viva_legado",
          clienteId: cliente,
          ok: false,
          totalLegado: comparacao.totalLegado,
          totalViva: comparacao.totalVivaAtual,
          divergencias: comparacao.divergencias,
          idsRecentesAusentes: comparacao.idsRecentesAusentes.length,
          idsDuplicados: comparacao.idsDuplicados.length,
          idsExtras: comparacao.idsExtras.length,
          idsAusentes: comparacao.idsAusentes.length,
          extrasNaViva: comparacao.idsExtras.length,
          ausentesNaViva: comparacao.idsAusentes.length,
          duplicadosNaViva: comparacao.idsDuplicados.length,
          amostraExtrasNaViva: comparacao.amostraExtrasNaViva,
          amostraAusentesNaViva: comparacao.amostraAusentesNaViva,
          amostraDuplicadosNaViva: comparacao.amostraDuplicadosNaViva,
          recoveryBloqueado: true,
          duracaoMs
        });
        return {
          ok: false,
          fonte: "fila_viva",
          recovery: false,
          recuperacaoBloqueada: true,
          sideEffectBlocked: true,
          fallbackLegado: true,
          motivoFallback: "viva_divergente_legado",
          entradas,
          itens: entradas.map(entrada => entrada.item),
          bytes: leitura.bytes || 0,
          comparacao
        };
      }
      const recovery = recuperarFilaVivaDoLegado(cliente, {
        ...deps,
        motivoRecovery: "viva_divergente_legado",
        logger: deps.logger
      });
      logOperacional(deps.logger, {
        versao: 1,
        evento: "divergencia_viva_legado",
        clienteId: cliente,
        ok: false,
        totalLegado: comparacao.totalLegado,
        totalViva: comparacao.totalVivaAtual,
        divergencias: comparacao.divergencias,
        idsRecentesAusentes: comparacao.idsRecentesAusentes.length,
        idsDuplicados: comparacao.idsDuplicados.length,
        idsExtras: comparacao.idsExtras.length,
        idsAusentes: comparacao.idsAusentes.length,
        extrasNaViva: comparacao.idsExtras.length,
        ausentesNaViva: comparacao.idsAusentes.length,
        duplicadosNaViva: comparacao.idsDuplicados.length,
        amostraExtrasNaViva: comparacao.amostraExtrasNaViva,
        amostraAusentesNaViva: comparacao.amostraAusentesNaViva,
        amostraDuplicadosNaViva: comparacao.amostraDuplicadosNaViva,
        duracaoMs
      });
      return {
        ...recovery,
        fallbackLegado: true,
        motivoFallback: "viva_divergente_legado",
        comparacao
      };
    }
    const duracaoMs = Math.round(Number(process.hrtime.bigint() - inicio) / 1e6);
    logOperacional(deps.logger, {
      versao: 1,
      evento: "read_fila_viva",
      clienteId: cliente,
      ok: true,
      fonte: "fila_viva",
      totalViva: entradas.length,
      bytesFilaViva: leitura.bytes || 0,
      fallbackLegado: false,
      divergencias: 0,
      duracaoMs
    });
    return {
      ok: true,
      fonte: "fila_viva",
      recovery: false,
      entradas,
      itens: entradas.map(entrada => entrada.item),
      bytes: leitura.bytes || 0,
      comparacao
    };
  }

  if (!permitirRecovery) {
    const duracaoMs = Math.round(Number(process.hrtime.bigint() - inicio) / 1e6);
    logOperacional(deps.logger, {
      versao: 1,
      evento: "read_fila_viva_indisponivel",
      clienteId: cliente,
      ok: false,
      fonte: "fila_viva",
      motivo: leitura.motivo,
      recoveryBloqueado: true,
      bytesFilaViva: leitura.bytes || 0,
      duracaoMs
    });
    return {
      ok: false,
      fonte: "fila_viva",
      recovery: false,
      recuperacaoBloqueada: true,
      sideEffectBlocked: true,
      fallbackLegado: true,
      motivoFallback: leitura.motivo,
      erroFallback: leitura.erro || "",
      entradas: [],
      itens: [],
      bytes: leitura.bytes || 0
    };
  }

  const recovery = recuperarFilaVivaDoLegado(cliente, {
    ...deps,
    motivoRecovery: leitura.motivo,
    logger: deps.logger
  });
  return {
    ...recovery,
    fallbackLegado: true,
    motivoFallback: leitura.motivo,
    erroFallback: leitura.erro || ""
  };
}

function lerFilaVivaReadOnly(clienteId = "admin", deps = {}) {
  return lerFilaViva(clienteId, { ...deps, permitirRecovery: false });
}

function dataSegmentoHistorico(item = {}, agora = Date.now()) {
  const candidatos = [
    item.enviadoEm,
    item.dataEnvio,
    item.finalizadoEm,
    item.retidaEm,
    item.erroEm,
    item.expiradaEm,
    item.atualizadoEm,
    item.updatedAt
  ];
  for (const valor of candidatos) {
    const ms = Date.parse(valor);
    if (Number.isFinite(ms)) return new Date(ms).toISOString().slice(0, 10);
  }
  return agoraIso(agora).slice(0, 10);
}

function chaveHistorico(clienteId = "admin", item = {}, posicaoLegada = -1) {
  const base = [
    clienteSeguro(clienteId),
    idItem(item, posicaoLegada),
    statusItem(item),
    texto(item.enviadoEm || item.dataEnvio || item.finalizadoEm || item.retidaEm || item.erroEm || item.expiradaEm || "")
  ].join("|");
  return crypto.createHash("sha1").update(base).digest("hex");
}

function caminhoSegmentoHistorico(clienteId = "admin", item = {}, deps = {}) {
  const dirCliente = caminhoDirCliente(clienteId, deps);
  if (!dirCliente) return "";
  const dir = path.join(dirCliente, HISTORICO_INCREMENTAL_DIR);
  const data = dataSegmentoHistorico(item, deps.agora || Date.now());
  return path.join(dir, `${data}.jsonl`);
}

function chaveCacheHistorico(file = "") {
  return texto(file);
}

function limparCacheHistorico() {
  cacheChavesHistorico.clear();
  return true;
}

function invalidaCacheHistorico(file = "") {
  const chave = chaveCacheHistorico(file);
  if (chave) cacheChavesHistorico.delete(chave);
}

function lerCacheHistorico(file = "", fsImpl = fs, logger = console, clienteId = "admin") {
  const chaveArquivo = chaveCacheHistorico(file);
  if (!chaveArquivo) {
    return {
      chaves: new Set(),
      bytes: 0,
      linhas: 0,
      cacheHit: false,
      motivo: "caminho_indisponivel"
    };
  }

  let stat = null;
  try {
    stat = fsImpl.existsSync(file) ? fsImpl.statSync(file) : null;
  } catch {
    stat = null;
  }

  const cached = cacheChavesHistorico.get(chaveArquivo);
  if (cached && stat && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) {
    logOperacional(logger, {
      versao: 1,
      evento: "cache_hit_dedupe",
      clienteId: clienteSeguro(clienteId),
      fileHash: hashCurto(file),
      linhas: cached.linhas || 0,
      bytes: cached.bytes || 0
    });
    return {
      chaves: cloneSet(cached.chaves),
      bytes: cached.bytes || 0,
      linhas: cached.linhas || 0,
      cacheHit: true,
      motivo: "cache_hit"
    };
  }

  const chaves = new Set();
  let bytes = 0;
  let linhas = 0;
  try {
    if (file && fsImpl.existsSync(file)) {
      const conteudo = fsImpl.readFileSync(file, "utf8");
      bytes = Buffer.byteLength(conteudo || "", "utf8");
      const partes = (conteudo || "").split(/\r?\n/);
      for (const linha of partes) {
        if (!linha.trim()) continue;
        try {
          const registro = JSON.parse(linha);
          const clienteRegistro = texto(registro?.clienteId || clienteId);
          const itemRegistro = registro?.item && typeof registro.item === "object" ? registro.item : {};
          const posicaoRegistro = Number.isInteger(Number(registro?.posicaoLegada))
            ? Number(registro.posicaoLegada)
            : -1;
          const chaveAtual = texto(registro?.chave) || chaveHistoricoAtual(clienteRegistro, itemRegistro, posicaoRegistro);
          const chaveLegada = texto(registro?.chaveLegada) || chaveHistoricoLegada(clienteRegistro, itemRegistro, posicaoRegistro);
          if (chaveAtual) chaves.add(chaveAtual);
          if (chaveLegada) chaves.add(chaveLegada);
          linhas += 1;
        } catch {}
      }
    }
  } catch {}

  const snapshot = {
    chaves,
    bytes,
    linhas,
    mtimeMs: stat ? Number(stat.mtimeMs || 0) : 0,
    size: stat ? Number(stat.size || 0) : 0
  };
  cacheChavesHistorico.set(chaveArquivo, snapshot);
  logOperacional(logger, {
    versao: 1,
    evento: "cache_miss_dedupe",
    clienteId: clienteSeguro(clienteId),
    fileHash: hashCurto(file),
    linhas: snapshot.linhas,
    bytes: snapshot.bytes
  });
  return {
    chaves: cloneSet(snapshot.chaves),
    bytes: snapshot.bytes,
    linhas: snapshot.linhas,
    cacheHit: false,
    motivo: "cache_miss"
  };
}

function appendHistoricoIncremental(clienteId = "admin", entradaOuItem = {}, deps = {}) {
  const inicio = process.hrtime.bigint();
  const cliente = clienteSeguro(clienteId);
  const fsImpl = deps.fs || fs;
  const entrada = normalizarEntradaViva(entradaOuItem, entradaOuItem?.posicaoLegada || 0, deps.agora || Date.now());
  const item = entrada.item || {};
  const file = caminhoSegmentoHistorico(cliente, item, deps);
  const chave = chaveHistorico(cliente, item, entrada.posicaoLegada);
  const chaveLegada = chaveHistoricoLegada(cliente, item, entrada.posicaoLegada);
  let leituraCache = {
    chaves: new Set(),
    bytes: 0,
    linhas: 0,
    cacheHit: false,
    motivo: "nao_carregado"
  };

  if (!file) {
    return { ok: false, motivo: "caminho_historico_indisponivel", chave };
  }

  try {
    fsImpl.mkdirSync(path.dirname(file), { recursive: true });
    leituraCache = lerCacheHistorico(file, fsImpl, deps.logger, cliente);
    const existentes = leituraCache.chaves;
    if (existentes.has(chave) || existentes.has(chaveLegada)) {
      const duracaoMs = Math.round(Number(process.hrtime.bigint() - inicio) / 1e6);
      logOperacional(deps.logger, {
        versao: 1,
        evento: "historico_append",
        clienteId: cliente,
        ok: true,
        idempotente: true,
        cacheHit: leituraCache.cacheHit === true,
        status: entrada.status || statusItem(item),
        bytesAppend: 0,
        duracaoMs
      });
      logOperacional(deps.logger, {
        versao: 1,
        evento: "append_idempotente_ignorado",
        clienteId: cliente,
        cacheHit: leituraCache.cacheHit === true,
        status: entrada.status || statusItem(item),
        fileHash: hashCurto(file),
        duracaoMs
      });
      return { ok: true, idempotente: true, motivo: "historico_ja_registrado", chave, chaveLegada, file };
    }

    const registro = {
      versao: 1,
      chave,
      chaveLegada,
      clienteId: cliente,
      id: entrada.id || idItem(item, entrada.posicaoLegada),
      status: entrada.status || statusItem(item),
      posicaoLegada: entrada.posicaoLegada,
      motivoBucket: entrada.motivoBucket || "",
      registradoEm: agoraIso(deps.agora || Date.now()),
      item
    };
    const linha = `${JSON.stringify(registro)}\n`;
    fsImpl.appendFileSync(file, linha, "utf8");
    try {
      const stat = fsImpl.existsSync(file) ? fsImpl.statSync(file) : null;
      cacheChavesHistorico.set(chaveCacheHistorico(file), {
        chaves: new Set([...existentes, chave, chaveLegada]),
        bytes: (stat ? stat.size : (leituraCache.bytes || 0)) + Buffer.byteLength(linha, "utf8"),
        linhas: (leituraCache.linhas || 0) + 1,
        mtimeMs: stat ? Number(stat.mtimeMs || 0) : 0,
        size: stat ? Number(stat.size || 0) : 0
      });
    } catch {}
    const duracaoMs = Math.round(Number(process.hrtime.bigint() - inicio) / 1e6);
    logOperacional(deps.logger, {
      versao: 1,
      evento: "historico_append",
      clienteId: cliente,
      ok: true,
      idempotente: false,
      cacheHit: leituraCache.cacheHit === true,
      status: registro.status,
      bytesAppend: Buffer.byteLength(linha, "utf8"),
      duracaoMs
    });
    return {
      ok: true,
      idempotente: false,
      motivo: "historico_append_ok",
      chave,
      chaveLegada,
      file,
      bytesAppend: Buffer.byteLength(linha, "utf8")
    };
  } catch (erro) {
    const duracaoMs = Math.round(Number(process.hrtime.bigint() - inicio) / 1e6);
    logOperacional(deps.logger, {
      versao: 1,
      evento: "historico_append",
      clienteId: cliente,
      ok: false,
      cacheHit: leituraCache.cacheHit === true,
      status: entrada.status || statusItem(item),
      erro: erro?.message || "erro_append_historico",
      duracaoMs
    });
    return {
      ok: false,
      motivo: "erro_append_historico",
      erro: erro?.message || "erro_append",
      chave,
      chaveLegada,
      file
    };
  }
}

function itemTerminalParaHistorico(item = {}, agora = Date.now()) {
  const classificacao = classificarItemFilaV2(item, { agora });
  return classificacao.bucket === "historico";
}

function moverTerminalParaHistorico(clienteId = "admin", filaViva = [], alvo = {}, deps = {}) {
  const inicio = process.hrtime.bigint();
  const cliente = clienteSeguro(clienteId);
  const entradas = normalizarEntradasViva(filaViva, deps.agora || Date.now());
  const alvoId = idItem(alvo?.item || alvo, alvo?.posicaoLegada || -1);
  const entradaEncontrada = entradas.find(item => item.id === alvoId);
  const entrada = entradaEncontrada
    ? {
        ...entradaEncontrada,
        item: alvo?.item || alvo || entradaEncontrada.item,
        status: statusItem(alvo?.item || alvo || entradaEncontrada.item),
        bucket: alvo?.bucket || entradaEncontrada.bucket,
        motivoBucket: alvo?.motivoBucket || entradaEncontrada.motivoBucket
      }
    :
    normalizarEntradaViva(alvo?.item ? alvo : { item: alvo, posicaoLegada: alvo?.posicaoLegada }, alvo?.posicaoLegada || -1, deps.agora || Date.now());

  if (!itemTerminalParaHistorico(entrada.item, deps.agora || Date.now())) {
    return { ok: false, motivo: "item_nao_terminal", removeuDaViva: false };
  }

  const historico = appendHistoricoIncremental(cliente, entrada, deps);
  if (!historico.ok) {
    logOperacional(deps.logger, {
      versao: 1,
      evento: "transicao_terminal",
      clienteId: cliente,
      ok: false,
      motivo: "historico_falhou_item_permanece_vivo",
      removeuDaViva: false
    });
    return {
      ok: false,
      motivo: "historico_falhou_item_permanece_vivo",
      removeuDaViva: false,
      historico
    };
  }

  const restante = entradas.filter(item => item.id !== entrada.id);
  const escrita = escreverFilaViva(cliente, restante, deps);
  const duracaoMs = Math.round(Number(process.hrtime.bigint() - inicio) / 1e6);
  if (!escrita.ok) {
    logOperacional(deps.logger, {
      versao: 1,
      evento: "conflito_viva_historico",
      clienteId: cliente,
      ok: false,
      historicoOk: true,
      vivaOk: false,
      cacheHit: true,
      removeuDaViva: false,
      totalVivaAntes: entradas.length,
      totalVivaDepois: entradas.length,
      fileHash: hashCurto(caminhoSegmentoHistorico(cliente, entrada.item || {}, deps))
    });
  }
  logOperacional(deps.logger, {
    versao: 1,
    evento: "transicao_terminal",
      clienteId: cliente,
      ok: escrita.ok === true,
      removeuDaViva: escrita.ok === true,
      totalVivaAntes: entradas.length,
      totalVivaDepois: escrita.ok === true ? restante.length : entradas.length,
      historicoOk: true,
      duracaoMs
    });

  return {
    ok: escrita.ok === true,
    motivo: escrita.ok ? "terminal_movido_para_historico" : "historico_ok_viva_nao_atualizada",
    removeuDaViva: escrita.ok === true,
    historico,
    escrita,
    filaViva: escrita.ok ? restante : entradas
  };
}

function compararVivaComLegado(clienteId = "admin", entradasViva = [], filaLegada = [], deps = {}) {
  return compararVivaComLegadoInterno(clienteId, entradasViva, filaLegada, deps);
}

function flagAtiva(nome, env = process.env) {
  return String(env?.[nome] || "").trim().toLowerCase() === "true";
}

function modoOperacional(env = process.env) {
  return resolverModoOperacional(env);
}

function sincronizarCanaryEscrita(params = {}, deps = {}, opcoes = {}) {
  const cliente = clienteSeguro(params.clienteId || "admin");
  const env = opcoes.env || deps.env || process.env;
  const modo = resolverModoOperacional(env);

  if (!deveUsarFilaV2Operacional(cliente, env)) {
    return {
      ok: true,
      pulou: true,
      motivo: "rollout_desativado",
      ...modo
    };
  }

  const inicio = process.hrtime.bigint();
  const filaLegada = Array.isArray(params.fila)
    ? params.fila.filter(item => clienteSeguro(item?.clienteId || "admin") === cliente)
    : lerFilaLegada(cliente, { ...opcoes, ...deps });
  const agora = params.agora || deps.agora || Date.now();
  const projecao = projetarFilaV2(filaLegada, { agora });
  const escrita = escreverFilaViva(cliente, projecao.viva, { ...opcoes, ...deps, agora });
  const comparacao = compararVivaComLegado(cliente, projecao.viva, filaLegada, { ...opcoes, ...deps, agora });
  const duracaoMs = Math.round(Number(process.hrtime.bigint() - inicio) / 1e6);
  const logger = params.logger || deps.logger || opcoes.logger || console;

  logOperacional(logger, {
    versao: 1,
    evento: "canary_write_operacional",
    clienteId: cliente,
    rollout: modo.rolloutOperacional,
    canaryClientes: modo.canaryClientes.length,
    ok: escrita.ok === true && comparacao.ok === true,
    totalLegado: projecao.totalLegado,
    totalViva: projecao.totalViva,
    totalHistorico: projecao.totalHistorico,
    divergencias: comparacao.divergencias || 0,
    bytesFilaViva: escrita.bytesFilaViva || 0,
    fallbackLegado: escrita.ok !== true || comparacao.ok !== true,
    duracaoMs
  });

  console.log(TAG_CANARY_WRITER, JSON.stringify({
    versao: 1,
    clienteId: cliente,
    rollout: modo.rolloutOperacional,
    canaryAtivo: true,
    ok: escrita.ok === true && comparacao.ok === true,
    totalLegado: projecao.totalLegado,
    totalViva: projecao.totalViva,
    totalHistorico: projecao.totalHistorico,
    divergencias: comparacao.divergencias || 0,
    bytesFilaViva: escrita.bytesFilaViva || 0,
    fallbackLegado: escrita.ok !== true || comparacao.ok !== true,
    duracaoMs
  }));

  return {
    ok: escrita.ok === true && comparacao.ok === true,
    pulou: false,
    ...modo,
    projecao,
    escrita,
    comparacao
  };
}

function criarControladorCheckpointLegadoV2(opcoes = {}) {
  const politica = opcoes.politica || politicaCheckpointLegado(opcoes.env || process.env);
  const estados = new Map();

  function obterEstado(clienteId = "admin") {
    const cliente = clienteSeguro(clienteId);
    if (!estados.has(cliente)) {
      estados.set(cliente, {
        clienteId: cliente,
        dirty: false,
        mutacoes: 0,
        dirtyDesde: 0,
        ultimoCheckpoint: 0,
        checkpoints: 0,
        ultimoMotivo: "",
        generation: 0,
        checkpointEmAndamento: false,
        checkpointGeneration: 0,
        checkpointMutacoes: 0,
        checkpointConcurrentSkip: 0
      });
    }
    return estados.get(cliente);
  }

  function snapshot(clienteId = "admin", agora = Date.now()) {
    const estado = obterEstado(clienteId);
    return {
      clienteId: estado.clienteId,
      dirty: estado.dirty,
      mutacoes: estado.mutacoes,
      dirtyAgeMs: estado.dirty && estado.dirtyDesde ? Math.max(0, agora - estado.dirtyDesde) : 0,
      checkpoints: estado.checkpoints,
      ultimoMotivo: estado.ultimoMotivo,
      generation: estado.generation,
      checkpointEmAndamento: estado.checkpointEmAndamento,
      checkpointGeneration: estado.checkpointGeneration,
      checkpointConcurrentSkip: estado.checkpointConcurrentSkip
    };
  }

  function marcarDirty(clienteId = "admin", motivo = "mutacao_viva", agora = Date.now()) {
    const estado = obterEstado(clienteId);
    if (!estado.dirty) {
      estado.dirty = true;
      estado.dirtyDesde = agora;
    }
    estado.mutacoes += 1;
    estado.ultimoMotivo = texto(motivo || "mutacao_viva");
    estado.generation += 1;
    return snapshot(clienteId, agora);
  }

  function deveCheckpoint(clienteId = "admin", opcoesCheckpoint = {}) {
    const agora = opcoesCheckpoint.agora || Date.now();
    const estado = obterEstado(clienteId);
    if (!estado.dirty) return { deve: false, motivo: "limpo", estado: snapshot(clienteId, agora), politica };
    if (opcoesCheckpoint.forcar) return { deve: true, motivo: opcoesCheckpoint.motivo || "forcado", estado: snapshot(clienteId, agora), politica };
    const dirtyAgeMs = estado.dirtyDesde ? Math.max(0, agora - estado.dirtyDesde) : 0;
    const desdeCheckpointMs = estado.ultimoCheckpoint ? Math.max(0, agora - estado.ultimoCheckpoint) : dirtyAgeMs;
    if (estado.mutacoes >= politica.mutacoes) {
      return { deve: true, motivo: "mutacoes", estado: snapshot(clienteId, agora), politica };
    }
    if (desdeCheckpointMs >= politica.intervaloMs) {
      return { deve: true, motivo: "intervalo", estado: snapshot(clienteId, agora), politica };
    }
    if (dirtyAgeMs >= politica.maxDirtyMs) {
      return { deve: true, motivo: "max_dirty", estado: snapshot(clienteId, agora), politica };
    }
    return { deve: false, motivo: "aguardando_batch", estado: snapshot(clienteId, agora), politica };
  }

  function iniciarCheckpoint(clienteId = "admin", opcoesCheckpoint = {}) {
    const agora = opcoesCheckpoint.agora || Date.now();
    const estado = obterEstado(clienteId);
    if (estado.checkpointEmAndamento) {
      estado.checkpointConcurrentSkip += 1;
      return {
        deve: false,
        motivo: "checkpoint_em_andamento",
        checkpointConcurrentSkip: true,
        estado: snapshot(clienteId, agora),
        politica
      };
    }

    const decisao = deveCheckpoint(clienteId, opcoesCheckpoint);
    if (!decisao.deve) return decisao;

    estado.checkpointEmAndamento = true;
    estado.checkpointGeneration = estado.generation;
    estado.checkpointMutacoes = estado.mutacoes;
    return {
      ...decisao,
      generationInicial: estado.checkpointGeneration,
      mutacoesCapturadas: estado.checkpointMutacoes,
      estado: snapshot(clienteId, agora)
    };
  }

  function concluirCheckpoint(clienteId = "admin", opcoesConclusao = {}) {
    const agora = opcoesConclusao.agora || Date.now();
    const estado = obterEstado(clienteId);
    const generationInicial = Number(opcoesConclusao.generationInicial || estado.checkpointGeneration || 0);
    const mutacoesCapturadas = Number(opcoesConclusao.mutacoesCapturadas || estado.checkpointMutacoes || 0);

    estado.checkpointEmAndamento = false;
    estado.checkpointGeneration = 0;
    estado.checkpointMutacoes = 0;

    if (opcoesConclusao.ok !== true) {
      estado.dirty = true;
      if (!estado.dirtyDesde) estado.dirtyDesde = agora;
      estado.ultimoMotivo = texto(opcoesConclusao.motivo || "checkpoint_falhou");
      return snapshot(clienteId, agora);
    }

    if (estado.generation === generationInicial) {
      estado.dirty = false;
      estado.mutacoes = 0;
      estado.dirtyDesde = 0;
    } else {
      estado.dirty = true;
      estado.mutacoes = Math.max(1, estado.mutacoes - mutacoesCapturadas);
      if (!estado.dirtyDesde) estado.dirtyDesde = agora;
    }
    estado.ultimoCheckpoint = agora;
    estado.checkpoints += 1;
    estado.ultimoMotivo = texto(opcoesConclusao.motivo || "checkpoint_confirmado");
    return snapshot(clienteId, agora);
  }

  function confirmarCheckpoint(clienteId = "admin", opcoesConfirmacao = {}) {
    const agora = opcoesConfirmacao.agora || Date.now();
    const estado = obterEstado(clienteId);
    estado.dirty = false;
    estado.mutacoes = 0;
    estado.dirtyDesde = 0;
    estado.ultimoCheckpoint = agora;
    estado.checkpoints += 1;
    estado.ultimoMotivo = texto(opcoesConfirmacao.motivo || "checkpoint_confirmado");
    return snapshot(clienteId, agora);
  }

  function pendentes(agora = Date.now()) {
    return Array.from(estados.values())
      .filter(estado => estado.dirty)
      .map(estado => snapshot(estado.clienteId, agora));
  }

  return {
    politica,
    marcarDirty,
    deveCheckpoint,
    iniciarCheckpoint,
    concluirCheckpoint,
    confirmarCheckpoint,
    snapshot,
    pendentes
  };
}

function criarControladorFilaOperacionalV2(opcoes = {}) {
  function prepararSeHabilitado(params = {}) {
    const modo = modoOperacional(opcoes.env || process.env);
    if (!modo.shadow2B1Ativo && !modo.operacionalAtivo) {
      return { ok: true, pulou: true, motivo: "flag_desativada", ...modo };
    }

    const cliente = clienteSeguro(params.clienteId || "admin");
    const filaLegada = Array.isArray(params.fila)
      ? params.fila.filter(item => clienteSeguro(item?.clienteId || "admin") === cliente)
      : lerFilaLegada(cliente, { ...opcoes, ...params });
    const projecao = projetarFilaV2(filaLegada, { agora: params.agora || Date.now() });
    const escrita = escreverFilaViva(cliente, projecao.viva, { ...opcoes, ...params });
    const comparacao = compararVivaComLegado(cliente, projecao.viva, filaLegada, { ...opcoes, ...params });

    logOperacional(params.logger || opcoes.logger, {
      versao: 1,
      evento: "preparacao_2b1",
      clienteId: cliente,
      ok: escrita.ok === true && comparacao.ok === true,
      operacionalAtivo: modo.operacionalAtivo,
      shadow2B1Ativo: modo.shadow2B1Ativo,
      totalLegado: projecao.totalLegado,
      totalViva: projecao.totalViva,
      totalHistorico: projecao.totalHistorico,
      divergencias: comparacao.divergencias,
      idsAusentes: comparacao.idsAusentes.length,
      idsExtras: comparacao.idsExtras.length,
      idsDuplicados: comparacao.idsDuplicados.length,
      idsRecentesAusentes: comparacao.idsRecentesAusentes.length,
      fallbackLegado: false,
      bytesFilaViva: escrita.bytesFilaViva || 0
    });

    return {
      ok: escrita.ok === true && comparacao.ok === true,
      pulou: false,
      ...modo,
      projecao,
      escrita,
      comparacao
    };
  }

  return {
    prepararSeHabilitado,
    deveUsarFilaV2Operacional: clienteId => deveUsarFilaV2Operacional(clienteId, opcoes.env || process.env),
    sincronizarCanaryEscrita: (params = {}, deps = {}) => sincronizarCanaryEscrita(params, deps, opcoes),
    inserirItemFilaVivaIncremental: (clienteId, item, deps = {}) => inserirItemFilaVivaIncremental(clienteId, item, { ...opcoes, ...deps }),
    atualizarItemFilaVivaIncremental: (clienteId, item, deps = {}) => atualizarItemFilaVivaIncremental(clienteId, item, { ...opcoes, ...deps }),
    removerItemFilaVivaIncremental: (clienteId, item, deps = {}) => removerItemFilaVivaIncremental(clienteId, item, { ...opcoes, ...deps }),
    lerFilaVivaParaMerge: (clienteId, deps = {}) => lerFilaVivaParaMerge(clienteId, { ...opcoes, ...deps }),
    filaVivaMaisNovaQueLegado: (clienteId, deps = {}) => filaVivaMaisNovaQueLegado(clienteId, { ...opcoes, ...deps }),
    mesclarFilaLegadaComViva: (clienteId, filaLegadaCliente, entradasViva, deps = {}) => mesclarFilaLegadaComViva(clienteId, filaLegadaCliente, entradasViva, { ...opcoes, ...deps }),
    lerFilaViva: (clienteId, deps = {}) => lerFilaViva(clienteId, { ...opcoes, ...deps }),
    lerFilaVivaReadOnly: (clienteId, deps = {}) => lerFilaVivaReadOnly(clienteId, { ...opcoes, ...deps }),
    escreverFilaViva: (clienteId, entradas, deps = {}) => escreverFilaViva(clienteId, entradas, { ...opcoes, ...deps }),
    appendHistoricoIncremental: (clienteId, entrada, deps = {}) => appendHistoricoIncremental(clienteId, entrada, { ...opcoes, ...deps }),
    moverTerminalParaHistorico: (clienteId, filaViva, alvo, deps = {}) => moverTerminalParaHistorico(clienteId, filaViva, alvo, { ...opcoes, ...deps }),
    compararVivaComLegado: (clienteId, entradasViva, filaLegada, deps = {}) => compararVivaComLegado(clienteId, entradasViva, filaLegada, { ...opcoes, ...deps }),
    lerManifestoFilaV2: (clienteId, deps = {}) => lerManifestoFilaV2(clienteId, { ...opcoes, ...deps }),
    registrarManifestoMutacaoObservacional: (clienteId, dados = {}, deps = {}) => registrarManifestoMutacaoObservacional(clienteId, dados, { ...opcoes, ...deps }),
    registrarManifestoCheckpointObservacional: (clienteId, dados = {}, deps = {}) => registrarManifestoCheckpointObservacional(clienteId, dados, { ...opcoes, ...deps }),
    resetarCacheHistoricoParaTeste: limparCacheHistorico
  };
}

module.exports = {
  FILA_V2_MANIFEST_ARQUIVO,
  FLAG_OPERACIONAL_ATIVA,
  FLAG_ROLLOUT_ATIVO,
  FLAG_CANARY_CLIENTES,
  FLAG_2B1_SHADOW_ATIVA,
  FLAG_CHECKPOINT_MUTACOES,
  FLAG_CHECKPOINT_INTERVALO_MS,
  FLAG_CHECKPOINT_MAX_DIRTY_MS,
  HISTORICO_INCREMENTAL_DIR,
  TAG_TELEMETRIA,
  TAG_MANIFEST,
  TAG_CANARY_WRITER,
  TAG_2C,
  TAG_RECOVERY_COMPARACAO,
  TAG_MANIFEST_STATE,
  RECOVERY_COMPARACAO_THROTTLE_MAX_ENTRADAS,
  MANIFEST_STATE_THROTTLE_MAX_ENTRADAS,
  DEFAULT_CHECKPOINT_MUTACOES,
  DEFAULT_CHECKPOINT_INTERVALO_MS,
  DEFAULT_CHECKPOINT_MAX_DIRTY_MS,
  normalizarEntradasViva,
  identidadesItemFilaV2,
  identidadePrincipalItemFilaV2,
  rankStatusFilaV2,
  escolherItemMaisAvancadoFilaV2,
  mesclarFilaLegadaComViva,
  lerFilaVivaParaMerge,
  filaVivaMaisNovaQueLegado,
  lerFilaViva,
  lerFilaVivaReadOnly,
  escreverFilaViva,
  inserirItemFilaVivaIncremental,
  atualizarItemFilaVivaIncremental,
  removerItemFilaVivaIncremental,
  recuperarFilaVivaDoLegado,
  appendHistoricoIncremental,
  moverTerminalParaHistorico,
  compararVivaComLegado,
  avaliarRecoveryPeloManifesto,
  lerManifestoFilaV2,
  registrarManifestoMutacaoObservacional,
  registrarManifestoCheckpointObservacional,
  itemTerminalParaHistorico,
  politicaCheckpointLegado,
  criarControladorCheckpointLegadoV2,
  modoOperacional,
  deveUsarFilaV2Operacional,
  criarControladorFilaOperacionalV2,
  limparCacheHistorico,
  resetarThrottleRecoveryComparacaoParaTeste,
  tamanhoThrottleRecoveryComparacaoParaTeste,
  resetarThrottleManifestStateParaTeste,
  tamanhoThrottleManifestStateParaTeste
};
