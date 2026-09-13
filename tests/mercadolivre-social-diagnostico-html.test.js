"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const {
  extrairProvaIdentidadeMercadoLivreHtml
} = require("../modules/radar/mercadolivre-social-identidade");

function carregarHelpers() {
  const arquivo = path.join(__dirname, "..", "index.js");
  const codigo = fs.readFileSync(arquivo, "utf8");
  const inicio = codigo.indexOf("function limparUrlProdutoRadar");
  const fim = codigo.indexOf("function isUrlIntermediariaRadar");
  const inicioLog = codigo.indexOf("function textoArrayLogDiagnosticoMercadoLivreRadar");
  const fimLog = codigo.indexOf("function logPromozoneRadar");
  assert.ok(inicio >= 0 && fim > inicio, "helpers de fallback ML nao encontrados");
  assert.ok(inicioLog >= 0 && fimLog > inicioLog, "helper de log diagnostico ML nao encontrado");

  const logs = [];
  const chamadasRede = [];
  const contexto = {
    URL,
    Buffer,
    console: {
      log: (...args) => logs.push(args)
    },
    axios: {
      get: async url => {
        chamadasRede.push(url);
        throw new Error("rede_nao_deveria_ser_chamada");
      }
    },
    extrairProvaIdentidadeMercadoLivreHtml,
    module: { exports: {} },
    __logs: logs,
    __chamadasRede: chamadasRede
  };

  const fonte = `
    function normalizarTexto(valor = "") { return String(valor || "").trim().toLowerCase(); }
    function normalizarMarketplaceRadar(marketplace = "") { return normalizarTexto(marketplace || "") === "kabum" ? "awin" : normalizarTexto(marketplace || ""); }
    function detectarMarketplaceRadarLink() { return "mercadolivre"; }
    function extrairAmazonAsinRadar() { return ""; }
    ${codigo.slice(inicio, fim)}
    ${codigo.slice(inicioLog, fimLog)}
    module.exports = {
      MAX_OBJETOS_DIAGNOSTICO_MERCADO_LIVRE_RADAR,
      MAX_OCORRENCIAS_DIAGNOSTICO_MERCADO_LIVRE_RADAR,
      MAX_TAMANHO_JSON_DIAGNOSTICO_MERCADO_LIVRE_RADAR,
      MAX_TRECHO_ARRAY_DIAGNOSTICO_ML,
      MAX_NIVEIS_PATH_DIAGNOSTICO_ML,
      diagnosticarFallbackProdutoMercadoLivreDeHtmlRadar,
      diagnosticarProdutoMercadoLivreIntermediarioRadar,
      extrairProdutoMercadoLivreDeHtmlRadar,
      logRadarMlSocialDiagnosticoHtml,
      logs: __logs,
      chamadasRede: __chamadasRede,
      codigoFonte: ${JSON.stringify(codigo)}
    };
  `;

  vm.runInNewContext(fonte, contexto, { filename: "diagnostico-html-ml.js" });
  return contexto.module.exports;
}

function diagnosticar(helpers, html) {
  return helpers.diagnosticarFallbackProdutoMercadoLivreDeHtmlRadar(
    html,
    helpers.extrairProdutoMercadoLivreDeHtmlRadar(html)
  );
}

function assertMetodo(helpers, nome, html, metodo, esperado) {
  const diagnostico = diagnosticar(helpers, html);
  assert.strictEqual(diagnostico.metodoFallbackEncontrado, metodo, nome);
  assert.strictEqual(diagnostico.urlProduto, esperado, nome);
  assert.strictEqual(helpers.extrairProdutoMercadoLivreDeHtmlRadar(html), esperado, `${nome}: retorno funcional preservado`);
  return diagnostico;
}

function htmlCardFeaturedSeguro() {
  return `<html><script>${JSON.stringify({
    cards: [{
      id: "card-featured",
      recommendation_data: {
        recommendation_info: {
          polycards: [{
            metadata: {
              id: "MLB4876269031",
              product_id: "MLB32444906",
              url: "www.mercadolivre.com.br/processador-amd-ryzen/p/MLB32444906",
              url_params: "?pdp_filters=item_id%3AMLB4876269031"
            }
          }]
        }
      }
    }]
  })}</script></html>`;
}

const helpers = carregarHelpers();

{
  const inicio = helpers.codigoFonte.indexOf("function extrairJsonObjetoContendoDiagnosticoMercadoLivreRadar");
  const fim = helpers.codigoFonte.indexOf("function chaveAntesEstruturaDiagnosticoMercadoLivreRadar");
  const corpo = helpers.codigoFonte.slice(inicio, fim);
  assert.ok(inicio >= 0 && fim > inicio, "corpo do extrator estrutural deve existir");
  assert.strictEqual(corpo.includes("chaveAntesEstruturaDiagnosticoMercadoLivreRadar("), false, "chave estrutural deve ser resolvida de forma lazy");
}

{
  assertMetodo(
    helpers,
    "canonical",
    '<html><head><link rel="canonical" href="https://produto.mercadolivre.com.br/MLB-4170062689-produto-_JM"></head></html>',
    "canonical",
    "https://produto.mercadolivre.com.br/MLB-4170062689-produto-_JM"
  );
}

{
  assertMetodo(
    helpers,
    "og_url",
    '<html><head><meta property="og:url" content="https://produto.mercadolivre.com.br/MLB-7223217402-produto-_JM"></head></html>',
    "og_url",
    "https://produto.mercadolivre.com.br/MLB-7223217402-produto-_JM"
  );
}

{
  assertMetodo(
    helpers,
    "permalink",
    '<script>{"permalink":"https://produto.mercadolivre.com.br/MLB-4701793653-produto-_JM"}</script>',
    "permalink",
    "https://produto.mercadolivre.com.br/MLB-4701793653-produto-_JM"
  );
}

{
  assertMetodo(
    helpers,
    "url_json",
    '<script>{"url":"https://produto.mercadolivre.com.br/MLB-2634448552-produto-_JM"}</script>',
    "url_json",
    "https://produto.mercadolivre.com.br/MLB-2634448552-produto-_JM"
  );
}

{
  assertMetodo(
    helpers,
    "raw_url",
    String.raw`<body>produto=https:\/\/produto.mercadolivre.com.br\/MLB-4170062689-produto-_JM</body>`,
    "raw_url",
    "https://produto.mercadolivre.com.br/MLB-4170062689-produto-_JM"
  );
}

{
  assertMetodo(
    helpers,
    "mlb_solto",
    "<html><body>MLB4701793653</body></html>",
    "mlb_solto",
    "https://produto.mercadolivre.com.br/MLB4701793653"
  );
}

{
  const html = `<script>${JSON.stringify({
    id: "diagnostic-card",
    recommendation_data: true,
    polycard: true,
    reco_backend: "item_decorator",
    banner: false,
    advertising: "adn",
    carousel: true,
    url: "https://produto.mercadolivre.com.br/MLB-4170062689-produto-_JM"
  })}</script>`;
  const diagnostico = assertMetodo(
    helpers,
    "contexto negativo somente diagnostico",
    html,
    "url_json",
    "https://produto.mercadolivre.com.br/MLB-4170062689-produto-_JM"
  );
  const objeto = diagnostico.objetosLimitados[0];
  assert.ok(objeto, "objeto diagnostico deve existir");
  assert.strictEqual(objeto.contemRecommendation, true);
  assert.strictEqual(objeto.contemPolycard, true);
  assert.strictEqual(objeto.contemReco, true);
  assert.strictEqual(objeto.contemBanner, true);
  assert.strictEqual(objeto.contemAdvertising, true);
  assert.strictEqual(objeto.contemCarousel, true);
  assert.strictEqual(diagnostico.totalMlbsDistintos, 1);
  assert.strictEqual(diagnostico.quantidadeOcorrenciasDoMlb, 1);
}

{
  const html = `<script>${JSON.stringify({
    list: [
      {
        id: "card-a",
        url: "https://produto.mercadolivre.com.br/MLB-4170062689-produto-_JM",
        product_id: "MLB1234567890"
      }
    ]
  })}</script>`;
  const diagnostico = diagnosticar(helpers, html);
  assert.strictEqual(diagnostico.objetosLimitados[0].dentroArray, true);
  assert.ok(diagnostico.objetosLimitados[0].chavesDiretas.includes("url"));
  assert.ok(diagnostico.objetosLimitados[0].urlsDiretasMesmoObjeto[0].includes("produto.mercadolivre.com.br/MLB-4170062689-produto-_JM"));
  assert.strictEqual(diagnostico.objetosLimitados[0].candidatosDistintosNoObjeto, 2);
}

{
  const html = `<script>window.__PRELOADED_STATE__ = ${JSON.stringify({
    recommendations: {
      items: [
        {
          url_fragments: "recommendations_home_affiliate-profile",
          tracking: {
            reco_backend: "item_decorator"
          },
          metadata: {
            id: "MLB5157756068",
            product_id: "MLB35277819",
            user_product_id: "MLBU2705565610"
          }
        }
      ]
    }
  })}</script>`;
  const diagnostico = helpers.diagnosticarFallbackProdutoMercadoLivreDeHtmlRadar(
    html,
    "https://produto.mercadolivre.com.br/MLB5157756068-produto-_JM"
  );
  const objeto = diagnostico.objetosLimitados[0];
  assert.ok(objeto.caminhoEstrutural.includes("window.__PRELOADED_STATE__.recommendations.items[0].metadata"));
  assert.strictEqual(objeto.tipoPai, "object");
  assert.strictEqual(objeto.chaveAvo, "items");
  assert.strictEqual(objeto.indiceNoArray, null);
  assert.strictEqual(objeto.caminhoContemRecommendation, true);
  assert.strictEqual(objeto.caminhoContemPolycard, false);
  assert.strictEqual(objeto.caminhoContemReco, true);
  assert.strictEqual(objeto.itemIdCandidato, "MLB5157756068");
  assert.strictEqual(objeto.catalogProductId, "MLB35277819");
  assert.strictEqual(objeto.userProductId, "MLBU2705565610");
  assert.strictEqual(objeto.urlsDiretasMesmoObjeto.length, 0);
}

{
  const html = `<script>window.__PRELOADED_STATE__ = ${JSON.stringify({
    page: {
      product: {
        current: {
          items: [
            {
              id: "MLB5157756068",
              product_id: "MLB35277819",
              user_product_id: "MLBU2705565610"
            }
          ]
        }
      }
    }
  })}</script>`;
  const diagnostico = helpers.diagnosticarFallbackProdutoMercadoLivreDeHtmlRadar(
    html,
    "https://produto.mercadolivre.com.br/MLB5157756068-produto-_JM"
  );
  const objeto = diagnostico.objetosLimitados[0];
  assert.ok(objeto.caminhoEstrutural.includes("window.__PRELOADED_STATE__.page.product.current.items[0]"));
  assert.strictEqual(objeto.chavePai, "items");
  assert.strictEqual(objeto.tipoPai, "array");
  assert.strictEqual(objeto.chaveAvo, "current");
  assert.strictEqual(objeto.indiceNoArray, 0);
  assert.strictEqual(objeto.caminhoContemRecommendation, false);
  assert.strictEqual(objeto.caminhoContemPolycard, false);
  assert.strictEqual(objeto.caminhoContemReco, false);
}

{
  const html = [
    '<link rel="canonical" href="https://produto.mercadolivre.com.br/MLB-4170062689-produto-_JM">',
    '<script>{"url":"https://produto.mercadolivre.com.br/MLB-7223217402-outro-_JM"}</script>'
  ].join("");
  const diagnostico = helpers.diagnosticarProdutoMercadoLivreIntermediarioRadar(html, "https://www.mercadolivre.com.br/social/perfil");
  assert.strictEqual(diagnostico.urlProduto, helpers.extrairProdutoMercadoLivreDeHtmlRadar(html));
  assert.strictEqual(diagnostico.urlProduto, "https://produto.mercadolivre.com.br/MLB-4170062689-produto-_JM");
  assert.strictEqual(diagnostico.diagnostico.fallbackSocial.urlProduto, diagnostico.urlProduto);
  assert.strictEqual(diagnostico.diagnostico.fallbackSocial.metodoFallbackEncontrado, "canonical");
}

{
  const ocorrencias = Array.from({ length: 1000 }, (_, indice) => (
    `<span data-i="${indice}">MLB-4170062689</span>`
  )).join("");
  const html = `<link rel="canonical" href="https://produto.mercadolivre.com.br/MLB-4170062689-produto-_JM">${ocorrencias}`;
  const diagnostico = diagnosticar(helpers, html);
  assert.strictEqual(diagnostico.urlProduto, "https://produto.mercadolivre.com.br/MLB-4170062689-produto-_JM");
  assert.ok(diagnostico.ocorrenciasInspecionadas <= helpers.MAX_OCORRENCIAS_DIAGNOSTICO_MERCADO_LIVRE_RADAR);
  assert.strictEqual(diagnostico.diagnosticoTruncado, true);
  assert.strictEqual(helpers.extrairProdutoMercadoLivreDeHtmlRadar(html), diagnostico.urlProduto);
}

{
  const filler = Array.from({ length: 2600 }, (_, indice) => `{"x":${indice}}`).join(",");
  const html = `<script>window.__PRELOADED_STATE__ = {"items":[${filler},{"id":"MLB4170062689"}]}</script>`;
  const diagnostico = helpers.diagnosticarFallbackProdutoMercadoLivreDeHtmlRadar(
    html,
    "https://produto.mercadolivre.com.br/MLB4170062689-produto-_JM"
  );
  const objeto = diagnostico.objetosLimitados[0];
  assert.ok(filler.length > helpers.MAX_TRECHO_ARRAY_DIAGNOSTICO_ML);
  assert.strictEqual(objeto.indiceNoArray, null);
  assert.strictEqual(objeto.indiceArrayTruncado, true);
  assert.strictEqual(diagnostico.urlProduto, "https://produto.mercadolivre.com.br/MLB4170062689-produto-_JM");
}

{
  let objeto = { id: "MLB4170062689" };
  for (let indice = 119; indice >= 0; indice -= 1) {
    objeto = { [`nivel_${indice}`]: objeto };
  }
  const html = `<script>window.__PRELOADED_STATE__ = ${JSON.stringify(objeto)}</script>`;
  const diagnostico = helpers.diagnosticarFallbackProdutoMercadoLivreDeHtmlRadar(
    html,
    "https://produto.mercadolivre.com.br/MLB4170062689-produto-_JM"
  );
  const objetoDiagnosticado = diagnostico.objetosLimitados[0];
  assert.strictEqual(objetoDiagnosticado.caminhoTruncado, true);
  assert.ok(objetoDiagnosticado.caminhoEstrutural.includes("..."));
  assert.ok(objetoDiagnosticado.caminhoEstrutural.length <= 220);
  assert.strictEqual(helpers.extrairProdutoMercadoLivreDeHtmlRadar(html), "https://produto.mercadolivre.com.br/MLB4170062689");
}

{
  const objetos = Array.from({ length: 5 }, (_, indice) => (
    `<script>{"id":"objeto-${indice}","url":"https://produto.mercadolivre.com.br/MLB-4170062689-produto-_JM"}</script>`
  )).join("");
  const diagnostico = diagnosticar(helpers, `<link rel="canonical" href="https://produto.mercadolivre.com.br/MLB-4170062689-produto-_JM">${objetos}`);
  assert.ok(diagnostico.objetosLimitados.length <= helpers.MAX_OBJETOS_DIAGNOSTICO_MERCADO_LIVRE_RADAR);
}

{
  const objeto = {};
  for (let indice = 0; indice < 30; indice += 1) {
    objeto[`campo_${indice}`] = `valor_${indice}`;
  }
  objeto.url = "https://produto.mercadolivre.com.br/MLB-4170062689-produto-_JM";
  const diagnostico = diagnosticar(helpers, `<script>${JSON.stringify(objeto)}</script>`);
  assert.ok(diagnostico.objetosLimitados[0].chavesDiretas.length <= 20);
  assert.ok(diagnostico.objetosLimitados[0].camposIrmaosDiretos.length <= 20);
}

{
  const html = `<script>{"url":"https://produto.mercadolivre.com.br/MLB-4170062689-produto-_JM","payload":"${"x".repeat(helpers.MAX_TAMANHO_JSON_DIAGNOSTICO_MERCADO_LIVRE_RADAR + 1000)}"}</script>`;
  const diagnostico = diagnosticar(helpers, html);
  assert.strictEqual(diagnostico.urlProduto, "https://produto.mercadolivre.com.br/MLB-4170062689-produto-_JM");
  assert.strictEqual(diagnostico.objetosLimitados.length, 0);
  assert.ok(diagnostico.ocorrenciasInspecionadas <= helpers.MAX_OCORRENCIAS_DIAGNOSTICO_MERCADO_LIVRE_RADAR);
}

{
  const diagnostico = helpers.diagnosticarProdutoMercadoLivreIntermediarioRadar(htmlCardFeaturedSeguro(), "https://www.mercadolivre.com.br/social/perfil");
  assert.strictEqual(diagnostico.metodo, "html");
  assert.strictEqual(diagnostico.provaIdentidadeMeli.ok, true);
  assert.strictEqual(diagnostico.urlProduto, "https://www.mercadolivre.com.br/processador-amd-ryzen/p/MLB32444906?pdp_filters=item_id%3AMLB4876269031");
  assert.strictEqual(diagnostico.diagnostico.fallbackSocial, null);
}

{
  const antes = helpers.logs.length;
  const diagnostico = diagnosticar(helpers, '<script>{"id":"objeto-log","url":"https://produto.mercadolivre.com.br/MLB-7223217402-produto-_JM","product_id":"MLB1234567890"}</script>');
  helpers.logRadarMlSocialDiagnosticoHtml({
    motivoProva: "card_featured_ausente",
    ...diagnostico
  });
  assert.strictEqual(helpers.logs.length, antes + 1);
  assert.strictEqual(helpers.logs.at(-1)[0], "[RADAR-ML-SOCIAL-DIAGNOSTICO-HTML]");
  assert.strictEqual(helpers.logs.at(-1)[1].metodoFallbackEncontrado, "url_json");
  assert.strictEqual(helpers.logs.at(-1)[1].urlProdutoEncontrada, "produto.mercadolivre.com.br/MLB-7223217402-produto-_JM");
  assert.strictEqual(helpers.logs.at(-1)[1].objetosLimitados[0].indiceObjeto, 0);
  assert.ok(helpers.logs.at(-1)[1].objetosLimitados[0].chavesDiretasTexto.includes("url"));
  assert.ok(helpers.logs.at(-1)[1].objetosLimitados[0].camposIrmaosDiretosTexto.includes("id:objeto-log"));
  assert.ok(helpers.logs.at(-1)[1].objetosLimitados[0].urlsDiretasMesmoObjetoTexto.includes("produto.mercadolivre.com.br/MLB-7223217402-produto-_JM"));
  assert.ok(Object.prototype.hasOwnProperty.call(helpers.logs.at(-1)[1].objetosLimitados[0], "caminhoEstrutural"));
}

assert.strictEqual(helpers.chamadasRede.length, 0, "diagnostico estrutural nao deve fazer chamada de rede");

console.log("mercadolivre-social-diagnostico-html.test.js ok");
