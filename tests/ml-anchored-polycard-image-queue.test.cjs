"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  resolverImagemUniversal,
  temProvaImagemOficialMercadoLivre
} = require("../modules/imagens/resolver-imagem-universal");
const { montarItemFilaEngine } = require("../modules/engine/distributor/distributor.service");
const { imagemFontePublicavel } = require("../modules/fila/fila-thumbnail.service");

const listingId = "MLB7356314460";
const catalogId = "MLB76166552";
const originalUrl = "https://meli.la/2Rapala";
const canonicalUrl = `https://www.mercadolivre.com.br/carretilha-exemplo/p/${catalogId}?pdp_filters=item_id%3A${listingId}&searchVariation=186594038538`;
const imageUrl = "https://http2.mlstatic.com/D_NQ_NP_2X_123456-MLA987654321_012026-F.jpg";

function offer(overrides = {}) {
  const metadata = {
    adapter: "mercadolivre",
    marketplace: "mercadolivre",
    jobId: "1163145",
    eventoId: "238080",
    clienteId: "user_pss60lus",
    linkOriginalEngine: originalUrl,
    linkExpandidoEngine: canonicalUrl,
    imagemOrigem: "polycard.picture_template",
    imagemOrigemImportador: "polycard.picture_template",
    imagemStatus: "importador_ml_mlb",
    imagemEnviavel: true,
    imagemCacheCanonico: {
      origem: "polycard.picture_template",
      imagemCanonicaDuravel: imageUrl,
      imagemEnviavel: true,
      pictureId: "123456-MLA987654321_012026"
    },
    linksClassificados: [
      { id: 701, urlOriginal: originalUrl, papelLink: "produto", marketplace: "mercadolivre" },
      { id: 702, urlOriginal: "https://meli.la/cupom", papelLink: "cupom", marketplace: "mercadolivre" }
    ],
    identidadeCanonicaMl: {
      status: "consistente",
      mlbForteConfirmado: true,
      mlbProduto: listingId,
      mlbRevalidado: listingId,
      catalogId,
      variationId: "186594038538",
      urlOriginal: originalUrl,
      urlCanonicaRevalidada: canonicalUrl,
      transporteShowProductConfirmado: true
    },
    produto: { variationId: "186594038538", pictureId: "123456-MLA987654321_012026" },
    ofcV24: { imagemComercial: { imagemOficial: false, possuiMarcaFonte: false } }
  };
  return {
    id: 215896,
    job_id: 1163145,
    evento_id: 238080,
    cliente_id: "user_pss60lus",
    marketplace: "mercadolivre",
    titulo: "Isca Artificial Rapala Precision Xtreme",
    categoria: "Pesca e Camping",
    imagem: imageUrl,
    imagemUrl: imageUrl,
    imagemOrigem: "polycard.picture_template",
    imagemStatus: "importador_ml_mlb",
    imagemEnviavel: true,
    link_original: originalUrl,
    link_afiliado: "https://meli.la/workspace-affiliate",
    preco: 52.99,
    preco_original: 89.9,
    cupom: "RADAR10",
    metadata,
    ...overrides,
    metadata: { ...metadata, ...(overrides.metadata || {}) }
  };
}

test("Polycard oficial ancorado preserva imagem até o gate de mídia da fila", () => {
  const input = offer();
  assert.equal(temProvaImagemOficialMercadoLivre(input), true);

  const resolved = resolverImagemUniversal(input, { origem: "engine_distributor" });
  assert.equal(resolved.imagem, imageUrl);
  assert.equal(resolved.imagemEnviavel, true);

  const queueItem = montarItemFilaEngine(input);
  assert.equal(queueItem.engineJobId, input.job_id);
  assert.equal(queueItem.clienteId, input.cliente_id);
  assert.equal(queueItem.imagem, imageUrl);
  assert.equal(queueItem.imagemEnviavel, true);
  assert.equal(imagemFontePublicavel(queueItem, queueItem.imagem).ok, true);
  assert.equal(queueItem.titulo, input.titulo);
  assert.equal(queueItem.categoria, input.categoria);
  assert.equal(queueItem.preco, input.preco);
  assert.equal(queueItem.precoOriginal, input.preco_original);
  assert.equal(queueItem.cupom, input.cupom);
  assert.equal(queueItem.linkOriginal, input.link_original);
  assert.equal(queueItem.linkAfiliado, input.link_afiliado);
});

for (const [name, mutate] of [
  ["anúncio divergente", value => { value.metadata.identidadeCanonicaMl.mlbProduto = "MLB9999999999"; }],
  ["catálogo divergente", value => { value.metadata.identidadeCanonicaMl.catalogId = "MLB9999999999"; }],
  ["seletor item_id divergente", value => {
    const url = value.metadata.identidadeCanonicaMl.urlCanonicaRevalidada.replace(listingId, "MLB9999999999");
    value.metadata.identidadeCanonicaMl.urlCanonicaRevalidada = url;
    value.metadata.linkExpandidoEngine = url;
  }],
  ["rota de catálogo divergente", value => {
    const url = value.metadata.identidadeCanonicaMl.urlCanonicaRevalidada.replace(catalogId, "MLB9999999999");
    value.metadata.identidadeCanonicaMl.urlCanonicaRevalidada = url;
    value.metadata.linkExpandidoEngine = url;
  }],
  ["link original de outra ocorrência", value => { value.metadata.linkOriginalEngine = "https://meli.la/outro"; }],
  ["job de outra ocorrência", value => { value.metadata.jobId = "1163999"; }],
  ["evento divergente", value => { value.evento_id = 238081; }],
  ["workspace divergente", value => { value.metadata.clienteId = "workspace-errada"; }],
  ["classificação do link não é produto", value => { value.metadata.linksClassificados[0].papelLink = "cupom"; }],
  ["variante divergente", value => { value.metadata.identidadeCanonicaMl.variationId = "999999999999"; }],
  ["variante conflita com o objeto do produto", value => { value.metadata.produto.variationId = "999999999999"; }],
  ["página de segurança", value => { value.metadata.falhaImportadorMercadoLivre = { motivo: "ml_wall_captcha" }; }],
  ["imagem não é do host oficial", value => { value.imagem = value.imagemUrl = "https://example.test/image.jpg"; }],
  ["imagem veio do Radar", value => { value.imagemOrigem = value.metadata.imagemOrigem = "radar_whatsapp"; }]
]) {
  test(`imagem Polycard não autoriza envio com ${name}`, () => {
    const input = offer();
    mutate(input);
    assert.equal(temProvaImagemOficialMercadoLivre(input), false);
    const queueItem = montarItemFilaEngine(input);
    assert.equal(queueItem.imagem, "");
    assert.equal(queueItem.imagemEnviavel, false);
    assert.notEqual(imagemFontePublicavel(queueItem, imageUrl).ok, true);
  });
}
