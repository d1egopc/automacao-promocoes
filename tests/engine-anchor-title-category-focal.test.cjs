const assert = require('node:assert/strict');
const { normalizarOfertaImportada } = require('../modules/engine/importer/importer.service');
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
console.log('engine-anchor-title-category-focal.test.cjs OK');
