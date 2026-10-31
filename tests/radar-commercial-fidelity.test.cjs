const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { performance } = require('node:perf_hooks');
const f = require('./fixtures/radar-commercial-fidelity-20261031.json');
const { extrairComercialUniversal } = require('../modules/radar/extrator-comercial-universal');
const { criarRadarMirror } = require('../modules/radar/radar-mirror');
const { resolverPrecoSemantico } = require('../modules/radar/preco-semantico');
const { normalizarCodigoCupomSemantico } = require('../modules/radar/cupom-semantico');
const { resolverPrecedenciaComercialRadar, validarFidelidadeComercialRadar, tituloComercialUniversalValido } = require('../modules/radar/comercial-precedencia');
const { montarMensagemOferta } = require('../utils/mensagens-ofertas');
const { prepararDadosOficiaisTemplate } = require('../modules/templates-clientes/dados-oficiais');
const activityPath = require.resolve('../utils/usuarios-atividade');
const activityModule = require(activityPath);
require.cache[activityPath].exports = { ...activityModule, usuarioAtivo: () => true };
const { adicionarOfertaNaFilaCliente, validarOfertaParaDistribuicao } = require('../modules/engine/distributor/distributor.service');
require.cache[activityPath].exports = activityModule;
function mirror(text, price, title = 'Suporte com rodas') {
  const c = extrairComercialUniversal({ textoOriginal: text, marketplaceDetectado: 'shopee' });
  const m = criarRadarMirror({ textoOriginal: text, marketplace: 'shopee', clienteId: 'admin', extracaoRadarLocal: { comercial: c, cupom: c.cupom, precoAtual: c.precoAtual, precoAnterior: c.precoAntigo, titulo: { valor: title } } });
  if (price !== undefined) m.preco.atualCapturado = price;
  return m;
}
function resolve(m, tenant = 'tenant_a', extra = {}) {
  return resolverPrecedenciaComercialRadar({ radarMirror: m, clienteId: tenant, metadata: { radarMirror: m }, ofertaImportador: { id: 10, cliente_id: tenant, clienteId: tenant, titulo: 'Suporte técnico com rodas', marketplace: 'shopee', preco: 2920, precoAtual: 2920, precoOriginal: 5000, cupom: 'IMPORTADOR99', categoria: 'Casa', produtoId: '123/456', imagem: 'https://example.invalid/image.jpg', linkExpandido: 'https://shopee.com.br/product/123/456', linkAfiliado: 'https://example.invalid/afiliado', ...extra } }).oferta;
}
test('32 vs 2920: Radar wins through enrichment, queue and actual renderer in two tenants', async () => {
  for (const tenant of ['tenant_a', 'tenant_b']) {
    const original = mirror(f.price32Control), snapshot = JSON.stringify(original);
    const o = resolve(original, tenant);
    assert.equal(o.preco, 32); assert.equal(o.precoAnterior, 59.9);
    assert.deepEqual(o.cupons, ['3SQU3NT411', 'CASA10']); assert.ok(!o.cupom.includes('IMPORTADOR99'));
    assert.equal(o.imagem, 'https://example.invalid/image.jpg'); assert.equal(o.categoria, 'Casa');
    assert.equal(validarFidelidadeComercialRadar(o).ok, true);
    const queueResult = await adicionarOfertaNaFilaCliente({ ...o, preco_original: o.precoOriginal, link_afiliado: o.linkAfiliado }, {
      deps: {
        adicionarOfertaNaFilaGlobal: async (workspace, item) => {
          assert.equal(workspace, tenant);
          assert.equal(item.precoAtual, 32);
          assert.deepEqual(item.codigosCupom, ['3SQU3NT411', 'CASA10']);
          return { ok: true, itemFila: item };
        }
      }
    });
    assert.equal(queueResult.ok, true);
    const q = queueResult.itemFila;
    assert.equal(q.clienteId || q.cliente_id, tenant);
    const route = await validarOfertaParaDistribuicao({ ...q, cliente_id: tenant }, {
      clientesValidos: ['tenant_a', 'tenant_b'],
      marketplacesAtivosPorCliente: { tenant_a: { shopee: true }, tenant_b: { shopee: true } },
      destinosPorCliente: {
        tenant_a: [{ id: 'destination-tenant_a', nome: 'Destino tenant_a', ativo: true, tipo: 'whatsapp', marketplaces: ['shopee'], categorias: ['Geral'], todasCategorias: true }],
        tenant_b: [{ id: 'destination-tenant_b', nome: 'Destino tenant_b', ativo: true, tipo: 'whatsapp', marketplaces: ['shopee'], categorias: ['Geral'], todasCategorias: true }]
      }
    });
    assert.equal(route.ok, true);
    assert.deepEqual(route.destinosCompativeisDetalhes.map(item => item.destino), [`Destino ${tenant}`]);
    const msg = montarMensagemOferta(q, { clienteId: tenant });
    assert.match(msg, /32,00/); assert.doesNotMatch(msg, /2\.920,00|IMPORTADOR99/);
    assert.match(msg, /3SQU3NT411/); assert.match(msg, /CASA10/);
    const renderData = prepararDadosOficiaisTemplate(q, { modo: 'universal' });
    assert.equal(renderData.cupom, '3SQU3NT411 ou CASA10');
    assert.deepEqual(renderData.cupons, ['3SQU3NT411', 'CASA10']);
    assert.equal(JSON.stringify(original), snapshot);
  }
});
test('missing or ambiguous source price is retained and cannot enqueue or render', async () => {
  for (const text of ['Produto sem preço\nCupom: CASA10', 'Produto\nR$ 32,00 ou R$ 45,00']) {
    const o = resolve(mirror(text));
    assert.equal(o.preco, undefined); assert.equal(validarFidelidadeComercialRadar(o).ok, false);
    assert.equal((await adicionarOfertaNaFilaCliente(o)).ok, false);
    assert.throws(() => montarMensagemOferta(o), /radar_preco/);
  }
});
test('low prices remain valid when explicitly captured; amount alone is never a rejection rule', () => {
  for (const preco of [1, 4, 9, 10]) {
    const titulo = `Produto controle ${preco}`;
    const texto = `${titulo}\nPor R$ ${preco},00`;
    const o = resolve(mirror(texto, preco, titulo), 'tenant_a', { titulo });
    assert.equal(o.preco, preco);
    assert.equal(validarFidelidadeComercialRadar(o).ok, true);
  }
});
test('actual Shopee event is 2920 for a TV; cart cannot confirm the stand identity', () => {
  const o = resolve(mirror(f.shopeeOriginal, undefined, 'Smart TV HQ QLED 75'), 'tenant_a', { linkExpandido: 'https://shopee.com.br/cart' });
  assert.equal(o.preco, 2920);
  assert.ok(validarFidelidadeComercialRadar(o).motivos.includes('radar_identidade_destino_nao_produto'));
  assert.throws(() => montarMensagemOferta(o), /radar_identidade/);
});
test('actual ML instruction and campaign date are never commercial title/price/coupon', () => {
  assert.equal(resolverPrecoSemantico(f.mlOriginal).precoAtual, null);
  for (const t of ['2 - No canto INFERIOR DIREITO vá em mais', '1 - Abra este link no APP', 'Nas primeiras opções Cupons Relâmpago', 'Siga nosso canal de ofertas']) assert.equal(tituloComercialUniversalValido(t), false);
  assert.equal(normalizarCodigoCupomSemantico('e ative o lembrete'), '');
  assert.equal(normalizarCodigoCupomSemantico('Relâmpago do 11.11'), '');
  assert.equal(tituloComercialUniversalValido('O CARA DAS OFERTAS ACHOU PRA VOCÊ! Perfume Jean Paul Gaultier Le Beau Le Parfum 125 ml'), false);
  const legacy = mirror(f.mlOriginal, 11.11, '2 - No canto INFERIOR DIREITO vá em mais');
  legacy.preco.confianca = 'media';
  const o = resolve(legacy);
  assert.equal(validarFidelidadeComercialRadar(o).ok, false);
});
test('technical title can enrich a valid priced offer; operational title alone cannot publish', () => {
  const m = mirror(f.price32Control, undefined, '2 - No canto INFERIOR DIREITO vá em mais');
  const o = resolve(m);
  assert.equal(o.titulo, 'Suporte técnico com rodas');
  assert.ok(validarFidelidadeComercialRadar(o).motivos.includes('radar_identidade_titulo_nao_confirmada'));
  const confirmado = {
    ...o,
    metadata: {
      ...o.metadata,
      identidadeCanonicaMl: {
        status: 'consistente', mlbForteConfirmado: true, mlbProduto: 'MLB123', mlbRevalidado: 'MLB123'
      }
    }
  };
  assert.equal(validarFidelidadeComercialRadar(confirmado).ok, true);
  assert.equal(validarFidelidadeComercialRadar({ ...o, titulo: 'Abra este link no APP' }).ok, false);
  assert.equal(tituloComercialUniversalValido('Luminária de canto com controle remoto'), true);
});
test('rendered Pix label preserves payment semantics without requiring the source amount twice', () => {
  const m = mirror('Produto teste\nPor R$ 32,00 no Pix', 32, 'Produto teste');
  const o = resolve(m);
  const rendered = prepararDadosOficiaisTemplate(o, { modo: 'personalizado' });
  assert.equal(rendered.condicaoPix, 'no Pix');
  assert.equal(validarFidelidadeComercialRadar({ ...o, condicaoPix: rendered.condicaoPix }).ok, true);
  assert.equal(validarFidelidadeComercialRadar({ ...o, precoPix: 'R$ 33,00 no Pix' }).ok, false);
  assert.equal(validarFidelidadeComercialRadar({ ...o, condicaoPix: 'no boleto' }).ok, false);
});
test('an importer title cannot replace an operational Radar title without official identity proof', () => {
  const m = mirror('2 - No canto INFERIOR DIREITO vá em mais\nPor R$ 32,00\nCupom: CASA10', 32,
    '2 - No canto INFERIOR DIREITO vá em mais');
  const o = resolve(m, 'tenant_a', { titulo: 'Watercooler Deepcool LS520' });
  assert.ok(validarFidelidadeComercialRadar(o).motivos.includes('radar_identidade_titulo_nao_confirmada'));
  const comprovado = {
    ...o,
    metadata: {
      ...o.metadata,
      identidadeCanonicaMl: {
        status: 'consistente', mlbForteConfirmado: true, mlbProduto: 'MLB123', mlbRevalidado: 'MLB123'
      }
    }
  };
  assert.equal(validarFidelidadeComercialRadar(comprovado).ok, true);
});
test('fidelity guard recognizes nested Radar mirrors and fails closed on Radar origin without source evidence', () => {
  const o = resolve(mirror(f.price32Control));
  const nested = { ...o, metadata: { ...o.metadata, radarMirror: undefined, radarEspelhoComercial: { radarMirror: o.metadata.radarMirror } } };
  assert.equal(validarFidelidadeComercialRadar(nested).ok, true);
  const missing = validarFidelidadeComercialRadar({ origem: 'radar', titulo: 'Produto válido', preco: 32 }, {});
  assert.equal(missing.ok, false);
  assert.equal(missing.motivos[0], 'radar_contrato_original_ausente');
});
test('a title diverging from the captured product is retained until a verified identity exists', () => {
  const o = resolve(mirror(f.price32Control));
  const divergente = { ...o, titulo: 'Smart TV Samsung 55 polegadas' };
  assert.ok(validarFidelidadeComercialRadar(divergente).motivos.includes('radar_titulo_divergente_sem_identidade'));
});
test('mutation after capture is rejected before send, including previous price and coupon', () => {
  const o = resolve(mirror(f.price32Control));
  for (const delta of [{ preco: 2920 }, { precoAtual: 2920 }, { cupom: 'IMPORTADOR99' }, { precoAnterior: 999 }]) {
    const bad = { ...o, ...delta };
    assert.equal(validarFidelidadeComercialRadar(bad).ok, false);
    assert.throws(() => montarMensagemOferta(bad), /radar_/);
  }
});
test('independent collector remains untouched; auxiliary redemption links remain preserved', () => {
  const raw = { titulo: 'Produto coletor', preco: 2920, cupom: 'COLETOR10', metadata: {} };
  const result = resolverPrecedenciaComercialRadar({ ofertaImportador: raw });
  assert.equal(result.aplicavel, false); assert.deepEqual(result.oferta, raw);
  assert.equal(validarFidelidadeComercialRadar(raw).aplicavel, false);
  const m = mirror(f.price32Control); m.links.resgateCupom = 'https://example.invalid/resgate';
  assert.equal(resolve(m).linkResgateCupom, 'https://example.invalid/resgate');
  const radar = resolve(mirror(f.price32Control));
  assert.equal(prepararDadosOficiaisTemplate(radar, { modo: 'personalizado' }).cupom, '3SQU3NT411 ou CASA10');
});
test('runtime wiring retains before persistence and revalidates before queue and render', () => {
  const s = fs.readFileSync('modules/engine/importer/importer.service.js', 'utf8');
  assert.match(s, /const retidaV2 = !fidelidadeRadar.ok/);
  assert.ok(s.indexOf('const fidelidadeRadar = validarFidelidadeComercialRadar') < s.indexOf('const statusPersistencia ='));
});
test('bounded warm performance measurement', () => {
  const o = resolve(mirror(f.price32Control)); const start = performance.now();
  for (let i = 0; i < 300; i++) assert.equal(validarFidelidadeComercialRadar(o).ok, true);
  console.log(JSON.stringify({ validations: 300, totalMs: +(performance.now() - start).toFixed(2) }));
});
