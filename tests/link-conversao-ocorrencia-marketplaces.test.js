const assert = require("assert");
const { importarMercadoLivreEngine } = require("../modules/engine/importer/adapters/mercadolivre.adapter");
const { importarAmazonEngine } = require("../modules/engine/importer/adapters/amazon.adapter");
const { importarAwinEngine } = require("../modules/engine/importer/adapters/awin.adapter");
const { importarAliExpressEngine } = require("../modules/engine/importer/adapters/aliexpress.adapter");

function ocorrencia(url, ordem, papel = "produto") {
  return {
    id: `link-${ordem}`,
    ocorrenciaId: `radar:${papel}:${ordem}`,
    ordemCaptura: ordem,
    url_original: url,
    urlOriginal: url,
    papelLink: papel,
    papel,
    tipo: papel
  };
}

async function testarMercadoLivreAB() {
  const clienteId = "D1";
  const meliA = "https://meli.la/A";
  const meliB = "https://meli.la/B";
  const produtoA = "https://produto.mercadolivre.com.br/MLB-111-produto-a";
  const produtoB = "https://produto.mercadolivre.com.br/MLB-222-produto-b";
  const afiliadoA = "https://mercadolivre.com/sec/aff-a";
  const afiliadoB = "https://mercadolivre.com/sec/aff-b";
  const resolvidos = { [meliA]: produtoA, [meliB]: produtoB };
  const afiliados = { [produtoA]: afiliadoA, [produtoB]: afiliadoB };
  const resolucoes = [];
  const conversoes = [];

  const resultado = await importarMercadoLivreEngine({
    job: { id: 11, evento_id: 12, cliente_id: clienteId },
    evento: { texto_original: `ML A e B\n${meliA}\n${meliB}`, marketplace: "mercadolivre" },
    links: [ocorrencia(meliA, 1), ocorrencia(meliB, 2)],
    deps: {
      getIntegracaoCliente: () => ({ credenciais: { tag: "d1" } }),
      resolverLinkOriginalRadar: async (url) => {
        resolucoes.push(url);
        return { ok: true, linkResolvido: resolvidos[url], urlResolvida: resolvidos[url], tipoLinkRadar: "meli_la" };
      },
      importarMercadoLivre: async (url) => {
        assert.strictEqual(url, produtoA);
        return {
          titulo: "Produto Mercado Livre A",
          precoAtual: "100",
          imagem: "https://img.test/ml-a.jpg",
          linkAfiliado: afiliadoA,
          linkFinal: afiliadoA,
          link: afiliadoA,
          urlFinal: produtoA,
          categoria: "Casa"
        };
      },
      gerarLinkAfiliadoMercadoLivre: async (url, _integracao, contexto) => {
        conversoes.push({ url, clienteId: contexto?.clienteId || "" });
        return afiliados[url] || "";
      }
    }
  });

  assert.strictEqual(resultado.ok, true);
  assert.deepStrictEqual(resolucoes, [meliA, meliB]);
  assert.deepStrictEqual(conversoes, [{ url: produtoB, clienteId }]);
  assert.deepStrictEqual(resultado.metadata.linksComerciais.map(item => item.urlOriginal), [meliA, meliB]);
  assert.deepStrictEqual(resultado.metadata.linksComerciais.map(item => item.urlAfiliadaWorkspace), [afiliadoA, afiliadoB]);
  assert(resultado.metadata.linksComerciais.every(item => item.renderizavel === true));
}

async function testarAmazonProdutoAssinatura() {
  const produto = "https://www.amazon.com.br/dp/B0PRODUTO";
  const assinatura = "https://www.amazon.com.br/subscribe-save/dp/B0ASSINA";
  const afiliadoProduto = "https://amzn.to/produto-d1";
  const afiliadoAssinatura = "https://amzn.to/assinatura-d1";
  const chamadas = [];

  const resultado = await importarAmazonEngine({
    job: { id: 21, evento_id: 22, cliente_id: "Wolf" },
    evento: { texto_original: `Amazon\n${produto}\n${assinatura}`, marketplace: "amazon" },
    links: [ocorrencia(produto, 1, "produto"), ocorrencia(assinatura, 2, "assinatura")],
    deps: {
      getIntegracaoCliente: () => ({ credenciais: { trackingId: "wolf-20" } }),
      importarAmazon: async (url) => {
        chamadas.push(url);
        return {
          titulo: url === produto ? "Produto Amazon" : "Assinatura Amazon",
          precoAtual: "88",
          imagem: "https://img.test/amazon.jpg",
          linkAfiliado: url === produto ? afiliadoProduto : afiliadoAssinatura,
          linkFinal: url === produto ? afiliadoProduto : afiliadoAssinatura,
          link: url === produto ? afiliadoProduto : afiliadoAssinatura,
          categoria: "Mercado"
        };
      }
    }
  });

  assert.strictEqual(resultado.ok, true);
  assert.deepStrictEqual(chamadas, [produto, assinatura]);
  assert.deepStrictEqual(resultado.metadata.linksComerciais.map(item => item.urlOriginal), [produto, assinatura]);
  assert.deepStrictEqual(resultado.metadata.linksComerciais.map(item => item.urlAfiliadaWorkspace), [afiliadoProduto, afiliadoAssinatura]);
}

async function testarKabumAwinDeeplinksDistintos() {
  const destinoA = "https://www.kabum.com.br/produto/111/produto-a";
  const destinoB = "https://www.kabum.com.br/produto/222/produto-b";
  const awinA = `https://www.awin1.com/cread.php?ued=${encodeURIComponent(destinoA)}`;
  const awinB = `https://www.awin1.com/cread.php?ued=${encodeURIComponent(destinoB)}`;
  const afiliadoA = `https://www.awin1.com/cread.php?awinmid=123&ued=${encodeURIComponent(destinoA)}`;
  const afiliadoB = `https://www.awin1.com/cread.php?awinmid=123&ued=${encodeURIComponent(destinoB)}`;
  const deeplinks = [];

  const resultado = await importarAwinEngine({
    job: { id: 31, evento_id: 32, cliente_id: "Roger" },
    evento: { texto_original: `KaBuM\n${awinA}\n${awinB}`, marketplace: "kabum" },
    links: [ocorrencia(awinA, 1), ocorrencia(awinB, 2)],
    deps: {
      getIntegracaoCliente: () => ({ credenciais: { publisherId: "123" } }),
      importarProdutoKabumViaAwin: async (url) => {
        assert.strictEqual(url, destinoA);
        return {
          titulo: "Produto Kabum A",
          precoAtual: "999",
          imagem: "https://img.test/kabum.jpg",
          linkAfiliado: afiliadoA,
          linkFinal: afiliadoA,
          link: afiliadoA,
          categoria: "Hardware"
        };
      },
      gerarDeepLinkAwin: async (url, clienteId) => {
        deeplinks.push({ url, clienteId });
        return url === destinoA ? afiliadoA : url === destinoB ? afiliadoB : "";
      }
    }
  });

  assert.strictEqual(resultado.ok, true);
  assert.deepStrictEqual(deeplinks, [{ url: destinoB, clienteId: "Roger" }]);
  assert.deepStrictEqual(resultado.metadata.linksComerciais.map(item => item.urlOriginal), [destinoA, destinoB]);
  assert.deepStrictEqual(resultado.metadata.linksComerciais.map(item => item.urlAfiliadaWorkspace), [afiliadoA, afiliadoB]);
  assert(resultado.metadata.linksComerciais[0].urlAfiliadaWorkspace.includes(encodeURIComponent(destinoA)));
  assert(resultado.metadata.linksComerciais[1].urlAfiliadaWorkspace.includes(encodeURIComponent(destinoB)));
}

async function testarAliExpressAppPcProduto() {
  const app = "https://a.aliexpress.com/_appD1";
  const pc = "https://www.aliexpress.com/item/1005001234567890.html?via=pc";
  const produto = "https://www.aliexpress.com/item/1005001234567890.html?via=produto";
  const afiliadoApp = "https://s.click.aliexpress.com/e/_APPD1";
  const afiliadoPc = "https://s.click.aliexpress.com/e/_PCD1";
  const afiliadoProduto = "https://s.click.aliexpress.com/e/_PRODUTOD1";
  const chamadas = [];

  const resultado = await importarAliExpressEngine({
    job: { id: 36, evento_id: 37, cliente_id: "D1" },
    evento: {
      texto_original: [
        "AliExpress APP PC Produto",
        "Por R$ 120",
        `APP: ${app}`,
        `PC: ${pc}`,
        `Produto: ${produto}`
      ].join("\n"),
      marketplace: "aliexpress"
    },
    links: [
      { url_original: app, metadata: { papelLink: "link_app", papelLinkMotivo: "app_explicito" } },
      { url_original: pc, metadata: { papelLink: "link_pc", papelLinkMotivo: "pc_explicito" } },
      { url_original: produto, metadata: { papelLink: "produto", papelLinkMotivo: "produto_explicito" } }
    ],
    deps: {
      getIntegracaoCliente: () => ({ credenciais: { appKey: "app", secret: "secret", trackingId: "d1" } }),
      importarAliExpress: async (url, config = {}) => {
        chamadas.push(url);
        return {
          marketplace: "aliexpress",
          titulo: "AliExpress APP PC Produto",
          productId: "1005001234567890",
          precoAtual: "120.00",
          linkOriginal: url,
          linkAfiliado: url === app ? afiliadoApp : url === pc ? afiliadoPc : afiliadoProduto,
          metadata: { papelLink: config.contextoEngine?.papelLink || "" }
        };
      }
    }
  });

  assert.strictEqual(resultado.ok, true);
  assert.deepStrictEqual(chamadas, [pc, app, produto]);
  const links = resultado.metadata.linksClassificados;
  assert.deepStrictEqual(links.map(item => item.papelLink), ["link_app", "link_pc", "produto"]);
  assert.deepStrictEqual(links.map(item => item.urlAfiliada), [afiliadoApp, afiliadoPc, afiliadoProduto]);
  assert(links.every(item => item.renderizavel === true));
}

async function testarDuplicadoReusaConversaoMasPreservaOcorrencia() {
  const produto = "https://www.amazon.com.br/dp/B0CLONE";
  const afiliado = "https://amzn.to/clone-d1";
  const chamadas = [];

  const resultado = await importarAmazonEngine({
    job: { id: 41, evento_id: 42, cliente_id: "D1" },
    evento: { texto_original: `Amazon clone\n${produto}\n${produto}`, marketplace: "amazon" },
    links: [ocorrencia(produto, 1), ocorrencia(produto, 2)],
    deps: {
      getIntegracaoCliente: () => ({ credenciais: { trackingId: "d1-20" } }),
      importarAmazon: async (url) => {
        chamadas.push(url);
        return {
          titulo: "Produto Amazon Clone",
          precoAtual: "77",
          imagem: "https://img.test/clone.jpg",
          linkAfiliado: afiliado,
          linkFinal: afiliado,
          link: afiliado,
          categoria: "Casa"
        };
      }
    }
  });

  assert.strictEqual(resultado.ok, true);
  assert.deepStrictEqual(chamadas, [produto], "duplicado pode reutilizar uma conversao tecnica");
  assert.deepStrictEqual(resultado.metadata.linksComerciais.map(item => item.urlOriginal), [produto, produto]);
  assert.deepStrictEqual(resultado.metadata.linksComerciais.map(item => item.urlAfiliadaWorkspace), [afiliado, afiliado]);
  assert.deepStrictEqual(resultado.metadata.linksComerciais.map(item => item.ordemCaptura), [1, 2]);
}

async function testarFalhaNaoVazaOriginal() {
  const produto = "https://www.amazon.com.br/dp/B0OK";
  const assinatura = "https://www.amazon.com.br/subscribe-save/dp/B0FALHA";
  const afiliadoProduto = "https://amzn.to/produto-ok";

  const resultado = await importarAmazonEngine({
    job: { id: 51, evento_id: 52, cliente_id: "D1" },
    evento: { texto_original: `Amazon falha\n${produto}\n${assinatura}`, marketplace: "amazon" },
    links: [ocorrencia(produto, 1), ocorrencia(assinatura, 2, "assinatura")],
    deps: {
      getIntegracaoCliente: () => ({ credenciais: { trackingId: "d1-20" } }),
      importarAmazon: async (url) => ({
        titulo: "Produto Amazon",
        precoAtual: "77",
        imagem: "https://img.test/falha.jpg",
        linkAfiliado: url === produto ? afiliadoProduto : "",
        linkFinal: url === produto ? afiliadoProduto : "",
        link: url === produto ? afiliadoProduto : "",
        categoria: "Casa"
      })
    }
  });

  assert.strictEqual(resultado.ok, true);
  const falha = resultado.metadata.linksComerciais[1];
  assert.strictEqual(falha.urlOriginal, assinatura);
  assert.strictEqual(falha.urlAfiliadaWorkspace, "");
  assert.strictEqual(falha.renderizavel, false);
  assert.strictEqual(falha.conversaoStatus, "falhou");
}

async function main() {
  await testarMercadoLivreAB();
  await testarAmazonProdutoAssinatura();
  await testarKabumAwinDeeplinksDistintos();
  await testarAliExpressAppPcProduto();
  await testarDuplicadoReusaConversaoMasPreservaOcorrencia();
  await testarFalhaNaoVazaOriginal();
  console.log("link-conversao-ocorrencia-marketplaces.test.js OK");
}

main().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
