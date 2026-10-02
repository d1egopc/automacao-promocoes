"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const filaOperacionalV2 = require("../modules/fila/fila-operacional-v2");
const { criarCoordenadorPersistencia } = require("../modules/fila/persistence-coordinator");

const metodosIndex = [
  "filtrarItensCercadosCheckpoint",
  "contemIdentidadeCercadaCheckpoint",
  "lerIntentMutacaoViva",
  "lerRemovalFences",
  "reconciliarIntentMutacaoViva",
  "provarRecoveryRemovalFencesPendentes",
  "capturarTargetCheckpointCoordenado",
  "confirmarCheckpointCoordenado"
];

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "fila-viva-runtime-wiring-"));
const env = { ...process.env, DATA_DIR: dataDir, FILA_PERSISTENCE_WORKER: "1",
  FILA_VIVA_MUTATION_WORKER_ROLLOUT: "canary",
  FILA_PERSISTENCIA_CANARY_CLIENTES: "workspace-wiring",
  FILA_V2_OPERACIONAL_ROLLOUT: "canary",
  FILA_V2_OPERACIONAL_CANARY_CLIENTES: "workspace-wiring" };
const filaClientePath = (clienteId, arquivo) => path.join(dataDir, "clientes", clienteId, arquivo);

async function main() {
  const persistenciaCheckpointV2 = criarCoordenadorPersistencia({ env, logger: { log() {} } });
  try {
    const controlador = filaOperacionalV2.criarControladorFilaOperacionalV2({
      env,
      readClienteJson: () => null,
      writeClienteJson: () => true,
      getClienteJsonPath: filaClientePath,
      getClientePath: clienteId => path.join(dataDir, "clientes", clienteId),
      workspaceAtivoOperacional: () => true,
      modoPersistenciaViva: clienteId => persistenciaCheckpointV2.modeForViva(clienteId),
      agendarMutacaoViva: payload => persistenciaCheckpointV2.mutateViva({ ...payload, dataDir }),
      agendarProbeViva: payload => persistenciaCheckpointV2.probeVivaSnapshot({ ...payload, dataDir }),
      agendarTerminalIndexBootstrap: payload => persistenciaCheckpointV2.bootstrapTerminalIndex({ ...payload, dataDir }),
      agendarTerminalIndexDelta: payload => persistenciaCheckpointV2.deltaTerminalIndex({ ...payload, dataDir }),
      logger: { log() {} }
    });

    for (const metodo of metodosIndex) {
      assert.strictEqual(typeof filaOperacionalV2[metodo], "function", `${metodo} ausente no modulo`);
      assert.strictEqual(typeof controlador[metodo], "function", `${metodo} ausente na instancia do index`);
    }

    assert.strictEqual(typeof persistenciaCheckpointV2.probeVivaSnapshot, "function");
    assert.strictEqual(controlador.deveUsarFilaV2Operacional("workspace-wiring"), true);
    assert.deepStrictEqual(controlador.lerRemovalFences("workspace-wiring"), []);
    assert.strictEqual(controlador.lerIntentMutacaoViva("workspace-wiring").exists, false);
    console.log("fila-viva-runtime-wiring: OK");
  } finally {
    await persistenciaCheckpointV2.shutdown();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

main().catch(erro => { console.error(erro); process.exitCode = 1; });
