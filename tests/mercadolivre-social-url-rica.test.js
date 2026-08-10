const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const { importarMercadoLivreEngine } = require("../modules/engine/importer/adapters/mercadolivre.adapter");

function carregarHelpersRadarMl() {
  const arquivo = path.join(__dirname, "..", "marketplaces", "inteligencia", "index.js");
  const codigo = fs.readFileSync(arquivo, "utf8");
  const inicio = codigo.indexOf("function limparUrlProdutoRadar");
  const fim = codigo.indexOf("async function extrairProdutoMercadoLivreIntermediarioRadar");
  assert.ok(inicio >= 0 && fim > inicio, "bloco de helpers ML nao encontrado");
  const blocoHelpers = codigo.slice(inicio, fim);
  const contexto = {
    URL,
    module: { exports: {} }
  };
  const fonte = `
    function normalizarMarketplaceRadar(valor) { return String(valor || "").toLowerCase(); }
    function detectarMarketplaceRadarLink() { return "mercadolivre"; }
    ${blocoHelpers}
    module.exports = {
      decodificarUrlExtraidaMercadoLivreRadar,
      normalizarUrlExtraidaMercadoLivreRadar,
      extrairCandidatosPolycardsMercadoLivreRadar,
      extrairProdutoMercadoLivreDeHtmlRadar
    };
  `;

  vm.runInNewContext(fonte, contexto, { filename: "helpers-radar-ml.js" });
  return contexto.module.exports;
}

function htmlSocialPolycard({ id, productId = "", url, urlParams = "", extra = "" }) {
  const productIdCampo = productId ? `"product_id":"${productId}",` : "";
  const urlParamsCampo = urlParams ? `,"url_params":"${urlParams}"` : "";
  return String.raw`
    <html>
      <head><meta property="og:url" content="https://www.mercadolivre.com.br/social/perfil"></head>
      <body>
        <script>
          window.__PRELOADED_STATE__ = {
            "polycards":[{
              "metadata":{
                "id":"${id}",
                ${productIdCampo}
                "url":"${url}"${urlParamsCampo}
                ${extra}
              },
              "pictures":{"pictures":[{"id":"999999-MLB00000000000"}]}
            }]
          };
        </script>
      </body>
    </html>
  `;
}

(async () => {
  const helpers = carregarHelpersRadarMl();

  {
    const entrada = String.raw`www.mercadolivre.com.br\u002Fproduto-teste\u002Fp\u002FMLB123456789`;
    assert.strictEqual(
      helpers.normalizarUrlExtraidaMercadoLivreRadar(entrada),
      "https://www.mercadolivre.com.br/produto-teste/p/MLB123456789"
    );
    assert.strictEqual(
      helpers.normalizarUrlExtraidaMercadoLivreRadar(String.raw`https:\/\/www.mercadolivre.com.br\/produto-teste\/p\/MLB123456789`),
      "https://www.mercadolivre.com.br/produto-teste/p/MLB123456789"
    );
  }

  {
    const casos = [
      {
        nome: "Joico",
        id: "MLB5181827144",
        productId: "",
        url: String.raw`www.mercadolivre.com.br\u002Fkit-duo-protecao-de-danos-e-nutricao-dos-fios-defy-damage-jo\u002Fup\u002FMLBU2803546999`,
        urlParams: String.raw`?pdp_filters=item_id%3AMLB5181827144\u0026matt_event_ts=1786378772200`,
        esperado: "https://www.mercadolivre.com.br/kit-duo-protecao-de-danos-e-nutricao-dos-fios-defy-damage-jo/up/MLBU2803546999?pdp_filters=item_id%3AMLB5181827144"
      },
      {
        nome: "Creatina",
        id: "MLB3905062233",
        productId: "MLB19540092",
        url: String.raw`www.mercadolivre.com.br\u002Fcreatina-hardcore-100-pura-120-capsulas-energia-e-forca-integralmedica\u002Fp\u002FMLB19540092`,
        esperado: "https://www.mercadolivre.com.br/creatina-hardcore-100-pura-120-capsulas-energia-e-forca-integralmedica/p/MLB19540092"
      },
      {
        nome: "Celular",
        id: "MLB6801238036",
        productId: "MLB67009767",
        url: String.raw`www.mercadolivre.com.br\u002Fsmartphone-celular-realme-16-5g-256gb-12gb-ram-dual-sim-camera-de-50mp\u002Fp\u002FMLB67009767`,
        esperado: "https://www.mercadolivre.com.br/smartphone-celular-realme-16-5g-256gb-12gb-ram-dual-sim-camera-de-50mp/p/MLB67009767"
      },
      {
        nome: "Water Cooler",
        id: "MLB6469871444",
        productId: "MLB49249508",
        url: String.raw`www.mercadolivre.com.br\u002Fwater-cooler-gl240-lite-aura-argb-preto-gamdias\u002Fp\u002FMLB49249508`,
        esperado: "https://www.mercadolivre.com.br/water-cooler-gl240-lite-aura-argb-preto-gamdias/p/MLB49249508"
      }
    ];

    for (const caso of casos) {
      const html = htmlSocialPolycard(caso);
      assert.strictEqual(helpers.extrairProdutoMercadoLivreDeHtmlRadar(html), caso.esperado, caso.nome);
    }
  }

  {
    const html = htmlSocialPolycard({
      id: "MLB5181827144",
      productId: "MLB19540092",
      url: String.raw`www.mercadolivre.com.br\u002Fproduto-errado\u002Fp\u002FMLB999999999`
    });
    const resultado = helpers.extrairProdutoMercadoLivreDeHtmlRadar(html);
    assert.notStrictEqual(resultado, "https://www.mercadolivre.com.br/produto-errado/p/MLB999999999");
    assert.strictEqual(resultado, "https://produto.mercadolivre.com.br/MLB5181827144");
  }

  {
    const html = `<meta property="og:url" content="https://www.mercadolivre.com.br/social/diegopc2015"><body>MLB6801238036</body>`;
    const resultado = helpers.extrairProdutoMercadoLivreDeHtmlRadar(html);
    assert.notStrictEqual(resultado, "https://www.mercadolivre.com.br/social/diegopc2015");
    assert.strictEqual(resultado, "https://produto.mercadolivre.com.br/MLB6801238036");
  }

  {
    const urlRica = "https://www.mercadolivre.com.br/water-cooler-gl240-lite-aura-argb-preto-gamdias/p/MLB49249508";
    const linkAfiliado = "https://meli.la/workspace-afiliado";
    const comerciais = {
      titulo: "Water Cooler Gamdias Aura Gl240 Lite Preto Argb",
      precoAtual: "168.00",
      cupom: "OUTLET1008",
      beneficioTexto: "Aplique o cupom OUTLET1008 antes de finalizar.",
      categoria: "Gamer e Hardware"
    };
    const chamadas = [];
    const resultado = await importarMercadoLivreEngine({
      job: { id: "job-social", evento_id: "evento-social", cliente_id: "cliente-a" },
      evento: { texto_original: "Radar original" },
      links: [{ url_original: "https://meli.la/1ZyJaeN" }],
      deps: {
        getIntegracaoCliente: () => ({ credenciais: { cookies: "cookie=1", tag: "tag" } }),
        resolverLinkOriginalRadar: async () => ({
          ok: true,
          urlResolvida: "https://www.mercadolivre.com.br/social/iskandarsouza",
          linkOriginalLimpo: "https://produto.mercadolivre.com.br/MLB6469871444",
          linkResolvido: urlRica
        }),
        importarMercadoLivre: async (url) => {
          chamadas.push(url);
          return {
            ...comerciais,
            titulo: comerciais.titulo,
            preco: comerciais.precoAtual,
            linkAfiliado,
            urlFinal: url,
            imagem: "https://http2.mlstatic.com/D_NQ_NP_WATER-COOLER-MLB.webp",
            imagemOrigem: "jsonLd.image"
          };
        }
      }
    });

    assert.strictEqual(chamadas[0], urlRica);
    assert.strictEqual(resultado.linkExpandido, urlRica);
    assert.strictEqual(resultado.linkAfiliado, linkAfiliado);
    assert.strictEqual(Number(resultado.preco), Number(comerciais.precoAtual));
    assert.strictEqual(resultado.cupom, comerciais.cupom);
    assert.strictEqual(resultado.beneficioTexto, comerciais.beneficioTexto);
    assert.strictEqual(resultado.categoria, comerciais.categoria);
  }

  {
    const generica = "https://produto.mercadolivre.com.br/MLB6801238036";
    const chamadas = [];
    await importarMercadoLivreEngine({
      job: { id: "job-generico", evento_id: "evento-generico", cliente_id: "cliente-a" },
      evento: {},
      links: [{ url_original: "https://meli.la/2g2bryn" }],
      deps: {
        getIntegracaoCliente: () => ({ credenciais: { cookies: "cookie=1" } }),
        resolverLinkOriginalRadar: async () => ({
          ok: true,
          urlResolvida: "https://www.mercadolivre.com.br/social/diegopc2015",
          linkOriginalLimpo: generica
        }),
        importarMercadoLivre: async (url) => {
          chamadas.push(url);
          return {
            titulo: "Celular",
            preco: "1979.10",
            linkAfiliado: "https://meli.la/afiliado-celular",
            urlFinal: url
          };
        }
      }
    });

    assert.strictEqual(chamadas[0], generica);
  }

  console.log("mercadolivre-social-url-rica.test.js ok");
})();
