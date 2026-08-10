const assert = require("assert");

const {
  normalizarCuponsSemanticos
} = require("../modules/radar/cupom-semantico");
const {
  normalizarApresentacaoComercial
} = require("../modules/templates-clientes/normalizador-apresentacao-comercial");
const {
  gerarTemplateUniversal
} = require("../modules/template-universal");
const {
  renderizarTemplatePersonalizado
} = require("../modules/templates-clientes/renderer");
const {
  construirEspelhoComercialV24
} = require("../modules/ofc-v2/espelho-comercial");

assert.deepStrictEqual(
  normalizarCuponsSemanticos("Resgate o cupom R$100 OFF: https://s.shopee.com.br/6AjYyovVdx"),
  [],
  "slug Shopee e beneficio R$100 OFF nao viram codigo de cupom"
);

assert.deepStrictEqual(
  normalizarCuponsSemanticos("https://s.shopee.com.br/8AUdMMNQf9"),
  [],
  "URL/slug de resgate nao vira codigo"
);

assert.deepStrictEqual(
  normalizarCuponsSemanticos(["Cupom: PROMO10", "Use FASHIONML", "Codigo QUERODESCONTO"]),
  ["PROMO10", "FASHIONML", "QUERODESCONTO"],
  "codigo textual explicito continua valido"
);

const shopeeResgate = normalizarApresentacaoComercial({
  marketplace: "Shopee",
  titulo: "Oferta Shopee com resgate",
  precoAtual: 199,
  cupom: "Resgate o cupom R$100 OFF: https://s.shopee.com.br/6AjYyovVdx",
  instrucaoCupom: "Resgate o cupom no link abaixo.",
  beneficioTexto: "R$100 OFF",
  beneficios: ["R$100 OFF"],
  linksComerciais: [
    { tipo: "produto", papel: "link_produto", ordemCaptura: 1, urlAfiliada: "https://s.shopee.com.br/produto" },
    { tipo: "resgate", papel: "link_resgate", ordemCaptura: 2, urlAfiliada: "https://s.shopee.com.br/6AjYyovVdx" }
  ],
  linkAfiliado: "https://s.shopee.com.br/produto"
});

assert.strictEqual(shopeeResgate.cupom, "", "beneficio com linkResgate fica sem codigo inventado");
assert.strictEqual(shopeeResgate.beneficioTexto, "R$100 OFF", "beneficio sem codigo permanece como beneficio");
assert.strictEqual(shopeeResgate.instrucaoCupom, "Resgate o cupom no link abaixo.");
assert.strictEqual(shopeeResgate.linksProduto.length, 1, "Shopee Produto preservado");
assert.strictEqual(shopeeResgate.linksResgate.length, 1, "Shopee Resgate preservado");

const amazonEspelho = construirEspelhoComercialV24({
  textoOriginal: [
    "Chuveiro Fame",
    "R$196 no PIX",
    "Cupom: 10% OFF no Anuncio"
  ].join("\n"),
  oferta: {
    titulo: "Chuveiro Fame",
    marketplace: "Amazon",
    precoAtual: 196,
    precoPix: "R$ 220 no Pix",
    condicaoPix: "R$ 220 no Pix",
    cupom: "10OFF",
    beneficioTexto: "Cupom: 10% OFF no Anuncio",
    avaliacao: "Cupom: 10% OFF no Anuncio",
    linkAfiliado: "https://amzn.to/chuveiro"
  },
  ofertaEntrada: {
    marketplace: "Amazon",
    precoPix: "R$ 220 no Pix",
    cupom: "10OFF"
  }
});

assert.strictEqual(amazonEspelho.documentoComercialCanonico.cupomTexto, null, "10% OFF no anuncio nao vira 10OFF");
assert.ok(/196/.test(amazonEspelho.documentoComercialCanonico.precoPixTexto || ""), "Pix Radar 196 vence API divergente");
assert.ok(/220/.test(amazonEspelho.documentoComercialCanonico.auditoriaComercial?.precoPix?.precoPixReferenciaApi || ""), "Pix API divergente fica apenas em auditoria");
assert.ok(!/10OFF/.test(amazonEspelho.templateEspelhoV26), "OFC nao renderiza cupom inventado 10OFF");
assert.ok(!/Pix:\s*R\$\s*220/i.test(amazonEspelho.templateEspelhoV26), "OFC nao renderiza Pix divergente");
assert.ok(!/Cupom: 10% OFF no Anuncio[\s\S]*Cupom: 10% OFF no Anuncio/.test(amazonEspelho.templateEspelhoV26), "mesmo fato nao duplica como cupom/beneficio/avaliacao");

const amazonSemRadarPix = construirEspelhoComercialV24({
  textoOriginal: [
    "Chuveiro Fame",
    "Por R$196",
    "Cupom: 10% OFF no Anuncio"
  ].join("\n"),
  oferta: {
    titulo: "Chuveiro Fame",
    marketplace: "Amazon",
    precoAtual: 196,
    precoPix: "R$ 220 no Pix",
    linkAfiliado: "https://amzn.to/chuveiro"
  },
  ofertaEntrada: {
    marketplace: "Amazon",
    precoPix: "R$ 220 no Pix"
  }
});

assert.ok(/220/.test(amazonSemRadarPix.documentoComercialCanonico.precoPixTexto || ""), "API Pix confiavel sem Radar Pix enriquece o canonico");

const kitBlackToolPix = construirEspelhoComercialV24({
  textoOriginal: [
    "KIT DA BLACK TOOL TA DADO",
    "De R$ 289 por R$ 132 no Pix",
    "Cupom: QUEROCUPOM",
    "https://meli.la/blacktool"
  ].join("\n"),
  oferta: {
    titulo: "KIT DA BLACK TOOL TA DADO",
    marketplace: "Mercado Livre",
    precoAtual: 132,
    linkAfiliado: "https://meli.la/blacktool"
  },
  ofertaEntrada: { marketplace: "Mercado Livre", cupom: "QUEROCUPOM" }
});

assert.strictEqual(kitBlackToolPix.documentoComercialCanonico.precoDeTexto, "R$ 289,00", "De X por Y no Pix preserva preco De");
assert.strictEqual(kitBlackToolPix.documentoComercialCanonico.precoPorTexto, "R$ 132,00 no Pix", "De X por Y no Pix preserva preco Por");
assert.strictEqual(kitBlackToolPix.documentoComercialCanonico.precoPixTexto, "R$ 132,00 no Pix", "Pix textual fica associado ao Por, nao ao De");

const invictusPix = construirEspelhoComercialV24({
  textoOriginal: [
    "PERFUMAO INVICTUS POR METADE DO PRECO",
    "De R$ 849,00 por R$ 407,00 no PIX",
    "https://meli.la/invictus"
  ].join("\n"),
  oferta: {
    titulo: "PERFUMAO INVICTUS POR METADE DO PRECO",
    marketplace: "Mercado Livre",
    precoAtual: 407,
    linkAfiliado: "https://meli.la/invictus"
  },
  ofertaEntrada: { marketplace: "Mercado Livre" }
});

assert.strictEqual(invictusPix.documentoComercialCanonico.precoPixTexto, "R$ 407,00 no Pix", "De 849 por 407 no PIX extrai Pix 407");

const heringPix = construirEspelhoComercialV24({
  textoOriginal: [
    "BASICAS DA HERING E MUITO CUSTO BENEFICIO",
    "De R$ 159 por R$ 65 a vista no Pix",
    "Cupom: SEMPREMODA",
    "https://meli.la/hering"
  ].join("\n"),
  oferta: {
    titulo: "BASICAS DA HERING E MUITO CUSTO BENEFICIO",
    marketplace: "Mercado Livre",
    precoAtual: 65,
    linkAfiliado: "https://meli.la/hering"
  },
  ofertaEntrada: { marketplace: "Mercado Livre", cupom: "SEMPREMODA" }
});

assert.strictEqual(heringPix.documentoComercialCanonico.precoDeTexto, "R$ 159,00", "Hering preserva preco De");
assert.strictEqual(heringPix.documentoComercialCanonico.precoPorTexto, "R$ 65,00 no Pix", "Hering preserva Por ligado ao Pix");
assert.strictEqual(heringPix.documentoComercialCanonico.precoPixTexto, "R$ 65,00 no Pix", "Hering nao usa precoDe como Pix");

const porPixDireto = construirEspelhoComercialV24({
  textoOriginal: [
    "Oferta direta no Pix",
    "Por R$ 65 no Pix",
    "https://meli.la/pixdireto"
  ].join("\n"),
  oferta: {
    titulo: "Oferta direta no Pix",
    marketplace: "Mercado Livre",
    precoAtual: 65,
    linkAfiliado: "https://meli.la/pixdireto"
  },
  ofertaEntrada: { marketplace: "Mercado Livre" }
});

assert.strictEqual(porPixDireto.documentoComercialCanonico.precoPixTexto, "R$ 65,00 no Pix", "Por Y no Pix extrai Pix Y");

const doisValoresSemPix = construirEspelhoComercialV24({
  textoOriginal: [
    "Oferta sem Pix",
    "De R$ 289 por R$ 132",
    "https://meli.la/sempix"
  ].join("\n"),
  oferta: {
    titulo: "Oferta sem Pix",
    marketplace: "Mercado Livre",
    precoAtual: 132,
    linkAfiliado: "https://meli.la/sempix"
  },
  ofertaEntrada: { marketplace: "Mercado Livre" }
});

assert.strictEqual(doisValoresSemPix.documentoComercialCanonico.precoDeTexto, "R$ 289,00", "frase sem Pix preserva De");
assert.strictEqual(doisValoresSemPix.documentoComercialCanonico.precoPorTexto, "R$ 132,00", "frase sem Pix preserva Por");
assert.strictEqual(doisValoresSemPix.documentoComercialCanonico.precoPixTexto, null, "dois valores sem papel Pix nao inventam precoPix");

const templateAmazon = gerarTemplateUniversal({
  titulo: "Chuveiro Fame",
  marketplace: "Amazon",
  categoria: "Casa",
  precoAtual: 196,
  precoPix: "",
  condicaoPix: "R$196 no Pix",
  cupom: "10OFF",
  instrucaoCupom: "Cupom: 10% OFF no Anuncio",
  beneficioTexto: "Cupom: 10% OFF no Anuncio",
  beneficios: ["Cupom: 10% OFF no Anuncio"],
  avaliacao: "Cupom: 10% OFF no Anuncio",
  linkAfiliado: "https://amzn.to/chuveiro"
});

assert.ok(templateAmazon.includes("Por: *R$ 196,00 no Pix*"), "Radar Pix explicito igual ao Por fica como condicao do preco");
assert.ok(!/Pix:\s*\*?R\$\s*220/i.test(templateAmazon), "Template Universal nao renderiza Pix divergente");
assert.ok(!/Cupom:\s*\*?10OFF/i.test(templateAmazon), "Template Universal nao renderiza cupom inventado");
assert.strictEqual((templateAmazon.match(/Cupom: 10% OFF no Anuncio/g) || []).length, 1, "fato de cupom sem codigo aparece no maximo uma vez");

const templateApiPix = gerarTemplateUniversal({
  titulo: "Oferta API Pix",
  marketplace: "Amazon",
  categoria: "Casa",
  precoAtual: 196,
  precoPix: "R$ 220 no Pix",
  linkAfiliado: "https://amzn.to/api-pix"
});

assert.ok(/Pix:\s*\*R\$\s*220 no Pix\*/i.test(templateApiPix), "Template Universal renderiza Pix canonico sem recalcular por precoPor");

const personalizadoPixZero = renderizarTemplatePersonalizado({
  oferta: {
    titulo: "Oferta Pix zero",
    marketplace: "Mercado Livre",
    precoAtual: 50,
    precoPix: "R$ 0 no Pix",
    cupom: "PROMO10",
    linkAfiliado: "https://meli.la/produto"
  },
  template: {
    id: "tpl_pix_zero",
    canais: ["whatsapp"],
    blocos: [
      { tipo: "titulo", ativo: true, ordem: 10 },
      { tipo: "preco_por", ativo: true, ordem: 20 },
      { tipo: "preco_pix", ativo: true, ordem: 30 },
      { tipo: "cupom", ativo: true, ordem: 40 },
      { tipo: "link", ativo: true, ordem: 50 }
    ]
  },
  canal: "whatsapp"
});

assert.strictEqual(personalizadoPixZero.ok, true);
assert.ok(!/Pix:\s*R\$\s*0/i.test(personalizadoPixZero.mensagem), "Pix zero nao renderiza");
assert.ok(/Cupom:\s*PROMO10/i.test(personalizadoPixZero.mensagem), "cupom textual ML/Amazon nao regride");

const personalizadoPixInvalido = renderizarTemplatePersonalizado({
  oferta: {
    titulo: "Oferta Pix invalido",
    marketplace: "Amazon",
    precoAtual: 50,
    precoPix: "-R$ 10 no Pix",
    linkAfiliado: "https://amzn.to/invalido"
  },
  template: {
    id: "tpl_pix_invalido",
    canais: ["whatsapp"],
    blocos: [
      { tipo: "titulo", ativo: true, ordem: 10 },
      { tipo: "preco_por", ativo: true, ordem: 20 },
      { tipo: "preco_pix", ativo: true, ordem: 30 },
      { tipo: "link", ativo: true, ordem: 40 }
    ]
  },
  canal: "whatsapp"
});

assert.strictEqual(personalizadoPixInvalido.ok, true);
assert.ok(!/Pix:\s*-?R\$\s*10/i.test(personalizadoPixInvalido.mensagem), "Pix negativo/invalido nao renderiza");

const personalizadoPixCanonico = renderizarTemplatePersonalizado({
  oferta: {
    titulo: "Oferta Pix canonico",
    marketplace: "Amazon",
    precoAtual: 196,
    precoPix: "R$ 220 no Pix",
    linkAfiliado: "https://amzn.to/canonico"
  },
  template: {
    id: "tpl_pix_canonico",
    canais: ["whatsapp"],
    blocos: [
      { tipo: "titulo", ativo: true, ordem: 10 },
      { tipo: "preco_por", ativo: true, ordem: 20 },
      { tipo: "preco_pix", ativo: true, ordem: 30 },
      { tipo: "link", ativo: true, ordem: 40 }
    ]
  },
  canal: "whatsapp"
});

assert.ok(/Pix:\s*R\$\s*220 no Pix/i.test(personalizadoPixCanonico.mensagem), "Renderer nao rejeita Pix canonico por comparacao com Por");

const ali = gerarTemplateUniversal({
  titulo: "Oferta Ali",
  marketplace: "AliExpress",
  precoAtual: 97,
  linkAfiliado: "https://ali/produto",
  linksComerciais: [
    { tipo: "app", papel: "link_app", ordemCaptura: 1, urlAfiliada: "https://ali/app" },
    { tipo: "pc", papel: "link_pc", ordemCaptura: 2, urlAfiliada: "https://ali/pc" }
  ]
});

assert.ok(ali.includes("*APP:*\nhttps://ali/app"), "AliExpress APP preservado");
assert.ok(ali.includes("*PC:*\nhttps://ali/pc"), "AliExpress PC preservado");

console.log("fidelidade-semantica-cupom-beneficio-pix.test.js OK");
