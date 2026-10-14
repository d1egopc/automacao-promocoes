"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  MAGALU_IDENTITY_CAPABILITY,
  sanitizarUrlOneLinkMagalu,
  chaveIdentidadeMagalu,
  validarResultadoMagaluIdentity
} = require("../modules/local-worker/magalu-identity.contract");
const { criarLocalWorkerService } = require("../modules/local-worker/local-worker.service");
const { planoRetryImagemMagaluLocal } = require("../modules/engine/importer/importer.service");
const { tratarFalhaRetriavelMagalu } = require("../modules/engine/importer/importer.runner");

const sourceUrl = "https://magazineluiza.onelink.me/589508454/c3qooxsv";
const finalUrl = "https://www.magazineluiza.com.br/potes-hermeticos-com-tampa-10un-bumper/p/123456789/ud/poud/";

function storageFake(dados) {
  return {
    get: async chave => ({ [chave]: dados[chave] }),
    set: async valor => Object.assign(dados, valor),
    remove: async chave => { delete dados[chave]; }
  };
}

(async () => {
  assert.strictEqual(sanitizarUrlOneLinkMagalu(sourceUrl), sourceUrl);
  assert.strictEqual(sanitizarUrlOneLinkMagalu(`${sourceUrl}?token=privado`), "");
  const identityKey = chaveIdentidadeMagalu(sourceUrl);
  assert.match(identityKey, /^url_[a-f0-9]{32}$/);

  const fetchOriginal = global.fetch;
  global.fetch = async (_url, options = {}) => ({
    ok: false,
    status: 403,
    redirected: true,
    url: `${finalUrl}?promoter_id=5438968&token=nao-retornar`,
    body: { cancel: async () => undefined },
    options
  });
  delete require.cache[require.resolve("../optimus-capture/local-worker/magalu-identity.js")];
  const resolver = require("../optimus-capture/local-worker/magalu-identity.js");
  let resolvido;
  try {
    resolvido = await resolver.resolver({ sourceUrl, identityKey });
    assert.strictEqual(resolvido.observedProductId, "123456789");
    assert.strictEqual(resolvido.finalUrl, finalUrl);
    assert.strictEqual(resolvido.provaTecnica.statusHttp, 403);
    assert.strictEqual(resolvido.provaTecnica.redirected, true);
    assert.strictEqual(JSON.stringify(resolvido).includes("token"), false);

    global.fetch = async () => ({ status: 403, redirected: true, url: "https://evil.example/p/123456789", body: { cancel: async () => undefined } });
    await assert.rejects(() => resolver.resolver({ sourceUrl, identityKey }), /magalu_identity_produto_nao_confirmado/);
    global.fetch = async () => ({ status: 403, redirected: false, url: finalUrl, body: { cancel: async () => undefined } });
    await assert.rejects(() => resolver.resolver({ sourceUrl, identityKey }), /magalu_identity_produto_nao_confirmado/);
  } finally {
    global.fetch = fetchOriginal;
  }

  const validado = validarResultadoMagaluIdentity(resolvido, { sourceUrl, identityKey });
  assert.strictEqual(validado.identidadeValidada, true);
  assert.strictEqual(validado.observedProductId, "123456789");

  let garantirArgs = null;
  let cache = null;
  let completado = null;
  const task = {
    id: "501",
    type: "identidade_oficial",
    marketplace: "magalu",
    productId: identityKey,
    sourceUrl,
    capability: MAGALU_IDENTITY_CAPABILITY,
    status: "leased"
  };
  const repository = {
    garantirTask: async args => { garantirArgs = args; return { ok: true, criada: true, task }; },
    obterTask: async () => task,
    completarIdentidade: async args => { completado = args; cache = { result: args.resultado }; return { ok: true, task }; },
    obterCacheIdentidade: async () => cache,
    obterCache: async () => null,
    claim: async () => ({ ok: true, task: null }),
    status: async () => ({ ok: true }),
    ensureSchema: async () => ({ ok: true })
  };
  const service = criarLocalWorkerService({ repository, dedicatedOwnerIds: ["owner-1"] });
  const criada = await service.garantirIdentidadeMagalu({ sourceUrl });
  assert.strictEqual(criada.ok, true);
  assert.strictEqual(garantirArgs.capability, MAGALU_IDENTITY_CAPABILITY);
  assert.strictEqual(garantirArgs.productId, identityKey);
  assert.strictEqual(garantirArgs.sourceUrl, sourceUrl);
  assert.strictEqual(garantirArgs.maxAttempts, 3);
  const worker = { ok: true, workerType: "dedicated", ownerId: "owner-1", workerId: "worker-1", capabilities: [MAGALU_IDENTITY_CAPABILITY] };
  const concluida = await service.resultado({ worker, taskId: task.id, leaseToken: "lease-1", ...resolvido });
  assert.strictEqual(concluida.ok, true);
  assert.strictEqual(completado.cacheTtlMs, 6 * 60 * 60 * 1000);
  const cacheLido = await service.obterIdentidadeMagalu({ sourceUrl });
  assert.strictEqual(cacheLido.observedProductId, "123456789");
  assert.strictEqual(cacheLido.canonicalUrl, finalUrl);

  const baseTempo = new Date("2026-10-14T12:00:00.000Z");
  assert.strictEqual(planoRetryImagemMagaluLocal({ metadata: {} }, baseTempo).atrasoMs, 30_000);
  assert.strictEqual(planoRetryImagemMagaluLocal({ metadata: { localWorkerImageRetry: { tentativas: 1 } } }, baseTempo).atrasoMs, 120_000);
  assert.strictEqual(planoRetryImagemMagaluLocal({ metadata: { localWorkerImageRetry: { tentativas: 2 } } }, baseTempo).atrasoMs, 300_000);
  assert.strictEqual(planoRetryImagemMagaluLocal({ metadata: { localWorkerImageRetry: { tentativas: 3 } } }, baseTempo).reagendar, false,
    "worker offline deve esgotar o retry homologado sem loop infinito");
  let retryArgs = null;
  const resumoRetry = { retentativas: 0, motivos: {} };
  const retry = await tratarFalhaRetriavelMagalu(
    { id: 901, metadata: {} },
    {
      ok: false,
      retriavel: true,
      motivo: "sem_link_produto_confirmado",
      motivoDetalhe: "aguardando_identidade_local",
      metadata: { localWorkerIdentity: { capability: MAGALU_IDENTITY_CAPABILITY } }
    },
    "magalu",
    resumoRetry,
    { deps: { agendarRetryImagemMagaluLocal: async (_job, detalhes) => { retryArgs = detalhes; return { ok: true, tentativa: 1 }; } } }
  );
  assert.strictEqual(retry.reagendado, true);
  assert.strictEqual(retry.motivo, "aguardando_identidade_local");
  assert.strictEqual(retryArgs.capability, MAGALU_IDENTITY_CAPABILITY);
  assert.strictEqual(resumoRetry.retentativas, 1);

  const local = {};
  const session = {};
  let results = 0;
  global.chrome = {
    storage: { local: storageFake(local), session: storageFake(session) },
    alarms: { get: (_nome, callback) => callback(null), create: () => undefined, onAlarm: { addListener: () => undefined } }
  };
  global.OptimusLocalWorkerClient = {
    CAPABILITY: "magalu_image_v1",
    MAGALU_IDENTITY_CAPABILITY,
    bootstrap: async () => ({ token: "worker-token", workerId: "worker-1" }),
    claim: async () => ({ task: { ...task, leaseToken: "lease-1" } }),
    heartbeat: async () => ({ ok: true }),
    result: async (_task, payload) => {
      results += 1;
      assert.strictEqual(payload.capability, MAGALU_IDENTITY_CAPABILITY);
      assert.strictEqual(payload.observedProductId, "123456789");
      assert.strictEqual(Object.hasOwn(payload, "preco"), false);
      assert.strictEqual(Object.hasOwn(payload, "titulo"), false);
      return { ok: true };
    },
    failure: async () => { throw new Error("failure_not_expected"); }
  };
  global.OptimusMagaluIdentityResolver = {
    sourceUrlSegura: valor => sanitizarUrlOneLinkMagalu(valor),
    resolver: async () => resolvido
  };
  delete require.cache[require.resolve("../optimus-capture/local-worker/task-runner.js")];
  const runner = require("../optimus-capture/local-worker/task-runner.js");
  await runner.processar();
  assert.strictEqual(results, 1);
  assert.strictEqual(local[runner.STORAGE_KEYS.STATE], undefined);
  assert.strictEqual(session[runner.STORAGE_KEYS.LEASE], undefined);

  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "optimus-capture", "manifest.json"), "utf8"));
  assert(manifest.host_permissions.includes("https://magazineluiza.onelink.me/*"));
  const background = fs.readFileSync(path.join(__dirname, "..", "optimus-capture", "background", "service-worker.js"), "utf8");
  assert(background.includes("../local-worker/magalu-identity.js"));

  console.log("magalu-local-worker-identity.test.js OK");
})().catch(erro => { console.error(erro); process.exitCode = 1; });
