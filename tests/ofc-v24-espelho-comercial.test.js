"use strict";

const assert = require("assert");
const {
  construirEspelhoComercialV24,
  construirEspelhoComercialV24FailOpen,
  montarTemplateEspelhoPorBlocosV26,
  montarTemplateEspelhoShadow,
  resumoEspelhoComercialLog,
  selecionarImagemComercial
} = require("../modules/ofc-v2/espelho-comercial");

function criarEspelho({ textoOriginal = "", oferta = {}, ofertaEntrada = {}, link = {}, metadata = {}, comercialNormalizado = {} } = {}) {
  return construirEspelhoComercialV24({
    evento: { texto_original: textoOriginal },
    job: { id: 10, cliente_id: "user_teste", marketplace_detectado: oferta.marketplace || ofertaEntrada.marketplace || "mercadolivre" },
    oferta: {
      titulo: "Titulo da pagina",
      marketplace: "mercadolivre",
      preco: 999.99,
      precoOriginal: 1299.99,
      linkAfiliado: "https://afiliado.test/produto",
      imagem: "https://http2.mlstatic.com/produto-oficial.jpg",
      imagemOrigem: "canonical.product.image",
      ...oferta
    },
    ofertaEntrada,
    link,
    metadata,
    comercialNormalizado: {
      marketplace: oferta.marketplace || ofertaEntrada.marketplace || "mercadolivre",
      precoAtual: 999.99,
      precoAnterior: 1299.99,
      precoConfiavel: true,
      ...comercialNormalizado
    }
  });
}

const mlCompleto = criarEspelho({
  textoOriginal: [
    "Bolsa Esportiva adidas Preto",
    "De: R$ 299,99",
    "Por: R$ 73,79 via Pix",
    "Cupom: FASHIONML",
    "Confira aqui: https://meli.la/1fS6gji",
    "Aplique o cupom FASHIONML + Pix para chegar neste valor."
  ].join("\n"),
  oferta: { preco: 120.5, precoOriginal: 299.99 }
});
assert.strictEqual(mlCompleto.ok, true);
assert.strictEqual(mlCompleto.espelhoComercial.tituloNormalizado, "Bolsa Esportiva adidas Preto");
assert.strictEqual(mlCompleto.espelhoComercial.precoDeValor, 299.99);
assert.strictEqual(mlCompleto.espelhoComercial.precoPorValor, 73.79);
assert.strictEqual(mlCompleto.espelhoComercial.precoFinalValor, 73.79);
assert.strictEqual(mlCompleto.espelhoComercial.formaPagamentoTexto, "Pix");
assert.strictEqual(mlCompleto.espelhoComercial.cupomCodigo, "FASHIONML");
assert.match(mlCompleto.espelhoComercial.instrucaoComercial, /FASHIONML \+ Pix/);
assert.strictEqual(mlCompleto.espelhoComercial.linkProdutoOriginal, "https://meli.la/1fS6gji");
assert.strictEqual(mlCompleto.documentoComercialCanonico.precoDeTexto, "R$ 299,99");
assert.strictEqual(mlCompleto.documentoComercialCanonico.precoPorTexto, "R$ 73,79 via Pix");
assert.strictEqual(mlCompleto.documentoComercialCanonico.precoPixTexto, "R$ 73,79 via Pix");
assert.strictEqual(mlCompleto.documentoComercialCanonico.cupomTexto, "FASHIONML");
assert.strictEqual(mlCompleto.documentoComercialCanonico.instrucaoTexto, "Aplique o cupom FASHIONML + Pix para chegar neste valor.");
assert.strictEqual(mlCompleto.documentoComercialCanonico.linkProdutoOriginal, "https://meli.la/1fS6gji");
assert.strictEqual(mlCompleto.documentoComercialCanonico.linkAfiliado, "https://afiliado.test/produto");
assert.strictEqual(mlCompleto.documentoComercialCanonico.origemDocumento, "texto_comercial_original");
assert.ok(mlCompleto.templateEspelhoShadow.mensagem.includes("🛍️ Mercado Livre"));
assert.ok(mlCompleto.templateEspelhoShadow.mensagem.includes("Por: R$ 73,79 via Pix"));
assert.ok(!mlCompleto.templateEspelhoShadow.mensagem.includes("Pix:"), "Pix embutido no Por nao duplica bloco Pix");
assert.ok(mlCompleto.templateEspelhoShadow.mensagem.includes("🔗 Confira aqui:\nhttps://afiliado.test/produto"));
assert.ok(!mlCompleto.templateEspelhoShadow.mensagem.includes("120,50"), "preco da pagina nao substitui captura");

const mlTechnosCupomSemPix = criarEspelho({
  textoOriginal: [
    "Relogio Technos Masculino",
    "Por: R$ 399,83",
    "Use o cupom TECHNOS10",
    "Confira aqui: https://meli.la/technos"
  ].join("\n"),
  oferta: { marketplace: "mercadolivre", preco: 599.9, linkAfiliado: "https://meli.afiliado/technos" },
  ofertaEntrada: { cupom: "TECHNOS10", condicaoPix: "Use o cupom TECHNOS10" },
  comercialNormalizado: { marketplace: "mercadolivre", precoAtual: 399.83, precoConfiavel: true }
});
assert.strictEqual(mlTechnosCupomSemPix.documentoComercialCanonico.precoPorTexto, "R$ 399,83");
assert.strictEqual(mlTechnosCupomSemPix.documentoComercialCanonico.precoDeTexto, null);
assert.strictEqual(mlTechnosCupomSemPix.documentoComercialCanonico.precoPixTexto, null);
assert.strictEqual(mlTechnosCupomSemPix.espelhoComercial.formaPagamentoTexto, null);
assert.strictEqual(mlTechnosCupomSemPix.documentoComercialCanonico.cupomTexto, "TECHNOS10");
assert.strictEqual(mlTechnosCupomSemPix.documentoComercialCanonico.linkProdutoOriginal, "https://meli.la/technos");
assert.ok(!/\b(?:cupom|use|https?:\/\/|technos masculino)\b/i.test(mlTechnosCupomSemPix.documentoComercialCanonico.precoPorTexto));

const mlPixProprio = criarEspelho({
  textoOriginal: [
    "Produto Mercado Livre",
    "De: R$ 129,99",
    "Por: R$ 64,44",
    "Pix: R$ 61,22",
    "Cupom: PIPOCA",
    "https://meli.la/pipoca"
  ].join("\n"),
  oferta: { marketplace: "mercadolivre", preco: 64.44, linkAfiliado: "https://meli.afiliado/pipoca" },
  ofertaEntrada: { cupom: "PIPOCA" },
  comercialNormalizado: { marketplace: "mercadolivre", precoAtual: 64.44, precoConfiavel: true }
});
assert.strictEqual(mlPixProprio.documentoComercialCanonico.precoDeTexto, "R$ 129,99");
assert.strictEqual(mlPixProprio.documentoComercialCanonico.precoPorTexto, "R$ 64,44");
assert.strictEqual(mlPixProprio.documentoComercialCanonico.precoPixTexto, "R$ 61,22");
assert.strictEqual(mlPixProprio.documentoComercialCanonico.cupomTexto, "PIPOCA");
assert.ok(!/\bCupom\b|https?:\/\//i.test(mlPixProprio.documentoComercialCanonico.precoPixTexto));

const templateAdaptativoCupomDesligado = montarTemplateEspelhoShadow(
  mlCompleto.espelhoComercial,
  mlCompleto.documentoComercialCanonico,
  {
    template: {
      blocos: [
        { tipo: "titulo", ativo: true, ordem: 10 },
        { tipo: "preco_de", ativo: true, ordem: 20 },
        { tipo: "preco_por", ativo: true, ordem: 30 },
        { tipo: "cupom", ativo: false, ordem: 40 },
        { tipo: "frase_cupom", ativo: false, ordem: 50 },
        { tipo: "link", ativo: true, ordem: 60 }
      ]
    }
  }
);
assert.strictEqual(templateAdaptativoCupomDesligado.ok, true);
assert.ok(templateAdaptativoCupomDesligado.mensagem.includes("De: R$ 299,99"));
assert.ok(templateAdaptativoCupomDesligado.mensagem.includes("Por: R$ 73,79 via Pix"));
assert.ok(templateAdaptativoCupomDesligado.mensagem.includes("via Pix"), "toggle Pix ausente/desligado nao remove condicao Pix do preco canonico");
assert.ok(templateAdaptativoCupomDesligado.mensagem.includes("Cupom: FASHIONML"), "cupom confiavel permanece obrigatorio mesmo com toggle desligado");
assert.ok(!templateAdaptativoCupomDesligado.mensagem.includes("Aplique o cupom"), "toggle desligado oculta apenas instrucao existente");
assert.ok(!/\b(?:undefined|null|NaN|Infinity)\b/.test(templateAdaptativoCupomDesligado.mensagem));

const templateDecorativosDesligados = montarTemplateEspelhoShadow(
  mlCompleto.espelhoComercial,
  mlCompleto.documentoComercialCanonico,
  {
    contexto: { marketplace: "mercadolivre", categoria: "Moda", economia: "R$ 226,20" },
    template: {
      blocos: [
        { tipo: "titulo", ativo: true, ordem: 10 },
        { tipo: "marketplace", ativo: false, ordem: 20 },
        { tipo: "categoria", ativo: false, ordem: 30 },
        { tipo: "preco_de", ativo: false, ordem: 40 },
        { tipo: "preco_por", ativo: true, ordem: 50 },
        { tipo: "economia", ativo: false, ordem: 60 },
        { tipo: "cupom", ativo: true, ordem: 70 },
        { tipo: "link", ativo: true, ordem: 80 }
      ],
      rodape: { ativo: false, texto: "Rodape Optimus" }
    }
  }
);
assert.ok(!templateDecorativosDesligados.mensagem.includes("Marketplace:"), "marketplace desligado desaparece");
assert.ok(!templateDecorativosDesligados.mensagem.includes("Categoria:"), "categoria desligada desaparece");
assert.ok(!templateDecorativosDesligados.mensagem.includes("De: R$ 299,99"), "preco De desligado desaparece");
assert.ok(!templateDecorativosDesligados.mensagem.includes("Economia:"), "economia desligada desaparece");
assert.ok(!templateDecorativosDesligados.mensagem.includes("Rodape Optimus"), "rodape desligado desaparece");

const templateRodapeLigado = montarTemplateEspelhoShadow(
  mlCompleto.espelhoComercial,
  mlCompleto.documentoComercialCanonico,
  {
    template: {
      blocos: [
        { tipo: "titulo", ativo: true, ordem: 10 },
        { tipo: "preco_por", ativo: true, ordem: 20 },
        { tipo: "link", ativo: true, ordem: 30 }
      ],
      rodape: { ativo: true, texto: "Rodape Optimus" }
    }
  }
);
assert.ok(templateRodapeLigado.mensagem.endsWith("Rodape Optimus"), "rodape ligado aparece");

const templateAdaptativoCupomAmbiguo = montarTemplateEspelhoShadow(
  { cupomCodigo: "TALVEZ10", motivosConfianca: [] },
  { tituloOriginal: "Oferta ambigua", precoPorTexto: "R$ 50,00", cupomTexto: "TALVEZ10", confianca: { motivos: [] } },
  {
    template: {
      blocos: [
        { tipo: "titulo", ativo: true, ordem: 10 },
        { tipo: "preco_por", ativo: true, ordem: 20 },
        { tipo: "cupom", ativo: false, ordem: 30 }
      ]
    }
  }
);
assert.ok(!templateAdaptativoCupomAmbiguo.mensagem.includes("Cupom: TALVEZ10"), "cupom ambiguo nao e promovido a obrigatorio sem evidencia");

const mlSimples = criarEspelho({
  textoOriginal: "Monitor Gamer Asrock\nPor R$ 594 com cupom JULHO15\nhttps://meli.la/produto",
  oferta: { preco: 700 },
  ofertaEntrada: { cupom: "JULHO15" }
});
assert.strictEqual(mlSimples.espelhoComercial.precoPorValor, 594);
assert.strictEqual(mlSimples.espelhoComercial.cupomCodigo, "JULHO15");
assert.strictEqual(mlSimples.espelhoComercial.precoDeValor, null);

const shopeeResgate = criarEspelho({
  textoOriginal: [
    "Resgate todos os cupons desta pagina",
    "https://s.shopee.com.br/resgate-cupom",
    "Fone Bluetooth",
    "Por R$ 89,90",
    "https://s.shopee.com.br/produto-real"
  ].join("\n"),
  oferta: { marketplace: "shopee", linkAfiliado: "https://shopee.afiliado/produto" }
});
assert.strictEqual(shopeeResgate.espelhoComercial.cupomCodigo, null);
assert.strictEqual(shopeeResgate.espelhoComercial.instrucaoComercial, "Resgate todos os cupons desta pagina");
assert.strictEqual(shopeeResgate.espelhoComercial.linkResgateOriginal, "https://s.shopee.com.br/resgate-cupom");
assert.strictEqual(shopeeResgate.espelhoComercial.linkProdutoOriginal, "https://s.shopee.com.br/produto-real");
assert.strictEqual(shopeeResgate.documentoComercialCanonico.linkResgateOriginal, "https://s.shopee.com.br/resgate-cupom");
assert.strictEqual(shopeeResgate.documentoComercialCanonico.linkProdutoOriginal, "https://s.shopee.com.br/produto-real");
const shopeeResgateObrigatorio = montarTemplateEspelhoShadow(
  shopeeResgate.espelhoComercial,
  shopeeResgate.documentoComercialCanonico,
  {
    template: {
      blocos: [
        { tipo: "titulo", ativo: true, ordem: 10 },
        { tipo: "preco_por", ativo: true, ordem: 20 },
        { tipo: "link_resgate", ativo: false, ordem: 30 },
        { tipo: "link", ativo: true, ordem: 40 }
      ]
    }
  }
);
assert.ok(shopeeResgateObrigatorio.mensagem.includes("🎟️ Resgate:\nhttps://s.shopee.com.br/resgate-cupom"), "resgate essencial permanece mesmo com toggle desligado");
assert.ok(shopeeResgateObrigatorio.mensagem.includes("🔗 Confira aqui:\nhttps://shopee.afiliado/produto"), "link afiliado segue separado do resgate");

const shopeeSomenteProduto = criarEspelho({
  textoOriginal: [
    "Produto Shopee simples",
    "Por R$ 49,90",
    "Link produto:",
    "https://s.shopee.com.br/produto-unico?lp=aff"
  ].join("\n"),
  oferta: { marketplace: "shopee", linkAfiliado: "https://shopee.afiliado/produto-unico" },
  comercialNormalizado: { marketplace: "shopee", precoAtual: 49.9, precoConfiavel: true }
});
assert.strictEqual(shopeeSomenteProduto.documentoComercialCanonico.linkResgateOriginal, null);
assert.strictEqual(shopeeSomenteProduto.documentoComercialCanonico.linkProdutoOriginal, "https://s.shopee.com.br/produto-unico?lp=aff");
assert.strictEqual(shopeeSomenteProduto.documentoComercialCanonico.precoPorTexto, "R$ 49,90");

const shopeeVoucherMoedas = criarEspelho({
  textoOriginal: "Produto Shopee\nR$ 70 usando moedas + cupom\nVoucher disponivel no app\nhttps://s.shopee.com.br/produto",
  oferta: { marketplace: "shopee", preco: 80 },
  ofertaEntrada: { beneficios: ["moedas + cupom", "voucher no app"] }
});
assert.strictEqual(shopeeVoucherMoedas.espelhoComercial.precoPorValor, 70);
assert.ok(shopeeVoucherMoedas.espelhoComercial.condicoesComerciais.includes("voucher_ou_moedas"));

const amazonCupomPagina = criarEspelho({
  textoOriginal: "Echo Dot\nPor R$ 299,00\nAplique o cupom AMAZON20 para obter o desconto\nhttps://amzn.to/produto",
  oferta: { marketplace: "amazon", preco: 299 },
  ofertaEntrada: { cupom: "AMAZON20" }
});
assert.strictEqual(amazonCupomPagina.espelhoComercial.cupomCodigo, "AMAZON20");
assert.match(amazonCupomPagina.espelhoComercial.instrucaoComercial, /AMAZON20/);

const aliexpressMoedaEstrangeira = criarEspelho({
  textoOriginal: "Gadget importado\nPor US$ 19.99\nCupom: ALI5\nhttps://aliexpress.com/item/1",
  oferta: { marketplace: "aliexpress", preco: 19.99, moeda: "USD" },
  comercialNormalizado: { marketplace: "aliexpress", precoAtual: 19.99, moeda: "USD", precoConfiavel: false, avisoPreco: "moeda_nao_convertida" }
});
assert.strictEqual(aliexpressMoedaEstrangeira.espelhoComercial.cupomCodigo, "ALI5");
assert.ok(aliexpressMoedaEstrangeira.espelhoComercial.avisos.includes("moeda_nao_convertida"));
assert.strictEqual(aliexpressMoedaEstrangeira.documentoComercialCanonico.precoPorTexto, "US$ 19.99");
assert.ok(aliexpressMoedaEstrangeira.templateEspelhoShadow.mensagem.includes("US$ 19.99"), "moeda estrangeira permanece no texto Shadow");
assert.ok(!aliexpressMoedaEstrangeira.templateEspelhoShadow.mensagem.includes("R$ 19,99"), "moeda estrangeira nao vira BRL");

const aliexpressAppPc = criarEspelho({
  textoOriginal: [
    "Mini PC PUSKILL",
    "Por R$ 227",
    "APP: https://a.aliexpress.com/_c37JTNLV",
    "PC: https://a.aliexpress.com/_c4b9dLcf"
  ].join("\n"),
  oferta: { marketplace: "aliexpress", preco: 227, linkAfiliado: "" },
  comercialNormalizado: { marketplace: "aliexpress", precoAtual: 227, precoConfiavel: true }
});
assert.deepStrictEqual(
  aliexpressAppPc.documentoComercialCanonico.linksComerciais.map(item => item.tipo),
  ["app", "pc"]
);
assert.deepStrictEqual(
  aliexpressAppPc.documentoComercialCanonico.linksComerciais.map(item => item.renderizavel),
  [false, false],
  "APP/PC capturados de fonte externa sem conversao nao sao CTAs seguros"
);
assert.ok(!aliexpressAppPc.templateEspelhoShadow.mensagem.includes("https://a.aliexpress.com/_c37JTNLV"));
assert.ok(!aliexpressAppPc.templateEspelhoShadow.mensagem.includes("https://a.aliexpress.com/_c4b9dLcf"));

const aliexpressAppPcOficialNeutro = criarEspelho({
  textoOriginal: [
    "Mini PC PUSKILL",
    "Por R$ 227",
    "APP oficial neutro: https://a.aliexpress.com/_appOficial",
    "PC oficial neutro: https://a.aliexpress.com/_pcOficial"
  ].join("\n"),
  oferta: { marketplace: "aliexpress", preco: 227, linkAfiliado: "" },
  comercialNormalizado: { marketplace: "aliexpress", precoAtual: 227, precoConfiavel: true }
});
assertBloco(aliexpressAppPcOficialNeutro, "link_app");
assertBloco(aliexpressAppPcOficialNeutro, "link_pc");
assert.ok(aliexpressAppPcOficialNeutro.templateEspelhoShadow.mensagem.includes("APP:\nhttps://a.aliexpress.com/_appOficial"));
assert.ok(aliexpressAppPcOficialNeutro.templateEspelhoShadow.mensagem.includes("PC:\nhttps://a.aliexpress.com/_pcOficial"));

const kabumSimples = criarEspelho({
  textoOriginal: "Fonte XPG Core Reactor\nValor: R$ 415,00\nCupom: JULHOFORTE15\nFrete varia por Estado\nhttps://awin1.com/cread.php",
  oferta: { marketplace: "kabum", preco: 415, linkAfiliado: "https://awin1.com/afiliado" }
});
assert.strictEqual(kabumSimples.espelhoComercial.precoPorValor, 415);
assert.strictEqual(kabumSimples.espelhoComercial.cupomCodigo, "JULHOFORTE15");
assert.ok(kabumSimples.espelhoComercial.condicoesComerciais.some(item => /frete/i.test(item)));
assert.strictEqual(kabumSimples.documentoComercialCanonico.freteTexto, "Frete varia por Estado");
const kabumFreteDesligado = montarTemplateEspelhoShadow(
  kabumSimples.espelhoComercial,
  kabumSimples.documentoComercialCanonico,
  {
    template: {
      blocos: [
        { tipo: "titulo", ativo: true, ordem: 10 },
        { tipo: "preco_por", ativo: true, ordem: 20 },
        { tipo: "frete", ativo: false, ordem: 30 },
        { tipo: "beneficio", ativo: true, ordem: 40 },
        { tipo: "cupom", ativo: true, ordem: 50 },
        { tipo: "link", ativo: true, ordem: 60 }
      ]
    }
  }
);
assert.ok(!kabumFreteDesligado.mensagem.includes("Frete varia por Estado"), "frete desligado nao reaparece em outro bloco");

const semCupom = criarEspelho({
  textoOriginal: "Oferta minima\nPor R$ 79,90\nhttps://produto.test/1",
  oferta: { preco: 79.9 }
});
assert.strictEqual(semCupom.espelhoComercial.cupomCodigo, null);
assert.ok(!semCupom.templateEspelhoShadow.mensagem.includes("Cupom:"));
assert.ok(!semCupom.templateEspelhoShadow.mensagem.includes("Aplique o cupom"));

const cashback = criarEspelho({
  textoOriginal: "Produto com cashback\nPor R$ 100,00\nR$ 10 de cashback\nhttps://produto.test/2",
  oferta: { preco: 100, cashback: "R$ 10 de cashback" }
});
assert.strictEqual(cashback.espelhoComercial.precoPorValor, 100);
assert.strictEqual(cashback.espelhoComercial.precoFinalValor, null, "cashback nao reduz preco pago nem cria preco final");
assert.ok(cashback.espelhoComercial.condicoesComerciais.some(item => /cashback/i.test(item)));
assert.ok(cashback.templateEspelhoShadow.mensagem.includes("💰 Cashback: R$ 10 de cashback"));
assert.ok(!cashback.templateEspelhoShadow.mensagem.includes("R$ 90"), "cashback nao e abatido do preco pago");
const cashbackDesligado = montarTemplateEspelhoShadow(
  cashback.espelhoComercial,
  cashback.documentoComercialCanonico,
  {
    template: {
      blocos: [
        { tipo: "titulo", ativo: true, ordem: 10 },
        { tipo: "preco_por", ativo: true, ordem: 20 },
        { tipo: "beneficio", ativo: true, ordem: 30 },
        { tipo: "cashback", ativo: false, ordem: 40 },
        { tipo: "link", ativo: true, ordem: 50 }
      ]
    }
  }
);
assert.ok(!cashbackDesligado.mensagem.includes("Cashback:"), "cashback desligado nao renderiza bloco dedicado");
assert.ok(!cashbackDesligado.mensagem.includes("Beneficio: R$ 10 de cashback"), "cashback desligado nao reaparece como beneficio");
assert.ok(!cashbackDesligado.mensagem.includes("Benefício: R$ 10 de cashback"), "cashback desligado nao reaparece como beneficio visual");

const parcelamento = criarEspelho({
  textoOriginal: "Produto parcelado\nDe R$ 499 por R$ 205 no Pix ou R$ 215,83 em ate 6x\nCupom: FASHION ou MODACOMVC\nhttps://meli.la/produto",
  oferta: { preco: 300 },
  ofertaEntrada: { parcelamento: "R$ 215,83 em ate 6x" }
});
assert.strictEqual(parcelamento.espelhoComercial.precoDeValor, 499);
assert.strictEqual(parcelamento.espelhoComercial.precoPorValor, 205);
assert.strictEqual(parcelamento.espelhoComercial.cupomCodigo, "FASHION ou MODACOMVC");
assert.ok(parcelamento.espelhoComercial.condicoesComerciais.some(item => /6x/.test(item)));
const ofertaCompletaAdaptativa = montarTemplateEspelhoShadow(
  parcelamento.espelhoComercial,
  parcelamento.documentoComercialCanonico,
  {
    template: {
      blocos: [
        { tipo: "titulo", ativo: true, ordem: 10 },
        { tipo: "preco_de", ativo: true, ordem: 20 },
        { tipo: "preco_por", ativo: true, ordem: 30 },
        { tipo: "parcelamento", ativo: true, ordem: 40 },
        { tipo: "cupom", ativo: true, ordem: 50 },
        { tipo: "link", ativo: true, ordem: 60 }
      ],
      rodape: { ativo: true, texto: "Rodape completo" }
    }
  }
);
assert.ok(ofertaCompletaAdaptativa.mensagem.includes("De: R$ 499"));
assert.ok(ofertaCompletaAdaptativa.mensagem.includes("Por: R$ 205,00 no Pix"));
assert.ok(ofertaCompletaAdaptativa.mensagem.includes("R$ 215,83 em ate 6x"));
assert.ok(ofertaCompletaAdaptativa.mensagem.includes("Cupom: FASHION ou MODACOMVC"));
assert.ok(ofertaCompletaAdaptativa.mensagem.includes("Confira aqui:"));
assert.ok(ofertaCompletaAdaptativa.mensagem.endsWith("Rodape completo"));

const avaliacaoComNotaReal = montarTemplateEspelhoShadow(
  {},
  { tituloOriginal: "Produto avaliado", precoPorTexto: "R$ 10,00", linkAfiliado: "https://afiliado.test/avaliado" },
  {
    contexto: { avaliacao: "4.8" },
    template: { blocos: [{ tipo: "avaliacao", ativo: true, ordem: 10 }] }
  }
);
assert.ok(avaliacaoComNotaReal.mensagem.includes("4.8"), "nota real pode ser apresentada");

const avaliacaoComQuantidade = montarTemplateEspelhoShadow(
  {},
  { tituloOriginal: "Produto com quantidade", precoPorTexto: "R$ 10,00", linkAfiliado: "https://afiliado.test/quantidade" },
  {
    contexto: { avaliacao: "90 avaliações" },
    template: { blocos: [{ tipo: "avaliacao", ativo: true, ordem: 10 }] }
  }
);
assert.ok(avaliacaoComQuantidade.mensagem.includes("90 avaliações"), "quantidade de avaliacoes pode aparecer como quantidade");

const avaliacaoScoreInterno = montarTemplateEspelhoShadow(
  {},
  { tituloOriginal: "Produto com score", precoPorTexto: "R$ 10,00", linkAfiliado: "https://afiliado.test/score" },
  {
    contexto: { score: 90 },
    template: {
      blocos: [
        { tipo: "titulo", ativo: true, ordem: 10 },
        { tipo: "avaliacao", ativo: true, ordem: 20 }
      ]
    }
  }
);
assert.ok(!avaliacaoScoreInterno.mensagem.includes("90"), "score interno nao vira avaliacao");

const avaliacaoSemSemantica = montarTemplateEspelhoShadow(
  {},
  { tituloOriginal: "Produto sem avaliacao", precoPorTexto: "R$ 10,00", linkAfiliado: "https://afiliado.test/semantica" },
  {
    contexto: { avaliacao: "Avaliação: 90" },
    template: {
      blocos: [
        { tipo: "titulo", ativo: true, ordem: 10 },
        { tipo: "avaliacao", ativo: true, ordem: 20 }
      ]
    }
  }
);
assert.ok(!avaliacaoSemSemantica.mensagem.includes("Avaliação: 90"), "numero sem semantica de nota real fica oculto");

const imagem = selecionarImagemComercial({
  oferta: { imagem: "https://cdn.marketplace.test/produto-limpo.jpg", imagemOrigem: "canonical.product.image" },
  ofertaEntrada: { thumbnail: "https://grupo-fonte.test/card-whatsapp.jpg" }
});
assert.strictEqual(imagem.urlSelecionada, "https://cdn.marketplace.test/produto-limpo.jpg");
assert.strictEqual(imagem.imagemOficial, true);
assert.strictEqual(imagem.imagemLimpa, true);

const falha = construirEspelhoComercialV24FailOpen({
  oferta: Object.defineProperty({}, "titulo", { get() { throw new Error("falha_controlada"); } })
});
assert.strictEqual(falha.ok, false);
assert.strictEqual(falha.aplicouMudancas, false);
assert.strictEqual(falha.motivo, "espelho_comercial_exception");

const resumo = resumoEspelhoComercialLog(mlCompleto, { workspaceId: "user_teste", ofertaId: 99, jobId: 10 });
assert.strictEqual(resumo.temPrecoFinal, true);
assert.strictEqual(resumo.temPix, true);
assert.strictEqual(resumo.temCupom, true);
assert.strictEqual(resumo.aplicouMudancasOperacionais, false);
assert.ok(!JSON.stringify(resumo).includes("Aplique o cupom"), "log resumido nao expoe texto completo");

const amazonRtxRecorte = criarEspelho({
  textoOriginal: [
    "Placa de Video RTX 5060 Ti Gaming OC, 16GB, GDDR7, 128-bit",
    "Boost Clock, 3 x DisplayPort, 1 x HDMI",
    "R$ 2499 no PIX com cupom: EBACUPOM R$ 20 OFF no cupom/pagina",
    "10x de R$ 317,70 sem juros",
    "Resgate no anuncio",
    "Link: https://amzn.to/rtx5060ti"
  ].join("\n"),
  oferta: { marketplace: "amazon", preco: 3170, linkAfiliado: "https://amzn.to/afiliado-rtx" },
  ofertaEntrada: { cupom: "EBACUPOM" },
  comercialNormalizado: { marketplace: "amazon", precoAtual: 2499, precoConfiavel: true }
});
assert.strictEqual(amazonRtxRecorte.documentoComercialCanonico.precoPorTexto, "R$ 2.499,00 no Pix");
assert.strictEqual(amazonRtxRecorte.documentoComercialCanonico.precoPixTexto, "R$ 2.499,00 no Pix");
assert.strictEqual(amazonRtxRecorte.documentoComercialCanonico.parcelamentoTexto, "10x de R$ 317,70 sem juros");
assert.strictEqual(amazonRtxRecorte.documentoComercialCanonico.cupomTexto, "EBACUPOM");
assert.strictEqual(amazonRtxRecorte.documentoComercialCanonico.beneficioTexto, "R$ 20 OFF no cupom/pagina");
assert.strictEqual(amazonRtxRecorte.documentoComercialCanonico.instrucaoTexto, "Resgate no anuncio");
assert.strictEqual(amazonRtxRecorte.documentoComercialCanonico.linkProdutoOriginal, "https://amzn.to/rtx5060ti");
assert.ok(!/https?:\/\//i.test(amazonRtxRecorte.documentoComercialCanonico.precoPorTexto), "preco nao contem URL");
assert.ok(!/\b(?:cupom|link|displayport|hdmi)\b/i.test(amazonRtxRecorte.documentoComercialCanonico.precoPorTexto), "preco nao engole cupom, link ou especificacao");
assert.ok(!amazonRtxRecorte.templateEspelhoShadow.mensagem.includes("Pix:"), "Amazon Pix nao duplica no template");

const mlCompactado = criarEspelho({
  textoOriginal: "Kit Compacto De: R$ 78 por R$ 40 no Pix Cupom: OFFCASA Link: https://meli.la/compacto",
  oferta: { marketplace: "mercadolivre", preco: 122.82, linkAfiliado: "https://meli.afiliado/compacto" },
  ofertaEntrada: { cupom: "OFFCASA" }
});
assert.strictEqual(mlCompactado.documentoComercialCanonico.precoDeTexto, "R$ 78,00");
assert.strictEqual(mlCompactado.documentoComercialCanonico.precoPorTexto, "R$ 40,00 no Pix");
assert.strictEqual(mlCompactado.documentoComercialCanonico.precoPixTexto, "R$ 40,00 no Pix");
assert.strictEqual(mlCompactado.documentoComercialCanonico.cupomTexto, "OFFCASA");
assert.strictEqual(mlCompactado.documentoComercialCanonico.linkProdutoOriginal, "https://meli.la/compacto");
assert.ok(!/\bCupom\b|https?:\/\//i.test(mlCompactado.documentoComercialCanonico.precoPorTexto));

const shopeeDoisLinks = criarEspelho({
  textoOriginal: [
    "Resgate:",
    "https://s.shopee.com.br/cupom-real",
    "Link do produto:",
    "https://s.shopee.com.br/produto-real?lp=aff"
  ].join("\n"),
  oferta: { marketplace: "shopee", linkAfiliado: "https://shopee.afiliado/produto-real" },
  comercialNormalizado: { marketplace: "shopee", precoConfiavel: false }
});
assert.strictEqual(shopeeDoisLinks.documentoComercialCanonico.linkResgateOriginal, "https://s.shopee.com.br/cupom-real");
assert.strictEqual(shopeeDoisLinks.documentoComercialCanonico.linkProdutoOriginal, "https://s.shopee.com.br/produto-real?lp=aff");
const shopeeDoisLinksTemplate = montarTemplateEspelhoShadow(shopeeDoisLinks.espelhoComercial, shopeeDoisLinks.documentoComercialCanonico, {
  template: { blocos: [{ tipo: "link_resgate", ativo: true, ordem: 10 }, { tipo: "link", ativo: true, ordem: 20 }] }
});
assert.ok(shopeeDoisLinksTemplate.mensagem.includes("Resgate:\nhttps://s.shopee.com.br/cupom-real"));
assert.ok(shopeeDoisLinksTemplate.mensagem.includes("Confira aqui:\nhttps://shopee.afiliado/produto-real"));

const shopeeResgateDoisProdutos = criarEspelho({
  textoOriginal: [
    "Resgate:",
    "https://s.shopee.com.br/cupom-real",
    "Link produto A:",
    "https://s.shopee.com.br/produto-a",
    "Link produto B:",
    "https://s.shopee.com.br/produto-b"
  ].join("\n"),
  oferta: { marketplace: "shopee", linkAfiliado: "" },
  comercialNormalizado: { marketplace: "shopee", precoConfiavel: false }
});
assert.strictEqual(shopeeResgateDoisProdutos.documentoComercialCanonico.linkResgateOriginal, "https://s.shopee.com.br/cupom-real");
assert.strictEqual(shopeeResgateDoisProdutos.documentoComercialCanonico.linkProdutoOriginal, "https://s.shopee.com.br/produto-a");
assert.ok(shopeeResgateDoisProdutos.documentoComercialCanonico.avisos.includes("links_produto_ambiguos"));
assert.deepStrictEqual(
  shopeeResgateDoisProdutos.documentoComercialCanonico.linksComerciais.map(item => item.tipo),
  ["resgate", "produto", "produto"]
);
assert.deepStrictEqual(
  shopeeResgateDoisProdutos.documentoComercialCanonico.linksComerciais.map(item => item.renderizavel),
  [true, false, false],
  "produtos ambiguos ficam preservados para auditoria, mas nao renderizaveis"
);

function blocosV26(resultado) {
  return resultado.documentoComercialCanonico.blocos || [];
}

function tiposV26(resultado) {
  return blocosV26(resultado).map(bloco => bloco.tipo);
}

function blocosTipo(resultado, tipo) {
  return blocosV26(resultado).filter(bloco => bloco.tipo === tipo);
}

function blocoTipo(resultado, tipo) {
  return blocosTipo(resultado, tipo)[0] || null;
}

function assertBloco(resultado, tipo, mensagem = tipo) {
  assert.ok(blocoTipo(resultado, tipo), `bloco V2.6 ausente: ${mensagem}`);
}

function assertSemDuplicidadeDedupe(resultado) {
  const chaves = blocosV26(resultado).map(bloco => bloco.dedupeKey);
  assert.strictEqual(new Set(chaves).size, chaves.length, "dedupeKey V2.6 sem duplicidade");
}

function assertBlocosObrigatorios(resultado) {
  for (const bloco of blocosV26(resultado)) {
    assert.ok(bloco.id, "bloco tem id");
    assert.ok(bloco.tipo, "bloco tem tipo");
    assert.ok(bloco.origem, "bloco tem origem");
    assert.ok(bloco.confianca, "bloco tem confianca");
    assert.ok(Number.isFinite(bloco.ordemSugerida), "bloco tem ordem");
    assert.ok(bloco.dedupeKey, "bloco tem dedupeKey");
    assert.strictEqual(typeof bloco.essencial, "boolean", "bloco tem essencial booleano");
  }
}

for (const fixture of [
  mlCompleto,
  mlTechnosCupomSemPix,
  mlPixProprio,
  mlSimples,
  shopeeResgate,
  shopeeSomenteProduto,
  shopeeResgateDoisProdutos,
  aliexpressMoedaEstrangeira,
  aliexpressAppPc,
  kabumSimples,
  semCupom,
  cashback,
  parcelamento,
  amazonRtxRecorte,
  mlCompactado,
  shopeeDoisLinks
]) {
  assert.ok(Array.isArray(fixture.documentoComercialCanonico.blocos), "Documento Canonico possui blocos V2.6");
  assertBlocosObrigatorios(fixture);
  assertSemDuplicidadeDedupe(fixture);
  assert.strictEqual(fixture.documentoComercialCanonico.precoPorTexto ?? null, fixture.documentoComercialCanonico.precoPorTexto, "campos planos preservados");
}

assertBloco(mlCompleto, "titulo");
assertBloco(mlCompleto, "preco_referencia");
assertBloco(mlCompleto, "preco_oferta");
assertBloco(mlCompleto, "cupom_codigo");
assertBloco(mlCompleto, "instrucao_cupom");
assertBloco(mlCompleto, "link_afiliado");
assert.strictEqual(blocoTipo(mlCompleto, "preco_oferta").textoOriginal, "R$ 73,79 via Pix");
assert.strictEqual(blocoTipo(mlCompleto, "cupom_codigo").essencial, true, "cupom com instrucao/preco condicionado fica essencial");
assert.ok(blocoTipo(mlCompleto, "preco_oferta").requisitos.includes("pagamento_pix"));
assert.ok(blocoTipo(mlCompleto, "preco_oferta").requisitos.includes("cupom"));

const mlPixVendedorFreteGrupo = criarEspelho({
  textoOriginal: [
    "Tenis Mercado Livre",
    "Por: R$ 199,90 no Pix",
    "Vendedor: Loja Oficial",
    "Frete gratis",
    "Grupo: https://chat.whatsapp.com/fonte",
    "Link: https://meli.la/tenis"
  ].join("\n"),
  oferta: { marketplace: "mercadolivre", preco: 199.9, linkAfiliado: "https://meli.afiliado/tenis" },
  ofertaEntrada: { vendedor: "Loja Oficial" }
});
assertBloco(mlPixVendedorFreteGrupo, "vendedor");
assertBloco(mlPixVendedorFreteGrupo, "frete");
assert.strictEqual(blocoTipo(mlPixVendedorFreteGrupo, "link_fonte_ignorado"), null, "link de fonte/grupo nao entra no Documento Canonico V2.7");
assert.strictEqual(mlPixVendedorFreteGrupo.documentoComercialCanonico.precoPorTexto, "R$ 199,90 no Pix");

const mlAvaliacaoCupomInstrucao = criarEspelho({
  textoOriginal: [
    "Produto bem avaliado",
    "Por: R$ 122,82",
    "Cupom: MODALIVRE",
    "Aplique o cupom MODALIVRE no carrinho.",
    "https://meli.la/avaliado"
  ].join("\n"),
  oferta: { marketplace: "mercadolivre", preco: 122.82, linkAfiliado: "https://meli.afiliado/avaliado", rating: "4.8", quantidadeAvaliacoes: "90 avaliacoes" }
});
assertBloco(mlAvaliacaoCupomInstrucao, "avaliacao_nota");
assertBloco(mlAvaliacaoCupomInstrucao, "avaliacao_quantidade");
assert.strictEqual(blocoTipo(mlAvaliacaoCupomInstrucao, "avaliacao_nota").valorEstruturado.nota, 4.8);
assert.strictEqual(blocoTipo(mlAvaliacaoCupomInstrucao, "cupom_codigo").essencial, true);

assertBloco(shopeeSomenteProduto, "link_afiliado");
assert.ok(!tiposV26(shopeeSomenteProduto).includes("link_resgate"), "Shopee apenas produto nao cria resgate");
assert.strictEqual(shopeeSomenteProduto.documentoComercialCanonico.linkProdutoOriginal, "https://s.shopee.com.br/produto-unico?lp=aff");

assertBloco(shopeeResgate, "link_resgate");
assertBloco(shopeeResgate, "link_afiliado");
assert.strictEqual(blocoTipo(shopeeResgate, "link_resgate").essencial, true, "resgate com contexto comercial e essencial");

assert.strictEqual(blocosTipo(shopeeResgateDoisProdutos, "links_produto_alternativos").length, 0, "produtos ambiguos nao viram blocos renderizaveis");
assert.strictEqual(shopeeResgateDoisProdutos.documentoComercialCanonico.linksComerciais.filter(item => item.tipo === "produto").length, 2);
assert.ok(shopeeResgateDoisProdutos.documentoComercialCanonico.avisos.includes("links_produto_ambiguos"));

const aliexpressMoedasAppPc = criarEspelho({
  textoOriginal: [
    "Mini Projetor AliExpress",
    "Por R$ 180",
    "Use moedas no app para desconto",
    "APP: https://a.aliexpress.com/_appMoedas",
    "PC: https://a.aliexpress.com/_pcMoedas",
    "Moedas: https://a.aliexpress.com/_coins"
  ].join("\n"),
  oferta: { marketplace: "aliexpress", preco: 180 },
  comercialNormalizado: { marketplace: "aliexpress", precoAtual: 180, precoConfiavel: true }
});
assertBloco(aliexpressMoedasAppPc, "moedas");
assert.strictEqual(blocosTipo(aliexpressMoedasAppPc, "link_app").length, 0);
assert.strictEqual(blocosTipo(aliexpressMoedasAppPc, "link_pc").length, 0);
assert.strictEqual(blocosTipo(aliexpressMoedasAppPc, "link_moedas").length, 0);
assert.ok(aliexpressMoedasAppPc.documentoComercialCanonico.linksComerciais.every(item => item.renderizavel === false));
assert.ok(!tiposV26(aliexpressMoedasAppPc).includes("link_resgate"), "AliExpress APP/PC/moedas nao viram resgate");

const aliexpressAppDuplicadoPc = criarEspelho({
  textoOriginal: [
    "AliExpress duplicado",
    "Por R$ 90",
    "APP: https://a.aliexpress.com/_dup",
    "APP: https://a.aliexpress.com/_dup",
    "PC: https://a.aliexpress.com/_pc"
  ].join("\n"),
  oferta: { marketplace: "aliexpress", preco: 90 },
  comercialNormalizado: { marketplace: "aliexpress", precoAtual: 90, precoConfiavel: true }
});
assert.strictEqual(aliexpressAppDuplicadoPc.documentoComercialCanonico.linksComerciais.filter(item => item.tipo === "app").length, 1, "APP duplicado deduplicado");
assert.strictEqual(aliexpressAppDuplicadoPc.documentoComercialCanonico.linksComerciais.filter(item => item.tipo === "pc").length, 1);
assert.strictEqual(blocosTipo(aliexpressAppDuplicadoPc, "link_app").length, 0);
assert.strictEqual(blocosTipo(aliexpressAppDuplicadoPc, "link_pc").length, 0);

const amazonCupomSemCodigo = criarEspelho({
  textoOriginal: [
    "Produto Amazon com cupom na pagina",
    "Por R$ 159,90",
    "Resgate cupom no anuncio",
    "https://amzn.to/cupom-pagina"
  ].join("\n"),
  oferta: { marketplace: "amazon", preco: 159.9, linkAfiliado: "https://amzn.to/afiliado-cupom-pagina" },
  comercialNormalizado: { marketplace: "amazon", precoAtual: 159.9, precoConfiavel: true }
});
assertBloco(amazonCupomSemCodigo, "cupom_sem_codigo");
assertBloco(amazonCupomSemCodigo, "instrucao_cupom");
assert.ok(!tiposV26(amazonCupomSemCodigo).includes("cupom_codigo"), "cupom sem codigo nao inventa codigo");
assert.ok(!tiposV26(amazonCupomSemCodigo).includes("link_resgate"), "instrucao Amazon de resgate no anuncio nao vira link de resgate");
assert.ok(!tiposV26(amazonCupomSemCodigo).includes("links_produto_alternativos"), "link afiliado nao vira alternativa duplicada de produto");

const amazonParcelado = criarEspelho({
  textoOriginal: "Produto Amazon parcelado\nPor R$ 699,00\n10x de R$ 69,90 sem juros\nhttps://amzn.to/parcelado",
  oferta: { marketplace: "amazon", preco: 699, linkAfiliado: "https://amzn.to/afiliado-parcelado" },
  comercialNormalizado: { marketplace: "amazon", precoAtual: 699, precoConfiavel: true }
});
assertBloco(amazonParcelado, "parcelamento");
assertBloco(amazonParcelado, "valor_parcela");
assertBloco(amazonParcelado, "quantidade_parcelas");
assert.strictEqual(blocoTipo(amazonParcelado, "valor_parcela").valorEstruturado.valor, 69.9);

const amazonDePorPixAvaliacao = criarEspelho({
  textoOriginal: [
    "Oferta Amazon avaliada",
    "De: R$ 499,90",
    "Por: R$ 399,90 no Pix",
    "4.7",
    "https://amzn.to/avaliada"
  ].join("\n"),
  oferta: { marketplace: "amazon", preco: 399.9, linkAfiliado: "https://amzn.to/afiliado-avaliada", rating: "4.7" },
  comercialNormalizado: { marketplace: "amazon", precoAtual: 399.9, precoConfiavel: true }
});
assertBloco(amazonDePorPixAvaliacao, "preco_referencia");
assertBloco(amazonDePorPixAvaliacao, "preco_oferta");
assertBloco(amazonDePorPixAvaliacao, "avaliacao_nota");
assert.strictEqual(blocoTipo(amazonDePorPixAvaliacao, "preco_oferta").textoOriginal, "R$ 399,90 no Pix");

const kabumGarantiaFrete = criarEspelho({
  textoOriginal: [
    "Fonte KaBuM 850W",
    "Valor: R$ 415,00",
    "Cupom: JULHOFORTE15",
    "Garantia de 10 anos",
    "Frete varia por Estado",
    "https://www.kabum.com.br/produto/514896"
  ].join("\n"),
  oferta: { marketplace: "kabum", preco: 415, linkAfiliado: "https://awin1.com/afiliado-kabum" },
  comercialNormalizado: { marketplace: "kabum", precoAtual: 415, precoConfiavel: true }
});
assertBloco(kabumGarantiaFrete, "cupom_codigo");
assertBloco(kabumGarantiaFrete, "garantia");
assertBloco(kabumGarantiaFrete, "frete");

const kabumAwinYoutube = criarEspelho({
  textoOriginal: [
    "Teclado KaBuM",
    "Valor: R$ 199,00",
    "Link: https://www.awin1.com/cread.php?ued=https%3A%2F%2Fwww.kabum.com.br%2Fproduto%2F123",
    "Review: https://youtu.be/review-produto"
  ].join("\n"),
  oferta: { marketplace: "kabum", preco: 199, linkAfiliado: "https://awin1.com/deeplink-produto" },
  comercialNormalizado: { marketplace: "kabum", precoAtual: 199, precoConfiavel: true }
});
assertBloco(kabumAwinYoutube, "link_afiliado");
assert.strictEqual(blocoTipo(kabumAwinYoutube, "link_auxiliar"), null, "link auxiliar nao compete com o CTA AWIN/Kabum");

assertBloco(semCupom, "preco_oferta");
assertBloco(semCupom, "link_afiliado");
assert.ok(!tiposV26(semCupom).includes("cupom_codigo"), "oferta simples nao inventa cupom");

assertBloco(cashback, "cashback");
assert.strictEqual(cashback.espelhoComercial.precoFinalValor, null);
assert.ok(!JSON.stringify(blocoTipo(cashback, "cashback")).includes("R$ 90"), "cashback nao reduz preco no bloco");

assertBloco(aliexpressMoedaEstrangeira, "moeda");
assert.strictEqual(blocoTipo(aliexpressMoedaEstrangeira, "moeda").textoOriginal, "USD");
assert.strictEqual(blocoTipo(aliexpressMoedaEstrangeira, "preco_oferta").moeda, "USD");
assert.ok(!JSON.stringify(blocosV26(aliexpressMoedaEstrangeira)).includes("R$ 19,99"), "moeda estrangeira nao e convertida nos blocos");


const mlPlacaMaePolimento = criarEspelho({
  textoOriginal: [
    "Placa-mae Mercado Livre B550",
    "Por: R$ 406,00 no Pix",
    "Cupom: NAPAGINADOPRODUTO",
    "Pode haver beneficio pelo app",
    "Frete gratis",
    "NAPAGINADOPRODUTO",
    "Link: https://meli.la/placa-mae"
  ].join("\n"),
  oferta: { marketplace: "mercadolivre", preco: 406, linkAfiliado: "https://meli.afiliado/placa-mae" },
  comercialNormalizado: { marketplace: "mercadolivre", precoAtual: 406, precoConfiavel: true }
});
assert.ok(!tiposV26(mlPlacaMaePolimento).includes("link_resgate"), "ML nao cria resgate falso para link meli.la");
assert.ok(!tiposV26(mlPlacaMaePolimento).includes("beneficio_app"), "beneficio especulativo pelo app nao renderiza por padrao");
assert.ok(!tiposV26(mlPlacaMaePolimento).includes("beneficio"), "beneficio especulativo nao aparece como beneficio generico");
assert.strictEqual(mlPlacaMaePolimento.documentoComercialCanonico.precoPorTexto, "R$ 406,00 no Pix");
assert.strictEqual(mlPlacaMaePolimento.documentoComercialCanonico.precoPixTexto, "R$ 406,00 no Pix");
assert.ok(!mlPlacaMaePolimento.templateEspelhoShadow.mensagem.includes("Pix:"), "Pix dentro do Por nao duplica");
assert.ok(!mlPlacaMaePolimento.templateEspelhoShadow.mensagem.includes("Pode haver beneficio"));
assert.ok(!mlPlacaMaePolimento.templateEspelhoShadow.mensagem.includes("vazio"));

const mlOculosSemResgate = criarEspelho({
  textoOriginal: [
    "Oculos de sol Mercado Livre",
    "De: R$ 199,90 | Por: R$ 79,90",
    "Resgate o cupom OCULOS10",
    "https://mercadolivre.com/sec/2xProduto"
  ].join("\n"),
  oferta: { marketplace: "mercadolivre", preco: 79.9, linkAfiliado: "https://meli.afiliado/oculos" },
  ofertaEntrada: { cupom: "OCULOS10" },
  comercialNormalizado: { marketplace: "mercadolivre", precoAtual: 79.9, precoConfiavel: true }
});
assert.strictEqual(mlOculosSemResgate.documentoComercialCanonico.linkResgateOriginal, null);
assert.ok(!tiposV26(mlOculosSemResgate).includes("link_resgate"), "mercadolivre.com/sec e resgate textual nao viram resgate separado");
assert.strictEqual(blocosTipo(mlOculosSemResgate, "instrucao_cupom").length, 1, "instrucao de cupom renderiza uma unica vez");

const mlPotesInstrucaoUnica = criarEspelho({
  textoOriginal: [
    "Kit potes hermeticos",
    "Por: R$ 122,82",
    "Cupom: POTES10",
    "Use o cupom POTES10",
    "Use o cupom POTES10",
    "https://meli.la/potes"
  ].join("\n"),
  oferta: { marketplace: "mercadolivre", preco: 122.82, linkAfiliado: "https://meli.afiliado/potes" },
  ofertaEntrada: { cupom: "POTES10" },
  comercialNormalizado: { marketplace: "mercadolivre", precoAtual: 122.82, precoConfiavel: true }
});
assert.strictEqual(blocosTipo(mlPotesInstrucaoUnica, "instrucao_cupom").length, 1);
assert.strictEqual(blocoTipo(mlPotesInstrucaoUnica, "instrucao_cupom").textoOriginal, "Aplique o cupom POTES10 para obter o desconto.");
assert.ok(!tiposV26(mlPotesInstrucaoUnica).includes("link_resgate"));

const mlRoupaDoisCupons = criarEspelho({
  textoOriginal: [
    "Jaqueta masculina Mercado Livre",
    "De: R$ 299,99 por R$ 73,79 no Pix",
    "Cupom: FASHIONML ou MODACOMVC",
    "Resgate o cupom na pagina",
    "https://meli.la/roupa"
  ].join("\n"),
  oferta: { marketplace: "mercadolivre", preco: 73.79, linkAfiliado: "https://meli.afiliado/roupa" },
  ofertaEntrada: { cupom: "FASHIONML ou MODACOMVC" },
  comercialNormalizado: { marketplace: "mercadolivre", precoAtual: 73.79, precoConfiavel: true }
});
assert.ok(tiposV26(mlRoupaDoisCupons).includes("cupons_alternativos"));
assert.strictEqual(blocoTipo(mlRoupaDoisCupons, "instrucao_cupom").textoOriginal, "Aplique um dos cupons informados para obter o desconto.");
assert.ok(!tiposV26(mlRoupaDoisCupons).includes("link_resgate"));

const amazonCadeiraVazio = criarEspelho({
  textoOriginal: [
    "Cadeira ergonomica Amazon",
    "Por: R$ 799,90",
    "Beneficio: vazio",
    "vazio",
    "https://amzn.to/cadeira"
  ].join("\n"),
  oferta: { marketplace: "amazon", preco: 799.9, linkAfiliado: "https://amzn.to/afiliado-cadeira", beneficioTexto: "vazio" },
  comercialNormalizado: { marketplace: "amazon", precoAtual: 799.9, precoConfiavel: true }
});
assert.ok(!JSON.stringify(amazonCadeiraVazio.documentoComercialCanonico.blocos).includes("vazio"));
assert.ok(!amazonCadeiraVazio.templateEspelhoShadow.mensagem.includes("vazio"));

const mlCupomPixMisclassificado = criarEspelho({
  textoOriginal: [
    "Produto ML com cupom",
    "Por: R$ 399,83",
    "Use o cupom TECHNOS10",
    "https://meli.la/technos-cupom"
  ].join("\n"),
  oferta: { marketplace: "mercadolivre", preco: 399.83, linkAfiliado: "https://meli.afiliado/technos-cupom" },
  ofertaEntrada: { cupom: "TECHNOS10", condicaoPix: "Use o cupom TECHNOS10" },
  comercialNormalizado: { marketplace: "mercadolivre", precoAtual: 399.83, precoConfiavel: true }
});
assert.strictEqual(mlCupomPixMisclassificado.documentoComercialCanonico.precoPixTexto, null, "Use o cupom nao e preco Pix");
assert.strictEqual(mlCupomPixMisclassificado.espelhoComercial.formaPagamentoTexto, null);

const amazonPixTituloInvalido = criarEspelho({
  textoOriginal: [
    "anuncio)",
    "Por: R$ 2.499 no Pix",
    "vazio",
    "https://amzn.to/placa-video"
  ].join("\n"),
  oferta: { titulo: "Placa de Video RTX 5060 Ti", marketplace: "amazon", preco: 2499, linkAfiliado: "https://amzn.to/afiliado-placa-video" },
  comercialNormalizado: { marketplace: "amazon", precoAtual: 2499, precoConfiavel: true }
});
assert.strictEqual(amazonPixTituloInvalido.documentoComercialCanonico.tituloOriginal, "Placa de Video RTX 5060 Ti");
assert.ok(!amazonPixTituloInvalido.templateEspelhoShadow.mensagem.includes("anuncio)"));
assert.ok(!amazonPixTituloInvalido.templateEspelhoShadow.mensagem.includes("vazio"));
assert.ok(!amazonPixTituloInvalido.templateEspelhoShadow.mensagem.includes("Pix:"));

const mlCupomCodigoCru = criarEspelho({
  textoOriginal: [
    "Produto com codigo cru",
    "Por: R$ 88,00",
    "Cupom: ECONOMIA10",
    "ECONOMIA10",
    "https://meli.la/codigo-cru"
  ].join("\n"),
  oferta: { marketplace: "mercadolivre", preco: 88, linkAfiliado: "https://meli.afiliado/codigo-cru" },
  ofertaEntrada: { cupom: "ECONOMIA10", instrucaoCupom: "ECONOMIA10" },
  comercialNormalizado: { marketplace: "mercadolivre", precoAtual: 88, precoConfiavel: true }
});
assert.strictEqual(blocoTipo(mlCupomCodigoCru, "instrucao_cupom").textoOriginal, "Aplique o cupom ECONOMIA10 para obter o desconto.");
assert.strictEqual(blocosTipo(mlCupomCodigoCru, "cupom_codigo").length, 1);

const mlBeneficioAppEspeculativo = criarEspelho({
  textoOriginal: [
    "Produto app Mercado Livre",
    "Por: R$ 55,10",
    "Pode haver beneficio pelo app",
    "Confira no carrinho/app",
    "https://meli.la/app-beneficio"
  ].join("\n"),
  oferta: { marketplace: "mercadolivre", preco: 55.1, linkAfiliado: "https://meli.afiliado/app-beneficio" },
  ofertaEntrada: { beneficioTexto: "Pode haver beneficio pelo app" },
  comercialNormalizado: { marketplace: "mercadolivre", precoAtual: 55.1, precoConfiavel: true }
});
assert.ok(!tiposV26(mlBeneficioAppEspeculativo).includes("beneficio"));
assert.ok(!tiposV26(mlBeneficioAppEspeculativo).includes("beneficio_app"));
assert.ok(!mlBeneficioAppEspeculativo.templateEspelhoShadow.mensagem.includes("Pode haver"));
assert.ok(!tiposV26(mlBeneficioAppEspeculativo).includes("link_app"), "slug app em URL de produto ML nao vira link APP");

const shopeePolimentoResgateProduto = criarEspelho({
  textoOriginal: [
    "Kit beleza Shopee",
    "Por R$ 39,90",
    "Resgate todos os cupons:",
    "https://s.shopee.com.br/4LEepvkqdN",
    "Link produto:",
    "https://s.shopee.com.br/2qPrA9vtrB?lp=aff"
  ].join("\n"),
  oferta: { marketplace: "shopee", preco: 39.9, linkAfiliado: "https://shopee.afiliado/kit-beleza" },
  comercialNormalizado: { marketplace: "shopee", precoAtual: 39.9, precoConfiavel: true }
});
assert.strictEqual(shopeePolimentoResgateProduto.documentoComercialCanonico.linkResgateOriginal, "https://s.shopee.com.br/4LEepvkqdN");
assert.strictEqual(shopeePolimentoResgateProduto.documentoComercialCanonico.linkProdutoOriginal, "https://s.shopee.com.br/2qPrA9vtrB?lp=aff");
assert.ok(shopeePolimentoResgateProduto.templateEspelhoShadow.mensagem.includes("Resgate:\nhttps://s.shopee.com.br/4LEepvkqdN"));
assert.ok(shopeePolimentoResgateProduto.templateEspelhoShadow.mensagem.includes("Confira aqui:\nhttps://shopee.afiliado/kit-beleza"));

const aliexpressPolimentoAppPcMoedas = criarEspelho({
  textoOriginal: [
    "Fone AliExpress",
    "Por US$ 9.99",
    "Moedas disponiveis no app",
    "APP: https://a.aliexpress.com/_appPolido",
    "PC: https://a.aliexpress.com/_pcPolido",
    "Moedas: https://a.aliexpress.com/_coinPolido"
  ].join("\n"),
  oferta: { marketplace: "aliexpress", preco: 9.99, moeda: "USD" },
  comercialNormalizado: { marketplace: "aliexpress", precoAtual: 9.99, moeda: "USD", precoConfiavel: false }
});
assert.strictEqual(blocosTipo(aliexpressPolimentoAppPcMoedas, "link_app").length, 0);
assert.strictEqual(blocosTipo(aliexpressPolimentoAppPcMoedas, "link_pc").length, 0);
assert.strictEqual(blocosTipo(aliexpressPolimentoAppPcMoedas, "link_moedas").length, 0);
assert.ok(!tiposV26(aliexpressPolimentoAppPcMoedas).includes("link_resgate"));
assert.ok(!aliexpressPolimentoAppPcMoedas.templateEspelhoShadow.mensagem.includes("https://a.aliexpress.com/_appPolido"));
assert.ok(!aliexpressPolimentoAppPcMoedas.templateEspelhoShadow.mensagem.includes("https://a.aliexpress.com/_pcPolido"));

const mlConcorrenteAfiliadoD1 = criarEspelho({
  textoOriginal: [
    "Oferta ML com fontes concorrentes",
    "Por R$ 88,00",
    "Resgate: https://mercadolivre.com.br/sec/cupons",
    "Link: https://meli.la/produto-original",
    "Fonte: https://chat.whatsapp.com/grupo"
  ].join("\n"),
  oferta: { marketplace: "mercadolivre", preco: 88, linkAfiliado: "https://meli.afiliado/d1-oficial" },
  comercialNormalizado: { marketplace: "mercadolivre", precoAtual: 88, precoConfiavel: true }
});
assert.strictEqual(blocosTipo(mlConcorrenteAfiliadoD1, "link_afiliado").length, 1);
assert.strictEqual(blocosTipo(mlConcorrenteAfiliadoD1, "link_resgate").length, 0);
assert.strictEqual(blocosTipo(mlConcorrenteAfiliadoD1, "link_produto_original").length, 0);
assert.ok(mlConcorrenteAfiliadoD1.templateEspelhoShadow.mensagem.includes("https://meli.afiliado/d1-oficial"));
assert.ok(!mlConcorrenteAfiliadoD1.templateEspelhoShadow.mensagem.includes("mercadolivre.com.br/sec"));
assert.ok(!mlConcorrenteAfiliadoD1.templateEspelhoShadow.mensagem.includes("chat.whatsapp.com"));

const kabumAwinTerceiroSemConversao = criarEspelho({
  textoOriginal: [
    "Teclado KaBuM sem conversao",
    "Valor: R$ 199,00",
    "Link: https://awin1.com/cread.php?clickref=terceiro"
  ].join("\n"),
  oferta: { marketplace: "kabum", preco: 199, linkAfiliado: "" },
  comercialNormalizado: { marketplace: "kabum", precoAtual: 199, precoConfiavel: true }
});
assert.strictEqual(blocosTipo(kabumAwinTerceiroSemConversao, "link_afiliado").length, 0);
assert.strictEqual(blocosTipo(kabumAwinTerceiroSemConversao, "link_produto_original").length, 0);
assert.ok(!kabumAwinTerceiroSemConversao.templateEspelhoShadow.mensagem.includes("awin1.com/cread.php"));

const aliexpressAppPcMoedasConvertidos = criarEspelho({
  textoOriginal: [
    "SSD AliExpress",
    "Por US$ 19.99",
    "Cupom: ALI5",
    "Link com moedas: https://a.aliexpress.com/_moedasSeguro",
    "APP: https://a.aliexpress.com/_appSeguro",
    "PC: https://a.aliexpress.com/_pcSeguro"
  ].join("\n"),
  oferta: {
    marketplace: "aliexpress",
    preco: 19.99,
    moeda: "USD",
    linksProduto: [
      { tipo: "link_moedas", url: "https://a.aliexpress.com/_moedasSeguro", urlAfiliada: "https://ali.workspace/moedas", convertidoWorkspace: true },
      { tipo: "link_app", url: "https://a.aliexpress.com/_appSeguro", urlAfiliada: "https://ali.workspace/app", convertidoWorkspace: true },
      { tipo: "link_pc", url: "https://a.aliexpress.com/_pcSeguro", urlAfiliada: "https://ali.workspace/pc", convertidoWorkspace: true }
    ]
  },
  comercialNormalizado: { marketplace: "aliexpress", precoAtual: 19.99, moeda: "USD", precoConfiavel: false }
});
assertBloco(aliexpressAppPcMoedasConvertidos, "link_moedas");
assertBloco(aliexpressAppPcMoedasConvertidos, "link_app");
assertBloco(aliexpressAppPcMoedasConvertidos, "link_pc");
const templateAliConvertidosV26 = montarTemplateEspelhoPorBlocosV26(
  aliexpressAppPcMoedasConvertidos.espelhoComercial,
  aliexpressAppPcMoedasConvertidos.documentoComercialCanonico
);
assert.ok(templateAliConvertidosV26.mensagem.includes("Link com moedas:\nhttps://ali.workspace/moedas"));
assert.ok(templateAliConvertidosV26.mensagem.includes("APP:\nhttps://ali.workspace/app"));
assert.ok(templateAliConvertidosV26.mensagem.includes("PC:\nhttps://ali.workspace/pc"));
assert.ok(!templateAliConvertidosV26.mensagem.includes("https://a.aliexpress.com/_appSeguro"));

const aliexpressAppRepetidoPcMoedasExternos = criarEspelho({
  textoOriginal: [
    "AliExpress externo",
    "Por R$ 90",
    "APP: https://a.aliexpress.com/_dupExterno",
    "APP: https://a.aliexpress.com/_dupExterno",
    "NO PC: https://s.click.aliexpress.com/e/_pcExterno",
    "Link com moedas: https://a.aliexpress.com/_coinsExterno"
  ].join("\n"),
  oferta: { marketplace: "aliexpress", preco: 90, linkAfiliado: "https://ali.workspace/cta-unico" },
  comercialNormalizado: { marketplace: "aliexpress", precoAtual: 90, precoConfiavel: true }
});
assert.strictEqual(aliexpressAppRepetidoPcMoedasExternos.documentoComercialCanonico.linksComerciais.filter(item => item.tipo === "app").length, 1);
assert.strictEqual(aliexpressAppRepetidoPcMoedasExternos.documentoComercialCanonico.linksComerciais.filter(item => item.tipo === "pc").length, 1);
assert.strictEqual(aliexpressAppRepetidoPcMoedasExternos.documentoComercialCanonico.linksComerciais.filter(item => item.tipo === "moedas").length, 1);
assert.ok(aliexpressAppRepetidoPcMoedasExternos.documentoComercialCanonico.linksComerciais.every(item => item.renderizavel === false));
assertBloco(aliexpressAppRepetidoPcMoedasExternos, "link_afiliado");
assert.ok(!aliexpressAppRepetidoPcMoedasExternos.templateEspelhoShadow.mensagem.includes("s.click.aliexpress.com/e/_pcExterno"));
assert.ok(!tiposV26(aliexpressAppRepetidoPcMoedasExternos).includes("link_resgate"));

const aliexpressDoisProdutosDistintos = criarEspelho({
  textoOriginal: [
    "AliExpress misturado",
    "Por R$ 120",
    "Link produto: https://www.aliexpress.com/item/1005001111111111.html",
    "Link produto: https://www.aliexpress.com/item/1005002222222222.html"
  ].join("\n"),
  oferta: { marketplace: "aliexpress", preco: 120, linkAfiliado: "https://ali.workspace/produto" },
  comercialNormalizado: { marketplace: "aliexpress", precoAtual: 120, precoConfiavel: true }
});
assert.ok(aliexpressDoisProdutosDistintos.documentoComercialCanonico.avisos.includes("links_produto_ambiguos"));

const aliexpressVariacoesPreco = criarEspelho({
  textoOriginal: [
    "SSD AliExpress com variacoes",
    "250 GB por R$ 89,90",
    "500 GB por R$ 139,90",
    "Cupom: ALI5",
    "Link: https://www.aliexpress.com/item/1005003333333333.html"
  ].join("\n"),
  oferta: { marketplace: "aliexpress", preco: 89.9, linkAfiliado: "https://ali.workspace/variacao" },
  comercialNormalizado: { marketplace: "aliexpress", precoAtual: 89.9, precoConfiavel: true }
});
assertBloco(aliexpressVariacoesPreco, "link_afiliado");
assert.ok(!aliexpressVariacoesPreco.documentoComercialCanonico.precoPorTexto || !aliexpressVariacoesPreco.documentoComercialCanonico.precoPorTexto.includes("139,90"), "variacoes nao escolhem segundo preco silenciosamente");

const aliexpressSemImagemCirculavel = criarEspelho({
  textoOriginal: "Produto AliExpress sem imagem\nPor R$ 55,00\nLink: https://www.aliexpress.com/item/1005004444444444.html",
  oferta: { marketplace: "aliexpress", preco: 55, imagem: "", linkAfiliado: "https://ali.workspace/sem-imagem" },
  comercialNormalizado: { marketplace: "aliexpress", precoAtual: 55, precoConfiavel: true }
});
assertBloco(aliexpressSemImagemCirculavel, "link_afiliado");
assert.ok(!aliexpressSemImagemCirculavel.documentoComercialCanonico.avisos.includes("imagem_ausente"));

const kabumAwinTerceiroComUedReconvertido = criarEspelho({
  textoOriginal: [
    "Fonte KaBuM AWIN",
    "Valor: R$ 415,00",
    "Link: https://www.awin1.com/cread.php?awinaffid=999&clickref=terceiro&ued=https%3A%2F%2Fwww.kabum.com.br%2Fproduto%2F514896%2Ffonte",
    "Garantia de 10 anos",
    "Frete varia por estado"
  ].join("\n"),
  oferta: { marketplace: "kabum", preco: 415, linkAfiliado: "https://awin.workspace/deeplink-514896" },
  comercialNormalizado: { marketplace: "kabum", precoAtual: 415, precoConfiavel: true }
});
assertBloco(kabumAwinTerceiroComUedReconvertido, "link_afiliado");
assertBloco(kabumAwinTerceiroComUedReconvertido, "garantia");
assertBloco(kabumAwinTerceiroComUedReconvertido, "frete");
assert.ok(kabumAwinTerceiroComUedReconvertido.templateEspelhoShadow.mensagem.includes("https://awin.workspace/deeplink-514896"));
assert.ok(!kabumAwinTerceiroComUedReconvertido.templateEspelhoShadow.mensagem.includes("awinaffid=999"));

const kabumPreVendaPrazo = criarEspelho({
  textoOriginal: [
    "Console KaBuM",
    "Valor: R$ 2.999,00",
    "Pre-venda",
    "Envio a partir de 15/08",
    "https://www.kabum.com.br/produto/777777/console"
  ].join("\n"),
  oferta: { marketplace: "kabum", preco: 2999, linkAfiliado: "https://awin.workspace/console" },
  comercialNormalizado: { marketplace: "kabum", precoAtual: 2999, precoConfiavel: true }
});
assertBloco(kabumPreVendaPrazo, "pre_venda");
assertBloco(kabumPreVendaPrazo, "prazo_envio");

const kabumDiretoConvertido = criarEspelho({
  textoOriginal: "Mouse KaBuM\nValor: R$ 99,00\nhttps://www.kabum.com.br/produto/888888/mouse",
  oferta: { marketplace: "kabum", preco: 99, linkAfiliado: "https://awin.workspace/mouse" },
  comercialNormalizado: { marketplace: "kabum", precoAtual: 99, precoConfiavel: true }
});
assertBloco(kabumDiretoConvertido, "link_afiliado");
assert.ok(!kabumDiretoConvertido.templateEspelhoShadow.mensagem.includes("www.kabum.com.br/produto/888888"));

const contratoDesconhecidoSemCtaSeguro = criarEspelho({
  textoOriginal: [
    "Marketplace novo",
    "Por R$ 50,00",
    "Link: https://marketplace-terceiro.example/produto"
  ].join("\n"),
  oferta: { marketplace: "marketplace_novo", preco: 50, linkAfiliado: "" },
  comercialNormalizado: { marketplace: "marketplace_novo", precoAtual: 50, precoConfiavel: true }
});
assert.strictEqual(contratoDesconhecidoSemCtaSeguro.documentoComercialCanonico.contratoMarketplace.modoFielSeguro, true);
assert.strictEqual(blocosTipo(contratoDesconhecidoSemCtaSeguro, "link_afiliado").length, 0);
assert.ok(!contratoDesconhecidoSemCtaSeguro.templateEspelhoShadow.mensagem.includes("marketplace-terceiro.example"));

const mlHaizPrecoEstruturado = criarEspelho({
  textoOriginal: [
    "Monitor Gamer Haiz 25'' Ips Fhd 144hz 0.5ms Hdmi Dp Vesa Preto 127/220v",
    "Cupom: CORREAQUIHJ",
    "Aplique o cupom CORREAQUIHJ para obter o desconto.",
    "Link do produto: https://produto.mercadolivre.com.br/MLB-1825349418-monitor-gamer-brazil-pc-g-m24wkn-238-curvo-full-hd-_JM"
  ].join("\n"),
  oferta: {
    marketplace: "mercadolivre",
    preco: 497,
    precoAtual: "497.00",
    cupom: "CORREAQUIHJ",
    linkAfiliado: "https://meli.la/3252Ddb",
    categoria: "Perifericos"
  },
  comercialNormalizado: { marketplace: "mercadolivre", precoAtual: 497, precoConfiavel: true }
});
assert.strictEqual(mlHaizPrecoEstruturado.documentoComercialCanonico.precoPorTexto, "R$ 497,00");
assertBloco(mlHaizPrecoEstruturado, "preco_oferta");
assert.ok(mlHaizPrecoEstruturado.templateEspelhoShadow.mensagem.includes("Por: R$ 497,00"));

const mlOrganizadorPrecoEstruturado = criarEspelho({
  textoOriginal: [
    "Organizador De Fios E Cabos Baixo Mesa Oculto - 0,5 Mt C/nfe Preto",
    "Cupom: PIPOCA",
    "Link do produto: https://produto.mercadolivre.com.br/MLB-111111111-organizador-de-fios"
  ].join("\n"),
  oferta: {
    marketplace: "mercadolivre",
    preco: "51.00",
    precoAtual: "51.00",
    cupom: "PIPOCA",
    beneficioTexto: "Aplique o cupom PIPOCA antes de finalizar.",
    linkAfiliado: "https://meli.la/1C6faZN",
    categoria: "Casa, Moveis e Decoracao"
  },
  comercialNormalizado: { marketplace: "mercadolivre", precoAtual: 51, precoConfiavel: true }
});
assert.strictEqual(mlOrganizadorPrecoEstruturado.documentoComercialCanonico.precoPorTexto, "R$ 51,00");
assertBloco(mlOrganizadorPrecoEstruturado, "preco_oferta");
assert.strictEqual(blocosTipo(mlOrganizadorPrecoEstruturado, "beneficio").length, 0);
assert.ok(mlOrganizadorPrecoEstruturado.templateEspelhoShadow.mensagem.includes("Por: R$ 51,00"));
assert.strictEqual((mlOrganizadorPrecoEstruturado.templateEspelhoShadow.mensagem.match(/Aplique o cupom PIPOCA/g) || []).length, 1);
assert.ok(!mlOrganizadorPrecoEstruturado.templateEspelhoShadow.mensagem.includes("🎁"));

const mlCuecasCupomBeneficioDuplicado = criarEspelho({
  textoOriginal: [
    "Kit 10 Cuecas Polo Wear",
    "Cupom: FASHIONML",
    "Link do produto: https://produto.mercadolivre.com.br/MLB-222222222-kit-cuecas"
  ].join("\n"),
  oferta: {
    marketplace: "mercadolivre",
    preco: 73.79,
    precoAtual: 73.79,
    cupom: "FASHIONML",
    beneficioTexto: "Aplique o cupom FASHIONML antes de finalizar.",
    linkAfiliado: "https://meli.la/fashionml"
  },
  comercialNormalizado: { marketplace: "mercadolivre", precoAtual: 73.79, precoConfiavel: true }
});
assert.strictEqual((mlCuecasCupomBeneficioDuplicado.templateEspelhoShadow.mensagem.match(/Aplique o cupom FASHIONML/g) || []).length, 1);
assert.strictEqual(blocosTipo(mlCuecasCupomBeneficioDuplicado, "beneficio").length, 0);

const tituloSmartTvShopee = "Smart Tv Hq Qled 50 Polegadas";
const smartTvShopeeCloneSemantico = criarEspelho({
  textoOriginal: [
    tituloSmartTvShopee,
    "Por: R$ 1.442,00",
    "Cupom: F3L1Z200",
    "Frete gratis",
    "https://s.shopee.com.br/smart-tv"
  ].join("\n"),
  oferta: {
    titulo: tituloSmartTvShopee,
    marketplace: "shopee",
    categoria: "Audio TV",
    preco: 1442,
    precoAtual: 1442,
    cupom: "F3L1Z200",
    freteGratis: true,
    beneficioTexto: tituloSmartTvShopee,
    avaliacao: tituloSmartTvShopee,
    linkAfiliado: "https://shopee.afiliado/smart-tv"
  },
  ofertaEntrada: {
    beneficioTexto: tituloSmartTvShopee,
    beneficios: [tituloSmartTvShopee],
    avaliacao: tituloSmartTvShopee
  },
  comercialNormalizado: { marketplace: "shopee", precoAtual: 1442, precoConfiavel: true }
});
const mensagemSmartTv = smartTvShopeeCloneSemantico.templateEspelhoShadow.mensagem;
assert.strictEqual(smartTvShopeeCloneSemantico.documentoComercialCanonico.beneficioTexto, null);
assert.strictEqual(blocosTipo(smartTvShopeeCloneSemantico, "beneficio").length, 0);
assert.strictEqual(blocosTipo(smartTvShopeeCloneSemantico, "avaliacao_nota").length, 0);
assert.strictEqual(blocosTipo(smartTvShopeeCloneSemantico, "avaliacao_quantidade").length, 0);
assert.ok(mensagemSmartTv.includes(tituloSmartTvShopee));
assert.strictEqual(mensagemSmartTv.split(tituloSmartTvShopee).length - 1, 1, "titulo nao vaza como beneficio/prova social");
assert.ok(mensagemSmartTv.includes("Shopee"));
assert.strictEqual(blocoTipo(smartTvShopeeCloneSemantico, "categoria").textoOriginal, "Audio TV");
assert.ok(mensagemSmartTv.includes("Por: R$ 1.442,00"));
assert.ok(mensagemSmartTv.includes("Cupom: F3L1Z200"));
assert.ok(/Frete gratis/i.test(mensagemSmartTv));
assert.ok(mensagemSmartTv.includes("Confira aqui:"));
assert.ok(!mensagemSmartTv.includes(`⭐ ${tituloSmartTvShopee}`));
assert.ok(!mensagemSmartTv.includes(`🎁 ${tituloSmartTvShopee}`));

const mlCupomCashbackReal = criarEspelho({
  textoOriginal: [
    "Produto com Cashback",
    "Cupom: CASH20",
    "Link do produto: https://produto.mercadolivre.com.br/MLB-333333333-produto-cashback"
  ].join("\n"),
  oferta: {
    marketplace: "mercadolivre",
    preco: 120,
    precoAtual: 120,
    cupom: "CASH20",
    cashback: "Cashback de R$ 20.",
    linkAfiliado: "https://meli.la/cash20"
  },
  comercialNormalizado: { marketplace: "mercadolivre", precoAtual: 120, precoConfiavel: true }
});
assertBloco(mlCupomCashbackReal, "instrucao_cupom");
assertBloco(mlCupomCashbackReal, "cashback");
assert.ok(mlCupomCashbackReal.templateEspelhoShadow.mensagem.includes("Cashback"));

const mlCupomFreteReal = criarEspelho({
  textoOriginal: [
    "Produto com Frete",
    "Cupom: FRETE10",
    "Link do produto: https://produto.mercadolivre.com.br/MLB-444444444-produto-frete"
  ].join("\n"),
  oferta: {
    marketplace: "mercadolivre",
    preco: 89.9,
    precoAtual: 89.9,
    cupom: "FRETE10",
    frete: "Frete gratis",
    linkAfiliado: "https://meli.la/frete10"
  },
  comercialNormalizado: { marketplace: "mercadolivre", precoAtual: 89.9, precoConfiavel: true }
});
assertBloco(mlCupomFreteReal, "instrucao_cupom");
assertBloco(mlCupomFreteReal, "frete");
assert.ok(mlCupomFreteReal.templateEspelhoShadow.mensagem.includes("Frete"));

const mlCupomBeneficioDiferente = criarEspelho({
  textoOriginal: [
    "Produto com Brinde",
    "Cupom: BRINDE10",
    "Link do produto: https://produto.mercadolivre.com.br/MLB-555555555-produto-brinde"
  ].join("\n"),
  oferta: {
    marketplace: "mercadolivre",
    preco: 199,
    precoAtual: 199,
    cupom: "BRINDE10",
    beneficioTexto: "Brinde exclusivo na compra.",
    linkAfiliado: "https://meli.la/brinde10"
  },
  comercialNormalizado: { marketplace: "mercadolivre", precoAtual: 199, precoConfiavel: true }
});
assertBloco(mlCupomBeneficioDiferente, "instrucao_cupom");
assertBloco(mlCupomBeneficioDiferente, "beneficio");
assert.ok(mlCupomBeneficioDiferente.templateEspelhoShadow.mensagem.includes("Brinde exclusivo"));

const aliexpressHigieneTecnicaAppPc = criarEspelho({
  textoOriginal: [
    "Headset AliExpress",
    "Por R$ 112,00",
    "Link APP: https://a.aliexpress.com/_appSemConversao",
    "Link PC: https://a.aliexpress.com/_pcConvertido"
  ].join("\n"),
  oferta: {
    marketplace: "aliexpress",
    preco: 112,
    beneficioTexto: "Erro ao consultar API AliExpress",
    avisoCupom: "link_aliexpress_sem_conversao_segura",
    linksProduto: [
      {
        tipo: "link_app",
        url: "https://a.aliexpress.com/_appSemConversao",
        renderizavel: false,
        motivo: "link_aliexpress_sem_conversao_segura"
      },
      {
        tipo: "link_pc",
        url: "https://a.aliexpress.com/_pcConvertido",
        urlAfiliada: "https://s.click.aliexpress.com/e/_pcD1Seguro",
        convertidoWorkspace: true,
        renderizavel: true
      }
    ]
  },
  comercialNormalizado: { marketplace: "aliexpress", precoAtual: 112, precoConfiavel: true }
});
const mensagemHigieneTecnica = aliexpressHigieneTecnicaAppPc.templateEspelhoShadow.mensagem;
assert.ok(mensagemHigieneTecnica.includes("PC:\nhttps://s.click.aliexpress.com/e/_pcD1Seguro"));
assert.ok(!mensagemHigieneTecnica.includes("Confira aqui:\nhttps://s.click.aliexpress.com/e/_pcD1Seguro"));
assert.ok(!mensagemHigieneTecnica.includes("APP:\nhttps://a.aliexpress.com/_appSemConversao"));
assert.ok(!/Erro ao consultar API AliExpress|link_aliexpress_sem_conversao_segura|sem_conversao_segura/.test(mensagemHigieneTecnica));
assert.strictEqual(blocosTipo(aliexpressHigieneTecnicaAppPc, "beneficio").length, 0);

for (const resultado of [
  mlHaizPrecoEstruturado,
  mlOrganizadorPrecoEstruturado,
  mlCuecasCupomBeneficioDuplicado,
  smartTvShopeeCloneSemantico,
  mlCupomCashbackReal,
  mlCupomFreteReal,
  mlCupomBeneficioDiferente,
  aliexpressHigieneTecnicaAppPc
]) {
  assert.ok(!/(?:null|undefined|NaN)/i.test(resultado.templateEspelhoShadow.mensagem));
}

const aliexpressCategoriaFinalSemGenerica = criarEspelho({
  textoOriginal: [
    "WiFi 6E AX210 PCI Express + Bluetooth 5.3",
    "Valor: R$ 293",
    "PC: https://a.aliexpress.com/_pcWifi"
  ].join("\n"),
  oferta: {
    marketplace: "aliexpress",
    categoria: "Eletrônicos",
    preco: 293,
    linksComerciais: [
      {
        papel: "link_pc",
        urlOriginal: "https://a.aliexpress.com/_pcWifi",
        urlAfiliada: "https://s.click.aliexpress.com/e/_pcWifiD1",
        renderizavel: true,
        convertidoWorkspace: true,
        seguro: true
      }
    ]
  },
  ofertaEntrada: { categoria: "AliExpress" },
  comercialNormalizado: { marketplace: "aliexpress", precoAtual: 293, precoConfiavel: true, categoria: "AliExpress" }
});
const mensagemCategoriaFinal = aliexpressCategoriaFinalSemGenerica.templateEspelhoShadow.mensagem;
const blocoCategoriaFinal = blocosTipo(aliexpressCategoriaFinalSemGenerica, "categoria")[0];
assert.strictEqual(blocoCategoriaFinal?.textoOriginal, "Eletrônicos");
assert.notStrictEqual(blocoCategoriaFinal?.textoOriginal, "AliExpress");
assert.ok(mensagemCategoriaFinal.includes("PC:\nhttps://s.click.aliexpress.com/e/_pcWifiD1"));
assert.ok(!mensagemCategoriaFinal.includes("Confira aqui:\nhttps://s.click.aliexpress.com/e/_pcWifiD1"));
const aliexpressCuponsMoedasAppPcConvertidos = criarEspelho({
  textoOriginal: [
    "SSD Netac 512gb sata3",
    "512GB por R$ 354,74 (68 moedas)",
    "Cupom: BRAE2 ou IFP6FAD6 ou IFPVOILF",
    "Link APP: https://a.aliexpress.com/_appNetac",
    "Link PC: https://a.aliexpress.com/_pcNetac"
  ].join("\n"),
  oferta: {
    marketplace: "aliexpress",
    preco: 354.74,
    linksComerciais: [
      {
        papel: "link_app",
        urlOriginal: "https://a.aliexpress.com/_appNetac",
        urlAfiliada: "https://s.click.aliexpress.com/e/_appNetacD1",
        renderizavel: true,
        convertidoWorkspace: true,
        seguro: true
      },
      {
        papel: "link_pc",
        urlOriginal: "https://a.aliexpress.com/_pcNetac",
        urlAfiliada: "https://s.click.aliexpress.com/e/_pcNetacD1",
        renderizavel: true,
        convertidoWorkspace: true,
        seguro: true
      }
    ]
  },
  comercialNormalizado: { marketplace: "aliexpress", precoAtual: 354.74, precoConfiavel: true }
});
const templateAliCuponsMoedas = montarTemplateEspelhoPorBlocosV26(
  aliexpressCuponsMoedasAppPcConvertidos.espelhoComercial,
  aliexpressCuponsMoedasAppPcConvertidos.documentoComercialCanonico
);
assert.ok(templateAliCuponsMoedas.mensagem.includes("Cupons: BRAE2 • IFP6FAD6 • IFPVOILF"));
assert.ok(templateAliCuponsMoedas.mensagem.includes("APP: +68 moedas"));
assert.ok(templateAliCuponsMoedas.mensagem.includes("Aplique um dos cupons acima"), "AliExpress nao usa primeiro cupom como CTA");
assert.ok(!templateAliCuponsMoedas.mensagem.includes("Aplique o cupom BRAE2"), "AliExpress nao renderiza cupom literal como frase");
assert.ok(templateAliCuponsMoedas.mensagem.includes("APP:\nhttps://s.click.aliexpress.com/e/_appNetacD1"));
assert.ok(templateAliCuponsMoedas.mensagem.includes("PC:\nhttps://s.click.aliexpress.com/e/_pcNetacD1"));
assert.ok(!templateAliCuponsMoedas.mensagem.includes("https://a.aliexpress.com/_appNetac"));
assert.ok(!templateAliCuponsMoedas.mensagem.includes("https://a.aliexpress.com/_pcNetac"));
assert.ok(!/Erro ao consultar API AliExpress|link_aliexpress_sem_conversao_segura|falha_tecnica_conversao_link/.test(templateAliCuponsMoedas.mensagem));
assert.deepStrictEqual(
  aliexpressCuponsMoedasAppPcConvertidos.documentoComercialCanonico.linksComerciais.map(item => item.tipo),
  ["app", "pc"]
);
const aliexpressCuponsMoedasSemContaminarCupom = criarEspelho({
  textoOriginal: [
    "Fone AliExpress",
    "Por: R$ 89,90",
    "Cupom: IFPC5HAQ ou IFPRWL57 ou 732MOEDAS",
    "732 moedas no APP",
    "Link PC: https://a.aliexpress.com/_pcFone"
  ].join("\n"),
  oferta: {
    marketplace: "aliexpress",
    preco: 89.9,
    linksComerciais: [
      {
        papel: "link_pc",
        urlOriginal: "https://a.aliexpress.com/_pcFone",
        urlAfiliada: "https://s.click.aliexpress.com/e/_pcFoneD1",
        renderizavel: true,
        convertidoWorkspace: true,
        seguro: true
      }
    ]
  },
  comercialNormalizado: { marketplace: "aliexpress", precoAtual: 89.9, precoConfiavel: true }
});
const templateAliSomentePc = montarTemplateEspelhoPorBlocosV26(
  aliexpressCuponsMoedasSemContaminarCupom.espelhoComercial,
  aliexpressCuponsMoedasSemContaminarCupom.documentoComercialCanonico
);
assert.ok(templateAliSomentePc.mensagem.includes("Cupons: IFPC5HAQ"), "AliExpress varios cupons renderiza bloco de cupons");
assert.ok(templateAliSomentePc.mensagem.includes("IFPRWL57"), "AliExpress preserva segundo cupom");
assert.ok(templateAliSomentePc.mensagem.includes("APP: +732 moedas"), "AliExpress moedas segue como beneficio separado");
assert.ok(templateAliSomentePc.mensagem.includes("Aplique um dos cupons acima"), "AliExpress cupom contaminado ainda usa CTA seguro");
assert.ok(templateAliSomentePc.mensagem.includes("PC:\nhttps://s.click.aliexpress.com/e/_pcFoneD1"), "AliExpress somente PC renderiza link convertido");
assert.ok(!templateAliSomentePc.mensagem.includes("732MOEDAS"), "AliExpress nao renderiza moedas como cupom");
assert.ok(!templateAliSomentePc.mensagem.includes("https://a.aliexpress.com/_pcFone"), "AliExpress nao renderiza link original inseguro");
const resumoV26 = mlCompleto.documentoComercialCanonico.blocos.reduce((acc, bloco) => {
  acc[bloco.tipo] = (acc[bloco.tipo] || 0) + 1;
  return acc;
}, {});
assert.ok(resumoV26.preco_oferta >= 1);
assert.ok(!JSON.stringify(resumoEspelhoComercialLog(mlCompleto, { workspaceId: "user_teste" })).includes("https://"), "log legado continua sanitizado");

console.log("ofc-v24-espelho-comercial.test.js ok");
