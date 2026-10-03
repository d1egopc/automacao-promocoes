const assert = require("assert");

const capture = require("../optimus-capture/core/product-contract");
const { normalizarOfertaManualV2 } = require("../modules/manual-v2/manual-offers.contract");
const { gerarTemplateUniversal } = require("../modules/template-universal");
const { renderizarTemplatePersonalizado } = require("../modules/templates-clientes/renderer");
const { montarLinhaDesconto } = require("../utils/templates");

const baseCapture = {
  marketplace: "mercadolivre",
  urlOriginal: "https://produto.mercadolivre.com.br/MLB-123456-produto-_JM",
  titulo: "Produto de teste",
  precoAtual: 120,
  precoAnterior: 150
};

const semExplicito = capture.normalizarProdutoCapturado(baseCapture);
assert.strictEqual(semExplicito.descontoPercentual, null);
assert.strictEqual(semExplicito.descontoPercentualOrigem, "");

const legado = capture.normalizarProdutoCapturado({
  ...baseCapture,
  descontoPercentual: 20
});
assert.strictEqual(legado.descontoPercentual, null, "percentual sem origem nao e publicavel");

const marketplace = capture.normalizarProdutoCapturado({
  ...baseCapture,
  descontoPercentual: "20%",
  descontoPercentualOrigem: "marketplace"
});
assert.strictEqual(marketplace.descontoPercentual, 20);
assert.strictEqual(marketplace.descontoPercentualOrigem, "marketplace");
assert.deepStrictEqual(
  {
    descontoPercentual: capture.payloadPreview(marketplace).descontoPercentual,
    descontoPercentualOrigem: capture.payloadPreview(marketplace).descontoPercentualOrigem
  },
  { descontoPercentual: 20, descontoPercentualOrigem: "marketplace" }
);

const manual = normalizarOfertaManualV2({
  ...baseCapture,
  descontoPercentual: 17,
  descontoPercentualOrigem: "manual"
}, { clienteId: "cliente_teste", now: "2026-10-03T12:00:00.000Z", idFactory: () => "oferta_teste" });
assert.strictEqual(manual.descontoPercentual, "17");
assert.strictEqual(manual.descontoPercentualOrigem, "manual");

const manualLimpo = normalizarOfertaManualV2({
  ...baseCapture,
  descontoPercentual: "",
  descontoPercentualOrigem: "manual"
}, { clienteId: "cliente_teste", now: "2026-10-03T12:00:00.000Z", idFactory: () => "oferta_teste" });
assert.strictEqual(manualLimpo.descontoPercentual, "");
assert.strictEqual(manualLimpo.descontoPercentualOrigem, "");

const ofertaMensagem = {
  titulo: "Produto de teste",
  marketplace: "Mercado Livre",
  precoOriginal: 150,
  precoAtual: 120,
  linkAfiliado: "https://meli.la/teste"
};
assert.ok(!gerarTemplateUniversal(ofertaMensagem).includes("% OFF"), "template universal nao calcula OFF");
assert.ok(gerarTemplateUniversal({
  ...ofertaMensagem,
  descontoPercentual: 20,
  descontoPercentualOrigem: "marketplace"
}).includes("20% OFF"));
assert.ok(!gerarTemplateUniversal({
  ...ofertaMensagem,
  descontoPercentual: 20
}).includes("% OFF"), "registro antigo fica fail-closed");

const template = {
  id: "tpl_desconto_explicito",
  canais: ["whatsapp"],
  blocos: [{ tipo: "desconto_percentual", ativo: true, ordem: 10 }]
};
const customManual = renderizarTemplatePersonalizado({
  oferta: { ...ofertaMensagem, descontoPercentual: 17, descontoPercentualOrigem: "manual" },
  template,
  canal: "whatsapp"
});
assert.strictEqual(customManual.ok, true);
assert.ok(customManual.mensagem.includes("17% OFF"));

const customLegado = renderizarTemplatePersonalizado({
  oferta: { ...ofertaMensagem, descontoPercentual: 20 },
  template,
  canal: "whatsapp"
});
assert.strictEqual(customLegado.ok, true);
assert.ok(!customLegado.mensagem.includes("% OFF"));

assert.strictEqual(montarLinhaDesconto({ ...ofertaMensagem, descontoPercentual: 20 }), "");
assert.strictEqual(montarLinhaDesconto({
  ...ofertaMensagem,
  descontoPercentual: 20,
  descontoPercentualOrigem: "marketplace"
}), "20% OFF");

console.log("desconto-explicito-contract.test.js: PASS");
