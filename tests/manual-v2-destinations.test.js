const assert = require("assert");
const fs = require("fs");
const path = require("path");
const express = require("express");

const {
  listarDestinosManuaisV2
} = require("../modules/manual-v2/manual-destinations");
const criarRotasManualV2 = require("../modules/manual-v2/manual-offers.routes");

const planoCompleto = {
  recursos: {
    whatsapp: true,
    telegram: true,
    discord: true
  }
};

const destinosPorCliente = {
  cliente_a: [
    {
      id: "wa_ok",
      nome: "Grupo Ofertas",
      tipo: "whatsapp",
      ativo: true,
      conexaoId: "sessao_a",
      gruposWhatsapp: ["120363@g.us"],
      segredoInterno: "nao_deve_sair"
    },
    {
      id: "wa_down",
      nome: "Grupo Desconectado",
      tipo: "whatsapp",
      ativo: true,
      conexaoId: "sessao_down",
      gruposWhatsapp: ["999@g.us"]
    },
    {
      id: "tg_ok",
      nome: "Canal Telegram",
      tipo: "telegram",
      ativo: true,
      telegramDestinos: ["chat_ok"]
    },
    {
      id: "tg_sem_config",
      nome: "Telegram Sem Config",
      tipo: "telegram",
      ativo: true,
      telegramDestinos: ["chat_sem_config"]
    },
    {
      id: "destino_inativo",
      nome: "Destino Inativo",
      tipo: "whatsapp",
      ativo: false,
      conexaoId: "sessao_a",
      gruposWhatsapp: ["120363@g.us"]
    },
    {
      id: "dc_ok",
      nome: "Discord Ofertas",
      tipo: "discord",
      ativo: true,
      conexaoId: "discord_a",
      channelId: "canal_ok",
      guildId: "guild_nao_sair",
      token: "DISCORD_TOKEN_NAO_SAIR"
    },
    {
      id: "dc_off",
      nome: "Discord Desconectado",
      tipo: "discord",
      ativo: true,
      conexaoId: "discord_off",
      channelId: "canal_ok"
    },
    {
      id: "dc_sem_send",
      nome: "Discord Sem Permissao",
      tipo: "discord",
      ativo: true,
      conexaoId: "discord_a",
      channelId: "canal_sem_send"
    }
  ],
  cliente_b: [
    {
      id: "wa_b",
      nome: "Grupo Cliente B",
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
      destinos: [
        {
          id: "bot_ok",
          nome: "Bot OK",
          botToken: "123456:SEGREDO",
          chatId: "chat_ok",
          ativo: true
        },
        {
          id: "bot_sem_config",
          nome: "Bot Sem Config",
          botToken: "",
          chatId: "chat_sem_config",
          ativo: true
        }
      ]
    }
  },
  cliente_b: {
    telegram: {
      destinos: [
        {
          id: "bot_b",
          botToken: "cliente_b:SEGREDO",
          chatId: "chat_b",
          ativo: true
        }
      ]
    }
  }
};

const sessoes = {
  sessao_a: {},
  sessao_b: {}
};

const statusSessao = {
  sessao_a: "open",
  sessao_down: "offline",
  sessao_b: "aberto"
};

const discordConexoes = [
  {
    id: "discord_a",
    tipo: "discord",
    guildId: "guild_a",
    guildName: "Servidor A",
    ativo: true,
    botToken: "BOT_DISCORD_NAO_SAIR"
  },
  {
    id: "discord_off",
    tipo: "discord",
    guildId: "guild_off",
    guildName: "Servidor Off",
    ativo: false
  }
];

const discordCanaisPorConexao = {
  discord_a: [
    {
      id: "canal_ok",
      nome: "ofertas",
      tipo: "texto",
      utilizavel: true
    },
    {
      id: "canal_sem_send",
      nome: "sem-envio",
      tipo: "texto",
      utilizavel: false,
      motivoIndisponivel: "Bot sem permissao para enviar mensagens"
    }
  ]
};

function assertSemSegredos(destinos) {
  const texto = JSON.stringify(destinos);
  for (const termo of ["SEGREDO", "botToken", "token", "secret", "cookies", "segredoInterno", "chat_ok", "chat_sem_config", "chat_b", "DISCORD_TOKEN_NAO_SAIR", "BOT_DISCORD_NAO_SAIR", "guild_a", "guild_nao_sair", "canal_ok", "canal_sem_send"]) {
    assert.ok(!texto.includes(termo), `retorno sanitizado nao pode conter ${termo}`);
  }
}

{
  const antesDestinos = JSON.stringify(destinosPorCliente);
  const antesConfigs = JSON.stringify(configsPorCliente);
  const destinos = listarDestinosManuaisV2("cliente_a", {
    destinosPorCliente,
    configsPorCliente,
    sessoes,
    statusSessao,
    plano: planoCompleto,
    discordConexoes,
    discordCanaisPorConexao,
    enviarDiscord: async () => ({ ok: true })
  });

  assert.strictEqual(destinos.length, 8);
  assertSemSegredos(destinos);

  const waOk = destinos.find((item) => item.id === "wa_ok");
  assert.deepStrictEqual(waOk, {
    id: "wa_ok",
    nome: "Grupo Ofertas",
    tipo: "whatsapp",
    ativo: true,
    utilizavel: true,
    motivoIndisponivel: "",
    identificacaoVisual: "120363@g.us"
  });

  const waDown = destinos.find((item) => item.id === "wa_down");
  assert.strictEqual(waDown.utilizavel, false);
  assert.strictEqual(waDown.motivoIndisponivel, "Sessao WhatsApp desconectada");

  const tgOk = destinos.find((item) => item.id === "tg_ok");
  assert.strictEqual(tgOk.utilizavel, true);
  assert.strictEqual(tgOk.identificacaoVisual, "Canal Telegram");

  const tgSemToken = destinos.find((item) => item.id === "tg_sem_config");
  assert.strictEqual(tgSemToken.utilizavel, false);
  assert.strictEqual(tgSemToken.motivoIndisponivel, "Telegram nao configurado");

  const inativo = destinos.find((item) => item.id === "destino_inativo");
  assert.strictEqual(inativo.utilizavel, false);
  assert.strictEqual(inativo.motivoIndisponivel, "Destino inativo");

  const dcOk = destinos.find((item) => item.id === "dc_ok");
  assert.deepStrictEqual(dcOk, {
    id: "dc_ok",
    nome: "Discord Ofertas",
    tipo: "discord",
    ativo: true,
    utilizavel: true,
    motivoIndisponivel: "",
    identificacaoVisual: "Servidor A #ofertas"
  });

  const dcOff = destinos.find((item) => item.id === "dc_off");
  assert.strictEqual(dcOff.utilizavel, false);
  assert.strictEqual(dcOff.motivoIndisponivel, "Servidor Discord desconectado");

  const dcSemSend = destinos.find((item) => item.id === "dc_sem_send");
  assert.strictEqual(dcSemSend.utilizavel, false);
  assert.strictEqual(dcSemSend.motivoIndisponivel, "Bot sem permissao para enviar mensagens");

  assert.strictEqual(JSON.stringify(destinosPorCliente), antesDestinos, "Manual V2 nao pode mutar destinos");
  assert.strictEqual(JSON.stringify(configsPorCliente), antesConfigs, "Manual V2 nao pode mutar configs");
}

{
  const destinos = listarDestinosManuaisV2("cliente_a", {
    destinosPorCliente,
    configsPorCliente,
    sessoes,
    statusSessao,
    plano: {
      recursos: {
        whatsapp: false,
        telegram: false,
        discord: false
      }
    },
    discordConexoes,
    discordCanaisPorConexao,
    enviarDiscord: async () => ({ ok: true })
  });

  assert.strictEqual(destinos.find((item) => item.id === "wa_ok").utilizavel, false);
  assert.strictEqual(destinos.find((item) => item.id === "wa_ok").motivoIndisponivel, "Canal indisponivel no plano atual");
  assert.strictEqual(destinos.find((item) => item.id === "tg_ok").utilizavel, false);
  assert.strictEqual(destinos.find((item) => item.id === "tg_ok").motivoIndisponivel, "Canal indisponivel no plano atual");
  assert.strictEqual(destinos.find((item) => item.id === "dc_ok").utilizavel, false);
  assert.strictEqual(destinos.find((item) => item.id === "dc_ok").motivoIndisponivel, "Canal indisponivel no plano atual");
}

{
  const destinosA = listarDestinosManuaisV2("cliente_a", {
    destinosPorCliente,
    configsPorCliente,
    sessoes,
    statusSessao,
    plano: planoCompleto,
    discordConexoes,
    discordCanaisPorConexao,
    enviarDiscord: async () => ({ ok: true })
  });
  const destinosB = listarDestinosManuaisV2("cliente_b", {
    destinosPorCliente,
    configsPorCliente,
    sessoes,
    statusSessao,
    plano: planoCompleto,
    discordConexoes,
    discordCanaisPorConexao,
    enviarDiscord: async () => ({ ok: true })
  });

  assert.ok(destinosA.every((item) => item.id !== "wa_b"));
  assert.deepStrictEqual(destinosB.map((item) => item.id), ["wa_b"]);
  assert.strictEqual(destinosB[0].utilizavel, true);
}

{
  const destinoDiscordUnitario = {
    id: "discord_destino_1",
    nome: "Discord Unitario",
    tipo: "discord",
    conexaoId: "discord_a",
    channelId: "canal_ok",
    ativo: true,
    token: "DISCORD_TOKEN_NAO_SAIR"
  };
  const destinos = listarDestinosManuaisV2("cliente_a", {
    destinosPorCliente: {
      cliente_a: {
        discord_destino_1: destinoDiscordUnitario
      }
    },
    configsPorCliente,
    sessoes,
    statusSessao,
    plano: planoCompleto,
    discordConexoes,
    discordCanaisPorConexao,
    enviarDiscord: async () => ({ ok: true })
  });

  assert.strictEqual(destinos.length, 1);
  assertSemSegredos(destinos);
  assert.deepStrictEqual(destinos[0], {
    id: "discord_destino_1",
    nome: "Discord Unitario",
    tipo: "discord",
    ativo: true,
    utilizavel: true,
    motivoIndisponivel: "",
    identificacaoVisual: "Servidor A #ofertas"
  });
}

{
  const destinos = listarDestinosManuaisV2("cliente_a", {
    destinosPorCliente: {
      cliente_a: {
        sessao_whatsapp: [
          {
            id: "wa_legado",
            nome: "WA Legado",
            tipo: "whatsapp",
            ativo: true,
            conexaoId: "sessao_a",
            gruposWhatsapp: ["120363@g.us"]
          }
        ],
        sessao_telegram: [
          {
            id: "tg_legado",
            nome: "TG Legado",
            tipo: "telegram",
            ativo: true,
            telegramDestinos: ["chat_ok"]
          }
        ],
        sessao_discord: [
          {
            id: "dc_legado",
            nome: "DC Legado",
            tipo: "discord",
            ativo: true,
            conexaoId: "discord_a",
            channelId: "canal_ok"
          }
        ]
      }
    },
    configsPorCliente,
    sessoes,
    statusSessao,
    plano: planoCompleto,
    discordConexoes,
    discordCanaisPorConexao,
    enviarDiscord: async () => ({ ok: true })
  });

  assert.deepStrictEqual(destinos.map((item) => item.id), ["wa_legado", "tg_legado", "dc_legado"]);
  assert.strictEqual(destinos.find((item) => item.id === "wa_legado").utilizavel, true);
  assert.strictEqual(destinos.find((item) => item.id === "tg_legado").utilizavel, true);
  assert.strictEqual(destinos.find((item) => item.id === "dc_legado").utilizavel, true);
}

{
  const destino = {
    id: "dc_repetido",
    nome: "Discord Repetido",
    tipo: "discord",
    ativo: true,
    conexaoId: "discord_a",
    channelId: "canal_ok"
  };
  const destinos = listarDestinosManuaisV2("cliente_a", {
    destinosPorCliente: {
      cliente_a: {
        primeira: [destino],
        segunda: destino,
        objeto_arbitrario: {
          nome: "Nao deve virar destino",
          recursos: { discord: true }
        }
      }
    },
    configsPorCliente,
    sessoes,
    statusSessao,
    plano: planoCompleto,
    discordConexoes,
    discordCanaisPorConexao,
    enviarDiscord: async () => ({ ok: true })
  });

  assert.deepStrictEqual(destinos.map((item) => item.id), ["dc_repetido"]);
}

function criarApp() {
  const app = express();
  app.use(express.json());
  app.use("/manual-v2", criarRotasManualV2({
    getClienteId: (req) => req.header("x-cliente-id") || "cliente_a",
    destinosPorCliente,
    configsPorCliente,
    sessoes,
    statusSessao,
    discordConexoes,
    discordCanaisPorConexao,
    enviarDiscord: async () => ({ ok: true }),
    getPlanoUsuario: (req) => {
      if (req.header("x-plano") === "sem-canais") {
        return { recursos: { whatsapp: false, telegram: false, discord: false } };
      }
      return planoCompleto;
    }
  }));
  return app;
}

function ouvir(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

async function request(server, clienteId = "cliente_a", plano = "") {
  const headers = { "x-cliente-id": clienteId };
  if (plano) headers["x-plano"] = plano;
  const res = await fetch(`http://127.0.0.1:${server.address().port}/manual-v2/destinos`, {
    headers
  });
  return { status: res.status, body: await res.json() };
}

(async function testarRota() {
  const server = await ouvir(criarApp());
  try {
    const respostaA = await request(server, "cliente_a");
    assert.strictEqual(respostaA.status, 200);
    assert.strictEqual(respostaA.body.ok, true);
    assert.strictEqual(respostaA.body.destinos.length, 8);
    assertSemSegredos(respostaA.body.destinos);

    const respostaB = await request(server, "cliente_b");
    assert.deepStrictEqual(respostaB.body.destinos.map((item) => item.id), ["wa_b"]);

    const semCanais = await request(server, "cliente_a", "sem-canais");
    assert.strictEqual(semCanais.body.destinos.find((item) => item.id === "wa_ok").utilizavel, false);
    assert.strictEqual(semCanais.body.destinos.find((item) => item.id === "tg_ok").utilizavel, false);
    assert.strictEqual(semCanais.body.destinos.find((item) => item.id === "dc_ok").utilizavel, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
})()
  .then(() => {
    const arquivos = [
      path.join(__dirname, "..", "modules", "manual-v2", "manual-destinations.js"),
      path.join(__dirname, "..", "modules", "manual-v2", "manual-offers.routes.js")
    ];
    const proibidos = [
      "utils/fila-ofertas",
      "salvarFila",
      "processarFila",
      "prepararOfertaGlobal",
      "adicionarOfertaInicioFila",
      "Distributor",
      "Engine",
      "Oferta Universal",
      "oferta-universal",
      "inteligencia-universal",
      "memoria-ofertas",
      "radar-ofertas",
      "/fila",
      "/enviar-manual",
      "registrarRadarCupons"
    ];

    for (const arquivo of arquivos) {
      const fonte = fs.readFileSync(arquivo, "utf8");
      for (const termo of proibidos) {
        assert.ok(!fonte.includes(termo), `Manual V2 destinos nao pode referenciar ${termo}`);
      }
    }

    console.log("manual-v2-destinations.test.js ok");
  })
  .catch((erro) => {
    console.error(erro);
    process.exit(1);
  });
