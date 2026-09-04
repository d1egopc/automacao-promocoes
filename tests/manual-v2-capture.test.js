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
      chamadas.push({ clienteId, marketplace, linkOriginal, ofertaBase });
      return "https://meli.la/captureOk";
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
        marketplace: "amazon"
      }));
      assert.strictEqual(resposta.status, 400);
      assert.strictEqual(resposta.body.motivo, "capture_marketplace_nao_suportado");
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
