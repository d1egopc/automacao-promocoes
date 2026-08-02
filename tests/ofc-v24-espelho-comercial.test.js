"use strict";

const assert = require("assert");
const {
  construirEspelhoComercialV24,
  construirEspelhoComercialV24FailOpen,
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
assert.ok(mlCompleto.templateEspelhoShadow.mensagem.includes("Por: R$ 73,79 via Pix"));
assert.ok(mlCompleto.templateEspelhoShadow.mensagem.includes("Confira aqui:\nhttps://afiliado.test/produto"));
assert.ok(!mlCompleto.templateEspelhoShadow.mensagem.includes("120,50"), "preco da pagina nao substitui captura");

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

const kabumSimples = criarEspelho({
  textoOriginal: "Fonte XPG Core Reactor\nValor: R$ 415,00\nCupom: JULHOFORTE15\nFrete varia por Estado\nhttps://awin1.com/cread.php",
  oferta: { marketplace: "kabum", preco: 415, linkAfiliado: "https://awin1.com/afiliado" }
});
assert.strictEqual(kabumSimples.espelhoComercial.precoPorValor, 415);
assert.strictEqual(kabumSimples.espelhoComercial.cupomCodigo, "JULHOFORTE15");
assert.ok(kabumSimples.espelhoComercial.condicoesComerciais.some(item => /frete/i.test(item)));
assert.strictEqual(kabumSimples.documentoComercialCanonico.freteTexto, "Frete varia por Estado");

const semCupom = criarEspelho({
  textoOriginal: "Oferta minima\nPor R$ 79,90\nhttps://produto.test/1",
  oferta: { preco: 79.9 }
});
assert.strictEqual(semCupom.espelhoComercial.cupomCodigo, null);
assert.ok(!semCupom.templateEspelhoShadow.mensagem.includes("Cupom:"));

const cashback = criarEspelho({
  textoOriginal: "Produto com cashback\nPor R$ 100,00\nR$ 10 de cashback\nhttps://produto.test/2",
  oferta: { preco: 100, cashback: "R$ 10 de cashback" }
});
assert.strictEqual(cashback.espelhoComercial.precoPorValor, 100);
assert.strictEqual(cashback.espelhoComercial.precoFinalValor, null, "cashback nao reduz preco pago nem cria preco final");
assert.ok(cashback.espelhoComercial.condicoesComerciais.some(item => /cashback/i.test(item)));
assert.ok(cashback.templateEspelhoShadow.mensagem.includes("Cashback: R$ 10 de cashback"));
assert.ok(!cashback.templateEspelhoShadow.mensagem.includes("R$ 90"), "cashback nao e abatido do preco pago");

const parcelamento = criarEspelho({
  textoOriginal: "Produto parcelado\nDe R$ 499 por R$ 205 no Pix ou R$ 215,83 em ate 6x\nCupom: FASHION ou MODACOMVC\nhttps://meli.la/produto",
  oferta: { preco: 300 },
  ofertaEntrada: { parcelamento: "R$ 215,83 em ate 6x" }
});
assert.strictEqual(parcelamento.espelhoComercial.precoDeValor, 499);
assert.strictEqual(parcelamento.espelhoComercial.precoPorValor, 205);
assert.strictEqual(parcelamento.espelhoComercial.cupomCodigo, "FASHION ou MODACOMVC");
assert.ok(parcelamento.espelhoComercial.condicoesComerciais.some(item => /6x/.test(item)));

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

console.log("ofc-v24-espelho-comercial.test.js ok");
