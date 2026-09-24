"use strict";

const assert = require("assert");
const {
  ML_IDENTITY_CAPABILITY,
  validarResultadoMlIdentity
} = require("../modules/local-worker/ml-identity.contract");
const { criarLocalWorkerService } = require("../modules/local-worker/local-worker.service");
const {
  consultarMlWorkIdentityBestEffort,
  montarMlWorkEnrichmentShadow
} = require("../modules/engine/importer/ml-work-enrichment-shadow");

const MLB = "MLB123456789";
const AGORA = Date.parse("2026-09-24T20:00:00.000Z");

function identidade(overrides = {}) {
  const collectedAt = new Date(AGORA - 1000).toISOString();
  return {
    capability: ML_IDENTITY_CAPABILITY,
    contractVersion: 1,
    marketplace: "mercadolivre",
    expectedMlb: MLB,
    observedMlb: MLB,
    identidadeValidada: true,
    tituloOficial: "Furadeira Parafusadeira Bosch GSR 120-LI 12V",
    imagemOficial: "https://http2.mlstatic.com/D_NQ_NP_2X_123-MLB123456789.jpg",
    origemTitulo: "jsonld.name",
    origemImagem: "jsonld.image",
    finalUrl: `https://produto.mercadolivre.com.br/${MLB}-furadeira`,
    canonicalUrl: `https://produto.mercadolivre.com.br/${MLB}-furadeira`,
    collectedAt,
    provaTecnica: {
      capability: ML_IDENTITY_CAPABILITY,
      contractVersion: 1,
      source: "local_first_party",
      provenance: "local_worker.ml_identity_v1",
      expectedMlb: MLB,
      observedMlb: MLB,
      sameProductObject: true,
      finalUrl: `https://produto.mercadolivre.com.br/${MLB}-furadeira`,
      canonicalUrl: `https://produto.mercadolivre.com.br/${MLB}-furadeira`,
      collectedAt
    },
    ...overrides
  };
}

(async () => {
  const validada = validarResultadoMlIdentity(identidade({
    preco: 1,
    cupom: "NAO_PERSISTIR",
    linkAfiliado: "https://nao.persistir"
  }), { expectedMlb: MLB, agoraMs: AGORA });
  assert.strictEqual(validada.identidadeValidada, true);
  assert.strictEqual(validada.expectedMlb, MLB);
  assert.strictEqual(validada.tituloOficial.includes("Bosch"), true);
  assert.strictEqual(validarResultadoMlIdentity(identidade({
    imagemOficial: "https://http2.mlstatic.com/D_NQ_NP_2X_123-MLB123456789.jpg?token=fonte#origem"
  }), { expectedMlb: MLB, agoraMs: AGORA }).imagemOficial, "https://http2.mlstatic.com/D_NQ_NP_2X_123-MLB123456789.jpg");
  assert.strictEqual(Object.hasOwn(validada, "preco"), false);
  assert.strictEqual(Object.hasOwn(validada, "cupom"), false);
  assert.strictEqual(Object.hasOwn(validada, "linkAfiliado"), false);

  await assert.rejects(async () => validarResultadoMlIdentity(identidade({ observedMlb: "MLB999999999" }), { expectedMlb: MLB, agoraMs: AGORA }), /ml_identity_mlb_divergente/);
  await assert.rejects(async () => validarResultadoMlIdentity(identidade({ marketplace: "shopee" }), { expectedMlb: MLB, agoraMs: AGORA }), /ml_identity_marketplace_invalido/);
  await assert.rejects(async () => validarResultadoMlIdentity(identidade({ tituloOficial: "Vendido por Loja Oficial no ML", imagemOficial: "" }), { expectedMlb: MLB, agoraMs: AGORA }), /ml_identity_titulo_nao_factual/);
  await assert.rejects(async () => validarResultadoMlIdentity(identidade({ imagemOficial: "https://evil.example/produto.jpg" }), { expectedMlb: MLB, agoraMs: AGORA }), /ml_identity_imagem_host_invalido/);
  await assert.rejects(async () => validarResultadoMlIdentity(identidade({ origemTitulo: "meta.og:title" }), { expectedMlb: MLB, agoraMs: AGORA }), /ml_identity_origem_titulo_invalida/);
  await assert.rejects(async () => validarResultadoMlIdentity(identidade({ origemImagem: "meta.og:image" }), { expectedMlb: MLB, agoraMs: AGORA }), /ml_identity_origem_imagem_invalida/);

  let enqueues = 0;
  const cacheHit = await consultarMlWorkIdentityBestEffort({
    marketplace: "mercadolivre",
    expectedMlb: MLB,
    sourceUrl: `https://produto.mercadolivre.com.br/${MLB}-furadeira`,
    agoraMs: AGORA,
    deps: {
      obterIdentidadeMercadoLivreLocalWorker: async () => identidade(),
      garantirIdentidadeMercadoLivreLocalWorker: async () => { enqueues += 1; return { ok: true }; }
    }
  });
  assert.strictEqual(cacheHit.cacheHit, true);
  assert.strictEqual(cacheHit.identidadeValidada, true);
  assert.strictEqual(enqueues, 0);

  const cacheMiss = await consultarMlWorkIdentityBestEffort({
    marketplace: "mercadolivre",
    expectedMlb: MLB,
    sourceUrl: `https://produto.mercadolivre.com.br/${MLB}-furadeira`,
    agoraMs: AGORA,
    deps: {
      obterIdentidadeMercadoLivreLocalWorker: async () => null,
      garantirIdentidadeMercadoLivreLocalWorker: async () => { enqueues += 1; return { ok: true, criada: true, task: { id: "77" } }; }
    }
  });
  assert.strictEqual(cacheMiss.identidadeValidada, false);
  assert.strictEqual(cacheMiss.taskCriada, true);
  assert.strictEqual(cacheMiss.taskId, "77");
  assert.strictEqual(Object.hasOwn(cacheMiss, "retriavel"), false);
  assert.strictEqual(enqueues, 1);

  const cacheInvalido = await consultarMlWorkIdentityBestEffort({
    marketplace: "mercadolivre",
    expectedMlb: MLB,
    sourceUrl: `https://produto.mercadolivre.com.br/${MLB}-furadeira`,
    agoraMs: AGORA,
    deps: {
      obterIdentidadeMercadoLivreLocalWorker: async () => identidade({ observedMlb: "MLB999999999" }),
      garantirIdentidadeMercadoLivreLocalWorker: async () => ({ ok: true, criada: false, task: { id: "existente" } })
    }
  });
  assert.strictEqual(cacheInvalido.observado, true);
  assert.strictEqual(cacheInvalido.identidadeValidada, false);
  assert.strictEqual(cacheInvalido.cacheHit, false);
  assert.match(cacheInvalido.motivoRejeicao, /ml_identity_mlb_divergente/);

  const offline = await consultarMlWorkIdentityBestEffort({
    marketplace: "mercadolivre",
    expectedMlb: MLB,
    sourceUrl: `https://produto.mercadolivre.com.br/${MLB}-furadeira`,
    agoraMs: AGORA,
    deps: {
      obterIdentidadeMercadoLivreLocalWorker: async () => { throw new Error("worker_offline"); },
      garantirIdentidadeMercadoLivreLocalWorker: async () => { throw new Error("enqueue_timeout"); }
    }
  });
  assert.strictEqual(offline.identidadeValidada, false);
  assert.match(offline.motivoRejeicao, /worker_offline|enqueue_timeout/);

  const inicioTimeout = Date.now();
  const timeout = await consultarMlWorkIdentityBestEffort({
    marketplace: "mercadolivre",
    expectedMlb: MLB,
    sourceUrl: `https://produto.mercadolivre.com.br/${MLB}-furadeira`,
    agoraMs: AGORA,
    deps: {
      obterIdentidadeMercadoLivreLocalWorker: async () => new Promise(() => {}),
      garantirIdentidadeMercadoLivreLocalWorker: async () => ({ ok: true, criada: false })
    }
  });
  assert.strictEqual(timeout.identidadeValidada, false);
  assert.match(timeout.motivoRejeicao, /ml_identity_operacao_local_timeout/);
  assert.ok(Date.now() - inicioTimeout < 1000);

  const oferta = {
    marketplace: "mercadolivre",
    titulo: "Vendido por Loja Oficial no ML",
    imagem: "https://http2.mlstatic.com/D_NQ_NP_ATUAL-MLB.jpg",
    categoria: "Diversos",
    preco: 1379,
    precoOriginal: 2199,
    cupom: "RADAR100",
    linkAfiliado: "https://meli.la/workspace",
    linksComerciais: [{ papel: "produto", url: "https://meli.la/workspace" }]
  };
  const metadata = { produto: {}, linksClassificados: [{ papel: "produto" }] };
  const antesOferta = JSON.stringify(oferta);
  const antesMetadata = JSON.stringify(metadata);
  const shadow = montarMlWorkEnrichmentShadow({
    consulta: cacheHit,
    oferta,
    metadataFinal: metadata,
    job: { marketplace: "mercadolivre" },
    reclassificarCategoria: clone => ({ oferta: { ...clone, categoria: "Ferramentas" } })
  });
  assert.strictEqual(shadow.comparacao.tituloHipoteticoEscolhido.includes("Bosch"), true);
  assert.strictEqual(shadow.comparacao.categoriaHipoteticaRecalculada, "Ferramentas");
  assert.strictEqual(shadow.comparacao.comercialAlterado, false);
  assert.strictEqual(shadow.comparacao.linksAlterados, false);
  assert.strictEqual(JSON.stringify(oferta), antesOferta);
  assert.strictEqual(JSON.stringify(metadata), antesMetadata);
  assert.strictEqual(shadow.telemetria.tituloWorkHash.length, 16);
  assert.strictEqual(JSON.stringify(shadow.telemetria).includes("Furadeira Parafusadeira"), false);
  assert.strictEqual(JSON.stringify(shadow.telemetria).includes("meli.la/workspace"), false);

  const shadowClassificadorFalho = montarMlWorkEnrichmentShadow({
    consulta: cacheHit,
    oferta,
    metadataFinal: metadata,
    job: {},
    reclassificarCategoria: () => { throw new Error("classificador_indisponivel"); }
  });
  assert.strictEqual(shadowClassificadorFalho.comparacao.categoriaHipoteticaRecalculada, oferta.categoria);
  assert.match(shadowClassificadorFalho.telemetria.motivoRejeicao, /classificador_indisponivel/);
  assert.strictEqual(JSON.stringify(oferta), antesOferta);

  let guaranteeArgs = null;
  let completedIdentity = null;
  const task = {
    id: "identity-1",
    type: "identidade_oficial",
    marketplace: "mercadolivre",
    productId: MLB,
    capability: ML_IDENTITY_CAPABILITY,
    status: "leased"
  };
  const repo = {
    registrarWorkerDedicated: async ({ capabilities }) => ({ ok: true, capabilities, workerType: "dedicated" }),
    registrarWorkerCommunity: async ({ capabilities }) => ({ ok: true, capabilities, workerType: "community" }),
    autenticarWorker: async () => ({ ok: true, workerId: "worker-1", ownerId: "owner-1", workerType: "dedicated", capabilities: [ML_IDENTITY_CAPABILITY, "ml_image_v1"] }),
    garantirTask: async args => { guaranteeArgs = args; return { ok: true, criada: true, task }; },
    obterTask: async () => task,
    completarIdentidade: async args => { completedIdentity = args; return { ok: true }; },
    obterCacheIdentidade: async () => ({ result: identidade(), validatedAt: new Date(AGORA).toISOString() })
  };
  const service = criarLocalWorkerService({
    repository: repo,
    dedicatedOwnerIds: ["owner-1"],
    agora: () => new Date(AGORA),
    fetchFn: async url => ({ ok: true, status: 200, url, headers: { get: () => "image/jpeg" }, body: { cancel: async () => undefined } })
  });
  const workerAntigo = await service.registrarWorker({ ownerId: "owner-1", workerId: "legacy", capabilities: ["ml_image_v1"] });
  assert.deepStrictEqual(workerAntigo.capabilities.sort(), ["magalu_image_v1", "ml_image_v1"].sort());

  await service.garantirIdentidadeMercadoLivre({ productId: MLB, sourceUrl: `https://produto.mercadolivre.com.br/${MLB}-furadeira` });
  assert.strictEqual(guaranteeArgs.capability, ML_IDENTITY_CAPABILITY);
  assert.strictEqual(guaranteeArgs.type, "identidade_oficial");
  assert.strictEqual(guaranteeArgs.idempotencyKey, `mercadolivre:${MLB}:ml_identity_v1`);
  assert.strictEqual(guaranteeArgs.reutilizarCompleted, false);

  await service.garantirIdentidadeMercadoLivre({ productId: MLB, sourceUrl: `https://produto.mercadolivre.com.br/${MLB}-furadeira?tracking=fonte#origem` });
  assert.strictEqual(guaranteeArgs.sourceUrl, `https://produto.mercadolivre.com.br/${MLB}-furadeira`);

  const worker = await service.autenticar("token");
  await service.resultado({
    worker,
    taskId: task.id,
    leaseToken: "lease",
    ...identidade()
  });
  assert.strictEqual(completedIdentity.resultado.capability, ML_IDENTITY_CAPABILITY);
  assert.strictEqual(completedIdentity.resultado.provaTecnica.provenance, "local_worker.ml_identity_v1");
  assert.strictEqual(Object.hasOwn(completedIdentity.resultado, "html"), false);
  assert.strictEqual(Object.hasOwn(completedIdentity.resultado, "cookie"), false);

  const cacheService = await service.obterIdentidadeMercadoLivre({ productId: MLB });
  assert.strictEqual(cacheService.identidadeValidada, true);
  assert.strictEqual(cacheService.expectedMlb, MLB);

  console.log("ml-work-enrichment-shadow.test.js: ok");
})().catch(erro => { console.error(erro); process.exitCode = 1; });
