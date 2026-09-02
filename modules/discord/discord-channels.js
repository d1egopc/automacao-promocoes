const { obterConfigDiscordAsync, DISCORD_API_BASE } = require("./discord-oauth");

const CANAL_TEXTO_GUILD = 0;
const CANAL_ANUNCIO_GUILD = 5;
const TIPOS_COMPATIVEIS = new Set([CANAL_TEXTO_GUILD, CANAL_ANUNCIO_GUILD]);

const PERMISSAO_VIEW_CHANNEL = 1024n;
const PERMISSAO_SEND_MESSAGES = 2048n;
const PERMISSAO_ADMINISTRATOR = 8n;

function texto(valor = "") {
  return String(valor ?? "").trim();
}

function bitfield(valor = 0) {
  try {
    return BigInt(String(valor || 0));
  } catch {
    return 0n;
  }
}

function possui(permissoes, bit) {
  return (permissoes & bit) === bit;
}

function tipoCanal(raw = {}) {
  const tipo = Number(raw.type);
  return Number.isFinite(tipo) ? tipo : -1;
}

function tipoCanalLabel(tipo) {
  if (tipo === CANAL_TEXTO_GUILD) return "texto";
  if (tipo === CANAL_ANUNCIO_GUILD) return "anuncio";
  return "incompativel";
}

function canalCompativel(raw = {}) {
  return TIPOS_COMPATIVEIS.has(tipoCanal(raw));
}

function sanitizarCanalDiscord(raw = {}, contexto = {}) {
  const tipo = tipoCanal(raw);
  const id = texto(raw.id);
  const nome = texto(raw.name);
  const compativel = canalCompativel(raw);
  const permissoes = contexto.permissoes;
  const view = contexto.view !== undefined ? contexto.view === true : true;
  const send = contexto.send !== undefined ? contexto.send === true : true;

  const motivoIndisponivel = !id
    ? "Canal Discord sem identificador"
    : !compativel
      ? "Tipo de canal Discord indisponivel"
      : !view
        ? "Bot sem permissao para visualizar o canal"
        : !send
          ? "Bot sem permissao para enviar mensagens"
          : "";

  return {
    id,
    nome: nome || id,
    tipo: tipoCanalLabel(tipo),
    utilizavel: Boolean(id && compativel && view && send && !motivoIndisponivel),
    motivoIndisponivel,
    _permissoes: permissoes
  };
}

async function discordGet(httpClient, caminho, config) {
  if (!httpClient || typeof httpClient.get !== "function") throw new Error("discord_http_indisponivel");
  const resposta = await httpClient.get(`${DISCORD_API_BASE}${caminho}`, {
    headers: { Authorization: `Bot ${config.botToken}` }
  });
  return resposta?.data;
}

async function obterBotId({ httpClient, config }) {
  const usuario = await discordGet(httpClient, "/users/@me", config);
  return texto(usuario?.id);
}

async function listarCanaisBrutos({ guildId = "", httpClient, config }) {
  const id = texto(guildId);
  if (!id) throw new Error("discord_guild_id_ausente");
  const canais = await discordGet(httpClient, `/guilds/${encodeURIComponent(id)}/channels`, config);
  return Array.isArray(canais) ? canais : [];
}

async function buscarMembroBot({ guildId = "", botId = "", httpClient, config }) {
  const id = texto(guildId);
  const bot = texto(botId);
  if (!id || !bot) return null;
  try {
    return await discordGet(httpClient, `/guilds/${encodeURIComponent(id)}/members/${encodeURIComponent(bot)}`, config);
  } catch {
    return null;
  }
}

async function listarRolesGuild({ guildId = "", httpClient, config }) {
  const id = texto(guildId);
  if (!id) return [];
  try {
    const roles = await discordGet(httpClient, `/guilds/${encodeURIComponent(id)}/roles`, config);
    return Array.isArray(roles) ? roles : [];
  } catch {
    return [];
  }
}

function permissoesBaseGuild({ guildId = "", membro = {}, roles = [] } = {}) {
  const roleIds = new Set([texto(guildId), ...((Array.isArray(membro?.roles) ? membro.roles : []).map(texto))].filter(Boolean));
  let permissoes = 0n;

  for (const role of roles) {
    if (roleIds.has(texto(role.id))) {
      permissoes |= bitfield(role.permissions);
    }
  }

  return permissoes;
}

function aplicarOverwrite(permissoes, overwrite = {}) {
  const deny = bitfield(overwrite.deny);
  const allow = bitfield(overwrite.allow);
  return (permissoes & ~deny) | allow;
}

function permissoesEfetivasCanal({ guildId = "", botId = "", membro = {}, roles = [], canal = {} } = {}) {
  let permissoes = permissoesBaseGuild({ guildId, membro, roles });
  if (possui(permissoes, PERMISSAO_ADMINISTRATOR)) return permissoes;

  const overwrites = Array.isArray(canal.permission_overwrites) ? canal.permission_overwrites : [];
  const everyone = overwrites.find((item) => texto(item.id) === texto(guildId));
  if (everyone) permissoes = aplicarOverwrite(permissoes, everyone);

  let denyRoles = 0n;
  let allowRoles = 0n;
  const rolesMembro = new Set((Array.isArray(membro?.roles) ? membro.roles : []).map(texto));
  for (const overwrite of overwrites) {
    if (Number(overwrite.type) === 0 && rolesMembro.has(texto(overwrite.id))) {
      denyRoles |= bitfield(overwrite.deny);
      allowRoles |= bitfield(overwrite.allow);
    }
  }
  permissoes = (permissoes & ~denyRoles) | allowRoles;

  const membroOverwrite = overwrites.find((item) => Number(item.type) === 1 && texto(item.id) === texto(botId));
  if (membroOverwrite) permissoes = aplicarOverwrite(permissoes, membroOverwrite);

  return permissoes;
}

async function listarCanaisDiscord({ guildId = "", env = process.env, httpClient, getPlatformVariableImpl } = {}) {
  const config = await obterConfigDiscordAsync({ env, getPlatformVariableImpl });
  if (!config.botToken) throw new Error("discord_bot_token_ausente");

  const canais = await listarCanaisBrutos({ guildId, httpClient, config });
  const botId = await obterBotId({ httpClient, config });
  const [membro, roles] = await Promise.all([
    buscarMembroBot({ guildId, botId, httpClient, config }),
    listarRolesGuild({ guildId, httpClient, config })
  ]);

  return canais
    .filter(canalCompativel)
    .map((canal) => {
      const permissoes = membro && roles.length
        ? permissoesEfetivasCanal({ guildId, botId, membro, roles, canal })
        : 0n;
      const semModeloPermissao = !membro || !roles.length;
      const view = semModeloPermissao ? false : possui(permissoes, PERMISSAO_VIEW_CHANNEL);
      const send = semModeloPermissao ? false : possui(permissoes, PERMISSAO_SEND_MESSAGES);
      const sanitizado = sanitizarCanalDiscord(canal, { permissoes, view, send });
      delete sanitizado._permissoes;
      return sanitizado;
    });
}

async function validarDestinoDiscord({ clienteId = "", destino = {}, conexoes = [], env = process.env, httpClient, getPlatformVariableImpl } = {}) {
  const conexaoId = texto(destino.conexaoId || destino.sessao || destino.idConexao);
  const channelId = texto(destino.channelId || destino.canalId || destino.grupo || destino.canal);
  const conexao = conexoes.find((item) => texto(item.id) === conexaoId);

  if (!conexao) throw new Error("discord_conexao_nao_encontrada");
  if (conexao.ativo === false) throw new Error("discord_conexao_inativa");
  if (!texto(conexao.guildId)) throw new Error("discord_guild_id_ausente");
  if (!channelId) throw new Error("discord_channel_id_ausente");

  const canais = await listarCanaisDiscord({ guildId: conexao.guildId, env, httpClient, getPlatformVariableImpl });
  const canal = canais.find((item) => item.id === channelId);
  if (!canal) throw new Error("discord_canal_nao_encontrado");
  if (!canal.utilizavel) throw new Error("discord_canal_indisponivel");

  return {
    ...destino,
    tipo: "discord",
    conexaoId: conexao.id,
    sessao: conexao.id,
    guildId: conexao.guildId,
    guildName: conexao.guildName,
    channelId: canal.id,
    canalId: canal.id,
    grupo: canal.id,
    channelName: canal.nome,
    grupoNome: canal.nome,
    telegramDestinos: [],
    gruposWhatsapp: [],
    botToken: undefined,
    token: undefined,
    chatId: undefined,
    clienteId
  };
}

module.exports = {
  CANAL_TEXTO_GUILD,
  CANAL_ANUNCIO_GUILD,
  PERMISSAO_VIEW_CHANNEL,
  PERMISSAO_SEND_MESSAGES,
  listarCanaisDiscord,
  sanitizarCanalDiscord,
  permissoesEfetivasCanal,
  validarDestinoDiscord
};
