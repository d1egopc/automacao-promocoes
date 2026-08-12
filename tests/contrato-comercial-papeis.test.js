const assert = require("assert");

const {
  resolverPrecedenciaComercialRadar,
  tituloComercialUniversalValido
} = require("../modules/radar/comercial-precedencia");
const { classificarLinksComerciais } = require("../modules/radar/links-comerciais");
const { aplicarContratoMarketplace } = require("../modules/ofc-v2/marketplace-contracts");
const { normalizarApresentacaoComercial } = require("../modules/templates-clientes/normalizador-apresentacao-comercial");
const { renderizarTemplatePersonalizado } = require("../modules/templates-clientes/renderer");

function campo(valor, confianca = "alta", evidencia = "") {
  return { valor, confianca, evidencia: evidencia || String(valor || "") };
}

function radarMirror({ titulo = "Produto Radar Confiavel", preco = 99, precoAnterior = 129, cupom = "PROMO10" } = {}) {
  return {
    origem: { clienteId: "cliente_teste" },
    produto: { tituloCapturado: titulo },
    texto: {
      original: [
        titulo,
        `De R$ ${precoAnterior}`,
        `Por R$ ${preco}`,
        cupom ? `Cupom ${cupom}` : "",
        "https://produto.test/oferta"
      ].filter(Boolean).join("\n")
    },
    preco: {
      atualCapturado: preco,
      anteriorCapturado: precoAnterior,
      confianca: "alta",
      evidenciaCapturada: `Por R$ ${preco}`,
      marcadorComercial: "por"
    },
    cupom: {
      codigoCapturado: cupom,
      textoCapturado: cupom ? `Cupom ${cupom}` : "",
      condicaoCapturada: cupom ? `Use ${cupom}` : "",
      confianca: cupom ? "alta" : "ausente"
    },
    comercial: {
      precoAtual: campo(preco, "alta", `Por R$ ${preco}`),
      precoAntigo: campo(precoAnterior, "alta", `De R$ ${precoAnterior}`),
      cupom: { codigo: cupom, texto: cupom ? `Cupom ${cupom}` : "", instrucao: cupom ? `Use ${cupom}` : "", confianca: cupom ? "alta" : "ausente" },
      freteGratis: campo(null, "ausente", ""),
      pix: campo(null, "ausente", ""),
      links: { produto: "https://produto.test/oferta", classificados: [{ link: "https://produto.test/oferta", tipo: "produto" }] }
    },
    links: {
      encontrados: ["https://produto.test/oferta"],
      produtoOriginal: "https://produto.test/oferta",
      quantidadeEncontrada: 1
    },
    comparacaoImportador: {}
  };
}

assert.strictEqual(tituloComercialUniversalValido("Amazon / Amazon", { marketplace: "amazon" }), false);
assert.strictEqual(tituloComercialUniversalValido("10%", { marketplace: "amazon" }), false);
assert.strictEqual(tituloComercialUniversalValido("NATORCIDA", { marketplace: "amazon", cupons: ["NATORCIDA"] }), false);
assert.strictEqual(tituloComercialUniversalValido("Echo Dot 5a Geracao", { marketplace: "amazon" }), true);

const tituloRadarVenceApi = resolverPrecedenciaComercialRadar({
  marketplace: "amazon",
  ofertaImportador: {
    marketplace: "amazon",
    titulo: "Titulo oficial API",
    preco: 150,
    cupom: "API10"
  },
  radarMirror: radarMirror({ titulo: "Echo Dot 5a Geracao", preco: 62.3, precoAnterior: 136.25, cupom: "NATORCIDA" })
});
assert.strictEqual(tituloRadarVenceApi.oferta.titulo, "Echo Dot 5a Geracao");
assert.strictEqual(tituloRadarVenceApi.oferta.preco, 62.3);
assert.strictEqual(tituloRadarVenceApi.oferta.cupom, "NATORCIDA");

const tituloRadarInvalidoNaoVence = resolverPrecedenciaComercialRadar({
  marketplace: "amazon",
  ofertaImportador: { marketplace: "amazon", titulo: "Echo Dot API Oficial", preco: 150 },
  radarMirror: radarMirror({ titulo: "Amazon / Amazon", preco: 62.3, precoAnterior: 136.25, cupom: "NATORCIDA" })
});
assert.strictEqual(tituloRadarInvalidoNaoVence.oferta.titulo, "Echo Dot API Oficial");
assert.strictEqual(tituloRadarInvalidoNaoVence.resolucao.tituloRadar, null);

const mlRadarComercial = resolverPrecedenciaComercialRadar({
  marketplace: "mercadolivre",
  ofertaImportador: { marketplace: "mercadolivre", titulo: "Produto ML API", preco: 57, precoOriginal: 140, cupom: "API" },
  radarMirror: radarMirror({ titulo: "Produto ML Radar", preco: 49, precoAnterior: 139, cupom: "QUEROCUPOM" })
});
assert.strictEqual(mlRadarComercial.oferta.preco, 49);
assert.strictEqual(mlRadarComercial.oferta.cupom, "QUEROCUPOM");

const shopeeApresentacao = normalizarApresentacaoComercial({
  marketplace: "shopee",
  linkAfiliado: "https://shopee.test/produto",
  linksComerciais: [
    { tipo: "produto", papel: "produto", ordemCaptura: 1, urlAfiliada: "https://shopee.test/produto" },
    { tipo: "resgate", papel: "resgate", ordemCaptura: 2, urlAfiliada: "https://shopee.test/resgate" }
  ]
});
assert.strictEqual(shopeeApresentacao.linksProduto.length, 1);
assert.strictEqual(shopeeApresentacao.linksResgate.length, 1);
assert.strictEqual(shopeeApresentacao.linkProduto, "https://shopee.test/produto");
assert.strictEqual(shopeeApresentacao.linkResgate, "https://shopee.test/resgate");

const contratoAliDiferente = aplicarContratoMarketplace({
  marketplace: "aliexpress",
  links: [
    { url: "https://a.aliexpress.com/_app", tipo: "link_app", ordemCaptura: 1, urlAfiliada: "https://s.click.aliexpress.com/e/_app", convertidoWorkspace: true },
    { url: "https://a.aliexpress.com/_pc", tipo: "link_pc", ordemCaptura: 2, urlAfiliada: "https://s.click.aliexpress.com/e/_pc", convertidoWorkspace: true }
  ]
});
assert.deepStrictEqual(contratoAliDiferente.links.map(link => link.papel), ["link_app", "link_pc"]);

const contratoAliMesmoFinal = aplicarContratoMarketplace({
  marketplace: "aliexpress",
  links: [
    { url: "https://a.aliexpress.com/_app", tipo: "link_app", ordemCaptura: 1, urlAfiliada: "https://s.click.aliexpress.com/e/_same", convertidoWorkspace: true },
    { url: "https://a.aliexpress.com/_pc", tipo: "link_pc", ordemCaptura: 2, urlAfiliada: "https://s.click.aliexpress.com/e/_same", convertidoWorkspace: true }
  ]
});
assert.deepStrictEqual(contratoAliMesmoFinal.links.map(link => link.papel), ["link_app", "link_pc"]);

const repetidosAli = classificarLinksComerciais({
  marketplace: "aliexpress",
  texto: [
    "APP/Moedas https://a.aliexpress.com/_app",
    "APP/Moedas https://a.aliexpress.com/_app",
    "NO PC",
    "https://a.aliexpress.com/_pc"
  ].join("\n")
});
assert.strictEqual(repetidosAli.classificados.filter(link => link.tipo === "app" || link.tipo === "moedas").length, 2);
assert.ok(repetidosAli.classificados.some(link => link.tipo === "pc"));

const template = {
  id: "contrato_papeis",
  canais: ["whatsapp"],
  blocos: [
    { tipo: "titulo", ativo: true, ordem: 10 },
    { tipo: "beneficio", ativo: true, ordem: 20 },
    { tipo: "avaliacao", ativo: true, ordem: 30 },
    { tipo: "cupom", ativo: true, ordem: 40 },
    { tipo: "link_resgate", ativo: true, ordem: 50 },
    { tipo: "link_app", ativo: true, ordem: 60 },
    { tipo: "link_pc", ativo: true, ordem: 70 },
    { tipo: "link", ativo: true, ordem: 80 }
  ]
};

const renderSemCamposInventados = renderizarTemplatePersonalizado({
  canal: "whatsapp",
  template,
  oferta: {
    titulo: "Smart Tv Hq Qled 50 Polegadas",
    marketplace: "shopee",
    categoria: "Audio TV",
    preco: 1442,
    cupom: "F3L1Z200",
    freteGratis: true,
    linkAfiliado: "https://shopee.test/produto",
    inteligenciaUniversalV2: { logs: ["score_interno_98"], score: 98 }
  }
});
assert.strictEqual(renderSemCamposInventados.ok, true);
assert.ok(!renderSemCamposInventados.mensagem.includes("score_interno_98"));
assert.ok(!renderSemCamposInventados.blocosRenderizados.includes("beneficio"));
assert.ok(!renderSemCamposInventados.blocosRenderizados.includes("avaliacao"));
assert.ok(renderSemCamposInventados.mensagem.includes("F3L1Z200"));

const renderLinksAli = renderizarTemplatePersonalizado({
  canal: "whatsapp",
  template,
  oferta: {
    titulo: "Ventoinha Jungle Leopard",
    marketplace: "aliexpress",
    preco: 97,
    linkAfiliado: "https://s.click.aliexpress.com/e/_app",
    linksComerciais: [
      { papel: "link_app", tipo: "app", ordemCaptura: 1, urlAfiliada: "https://go.optimus/r/app" },
      { papel: "link_pc", tipo: "pc", ordemCaptura: 2, urlAfiliada: "https://go.optimus/r/pc" }
    ]
  }
});
assert.ok(renderLinksAli.mensagem.includes("https://go.optimus/r/app"));
assert.ok(renderLinksAli.mensagem.includes("https://go.optimus/r/pc"));

function linksRenderizaveis(contrato) {
  return contrato.links.filter(link => link.renderizavel !== false);
}

function testarAfiliadoGlobalNaoTrocaDestino(marketplace, urlA, urlB, afiliadoA) {
  const contrato = aplicarContratoMarketplace({
    marketplace,
    linkOriginal: urlA,
    linkAfiliado: afiliadoA,
    links: [
      { url: urlA, tipo: "produto", ordemCaptura: 1 },
      { url: urlB, tipo: "produto", ordemCaptura: 2 }
    ]
  });
  assert.strictEqual(contrato.links.length, 2, `${marketplace}: duas ocorrencias devem continuar auditaveis`);
  assert.strictEqual(contrato.links[0].urlAfiliada, afiliadoA, `${marketplace}: A deve receber afiliado A'`);
  assert.strictEqual(contrato.links[0].renderizavel, true, `${marketplace}: A deve renderizar`);
  assert.strictEqual(contrato.links[1].urlAfiliada, "", `${marketplace}: B nao pode receber afiliado A'`);
  assert.strictEqual(contrato.links[1].renderizavel, false, `${marketplace}: B sem conversao propria nao renderiza original`);
  assert.strictEqual(linksRenderizaveis(contrato).length, 1, `${marketplace}: somente ocorrencia convertida renderiza`);
}

testarAfiliadoGlobalNaoTrocaDestino(
  "mercadolivre",
  "https://meli.la/produto-a",
  "https://meli.la/produto-b",
  "https://go.optimus/ml/produto-a"
);

testarAfiliadoGlobalNaoTrocaDestino(
  "amazon",
  "https://amzn.to/produto-a",
  "https://amzn.to/produto-b",
  "https://go.optimus/amazon/produto-a"
);

testarAfiliadoGlobalNaoTrocaDestino(
  "kabum-awin",
  "https://www.kabum.com.br/produto/100/produto-a",
  "https://www.kabum.com.br/produto/200/produto-b",
  "https://go.optimus/kabum/produto-a"
);

const contratoShopeeResgateProdutoProduto = aplicarContratoMarketplace({
  marketplace: "shopee",
  links: [
    { url: "https://s.shopee.com.br/resgate-a", tipo: "resgate", contexto: "Resgate o cupom", ordemCaptura: 1, urlAfiliada: "https://go.optimus/shopee/resgate-a", convertidoWorkspace: true },
    { url: "https://s.shopee.com.br/produto-b", tipo: "produto", contexto: "Produto", ordemCaptura: 2, urlAfiliada: "https://go.optimus/shopee/produto-b", convertidoWorkspace: true },
    { url: "https://s.shopee.com.br/produto-b", tipo: "produto", contexto: "Produto", ordemCaptura: 3, urlAfiliada: "https://go.optimus/shopee/produto-b", convertidoWorkspace: true }
  ]
});
assert.deepStrictEqual(
  linksRenderizaveis(contratoShopeeResgateProdutoProduto).map(link => link.urlAfiliada),
  [
    "https://go.optimus/shopee/resgate-a",
    "https://go.optimus/shopee/produto-b",
    "https://go.optimus/shopee/produto-b"
  ],
  "Shopee deve preservar Resgate + Produto + Produto sem trocar destino"
);

const contratoAliProdutoDistintos = aplicarContratoMarketplace({
  marketplace: "aliexpress",
  linkOriginal: "https://a.aliexpress.com/_produtoA",
  linkAfiliado: "https://s.click.aliexpress.com/e/_produtoA",
  links: [
    { url: "https://a.aliexpress.com/_produtoA", tipo: "produto", ordemCaptura: 1 },
    { url: "https://a.aliexpress.com/_produtoB", tipo: "produto", ordemCaptura: 2 }
  ]
});
assert.strictEqual(contratoAliProdutoDistintos.links[0].urlAfiliada, "https://s.click.aliexpress.com/e/_produtoA");
assert.strictEqual(contratoAliProdutoDistintos.links[1].urlAfiliada, "", "AliExpress Produto B nao pode receber conversao do Produto A");
assert.strictEqual(contratoAliProdutoDistintos.links[1].renderizavel, false);

const renderNaoVazaOriginal = renderizarTemplatePersonalizado({
  canal: "whatsapp",
  template,
  oferta: {
    titulo: "Produto sem conversao",
    marketplace: "mercadolivre",
    preco: 99,
    linksComerciais: [
      { tipo: "produto", papel: "link_produto", ordemCaptura: 1, original: "https://meli.la/original-terceiro", renderizavel: false, conversaoStatus: "falhou" }
    ]
  }
});
assert.strictEqual(renderNaoVazaOriginal.ok, true);
assert.ok(!renderNaoVazaOriginal.mensagem.includes("https://meli.la/original-terceiro"), "renderer nao deve vazar URL original sem conversao workspace");

console.log("contrato-comercial-papeis: ok");
