"use strict";

const assert = require("assert");
const { gerarPreviewCaptureManualV2 } = require("../modules/manual-v2/manual-capture.service");

process.env.JWT_SECRET = process.env.JWT_SECRET || "manual-magalu-query-test-secret";

const urlComSeller = "https://www.magazineluiza.com.br/escova-secadora/p/226803000/pf/esse/?seller_id=magazineluiza&utm_source=manual";
const urlSemQuery = "https://www.magazineluiza.com.br/escova-secadora/p/226803000/pf/esse/";

function entrada(url) {
  return {
    marketplace: "magalu",
    urlOriginal: url,
    titulo: "Escova Secadora Britania",
    precoAtual: 99.90,
    precoPix: 99.90,
    precoAnterior: "",
    produtoId: "226803000",
    sku: "226803000",
    seller: "Magalu",
    imagem: "https://a-static.mlcdn.com.br/produto.jpg",
    parcelamento: "2x de R$ 52,58 sem juros",
    cupom: ""
  };
}

function deps(promoterId = "d1egopc") {
  return {
    clienteId: "workspace-magalu",
    getIntegracaoCliente: () => ({ credenciais: { promoterId } })
  };
}

(async () => {
  for (const url of [urlComSeller, urlSemQuery]) {
    const resultado = await gerarPreviewCaptureManualV2(entrada(url), deps());
    assert.strictEqual(resultado.ok, true);
    assert.strictEqual(resultado.oferta.produtoId, "226803000");
    assert.strictEqual(resultado.oferta.afiliacaoWorkspaceVerificada.conversaoStatus, "convertida");
    assert.ok(resultado.oferta.urlAfiliada.includes("magazined1egopc"));
    assert.ok(resultado.oferta.urlAfiliada.includes("/p/226803000/"));
  }

  const workspaceB = await gerarPreviewCaptureManualV2(entrada(urlComSeller), deps("outroworkspace"));
  assert.ok(workspaceB.oferta.urlAfiliada.includes("magazineoutroworkspace"));
  assert.ok(!workspaceB.oferta.urlAfiliada.includes("magazined1egopc"));

  await assert.rejects(
    gerarPreviewCaptureManualV2({ ...entrada(urlComSeller), urlOriginal: `${urlComSeller}&promoter_id=5438968` }, deps()),
    erro => erro?.codigo === "conversao_afiliada_indisponivel"
  );

  console.log("manual-v2-magalu-query.test.js ok");
})().catch(erro => {
  console.error(erro);
  process.exit(1);
});
