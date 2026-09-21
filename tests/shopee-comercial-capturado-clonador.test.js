"use strict";

const assert = require("assert");
const { importarShopeeEngine } = require("../modules/engine/importer/adapters/shopee.adapter");

const URL_PRODUTO = "https://www.shopee.com.br/product/111111111/222222222";
const URL_AFILIADA = "https://s.shopee.com.br/afiliadoProduto";
const URL_RESGATE = "https://www.shopee.com.br/m/cupom-a";

function contratoClonador(overrides = {}) {
  return {
    versao: "clonador_comercial_capturado_v1",
    origem: "clonador_grupos",
    precoAtual: 439.99,
    precoAnterior: 709.66,
    cupom: "CLONE10",
    beneficioTexto: "Resgate o beneficio",
    ...overrides
  };
}

function depsFixture(precoPagina = "") {
  return {
    getIntegracaoCliente: () => ({ credenciais: { appId: "app", secret: "secret" } }),
    importarShopee: async () => ({
      ok: true,
      titulo: "Produto Shopee do Clonador",
      precoAtual: precoPagina,
      preco: precoPagina,
      imagem: "https://cf.shopee.com.br/file/produto.jpg",
      imagemOrigem: "api_productOfferV2.imageUrl",
      linkOriginal: URL_PRODUTO,
      linkExpandido: URL_PRODUTO,
      linkAfiliado: URL_AFILIADA,
      linkFinal: URL_AFILIADA,
      link: URL_AFILIADA,
      shopId: "111111111",
      itemId: "222222222",
      categoria: "Shopee"
    }),
    expandirShortlinkShopee: async () => `${URL_PRODUTO}?mmp_pid=an_app&utm_source=an_app`
  };
}

function entrada({ contrato = null, origem = "clonador_grupos", precoPagina = "", linksResgate = false, jobMetadata = {} } = {}) {
  const links = [{ url_original: URL_PRODUTO, url_expandida: URL_PRODUTO, ordemCaptura: 1, papelLink: "produto" }];
  if (linksResgate) {
    links.push({ url_original: URL_RESGATE, url_expandida: URL_RESGATE, ordemCaptura: 2, papelLink: "cupom" });
  }
  return importarShopeeEngine({
    job: { id: 10, evento_id: 20, cliente_id: "workspace", metadata: jobMetadata },
    evento: {
      origem,
      marketplace: "shopee",
      texto_original: "DE ~709,66~ | POR *439,99*",
      metadata: contrato ? { origemFluxo: "clonador_grupos", comercialCapturado: contrato } : {}
    },
    links,
    deps: depsFixture(precoPagina)
  });
}

async function main() {
  const clone = await entrada({ contrato: contratoClonador() });
  assert.strictEqual(clone.ok, true, "preco estruturado do Clonador deve atravessar o gate");
  assert.strictEqual(clone.preco, 439.99);
  assert.strictEqual(clone.precoOriginal, 709.66);
  assert.strictEqual(clone.metadata.produto.precoAtual, 439.99);
  assert.strictEqual(clone.metadata.produto.precoAnterior, 709.66);
  // O adapter so atravessa o gate de preco; cupom/beneficio continuam sendo
  // aplicados pela etapa canonica aplicarComercialCapturadoClonador().
  assert.strictEqual(clone.imagem, "https://cf.shopee.com.br/file/produto.jpg");

  const cloneComPrecoPaginaDiferente = await entrada({ contrato: contratoClonador(), precoPagina: "999,90" });
  assert.strictEqual(cloneComPrecoPaginaDiferente.ok, true);
  assert.strictEqual(cloneComPrecoPaginaDiferente.preco, 439.99, "pagina/API nao pode sobrescrever a verdade do Clone");
  assert.strictEqual(cloneComPrecoPaginaDiferente.precoOriginal, 709.66);

  const semContrato = await entrada();
  assert.strictEqual(semContrato.ok, false);
  assert.strictEqual(semContrato.motivo, "shopee_preco_indisponivel");

  const contratoInvalido = await entrada({ contrato: contratoClonador({ precoAtual: "439,99" }) });
  assert.strictEqual(contratoInvalido.ok, false, "string nao e contrato numerico explicito valido");
  assert.strictEqual(contratoInvalido.motivo, "shopee_preco_indisponivel");

  const contratoNulo = await entrada({ contrato: contratoClonador({ precoAtual: null }) });
  assert.strictEqual(contratoNulo.ok, false);
  assert.strictEqual(contratoNulo.motivo, "shopee_preco_indisponivel");

  const contratoZero = await entrada({ contrato: contratoClonador({ precoAtual: 0 }) });
  assert.strictEqual(contratoZero.ok, false);
  assert.strictEqual(contratoZero.motivo, "shopee_preco_indisponivel");

  const contratoNegativo = await entrada({ contrato: contratoClonador({ precoAtual: -1 }) });
  assert.strictEqual(contratoNegativo.ok, false);
  assert.strictEqual(contratoNegativo.motivo, "shopee_preco_indisponivel");

  const contratoNaN = await entrada({ contrato: contratoClonador({ precoAtual: NaN }) });
  assert.strictEqual(contratoNaN.ok, false);
  assert.strictEqual(contratoNaN.motivo, "shopee_preco_indisponivel");

  const origemDiferente = await entrada({ contrato: contratoClonador(), origem: "radar" });
  assert.strictEqual(origemDiferente.ok, false, "origem diferente nao recebe excecao do Clonador");
  assert.strictEqual(origemDiferente.motivo, "shopee_preco_indisponivel");

  const radarComPreco = await entrada({ origem: "radar", precoPagina: "99,90" });
  assert.strictEqual(radarComPreco.ok, true);
  assert.strictEqual(radarComPreco.preco, 99.9);

  const produtoResgate = await entrada({ contrato: contratoClonador(), linksResgate: true });
  assert.strictEqual(produtoResgate.ok, true);
  assert.deepStrictEqual(produtoResgate.linksProduto.map(item => item.tipo), ["produto"]);
  assert.deepStrictEqual(produtoResgate.linksResgate.map(item => item.tipo), ["resgate"]);

  const viaMetadataJob = await entrada({
    contrato: null,
    origem: "clonador_grupos",
    jobMetadata: {
      origemFluxo: "clonador_grupos",
      metadataEvento: { comercialCapturado: contratoClonador() }
    }
  });
  assert.strictEqual(viaMetadataJob.ok, true);
  assert.strictEqual(viaMetadataJob.preco, 439.99);

  console.log("shopee-comercial-capturado-clonador.test.js ok");
}

main().catch(erro => {
  console.error(erro);
  process.exit(1);
});
