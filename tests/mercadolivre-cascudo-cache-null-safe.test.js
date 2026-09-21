"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-ml-cascudo-cache-null-safe-"));

const databasePath = require.resolve("../modules/engine/database");
require.cache[databasePath] = {
  id: databasePath,
  filename: databasePath,
  loaded: true,
  exports: {
    queryEngine: async sql => {
      if (/INSERT INTO engine_ofertas/i.test(sql)) {
        return { ok: true, resultado: { rows: [{ id: 905, uuid: "uuid-905" }] } };
      }
      if (/UPDATE engine_ofertas\s+SET metadata/i.test(sql)) {
        return { ok: true, resultado: { rows: [{ id: 905 }] } };
      }
      return { ok: true, resultado: { rows: [] } };
    }
  }
};

const importerService = require("../modules/engine/importer/importer.service");

function respostaPdpSemImagem(url = "https://produto.mercadolivre.com.br/MLB123456789") {
  return {
    status: 404,
    ok: false,
    url,
    headers: { get: () => "text/html" },
    text: async () => ""
  };
}

function ofertaMlSemImagem() {
  return {
    ok: true,
    marketplace: "mercadolivre",
    titulo: "Produto ML sem imagem",
    preco: 99.9,
    precoOriginal: 129.9,
    cupom: "MLCUPOM",
    imagem: "",
    imagemOrigem: "",
    linkOriginal: "https://meli.la/exemplo",
    linkExpandido: "https://produto.mercadolivre.com.br/MLB-123456789-produto",
    linkAfiliado: "https://meli.la/afiliado-exemplo",
    origemFluxo: "clonador_grupos",
    produtoIdDetectado: "MLB123456789",
    metadata: {
      adapter: "mercadolivre",
      produto: { produtoId: "MLB123456789" }
    }
  };
}

async function executarGate(cache) {
  const originalFetch = global.fetch;
  const chamadasTask = [];
  const entrada = ofertaMlSemImagem();
  global.fetch = async url => respostaPdpSemImagem(String(url));
  try {
    return await importerService.gravarOfertaEngine(
      { id: 901, evento_id: 902, cliente_id: "workspace_ml", marketplace: "mercadolivre", metadata: { origemFluxo: "clonador_grupos" } },
      { id: 902, origem: "clonador_grupos", origem_tipo: "whatsapp", grupo_id: "grupo@g.us", metadata: { origemFluxo: "clonador_grupos" } },
      {
        id: 903,
        url_original: "https://meli.la/exemplo",
        url_expandida: "https://produto.mercadolivre.com.br/MLB-123456789-produto",
        marketplace_detectado: "mercadolivre"
      },
      entrada,
      {
        obterImagemCacheLocalWorker: async () => cache,
        garantirImagemMercadoLivreLocalWorker: async args => {
          chamadasTask.push(args);
          return { ok: true, task: { id: 904, capability: "ml_image_v1" } };
        }
      }
    ).then(resultado => ({ resultado, chamadasTask, entrada }));
  } finally {
    global.fetch = originalFetch;
  }
}

(async () => {
  const cachesAusentes = [null, undefined, {}];
  for (const cache of cachesAusentes) {
    const { resultado, chamadasTask, entrada } = await executarGate(cache);
    assert.strictEqual(resultado.ok, false);
    assert.strictEqual(resultado.retriavel, true);
    assert.strictEqual(resultado.motivo, "sem_imagem");
    assert.strictEqual(resultado.localWorker.capability, "ml_image_v1");
    assert.strictEqual(resultado.localWorker.productId, "MLB123456789");
    assert.strictEqual(chamadasTask.length, 1);
    assert.strictEqual(chamadasTask[0].productId, "MLB123456789");
    assert.strictEqual(entrada.preco, 99.9);
    assert.strictEqual(entrada.precoOriginal, 129.9);
    assert.strictEqual(entrada.cupom, "MLCUPOM");
    assert.strictEqual(entrada.linkOriginal, "https://meli.la/exemplo");
    assert.strictEqual(entrada.linkAfiliado, "https://meli.la/afiliado-exemplo");
    assert.strictEqual(entrada.origemFluxo, "clonador_grupos");
  }

  const agora = Date.now();
  const cacheValido = {
    marketplace: "mercadolivre",
    productId: "MLB123456789",
    imageUrl: "https://http2.mlstatic.com/D_NQ_NP_MLB123456789.jpg",
    validatedAt: new Date(agora - 60_000).toISOString(),
    expiresAt: new Date(agora + 60_000).toISOString(),
    proof: {
      provenance: "local_worker.ml_image_v1",
      productIdObserved: "MLB123456789",
      sameProductObject: true,
      checkedAt: new Date(agora - 60_000).toISOString()
    }
  };
  const { resultado: resultadoCacheValido, chamadasTask: chamadasCacheValido } = await executarGate(cacheValido);
  assert.strictEqual(resultadoCacheValido.ok, true);
  assert.strictEqual(resultadoCacheValido.oferta.imagem, cacheValido.imageUrl);
  assert.strictEqual(chamadasCacheValido.length, 0);
  const { resultado: resultadoCacheExpirado, chamadasTask: chamadasCacheExpirado } = await executarGate({
    ...cacheValido,
    expiresAt: new Date(agora - 1).toISOString()
  });
  assert.strictEqual(resultadoCacheExpirado.ok, false);
  assert.strictEqual(resultadoCacheExpirado.retriavel, true);
  assert.strictEqual(chamadasCacheExpirado.length, 1);
  assert.strictEqual(importerService.resolverIdentidadeMlWorker({
    identidade: {},
    mlbsMetadata: ["MLB123456789"],
    sourceUrl: "https://produto.mercadolivre.com.br/MLB987654321"
  }).ok, false);
  assert.strictEqual(importerService.resolverIdentidadeMlWorker({
    identidade: {},
    mlbsMetadata: ["MLB123456789", "MLB987654321"],
    sourceUrl: ""
  }).ok, false);

  let cacheLookupCalled = 0;
  let taskCreatorCalled = 0;
  const ofertaComImagem = { ...ofertaMlSemImagem(), imagem: "https://http2.mlstatic.com/D_NQ_NP_MLB123456789.jpg" };
  const resultadoComImagem = await importerService.gravarOfertaEngine(
    { id: 906, evento_id: 907, cliente_id: "workspace_ml", marketplace: "mercadolivre", metadata: { origemFluxo: "clonador_grupos" } },
    { id: 907, origem: "clonador_grupos", origem_tipo: "whatsapp", grupo_id: "grupo@g.us", metadata: { origemFluxo: "clonador_grupos" } },
    {
      id: 908,
      url_original: ofertaComImagem.linkOriginal,
      url_expandida: ofertaComImagem.linkExpandido,
      marketplace_detectado: "mercadolivre"
    },
    ofertaComImagem,
    {
      obterImagemCacheLocalWorker: async () => { cacheLookupCalled += 1; return null; },
      garantirImagemMercadoLivreLocalWorker: async () => { taskCreatorCalled += 1; return { ok: true, task: { id: 906 } }; }
    }
  );
  assert.strictEqual(resultadoComImagem.ok, true);
  assert.strictEqual(cacheLookupCalled, 0);
  assert.strictEqual(taskCreatorCalled, 0);

  console.log("mercadolivre-cascudo-cache-null-safe.test.js: ok");
})().catch(erro => {
  console.error(erro);
  process.exitCode = 1;
});
