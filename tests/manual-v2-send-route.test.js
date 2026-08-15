const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const express = require("express");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-manual-v2-send-route-"));

const criarRotasManualV2 = require("../modules/manual-v2/manual-offers.routes");
const storage = require("../modules/manual-v2/manual-offers.storage");
const {
  getClienteJsonPath
} = require("../utils/storage");

const destinosPorCliente = {
  cliente_a: [
    {
      id: "wa_ok",
      nome: "WA Ofertas",
      tipo: "whatsapp",
      ativo: true,
      conexaoId: "sessao_a",
      gruposWhatsapp: ["120363@g.us"]
    },
    {
      id: "tg_ok",
      nome: "TG Ofertas",
      tipo: "telegram",
      ativo: true,
      telegramDestinos: ["chat_ok"]
    }
  ],
  cliente_b: [
    {
      id: "wa_b",
      nome: "WA Cliente B",
      tipo: "whatsapp",
      ativo: true,
      conexaoId: "sessao_b",
      gruposWhatsapp: ["cliente_b@g.us"]
    }
  ]
};

const configsPorCliente = {
  cliente_a: {
    telegram: {
      destinos: [{
        id: "bot_ok",
        botToken: "123456:SEGREDO",
        chatId: "chat_ok",
        ativo: true
      }]
    }
  }
};

function criarApp(dispatcher, storageOptions) {
  const app = express();
  app.use(express.json());
  app.use("/manual-v2", criarRotasManualV2({
    getClienteId: (req) => req.header("x-cliente-id") || "cliente_a",
    storageOptions,
    destinosPorCliente,
    configsPorCliente,
    sessoes: {
      sessao_a: {},
      sessao_b: {}
    },
    statusSessao: {
      sessao_a: "open",
      sessao_b: "aberto"
    },
    getPlanoUsuario: () => ({
      recursos: {
        whatsapp: true,
        telegram: true
      }
    }),
    enviarOfertaManualV2: dispatcher
  }));
  return app;
}

function ouvir(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

async function request(server, metodo, caminho, clienteId, body) {
  const headers = {
    "x-cliente-id": clienteId
  };
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`http://127.0.0.1:${server.address().port}${caminho}`, {
    method: metodo,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  return { status: res.status, body: await res.json() };
}

function arquivoCliente(clienteId, arquivo) {
  return getClienteJsonPath(clienteId, arquivo);
}

function assertSemSegredos(valor) {
  const serializado = JSON.stringify(valor);
  for (const termo of ["SEGREDO", "botToken", "token", "secret", "cookie", "chat_ok"]) {
    assert.ok(!serializado.includes(termo), `resposta/storage nao pode expor ${termo}`);
  }
}

function criarOferta(clienteId, id, extra = {}) {
  return storage.criarOfertaManualV2(clienteId, {
    id,
    marketplace: "amazon",
    urlOriginal: `https://example.com/${id}`,
    titulo: `Oferta ${id}`,
    precoAtual: "99,90",
    ...extra
  }, {
    now: () => "2026-08-15T10:00:00.000Z",
    idFactory: () => id
  });
}

(async function main() {
  let tick = 0;
  const storageOptions = {
    now: () => {
      tick += 1;
      return `2026-08-15T12:00:${String(tick).padStart(2, "0")}.000Z`;
    }
  };
  const chamadas = [];
  let modo = "sucesso";
  const dispatcher = async (entrada, deps) => {
    chamadas.push({ entrada, deps });
    assert.deepStrictEqual(Object.keys(entrada).sort(), ["clienteId", "destinosIds", "ofertaId"].sort());
    if (modo === "falha") {
      return {
        ok: false,
        ofertaId: entrada.ofertaId,
        enviados: 0,
        erros: 1,
        creditosDebitados: 0,
        resultados: [{
          destinoId: entrada.destinosIds[0],
          nome: "WA Ofertas",
          tipo: "whatsapp",
          status: "erro",
          enviadoEm: "",
          erro: "falha_mock",
          botToken: "NAO_SAIR"
        }]
      };
    }
    if (modo === "parcial") {
      return {
        ok: true,
        ofertaId: entrada.ofertaId,
        enviados: 1,
        erros: 1,
        creditosDebitados: 1,
        resultados: [
          {
            destinoId: "wa_ok",
            nome: "WA Ofertas",
            tipo: "whatsapp",
            status: "enviado",
            enviadoEm: "2026-08-15T12:30:00.000Z",
            erro: ""
          },
          {
            destinoId: "tg_ok",
            nome: "TG Ofertas",
            tipo: "telegram",
            status: "erro",
            enviadoEm: "",
            erro: "falha_tg_mock",
            token: "NAO_SAIR"
          }
        ]
      };
    }
    return {
      ok: true,
      ofertaId: entrada.ofertaId,
      enviados: 1,
      erros: 0,
      creditosDebitados: 1,
      resultados: [{
        destinoId: entrada.destinosIds[0],
        nome: "WA Ofertas",
        tipo: "whatsapp",
        status: "enviado",
        enviadoEm: "2026-08-15T12:20:00.000Z",
        erro: "",
        secret: "NAO_SAIR"
      }]
    };
  };

  const server = await ouvir(criarApp(dispatcher, storageOptions));
  try {
    {
      const oferta = criarOferta("cliente_a", "oferta_sucesso");
      const resposta = await request(server, "POST", `/manual-v2/ofertas/${oferta.id}/enviar-agora`, "cliente_a", {
        destinosIds: ["wa_ok"],
        botToken: "frontend_nao_confiavel",
        chatId: "frontend_nao_confiavel"
      });

      assert.strictEqual(resposta.status, 200);
      assert.strictEqual(resposta.body.ok, true);
      assert.strictEqual(resposta.body.oferta.status, "enviada");
      assert.ok(resposta.body.oferta.enviadoEm);
      assert.strictEqual(resposta.body.oferta.envioManual.creditosDebitados, 1);
      assert.strictEqual(resposta.body.oferta.envioManual.enviados, 1);
      assertSemSegredos(resposta.body);

      const persistida = storage.buscarOfertaManualV2("cliente_a", oferta.id);
      assert.strictEqual(persistida.status, "enviada");
      assert.ok(persistida.enviadoEm);
      assert.strictEqual(persistida.envioManual.creditosDebitados, 1);
      assert.deepStrictEqual(persistida.envioManual.destinosEscolhidos.map((item) => item.id), ["wa_ok"]);
      assertSemSegredos(persistida);
    }

    {
      modo = "falha";
      const oferta = criarOferta("cliente_a", "oferta_falha");
      const resposta = await request(server, "POST", `/manual-v2/ofertas/${oferta.id}/enviar-agora`, "cliente_a", {
        destinosIds: ["wa_ok"]
      });

      assert.strictEqual(resposta.status, 409);
      assert.strictEqual(resposta.body.ok, false);
      assert.strictEqual(resposta.body.oferta.status, "erro");
      assert.strictEqual(Boolean(resposta.body.oferta.enviadoEm), false);
      assert.strictEqual(resposta.body.oferta.envioManual.creditosDebitados, 0);
      assert.strictEqual(resposta.body.oferta.envioManual.enviados, 0);
      assert.strictEqual(resposta.body.oferta.envioManual.erros, 1);
      assert.strictEqual(resposta.body.oferta.envioManual.erroResumo, "WA Ofertas: falha_mock");
      assertSemSegredos(resposta.body);
    }

    {
      modo = "parcial";
      const oferta = criarOferta("cliente_a", "oferta_parcial");
      const resposta = await request(server, "POST", `/manual-v2/ofertas/${oferta.id}/enviar-agora`, "cliente_a", {
        destinosIds: ["wa_ok", "tg_ok"]
      });

      assert.strictEqual(resposta.status, 200);
      assert.strictEqual(resposta.body.ok, true);
      assert.strictEqual(resposta.body.oferta.status, "enviada");
      assert.strictEqual(resposta.body.oferta.envioManual.enviados, 1);
      assert.strictEqual(resposta.body.oferta.envioManual.erros, 1);
      assert.strictEqual(resposta.body.oferta.envioManual.creditosDebitados, 1);
      assert.strictEqual(resposta.body.oferta.envioManual.erroResumo, "TG Ofertas: falha_tg_mock");
      assert.deepStrictEqual(resposta.body.oferta.envioManual.resultados.map((item) => item.status), ["enviado", "erro"]);
      assertSemSegredos(resposta.body);
      assertSemSegredos(storage.buscarOfertaManualV2("cliente_a", oferta.id));
    }

    {
      modo = "sucesso";
      const ofertaB = criarOferta("cliente_b", "oferta_cliente_b");
      const chamadasAntes = chamadas.length;
      const resposta = await request(server, "POST", `/manual-v2/ofertas/${ofertaB.id}/enviar-agora`, "cliente_a", {
        destinosIds: ["wa_ok"]
      });

      assert.strictEqual(resposta.status, 404);
      assert.strictEqual(chamadas.length, chamadasAntes);
    }

    {
      const oferta = criarOferta("cliente_a", "oferta_enviando");
      storage.atualizarMetadadosEnvioManualV2("cliente_a", oferta.id, { status: "enviando" });
      const chamadasAntes = chamadas.length;
      const resposta = await request(server, "POST", `/manual-v2/ofertas/${oferta.id}/enviar-agora`, "cliente_a", {
        destinosIds: ["wa_ok"]
      });

      assert.strictEqual(resposta.status, 409);
      assert.strictEqual(resposta.body.motivo, "oferta_manual_v2_ja_enviando");
      assert.strictEqual(chamadas.length, chamadasAntes);
    }

    {
      const oferta = criarOferta("cliente_a", "oferta_sem_destino");
      const chamadasAntes = chamadas.length;
      const resposta = await request(server, "POST", `/manual-v2/ofertas/${oferta.id}/enviar-agora`, "cliente_a", {
        destinosIds: []
      });

      assert.strictEqual(resposta.status, 400);
      assert.strictEqual(resposta.body.motivo, "manual_v2_destinos_obrigatorios");
      assert.strictEqual(chamadas.length, chamadasAntes);
      assert.strictEqual(storage.buscarOfertaManualV2("cliente_a", oferta.id).status, "salva");
    }

    {
      assert.strictEqual(fs.existsSync(arquivoCliente("cliente_a", "fila.json")), false);
      assert.strictEqual(fs.existsSync(arquivoCliente("cliente_b", "fila.json")), false);
    }

    {
      const fonte = fs.readFileSync(
        path.join(__dirname, "..", "modules", "manual-v2", "manual-offers.routes.js"),
        "utf8"
      );
      const proibidos = [
        "utils/fila-ofertas",
        "processarFila",
        "adicionarOfertaInicioFila",
        "prepararOfertaGlobal",
        "enviarParaDestinoInteligente",
        "enviarOfertaAgoraDireto",
        "enviarCampanhaManual",
        "Engine",
        "Radar",
        "Distributor",
        "Oferta Universal",
        "fila.json",
        "/enviar-manual"
      ];
      for (const termo of proibidos) {
        assert.ok(!fonte.includes(termo), `rota Manual V2 envio nao pode referenciar ${termo}`);
      }
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  console.log("manual-v2-send-route.test.js ok");
})().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
