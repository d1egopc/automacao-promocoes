"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { runAdminCheckpointResume, expectedFromState, parseCliArgs } = require("../scripts/checkpoint-resume-admin.cjs");

function state(overrides = {}) {
  return {
    revision: 113520,
    vivaGeneration: 85681,
    durableCheckpointGeneration: 85675,
    dirtyGeneration: 85676,
    authorityReady: false,
    pendingCheckpointRevision: "f9d58827-784e-466f-b290-e0df0cbb6842",
    pendingCheckpointTargetGeneration: 85681,
    ...overrides
  };
}

function fixture() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "checkpoint-resume-admin-"));
  const clientDir = path.join(dataDir, "clientes", "user_b2oogwwl");
  fs.mkdirSync(clientDir, { recursive: true });
  const legacy = path.join(clientDir, "fila.json");
  const viva = path.join(clientDir, "fila-viva.json");
  fs.writeFileSync(legacy, JSON.stringify([{ id: "legacy-105447", imagem: "protected" }]));
  fs.writeFileSync(viva, JSON.stringify([{ id: "viva-105447" }]));
  const proofFor = (file, arquivo, generation, fileRevision) => {
    const stat = fs.statSync(file);
    const contentHash = require("node:crypto").createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    return { proofVersion: 1, clienteId: "user_b2oogwwl", arquivo, generation,
      fileRevision, contentHash, size: stat.size, mtimeMs: stat.mtimeMs,
      publishedAt: "2026-10-22T00:00:00.000Z" };
  };
  const vivaProof = proofFor(viva, "fila-viva.json", 85681, "viva-revision-85681");
  const legacyProof = proofFor(legacy, "fila.json", 85675, "legacy-revision-85675");
  const legacyConfirmed = proofFor(legacy, "fila.json", 85681, "legacy-revision-85681");
  fs.writeFileSync(path.join(clientDir, "fila-viva.proof.json"), JSON.stringify(vivaProof));
  fs.writeFileSync(path.join(clientDir, "fila.proof.json"), JSON.stringify(legacyProof));
  return { dataDir, clientDir, proofs: { vivaProof, legacyProof, legacyConfirmed } };
}

function apiHarness(events, states) {
  let readCount = 0;
  return {
    readState: async () => ({ ok: true, state: states[Math.min(readCount++, states.length - 1)] }),
    api: {
      repo: {},
      fila: {
        capturarTargetCheckpointCoordenado: async (_cliente, dados) => {
          events.push(["capture", dados]);
          return { ok: true, retomado: true, checkpointRevision: dados.checkpointRevision, targetGeneration: dados.expectedTargetGeneration };
        },
        confirmarCheckpointCoordenado: async (_cliente, dados) => {
          events.push(["confirm", dados.checkpointRevision, dados.targetGeneration]);
          const published = await dados.publicarCheckpoint({});
          events.push(["published", published?.ok]);
          return { ok: true, dbState: { ...states[0], durableCheckpointGeneration: 85681, pendingCheckpointRevision: null } };
        },
        reconstruirProjecaoLeveAposCheckpoint: async (_cliente, params) => {
          events.push(["projection", params.checkpointRevision, params.targetGeneration]);
          assert.equal(params.checkpointSnapshot.contentHash, "a".repeat(64));
          return { ok: true, motivo: "projecao_checkpoint_confirmada" };
        },
        prepararReadinessAutoridadeRecovery: async (_cliente, deps) => {
          events.push(["readiness", deps.expectedRevision]);
          return { ok: true, ready: true };
        }
      },
      buildIndex: async () => {
        events.push(["index"]);
        return { complete: true, refsCount: 665, refs: new Map([["protected", { count: 1 }]]) };
      }
    }
  };
}

test("a mesma pending revision e target sao retomados, nunca substituidos", async () => {
  const f = fixture();
  const events = [];
  const beforeState = state({ vivaFileProof: f.proofs.vivaProof, legacyFileProof: f.proofs.legacyProof });
  const afterState = { ...beforeState, revision: 113521, durableCheckpointGeneration: 85681,
    dirtyGeneration: null, pendingCheckpointRevision: null, pendingCheckpointTargetGeneration: null,
    legacyFileProof: f.proofs.legacyConfirmed, authorityReady: false };
  const finalState = { ...afterState, revision: 113522, authorityReady: true };
  const h = apiHarness(events, [beforeState, afterState, finalState]);
  const persistence = {
    prepare: async () => ({
      ok: true, tempIdentity: { size: 1, mtimeMs: 1, dev: 1, ino: 1 },
      sourceRevisions: {}, itens: 877,
      checkpointProjection: { contentHash: "a".repeat(64), projecao: { clienteId: "user_b2oogwwl", versao: 1, total: 1, itens: [] }, hashes: [] }
    }),
    publish: async () => {
      fs.writeFileSync(path.join(f.clientDir, "fila.proof.json"), JSON.stringify(f.proofs.legacyConfirmed));
      return { ok: true, legacyFileProof: f.proofs.legacyConfirmed };
    },
    shutdown: async () => { events.push(["shutdown"]); }
  };
  const result = await runAdminCheckpointResume({
    dataDir: f.dataDir, clienteId: "user_b2oogwwl", expectedRevision: state().pendingCheckpointRevision,
    expectedTargetGeneration: 85681, expectedReferenceCount: 665, expectedProtectedHash: "protected",
    execute: true, authorization: "true", readState: h.readState, api: h.api, persistence
  });
  assert.equal(result.ok, true);
  assert.deepEqual(events.map(item => item[0]), ["capture", "confirm", "published", "projection", "index", "readiness", "shutdown"]);
  assert.equal(events.find(item => item[0] === "readiness")[1], afterState.revision);
  fs.rmSync(f.dataDir, { recursive: true, force: true });
});

test("revisao diferente e bloqueada sem tocar fontes", async () => {
  const f = fixture();
  let captureCalled = false;
  const result = await runAdminCheckpointResume({
    dataDir: f.dataDir, clienteId: "user_b2oogwwl", expectedRevision: "outra-revisao-0000",
    expectedTargetGeneration: 85681, execute: true, authorization: "true",
    readState: async () => ({ ok: true, state: state() }),
    api: { repo: {}, fila: { capturarTargetCheckpointCoordenado: async () => { captureCalled = true; } } }
  });
  assert.equal(result.ok, false);
  assert.equal(result.stage, "preflight");
  assert.equal(captureCalled, false);
  fs.rmSync(f.dataDir, { recursive: true, force: true });
});

test("falha entre prepare e confirmacao limpa temporario e nao agenda readiness", async () => {
  const f = fixture();
  const events = [];
  const h = apiHarness(events, [state()]);
  const persistence = {
    prepare: async () => ({
      ok: true, tempIdentity: { size: 1, mtimeMs: 1, dev: 1, ino: 1 }, sourceRevisions: {}, itens: 877,
      checkpointProjection: { contentHash: "a".repeat(64), projecao: { clienteId: "user_b2oogwwl", versao: 1, total: 0, itens: [] }, hashes: [] }
    }),
    publish: async () => { throw new Error("publish_interrupted"); },
    cleanup: async () => { events.push(["cleanup"]); },
    shutdown: async () => { events.push(["shutdown"]); }
  };
  const result = await runAdminCheckpointResume({
    dataDir: f.dataDir, clienteId: "user_b2oogwwl", expectedRevision: state().pendingCheckpointRevision,
    expectedTargetGeneration: 85681, execute: true, authorization: "true", readState: h.readState, api: h.api, persistence
  });
  assert.equal(result.ok, false);
  assert.equal(result.stage, "confirm");
  assert.ok(events.some(item => item[0] === "cleanup"));
  assert.ok(!events.some(item => item[0] === "readiness"));
  fs.rmSync(f.dataDir, { recursive: true, force: true });
});

test("dry-run e somente leitura e exige estado pendente atual", async () => {
  assert.deepEqual(expectedFromState(state(), { revision: state().pendingCheckpointRevision, target: 85681 }), {
    revision: state().pendingCheckpointRevision, target: 85681
  });
  const f = fixture();
  const result = await runAdminCheckpointResume({
    dataDir: f.dataDir, clienteId: "user_b2oogwwl", expectedRevision: state().pendingCheckpointRevision,
    expectedTargetGeneration: 85681, execute: false, readState: async () => ({ ok: true, state: state() })
  });
  assert.equal(result.ok, true);
  assert.equal(result.dryRun, true);
  fs.rmSync(f.dataDir, { recursive: true, force: true });
});

test("CLI exige workspace, revisao, target, cobertura e hash protegido", () => {
  const completo = parseCliArgs([
    "--workspace", "user_b2oogwwl",
    "--pending-revision", "f9d58827-784e-466f-b290-e0df0cbb6842",
    "--target-generation", "85681",
    "--expected-reference-count", "665",
    "--protected-hash", "3ef0ca2dde2f527613a9565d9855cbba6830ef61606e273776df063840fb30cc",
    "--execute"
  ], { CHECKPOINT_ADMIN_EXECUTE: "true" });
  assert.equal(completo.ok, true);
  assert.equal(completo.options.execute, true);
  assert.equal(parseCliArgs(["--execute"], {}).ok, false);
});

console.log("checkpoint-resume-admin.test.cjs OK");
