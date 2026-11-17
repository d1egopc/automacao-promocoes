"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  acordarJobMagaluPorIdentidade,
  validarCallbackIdentidadeMagaluParaAcordar
} = require("../modules/engine/importer/importer.service.js");
const {
  criarLocalWorkerService
} = require("../modules/local-worker/local-worker.service.js");
const {
  chaveIdentidadeMagalu
} = require("../modules/local-worker/magalu-identity.contract.js");

const agoraIso = "2026-11-16T23:32:00.000Z";
const agoraMs = Date.parse(agoraIso);
const sourceUrl = "https://magazineluiza.onelink.me/589508454/wdy9a64x";
const identityKey = chaveIdentidadeMagalu(sourceUrl);
const canonicalUrl = "https://www.magazineluiza.com.br/amaciante-ype/p/cfhh5dcg0d/me/amro/";

function tarefa(overrides = {}) {
  return {
    id: "41221",
    marketplace: "magalu",
    capability: "magalu_identity_v1",
    type: "identidade_oficial",
    productId: identityKey,
    status: "completed",
    createdAt: "2026-11-16T23:31:48.750Z",
    completedAt: "2026-11-16T23:31:58.000Z",
    expiresAt: "2026-11-16T23:46:48.750Z",
    ...overrides
  };
}

function resultado(overrides = {}) {
  const base = {
    capability: "magalu_identity_v1",
    contractVersion: 1,
    marketplace: "magalu",
    identityKey,
    sourceUrl,
    observedProductId: "cfhh5dcg0d",
    identidadeValidada: true,
    finalUrl: canonicalUrl,
    canonicalUrl,
    collectedAt: "2026-11-16T23:31:57.500Z",
    provaTecnica: {
      capability: "magalu_identity_v1",
      contractVersion: 1,
      source: "local_first_party",
      provenance: "local_worker.magalu_identity_v1",
      identityKey,
      observedProductId: "cfhh5dcg0d",
      redirected: true,
      finalUrl: canonicalUrl,
      statusHttp: 200,
      collectedAt: "2026-11-16T23:31:57.500Z"
    }
  };
  return { ...base, ...overrides, provaTecnica: { ...base.provaTecnica, ...(overrides.provaTecnica || {}) } };
}

function queryQueAcordaUmaVez() {
  let acordado = false;
  return async () => {
    await Promise.resolve();
    if (acordado) return { ok: true, resultado: { rowCount: 0, rows: [] } };
    acordado = true;
    return { ok: true, resultado: { rowCount: 1, rows: [{ id: "1181972", status: "pronto_para_importar" }] } };
  };
}

test("callback válido antes do TTL acorda o mesmo job", async () => {
  const resultadoWake = await acordarJobMagaluPorIdentidade({
    task: tarefa(),
    resultado: resultado(),
    agoraMs,
    queryFn: async (_sql, params) => {
      assert.deepEqual(params, ["41221", identityKey]);
      return { ok: true, resultado: { rowCount: 1, rows: [{ id: "1181972" }] } };
    }
  });
  assert.equal(resultadoWake.ok, true);
  assert.equal(resultadoWake.acordado, true);
});

test("callback duplicado é idempotente e não acorda duas vezes", async () => {
  const queryFn = queryQueAcordaUmaVez();
  const primeiro = await acordarJobMagaluPorIdentidade({ task: tarefa(), resultado: resultado(), agoraMs, queryFn });
  const segundo = await acordarJobMagaluPorIdentidade({ task: tarefa(), resultado: resultado(), agoraMs, queryFn });
  assert.equal(primeiro.acordado, true);
  assert.equal(segundo.acordado, false);
  assert.equal(segundo.ignorado, true);
});

test("job comercial expirado não é ressuscitado", async () => {
  let queries = 0;
  const expirado = await acordarJobMagaluPorIdentidade({
    task: tarefa({ completedAt: "2026-11-16T23:31:58.000Z" }),
    resultado: resultado(),
    agoraMs: Date.parse("2026-11-17T00:00:00.000Z"),
    queryFn: async () => { queries += 1; return { ok: true, resultado: { rowCount: 0, rows: [] } }; }
  });
  assert.equal(expirado.ok, true);
  assert.equal(expirado.acordado, false);
  assert.equal(queries, 1, "a guarda comercial fica no UPDATE atômico; nenhum estado é reaberto pelo callback");
});

test("task terminal, CAPTCHA ou identidade divergente não acordam o job", async () => {
  const terminal = validarCallbackIdentidadeMagaluParaAcordar({ task: tarefa({ status: "failed" }), resultado: resultado(), agoraMs });
  const captcha = validarCallbackIdentidadeMagaluParaAcordar({ task: tarefa({ status: "failed" }), resultado: { motivo: "magalu_pdp_captcha" }, agoraMs });
  const divergente = validarCallbackIdentidadeMagaluParaAcordar({ task: tarefa(), resultado: resultado({ identityKey: "url_outro_produto" }), agoraMs });
  assert.equal(terminal.ok, false);
  assert.equal(captcha.ok, false);
  assert.equal(divergente.ok, false);
});

test("retomada concorrente permite somente uma transição", async () => {
  const queryFn = queryQueAcordaUmaVez();
  const [a, b] = await Promise.all([
    acordarJobMagaluPorIdentidade({ task: tarefa(), resultado: resultado(), agoraMs, queryFn }),
    acordarJobMagaluPorIdentidade({ task: tarefa(), resultado: resultado(), agoraMs, queryFn })
  ]);
  assert.equal([a.acordado, b.acordado].filter(Boolean).length, 1);
  assert.equal([a.ignorado, b.ignorado].filter(Boolean).length, 1);
});

test("os casos 1181972 e 1182953 usam o mesmo vínculo Magalu-only", async () => {
  for (const [jobId, taskId] of [["1181972", "41221"], ["1182953", "41242"]]) {
    const acordado = await acordarJobMagaluPorIdentidade({
      task: tarefa({ id: taskId }),
      resultado: resultado(),
      agoraMs,
      queryFn: async (sql, params) => {
        assert.match(sql, /LOWER\(COALESCE\(NULLIF\(TRIM\(j\.marketplace\)/);
        assert.deepEqual(params, [taskId, identityKey]);
        return { ok: true, resultado: { rowCount: 1, rows: [{ id: jobId, status: "pronto_para_importar" }] } };
      }
    });
    assert.equal(acordado.acordado, true);
  }
});

test("local-worker chama o wake somente na primeira conclusão persistida", async () => {
  let status = "leased";
  let callbacks = 0;
  const task = {
    id: "41221",
    marketplace: "magalu",
    capability: "magalu_identity_v1",
    type: "identidade_oficial",
    productId: identityKey,
    sourceUrl,
    createdAt: "2026-11-16T23:31:48.750Z",
    expiresAt: "2026-11-16T23:46:48.750Z"
  };
  const service = criarLocalWorkerService({
    agora: () => new Date(agoraIso),
    dedicatedOwnerIds: ["owner-1"],
    repository: {
      obterTask: async () => ({ ...task, status }),
      completarIdentidade: async () => {
        if (status === "completed") return { ok: true, idempotente: true, task: { ...task, status } };
        status = "completed";
        return { ok: true, idempotente: false, task: { ...task, status, completedAt: "2026-11-16T23:31:58.000Z" } };
      }
    },
    onIdentityResult: async ({ task: completedTask, resultado: persisted }) => {
      callbacks += 1;
      assert.equal(completedTask.id, "41221");
      assert.equal(persisted.identityKey, identityKey);
    }
  });
  const worker = { ok: true, workerType: "dedicated", ownerId: "owner-1", workerId: "worker-1", capabilities: ["magalu_identity_v1"] };
  const payload = resultado();
  await service.resultado({ worker, taskId: "41221", leaseToken: "lease", ...payload });
  await service.resultado({ worker, taskId: "41221", leaseToken: "lease", ...payload });
  assert.equal(callbacks, 1);
});

console.log("magalu-identity-result-wakeup.test.cjs: ok");
