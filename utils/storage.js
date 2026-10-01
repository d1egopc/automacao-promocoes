const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { isMainThread, threadId } = require("worker_threads");
const { registrarArquivo } = require("./painel-latencia");
const PERF_STORAGE_MIN_MS = Number(process.env.PERF_STORAGE_MIN_MS || 100);
const PERF_STORAGE_DIAGNOSTICO_ENABLED = /^(1|true)$/i.test(
  String(process.env.PERF_STORAGE_DIAGNOSTICO || "")
);

function numeroEnvSeguro(nome, fallback) {
  const valor = Number(process.env[nome]);
  return Number.isFinite(valor) && valor >= 0 ? valor : fallback;
}

const PERF_STORAGE_DIAGNOSTICO_MIN_MS = numeroEnvSeguro(
  "PERF_STORAGE_DIAGNOSTICO_MIN_MS",
  100
);
const PERF_STORAGE_DIAGNOSTICO_MIN_BYTES = numeroEnvSeguro(
  "PERF_STORAGE_DIAGNOSTICO_MIN_BYTES",
  16 * 1024 * 1024
);
let workspaceHashSalt;

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

function workspaceHashDoArquivo(file) {
  try {
    const raizClientes = path.resolve(CLIENTES_DIR) + path.sep;
    const arquivoResolvido = path.resolve(String(file || ""));
    if (!arquivoResolvido.startsWith(raizClientes)) return null;

    const relativo = path.relative(path.resolve(CLIENTES_DIR), arquivoResolvido);
    const [workspace] = relativo.split(path.sep);
    if (!workspace || workspace === ".") return null;

    if (!workspaceHashSalt) workspaceHashSalt = crypto.randomBytes(16);
    return crypto.createHash("sha256")
      .update(workspaceHashSalt)
      .update(workspace, "utf8")
      .digest("hex")
      .slice(0, 12);
  } catch {
    return null;
  }
}

function callerTagDiagnostico() {
  try {
    const raizProjeto = path.resolve(__dirname, "..");
    const arquivoStorage = path.resolve(__filename);
    const stack = new Error().stack || "";

    for (const linha of stack.split("\n").slice(1)) {
      const correspondencia = linha.match(/at (?:.+ \()?(.+):\d+:\d+\)?$/);
      if (!correspondencia) continue;

      const arquivo = correspondencia[1];
      if (!path.isAbsolute(arquivo)) continue;

      const arquivoResolvido = path.resolve(arquivo);
      if (arquivoResolvido === arquivoStorage) continue;

      const relativo = path.relative(raizProjeto, arquivoResolvido);
      if (!relativo || relativo.startsWith("..") || path.isAbsolute(relativo)) continue;

      return relativo.split(path.sep).join("/");
    }
  } catch {}

  return "desconhecido";
}

function logStorageDiagnostico({
  operacao,
  file,
  bytes = 0,
  duracaoMs = 0,
  ...extra
} = {}) {
  if (!PERF_STORAGE_DIAGNOSTICO_ENABLED) return;

  try {
    const bytesSeguro = Number.isFinite(Number(bytes)) ? Math.max(0, Number(bytes)) : 0;
    const duracaoSegura = Number.isFinite(Number(duracaoMs)) ? Math.max(0, Number(duracaoMs)) : 0;
    if (
      duracaoSegura < PERF_STORAGE_DIAGNOSTICO_MIN_MS &&
      bytesSeguro < PERF_STORAGE_DIAGNOSTICO_MIN_BYTES
    ) {
      return;
    }

    console.log("[PERF STORAGE DIAGNOSTICO]", JSON.stringify({
      timestamp: new Date().toISOString(),
      operacao: String(operacao || "desconhecida"),
      arquivo: path.basename(String(file || "")),
      bytes: bytesSeguro,
      duracaoMs: Math.round(duracaoSegura),
      isMainThread,
      threadId,
      workspaceHash: workspaceHashDoArquivo(file),
      callerTag: callerTagDiagnostico(),
      ...extra
    }));
  } catch {}
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
      const resultado = {
        backupOk: true,
        backupMetodo: "hardlink",
        backupMs: Math.round(perfStorageMs(inicio))
      };
      logStorageDiagnostico({
        operacao: "backup",
        fase: resultado.backupMetodo,
        file,
        bytes: opcoes.bytes,
        duracaoMs: resultado.backupMs,
        backupMetodo: resultado.backupMetodo,
        backupOk: resultado.backupOk
      });
      return resultado;
    } catch {
      removerArquivoSeExistir(bakTmp);
    }
  }

  try {
    fs.copyFileSync(file, bak);
    const resultado = {
      backupOk: true,
      backupMetodo: "copy",
      backupMs: Math.round(perfStorageMs(inicio))
    };
    logStorageDiagnostico({
      operacao: "backup",
      fase: resultado.backupMetodo,
      file,
      bytes: opcoes.bytes,
      duracaoMs: resultado.backupMs,
      backupMetodo: resultado.backupMetodo,
      backupOk: resultado.backupOk
    });
    return resultado;
  } catch {
    const resultado = {
      backupOk: false,
      backupMetodo: "erro",
      backupMs: Math.round(perfStorageMs(inicio))
    };
    logStorageDiagnostico({
      operacao: "backup",
      fase: resultado.backupMetodo,
      file,
      bytes: opcoes.bytes,
      duracaoMs: resultado.backupMs,
      backupMetodo: resultado.backupMetodo,
      backupOk: resultado.backupOk
    });
    return resultado;
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
      const totalMs = perfStorageMs(inicio);
      logStorageLento("readJsonFile", file, inicio, { existe: false });
      logStorageDiagnostico({
        operacao: "readJsonFile",
        fase: "aggregate",
        file,
        bytes: 0,
        duracaoMs: totalMs,
        totalMs,
        readMs: 0,
        parseMs: null,
        existe: false
      });
      return clonarFallback(fallback);
    }
    const inicioRead = process.hrtime.bigint();
    const texto = fs.readFileSync(file, "utf8");
    const readMs = perfStorageMs(inicio);
    const readPhaseMs = perfStorageMs(inicioRead);
    const bytes = Buffer.byteLength(texto || "", "utf8");
    registrarArquivo("readFileSync", file, readMs, bytes);
    logStorageLento("readJsonFile", file, inicio, { existe: true, bytes });
    if (!texto) {
      const totalMs = perfStorageMs(inicio);
      logStorageDiagnostico({
        operacao: "readJsonFile",
        fase: "aggregate",
        file,
        bytes,
        duracaoMs: totalMs,
        totalMs,
        readMs: readPhaseMs,
        parseMs: null,
        existe: true
      });
      return clonarFallback(fallback);
    }
    const inicioParse = process.hrtime.bigint();
    let parseMs = null;
    try {
      return JSON.parse(texto);
    } finally {
      parseMs = perfStorageMs(inicioParse);
      registrarArquivo("JSON.parse", file, parseMs, bytes);
      logStorageDiagnostico({
        operacao: "readJsonFile",
        fase: "aggregate",
        file,
        bytes,
        duracaoMs: perfStorageMs(inicio),
        totalMs: perfStorageMs(inicio),
        readMs: readPhaseMs,
        parseMs,
        existe: true
      });
    }
  } catch {
    logStorageLento("readJsonFile", file, inicio, { erro: true });
    return clonarFallback(fallback);
  }
}

function writeJsonFileAtomic(file, dados, opcoes = {}) {
  const inicio = process.hrtime.bigint();
  garantirDir(path.dirname(file));

  const tmp = file + ".tmp";
  const bak = file + ".bak";
  const inicioStringify = process.hrtime.bigint();
  const conteudo = JSON.stringify(dados, null, 2);
  const stringifyMs = Math.round(perfStorageMs(inicioStringify));
  const bytes = Buffer.byteLength(conteudo || "", "utf8");
  registrarArquivo("JSON.stringify", file, stringifyMs, bytes);

  const backup = criarBackupArquivoAtomic(file, bak, {
    preferirHardlink: path.basename(file) === "fila.json",
    bytes
  });
  registrarArquivo(`backup_${backup.backupMetodo}`, file, backup.backupMs, backup.backupMetodo === "copy" ? bytes : 0);

  const inicioWrite = process.hrtime.bigint();
  fs.writeFileSync(tmp, conteudo);
  const writeMs = Math.round(perfStorageMs(inicioWrite));
  registrarArquivo("writeFileSync", file, writeMs, bytes);
  const inicioRename = process.hrtime.bigint();
  try {
    if (typeof opcoes.beforeRename === "function") opcoes.beforeRename({ file, bytes });
  } catch {}
  fs.renameSync(tmp, file);
  const renameMs = Math.round(perfStorageMs(inicioRename));
  registrarArquivo("renameSync", file, renameMs);
  try {
    if (typeof opcoes.afterRename === "function") opcoes.afterRename({ file, bytes, renameMs });
  } catch {}
  const totalMs = perfStorageMs(inicio);
  logStorageLento("writeJsonFileAtomic", file, inicio, {
    bytes,
    stringifyMs,
    backupMs: backup.backupMs,
    backupMetodo: backup.backupMetodo,
    backupOk: backup.backupOk,
    writeMs,
    renameMs
  });
  logStorageDiagnostico({
    operacao: "writeJsonFileAtomic",
    fase: "aggregate",
    file,
    bytes,
    duracaoMs: totalMs,
    totalMs,
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

function writeClienteJson(clienteId = "admin", arquivo = "", dados = {}, opcoes = {}) {
  const id = normalizarClienteId(clienteId);
  return writeJsonFileAtomic(getClienteJsonPath(id, arquivo), withClienteId(id, dados), opcoes);
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
  criarBackupArquivoAtomic,
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
