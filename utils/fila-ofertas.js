const fs = require("fs");
const path = require("path");

let inteligenciaUniversalCache = null;

function getInteligenciaUniversal() {
  if (inteligenciaUniversalCache) return inteligenciaUniversalCache;

  inteligenciaUniversalCache = require("../modules/inteligencia-universal");
  return inteligenciaUniversalCache;
}

function resumirLogsUniversais(logs = []) {
  if (!Array.isArray(logs)) return [];
  return logs.slice(-20);
}

function montarMetadataUniversalErro(oferta = {}, erro = null) {
  return {
    ativo: true,
    modo: "passivo",
    ok: false,
    status: "erro",
    motivo: erro?.message || "erro_inteligencia_universal",
    prioridade: null,
    score: null,
    categoria: oferta.categoria || "",
    valorEfetivo: null,
    valorEfetivoOrigem: "",
    logs: [{
      etapa: "porta_fila",
      status: "erro",
      motivo: erro?.message || "erro_inteligencia_universal"
    }]
  };
}

function aplicarPortaUniversalFila(oferta = {}, contexto = {}) {
  const logger = contexto.logger || console;

  try {
    const {
      avaliarOfertaUniversal,
      normalizarOfertaUniversal
    } = getInteligenciaUniversal();

    const contextoUniversal = {
      origem: contexto.origem || oferta.origem || "fila",
      clienteId: contexto.clienteId || oferta.clienteId || "admin",
      marketplace: contexto.marketplace || oferta.marketplace || ""
    };

    const normalizada = normalizarOfertaUniversal(oferta, contextoUniversal);
    const avaliacao = avaliarOfertaUniversal(oferta, contextoUniversal);
    const score = avaliacao.score?.score ?? avaliacao.score ?? null;

    oferta.ofertaUniversal = true;
    oferta.versaoOfertaUniversal = "v2-passiva";
    oferta.inteligenciaUniversalV2 = {
      ativo: true,
      modo: "passivo",
      ok: avaliacao.ok === true,
      status: avaliacao.status || "avaliada",
      motivo: avaliacao.motivo || "",
      prioridade: avaliacao.prioridade ?? null,
      score,
      categoria: avaliacao.categoria || normalizada.categoria || oferta.categoria || "",
      valorEfetivo: avaliacao.valorEfetivo ?? null,
      valorEfetivoOrigem: avaliacao.valorEfetivoOrigem || "",
      logs: resumirLogsUniversais(avaliacao.logs)
    };

    logger.log("[OFERTA-UNIVERSAL-PASSIVA]", {
      clienteId: contextoUniversal.clienteId,
      marketplace: normalizada.marketplace,
      titulo: normalizada.titulo,
      ok: oferta.inteligenciaUniversalV2.ok,
      status: oferta.inteligenciaUniversalV2.status,
      motivo: oferta.inteligenciaUniversalV2.motivo,
      prioridade: oferta.inteligenciaUniversalV2.prioridade,
      score: oferta.inteligenciaUniversalV2.score,
      categoria: oferta.inteligenciaUniversalV2.categoria,
      valorEfetivo: oferta.inteligenciaUniversalV2.valorEfetivo
    });

    return oferta;
  } catch (e) {
    oferta.ofertaUniversal = true;
    oferta.versaoOfertaUniversal = "v2-passiva";
    oferta.inteligenciaUniversalV2 = montarMetadataUniversalErro(oferta, e);

    logger.error("[OFERTA-UNIVERSAL-ERRO]", {
      clienteId: contexto.clienteId || oferta.clienteId || "admin",
      marketplace: oferta.marketplace || "",
      titulo: oferta.titulo || oferta.nome || "",
      erro: e.message
    });

    return oferta;
  }
}

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

function adicionarOfertaFila(fila = [], oferta, contexto = {}) {
  if (!oferta) return false;

  const ofertaFinal = aplicarPortaUniversalFila(oferta, {
    ...contexto,
    origem: contexto.origem || oferta.origem || "fila_push"
  });

  fila.push(ofertaFinal);

  const logger = contexto.logger || console;
  logger.log("[FILA-PORTA-UNIVERSAL]", {
    acao: "push",
    clienteId: ofertaFinal.clienteId || contexto.clienteId || "admin",
    marketplace: ofertaFinal.marketplace || "",
    ok: ofertaFinal.inteligenciaUniversalV2?.ok === true,
    status: ofertaFinal.inteligenciaUniversalV2?.status || ""
  });

  return true;
}

function adicionarOfertaInicioFila(fila = [], oferta, contexto = {}) {
  if (!oferta) return false;

  const ofertaFinal = aplicarPortaUniversalFila(oferta, {
    ...contexto,
    origem: contexto.origem || oferta.origem || "fila_unshift"
  });

  fila.unshift(ofertaFinal);

  const logger = contexto.logger || console;
  logger.log("[FILA-PORTA-UNIVERSAL]", {
    acao: "unshift",
    clienteId: ofertaFinal.clienteId || contexto.clienteId || "admin",
    marketplace: ofertaFinal.marketplace || "",
    ok: ofertaFinal.inteligenciaUniversalV2?.ok === true,
    status: ofertaFinal.inteligenciaUniversalV2?.status || ""
  });

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
  adicionarOfertaInicioFila,
  aplicarPortaUniversalFila,
  atualizarStatusFila,
  salvarFila,
  limparFilaAntiga,
  buscarOfertaFila,
  carregarFila
};
