"use strict";

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_DURABLE_DIR = "/data/mensageiro-v3";

function assertAbsolute(filePath, code = "mensageiro_v3_storage_path_invalido") {
  if (typeof filePath !== "string" || !path.isAbsolute(filePath)) throw new Error(code);
  return path.normalize(filePath);
}

function resolveDurablePath({ statePath, fencePath, dataDir, env = process.env } = {}) {
  if (process.platform === "win32" && !statePath && !fencePath && !dataDir && !env.MENSAGEIRO_V3_DATA_DIR && !env.MENSAGEIRO_V3_STATE_PATH && !env.MENSAGEIRO_V3_FENCE_PATH) {
    throw new Error("mensageiro_v3_storage_path_required");
  }
  const configuredDir = dataDir || env.MENSAGEIRO_V3_DATA_DIR || DEFAULT_DURABLE_DIR;
  const dir = assertAbsolute(configuredDir);
  return {
    dataDir: dir,
    statePath: assertAbsolute(statePath || env.MENSAGEIRO_V3_STATE_PATH || path.join(dir, "state.json")),
    fencePath: assertAbsolute(fencePath || env.MENSAGEIRO_V3_FENCE_PATH || path.join(dir, "workspace-fence.json"))
  };
}

function assertDurableStorage(filePath, { createParent = false } = {}) {
  const normalized = assertAbsolute(filePath);
  const parent = path.dirname(normalized);
  if (createParent) fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  let stat;
  try { stat = fs.statSync(parent); } catch (error) {
    const wrapped = new Error("mensageiro_v3_storage_indisponivel");
    wrapped.cause = error;
    throw wrapped;
  }
  if (!stat.isDirectory()) throw new Error("mensageiro_v3_storage_indisponivel");
  try { fs.accessSync(parent, fs.constants.R_OK | fs.constants.W_OK | fs.constants.X_OK); } catch (error) {
    const wrapped = new Error("mensageiro_v3_storage_sem_permissao");
    wrapped.cause = error;
    throw wrapped;
  }
  return normalized;
}

function assertSameFilesystem(...filePaths) {
  const dirs = filePaths.map(filePath => path.dirname(assertAbsolute(filePath)));
  const devices = dirs.map(dir => fs.statSync(dir).dev);
  if (devices.some(device => device !== devices[0])) throw new Error("mensageiro_v3_storage_fs_divergente");
  return true;
}

module.exports = { DEFAULT_DURABLE_DIR, assertAbsolute, resolveDurablePath, assertDurableStorage, assertSameFilesystem };
