const {
  readClienteJson,
  writeClienteJson,
  normalizarClienteId
} = require("../../utils/storage");

const ARQUIVO_CONEXOES_DISCORD = "discord-conexoes.json";

function texto(valor = "") {
  return String(valor ?? "").trim();
}

function agoraIso() {
  return new Date().toISOString();
}

function resolverDeps(deps = {}) {
  return {
    readClienteJson: deps.readClienteJson || readClienteJson,
    writeClienteJson: deps.writeClienteJson || writeClienteJson,
    normalizarClienteId: deps.normalizarClienteId || normalizarClienteId,
    now: deps.now || agoraIso
  };
}

function idConexaoDiscord(guildId = "") {
  const id = texto(guildId).replace(/[^a-zA-Z0-9_-]/g, "");
  return id ? `discord_${id}` : "";
}

function sanitizarConexaoDiscord(conexao = {}) {
  const guildId = texto(conexao.guildId);
  const ativo = conexao.ativo !== false;
  const motivoIndisponivel = !ativo
    ? "Conexao Discord desativada"
    : !guildId
      ? "Servidor Discord nao identificado"
      : "";

  return {
    id: texto(conexao.id) || idConexaoDiscord(guildId),
    tipo: "discord",
    guildId,
    guildName: texto(conexao.guildName),
    guildIcon: texto(conexao.guildIcon),
    ativo,
    conectadoEm: texto(conexao.conectadoEm),
    atualizadoEm: texto(conexao.atualizadoEm),
    utilizavel: Boolean(ativo && guildId && !motivoIndisponivel),
    motivoIndisponivel
  };
}

function normalizarConexaoDiscord(conexao = {}, contexto = {}) {
  const guildId = texto(conexao.guildId || conexao.id);
  const agora = texto(contexto.now) || agoraIso();
  return {
    id: texto(conexao.id) || idConexaoDiscord(guildId),
    tipo: "discord",
    guildId,
    guildName: texto(conexao.guildName || conexao.name || "Servidor Discord"),
    guildIcon: texto(conexao.guildIcon || conexao.icon),
    ativo: conexao.ativo !== false,
    conectadoEm: texto(conexao.conectadoEm) || agora,
    atualizadoEm: texto(conexao.atualizadoEm) || agora
  };
}

function lerConexoesDiscord(clienteId = "admin", deps = {}) {
  const storage = resolverDeps(deps);
  const id = storage.normalizarClienteId(clienteId || "admin");
  const dados = storage.readClienteJson(id, ARQUIVO_CONEXOES_DISCORD, []);
  return Array.isArray(dados) ? dados : [];
}

function salvarListaDiscord(clienteId = "admin", lista = [], deps = {}) {
  const storage = resolverDeps(deps);
  const id = storage.normalizarClienteId(clienteId || "admin");
  const normalizada = Array.isArray(lista)
    ? lista.map((item) => normalizarConexaoDiscord(item, { now: item?.atualizadoEm || storage.now() }))
    : [];
  storage.writeClienteJson(id, ARQUIVO_CONEXOES_DISCORD, normalizada);
  return normalizada;
}

function listarConexoesDiscord(clienteId = "admin", deps = {}) {
  return lerConexoesDiscord(clienteId, deps).map(sanitizarConexaoDiscord);
}

function salvarConexaoDiscord(clienteId = "admin", conexao = {}, deps = {}) {
  const storage = resolverDeps(deps);
  const id = storage.normalizarClienteId(clienteId || "admin");
  const agora = storage.now();
  const nova = normalizarConexaoDiscord(conexao, { now: agora });
  if (!nova.guildId) return null;

  const lista = lerConexoesDiscord(id, deps);
  const index = lista.findIndex((item) =>
    texto(item.guildId) === nova.guildId ||
    texto(item.id) === nova.id
  );

  const persistida = {
    ...(index >= 0 ? lista[index] : {}),
    ...nova,
    conectadoEm: index >= 0 ? texto(lista[index].conectadoEm) || nova.conectadoEm : nova.conectadoEm,
    atualizadoEm: agora,
    ativo: true
  };

  const proxima = index >= 0
    ? lista.map((item, i) => (i === index ? persistida : item))
    : [persistida, ...lista];

  salvarListaDiscord(id, proxima, deps);
  return sanitizarConexaoDiscord(persistida);
}

function desconectarConexaoDiscord(clienteId = "admin", conexaoId = "", deps = {}) {
  const storage = resolverDeps(deps);
  const id = storage.normalizarClienteId(clienteId || "admin");
  const alvo = texto(conexaoId);
  if (!alvo) return null;

  const lista = lerConexoesDiscord(id, deps);
  const index = lista.findIndex((item) =>
    texto(item.id) === alvo ||
    texto(item.guildId) === alvo
  );
  if (index < 0) return null;

  const agora = storage.now();
  const atualizada = {
    ...lista[index],
    ativo: false,
    atualizadoEm: agora
  };
  const proxima = lista.map((item, i) => (i === index ? atualizada : item));
  salvarListaDiscord(id, proxima, deps);
  return sanitizarConexaoDiscord(atualizada);
}

module.exports = {
  ARQUIVO_CONEXOES_DISCORD,
  idConexaoDiscord,
  sanitizarConexaoDiscord,
  normalizarConexaoDiscord,
  listarConexoesDiscord,
  salvarConexaoDiscord,
  desconectarConexaoDiscord
};
