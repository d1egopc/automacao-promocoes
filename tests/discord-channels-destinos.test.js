const assert = require("assert");
const express = require("express");
const criarRotasDiscord = require("../modules/discord/discord.routes");
const {
  salvarConexaoDiscord,
  desconectarConexaoDiscord
} = require("../modules/discord/discord-connections.storage");
const {
  listarCanaisDiscord,
  validarDestinoDiscord,
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

function criarHttpDiscord() {
  const chamadas = [];
  const roles = [
    { id: "guild_a", permissions: String(PERMISSAO_VIEW_CHANNEL | PERMISSAO_SEND_MESSAGES) },
    { id: "role_sem_send", permissions: String(PERMISSAO_VIEW_CHANNEL) }
  ];
  const canais = [
    { id: "canal_ok", name: "ofertas-gerais", type: 0, permission_overwrites: [] },
    {
      id: "canal_sem_send",
      name: "somente-leitura",
      type: 0,
      permission_overwrites: [{ id: "guild_a", type: 0, deny: String(PERMISSAO_SEND_MESSAGES), allow: "0" }]
    },
    { id: "voz", name: "Voz", type: 2, permission_overwrites: [] }
  ];

  return {
    chamadas,
    client: {
      async get(url, options) {
        chamadas.push({ url, options });
        if (url.endsWith("/users/@me")) return { data: { id: "bot_1" } };
        if (url.endsWith("/guilds/guild_a/members/bot_1")) return { data: { user: { id: "bot_1" }, roles: [] } };
        if (url.endsWith("/guilds/guild_a/roles")) return { data: roles };
        if (url.endsWith("/guilds/guild_a/channels")) return { data: canais };
        if (url.endsWith("/guilds/guild_b/channels")) return { data: [{ id: "canal_b", name: "outro-workspace", type: 0 }] };
        return { data: [] };
      }
    }
  };
}

function textoJson(valor) {
  return JSON.stringify(valor);
}

function criarResolverPlatformVariables(valores = {}) {
  return async (nome) => {
    if (Object.prototype.hasOwnProperty.call(valores, nome)) {
      return { ok: true, source: "platform_variables", nome, value: valores[nome] };
    }
    return { ok: false, source: "missing", nome, value: null };
  };
}

(async () => {
const storage = criarStorageMemoria();
const http = criarHttpDiscord();

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
const conexaoInativa = salvarConexaoDiscord("cliente_a", {
  guildId: "guild_inativa",
  guildName: "Inativa",
  ativo: true
}, storage.deps);
desconectarConexaoDiscord("cliente_a", conexaoInativa.id, storage.deps);

const canais = await listarCanaisDiscord({ guildId: "guild_a", env: ENV, httpClient: http.client });
assert.strictEqual(canais.length, 2, "Apenas canais texto/anuncio devem ser retornados");
assert.strictEqual(canais.find((c) => c.id === "canal_ok").utilizavel, true, "Canal com view+send deve ser utilizavel");
assert.strictEqual(canais.find((c) => c.id === "canal_sem_send").utilizavel, false, "Canal sem Send Messages deve ser indisponivel");
assert.ok(!textoJson(canais).match(/token|secret|Authorization|permission_overwrites|permissions/i), "Retorno de canais deve ser sanitizado");

const httpPainel = criarHttpDiscord();
await listarCanaisDiscord({
  guildId: "guild_a",
  env: { DISCORD_BOT_TOKEN: "bot_env_antigo" },
  httpClient: httpPainel.client,
  getPlatformVariableImpl: criarResolverPlatformVariables({ DISCORD_BOT_TOKEN: "bot_painel_nao_vaza" })
});
assert.ok(
  httpPainel.chamadas.every((c) => c.options.headers.Authorization === "Bot bot_painel_nao_vaza"),
  "Listagem de canais deve consumir bot token do painel em vez de ENV"
);
assert.ok(!textoJson(canais).includes("bot_painel_nao_vaza"), "Token do painel nao deve sair em payload de canais");

const destinoValidado = await validarDestinoDiscord({
  clienteId: "cliente_a",
  destino: {
    id: "dest_discord",
    tipo: "discord",
    conexaoId: conexaoA.id,
    channelId: "canal_ok",
    guildId: "guild_b",
    channelName: "forjado"
  },
  conexoes: [conexaoA],
  env: ENV,
  httpClient: http.client
});
assert.strictEqual(destinoValidado.guildId, "guild_a", "guildId adulterado pelo browser deve ser ignorado");
assert.strictEqual(destinoValidado.channelName, "ofertas-gerais", "channelName deve vir do Discord, nao do browser");
assert.ok(!textoJson(destinoValidado).match(/token|secret|botToken/i), "Destino Discord validado nao deve conter segredo");

await assert.rejects(
  () => validarDestinoDiscord({
    clienteId: "cliente_a",
    destino: { tipo: "discord", conexaoId: conexaoA.id, channelId: "canal_sem_send" },
    conexoes: [conexaoA],
    env: ENV,
    httpClient: http.client
  }),
  /discord_canal_indisponivel/,
  "Canal sem Send Messages nao deve salvar destino utilizavel"
);

await assert.rejects(
  () => validarDestinoDiscord({
    clienteId: "cliente_a",
    destino: { tipo: "discord", conexaoId: "discord_guild_b", channelId: "canal_b" },
    conexoes: [conexaoA],
    env: ENV,
    httpClient: http.client
  }),
  /discord_conexao_nao_encontrada/,
  "Workspace A nao pode usar conexao de B"
);

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
try {
  const base = `http://127.0.0.1:${server.address().port}`;
  const semPlano = await fetch(`${base}/discord/conexoes/${encodeURIComponent(conexaoA.id)}/canais`, {
    headers: { "x-cliente": "cliente_a" }
  });
  assert.strictEqual(semPlano.status, 403, "Plano sem Discord bloqueia canais");

  const outroWorkspace = await fetch(`${base}/discord/conexoes/${encodeURIComponent("discord_guild_b")}/canais`, {
    headers: { "x-cliente": "cliente_a", "x-discord": "1" }
  });
  assert.strictEqual(outroWorkspace.status, 404, "A nao lista canais da conexao B");

  const inativa = await fetch(`${base}/discord/conexoes/${encodeURIComponent(conexaoInativa.id)}/canais`, {
    headers: { "x-cliente": "cliente_a", "x-discord": "1" }
  });
  assert.strictEqual(inativa.status, 400, "Conexao inativa nao lista canais");

  const ok = await fetch(`${base}/discord/conexoes/${encodeURIComponent(conexaoA.id)}/canais`, {
    headers: { "x-cliente": "cliente_a", "x-discord": "1" }
  });
  assert.strictEqual(ok.status, 200);
  const body = await ok.json();
  assert.strictEqual(body.ok, true);
  assert.strictEqual(body.canais[0].id, "canal_ok");
  assert.ok(!textoJson(body).match(/token|secret|Authorization|permission_overwrites|permissions/i), "Rota de canais nao vaza segredo/permissoes brutas");
} finally {
  await new Promise((resolve) => server.close(resolve));
}

console.log("discord-channels-destinos.test.js OK");
})().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
