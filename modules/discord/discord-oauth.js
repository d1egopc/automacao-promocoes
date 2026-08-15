const crypto = require("crypto");

const DISCORD_AUTHORIZE_URL = "https://discord.com/oauth2/authorize";
const DISCORD_API_BASE = "https://discord.com/api/v10";
const DISCORD_SCOPE = "bot identify";
const DISCORD_PERMISSIONS = String(1024 + 2048 + 16384 + 32768);
const STATE_TTL = "10m";
const STATE_TTL_MS = 10 * 60 * 1000;

function texto(valor = "") {
  return String(valor ?? "").trim();
}

function obterConfigDiscord(env = process.env) {
  return {
    clientId: texto(env.DISCORD_CLIENT_ID),
    clientSecret: texto(env.DISCORD_CLIENT_SECRET),
    botToken: texto(env.DISCORD_BOT_TOKEN),
    redirectUri: texto(env.DISCORD_REDIRECT_URI)
  };
}

function validarConfigConectar(config = {}) {
  return Boolean(config.clientId && config.redirectUri);
}

function validarConfigCallback(config = {}) {
  return Boolean(config.clientId && config.clientSecret && config.botToken && config.redirectUri);
}

function segredoState(secret = "") {
  return texto(secret) || texto(process.env.JWT_SECRET) || "segredo";
}

function criarStateDiscord({ clienteId = "", jwt, secret = "", now = Date.now } = {}) {
  if (!jwt || typeof jwt.sign !== "function") throw new Error("discord_state_jwt_indisponivel");
  const nonce = crypto.randomBytes(12).toString("hex");
  const payload = {
    tipo: "discord_oauth",
    clienteId: texto(clienteId),
    nonce,
    criadoEm: new Date(now()).toISOString()
  };
  return {
    token: jwt.sign(payload, segredoState(secret), { expiresIn: STATE_TTL }),
    nonce,
    criadoEm: payload.criadoEm,
    expiraEm: new Date(Date.parse(payload.criadoEm) + STATE_TTL_MS).toISOString()
  };
}

function validarStateDiscord(state = "", { jwt, secret = "" } = {}) {
  if (!jwt || typeof jwt.verify !== "function") throw new Error("discord_state_jwt_indisponivel");
  const decoded = jwt.verify(texto(state), segredoState(secret));
  if (!decoded || decoded.tipo !== "discord_oauth" || !texto(decoded.clienteId)) {
    const erro = new Error("discord_state_invalido");
    erro.codigo = "discord_state_invalido";
    throw erro;
  }
  return {
    clienteId: texto(decoded.clienteId),
    nonce: texto(decoded.nonce),
    criadoEm: texto(decoded.criadoEm)
  };
}

function criarUrlConexaoDiscord({ clienteId = "", env = process.env, jwt, secret = "", registrarStateDiscordOAuth } = {}) {
  const config = obterConfigDiscord(env);
  if (!validarConfigConectar(config)) {
    const erro = new Error("discord_config_incompleta");
    erro.codigo = "discord_config_incompleta";
    throw erro;
  }

  if (typeof registrarStateDiscordOAuth !== "function") {
    const erro = new Error("discord_state_storage_indisponivel");
    erro.codigo = "discord_state_storage_indisponivel";
    throw erro;
  }

  const state = criarStateDiscord({ clienteId, jwt, secret });
  registrarStateDiscordOAuth(clienteId, {
    nonce: state.nonce,
    criadoEm: state.criadoEm,
    expiraEm: state.expiraEm,
    ttlMs: STATE_TTL_MS
  });

  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: DISCORD_SCOPE,
    permissions: DISCORD_PERMISSIONS,
    state: state.token,
    prompt: "consent"
  });

  return {
    ok: true,
    url: `${DISCORD_AUTHORIZE_URL}?${params.toString()}`,
    state: state.token,
    nonce: state.nonce
  };
}

async function trocarCodigoDiscord({ code = "", config = {}, httpClient } = {}) {
  if (!texto(code)) throw new Error("discord_code_ausente");
  if (!httpClient || typeof httpClient.post !== "function") throw new Error("discord_http_indisponivel");

  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: "authorization_code",
    code: texto(code),
    redirect_uri: config.redirectUri
  });

  const resposta = await httpClient.post(`${DISCORD_API_BASE}/oauth2/token`, body.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" }
  });

  return resposta?.data || {};
}

async function buscarGuildDiscord({ guildId = "", config = {}, httpClient } = {}) {
  if (!texto(guildId)) throw new Error("discord_guild_id_ausente");
  if (!httpClient || typeof httpClient.get !== "function") throw new Error("discord_http_indisponivel");

  const resposta = await httpClient.get(`${DISCORD_API_BASE}/guilds/${encodeURIComponent(texto(guildId))}`, {
    headers: { Authorization: `Bot ${config.botToken}` }
  });

  const guild = resposta?.data || {};
  if (!texto(guild.id)) throw new Error("discord_guild_inacessivel");
  return guild;
}

function guildIconUrl(guild = {}) {
  const guildId = texto(guild.id);
  const icon = texto(guild.icon);
  if (!guildId || !icon) return "";
  return `https://cdn.discordapp.com/icons/${encodeURIComponent(guildId)}/${encodeURIComponent(icon)}.png`;
}

function guildDoTokenOAuth(tokenData = {}) {
  const guild = tokenData?.guild || {};
  if (!texto(guild.id)) {
    const erro = new Error("discord_guild_nao_comprovada_no_oauth");
    erro.codigo = "discord_guild_nao_comprovada_no_oauth";
    throw erro;
  }
  return guild;
}

async function processarCallbackDiscord({
  query = {},
  env = process.env,
  jwt,
  secret = "",
  httpClient,
  salvarConexaoDiscord,
  consumirStateDiscordOAuth
} = {}) {
  const config = obterConfigDiscord(env);
  if (!validarConfigCallback(config)) {
    const erro = new Error("discord_config_incompleta");
    erro.codigo = "discord_config_incompleta";
    throw erro;
  }

  const state = validarStateDiscord(query.state, { jwt, secret });
  const code = texto(query.code);
  if (!code) throw new Error("discord_code_ausente");

  if (typeof consumirStateDiscordOAuth !== "function") {
    throw new Error("discord_state_storage_indisponivel");
  }

  consumirStateDiscordOAuth(state.clienteId, state.nonce);

  const tokenData = await trocarCodigoDiscord({ code, config, httpClient });
  const guildAutorizada = guildDoTokenOAuth(tokenData);
  const guild = await buscarGuildDiscord({ guildId: guildAutorizada.id, config, httpClient });

  if (texto(guild.id) !== texto(guildAutorizada.id)) {
    throw new Error("discord_guild_divergente");
  }

  if (typeof salvarConexaoDiscord !== "function") {
    throw new Error("discord_storage_indisponivel");
  }

  return salvarConexaoDiscord(state.clienteId, {
    guildId: guild.id,
    guildName: guild.name,
    guildIcon: guildIconUrl(guild),
    ativo: true
  });
}

module.exports = {
  DISCORD_AUTHORIZE_URL,
  DISCORD_API_BASE,
  DISCORD_SCOPE,
  DISCORD_PERMISSIONS,
  STATE_TTL_MS,
  obterConfigDiscord,
  criarStateDiscord,
  validarStateDiscord,
  criarUrlConexaoDiscord,
  trocarCodigoDiscord,
  buscarGuildDiscord,
  guildDoTokenOAuth,
  processarCallbackDiscord
};
