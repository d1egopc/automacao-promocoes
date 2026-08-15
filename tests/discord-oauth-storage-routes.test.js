const assert = require("assert");
const express = require("express");
const jwt = require("jsonwebtoken");
const fs = require("fs");
const path = require("path");

const criarRotasDiscord = require("../modules/discord/discord.routes");
const {
  DISCORD_SCOPE,
  DISCORD_PERMISSIONS,
  criarStateDiscord,
  criarUrlConexaoDiscord,
  validarStateDiscord,
  processarCallbackDiscord
} = require("../modules/discord/discord-oauth");
const {
  salvarConexaoDiscord,
  listarConexoesDiscord,
  desconectarConexaoDiscord
} = require("../modules/discord/discord-connections.storage");
const {
  registrarStateDiscordOAuth,
  consumirStateDiscordOAuth
} = require("../modules/discord/discord-oauth-state.storage");

const SECRET = "segredo_teste_discord";
const ENV = {
  DISCORD_CLIENT_ID: "client_123",
  DISCORD_CLIENT_SECRET: "client_secret_nao_vaza",
  DISCORD_BOT_TOKEN: "bot_token_nao_vaza",
  DISCORD_REDIRECT_URI: "https://go.optimuspromo.com.br/discord/callback"
};

function criarStorageMemoria(now = () => "2026-08-15T12:00:00.000Z") {
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
      now
    }
  };
}

function textoJson(valor) {
  return JSON.stringify(valor);
}

function criarStatePersistido(clienteId, storage) {
  return criarUrlConexaoDiscord({
    clienteId,
    env: ENV,
    jwt,
    secret: SECRET,
    registrarStateDiscordOAuth: (id, dados) => registrarStateDiscordOAuth(id, dados, storage.deps)
  });
}

function criarHttpDiscord({ guildToken = "guild_2", guildBot = guildToken, token = "oauth_access_nao_persistir" } = {}) {
  const chamadas = [];
  return {
    chamadas,
    client: {
      async post(url, body, options) {
        chamadas.push({ metodo: "POST", url, body, options });
        return {
          data: {
            access_token: token,
            refresh_token: "oauth_refresh_nao_persistir",
            scope: "bot identify",
            guild: { id: guildToken, name: `Servidor ${guildToken}`, icon: "icone_hash" }
          }
        };
      },
      async get(url, options) {
        chamadas.push({ metodo: "GET", url, options });
        if (!guildBot) return { data: {} };
        return { data: { id: guildBot, name: `Servidor ${guildBot}`, icon: "icone_hash" } };
      }
    }
  };
}

const storage = criarStorageMemoria();
const urlOAuth = criarStatePersistido("cliente_a", storage);
assert.strictEqual(DISCORD_SCOPE, "bot identify", "D2.1 deve reduzir scopes para code grant minimo");
assert.strictEqual(DISCORD_PERMISSIONS, "52224", "Permissoes devem ser View Channels + Send Messages + Embed Links + Attach Files");
assert.strictEqual(urlOAuth.ok, true, "OAuth deve gerar URL");
assert.ok(urlOAuth.url.startsWith("https://discord.com/oauth2/authorize?"), "URL deve usar endpoint oficial Discord");
assert.ok(urlOAuth.url.includes("client_id=client_123"), "URL deve conter client_id publico");
const paramsOAuth = new URL(urlOAuth.url).searchParams;
assert.strictEqual(paramsOAuth.get("scope"), "bot identify", "URL deve usar apenas bot identify");
assert.ok(!paramsOAuth.get("scope").includes("applications.commands") && !paramsOAuth.get("scope").includes("guilds"), "URL nao deve pedir guilds/applications.commands");
assert.ok(urlOAuth.url.includes("permissions=52224"), "URL deve pedir permissao minima sem Administrator");
assert.strictEqual(Number(DISCORD_PERMISSIONS) & 8, 0, "Permissoes nao devem incluir Administrator");
assert.ok(!urlOAuth.url.includes(ENV.DISCORD_CLIENT_SECRET), "URL OAuth nao pode vazar client secret");
assert.ok(!urlOAuth.url.includes(ENV.DISCORD_BOT_TOKEN), "URL OAuth nao pode vazar bot token");
const stateDecodificado = validarStateDiscord(urlOAuth.state, { jwt, secret: SECRET });
assert.strictEqual(stateDecodificado.clienteId, "cliente_a", "state deve preservar clienteId assinado");
assert.ok(stateDecodificado.nonce, "state deve conter nonce para anti-replay");
assert.throws(() => validarStateDiscord("state_invalido", { jwt, secret: SECRET }), /jwt|invalid|malformed/i, "state invalido deve rejeitar");

const salva = salvarConexaoDiscord("cliente_a", {
  guildId: "guild_1",
  guildName: "Servidor Um",
  guildIcon: "https://cdn.discordapp.com/icons/guild_1/icon.png",
  botToken: "nao_persistir"
}, storage.deps);
assert.strictEqual(salva.tipo, "discord");
assert.strictEqual(salva.guildId, "guild_1");
assert.strictEqual(salva.utilizavel, true);
assert.ok(!textoJson(salva).includes("nao_persistir"), "Resposta sanitizada nao deve conter token");

const lista = listarConexoesDiscord("cliente_a", storage.deps);
assert.strictEqual(lista.length, 1, "Conexao deve listar por cliente");
assert.strictEqual(listarConexoesDiscord("cliente_b", storage.deps).length, 0, "Cliente B nao ve conexao de A");
assert.strictEqual(desconectarConexaoDiscord("cliente_b", salva.id, storage.deps), null, "Cliente B nao desconecta conexao de A");
assert.strictEqual(desconectarConexaoDiscord("cliente_a", salva.id, storage.deps).ativo, false, "Desconectar deve desativar conexao do proprio cliente");

(async () => {
const httpOk = criarHttpDiscord({ guildToken: "guild_2", guildBot: "guild_2" });
const stateClienteA = criarStatePersistido("cliente_a", storage).state;
let clienteSalvo = "";
const conexaoCallback = await processarCallbackDiscord({
  query: { state: stateClienteA, code: "codigo_ok", guild_id: "guild_invasora", clienteId: "cliente_b" },
  env: ENV,
  jwt,
  secret: SECRET,
  httpClient: httpOk.client,
  consumirStateDiscordOAuth: (clienteId, nonce) => consumirStateDiscordOAuth(clienteId, nonce, storage.deps),
  salvarConexaoDiscord: (clienteId, dados) => {
    clienteSalvo = clienteId;
    return salvarConexaoDiscord(clienteId, dados, storage.deps);
  }
});
assert.strictEqual(clienteSalvo, "cliente_a", "Callback deve confiar no state, nao em clienteId livre do browser");
assert.strictEqual(conexaoCallback.guildId, "guild_2", "Guild deve vir do token OAuth, nao da query");
assert.ok(!httpOk.chamadas.some((c) => c.url.endsWith("/guilds/guild_invasora")), "Query guild_id arbitraria nao pode ser usada como autoridade");
assert.ok(httpOk.chamadas.some((c) => c.url.endsWith("/oauth2/token")), "Callback deve validar resultado OAuth");
assert.ok(httpOk.chamadas.some((c) => c.url.endsWith("/guilds/guild_2")), "Callback deve confirmar guild do token via Bot Token backend");
assert.ok(!textoJson(conexaoCallback).includes("oauth_access_nao_persistir"), "OAuth access token nao deve sair no retorno");
assert.ok(!textoJson(storage.dados).includes("oauth_refresh_nao_persistir"), "OAuth refresh token nao deve ser persistido");
assert.ok(!textoJson(storage.dados).includes("bot_token_nao_vaza"), "Bot token global nao deve ser persistido por workspace");

await assert.rejects(
  () => processarCallbackDiscord({
    query: { state: stateClienteA, code: "codigo_replay" },
    env: ENV,
    jwt,
    secret: SECRET,
    httpClient: httpOk.client,
    consumirStateDiscordOAuth: (clienteId, nonce) => consumirStateDiscordOAuth(clienteId, nonce, storage.deps),
    salvarConexaoDiscord: (clienteId, dados) => salvarConexaoDiscord(clienteId, dados, storage.deps)
  }),
  /discord_state_reutilizado/,
  "Replay do mesmo state deve falhar"
);

const stateSemNonce = criarStateDiscord({ clienteId: "cliente_a", jwt, secret: SECRET }).token;
await assert.rejects(
  () => processarCallbackDiscord({
    query: { state: stateSemNonce, code: "codigo_sem_nonce" },
    env: ENV,
    jwt,
    secret: SECRET,
    httpClient: httpOk.client,
    consumirStateDiscordOAuth: (clienteId, nonce) => consumirStateDiscordOAuth(clienteId, nonce, storage.deps),
    salvarConexaoDiscord: (clienteId, dados) => salvarConexaoDiscord(clienteId, dados, storage.deps)
  }),
  /discord_state_nonce_inexistente/,
  "Nonce inexistente deve falhar"
);

const storageOutroWorkspace = criarStorageMemoria();
const stateA = criarStateDiscord({ clienteId: "cliente_a", jwt, secret: SECRET });
registrarStateDiscordOAuth("cliente_b", { nonce: stateA.nonce, criadoEm: stateA.criadoEm, expiraEm: stateA.expiraEm }, storageOutroWorkspace.deps);
await assert.rejects(
  () => processarCallbackDiscord({
    query: { state: stateA.token, code: "codigo_workspace" },
    env: ENV,
    jwt,
    secret: SECRET,
    httpClient: httpOk.client,
    consumirStateDiscordOAuth: (clienteId, nonce) => consumirStateDiscordOAuth(clienteId, nonce, storageOutroWorkspace.deps),
    salvarConexaoDiscord: (clienteId, dados) => salvarConexaoDiscord(clienteId, dados, storageOutroWorkspace.deps)
  }),
  /discord_state_nonce_inexistente/,
  "Nonce de outro workspace nao deve validar"
);

const storageExpirado = criarStorageMemoria(() => "2026-08-15T12:20:00.000Z");
const stateExpirado = criarStateDiscord({ clienteId: "cliente_a", jwt, secret: SECRET, now: () => Date.parse("2026-08-15T12:00:00.000Z") });
registrarStateDiscordOAuth("cliente_a", {
  nonce: stateExpirado.nonce,
  criadoEm: "2026-08-15T12:00:00.000Z",
  expiraEm: "2026-08-15T12:10:00.000Z"
}, storageExpirado.deps);
await assert.rejects(
  () => processarCallbackDiscord({
    query: { state: stateExpirado.token, code: "codigo_expirado" },
    env: ENV,
    jwt,
    secret: SECRET,
    httpClient: httpOk.client,
    consumirStateDiscordOAuth: (clienteId, nonce) => consumirStateDiscordOAuth(clienteId, nonce, storageExpirado.deps),
    salvarConexaoDiscord: (clienteId, dados) => salvarConexaoDiscord(clienteId, dados, storageExpirado.deps)
  }),
  /discord_state_expirado/,
  "State expirado no storage deve falhar"
);

const storageBotAusente = criarStorageMemoria();
const stateBotAusente = criarStatePersistido("cliente_a", storageBotAusente).state;
const httpBotAusente = criarHttpDiscord({ guildToken: "guild_sem_bot", guildBot: "" });
await assert.rejects(
  () => processarCallbackDiscord({
    query: { state: stateBotAusente, code: "codigo_bot_ausente" },
    env: ENV,
    jwt,
    secret: SECRET,
    httpClient: httpBotAusente.client,
    consumirStateDiscordOAuth: (clienteId, nonce) => consumirStateDiscordOAuth(clienteId, nonce, storageBotAusente.deps),
    salvarConexaoDiscord: (clienteId, dados) => salvarConexaoDiscord(clienteId, dados, storageBotAusente.deps)
  }),
  /discord_guild_inacessivel/,
  "Bot ausente na guild deve falhar"
);

const storageMulti = criarStorageMemoria();
for (const clienteId of ["cliente_a", "cliente_b"]) {
  const state = criarStatePersistido(clienteId, storageMulti).state;
  await processarCallbackDiscord({
    query: { state, code: `codigo_${clienteId}` },
    env: ENV,
    jwt,
    secret: SECRET,
    httpClient: criarHttpDiscord({ guildToken: "guild_compartilhada", guildBot: "guild_compartilhada" }).client,
    consumirStateDiscordOAuth: (id, nonce) => consumirStateDiscordOAuth(id, nonce, storageMulti.deps),
    salvarConexaoDiscord: (id, dados) => salvarConexaoDiscord(id, dados, storageMulti.deps)
  });
}
assert.strictEqual(listarConexoesDiscord("cliente_a", storageMulti.deps)[0].guildId, "guild_compartilhada", "Mesma guild pode existir no workspace A");
assert.strictEqual(listarConexoesDiscord("cliente_b", storageMulti.deps)[0].guildId, "guild_compartilhada", "Mesma guild exige autorizacao independente no workspace B");

const app = express();
app.use(express.json());
app.use("/discord", criarRotasDiscord({
  getClienteId: (req) => req.headers["x-cliente"] || "cliente_a",
  usuarioTemRecurso: (req, recurso) => recurso === "discord" && req.headers["x-discord"] === "1",
  jwt,
  jwtSecret: SECRET,
  env: ENV,
  httpClient: httpOk.client,
  storageDeps: storage.deps
}));
const server = app.listen(0);
try {
  const base = `http://127.0.0.1:${server.address().port}`;
  const bloqueado = await fetch(`${base}/discord/conectar`, { headers: { "x-cliente": "cliente_plano_sem" } });
  assert.strictEqual(bloqueado.status, 403, "Plano sem Discord deve bloquear conectar");

  const liberado = await fetch(`${base}/discord/conectar`, { headers: { "x-cliente": "cliente_a", "x-discord": "1" } });
  assert.strictEqual(liberado.status, 200, "Plano com Discord deve gerar URL");
  const bodyLiberado = await liberado.json();
  assert.strictEqual(bodyLiberado.ok, true);
  assert.ok(!textoJson(bodyLiberado).includes(ENV.DISCORD_CLIENT_SECRET), "Rota conectar nao vaza client secret");
  assert.ok(!textoJson(bodyLiberado).includes(ENV.DISCORD_BOT_TOKEN), "Rota conectar nao vaza bot token");

  const conexoes = await fetch(`${base}/discord/conexoes`, { headers: { "x-cliente": "cliente_a" } });
  assert.strictEqual(conexoes.status, 200);
  const bodyConexoes = await conexoes.json();
  assert.strictEqual(bodyConexoes.ok, true);
  assert.ok(!textoJson(bodyConexoes).match(/token|secret|Authorization/i), "GET conexoes deve ser sanitizado");
} finally {
  await new Promise((resolve) => server.close(resolve));
}

const raiz = path.resolve(__dirname, "..");
for (const relativo of [
  "modules/discord/discord-connections.storage.js",
  "modules/discord/discord-oauth-state.storage.js",
  "modules/discord/discord-oauth.js",
  "modules/discord/discord.routes.js"
]) {
  const fonte = fs.readFileSync(path.join(raiz, relativo), "utf8");
  assert.ok(!/processarFila|adicionarOfertaInicioFila|prepararOfertaGlobal|Distributor|Radar|Oferta Universal|fila\.json|manual-dispatcher|manual-scheduler/i.test(fonte), `${relativo} nao deve tocar envio/rio automatico`);
}

console.log("discord-oauth-storage-routes.test.js OK");
})().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
