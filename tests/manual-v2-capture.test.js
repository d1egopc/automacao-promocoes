const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const express = require("express");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-manual-v2-capture-"));

const {
  getClienteJsonPath
} = require("../utils/storage");
const criarRotasManualV2 = require("../modules/manual-v2/manual-offers.routes");

function criarLogger() {
  const eventos = [];
  return {
    eventos,
    log(...args) {
      eventos.push(args);
    }
  };
}

function criarApp(opcoes = {}) {
  const app = express();
  const logger = opcoes.logger || criarLogger();
  const chamadas = opcoes.chamadas || [];
  app.use(express.json());
  app.use("/manual-v2", criarRotasManualV2({
    getClienteId: (req) => req.header("x-cliente-id") || "",
    exigirClienteAutenticado: (req, res) => {
      const clienteId = req.header("x-cliente-id") || "";
      if (!clienteId) {
        res.status(401).json({
          ok: false,
          erro: "cliente_nao_autenticado",
          motivo: "cliente_nao_autenticado"
        });
        return null;
      }
      req.clienteId = clienteId;
      return clienteId;
    },
    importarUrlManualV2: async () => {
      throw new Error("importador_nao_deveria_ser_chamado");
    },
    gerarLinkAfiliadoCliente: opcoes.gerarLinkAfiliadoCliente || (async (clienteId, marketplace, linkOriginal, ofertaBase) => {
      chamadas.push({ tipo: "generic", clienteId, marketplace, linkOriginal, ofertaBase });
      return "https://meli.la/captureOk";
    }),
    getIntegracaoCliente: opcoes.getIntegracaoCliente || ((clienteId, marketplace) => {
      chamadas.push({ tipo: "integracao", clienteId, marketplace });
      return { credenciais: { appId: "app_teste", secret: "secret_teste" } };
    }),
    gerarShortLinkShopee: opcoes.gerarShortLinkShopee || (async (originUrl, integracao) => {
      chamadas.push({
        tipo: "shortlink_shopee",
        originUrl,
        temAppId: Boolean(integracao?.credenciais?.appId),
        temSecret: Boolean(integracao?.credenciais?.secret)
      });
      return { ok: true, shortLink: "https://s.shopee.com.br/captureOk" };
    }),
    logger,
    storageOptions: {
      now: () => "2026-09-04T12:00:00.000Z",
      idFactory: () => "manual_v2_capture_nao_persistido"
    },
    now: () => "2026-09-04T12:00:00.000Z"
  }));
  return { app, logger, chamadas };
}

function ouvir(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

async function request(server, metodo, caminho, clienteId, body) {
  const url = `http://127.0.0.1:${server.address().port}${caminho}`;
  const headers = {};
  if (clienteId) headers["x-cliente-id"] = clienteId;
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(url, {
    method: metodo,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  return { status: res.status, body: await res.json() };
}

function payloadValido(extra = {}) {
  return {
    marketplace: "mercadolivre",
    urlOriginal: "https://produto.mercadolivre.com.br/MLB-123-produto-capture-_JM",
    titulo: "Produto real capturado",
    precoAtual: 129.9,
    precoAnterior: 199.9,
    imagem: "https://http2.mlstatic.com/D_NQ_NP_123-ABC.webp",
    cupom: "SEMDEMORA",
    categoria: "beleza",
    parcelamento: "10x sem juros",
    origem: "optimus_capture_v1",
    ...extra
  };
}

function payloadShopeeValido(extra = {}) {
  return {
    marketplace: "shopee",
    urlOriginal: "https://shopee.com.br/product/123456/987654",
    titulo: "Tenis de Corrida Unissex Respiravel Challenger 6 - Olympikus",
    precoAtual: 212.9,
    precoAnterior: "",
    imagem: "https://down-br.img.susercontent.com/file/produto-hero.webp",
    cupom: "",
    categoria: "",
    origem: "optimus_capture_v1",
    ...extra
  };
}

function payloadAmazonValido(extra = {}) {
  return {
    marketplace: "amazon",
    urlOriginal: "https://www.amazon.com.br/Soundbar-Subwoofer-Bluetooth-Canais-S55H/dp/B0G2T13LT6?th=1",
    titulo: "Soundbar TCL com Subwoofer sem fio Bluetooth 2.1 Canais HDMI ARC S55H",
    precoAtual: 798.99,
    precoAnterior: 1099.00,
    imagem: "https://m.media-amazon.com/images/I/soundbar-SL1000.jpg",
    cupom: "",
    categoria: "",
    origem: "optimus_capture_v1",
    ...extra
  };
}

function payloadAliExpressValido(extra = {}) {
  return {
    marketplace: "aliexpress",
    urlOriginal: "https://pt.aliexpress.com/item/1005007871648778.html?spm=tracking",
    titulo: "Mini Projetor Portatil AliExpress Full HD",
    precoAtual: 213.25,
    precoAnterior: "",
    imagem: "https://ae01.alicdn.com/kf/projetor.jpg",
    cupom: "",
    categoria: "",
    origem: "optimus_capture_v1",
    ...extra
  };
}

function payloadKabumValido(extra = {}) {
  return {
    marketplace: "kabum",
    urlOriginal: "https://www.kabum.com.br/produto/944475/placa-de-video?utm_source=capture",
    titulo: "Placa de Video ASUS RTX 5090 32GB GDDR7",
    precoAtual: 4946.99,
    precoAnterior: 8235.28,
    imagem: "https://images.kabum.com.br/produtos/fotos/944475/placa.jpg",
    cupom: "",
    categoria: "Gamer e Hardware",
    origem: "optimus_capture_v1",
    ...extra
  };
}

function arquivoOfertas(clienteId) {
  return getClienteJsonPath(clienteId, "manual_ofertas_v2.json");
}

(async function main() {
  const logger = criarLogger();
  const { app, chamadas } = criarApp({ logger });
  const server = await ouvir(app);

  try {
    {
      const resposta = await request(server, "POST", "/manual-v2/capture/ofertas", "", payloadValido());
      assert.strictEqual(resposta.status, 401, "sem cliente autenticado deve rejeitar");
      assert.strictEqual(resposta.body.ok, false);
    }

    {
      const resposta = await request(server, "POST", "/manual-v2/capture/ofertas", "cliente_a", payloadValido({
        clienteId: "cliente_malicioso"
      }));
      assert.strictEqual(resposta.status, 200);
      assert.strictEqual(resposta.body.ok, true);
      assert.strictEqual(resposta.body.salva, false);
      assert.strictEqual(resposta.body.oferta.clienteId, "cliente_a");
      assert.strictEqual(chamadas.at(-1).clienteId, "cliente_a");
      assert.strictEqual(chamadas.at(-1).ofertaBase.titulo, "Produto real capturado");
    }

    {
      const resposta = await request(server, "POST", "/manual-v2/capture/ofertas", "cliente_a", payloadValido({
        urlOriginal: "https://example.com/produto"
      }));
      assert.strictEqual(resposta.status, 400);
      assert.strictEqual(resposta.body.motivo, "url_mercadolivre_invalida");
    }

    {
      const resposta = await request(server, "POST", "/manual-v2/capture/ofertas", "cliente_a", payloadValido({
        urlOriginal: "https://www.mercadolivre.com.br/"
      }));
      assert.strictEqual(resposta.status, 400);
      assert.strictEqual(resposta.body.motivo, "url_mercadolivre_produto_invalida");
    }

    {
      const resposta = await request(server, "POST", "/manual-v2/capture/ofertas", "cliente_a", payloadValido({
        urlOriginal: "https://meli.la/abc123"
      }));
      assert.strictEqual(resposta.status, 400);
      assert.strictEqual(resposta.body.motivo, "meli_la_capture_inseguro");
    }

    {
      const resposta = await request(server, "POST", "/manual-v2/capture/ofertas", "cliente_a", payloadValido({
        titulo: " "
      }));
      assert.strictEqual(resposta.status, 400);
      assert.strictEqual(resposta.body.motivo, "capture_titulo_invalido");
    }

    {
      const resposta = await request(server, "POST", "/manual-v2/capture/ofertas", "cliente_a", payloadValido({
        precoAtual: "gratis"
      }));
      assert.strictEqual(resposta.status, 400);
      assert.strictEqual(resposta.body.motivo, "capture_preco_invalido");
    }

    {
      const resposta = await request(server, "POST", "/manual-v2/capture/ofertas", "cliente_a", payloadValido({
        precoAtual: "129.90"
      }));
      assert.strictEqual(resposta.status, 200);
      assert.strictEqual(resposta.body.oferta.precoAtual, "129.9");
    }

    {
      const { app: appFalha } = criarApp({
        gerarLinkAfiliadoCliente: async () => ""
      });
      const serverFalha = await ouvir(appFalha);
      try {
        const resposta = await request(serverFalha, "POST", "/manual-v2/capture/ofertas", "cliente_a", payloadValido());
        assert.strictEqual(resposta.status, 502);
        assert.strictEqual(resposta.body.motivo, "conversao_afiliada_indisponivel");
        assert.ok(!JSON.stringify(resposta.body).includes(payloadValido().urlOriginal), "nao deve devolver original como afiliado em falha");
      } finally {
        await new Promise(resolve => serverFalha.close(resolve));
      }
    }

    {
      const { app: appOriginal } = criarApp({
        gerarLinkAfiliadoCliente: async (_clienteId, _marketplace, linkOriginal) => linkOriginal
      });
      const serverOriginal = await ouvir(appOriginal);
      try {
        const resposta = await request(serverOriginal, "POST", "/manual-v2/capture/ofertas", "cliente_a", payloadValido());
        assert.strictEqual(resposta.status, 502);
        assert.strictEqual(resposta.body.motivo, "conversao_afiliada_indisponivel");
      } finally {
        await new Promise(resolve => serverOriginal.close(resolve));
      }
    }

    {
      const { app: appErro } = criarApp({
        gerarLinkAfiliadoCliente: async () => {
          throw new Error("falha_secreta_com_url");
        }
      });
      const serverErro = await ouvir(appErro);
      try {
        const resposta = await request(serverErro, "POST", "/manual-v2/capture/ofertas", "cliente_a", payloadValido());
        assert.strictEqual(resposta.status, 502);
        assert.strictEqual(resposta.body.motivo, "conversao_afiliada_indisponivel");
      } finally {
        await new Promise(resolve => serverErro.close(resolve));
      }
    }

    {
      const resposta = await request(server, "POST", "/manual-v2/capture/ofertas", "cliente_a", payloadValido({
        cookies: "cookie_secreto",
        tag: "tag_secreta",
        token: "token_secreto"
      }));
      assert.strictEqual(resposta.status, 200);
      const serializado = JSON.stringify(resposta.body);
      assert.ok(!serializado.includes("cookie_secreto"));
      assert.ok(!serializado.includes("tag_secreta"));
      assert.ok(!serializado.includes("token_secreto"));
      assert.ok(!("id" in resposta.body.oferta), "preview nao deve criar id persistente falso");
      assert.strictEqual(resposta.body.oferta.urlAfiliada, "https://meli.la/captureOk");
    }

    {
      const antes = chamadas.length;
      const resposta = await request(server, "POST", "/manual-v2/capture/ofertas", "cliente_shopee", payloadShopeeValido({
        clienteId: "cliente_malicioso",
        appId: "nao_deve_ir_para_backend",
        secret: "nao_deve_ir_para_backend"
      }));
      assert.strictEqual(resposta.status, 200);
      assert.strictEqual(resposta.body.ok, true);
      assert.strictEqual(resposta.body.oferta.clienteId, "cliente_shopee");
      assert.strictEqual(resposta.body.oferta.marketplace, "shopee");
      assert.strictEqual(resposta.body.oferta.urlAfiliada, "https://s.shopee.com.br/captureOk");
      const chamadasShopee = chamadas.slice(antes);
      assert.ok(chamadasShopee.some(chamada => chamada.tipo === "integracao" && chamada.clienteId === "cliente_shopee" && chamada.marketplace === "shopee"));
      assert.ok(chamadasShopee.some(chamada => chamada.tipo === "shortlink_shopee" && chamada.originUrl === "https://shopee.com.br/product/123456/987654"));
      assert.ok(!chamadasShopee.some(chamada => chamada.tipo === "generic" && chamada.marketplace === "shopee"), "Capture Shopee nao deve usar conversor por keyword");
      const serializado = JSON.stringify(resposta.body);
      assert.ok(!serializado.includes("nao_deve_ir_para_backend"));
      assert.ok(!serializado.includes("secret_teste"));
    }

    {
      const resposta = await request(server, "POST", "/manual-v2/capture/ofertas", "cliente_shopee", payloadShopeeValido({
        precoAtual: "",
        precoAnterior: "",
        precoMin: 67.99,
        precoMax: 99.99,
        temVariacaoPreco: true
      }));
      assert.strictEqual(resposta.status, 200);
      assert.strictEqual(resposta.body.oferta.precoAtual, "", "faixa Shopee nao vira preco unico");
      assert.strictEqual(resposta.body.oferta.precoMin, "67.99");
      assert.strictEqual(resposta.body.oferta.precoMax, "99.99");
      assert.strictEqual(resposta.body.oferta.temVariacaoPreco, true);
      assert.ok(resposta.body.oferta.fonteImportacao.camposConfiaveis.includes("precoMin"));
      assert.ok(resposta.body.oferta.fonteImportacao.camposConfiaveis.includes("precoMax"));

      const save = await request(server, "POST", "/manual-v2/ofertas", "cliente_shopee", {
        oferta: resposta.body.oferta
      });
      assert.strictEqual(save.status, 201);
      assert.strictEqual(save.body.oferta.precoAtual, "");
      assert.strictEqual(save.body.oferta.precoMin, "67.99");
      assert.strictEqual(save.body.oferta.precoMax, "99.99");
      assert.strictEqual(save.body.oferta.temVariacaoPreco, true);
    }

    {
      const resposta = await request(server, "POST", "/manual-v2/capture/ofertas", "cliente_shopee", payloadShopeeValido({
        precoAtual: "1% OFF",
        precoMin: "",
        precoMax: "",
        temVariacaoPreco: false
      }));
      assert.strictEqual(resposta.status, 400);
      assert.strictEqual(resposta.body.motivo, "capture_preco_invalido");
    }

    {
      const resposta = await request(server, "POST", "/manual-v2/capture/ofertas", "cliente_a", payloadShopeeValido({
        urlOriginal: "https://s.shopee.com.br/abc123"
      }));
      assert.strictEqual(resposta.status, 400);
      assert.strictEqual(resposta.body.motivo, "shopee_shortlink_capture_inseguro");
    }

    {
      const resposta = await request(server, "POST", "/manual-v2/capture/ofertas", "cliente_a", payloadShopeeValido({
        urlOriginal: "https://shopee.com.br/m/cupom-de-desconto"
      }));
      assert.strictEqual(resposta.status, 400);
      assert.strictEqual(resposta.body.motivo, "url_shopee_produto_invalida");
    }

    {
      const { app: appAmazon, chamadas: chamadasAmazonApp } = criarApp({
        gerarLinkAfiliadoCliente: async (clienteId, marketplace, linkOriginal, ofertaBase) => {
          chamadasAmazonApp.push({ tipo: "generic", clienteId, marketplace, linkOriginal, ofertaBase });
          const url = new URL(linkOriginal);
          url.searchParams.set("tag", "capture-20");
          return url.toString();
        }
      });
      const serverAmazon = await ouvir(appAmazon);
      try {
        const resposta = await request(serverAmazon, "POST", "/manual-v2/capture/ofertas", "cliente_amazon", payloadAmazonValido({
          clienteId: "cliente_malicioso",
          trackingId: "nao_deve_ir_para_backend"
        }));
        assert.strictEqual(resposta.status, 200);
        assert.strictEqual(resposta.body.ok, true);
        assert.strictEqual(resposta.body.oferta.clienteId, "cliente_amazon");
        assert.strictEqual(resposta.body.oferta.marketplace, "amazon");
        assert.strictEqual(resposta.body.oferta.titulo, "Soundbar TCL com Subwoofer sem fio Bluetooth 2.1 Canais HDMI ARC S55H");
        assert.strictEqual(resposta.body.oferta.precoAtual, "798.99");
        assert.strictEqual(resposta.body.oferta.precoAnterior, "1099");
        assert.strictEqual(resposta.body.oferta.urlAfiliada, "https://www.amazon.com.br/Soundbar-Subwoofer-Bluetooth-Canais-S55H/dp/B0G2T13LT6?th=1&tag=capture-20");
        assert.deepStrictEqual(chamadasAmazonApp.map(chamada => chamada.tipo), ["generic"]);
        assert.strictEqual(chamadasAmazonApp[0].clienteId, "cliente_amazon");
        assert.strictEqual(chamadasAmazonApp[0].marketplace, "amazon");
        assert.strictEqual(chamadasAmazonApp[0].linkOriginal, "https://www.amazon.com.br/Soundbar-Subwoofer-Bluetooth-Canais-S55H/dp/B0G2T13LT6?th=1");
        assert.strictEqual(chamadasAmazonApp[0].ofertaBase.urlOriginal, chamadasAmazonApp[0].linkOriginal);
        assert.ok(!JSON.stringify(resposta.body).includes("nao_deve_ir_para_backend"));
      } finally {
        await new Promise(resolve => serverAmazon.close(resolve));
      }
    }

    {
      const antes = chamadas.length;
      const resposta = await request(server, "POST", "/manual-v2/capture/ofertas", "cliente_amazon", payloadAmazonValido({
        clienteId: "cliente_malicioso",
        trackingId: "nao_deve_ir_para_backend"
      }));
      assert.strictEqual(resposta.status, 200);
      assert.strictEqual(resposta.body.ok, true);
      assert.strictEqual(resposta.body.oferta.clienteId, "cliente_amazon");
      assert.strictEqual(resposta.body.oferta.marketplace, "amazon");
      const chamadasAmazon = chamadas.slice(antes);
      assert.deepStrictEqual(chamadasAmazon.map(chamada => chamada.tipo), ["generic"]);
      assert.strictEqual(chamadasAmazon[0].clienteId, "cliente_amazon");
      assert.strictEqual(chamadasAmazon[0].marketplace, "amazon");
      assert.strictEqual(chamadasAmazon[0].linkOriginal, "https://www.amazon.com.br/Soundbar-Subwoofer-Bluetooth-Canais-S55H/dp/B0G2T13LT6?th=1");
      assert.strictEqual(chamadasAmazon[0].ofertaBase.urlOriginal, chamadasAmazon[0].linkOriginal);
      assert.ok(!JSON.stringify(resposta.body).includes("nao_deve_ir_para_backend"));
    }

    {
      const resposta = await request(server, "POST", "/manual-v2/capture/ofertas", "cliente_amazon", payloadAmazonValido({
        urlOriginal: "https://www.amazon.com.br/s?k=soundbar"
      }));
      assert.strictEqual(resposta.status, 400);
      assert.strictEqual(resposta.body.motivo, "url_amazon_produto_invalida");
    }

    {
      const resposta = await request(server, "POST", "/manual-v2/capture/ofertas", "cliente_amazon", payloadAmazonValido({
        urlOriginal: "https://amzn.to/abc123"
      }));
      assert.strictEqual(resposta.status, 400);
      assert.strictEqual(resposta.body.motivo, "amazon_shortlink_capture_inseguro");
    }

    {
      const { app: appAmazonFalha } = criarApp({
        gerarLinkAfiliadoCliente: async () => ""
      });
      const serverAmazonFalha = await ouvir(appAmazonFalha);
      try {
        const resposta = await request(serverAmazonFalha, "POST", "/manual-v2/capture/ofertas", "cliente_amazon", payloadAmazonValido());
        assert.strictEqual(resposta.status, 502);
        assert.strictEqual(resposta.body.motivo, "conversao_afiliada_indisponivel");
      } finally {
        await new Promise(resolve => serverAmazonFalha.close(resolve));
      }
    }

    {
      const chamadasAli = [];
      const { app: appAli } = criarApp({
        chamadas: chamadasAli,
        gerarLinkAfiliadoCliente: async (clienteId, marketplace, linkOriginal, ofertaBase) => {
          chamadasAli.push({ tipo: "generic", clienteId, marketplace, linkOriginal, ofertaBase });
          return "https://s.click.aliexpress.com/e/_captureAli";
        }
      });
      const serverAli = await ouvir(appAli);
      try {
        const resposta = await request(serverAli, "POST", "/manual-v2/capture/ofertas", "cliente_aliexpress", payloadAliExpressValido({
          clienteId: "cliente_malicioso",
          appKey: "nao_deve_ir_para_backend",
          secret: "nao_deve_ir_para_backend",
          trackingId: "nao_deve_ir_para_backend"
        }));
        assert.strictEqual(resposta.status, 200);
        assert.strictEqual(resposta.body.ok, true);
        assert.strictEqual(resposta.body.oferta.clienteId, "cliente_aliexpress");
        assert.strictEqual(resposta.body.oferta.marketplace, "aliexpress");
        assert.strictEqual(resposta.body.oferta.urlOriginal, "https://pt.aliexpress.com/item/1005007871648778.html");
        assert.strictEqual(resposta.body.oferta.urlAfiliada, "https://s.click.aliexpress.com/e/_captureAli");
        assert.deepStrictEqual(chamadasAli.map(chamada => chamada.tipo), ["generic"]);
        assert.strictEqual(chamadasAli[0].clienteId, "cliente_aliexpress");
        assert.strictEqual(chamadasAli[0].marketplace, "aliexpress");
        assert.strictEqual(chamadasAli[0].linkOriginal, "https://pt.aliexpress.com/item/1005007871648778.html");
        assert.strictEqual(chamadasAli[0].ofertaBase.urlOriginal, chamadasAli[0].linkOriginal);
        const serializado = JSON.stringify(resposta.body);
        assert.ok(!serializado.includes("nao_deve_ir_para_backend"));
      } finally {
        await new Promise(resolve => serverAli.close(resolve));
      }
    }

    {
      const chamadasAli = [];
      const { app: appAliFaixa } = criarApp({
        chamadas: chamadasAli,
        gerarLinkAfiliadoCliente: async (clienteId, marketplace, linkOriginal, ofertaBase) => {
          chamadasAli.push({ tipo: "generic", clienteId, marketplace, linkOriginal, ofertaBase });
          return "https://s.click.aliexpress.com/e/_captureAliFaixa";
        }
      });
      const serverAliFaixa = await ouvir(appAliFaixa);
      try {
        const resposta = await request(serverAliFaixa, "POST", "/manual-v2/capture/ofertas", "cliente_aliexpress", payloadAliExpressValido({
          precoAtual: "",
          precoMin: 67.99,
          precoMax: 99.99,
          temVariacaoPreco: true
        }));
        assert.strictEqual(resposta.status, 200);
        assert.strictEqual(resposta.body.oferta.precoAtual, "", "faixa AliExpress nao vira preco unico");
        assert.strictEqual(resposta.body.oferta.precoMin, "67.99");
        assert.strictEqual(resposta.body.oferta.precoMax, "99.99");
        assert.strictEqual(resposta.body.oferta.temVariacaoPreco, true);
        assert.ok(resposta.body.oferta.fonteImportacao.camposConfiaveis.includes("precoMin"));
        assert.ok(resposta.body.oferta.fonteImportacao.camposConfiaveis.includes("precoMax"));
      } finally {
        await new Promise(resolve => serverAliFaixa.close(resolve));
      }
    }

    {
      const resposta = await request(server, "POST", "/manual-v2/capture/ofertas", "cliente_aliexpress", payloadAliExpressValido({
        urlOriginal: "https://a.aliexpress.com/_mTeste"
      }));
      assert.strictEqual(resposta.status, 400);
      assert.strictEqual(resposta.body.motivo, "aliexpress_shortlink_capture_inseguro");
    }

    {
      const resposta = await request(server, "POST", "/manual-v2/capture/ofertas", "cliente_aliexpress", payloadAliExpressValido({
        urlOriginal: "https://pt.aliexpress.com/w/wholesale-projetor.html"
      }));
      assert.strictEqual(resposta.status, 400);
      assert.strictEqual(resposta.body.motivo, "url_aliexpress_produto_invalida");
    }

    {
      const resposta = await request(server, "POST", "/manual-v2/capture/ofertas", "cliente_aliexpress", payloadAliExpressValido({
        urlOriginal: "https://pt.aliexpress.com/w/wholesale-projetor.html?itemId=1005007871648778"
      }));
      assert.strictEqual(resposta.status, 400);
      assert.strictEqual(resposta.body.motivo, "url_aliexpress_produto_invalida");
    }

    {
      const { app: appAliOriginal } = criarApp({
        gerarLinkAfiliadoCliente: async (_clienteId, _marketplace, linkOriginal) => linkOriginal
      });
      const serverAliOriginal = await ouvir(appAliOriginal);
      try {
        const resposta = await request(serverAliOriginal, "POST", "/manual-v2/capture/ofertas", "cliente_aliexpress", payloadAliExpressValido());
        assert.strictEqual(resposta.status, 502);
        assert.strictEqual(resposta.body.motivo, "conversao_afiliada_indisponivel");
        assert.ok(!JSON.stringify(resposta.body).includes("sem_comissao"));
      } finally {
        await new Promise(resolve => serverAliOriginal.close(resolve));
      }
    }

    {
      const { app: appAliFalha } = criarApp({
        gerarLinkAfiliadoCliente: async () => {
          throw new Error("falha_api_aliexpress");
        }
      });
      const serverAliFalha = await ouvir(appAliFalha);
      try {
        const resposta = await request(serverAliFalha, "POST", "/manual-v2/capture/ofertas", "cliente_aliexpress", payloadAliExpressValido());
        assert.strictEqual(resposta.status, 502);
        assert.strictEqual(resposta.body.motivo, "conversao_afiliada_indisponivel");
        assert.ok(!JSON.stringify(resposta.body).includes("Produto sem comissao"));
      } finally {
        await new Promise(resolve => serverAliFalha.close(resolve));
      }
    }

    {
      const chamadasKabum = [];
      const { app: appKabum } = criarApp({
        chamadas: chamadasKabum,
        gerarLinkAfiliadoCliente: async (clienteId, marketplace, linkOriginal, ofertaBase) => {
          chamadasKabum.push({ tipo: "generic", clienteId, marketplace, linkOriginal, ofertaBase });
          return "https://www.awin1.com/cread.php?awinmid=17729&awinaffid=123&ued=kabum";
        }
      });
      const serverKabum = await ouvir(appKabum);
      try {
        const resposta = await request(serverKabum, "POST", "/manual-v2/capture/ofertas", "cliente_kabum", payloadKabumValido({
          clienteId: "cliente_malicioso",
          publisherId: "nao_deve_ir_para_backend",
          apiToken: "nao_deve_ir_para_backend",
          advertiserId: "nao_deve_ir_para_backend"
        }));
        assert.strictEqual(resposta.status, 200);
        assert.strictEqual(resposta.body.ok, true);
        assert.strictEqual(resposta.body.oferta.clienteId, "cliente_kabum");
        assert.strictEqual(resposta.body.oferta.marketplace, "kabum");
        assert.strictEqual(resposta.body.oferta.urlOriginal, "https://www.kabum.com.br/produto/944475/placa-de-video?utm_source=capture");
        assert.strictEqual(resposta.body.oferta.urlAfiliada, "https://www.awin1.com/cread.php?awinmid=17729&awinaffid=123&ued=kabum");
        assert.deepStrictEqual(chamadasKabum.map(chamada => chamada.tipo), ["generic"]);
        assert.strictEqual(chamadasKabum[0].clienteId, "cliente_kabum");
        assert.strictEqual(chamadasKabum[0].marketplace, "kabum");
        assert.strictEqual(chamadasKabum[0].linkOriginal, "https://www.kabum.com.br/produto/944475/placa-de-video?utm_source=capture");
        assert.strictEqual(chamadasKabum[0].ofertaBase.urlOriginal, chamadasKabum[0].linkOriginal);
        const serializado = JSON.stringify(resposta.body);
        assert.ok(!serializado.includes("nao_deve_ir_para_backend"));
      } finally {
        await new Promise(resolve => serverKabum.close(resolve));
      }
    }

    {
      const resposta = await request(server, "POST", "/manual-v2/capture/ofertas", "cliente_kabum", payloadKabumValido({
        urlOriginal: "https://www.kabum.com.br/busca/placa-de-video"
      }));
      assert.strictEqual(resposta.status, 400);
      assert.strictEqual(resposta.body.motivo, "url_kabum_produto_invalida");
    }

    {
      const resposta = await request(server, "POST", "/manual-v2/capture/ofertas", "cliente_kabum", payloadKabumValido({
        urlOriginal: "https://www.awin1.com/cread.php?ued=https%3A%2F%2Fwww.kabum.com.br%2Fproduto%2F944475"
      }));
      assert.strictEqual(resposta.status, 400);
      assert.strictEqual(resposta.body.motivo, "kabum_awin_capture_inseguro");
    }

    {
      const { app: appKabumTextoInvalido } = criarApp({
        gerarLinkAfiliadoCliente: async () => "texto_invalido"
      });
      const serverKabumTextoInvalido = await ouvir(appKabumTextoInvalido);
      try {
        const resposta = await request(serverKabumTextoInvalido, "POST", "/manual-v2/capture/ofertas", "cliente_kabum", payloadKabumValido());
        assert.strictEqual(resposta.status, 502);
        assert.strictEqual(resposta.body.motivo, "conversao_afiliada_indisponivel");
      } finally {
        await new Promise(resolve => serverKabumTextoInvalido.close(resolve));
      }
    }

    {
      const { app: appKabumFtp } = criarApp({
        gerarLinkAfiliadoCliente: async () => "ftp://awin.example/deeplink"
      });
      const serverKabumFtp = await ouvir(appKabumFtp);
      try {
        const resposta = await request(serverKabumFtp, "POST", "/manual-v2/capture/ofertas", "cliente_kabum", payloadKabumValido());
        assert.strictEqual(resposta.status, 502);
        assert.strictEqual(resposta.body.motivo, "conversao_afiliada_indisponivel");
      } finally {
        await new Promise(resolve => serverKabumFtp.close(resolve));
      }
    }

    {
      const { app: appKabumVazio } = criarApp({
        gerarLinkAfiliadoCliente: async () => ""
      });
      const serverKabumVazio = await ouvir(appKabumVazio);
      try {
        const resposta = await request(serverKabumVazio, "POST", "/manual-v2/capture/ofertas", "cliente_kabum", payloadKabumValido());
        assert.strictEqual(resposta.status, 502);
        assert.strictEqual(resposta.body.motivo, "conversao_afiliada_indisponivel");
      } finally {
        await new Promise(resolve => serverKabumVazio.close(resolve));
      }
    }

    {
      const { app: appKabumOriginal } = criarApp({
        gerarLinkAfiliadoCliente: async (_clienteId, _marketplace, linkOriginal) => linkOriginal
      });
      const serverKabumOriginal = await ouvir(appKabumOriginal);
      try {
        const resposta = await request(serverKabumOriginal, "POST", "/manual-v2/capture/ofertas", "cliente_kabum", payloadKabumValido());
        assert.strictEqual(resposta.status, 502);
        assert.strictEqual(resposta.body.motivo, "conversao_afiliada_indisponivel");
      } finally {
        await new Promise(resolve => serverKabumOriginal.close(resolve));
      }
    }

    {
      const { app: appKabumMesmoProduto } = criarApp({
        gerarLinkAfiliadoCliente: async () => "https://kabum.com.br/produto/944475/placa-de-video#reviews"
      });
      const serverKabumMesmoProduto = await ouvir(appKabumMesmoProduto);
      try {
        const resposta = await request(serverKabumMesmoProduto, "POST", "/manual-v2/capture/ofertas", "cliente_kabum", payloadKabumValido());
        assert.strictEqual(resposta.status, 502);
        assert.strictEqual(resposta.body.motivo, "conversao_afiliada_indisponivel");
      } finally {
        await new Promise(resolve => serverKabumMesmoProduto.close(resolve));
      }
    }

    {
      const { app: appKabumAfiliadaDistinta } = criarApp({
        gerarLinkAfiliadoCliente: async () => "https://go.afiliado.example/kabum/944475"
      });
      const serverKabumAfiliadaDistinta = await ouvir(appKabumAfiliadaDistinta);
      try {
        const resposta = await request(serverKabumAfiliadaDistinta, "POST", "/manual-v2/capture/ofertas", "cliente_kabum", payloadKabumValido());
        assert.strictEqual(resposta.status, 200);
        assert.strictEqual(resposta.body.oferta.urlAfiliada, "https://go.afiliado.example/kabum/944475");
      } finally {
        await new Promise(resolve => serverKabumAfiliadaDistinta.close(resolve));
      }
    }

    {
      const lista = await request(server, "GET", "/manual-v2/ofertas", "cliente_a");
      assert.strictEqual(lista.status, 200);
      assert.deepStrictEqual(lista.body.ofertas, []);
      assert.strictEqual(fs.existsSync(arquivoOfertas("cliente_a")), false, "preview Capture nao deve persistir Galeria");
    }

    {
      const fonteRotas = fs.readFileSync(
        path.join(__dirname, "..", "modules", "manual-v2", "manual-offers.routes.js"),
        "utf8"
      );
      const fonteCapture = fs.readFileSync(
        path.join(__dirname, "..", "modules", "manual-v2", "manual-capture.service.js"),
        "utf8"
      );
      assert.ok(!fonteCapture.includes("importarMercadoLivre"));
      assert.ok(!fonteCapture.includes("mercadolivre.manual.adapter"));
      assert.ok(!fonteCapture.includes("importarAmazon"));
      assert.ok(!fonteCapture.includes("amazon.manual.adapter"));
      assert.ok(!fonteCapture.includes("importarProdutoKabum"));
      assert.ok(!fonteCapture.includes("kabum-awin.manual.adapter"));
      assert.ok(!fonteRotas.includes("importarMercadoLivre"));
    }

    const logs = JSON.stringify(logger.eventos);
    assert.ok(!logs.includes("cookie_secreto"));
    assert.ok(!logs.includes("tag_secreta"));
    assert.ok(!logs.includes("token_secreto"));

    console.log("manual-v2-capture.test.js ok");
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
})().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
