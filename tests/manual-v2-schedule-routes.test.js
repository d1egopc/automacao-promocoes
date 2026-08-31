const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const express = require("express");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-manual-v2-schedule-routes-"));

const criarRotasManualV2 = require("../modules/manual-v2/manual-offers.routes");
const storage = require("../modules/manual-v2/manual-offers.storage");
const {
  getClienteJsonPath
} = require("../utils/storage");

const NOW = "2026-08-15T12:00:00.000Z";

const destinosPorCliente = {
  cliente_a: [
    {
      id: "wa_ok",
      nome: "WA Ofertas",
      tipo: "whatsapp",
      ativo: true,
      conexaoId: "sessao_a",
      gruposWhatsapp: ["120363@g.us"],
      token: "TOKEN_NAO_SAIR",
      botToken: "BOT_NAO_SAIR",
      secret: "SECRET_NAO_SAIR"
    },
    {
      id: "tg_ok",
      nome: "TG Ofertas",
      tipo: "telegram",
      ativo: true,
      telegramDestinos: ["chat_ok"]
    },
    {
      id: "wa_off",
      nome: "WA Desconectado",
      tipo: "whatsapp",
      ativo: true,
      conexaoId: "sessao_off",
      gruposWhatsapp: ["120363-off@g.us"]
    },
    {
      id: "wa_power_off",
      nome: "WA Power OFF",
      tipo: "whatsapp",
      ativo: false,
      conexaoId: "sessao_a",
      gruposWhatsapp: ["120363-power-off@g.us"]
    },
    {
      id: "dc_ok",
      nome: "Discord Ofertas",
      tipo: "discord",
      ativo: true,
      conexaoId: "discord_a",
      channelId: "canal_discord",
      botToken: "BOT_DISCORD_NAO_SAIR",
      token: "TOKEN_DISCORD_NAO_SAIR",
      secret: "SECRET_DISCORD_NAO_SAIR"
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
        id: "bot_a",
        botToken: "123456:SEGREDO",
        chatId: "chat_ok",
        ativo: true
      }]
    }
  }
};

const discordConexoes = [
  {
    id: "discord_a",
    tipo: "discord",
    guildId: "guild_a",
    guildName: "Servidor A",
    ativo: true,
    botToken: "BOT_DISCORD_NAO_SAIR"
  }
];

const discordCanaisPorConexao = {
  discord_a: [
    {
      id: "canal_discord",
      nome: "ofertas",
      tipo: "texto",
      utilizavel: true
    }
  ]
};

function criarOferta(clienteId, id, extra = {}) {
  return storage.criarOfertaManualV2(clienteId, {
    id,
    marketplace: "amazon",
    titulo: `Oferta ${id}`,
    precoAtual: "99,90",
    urlOriginal: `https://example.com/${id}`,
    ...extra
  }, {
    now: () => NOW,
    idFactory: () => id
  });
}

function criarApp(onDispatcherCall) {
  const app = express();
  app.use(express.json());
  app.use("/manual-v2", criarRotasManualV2({
    getClienteId: (req) => req.header("x-cliente-id") || "cliente_a",
    storageOptions: { now: () => NOW },
    now: () => NOW,
    destinosPorCliente,
    configsPorCliente,
    sessoes: {
      sessao_a: {},
      sessao_b: {}
    },
    statusSessao: {
      sessao_a: "open",
      sessao_b: "aberto",
      sessao_off: "closed"
    },
    discordConexoes,
    discordCanaisPorConexao,
    enviarDiscord: async () => ({ ok: true }),
    getPlanoUsuario: () => ({
      recursos: {
        whatsapp: true,
        telegram: true,
        discord: true
      }
    }),
    enviarOfertaManualV2: async () => {
      onDispatcherCall();
      throw new Error("dispatcher_nao_deveria_ser_chamado");
    }
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

function assertSemSegredos(valor) {
  const serializado = JSON.stringify(valor);
  for (const termo of [
    "TOKEN_NAO_SAIR",
    "BOT_NAO_SAIR",
    "SECRET_NAO_SAIR",
    "TOKEN_FRONT",
    "BOT_FRONT",
    "CHAT_FRONT",
    "BOT_DISCORD_NAO_SAIR",
    "TOKEN_DISCORD_NAO_SAIR",
    "SECRET_DISCORD_NAO_SAIR",
    "guild_a",
    "canal_discord",
    "SESSAO_FRONT",
    "ALVO_FRONT",
    "SEGREDO",
    "botToken",
    "token",
    "secret",
    "chat_ok"
  ]) {
    assert.ok(!serializado.includes(termo), `agendamento nao deve expor ${termo}`);
  }
}

(async function main() {
  let chamadasDispatcher = 0;
  const server = await ouvir(criarApp(() => { chamadasDispatcher += 1; }));

  try {
    {
      const oferta = criarOferta("cliente_a", "oferta_agendar");
      const resposta = await request(server, "POST", `/manual-v2/ofertas/${oferta.id}/agendar`, "cliente_a", {
        clienteId: "cliente_b",
        destinosIds: ["wa_ok"],
        dataHoraLocal: "2026-08-16T14:30",
        timezone: "America/Sao_Paulo",
        token: "TOKEN_FRONT",
        botToken: "BOT_FRONT",
        chatId: "CHAT_FRONT",
        sessao: "SESSAO_FRONT",
        alvo: "ALVO_FRONT"
      });

      assert.strictEqual(resposta.status, 201);
      assert.strictEqual(resposta.body.ok, true);
      assert.strictEqual(resposta.body.oferta.status, "agendada");
      assert.strictEqual(resposta.body.oferta.agendamentoLocal, "2026-08-16T14:30");
      assert.strictEqual(resposta.body.oferta.agendamentoTimezone, "America/Sao_Paulo");
      assert.strictEqual(resposta.body.oferta.agendadoPara, "2026-08-16T17:30:00.000Z");
      assert.deepStrictEqual(resposta.body.oferta.destinosIds, ["wa_ok"]);
      assert.deepStrictEqual(resposta.body.oferta.destinosAgendados.map((destino) => destino.id), ["wa_ok"]);
      assertSemSegredos(resposta.body);

      const persistida = storage.buscarOfertaManualV2("cliente_a", oferta.id);
      assert.strictEqual(persistida.status, "agendada");
      assert.strictEqual(persistida.agendadoPara, "2026-08-16T17:30:00.000Z");
      assertSemSegredos(persistida);
    }

    {
      const oferta = criarOferta("cliente_a", "oferta_timezone");
      const resposta = await request(server, "POST", `/manual-v2/ofertas/${oferta.id}/agendar`, "cliente_a", {
        destinosIds: ["wa_ok"],
        dataHoraLocal: "2026-08-16T14:30",
        timezone: "UTC"
      });

      assert.strictEqual(resposta.status, 201);
      assert.strictEqual(resposta.body.oferta.agendamentoTimezone, "UTC");
      assert.strictEqual(resposta.body.oferta.agendadoPara, "2026-08-16T14:30:00.000Z");
    }

    {
      const oferta = criarOferta("cliente_a", "oferta_discord");
      const resposta = await request(server, "POST", `/manual-v2/ofertas/${oferta.id}/agendar`, "cliente_a", {
        destinosIds: ["dc_ok"],
        dataHoraLocal: "2026-08-16T14:30",
        timezone: "America/Sao_Paulo"
      });

      assert.strictEqual(resposta.status, 201);
      assert.strictEqual(resposta.body.oferta.status, "agendada");
      assert.deepStrictEqual(resposta.body.oferta.destinosIds, ["dc_ok"]);
      assert.deepStrictEqual(resposta.body.oferta.destinosAgendados, [{
        id: "dc_ok",
        nome: "Discord Ofertas",
        tipo: "discord",
        ativo: true,
        utilizavel: true,
        motivoIndisponivel: "",
        identificacaoVisual: "Servidor A #ofertas"
      }]);
      assertSemSegredos(resposta.body);
    }

    {
      const oferta = criarOferta("cliente_a", "oferta_passado");
      const resposta = await request(server, "POST", `/manual-v2/ofertas/${oferta.id}/agendar`, "cliente_a", {
        destinosIds: ["wa_ok"],
        dataHoraLocal: "2026-08-15T08:00",
        timezone: "America/Sao_Paulo"
      });

      assert.strictEqual(resposta.status, 400);
      assert.strictEqual(resposta.body.motivo, "manual_v2_agendamento_no_passado");
      assert.strictEqual(storage.buscarOfertaManualV2("cliente_a", oferta.id).status, "salva");
    }

    {
      const oferta = criarOferta("cliente_a", "oferta_sem_destino");
      const resposta = await request(server, "POST", `/manual-v2/ofertas/${oferta.id}/agendar`, "cliente_a", {
        destinosIds: [],
        dataHoraLocal: "2026-08-16T14:30",
        timezone: "America/Sao_Paulo"
      });

      assert.strictEqual(resposta.status, 400);
      assert.strictEqual(resposta.body.motivo, "manual_v2_destinos_obrigatorios");
    }

    {
      const oferta = criarOferta("cliente_a", "oferta_destino_indisponivel");
      const resposta = await request(server, "POST", `/manual-v2/ofertas/${oferta.id}/agendar`, "cliente_a", {
        destinosIds: ["wa_off"],
        dataHoraLocal: "2026-08-16T14:30",
        timezone: "America/Sao_Paulo"
      });

      assert.strictEqual(resposta.status, 400);
      assert.strictEqual(resposta.body.motivo, "manual_v2_destino_indisponivel");
    }

    {
      const oferta = criarOferta("cliente_a", "oferta_power_off");
      const resposta = await request(server, "POST", `/manual-v2/ofertas/${oferta.id}/agendar`, "cliente_a", {
        destinosIds: ["wa_power_off"],
        dataHoraLocal: "2026-08-16T14:30",
        timezone: "America/Sao_Paulo"
      });

      assert.strictEqual(resposta.status, 400);
      assert.strictEqual(resposta.body.motivo, "manual_v2_destino_indisponivel", "Power OFF nao deve ser agendavel");
      assert.strictEqual(storage.buscarOfertaManualV2("cliente_a", oferta.id).status, "salva");
    }

    {
      const oferta = criarOferta("cliente_a", "oferta_destino_outro_cliente");
      const resposta = await request(server, "POST", `/manual-v2/ofertas/${oferta.id}/agendar`, "cliente_a", {
        destinosIds: ["wa_b"],
        dataHoraLocal: "2026-08-16T14:30",
        timezone: "America/Sao_Paulo"
      });

      assert.strictEqual(resposta.status, 400);
      assert.strictEqual(resposta.body.motivo, "manual_v2_destino_indisponivel");
    }

    {
      const oferta = criarOferta("cliente_a", "oferta_reprogramar");
      await request(server, "POST", `/manual-v2/ofertas/${oferta.id}/agendar`, "cliente_a", {
        destinosIds: ["wa_ok"],
        dataHoraLocal: "2026-08-16T14:30",
        timezone: "America/Sao_Paulo"
      });
      storage.atualizarMetadadosAgendamentoManualV2("cliente_a", oferta.id, {
        agendamentoLockId: "lock_antigo",
        agendamentoLockEm: "2026-08-15T12:01:00.000Z"
      }, { now: () => NOW });

      const resposta = await request(server, "PUT", `/manual-v2/ofertas/${oferta.id}/agendamento`, "cliente_a", {
        destinosIds: ["tg_ok"],
        dataHoraLocal: "2026-08-17T10:00",
        timezone: "America/Sao_Paulo"
      });

      assert.strictEqual(resposta.status, 200);
      assert.strictEqual(resposta.body.oferta.status, "agendada");
      assert.strictEqual(resposta.body.oferta.agendadoPara, "2026-08-17T13:00:00.000Z");
      assert.deepStrictEqual(resposta.body.oferta.destinosIds, ["tg_ok"]);
      assert.strictEqual(resposta.body.oferta.agendamentoLockId || "", "");
      assert.strictEqual(resposta.body.oferta.agendamentoLockEm || "", "");
      assertSemSegredos(resposta.body);
    }

    {
      const oferta = criarOferta("cliente_a", "oferta_cancelar");
      await request(server, "POST", `/manual-v2/ofertas/${oferta.id}/agendar`, "cliente_a", {
        destinosIds: ["wa_ok"],
        dataHoraLocal: "2026-08-16T14:30",
        timezone: "America/Sao_Paulo"
      });
      const resposta = await request(server, "POST", `/manual-v2/ofertas/${oferta.id}/agendamento/cancelar`, "cliente_a", {});

      assert.strictEqual(resposta.status, 200);
      assert.strictEqual(resposta.body.oferta.status, "salva");
      assert.strictEqual(resposta.body.oferta.agendadoPara, "");
      assert.deepStrictEqual(resposta.body.oferta.destinosIds, []);
      assert.deepStrictEqual(resposta.body.oferta.destinosAgendados, []);
      assert.ok(resposta.body.oferta.agendamentoCanceladoEm);
    }

    {
      const oferta = criarOferta("cliente_b", "oferta_cliente_b");
      const resposta = await request(server, "POST", `/manual-v2/ofertas/${oferta.id}/agendar`, "cliente_a", {
        destinosIds: ["wa_ok"],
        dataHoraLocal: "2026-08-16T14:30",
        timezone: "America/Sao_Paulo"
      });

      assert.strictEqual(resposta.status, 404);
      assert.strictEqual(storage.buscarOfertaManualV2("cliente_b", oferta.id).status, "salva");
    }

    for (const status of ["enviando", "enviada"]) {
      const ofertaReprogramar = criarOferta("cliente_bloqueio", `oferta_reprogramar_${status}`);
      await request(server, "POST", `/manual-v2/ofertas/${ofertaReprogramar.id}/agendar`, "cliente_bloqueio", {
        destinosIds: ["wa_b"],
        dataHoraLocal: "2026-08-16T14:30",
        timezone: "America/Sao_Paulo"
      });
      storage.atualizarMetadadosEnvioManualV2("cliente_bloqueio", ofertaReprogramar.id, {
        status,
        enviadoEm: status === "enviada" ? NOW : ""
      }, { now: () => NOW });

      const respostaReprogramar = await request(server, "PUT", `/manual-v2/ofertas/${ofertaReprogramar.id}/agendamento`, "cliente_bloqueio", {
        destinosIds: ["wa_b"],
        dataHoraLocal: "2026-08-17T14:30",
        timezone: "America/Sao_Paulo"
      });
      assert.strictEqual(respostaReprogramar.status, 409);
      assert.strictEqual(respostaReprogramar.body.motivo, "oferta_manual_v2_agendamento_status_bloqueado");

      const ofertaCancelar = criarOferta("cliente_bloqueio", `oferta_cancelar_${status}`);
      await request(server, "POST", `/manual-v2/ofertas/${ofertaCancelar.id}/agendar`, "cliente_bloqueio", {
        destinosIds: ["wa_b"],
        dataHoraLocal: "2026-08-16T14:30",
        timezone: "America/Sao_Paulo"
      });
      storage.atualizarMetadadosEnvioManualV2("cliente_bloqueio", ofertaCancelar.id, {
        status,
        enviadoEm: status === "enviada" ? NOW : ""
      }, { now: () => NOW });

      const respostaCancelar = await request(server, "POST", `/manual-v2/ofertas/${ofertaCancelar.id}/agendamento/cancelar`, "cliente_bloqueio", {});
      assert.strictEqual(respostaCancelar.status, 409);
      assert.strictEqual(respostaCancelar.body.motivo, "oferta_manual_v2_agendamento_status_bloqueado");
    }

    {
      assert.strictEqual(chamadasDispatcher, 0, "rotas de agendamento nao disparam dispatcher");
      assert.strictEqual(fs.existsSync(getClienteJsonPath("cliente_a", "fila.json")), false);
      assert.strictEqual(fs.existsSync(getClienteJsonPath("cliente_b", "fila.json")), false);
    }

    {
      const fonte = fs.readFileSync(
        path.join(__dirname, "..", "modules", "manual-v2", "manual-offers.routes.js"),
        "utf8"
      );
      const proibidos = [
        "utils/fila-ofertas",
        "fila.json",
        "processarFila",
        "adicionarOfertaInicioFila",
        "prepararOfertaGlobal",
        "Engine",
        "Radar",
        "Distributor",
        "Oferta Universal",
        "manual-scheduler",
        "/fila",
        "/enviar-manual"
      ];

      for (const termo of proibidos) {
        assert.ok(!fonte.includes(termo), `rotas Manual V2 nao podem referenciar ${termo}`);
      }
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  console.log("manual-v2-schedule-routes.test.js ok");
})().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
