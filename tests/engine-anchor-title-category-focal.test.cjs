const assert = require('node:assert/strict');
const { normalizarOfertaImportada, reclassificarCategoriaFinalEngine } = require('../modules/engine/importer/importer.service');
const { tituloComercialUniversalValido } = require('../modules/radar/comercial-precedencia');

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
  metadata: { adapter: 'shopee', produto: {
    titulo: 'Fone Bluetooth JBL Tune 520BT Preto', shopId: '123', itemId: idProduto,
    identidadeProdutoValidada: { shopId: '123', itemId: idProduto, fonte: 'api.productOfferV2' }
  }, linksComerciais: [
    { papelLink: 'produto', urlOriginal: `https://shopee.com.br/product/123/${idLink}` },
    { papelLink: 'resgate', urlOriginal: 'https://shopee.com.br/voucher/ABC' }
  ] }
}, { marketplace: 'shopee', cliente_id: 'workspace_a' });
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
    preco: 32, cupom: 'RADAR10', metadata: { adapter: 'shopee', produto: {
      titulo: 'Fone Bluetooth JBL Tune 520BT Preto', shopId: '123', itemId: '456'
    } }
  }, { marketplace: 'shopee' });
  assert.equal(oferta.titulo, 'Fone Bluetooth JBL Tune 520BT Preto');
  assert.equal(oferta.categoria, 'Audio TV');
  assert.equal(oferta.preco, 32);
  assert.equal(oferta.cupom, 'RADAR10');
}
const textoRadarPlausivel = ofertaAncorada('456');
textoRadarPlausivel.titulo = 'Fone sem fio em promoção';
const oficialPrevalece = normalizarOfertaImportada({
  marketplace: 'shopee', titulo: textoRadarPlausivel.titulo,
  linkExpandido: 'https://shopee.com.br/product/123/456', produtoIdDetectado: '123/456',
  metadata: { adapter: 'shopee', produto: { titulo: 'Fone Bluetooth JBL Tune 520BT Preto',
    shopId: '123', itemId: '456' } }
}, { marketplace: 'shopee' });
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
  const base = { marketplace, titulo: 'Grupo de ofertas Gerais', produtoIdDetectado: productId,
    linkExpandido, preco: 25, cupom: 'RADAR',
    metadata: { adapter: marketplace, produto: { ...produto, titulo: tituloOficial }, ...metadataExtra } };
  const confirmado = normalizarOfertaImportada(base, { marketplace, cliente_id: 'workspace_a' });
  assert.equal(confirmado.titulo, tituloOficial, `${marketplace}: título oficial`);
  assert.equal(confirmado.preco, 25);
  assert.equal(confirmado.cupom, 'RADAR');
  if (marketplace !== 'amazon') {
    const divergente = normalizarOfertaImportada({ ...base, produtoIdDetectado: 'produto-diferente' },
      { marketplace, cliente_id: 'workspace_b' });
    assert.equal(divergente.titulo, '', `${marketplace}: ID divergente`);
  }
}
const faroleteAncorado = (titulo, itemId = '456') => normalizarOfertaImportada({
  marketplace: 'shopee', titulo: 'Grupo de ofertas Gerais', categoria: 'Iluminação e Elétrica',
  produtoIdDetectado: '123/456', linkExpandido: 'https://shopee.com.br/product/123/456',
  preco: 32, cupom: 'RADAR10', metadata: { adapter: 'shopee', produto: {
    titulo, shopId: '123', itemId
  } }
}, { marketplace: 'shopee', cliente_id: 'workspace_a' });
const faroleteOutdoor = faroleteAncorado('Farolete LED recarregável para camping e pesca');
assert.equal(faroleteOutdoor.titulo, 'Farolete LED recarregável para camping e pesca');
assert.equal(faroleteOutdoor.categoria, 'Pesca e Camping');
assert.equal(faroleteOutdoor.preco, 32);
assert.equal(faroleteOutdoor.cupom, 'RADAR10');
assert.equal(faroleteAncorado('Farolete LED para iluminação residencial').categoria, 'Iluminação e Elétrica');
assert.equal(faroleteAncorado('Farolete LED recarregável para camping e pesca', '999').titulo, '');
assert.equal(faroleteAncorado('Farolete LED recarregável para camping e pesca', '999').categoria, 'Diversos');

console.log('engine-anchor-title-category-focal.test.cjs OK');
