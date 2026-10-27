"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fixture = require("./fixtures/magalu-197029-retry.sanitized.json");
// Allows the unchanged tests to exercise the exact published baseline in isolation.
const root = process.env.MAGALU_RECOVERY_TEST_ROOT || path.resolve(__dirname, "..");
const db = require(path.join(root, "modules/engine/database.js"));
let row;
const queries = [];
db.queryEngine = async (sql, params) => {
  queries.push({ sql, params });
  if (/UPDATE engine_jobs_cliente/.test(sql) && /jsonb_build_object\('localWorkerImageRetry'/.test(sql)) {
    if (row.status !== "importando") return { ok: true, resultado: { rowCount: 0, rows: [] } };
    row.status = "pronto_para_importar";
    row.tentativas++;
    row.metadata.localWorkerImageRetry = JSON.parse(params[1]);
    return { ok: true, resultado: { rowCount: 1, rows: [structuredClone(row)] } };
  }
  if (/INSERT INTO engine_processamentos/.test(sql)) return { ok: true, resultado: { rowCount: 1, rows: [{ id: "fixture-processing" }] } };
  if (/UPDATE engine_jobs_cliente\s+SET atualizado_em = NOW\(\)/.test(sql)) return { ok: true, resultado: { rowCount: 1, rows: [{ id: row.id, status: row.status }] } };
  if (/UPDATE engine_jobs_cliente/.test(sql) && /status = \$2/.test(sql)) {
    row.status = params[1];
    return { ok: true, resultado: { rowCount: 1, rows: [{ id: row.id, status: row.status }] } };
  }
  throw new Error("unexpected_fixture_query");
};
const { planoRetryImagemMagaluLocal, agendarRetryImagemMagaluLocal } = require(path.join(root, "modules/engine/importer/importer.service.js"));
const { tratarFalhaRetriavelMagalu } = require(path.join(root, "modules/engine/importer/importer.runner.js"));
const { importarProdutoMagaluEngine } = require(path.join(root, "modules/engine/importer/adapters/magalu.adapter.js"));
const identity = { capability: "magalu_identity_v1", motivo: "aguardando_identidade_local" };
const image = { capability: "magalu_image_v1", motivo: "imagem_oficial_local_pendente" };
const now = new Date(fixture.evidence.imageFailureAt);
function reset() {
  queries.length = 0;
  row = { id: "fixture-job", evento_id: "fixture-event", cliente_id: fixture.simulation.workspace, status: "importando", tentativas: 0, metadata: { preserved: { coupon: fixture.simulation.coupon } } };
}
async function schedule(details, time = now) {
  row.status = "importando";
  return agendarRetryImagemMagaluLocal(structuredClone(row), details, { agora: time });
}

test("identity wait exhaustion does not consume the image wait budget", async () => {
  reset();
  for (let i = 0; i < 3; i++) {
    const result = await schedule(identity, new Date(fixture.evidence.identityWaits[i]));
    assert.equal(result.ok, true);
    assert.equal(result.tentativa, i + 1);
  }
  const result = await schedule(image);
  assert.equal(result.ok, true, "image recovery must get its first bounded wait after identity succeeds");
  assert.equal(result.tentativa, 1);
  assert.equal(result.atrasoMs, 30_000);
  assert.equal(row.tentativas, 4);
  assert.deepEqual(row.metadata.preserved, { coupon: fixture.simulation.coupon });
});

test("each phase remains bounded and cannot cycle back to identity", async () => {
  reset();
  for (let i = 0; i < 3; i++) assert.equal((await schedule(identity)).ok, true);
  assert.equal((await schedule(identity)).esgotado, true);
  for (let i = 0; i < 3; i++) {
    const result = await schedule(image);
    assert.equal(result.ok, true);
    assert.equal(result.tentativa, i + 1);
  }
  assert.equal((await schedule(image)).esgotado, true);
  assert.equal((await schedule(identity)).esgotado, true);
  assert.equal(row.tentativas, 6);
});

test("legacy image retries retain their original exhaustion and backoff", () => {
  for (const [attempts, delay] of [[0, 30_000], [1, 120_000], [2, 300_000], [3, undefined]]) {
    const result = planoRetryImagemMagaluLocal({ metadata: { localWorkerImageRetry: { tentativas: attempts } } }, now);
    assert.equal(result.atrasoMs, delay);
    assert.equal(result.reagendar, attempts < 3);
  }
});

test("a phase regression is blocked even before the image budget is exhausted", async () => {
  reset();
  await schedule(identity);
  await schedule(image);
  assert.equal((await schedule(identity)).esgotado, true);
  assert.equal(row.tentativas, 2);
  assert.equal(row.metadata.localWorkerImageRetry.etapa, "imagem");
});

test("an unspecified caller cannot erase a recorded phase and permit cycling", async () => {
  reset();
  await schedule(identity);
  await schedule(image);
  await schedule({});
  assert.equal(row.metadata.localWorkerImageRetry.etapa, "imagem");
  assert.equal((await schedule(identity)).esgotado, true);
});

test("unknown or missing capability cannot reset an exhausted phase", async () => {
  for (const details of [{}, { capability: "unknown" }, { capability: "magalu_image_v1", motivo: "unknown" }]) {
    reset();
    row.metadata.localWorkerImageRetry = { tentativas: 3, etapa: "identidade", capability: "magalu_identity_v1" };
    const result = await schedule(details);
    assert.equal(result.esgotado, true);
    assert.equal(queries.length, 0);
  }
});

test("existing compare-and-set prevents duplicate scheduling and terminal reopening", async () => {
  reset();
  const original = structuredClone(row);
  assert.equal((await agendarRetryImagemMagaluLocal(original, identity, { agora: now })).ok, true);
  assert.equal((await agendarRetryImagemMagaluLocal(original, identity, { agora: now })).ignorado, true);
  assert.equal(row.tentativas, 1);
  row.status = "erro_importacao";
  assert.equal((await agendarRetryImagemMagaluLocal(original, identity, { agora: now })).ok, false);
  assert.equal(row.status, "erro_importacao");
});

function commercialFixture() {
  const f = fixture.simulation;
  const url = fixture.evidence.sourceUrl;
  return {
    evento: { cupom: f.coupon, texto_original: `${f.title}\nDe R$ ${f.previousPrice}\nPor R$ ${f.price}\n${url}`, links_extraidos: [url] },
    links: [{ id: "fixture-link", url_original: url, url_normalizada: url, marketplace_detectado: "magalu", metadata: {} }],
    deps: {
      getIntegracaoCliente: (workspace) => workspace === f.workspace ? { credenciais: { promoterId: f.promoter } } : null,
      obterIdentidadeMagaluLocalWorker: async () => ({ identidadeValidada: true, sourceUrl: url, observedProductId: f.productId, canonicalUrl: f.canonicalUrl, finalUrl: f.canonicalUrl }),
      garantirIdentidadeMagaluLocalWorker: async () => { throw new Error("duplicate_identity_task"); },
      obterImagemCacheLocalWorker: async () => null,
      obterTaskImagemMagaluLocalWorker: async () => ({ ok: true, task: { id: "fixture-image-task", status: "pending", capability: "magalu_image_v1" } }),
      resolverFatosMagalu: async () => { throw new Error("must_wait_for_existing_image_task"); }
    }
  };
}

test("adapter and official runner keep a job alive when identity finishes after three waits", async () => {
  reset();
  for (const time of fixture.evidence.identityWaits) await schedule(identity, new Date(time));
  const f = commercialFixture();
  const blocked = await importarProdutoMagaluEngine({ job: row, ...f });
  assert.equal(blocked.motivo, "sem_imagem");
  assert.equal(blocked.retriavel, true);
  row.status = "importando";
  const retry = await tratarFalhaRetriavelMagalu(structuredClone(row), blocked, "magalu", { erros: 0, retentativas: 0, motivos: {} }, {
    deps: { agendarRetryImagemMagaluLocal: (job, details) => agendarRetryImagemMagaluLocal(job, details, { agora: now }) }
  });
  assert.equal(retry.reagendado, true);
  assert.equal(retry.tentativa, 1);
  assert.equal(row.status, "pronto_para_importar");
});

test("image completion reuses the existing cache and workspace affiliation, preserving commercial fields", async () => {
  reset();
  const f = commercialFixture();
  const p = fixture.simulation;
  const ownUrl = `https://www.magazinevoce.com.br/magazine${p.promoter}/produto-fixture/p/${p.productId}/ud/poud/`;
  const original = structuredClone(f.evento);
  let taskCreated = 0;
  const result = await importarProdutoMagaluEngine({ job: row, evento: f.evento, links: f.links, deps: {
    ...f.deps,
    obterImagemCacheLocalWorker: async () => ({ source: "local_first_party", imageUrl: p.imageUrl }),
    garantirImagemMagaluLocalWorker: async () => { taskCreated++; },
    resolverFatosMagalu: async () => ({ ok: true, fonteUsada: "fixture_page", fatos: {
      urlOriginal: p.canonicalUrl, urlAfiliavelComprovada: ownUrl, magaluWorkspaceValidado: true,
      produtoId: p.productId, codigo: p.productId, precoAtual: "999,00", titulo: "Different page title", avisos: []
    }, avisos: [] })
  } });
  assert.equal(result.ok, true);
  assert.equal(result.titulo, p.title);
  assert.equal(result.preco, 85.41);
  assert.equal(result.precoOriginal, p.previousPrice);
  assert.equal(result.cupom, p.coupon);
  assert.equal(result.imagem, p.imageUrl);
  assert.equal(result.linkAfiliado, ownUrl);
  // Baseline adapter lines 1019-1026 deliberately project identity without sourceUrl.
  // Original provenance is contracted in linksClassificados, not that projection.
  // This newly authored fixture assertion corrects a nonexistent-field expectation;
  // it does not change or waive any published assertion or production behavior.
  assert.equal(result.metadata.identidadeLocalWorker.canonicalUrl, p.canonicalUrl);
  assert.equal(result.metadata.linksClassificados.find(link => link.urlOriginal === fixture.evidence.sourceUrl)?.urlOriginal, fixture.evidence.sourceUrl);
  assert.deepEqual(f.evento, original);
  assert.equal(taskCreated, 0);
});

test("another workspace cannot borrow the configured affiliate integration", async () => {
  reset();
  const f = commercialFixture();
  const result = await importarProdutoMagaluEngine({ job: { ...row, cliente_id: "workspace_fixture_b" }, ...f });
  assert.equal(result.ok, false);
  assert.equal(result.motivo, "integracao_ausente");
});

test("unconfirmed identity remains blocked and creates only the existing identity task", async () => {
  reset();
  const f = commercialFixture();
  let imageCalls = 0;
  const result = await importarProdutoMagaluEngine({ job: row, evento: f.evento, links: f.links, deps: {
    ...f.deps,
    obterIdentidadeMagaluLocalWorker: async () => ({ identidadeValidada: true, observedProductId: "other-product", canonicalUrl: fixture.simulation.canonicalUrl }),
    garantirIdentidadeMagaluLocalWorker: async () => ({ ok: true, task: { id: "fixture-identity-task", status: "pending", capability: "magalu_identity_v1" } }),
    obterImagemCacheLocalWorker: async () => { imageCalls++; return null; }
  } });
  assert.equal(result.motivo, "sem_link_produto_confirmado");
  assert.equal(imageCalls, 0);
});
