const assert = require("assert");
const fs = require("fs");
const path = require("path");

function limparModulo(relativo) {
  const resolvido = require.resolve(relativo);
  delete require.cache[resolvido];
  return resolvido;
}

function mockModulo(relativo, exports) {
  const resolvido = limparModulo(relativo);
  require.cache[resolvido] = {
    id: resolvido,
    filename: resolvido,
    loaded: true,
    exports
  };
}

function linkRow(id, url) {
  return {
    id,
    url_original: url,
    url_normalizada: url,
    url_expandida: "",
    marketplace_detectado: url.includes("aliexpress") ? "aliexpress" : "shopee",
    metadata: {}
  };
}

async function testarClassificacaoShopeePreservaProduto() {
  const { importarShopeeEngine } = require("../modules/engine/importer/adapters/shopee.adapter");
  const cupom = "https://s.shopee.com.br/4fut1OkrEh";
  const produto = "https://s.shopee.com.br/8AUlBpU61C";
  let urlImportada = "";

  const resultado = await importarShopeeEngine({
    job: { id: 101, evento_id: 201, cliente_id: "workspace_teste" },
    evento: {
      texto_original: [
        "Water Cooler Aigo Darkflash DC360 Radiant",
        "R$ 229",
        `Resgate todos os cupons desta pagina: ${cupom}`,
        `Link do produto: ${produto}`
      ].join("\n"),
      links_extraidos: [cupom, produto]
    },
    links: [linkRow(1, cupom), linkRow(2, produto)],
    deps: {
      getIntegracaoCliente: () => ({ credenciais: { appId: "app", secret: "secret" } }),
      importarShopee: async (url) => {
        urlImportada = url;
        return {
          titulo: "Water Cooler Aigo Darkflash DC360 Radiant",
          precoAtual: "229.00",
          precoOriginal: "399.00",
          imagem: "https://img.test/water-cooler.jpg",
          linkAfiliado: "https://shopee.test/afiliado",
          linkExpandido: "https://shopee.com.br/product/123/456",
          shopId: "123",
          itemId: "456",
          categoria: "informatica"
        };
      }
    }
  });

  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(urlImportada, produto);
  assert.strictEqual(resultado.metadata.papelLinkEscolhido, "produto");
  assert.strictEqual(resultado.metadata.linksClassificados[0].papelLink, "cupom");
  assert.strictEqual(resultado.metadata.linksClassificados[1].papelLink, "produto");
}

async function testarShopeeShortlinkGenericoChegaAoImportador() {
  limparModulo("../modules/engine/importer/adapters/shopee.adapter");
  const { importarShopeeEngine } = require("../modules/engine/importer/adapters/shopee.adapter");
  const shortlink = "https://s.shopee.com.br/abc123";
  let urlImportada = "";

  const resultado = await importarShopeeEngine({
    job: { id: 111, evento_id: 211, cliente_id: "workspace_teste" },
    evento: {
      texto_original: [
        "Oferta Shopee imperdivel",
        "Por R$ 99,90",
        shortlink
      ].join("\n"),
      links_extraidos: [shortlink]
    },
    links: [linkRow(1, shortlink)],
    deps: {
      getIntegracaoCliente: () => ({ credenciais: { appId: "app", secret: "secret" } }),
      importarShopee: async (url) => {
        urlImportada = url;
        return {
          titulo: "Produto Shopee Confirmado",
          precoAtual: "99.90",
          imagem: "https://img.test/shopee.jpg",
          linkAfiliado: "https://shopee.test/afiliado",
          linkExpandido: "https://shopee.com.br/product/321/654",
          shopId: "321",
          itemId: "654",
          categoria: "shopee"
        };
      }
    }
  });

  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(urlImportada, shortlink);
  assert.strictEqual(resultado.metadata.produtoId, "321/654");
}

async function testarShopeeCupomSozinhoNaoChamaImportador() {
  limparModulo("../modules/engine/importer/adapters/shopee.adapter");
  const { importarShopeeEngine } = require("../modules/engine/importer/adapters/shopee.adapter");
  const cupom = "https://s.shopee.com.br/cupom-geral";
  let chamadasImportador = 0;

  const resultado = await importarShopeeEngine({
    job: { id: 112, evento_id: 212, cliente_id: "workspace_teste" },
    evento: {
      texto_original: `Resgate todos os cupons desta pagina: ${cupom}`,
      links_extraidos: [cupom]
    },
    links: [linkRow(1, cupom)],
    deps: {
      getIntegracaoCliente: () => ({ credenciais: { appId: "app", secret: "secret" } }),
      importarShopee: async () => {
        chamadasImportador += 1;
        return {};
      }
    }
  });

  assert.strictEqual(resultado.ok, false);
  assert.strictEqual(chamadasImportador, 0);
  assert.strictEqual(resultado.motivo, "sem_link_produto_entre_links_auxiliares");
}

async function testarShopeeTentaProximoCandidatoQuandoPrimeiroNaoConfirmaProduto() {
  limparModulo("../modules/engine/importer/adapters/shopee.adapter");
  const { importarShopeeEngine } = require("../modules/engine/importer/adapters/shopee.adapter");
  const primeiro = "https://s.shopee.com.br/primeiro";
  const segundo = "https://s.shopee.com.br/segundo";
  const chamadas = [];

  const resultado = await importarShopeeEngine({
    job: { id: 113, evento_id: 213, cliente_id: "workspace_teste" },
    evento: {
      texto_original: [
        "Produto A",
        primeiro,
        "Produto B",
        segundo
      ].join("\n"),
      links_extraidos: [primeiro, segundo]
    },
    links: [linkRow(1, primeiro), linkRow(2, segundo)],
    deps: {
      getIntegracaoCliente: () => ({ credenciais: { appId: "app", secret: "secret" } }),
      importarShopee: async (url) => {
        chamadas.push(url);
        if (url === primeiro) {
          return {
            ok: false,
            marketplace: "shopee",
            motivo: "shopee_produto_nao_confirmado_apos_importador",
            linkExpandido: "https://shopee.com.br/cupons"
          };
        }
        return {
          titulo: "Produto Shopee Valido",
          precoAtual: "59.90",
          imagem: "https://img.test/produto.jpg",
          linkAfiliado: "https://shopee.test/afiliado2",
          linkExpandido: "https://shopee.com.br/product/987/654",
          shopId: "987",
          itemId: "654",
          categoria: "shopee"
        };
      }
    }
  });

  assert.strictEqual(resultado.ok, true);
  assert.deepStrictEqual(chamadas, [primeiro, segundo]);
  assert.strictEqual(resultado.metadata.linkOriginalEngine, segundo);
  assert.strictEqual(resultado.metadata.produtoId, "987/654");
}

async function testarClassificacaoAliExpressPreservaProduto() {
  const { importarAliExpressEngine } = require("../modules/engine/importer/adapters/aliexpress.adapter");
  const moedas = "https://a.aliexpress.com/_c2zipJlH";
  const produto = "https://a.aliexpress.com/_c35XhGGR";
  let urlImportada = "";

  const resultado = await importarAliExpressEngine({
    job: { id: 102, evento_id: 202, cliente_id: "workspace_teste" },
    evento: {
      texto_original: [
        "Processador AMD Ryzen 7 5700x",
        "Valor: R$995",
        `Moedas: ${moedas}`,
        `Link: ${produto}`
      ].join("\n"),
      links_extraidos: [moedas, produto]
    },
    links: [
      { ...linkRow(1, moedas), marketplace_detectado: "aliexpress" },
      { ...linkRow(2, produto), marketplace_detectado: "aliexpress" }
    ],
    deps: {
      getIntegracaoCliente: () => ({ credenciais: { appKey: "app", secret: "secret", trackingId: "track" } }),
      importarAliExpress: async (url) => {
        urlImportada = url;
        return {
          titulo: "Processador AMD Ryzen 7 5700x",
          precoAtual: "995.00",
          precoOriginal: "1299.00",
          imagem: "https://img.test/ryzen.jpg",
          linkAfiliado: "https://ali.test/afiliado",
          linkExpandido: "https://www.aliexpress.com/item/1005001111111111.html",
          categoria: "informatica"
        };
      }
    }
  });

  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(urlImportada, produto);
  assert.strictEqual(resultado.metadata.papelLinkEscolhido, "produto");
  assert.strictEqual(resultado.metadata.linksClassificados[0].papelLink, "moedas");
  assert.strictEqual(resultado.metadata.linksClassificados[1].papelLink, "produto");
}

async function testarValidacaoKabumComIntegracaoAwinGenerica() {
  mockModulo("../modules/engine/processor.service", {
    marcarJobStatus: async () => ({ ok: true }),
    registrarProcessamento: async () => ({ ok: true }),
    limitarJobs: valor => Number(valor || 20)
  });
  limparModulo("../modules/engine/validator.service");
  const validator = require("../modules/engine/validator.service");

  const resultado = await validator.validarJobDiagnosticadoEngine({
    id: 103,
    cliente_id: "workspace_com_awin",
    marketplace: "kabum"
  }, {
    clientesValidos: ["workspace_com_awin"],
    marketplacesAtivosPorCliente: {
      workspace_com_awin: { awin: true }
    },
    integracoesPorCliente: {
      workspace_com_awin: {
        awin: { credenciais: { publisherId: "123", apiToken: "token" } }
      }
    }
  });

  assert.strictEqual(resultado.status, "pronto_para_importar");
}

function testarOrquestradorIncluiMarketplacesOficiais() {
  const fonte = fs.readFileSync(path.join(__dirname, "..", "modules", "engine", "orchestrator.runner.js"), "utf8");
  for (const etapa of [
    "importar_aliexpress",
    "distribuir_aliexpress",
    "distribuir_awin",
    "distribuir_kabum"
  ]) {
    assert(fonte.includes(etapa), `orquestrador deve executar ${etapa}`);
  }
}

(async () => {
  await testarClassificacaoShopeePreservaProduto();
  await testarShopeeShortlinkGenericoChegaAoImportador();
  await testarShopeeCupomSozinhoNaoChamaImportador();
  await testarShopeeTentaProximoCandidatoQuandoPrimeiroNaoConfirmaProduto();
  await testarClassificacaoAliExpressPreservaProduto();
  await testarValidacaoKabumComIntegracaoAwinGenerica();
  testarOrquestradorIncluiMarketplacesOficiais();
  console.log("engine-v2-marketplaces-fidelidade.test.js OK");
})().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
