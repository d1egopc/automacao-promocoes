"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { runAdminCheckpointResume, expectedFromState } = require("../scripts/checkpoint-resume-admin.cjs");

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
  fs.writeFileSync(path.join(clientDir, "fila.json"), JSON.stringify([{ id: "legacy-105447", imagem: "protected" }]));
  fs.writeFileSync(path.join(clientDir, "fila-viva.json"), JSON.stringify([{ id: "viva-105447" }]));
  return { dataDir, clientDir };
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
        prepararReadinessAutoridadeRecovery: async () => {
          events.push(["readiness"]);
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
  const h = apiHarness(events, [state(), { ...state(), durableCheckpointGeneration: 85681, pendingCheckpointRevision: null, authorityReady: true }]);
  const persistence = {
    prepare: async () => ({
      ok: true, tempIdentity: { size: 1, mtimeMs: 1, dev: 1, ino: 1 },
      sourceRevisions: {}, itens: 877,
      checkpointProjection: { contentHash: "a".repeat(64), projecao: { clienteId: "user_b2oogwwl", versao: 1, total: 1, itens: [] }, hashes: [] }
    }),
    publish: async () => ({ ok: true, legacyFileProof: { generation: 85681 } }),
    shutdown: async () => { events.push(["shutdown"]); }
  };
  const result = await runAdminCheckpointResume({
    dataDir: f.dataDir, clienteId: "user_b2oogwwl", expectedRevision: state().pendingCheckpointRevision,
    expectedTargetGeneration: 85681, expectedReferenceCount: 665, expectedProtectedHash: "protected",
    execute: true, authorization: "true", readState: h.readState, api: h.api, persistence
  });
  assert.equal(result.ok, true);
  assert.deepEqual(events.map(item => item[0]), ["capture", "confirm", "published", "projection", "index", "readiness", "shutdown"]);
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

console.log("checkpoint-resume-admin.test.cjs OK");
