const assert = require('assert');

const { importarMercadoLivreEngine, _test } = require('../modules/engine/importer/adapters/mercadolivre.adapter');

const ORIGINAL = 'https://meli.la/trace-pesca';
const CANONICAL = 'https://www.mercadolivre.com.br/p/MLB50525153?pdp_filters=item_id%3AMLB4498679443';
const ITEM = 'MLB4498679443';
const IMAGE = 'https://http2.mlstatic.com/D_NQ_NP_2X_MLB4498679443-F.jpg';
const TITLE = 'Vara Pesca Carretilha Maruri Nakamura Mizu 17lb 1,73m 1parte';

function job() {
  return { id: 1197306, evento_id: 246478, cliente_id: 'user_pss60lus', marketplace: 'mercadolivre' };
}

function event() {
  return {
    id: 246478,
    origem: 'clonador_grupos',
    origem_fluxo: 'clonador_grupos',
    texto_original: `${TITLE}\nPor R$ 331,81\nCupom CORREHOJEPROML\n${ORIGINAL}`,
    links_extraidos: [ORIGINAL],
    metadata: {
      comercialCapturado: {
        origem: 'clonador_grupos',
        tituloCapturado: TITLE,
        precoAtual: 331.81,
        precoAnterior: 399.9,
        cupom: 'CORREHOJEPROML',
        beneficioTexto: 'cupom: CORREHOJEPROML'
      }
    }
  };
}

function resolvedLink() {
  return {
    ok: true,
    urlResolvida: 'https://www.mercadolivre.com.br/social/trace',
    linkResolvido: CANONICAL,
    tipoLinkRadar: 'shortlink_meli',
    metodoResolucaoMeli: 'social_action_links_show_product',
    provaTransporteShowProduct: {
      ok: true,
      actionId: 'show_product',
      origem: 'social.action_links.show_product',
      linkResolvidoTecnico: CANONICAL,
      urlProduto: CANONICAL,
      mlbItem: ITEM,
      socialResolvido: 'https://www.mercadolivre.com.br/social/trace',
      ctaPrincipalUnico: true
    }
  };
}

function baseProduct(productId = 'MLB50525153') {
  return {
    marketplace: 'mercadolivre',
    titulo: '',
    nome: '',
    produtoId: productId,
    produtoIdDetectado: productId,
    precoAtual: 331.81,
    preco: 331.81,
    cupom: 'CORREHOJEPROML',
    beneficioTexto: 'cupom: CORREHOJEPROML',
    linkOriginal: ORIGINAL,
    urlFinal: CANONICAL,
    linkAfiliado: 'https://meli.la/workspace-affiliate',
    imagem: '',
    categoria: 'Diversos',
    statusHttp: 200
  };
}

function deps({ trace, officialTitle = TITLE, officialImage = IMAGE } = {}) {
  const calls = { api: 0 };
  return {
    calls,
    deps: {
      onMercadoLivreOfficialRecoveryTrace: (entry) => trace.push(entry),
      getIntegracaoCliente: () => ({ credenciais: { tag: 'synthetic' } }),
      resolverLinkOriginalRadar: async () => resolvedLink(),
      importarMercadoLivre: async () => baseProduct(),
      gerarLinkAfiliadoMercadoLivre: async () => 'https://meli.la/workspace-affiliate',
      buscarImagemOficialMercadoLivrePorMlb: async (mlb) => {
        calls.api += 1;
        return {
          mlb,
          tituloOficial: officialTitle,
          provaTituloOficial: {
            produtoIdCanonico: mlb,
            fonte: 'api_mercadolibre.items.title',
            urlApi: `https://api.mercadolibre.com/items/${mlb}`
          },
          imagem: officialImage,
          origem: officialImage ? 'api_mercadolibre.items.pictures[0].secure_url' : ''
        };
      }
    }
  };
}

async function validProofReachesGate() {
  const trace = [];
  const context = deps({ trace });
  const result = await importarMercadoLivreEngine({
    job: job(),
    evento: event(),
    links: [{ url_original: ORIGINAL, url_normalizada: ORIGINAL, marketplace_detectado: 'mercadolivre' }],
    deps: context.deps
  });

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.titulo, TITLE);
  assert.strictEqual(result.imagem, IMAGE);
  assert.strictEqual(result.linkOriginal, ORIGINAL);
  assert.strictEqual(result.preco, 331.81);
  assert.strictEqual(result.cupom, 'CORREHOJEPROML');
  assert.strictEqual(result.linkAfiliado, 'https://meli.la/workspace-affiliate');
  assert.strictEqual(result.produtoId, 'MLB50525153');
  assert.strictEqual(result.metadata.produto.itemId, ITEM);
  assert.ok(result.metadata.provaTituloTecnico || result.metadata.produto?.provaTituloOficial);
  assert.ok(trace.some((entry) => entry.stage === 'enrichment_entry' && entry.outcome === 'eligible'));
  assert.ok(trace.some((entry) => entry.stage === 'enrichment_exit' && entry.outcome === 'accepted'));
  assert.ok(trace.some((entry) => entry.stage === 'official_api' && entry.outcome === 'started' && entry.officialApiAttempted));
  assert.ok(trace.some((entry) => entry.stage === 'official_api' && entry.outcome === 'completed' && entry.officialApiCompleted));
  const finalGate = trace.find((entry) => entry.stage === 'final_gate');
  assert.ok(finalGate && finalGate.outcome === 'accepted');
  assert.strictEqual(finalGate.identityProofPresent, true);
  assert.strictEqual(finalGate.commercialFieldsPreserved, true);
  assert.ok(trace.every((entry) => !JSON.stringify(entry).includes('https://')));
  assert.strictEqual(context.calls.api, 1);
}

async function divergentOfficialProofFailsClosed() {
  const trace = [];
  const context = deps({ trace, officialTitle: 'Produto divergente sem relação' });
  const result = await _test.enriquecerProdutoMercadoLivreComIdentidadeOficial({
    produto: baseProduct(),
    resolucaoProduto: { resolucaoRadar: resolvedLink() },
    tituloRadar: TITLE,
    urlOriginalEngine: ORIGINAL,
    clienteId: 'user_pss60lus',
    jobId: job().id,
    eventId: job().evento_id,
    deps: context.deps
  });

  assert.strictEqual(result.identidade, null);
  assert.strictEqual(result.produto.titulo, '');
  assert.ok(trace.some((entry) => ['official_title_mismatch', 'official_proof_rejected'].includes(entry.reasonCode)));
  assert.ok(!trace.some((entry) => entry.stage === 'enrichment_exit' && entry.outcome === 'accepted'));
}

async function missingCanonicalEvidenceFailsClosed() {
  const trace = [];
  const context = deps({ trace });
  const result = await _test.enriquecerProdutoMercadoLivreComIdentidadeOficial({
    produto: baseProduct(),
    resolucaoProduto: {},
    tituloRadar: TITLE,
    urlOriginalEngine: ORIGINAL,
    clienteId: 'user_pss60lus',
    jobId: job().id,
    eventId: job().evento_id,
    deps: context.deps
  });

  assert.strictEqual(result.identidade, null);
  assert.ok(trace.some((entry) => entry.reasonCode === 'canonical_candidate_count_invalid'));
  assert.ok(!trace.some((entry) => entry.stage === 'enrichment_exit' && entry.outcome === 'accepted'));
  assert.strictEqual(context.calls.api, 0);
}

async function telemetryFailureDoesNotInterruptImporter() {
  const context = deps({ trace: [] });
  context.deps.onMercadoLivreOfficialRecoveryTrace = () => {
    throw new Error('synthetic telemetry sink failure');
  };
  const result = await importarMercadoLivreEngine({
    job: job(),
    evento: event(),
    links: [{ url_original: ORIGINAL, url_normalizada: ORIGINAL, marketplace_detectado: 'mercadolivre' }],
    deps: context.deps
  });

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.titulo, TITLE);
  assert.strictEqual(result.imagem, IMAGE);
  assert.strictEqual(context.calls.api, 1);
}

(async () => {
  await validProofReachesGate();
  await divergentOfficialProofFailsClosed();
  await missingCanonicalEvidenceFailsClosed();
  await telemetryFailureDoesNotInterruptImporter();
  console.log('mercadolivre-official-recovery-trace: 4/4 PASS');
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
