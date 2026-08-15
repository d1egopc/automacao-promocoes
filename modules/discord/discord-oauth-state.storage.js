const {
  readClienteJson,
  writeClienteJson,
  normalizarClienteId
} = require("../../utils/storage");

const ARQUIVO_STATES_DISCORD = "discord-oauth-states.json";

function texto(valor = "") {
  return String(valor ?? "").trim();
}

function agoraMs(now = Date.now) {
  const valor = typeof now === "function" ? now() : now;
  const data = valor instanceof Date ? valor : new Date(valor);
  const ms = data.getTime();
  return Number.isFinite(ms) ? ms : Date.now();
}

function iso(ms) {
  return new Date(ms).toISOString();
}

function resolverDeps(deps = {}) {
  return {
    readClienteJson: deps.readClienteJson || readClienteJson,
    writeClienteJson: deps.writeClienteJson || writeClienteJson,
    normalizarClienteId: deps.normalizarClienteId || normalizarClienteId,
    now: deps.now || Date.now
  };
}

function normalizarState(item = {}) {
  return {
    nonce: texto(item.nonce),
    clienteId: texto(item.clienteId),
    criadoEm: texto(item.criadoEm),
    expiraEm: texto(item.expiraEm),
    consumidoEm: texto(item.consumidoEm)
  };
}

function lerStates(clienteId = "admin", deps = {}) {
  const storage = resolverDeps(deps);
  const id = storage.normalizarClienteId(clienteId || "admin");
  const dados = storage.readClienteJson(id, ARQUIVO_STATES_DISCORD, []);
  return Array.isArray(dados) ? dados.map(normalizarState).filter((item) => item.nonce) : [];
}

function salvarStates(clienteId = "admin", lista = [], deps = {}) {
  const storage = resolverDeps(deps);
  const id = storage.normalizarClienteId(clienteId || "admin");
  const segura = Array.isArray(lista)
    ? lista.map(normalizarState).filter((item) => item.nonce)
    : [];
  storage.writeClienteJson(id, ARQUIVO_STATES_DISCORD, segura);
  return segura;
}

function limparExpirados(lista = [], agora = Date.now()) {
  return lista.filter((item) => {
    const expiracao = Date.parse(item.expiraEm);
    if (!Number.isFinite(expiracao)) return false;
    if (item.consumidoEm) return false;
    return expiracao > agora;
  });
}

function registrarStateDiscordOAuth(clienteId = "admin", dados = {}, deps = {}) {
  const storage = resolverDeps(deps);
  const id = storage.normalizarClienteId(clienteId || dados.clienteId || "admin");
  const nonce = texto(dados.nonce);
  if (!nonce) throw new Error("discord_state_nonce_ausente");

  const agora = agoraMs(storage.now);
  const ttlMs = Number.isFinite(Number(dados.ttlMs)) ? Number(dados.ttlMs) : 10 * 60 * 1000;
  const registro = normalizarState({
    nonce,
    clienteId: id,
    criadoEm: texto(dados.criadoEm) || iso(agora),
    expiraEm: texto(dados.expiraEm) || iso(agora + ttlMs),
    consumidoEm: ""
  });

  const lista = limparExpirados(lerStates(id, deps), agora).filter((item) => item.nonce !== nonce);
  salvarStates(id, [registro, ...lista], deps);
  return registro;
}

function consumirStateDiscordOAuth(clienteId = "admin", nonce = "", deps = {}) {
  const storage = resolverDeps(deps);
  const id = storage.normalizarClienteId(clienteId || "admin");
  const alvo = texto(nonce);
  if (!alvo) {
    const erro = new Error("discord_state_nonce_ausente");
    erro.codigo = "discord_state_nonce_ausente";
    throw erro;
  }

  const agora = agoraMs(storage.now);
  const lista = lerStates(id, deps);
  const index = lista.findIndex((item) => item.nonce === alvo);
  if (index < 0) {
    const erro = new Error("discord_state_nonce_inexistente");
    erro.codigo = "discord_state_nonce_inexistente";
    throw erro;
  }

  const registro = lista[index];
  if (registro.clienteId !== id) {
    const erro = new Error("discord_state_workspace_divergente");
    erro.codigo = "discord_state_workspace_divergente";
    throw erro;
  }

  if (registro.consumidoEm) {
    const erro = new Error("discord_state_reutilizado");
    erro.codigo = "discord_state_reutilizado";
    throw erro;
  }

  const expiracao = Date.parse(registro.expiraEm);
  if (!Number.isFinite(expiracao) || expiracao <= agora) {
    const erro = new Error("discord_state_expirado");
    erro.codigo = "discord_state_expirado";
    throw erro;
  }

  const consumido = { ...registro, consumidoEm: iso(agora) };
  const proxima = lista.map((item, i) => (i === index ? consumido : item));
  salvarStates(id, proxima, deps);
  return consumido;
}

module.exports = {
  ARQUIVO_STATES_DISCORD,
  registrarStateDiscordOAuth,
  consumirStateDiscordOAuth,
  lerStates,
  limparExpirados
};
