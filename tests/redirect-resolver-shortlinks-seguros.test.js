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
