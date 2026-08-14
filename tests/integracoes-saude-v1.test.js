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
  registrarResultadoSaudeIntegracao,
  registrarSucessoIntegracao,
  classificarCodigoSaude
} = require("../utils/alertas-integracoes");
const {
  criarGerarLinkAmazon
} = require("../modules/marketplaces/conversores/amazon.converter");
const {
  criarGerarLinkMercadoLivre
} = require("../modules/marketplaces/conversores/mercadolivre.converter");

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

  const paapi = await testarIntegracaoMarketplace("workspace_a", "amazon", {
    modo: "api",
    credenciais: { appId: "app", accessKey: "ak", secretKey: "sk" }
  });
  assert.strictEqual(paapi.saude.status, "desconhecida");
  assert.strictEqual(paapi.codigo, "teste_paapi_nao_disponivel");
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

async function testeAliExpress() {
  mockFetchSequencial([
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
  const ok = await testarIntegracaoMarketplace("workspace_a", "aliexpress", {
    credenciais: { appKey: "app", secret: "secret", trackingId: "track" }
  });
  assert.strictEqual(ok.saude.status, "saudavel");

  mockFetchSequencial([
    resposta({ json: { error_response: { code: "15", msg: "invalid signature" } } })
  ]);
  const invalida = await testarIntegracaoMarketplace("workspace_a", "aliexpress", {
    credenciais: { appKey: "app", secret: "secret", trackingId: "track" }
  });
  assert.strictEqual(invalida.saude.status, "invalida");
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

  mockFetchSequencial([
    resposta({ json: [{ id: 111, name: "Loja A" }] })
  ]);
  const awinParcial = await testarIntegracaoMarketplace("workspace_a", "awin", {
    credenciais: {
      publisherId: "123",
      apiToken: "token-secreto",
      programas: [
        { nome: "loja_a", advertiserId: "111" },
        { nome: "loja_b", advertiserId: "222" }
      ]
    }
  });
  registrarResultadoSaudeIntegracao("workspace_a", "awin", awinParcial, "manual");
  assert.strictEqual(obterSaudeIntegracao("workspace_a", "awin", "advertiser:111").status, "saudavel");
  assert.strictEqual(obterSaudeIntegracao("workspace_a", "awin", "advertiser:222").status, "invalida");
  assert.strictEqual(obterSaudeIntegracao("workspace_a", "awin", "advertiser:111").status, "saudavel");
  assert.strictEqual(obterSaudeIntegracao("workspace_a", "kabum", "advertiser:17729").status, "invalida");
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
    await testeShopee();
    await testeAliExpress();
    await testeAwinKabum();
    testeSensorPassivo();
    testeAmazonUrlNaoPintaVerde();
    await testeMercadoLivreFailOpenSensor();
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
