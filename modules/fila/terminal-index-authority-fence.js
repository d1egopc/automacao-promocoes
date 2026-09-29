const fsPadrao = require("fs");
const path = require("path");
const crypto = require("crypto");
const storage = require("../../utils/storage");

const VERSION = 1;
const STATE_FILE = "fila-terminal-authority-fence.json";
const LOCK_FILE = "fila-terminal-authority-fence.lock";
const FLAG = "FILA_TERMINAL_INDEX_AUTHORITY_FENCE";
const TOKEN_RE = /^[A-Za-z0-9_.:-]{8,128}$/;

function habilitado(env = process.env) {
  return String(env?.[FLAG] || "").trim() === "1";
}

function clienteSeguro(clienteId = "admin") {
  const valor = String(clienteId || "admin").trim();
  return valor || "admin";
}

function logger(deps = {}, evento, payload = {}) {
  const alvo = deps.logger;
  if (alvo && typeof alvo.warn === "function") {
    alvo.warn("[TERMINAL-AUTHORITY-FENCE]", JSON.stringify({ evento, ...payload }));
  }
}

function agora(deps = {}) {
  return typeof deps.agora === "function" ? deps.agora() : (deps.agora || Date.now());
}

function tokenUnico(deps = {}) {
  if (typeof deps.token === "function") return String(deps.token());
  if (typeof deps.randomUUID === "function") return String(deps.randomUUID());
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function caminhos(clienteId = "admin", deps = {}) {
  const cliente = clienteSeguro(clienteId);
  const resolver = deps.getClientePath || storage.getClientePath;
  const workspace = typeof resolver === "function" ? resolver(cliente) : "";
  return {
    clienteId: cliente,
    workspace,
    stateFile: workspace ? path.join(workspace, STATE_FILE) : "",
    lockFile: workspace ? path.join(workspace, LOCK_FILE) : ""
  };
}

function stateBase(owners = [], epoch = 0) {
  return {
    version: VERSION,
    epoch,
    owners: owners.slice()
  };
}

function estadoInvalido(paths, reasonCode = "state_invalid", extra = {}) {
  return {
    ok: false,
    exists: true,
    reasonCode,
    failClosed: true,
    pending: true,
    activeOwners: null,
    owners: null,
    epoch: null,
    stateFile: paths.stateFile,
    ...extra
  };
}

function normalizarEstado(valor, paths) {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) {
    return estadoInvalido(paths, "state_not_object");
  }
  if (valor.version !== VERSION) {
    return estadoInvalido(paths, "state_version_invalid");
  }
  if (!Number.isSafeInteger(valor.epoch) || valor.epoch < 0) {
    return estadoInvalido(paths, "state_epoch_invalid");
  }
  if (!Array.isArray(valor.owners) || valor.owners.some(owner => typeof owner !== "string" || !TOKEN_RE.test(owner))) {
    return estadoInvalido(paths, "state_owners_invalid");
  }
  const owners = valor.owners.slice();
  if (new Set(owners).size !== owners.length) {
    return estadoInvalido(paths, "state_owners_duplicate");
  }
  return {
    ok: true,
    exists: true,
    reasonCode: "state_valid",
    failClosed: false,
    version: VERSION,
    epoch: valor.epoch,
    owners,
    activeOwners: owners.length,
    pending: owners.length > 0,
    stateFile: paths.stateFile
  };
}

function lerEstado(paths, fsImpl) {
  if (!paths.stateFile) return estadoInvalido(paths, "state_path_unavailable");
  if (!fsImpl.existsSync(paths.stateFile)) {
    return {
      ok: true,
      exists: false,
      reasonCode: "state_absent",
      failClosed: false,
      version: VERSION,
      epoch: 0,
      owners: [],
      activeOwners: 0,
      pending: false,
      stateFile: paths.stateFile
    };
  }
  try {
    const texto = fsImpl.readFileSync(paths.stateFile, "utf8");
    return normalizarEstado(JSON.parse(texto), paths);
  } catch (erro) {
    return estadoInvalido(paths, "state_corrupt", { erro: erro?.message || "state_read_failed" });
  }
}

function adquirirLock(paths, fsImpl, deps = {}) {
  if (!paths.lockFile) return { ok: false, reasonCode: "metadata_lock_path_unavailable" };
  const lockToken = tokenUnico(deps);
  let fd = null;
  try {
    fd = fsImpl.openSync(paths.lockFile, "wx", 0o600);
    const escritos = fsImpl.writeSync(fd, lockToken, 0, "utf8");
    if (Number(escritos) !== Buffer.byteLength(lockToken, "utf8")) {
      throw new Error("metadata_lock_write_partial");
    }
    if (typeof fsImpl.fsyncSync === "function") fsImpl.fsyncSync(fd);
    fsImpl.closeSync(fd);
    return { ok: true, lockToken };
  } catch (erro) {
    try {
      if (fd !== null && typeof fsImpl.closeSync === "function") fsImpl.closeSync(fd);
    } catch (_) {}
    if (erro?.code === "EEXIST") {
      return { ok: false, reasonCode: "metadata_lock_present" };
    }
    return { ok: false, reasonCode: "metadata_lock_acquire_failed", erro: erro?.message || "lock_acquire_failed" };
  }
}

function liberarLock(paths, fsImpl, lockToken) {
  if (!paths.lockFile || !lockToken) return { ok: false, reasonCode: "metadata_lock_release_invalid" };
  try {
    const atual = String(fsImpl.readFileSync(paths.lockFile, "utf8"));
    if (atual !== lockToken) {
      return { ok: false, reasonCode: "metadata_lock_owner_mismatch" };
    }
    fsImpl.unlinkSync(paths.lockFile);
    return { ok: true, reasonCode: "metadata_lock_released" };
  } catch (erro) {
    return { ok: false, reasonCode: "metadata_lock_release_failed", erro: erro?.message || "lock_release_failed" };
  }
}

function comMetadataLock(paths, fsImpl, deps, operation) {
  const acquired = adquirirLock(paths, fsImpl, deps);
  if (acquired.ok !== true) return acquired;
  let resultado;
  try {
    resultado = operation();
  } catch (erro) {
    resultado = { ok: false, reasonCode: "metadata_operation_failed", erro: erro?.message || "metadata_operation_failed" };
  }
  const released = liberarLock(paths, fsImpl, acquired.lockToken);
  if (released.ok !== true) {
    logger(deps, "metadata_lock_release_failed", {
      clienteId: paths.clienteId,
      reasonCode: released.reasonCode
    });
    return {
      ...resultado,
      ok: false,
      failClosed: true,
      reasonCode: released.reasonCode,
      lockRelease: released
    };
  }
  return { ...resultado, lockRelease: released };
}

function persistirAtomico(paths, state, fsImpl, deps = {}) {
  if (!paths.stateFile) return { ok: false, reasonCode: "state_path_unavailable" };
  const temporary = `${paths.stateFile}.tmp.${process.pid}.${tokenUnico(deps)}`;
  let fd = null;
  try {
    const payload = `${JSON.stringify(state)}\n`;
    fd = fsImpl.openSync(temporary, "wx", 0o600);
    const escritos = fsImpl.writeSync(fd, payload, 0, "utf8");
    if (Number(escritos) !== Buffer.byteLength(payload, "utf8")) {
      throw new Error("state_write_partial");
    }
    if (typeof fsImpl.fsyncSync === "function") fsImpl.fsyncSync(fd);
    fsImpl.closeSync(fd);
    fd = null;
    fsImpl.renameSync(temporary, paths.stateFile);
    return { ok: true, reasonCode: "state_published", state };
  } catch (erro) {
    try {
      if (fd !== null && typeof fsImpl.closeSync === "function") fsImpl.closeSync(fd);
    } catch (_) {}
    try {
      if (fsImpl.existsSync(temporary)) fsImpl.unlinkSync(temporary);
    } catch (_) {}
    return { ok: false, reasonCode: "state_publish_failed", erro: erro?.message || "state_publish_failed" };
  }
}

function armarRewrite(clienteId = "admin", deps = {}) {
  const paths = caminhos(clienteId, deps);
  const fsImpl = deps.fs || fsPadrao;
  const resultado = comMetadataLock(paths, fsImpl, deps, () => {
    const atual = lerEstado(paths, fsImpl);
    if (atual.ok !== true) return { ok: false, reasonCode: atual.reasonCode, failClosed: true };
    if (!Number.isSafeInteger(atual.epoch) || atual.epoch >= Number.MAX_SAFE_INTEGER) {
      return { ok: false, reasonCode: "epoch_exhausted", failClosed: true };
    }
    const token = tokenUnico(deps);
    if (!TOKEN_RE.test(token) || atual.owners.includes(token)) {
      return { ok: false, reasonCode: "owner_token_invalid_or_reused", failClosed: true };
    }
    const state = stateBase([...atual.owners, token], atual.epoch + 1);
    const escrita = persistirAtomico(paths, state, fsImpl, deps);
    if (escrita.ok !== true) return { ok: false, reasonCode: escrita.reasonCode, failClosed: true, escrita };
    return {
      ok: true,
      reasonCode: "armed",
      token,
      epoch: state.epoch,
      owners: state.owners,
      pending: true,
      stateFile: paths.stateFile
    };
  });
  if (resultado.ok !== true) {
    logger(deps, "arm_failed", { clienteId: paths.clienteId, reasonCode: resultado.reasonCode });
  }
  return { ...resultado, clienteId: paths.clienteId };
}

function limparRewrite(clienteId = "admin", ownerToken = "", deps = {}) {
  const paths = caminhos(clienteId, deps);
  const fsImpl = deps.fs || fsPadrao;
  const resultado = comMetadataLock(paths, fsImpl, deps, () => {
    const atual = lerEstado(paths, fsImpl);
    if (atual.ok !== true) return { ok: false, reasonCode: atual.reasonCode, failClosed: true };
    if (!TOKEN_RE.test(String(ownerToken || "")) || !atual.owners.includes(ownerToken)) {
      return { ok: false, reasonCode: "owner_not_active", failClosed: true, epoch: atual.epoch, pending: atual.pending };
    }
    const state = stateBase(atual.owners.filter(owner => owner !== ownerToken), atual.epoch);
    const escrita = persistirAtomico(paths, state, fsImpl, deps);
    if (escrita.ok !== true) return { ok: false, reasonCode: escrita.reasonCode, failClosed: true, escrita };
    return {
      ok: true,
      reasonCode: "cleared",
      epoch: state.epoch,
      owners: state.owners,
      pending: state.owners.length > 0,
      stateFile: paths.stateFile
    };
  });
  if (resultado.ok !== true) {
    logger(deps, "clear_failed", { clienteId: paths.clienteId, reasonCode: resultado.reasonCode });
  }
  return { ...resultado, clienteId: paths.clienteId };
}

function logExecucao(deps = {}, evento, payload = {}) {
  const alvo = deps.logger;
  if (alvo && typeof alvo.warn === "function") {
    alvo.warn("[TERMINAL-AUTHORITY-FENCE]", JSON.stringify({ evento, ...payload }));
  }
}

function executarRewriteComFence(clienteId = "admin", deps = {}, rewrite = () => null) {
  if (!habilitado(deps.env)) {
    return rewrite();
  }

  const cliente = clienteSeguro(clienteId);
  const motivo = deps.motivo || "legacy_rewrite";
  const armado = armarRewrite(cliente, deps);
  if (armado.ok !== true) {
    logExecucao(deps, "legacy_rewrite_fence_not_armed", {
      clienteId: cliente,
      motivo: armado.reasonCode || "legacy_rewrite_fence_indisponivel",
      authorityPermitida: false
    });
    return {
      ok: false,
      pulou: true,
      skipped: true,
      motivo: "legacy_rewrite_fence_not_armed",
      fence: armado
    };
  }

  let resultado;
  try {
    resultado = rewrite();
  } catch (erro) {
    logExecucao(deps, "legacy_rewrite_fence_preservado_apos_falha", {
      clienteId: cliente,
      motivo,
      erro: erro?.message || "erro_rewrite"
    });
    throw erro;
  }

  if (resultado?.ok !== true) {
    return {
      ...resultado,
      fence: armado,
      fenceClear: { ok: false, reasonCode: "rewrite_not_confirmed_owner_retained" }
    };
  }

  const liberado = limparRewrite(cliente, armado.token, deps);
  if (liberado.ok !== true) {
    logExecucao(deps, "legacy_rewrite_fence_release_falhou", {
      clienteId: cliente,
      motivo: liberado.reasonCode || "legacy_rewrite_fence_release_falhou",
      authorityPermitida: false
    });
    return {
      ...resultado,
      ok: false,
      fence: armado,
      fenceClear: liberado
    };
  }
  return { ...resultado, fence: armado, fenceClear: liberado };
}

function snapshot(clienteId = "admin", deps = {}) {
  const paths = caminhos(clienteId, deps);
  const fsImpl = deps.fs || fsPadrao;
  const lockPresent = Boolean(paths.lockFile && fsImpl.existsSync(paths.lockFile));
  const atual = lerEstado(paths, fsImpl);
  if (lockPresent) {
    return {
      ok: false,
      eligible: false,
      reasonCode: "metadata_lock_present",
      failClosed: true,
      version: atual.version || VERSION,
      epoch: atual.ok === true ? atual.epoch : null,
      owners: atual.ok === true ? atual.owners : null,
      activeOwners: atual.ok === true ? atual.activeOwners : null,
      pending: true,
      metadataLockPresent: true,
      stateFile: paths.stateFile,
      lockFile: paths.lockFile
    };
  }
  if (atual.ok !== true || atual.exists !== true) {
    return {
      ok: false,
      eligible: false,
      reasonCode: atual.reasonCode,
      failClosed: true,
      version: atual.version || VERSION,
      epoch: atual.epoch ?? null,
      owners: atual.owners,
      activeOwners: atual.activeOwners,
      pending: true,
      metadataLockPresent: false,
      stateFile: paths.stateFile,
      lockFile: paths.lockFile
    };
  }
  return {
    ok: true,
    eligible: atual.owners.length === 0,
    reasonCode: "snapshot_valid",
    failClosed: false,
    version: atual.version,
    epoch: atual.epoch,
    owners: atual.owners,
    activeOwners: atual.activeOwners,
    pending: atual.pending,
    metadataLockPresent: false,
    stateFile: paths.stateFile,
    lockFile: paths.lockFile
  };
}

module.exports = {
  VERSION,
  STATE_FILE,
  LOCK_FILE,
  FLAG,
  habilitado,
  getFencePaths: caminhos,
  armarRewrite,
  limparRewrite,
  executarRewriteComFence,
  snapshot
};
