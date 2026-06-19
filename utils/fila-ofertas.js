const fs = require("fs");
const path = require("path");

function getFallbackFileSeguro(getFilaFile, clienteId = "admin") {
  if (typeof getFilaFile !== "function") {
    throw new Error("storage_fila_nao_injetado");
  }

  const file = getFilaFile(clienteId);
  const base = path.resolve(process.env.DATA_DIR || "/data");
  const resolvido = path.resolve(file);

  if (!resolvido.startsWith(`${base}${path.sep}`)) {
    throw new Error("caminho_fila_inseguro");
  }

  return resolvido;
}

function salvarFila({ fila = [], clienteId = "admin", getFilaFile, writeClienteJson, logger = console } = {}) {
  try {
    const filaCliente = fila.filter(
      o => String(o.clienteId || "admin") === String(clienteId)
    );

    if (typeof writeClienteJson === "function") {
      writeClienteJson(clienteId, "fila.json", filaCliente);
      return true;
    }

    const file = getFallbackFileSeguro(getFilaFile, clienteId);

    fs.writeFileSync(
      file,
      JSON.stringify(filaCliente, null, 2)
    );

    return true;
  } catch (e) {
    logger.error("ERRO AO SALVAR FILA:", e.message);
    return false;
  }
}

function carregarFila({ fila = [], clienteId = "admin", getFilaFile, readClienteJson, logger = console } = {}) {
  try {
    let filaCliente;

    if (typeof readClienteJson === "function") {
      filaCliente = readClienteJson(clienteId, "fila.json", []);
    } else {
      const file = getFallbackFileSeguro(getFilaFile, clienteId);

      if (!fs.existsSync(file)) {
        return fila;
      }

      const data = fs.readFileSync(file, "utf8");

      if (!data) {
        return fila;
      }

      filaCliente = JSON.parse(data);
    }

    const filaLimpa = filaCliente.filter(
      o => o?.clienteId
    );

    const filaSemCliente = fila.filter(
      o => String(o.clienteId || "admin") !== String(clienteId)
    );

    logger.log(`Fila carregada do cliente: ${clienteId}`);

    return [
      ...filaSemCliente,
      ...filaLimpa
    ];
  } catch (e) {
    logger.error("ERRO AO CARREGAR FILA:", e.message);
    return fila;
  }
}

function adicionarOfertaFila(fila = [], oferta) {
  if (!oferta) return false;

  fila.push(oferta);
  return true;
}

function buscarOfertaFila(fila = [], { id, clienteId = "admin", index } = {}) {
  if (index != null) {
    const oferta = fila[index];

    if (
      oferta &&
      String(oferta.clienteId || "admin") === String(clienteId)
    ) {
      return { oferta, index };
    }

    return { oferta: null, index: -1 };
  }

  const indexEncontrado = fila.findIndex(item =>
    String(item.id) === String(id) &&
    String(item.clienteId || "admin") === String(clienteId)
  );

  return {
    oferta: indexEncontrado >= 0 ? fila[indexEncontrado] : null,
    index: indexEncontrado
  };
}

function atualizarStatusFila(fila = [], { id, clienteId = "admin", status, statusDetalhe, erro, erroEm } = {}) {
  const resultado = buscarOfertaFila(fila, { id, clienteId });

  if (!resultado.oferta) return null;

  if (status != null) resultado.oferta.status = status;
  if (statusDetalhe != null) resultado.oferta.statusDetalhe = statusDetalhe;
  if (erro != null) resultado.oferta.erro = erro;
  if (erroEm != null) resultado.oferta.erroEm = erroEm;

  return resultado.oferta;
}

function limparFilaAntiga(fila = [], { clienteId = "admin", status = "" } = {}) {
  const antes = fila.length;

  const novaFila = fila.filter(item => {
    const dono = String(item.clienteId || "admin");

    const mesmoCliente =
      dono === String(clienteId);

    const mesmoStatus =
      status
        ? String(item.status) === String(status)
        : true;

    return !(mesmoCliente && mesmoStatus);
  });

  return {
    fila: novaFila,
    removidos: antes - novaFila.length
  };
}

module.exports = {
  adicionarOfertaFila,
  atualizarStatusFila,
  salvarFila,
  limparFilaAntiga,
  buscarOfertaFila,
  carregarFila
};
