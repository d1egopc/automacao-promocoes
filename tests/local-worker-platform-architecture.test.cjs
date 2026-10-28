"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { criarLocalWorkerService } = require("../modules/local-worker/local-worker.service");
const { criarLocalWorkerRepository } = require("../modules/local-worker/local-worker.repository");
const { importarProdutoMagaluEngine } = require("../modules/engine/importer/adapters/magalu.adapter");
const { gerarLinkAfiliadoMagaluSeguro, linkPertenceLojaMagalu } = require("../modules/marketplaces/magalu/magalu-affiliate-link");

const productId = "123456789";
const canonicalUrl = `https://www.magazineluiza.com.br/produto-fixture/p/${productId}/ud/poud/`;
const imageUrl = `https://a-static.mlcdn.com.br/800x560/produto-fixture/loja/${productId}/fixture.jpg`;
const technicalHref = `https://www.magazinevoce.com.br/magazined1egopc/produto-fixture/p/${productId}/ud/poud/`;

test("the existing converter accepts dynamic stores and legacy aliases while retaining product and seller", () => {
  const source = canonicalUrl + "?seller_id=vendedor_fixture";
  for (const promoterId of ["d1egopc", "loja_brnofertas", "mariadasdores", "nova-loja-2026"]) {
    const converted = gerarLinkAfiliadoMagaluSeguro(source, promoterId);
    const url = new URL(converted.urlAfiliada);
    assert.equal(url.hostname, "www.magazinevoce.com.br");
    assert.equal(url.pathname, `/magazine${promoterId}/produto-fixture/p/${productId}/ud/poud/`);
    assert.equal(url.searchParams.get("seller_id"), "vendedor_fixture");
    for (const alias of [promoterId, `magazine${promoterId}`]) {
      const legacy = `https://www.magazinevoce.com.br/${alias}/produto-fixture/p/${productId}/ud/poud/?seller_id=vendedor_fixture`;
      assert.equal(linkPertenceLojaMagalu(legacy, promoterId), true);
      assert.equal(gerarLinkAfiliadoMagaluSeguro(legacy, promoterId).urlAfiliada, legacy);
      assert.equal(linkPertenceLojaMagalu(legacy, "foreign_workspace_store"), false);
    }
    const onelink = gerarLinkAfiliadoMagaluSeguro("https://magazineluiza.onelink.me/589508454/cykrl2vm", promoterId);
    assert.equal(onelink.comprovado, false, "OneLink alone never establishes store affiliation");
    assert.equal(onelink.urlAfiliada, "");
  }
});

test("an authorized personal worker is dedicated without an Admin Master identity", async () => {
  const registrations = [];
  let claimed;
  const service = criarLocalWorkerService({
    dedicatedOwnerIds: ["personal_owner_fixture"],
    magaluTechnicalSlug: "d1egopc",
    repository: {
      registrarWorkerDedicated: async payload => { registrations.push(payload); return { ok: true, workerType: "dedicated", workerId: payload.workerId, capabilities: payload.capabilities }; },
      registrarWorkerCommunity: async () => ({ ok: true, workerType: "community" }),
      claim: async payload => { claimed = payload; return { ok: true, task: { id: "platform-task", productId, capability: "magalu_image_v1" } }; }
    }
  });
  const registration = await service.registrarWorker({ ownerId: "personal_owner_fixture", workerId: "personal_pc", capabilities: ["magalu_image_v1", "ml_image_v1"] });
  assert.equal(registration.workerType, "dedicated");
  assert.equal(registrations[0].ownerId, "personal_owner_fixture");
  const worker = { ok: true, ownerId: "personal_owner_fixture", workerId: "personal_pc", workerType: "dedicated", capabilities: registration.capabilities };
  assert.equal((await service.claim({ worker })).task.id, "platform-task");
  assert.deepEqual(claimed, { workerId: "personal_pc", capabilities: ["magalu_image_v1", "ml_image_v1"] });
  assert.equal((await service.registrarWorker({ ownerId: "unapproved_owner" })).workerType, "community");
  await assert.rejects(() => service.claim({ worker: { ...worker, workerType: "community" } }), /worker_nao_autorizado/);
  await assert.rejects(() => service.claim({ worker: { ...worker, ownerId: "unapproved_owner" } }), /worker_dedicated_nao_autorizado/);
});

test("the repository leases technical tasks globally and exposes no commercial workspace mapping", async () => {
  let claimQuery;
  const client = {
    query: async (sql, params) => {
      if (/WITH candidato AS/.test(sql)) {
        claimQuery = { sql, params };
        return { rows: [{ id: "shared-task", marketplace: "magalu", product_id: productId, source_url: canonicalUrl, technical_slug: "d1egopc", capability: "magalu_image_v1", status: "leased" }] };
      }
      return { rows: [] };
    },
    release() {}
  };
  const repo = criarLocalWorkerRepository({ pool: { connect: async () => client, query: async () => ({ rows: [] }) } });
  const result = await repo.claim({ workerId: "personal_pc", capabilities: ["magalu_image_v1"] });
  assert.equal(result.task.id, "shared-task");
  assert.deepEqual(claimQuery.params[0], ["magalu_image_v1"]);
  assert.equal(claimQuery.params[1], "personal_pc");
  assert.match(claimQuery.sql, /FOR UPDATE SKIP LOCKED LIMIT 1/);
  assert.doesNotMatch(claimQuery.sql, /owner_id|cliente_id|workspace_id/);
  assert.equal(result.task.technicalSlug, "d1egopc");
  // This asserts the current observability limitation, not compliance with a
  // requester-provenance contract. Commercial ownership remains on Engine jobs.
  for (const key of ["clienteId", "workspaceId", "eventoId", "jobId"]) assert.equal(Object.hasOwn(result.task, key), false);
});

test("a shared technical image supports dynamic workspace stores without crossing affiliations", async () => {
  let cached;
  const task = { id: "image-task-fixture", marketplace: "magalu", productId, capability: "magalu_image_v1" };
  const service = criarLocalWorkerService({
    dedicatedOwnerIds: ["personal_owner_fixture"],
    magaluTechnicalSlug: "d1egopc",
    fetchFn: async () => ({ ok: true, status: 200, url: imageUrl, headers: { get: () => "image/jpeg" }, body: { cancel: async () => undefined } }),
    repository: {
      obterTask: async () => task,
      completar: async payload => {
        cached = { marketplace: "magalu", productId, source: "local_first_party", imageUrl: payload.imageUrl, proof: payload.proof };
        return { ok: true };
      },
      obterCache: async ({ marketplace, productId: expected }) => marketplace === "magalu" && expected === productId ? cached : null
    }
  });
  await service.resultado({
    worker: { ok: true, workerType: "dedicated", ownerId: "personal_owner_fixture", workerId: "personal_pc", capabilities: ["magalu_image_v1"] },
    taskId: task.id, leaseToken: "fixture-lease", marketplace: "magalu", productId, imagemOficialUrl: imageUrl,
    provaTecnica: { productId, skuConfirmado: true, hrefConfirmado: true, origem: "local_first_party", hrefProduto: technicalHref, hostFinal: "a-static.mlcdn.com.br" }
  });
  assert.equal(cached.proof.hrefProduto, technicalHref);
  // Fictional integration values; these do not assert existence or commission.
  const integrations = { workspace_a: "d1egopc", workspace_b: "loja_brnofertas", workspace_c: "mariadasdores", workspace_new: "nova-loja-2026" };
  const outputs = [];
  for (const [workspaceId, promoter] of Object.entries(integrations)) {
    const ownUrl = `https://www.magazinevoce.com.br/magazine${promoter}/produto-fixture/p/${productId}/ud/poud/`;
    const result = await importarProdutoMagaluEngine({
      job: { id: `job-${workspaceId}`, evento_id: "event-fixture", cliente_id: workspaceId },
      evento: { texto_original: `Kit potes hermeticos fixture\nDe R$ 129,90\nPor R$ 85,41\n${canonicalUrl}`, cupom: "FIXTURE10", links_extraidos: [canonicalUrl] },
      links: [{ url_original: canonicalUrl, url_normalizada: canonicalUrl, marketplace_detectado: "magalu", metadata: {} }],
      deps: {
        getIntegracaoCliente: id => ({ credenciais: { promoterId: integrations[id] } }),
        obterImagemCacheLocalWorker: service.obterImagemCache,
        resolverFatosMagalu: async ({ promoterId }) => {
          assert.equal(promoterId, promoter);
          return { ok: true, fonteUsada: "fixture_workspace_page", avisos: [], fatos: { urlOriginal: canonicalUrl, produtoId: productId, codigo: productId, urlAfiliavelComprovada: ownUrl, magaluWorkspaceValidado: true, avisos: [] } };
        }
      }
    });
    assert.equal(result.ok, true);
    assert.equal(result.imagem, imageUrl);
    assert.equal(result.preco, 85.41);
    assert.equal(result.precoOriginal, "129,90");
    assert.equal(result.cupom, "FIXTURE10");
    assert.equal(result.linkAfiliado, ownUrl);
    assert.equal(result.metadata.afiliacaoWorkspace.workspaceId, workspaceId);
    // The published affiliation contract stores the normalized store path,
    // including the "magazine" prefix, rather than the unnormalized input.
    assert.equal(result.metadata.afiliacaoWorkspace.slugLoja, `magazine${promoter}`);
    assert.doesNotMatch(JSON.stringify(result), /personal_owner_fixture|personal_pc|fixture-lease/);
    if (promoter !== "d1egopc") assert.doesNotMatch(result.linkAfiliado, /d1egopc/);
    outputs.push(result);
  }
  assert.equal(new Set(outputs.map(result => result.linkAfiliado)).size, Object.keys(integrations).length);
});

test("a workspace without Magalu integration fails closed before using technical worker affiliation", async () => {
  for (const integration of [null, {}, { credenciais: {} }, { credenciais: { promoterId: "" } }]) {
    let resolverCalls = 0;
    const result = await importarProdutoMagaluEngine({
      job: { id: "missing-integration-fixture", cliente_id: "workspace_without_integration" },
      evento: { texto_original: `Produto fixture\nPor R$ 85,41\n${canonicalUrl}`, links_extraidos: [canonicalUrl] },
      links: [{ url_original: canonicalUrl, marketplace_detectado: "magalu", metadata: {} }],
      deps: {
        getIntegracaoCliente: () => integration,
        resolverFatosMagalu: async () => { resolverCalls++; throw new Error("must_not_resolve_without_integration"); }
      }
    });
    assert.equal(result.ok, false);
    assert.equal(result.motivo, "integracao_ausente");
    assert.equal(result.linkAfiliado, undefined);
    assert.equal(resolverCalls, 0);
  }
});

test("a technical D1EGOPC page cannot replace another workspace affiliate URL", async () => {
  const result = await importarProdutoMagaluEngine({
    job: { id: "foreign-affiliate-fixture", cliente_id: "workspace_a" },
    evento: { texto_original: `Kit potes hermeticos fixture\nPor R$ 85,41\n${canonicalUrl}`, links_extraidos: [canonicalUrl] },
    links: [{ url_original: canonicalUrl, marketplace_detectado: "magalu", metadata: {} }],
    deps: {
      getIntegracaoCliente: () => ({ credenciais: { promoterId: "lojaaa" } }),
      obterImagemCacheLocalWorker: async () => ({ source: "local_first_party", imageUrl, proof: { hrefProduto: technicalHref } }),
      resolverFatosMagalu: async () => ({ ok: true, avisos: [], fatos: { urlOriginal: canonicalUrl, produtoId: productId, urlAfiliavelComprovada: technicalHref, magaluWorkspaceValidado: true, avisos: [] } })
    }
  });
  assert.equal(result.ok, false);
  assert.equal(result.motivo, "afiliacao_workspace_incompleta");
  assert.equal(result.linkAfiliado, undefined);
});
