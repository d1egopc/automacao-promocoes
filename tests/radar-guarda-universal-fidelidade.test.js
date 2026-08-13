const assert = require("assert");

const {
  aplicarPonteIntegridadeComercial
} = require("../modules/engine/importer/importer.service");
const {
  montarOfertaUniversalEngine
} = require("../modules/engine/oferta-universal.contract");

function linkProduto(urlOriginal, urlAfiliada, extras = {}) {
  return {
    papel: "produto",
    tipo: "produto",
    urlOriginal,
    url: urlOriginal,
    urlAfiliadaWorkspace: urlAfiliada,
    urlAfiliada,
    renderizavel: true,
    seguro: true,
    conversaoStatus: "convertida",
    ...extras
  };
}

function linkResgate(urlOriginal, urlAfiliada, extras = {}) {
  return {
    papel: "link_resgate",
    tipo: "resgate",
    urlOriginal,
    url: urlOriginal,
    urlAfiliadaWorkspace: urlAfiliada,
    urlAfiliada,
    renderizavel: true,
    seguro: true,
    conversaoStatus: "convertida",
    ...extras
  };
}

function aplicar({ evento, links, oferta = {}, metadata = {}, comercialNormalizado = null, marketplace = "shopee" }) {
  return aplicarPonteIntegridadeComercial({
    oferta: {
      marketplace,
      titulo: "Produto Radar",
      preco: 80,
      linkAfiliado: "https://afiliado.test/principal",
      imagem: "https://img.test/produto.jpg",
      categoria: "Celulares",
      avaliacao: "4.8",
      ...oferta
    },
    ofertaEntrada: { metadata: {} },
    metadata: {
      linksComerciais: links,
      ...metadata
    },
    evento,
    comercialNormalizado
  });
}

function testarMercadoLivreEAmazonUmParaUm() {
  const meli = "https://meli.la/produto-a";
  const amazon = "https://www.amazon.com.br/dp/B0RADAR";

  const ml = aplicar({
    marketplace: "mercadolivre",
    evento: {
      texto_original: `Oferta ML R$ 100\n${meli}`,
      links_extraidos: [meli]
    },
    links: [
      linkProduto(meli, "https://mercadolivre.test/aff-a"),
      linkProduto("https://produto.mercadolivre.com.br/MLB-999-api-extra", "https://mercadolivre.test/aff-extra")
    ]
  });

  const az = aplicar({
    marketplace: "amazon",
    evento: {
      texto_original: `Oferta Amazon R$ 100\n${amazon}`,
      links_extraidos: [amazon]
    },
    links: [
      linkProduto(amazon, "https://amzn.to/radar"),
      linkProduto("https://www.amazon.com.br/dp/B0EXTRA", "https://amzn.to/extra")
    ]
  });

  assert.strictEqual(ml.metadata.linksComerciais.length, 1);
  assert.strictEqual(ml.metadata.linksComerciais[0].urlOriginal, meli);
  assert.strictEqual(ml.metadata.integridadeComercial.linksDescartadosRadar.length, 1);
  assert.strictEqual(az.metadata.linksComerciais.length, 1);
  assert.strictEqual(az.metadata.linksComerciais[0].urlOriginal, amazon);
  assert.strictEqual(az.metadata.integridadeComercial.linksDescartadosRadar.length, 1);
}

function testarRadarUmProdutoContraCincoCandidatosApi() {
  const radar = "https://produto.test/a";
  const resultado = aplicar({
    evento: {
      texto_original: `Oferta R$ 100\nProduto: ${radar}`,
      links_extraidos: [radar]
    },
    oferta: {
      preco: 80,
      precoPix: "R$ 70 no Pix",
      descontoPix: "R$ 10"
    },
    comercialNormalizado: {
      precoAtual: 100,
      precoOrigem: "texto_radar",
      precoConfiavel: true
    },
    links: [
      linkProduto(radar, "https://aff.test/a"),
      linkProduto("https://produto.test/b", "https://aff.test/b"),
      linkProduto("https://produto.test/c", "https://aff.test/c"),
      linkProduto("https://produto.test/d", "https://aff.test/d"),
      linkProduto("https://produto.test/e", "https://aff.test/e")
    ]
  });

  assert.strictEqual(resultado.oferta.preco, 100);
  assert.strictEqual(resultado.oferta.precoPix, undefined, "Pix API sem evidencia Radar nao sobe para verdade comercial");
  assert.strictEqual(resultado.metadata.linksComerciais.length, 1);
  assert.strictEqual(resultado.metadata.linksComerciais[0].urlOriginal, radar);
  assert.strictEqual(resultado.metadata.linksComerciais[0].renderizavel, true);
  assert.strictEqual(resultado.metadata.integridadeComercial.linksDescartadosRadar.length, 4);
  assert.strictEqual(resultado.metadata.integridadeComercial.guardaRadar.totalLinksRenderizaveis, 1);
  assert.strictEqual(resultado.oferta.imagem, "https://img.test/produto.jpg");
  assert.strictEqual(resultado.oferta.categoria, "Celulares");
  assert.strictEqual(resultado.oferta.avaliacao, "4.8");
}

function testarTodosInvalidosSobrescrevemLinksStale() {
  const radar = "https://produto.test/a";
  const api = "https://produto.test/b";
  const afiliadoApi = "https://aff.test/b";
  const resultado = aplicar({
    evento: {
      id: 10,
      texto_original: `Produto A\n${radar}`,
      links_extraidos: [radar]
    },
    oferta: {
      id: 20,
      linkAfiliado: "",
      linkOriginal: radar
    },
    links: [
      linkProduto(api, afiliadoApi)
    ]
  });
  const ofertaUniversal = montarOfertaUniversalEngine({
    oferta: resultado.oferta,
    metadata: resultado.metadata,
    evento: { id: 10 },
    job: { id: 30, cliente_id: "D1", marketplace_detectado: "shopee" },
    link: { url_original: radar }
  });
  const metadataSemDiagnostico = {
    ...resultado.metadata,
    integridadeComercial: {
      ...resultado.metadata.integridadeComercial,
      linksDescartadosRadar: []
    }
  };

  assert.deepStrictEqual(resultado.metadata.linksComerciais, []);
  assert.deepStrictEqual(resultado.metadata.integridadeComercial.linksComerciais, []);
  assert.strictEqual(resultado.metadata.integridadeComercial.linksDescartadosRadar.length, 1);
  assert.strictEqual(resultado.metadata.integridadeComercial.linksDescartadosRadar[0].urlOriginal, api);
  assert.strictEqual(resultado.metadata.integridadeComercial.linksDescartadosRadar[0].urlAfiliadaWorkspace, "");
  assert.strictEqual(resultado.metadata.integridadeComercial.linksDescartadosRadar[0].motivoConversao, "ocorrencia_nao_capturada_radar");
  assert.ok(!JSON.stringify(metadataSemDiagnostico).includes(api), "API B nao pode sobreviver fora do diagnostico");
  assert.ok(!JSON.stringify(metadataSemDiagnostico).includes(afiliadoApi), "afiliado de B nao pode sobreviver fora do diagnostico");
  assert.ok(!JSON.stringify(ofertaUniversal).includes(api), "API B nao chega a Oferta Universal");
  assert.ok(!JSON.stringify(ofertaUniversal).includes(afiliadoApi), "afiliado de B nao chega a Oferta Universal");
}

function testarResgateProdutoPreservamPapeis() {
  const resgate = "https://s.shopee.com.br/4Az3hSPAD1";
  const produto = "https://s.shopee.com.br/3VjI4rARl1";
  const resultado = aplicar({
    evento: {
      texto_original: `Resgate/cupom:\n${resgate}\nProduto:\n${produto}`,
      links_extraidos: [resgate, produto]
    },
    links: [
      linkResgate(resgate, "https://s.shopee.com.br/resgate-workspace"),
      linkProduto(produto, "https://s.shopee.com.br/produto-workspace")
    ]
  });

  assert.deepStrictEqual(
    resultado.metadata.linksComerciais.map(item => item.tipo),
    ["resgate", "produto"]
  );
  assert.deepStrictEqual(
    resultado.metadata.linksComerciais.map(item => item.ordemCaptura),
    [1, 2]
  );
  assert.strictEqual(resultado.metadata.integridadeComercial.linksDescartadosRadar.length, 0);
}

function testarCincoLinksRadarSobrevivem() {
  const links = Array.from({ length: 5 }, (_, indice) => `https://produto.test/${indice + 1}`);
  const resultado = aplicar({
    evento: {
      texto_original: links.map((url, indice) => `Produto ${indice + 1}: ${url}`).join("\n"),
      links_extraidos: links
    },
    links: links.map((url, indice) => linkProduto(url, `https://aff.test/${indice + 1}`))
  });

  assert.strictEqual(resultado.metadata.linksComerciais.length, 5);
  assert.deepStrictEqual(resultado.metadata.linksComerciais.map(item => item.urlOriginal), links);
  assert.ok(resultado.metadata.linksComerciais.every(item => item.renderizavel === true));
}

function testarQuantidadeCertaDestinoErradoRejeita() {
  const radar = "https://shopee.com.br/product/111/222";
  const resultado = aplicar({
    evento: {
      texto_original: `Produto: ${radar}`,
      links_extraidos: [radar]
    },
    links: [
      linkProduto(radar, "https://s.shopee.com.br/produto-errado", {
        destinoFuncionalOriginal: { tipo: "produto", shopId: "111", itemId: "222" },
        destinoFuncionalFinal: { tipo: "produto", shopId: "999", itemId: "888" }
      })
    ]
  });

  assert.strictEqual(resultado.metadata.linksComerciais.length, 1);
  assert.strictEqual(resultado.metadata.linksComerciais[0].renderizavel, false);
  assert.strictEqual(resultado.metadata.linksComerciais[0].urlAfiliadaWorkspace, "");
  assert.strictEqual(resultado.metadata.linksComerciais[0].motivoConversao, "destino_funcional_divergente_radar");
}

function testarPixCupomBeneficioRadarProtegidos() {
  const radar = "https://produto.test/a";
  const resultado = aplicar({
    evento: {
      texto_original: `Oferta R$ 100 no Pix\nCupom: RADAR10\nProduto: ${radar}`,
      links_extraidos: [radar]
    },
    oferta: {
      preco: 80,
      precoPix: "R$ 100 no Pix",
      condicaoPix: "R$ 100 no Pix",
      cupom: "RADAR10",
      codigoCupom: "RADAR10",
      beneficioTexto: "Cupom RADAR10",
      beneficioExtra: "Cupom RADAR10"
    },
    links: [linkProduto(radar, "https://aff.test/a")]
  });

  assert.strictEqual(resultado.oferta.precoPix, "R$ 100 no Pix");
  assert.strictEqual(resultado.oferta.condicaoPix, "R$ 100 no Pix");
  assert.strictEqual(resultado.oferta.cupom, "RADAR10");
  assert.strictEqual(resultado.oferta.beneficioTexto, "Cupom RADAR10");
}

function testarWorkspaceIsolado() {
  const radar = "https://produto.test/a";
  const baseEvento = {
    texto_original: `Produto: ${radar}`,
    links_extraidos: [radar]
  };
  const d1 = aplicar({
    evento: baseEvento,
    oferta: { clienteId: "D1" },
    links: [linkProduto(radar, "https://aff.test/d1")]
  });
  const wolf = aplicar({
    evento: baseEvento,
    oferta: { clienteId: "Wolf" },
    links: [linkProduto(radar, "https://aff.test/wolf")]
  });

  assert.strictEqual(d1.metadata.linksComerciais[0].urlAfiliadaWorkspace, "https://aff.test/d1");
  assert.strictEqual(wolf.metadata.linksComerciais[0].urlAfiliadaWorkspace, "https://aff.test/wolf");
}

function testarOfertaNaoRadarNaoPerdeCamposComerciais() {
  const resultado = aplicar({
    evento: {},
    oferta: {
      precoPix: "R$ 95 no Pix",
      cupom: "API10",
      beneficioTexto: "Beneficio tecnico autorizado fora do Radar"
    },
    links: [linkProduto("https://produto.test/manual", "https://aff.test/manual")]
  });

  assert.strictEqual(resultado.oferta.precoPix, "R$ 95 no Pix");
  assert.strictEqual(resultado.oferta.cupom, "API10");
  assert.strictEqual(resultado.oferta.beneficioTexto, "Beneficio tecnico autorizado fora do Radar");
  assert.strictEqual(resultado.metadata.integridadeComercial.guardaRadar.protecaoCamposRadar, false);
}

testarRadarUmProdutoContraCincoCandidatosApi();
testarTodosInvalidosSobrescrevemLinksStale();
testarMercadoLivreEAmazonUmParaUm();
testarResgateProdutoPreservamPapeis();
testarCincoLinksRadarSobrevivem();
testarQuantidadeCertaDestinoErradoRejeita();
testarPixCupomBeneficioRadarProtegidos();
testarWorkspaceIsolado();
testarOfertaNaoRadarNaoPerdeCamposComerciais();

console.log("radar-guarda-universal-fidelidade.test.js OK");
