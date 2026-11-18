const assert = require("assert");

const { importarMercadoLivreEngine, _test } = require("../modules/engine/importer/adapters/mercadolivre.adapter");

const ORIGINAL = "https://meli.la/pesca-rapala";
const CANONICAL = "https://www.mercadolivre.com.br/vara-pesca/p/MLB50525153?pdp_filters=item_id%3AMLB4498679443";
const ITEM = "MLB4498679443";
const IMAGE = "https://http2.mlstatic.com/D_NQ_NP_2X_MLB4498679443-F.jpg";

function baseJob() {
  return { id: 1197306, evento_id: 246478, cliente_id: "user_pss60lus", marketplace: "mercadolivre" };
}

function baseEvent(titulo = "Vara Pesca Carretilha Maruri Nakamura Mizu 17lb 1,73m 1parte") {
  return {
    id: 246478,
    origem: "clonador_grupos",
    origem_fluxo: "clonador_grupos",
    texto_original: `${titulo}\nPor R$ 331,81\nCupom CORREHOJEPROML\n${ORIGINAL}`,
    links_extraidos: [ORIGINAL],
    metadata: {
      comercialCapturado: {
        origem: "clonador_grupos",
        tituloCapturado: titulo,
        precoAtual: 331.81,
        precoAnterior: 399.9,
        cupom: "CORREHOJEPROML",
        beneficioTexto: "cupom: CORREHOJEPROML"
      },
      clonadorGrupos: { destinoIds: ["pesca-destino"] }
    }
  };
}

function resolvedLink() {
  return {
    ok: true,
    urlResolvida: "https://www.mercadolivre.com.br/social/pd-test",
    linkResolvido: CANONICAL,
    tipoLinkRadar: "shortlink_meli",
    metodoResolucaoMeli: "social_action_links_show_product",
    provaTransporteShowProduct: {
      ok: true,
      actionId: "show_product",
      origem: "social.action_links.show_product",
      linkResolvidoTecnico: CANONICAL,
      urlProduto: CANONICAL,
      socialResolvido: "https://www.mercadolivre.com.br/social/pd-test",
      ctaPrincipalUnico: true
    }
  };
}

function productWithoutTechnicalFields() {
  return {
    marketplace: "mercadolivre",
    titulo: "",
    nome: "",
    produtoId: "MLB50525153",
    produtoIdDetectado: "MLB50525153",
    precoAtual: 331.81,
    preco: 331.81,
    cupom: "CORREHOJEPROML",
    beneficioTexto: "cupom: CORREHOJEPROML",
    linkOriginal: ORIGINAL,
    urlFinal: CANONICAL,
    linkAfiliado: "https://meli.la/workspace-affiliate",
    imagem: "",
    categoria: "Diversos",
    statusHttp: 200
  };
}

function deps({ officialTitle = "Vara Pesca Carretilha Maruri Nakamura Mizu 17lb 1,73m 1parte", officialImage = IMAGE } = {}) {
  const calls = { api: 0 };
  return {
    calls,
    deps: {
      getIntegracaoCliente: () => ({ credenciais: { cookies: "ok", tag: "ok" } }),
      resolverLinkOriginalRadar: async () => resolvedLink(),
      importarMercadoLivre: async () => productWithoutTechnicalFields(),
      gerarLinkAfiliadoMercadoLivre: async () => "https://meli.la/workspace-affiliate",
      buscarImagemOficialMercadoLivrePorMlb: async (mlb) => {
        calls.api += 1;
        return {
          mlb,
          tituloOficial: officialTitle,
          provaTituloOficial: {
            produtoIdCanonico: mlb,
            fonte: "api_mercadolibre.items.title",
            urlApi: `https://api.mercadolibre.com/items/${mlb}`
          },
          provaCategoriaOficial: {
            categoria: "Pesca e Camping",
            produtoIdCanonico: mlb,
            fonte: "api_mercadolibre.items.category",
            urlApi: `https://api.mercadolibre.com/items/${mlb}`
          },
          imagem: officialImage,
          origem: officialImage ? "api_mercadolibre.items.pictures[0].secure_url" : "",
          motivo: officialImage ? "api_oficial_mlb_imagem_recuperada" : "api_oficial_mlb_sem_imagem"
        };
      }
    }
  };
}

async function testOfficialTitleAndImageRecovery() {
  const context = deps();
  const result = await importarMercadoLivreEngine({
    job: baseJob(),
    evento: baseEvent(),
    links: [{ url_original: ORIGINAL, url_normalizada: ORIGINAL, url_expandida: "", marketplace_detectado: "mercadolivre" }],
    deps: context.deps
  });

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.titulo, "Vara Pesca Carretilha Maruri Nakamura Mizu 17lb 1,73m 1parte");
  assert.strictEqual(result.imagem, IMAGE);
  assert.strictEqual(result.categoria, "Pesca e Camping");
  assert.strictEqual(result.linkOriginal, ORIGINAL);
  assert.strictEqual(result.preco, 331.81);
  assert.strictEqual(result.cupom, "CORREHOJEPROML");
  assert.strictEqual(result.linkAfiliado, "https://meli.la/workspace-affiliate");
  assert.strictEqual(result.produtoId, "MLB50525153");
  assert.strictEqual(result.metadata.produto.itemId, ITEM);
  assert.strictEqual(context.calls.api, 1);
}

async function testDivergentOfficialTitleFailsClosed() {
  const context = deps({ officialTitle: "Outro produto totalmente divergente" });
  const enriched = await _test.enriquecerProdutoMercadoLivreComIdentidadeOficial({
    produto: productWithoutTechnicalFields(),
    resolucaoProduto: { resolucaoRadar: resolvedLink() },
    tituloRadar: "Vara Pesca Carretilha Maruri Nakamura Mizu 17lb 1,73m 1parte",
    urlOriginalEngine: ORIGINAL,
    clienteId: "user_pss60lus",
    integracao: { credenciais: { tag: "ok" } },
    deps: context.deps
  });
  assert.strictEqual(enriched.identidade, null);
  assert.strictEqual(enriched.produto.titulo, "");
  assert.strictEqual(enriched.produto.imagem, "");
}

async function testNoOfficialImageRemainsFailClosed() {
  const context = deps({ officialImage: "" });
  const result = await importarMercadoLivreEngine({
    job: baseJob(),
    evento: baseEvent(),
    links: [{ url_original: ORIGINAL, url_normalizada: ORIGINAL, url_expandida: "", marketplace_detectado: "mercadolivre" }],
    deps: context.deps
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.titulo, "Vara Pesca Carretilha Maruri Nakamura Mizu 17lb 1,73m 1parte");
  assert.strictEqual(result.imagem, "");
}

async function testVariantDivergenceFailsClosed() {
  const context = deps();
  const produto = { ...productWithoutTechnicalFields(), produtoId: "MLB9999999999", produtoIdDetectado: "MLB9999999999" };
  const enriched = await _test.enriquecerProdutoMercadoLivreComIdentidadeOficial({
    produto,
    resolucaoProduto: { resolucaoRadar: resolvedLink() },
    tituloRadar: "Vara Pesca Carretilha Maruri Nakamura Mizu 17lb 1,73m 1parte",
    urlOriginalEngine: ORIGINAL,
    clienteId: "user_pss60lus",
    integracao: { credenciais: { tag: "ok" } },
    deps: context.deps
  });
  assert.strictEqual(enriched.identidade, null);
  assert.strictEqual(enriched.produto.produtoId, "MLB9999999999");
  assert.strictEqual(context.calls.api, 0);
}

(async () => {
  await testOfficialTitleAndImageRecovery();
  await testDivergentOfficialTitleFailsClosed();
  await testNoOfficialImageRemainsFailClosed();
  await testVariantDivergenceFailsClosed();
  console.log("mercadolivre-pesca-official-recovery: 4/4 PASS");
})().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
