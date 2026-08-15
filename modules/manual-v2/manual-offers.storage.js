const {
  readClienteJson,
  writeClienteJson,
  normalizarClienteId
} = require("../../utils/storage");
const {
  normalizarOfertaManualV2,
  STATUS_INICIAL_MANUAL_V2
} = require("./manual-offers.contract");

const ARQUIVO_OFERTAS_MANUAL_V2 = "manual_ofertas_v2.json";

function agoraIso() {
  return new Date().toISOString();
}

function resolverDepsStorage(deps = {}) {
  return {
    readClienteJson: deps.readClienteJson || readClienteJson,
    writeClienteJson: deps.writeClienteJson || writeClienteJson,
    normalizarClienteId: deps.normalizarClienteId || normalizarClienteId,
    now: deps.now || agoraIso,
    idFactory: deps.idFactory
  };
}

function lerListaCliente(clienteId = "admin", deps = {}) {
  const storage = resolverDepsStorage(deps);
  const id = storage.normalizarClienteId(clienteId || "admin");
  const dados = storage.readClienteJson(id, ARQUIVO_OFERTAS_MANUAL_V2, []);
  const lista = Array.isArray(dados) ? dados : [];

  return lista.filter((oferta) =>
    oferta &&
    typeof oferta === "object" &&
    String(oferta.clienteId || "") === String(id)
  );
}

function salvarListaCliente(clienteId = "admin", lista = [], deps = {}) {
  const storage = resolverDepsStorage(deps);
  const id = storage.normalizarClienteId(clienteId || "admin");
  const normalizada = Array.isArray(lista)
    ? lista.map((oferta) => ({ ...oferta, clienteId: id }))
    : [];

  storage.writeClienteJson(id, ARQUIVO_OFERTAS_MANUAL_V2, normalizada);
  return normalizada;
}

function listarOfertasManuaisV2(clienteId = "admin", deps = {}) {
  return lerListaCliente(clienteId, deps);
}

function buscarOfertaManualV2(clienteId = "admin", ofertaId = "", deps = {}) {
  const id = String(ofertaId || "").trim();
  if (!id) return null;

  return listarOfertasManuaisV2(clienteId, deps)
    .find((oferta) => String(oferta.id || "") === id) || null;
}

function criarOfertaManualV2(clienteId = "admin", entrada = {}, deps = {}) {
  const storage = resolverDepsStorage(deps);
  const id = storage.normalizarClienteId(clienteId || "admin");
  const agora = storage.now();
  const lista = lerListaCliente(id, deps);
  const oferta = normalizarOfertaManualV2(
    {
      ...entrada,
      status: STATUS_INICIAL_MANUAL_V2
    },
    {
      clienteId: id,
      now: agora,
      idFactory: storage.idFactory
    }
  );

  oferta.status = STATUS_INICIAL_MANUAL_V2;
  oferta.clienteId = id;
  oferta.criadoEm = oferta.criadoEm || agora;
  oferta.atualizadoEm = agora;

  salvarListaCliente(id, [oferta, ...lista], deps);
  return oferta;
}

function atualizarOfertaManualV2(clienteId = "admin", ofertaId = "", alteracoes = {}, deps = {}) {
  const storage = resolverDepsStorage(deps);
  const id = storage.normalizarClienteId(clienteId || "admin");
  const alvoId = String(ofertaId || "").trim();
  if (!alvoId) return null;

  const lista = lerListaCliente(id, deps);
  const index = lista.findIndex((oferta) => String(oferta.id || "") === alvoId);
  if (index < 0) return null;

  const existente = lista[index];
  const agora = storage.now();
  const normalizada = normalizarOfertaManualV2(
    {
      ...existente,
      ...alteracoes,
      id: existente.id,
      clienteId: id,
      criadoEm: existente.criadoEm,
      atualizadoEm: agora
    },
    {
      clienteId: id,
      now: agora,
      idFactory: () => existente.id
    }
  );

  normalizada.id = existente.id;
  normalizada.clienteId = id;
  normalizada.criadoEm = existente.criadoEm;
  normalizada.atualizadoEm = agora;

  const proxima = [...lista];
  proxima[index] = normalizada;
  salvarListaCliente(id, proxima, deps);
  return normalizada;
}

function excluirOfertaManualV2(clienteId = "admin", ofertaId = "", deps = {}) {
  const id = resolverDepsStorage(deps).normalizarClienteId(clienteId || "admin");
  const alvoId = String(ofertaId || "").trim();
  if (!alvoId) return false;

  const lista = lerListaCliente(id, deps);
  const proxima = lista.filter((oferta) => String(oferta.id || "") !== alvoId);
  if (proxima.length === lista.length) return false;

  salvarListaCliente(id, proxima, deps);
  return true;
}

module.exports = {
  ARQUIVO_OFERTAS_MANUAL_V2,
  listarOfertasManuaisV2,
  buscarOfertaManualV2,
  criarOfertaManualV2,
  atualizarOfertaManualV2,
  excluirOfertaManualV2
};
