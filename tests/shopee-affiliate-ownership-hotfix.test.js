const assert = require("assert");

const { importarShopeeEngine } = require("../modules/engine/importer/adapters/shopee.adapter");

const clienteId = "workspace_shopee";
const original = "https://s.shopee.com.br/original";
const derivada = "https://s.shopee.com.br/derivada-workspace";
const produtoDireto = "https://shopee.com.br/product/111/222";

function deps(expandirShortlinkShopee) {
  return {
    getIntegracaoCliente: () => ({ credenciais: { appId: "18362140789", secret: "segredo-de-teste" } }),
    expandirShortlinkShopee,
    importarShopee: async () => ({
      ok: true,
      titulo: "Produto Shopee oficial",
      precoAtual: "99,90",
      preco: "99,90",
      imagem: "https://cf.shopee.com.br/file/produto.jpg",
      imagemOrigem: "api_productOfferV2.imageUrl",
      linkAfiliado: derivada,
      linkFinal: derivada,
      link: derivada,
      linkOriginal: original,
      linkExpandido: produtoDireto,
      shopId: "111",
      itemId: "222",
      categoria: "Shopee"
    })
  };
}

async function importar(expandirShortlinkShopee) {
  return importarShopeeEngine({
    job: { id: 1, evento_id: 2, cliente_id: clienteId },
    evento: { texto_original: `Produto\nR$ 99,90\n${original}`, marketplace: "shopee" },
    links: [{ url_original: original, url_expandida: produtoDireto, ordemCaptura: 1 }],
    deps: deps(expandirShortlinkShopee)
  });
}

async function main() {
  const esperado = `${produtoDireto}?mmp_pid=an_18362140789&utm_source=an_18362140789`;
  const aprovado = await importar(async () => esperado);
  assert.strictEqual(aprovado.ok, true);
  assert.strictEqual(aprovado.metadata.afiliacaoWorkspace.affiliateIdDetectado, "an_18362140789");

  for (const terceiro of ["an_18179570003", "an_18197860005"]) {
    const bloqueado = await importar(async () => `${produtoDireto}?mmp_pid=${terceiro}`);
    assert.strictEqual(bloqueado.ok, false);
    assert.strictEqual(bloqueado.motivo, "afiliacao_workspace_incompleta");
    assert.strictEqual(bloqueado.motivoDetalhe, "afiliacao_workspace_divergente");
    assert.strictEqual(bloqueado.retriavel, false);
    assert.strictEqual(bloqueado.linkAfiliado, undefined);
  }

  const vazio = await importar(async () => "");
  assert.strictEqual(vazio.ok, false);
  assert.strictEqual(vazio.motivo, "afiliacao_workspace_incompleta");
  assert.strictEqual(vazio.motivoDetalhe, "afiliacao_workspace_nao_confirmada");
  assert.strictEqual(vazio.retriavel, true);

  let tentativas = 0;
  const recuperado = await importar(async () => {
    tentativas += 1;
    return tentativas === 1 ? "" : esperado;
  });
  assert.strictEqual(recuperado.ok, true);
  assert.strictEqual(tentativas, 2);
  console.log("shopee-affiliate-ownership-hotfix.test.js OK");
}

main().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
