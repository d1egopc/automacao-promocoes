"use strict";

const assert = require("assert");
const {
  criarLocalWorkerService,
  MAGALU_OPPORTUNITY_CAPABILITY,
  MAGALU_OPPORTUNITY_TASK_TYPE,
  MAGALU_OPPORTUNITY_PRODUCT_ID,
  MAGALU_OPPORTUNITY_URL
} = require("../modules/local-worker/local-worker.service");

const agora = new Date("2026-09-20T12:00:00.000Z");

function taskOpportunity(overrides = {}) {
  return {
    id: "10",
    type: MAGALU_OPPORTUNITY_TASK_TYPE,
    marketplace: "magalu",
    productId: MAGALU_OPPORTUNITY_PRODUCT_ID,
    sourceUrl: MAGALU_OPPORTUNITY_URL,
    capability: MAGALU_OPPORTUNITY_CAPABILITY,
    status: "leased",
    attempts: 1,
    updatedAt: agora.toISOString(),
    ...overrides
  };
}

function criarRepoFake() {
  const state = { task: null, garantirChamadas: 0, ultimaGarantia: null, completed: null, failed: null };
  return {
    state,
    ensureSchema: async () => ({ ok: true }),
    autenticarWorker: async () => ({ ok: true, workerId: "worker-1", ownerId: "owner-1", workerType: "dedicated", capabilities: ["magalu_image_v1", MAGALU_OPPORTUNITY_CAPABILITY] }),
    registrarWorkerDedicated: async payload => ({ ok: true, workerId: payload.workerId || "worker-1", workerType: "dedicated", capabilities: payload.capabilities }),
    registrarWorkerCommunity: async payload => ({ ok: true, workerId: payload.workerId || "community", workerType: "community", capabilities: [] }),
    obterTask: async () => state.task,
    obterUltimaTask: async () => state.task,
    garantirTask: async payload => {
      state.garantirChamadas += 1;
      state.ultimaGarantia = payload;
      state.task = taskOpportunity({ id: String(10 + state.garantirChamadas), status: "pending", attempts: 0, sourceUrl: payload.sourceUrl, capability: payload.capability });
      return { ok: true, criada: true, task: state.task };
    },
    completarTecnica: async payload => {
      state.completed = payload;
      state.task = taskOpportunity({ status: "completed", completedAt: agora.toISOString(), resultMetadata: payload.metadata });
      return { ok: true, idempotente: false, task: state.task };
    },
    falhar: async payload => { state.failed = payload; return { ok: true }; },
    claim: async () => ({ ok: true, task: state.task }),
    heartbeat: async () => ({ ok: true }),
    revogarWorker: async () => ({ ok: true }),
    obterTaskAtiva: async () => state.task,
    obterCache: async () => null,
    status: async () => ({ ok: true, counts: {} })
  };
}

(async () => {
  const repo = criarRepoFake();
  let invalidacoes = 0;
  const service = criarLocalWorkerService({ repository: repo, dedicatedOwnerIds: ["owner-1"], agora: () => new Date(agora), onOpportunityResult: () => { invalidacoes += 1; } });
  const worker = await service.autenticar("token");

  const primeira = await service.garantirOportunidadeMagalu();
  for (let i = 0; i < 19; i += 1) await service.garantirOportunidadeMagalu();
  assert.strictEqual(primeira.criada, true);
  assert.strictEqual(repo.state.garantirChamadas, 1, "consultas concorrentes/repetidas reutilizam a task ativa");
  assert.strictEqual(primeira.task.capability, MAGALU_OPPORTUNITY_CAPABILITY);

  repo.state.task = taskOpportunity();
  const payloadValido = {
    worker,
    taskId: "10",
    leaseToken: "lease-10",
    capability: MAGALU_OPPORTUNITY_CAPABILITY,
    accessible: true,
    indicatorFound: true,
    finalUrl: MAGALU_OPPORTUNITY_URL,
    checkedAt: agora.toISOString()
  };
  assert.strictEqual((await service.resultado(payloadValido)).ok, true);
  assert.strictEqual(repo.state.completed.metadata.indicatorFound, true);
  assert.strictEqual(invalidacoes, 1, "resultado técnico aceito deve invalidar somente o cache Magalu pela composição");
  assert.strictEqual((await service.obterOportunidadeMagaluRecente()).resultado.indicatorFound, true);

  repo.state.task = taskOpportunity();
  await assert.rejects(() => service.resultado({ ...payloadValido, finalUrl: "https://evil.example/selecao/ofertasdodiamundo/" }), /url_oportunidade_invalida/);
  await assert.rejects(() => service.resultado({ ...payloadValido, finalUrl: "https://www.magazineluiza.com.br/outro/" }), /url_oportunidade_invalida/);
  assert.strictEqual((await service.resultado({ ...payloadValido, checkedAt: "2026-09-20T11:55:00.000Z" })).ok, true, "resultado de cinco minutos ainda deve ser reutilizado sem nova consulta residencial");
  repo.state.task = taskOpportunity();
  await assert.rejects(() => service.resultado({ ...payloadValido, checkedAt: "2026-09-20T11:49:59.000Z" }), /resultado_oportunidade_stale/);
  repo.state.task = taskOpportunity();
  await assert.rejects(() => service.resultado({ ...payloadValido, checkedAt: "2026-09-20T11:50:00.000Z" }), /resultado_oportunidade_stale/, "dez minutos exatos já são stale");

  repo.state.task = taskOpportunity();
  assert.strictEqual((await service.resultado({ ...payloadValido, indicatorFound: false })).ok, true, "ausência confirmada é resultado técnico válido");
  assert.strictEqual(repo.state.completed.metadata.indicatorFound, false);

  repo.state.task = taskOpportunity({ status: "failed", updatedAt: "2026-09-20T11:59:00.000Z" });
  const antesBackoff = repo.state.garantirChamadas;
  const backoff = await service.garantirOportunidadeMagalu();
  assert.strictEqual(backoff.backoff, true);
  assert.strictEqual(repo.state.garantirChamadas, antesBackoff, "falha recente não cria task storm");

  repo.state.task = taskOpportunity({ status: "failed", updatedAt: "2026-09-20T11:49:59.000Z" });
  const renovada = await service.garantirOportunidadeMagalu();
  assert.strictEqual(renovada.criada, true, "nova verificação só nasce depois da janela técnica de dez minutos");
  assert.strictEqual(repo.state.ultimaGarantia.maxAttempts, 1, "task de oportunidade faz no máximo uma consulta residencial por ciclo");

  repo.state.task = taskOpportunity();
  await service.falha({ worker, taskId: "10", leaseToken: "lease-10", motivo: "magalu_oportunidade_challenge", metadata: { accessible: false, finalUrl: MAGALU_OPPORTUNITY_URL, checkedAt: agora.toISOString() } });
  assert.strictEqual(repo.state.failed.metadata.accessible, false);

  console.log("local-worker-opportunity.test.js: ok");
})().catch(erro => { console.error(erro); process.exitCode = 1; });
