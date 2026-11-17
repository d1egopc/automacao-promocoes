"use strict";

const assert = require("assert");
const { importarProdutoMagaluEngine } = require("../modules/engine/importer/adapters/magalu.adapter");
const { chaveIdentidadeMagalu } = require("../modules/local-worker/magalu-identity.contract");

const ONE_LINK = "https://magazineluiza.onelink.me/589508454/wdy9a64x";
const PRODUCT_URL = "https://www.magazineluiza.com.br/amaciante-ype-encanto/p/123456789/";
const AFFILIATE_URL = "https://www.magazinevoce.com.br/magazined1egopc/amaciante-ype-encanto/p/123456789/";
const IMAGE_URL = "https://a-static.mlcdn.com.br/320x320/123456789-ype.jpg";

function linkRow({ metadata = {}, expanded = ONE_LINK } = {}) {
  return {
    id: "link-58038",
    url_original: ONE_LINK,
    url_normalizada: ONE_LINK,
    url_expandida: expanded,
    marketplace_detectado: "magalu",
    metadata
  };
}

function eventoComercial() {
  return {
    titulo: "Amaciante Concentrado Ypê Encanto 1,5L",
    texto_original: [
      "Amaciante Concentrado Ypê Encanto 1,5L",
      "De R$ 35,99",
      "Por R$ 20,69",
      "Pix",
      "Cupom: GARIMPEI15",
      ONE_LINK
    ].join("\n"),
    precoAnterior: "35,99",
    precoAtual: "20,69",
    cupom: "GARIMPEI15",
    links_extraidos: [ONE_LINK]
  };
}

function job() {
  return { id: 1181972, evento_id: 242606, cliente_id: "user_pss60lus", marketplace: "magalu" };
}

function baseDeps() {
  return {
    getIntegracaoCliente(clienteId, marketplace) {
      assert.strictEqual(clienteId, "user_pss60lus");
      assert.strictEqual(marketplace, "magalu");
      return { credenciais: { promoterId: "d1egopc" } };
    },
    resolverFatosMagalu: async ({ urlOriginal }) => ({
      ok: true,
      produtoId: "123456789",
      fatos: {
        urlOriginal,
        urlCanonica: PRODUCT_URL,
        urlAfiliavelComprovada: AFFILIATE_URL,
        magaluWorkspaceValidado: true,
        produtoId: "123456789",
        codigo: "123456789",
        titulo: "Amaciante Concentrado Ypê Encanto 1,5L",
        precoAtual: "999,99",
        imagem: IMAGE_URL,
        categoria: "Limpeza",
        seller: "Magalu",
        avisos: [],
        metadata: { fontes: { urlCanonica: "canonical", titulo: "jsonld.name" } }
      },
      avisos: []
    })
  };
}

function taskFor(sourceUrl, id = "identity-1") {
  return {
    id,
    status: "pending",
    capability: "magalu_identity_v1",
    productId: chaveIdentidadeMagalu(sourceUrl),
    sourceUrl,
    createdAt: "2026-11-16T23:03:21.000Z",
    expiresAt: "2026-11-16T23:13:21.000Z"
  };
}

async function oneLink403AcionaFallback() {
  const calls = [];
  const result = await importarProdutoMagaluEngine({
    job: job(),
    evento: eventoComercial(),
    links: [linkRow({ metadata: { papelLink: "produto", papelLinkMotivo: "http_status_403" } })],
    deps: {
      ...baseDeps(),
      obterIdentidadeMagaluLocalWorker: async ({ sourceUrl }) => { calls.push(["cache", sourceUrl]); return null; },
      garantirIdentidadeMagaluLocalWorker: async ({ sourceUrl }) => {
        calls.push(["task", sourceUrl]);
        return { ok: true, task: taskFor(sourceUrl) };
      }
    }
  });

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.motivo, "sem_link_produto_confirmado");
  assert.deepStrictEqual(calls, [["cache", ONE_LINK], ["task", ONE_LINK]]);
  assert.strictEqual(result.linkOriginal, ONE_LINK);
  assert.strictEqual(result.metadata.localWorkerIdentity.binding.jobId, "1181972");
  assert.strictEqual(result.metadata.localWorkerIdentity.binding.eventoId, "242606");
  assert.strictEqual(result.metadata.localWorkerIdentity.binding.workspaceId, "user_pss60lus");
}

async function oneLinkIdentityConfirmedPreservesAnchorAndCommercial() {
  let resolverUrl = "";
  let duplicateTaskAttempted = false;
  const result = await importarProdutoMagaluEngine({
    job: job(),
    evento: eventoComercial(),
    links: [linkRow({ metadata: { papelLink: "produto", papelLinkMotivo: "http_status_403" } })],
    deps: {
      ...baseDeps(),
      obterIdentidadeMagaluLocalWorker: async ({ sourceUrl }) => ({
        capability: "magalu_identity_v1",
        sourceUrl,
        observedProductId: "123456789",
        identidadeValidada: true,
        canonicalUrl: PRODUCT_URL,
        finalUrl: PRODUCT_URL,
        collectedAt: "2026-11-16T23:04:00.000Z"
      }),
      garantirIdentidadeMagaluLocalWorker: async () => { duplicateTaskAttempted = true; },
      resolverFatosMagalu: async ({ urlOriginal }) => {
        resolverUrl = urlOriginal;
        return baseDeps().resolverFatosMagalu({ urlOriginal });
      }
    }
  });

  assert.strictEqual(result.ok, true, result.motivo);
  assert.strictEqual(duplicateTaskAttempted, false);
  assert.strictEqual(resolverUrl, PRODUCT_URL);
  assert.strictEqual(result.linkOriginal, ONE_LINK);
  assert.strictEqual(result.metadata.linkOriginalOcorrencia, ONE_LINK);
  assert.strictEqual(result.metadata.linksComerciais[0].urlOriginal, ONE_LINK);
  assert.strictEqual(result.metadata.linksComerciais[0].papelLink, "produto");
  assert.strictEqual(result.metadata.linksComerciais[0].urlAfiliadaWorkspace, AFFILIATE_URL);
  assert.strictEqual(result.preco, 20.69);
  assert.strictEqual(result.precoOriginal, "35,99");
  assert.strictEqual(result.cupom, "GARIMPEI15");
  assert.strictEqual(result.imagem, IMAGE_URL);
}

async function divergentIdentityRemainsBlocked() {
  let resolverCalled = false;
  const result = await importarProdutoMagaluEngine({
    job: job(),
    evento: eventoComercial(),
    links: [linkRow({ metadata: { papelLink: "produto" } })],
    deps: {
      ...baseDeps(),
      obterIdentidadeMagaluLocalWorker: async ({ sourceUrl }) => ({
        sourceUrl,
        identidadeValidada: true,
        observedProductId: "999999999",
        canonicalUrl: PRODUCT_URL
      }),
      garantirIdentidadeMagaluLocalWorker: async ({ sourceUrl }) => ({ ok: true, task: taskFor(sourceUrl, "identity-divergent") }),
      resolverFatosMagalu: async () => { resolverCalled = true; return null; }
    }
  });

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.motivo, "sem_link_produto_confirmado");
  assert.strictEqual(resolverCalled, false);
  assert.strictEqual(result.linkOriginal, ONE_LINK);
}

async function repeatedJobUsesIdempotentHelperResult() {
  const tasks = new Map();
  let calls = 0;
  const deps = {
    ...baseDeps(),
    obterIdentidadeMagaluLocalWorker: async () => null,
    garantirIdentidadeMagaluLocalWorker: async ({ sourceUrl }) => {
      calls += 1;
      if (!tasks.has(sourceUrl)) tasks.set(sourceUrl, taskFor(sourceUrl, "identity-idempotent"));
      return { ok: true, task: tasks.get(sourceUrl) };
    }
  };
  const input = { job: job(), evento: eventoComercial(), links: [linkRow({ metadata: { papelLink: "produto" } })], deps };
  const first = await importarProdutoMagaluEngine(input);
  const second = await importarProdutoMagaluEngine(input);

  assert.strictEqual(first.metadata.localWorkerIdentity.binding.taskId, "identity-idempotent");
  assert.strictEqual(second.metadata.localWorkerIdentity.binding.taskId, "identity-idempotent");
  assert.strictEqual(tasks.size, 1);
  assert.strictEqual(calls, 2, "o helper existente recebe as duas consultas e permanece responsável pela idempotência");
}

async function captchaRemainsRetained() {
  let taskCreated = false;
  const result = await importarProdutoMagaluEngine({
    job: job(),
    evento: eventoComercial(),
    links: [linkRow({ metadata: { papelLink: "produto" } })],
    deps: {
      ...baseDeps(),
      obterIdentidadeMagaluLocalWorker: async () => ({ identidadeValidada: false, motivo: "magalu_captcha_detectado" }),
      garantirIdentidadeMagaluLocalWorker: async ({ sourceUrl }) => {
        taskCreated = true;
        return { ok: true, task: taskFor(sourceUrl, "identity-captcha") };
      }
    }
  });

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.motivo, "sem_link_produto_confirmado");
  assert.strictEqual(taskCreated, true);
  assert.strictEqual(result.linkOriginal, ONE_LINK);
}

Promise.resolve()
  .then(oneLink403AcionaFallback)
  .then(oneLinkIdentityConfirmedPreservesAnchorAndCommercial)
  .then(divergentIdentityRemainsBlocked)
  .then(repeatedJobUsesIdempotentHelperResult)
  .then(captchaRemainsRetained)
  .then(() => console.log("magalu-onelink-403-fallback.test.cjs ok"))
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
