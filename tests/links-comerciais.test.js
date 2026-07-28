const assert = require("assert");
const {
  classificarLinkComercial,
  classificarLinksComerciais
} = require("../modules/radar/links-comerciais");
const {
  criarRadarMirror
} = require("../modules/radar/radar-mirror");
const {
  resolverBlocoComercialCanonico
} = require("../modules/radar/bloco-comercial-canonico");
const {
  montarOfertaRadarEspelhoComercial
} = require("../modules/radar/espelho-comercial");

function tiposPorUrl(resultado = {}) {
  const mapa = {};
  for (const item of resultado.classificados || []) {
    mapa[item.url] = item.tipo;
  }
  return mapa;
}

{
  const resgate = "https://s.shopee.com.br/cupomA";
  const produto = "https://s.shopee.com.br/produtoB";
  const resultado = classificarLinksComerciais({
    texto: [
      "Resgate o cupom aqui",
      resgate,
      "Compre o produto aqui",
      produto
    ].join("\n")
  });
  const tipos = tiposPorUrl(resultado);

  assert.strictEqual(tipos[resgate], "resgate");
  assert.strictEqual(tipos[produto], "produto");
  assert.deepStrictEqual(resultado.resgate, [resgate]);
  assert.deepStrictEqual(resultado.produto, [produto]);
}

{
  const resgate = "https://s.shopee.com.br/cupomA";
  const produto = "https://s.shopee.com.br/produtoB";
  const resultado = classificarLinksComerciais({
    texto: [
      "Compre o produto aqui",
      produto,
      "Resgate o cupom aqui",
      resgate
    ].join("\n")
  });
  const tipos = tiposPorUrl(resultado);

  assert.strictEqual(tipos[resgate], "resgate");
  assert.strictEqual(tipos[produto], "produto");
}

{
  const link = "https://s.shopee.com.br/campanha-cupom";
  const resultado = classificarLinkComercial({
    url: link,
    linhaAtual: link,
    linhaAnterior: "Resgate seu cupom aqui",
    tipoSugerido: "produto"
  });

  assert.strictEqual(resultado.tipo, "resgate");
  assert.ok(resultado.evidencias.includes("divergencia_tipo_sugerido_produto_para_resgate"));
}

{
  const link = "https://s.shopee.com.br/produto-real";
  const resultado = classificarLinkComercial({
    url: link,
    linhaAtual: link,
    linhaAnterior: "Compre o produto aqui",
    tipoSugerido: "resgate"
  });

  assert.strictEqual(resultado.tipo, "produto");
  assert.ok(resultado.evidencias.includes("divergencia_tipo_sugerido_resgate_para_produto"));
}

{
  const resgate = "https://s.shopee.com.br/campanha-cupom";
  const produto = "https://s.shopee.com.br/produto-real";
  const resultado = classificarLinksComerciais({
    texto: [
      "Pegue o cupom",
      resgate,
      "Veja o produto",
      produto
    ].join("\n")
  });
  const tipos = tiposPorUrl(resultado);

  assert.strictEqual(tipos[resgate], "resgate");
  assert.strictEqual(tipos[produto], "produto");
}

{
  const link = "https://s.shopee.com.br/abc123";
  const resultado = classificarLinkComercial({
    url: link,
    linhaAnterior: "Confira o produto"
  });

  assert.strictEqual(resultado.tipo, "produto");
}

{
  const link = "https://s.shopee.com.br/cupons-gerais";
  const resultado = classificarLinkComercial({ url: link });

  assert.strictEqual(resultado.tipo, "resgate");
}

{
  const link = "https://cdn.example.com/produto.jpg";
  const resultado = classificarLinkComercial({ url: link });

  assert.strictEqual(resultado.tipo, "imagem");
}

{
  const produto = "https://www.mercadolivre.com.br/produto/MLB999";
  const cupom = "https://www.mercadolivre.com.br/cupons/resgate";
  const resultado = classificarLinksComerciais({
    texto: [
      "Produto Mercado Livre",
      produto,
      "Resgate cupom",
      cupom
    ].join("\n")
  });
  const tipos = tiposPorUrl(resultado);

  assert.strictEqual(tipos[produto], "produto");
  assert.strictEqual(tipos[cupom], "resgate");
}

{
  const produto = "https://www.amazon.com.br/dp/B0ABCDEF12";
  const auxiliar = "https://www.amazon.com.br/ajuda";
  const resultado = classificarLinksComerciais({
    texto: [
      "Confira o produto",
      produto,
      "Veja detalhes auxiliares",
      auxiliar
    ].join("\n")
  });
  const tipos = tiposPorUrl(resultado);

  assert.strictEqual(tipos[produto], "produto");
  assert.strictEqual(tipos[auxiliar], "outros");
  assert.strictEqual(resultado.produto[0], produto);
}

{
  const link = "https://s.click.aliexpress.com/e/_DmProduto";
  const resultado = classificarLinkComercial({
    url: link,
    linhaAnterior: "Compre o produto"
  });

  assert.strictEqual(resultado.tipo, "produto");
}

{
  const resgate = "https://s.shopee.com.br/cupom-sem-produto";
  const texto = [
    "Produto sem link de produto",
    "Por R$ 49,90",
    "Resgate seu cupom aqui",
    resgate
  ].join("\n");
  const mirror = {
    texto: { original: texto, limpo: texto },
    links: {
      encontrados: [resgate],
      produtoOriginal: resgate,
      classificados: [{ link: resgate, tipo: "produto" }]
    }
  };
  const resultado = resolverBlocoComercialCanonico(mirror);

  assert.strictEqual(resultado.ok, false);
  assert.strictEqual(resultado.motivo, "produto_sem_link");
}

{
  const resgate = "https://s.shopee.com.br/cupom-oficial";
  const produto = "https://s.shopee.com.br/produto-oficial";
  const texto = [
    "Produto Oficial Shopee",
    "DE 199,90 | POR 99,90",
    "Resgate o cupom aqui",
    resgate,
    "Compre o produto aqui",
    produto
  ].join("\n");
  const mirror = criarRadarMirror({
    textoOriginal: texto,
    links: [resgate, produto],
    marketplace: "shopee",
    extracaoRadarLocal: {
      titulo: { valor: "Produto Oficial Shopee" },
      precoAtual: { valor: 99.9, confianca: "alta", evidencia: "POR 99,90" },
      precoAnterior: { valor: 199.9, confianca: "alta", evidencia: "DE 199,90" },
      comercial: {
        links: {}
      }
    },
    beneficiosMensagem: {}
  });
  const bloco = resolverBlocoComercialCanonico(mirror);
  const oferta = montarOfertaRadarEspelhoComercial({
    radarMirror: mirror,
    ofertaImportador: { marketplace: "shopee", linkResolvido: produto },
    metadata: {},
    clienteId: "admin",
    marketplace: "shopee",
    resolucao: {
      urlCapturada: produto,
      linkOriginalRadar: produto,
      linkOriginalLimpo: produto
    },
    contexto: { correlationId: "links_comerciais_fluxo_completo" }
  });

  assert.strictEqual(mirror.links.produtoOriginal, produto);
  assert.strictEqual(mirror.links.resgateCupom, resgate);
  assert.strictEqual(bloco.ok, true);
  assert.deepStrictEqual(bloco.bloco.links.produto, [produto]);
  assert.deepStrictEqual(bloco.bloco.links.resgate, [resgate]);
  assert.strictEqual(oferta.ok, true);
  assert.strictEqual(oferta.oferta.linksProduto[0].original, produto);
  assert.strictEqual(oferta.oferta.linksResgate[0].original, resgate);
}

console.log("links-comerciais.test.js OK");
