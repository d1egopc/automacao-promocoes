const assert = require("assert");
const express = require("express");
const criarRotasDiscord = require("../modules/discord/discord.routes");
const { salvarConexaoDiscord } = require("../modules/discord/discord-connections.storage");
const {
  PERMISSAO_VIEW_CHANNEL,
  PERMISSAO_SEND_MESSAGES
} = require("../modules/discord/discord-channels");

const ENV = {
  DISCORD_CLIENT_ID: "client_123",
  DISCORD_CLIENT_SECRET: "client_secret_nao_vaza",
  DISCORD_BOT_TOKEN: "bot_token_nao_vaza",
  DISCORD_REDIRECT_URI: "https://go.optimuspromo.com.br/discord/callback"
};

function criarStorageMemoria() {
  const dados = new Map();
  return {
    dados,
    deps: {
      normalizarClienteId: (id) => String(id || "admin"),
      readClienteJson: (clienteId, arquivo, fallback) => {
        const chave = `${clienteId}:${arquivo}`;
        return dados.has(chave) ? JSON.parse(JSON.stringify(dados.get(chave))) : JSON.parse(JSON.stringify(fallback));
      },
      writeClienteJson: (clienteId, arquivo, valor) => {
        dados.set(`${clienteId}:${arquivo}`, JSON.parse(JSON.stringify(valor)));
        return true;
      },
      now: () => "2026-08-15T12:00:00.000Z"
    }
  };
}

function criarHttpDiscord({ postError } = {}) {
  const chamadas = [];
  const rolesA = [{ id: "guild_a", permissions: String(PERMISSAO_VIEW_CHANNEL | PERMISSAO_SEND_MESSAGES) }];
  const rolesB = [{ id: "guild_b", permissions: String(PERMISSAO_VIEW_CHANNEL | PERMISSAO_SEND_MESSAGES) }];
  return {
    chamadas,
    client: {
      async get(url, options) {
        chamadas.push({ metodo: "GET", url, options });
        if (url.endsWith("/users/@me")) return { data: { id: "bot_1" } };
        if (url.endsWith("/guilds/guild_a/members/bot_1")) return { data: { user: { id: "bot_1" }, roles: [] } };
        if (url.endsWith("/guilds/guild_b/members/bot_1")) return { data: { user: { id: "bot_1" }, roles: [] } };
        if (url.endsWith("/guilds/guild_a/roles")) return { data: rolesA };
        if (url.endsWith("/guilds/guild_b/roles")) return { data: rolesB };
        if (url.endsWith("/guilds/guild_a/channels")) {
          return {
            data: [
              { id: "canal_ok", name: "ofertas-gerais", type: 0, permission_overwrites: [] },
              {
                id: "canal_sem_send",
                name: "somente-leitura",
                type: 0,
                permission_overwrites: [{ id: "guild_a", type: 0, deny: String(PERMISSAO_SEND_MESSAGES), allow: "0" }]
              }
            ]
          };
        }
        if (url.endsWith("/guilds/guild_b/channels")) {
          return { data: [{ id: "canal_b", name: "outro", type: 0, permission_overwrites: [] }] };
        }
        return { data: [] };
      },
      async post(url, body, options) {
        chamadas.push({ metodo: "POST", url, body, options });
        if (postError) throw postError;
        return {
          status: 200,
          data: { id: "msg_teste", timestamp: "2026-08-15T12:00:00.000Z" }
        };
      }
    }
  };
}

function erroHttp(status, data = {}, headers = {}) {
  const erro = new Error(`HTTP ${status}`);
  erro.response = { status, data, headers };
  return erro;
}

function textoJson(valor) {
  return JSON.stringify(valor);
}

async function criarApp({ http, storage }) {
  const app = express();
  app.use(express.json());
  app.use("/discord", criarRotasDiscord({
    getClienteId: (req) => req.headers["x-cliente"] || "cliente_a",
    usuarioTemRecurso: (req, recurso) => recurso === "discord" && req.headers["x-discord"] === "1",
    env: ENV,
    httpClient: http.client,
    storageDeps: storage.deps
  }));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  return { server, base };
}

async function postJson(base, caminho, body, headers = {}) {
  return fetch(`${base}${caminho}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body)
  });
}

(async () => {
  const storage = criarStorageMemoria();
  const conexaoA = salvarConexaoDiscord("cliente_a", {
    guildId: "guild_a",
    guildName: "D1EGOPC Ofertas",
    ativo: true
  }, storage.deps);
  salvarConexaoDiscord("cliente_b", {
    guildId: "guild_b",
    guildName: "Outro Workspace",
    ativo: true
  }, storage.deps);

  {
    const http = criarHttpDiscord();
    const { server, base } = await criarApp({ http, storage });
    try {
      const semPlano = await postJson(base, `/discord/conexoes/${encodeURIComponent(conexaoA.id)}/testar`, { channelId: "canal_ok" }, {
        "x-cliente": "cliente_a"
      });
      assert.strictEqual(semPlano.status, 403, "Plano sem Discord bloqueia teste");

      const outroWorkspace = await postJson(base, `/discord/conexoes/${encodeURIComponent("discord_guild_b")}/testar`, { channelId: "canal_b" }, {
        "x-cliente": "cliente_a",
        "x-discord": "1"
      });
      assert.strictEqual(outroWorkspace.status, 404, "Workspace errado nao testa conexao de B");

      const outraGuild = await postJson(base, `/discord/conexoes/${encodeURIComponent(conexaoA.id)}/testar`, {
        channelId: "canal_b",
        guildId: "guild_b"
      }, {
        "x-cliente": "cliente_a",
        "x-discord": "1"
      });
      assert.strictEqual(outraGuild.status, 404, "Canal de outra guild deve ser rejeitado");

      const indisponivel = await postJson(base, `/discord/conexoes/${encodeURIComponent(conexaoA.id)}/testar`, { channelId: "canal_sem_send" }, {
        "x-cliente": "cliente_a",
        "x-discord": "1"
      });
      assert.strictEqual(indisponivel.status, 400, "Canal sem Send Messages deve ser rejeitado");

      const ok = await postJson(base, `/discord/conexoes/${encodeURIComponent(conexaoA.id)}/testar`, { channelId: "canal_ok" }, {
        "x-cliente": "cliente_a",
        "x-discord": "1"
      });
      assert.strictEqual(ok.status, 200);
      const body = await ok.json();
      assert.strictEqual(body.ok, true);
      assert.strictEqual(body.resultado.messageId, "msg_teste");
      assert.ok(http.chamadas.some((chamada) => chamada.metodo === "POST" && chamada.url.endsWith("/channels/canal_ok/messages")), "Teste deve chamar sender Discord");
      const post = http.chamadas.find((chamada) => chamada.metodo === "POST");
      assert.deepStrictEqual(post.body, { content: criarRotasDiscord.MENSAGEM_TESTE_DISCORD });
      assert.ok(!textoJson(body).match(/bot_token|Authorization|secret|credito|fila/i), "Resposta do teste deve ser sanitizada e sem credito/fila");
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }

  for (const [status, esperado] of [
    [403, "discord_sem_permissao"],
    [404, "discord_canal_nao_encontrado"],
    [429, "discord_rate_limit"]
  ]) {
    const http = criarHttpDiscord({
      postError: erroHttp(status, status === 429 ? { retry_after: 2 } : {}, status === 429 ? { "retry-after": "2" } : {})
    });
    const { server, base } = await criarApp({ http, storage });
    try {
      const resposta = await postJson(base, `/discord/conexoes/${encodeURIComponent(conexaoA.id)}/testar`, { channelId: "canal_ok" }, {
        "x-cliente": "cliente_a",
        "x-discord": "1"
      });
      assert.strictEqual(resposta.status, status);
      const body = await resposta.json();
      assert.strictEqual(body.ok, false);
      assert.strictEqual(body.resultado.erro, esperado);
      if (status === 429) assert.strictEqual(body.resultado.retryAfterMs, 2000);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }

  {
    const fonteRotas = require("fs").readFileSync(require("path").resolve(__dirname, "../modules/discord/discord.routes.js"), "utf8");
    assert.ok(!/processarFila|adicionarOfertaInicioFila|prepararOfertaGlobal|Distributor|Radar|Engine|Oferta Universal|manual-v2|credito|creditos/i.test(fonteRotas), "Rota de teste Discord nao deve tocar rio automatico/credito/manual");
  }

  console.log("discord-test-route.test.js OK");
})().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
