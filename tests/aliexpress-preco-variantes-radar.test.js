"use strict";

const assert = require("node:assert/strict");
const { importarAliExpressEngine } = require("../modules/engine/importer/adapters/aliexpress.adapter");

const credenciais = { appKey: "fixture_key", secret: "fixture_secret", trackingId: "fixture_tracking" };
const job = { id: 165001, evento_id: 165001, cliente_id: "fixture_workspace", marketplace: "aliexpress" };
const links = [{ url_original: "https://a.aliexpress.com/_fixtureGudga", metadata: { papelLink: "link_app" } }];

async function executar(texto, precoEstruturado) {
  let chamadasImportador = 0;
  const resultado = await importarAliExpressEngine({
    job,
    evento: { texto_original: texto, metadata: { radarMirror: { preco: { atualCapturado: precoEstruturado } } } },
    links,
    deps: {
      getIntegracaoCliente: () => ({ credenciais }),
      importarAliExpress: async () => { chamadasImportador += 1; return { ok: false, motivo: "fixture_importador" }; }
    }
  });
  return { resultado, chamadasImportador };
}

async function main() {
  const gudga = await executar([
    "Memória Ram Gudga White DDR4 8GB",
    "As memórias ram aumentaram, e talvez só tenha 2x8 por R$ 600 no 11.11",
    "R$ 283 - 2666mhz",
    "Cupom: resgate os cupons da loja + IFPIGKJ2 ou IFPGCGBG + 584 moedas no APP",
    "R$ 315 - 3200mhz",
    "Cupom: resgate os cupons da loja + IFPIGKJ2 ou IFPGCGBG + 644 moedas no APP"
  ].join("\n"), 600);
  assert.equal(gudga.resultado.ok, false);
  assert.equal(gudga.resultado.motivo, "preco_variantes_ambiguas");
  assert.equal(gudga.chamadasImportador, 0, "não converter nem publicar preço ambíguo");

  const casosPermitidos = [
    ["preço único", "Oferta R$ 294", 294],
    ["DE/POR", "De R$ 399\nPor R$ 294", 294],
    ["cupom e moedas", "Oferta R$ 294\nCupom: IFPIGKJ2 + 706 moedas no APP", 294],
    ["variante única", "Memória Ram JUHOR Black DDR4 8GB 3200MHz\nR$ 294 - 8GB", 294]
  ];
  for (const [nome, texto, preco] of casosPermitidos) {
    const caso = await executar(texto, preco);
    assert.equal(caso.resultado.motivo, "fixture_importador", `${nome} mantém o caminho existente`);
    assert.equal(caso.chamadasImportador, 1, `${nome} chega ao importador`);
  }

  console.log("aliexpress-preco-variantes-radar: PASS");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
