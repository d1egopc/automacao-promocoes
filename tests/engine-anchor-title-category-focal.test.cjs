const assert = require('node:assert/strict');
const { normalizarOfertaImportada, reclassificarCategoriaFinalEngine } = require('../modules/engine/importer/importer.service');
const { tituloComercialUniversalValido } = require('../modules/radar/comercial-precedencia');

const jobShopee = { id: 'fixture-job-shopee-anchor-01', evento_id: 'fixture-event-shopee-anchor-01', cliente_id: 'fixture-workspace-a', marketplace: 'shopee' };
const provaShopee = (itemId = '456', titulo = 'Fone Bluetooth JBL Tune 520BT Preto', url = `https://shopee.com.br/product/123/${itemId}`) => ({
  versao: 1, marketplace: 'shopee', jobId: jobShopee.id, eventoId: jobShopee.evento_id,
  workspaceId: jobShopee.cliente_id,
  ocorrenciaLink: { id: 'link-shopee-1', ordem: 1, campo: 'url_original', urlOriginal: url },
  produto: { produtoIdCanonico: `123/${itemId}`, urlCanonica: url },
  titulo: { valor: titulo, fonte: 'api.productOfferV2' }
});

for (const [marketplace, titulo] of [
  ['shopee', 'Bot de Alertas: @TalkPCAlertasBot'],
  ['shopee', 'Grupo de ofertas Gerais'],
  ['aliexpress', 'No APP, vai abrir na página de moedas']
]) {
  assert.equal(tituloComercialUniversalValido(titulo, { marketplace }), false);
  const oferta = normalizarOfertaImportada({ marketplace, titulo, categoria: 'Diversos', preco: 32,
    precoOriginal: 49, cupom: 'RADAR10', linkOriginal: 'https://example.com/produto',
    metadata: { linksComerciais: [{ urlOriginal: 'https://example.com/produto', papelLink: 'link_app' }] }
  }, { marketplace });
  assert.equal(oferta.titulo, '');
  assert.equal(oferta.preco, 32);
  assert.equal(oferta.precoOriginal, 49);
  assert.equal(oferta.cupom, 'RADAR10');
  assert.equal(oferta.linkOriginal, 'https://example.com/produto');
  assert.equal(oferta.metadata.linksComerciais.length, 1);
}

const placa = normalizarOfertaImportada({ marketplace: 'amazon',
  titulo: 'Placa de captura de vídeo 4K HDTVI para USB 3.0, dispositivo de captura HDMI 1080P a 60 FPS',
  categoria: 'Perfumaria, Farmácia e Beleza' }, { marketplace: 'amazon' });
assert.equal(placa.categoria, 'Periféricos');

const yamalube = normalizarOfertaImportada({ marketplace: 'mercadolivre',
  titulo: 'Óleo Náutico Tcw3 2t Yamalube Kit 4l Grátis Boné Yamaha',
  categoria: 'Roupas e Moda Masculina' }, { marketplace: 'mercadolivre' });
assert.equal(yamalube.categoria, 'Diversos');

const oficial = normalizarOfertaImportada({ marketplace: 'shopee',
  titulo: 'Fone Bluetooth JBL Tune 520BT Preto', categoria: 'Áudio e Vídeo',
  produtoIdDetectado: '123/456', linkOriginal: 'https://shopee.com.br/product/123/456' }, { marketplace: 'shopee' });
assert.equal(oficial.titulo, 'Fone Bluetooth JBL Tune 520BT Preto');
assert.equal(oficial.categoria, 'Áudio e Vídeo');
assert.equal(oficial.produtoIdDetectado, '123/456');

const ofertaAncorada = (idLink, idProduto = idLink) => normalizarOfertaImportada({
  marketplace: 'shopee', titulo: 'Grupo de ofertas Gerais', preco: 32,
  precoOriginal: 49, cupom: 'RADAR10',
  linkOriginal: `https://shopee.com.br/product/123/${idLink}`,
  linkExpandido: `https://shopee.com.br/product/123/${idLink}`,
  produtoIdDetectado: `123/${idLink}`,
  metadata: { adapter: 'shopee', jobId: jobShopee.id, eventoId: jobShopee.evento_id,
    clienteId: jobShopee.cliente_id, linkOriginalEngine: `https://shopee.com.br/product/123/${idLink}`,
    provaTituloTecnico: provaShopee(idProduto), produto: {
    titulo: 'Fone Bluetooth JBL Tune 520BT Preto', shopId: '123', itemId: idProduto,
    tituloOrigem: 'api.productOfferV2',
    identidadeProdutoValidada: { shopId: '123', itemId: idProduto, fonte: 'api.productOfferV2',
      urlCanonica: `https://shopee.com.br/product/123/${idProduto}` }
  }, linksComerciais: [
    { papelLink: 'produto', urlOriginal: `https://shopee.com.br/product/123/${idLink}`,
      ocorrenciaId: 'link-shopee-1', ordemCaptura: 1 },
    { papelLink: 'resgate', urlOriginal: 'https://shopee.com.br/voucher/ABC',
      ocorrenciaId: 'link-shopee-2', ordemCaptura: 2 }
  ] }
}, jobShopee);
const mesmoProduto = ofertaAncorada('456');
assert.equal(mesmoProduto.titulo, 'Fone Bluetooth JBL Tune 520BT Preto');
for (const propagandaRadar of [
  'Bot de Alertas: @TalkPCAlertasBot',
  'Aproveita e convida os amigos pro grupo enviando o link abaixo:',
  'Todo mundo vai perguntar qual é o seu perfume'
]) {
  const oferta = normalizarOfertaImportada({
    marketplace: 'shopee', titulo: propagandaRadar, categoria: 'Diversos',
    linkExpandido: 'https://shopee.com.br/product/123/456', produtoIdDetectado: '123/456',
    linkOriginal: 'https://shopee.com.br/product/123/456',
    preco: 32, cupom: 'RADAR10', metadata: { adapter: 'shopee', jobId: jobShopee.id,
      eventoId: jobShopee.evento_id, clienteId: jobShopee.cliente_id,
      linkOriginalEngine: 'https://shopee.com.br/product/123/456', provaTituloTecnico: provaShopee(),
      linksComerciais: [{ papelLink: 'produto', urlOriginal: 'https://shopee.com.br/product/123/456',
        ocorrenciaId: 'link-shopee-1', ordemCaptura: 1 }],
      produto: { titulo: 'Fone Bluetooth JBL Tune 520BT Preto', tituloOrigem: 'api.productOfferV2',
        shopId: '123', itemId: '456', identidadeProdutoValidada: { shopId: '123', itemId: '456',
          fonte: 'api.productOfferV2', urlCanonica: 'https://shopee.com.br/product/123/456' } } }
  }, jobShopee);
  assert.equal(oferta.titulo, 'Fone Bluetooth JBL Tune 520BT Preto');
  assert.equal(oferta.categoria, 'Audio TV');
  assert.equal(oferta.preco, 32);
  assert.equal(oferta.cupom, 'RADAR10');
}
const textoRadarPlausivel = ofertaAncorada('456');
textoRadarPlausivel.titulo = 'Fone sem fio em promoção';
const oficialPrevalece = normalizarOfertaImportada({
  ...textoRadarPlausivel, titulo: textoRadarPlausivel.titulo
}, jobShopee);
assert.equal(oficialPrevalece.titulo, 'Fone Bluetooth JBL Tune 520BT Preto');
assert.equal(mesmoProduto.cupom, 'RADAR10');
assert.equal(mesmoProduto.metadata.linksComerciais.length, 2);
assert.equal(mesmoProduto.linkOriginal, 'https://shopee.com.br/product/123/456');
assert.equal(ofertaAncorada('456', '999').titulo, '');
assert.equal(ofertaAncorada('456', '999').categoria, 'Diversos');
const divergenteFinal = ofertaAncorada('456', '999');
assert.equal(reclassificarCategoriaFinalEngine(divergenteFinal, divergenteFinal.metadata,
  { marketplace: 'shopee' }).oferta.categoria, 'Diversos');

const fallbackRadar = normalizarOfertaImportada({ marketplace: 'amazon',
  titulo: 'Placa de captura HDMI USB 3.0 1080P 60 FPS', preco: 77,
  metadata: { adapter: 'amazon', diagnosticoAmazon: { tituloOrigem: 'radar_mirror' },
    produto: { titulo: '', urlFinal: '' } }
}, { marketplace: 'amazon' });
assert.equal(fallbackRadar.titulo, 'Placa de captura HDMI USB 3.0 1080P 60 FPS');
assert.equal(normalizarOfertaImportada({ marketplace: 'amazon', titulo: 'Grupo de ofertas Gerais',
  metadata: { adapter: 'amazon', diagnosticoAmazon: { tituloOrigem: 'radar_mirror' }, produto: {} }
}, { marketplace: 'amazon' }).titulo, '');

for (const [marketplace, linkExpandido, productId, produto, metadataExtra, tituloOficial] of [
  ['aliexpress', 'https://www.aliexpress.com/item/1005010148896613.html', '1005010148896613',
    { productId: '1005010148896613' }, { produtoCanonico: { produtoId: '1005010148896613' } }, 'SSD NVMe Movespeed 4TB'],
  ['amazon', 'https://www.amazon.com.br/dp/B012345678', '',
    { urlFinal: 'https://www.amazon.com.br/dp/B012345678' },
    { diagnosticoAmazon: { tituloOrigem: 'amazon_importer', importadorBloqueado: false } }, 'Placa de captura HDMI USB 3.0'],
  ['magalu', 'https://www.magazineluiza.com.br/produto/p/abc123/te/ga07/', 'abc123',
    { produtoId: 'abc123' }, { fallbackRadar: { identidadeProdutoConfirmada: true } }, 'Kit Utensílios Cozinha com Suporte']
]) {
  const jobAmazon = { id: 'fixture-job-amazon-anchor-01', evento_id: 'fixture-event-amazon-anchor-01', cliente_id: 'fixture-workspace-a', marketplace: 'amazon' };
  const metadataAmazon = marketplace === 'amazon' ? {
    jobId: jobAmazon.id, eventoId: jobAmazon.evento_id, clienteId: jobAmazon.cliente_id,
    linkOriginalEngine: linkExpandido,
    provaTituloTecnico: { versao: 1, marketplace: 'amazon', jobId: jobAmazon.id,
      eventoId: jobAmazon.evento_id, workspaceId: jobAmazon.cliente_id,
      ocorrenciaLink: { id: 'amazon-link-1', ordem: 1, campo: 'url_original', urlOriginal: linkExpandido },
      produto: { produtoIdCanonico: 'B012345678', urlCanonica: linkExpandido },
      titulo: { valor: tituloOficial, fonte: 'amazon_importer' } }
  } : {};
  const base = { marketplace, titulo: 'Grupo de ofertas Gerais', produtoIdDetectado: productId,
    linkOriginal: linkExpandido, linkExpandido, preco: 25, cupom: 'RADAR',
    metadata: { adapter: marketplace, produto: { ...produto, titulo: tituloOficial }, ...metadataAmazon, ...metadataExtra } };
  if (marketplace === 'amazon') {
    base.metadata.linksComerciais = [{ papelLink: 'produto', urlOriginal: linkExpandido,
      ocorrenciaId: 'amazon-link-1', ordemCaptura: 1 }];
  }
  const jobBase = marketplace === 'amazon' ? jobAmazon : { marketplace, cliente_id: 'workspace_a' };
  const confirmado = normalizarOfertaImportada(base, jobBase);
  assert.equal(confirmado.titulo, tituloOficial, `${marketplace}: título oficial`);
  assert.equal(confirmado.preco, 25);
  assert.equal(confirmado.cupom, 'RADAR');
  if (marketplace !== 'amazon') {
    const divergente = normalizarOfertaImportada({ ...base, produtoIdDetectado: 'produto-diferente' },
      { ...jobBase, cliente_id: 'workspace_b' });
    assert.equal(divergente.titulo, '', `${marketplace}: ID divergente`);
  }
}
const faroleteAncorado = (titulo, itemId = '456') => normalizarOfertaImportada({
  marketplace: 'shopee', titulo: 'Grupo de ofertas Gerais', categoria: 'Iluminação e Elétrica',
  produtoIdDetectado: '123/456', linkOriginal: 'https://shopee.com.br/product/123/456',
  linkExpandido: 'https://shopee.com.br/product/123/456',
  preco: 32, cupom: 'RADAR10', metadata: { adapter: 'shopee', jobId: jobShopee.id,
    eventoId: jobShopee.evento_id, clienteId: jobShopee.cliente_id,
    linkOriginalEngine: 'https://shopee.com.br/product/123/456',
    provaTituloTecnico: provaShopee(itemId, titulo, 'https://shopee.com.br/product/123/456'), produto: {
      titulo, tituloOrigem: 'api.productOfferV2', shopId: '123', itemId,
      identidadeProdutoValidada: { fonte: 'api.productOfferV2', shopId: '123', itemId,
        urlCanonica: 'https://shopee.com.br/product/123/456' }
    }, linksComerciais: [{ papelLink: 'produto', urlOriginal: 'https://shopee.com.br/product/123/456',
      ocorrenciaId: 'link-shopee-1', ordemCaptura: 1 }] }
}, jobShopee);
const faroleteOutdoor = faroleteAncorado('Farolete LED recarregável para camping e pesca');
assert.equal(faroleteOutdoor.titulo, 'Farolete LED recarregável para camping e pesca');
assert.equal(faroleteOutdoor.categoria, 'Pesca e Camping');
assert.equal(faroleteOutdoor.preco, 32);
assert.equal(faroleteOutdoor.cupom, 'RADAR10');
assert.equal(faroleteAncorado('Farolete LED para iluminação residencial').categoria, 'Iluminação e Elétrica');
assert.equal(faroleteAncorado('Farolete LED recarregável para camping e pesca', '999').titulo, '');
assert.equal(faroleteAncorado('Farolete LED recarregável para camping e pesca', '999').categoria, 'Diversos');

console.log('engine-anchor-title-category-focal.test.cjs OK');
