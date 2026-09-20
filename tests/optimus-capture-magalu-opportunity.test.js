"use strict";

const assert = require("assert");
const resolver = require("../optimus-capture/local-worker/magalu-opportunity.js");

function resposta({ status = 200, url = resolver.URL_OFICIAL, html = "Ofertas do dia" } = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    url,
    bodyUsed: false,
    body: { cancel: async () => undefined },
    text: async () => html
  };
}

(async () => {
  const encontrada = await resolver.verificar({ fetchFn: async () => resposta({ html: "Ofertas do dia · produtos encontrados" }) });
  assert.strictEqual(encontrada.accessible, true);
  assert.strictEqual(encontrada.indicatorFound, true);

  const ausente = await resolver.verificar({ fetchFn: async () => resposta({ html: "Página normal sem campanha" }) });
  assert.strictEqual(ausente.accessible, true);
  assert.strictEqual(ausente.indicatorFound, false);

  const http403 = await resolver.verificar({ fetchFn: async () => resposta({ status: 403, html: "Akamai robot" }) });
  assert.strictEqual(http403.accessible, false);
  assert.strictEqual(http403.reason, "magalu_oportunidade_http_403");

  const challenge = await resolver.verificar({ fetchFn: async () => resposta({ html: "az-request-verify challenge" }) });
  assert.strictEqual(challenge.accessible, false);
  assert.strictEqual(challenge.reason, "magalu_oportunidade_challenge");

  const hostInvalido = await resolver.verificar({ fetchFn: async () => resposta({ url: "https://evil.example/selecao/ofertasdodiamundo/" }) });
  assert.strictEqual(hostInvalido.accessible, false);
  assert.strictEqual(hostInvalido.reason, "magalu_oportunidade_url_final_invalida");

  const pathInvalido = await resolver.verificar({ fetchFn: async () => resposta({ url: "https://www.magazineluiza.com.br/outro/" }) });
  assert.strictEqual(pathInvalido.accessible, false);
  assert.strictEqual(pathInvalido.reason, "magalu_oportunidade_url_final_invalida");

  console.log("optimus-capture-magalu-opportunity.test.js: ok");
})().catch(erro => { console.error(erro); process.exitCode = 1; });
