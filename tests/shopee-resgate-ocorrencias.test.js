const assert = require("assert");
const { importarShopeeEngine } = require("../modules/engine/importer/adapters/shopee.adapter");
const { montarMensagemOferta } = require("../utils/mensagens-ofertas");

async function testarResgateProdutoProduto() {
  const resgate = "https://s.shopee.com.br/4Az3hSPAD1";
  const resgateExpandido = "https://shopee.com.br/m/cupom-de-desconto?from=fixture";
  const produto = "https://s.shopee.com.br/3VjI4rARl1";
  const produtoExpandido = "https://shopee.com.br/product/1866834175/58215641231";
  const afiliadoProduto = "https://s.shopee.com.br/1BLVJdLx8g";
  const afiliadoResgate = "https://s.shopee.com.br/resgateD1";
  const texto = [
    "Kit Ferramentas",
    "R$ 55,90",
    "Resgatem o cupom de 30% OFF",
    resgate,
    produto,
    produto
  ].join("\n");

  const chamadas = [];
  const shortlinksGerados = [];
  const resultado = await importarShopeeEngine({
    job: { id: 1, evento_id: 2, cliente_id: "cliente_teste" },
    evento: { texto_original: texto, marketplace: "shopee" },
    links: [
      { url_original: resgate, url_expandida: resgateExpandido, ordemCaptura: 1, ocorrenciaId: "radar:resgate:1" },
      { url_original: produto, url_expandida: produtoExpandido, ordemCaptura: 2, ocorrenciaId: "radar:produto:2" },
      { url_original: produto, url_expandida: produtoExpandido, ordemCaptura: 3, ocorrenciaId: "radar:produto:3" }
    ],
    deps: {
      getIntegracaoCliente: () => ({ credenciais: { appId: "app", secret: "secret" } }),
      gerarShortLinkShopee: async (originUrl, integracao, subIds) => {
        shortlinksGerados.push({ originUrl, subIds, appId: integracao.credenciais.appId });
        assert.strictEqual(originUrl, resgateExpandido);
        return { ok: true, shortLink: afiliadoResgate };
      },
      expandirShortlinkShopee: async (url) => {
        assert.strictEqual(url, afiliadoResgate);
        return resgateExpandido + "&aff=workspace";
      },
      importarShopee: async (url) => {
        chamadas.push(url);
        if (url === resgate) {
          throw new Error("resgate_nao_deve_chamar_importador_de_produto");
        }
        assert.strictEqual(url, produto);
        return {
          ok: true,
          titulo: "Kit Jogo Ferramenta Chave Magnetica Precisao 24 Pecas",
          precoAtual: "55,90",
          preco: "55,90",
          imagem: "https://img.test/shopee.jpg",
          imagemOrigem: "fixture",
          linkAfiliado: afiliadoProduto,
          linkFinal: afiliadoProduto,
          link: afiliadoProduto,
          linkOriginal: produto,
          linkExpandido: produtoExpandido,
          shopId: "1866834175",
          itemId: "58215641231",
          categoria: "Ferramentas"
        };
      }
    }
  });

  assert.strictEqual(resultado.ok, true);
  assert.deepStrictEqual(chamadas, [produto], "resgate landing nao deve passar pelo importador de produto; produto duplicado reutiliza cache");
  assert.strictEqual(shortlinksGerados.length, 1);
  assert.ok(shortlinksGerados[0].subIds.includes("wsclienteteste"), "subIds devem identificar o workspace sem dados sensiveis");
  assert.deepStrictEqual(resultado.linksComerciais.map(item => item.tipo), ["resgate", "produto", "produto"]);
  assert.deepStrictEqual(resultado.linksComerciais.map(item => item.ordemCaptura), [1, 2, 3]);
  assert.strictEqual(resultado.linksComerciais[0].urlOriginal, resgate);
  assert.strictEqual(resultado.linksComerciais[0].renderizavel, true);
  assert.strictEqual(resultado.linksComerciais[0].urlAfiliadaWorkspace, afiliadoResgate);
  assert.strictEqual(resultado.linksComerciais[0].conversaoStatus, "convertida");
  assert.strictEqual(resultado.linksComerciais[0].motivoConversao, "resgate_workspace_convertido_generate_shortlink");
  assert.strictEqual(resultado.linksComerciais[0].destinoFuncionalOriginal.rota, "/m/cupom-de-desconto");
  assert.strictEqual(resultado.linksComerciais[0].destinoFuncionalFinal.rota, "/m/cupom-de-desconto");
  assert.strictEqual(resultado.linksComerciais[1].urlAfiliadaWorkspace, afiliadoProduto);
  assert.strictEqual(resultado.linksComerciais[2].urlAfiliadaWorkspace, afiliadoProduto);
  assert.deepStrictEqual(resultado.linksResgate.map(item => item.urlOriginal), [resgate]);
  assert.deepStrictEqual(resultado.linksProduto.map(item => item.urlOriginal), [produto, produto]);
  assert.deepStrictEqual(resultado.linksResgate.map(item => item.urlAfiliadaWorkspace), [afiliadoResgate]);
  assert.deepStrictEqual(resultado.metadata.linksComerciais.map(item => item.tipo), ["resgate", "produto", "produto"]);
}

async function testarCincoProdutosDiferentesPreservamCincoSaidas() {
  const produtos = [1, 2, 3, 4, 5].map(n => `https://s.shopee.com.br/produto${n}`);
  const produtosExpandidos = [1, 2, 3, 4, 5].map(n => `https://shopee.com.br/product/900${n}/800${n}`);
  const afiliados = [1, 2, 3, 4, 5].map(n => `https://s.shopee.com.br/produto${n}D1`);
  const chamadas = [];

  const resultado = await importarShopeeEngine({
    job: { id: 10, evento_id: 20, cliente_id: "cliente_teste" },
    evento: {
      texto_original: [
        "Lista Shopee",
        "R$ 99,90",
        ...produtos.map(url => `Produto: ${url}`)
      ].join("\n"),
      marketplace: "shopee"
    },
    links: produtos.map((url, indice) => ({
      url_original: url,
      url_expandida: produtosExpandidos[indice],
      ordemCaptura: indice + 1,
      ocorrenciaId: `radar:produto:${indice + 1}`
    })),
    deps: {
      getIntegracaoCliente: () => ({ credenciais: { appId: "app", secret: "secret" } }),
      importarShopee: async (url) => {
        chamadas.push(url);
        const indice = produtos.indexOf(url);
        assert.notStrictEqual(indice, -1, "produto desconhecido nao deve ser importado");
        const ids = produtosExpandidos[indice].match(/\/product\/(\d+)\/(\d+)/);
        return {
          ok: true,
          titulo: `Produto Shopee ${indice + 1}`,
          precoAtual: "99,90",
          preco: "99,90",
          imagem: `https://img.test/produto-${indice + 1}.jpg`,
          linkAfiliado: afiliados[indice],
          linkFinal: afiliados[indice],
          link: afiliados[indice],
          linkOriginal: url,
          linkExpandido: produtosExpandidos[indice],
          shopId: ids[1],
          itemId: ids[2],
          categoria: "Shopee"
        };
      }
    }
  });

  assert.strictEqual(resultado.ok, true);
  assert.deepStrictEqual(chamadas, produtos);
  assert.deepStrictEqual(resultado.linksComerciais.map(item => item.tipo), ["produto", "produto", "produto", "produto", "produto"]);
  assert.deepStrictEqual(resultado.linksComerciais.map(item => item.urlOriginal), produtos);
  assert.deepStrictEqual(resultado.linksComerciais.map(item => item.urlAfiliadaWorkspace), afiliados);
  assert.deepStrictEqual(resultado.linksComerciais.map(item => item.ordemCaptura), [1, 2, 3, 4, 5]);
}

async function testarImportadorNaoUsaKeywordParaResgate() {
  const { criarImportarShopee } = require("../marketplaces/shopee/importar");
  const importarShopee = criarImportarShopee({});
  const landing = "https://shopee.com.br/m/cupom-de-desconto?from=fixture";
  const resultado = await importarShopee(landing, {
    credenciais: { appId: "app", secret: "secret" },
    contextoEngine: { papelLink: "resgate" }
  });
  const resultadoSemContexto = await importarShopee(landing, {
    credenciais: { appId: "app", secret: "secret" }
  });

  assert.strictEqual(resultado.ok, false);
  assert.strictEqual(resultado.motivo, "resgate_shopee_sem_conversao_landing");
  assert.strictEqual(resultado.renderizavel, false);
  assert.strictEqual(resultado.linkAfiliado, "");
  assert.strictEqual(resultadoSemContexto.ok, false);
  assert.strictEqual(resultadoSemContexto.motivo, "resgate_shopee_sem_conversao_landing");
}

async function testarGenerateShortLinkUsaMutationOficial() {
  const { gerarShortLinkShopee } = require("../marketplaces/shopee/importar");
  const chamadas = [];
  const resultado = await gerarShortLinkShopee(
    "https://shopee.com.br/m/cupom-de-desconto?from=fixture",
    { credenciais: { appId: "app", secret: "secret" } },
    ["wscliente", "ev123"],
    {
      fetch: async (url, options) => {
        chamadas.push({ url, options, body: JSON.parse(options.body) });
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { generateShortLink: { shortLink: "https://s.shopee.com.br/resgateD1" } } })
        };
      }
    }
  );

  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(resultado.shortLink, "https://s.shopee.com.br/resgateD1");
  assert.strictEqual(chamadas[0].url, "https://open-api.affiliate.shopee.com.br/graphql");
  assert.match(chamadas[0].body.query, /generateShortLink/);
  assert.deepStrictEqual(chamadas[0].body.variables.input, {
    originUrl: "https://shopee.com.br/m/cupom-de-desconto?from=fixture",
    subIds: ["wscliente", "ev123"]
  });
  assert.match(chamadas[0].options.headers.Authorization, /^SHA256 Credential=app, Timestamp=\d+, Signature=[a-f0-9]{64}$/);
}

async function testarFalhaGenerateShortLinkMantemProduto() {
  const resgate = "https://s.shopee.com.br/4Az3hSPAD1";
  const resgateExpandido = "https://shopee.com.br/m/cupom-de-desconto?from=fixture";
  const produto = "https://s.shopee.com.br/3VjI4rARl1";
  const produtoExpandido = "https://shopee.com.br/product/1866834175/58215641231";
  const afiliadoProduto = "https://s.shopee.com.br/1BLVJdLx8g";
  const chamadas = [];

  const resultado = await importarShopeeEngine({
    job: { id: 30, evento_id: 40, cliente_id: "cliente_teste" },
    evento: {
      texto_original: [
        "Resgatem o cupom:",
        resgate,
        "Item Shopee Seguro",
        "R$ 55,90",
        "Confira:",
        produto
      ].join("\n"),
      marketplace: "shopee"
    },
    links: [
      { url_original: resgate, url_expandida: resgateExpandido, ordemCaptura: 1 },
      { url_original: produto, url_expandida: produtoExpandido, ordemCaptura: 2 }
    ],
    deps: {
      getIntegracaoCliente: () => ({ credenciais: { appId: "app", secret: "secret" } }),
      gerarShortLinkShopee: async () => ({ ok: false, motivo: "generate_shortlink_shopee_falhou" }),
      importarShopee: async (url) => {
        chamadas.push(url);
        assert.strictEqual(url, produto);
        return {
          ok: true,
          titulo: "Produto Shopee Seguro",
          precoAtual: "55,90",
          preco: "55,90",
          imagem: "https://img.test/shopee.jpg",
          linkAfiliado: afiliadoProduto,
          linkFinal: afiliadoProduto,
          link: afiliadoProduto,
          linkOriginal: produto,
          linkExpandido: produtoExpandido,
          shopId: "1866834175",
          itemId: "58215641231",
          categoria: "Shopee"
        };
      }
    }
  });

  assert.strictEqual(resultado.ok, true);
  assert.deepStrictEqual(chamadas, [produto]);
  assert.strictEqual(resultado.linksComerciais[0].renderizavel, false);
  assert.strictEqual(resultado.linksComerciais[0].motivoConversao, "resgate_shopee_sem_conversao_landing");
  assert.strictEqual(resultado.linksComerciais[1].renderizavel, true);
  assert.strictEqual(resultado.linksComerciais[1].urlAfiliadaWorkspace, afiliadoProduto);
}

async function testarDestinoDivergenteRejeitaResgate() {
  const resgate = "https://s.shopee.com.br/4Az3hSPAD1";
  const resgateExpandido = "https://shopee.com.br/m/cupom-de-desconto?from=fixture";
  const afiliadoResgate = "https://s.shopee.com.br/resgateErrado";
  const produto = "https://s.shopee.com.br/3VjI4rARl1";
  const produtoExpandido = "https://shopee.com.br/product/1866834175/58215641231";
  const afiliadoProduto = "https://s.shopee.com.br/1BLVJdLx8g";

  const resultado = await importarShopeeEngine({
    job: { id: 31, evento_id: 41, cliente_id: "cliente_teste" },
    evento: {
      texto_original: [
        "Resgatem o cupom:",
        resgate,
        "Item Shopee Seguro",
        "R$ 55,90",
        "Confira:",
        produto
      ].join("\n"),
      marketplace: "shopee"
    },
    links: [
      { url_original: resgate, url_expandida: resgateExpandido, ordemCaptura: 1 },
      { url_original: produto, url_expandida: produtoExpandido, ordemCaptura: 2 }
    ],
    deps: {
      getIntegracaoCliente: () => ({ credenciais: { appId: "app", secret: "secret" } }),
      gerarShortLinkShopee: async () => ({ ok: true, shortLink: afiliadoResgate }),
      expandirShortlinkShopee: async () => "https://shopee.com.br/product/1866834175/58215641231",
      importarShopee: async (url) => {
        assert.strictEqual(url, produto);
        return {
          ok: true,
          titulo: "Produto Shopee Seguro",
          precoAtual: "55,90",
          preco: "55,90",
          imagem: "https://img.test/shopee.jpg",
          linkAfiliado: afiliadoProduto,
          linkFinal: afiliadoProduto,
          link: afiliadoProduto,
          linkOriginal: produto,
          linkExpandido: produtoExpandido,
          shopId: "1866834175",
          itemId: "58215641231",
          categoria: "Shopee"
        };
      }
    }
  });

  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(resultado.linksComerciais[0].renderizavel, false);
  assert.strictEqual(resultado.linksComerciais[0].urlAfiliadaWorkspace, "");
  assert.strictEqual(resultado.linksComerciais[0].destinoFuncionalOriginal.rota, "/m/cupom-de-desconto");
  assert.strictEqual(resultado.linksComerciais[0].destinoFuncionalFinal.tipo, "produto");
}

async function testarWorkspaceNaoReutilizaShortlinkDeOutro() {
  const resgate = "https://s.shopee.com.br/4Az3hSPAD1";
  const resgateExpandido = "https://shopee.com.br/m/cupom-de-desconto?from=fixture";
  const produto = "https://s.shopee.com.br/3VjI4rARl1";
  const produtoExpandido = "https://shopee.com.br/product/1866834175/58215641231";
  const shortlinksPorWorkspace = {
    clienteA: "https://s.shopee.com.br/resgateA",
    clienteB: "https://s.shopee.com.br/resgateB"
  };

  async function executar(clienteId) {
    return importarShopeeEngine({
      job: { id: clienteId === "clienteA" ? 50 : 51, evento_id: 60, cliente_id: clienteId },
      evento: {
        texto_original: [
          "Resgatem o cupom:",
          resgate,
          "Item Shopee Seguro",
          "R$ 55,90",
          "Confira:",
          produto
        ].join("\n"),
        marketplace: "shopee"
      },
      links: [
        { url_original: resgate, url_expandida: resgateExpandido, ordemCaptura: 1 },
        { url_original: produto, url_expandida: produtoExpandido, ordemCaptura: 2 }
      ],
      deps: {
        getIntegracaoCliente: () => ({ credenciais: { appId: "app", secret: "secret" } }),
        gerarShortLinkShopee: async (originUrl, integracao, subIds) => {
          assert.strictEqual(originUrl, resgateExpandido);
          const workspaceSubId = subIds.find(item => item.startsWith("ws"));
          assert.strictEqual(workspaceSubId, `ws${clienteId}`);
          return { ok: true, shortLink: shortlinksPorWorkspace[clienteId] };
        },
        expandirShortlinkShopee: async () => resgateExpandido,
        importarShopee: async (url) => {
          assert.strictEqual(url, produto);
          return {
            ok: true,
            titulo: "Produto Shopee Seguro",
            precoAtual: "55,90",
            preco: "55,90",
            imagem: "https://img.test/shopee.jpg",
            linkAfiliado: `https://s.shopee.com.br/produto${clienteId}`,
            linkFinal: `https://s.shopee.com.br/produto${clienteId}`,
            link: `https://s.shopee.com.br/produto${clienteId}`,
            linkOriginal: produto,
            linkExpandido: produtoExpandido,
            shopId: "1866834175",
            itemId: "58215641231",
            categoria: "Shopee"
          };
        }
      }
    });
  }

  const resultadoA = await executar("clienteA");
  const resultadoB = await executar("clienteB");

  assert.strictEqual(resultadoA.linksComerciais[0].urlAfiliadaWorkspace, "https://s.shopee.com.br/resgateA");
  assert.strictEqual(resultadoB.linksComerciais[0].urlAfiliadaWorkspace, "https://s.shopee.com.br/resgateB");
}

async function testarPrecoBrasileiroMilharXiaomi() {
  const produto = "https://s.shopee.com.br/xiaomi13c";
  const produtoExpandido = "https://shopee.com.br/product/777/888";
  const texto = [
    "Xiaomi Redmi 13C",
    "R$ 1.169 - 128GB/6GB",
    "R$ 1.381 - 256GB/8GB",
    "R$ 1.555 - 512GB/8GB",
    "Produto:",
    produto
  ].join("\n");

  const resultado = await importarShopeeEngine({
    job: { id: 70, evento_id: 80, cliente_id: "cliente_teste" },
    evento: { texto_original: texto, marketplace: "shopee" },
    links: [{ url_original: produto, url_expandida: produtoExpandido, ordemCaptura: 1 }],
    deps: {
      getIntegracaoCliente: () => ({ credenciais: { appId: "app", secret: "secret" } }),
      importarShopee: async (url) => {
        assert.strictEqual(url, produto);
        return {
          ok: true,
          titulo: "Xiaomi Redmi 13C 128GB 6GB",
          precoAtual: "1381,00",
          preco: "1381,00",
          imagem: "https://img.test/xiaomi.jpg",
          linkAfiliado: "https://s.shopee.com.br/xiaomiD1",
          linkFinal: "https://s.shopee.com.br/xiaomiD1",
          link: "https://s.shopee.com.br/xiaomiD1",
          linkOriginal: produto,
          linkExpandido: produtoExpandido,
          shopId: "777",
          itemId: "888",
          categoria: "Celulares"
        };
      }
    }
  });

  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(resultado.preco, 1169);
  assert.strictEqual(resultado.metadata.precoRadarUsado, true);
  assert.strictEqual(resultado.metadata.precoRadarTexto, "R$ 1.169");
  assert.strictEqual(resultado.metadata.precoAuditoria.origemPreco, "texto_radar_soberano");
  const mensagem = montarMensagemOferta(resultado);
  assert.ok(mensagem.includes("R$ 1.169,00"), "template final deve preservar milhar brasileiro");
  assert.ok(!mensagem.includes("R$ 1,17"), "template final nunca pode reduzir R$ 1.169 para R$ 1,17");
}

async function testarFormatosPrecoBrasileiroShopee() {
  const casos = [
    ["R$ 1.169", 1169],
    ["R$ 1.169,90", 1169.9],
    ["R$ 169,90", 169.9],
    ["R$ 1.381", 1381],
    ["R$ 1.555", 1555]
  ];

  for (const [precoTexto, esperado] of casos) {
    const produto = `https://s.shopee.com.br/preco-${String(esperado).replace(/\D/g, "")}`;
    const resultado = await importarShopeeEngine({
      job: { id: 90 + Math.round(esperado), evento_id: 100 + Math.round(esperado), cliente_id: "cliente_teste" },
      evento: {
        texto_original: [
          "Produto Teste Shopee",
          precoTexto,
          "Produto:",
          produto
        ].join("\n"),
        marketplace: "shopee"
      },
      links: [{ url_original: produto, url_expandida: "https://shopee.com.br/product/777/888", ordemCaptura: 1 }],
      deps: {
        getIntegracaoCliente: () => ({ credenciais: { appId: "app", secret: "secret" } }),
        importarShopee: async (url) => {
          assert.strictEqual(url, produto);
          return {
            ok: true,
            titulo: "Produto Teste Shopee",
            precoAtual: "999,00",
            preco: "999,00",
            imagem: "https://img.test/produto.jpg",
            linkAfiliado: "https://s.shopee.com.br/produtoD1",
            linkFinal: "https://s.shopee.com.br/produtoD1",
            link: "https://s.shopee.com.br/produtoD1",
            linkOriginal: produto,
            linkExpandido: "https://shopee.com.br/product/777/888",
            shopId: "777",
            itemId: "888",
            categoria: "Shopee"
          };
        }
      }
    });

    assert.strictEqual(resultado.ok, true);
    assert.strictEqual(resultado.preco, esperado, `${precoTexto} deve preservar formato brasileiro`);
    assert.strictEqual(resultado.metadata.precoRadarUsado, true);
  }
}

Promise.resolve()
  .then(testarResgateProdutoProduto)
  .then(testarCincoProdutosDiferentesPreservamCincoSaidas)
  .then(testarImportadorNaoUsaKeywordParaResgate)
  .then(testarGenerateShortLinkUsaMutationOficial)
  .then(testarFalhaGenerateShortLinkMantemProduto)
  .then(testarDestinoDivergenteRejeitaResgate)
  .then(testarWorkspaceNaoReutilizaShortlinkDeOutro)
  .then(testarPrecoBrasileiroMilharXiaomi)
  .then(testarFormatosPrecoBrasileiroShopee)
  .then(() => console.log("shopee-resgate-ocorrencias.test.js OK"))
  .catch((erro) => {
    console.error(erro);
    process.exit(1);
  });
