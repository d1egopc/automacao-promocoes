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
  const conteudo = JSON.stringify(dados, null, 2);

  if (fs.existsSync(file)) {
    try {
      fs.copyFileSync(file, bak);
    } catch {}
  }

  fs.writeFileSync(tmp, conteudo);
  fs.renameSync(tmp, file);
  logStorageLento("writeJsonFileAtomic", file, inicio, { bytes: Buffer.byteLength(conteudo || "", "utf8") });
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
