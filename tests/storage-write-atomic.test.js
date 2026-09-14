const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-storage-atomic-"));
process.env.DATA_DIR = dataDir;
process.env.PERF_STORAGE_MIN_MS = "0";

const storagePath = path.resolve(__dirname, "../utils/storage.js");
delete require.cache[storagePath];

const copyFileSyncOriginal = fs.copyFileSync;
const linkSyncOriginal = fs.linkSync;
const consoleLogOriginal = console.log;
let copyFileSyncChamadas = 0;
const logsStorage = [];
fs.copyFileSync = (...args) => {
  copyFileSyncChamadas += 1;
  return copyFileSyncOriginal(...args);
};
console.log = (...args) => {
  if (String(args[0] || "") === "[PERF STORAGE]") {
    try {
      logsStorage.push(JSON.parse(String(args[1] || "{}")));
    } catch {}
  }
  return consoleLogOriginal(...args);
};

try {
  const storage = require(storagePath);
  const filaOfertas = require("../utils/fila-ofertas");
  const cliente = "cliente_storage_atomic";
  const primeiro = [{ id: "oferta_1", clienteId: cliente, status: "pendente" }];
  const segundo = [{ id: "oferta_1", clienteId: cliente, status: "processando" }];
  const terceiro = [{ id: "oferta_1", clienteId: cliente, status: "enviado" }];

  storage.writeClienteJson(cliente, "fila.json", primeiro);
  storage.writeClienteJson(cliente, "fila.json", segundo);

  const filaPath = storage.getClienteJsonPath(cliente, "fila.json");
  const bakPath = `${filaPath}.bak`;
  const lerAtual = () => JSON.parse(fs.readFileSync(filaPath, "utf8"));
  const lerBackup = () => JSON.parse(fs.readFileSync(bakPath, "utf8"));
  const ultimoLogFilaJson = () => logsStorage.filter(item => item.arquivo === "fila.json").at(-1) || {};

  assert.strictEqual(lerAtual()[0].status, "processando", "arquivo final deve receber nova versao");
  assert.strictEqual(lerBackup()[0].status, "pendente", "backup deve preservar versao anterior");
  assert.strictEqual(copyFileSyncChamadas, 0, "backup por hardlink nao deve copiar arquivo inteiro quando disponivel");
  assert.strictEqual(ultimoLogFilaJson().backupMetodo, "hardlink", "segundo save deve usar hardlink");

  storage.writeClienteJson(cliente, "fila.json", terceiro);
  assert.strictEqual(lerAtual()[0].status, "enviado", "terceiro save deve publicar versao atual");
  assert.strictEqual(lerBackup()[0].status, "processando", "terceiro save deve preservar versao imediatamente anterior");
  assert.strictEqual(copyFileSyncChamadas, 0, "terceiro save nao deve cair para copy com .bak existente");
  assert.strictEqual(ultimoLogFilaJson().backupMetodo, "hardlink", "terceiro save com .bak existente deve continuar hardlink");

  fs.linkSync = () => {
    throw new Error("hardlink_indisponivel");
  };
  storage.writeClienteJson(cliente, "fila.json", [{ id: "oferta_1", clienteId: cliente, status: "erro" }]);
  const atualFallback = lerAtual();
  const backupFallback = lerBackup();

  assert.strictEqual(atualFallback[0].status, "erro", "fallback deve gravar arquivo final");
  assert.strictEqual(backupFallback[0].status, "enviado", "fallback por copia deve preservar versao anterior");
  assert.strictEqual(copyFileSyncChamadas, 1, "fallback deve copiar quando hardlink nao esta disponivel");
  assert.strictEqual(ultimoLogFilaJson().backupMetodo, "copy", "fallback deve ser observavel como copy");

  fs.linkSync = linkSyncOriginal;
  storage.writeClienteJson(cliente, "manual_ofertas_v2.json", [{ id: "manual_1", clienteId: cliente, status: "rascunho" }]);
  storage.writeClienteJson(cliente, "manual_ofertas_v2.json", [{ id: "manual_1", clienteId: cliente, status: "salva" }]);
  assert.strictEqual(copyFileSyncChamadas, 2, "hardlink deve ficar restrito ao fila.json");

  const clienteFallback = "cliente_storage_fallback";
  const itemV0 = { id: "oferta_fb", clienteId: clienteFallback, status: "v0" };
  const itemV1 = { id: "oferta_fb", clienteId: clienteFallback, status: "v1" };
  const itemV2 = { id: "oferta_fb", clienteId: clienteFallback, status: "v2" };
  const getFilaFile = id => storage.getClienteJsonPath(id, "fila.json");
  storage.writeClienteJson(clienteFallback, "fila.json", [itemV0]);
  storage.writeClienteJson(clienteFallback, "fila.json", [itemV1]);
  const filaFallbackPath = getFilaFile(clienteFallback);
  const bakFallbackPath = `${filaFallbackPath}.bak`;
  const backupAntesFallback = fs.readFileSync(bakFallbackPath, "utf8");
  let escreveuDiretoNoFinal = false;
  const writeFileSyncOriginal = fs.writeFileSync;
  fs.writeFileSync = (file, ...args) => {
    if (path.resolve(String(file || "")) === path.resolve(filaFallbackPath)) {
      escreveuDiretoNoFinal = true;
    }
    return writeFileSyncOriginal(file, ...args);
  };
  try {
    const okFallback = filaOfertas.salvarFila({
      fila: [itemV2],
      clienteId: clienteFallback,
      getFilaFile
    });
    assert.strictEqual(okFallback, true, "fallback deve salvar com sucesso");
  } finally {
    fs.writeFileSync = writeFileSyncOriginal;
  }

  assert.strictEqual(escreveuDiretoNoFinal, false, "fallback nao pode escrever diretamente no fila.json final");
  assert.strictEqual(JSON.parse(fs.readFileSync(filaFallbackPath, "utf8"))[0].status, "v2", "fallback deve publicar versao nova");
  assert.strictEqual(fs.readFileSync(bakFallbackPath, "utf8"), backupAntesFallback, "fallback por rename nao pode alterar bak hardlinkado existente");
} finally {
  fs.copyFileSync = copyFileSyncOriginal;
  fs.linkSync = linkSyncOriginal;
  console.log = consoleLogOriginal;
  fs.rmSync(dataDir, { recursive: true, force: true });
}

console.log("storage-write-atomic.test.js OK");
