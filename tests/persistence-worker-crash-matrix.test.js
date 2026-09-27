"use strict";

// Fault-injection tests for the coordinator contract. All workers are created
// under the OS temp dir and are removed after each case.
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { criarCoordenadorPersistencia } = require("../modules/fila/persistence-coordinator");

function fixture(root) {
  const clienteId = "workspace-crash-matrix";
  const dir = path.join(root, "clientes", clienteId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "fila.json"), JSON.stringify([
    { id: "a", clienteId, status: "pendente" }
  ], null, 2));
  fs.writeFileSync(path.join(dir, "fila-viva.json"), "[]");
  return { clienteId, dir, fila: path.join(dir, "fila.json") };
}

function env(root, timeout = 2000) {
  return {
    ...process.env,
    DATA_DIR: root,
    FILA_PERSISTENCE_WORKER: "1",
    FILA_PERSISTENCE_WORKER_TIMEOUT_MS: String(timeout)
  };
}

function workerFile(root, source) {
  const file = path.join(root, `fault-${Date.now()}-${Math.random().toString(16).slice(2)}.js`);
  fs.writeFileSync(file, source, "utf8");
  return file;
}

async function runCrash(root, fixtureData) {
  const file = workerFile(root, "require('worker_threads').parentPort.on('message', () => process.exit(42));");
  const coordinator = criarCoordenadorPersistencia({
    env: env(root),
    workerPath: file,
    logger: { log() {} }
  });
  try {
    const result = await coordinator.prepare({
      clienteId: fixtureData.clienteId,
      checkpointRevision: "crash-matrix-0001",
      dataDir: root
    });
    assert.strictEqual(result.ok, false);
    assert.ok(["worker_exit", "worker_error"].includes(result.motivo));
    assert.strictEqual(coordinator.getState().circuitOpen, true);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(fixtureData.fila, "utf8")), [
      { id: "a", clienteId: fixtureData.clienteId, status: "pendente" }
    ]);
  } finally {
    await coordinator.shutdown();
    fs.rmSync(file, { force: true });
  }
}

async function runTimeout(root, fixtureData) {
  const file = workerFile(root, "require('worker_threads').parentPort.on('message', () => {});");
  const coordinator = criarCoordenadorPersistencia({
    env: env(root, 1000),
    workerPath: file,
    logger: { log() {} }
  });
  try {
    const result = await coordinator.prepare({
      clienteId: fixtureData.clienteId,
      checkpointRevision: "timeout-matrix-0001",
      dataDir: root
    });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.motivo, "worker_timeout");
    assert.strictEqual(coordinator.getState().circuitOpen, true);
  } finally {
    await coordinator.shutdown();
    fs.rmSync(file, { force: true });
  }
}

async function runTempWriteFailure(root, fixtureData) {
  const tempPath = path.join(fixtureData.dir, "fila.json.tmp.temp-matrix-0001");
  let file = null;
  if (process.platform === "win32") {
    file = workerFile(root, [
      "const { parentPort } = require('worker_threads');",
      "parentPort.on('message', job => parentPort.postMessage({ type: 'persistence_error', jobId: job.jobId, error: { code: 'TEMP_WRITE_FAILED', message: 'injected_temp_write_failure' } }));"
    ].join("\n"));
  } else {
    fs.mkdirSync(tempPath);
  }
  const coordinator = criarCoordenadorPersistencia({ env: env(root), workerPath: file || undefined, logger: { log() {} } });
  try {
    const result = await coordinator.prepare({
      clienteId: fixtureData.clienteId,
      checkpointRevision: "temp-matrix-0001",
      dataDir: root
    });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(coordinator.getState().circuitOpen, true);
    assert.strictEqual(fs.existsSync(fixtureData.fila), true);
  } finally {
    await coordinator.shutdown();
    fs.rmSync(tempPath, { recursive: true, force: true });
    if (file) fs.rmSync(file, { force: true });
  }
}

async function runAfterRenameExit(root, fixtureData) {
  const prep = criarCoordenadorPersistencia({ env: env(root), logger: { log() {} } });
  const prepared = await prep.prepare({
    clienteId: fixtureData.clienteId,
    checkpointRevision: "rename-matrix-0001",
    dataDir: root
  });
  assert.strictEqual(prepared.ok, true);
  await prep.shutdown();

  const source = [
    "const fs = require('fs');",
    "const path = require('path');",
    "const { parentPort } = require('worker_threads');",
    "parentPort.on('message', job => {",
    "  const dir = path.join(job.dataDir, 'clientes', job.clienteId);",
    "  fs.renameSync(path.join(dir, 'fila.json.tmp.' + job.checkpointRevision), path.join(dir, 'fila.json'));",
    "  process.exit(43);",
    "});"
  ].join("\n");
  const file = workerFile(root, source);
  const publish = criarCoordenadorPersistencia({ env: env(root), workerPath: file, logger: { log() {} } });
  try {
    const result = await publish.publish({
      clienteId: fixtureData.clienteId,
      checkpointRevision: "rename-matrix-0001",
      targetGeneration: 1,
      dataDir: root,
      tempIdentity: prepared.tempIdentity,
      expectedSourceRevisions: prepared.sourceRevisions
    });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(publish.getState().circuitOpen, true);
    assert.strictEqual(fs.existsSync(fixtureData.fila), true);
  } finally {
    await publish.shutdown();
    fs.rmSync(file, { force: true });
  }
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fila-persistence-crash-matrix-"));
  try {
    const primeira = fixture(root);
    await runCrash(root, primeira);
    const segunda = fixture(root);
    await runTimeout(root, segunda);
    const terceira = fixture(root);
    await runTempWriteFailure(root, terceira);
    const quarta = fixture(root);
    await runAfterRenameExit(root, quarta);
    const encerrando = criarCoordenadorPersistencia({ env: env(root), logger: { log() {} } });
    await encerrando.shutdown({ timeoutMs: 1000 });
    console.log("persistence-worker-crash-matrix: OK (crash/read-parse/temp/rename/timeout/shutdown)");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch(erro => {
  console.error(erro);
  process.exitCode = 1;
});
