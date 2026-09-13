"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  extrairProvaIdentidadeMercadoLivreHtml,
  ORIGEM_PROVA_BLOCO_PRINCIPAL,
  TIPO_PROVA_ESTRUTURAL,
  TIPO_PROVA_PDP_FILTERS,
  validarProvaIdentidadeMercadoLivre
} = require("../modules/radar/mercadolivre-social-identidade");
const {
  _test: { motivoIdentidadeMeliClonadorNaoComprovada }
} = require("../modules/engine/importer/adapters/mercadolivre.adapter");

function htmlSocial({ mlbItem, mlbProduto, url, urlParams, metadataExtra = {}, outrosCards = [], polycardsExtras = [], cardsFeaturedExtras = [] } = {}) {
  const cardFeatured = {
    id: "card-featured",
    recommendation_data: {
      recommendation_info: {
        polycards: [{
          metadata: {
            id: mlbItem,
            product_id: mlbProduto,
            url,
            url_params: urlParams,
            ...metadataExtra
          },
          pictures: { pictures: [] }
        }, ...polycardsExtras]
      }
    }
  };
  return `<html><script>${JSON.stringify({ cards: [...outrosCards, cardFeatured, ...cardsFeaturedExtras] })}</script></html>`;
}

function htmlBlocoPrincipal({ mlbItem = "MLB9988776655", mlbProduto = "MLB44556677", url, extras = {}, componentesExtras = [] } = {}) {
  const bloco = {
    id: "main-product",
    item_id: mlbItem,
    product_id: mlbProduto,
    url: url || `https://www.mercadolivre.com.br/camera-wifi-inteligente/p/${mlbProduto}?pdp_filters=item_id%3A${mlbItem}`,
    ...extras
  };
  return `<html><script>${JSON.stringify({ components: [bloco, ...componentesExtras] })}</script></html>`;
}

function casoReal(mlbItem, mlbProduto, slug) {
  return {
    mlbItem,
    mlbProduto,
    url: `www.mercadolivre.com.br/${slug}/p/${mlbProduto}`,
    urlParams: `?pdp_filters=item_id%3A${mlbItem}&matt_event_ts=123`
  };
}

function motivoEngine(prova, metodo = "html", urlProduto = prova?.urlProduto || "") {
  return motivoIdentidadeMeliClonadorNaoComprovada({
    evento: { origem: "clonador_grupos" },
    urlOriginalEngine: "https://meli.la/caso-real",
    resolucaoProduto: {
      resolucaoRadar: {
        urlResolvida: "https://www.mercadolivre.com.br/social/grupostecnoart?ref=seguro",
        linkOriginalLimpo: urlProduto,
        metodoResolucaoMeli: metodo,
        provaIdentidadeMeli: prova
      }
    }
  });
}

const casosReais = [
  casoReal("MLB4876269031", "MLB32444906", "processador-amd-ryzen-5-5600gt"),
  casoReal("MLB5486353878", "MLB48468943", "headset-gamer-redragon-zeus-lite"),
  casoReal("MLB4126050767", "MLB15475813", "mouse-gamer-m711-cobra-redragon")
];

for (const caso of casosReais) {
  const prova = extrairProvaIdentidadeMercadoLivreHtml(htmlSocial(caso));
  assert.strictEqual(prova.ok, true, caso.mlbItem);
  assert.strictEqual(prova.mlbItem, caso.mlbItem);
  assert.strictEqual(prova.mlbProduto, caso.mlbProduto);
  assert.strictEqual(prova.tipoProva, TIPO_PROVA_PDP_FILTERS);
  assert.strictEqual(validarProvaIdentidadeMercadoLivre(prova).ok, true);
  assert.strictEqual(motivoEngine(prova), "", `${caso.mlbItem} deve liberar HTML estruturado`);
}

const provaBlocoPrincipal = extrairProvaIdentidadeMercadoLivreHtml(htmlBlocoPrincipal());
assert.strictEqual(provaBlocoPrincipal.ok, true);
assert.strictEqual(provaBlocoPrincipal.origem, ORIGEM_PROVA_BLOCO_PRINCIPAL);
assert.strictEqual(provaBlocoPrincipal.mlbItem, "MLB9988776655");
assert.strictEqual(provaBlocoPrincipal.mlbProduto, "MLB44556677");
assert.strictEqual(provaBlocoPrincipal.tipoProva, TIPO_PROVA_PDP_FILTERS);
const blocoPrincipalSemOptIn = validarProvaIdentidadeMercadoLivre(provaBlocoPrincipal);
assert.strictEqual(blocoPrincipalSemOptIn.ok, false);
assert.strictEqual(blocoPrincipalSemOptIn.motivo, "bloco_principal_nao_homologado_contexto");
assert.strictEqual(validarProvaIdentidadeMercadoLivre(provaBlocoPrincipal, { aceitarBlocoPrincipal: true }).ok, true);
assert.strictEqual(motivoEngine(provaBlocoPrincipal), "identidade_ml_nao_comprovada", "bloco principal sem opt-in nao deve liberar identidade");

const blocoPrincipalProdutoDivergente = extrairProvaIdentidadeMercadoLivreHtml(htmlBlocoPrincipal({
  mlbItem: "MLB9988776655",
  mlbProduto: "MLB44556677",
  url: "https://www.mercadolivre.com.br/camera-wifi-inteligente/p/MLB11223344?pdp_filters=item_id%3AMLB9988776655"
}));
assert.strictEqual(blocoPrincipalProdutoDivergente.ok, false);

const blocoPrincipalItemDivergente = extrairProvaIdentidadeMercadoLivreHtml(htmlBlocoPrincipal({
  mlbItem: "MLB9988776655",
  mlbProduto: "MLB44556677",
  url: "https://www.mercadolivre.com.br/camera-wifi-inteligente/p/MLB44556677?pdp_filters=item_id%3AMLB1111111111"
}));
assert.strictEqual(blocoPrincipalItemDivergente.ok, false);

const blocoPrincipalAmbiguo = extrairProvaIdentidadeMercadoLivreHtml(htmlBlocoPrincipal({
  componentesExtras: [{
    id: "main-product",
    item_id: "MLB1111111111",
    product_id: "MLB22222222",
    url: "https://www.mercadolivre.com.br/outro-produto/p/MLB22222222?pdp_filters=item_id%3AMLB1111111111"
  }]
}));
assert.strictEqual(blocoPrincipalAmbiguo.ok, false);

const recommendationSemBlocoPrincipal = extrairProvaIdentidadeMercadoLivreHtml(`<html><script>${JSON.stringify({
  recommendation_data: {
    recommendation_info: {
      polycards: [{
        metadata: {
          id: "MLB9988776655",
          product_id: "MLB44556677",
          url: "https://www.mercadolivre.com.br/camera-wifi-inteligente/p/MLB44556677",
          url_params: "?pdp_filters=item_id%3AMLB9988776655"
        }
      }]
    }
  }
})}</script></html>`);
assert.strictEqual(recommendationSemBlocoPrincipal.ok, false);

const canonicalOgSemBlocoPrincipal = extrairProvaIdentidadeMercadoLivreHtml(`
  <html>
    <link rel="canonical" href="https://www.mercadolivre.com.br/camera-wifi-inteligente/p/MLB44556677?pdp_filters=item_id%3AMLB9988776655">
    <meta property="og:url" content="https://www.mercadolivre.com.br/camera-wifi-inteligente/p/MLB44556677?pdp_filters=item_id%3AMLB9988776655">
    <body>MLB9988776655</body>
  </html>
`);
assert.strictEqual(canonicalOgSemBlocoPrincipal.ok, false);

const provaEstruturalSemPdp = extrairProvaIdentidadeMercadoLivreHtml(htmlSocial({
  mlbItem: "MLB7777777777",
  mlbProduto: "MLB33333333",
  url: "www.mercadolivre.com.br/produto-estrutural/p/MLB33333333",
  urlParams: "?matt_event_ts=123",
  metadataExtra: {
    wid: "MLB7777777777",
    pid: "MLBP33333333",
    pid_extended: "MLBP33333333_MLB7777777777"
  }
}));
assert.strictEqual(provaEstruturalSemPdp.ok, true);
assert.strictEqual(provaEstruturalSemPdp.tipoProva, TIPO_PROVA_ESTRUTURAL);
assert.strictEqual(validarProvaIdentidadeMercadoLivre(provaEstruturalSemPdp).ok, true);
assert.strictEqual(motivoEngine(provaEstruturalSemPdp), "", "prova estrutural inequívoca sem pdp_filters deve liberar");

const provaRecommendationSemPdp = extrairProvaIdentidadeMercadoLivreHtml(htmlSocial({
  mlbItem: "MLB7777777777",
  mlbProduto: "MLB33333333",
  url: "www.mercadolivre.com.br/produto-estrutural/p/MLB33333333",
  urlParams: "?matt_event_ts=123",
  metadataExtra: {
    wid: "MLB7777777777",
    pid_extended: "MLBP33333333_MLB7777777777",
    url_fragments: "#polycard_client=recommendations_home_affiliate-profile&reco_item_pos=0"
  }
}));
assert.strictEqual(provaRecommendationSemPdp.ok, false);

const semIdentidade = extrairProvaIdentidadeMercadoLivreHtml("<html><body>MLB999999999 solto</body></html>");
assert.strictEqual(semIdentidade.ok, false);
assert.strictEqual(motivoEngine(null), "identidade_ml_nao_comprovada");
assert.strictEqual(
  motivoEngine(null, "html", extrairProvaIdentidadeMercadoLivreHtml(htmlSocial(casosReais[0])).urlProduto),
  "identidade_ml_nao_comprovada",
  "URL de produto sem prova estruturada nao libera metodo html"
);

const outroCard = {
  id: "card-outro",
  recommendation_data: { recommendation_info: { polycards: [{ metadata: { id: "MLB999999999", product_id: "MLB88888888" } }] } }
};
const provaComOutroMlb = extrairProvaIdentidadeMercadoLivreHtml(htmlSocial({ ...casosReais[0], outrosCards: [outroCard] }));
assert.strictEqual(provaComOutroMlb.ok, true);
assert.strictEqual(provaComOutroMlb.mlbItem, casosReais[0].mlbItem);

const ambiguo = extrairProvaIdentidadeMercadoLivreHtml(htmlSocial({
  ...casosReais[0],
  polycardsExtras: [{ metadata: { id: "MLB777777777", product_id: "MLB77777777" } }]
}));
assert.strictEqual(ambiguo.ok, false);

const externo = extrairProvaIdentidadeMercadoLivreHtml(htmlSocial({
  ...casosReais[0],
  url: `https://evil.example/produto/p/${casosReais[0].mlbProduto}`
}));
assert.strictEqual(externo.ok, false);

const produtoInconsistente = extrairProvaIdentidadeMercadoLivreHtml(htmlSocial({
  ...casosReais[0],
  mlbProduto: "MLB11111111"
}));
assert.strictEqual(produtoInconsistente.ok, false);

const itemInconsistente = extrairProvaIdentidadeMercadoLivreHtml(htmlSocial({
  ...casosReais[0],
  urlParams: "?pdp_filters=item_id%3AMLB222222222"
}));
assert.strictEqual(itemInconsistente.ok, false);

const cardFeaturedDuplicado = { id: "card-featured", recommendation_data: { recommendation_info: { polycards: [] } } };
const featuredAmbiguo = extrairProvaIdentidadeMercadoLivreHtml(htmlSocial({
  ...casosReais[0],
  cardsFeaturedExtras: [cardFeaturedDuplicado]
}));
assert.strictEqual(featuredAmbiguo.ok, false);

const provaValida = extrairProvaIdentidadeMercadoLivreHtml(htmlSocial(casosReais[0]));
assert.strictEqual(
  motivoEngine(provaValida, "html", provaValida.urlProduto.replace(casosReais[0].mlbItem, "MLB333333333")),
  "identidade_ml_nao_comprovada"
);
assert.strictEqual(motivoEngine(null, "parametro", ""), "identidade_ml_nao_comprovada");

const fonteIndex = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
assert.ok(
  fonteIndex.includes("diagnosticarProdutoMercadoLivreIntermediarioRadar("),
  "Radar deve centralizar prova/fallback do HTML social em helper estruturado"
);
assert.ok(
  !fonteIndex.includes("produtoHtml || await extrairProdutoMercadoLivreIntermediarioRadar(resolvida)"),
  "Radar nao deve baixar o HTML social uma segunda vez apos ja ter paginaIntermediaria"
);

console.log("mercadolivre-social-identidade-segura.test.js ok");
