"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const filaOperacionalV2 = require("../modules/fila/fila-operacional-v2");

const AGORA = new Date("2026-08-26T14:00:00.000Z").getTime();

function criarStorage() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "proof-mismatch-observability-"));
  const getClienteJsonPath = (clienteId, arquivo) => path.join(dir, clienteId, arquivo);
  return { dir, getClienteJsonPath };
}

function escreverJson(storage, cliente, arquivo, valor) {
  const destino = storage.getClienteJsonPath(cliente, arquivo);
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.writeFileSync(destino, JSON.stringify(valor), "utf8");
  return destino;
}

function proof(clienteId, arquivo, generation, fileRevision, size, mtimeMs, publishedAt = null) {
  return {
    proofVersion: 1,
    clienteId,
    arquivo,
    generation,
    targetGeneration: generation,
    fileRevision,
    size,
    mtimeMs,
    ...(publishedAt ? { publishedAt } : {})
  };
}

async function main() {
  const cliente = "user_b2oogwwl";
  const storage = criarStorage();
  const vivaPath = escreverJson(storage, cliente, "fila-viva.json", [{ id: "viva" }]);
  const legadoPath = escreverJson(storage, cliente, "fila.json", [{ id: "legado" }]);
  const vivaStat = fs.statSync(vivaPath);
  const legadoStat = fs.statSync(legadoPath);
  const checkpointId = "checkpoint-proof-7";
  const vivaDbProof = proof(cliente, "fila-viva.json", 7, "viva-db-7", vivaStat.size, vivaStat.mtimeMs);
  const legacyProof = proof(cliente, "fila.json", 7, checkpointId, legadoStat.size, legadoStat.mtimeMs);

  escreverJson(storage, cliente, "fila-v2-manifest.json", {
    manifestVersion: 2,
    vivaGeneration: 7,
    durableCheckpointGeneration: 7,
    dirtyGeneration: null
  });
  escreverJson(storage, cliente, "fila-viva.proof.json", proof(
    cliente,
    "fila-viva.json",
    6,
    "viva-file-6",
    999,
    AGORA - 300,
    new Date(AGORA - 300).toISOString()
  ));
  escreverJson(storage, cliente, "fila.proof.json", legacyProof);

  const state = {
    clienteId: cliente,
    revision: 10,
    vivaGeneration: 7,
    durableCheckpointGeneration: 7,
    dirtyGeneration: null,
    authorityReady: true,
    authorityReadyGeneration: 7,
    authorityReadyRevision: 10,
    pendingCheckpointRevision: "",
    pendingCheckpointTargetGeneration: null,
    vivaFileProof: vivaDbProof,
    legacyFileProof: legacyProof
  };
  const repo = {
    obterUltimoCheckpointConfirmado() {
      return {
        confirmedAtMs: AGORA - 1200,
        checkpointRevision: checkpointId,
        targetGeneration: 7
      };
    },
    async avaliarAutoridadeRecovery(clienteId, dados) {
      const validacao = await dados.validarEstadoFisico({ clienteId, state });
      return {
        ok: true,
        conclusiva: validacao.ok === true,
        fallbackMtime: validacao.ok !== true,
        motivo: validacao.motivo || "ok",
        state,
        validacao
      };
    }
  };
  const env = {
    FILA_V2_RECOVERY_AUTORIDADE: "generation",
    FILA_V2_OPERACIONAL_ROLLOUT: "canary",
    FILA_V2_OPERACIONAL_CANARY_CLIENTES: cliente,
    FILA_V2_EXECUTOR_GENERATION_AUTHORITY: "1",
    FILA_V2_EXECUTOR_GENERATION_CANARY_CLIENTES: cliente
  };
  const logs = [];
  const logger = {
    log(tag, payload) {
      if (tag === filaOperacionalV2.TAG_MANIFEST_STATE) logs.push(JSON.parse(payload));
    }
  };
  const deps = {
    getClienteJsonPath: storage.getClienteJsonPath,
    manifestStateRepository: repo,
    env,
    logger,
    agora: AGORA
  };

  const resultado = await filaOperacionalV2.reconciliarFilaV2ParaLeitura(
    cliente,
    { contexto: "executor_preflight" },
    deps
  );
  const telemetry = resultado.validacaoGeneration.proofMismatchTelemetry;

  assert.strictEqual(resultado.autoridadeUsada, "mtime");
  assert.strictEqual(resultado.motivo, "viva_proof_mismatch");
  assert.strictEqual(telemetry.workspaceKey.length, 12);
  assert.strictEqual(telemetry.dbVivaGeneration, 7);
  assert.strictEqual(telemetry.dbDurableCheckpointGeneration, 7);
  assert.strictEqual(telemetry.dbDirtyGeneration, null);
  assert.strictEqual(telemetry.fileRevision, "viva-db-7");
  assert.strictEqual(telemetry.proofPresent, true);
  assert.strictEqual(telemetry.proofGeneration, 6);
  assert.strictEqual(telemetry.proofFileRevision, "viva-file-6");
  assert.strictEqual(telemetry.proofSize, 999);
  assert.strictEqual(telemetry.proofMtimeMs, AGORA - 300);
  assert.strictEqual(typeof telemetry.proofFileMtimeMs, "number");
  assert.strictEqual(telemetry.statSize, vivaStat.size);
  assert.strictEqual(typeof telemetry.statMtimeMs, "number");
  assert.strictEqual(telemetry.lastCheckpointConfirmedAgeMs, 1200);
  assert.strictEqual(telemetry.lastCheckpointConfirmedId, checkpointId);
  assert.strictEqual(telemetry.proofAgeMs, 300);
  assert.strictEqual(telemetry.rejectionReason, "proof_arquivo_generation_mismatch");
  assert.strictEqual(typeof telemetry.observedAtUtc, "string");
  assert.strictEqual(typeof telemetry.observedMonotonicNs, "string");
  assert.strictEqual(logs.length, 1);
  assert.deepStrictEqual(logs[0].proofMismatchTelemetry, telemetry);

  const offCanary = await filaOperacionalV2.reconciliarFilaV2ParaLeitura(
    cliente,
    { contexto: "radar" },
    { ...deps, env: { ...env, FILA_V2_EXECUTOR_GENERATION_AUTHORITY: "0" } }
  );
  assert.strictEqual(offCanary.motivo, "viva_proof_mismatch");
  assert.strictEqual(offCanary.validacaoGeneration.proofMismatchTelemetry, undefined);

  fs.unlinkSync(storage.getClienteJsonPath(cliente, "fila-viva.proof.json"));
  const ausente = await filaOperacionalV2.reconciliarFilaV2ParaLeitura(
    cliente,
    { contexto: "executor_preflight" },
    deps
  );
  const ausenteTelemetry = ausente.validacaoGeneration.proofMismatchTelemetry;

  assert.strictEqual(ausente.autoridadeUsada, "mtime");
  assert.strictEqual(ausente.motivo, "viva_proof_ausente");
  assert.strictEqual(ausenteTelemetry.proofPresent, false);
  assert.strictEqual(ausenteTelemetry.proofGeneration, null);
  assert.strictEqual(ausenteTelemetry.proofFileRevision, null);
  assert.strictEqual(ausenteTelemetry.proofSize, null);
  assert.strictEqual(ausenteTelemetry.proofMtimeMs, null);
  assert.strictEqual(ausenteTelemetry.proofFileMtimeMs, null);
  assert.strictEqual(ausenteTelemetry.statSize, vivaStat.size);
  assert.strictEqual(typeof ausenteTelemetry.statMtimeMs, "number");
  assert.strictEqual(ausenteTelemetry.lastCheckpointConfirmedAgeMs, 1200);
  assert.strictEqual(ausenteTelemetry.lastCheckpointConfirmedId, checkpointId);
  assert.strictEqual(ausenteTelemetry.rejectionReason, "proof_ausente");

  const ausenteOffCanary = await filaOperacionalV2.reconciliarFilaV2ParaLeitura(
    cliente,
    { contexto: "radar" },
    { ...deps, env: { ...env, FILA_V2_EXECUTOR_GENERATION_AUTHORITY: "0" } }
  );
  assert.strictEqual(ausenteOffCanary.motivo, "viva_proof_ausente");
  assert.strictEqual(ausenteOffCanary.validacaoGeneration.proofMismatchTelemetry, undefined);

  console.log("fila-proof-mismatch-observability.test.js OK");
}

main().catch(erro => {
  console.error(erro);
  process.exitCode = 1;
});
