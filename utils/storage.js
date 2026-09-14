const fs = require("fs");
const path = require("path");
const PERF_STORAGE_MIN_MS = Number(process.env.PERF_STORAGE_MIN_MS || 100);

function perfStorageMs(inicio) {
  return Number(process.hrtime.bigint() - inicio) / 1e6;
}

function logStorageLento(operacao, file, inicio, extra = {}) {
  const tempoMs = Math.round(perfStorageMs(inicio));
  if (tempoMs < PERF_STORAGE_MIN_MS) return;
  console.log("[PERF STORAGE]", JSON.stringify({
    operacao,
    arquivo: path.basename(file || ""),
    tempoMs,
    ...extra
  }));
}

function removerArquivoSeExistir(file) {
  try {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } catch {}
}

function substituirBackupPorTemporario(bakTmp, bak) {
  if (!fs.existsSync(bak)) {
    fs.renameSync(bakTmp, bak);
    return;
  }

  const bakAnteriorTmp = `${bak}.replace.${process.pid}.${Date.now()}`;
  removerArquivoSeExistir(bakAnteriorTmp);
  fs.renameSync(bak, bakAnteriorTmp);

  try {
    fs.renameSync(bakTmp, bak);
    removerArquivoSeExistir(bakAnteriorTmp);
  } catch (erro) {
    if (!fs.existsSync(bak) && fs.existsSync(bakAnteriorTmp)) {
      try {
        fs.renameSync(bakAnteriorTmp, bak);
      } catch {}
    }
    throw erro;
  }
}

function criarBackupArquivoAtomic(file, bak, opcoes = {}) {
  const inicio = process.hrtime.bigint();
  if (!fs.existsSync(file)) {
    return { backupOk: false, backupMetodo: "arquivo_ausente", backupMs: 0 };
  }

  const bakTmp = `${bak}.tmp.${process.pid}.${Date.now()}`;
  if (opcoes.preferirHardlink === true) {
    removerArquivoSeExistir(bakTmp);

    try {
      fs.linkSync(file, bakTmp);
      try {
        substituirBackupPorTemporario(bakTmp, bak);
      } catch {
        removerArquivoSeExistir(bakTmp);
        throw new Error("hardlink_backup_replace_failed");
      }
      return {
        backupOk: true,
        backupMetodo: "hardlink",
        backupMs: Math.round(perfStorageMs(inicio))
      };
    } catch {
      removerArquivoSeExistir(bakTmp);
    }
  }

  try {
    fs.copyFileSync(file, bak);
    return {
      backupOk: true,
      backupMetodo: "copy",
      backupMs: Math.round(perfStorageMs(inicio))
    };
  } catch {
    return {
      backupOk: false,
      backupMetodo: "erro",
      backupMs: Math.round(perfStorageMs(inicio))
    };
  }
}

const DATA_DIR = process.env.DATA_DIR || "/data";
const CLIENTES_DIR = path.join(DATA_DIR, "clientes");

const storage = {
  driver: process.env.STORAGE_DRIVER || "json"
};

function assertNomeSeguro(valor = "", campo = "valor") {
  const texto = String(valor || "").trim();

  if (!texto) {
    throw new Error(`${campo}_invalido`);
  }

  if (
    texto.includes("..") ||
    texto.includes("/") ||
    texto.includes("\\") ||
    !/^[a-zA-Z0-9_.-]+$/.test(texto)
  ) {
    throw new Error(`${campo}_inseguro`);
  }

  return texto;
}

function normalizarClienteId(clienteId = "admin") {
  return assertNomeSeguro(clienteId || "admin", "clienteId");
}

function normalizarArquivoJson(arquivo = "") {
  const nome = assertNomeSeguro(arquivo, "arquivo");

  if (!nome.endsWith(".json")) {
    throw new Error("arquivo_json_invalido");
  }

  return nome;
}

function garantirDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function getClientePath(clienteId = "admin") {
  const id = normalizarClienteId(clienteId);
  const dir = path.join(CLIENTES_DIR, id);
  garantirDir(dir);
  return dir;
}

function getClienteJsonPath(clienteId = "admin", arquivo = "") {
  return path.join(getClientePath(clienteId), normalizarArquivoJson(arquivo));
}

function getGlobalJsonPath(arquivo = "") {
  garantirDir(DATA_DIR);
  return path.join(DATA_DIR, normalizarArquivoJson(arquivo));
}

function clonarFallback(fallback) {
  if (fallback === undefined) return undefined;
  return JSON.parse(JSON.stringify(fallback));
}

function readJsonFile(file, fallback) {
  const inicio = process.hrtime.bigint();
  try {
    if (!fs.existsSync(file)) {
      logStorageLento("readJsonFile", file, inicio, { existe: false });
      return clonarFallback(fallback);
    }
    const texto = fs.readFileSync(file, "utf8");
    logStorageLento("readJsonFile", file, inicio, { existe: true, bytes: Buffer.byteLength(texto || "", "utf8") });
    if (!texto) return clonarFallback(fallback);
    return JSON.parse(texto);
  } catch {
    logStorageLento("readJsonFile", file, inicio, { erro: true });
    return clonarFallback(fallback);
  }
}

function writeJsonFileAtomic(file, dados) {
  const inicio = process.hrtime.bigint();
  garantirDir(path.dirname(file));

  const tmp = file + ".tmp";
  const bak = file + ".bak";
  const inicioStringify = process.hrtime.bigint();
  const conteudo = JSON.stringify(dados, null, 2);
  const stringifyMs = Math.round(perfStorageMs(inicioStringify));
  const bytes = Buffer.byteLength(conteudo || "", "utf8");

  const backup = criarBackupArquivoAtomic(file, bak, {
    preferirHardlink: path.basename(file) === "fila.json"
  });

  const inicioWrite = process.hrtime.bigint();
  fs.writeFileSync(tmp, conteudo);
  const writeMs = Math.round(perfStorageMs(inicioWrite));
  const inicioRename = process.hrtime.bigint();
  fs.renameSync(tmp, file);
  const renameMs = Math.round(perfStorageMs(inicioRename));
  logStorageLento("writeJsonFileAtomic", file, inicio, {
    bytes,
    stringifyMs,
    backupMs: backup.backupMs,
    backupMetodo: backup.backupMetodo,
    backupOk: backup.backupOk,
    writeMs,
    renameMs
  });
  return true;
}

function withClienteId(clienteId, dados) {
  if (Array.isArray(dados)) {
    return dados.map(item =>
      item && typeof item === "object"
        ? { ...item, clienteId }
        : item
    );
  }

  if (dados && typeof dados === "object") {
    return { ...dados, clienteId };
  }

  return dados;
}

function readClienteJson(clienteId = "admin", arquivo = "", fallback = {}) {
  const id = normalizarClienteId(clienteId);
  return readJsonFile(getClienteJsonPath(id, arquivo), fallback);
}

function writeClienteJson(clienteId = "admin", arquivo = "", dados = {}) {
  const id = normalizarClienteId(clienteId);
  return writeJsonFileAtomic(getClienteJsonPath(id, arquivo), withClienteId(id, dados));
}

function readGlobalJson(arquivo = "", fallback = {}) {
  return readJsonFile(getGlobalJsonPath(arquivo), fallback);
}

function writeGlobalJson(arquivo = "", dados = {}) {
  return writeJsonFileAtomic(getGlobalJsonPath(arquivo), dados);
}

function listClientes() {
  try {
    garantirDir(CLIENTES_DIR);

    return fs.readdirSync(CLIENTES_DIR, { withFileTypes: true })
      .filter(entrada => entrada.isDirectory())
      .map(entrada => entrada.name)
      .filter(nome => {
        try {
          normalizarClienteId(nome);
          return true;
        } catch {
          return false;
        }
      });
  } catch {
    return [];
  }
}

function mascararSecrets(valor) {
  if (Array.isArray(valor)) return valor.map(mascararSecrets);

  if (!valor || typeof valor !== "object") return valor;

  const chavesSecretas = /token|secret|senha|password|cookie|cookies|access|refresh|appSecret|apiKey|apikey|authorization/i;
  const saida = {};

  for (const [chave, item] of Object.entries(valor)) {
    if (chavesSecretas.test(chave)) {
      saida[chave] = item ? "***" : item;
    } else {
      saida[chave] = mascararSecrets(item);
    }
  }

  return saida;
}

module.exports = {
  storage,
  getClientePath,
  getClienteJsonPath,
  readClienteJson,
  writeClienteJson,
  listClientes,
  readGlobalJson,
  writeGlobalJson,
  mascararSecrets,
  normalizarClienteId,
  normalizarArquivoJson
};
