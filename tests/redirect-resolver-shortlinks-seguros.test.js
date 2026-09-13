"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  resolverRedirectClonador,
  resolverRedirectUniversal
} = require("../modules/radar/redirect/redirect-resolver");

function httpRedirecionando(urlFinal = "") {
  return {
    get: async () => ({
      status: 200,
      data: "",
      request: { res: { responseUrl: urlFinal } }
    })
  };
}

function httpSequencial(respostas = []) {
  const chamadas = [];
  return {
    chamadas,
    get: async (url) => {
      chamadas.push(url);
      const resposta = respostas[Math.min(chamadas.length - 1, respostas.length - 1)] || {};
      return {
        status: resposta.status || 200,
        data: resposta.data || "",
        request: { res: { responseUrl: resposta.urlFinal || url } }
      };
    }
  };
}

function htmlSocialSeguro({ mlbItem = "MLB7777777777", mlbProduto = "MLB33333333", urlFragments = "" } = {}) {
  return `<html><script>${JSON.stringify({
    cards: [{
      id: "card-featured",
      recommendation_data: {
        recommendation_info: {
          polycards: [{
            metadata: {
              id: mlbItem,
              product_id: mlbProduto,
              wid: mlbItem,
              pid_extended: `MLBP33333333_${mlbItem}`,
              url: `www.mercadolivre.com.br/produto-seguro/p/${mlbProduto}`,
              url_params: "?matt_event_ts=123",
              url_fragments: urlFragments
            },
            pictures: { pictures: [] }
          }]
        }
      }
    }]
  })}</script></html>`;
}

function htmlSocialRecommendationPosicao4() {
  return `<html><script>${JSON.stringify({
    cards: [{
      id: "card-featured",
      recommendation_data: {
        recommendation_info: {
          polycards: [
            {
              metadata: {
                id: "MLB1111111111",
                product_id: "MLB22222222",
                wid: "MLB1111111111",
                pid_extended: "MLBP22222222_MLB1111111111",
                url: "www.mercadolivre.com.br/produto-principal/p/MLB22222222",
                url_params: "?matt_event_ts=123",
                url_fragments: "#polycard_client=recommendations_home_affiliate-profile&reco_item_pos=0"
              },
              pictures: { pictures: [] }
            },
            {
              metadata: {
                id: "MLB7367219188",
                url: "produto.mercadolivre.com.br/MLB-7367219188-cmera-de-seguranca-360-wifi-e27-viso-noturna-full-hd-1080-_JM",
                url_fragments: "#polycard_client=recommendations_home_affiliate_profile_v2p-recommendations&reco_item_pos=4&wid=MLB7367219188"
              },
              pictures: { pictures: [] }
            }
          ]
        }
      }
    }]
  })}</script></html>`;
}

(async function main() {
  const fonteIndex = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  assert.match(
    fonteIndex,
    /const clonadorGruposBridge = criarBridgeClonadorGrupos\(\{[\s\S]*?resolverRedirectUniversal:\s*resolverRedirectClonador,[\s\S]*?\}\);/,
    "Bridge do Clonador deve receber o resolver compativel com meli.la"
  );

  const meliOriginal = "https://meli.la/shortlink-valido";
  const meliProduto = "https://produto.mercadolivre.com.br/MLB-123456789-produto-_JM";
  const meliValido = await resolverRedirectClonador(meliOriginal, {
    httpClient: httpRedirecionando(meliProduto)
  });
  assert.strictEqual(meliValido.ok, true);
  assert.strictEqual(meliValido.urlExpandida, meliProduto);
  assert.strictEqual(meliValido.marketplaceDetectado, "mercadolivre");

  const meliSocial = await resolverRedirectClonador("https://meli.la/social-ambiguo", {
    httpClient: httpRedirecionando("https://www.mercadolivre.com.br/social/promocoes")
  });
  assert.strictEqual(meliSocial.ok, false);
  assert.strictEqual(meliSocial.motivo, "identidade_ml_nao_comprovada");
  assert.strictEqual(meliSocial.urlExpandida, "");

  const socialSeguroHttp = httpSequencial([
    { urlFinal: "https://www.mercadolivre.com.br/social/promozonevip" },
    { urlFinal: "https://www.mercadolivre.com.br/social/promozonevip", data: htmlSocialSeguro() }
  ]);
  const meliSocialSeguro = await resolverRedirectClonador("https://meli.la/social-seguro", {
    httpClient: socialSeguroHttp
  });
  assert.strictEqual(meliSocialSeguro.ok, true);
  assert.strictEqual(meliSocialSeguro.marketplaceDetectado, "mercadolivre");
  assert.strictEqual(meliSocialSeguro.urlExpandida, "https://www.mercadolivre.com.br/produto-seguro/p/MLB33333333?pdp_filters=item_id%3AMLB7777777777");
  assert.strictEqual(socialSeguroHttp.chamadas.length, 2, "Clone deve fazer 1 redirect + 1 HTML social");

  const socialRecommendationHttp = httpSequencial([
    { urlFinal: "https://www.mercadolivre.com.br/social/promozonevip" },
    { urlFinal: "https://www.mercadolivre.com.br/social/promozonevip", data: htmlSocialRecommendationPosicao4() }
  ]);
  const meliSocialRecommendation = await resolverRedirectClonador("https://meli.la/2qXLn93", {
    httpClient: socialRecommendationHttp
  });
  assert.strictEqual(meliSocialRecommendation.ok, false);
  assert.strictEqual(meliSocialRecommendation.motivo, "identidade_ml_nao_comprovada");
  assert.strictEqual(socialRecommendationHttp.chamadas.length, 2);

  const dominioNaoPermitido = await resolverRedirectClonador("https://redirect-nao-permitido.example/oferta");
  assert.strictEqual(dominioNaoPermitido.ok, false);
  assert.strictEqual(dominioNaoPermitido.motivo, "dominio_redirect_nao_permitido");

  const amazonOriginal = "https://amzn.divulguei.app/QWGHs9";
  const amazonProduto = "https://www.amazon.com.br/dp/B0C3T4MFMM?tag=origem-20";
  const amazonValido = await resolverRedirectClonador(amazonOriginal, {
    httpClient: httpRedirecionando(amazonProduto)
  });
  assert.strictEqual(amazonValido.ok, true);
  assert.strictEqual(amazonValido.urlExpandida, amazonProduto);
  assert.strictEqual(amazonValido.marketplaceDetectado, "amazon");

  const amazonSemAsin = await resolverRedirectUniversal("https://amzn.divulguei.app/sem-asin", {
    httpClient: httpRedirecionando("https://www.amazon.com.br/gp/browse.html")
  });
  assert.strictEqual(amazonSemAsin.ok, false);
  assert.strictEqual(amazonSemAsin.motivo, "amazon_shortlink_sem_asin_resolvido");
  assert.strictEqual(amazonSemAsin.urlExpandida, "");

  console.log("redirect-resolver-shortlinks-seguros.test.js ok");
})().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
