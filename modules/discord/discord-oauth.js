const crypto = require("crypto");
const { getPlatformVariable } = require("../platform-variables");

const DISCORD_AUTHORIZE_URL = "https://discord.com/oauth2/authorize";
const DISCORD_API_BASE = "https://discord.com/api/v10";
const DISCORD_SCOPE = "bot identify";
const DISCORD_PERMISSIONS = String(1024 + 2048 + 16384 + 32768);
const STATE_TTL = "10m";
const STATE_TTL_MS = 10 * 60 * 1000;
const DISCORD_CLIENT_ID = "DISCORD_CLIENT_ID";
const DISCORD_CLIENT_SECRET = "DISCORD_CLIENT_SECRET";
const DISCORD_BOT_TOKEN = "DISCORD_BOT_TOKEN";
const DISCORD_REDIRECT_URI = "DISCORD_REDIRECT_URI";
const DISCORD_IMAGE_ALLOWED_HOSTS = "DISCORD_IMAGE_ALLOWED_HOSTS";
const DISCORD_VARIAVEIS = new Set([
  DISCORD_CLIENT_ID,
  DISCORD_CLIENT_SECRET,
  DISCORD_BOT_TOKEN,
  DISCORD_REDIRECT_URI,
  DISCORD_IMAGE_ALLOWED_HOSTS
]);

function texto(valor = "") {
  return String(valor ?? "").trim();
}

function validarRedirectUriDiscord(valor = "") {
  const uri = texto(valor);
  if (!uri) return "";
  try {
    const url = new URL(uri);
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function obterConfigDiscord(env = process.env) {
  return {
    clientId: texto(env.DISCORD_CLIENT_ID),
    clientSecret: texto(env.DISCORD_CLIENT_SECRET),
    botToken: texto(env.DISCORD_BOT_TOKEN),
    redirectUri: validarRedirectUriDiscord(env.DISCORD_REDIRECT_URI),
    imageAllowedHosts: texto(env.DISCORD_IMAGE_ALLOWED_HOSTS)
  };
}

async function obterPlatformVariableDiscord(nome, {
  env = process.env,
  getPlatformVariableImpl = getPlatformVariable,
  defaultValue = ""
} = {}) {
  if (!DISCORD_VARIAVEIS.has(nome)) {
    throw new Error("discord_platform_variable_nao_homologada");
  }
  try {
    const resultado = await getPlatformVariableImpl(nome, {
      envFallback: true,
      defaultValue
    });
    if (resultado?.ok === true) return resultado.value;
  } catch {
    // Mantem compatibilidade temporaria com ENV quando a central estiver indisponivel.
  }
  if (Object.prototype.hasOwnProperty.call(env, nome)) return env[nome];
  return defaultValue;
}

async function obterConfigDiscordAsync({
  env = process.env,
  getPlatformVariableImpl = getPlatformVariable
} = {}) {
  const [
    clientId,
    clientSecret,
    botToken,
    redirectUri,
    imageAllowedHosts
  ] = await Promise.all([
    obterPlatformVariableDiscord(DISCORD_CLIENT_ID, { env, getPlatformVariableImpl }),
    obterPlatformVariableDiscord(DISCORD_CLIENT_SECRET, { env, getPlatformVariableImpl }),
    obterPlatformVariableDiscord(DISCORD_BOT_TOKEN, { env, getPlatformVariableImpl }),
    obterPlatformVariableDiscord(DISCORD_REDIRECT_URI, { env, getPlatformVariableImpl }),
    obterPlatformVariableDiscord(DISCORD_IMAGE_ALLOWED_HOSTS, { env, getPlatformVariableImpl })
  ]);
  return {
    clientId: texto(clientId),
    clientSecret: texto(clientSecret),
    botToken: texto(botToken),
    redirectUri: validarRedirectUriDiscord(redirectUri),
    imageAllowedHosts: texto(imageAllowedHosts)
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

function criarUrlConexaoDiscordComConfig({ clienteId = "", config = {}, jwt, secret = "", registrarStateDiscordOAuth } = {}) {
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

function criarUrlConexaoDiscord({ clienteId = "", env = process.env, jwt, secret = "", registrarStateDiscordOAuth } = {}) {
  return criarUrlConexaoDiscordComConfig({
    clienteId,
    config: obterConfigDiscord(env),
    jwt,
    secret,
    registrarStateDiscordOAuth
  });
}

async function criarUrlConexaoDiscordAsync({
  clienteId = "",
  env = process.env,
  jwt,
  secret = "",
  registrarStateDiscordOAuth,
  getPlatformVariableImpl = getPlatformVariable
} = {}) {
  const config = await obterConfigDiscordAsync({ env, getPlatformVariableImpl });
  return criarUrlConexaoDiscordComConfig({
    clienteId,
    config,
    jwt,
    secret,
    registrarStateDiscordOAuth
  });
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
  consumirStateDiscordOAuth,
  getPlatformVariableImpl = getPlatformVariable
} = {}) {
  const config = await obterConfigDiscordAsync({ env, getPlatformVariableImpl });
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
  obterConfigDiscordAsync,
  criarStateDiscord,
  validarStateDiscord,
  criarUrlConexaoDiscord,
  criarUrlConexaoDiscordAsync,
  trocarCodigoDiscord,
  buscarGuildDiscord,
  guildDoTokenOAuth,
  processarCallbackDiscord
};
