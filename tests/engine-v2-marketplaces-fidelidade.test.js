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
  const chamadasImportador = [];

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
        chamadasImportador.push(url);
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
  assert.deepStrictEqual(chamadasImportador, [produto]);
  assert.strictEqual(resultado.metadata.papelLinkEscolhido, "produto");
  assert.strictEqual(resultado.metadata.linksClassificados[0].papelLink, "cupom");
  assert.strictEqual(resultado.metadata.linksClassificados[1].papelLink, "produto");
}

async function testarShopeeResgateProdutoComParametroLpAff() {
  limparModulo("../modules/engine/importer/adapters/shopee.adapter");
  const { importarShopeeEngine } = require("../modules/engine/importer/adapters/shopee.adapter");
  const resgate = "https://s.shopee.com.br/4LEepvkqdN";
  const produto = "https://s.shopee.com.br/2qPrA9vtrB?lp=aff";
  const chamadasImportador = [];

  const resultado = await importarShopeeEngine({
    job: { id: 114, evento_id: 214, cliente_id: "workspace_teste" },
    evento: {
      texto_original: [
        "Resgate todos os cupons desta pagina:",
        resgate,
        "Smartphone Poco",
        "Por R$ 725",
        "Link produto:",
        produto
      ].join("\n"),
      links_extraidos: [resgate, produto]
    },
    links: [linkRow(1, resgate), linkRow(2, produto)],
    deps: {
      getIntegracaoCliente: () => ({ credenciais: { appId: "app", secret: "secret" } }),
      expandirShortlinkShopee: async () => "",
      gerarShortLinkShopee: async () => ({ ok: false, motivo: "fixture_sem_generate_shortlink" }),
      importarShopee: async (url) => {
        chamadasImportador.push(url);
        return {
          titulo: "Smartphone Poco",
          precoAtual: "725.00",
          imagem: "https://img.test/poco.jpg",
          linkAfiliado: "https://shopee.test/poco-afiliado",
          linkExpandido: "https://shopee.com.br/product/111/222",
          shopId: "111",
          itemId: "222",
          categoria: "celulares"
        };
      }
    }
  });

  assert.strictEqual(resultado.ok, true);
  assert.deepStrictEqual(chamadasImportador, [produto]);
  assert.strictEqual(resultado.metadata.linksClassificados[0].papelLink, "cupom");
  assert.strictEqual(resultado.metadata.linksClassificados[1].papelLink, "produto");
}

async function testarShopeeResgateProdutoSemRotuloExplicito() {
  limparModulo("../modules/engine/importer/adapters/shopee.adapter");
  const { importarShopeeEngine } = require("../modules/engine/importer/adapters/shopee.adapter");
  const resgate = "https://s.shopee.com.br/9zwbROf8sg";
  const produto = "https://s.shopee.com.br/4qE8r7jK78";
  const chamadasImportador = [];

  const resultado = await importarShopeeEngine({
    job: { id: 116, evento_id: 216, cliente_id: "workspace_teste" },
    evento: {
      texto_original: [
        "Memoria Servidor 32GB LEIA A DESCRICAO",
        "R$ 192 - 32GB 8500-1066MHZ",
        "Resgatem o cupom de R$ 25 OFF",
        resgate,
        "",
        "??",
        produto,
        produto
      ].join("\n"),
      links_extraidos: [resgate, produto]
    },
    links: [linkRow(1, resgate), linkRow(2, produto)],
    deps: {
      getIntegracaoCliente: () => ({ credenciais: { appId: "app", secret: "secret" } }),
      expandirShortlinkShopee: async () => "",
      gerarShortLinkShopee: async () => ({ ok: false, motivo: "fixture_sem_generate_shortlink" }),
      importarShopee: async (url) => {
        chamadasImportador.push(url);
        return {
          titulo: "Memoria Servidor 32GB",
          precoAtual: "192.00",
          imagem: "https://img.test/memoria.jpg",
          linkAfiliado: "https://shopee.test/memoria-afiliado",
          linkExpandido: "https://shopee.com.br/product/333/444",
          shopId: "333",
          itemId: "444",
          categoria: "informatica"
        };
      }
    }
  });

  assert.strictEqual(resultado.ok, true);
  assert.deepStrictEqual(chamadasImportador, [produto]);
  assert.strictEqual(resultado.metadata.linksClassificados[0].papelLink, "cupom");
  assert.strictEqual(resultado.metadata.linksClassificados[1].papelLink, "produto");
  assert.strictEqual(resultado.metadata.linksClassificados[1].papelLinkMotivo, "contexto_produto_apos_resgate_shopee");
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
  assert.strictEqual(resultado.metadata.ambiguidadeLinksProduto, true);
  assert.strictEqual(resultado.metadata.totalCandidatosProduto, 2);
}

async function testarShopeePreservaPrecoRadarQuandoApiIncompativel() {
  limparModulo("../modules/engine/importer/adapters/shopee.adapter");
  const { importarShopeeEngine } = require("../modules/engine/importer/adapters/shopee.adapter");
  const resgate = "https://s.shopee.com.br/8AUdMMNQf9";
  const produto = "https://s.shopee.com.br/6AjsAU1PXA";

  const resultado = await importarShopeeEngine({
    job: { id: 119, evento_id: 219, cliente_id: "workspace_teste" },
    evento: {
      texto_original: [
        "Wi-Fi Placa Mae Msi B550m Pro-vdh Wifi Ddr4 Socket Am4 Cor Preto",
        "R$ 611",
        `Resgate o cupom R$ 50 OFF: ${resgate}`,
        "Link do produto:",
        produto
      ].join("\n"),
      links_extraidos: [resgate, produto]
    },
    links: [linkRow(1, resgate), linkRow(2, produto)],
    deps: {
      getIntegracaoCliente: () => ({ credenciais: { appId: "app", secret: "secret" } }),
      expandirShortlinkShopee: async () => "",
      gerarShortLinkShopee: async () => ({ ok: false, motivo: "fixture_sem_generate_shortlink" }),
      importarShopee: async () => ({
        titulo: "Wi-Fi Placa Mae Msi B550m Pro-vdh Wifi Ddr4 Socket Am4 Cor Preto",
        precoAtual: "7,19",
        imagem: "https://img.test/placa.jpg",
        linkAfiliado: "https://shopee.test/placa-afiliada",
        linkExpandido: "https://shopee.com.br/product/123/789",
        shopId: "123",
        itemId: "789",
        categoria: "Gamer e Hardware"
      })
    }
  });

  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(resultado.preco, 611);
  assert.strictEqual(resultado.metadata.precoRadarUsado, true);
  assert.strictEqual(resultado.metadata.papelLinkEscolhido, "produto");
  assert.strictEqual(resultado.metadata.linksAuxiliaresShopee.length, 1);
}

async function testarClassificacaoAliExpressPreservaProduto() {
  const { importarAliExpressEngine } = require("../modules/engine/importer/adapters/aliexpress.adapter");
  const moedas = "https://a.aliexpress.com/_c2zipJlH";
  const produto = "https://a.aliexpress.com/_c35XhGGR";
  const urlsImportadas = [];

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
        urlsImportadas.push(url);
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
  assert.strictEqual(resultado.metadata.linkOriginalEngine, produto);
  assert.strictEqual(urlsImportadas[0], produto);
  assert.ok(urlsImportadas.includes(moedas), "link_moedas tambem deve passar por conversao controlada");
  assert.strictEqual(resultado.metadata.papelLinkEscolhido, "produto");
  assert.strictEqual(resultado.metadata.linksClassificados[0].papelLink, "link_moedas");
  assert.strictEqual(resultado.metadata.linksClassificados[1].papelLink, "produto");
}

async function testarAliExpressAppPcPreservaAmbosComoComerciais() {
  limparModulo("../modules/engine/importer/adapters/aliexpress.adapter");
  const { importarAliExpressEngine } = require("../modules/engine/importer/adapters/aliexpress.adapter");
  const app = "https://a.aliexpress.com/_c37JTNLV";
  const pc = "https://a.aliexpress.com/_c4b9dLcf";
  const urlsImportadas = [];

  const resultado = await importarAliExpressEngine({
    job: { id: 115, evento_id: 215, cliente_id: "workspace_teste" },
    evento: {
      texto_original: [
        "Mini PC PUSKILL",
        "Por R$ 227",
        `APP: ${app}`,
        app,
        `PC: ${pc}`
      ].join("\n"),
      links_extraidos: [app, app, pc]
    },
    links: [
      { ...linkRow(1, app), marketplace_detectado: "aliexpress" },
      { ...linkRow(2, app), marketplace_detectado: "aliexpress" },
      { ...linkRow(3, pc), marketplace_detectado: "aliexpress" }
    ],
    deps: {
      getIntegracaoCliente: () => ({ credenciais: { appKey: "app", secret: "secret", trackingId: "track" } }),
      importarAliExpress: async (url) => {
        urlsImportadas.push(url);
        return {
          titulo: "Mini PC PUSKILL",
          precoAtual: "227.00",
          imagem: "https://img.test/puskill.jpg",
          linkAfiliado: url === pc ? "https://s.click.aliexpress.com/e/_pcPuskillD1" : "https://s.click.aliexpress.com/e/_appPuskillD1",
          linkExpandido: "https://www.aliexpress.com/item/1005002222222222.html",
          categoria: "informatica"
        };
      }
    }
  });

  assert.strictEqual(resultado.ok, true);
  assert.deepStrictEqual(urlsImportadas, [pc, app]);
  const apps = resultado.metadata.linksClassificados.filter(item => item.papelLink === "link_app");
  const appRenderizavel = apps.filter(item => item.renderizavel === true);
  const pcRenderizavel = resultado.metadata.linksClassificados.find(item => item.papelLink === "link_pc");
  assert.strictEqual(apps.length, 2);
  assert.strictEqual(appRenderizavel.length, 2);
  assert.strictEqual(appRenderizavel[0].papelLinkMotivo, "contexto_link_app_aliexpress");
  assert.strictEqual(appRenderizavel[0].urlAfiliada, "https://s.click.aliexpress.com/e/_appPuskillD1");
  assert.strictEqual(appRenderizavel[1].urlAfiliada, "https://s.click.aliexpress.com/e/_appPuskillD1");
  assert.strictEqual(appRenderizavel[0].conversaoWorkspace.motivo, "cta_app_workspace_convertido_produto_canonico");
  assert.strictEqual(appRenderizavel[0].conversaoWorkspace.produtoCanonico, "1005002222222222");
  assert.strictEqual(appRenderizavel[0].conversaoWorkspace.produtoCanonicoPrincipal, "1005002222222222");
  assert.strictEqual(pcRenderizavel.urlAfiliada, "https://s.click.aliexpress.com/e/_pcPuskillD1");
}

async function testarAliExpressAppPcRenderizaAppComProvaObjetiva() {
  limparModulo("../modules/engine/importer/adapters/aliexpress.adapter");
  const { importarAliExpressEngine } = require("../modules/engine/importer/adapters/aliexpress.adapter");
  const app = "https://a.aliexpress.com/_appValidado";
  const pc = "https://a.aliexpress.com/_pcValidado";
  const urlsImportadas = [];

  const resultado = await importarAliExpressEngine({
    job: { id: 116, evento_id: 216, cliente_id: "workspace_teste" },
    evento: {
      texto_original: [
        "WiFi 6E AX210 PCI Express + Bluetooth 5.3",
        "Valor: R$ 293 + 66 moedas",
        `App: ${app}`,
        `PC: ${pc}`
      ].join("\n"),
      links_extraidos: [app, pc]
    },
    links: [
      { ...linkRow(1, app), marketplace_detectado: "aliexpress" },
      { ...linkRow(2, pc), marketplace_detectado: "aliexpress" }
    ],
    deps: {
      getIntegracaoCliente: () => ({ credenciais: { appKey: "app", secret: "secret", trackingId: "track" } }),
      importarAliExpress: async (url, opcoes = {}) => {
        urlsImportadas.push(url);
        return {
          titulo: "WiFi 6E AX210 PCI Express + Bluetooth 5.3",
          precoAtual: "293.00",
          imagem: "https://img.test/wifi.jpg",
          linkAfiliado: url === pc ? "https://s.click.aliexpress.com/e/_pcWifiD1" : "https://s.click.aliexpress.com/e/_appWifiD1",
          linkExpandido: "https://www.aliexpress.com/item/1005007777777777.html",
          categoria: "AliExpress",
          contextoRecebido: opcoes?.contextoEngine?.papelLink || ""
        };
      }
    }
  });

  assert.strictEqual(resultado.ok, true);
  assert.deepStrictEqual(urlsImportadas, [pc, app]);
  const linkApp = resultado.metadata.linksClassificados.find(item => item.papelLink === "link_app");
  const linkPc = resultado.metadata.linksClassificados.find(item => item.papelLink === "link_pc");
  assert.strictEqual(linkApp.renderizavel, true);
  assert.strictEqual(linkApp.conversaoWorkspace.motivo, "cta_app_workspace_convertido_produto_canonico");
  assert.strictEqual(linkApp.urlAfiliada, "https://s.click.aliexpress.com/e/_appWifiD1");
  assert.strictEqual(linkApp.conversaoWorkspace.produtoCanonico, "1005007777777777");
  assert.strictEqual(linkApp.conversaoWorkspace.produtoCanonicoPrincipal, "1005007777777777");
  assert.strictEqual(linkPc.renderizavel, true);
  assert.strictEqual(linkPc.urlAfiliada, "https://s.click.aliexpress.com/e/_pcWifiD1");
}

async function testarAliExpressAppNaoReutilizaUrlAfiliadaPc() {
  limparModulo("../modules/engine/importer/adapters/aliexpress.adapter");
  const { importarAliExpressEngine } = require("../modules/engine/importer/adapters/aliexpress.adapter");
  const app = "https://a.aliexpress.com/_appMesmoCtaPc";
  const pc = "https://a.aliexpress.com/_pcMesmoCta";

  const resultado = await importarAliExpressEngine({
    job: { id: 124, evento_id: 224, cliente_id: "workspace_teste" },
    evento: {
      texto_original: [
        "Produto AliExpress Mesmo CTA",
        "Valor: R$ 199",
        `App: ${app}`,
        `PC: ${pc}`
      ].join("\n"),
      links_extraidos: [app, pc]
    },
    links: [
      { ...linkRow(1, app), marketplace_detectado: "aliexpress" },
      { ...linkRow(2, pc), marketplace_detectado: "aliexpress" }
    ],
    deps: {
      getIntegracaoCliente: () => ({ credenciais: { appKey: "app", secret: "secret", trackingId: "track" } }),
      importarAliExpress: async () => ({
        titulo: "Produto AliExpress Mesmo CTA",
        precoAtual: "199.00",
        imagem: "https://img.test/mesmo-cta.jpg",
        linkAfiliado: "https://s.click.aliexpress.com/e/_mesmoCtaD1",
        linkExpandido: "https://www.aliexpress.com/item/1005001234567890.html",
        categoria: "AliExpress"
      })
    }
  });

  assert.strictEqual(resultado.ok, true);
  const linkApp = resultado.metadata.linksClassificados.find(item => item.papelLink === "link_app");
  const linkPc = resultado.metadata.linksClassificados.find(item => item.papelLink === "link_pc");
  assert.strictEqual(linkPc.renderizavel, true);
  assert.strictEqual(linkPc.urlAfiliada, "https://s.click.aliexpress.com/e/_mesmoCtaD1");
  assert.strictEqual(linkApp.renderizavel, false);
  assert.strictEqual(linkApp.urlAfiliada, "");
  assert.strictEqual(linkApp.conversaoWorkspace.motivo, "link_app_url_afiliada_igual_pc");
}
async function testarAliExpressAppAfiliadoDivergenteNaoRenderiza() {
  limparModulo("../modules/engine/importer/adapters/aliexpress.adapter");
  const { importarAliExpressEngine } = require("../modules/engine/importer/adapters/aliexpress.adapter");
  const app = "https://a.aliexpress.com/_appOutroProduto";
  const pc = "https://a.aliexpress.com/_pcProdutoCorreto";
  const urlsImportadas = [];

  const resultado = await importarAliExpressEngine({
    job: { id: 122, evento_id: 222, cliente_id: "workspace_teste" },
    evento: {
      texto_original: [
        "WiFi 6E AX210 PCI Express + Bluetooth 5.3",
        "Valor: R$ 293 + 66 moedas",
        `App: ${app}`,
        `PC: ${pc}`
      ].join("\n"),
      links_extraidos: [app, pc]
    },
    links: [
      { ...linkRow(1, app), marketplace_detectado: "aliexpress" },
      { ...linkRow(2, pc), marketplace_detectado: "aliexpress" }
    ],
    deps: {
      getIntegracaoCliente: () => ({ credenciais: { appKey: "app", secret: "secret", trackingId: "track" } }),
      importarAliExpress: async (url, opcoes = {}) => {
        urlsImportadas.push(url);
        return {
          titulo: "WiFi 6E AX210 PCI Express + Bluetooth 5.3",
          precoAtual: "293.00",
          imagem: url === pc ? "https://img.test/wifi-pc.jpg" : "https://img.test/wifi-app.jpg",
          linkAfiliado: url === pc ? "https://s.click.aliexpress.com/e/_pcWifiD1" : "https://s.click.aliexpress.com/e/_appOutroD1",
          linkExpandido: url === pc
            ? "https://www.aliexpress.com/item/1005007777777777.html"
            : "https://www.aliexpress.com/item/1005009999999999.html",
          categoria: "AliExpress",
          conversaoAppValidada: opcoes?.contextoEngine?.papelLink === "link_app"
        };
      }
    }
  });

  assert.strictEqual(resultado.ok, true);
  assert.deepStrictEqual(urlsImportadas, [pc, app]);
  assert.strictEqual(resultado.imagem, "https://img.test/wifi-pc.jpg");
  const linkApp = resultado.metadata.linksClassificados.find(item => item.papelLink === "link_app");
  const linkPc = resultado.metadata.linksClassificados.find(item => item.papelLink === "link_pc");
  assert.strictEqual(linkPc.renderizavel, true);
  assert.strictEqual(linkPc.conversaoWorkspace.produtoCanonico, "1005007777777777");
  assert.strictEqual(linkApp.renderizavel, false);
  assert.strictEqual(linkApp.urlAfiliada, "");
  assert.strictEqual(linkApp.conversaoWorkspace.motivo, "produto_canonico_divergente");
  assert.strictEqual(linkApp.conversaoWorkspace.produtoCanonicoPrincipal, "1005007777777777");
  assert.strictEqual(linkApp.conversaoWorkspace.produtoCanonico, "1005009999999999");
}
async function testarAliExpressUsaPrecoRadarQuandoApiNaoRetornaPreco() {
  limparModulo("../modules/engine/importer/adapters/aliexpress.adapter");
  const { importarAliExpressEngine } = require("../modules/engine/importer/adapters/aliexpress.adapter");
  const app = "https://a.aliexpress.com/_c3WQGDsT";
  const pc = "https://a.aliexpress.com/_c3yGqeR9";

  const resultado = await importarAliExpressEngine({
    job: { id: 117, evento_id: 217, cliente_id: "workspace_teste" },
    evento: {
      texto_original: [
        "Processador Ryzen 3 2200G PRO CPU R3 DDR4 AM4",
        "?? R$ 156",
        "Cupom: IFPRW9YO ou BRAE1 + 55 moedas no APP",
        app,
        "NO PC",
        pc
      ].join("\n"),
      links_extraidos: [app, pc]
    },
    links: [
      { ...linkRow(1, app), marketplace_detectado: "aliexpress" },
      { ...linkRow(2, pc), marketplace_detectado: "aliexpress" }
    ],
    deps: {
      getIntegracaoCliente: () => ({ credenciais: { appKey: "app", secret: "secret", trackingId: "track" } }),
      importarAliExpress: async () => ({
        titulo: "Processador Ryzen 3 2200G PRO CPU R3 DDR4 AM4",
        precoAtual: "",
        imagem: "https://img.test/ryzen.jpg",
        linkAfiliado: "https://ali.test/ryzen-afiliado",
        linkExpandido: "https://www.aliexpress.com/item/1005003333333333.html",
        categoria: "informatica"
      })
    }
  });

  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(resultado.precoAtual, 156);
  assert.strictEqual(resultado.precoOrigem, "texto_radar");
  assert.strictEqual(resultado.metadata.precoRadarUsado, true);
}

async function testarAliExpressNaoUsaCupomComoPrecoRadar() {
  limparModulo("../modules/engine/importer/adapters/aliexpress.adapter");
  const { importarAliExpressEngine } = require("../modules/engine/importer/adapters/aliexpress.adapter");
  const app = "https://a.aliexpress.com/_c3WQGDsT";

  const resultado = await importarAliExpressEngine({
    job: { id: 118, evento_id: 218, cliente_id: "workspace_teste" },
    evento: {
      texto_original: [
        "Produto AliExpress sem preco",
        "Cupom R$ 25 OFF: ALI25",
        `APP: ${app}`
      ].join("\n"),
      links_extraidos: [app]
    },
    links: [{ ...linkRow(1, app), marketplace_detectado: "aliexpress" }],
    deps: {
      getIntegracaoCliente: () => ({ credenciais: { appKey: "app", secret: "secret", trackingId: "track" } }),
      importarAliExpress: async () => ({
        titulo: "Produto AliExpress sem preco",
        precoAtual: "",
        imagem: "https://img.test/sem-preco.jpg",
        linkAfiliado: "https://ali.test/sem-preco",
        linkExpandido: "https://www.aliexpress.com/item/1005003333333334.html",
        categoria: "informatica"
      })
    }
  });

  assert.strictEqual(resultado.ok, false);
  assert.strictEqual(resultado.motivo, "preco_indisponivel");
}

async function testarAliExpressReconheceRotuloNaLinhaAnterior() {
  limparModulo("../modules/engine/importer/adapters/aliexpress.adapter");
  const { importarAliExpressEngine } = require("../modules/engine/importer/adapters/aliexpress.adapter");
  const moedas = "https://a.aliexpress.com/_c2z4gv3d";
  const pc = "https://a.aliexpress.com/_c4SNvGyb";
  const urlsImportadas = [];

  const resultado = await importarAliExpressEngine({
    job: { id: 120, evento_id: 220, cliente_id: "workspace_teste" },
    evento: {
      texto_original: [
        "Netac 512gb ssd sata3 2.5 BLACK",
        "512GB por R$ 354,74 (67 moedas)",
        "Link com moedas:",
        moedas,
        "Link para PC:",
        pc
      ].join("\n"),
      links_extraidos: [moedas, pc]
    },
    links: [
      { ...linkRow(1, moedas), marketplace_detectado: "aliexpress" },
      { ...linkRow(2, pc), marketplace_detectado: "aliexpress" }
    ],
    deps: {
      getIntegracaoCliente: () => ({ credenciais: { appKey: "app", secret: "secret", trackingId: "track" } }),
      importarAliExpress: async (url) => {
        urlsImportadas.push(url);
        return {
          titulo: "Netac 512gb ssd sata3 2.5 BLACK",
          precoAtual: "",
          imagem: "https://img.test/netac.jpg",
          linkAfiliado: "https://ali.test/netac-afiliado",
          linkExpandido: "https://www.aliexpress.com/item/1005005555555555.html",
          categoria: "AliExpress"
        };
      }
    }
  });

  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(urlsImportadas[0], pc);
  assert.ok(urlsImportadas.includes(moedas), "link_moedas tambem deve passar por conversao controlada");
  assert.strictEqual(resultado.precoAtual, 354.74);
  assert.strictEqual(resultado.metadata.linksClassificados[0].papelLink, "link_moedas");
  assert.strictEqual(resultado.metadata.linksClassificados[1].papelLink, "link_pc");
  assert.strictEqual(resultado.metadata.precoRadarUsado, true);
}

async function testarAliExpressBinnuneUsaPrecoRadarEstruturadoEDescartaAuxiliar() {
  limparModulo("../modules/engine/importer/adapters/aliexpress.adapter");
  const { importarAliExpressEngine } = require("../modules/engine/importer/adapters/aliexpress.adapter");
  const auxiliar = "https://cutt.ly/headset-binnune";
  const app = "https://a.aliexpress.com/_c3MLcDkb";
  const pc = "https://a.aliexpress.com/_c3j35EmF";
  const urlsImportadas = [];

  const resultado = await importarAliExpressEngine({
    job: { id: 121, evento_id: 221, cliente_id: "workspace_teste" },
    evento: {
      texto_original: [
        "HEADSET SEM FIO ACINACI BL100",
        "Cupom: IFPHHBVW ou BRAE1",
        `Confira mais: ${auxiliar}`,
        `Link APP: ${app}`,
        `Link PC: ${pc}`
      ].join("\n"),
      links_extraidos: [auxiliar, app, pc],
      metadata: {
        radarMirror: {
          preco: { atualCapturado: 112 },
          texto: { original: "HEADSET SEM FIO ACINACI BL100" }
        }
      }
    },
    links: [
      { ...linkRow(1, auxiliar), marketplace_detectado: "desconhecido" },
      { ...linkRow(2, app), marketplace_detectado: "aliexpress" },
      { ...linkRow(3, pc), marketplace_detectado: "aliexpress" }
    ],
    deps: {
      getIntegracaoCliente: () => ({ credenciais: { appKey: "app", secret: "secret", trackingId: "track" } }),
      importarAliExpress: async (url) => {
        urlsImportadas.push(url);
        return {
          titulo: "HEADSET SEM FIO ACINACI BL100",
          precoAtual: "",
          imagem: "https://img.test/binnune.jpg",
          linkAfiliado: url === pc ? "https://s.click.aliexpress.com/e/_pcBinnuneD1" : "https://s.click.aliexpress.com/e/_appBinnuneD1",
          linkExpandido: "https://www.aliexpress.com/item/1005006666666666.html",
          categoria: "AliExpress"
        };
      }
    }
  });

  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(resultado.precoAtual, 112);
  assert.strictEqual(resultado.precoOrigem, "texto_radar");
  assert.strictEqual(resultado.imagem, "https://img.test/binnune.jpg");
  assert.deepStrictEqual(urlsImportadas, [pc, app]);
  const papeis = resultado.metadata.linksClassificados.map(item => item.papelLink);
  assert.ok(papeis.includes("link_app"));
  assert.ok(papeis.includes("link_pc"));
  const linkApp = resultado.metadata.linksClassificados.find(item => item.papelLink === "link_app");
  const linkPc = resultado.metadata.linksClassificados.find(item => item.papelLink === "link_pc");
  assert.strictEqual(linkApp.renderizavel, true);
  assert.strictEqual(linkApp.urlAfiliada, "https://s.click.aliexpress.com/e/_appBinnuneD1");
  assert.strictEqual(linkApp.conversaoWorkspace.motivo, "cta_app_workspace_convertido_produto_canonico");
  assert.strictEqual(linkPc.renderizavel, true);
  assert.strictEqual(linkPc.urlAfiliada, "https://s.click.aliexpress.com/e/_pcBinnuneD1");
  assert.strictEqual(
    resultado.metadata.linksClassificados.find(item => item.urlOriginal === auxiliar)?.papelLink,
    "desconhecido"
  );
}

async function testarAliExpressEnriquecimentoImagemMoedasEAppProvaObjetiva() {
  limparModulo("../modules/engine/importer/adapters/aliexpress.adapter");
  const { importarAliExpressEngine } = require("../modules/engine/importer/adapters/aliexpress.adapter");
  const { montarItemFilaEngine } = require("../modules/engine/distributor/distributor.service");
  const app = "https://a.aliexpress.com/_appBaseus";
  const pc = "https://a.aliexpress.com/_pcBaseus";

  const resultado = await importarAliExpressEngine({
    job: { id: 122, evento_id: 222, cliente_id: "user_40qdblgt" },
    evento: {
      texto_original: [
        "Headset Sem Fio Baseus GH02 - Preto",
        "Valor: R$ 247 + 68 moedas",
        "Cupom: OCUPOMDALOJA",
        `App: ${app}`,
        `PC: ${pc}`
      ].join("\n"),
      links_extraidos: [app, pc]
    },
    links: [
      { ...linkRow(1, app), marketplace_detectado: "aliexpress" },
      { ...linkRow(2, pc), marketplace_detectado: "aliexpress" }
    ],
    deps: {
      getIntegracaoCliente: () => ({ credenciais: { appKey: "app", secret: "secret", trackingId: "track" } }),
      importarAliExpress: async (url) => ({
        titulo: "Headset Sem Fio Baseus GH02 - Preto",
        precoAtual: "",
        imageUrl: "https://ae01.alicdn.com/kf/baseus-gh02.jpg",
        linkAfiliado: url === pc ? "https://s.click.aliexpress.com/e/_pcBaseusD1" : "https://s.click.aliexpress.com/e/_appBaseusD1",
        linkExpandido: "https://www.aliexpress.com/item/1005008888888888.html",
        categoria: "Perifericos",
        conversaoAppValidada: false
      })
    }
  });

  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(resultado.precoAtual, 247);
  assert.strictEqual(resultado.imagem, "https://ae01.alicdn.com/kf/baseus-gh02.jpg");
  assert.strictEqual(resultado.imagemOrigem, "aliexpress_produto_canonico_pc");
  assert.strictEqual(resultado.moedasTexto, "+68 moedas");
  assert.strictEqual(resultado.beneficioTexto, "+68 moedas");
  assert.strictEqual(resultado.cupom, "OCUPOMDALOJA");
  const linkApp = resultado.metadata.linksClassificados.find(item => item.papelLink === "link_app");
  const linkPc = resultado.metadata.linksClassificados.find(item => item.papelLink === "link_pc");
  assert.strictEqual(linkApp.renderizavel, true);
  assert.strictEqual(linkApp.urlAfiliada, "https://s.click.aliexpress.com/e/_appBaseusD1");
  assert.strictEqual(linkApp.conversaoWorkspace.motivo, "cta_app_workspace_convertido_produto_canonico");
  assert.strictEqual(linkPc.renderizavel, true);

  const itemFila = montarItemFilaEngine({
    ...resultado,
    id: 122,
    cliente_id: "user_40qdblgt"
  });
  assert.strictEqual(itemFila.imagem, "https://ae01.alicdn.com/kf/baseus-gh02.jpg");
  assert.strictEqual(itemFila.beneficioTexto, "+68 moedas");
}

async function testarAliExpressSemImagemContinuaTextual() {
  limparModulo("../modules/engine/importer/adapters/aliexpress.adapter");
  const { importarAliExpressEngine } = require("../modules/engine/importer/adapters/aliexpress.adapter");
  const pc = "https://a.aliexpress.com/_pcSemImagem";

  const resultado = await importarAliExpressEngine({
    job: { id: 123, evento_id: 223, cliente_id: "user_40qdblgt" },
    evento: {
      texto_original: [
        "Webcam EMEET S600",
        "Valor: R$ 347 + 120 moedas",
        "Cupom: BRAE2",
        `PC: ${pc}`
      ].join("\n"),
      links_extraidos: [pc]
    },
    links: [{ ...linkRow(1, pc), marketplace_detectado: "aliexpress" }],
    deps: {
      getIntegracaoCliente: () => ({ credenciais: { appKey: "app", secret: "secret", trackingId: "track" } }),
      importarAliExpress: async () => ({
        titulo: "Webcam EMEET S600",
        precoAtual: "",
        linkAfiliado: "https://s.click.aliexpress.com/e/_pcWebcamD1",
        linkExpandido: "https://www.aliexpress.com/item/1005009999000000.html",
        categoria: "Perifericos"
      })
    }
  });

  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(resultado.imagem, "");
  assert.strictEqual(resultado.moedasTexto, "+120 moedas");
  assert.strictEqual(resultado.beneficioTexto, "+120 moedas");
  assert.strictEqual(resultado.linkAfiliado, "https://s.click.aliexpress.com/e/_pcWebcamD1");
}

function testarPonteIntegridadePreservaPrecoEAppPcAteFila() {
  const { aplicarPonteIntegridadeComercial } = require("../modules/engine/importer/importer.service");
  const { montarItemFilaEngine } = require("../modules/engine/distributor/distributor.service");
  const app = "https://a.aliexpress.com/_c3flfysB";
  const pc = "https://a.aliexpress.com/_c3U2QzT1";
  const ctaD1 = "https://ali.test/ssd-cusu-d1";

  const ponte = aplicarPonteIntegridadeComercial({
    oferta: {
      marketplace: "aliexpress",
      titulo: "SSD CUSU 1TB",
      preco: null,
      linkAfiliado: ctaD1
    },
    ofertaEntrada: {
      metadata: {
        linksClassificados: [
          { urlOriginal: app, papelLink: "link_app", papelLinkMotivo: "contexto_link_app_aliexpress" },
          { urlOriginal: pc, papelLink: "link_pc", papelLinkMotivo: "contexto_link_pc_aliexpress" }
        ]
      }
    },
    metadata: {},
    comercialNormalizado: {
      precoAtual: 347,
      precoOrigem: "texto_radar",
      precoConfiavel: true
    }
  });

  assert.strictEqual(ponte.oferta.preco, 347);
  assert.strictEqual(ponte.metadata.integridadeComercial.precoValidado.valor, 347);
  assert.deepStrictEqual(
    ponte.metadata.linksComerciais.map(item => item.papel),
    ["link_app", "link_pc"]
  );

  const itemFila = montarItemFilaEngine({
    id: 66385,
    uuid: "oferta-ssd-cusu",
    cliente_id: "user_40qdblgt",
    marketplace: "aliexpress",
    titulo: "SSD CUSU 1TB",
    preco: ponte.oferta.preco,
    link_afiliado: ctaD1,
    link_original: app,
    metadata: ponte.metadata
  });

  assert.strictEqual(itemFila.preco, 347);
  assert.strictEqual(itemFila.precoAtual, 347);
  assert.deepStrictEqual(
    itemFila.linksComerciais.map(item => item.papel),
    ["link_app", "link_pc"]
  );
}

function testarPonteIntegridadeKabumAwinMantemSomenteCtaD1Renderizavel() {
  const { montarItemFilaEngine } = require("../modules/engine/distributor/distributor.service");
  const awinTerceiro = "https://www.awin1.com/cread.php?awinmid=17729&awinaffid=1062989&clickref=marcosmx&ued=https%3A%2F%2Fwww.kabum.com.br%2Fproduto%2F1053828";
  const awinD1 = "https://www.awin1.com/cread.php?awinmid=17729&awinaffid=2649374&ued=https%3A%2F%2Fwww.kabum.com.br%2Fproduto%2F1053828";

  const itemFila = montarItemFilaEngine({
    id: 66416,
    uuid: "oferta-ryzen-kabum",
    cliente_id: "user_40qdblgt",
    marketplace: "awin",
    titulo: "Ryzen 7 KaBuM",
    preco: 2340,
    cupom: "GOATS",
    link_afiliado: awinD1,
    link_original: awinTerceiro,
    metadata: {
      integridadeComercial: {
        versao: "v1",
        precoValidado: { valor: 2340, origem: "texto_radar", confiavel: true },
        linksComerciais: [
          {
            papel: "produto",
            urlOriginal: awinTerceiro,
            urlAfiliada: awinD1,
            renderizavel: true,
            seguro: true,
            origem: "adapter.awin"
          }
        ],
        aplicouMudancasOperacionais: false
      }
    }
  });

  assert.strictEqual(itemFila.linkAfiliado, awinD1);
  assert.ok(!itemFila.linkAfiliado.includes("awinaffid=1062989"));
  assert.ok(!itemFila.linkAfiliado.includes("clickref=marcosmx"));
  assert.strictEqual(itemFila.linksComerciais.length, 1);
  assert.strictEqual(itemFila.linksComerciais[0].renderizavel, true);
  assert.strictEqual(itemFila.linksComerciais[0].urlAfiliada, awinD1);
}

async function testarEntradaFilaKabumAwinPreservaMotivoReal() {
  mockModulo("../utils/usuarios-atividade", {
    usuarioAtivo: () => true,
    logUsuarioInativoIgnorado: () => false
  });
  limparModulo("../modules/engine/distributor/distributor.service");
  const { adicionarOfertaNaFilaCliente } = require("../modules/engine/distributor/distributor.service");
  const awinD1 = "https://www.awin1.com/cread.php?awinmid=17729&awinaffid=2649374&ued=https%3A%2F%2Fwww.kabum.com.br%2Fproduto%2F1053828";

  function ofertaKabum(id, titulo, preco) {
    return {
      id,
      job_id: id + 100000,
      uuid: `oferta-kabum-${id}`,
      cliente_id: "user_40qdblgt",
      marketplace: "awin",
      titulo,
      preco,
      preco_atual: preco,
      categoria: "Gamer e Hardware",
      link_afiliado: awinD1,
      link_original: "https://www.awin1.com/cread.php?awinmid=17729&awinaffid=1062989&clickref=fonte&ued=https%3A%2F%2Fwww.kabum.com.br%2Fproduto%2F1053828",
      metadata: {
        integridadeComercial: {
          precoValidado: { valor: preco, origem: "texto_radar", confiavel: true },
          linksComerciais: [
            {
              papel: "produto",
              urlAfiliada: awinD1,
              renderizavel: true,
              seguro: true,
              origem: "adapter.awin"
            }
          ],
          aplicouMudancasOperacionais: false
        }
      }
    };
  }

  const adicionados = [];
  const depsOk = {
    adicionarOfertaNaFilaGlobal: (clienteId, itemFila) => {
      adicionados.push({ clienteId, itemFila });
      return { ok: true, itemFila };
    }
  };

  const aorus = await adicionarOfertaNaFilaCliente(
    ofertaKabum(69136, "Notebook Gamer AORUS 17X AXF", 18999),
    { deps: depsOk }
  );
  const gigabyte = await adicionarOfertaNaFilaCliente(
    ofertaKabum(69135, "Notebook Gamer Gigabyte Gaming A16", 6429),
    { deps: depsOk }
  );

  assert.strictEqual(aorus.ok, true);
  assert.strictEqual(gigabyte.ok, true);
  assert.strictEqual(adicionados.length, 2);
  assert.strictEqual(adicionados[0].itemFila.marketplace, "awin");
  assert.strictEqual(adicionados[0].itemFila.linkAfiliado, awinD1);
  assert.ok(!adicionados[0].itemFila.linkAfiliado.includes("awinaffid=1062989"));

  const duplicada = await adicionarOfertaNaFilaCliente(
    ofertaKabum(69136, "Notebook Gamer AORUS 17X AXF", 18999),
    { deps: { adicionarOfertaNaFilaGlobal: () => ({ ok: false, duplicada: true, motivo: "duplicidade_fila" }) } }
  );
  assert.strictEqual(duplicada.ok, false);
  assert.strictEqual(duplicada.motivo, "duplicidade_fila");

  const semEspaco = await adicionarOfertaNaFilaCliente(
    ofertaKabum(69135, "Notebook Gamer Gigabyte Gaming A16", 6429),
    { deps: { adicionarOfertaNaFilaGlobal: () => ({ ok: false, motivo: "sem_espaco_fila", erro: "ENOSPC: no space left on device, write" }) } }
  );
  assert.strictEqual(semEspaco.ok, false);
  assert.strictEqual(semEspaco.motivo, "sem_espaco_fila");
  assert.ok(semEspaco.erro.includes("ENOSPC"));
}

function testarEntradaFilaMarketplacesOficiaisContinuaPropagando() {
  mockModulo("../utils/usuarios-atividade", {
    usuarioAtivo: () => true,
    logUsuarioInativoIgnorado: () => false
  });
  limparModulo("../modules/engine/distributor/distributor.service");
  const { adicionarOfertaNaFilaCliente } = require("../modules/engine/distributor/distributor.service");
  const marketplaces = ["mercadolivre", "amazon", "shopee", "aliexpress"];

  return Promise.all(marketplaces.map(async (marketplace, idx) => {
    const resultado = await adicionarOfertaNaFilaCliente({
      id: 80000 + idx,
      uuid: `oferta-${marketplace}`,
      cliente_id: "user_40qdblgt",
      marketplace,
      titulo: `Oferta ${marketplace}`,
      preco: 100 + idx,
      categoria: "Gamer e Hardware",
      link_afiliado: `https://example.test/${marketplace}`,
      link_original: `https://origem.test/${marketplace}`
    }, {
      deps: {
        adicionarOfertaNaFilaGlobal: (_clienteId, itemFila) => ({ ok: true, itemFila })
      }
    });

    assert.strictEqual(resultado.ok, true, `${marketplace} deve continuar entrando na fila`);
    assert.strictEqual(resultado.itemFila.marketplace, marketplace);
  }));
}

function testarIndexPreservaMotivoEspecificoDaFila() {
  const fonte = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  assert.ok(fonte.includes("sem_espaco_fila"));
  assert.ok(fonte.includes("no space left on device"));
  assert.ok(fonte.includes("[ENGINE-DISTRIBUIDOR-FILA-ERRO]"));
  assert.ok(fonte.includes("erroSalvarFilaCliente(cliente)"));
}
function testarAwinMetadataCupomNaoBloqueiaUedKabum() {
  const { escolherProdutoPrincipal } = require("../modules/engine/link-role.service");
  const awin = "https://www.awin1.com/cread.php?awinmid=17729&awinaffid=terceiro&clickref=fonte&ued=https%3A%2F%2Fwww.kabum.com.br%2Fproduto%2F536014";
  const escolhido = escolherProdutoPrincipal([
    {
      url: awin,
      campo: "url_original",
      link: {
        url_original: awin,
        metadata: {
          papelLink: "cupom",
          papelLinkMotivo: "contexto_cupom",
          urlProduto: awin
        }
      }
    }
  ], "awin", {
    texto_original: [
      "Headset Gamer Sem Fio HyperX Cloud III",
      "Cupom: HYPERX12",
      "Link do produto:",
      awin
    ].join("\n")
  });

  assert.strictEqual(escolhido.papelLink, "produto");
  assert.strictEqual(escolhido.papelLinkMotivo, "kabum_id_produto_url");
  assert.ok(escolhido.urlProduto.includes("kabum.com.br/produto/536014"));
}

function testarCategoriaMarketplaceGenericaClassificaPorTitulo() {
  const { normalizarOfertaImportada } = require("../modules/engine/importer/importer.service");
  const casos = [
    ["Teclado Mecânico Ajazz X Nacodex NK61 Switch Red", "Periféricos"],
    ["Netac 512gb ssd sata3 2.5 BLACK", "Gamer e Hardware"],
    ["Processador Ryzen 3 2200G PRO CPU R3 DDR4 AM4", "Gamer e Hardware"],
    ["RX 5500 8GB Veineda Pcie 4.0", "Gamer e Hardware"],
    ["HEADSET SEM FIO ACINACI BL100", "Periféricos"]
  ];

  for (const [titulo, categoriaEsperada] of casos) {
    const oferta = normalizarOfertaImportada({
      marketplace: "aliexpress",
      titulo,
      preco: 748,
      categoria: "AliExpress"
    }, { marketplace: "aliexpress" });

    assert.strictEqual(oferta.categoria, categoriaEsperada, `${titulo} deve virar categoria comercial final`);
  }
}

function testarCategoriaAliExpressReclassificaAposTituloRadarFinal() {
  const { reclassificarCategoriaFinalEngine } = require("../modules/engine/importer/importer.service");
  const metadataInicial = {
    inteligenciaUniversalV2: {
      categoria: "Diversos",
      comparativo: { categoriaAntes: "Diversos", categoriaDepois: "Diversos" }
    }
  };

  const resultado = reclassificarCategoriaFinalEngine({
    marketplace: "aliexpress",
    titulo: "Air Cooler Para Xeon Wovibo aRGB",
    categoria: "Diversos"
  }, metadataInicial, { marketplace: "aliexpress" });

  assert.strictEqual(resultado.reclassificada, true);
  assert.strictEqual(resultado.oferta.categoria, "Gamer e Hardware");
  assert.strictEqual(resultado.metadataFinal.inteligenciaUniversalV2.categoria, "Gamer e Hardware");
  assert.strictEqual(resultado.metadataFinal.inteligenciaUniversalV2.comparativo.categoriaDepois, "Gamer e Hardware");

  const wifi = reclassificarCategoriaFinalEngine({
    marketplace: "aliexpress",
    titulo: "WiFi 6E AX210 PCI Express Bluetooth 5.3",
    categoria: "AliExpress"
  }, {}, { marketplace: "aliexpress" });

  assert.strictEqual(wifi.reclassificada, true);
  assert.notStrictEqual(wifi.oferta.categoria, "AliExpress");
  assert.ok(!["AliExpress", "Diversos", ""].includes(wifi.oferta.categoria));
}

function testarCategoriaAliExpressGenericaSemTituloConfiavelNaoInventa() {
  const { reclassificarCategoriaFinalEngine } = require("../modules/engine/importer/importer.service");
  const resultado = reclassificarCategoriaFinalEngine({
    marketplace: "aliexpress",
    titulo: "Produto AliExpress",
    categoria: "Diversos"
  }, {}, { marketplace: "aliexpress" });

  assert.strictEqual(resultado.reclassificada, false);
  assert.strictEqual(resultado.oferta.categoria, "Diversos");
  assert.strictEqual(resultado.motivo, "titulo_generico_indisponivel");
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
  await testarShopeeResgateProdutoComParametroLpAff();
  await testarShopeeResgateProdutoSemRotuloExplicito();
  await testarShopeeShortlinkGenericoChegaAoImportador();
  await testarShopeeCupomSozinhoNaoChamaImportador();
  await testarShopeeTentaProximoCandidatoQuandoPrimeiroNaoConfirmaProduto();
  await testarShopeePreservaPrecoRadarQuandoApiIncompativel();
  await testarClassificacaoAliExpressPreservaProduto();
  await testarAliExpressAppPcPreservaAmbosComoComerciais();
  await testarAliExpressAppPcRenderizaAppComProvaObjetiva();
  await testarAliExpressAppNaoReutilizaUrlAfiliadaPc();
  await testarAliExpressAppAfiliadoDivergenteNaoRenderiza();
  await testarAliExpressUsaPrecoRadarQuandoApiNaoRetornaPreco();
  await testarAliExpressNaoUsaCupomComoPrecoRadar();
  await testarAliExpressReconheceRotuloNaLinhaAnterior();
  await testarAliExpressBinnuneUsaPrecoRadarEstruturadoEDescartaAuxiliar();
  await testarAliExpressEnriquecimentoImagemMoedasEAppProvaObjetiva();
  await testarAliExpressSemImagemContinuaTextual();
  testarPonteIntegridadePreservaPrecoEAppPcAteFila();
  testarPonteIntegridadeKabumAwinMantemSomenteCtaD1Renderizavel();
  await testarEntradaFilaKabumAwinPreservaMotivoReal();
  await testarEntradaFilaMarketplacesOficiaisContinuaPropagando();
  testarIndexPreservaMotivoEspecificoDaFila();
  testarAwinMetadataCupomNaoBloqueiaUedKabum();
  testarCategoriaMarketplaceGenericaClassificaPorTitulo();
  testarCategoriaAliExpressReclassificaAposTituloRadarFinal();
  testarCategoriaAliExpressGenericaSemTituloConfiavelNaoInventa();
  await testarValidacaoKabumComIntegracaoAwinGenerica();
  testarOrquestradorIncluiMarketplacesOficiais();
  console.log("engine-v2-marketplaces-fidelidade.test.js OK");
})().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
