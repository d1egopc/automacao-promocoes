const {
  readClienteJson,
  writeClienteJson,
  normalizarClienteId
} = require("../../utils/storage");
const {
  normalizarOfertaManualV2,
  STATUS_INICIAL_MANUAL_V2,
  normalizarStatusManualV2
} = require("./manual-offers.contract");

const ARQUIVO_OFERTAS_MANUAL_V2 = "manual_ofertas_v2.json";

function agoraIso() {
  return new Date().toISOString();
}

function texto(valor = "") {
  return String(valor ?? "").trim();
}

function inteiro(valor = 0) {
  const numero = Number(valor);
  return Number.isFinite(numero) && numero > 0 ? Math.floor(numero) : 0;
}

function lista(valor) {
  return Array.isArray(valor) ? valor : [];
}

function sanitizarDestinoEscolhido(destino = {}) {
  return {
    id: texto(destino.id || destino.destinoId),
    nome: texto(destino.nome),
    tipo: texto(destino.tipo).toLowerCase() === "telegram" ? "telegram" : "whatsapp",
    ativo: destino.ativo !== false,
    utilizavel: destino.utilizavel === true,
    motivoIndisponivel: texto(destino.motivoIndisponivel),
    identificacaoVisual: texto(destino.identificacaoVisual)
  };
}

function sanitizarResultadoEnvio(resultado = {}) {
  const status = texto(resultado.status).toLowerCase() === "enviado" ? "enviado" : "erro";
  return {
    destinoId: texto(resultado.destinoId),
    nome: texto(resultado.nome),
    tipo: texto(resultado.tipo).toLowerCase() === "telegram" ? "telegram" : "whatsapp",
    status,
    enviadoEm: texto(resultado.enviadoEm),
    erro: status === "erro" ? texto(resultado.erro).slice(0, 500) : ""
  };
}

function sanitizarEnvioManual(envioManual = {}) {
  return {
    solicitadoEm: texto(envioManual.solicitadoEm),
    concluidoEm: texto(envioManual.concluidoEm),
    destinosEscolhidos: lista(envioManual.destinosEscolhidos)
      .map(sanitizarDestinoEscolhido)
      .filter((destino) => destino.id),
    resultados: lista(envioManual.resultados)
      .map(sanitizarResultadoEnvio)
      .filter((resultado) => resultado.destinoId || resultado.erro),
    enviados: inteiro(envioManual.enviados),
    erros: inteiro(envioManual.erros),
    creditosDebitados: inteiro(envioManual.creditosDebitados),
    erroResumo: texto(envioManual.erroResumo).slice(0, 1000)
  };
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

function atualizarMetadadosEnvioManualV2(clienteId = "admin", ofertaId = "", metadados = {}, deps = {}) {
  const storage = resolverDepsStorage(deps);
  const id = storage.normalizarClienteId(clienteId || "admin");
  const alvoId = String(ofertaId || "").trim();
  if (!alvoId) return null;

  const listaOfertas = lerListaCliente(id, deps);
  const index = listaOfertas.findIndex((oferta) => String(oferta.id || "") === alvoId);
  if (index < 0) return null;

  const existente = listaOfertas[index];
  const agora = storage.now();
  const proximaOferta = {
    ...existente,
    clienteId: id,
    status: normalizarStatusManualV2(metadados.status || existente.status),
    atualizadoEm: agora
  };

  if (Object.prototype.hasOwnProperty.call(metadados, "enviadoEm")) {
    const enviadoEm = texto(metadados.enviadoEm);
    if (enviadoEm) {
      proximaOferta.enviadoEm = enviadoEm;
    } else {
      delete proximaOferta.enviadoEm;
    }
  }

  if (metadados.envioManual && typeof metadados.envioManual === "object") {
    proximaOferta.envioManual = sanitizarEnvioManual(metadados.envioManual);
  }

  const proximaLista = [...listaOfertas];
  proximaLista[index] = proximaOferta;
  salvarListaCliente(id, proximaLista, deps);
  return proximaOferta;
}

module.exports = {
  ARQUIVO_OFERTAS_MANUAL_V2,
  listarOfertasManuaisV2,
  buscarOfertaManualV2,
  criarOfertaManualV2,
  atualizarOfertaManualV2,
  excluirOfertaManualV2,
  atualizarMetadadosEnvioManualV2
};
