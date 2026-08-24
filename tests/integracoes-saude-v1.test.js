"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "integracoes-saude-v1-"));
process.env.DATA_DIR = tempDataDir;

const {
  testarIntegracaoMarketplace
} = require("../utils/testar-integracao-marketplace");
const {
  listarSaudeIntegracoes,
  registrarAlertaIntegracao,
  limparAlertaIntegracao,
  obterSaudeIntegracao,
  registrarSaudeIntegracao,
  registrarResultadoSaudeIntegracao,
  registrarSucessoIntegracao,
  classificarCodigoSaude,
  credencialFingerprintIntegracao,
  obterSaudeIntegracaoAtual,
  obterSaudeIntegracaoCardAtual,
  listarSaudeIntegracoesAtuais,
  reiniciarSaudeIntegracaoSeCredencialMudou
} = require("../utils/alertas-integracoes");
const {
  criarGerarLinkAmazon
} = require("../modules/marketplaces/conversores/amazon.converter");
const {
  criarImportarAmazon
} = require("../marketplaces/amazon/importar");
const {
  criarGerarLinkMercadoLivre
} = require("../modules/marketplaces/conversores/mercadolivre.converter");
const {
  criarGerarLinkAliExpress
} = require("../modules/marketplaces/conversores/aliexpress.converter");
const {
  criarGerarDeepLinkAwin
} = require("../modules/marketplaces/conversores/awin.converter");
const {
  criarImportarShopee
} = require("../marketplaces/shopee/importar");

const fetchOriginal = global.fetch;

function resposta({ ok = true, status = 200, url = "", text = "", json = null } = {}) {
  return {
    ok,
    status,
    url,
    text: async () => text,
    json: async () => json
  };
}

function mockFetchSequencial(respostas = []) {
  const chamadas = [];
  global.fetch = async (url, opcoes = {}) => {
    chamadas.push({ url: String(url), opcoes });
    const proxima = respostas.shift();
    if (proxima instanceof Error) throw proxima;
    if (typeof proxima === "function") return proxima(url, opcoes, chamadas);
    return proxima || resposta({ ok: false, status: 500 });
  };
  return chamadas;
}

async function testeMercadoLivre() {
  mockFetchSequencial([
    resposta({ text: '<input name="_csrf" value="csrf-ok">' }),
    resposta({ json: { short_url: "https://meli.la/teste" } })
  ]);
  const ok = await testarIntegracaoMarketplace("workspace_a", "mercadolivre", {
    credenciais: { tag: "tag-ok", cookies: "cookie-secreto" }
  });
  assert.strictEqual(ok.ok, true);
  assert.strictEqual(ok.saude.status, "saudavel");
  assert.strictEqual(ok.detalhes.cookie, undefined);

  mockFetchSequencial([
    resposta({ ok: false, status: 403, url: "https://www.mercadolivre.com.br/login", text: "login" })
  ]);
  const invalida = await testarIntegracaoMarketplace("workspace_a", "mercadolivre", {
    credenciais: { tag: "tag-ok", cookies: "cookie-secreto" }
  });
  assert.strictEqual(invalida.saude.status, "invalida");

  mockFetchSequencial([
    resposta({ ok: false, status: 503, text: "indisponivel" })
  ]);
  const transitoria = await testarIntegracaoMarketplace("workspace_a", "mercadolivre", {
    credenciais: { tag: "tag-ok", cookies: "cookie-secreto" }
  });
  assert.strictEqual(transitoria.saude.status, "desconhecida");

  mockFetchSequencial([
    resposta({ text: '<meta name="csrf-token" content="csrf-meta">' }),
    resposta({ json: { short_url: "https://meli.la/meta" } })
  ]);
  const csrfMeta = await testarIntegracaoMarketplace("workspace_a", "mercadolivre", {
    credenciais: { tag: "tag-ok", cookies: "cookie-secreto" }
  });
  assert.strictEqual(csrfMeta.saude.status, "saudavel");

  mockFetchSequencial([
    resposta({ text: "<html>linkbuilder sem csrf</html>" })
  ]);
  const semCsrf = await testarIntegracaoMarketplace("workspace_a", "mercadolivre", {
    credenciais: { tag: "tag-ok", cookies: "cookie-secreto" }
  });
  assert.strictEqual(semCsrf.codigo, "falha_teste");
  assert.strictEqual(semCsrf.saude.status, "desconhecida");
}

async function testeAmazon() {
  mockFetchSequencial([
    resposta({ text: '<span id="productTitle">Produto</span>' })
  ]);
  const ok = await testarIntegracaoMarketplace("workspace_a", "amazon", {
    modo: "cookies",
    credenciais: { tag: "tag-20", cookies: "cookie-secreto" }
  });
  assert.strictEqual(ok.saude.status, "saudavel");

  mockFetchSequencial([
    resposta({ status: 200, url: "https://www.amazon.com.br/ap/signin", text: "login" })
  ]);
  const expirada = await testarIntegracaoMarketplace("workspace_a", "amazon", {
    modo: "cookies",
    credenciais: { tag: "tag-20", cookies: "cookie-secreto" }
  });
  assert.strictEqual(expirada.saude.status, "invalida");

  mockFetchSequencial([
    resposta({ status: 200, text: "captcha robot check" })
  ]);
  const captcha = await testarIntegracaoMarketplace("workspace_a", "amazon", {
    modo: "cookies",
    credenciais: { tag: "tag-20", cookies: "cookie-secreto" }
  });
  assert.strictEqual(captcha.saude.status, "desconhecida");

  mockFetchSequencial([
    resposta({ ok: false, status: 403, text: "captcha robot check suspicious traffic" })
  ]);
  const captcha403 = await testarIntegracaoMarketplace("workspace_a", "amazon", {
    modo: "cookies",
    credenciais: { tag: "tag-20", cookies: "cookie-secreto" }
  });
  assert.strictEqual(captcha403.saude.status, "desconhecida");

  const paapi = await testarIntegracaoMarketplace("workspace_a", "amazon", {
    modo: "api",
    credenciais: { appId: "app", accessKey: "ak", secretKey: "sk" }
  });
  assert.strictEqual(paapi.saude.status, "desconhecida");
  assert.strictEqual(paapi.codigo, "teste_paapi_nao_disponivel");
}

async function testeMercadoLivreManualConversorOficial() {
  const chamadasMlFetch = [];
  let importarAmazonChamadoNoTesteMl = false;
  let sucessoRegistrado = null;
  const gerarLinkAfiliadoMercadoLivre = criarGerarLinkMercadoLivre({
    fetch: async (url, opcoes) => {
      chamadasMlFetch.push({ url, opcoes });
      return resposta({ json: { short_url: "https://meli.la/prova-real" } });
    },
    buscarCsrfTokenMercadoLivre: async (cookies, contexto) => {
      assert.strictEqual(cookies, "cookie-secreto");
      assert.strictEqual(contexto.clienteId, "workspace_a");
      assert.strictEqual(contexto.origem, "teste_manual_integracao");
      return "csrf-ok";
    },
    tipoUrlMercadoLivreAfiliado: () => "produto",
    logMlAfiliadoFalhaDetalhe: () => {},
    registrarAlertaMercadoLivre: () => {},
    limparAlertaIntegracao: () => {},
    registrarSucessoIntegracao: (clienteId, marketplace, detalhes) => {
      sucessoRegistrado = { clienteId, marketplace, detalhes };
    }
  });

  const ok = await testarIntegracaoMarketplace("workspace_a", "mercadolivre", {
    credenciais: { tag: "tag-ok", cookies: "cookie-secreto" }
  }, {
    gerarLinkAfiliadoMercadoLivre,
    importarAmazon: () => {
      importarAmazonChamadoNoTesteMl = true;
      return {};
    }
  });
  assert.strictEqual(chamadasMlFetch.length, 1);
  assert.strictEqual(importarAmazonChamadoNoTesteMl, false);
  assert.ok(chamadasMlFetch[0].url.includes("/affiliate-program/api/v2/stripe/user/links"));
  assert.ok(JSON.parse(chamadasMlFetch[0].opcoes.body).url.includes("mercadolivre.com.br"));
  assert.strictEqual(JSON.parse(chamadasMlFetch[0].opcoes.body).tag, "tag-ok");
  assert.strictEqual(ok.ok, true);
  assert.strictEqual(ok.codigo, "afiliado_ok");
  assert.strictEqual(ok.saude.status, "saudavel");
  assert.strictEqual(ok.detalhes.prova, "conversor_oficial");
  assert.strictEqual(sucessoRegistrado.clienteId, "workspace_a");
  assert.strictEqual(sucessoRegistrado.marketplace, "mercadolivre");
  assert.strictEqual(sucessoRegistrado.detalhes.codigo, "afiliado_ok");

  const invalida = await testarIntegracaoMarketplace("workspace_a", "mercadolivre", {
    credenciais: { tag: "tag-ok", cookies: "cookie-secreto" }
  }, {
    gerarLinkAfiliadoMercadoLivre: async () => "",
    obterSaudeIntegracaoAtual: () => ({
      status: "invalida",
      codigo: "cookie_invalido",
      detalhes: { httpStatus: 401 }
    })
  });
  assert.strictEqual(invalida.ok, false);
  assert.strictEqual(invalida.codigo, "cookie_expirado");
  assert.strictEqual(invalida.saude.status, "invalida");

  const transitoria = await testarIntegracaoMarketplace("workspace_a", "mercadolivre", {
    credenciais: { tag: "tag-ok", cookies: "cookie-secreto" }
  }, {
    gerarLinkAfiliadoMercadoLivre: async () => {
      const erro = new Error("timeout");
      erro.name = "AbortError";
      throw erro;
    }
  });
  assert.strictEqual(transitoria.ok, false);
  assert.strictEqual(transitoria.codigo, "falha_teste");
  assert.strictEqual(transitoria.saude.status, "desconhecida");
  assert.strictEqual(transitoria.detalhes.motivo, "timeout");

  const csrfInconclusivo = await testarIntegracaoMarketplace("workspace_a", "mercadolivre", {
    credenciais: { tag: "tag-ok", cookies: "cookie-secreto" }
  }, {
    gerarLinkAfiliadoMercadoLivre: async () => "",
    obterSaudeIntegracaoAtual: () => ({
      status: "invalida",
      codigo: "cookie_invalido",
      detalhes: { httpStatus: 403, motivo: "csrf_nao_encontrado" }
    })
  });
  assert.strictEqual(csrfInconclusivo.codigo, "falha_teste");
  assert.strictEqual(csrfInconclusivo.saude.status, "desconhecida");

  const semLink = await testarIntegracaoMarketplace("workspace_a", "mercadolivre", {
    credenciais: { tag: "tag-ok", cookies: "cookie-secreto" }
  }, {
    gerarLinkAfiliadoMercadoLivre: async () => "https://www.mercadolivre.com.br/link-nao-afiliado"
  });
  assert.strictEqual(semLink.ok, false);
  assert.strictEqual(semLink.codigo, "falha_teste");
  assert.strictEqual(semLink.saude.status, "desconhecida");
}

async function testeAmazonManualProvaAutenticada() {
  const gerarLinkAmazon = criarGerarLinkAmazon({});

  const chamadasImportadorOk = [];
  const chamadasFetchOk = mockFetchSequencial([]);
  const okImportador = await testarIntegracaoMarketplace("workspace_a", "amazon", {
    modo: "cookies",
    credenciais: { tag: "tag-20", cookies: "cookie-secreto" }
  }, {
    gerarLinkAmazon,
    importarAmazon: async (url, config) => {
      chamadasImportadorOk.push({ url, config });
      return {
        titulo: "Produto Real Amazon",
        precoAtual: "99,90",
        imagem: "https://m.media-amazon.com/images/I/produto.jpg",
        linkAfiliado: url
      };
    }
  });
  assert.strictEqual(okImportador.ok, true);
  assert.strictEqual(okImportador.codigo, "cookie_valido");
  assert.strictEqual(okImportador.saude.status, "saudavel");
  assert.strictEqual(okImportador.detalhes.prova, "importador_oficial_amazon");
  assert.strictEqual(chamadasImportadorOk.length, 1);
  assert.strictEqual(chamadasImportadorOk[0].config.contextoEngine.origem, "teste_manual_integracao");
  assert.strictEqual(chamadasFetchOk.length, 0);

  const chamadasOk = mockFetchSequencial([
    resposta({ text: '<html><span id="productTitle">Produto</span></html>' })
  ]);
  const ok = await testarIntegracaoMarketplace("workspace_a", "amazon", {
    modo: "cookies",
    credenciais: { tag: "tag-20", cookies: "cookie-secreto" }
  }, { gerarLinkAmazon });
  assert.strictEqual(ok.ok, true);
  assert.strictEqual(ok.codigo, "cookie_valido");
  assert.strictEqual(ok.saude.status, "saudavel");
  assert.strictEqual(ok.detalhes.prova, "produto_autenticado_com_tag");
  assert.ok(chamadasOk[0].url.includes("tag=tag-20"));

  mockFetchSequencial([
    resposta({
      text: '<html><head><link rel="canonical" href="https://www.amazon.com.br/dp/B07PGL2ZSL"></head><body data-asin="B07PGL2ZSL"></body></html>'
    })
  ]);
  const canonical = await testarIntegracaoMarketplace("workspace_a", "amazon", {
    modo: "cookies",
    credenciais: { tag: "tag-20", cookies: "cookie-secreto" }
  }, { gerarLinkAmazon });
  assert.strictEqual(canonical.ok, true);
  assert.strictEqual(canonical.saude.status, "saudavel");

  mockFetchSequencial([
    resposta({ status: 200, url: "https://www.amazon.com.br/ap/signin", text: "login" })
  ]);
  const invalida = await testarIntegracaoMarketplace("workspace_a", "amazon", {
    modo: "cookies",
    credenciais: { tag: "tag-20", cookies: "cookie-secreto" }
  }, { gerarLinkAmazon });
  assert.strictEqual(invalida.ok, false);
  assert.strictEqual(invalida.codigo, "cookie_expirado");
  assert.strictEqual(invalida.saude.status, "invalida");

  mockFetchSequencial([
    resposta({ ok: false, status: 503, text: "indisponivel" })
  ]);
  const transitoria = await testarIntegracaoMarketplace("workspace_a", "amazon", {
    modo: "cookies",
    credenciais: { tag: "tag-20", cookies: "cookie-secreto" }
  }, { gerarLinkAmazon });
  assert.strictEqual(transitoria.codigo, "falha_teste");
  assert.strictEqual(transitoria.saude.status, "desconhecida");

  mockFetchSequencial([
    resposta({ ok: false, status: 429, text: "rate limit" })
  ]);
  const rateLimit = await testarIntegracaoMarketplace("workspace_a", "amazon", {
    modo: "cookies",
    credenciais: { tag: "tag-20", cookies: "cookie-secreto" }
  }, { gerarLinkAmazon });
  assert.strictEqual(rateLimit.codigo, "falha_teste");
  assert.strictEqual(rateLimit.saude.status, "desconhecida");

  const erroRede = new Error("socket hang up");
  mockFetchSequencial([erroRede]);
  const rede = await testarIntegracaoMarketplace("workspace_a", "amazon", {
    modo: "cookies",
    credenciais: { tag: "tag-20", cookies: "cookie-secreto" }
  }, { gerarLinkAmazon });
  assert.strictEqual(rede.codigo, "falha_teste");
  assert.strictEqual(rede.saude.status, "desconhecida");
  assert.strictEqual(rede.detalhes.motivo, "erro_rede");

  const erroTimeout = new Error("timeout");
  erroTimeout.name = "AbortError";
  const timeout = await testarIntegracaoMarketplace("workspace_a", "amazon", {
    modo: "cookies",
    credenciais: { tag: "tag-20", cookies: "cookie-secreto" }
  }, {
    gerarLinkAmazon,
    importarAmazon: async () => {
      throw erroTimeout;
    }
  });
  assert.strictEqual(timeout.codigo, "falha_teste");
  assert.strictEqual(timeout.saude.status, "desconhecida");
  assert.strictEqual(timeout.detalhes.motivo, "timeout");

  mockFetchSequencial([
    resposta({ text: "<html>pagina sem prova de produto</html>" })
  ]);
  const semProvaProduto = await testarIntegracaoMarketplace("workspace_a", "amazon", {
    modo: "cookies",
    credenciais: { tag: "tag-20", cookies: "cookie-secreto" }
  }, { gerarLinkAmazon });
  assert.strictEqual(semProvaProduto.ok, false);
  assert.strictEqual(semProvaProduto.codigo, "falha_teste");
  assert.strictEqual(semProvaProduto.saude.status, "desconhecida");

  const semLink = await testarIntegracaoMarketplace("workspace_a", "amazon", {
    modo: "cookies",
    credenciais: { tag: "tag-20", cookies: "cookie-secreto" }
  }, {
    gerarLinkAmazon: () => ""
  });
  assert.strictEqual(semLink.ok, false);
  assert.strictEqual(semLink.codigo, "falha_teste");
  assert.strictEqual(semLink.saude.status, "desconhecida");

  let gerarLinkAmazonChamadoNoModoApi = false;
  const api = await testarIntegracaoMarketplace("workspace_a", "amazon", {
    modo: "api",
    credenciais: { appId: "app", accessKey: "ak", secretKey: "sk" }
  }, {
    gerarLinkAmazon: () => {
      gerarLinkAmazonChamadoNoModoApi = true;
      return "https://www.amazon.com.br/dp/B07PGL2ZSL?tag=tag-20";
    }
  });
  assert.strictEqual(gerarLinkAmazonChamadoNoModoApi, false);
  assert.strictEqual(api.ok, false);
  assert.strictEqual(api.codigo, "teste_paapi_nao_disponivel");
  assert.strictEqual(api.saude.status, "desconhecida");
}

async function testeShopee() {
  mockFetchSequencial([
    resposta({
      json: {
        data: {
          productOfferV2: {
            nodes: [{ itemId: "1", productName: "Oferta", offerLink: "https://s.shopee.com.br/x" }]
          }
        }
      }
    })
  ]);
  const ok = await testarIntegracaoMarketplace("workspace_a", "shopee", {
    credenciais: { appId: "app", secret: "secret" }
  });
  assert.strictEqual(ok.saude.status, "saudavel");
  assert.strictEqual(JSON.stringify(ok).includes("secret"), false);

  mockFetchSequencial([
    resposta({ status: 403, json: { errors: [{ message: "invalid signature" }] } })
  ]);
  const invalida = await testarIntegracaoMarketplace("workspace_a", "shopee", {
    credenciais: { appId: "app", secret: "secret" }
  });
  assert.strictEqual(invalida.saude.status, "invalida");
}

async function testeShopeeSensorPassivoFalhaQualificada() {
  const depsBase = {
    limparPreco: (valor = "") => String(valor || "").replace(/^R\$\s*/i, "").trim(),
    htmlDecode: (valor = "") => String(valor || ""),
    extrairMeta: () => "",
    corrigirImagemUrl: (valor = "") => String(valor || "")
  };
  const config = {
    credenciais: { appId: "app", secret: "secret" },
    contextoEngine: { clienteId: "workspace_shopee_sensor" },
    textoOriginal: ""
  };
  const url = "https://shopee.com.br/product/123/456";

  let alerta = null;
  global.fetch = async (fetchUrl) => {
    if (String(fetchUrl).includes("open-api.affiliate.shopee.com.br")) {
      return resposta({
        ok: false,
        status: 403,
        json: { errors: [{ message: "invalid signature", code: "AUTH_INVALID" }] }
      });
    }
    return resposta({ status: 200, text: "<html></html>" });
  };
  await criarImportarShopee({
    ...depsBase,
    registrarAlertaIntegracao: (...args) => {
      alerta = args;
    }
  })(url, config);
  assert.ok(alerta, "Shopee deve registrar alerta passivo em erro auth qualificado");
  assert.strictEqual(alerta[0], "workspace_shopee_sensor");
  assert.strictEqual(alerta[1], "shopee");
  assert.strictEqual(alerta[2].tipo, "credencial_invalida");
  assert.ok(alerta[2].detalhes.credencialFingerprint);

  let alertaTransitorio = null;
  global.fetch = async (fetchUrl) => {
    if (String(fetchUrl).includes("open-api.affiliate.shopee.com.br")) {
      return resposta({
        ok: false,
        status: 429,
        json: { errors: [{ message: "rate limit" }] }
      });
    }
    return resposta({ status: 200, text: "<html></html>" });
  };
  await criarImportarShopee({
    ...depsBase,
    registrarAlertaIntegracao: (...args) => {
      alertaTransitorio = args;
    }
  })(url, config);
  assert.strictEqual(alertaTransitorio, null, "Shopee 429/transitorio nao deve registrar invalida");

  const importarSemSensor = criarImportarShopee(depsBase);
  const importarSensorThrow = criarImportarShopee({
    ...depsBase,
    registrarAlertaIntegracao: () => {
      throw new Error("sensor");
    }
  });
  const respostaAuthInvalida = async (fetchUrl) => {
    if (String(fetchUrl).includes("open-api.affiliate.shopee.com.br")) {
      return resposta({
        ok: false,
        status: 403,
        json: { errors: [{ message: "invalid signature", code: "AUTH_INVALID" }] }
      });
    }
    return resposta({ status: 200, text: "<html></html>" });
  };
  global.fetch = respostaAuthInvalida;
  const semSensor = await importarSemSensor(url, config);
  global.fetch = respostaAuthInvalida;
  const sensorThrow = await importarSensorThrow(url, config);
  assert.deepStrictEqual(sensorThrow, semSensor, "Falha do sensor Shopee nao pode alterar retorno comercial");
}

async function testeAliExpress() {
  const configAli = {
    credenciais: {
      appKey: "app",
      secret: "secret",
      trackingId: "track",
      urlTeste: "https://www.aliexpress.com/item/1005009999999999.html"
    }
  };
  const chamadasOk = mockFetchSequencial([
    resposta({
      json: {
        aliexpress_affiliate_link_generate_response: {
          resp_result: {
            result: {
              promotion_links: {
                promotion_link: [{ promotion_link: "https://s.click.aliexpress.com/e/_ok" }]
              }
            }
          }
        }
      }
    })
  ]);
  const ok = await testarIntegracaoMarketplace("workspace_a", "aliexpress", configAli);
  assert.strictEqual(ok.saude.status, "saudavel");
  assert.strictEqual(ok.detalhes.promocaoGerada, true);
  assert.strictEqual(
    new URLSearchParams(String(chamadasOk[0].opcoes.body)).get("source_values"),
    "https://www.aliexpress.com/item/1005009999999999.html"
  );
  const fingerprintAli = credencialFingerprintIntegracao("aliexpress", configAli);
  registrarResultadoSaudeIntegracao("workspace_aliexpress_teste", "aliexpress", {
    ...ok,
    credencialFingerprint: fingerprintAli,
    saude: { ...ok.saude, credencialFingerprint: fingerprintAli }
  }, "manual");
  assert.strictEqual(
    obterSaudeIntegracaoAtual("workspace_aliexpress_teste", "aliexpress", configAli).status,
    "saudavel"
  );
  assert.strictEqual(
    obterSaudeIntegracaoCardAtual("workspace_aliexpress_teste", "aliexpress", configAli).status,
    "saudavel"
  );

  mockFetchSequencial([
    resposta({ json: { error_response: { code: "15", msg: "invalid signature" } } })
  ]);
  const invalida = await testarIntegracaoMarketplace("workspace_a", "aliexpress", configAli);
  assert.strictEqual(invalida.saude.status, "invalida");

  const chamadasUrlInvalida = mockFetchSequencial([]);
  const inconclusiva = await testarIntegracaoMarketplace("workspace_a", "aliexpress", {
    credenciais: {
      appKey: "app",
      secret: "secret",
      trackingId: "track",
      urlTeste: "https://www.aliexpress.com/"
    },
    queryEngine: async () => ({ ok: true, resultado: { rows: [] } })
  });
  assert.strictEqual(inconclusiva.saude.status, "desconhecida");
  assert.strictEqual(inconclusiva.status, "falha_teste");
  assert.strictEqual(inconclusiva.detalhes.motivo, "url_prova_aliexpress_indisponivel");
  assert.strictEqual(chamadasUrlInvalida.length, 0);

  const chamadasRecente = mockFetchSequencial([
    resposta({
      json: {
        aliexpress_affiliate_link_generate_response: {
          resp_result: {
            result: {
              promotion_links: {
                promotion_link: [{ promotion_link: "https://s.click.aliexpress.com/e/_recente" }]
              }
            }
          }
        }
      }
    })
  ]);
  const recente = await testarIntegracaoMarketplace("workspace_a", "aliexpress", {
    credenciais: { appKey: "app", secret: "secret", trackingId: "track" },
    queryEngine: async () => ({
      ok: true,
      resultado: {
        rows: [
          { url_original: "https://a.aliexpress.com/_c3yGqeR9" }
        ]
      }
    })
  });
  assert.strictEqual(recente.saude.status, "saudavel");
  assert.strictEqual(
    new URLSearchParams(String(chamadasRecente[0].opcoes.body)).get("source_values"),
    "https://a.aliexpress.com/_c3yGqeR9"
  );
}

async function testeAwinKabum() {
  mockFetchSequencial([
    resposta({ json: [{ id: 17729, name: "KaBuM" }] }),
    resposta({ json: { shortUrl: "https://www.awin1.com/cread.php?awinmid=17729" } })
  ]);
  const ok = await testarIntegracaoMarketplace("workspace_a", "kabum", {
    credenciais: {
      publisherId: "123",
      apiToken: "token-secreto",
      programas: [{ nome: "kabum", advertiserId: "17729" }]
    }
  });
  assert.strictEqual(ok.saude.status, "saudavel");
  assert.strictEqual(JSON.stringify(ok).includes("token-secreto"), false);

  mockFetchSequencial([
    resposta({ json: [{ id: 999, name: "Outro" }] })
  ]);
  const invalida = await testarIntegracaoMarketplace("workspace_a", "kabum", {
    credenciais: {
      publisherId: "123",
      apiToken: "token-secreto",
      programas: [{ nome: "kabum", advertiserId: "17729" }]
    }
  });
  assert.strictEqual(invalida.saude.status, "invalida");
  registrarResultadoSaudeIntegracao("workspace_a", "kabum", invalida, "manual");

  const configAwinUnico = {
    credenciais: {
      publisherId: "123",
      apiToken: "token-secreto",
      programas: [{ nome: "kabum", advertiserId: "17729" }]
    }
  };
  mockFetchSequencial([
    resposta({ json: [{ id: 17729, name: "KaBuM" }] }),
    resposta({ json: { shortUrl: "https://www.awin1.com/cread.php?awinmid=17729" } })
  ]);
  const awinUnico = await testarIntegracaoMarketplace("workspace_awin_unico", "awin", configAwinUnico);
  assert.strictEqual(awinUnico.saude.status, "saudavel");
  assert.strictEqual(awinUnico.saude.integracaoId, "advertiser:17729");
  const fingerprintAwinUnico = credencialFingerprintIntegracao("awin", configAwinUnico, {
    integracaoId: "advertiser:17729"
  });
  registrarResultadoSaudeIntegracao("workspace_awin_unico", "awin", {
    ...awinUnico,
    credencialFingerprint: fingerprintAwinUnico,
    saude: { ...awinUnico.saude, credencialFingerprint: fingerprintAwinUnico },
    saudeFilhas: (awinUnico.saudeFilhas || []).map(filha => ({
      ...filha,
      credencialFingerprint: fingerprintAwinUnico
    }))
  }, "manual");
  assert.strictEqual(
    obterSaudeIntegracaoAtual("workspace_awin_unico", "awin", configAwinUnico, "advertiser:17729").status,
    "saudavel"
  );
  assert.strictEqual(
    listarSaudeIntegracoesAtuais("workspace_awin_unico", { awin: configAwinUnico })
      .some(item => item.marketplace === "awin" && !item.integracaoId && item.status === "desconhecida"),
    false
  );
  assert.strictEqual(
    obterSaudeIntegracaoCardAtual("workspace_awin_unico", "awin", configAwinUnico, { awin: configAwinUnico }).status,
    "saudavel"
  );

  const configAwinParcial = {
    credenciais: {
      publisherId: "123",
      apiToken: "token-secreto",
      programas: [
        { nome: "kabum", advertiserId: "17729" },
        { nome: "loja_b", advertiserId: "222" }
      ]
    }
  };
  mockFetchSequencial([
    resposta({ json: [{ id: 17729, name: "KaBuM" }] }),
    resposta({ json: { shortUrl: "https://www.awin1.com/cread.php?awinmid=17729" } })
  ]);
  const awinParcial = await testarIntegracaoMarketplace("workspace_a", "awin", configAwinParcial);
  registrarResultadoSaudeIntegracao("workspace_a", "awin", {
    ...awinParcial,
    saudeFilhas: awinParcial.saudeFilhas.map(filha => ({
      ...filha,
      credencialFingerprint: credencialFingerprintIntegracao("awin", configAwinParcial, {
        integracaoId: filha.integracaoId
      })
    }))
  }, "manual");
  assert.strictEqual(obterSaudeIntegracao("workspace_a", "awin").status, "invalida");
  assert.strictEqual(obterSaudeIntegracao("workspace_a", "awin", "advertiser:17729").status, "saudavel");
  assert.strictEqual(obterSaudeIntegracao("workspace_a", "awin", "advertiser:222").status, "invalida");
  assert.strictEqual(obterSaudeIntegracao("workspace_a", "awin", "advertiser:17729").status, "saudavel");
  assert.strictEqual(obterSaudeIntegracao("workspace_a", "kabum", "advertiser:17729").status, "invalida");
  assert.strictEqual(
    obterSaudeIntegracaoCardAtual("workspace_a", "awin", configAwinParcial, { awin: configAwinParcial }).status,
    "invalida"
  );

  const configAwinTodosOk = {
    credenciais: {
      publisherId: "123",
      apiToken: "token-secreto",
      programas: [
        { nome: "kabum", advertiserId: "111", urlTeste: "https://www.kabum.com.br/" },
        { nome: "kabum", advertiserId: "222", urlTeste: "https://www.kabum.com.br/" }
      ]
    }
  };
  mockFetchSequencial([
    resposta({ json: [{ id: 111, name: "Loja A" }, { id: 222, name: "Loja B" }] }),
    resposta({ json: { shortUrl: "https://www.awin1.com/cread.php?awinmid=111" } }),
    resposta({ json: { shortUrl: "https://www.awin1.com/cread.php?awinmid=222" } })
  ]);
  const awinTodosOk = await testarIntegracaoMarketplace("workspace_awin_all_ok", "awin", configAwinTodosOk);
  assert.strictEqual(awinTodosOk.saude.status, "saudavel");
  assert.strictEqual(awinTodosOk.saudeFilhas.every(item => item.status === "ok"), true);
  registrarResultadoSaudeIntegracao("workspace_awin_all_ok", "awin", {
    ...awinTodosOk,
    saudeFilhas: awinTodosOk.saudeFilhas.map(filha => ({
      ...filha,
      credencialFingerprint: credencialFingerprintIntegracao("awin", configAwinTodosOk, {
        integracaoId: filha.integracaoId
      })
    }))
  }, "manual");
  assert.strictEqual(
    obterSaudeIntegracaoCardAtual("workspace_awin_all_ok", "awin", configAwinTodosOk, { awin: configAwinTodosOk }).status,
    "saudavel"
  );
}

function testeSensorPassivo() {
  registrarAlertaIntegracao("workspace_a", "mercadolivre", {
    tipo: "cookie_expirado",
    mensagem: "cookie caiu",
    detalhes: { cookies: "nao-vazar", httpStatus: 403 }
  });
  let saude = obterSaudeIntegracao("workspace_a", "mercadolivre");
  assert.strictEqual(saude.status, "invalida");
  assert.strictEqual(JSON.stringify(saude).includes("nao-vazar"), false);

  limparAlertaIntegracao("workspace_a", "mercadolivre");
  saude = obterSaudeIntegracao("workspace_a", "mercadolivre");
  assert.strictEqual(saude.status, "desconhecida");
  assert.strictEqual(saude.codigo, "alerta_limpo_sem_prova");

  registrarSucessoIntegracao("workspace_a", "mercadolivre", {
    codigo: "afiliado_ok",
    origem: "teste"
  });
  saude = obterSaudeIntegracao("workspace_a", "mercadolivre");
  assert.strictEqual(saude.status, "saudavel");
  assert.strictEqual(saude.codigo, "afiliado_ok");

  registrarAlertaIntegracao("workspace_a", "mercadolivre", {
    tipo: "falha_teste",
    mensagem: "timeout isolado",
    detalhes: { httpStatus: 503 }
  });
  saude = obterSaudeIntegracao("workspace_a", "mercadolivre");
  assert.notStrictEqual(saude.status, "invalida");

  registrarSucessoIntegracao("workspace_janela", "mercadolivre", {
    codigo: "afiliado_ok",
    origem: "teste"
  });
  registrarAlertaIntegracao("workspace_janela", "mercadolivre", {
    tipo: "cookie_expirado",
    mensagem: "falha qualificada isolada",
    detalhes: { httpStatus: 401 }
  });
  saude = obterSaudeIntegracao("workspace_janela", "mercadolivre");
  assert.strictEqual(saude.status, "saudavel");

  registrarSaudeIntegracao("workspace_janela", "mercadolivre", {
    status: "saudavel",
    codigo: "afiliado_ok",
    mensagem: "Integracao funcionando",
    origem: "teste",
    ultimaProvaPositivaEm: new Date(Date.now() - 6 * 60 * 1000).toISOString(),
    falhaQualificadaPendenteEm: new Date(Date.now() - 4 * 60 * 1000).toISOString(),
    falhasQualificadas: 1
  });
  registrarAlertaIntegracao("workspace_janela", "mercadolivre", {
    tipo: "cookie_expirado",
    mensagem: "falha qualificada recorrente",
    detalhes: { httpStatus: 401 }
  });
  saude = obterSaudeIntegracao("workspace_janela", "mercadolivre");
  assert.strictEqual(saude.status, "invalida");

  registrarResultadoSaudeIntegracao("workspace_a", "shopee", {
    status: "credencial_invalida",
    codigo: "credencial_invalida"
  }, "sensor");
  registrarResultadoSaudeIntegracao("workspace_b", "shopee", {
    status: "ok",
    codigo: "ok"
  }, "sensor");
  assert.strictEqual(obterSaudeIntegracao("workspace_a", "shopee").status, "invalida");
  assert.strictEqual(obterSaudeIntegracao("workspace_b", "shopee").status, "saudavel");
  assert.strictEqual(listarSaudeIntegracoes("workspace_a").some(item => item.marketplace === "amazon"), false);

  assert.strictEqual(classificarCodigoSaude("bloqueio_ml", { httpStatus: 403, motivo: "captcha" }), "desconhecida");
  assert.strictEqual(classificarCodigoSaude("credencial_invalida", { httpStatus: 403 }), "invalida");
  assert.strictEqual(classificarCodigoSaude("falha_teste", { httpStatus: 429 }), "desconhecida");
}

async function testeSensoresPassivosConversores() {
  const gerarAli = criarGerarLinkAliExpress({
    fetch: async () => resposta({
      json: {
        aliexpress_affiliate_link_generate_response: {
          resp_result: {
            result: {
              promotion_links: {
                promotion_link: [{ promotion_link: "https://s.click.aliexpress.com/e/_ok" }]
              }
            }
          }
        }
      }
    }),
    timestampGMT8: () => "2026-08-14 12:00:00",
    assinar: () => "assinatura",
    registrarSucessoIntegracao
  });
  const linkAli = await gerarAli(
    "https://www.aliexpress.com/item/1005006871288989.html",
    { appKey: "app", secret: "secret", trackingId: "track" },
    { clienteId: "workspace_ali" }
  );
  assert.strictEqual(linkAli, "https://s.click.aliexpress.com/e/_ok");
  assert.strictEqual(obterSaudeIntegracao("workspace_ali", "aliexpress").status, "saudavel");

  const gerarAwin = criarGerarDeepLinkAwin({
    axios: {
      post: async () => ({ data: { shortUrl: "https://www.awin1.com/cread.php?awinmid=17729" } })
    },
    getIntegracaoCliente: () => ({
      credenciais: {
        publisherId: "123",
        apiToken: "token-secreto",
        programas: [{ nome: "kabum", advertiserId: "17729" }]
      }
    }),
    obterProgramaAwin: () => ({ nome: "kabum", advertiserId: "17729" }),
    registrarSucessoIntegracao
  });
  const linkAwin = await gerarAwin("https://www.kabum.com.br/produto/123/teste", "workspace_awin");
  assert.strictEqual(linkAwin, "https://www.awin1.com/cread.php?awinmid=17729");
  assert.strictEqual(obterSaudeIntegracao("workspace_awin", "kabum", "advertiser:17729").status, "saudavel");
  assert.strictEqual(obterSaudeIntegracao("workspace_awin", "kabum"), null);
}

function testeKabumSemBaseDesconhecidaArtificial() {
  const resultadoKabum = {
    ok: true,
    marketplace: "kabum",
    integracaoId: "advertiser:17729",
    status: "ok",
    codigo: "ok",
    saude: {
      marketplace: "kabum",
      integracaoId: "advertiser:17729",
      status: "saudavel",
      codigo: "ok"
    }
  };

  limparAlertaIntegracao("workspace_kabum_manual", "kabum", {
    integracaoId: resultadoKabum.integracaoId,
    apenasAlerta: true
  });
  registrarResultadoSaudeIntegracao("workspace_kabum_manual", "kabum", resultadoKabum, "manual");

  assert.strictEqual(obterSaudeIntegracao("workspace_kabum_manual", "kabum"), null);
  assert.strictEqual(
    obterSaudeIntegracao("workspace_kabum_manual", "kabum", "advertiser:17729").status,
    "saudavel"
  );

  registrarResultadoSaudeIntegracao("workspace_kabum_multi", "kabum", {
    ok: false,
    marketplace: "kabum",
    status: "programa_invalido",
    codigo: "programa_invalido",
    saudeFilhas: [
      {
        marketplace: "kabum",
        integracaoId: "advertiser:111",
        status: "ok",
        codigo: "ok"
      },
      {
        marketplace: "kabum",
        integracaoId: "advertiser:222",
        status: "programa_invalido",
        codigo: "programa_invalido"
      }
    ]
  }, "manual");
  assert.strictEqual(obterSaudeIntegracao("workspace_kabum_multi", "kabum", "advertiser:111").status, "saudavel");
  assert.strictEqual(obterSaudeIntegracao("workspace_kabum_multi", "kabum", "advertiser:222").status, "invalida");

  registrarResultadoSaudeIntegracao("workspace_kabum_all_ok", "kabum", {
    ok: true,
    marketplace: "kabum",
    status: "ok",
    codigo: "ok",
    saudeFilhas: [
      {
        marketplace: "kabum",
        integracaoId: "advertiser:111",
        status: "ok",
        codigo: "ok"
      },
      {
        marketplace: "kabum",
        integracaoId: "advertiser:222",
        status: "ok",
        codigo: "ok"
      }
    ]
  }, "manual");
  assert.strictEqual(obterSaudeIntegracao("workspace_kabum_all_ok", "kabum", "advertiser:111").status, "saudavel");
  assert.strictEqual(obterSaudeIntegracao("workspace_kabum_all_ok", "kabum", "advertiser:222").status, "saudavel");
}

function testeAmazonUrlNaoPintaVerde() {
  const gerarLinkAmazon = criarGerarLinkAmazon({
    registrarAlertaAmazon: registrarAlertaIntegracao,
    limparAlertaIntegracao
  });

  registrarAlertaIntegracao("workspace_a", "amazon", {
    tipo: "cookie_expirado",
    detalhes: { httpStatus: 403 }
  });
  const link = gerarLinkAmazon("workspace_a", "https://www.amazon.com.br/dp/B07PGL2ZSL", {
    credenciais: { trackingId: "tag-20" }
  });
  assert.ok(link.includes("tag=tag-20"));
  const saude = obterSaudeIntegracao("workspace_a", "amazon");
  assert.strictEqual(saude.status, "desconhecida");
  assert.notStrictEqual(saude.status, "saudavel");

  const semSensor = criarGerarLinkAmazon({})("workspace_a", "https://www.amazon.com.br/dp/B07PGL2ZSL", {
    credenciais: { trackingId: "tag-20" }
  });
  const sensorThrow = criarGerarLinkAmazon({
    limparAlertaIntegracao: () => { throw new Error("sensor"); }
  })("workspace_a", "https://www.amazon.com.br/dp/B07PGL2ZSL", {
    credenciais: { trackingId: "tag-20" }
  });

  const writeFileSyncOriginal = fs.writeFileSync;
  let storageThrow = "";
  try {
    fs.writeFileSync = () => { throw new Error("storage"); };
    storageThrow = criarGerarLinkAmazon({
      limparAlertaIntegracao
    })("workspace_a", "https://www.amazon.com.br/dp/B07PGL2ZSL", {
      credenciais: { trackingId: "tag-20" }
    });
  } finally {
    fs.writeFileSync = writeFileSyncOriginal;
  }

  assert.strictEqual(semSensor, "https://www.amazon.com.br/dp/B07PGL2ZSL?tag=tag-20");
  assert.strictEqual(sensorThrow, "https://www.amazon.com.br/dp/B07PGL2ZSL?tag=tag-20");
  assert.strictEqual(storageThrow, "https://www.amazon.com.br/dp/B07PGL2ZSL?tag=tag-20");
}

function validarCicloCredencialAtual({
  clienteId,
  marketplace,
  configA,
  configB,
  configC,
  integracaoId = ""
}) {
  const fpA = credencialFingerprintIntegracao(marketplace, configA, { integracaoId });
  const fpB = credencialFingerprintIntegracao(marketplace, configB, { integracaoId });
  const fpC = credencialFingerprintIntegracao(marketplace, configC, { integracaoId });

  assert.ok(fpA.startsWith("sha256:"), `${marketplace} deve gerar fingerprint`);
  assert.notStrictEqual(fpA, fpB, `${marketplace} deve mudar fingerprint ao trocar credencial`);
  assert.notStrictEqual(fpB, fpC, `${marketplace} deve mudar fingerprint ao restaurar credencial valida`);

  registrarResultadoSaudeIntegracao(clienteId, marketplace, {
    ok: true,
    marketplace,
    integracaoId,
    status: "ok",
    codigo: "ok",
    credencialFingerprint: fpA
  }, "manual");
  assert.strictEqual(
    obterSaudeIntegracaoAtual(clienteId, marketplace, configA, integracaoId).status,
    "saudavel",
    `${marketplace} A valida deve ficar verde`
  );
  registrarResultadoSaudeIntegracao(clienteId, marketplace, {
    ok: false,
    marketplace,
    integracaoId,
    status: "credencial_invalida",
    codigo: "credencial_invalida",
    credencialFingerprint: fpA
  }, "manual");
  assert.strictEqual(
    obterSaudeIntegracaoAtual(clienteId, marketplace, configA, integracaoId).status,
    "invalida",
    `${marketplace} teste manual negativo da credencial atual deve ficar vermelho imediatamente`
  );
  registrarResultadoSaudeIntegracao(clienteId, marketplace, {
    ok: true,
    marketplace,
    integracaoId,
    status: "ok",
    codigo: "ok",
    credencialFingerprint: fpA
  }, "manual");

  reiniciarSaudeIntegracaoSeCredencialMudou(clienteId, marketplace, configB);
  assert.strictEqual(
    obterSaudeIntegracaoAtual(clienteId, marketplace, configB, integracaoId).status,
    "desconhecida",
    `${marketplace} salvar B deve voltar para nao testado`
  );
  assert.strictEqual(
    obterSaudeIntegracaoAtual(clienteId, marketplace, configB, integracaoId).ultimaProvaPositivaEm,
    null,
    `${marketplace} B nao deve herdar prova positiva antiga`
  );

  registrarResultadoSaudeIntegracao(clienteId, marketplace, {
    ok: false,
    marketplace,
    integracaoId,
    status: "credencial_invalida",
    codigo: "credencial_invalida",
    credencialFingerprint: fpB
  }, "manual");
  assert.strictEqual(
    obterSaudeIntegracaoAtual(clienteId, marketplace, configB, integracaoId).status,
    "invalida",
    `${marketplace} teste negativo de B deve ficar vermelho`
  );

  reiniciarSaudeIntegracaoSeCredencialMudou(clienteId, marketplace, configC);
  assert.strictEqual(
    obterSaudeIntegracaoAtual(clienteId, marketplace, configC, integracaoId).status,
    "desconhecida",
    `${marketplace} salvar C deve voltar para nao testado antes do teste`
  );

  registrarResultadoSaudeIntegracao(clienteId, marketplace, {
    ok: true,
    marketplace,
    integracaoId,
    status: "ok",
    codigo: "ok",
    credencialFingerprint: fpC
  }, "manual");
  const saudeC = obterSaudeIntegracaoAtual(clienteId, marketplace, configC, integracaoId);
  assert.strictEqual(saudeC.status, "saudavel", `${marketplace} teste positivo de C deve ficar verde`);
  assert.strictEqual(saudeC.credencialFingerprint, fpC, `${marketplace} verde deve pertencer ao fingerprint atual`);
  assert.strictEqual(
    obterSaudeIntegracao(clienteId, marketplace, integracaoId).credencialFingerprint,
    fpC,
    `${marketplace} reload deve preservar verde apenas com fingerprint atual persistido`
  );
}

function testeCredencialAtualFingerprintUniversal() {
  const fpNormalizado = credencialFingerprintIntegracao("mercadolivre", {
    credenciais: { cookies: " cookie-a ", tag: " TAG-OK " }
  });
  assert.strictEqual(
    fpNormalizado,
    credencialFingerprintIntegracao("mercadolivre", {
      credenciais: { cookies: "cookie-a", tagId: "tag-ok" }
    }),
    "espacos e alias de tag nao devem trocar fingerprint da mesma credencial"
  );

  validarCicloCredencialAtual({
    clienteId: "workspace_fp_ml",
    marketplace: "mercadolivre",
    configA: { credenciais: { cookies: "cookie-a", tag: "tag-ok" } },
    configB: { credenciais: { cookies: "cookie-lixo", tag: "tag-ok" } },
    configC: { credenciais: { cookies: "cookie-c", tag: "tag-ok" } }
  });

  validarCicloCredencialAtual({
    clienteId: "workspace_fp_amazon",
    marketplace: "amazon",
    configA: { modo: "cookies", credenciais: { cookies: "cookie-a", tag: "tag-20" } },
    configB: { modo: "cookies", credenciais: { cookies: "cookie-lixo", tag: "tag-20" } },
    configC: { modo: "cookies", credenciais: { cookies: "cookie-c", tag: "tag-20" } }
  });

  validarCicloCredencialAtual({
    clienteId: "workspace_fp_shopee",
    marketplace: "shopee",
    configA: { credenciais: { appId: "app-a", secret: "secret-a" } },
    configB: { credenciais: { appId: "app-a", secret: "secret-lixo" } },
    configC: { credenciais: { appId: "app-c", secret: "secret-c" } }
  });

  validarCicloCredencialAtual({
    clienteId: "workspace_fp_ali",
    marketplace: "aliexpress",
    configA: { credenciais: { appKey: "app-a", secret: "secret-a", trackingId: "track-a" } },
    configB: { credenciais: { appKey: "app-a", secret: "secret-lixo", trackingId: "track-a" } },
    configC: { credenciais: { appKey: "app-c", secret: "secret-c", trackingId: "track-c" } }
  });

  validarCicloCredencialAtual({
    clienteId: "workspace_fp_awin",
    marketplace: "awin",
    integracaoId: "advertiser:111",
    configA: { credenciais: { publisherId: "pub", apiToken: "token-a", programas: [{ nome: "loja_a", advertiserId: "111" }] } },
    configB: { credenciais: { publisherId: "pub", apiToken: "token-lixo", programas: [{ nome: "loja_a", advertiserId: "111" }] } },
    configC: { credenciais: { publisherId: "pub", apiToken: "token-c", programas: [{ nome: "loja_a", advertiserId: "111" }] } }
  });

  validarCicloCredencialAtual({
    clienteId: "workspace_fp_kabum",
    marketplace: "kabum",
    integracaoId: "advertiser:17729",
    configA: { credenciais: { publisherId: "pub", apiToken: "token-a", programas: [{ nome: "kabum", advertiserId: "17729" }] } },
    configB: { credenciais: { publisherId: "pub", apiToken: "token-lixo", programas: [{ nome: "kabum", advertiserId: "17729" }] } },
    configC: { credenciais: { publisherId: "pub", apiToken: "token-c", programas: [{ nome: "kabum", advertiserId: "17729" }] } }
  });
}

async function testeAmazonImporterCaptcha403NaoVermelho() {
  let alertaChamado = false;
  const importarAmazon = criarImportarAmazon({
    extrairJsonLd: () => null,
    extrairMeta: () => "",
    htmlDecode: (valor) => valor,
    limparPreco: (valor) => valor,
    corrigirImagemUrl: (valor) => valor,
    limparLinkAmazon: (valor) => valor,
    gerarLinkOptimus: (valor) => valor,
    extrairCuponsAmazonDoHtml: () => [],
    detectarAvisoCupomAmazon: () => "",
    escolherCupomParaOfertaAmazon: () => null,
    registrarSucessoIntegracao: () => {
      throw new Error("nao_deveria_registrar_sucesso");
    },
    registrarAlertaIntegracao: () => {
      alertaChamado = true;
    }
  });
  mockFetchSequencial([
    resposta({
      ok: false,
      status: 403,
      url: "https://www.amazon.com.br/errors/validateCaptcha",
      text: "<html>captcha robot check suspicious traffic</html>"
    })
  ]);

  await importarAmazon("https://www.amazon.com.br/dp/B07PGL2ZSL", {
    credenciais: { cookies: "cookie-secreto" },
    contextoEngine: { clienteId: "workspace_a" }
  });

  assert.strictEqual(alertaChamado, false);
}

async function testeMercadoLivreFailOpenSensor() {
  const criarConversor = registrarSucesso => criarGerarLinkMercadoLivre({
    fetch: async () => resposta({ json: { short_url: "https://meli.la/ok" } }),
    buscarCsrfTokenMercadoLivre: async () => "csrf-ok",
    tipoUrlMercadoLivreAfiliado: () => "produto",
    logMlAfiliadoFalhaDetalhe: () => {},
    registrarAlertaMercadoLivre: () => {},
    limparAlertaIntegracao: () => {},
    registrarSucessoIntegracao: registrarSucesso
  });
  const config = { credenciais: { cookies: "cookie-secreto", tag: "tag-ok" } };
  const contexto = { clienteId: "workspace_a" };

  const noop = await criarConversor(() => {})("https://www.mercadolivre.com.br/p/MLB1", config, contexto);
  const missing = await criarConversor(undefined)("https://www.mercadolivre.com.br/p/MLB1", config, contexto);
  const throwing = await criarConversor(() => { throw new Error("falha sensor"); })("https://www.mercadolivre.com.br/p/MLB1", config, contexto);

  const writeFileSyncOriginal = fs.writeFileSync;
  let storageThrow = "";
  try {
    fs.writeFileSync = () => { throw new Error("falha storage"); };
    assert.doesNotThrow(() => registrarAlertaIntegracao("workspace_a", "mercadolivre", {
      tipo: "cookie_expirado",
      detalhes: { httpStatus: 403 }
    }));
    assert.doesNotThrow(() => registrarSucessoIntegracao("workspace_a", "mercadolivre", {
      codigo: "afiliado_ok"
    }));
    storageThrow = await criarConversor(registrarSucessoIntegracao)("https://www.mercadolivre.com.br/p/MLB1", config, contexto);
  } finally {
    fs.writeFileSync = writeFileSyncOriginal;
  }

  assert.strictEqual(noop, "https://meli.la/ok");
  assert.strictEqual(missing, "https://meli.la/ok");
  assert.strictEqual(throwing, "https://meli.la/ok");
  assert.strictEqual(storageThrow, "https://meli.la/ok");
}

async function main() {
  try {
    await testeMercadoLivre();
    await testeAmazon();
    await testeMercadoLivreManualConversorOficial();
    await testeAmazonManualProvaAutenticada();
    await testeShopee();
    await testeShopeeSensorPassivoFalhaQualificada();
    await testeAliExpress();
    await testeAwinKabum();
    testeSensorPassivo();
    await testeSensoresPassivosConversores();
    testeKabumSemBaseDesconhecidaArtificial();
    testeAmazonUrlNaoPintaVerde();
    await testeAmazonImporterCaptcha403NaoVermelho();
    await testeMercadoLivreFailOpenSensor();
    testeCredencialAtualFingerprintUniversal();
    console.log("integracoes-saude-v1: ok");
  } finally {
    global.fetch = fetchOriginal;
  }
}

main().catch(err => {
  global.fetch = fetchOriginal;
  console.error(err);
  process.exit(1);
});
