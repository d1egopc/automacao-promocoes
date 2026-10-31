"use strict";

const assert = require("node:assert/strict");
const { classificarLinkEngine, escolherProdutoPrincipal } = require("../modules/engine/link-role.service");
const { importarAliExpressEngine } = require("../modules/engine/importer/adapters/aliexpress.adapter");

function linkRow(url) {
  return {
    url_original: url,
    url_normalizada: url,
    url_expandida: "",
    marketplace_detectado: "aliexpress",
    metadata: {}
  };
}

async function main() {
  const workspaceId = "workspace_shortlink_fixture";
  const url = "https://s.click.aliexpress.com/e/_Fixture123";
  const afiliado = "https://s.click.aliexpress.com/e/_WorkspaceFixture123";
  const credenciais = { appKey: "fixture_app", secret: "fixture_secret", trackingId: "fixture_track" };
  const metadataAfiliacao = {
    papelLink: "produto",
    afiliacaoWorkspace: {
      workspaceId,
      appKey: credenciais.appKey,
      trackingIdEnviado: credenciais.trackingId,
      origemConversao: "workspace_api",
      conversaoStatus: "convertida",
      urlAfiliadaWorkspace: afiliado,
      motivoConversao: "fixture_convertida"
    }
  };
  const evento = { texto_original: "Produto AliExpress\nPor R$ 39,90" };
  const link = linkRow(url);

  const papel = classificarLinkEngine({ marketplace: "aliexpress", evento, link });
  assert.equal(papel.papelLink, "produto");
  assert.equal(papel.motivo, "aliexpress_shortlink_requer_confirmacao_no_importador");
  assert.equal(papel.confianca, "media");

  for (const urlOficial of [
    "https://a.aliexpress.com/_Fixture123",
    "https://s.click.aliexpress.com/s/_Fixture123"
  ]) {
    assert.equal(
      classificarLinkEngine({ marketplace: "aliexpress", evento, url: urlOficial }).papelLink,
      "produto",
      `o formato oficial existente do importador permanece candidato: ${urlOficial}`
    );
  }
  const cupom = classificarLinkEngine({
    marketplace: "aliexpress",
    evento: { texto_original: `Cupom: ${url}` },
    url
  });
  assert.equal(cupom.papelLink, "cupom", "o contexto explícito de cupom mantém precedência sobre o shortlink");

  for (const urlNegativa of [
    "https://s.click.aliexpress.com/e/Campanha123",
    "https://s.click.aliexpress.com/e/_",
    "https://s.click.aliexpress.com.example.test/e/_Fixture123",
    "http://s.click.aliexpress.com/e/_Fixture123"
  ]) {
    assert.notEqual(
      classificarLinkEngine({ marketplace: "aliexpress", evento, url: urlNegativa }).papelLink,
      "produto",
      `URL fora do formato oficial não vira candidata de produto: ${urlNegativa}`
    );
  }

  const appShortlink = classificarLinkEngine({
    marketplace: "aliexpress", evento: { texto_original: `APP: https://a.aliexpress.com/_App123` },
    url: "https://a.aliexpress.com/_App123"
  });
  assert.equal(appShortlink.papelLink, "link_app", "o contexto APP existente mantém precedência");

  const escolhido = escolherProdutoPrincipal([{ url, link, campo: "url_original" }], "aliexpress", evento);
  assert.equal(escolhido.url, url);
  assert.equal(escolhido.papelLink, "produto");

  const chamadas = [];
  const resultado = await importarAliExpressEngine({
    job: { id: "shortlink-fixture", evento_id: 9001, cliente_id: workspaceId, marketplace: "aliexpress" },
    evento,
    links: [link],
    deps: {
      getIntegracaoCliente: () => ({ credenciais }),
      importarAliExpress: async (urlImportada, config = {}) => {
        chamadas.push({ url: urlImportada, papel: config.contextoEngine?.papelLink });
        return {
          marketplace: "aliexpress",
          titulo: "Produto AliExpress confirmado pela fixture",
          productId: "1005001234567890",
          precoAtual: "39.90",
          precoOriginal: "59.90",
          linkOriginal: "https://www.aliexpress.com/item/1005001234567890.html",
          linkExpandido: "https://www.aliexpress.com/item/1005001234567890.html",
          linkAfiliado: afiliado,
          imagem: "https://ae01.alicdn.com/kf/fixture.jpg",
          categoria: "Eletronicos",
          metadata: metadataAfiliacao
        };
      }
    }
  });

  assert.deepEqual(chamadas, [{ url, papel: "produto" }]);
  assert.equal(resultado.ok, true);
  assert.equal(resultado.produtoId, "1005001234567890");
  assert.equal(resultado.metadata.linkOriginalEngine, url);
  console.log("aliexpress-shortlink-radar-candidate.test.cjs OK");
}

main().catch(erro => {
  console.error(erro);
  process.exitCode = 1;
});
