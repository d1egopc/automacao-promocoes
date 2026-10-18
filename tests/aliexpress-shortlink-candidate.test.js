const assert = require("assert");

const {
  classificarLinkEngine,
  escolherProdutoPrincipal
} = require("../modules/engine/link-role.service");
const { importarAliExpressEngine } = require("../modules/engine/importer/adapters/aliexpress.adapter");

function testarClassificacaoShortlink() {
  const evento = {
    texto_original: "Si buscáis una oferta: https://s.click.aliexpress.com/e/_c4PD1Uyd",
    links_extraidos: ["https://s.click.aliexpress.com/e/_c4PD1Uyd"]
  };

  const shortlink = "https://s.click.aliexpress.com/e/_c4PD1Uyd";
  const classificacao = classificarLinkEngine({
    marketplace: "aliexpress",
    evento,
    link: { url_original: shortlink }
  });

  assert.strictEqual(classificacao.papelLink, "produto");
  assert.strictEqual(classificacao.motivo, "aliexpress_shortlink_candidato");

  const escolhido = escolherProdutoPrincipal([
    { url: shortlink, link: { url_original: shortlink }, campo: "url_original" }
  ], "aliexpress", evento);
  assert.strictEqual(escolhido.url, shortlink);
  assert.strictEqual(escolhido.papelLink, "produto");

  const appShortlink = "https://a.aliexpress.com/_c2yzBVlz";
  assert.strictEqual(classificarLinkEngine({
    marketplace: "aliexpress",
    evento: { texto_original: appShortlink },
    link: { url_original: appShortlink }
  }).papelLink, "produto");

  const hostFalso = "https://s.click.aliexpress.com.evil.example/e/_c4PD1Uyd";
  assert.notStrictEqual(classificarLinkEngine({
    marketplace: "aliexpress",
    evento: { texto_original: hostFalso },
    link: { url_original: hostFalso }
  }).papelLink, "produto");

  const campanhaSemShortlink = "https://www.aliexpress.com/promotion/campaign";
  assert.strictEqual(classificarLinkEngine({
    marketplace: "aliexpress",
    evento: { texto_original: campanhaSemShortlink },
    link: { url_original: campanhaSemShortlink }
  }).papelLink, "campanha");
}

async function testarAfiliacaoIncompletaSemAfrouxarGate() {
  const app = "https://m.aliexpress.com/p/coin-index/index.html?productIds=1005012689379802";
  const pc = "https://pt.aliexpress.com/item/1005012689379802.html";
  const resultado = await importarAliExpressEngine({
    job: { id: "fixture_164958", evento_id: "fixture_164958", cliente_id: "workspace_fixture", marketplace: "aliexpress" },
    evento: {
      texto_original: `Link APP: ${app}\nPelo PC: ${pc}`,
      links_extraidos: [app, pc]
    },
    links: [
      { url_original: app, ordemCaptura: 1 },
      { url_original: pc, ordemCaptura: 2 }
    ],
    deps: {
      getIntegracaoCliente: () => ({ credenciais: { appKey: "app", secret: "secret", trackingId: "tracking" } }),
      importarAliExpress: async (url, config = {}) => {
        const papel = config.contextoEngine?.papelLink || "link_pc";
        const convertida = papel === "link_pc";
        const afiliado = convertida ? "https://s.click.aliexpress.com/e/_workspace_pc" : "";
        return {
          marketplace: "aliexpress",
          titulo: "Produto fixture",
          productId: "1005012689379802",
          precoAtual: "262,87",
          linkOriginal: url,
          linkAfiliado: afiliado,
          imagem: "https://ae01.alicdn.com/fixture.jpg",
          metadata: {
            papelLink: papel,
            afiliacaoWorkspace: {
              workspaceId: "workspace_fixture",
              appKey: "app",
              trackingIdEnviado: "tracking",
              origemConversao: "workspace_api",
              conversaoStatus: convertida ? "convertida" : "falhou",
              urlAfiliadaWorkspace: afiliado,
              motivoConversao: convertida ? "link_api_convertido" : "link_api_sem_retorno"
            }
          }
        };
      }
    }
  });

  assert.strictEqual(resultado.ok, false);
  assert.strictEqual(resultado.motivo, "afiliacao_workspace_incompleta");
}

async function testarShortlinkChegaAoAdapter() {
  const url = "https://s.click.aliexpress.com/e/_c4PD1Uyd";
  let chamadas = 0;
  const resultado = await importarAliExpressEngine({
    job: { id: "fixture_164957", evento_id: "fixture_164957", cliente_id: "workspace_fixture", marketplace: "aliexpress" },
    evento: { texto_original: `Oferta: ${url}`, links_extraidos: [url] },
    links: [{ url_original: url, ordemCaptura: 1 }],
    deps: {
      getIntegracaoCliente: () => ({ credenciais: { appKey: "app", secret: "secret", trackingId: "tracking" } }),
      importarAliExpress: async (urlRecebida) => {
        chamadas += 1;
        assert.strictEqual(urlRecebida, url);
        return {
          marketplace: "aliexpress",
          titulo: "Produto shortlink",
          productId: "1005012689379802",
          precoAtual: "138,64",
          linkOriginal: url,
          linkAfiliado: "https://s.click.aliexpress.com/e/_workspace_produto",
          imagem: "https://ae01.alicdn.com/fixture.jpg",
          metadata: {
            afiliacaoWorkspace: {
              workspaceId: "workspace_fixture",
              appKey: "app",
              trackingIdEnviado: "tracking",
              origemConversao: "workspace_api",
              conversaoStatus: "convertida",
              urlAfiliadaWorkspace: "https://s.click.aliexpress.com/e/_workspace_produto",
              motivoConversao: "link_api_convertido"
            }
          }
        };
      }
    }
  });

  assert.strictEqual(chamadas, 1);
  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(resultado.produtoId, "1005012689379802");
}

(async () => {
  testarClassificacaoShortlink();
  await testarShortlinkChegaAoAdapter();
  await testarAfiliacaoIncompletaSemAfrouxarGate();
  console.log("aliexpress-shortlink-candidate.test.js OK");
})().catch(error => { console.error(error); process.exitCode = 1; });
