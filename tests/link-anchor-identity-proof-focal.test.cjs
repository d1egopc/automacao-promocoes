const assert = require('node:assert/strict');
const {
  normalizarOfertaImportada,
  avaliarGateIdentidadeMercadoLivre
} = require('../modules/engine/importer/importer.service');
const { importarShopeeEngine } = require('../modules/engine/importer/adapters/shopee.adapter');

function proof({ marketplace, job, original, canonical, id, title, source, occurrenceId = 'link-occurrence-1' }) {
  return {
    versao: 1, marketplace, jobId: String(job.id), eventoId: String(job.evento_id),
    workspaceId: job.cliente_id,
    ocorrenciaLink: { id: occurrenceId, ordem: 1, campo: 'url_original', urlOriginal: original },
    produto: { produtoIdCanonico: id, urlCanonica: canonical },
    titulo: { valor: title, fonte: source }
  };
}

function mlCase({ jobId, eventId, workspace, mlb, officialTitle, radarTitle, proofId = mlb,
  proofUrl, proofSource = 'og:title', proofJob = jobId, proofOccurrenceId = 'link-occurrence-1',
  anchorUrl, productUrl, resultOriginal, commercialRole = 'produto', proofMissing = false } = {}) {
  const job = { id: jobId, evento_id: eventId, cliente_id: workspace, marketplace: 'mercadolivre' };
  const anchor = anchorUrl || `https://produto.mercadolivre.com.br/MLB-${mlb}-produto-_JM`;
  const canonical = productUrl || `https://produto.mercadolivre.com.br/MLB-${mlb}-produto-oficial-_JM`;
  const identidadeCanonicaMl = { status: 'consistente', mlbForteConfirmado: true,
    mlbProduto: `MLB${mlb}`, mlbRevalidado: `MLB${mlb}`, urlOriginal: anchor, urlCanonicaRevalidada: canonical };
  const raw = {
    ok: true, marketplace: 'mercadolivre', titulo: radarTitle,
    preco: 219.9, precoOriginal: 399.9, cupom: 'RADAR20', cupomTipo: 'texto',
    linkOriginal: resultOriginal || anchor, linkExpandido: canonical, linkAfiliado: `https://meli.la/workspace-${workspace}`,
    produtoIdDetectado: '',
    metadata: {
      adapter: 'mercadolivre', jobId: String(jobId), eventoId: String(eventId), clienteId: workspace,
      linkOriginalEngine: anchor, urlFinalImportador: canonical,
      identidadeCanonicaMl,
      ...(proofMissing ? {} : { provaTituloTecnico: proof({ marketplace: 'mercadolivre', job: { ...job, id: proofJob },
        original: anchor, canonical: proofUrl || canonical, id: `MLB${proofId}`, occurrenceId: proofOccurrenceId,
        title: officialTitle, source: proofSource }) }),
      linksComerciais: [
      { papelLink: commercialRole, urlOriginal: anchor, ocorrenciaId: 'link-occurrence-1', ordemCaptura: 1,
        urlAfiliadaWorkspace: `https://meli.la/workspace-${workspace}` },
      { papelLink: 'resgate', urlOriginal: 'https://meli.la/resgate-capturado', ocorrenciaId: 'link-occurrence-2', ordemCaptura: 2 }
      ],
      produto: { titulo: officialTitle, tituloFonteOficial: proofSource, urlFinal: canonical,
        produtoIdDetectado: `MLB${mlb}`, imagem: 'https://http2.mlstatic.com/D_NQ_NP_example.jpg' }
    }
  };
  return { job, raw, offer: normalizarOfertaImportada(raw, job) };
}

for (const sample of [
  mlCase({ jobId: 1105316, eventId: 224763, workspace: 'tenant_ml_a', mlb: '19628776',
    officialTitle: 'SSD NVMe 1TB Kingston NV2 M.2 PCIe 4.0', radarTitle: 'Convide seus amigos para o grupo' }),
  mlCase({ jobId: 1105171, eventId: 224700, workspace: 'tenant_ml_b', mlb: '5506817364',
    officialTitle: 'Fritadeira Air Fryer Philips Walita 4,1L', radarTitle: 'Oferta imperdível, aproveite agora' })
]) {
  assert.equal(sample.offer.titulo, sample.raw.metadata.produto.titulo, `ML ${sample.job.id}: oficial prevalece ao texto promocional`);
  assert.equal(sample.offer.produtoIdDetectado, sample.raw.metadata.identidadeCanonicaMl.mlbRevalidado);
  assert.equal(avaliarGateIdentidadeMercadoLivre(sample.offer, sample.offer.metadata).retida, false);
  assert.equal(sample.offer.preco, 219.9);
  assert.equal(sample.offer.precoOriginal, 399.9);
  assert.equal(sample.offer.cupom, 'RADAR20');
  assert.equal(sample.offer.linkAfiliado, `https://meli.la/workspace-${sample.job.cliente_id}`);
  assert.equal(sample.offer.metadata.linksComerciais.length, 2);
  assert.equal(sample.offer.metadata.provaTituloTecnicoValidada.validacao, 'confirmada_pelo_importador');
}

const mlBase = mlCase({ jobId: 1105316, eventId: 224763, workspace: 'tenant_ml_a', mlb: '19628776',
  officialTitle: 'SSD NVMe 1TB Kingston NV2 M.2 PCIe 4.0', radarTitle: 'Oferta somente hoje' });
const mlShortAnchor = mlCase({ jobId: 1105316, eventId: 224763, workspace: 'tenant_ml_a', mlb: '19628776',
  officialTitle: 'SSD NVMe 1TB Kingston NV2 M.2 PCIe 4.0', radarTitle: 'Oferta somente hoje',
  anchorUrl: 'https://meli.la/anchor-link', resultOriginal: 'https://produto.mercadolivre.com.br/MLB-19628776-produto-oficial-_JM' });
assert.equal(mlShortAnchor.offer.titulo, 'SSD NVMe 1TB Kingston NV2 M.2 PCIe 4.0',
  'ML: URL resolvida pode divergir literalmente da âncora, mantendo MLB confirmado');
const mlMissingProof = mlCase({ jobId: 1105316, eventId: 224763, workspace: 'tenant_ml_a', mlb: '19628776',
  officialTitle: 'SSD NVMe 1TB Kingston NV2 M.2 PCIe 4.0', radarTitle: 'Oferta somente hoje', proofMissing: true });
assert.equal(mlMissingProof.offer.titulo, '', 'ML sem prova propagada permanece bloqueado');
for (const bad of [
  { proofId: '19999999' },
  { proofJob: 1105171 },
  { proofOccurrenceId: 'another-link-occurrence' },
  { commercialRole: 'resgate' },
  { anchorUrl: 'https://produto.mercadolivre.com.br/MLB-19999999-outro-_JM' },
  { proofSource: 'texto_radar' },
  { proofUrl: 'https://produto.mercadolivre.com.br/MLB-19999999-outro-_JM' }
]) {
  const sample = mlCase({ jobId: 1105316, eventId: 224763, workspace: 'tenant_ml_a', mlb: '19628776',
    officialTitle: 'SSD NVMe 1TB Kingston NV2 M.2 PCIe 4.0', radarTitle: 'Oferta somente hoje', ...bad });
  assert.equal(sample.offer.titulo, '', 'ML: prova divergente, stale ou de origem promocional não confirma título');
  assert.equal(avaliarGateIdentidadeMercadoLivre(sample.offer, sample.offer.metadata).retida, true);
}

const jobAmazon = { id: 1105284, evento_id: 224749, cliente_id: 'tenant_amazon', marketplace: 'amazon' };
const amazonUrl = 'https://www.amazon.com.br/dp/B012345678';
function amazonCase({ anchor = amazonUrl, canonical = amazonUrl, id = 'B012345678', source = 'amazon_importer', proofMissing = false } = {}) {
  const title = 'Placa de captura HDMI USB 3.0 1080P 60 FPS';
  const raw = { ok: true, marketplace: 'amazon', titulo: 'Grupo de ofertas Gerais',
    preco: 99.9, precoOriginal: 159.9, cupom: 'CAPTURA10', linkOriginal: anchor,
    linkExpandido: canonical, linkAfiliado: 'https://amzn.to/workspace-amazon',
    metadata: { adapter: 'amazon', jobId: String(jobAmazon.id), eventoId: String(jobAmazon.evento_id),
      clienteId: jobAmazon.cliente_id, linkOriginalEngine: anchor,
      diagnosticoAmazon: { tituloOrigem: source, importadorBloqueado: false, tituloGenerico: false },
      ...(proofMissing ? {} : { provaTituloTecnico: proof({ marketplace: 'amazon', job: jobAmazon, original: anchor,
        canonical, id, title, source }),
      }),
      linksComerciais: [{ papelLink: 'produto', urlOriginal: anchor, ocorrenciaId: 'link-occurrence-1', ordemCaptura: 1 },
        { papelLink: 'resgate', urlOriginal: 'https://amazon.com.br/resgate', ocorrenciaId: 'link-occurrence-2', ordemCaptura: 2 }],
      produto: { titulo: title, urlFinal: canonical, linkOriginal: canonical,
        imagem: 'https://images.amazon.com.br/image.jpg' }
    }
  };
  return normalizarOfertaImportada(raw, jobAmazon);
}
const amazonOk = amazonCase();
assert.equal(amazonOk.titulo, 'Placa de captura HDMI USB 3.0 1080P 60 FPS');
assert.equal(amazonOk.preco, 99.9);
assert.equal(amazonOk.cupom, 'CAPTURA10');
assert.equal(amazonOk.metadata.linksComerciais.length, 2);
assert.equal(amazonCase({ anchor: 'https://amzn.to/anchor-shortlink', canonical: amazonUrl }).titulo,
  'Placa de captura HDMI USB 3.0 1080P 60 FPS', 'Amazon: link curto ligado ao ASIN canônico recuperado');
assert.equal(amazonCase({ canonical: 'https://www.amazon.com.br/dp/B099999999' }).titulo, '');
assert.equal(amazonCase({ source: 'radar_mirror' }).titulo, '');
assert.equal(amazonCase({ proofMissing: true }).titulo, '', 'Amazon sem prova propagada permanece bloqueada');

const jobShopee = { id: 1103477, evento_id: 224020, cliente_id: 'tenant_shopee', marketplace: 'shopee' };
const shopeeUrl = 'https://shopee.com.br/product/284312776/58258390791';
function shopeeCase({ anchor = shopeeUrl, canonical = shopeeUrl, shopId = '284312776',
  itemId = '58258390791', source = 'api.productOfferV2', proofMissing = false } = {}) {
  const title = 'Suporte articulado para monitor VESA';
  const raw = { ok: true, marketplace: 'shopee', titulo: 'Grupo de ofertas Gerais',
    preco: 79.9, precoOriginal: 119.9, cupom: 'SHOPEE10', linkOriginal: anchor,
    linkExpandido: canonical, linkAfiliado: 'https://shope.ee/workspace-shopee',
    produtoIdDetectado: `${shopId}/${itemId}`,
    metadata: { adapter: 'shopee', jobId: String(jobShopee.id), eventoId: String(jobShopee.evento_id),
      clienteId: jobShopee.cliente_id, linkOriginalEngine: anchor,
      ...(proofMissing ? {} : { provaTituloTecnico: proof({ marketplace: 'shopee', job: jobShopee, original: anchor,
        canonical, id: `${shopId}/${itemId}`, title, source }),
      }),
      linksComerciais: [{ papelLink: 'produto', urlOriginal: anchor, ocorrenciaId: 'link-occurrence-1', ordemCaptura: 1 },
        { papelLink: 'moedas', urlOriginal: 'https://shopee.com.br/moedas/capturado', ocorrenciaId: 'link-occurrence-2', ordemCaptura: 2 }],
      produto: { titulo: title, tituloOrigem: source, shopId, itemId,
        linkExpandido: canonical,
        identidadeProdutoValidada: { fonte: source, shopId, itemId, urlCanonica: canonical } }
    }
  };
  return normalizarOfertaImportada(raw, jobShopee);
}
const shopeeOk = shopeeCase();
assert.equal(shopeeOk.titulo, 'Suporte articulado para monitor VESA');
assert.equal(shopeeOk.preco, 79.9);
assert.equal(shopeeOk.precoOriginal, 119.9);
assert.equal(shopeeOk.cupom, 'SHOPEE10');
assert.equal(shopeeOk.metadata.linksComerciais.length, 2);
assert.equal(shopeeCase({ itemId: '58258390000' }).titulo, '');
assert.equal(shopeeCase({ source: 'html_fallback' }).titulo, '');
assert.equal(shopeeCase({ proofMissing: true }).titulo, '', 'Shopee sem prova propagada permanece bloqueada');

(async () => {
  const job = { id: 101, evento_id: 201, cliente_id: 'workspace_teste', marketplace: 'shopee' };
  const cupom = 'https://s.shopee.com.br/4fut1OkrEh';
  const produto = 'https://s.shopee.com.br/8AUlBpU61C';
  const canonical = 'https://shopee.com.br/product/123/456';
  const adapterResult = await importarShopeeEngine({
    job,
    evento: { texto_original: ['Water Cooler Aigo Darkflash DC360 Radiant', 'R$ 229',
      `Resgate todos os cupons desta pagina: ${cupom}`, `Link do produto: ${produto}`].join('\n'),
      links_extraidos: [cupom, produto] },
    links: [
      { id: 1, url_original: cupom, url_normalizada: cupom, url_expandida: '', marketplace_detectado: 'shopee', metadata: {} },
      { id: 2, url_original: produto, url_normalizada: produto, url_expandida: '', marketplace_detectado: 'shopee', metadata: {} }
    ],
    deps: {
      getIntegracaoCliente: () => ({ credenciais: { appId: 'app', secret: 'secret' } }),
      expandirShortlinkShopee: async url => url,
      importarShopee: async () => ({
        titulo: 'Water Cooler Aigo Darkflash DC360 Radiant', tituloOrigem: 'api.productOfferV2',
        precoAtual: '229.00', precoOriginal: '399.00', imagem: 'https://img.test/official-product.jpg',
        linkAfiliado: 'https://shopee.com.br/product/123/456?mmp_pid=an_app',
        linkExpandido: canonical, shopId: '123', itemId: '456', categoria: 'Computadores e Notebook',
        identidadeProdutoValidada: { fonte: 'api.productOfferV2', shopId: '123', itemId: '456',
          urlCanonica: canonical }
      })
    }
  });
  assert.equal(adapterResult.ok, true);
  assert.equal(adapterResult.metadata.provaTituloTecnico?.ocorrenciaLink?.id, '2');
  const normalized = normalizarOfertaImportada(adapterResult, job);
  assert.equal(normalized.titulo, 'Water Cooler Aigo Darkflash DC360 Radiant');
  assert.equal(normalized.metadata.provaTituloTecnicoValidada?.validacao, 'confirmada_pelo_importador');
  assert.equal(normalized.metadata.linksComerciais.length, 2, 'a ocorrência auxiliar continua preservada');
  assert.equal(normalized.linkAfiliado, 'https://shopee.com.br/product/123/456?mmp_pid=an_app');
  console.log('link-anchor-identity-proof-focal.test.cjs OK; Shopee adapter -> anchor proof -> normalized offer OK');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
