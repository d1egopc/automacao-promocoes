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
  aplicarAfiliadoLinkComercialRadar,
  montarOfertaRadarEspelhoComercial
} = require("../modules/radar/espelho-comercial");

function tiposPorUrl(resultado = {}) {
  const mapa = {};
  for (const item of resultado.classificados || []) {
    mapa[item.url] = item.tipo;
  }
  return mapa;
}

function classificadosPorTipo(resultado = {}, tipo = "") {
  return (resultado.classificados || []).filter(item => item.tipo === tipo).map(item => item.url);
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
  const app = "https://a.aliexpress.com/_appExplicito";
  const pc = "https://a.aliexpress.com/_pcExplicito";
  const resultado = classificarLinksComerciais({
    marketplace: "aliexpress",
    texto: [
      "SSD AliExpress",
      `APP: ${app}`,
      `PC: ${pc}`
    ].join("\n")
  });

  assert.deepStrictEqual(resultado.app, [app], "APP explicito deve preservar papel APP");
  assert.deepStrictEqual(resultado.pc, [pc], "PC explicito deve preservar papel PC");
}

{
  const app = "https://a.aliexpress.com/_semRotuloApp";
  const pc = "https://a.aliexpress.com/_semRotuloPc";
  const resultado = classificarLinksComerciais({
    marketplace: "aliexpress",
    texto: [
      "SSD AliExpress",
      app,
      "NO PC",
      pc
    ].join("\n")
  });

  assert.deepStrictEqual(resultado.app, [app], "link antes do marcador NO PC deve ser candidato APP");
  assert.deepStrictEqual(resultado.pc, [pc], "link depois do marcador NO PC deve ser PC");
}

{
  const produtoA = "https://www.aliexpress.com/item/1005001111111111.html";
  const produtoB = "https://www.aliexpress.com/item/1005001111111111.html?sku_id=1";
  const resultado = classificarLinksComerciais({
    marketplace: "aliexpress",
    texto: [
      "SSD AliExpress",
      produtoA,
      produtoB
    ].join("\n")
  });

  assert.strictEqual(resultado.app.length, 0, "sem rotulo nao pode assumir primeiro link como APP");
  assert.ok(classificadosPorTipo(resultado, "produto").length >= 1, "formato sem rotulo permanece produto ate resolucao/comparacao");
}

{
  const app = "https://a.aliexpress.com/_appRepetido";
  const pc = "https://a.aliexpress.com/_pcUnico";
  const resultado = classificarLinksComerciais({
    marketplace: "aliexpress",
    texto: [
      "AliExpress",
      `APP: ${app}`,
      `APP: ${app}`,
      `PC: ${pc}`
    ].join("\n")
  });

  assert.deepStrictEqual(resultado.app, [app, app], "APP repetido deve preservar ocorrencias comerciais");
  assert.deepStrictEqual(resultado.pc, [pc], "PC unico deve permanecer PC");
}

{
  const produto = "https://www.aliexpress.com/item/1005002222222222.html";
  const resgate = "https://campaign.aliexpress.com/wow/gcp/coupon-page";
  const resultado = classificarLinksComerciais({
    marketplace: "aliexpress",
    texto: [
      "Produto + cupom AliExpress",
      `Produto: ${produto}`,
      `Pegue antes: ${resgate}`
    ].join("\n")
  });

  assert.deepStrictEqual(resultado.produto, [produto], "link do item deve permanecer produto");
  assert.deepStrictEqual(resultado.resgate, [resgate], "pagina de cupons deve permanecer resgate mesmo sem palavra literal resgate");
}

{
  const ofertaBase = {
    linksComerciais: [
      { tipo: "app", original: "https://a.aliexpress.com/_appConverter", resolvido: "https://a.aliexpress.com/_appConverter" },
      { tipo: "pc", original: "https://a.aliexpress.com/_pcConverter", resolvido: "https://a.aliexpress.com/_pcConverter" },
      { tipo: "resgate", original: "https://campaign.aliexpress.com/wow/gcp/coupon-page", resolvido: "https://campaign.aliexpress.com/wow/gcp/coupon-page" }
    ]
  };
  const comApp = aplicarAfiliadoLinkComercialRadar(ofertaBase, {
    original: "https://a.aliexpress.com/_appConverter",
    resolvido: "https://a.aliexpress.com/_appConverter",
    afiliado: "https://s.click.aliexpress.com/e/_appWorkspace"
  });
  const comAppPc = aplicarAfiliadoLinkComercialRadar(comApp, {
    original: "https://a.aliexpress.com/_pcConverter",
    resolvido: "https://a.aliexpress.com/_pcConverter",
    afiliado: "https://s.click.aliexpress.com/e/_pcWorkspace"
  });
  const appConvertido = comAppPc.linksComerciais.find(item => item.tipo === "app");
  const pcConvertido = comAppPc.linksComerciais.find(item => item.tipo === "pc");
  const resgate = comAppPc.linksComerciais.find(item => item.tipo === "resgate");

  assert.strictEqual(appConvertido.urlAfiliada, "https://s.click.aliexpress.com/e/_appWorkspace");
  assert.strictEqual(pcConvertido.urlAfiliada, "https://s.click.aliexpress.com/e/_pcWorkspace");
  assert.strictEqual(appConvertido.renderizavel, true);
  assert.strictEqual(pcConvertido.renderizavel, true);
  assert.ok(!resgate.urlAfiliada, "Produto/APP/PC nao podem substituir Resgate");
}

{
  const ofertaBase = {
    linksComerciais: [
      { tipo: "app", original: "https://a.aliexpress.com/_appNaoConvertido", resolvido: "https://a.aliexpress.com/_appNaoConvertido" },
      { tipo: "pc", original: "https://a.aliexpress.com/_pcConvertido", resolvido: "https://a.aliexpress.com/_pcConvertido" }
    ]
  };
  const convertido = aplicarAfiliadoLinkComercialRadar(ofertaBase, {
    original: "https://a.aliexpress.com/_pcConvertido",
    resolvido: "https://a.aliexpress.com/_pcConvertido",
    afiliado: "https://s.click.aliexpress.com/e/_pcWorkspace"
  });
  const app = convertido.linksComerciais.find(item => item.tipo === "app");
  const pc = convertido.linksComerciais.find(item => item.tipo === "pc");

  assert.strictEqual(app.renderizavel, undefined, "APP nao convertivel nao deve renderizar por carona");
  assert.strictEqual(pc.urlAfiliada, "https://s.click.aliexpress.com/e/_pcWorkspace");
  assert.strictEqual(pc.renderizavel, true, "somente PC convertivel deve renderizar como PC");
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

{
  const resgate = "https://s.shopee.com.br/50UODeJEET";
  const produto = "https://s.shopee.com.br/6L3ZsZbcnU";
  const resultado = classificarLinksComerciais({
    marketplace: "shopee",
    texto: [
      "Kit Ferramentas",
      "Resgatem o cupom de 30% OFF",
      resgate,
      produto,
      produto
    ].join("\n")
  });

  assert.deepStrictEqual(resultado.classificados.map(item => item.tipo), ["resgate", "produto", "produto"]);
  assert.deepStrictEqual(resultado.resgate, [resgate]);
  assert.deepStrictEqual(resultado.produto, [produto, produto]);
  assert.ok(resultado.classificados.every(item => item.ocorrenciaId && item.link === item.url));
}

{
  const resgate = "https://s.shopee.com.br/50UODeJEET";
  for (const frase of ["Resgate o cupom", "Resgata o cupom", "Pegue o cupom", "Colete o cupom"]) {
    const resultado = classificarLinkComercial({
      url: resgate,
      linhaAtual: resgate,
      linhaAnterior: frase,
      marketplace: "shopee"
    });
    assert.strictEqual(resultado.tipo, "resgate", `${frase} deve ganhar do fallback por dominio`);
  }
}

{
  const produto = "https://s.shopee.com.br/produtoSemContexto";
  const resultado = classificarLinkComercial({ url: produto, marketplace: "shopee" });
  assert.strictEqual(resultado.tipo, "produto");
}
console.log("links-comerciais.test.js OK");
