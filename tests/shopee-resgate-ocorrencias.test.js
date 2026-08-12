const assert = require("assert");
const { importarShopeeEngine } = require("../modules/engine/importer/adapters/shopee.adapter");

async function testarResgateProdutoProduto() {
  const resgate = "https://s.shopee.com.br/50UODeJEET";
  const produto = "https://s.shopee.com.br/6L3ZsZbcnU";
  const afiliado = "https://s.shopee.com.br/1qbAWUnlri";
  const texto = [
    "Kit Ferramentas",
    "R$ 55,90",
    "Resgatem o cupom de 30% OFF",
    resgate,
    produto,
    produto
  ].join("\n");

  const chamadas = [];
  const resultado = await importarShopeeEngine({
    job: { id: 1, evento_id: 2, cliente_id: "cliente_teste" },
    evento: { texto_original: texto, marketplace: "shopee" },
    links: [
      { url_original: resgate, ordemCaptura: 1, ocorrenciaId: "radar:resgate:1" },
      { url_original: produto, ordemCaptura: 2, ocorrenciaId: "radar:produto:2" },
      { url_original: produto, ordemCaptura: 3, ocorrenciaId: "radar:produto:3" }
    ],
    deps: {
      getIntegracaoCliente: () => ({ credenciais: { appId: "app", secret: "secret" } }),
      importarShopee: async (url) => {
        chamadas.push(url);
        assert.strictEqual(url, produto, "Resgate nao deve ser enviado ao importador de Produto");
        return {
          ok: true,
          titulo: "Kit Jogo Ferramenta Chave Magnetica Precisao 24 Pecas",
          precoAtual: "55,90",
          preco: "55,90",
          imagem: "https://img.test/shopee.jpg",
          imagemOrigem: "fixture",
          linkAfiliado: afiliado,
          linkFinal: afiliado,
          link: afiliado,
          linkOriginal: produto,
          linkExpandido: produto,
          shopId: "123",
          itemId: "456",
          categoria: "Ferramentas"
        };
      }
    }
  });

  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(chamadas.length, 1, "duplicado pode reutilizar conversao tecnica");
  assert.deepStrictEqual(resultado.linksComerciais.map(item => item.tipo), ["resgate", "produto", "produto"]);
  assert.deepStrictEqual(resultado.linksComerciais.map(item => item.ordemCaptura), [1, 2, 3]);
  assert.strictEqual(resultado.linksComerciais[0].urlOriginal, resgate);
  assert.strictEqual(resultado.linksComerciais[0].renderizavel, true);
  assert.strictEqual(resultado.linksComerciais[1].urlAfiliadaWorkspace, afiliado);
  assert.strictEqual(resultado.linksComerciais[2].urlAfiliadaWorkspace, afiliado);
  assert.deepStrictEqual(resultado.linksResgate.map(item => item.urlOriginal), [resgate]);
  assert.deepStrictEqual(resultado.linksProduto.map(item => item.urlOriginal), [produto, produto]);
  assert.deepStrictEqual(resultado.metadata.linksComerciais.map(item => item.tipo), ["resgate", "produto", "produto"]);
}

testarResgateProdutoProduto()
  .then(() => console.log("shopee-resgate-ocorrencias.test.js OK"))
  .catch((erro) => {
    console.error(erro);
    process.exit(1);
  });
