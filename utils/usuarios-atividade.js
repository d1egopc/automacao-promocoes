const { readGlobalJson } = require("./storage");

const LOG_INATIVO_COOLDOWN_MS = Number(process.env.USUARIO_INATIVO_LOG_COOLDOWN_MS || 5 * 60 * 1000);
const logsInativosRecentes = new Map();

function texto(valor = "") {
  return String(valor ?? "").trim();
}

function carregarUsuariosFonte(opcoes = {}) {
  if (Array.isArray(opcoes.usuarios)) return opcoes.usuarios;
  const usuarios = readGlobalJson("usuarios.json", []);
  return Array.isArray(usuarios) ? usuarios : [];
}

function buscarUsuario(clienteId = "", opcoes = {}) {
  const id = texto(clienteId);
  if (!id) return null;
  return carregarUsuariosFonte(opcoes).find(usuario => texto(usuario?.id) === id) || null;
}

function usuarioAtivo(clienteId = "", opcoes = {}) {
  const usuario = buscarUsuario(clienteId, opcoes);
  if (!usuario) return false;
  return usuario.ativo !== false;
}

function listarClientesAtivos(opcoes = {}) {
  const vistos = new Set();
  const ids = [];

  for (const usuario of carregarUsuariosFonte(opcoes)) {
    const id = texto(usuario?.id);
    if (!id || vistos.has(id)) continue;
    if (usuario.ativo === false) continue;
    vistos.add(id);
    ids.push(id);
  }

  return ids;
}

function logUsuarioInativoIgnorado({ clienteId = "", fluxo = "", timestamp = new Date().toISOString() } = {}) {
  const id = texto(clienteId);
  if (!id) return false;

  const nomeFluxo = texto(fluxo) || "desconhecido";
  const chave = `${id}:${nomeFluxo}`;
  const agora = Date.now();
  const ultimo = logsInativosRecentes.get(chave) || 0;

  if (agora - ultimo < LOG_INATIVO_COOLDOWN_MS) return false;
  logsInativosRecentes.set(chave, agora);

  console.log("[USUARIO-INATIVO-IGNORADO]", JSON.stringify({
    clienteId: id,
    fluxo: nomeFluxo,
    timestamp
  }));

  return true;
}

module.exports = {
  usuarioAtivo,
  listarClientesAtivos,
  logUsuarioInativoIgnorado
};
