const assert = require("assert");

const chamadas = [];
let respostas = [];

global.fetch = async function fetchMock(url, opcoes = {}) {
  const body = opcoes.body instanceof URLSearchParams
    ? opcoes.body
    : new URLSearchParams(opcoes.body || "");
  const method = body.get("method");

  chamadas.push({
    url,
    method,
    params: Object.fromEntries(body.entries())
  });

  const proxima = respostas.shift();
  if (!proxima) {
    throw new Error(`Resposta mock ausente para ${method}`);
  }

  return {
    ok: proxima.ok !== false,
    status: proxima.status || 200,
    json: async () => proxima.data
  };
};

const {
  importarAliExpress,
  extrairProductIdAliExpressManual
} = require("../marketplaces/aliexpress/importar");
const {
  importarProdutoManual
} = require("../marketplaces/manual/importar-produto");

function credenciais() {
  return {
    appKey: "app_key_teste",
    secret: "secret_teste",
    trackingId: "tracking_teste"
  };
}

function resetar(respostasMock = []) {
  chamadas.length = 0;
  respostas = [...respostasMock];
}

function respostaDetalhe(produto) {
  return {
    data: {
      aliexpress_affiliate_productdetail_get_response: {
        resp_result: {
          resp_code: "200",
          result: {
            products: {
              product: produto
            }
          }
        }
      }
    }
  };
}

function respostaQuery(produtos) {
  return {
    data: {
      aliexpress_affiliate_product_query_response: {
        resp_result: {
          result: {
            products: {
              product: produtos
            }
          }
        }
      }
    }
  };
}

function respostaLink(link) {
  return {
    data: {
      aliexpress_affiliate_link_generate_response: {
        resp_result: {
          result: {
            promotion_links: {
              promotion_link: [
                {
                  promotion_link: link
                }
              ]
            }
          }
        }
      }
    }
  };
}

function produtoAli(id, extras = {}) {
  return {
    product_id: id,
    product_title: `Produto Ali ${id}`,
    target_sale_price: "123.45",
    target_original_price: "199.90",
    product_main_image_url: "//ae01.alicdn.com/produto.jpg",
    promotion_link: `https://s.click.aliexpress.com/e/_${id}`,
    product_detail_url: `https://www.aliexpress.com/item/${id}.html`,
    first_level_category_name: "Eletronicos",
    ...extras
  };
}

function config(extra = {}) {
  return {
    clienteId: "cliente_ali",
    credenciais: credenciais(),
    gerarLinkOptimus: (link) => `https://go.optimus.test/r/${encodeURIComponent(link)}`,
    ...extra
  };
}

async function testarDetalheFuncionando() {
  const id = "1005001111111111";
  resetar([
    respostaDetalhe(produtoAli(id)),
    respostaLink("https://s.click.aliexpress.com/e/_SHORT111")
  ]);

  const produto = await importarAliExpress(`https://www.aliexpress.com/item/${id}.html`, config());

  assert.strictEqual(produto.titulo, `Produto Ali ${id}`);
  assert.strictEqual(produto.precoAtual, "123,45");
  assert.strictEqual(produto.precoAntigo, "199,90");
  assert.strictEqual(produto.imagem, "https://ae01.alicdn.com/produto.jpg");
  assert.ok(produto.linkAfiliado.startsWith("https://go.optimus.test/r/"));
  assert.strictEqual(chamadas[0].method, "aliexpress.affiliate.productdetail.get");
  assert.strictEqual(chamadas[1].method, "aliexpress.affiliate.link.generate");
  assert.strictEqual(chamadas[1].params.source_values, "https://s.click.aliexpress.com/e/_1005001111111111");
}

async function testarFallbackQueryComMesmoProductId() {
  const id = "1005002222222222";
  resetar([
    respostaDetalhe({ product_id: id }),
    respostaQuery([
      produtoAli("1005000000000000"),
      produtoAli(id, {
        product_title: "Produto recuperado pela query",
        promotion_link_short: "https://s.click.aliexpress.com/e/_MATCH222"
      })
    ]),
    respostaLink("https://s.click.aliexpress.com/e/_SHORT222")
  ]);

  const produto = await importarAliExpress(`https://www.aliexpress.com/item/${id}.html`, config());

  assert.strictEqual(produto.titulo, "Produto recuperado pela query");
  assert.strictEqual(produto.precoAtual, "123,45");
  assert.strictEqual(produto.imagem, "https://ae01.alicdn.com/produto.jpg");
  assert.strictEqual(chamadas[1].method, "aliexpress.affiliate.product.query");
  assert.strictEqual(chamadas[1].params.keywords, id);
  assert.strictEqual(chamadas[2].params.source_values, "https://s.click.aliexpress.com/e/_MATCH222");
}

async function testarQueryRejeitaProdutoDiferente() {
  const id = "1005003333333333";
  resetar([
    respostaDetalhe({}),
    respostaQuery([
      produtoAli("1005004444444444")
    ])
  ]);

  const produto = await importarAliExpress(`https://www.aliexpress.com/item/${id}.html`, config());

  assert.strictEqual(produto.titulo, "Produto AliExpress");
  assert.strictEqual(produto.precoAtual, "");
  assert.strictEqual(produto.imagem, "");
  assert.strictEqual(chamadas.length, 2);
}

function testarExtracaoId() {
  assert.strictEqual(
    extrairProductIdAliExpressManual("https://www.aliexpress.com/item/1005005555555555.html"),
    "1005005555555555"
  );
  assert.strictEqual(
    extrairProductIdAliExpressManual("https://www.aliexpress.com/item/x.html?product_id=1005006666666666"),
    "1005006666666666"
  );
  assert.strictEqual(
    extrairProductIdAliExpressManual("https://www.aliexpress.com/item/x.html?itemId=1005007777777777"),
    "1005007777777777"
  );
  assert.strictEqual(
    extrairProductIdAliExpressManual("https://redirect.test/?url=https%3A%2F%2Fwww.aliexpress.com%2Fitem%2F1005008888888888.html"),
    "1005008888888888"
  );
}

async function testarRadarUsaImportadorModularComCredenciaisDoCliente() {
  const id = "1005009999999999";
  let importadorModularChamado = false;
  let clienteIdRecebido = "";
  let trackingRecebido = "";

  resetar([
    respostaDetalhe(produtoAli(id)),
    respostaLink("https://s.click.aliexpress.com/e/_RADAR999")
  ]);

  const resultado = await importarProdutoManual({
    clienteId: "cliente_radar",
    body: {
      url: `https://www.aliexpress.com/item/${id}.html`,
      marketplace: "aliexpress"
    }
  }, {
    getClienteId: req => req.clienteId,
    getIntegracaoCliente: (clienteId, marketplace) => {
      assert.strictEqual(clienteId, "cliente_radar");
      assert.strictEqual(marketplace, "aliexpress");
      return {
        clienteId,
        credenciais: {
          appKey: "app_key_radar",
          secret: "secret_radar",
          trackingId: "tracking_radar"
        }
      };
    },
    importarAliExpress: (url, configAli = {}) => {
      importadorModularChamado = true;
      clienteIdRecebido = configAli.clienteId;
      trackingRecebido = configAli.credenciais?.trackingId || "";
      return importarAliExpress(url, {
        ...configAli,
        gerarLinkOptimus: (link, marketplace, contexto = {}) =>
          `https://go.optimus.test/${contexto.clienteId}/${marketplace}/${encodeURIComponent(link)}`
      });
    }
  });

  assert.strictEqual(resultado.status, 200);
  assert.strictEqual(resultado.body.titulo, `Produto Ali ${id}`);
  assert.strictEqual(importadorModularChamado, true);
  assert.strictEqual(clienteIdRecebido, "cliente_radar");
  assert.strictEqual(trackingRecebido, "tracking_radar");
  assert.ok(resultado.body.linkAfiliado.includes("/cliente_radar/aliexpress/"));
  assert.strictEqual(chamadas[0].method, "aliexpress.affiliate.productdetail.get");
  assert.strictEqual(chamadas[1].method, "aliexpress.affiliate.link.generate");
  assert.strictEqual(chamadas[1].params.tracking_id, "tracking_radar");
}

async function testarClienteSemIntegracaoNaoContaminaOutroCliente() {
  resetar([]);

  const resultado = await importarProdutoManual({
    clienteId: "cliente_sem_ali",
    body: {
      url: "https://www.aliexpress.com/item/1005001234567890.html",
      marketplace: "aliexpress"
    }
  }, {
    getClienteId: req => req.clienteId,
    getIntegracaoCliente: (clienteId, marketplace) => {
      if (clienteId === "cliente_com_ali" && marketplace === "aliexpress") {
        return {
          clienteId,
          credenciais: credenciais()
        };
      }
      return null;
    },
    importarAliExpress: () => {
      throw new Error("importador nao deveria ser chamado sem integracao do cliente");
    }
  });

  assert.strictEqual(resultado.status, 400);
  assert.strictEqual(resultado.body.ok, false);
  assert.match(resultado.body.erro, /Integra/i);
  assert.strictEqual(chamadas.length, 0);
}

(async () => {
  await testarDetalheFuncionando();
  await testarFallbackQueryComMesmoProductId();
  await testarQueryRejeitaProdutoDiferente();
  testarExtracaoId();
  await testarRadarUsaImportadorModularComCredenciaisDoCliente();
  await testarClienteSemIntegracaoNaoContaminaOutroCliente();
  console.log("aliexpress-manual-importador.test.js ok");
})().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
