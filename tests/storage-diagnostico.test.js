const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { Worker } = require("worker_threads");

const storagePath = path.resolve(__dirname, "..", "utils", "storage.js");
const storageSource = fs.readFileSync(storagePath, "utf8");
const ENV_NAMES = [
  "DATA_DIR",
  "PERF_STORAGE_MIN_MS",
  "PERF_STORAGE_DIAGNOSTICO",
  "PERF_STORAGE_DIAGNOSTICO_MIN_MS",
  "PERF_STORAGE_DIAGNOSTICO_MIN_BYTES"
];

function snapshotEnv() {
  return Object.fromEntries(ENV_NAMES.map(nome => [nome, process.env[nome]]));
}

function restoreEnv(snapshot) {
  for (const nome of ENV_NAMES) {
    if (snapshot[nome] === undefined) delete process.env[nome];
    else process.env[nome] = snapshot[nome];
  }
}

function configureEnv(dataDir, overrides = {}) {
  process.env.DATA_DIR = dataDir;
  process.env.PERF_STORAGE_MIN_MS = overrides.PERF_STORAGE_MIN_MS ?? "1000000000";
  process.env.PERF_STORAGE_DIAGNOSTICO = overrides.PERF_STORAGE_DIAGNOSTICO ?? "0";
  process.env.PERF_STORAGE_DIAGNOSTICO_MIN_MS = overrides.PERF_STORAGE_DIAGNOSTICO_MIN_MS ?? "100";
  process.env.PERF_STORAGE_DIAGNOSTICO_MIN_BYTES = overrides.PERF_STORAGE_DIAGNOSTICO_MIN_BYTES ?? "16777216";
}

function loadStorage(dataDir, overrides = {}) {
  configureEnv(dataDir, overrides);
  delete require.cache[require.resolve(storagePath)];
  return require(storagePath);
}

function captureLogs(callback) {
  const logs = [];
  const original = console.log;
  console.log = (...args) => logs.push(args.join(" "));
  try {
    return { result: callback(), logs };
  } finally {
    console.log = original;
  }
}

function diagnosticEntries(logs) {
  return logs
    .filter(line => line.startsWith("[PERF STORAGE DIAGNOSTICO]"))
    .map(line => JSON.parse(line.slice(line.indexOf("{") )));
}

function assertSanitized(entries, rawWorkspace) {
  assert(entries.length > 0, "esperava ao menos uma entrada diagnóstica");
  for (const entry of entries) {
    const texto = JSON.stringify(entry);
    assert(!texto.includes(rawWorkspace), "workspace bruto apareceu no diagnóstico");
    assert(!texto.includes("DATA_DIR"), "caminho físico apareceu no diagnóstico");
    assert.equal(entry.arquivo, path.basename(entry.arquivo));
    assert.equal(typeof entry.timestamp, "string");
    assert.equal(typeof entry.workspaceHash, "string");
    assert.match(entry.workspaceHash, /^[a-f0-9]{12}$/);
    assert.equal(typeof entry.callerTag, "string");
    assert(!path.isAbsolute(entry.callerTag), "callerTag contém caminho absoluto");
  }
}

async function runWorker(dataDir) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(`
      const { parentPort, workerData, isMainThread, threadId } = require("worker_threads");
      process.env.DATA_DIR = workerData.dataDir;
      process.env.PERF_STORAGE_MIN_MS = "1000000000";
      process.env.PERF_STORAGE_DIAGNOSTICO = "1";
      process.env.PERF_STORAGE_DIAGNOSTICO_MIN_MS = "1000000000";
      process.env.PERF_STORAGE_DIAGNOSTICO_MIN_BYTES = "1";
      const storage = require(workerData.storagePath);
      const logs = [];
      console.log = (...args) => logs.push(args.join(" "));
      storage.writeClienteJson("worker-privado", "worker.json", { ok: true });
      parentPort.postMessage({ logs, isMainThread, threadId });
    `, { eval: true, workerData: { dataDir, storagePath } });

    worker.once("message", value => {
      worker.terminate().finally(() => resolve(value));
    });
    worker.once("error", reject);
  });
}

async function main() {
  const envSnapshot = snapshotEnv();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "storage-diagnostico-"));
  const rawWorkspace = "workspace-privado-123";

  try {
    {
      const storage = loadStorage(tempDir, { PERF_STORAGE_DIAGNOSTICO: "0" });
      const captured = captureLogs(() => {
        storage.writeClienteJson(rawWorkspace, "amostra.json", { valor: 7 });
        return storage.readClienteJson(rawWorkspace, "amostra.json", {});
      });
      assert.deepEqual(captured.result, { valor: 7, clienteId: rawWorkspace });
      assert.equal(diagnosticEntries(captured.logs).length, 0, "flag OFF emitiu diagnóstico");
    }

    {
      const storage = loadStorage(tempDir, {
        PERF_STORAGE_DIAGNOSTICO: "1",
        PERF_STORAGE_DIAGNOSTICO_MIN_MS: "1000000000",
        PERF_STORAGE_DIAGNOSTICO_MIN_BYTES: "1"
      });
      const captured = captureLogs(() => {
        storage.writeClienteJson(rawWorkspace, "amostra.json", { valor: 8 });
        const lido = storage.readClienteJson(rawWorkspace, "amostra.json", {});
        storage.writeGlobalJson("global.json", { global: true });
        return lido;
      });
      const entries = diagnosticEntries(captured.logs);
      assert.deepEqual(captured.result, { valor: 8, clienteId: rawWorkspace });
      assertSanitized(entries.filter(entry => entry.workspaceHash), rawWorkspace);
      const global = entries.find(entry => entry.arquivo === "global.json");
      assert(global, "diagnóstico global ausente");
      assert.equal(global.workspaceHash, null, "arquivo global recebeu workspace hash");
      for (const entry of entries.filter(item => item.workspaceHash)) {
        assert.equal(entry.isMainThread, true);
        assert.equal(entry.threadId, 0);
      }
    }

    {
      const storage = loadStorage(tempDir, {
        PERF_STORAGE_DIAGNOSTICO: "1",
        PERF_STORAGE_DIAGNOSTICO_MIN_MS: "1000000000",
        PERF_STORAGE_DIAGNOSTICO_MIN_BYTES: "1000000000"
      });
      const captured = captureLogs(() => storage.writeGlobalJson("threshold.json", { pequeno: true }));
      assert.equal(diagnosticEntries(captured.logs).length, 0, "limiares bloquearam incorretamente");
    }

    {
      const storage = loadStorage(tempDir, {
        PERF_STORAGE_DIAGNOSTICO: "1",
        PERF_STORAGE_DIAGNOSTICO_MIN_MS: "0",
        PERF_STORAGE_DIAGNOSTICO_MIN_BYTES: "1000000000"
      });
      const captured = captureLogs(() => storage.writeGlobalJson("duration.json", { pequeno: true }));
      assert(diagnosticEntries(captured.logs).length > 0, "limiar de duração não funcionou");
    }

    {
      const storage = loadStorage(tempDir, {
        PERF_STORAGE_DIAGNOSTICO: "1",
        PERF_STORAGE_DIAGNOSTICO_MIN_MS: "1000000000",
        PERF_STORAGE_DIAGNOSTICO_MIN_BYTES: "1"
      });
      const original = console.log;
      console.log = (...args) => {
        if (String(args[0]).includes("PERF STORAGE DIAGNOSTICO")) {
          throw new Error("falha_sintetica_do_logger");
        }
        return original(...args);
      };
      try {
        storage.writeClienteJson(rawWorkspace, "erro-diagnostico.json", { preservado: true });
        assert.deepEqual(
          storage.readClienteJson(rawWorkspace, "erro-diagnostico.json", {}),
          { preservado: true, clienteId: rawWorkspace }
        );
      } finally {
        console.log = original;
      }
    }

    {
      const workerResult = await runWorker(tempDir);
      const entries = diagnosticEntries(workerResult.logs);
      assert.equal(workerResult.isMainThread, false);
      assert(workerResult.threadId > 0, "worker threadId inválido");
      assert(entries.length > 0, "worker não emitiu diagnóstico");
      assert(entries.every(entry => entry.isMainThread === false));
      assert(entries.every(entry => entry.threadId === workerResult.threadId));
      assertSanitized(entries, "worker-privado");
    }

    assert(!storageSource.includes("setInterval("), "instrumentação adicionou timer");
    assert(!storageSource.includes("setTimeout("), "instrumentação adicionou timeout");
    assert(!storageSource.includes("process.on("), "instrumentação adicionou listener de processo");
    console.log("storage-diagnostico: OK");
  } finally {
    restoreEnv(envSnapshot);
    delete require.cache[require.resolve(storagePath)];
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
