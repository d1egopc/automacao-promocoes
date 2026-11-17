"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "magalu-golden-v1-"));

const fixture = require("./fixtures/magalu-golden-v1-contracts.json");
const { writeGlobalJson } = require("../utils/storage");
const {
  importarProdutoMagaluEngine
} = require("../modules/engine/importer/adapters/magalu.adapter");
const {
  criarLocalWorkerService
} = require("../modules/local-worker/local-worker.service");
const {
  chaveIdentidadeMagalu,
  MAGALU_IDENTITY_CAPABILITY,
  MAGALU_IDENTITY_TASK_TYPE
} = require("../modules/local-worker/magalu-identity.contract");
const {
  validarCallbackIdentidadeMagaluParaAcordar,
  acordarJobMagaluPorIdentidade
} = require("../modules/engine/importer/importer.service");
const {
  validarOfertaParaDistribuicao,
  montarItemFilaEngine
} = require("../modules/engine/distributor/distributor.service");

const identityKey = chaveIdentidadeMagalu(fixture.sourceUrl);

function eventoRadar() {
  return {
    id: fixture.occurrenceId,
    texto_original: `${fixture.title}\nDe R$ ${fixture.previousPrice}\nPor R$ ${fixture.price}\nCupom ${fixture.coupon}\n${fixture.sourceUrl}`,
    cupom: fixture.coupon,
    links_extraidos: [fixture.sourceUrl],
    metadata: { origemFluxo: "clonador_grupos" }
  };
}

function jobFor(workspace = fixture.workspace) {
  return {
    id: fixture.jobId,
    evento_id: fixture.occurrenceId,
    cliente_id: workspace,
    marketplace: "magalu",
    status: "importando",
    metadata: { origemFluxo: "clonador_grupos" }
  };
}

function linkOneLink() {
  return {
    id: "link-243084",
    evento_id: fixture.occurrenceId,
    url_original: fixture.sourceUrl,
    url_normalizada: fixture.sourceUrl,
    url_expandida: "",
    dominio_original: "magazineluiza.onelink.me",
    dominio_final: "magazineluiza.onelink.me",
    redirect_ok: false,
    motivo_redirect: "http_403",
    marketplace_detectado: "magalu",
    papelLink: "produto",
    metadata: { papelLink: "produto", papelLinkMotivo: "onelink_magalu" }
  };
}

function depsFor(workspace = fixture.workspace) {
  const promoterId = workspace === fixture.workspace ? fixture.promoterId : fixture.promoterIdAlt;
  const canonicalUrl = fixture.canonicalUrl.replace("/d1egopc/", `/${promoterId}/`);
  return {
    getIntegracaoCliente: clienteId => clienteId === workspace
      ? { credenciais: { promoterId } }
      : null,
    obterIdentidadeMagaluLocalWorker: async ({ sourceUrl }) => ({
      capability: MAGALU_IDENTITY_CAPABILITY,
      identityKey: chaveIdentidadeMagalu(sourceUrl),
      sourceUrl,
      finalUrl: fixture.canonicalUrl,
      canonicalUrl: fixture.canonicalUrl,
      observedProductId: fixture.productId,
      identidadeValidada: true,
      collectedAt: "2026-11-16T23:31:30.000Z"
    }),
    garantirIdentidadeMagaluLocalWorker: async () => {
      throw new Error("identity_task_should_not_be_created_after_valid_callback");
    },
    resolverFatosMagalu: async ({ urlOriginal, promoterId: resolvedPromoter }) => ({
      ok: true,
      fonteUsada: "magalu_first_party",
      fatos: {
        urlOriginal,
        urlCanonica: fixture.canonicalUrl,
        urlAfiliavelComprovada: canonicalUrl,
        magaluWorkspaceValidado: true,
        produtoId: fixture.productId,
        codigo: fixture.productId,
        seller: fixture.sellerId,
        sellerId: fixture.sellerId,
        variante: fixture.variantId,
        titulo: fixture.title,
        categoria: fixture.category,
        imagem: fixture.image,
        precoAtual: fixture.price,
        metadata: {
          fontes: { titulo: "magalu_first_party" },
          promoterId: resolvedPromoter,
          variante: fixture.variantId
        },
        avisos: []
      },
      avisos: []
    })
  };
}

async function importarMagalu(workspace = fixture.workspace) {
  return importarProdutoMagaluEngine({
    job: jobFor(workspace),
    evento: eventoRadar(),
    links: [linkOneLink()],
    deps: depsFor(workspace)
  });
}

function identityTask(overrides = {}) {
  const createdAt = "2026-11-16T23:30:00.000Z";
  const completedAt = "2026-11-16T23:32:27.000Z";
  const expiresAt = "2026-11-16T23:33:18.000Z";
  return {
    id: String(fixture.identityTaskId),
    taskId: String(fixture.identityTaskId),
    marketplace: "magalu",
    type: MAGALU_IDENTITY_TASK_TYPE,
    capability: MAGALU_IDENTITY_CAPABILITY,
    status: "completed",
    productId: identityKey,
    sourceUrl: fixture.sourceUrl,
    createdAt,
    completedAt,
    expiresAt,
    ...overrides
  };
}

function identityResult(overrides = {}) {
  return {
    identidadeValidada: true,
    identityKey,
    observedProductId: fixture.productId,
    canonicalUrl: fixture.canonicalUrl,
    finalUrl: fixture.canonicalUrl,
    ...overrides
  };
}

test("OneLink 403 uses the same occurrence-bound identity and preserves the commercial contract", async () => {
  const result = await importarMagalu();
  assert.equal(result.ok, true, result.motivo);
  assert.equal(result.metadata.jobId, fixture.jobId);
  assert.equal(result.metadata.eventoId, fixture.occurrenceId);
  assert.equal(result.metadata.linkOriginalOcorrencia, fixture.sourceUrl);
  assert.equal(result.metadata.identidadeLocalWorker.observedProductId, fixture.productId);
  assert.equal(result.produtoId, fixture.productId);
  assert.equal(result.seller, fixture.sellerId);
  assert.equal(result.metadata.produto.variante, fixture.variantId);
  assert.equal(result.linkExpandido, fixture.canonicalUrl);
  assert.equal(result.imagem, fixture.image);
  assert.equal(result.titulo, fixture.title);
  assert.equal(result.categoria, fixture.category);
  assert.equal(result.preco, 1899);
  assert.equal(result.precoOriginal, fixture.previousPrice);
  assert.equal(result.cupom, fixture.coupon);
  assert.match(result.linkAfiliado, /magazinevoce\.com\.br\/d1egopc\//);
});

test("affiliate conversion is isolated per workspace and never borrows promoterId", async () => {
  const diego = await importarMagalu(fixture.workspace);
  const achados = await importarMagalu(fixture.workspaceAlt);
  assert.match(diego.linkAfiliado, /\/d1egopc\//);
  assert.match(achados.linkAfiliado, /\/achadosdiretos\//);
  assert.notEqual(diego.linkAfiliado, achados.linkAfiliado);
  assert.equal(diego.clienteId, fixture.workspace);
  assert.equal(achados.clienteId, fixture.workspaceAlt);
});

test("identity completion is persisted before callback and callback is idempotent", async () => {
  let persisted = false;
  let callbacks = 0;
  let completeCalls = 0;
  const task = {
    id: String(fixture.identityTaskId),
    capability: MAGALU_IDENTITY_CAPABILITY,
    marketplace: "magalu",
    type: MAGALU_IDENTITY_TASK_TYPE,
    productId: identityKey,
    sourceUrl: fixture.sourceUrl,
    status: "leased"
  };
  const repo = {
    obterTask: async () => task,
    completarIdentidade: async ({ resultado }) => {
      completeCalls += 1;
      persisted = Boolean(resultado?.identidadeValidada);
      return {
        ok: true,
        idempotente: completeCalls > 1,
        task: { ...task, status: "completed", completedAt: "2026-11-16T23:32:27.000Z" }
      };
    }
  };
  const service = criarLocalWorkerService({
    repository: repo,
    dedicatedOwnerIds: [fixture.workspace],
    agora: () => new Date("2026-11-16T23:32:40.000Z"),
    onIdentityResult: async () => {
      assert.equal(persisted, true);
      callbacks += 1;
    }
  });
  const worker = {
    ok: true,
    workerType: "dedicated",
    ownerId: fixture.workspace,
    workerId: "worker-diego",
    capabilities: [MAGALU_IDENTITY_CAPABILITY]
  };
  const payload = {
    worker,
    taskId: String(fixture.identityTaskId),
    leaseToken: "lease-fixture",
    marketplace: "magalu",
    capability: MAGALU_IDENTITY_CAPABILITY,
    contractVersion: 1,
    identityKey,
    sourceUrl: fixture.sourceUrl,
    observedProductId: fixture.productId,
    identidadeValidada: true,
    finalUrl: fixture.canonicalUrl,
    canonicalUrl: fixture.canonicalUrl,
    collectedAt: "2026-11-16T23:32:27.000Z",
    provaTecnica: {
      capability: MAGALU_IDENTITY_CAPABILITY,
      contractVersion: 1,
      source: "local_first_party",
      provenance: "local_worker.magalu_identity_v1",
      identityKey,
      observedProductId: fixture.productId,
      redirected: true,
      finalUrl: fixture.canonicalUrl,
      collectedAt: "2026-11-16T23:32:27.000Z",
      statusHttp: 200
    }
  };
  assert.equal((await service.resultado(payload)).ok, true);
  assert.equal((await service.resultado(payload)).ok, true);
  assert.equal(completeCalls, 2);
  assert.equal(callbacks, 1);
});

test("callback wakeup consumes only a fresh, bound result and rejects late, duplicate or divergent callbacks", async () => {
  const nowMs = Date.parse("2026-11-16T23:32:40.000Z");
  const sqlCalls = [];
  const fresh = await acordarJobMagaluPorIdentidade({
    task: identityTask(),
    resultado: identityResult(),
    agoraMs: nowMs,
    queryFn: async (sql, params) => {
      sqlCalls.push({ sql, params });
      return { ok: true, resultado: { rowCount: sqlCalls.length === 1 ? 1 : 0 } };
    }
  });
  assert.equal(fresh.ok, true);
  assert.equal(fresh.acordado, true);
  const duplicate = await acordarJobMagaluPorIdentidade({
    task: identityTask(),
    resultado: identityResult(),
    agoraMs: nowMs,
    queryFn: async () => ({ ok: true, resultado: { rowCount: 0 } })
  });
  assert.equal(duplicate.ignorado, true);
  assert.match(sqlCalls[0].sql, /resultadoAplicadoTaskId/);
  assert.deepEqual(sqlCalls[0].params, [String(fixture.identityTaskId), identityKey]);

  const late = validarCallbackIdentidadeMagaluParaAcordar({
    task: identityTask({ completedAt: "2026-11-16T23:33:18.000Z" }),
    resultado: identityResult(),
    agoraMs: nowMs
  });
  assert.equal(late.ok, false);
  assert.equal(late.motivo, "task_resultado_fora_da_janela");

  const divergent = validarCallbackIdentidadeMagaluParaAcordar({
    task: identityTask(),
    resultado: identityResult({ identityKey: "url_outro_produto" }),
    agoraMs: nowMs
  });
  assert.equal(divergent.ok, false);
  assert.equal(divergent.motivo, "resultado_identidade_invalido");
});

test("category filter, RIO fanout and queue preserve official media and commercial fields", async () => {
  writeGlobalJson("usuarios.json", [{ id: fixture.workspace, ativo: true, plano: "pro" }]);
  const result = await importarMagalu();
  const oferta = {
    id: fixture.offerId,
    job_id: fixture.jobId,
    evento_id: fixture.occurrenceId,
    cliente_id: fixture.workspace,
    origem: "clonador_grupos",
    origemFluxo: "clonador_grupos",
    marketplace: "magalu",
    titulo: result.titulo,
    categoria: result.categoria,
    preco: result.preco,
    preco_original: result.precoOriginal,
    cupom: result.cupom,
    imagem: result.imagem,
    imagemEnviavel: true,
    link_original: result.linkOriginal,
    link_afiliado: result.linkAfiliado,
    metadata: { clonadorGrupos: { destinoIds: fixture.ackDestinations } }
  };
  const destinos = [
    { id: "rio-diego", nome: "RIO DiegoPC", ativo: true, tipo: "telegram", botToken: "fixture", chatId: "rio", marketplaces: ["magalu"], categorias: [fixture.category] },
    { id: "whatsapp-diego", nome: "WhatsApp DiegoPC", ativo: true, tipo: "whatsapp", botToken: "fixture", chatId: "whatsapp", marketplaces: ["magalu"], categorias: [fixture.category] },
    { id: "eletronicos", nome: "Eletrônicos", ativo: true, tipo: "telegram", botToken: "fixture", chatId: "wrong", marketplaces: ["magalu"], categorias: ["Eletrônicos"] }
  ];
  const routed = await validarOfertaParaDistribuicao(oferta, {
    clientesValidos: [fixture.workspace],
    marketplacesAtivosPorCliente: { [fixture.workspace]: { magalu: true } },
    destinosPorCliente: { [fixture.workspace]: destinos },
    validarCreditos: () => ({ ok: true })
  });
  assert.equal(routed.ok, true);
  assert.equal(routed.destinosTotal, 2);
  assert.equal(routed.destinosCompativeis, 2);
  const item = montarItemFilaEngine(oferta);
  assert.equal(item.engineJobId, fixture.jobId);
  assert.equal(item.engineOfertaId, fixture.offerId);
  assert.equal(item.imagem, fixture.image);
  assert.equal(item.linkOriginal, fixture.sourceUrl);
  assert.equal(item.linkAfiliado, result.linkAfiliado);
  assert.equal(item.preco, 1899);
  assert.equal(item.precoOriginal, fixture.previousPrice);
  assert.equal(item.cupom, fixture.coupon);
  assert.deepEqual(item.destinosEnviados, []);
  assert.ok(!/whatsapp|telegram|group/i.test(item.imagem));
});

test("shared marketplace guards remain available", () => {
  assert.equal(typeof require("../modules/engine/importer/adapters/mercadolivre.adapter").importarMercadoLivreEngine, "function");
  assert.equal(typeof require("../modules/engine/importer/adapters/shopee.adapter").importarShopeeEngine, "function");
  assert.equal(typeof require("../modules/engine/importer/adapters/awin.adapter").importarAwinEngine, "function");
  assert.equal(typeof montarItemFilaEngine, "function");
});
