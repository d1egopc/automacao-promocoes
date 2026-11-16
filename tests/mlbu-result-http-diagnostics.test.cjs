"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { criarLocalWorkerService } = require("../modules/local-worker/local-worker.service");
const { criarRotasLocalWorker } = require("../modules/local-worker/local-worker.routes");
const enrichment = require("../modules/engine/importer/ml-work-enrichment-shadow");
const { montarItemFilaEngine } = require("../modules/engine/distributor/distributor.service");
const { imagemFontePublicavel } = require("../modules/fila/fila-thumbnail.service");

const segredoAnterior = process.env.JWT_SECRET;
process.env.JWT_SECRET = "mlbu-422-isolated-test-key-not-production";
test.after(() => {
  if (segredoAnterior === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = segredoAnterior;
});

const MLB = "MLB6425677688";
const MLBU = "MLBU3826952667";
const SOURCE = `https://www.mercadolivre.com.br/carretilha-lite-esquerda-kawana-185g-11-rolamentos/up/${MLBU}?pdp_filters=item_id%3A${MLB}`;
const CANONICAL = `https://www.mercadolivre.com.br/carretilha-lite-esquerda-kawana-185g-11-rolamentos/up/${MLBU}`;
const IMAGE = "https://http2.mlstatic.com/D_NQ_NP_672228-MLB113183169306_072026-O.webp";
const AGORA = Date.parse("2026-11-15T23:25:07.600Z");

function associacao(mlb = MLB) {
  return { pageMlbu: MLBU, mlb, source: "nordic_current_product", bookmarkItem: mlb,
    bookmarkPage: MLBU, trackItem: mlb, trackPage: MLBU };
}

function payload(overrides = {}) {
  const collectedAt = "2026-11-15T23:25:07.440Z";
  const base = {
    leaseToken: "lease-fixture", capability: "ml_identity_v1", marketplace: "mercadolivre",
    productId: MLB, expectedMlb: MLB, observedMlb: MLB, identidadeValidada: true,
    tituloOficial: "Carretilha Lite Esquerda Kawana 185g 11 Rolamentos",
    imagemOficial: IMAGE, origemTitulo: "jsonld.name", origemImagem: "jsonld.image",
    finalUrl: SOURCE, canonicalUrl: CANONICAL, variationId: "", collectedAt,
    provaTecnica: { capability: "ml_identity_v1", contractVersion: 1, source: "local_first_party",
      provenance: "local_worker.ml_identity_v1", expectedMlb: MLB, observedMlb: MLB,
      sameProductObject: true, identidadeTipo: "mlb", origemTitulo: "jsonld.name",
      origemImagem: "jsonld.image", finalUrl: SOURCE, canonicalUrl: CANONICAL,
      variationId: "", collectedAt, associacaoPagina: associacao() }
  };
  return { ...base, ...overrides };
}

function task() {
  return { id: "40615", marketplace: "mercadolivre", productId: MLB,
    type: "identidade_oficial", capability: "ml_identity_v1", sourceUrl: SOURCE,
    technicalSlug: `${"c".repeat(64)}:` };
}

function worker() {
  return { ok: true, workerType: "dedicated", workerId: "worker-fixture",
    ownerId: "user_pss60lus", capabilities: ["ml_identity_v1"] };
}

function serviceCom(fetchFn, completarTecnica = async () => ({ ok: true })) {
  return criarLocalWorkerService({ repository: { obterTask: async () => task(), completarTecnica },
    dedicatedOwnerIds: ["user_pss60lus"], fetchFn, agora: () => new Date(AGORA), imageTimeoutMs: 20 });
}

test("task 40615: falha de rede da imagem nao vira HTTP 422 generico", async () => {
  const service = serviceCom(async () => { throw new TypeError("fetch failed"); });
  await assert.rejects(() => service.resultado({ worker: worker(), taskId: "40615", ...payload() }), erro => {
    assert.equal(erro.codigo, "ml_identity_imagem_fetch_sem_resposta");
    assert.equal(erro.statusCode, 503);
    assert.equal(erro.etapa, "imagem_oficial");
    assert.equal(erro.campo, "imagemOficial");
    return true;
  });
});

test("task 40615: a mesma prova conclui quando a imagem oficial responde", async () => {
  let salvo = null;
  const service = serviceCom(async url => ({ ok: true, status: 200, url,
    headers: { get: () => "image/webp" }, body: { cancel: async () => {} } }),
  async args => { salvo = args.metadata; return { ok: true, task: task() }; });
  const resposta = await service.resultado({ worker: worker(), taskId: "40615", ...payload() });
  assert.equal(resposta.ok, true);
  assert.equal(salvo.expectedMlb, MLB);
  assert.equal(salvo.observedMlb, MLB);
  assert.equal(salvo.associacaoPagina.mlb, MLB);
  assert.equal(salvo.tituloOficial, "Carretilha Lite Esquerda Kawana 185g 11 Rolamentos");
  assert.equal(salvo.imagemOficial, IMAGE);
  assert.ok(salvo.provaTecnica.reciboImagem);

  const promocao = enrichment.prepararMlWorkEnrichmentAtivo({
    consulta: { identidadeValidada: true, cacheHit: true, resultado: salvo },
    expectedMlb: MLB, marketplace: "mercadolivre", ativo: true
  });
  const canonica = enrichment.aplicarImagemMlWorkCanonica({}, promocao);
  const oferta = {
    id: "oferta-isolada-40615", cliente_id: "user_pss60lus", marketplace: "mercadolivre",
    titulo: salvo.tituloOficial, categoria: "Pesca e Camping", produtoId: MLB,
    imagem: canonica.imagemCanonicaDuravel, imagemUrl: canonica.imagemCanonicaDuravel,
    imagemOrigem: "local_worker.ml_identity_v1", imagemStatus: "local_worker_ml_identity",
    imagemEnviavel: true, preco: 275.99, precoAnterior: 319.9, cupom: "RADAR10",
    link_original: SOURCE, link_afiliado: "https://meli.la/link-radar-preservado",
    metadata: { imagemOrigem: "local_worker.ml_identity_v1", imagemEnviavel: true,
      localWorkerIdentityProof: canonica.localWorkerIdentityProof,
      ofcV24: { imagemComercial: { origemSelecionada: "local_worker.ml_identity_v1",
        imagemOficial: false, possuiMarcaFonte: false } } }
  };
  const fila = montarItemFilaEngine(oferta);
  assert.equal(fila.titulo, salvo.tituloOficial);
  assert.equal(fila.imagem, IMAGE);
  assert.equal(fila.preco, 275.99);
  assert.equal(fila.precoAnterior, 319.9);
  assert.equal(fila.cupom, "RADAR10");
  assert.equal(fila.linkAfiliado, "https://meli.la/link-radar-preservado");
  assert.equal(imagemFontePublicavel(fila, fila.imagem).ok, true);
});

test("timeout da imagem oficial preserva causa tecnica e continua retriavel", async () => {
  const service = serviceCom(async () => { throw new DOMException("aborted", "AbortError"); });
  await assert.rejects(() => service.resultado({ worker: worker(), taskId: "40615", ...payload() }), erro => {
    assert.equal(erro.codigo, "ml_identity_imagem_fetch_timeout");
    assert.equal(erro.statusCode, 503);
    return true;
  });
});

test("anuncio divergente continua bloqueado antes da validacao HTTP", async () => {
  let fetches = 0;
  const service = serviceCom(async () => { fetches += 1; throw new Error("nao_deveria_buscar"); });
  const divergente = payload({ observedMlb: "MLB9999999999",
    provaTecnica: { ...payload().provaTecnica, observedMlb: "MLB9999999999", associacaoPagina: associacao("MLB9999999999") } });
  await assert.rejects(() => service.resultado({ worker: worker(), taskId: "40615", ...divergente }), /ml_identity_mlb_divergente/);
  assert.equal(fetches, 0);
});

test("rota devolve codigo exato e status retriavel sem expor payload", async () => {
  const service = serviceCom(async () => { throw new TypeError("fetch failed"); });
  service.autenticar = async () => worker();
  const app = express();
  app.use(express.json());
  app.use("/local-worker", criarRotasLocalWorker({ service }));
  const server = await new Promise(resolve => { const aberto = app.listen(0, "127.0.0.1", () => resolve(aberto)); });
  try {
    const resposta = await fetch(`http://127.0.0.1:${server.address().port}/local-worker/tasks/40615/result`, {
      method: "POST", headers: { authorization: "Bearer fixture", "content-type": "application/json" },
      body: JSON.stringify(payload())
    });
    const body = await resposta.json();
    assert.equal(resposta.status, 503);
    assert.equal(body.motivo, "ml_identity_imagem_fetch_sem_resposta");
    assert.equal(JSON.stringify(body).includes("lease-fixture"), false);
    assert.equal(JSON.stringify(body).includes(SOURCE), false);
  } finally {
    await new Promise((resolve, reject) => server.close(erro => erro ? reject(erro) : resolve()));
  }
});
