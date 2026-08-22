const assert = require("assert");

const {
  avaliarGateQualidadeAliExpressImagem
} = require("../modules/engine/importer/importer.service");

function testarAliExpressSemImagemFicaRetida() {
  const resultado = avaliarGateQualidadeAliExpressImagem({
    marketplace: "aliexpress",
    imagem: ""
  });

  assert.strictEqual(resultado.retida, true);
  assert.strictEqual(resultado.status, "retida_v2");
  assert.strictEqual(resultado.motivo, "aliexpress_imagem_ausente");
  assert.strictEqual(resultado.reprocessavel, true);
}

function testarAliExpressComImagemValidaNaoFicaRetida() {
  const resultado = avaliarGateQualidadeAliExpressImagem({
    marketplace: "aliexpress",
    imagem: "https://ae01.alicdn.com/k/produto.jpg"
  });

  assert.deepStrictEqual(resultado, { retida: false, motivo: "" });
}

function testarAliExpressComImagemInvalidaFicaRetida() {
  const resultado = avaliarGateQualidadeAliExpressImagem({
    marketplace: "aliexpress",
    imagem: "data:image/png;base64,abc"
  });

  assert.strictEqual(resultado.retida, true);
  assert.strictEqual(resultado.motivo, "aliexpress_imagem_ausente");
}

function testarOutrosMarketplacesFicamIntocados() {
  for (const marketplace of ["mercadolivre", "amazon", "shopee", "kabum", "awin"]) {
    assert.deepStrictEqual(
      avaliarGateQualidadeAliExpressImagem({ marketplace, imagem: "" }),
      { retida: false, motivo: "" },
      marketplace
    );
  }
}

testarAliExpressSemImagemFicaRetida();
testarAliExpressComImagemValidaNaoFicaRetida();
testarAliExpressComImagemInvalidaFicaRetida();
testarOutrosMarketplacesFicamIntocados();

console.log("aliexpress-imagem-gate.test.js ok");
