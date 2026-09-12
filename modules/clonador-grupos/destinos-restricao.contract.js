"use strict";

const { resolverOrigemFluxo } = require("../../utils/origem-fluxo");

function texto(valor = "") {
  return String(valor ?? "").trim();
}

function objeto(valor = {}) {
  return valor && typeof valor === "object" && !Array.isArray(valor) ? valor : {};
}

function listaEntrada(valor) {
  if (Array.isArray(valor)) return valor;
  if (typeof valor === "string" || typeof valor === "number") return [valor];
  return [];
}

function normalizarDestinosAutorizadosIds(valor = []) {
  const vistos = new Set();
  const saida = [];
  for (const entrada of listaEntrada(valor)) {
    const id = texto(entrada);
    if (!id || vistos.has(id)) continue;
    vistos.add(id);
    saida.push(id);
  }
  return saida;
}

function clonadorGruposComDestinoIds(item = {}) {
  const metadata = objeto(item.metadata);
  const jobMetadata = objeto(item.job_metadata || item.jobMetadata);
  const eventoMetadata = objeto(item.evento_metadata || item.eventoMetadata);
  const fontes = [
    metadata.clonadorGrupos,
    objeto(metadata.metadataEvento).clonadorGrupos,
    objeto(jobMetadata.metadataEvento).clonadorGrupos,
    eventoMetadata.clonadorGrupos
  ];

  return fontes.find(fonte =>
    fonte && typeof fonte === "object" && !Array.isArray(fonte) &&
    Object.prototype.hasOwnProperty.call(fonte, "destinoIds")
  ) || null;
}

function resolverRestricaoDestinosClonador(item = {}) {
  if (resolverOrigemFluxo(item) !== "clonador_grupos") {
    return {
      aplica: false,
      destinosAutorizadosIds: [],
      motivo: "origem_nao_clonador",
      fonte: ""
    };
  }

  if (Object.prototype.hasOwnProperty.call(objeto(item), "destinosAutorizadosIds")) {
    const destinosAutorizadosIds = normalizarDestinosAutorizadosIds(item.destinosAutorizadosIds);
    return {
      aplica: true,
      destinosAutorizadosIds,
      motivo: destinosAutorizadosIds.length ? "snapshot_operacional" : "clonador_destinos_snapshot_vazio",
      fonte: "campo_operacional"
    };
  }

  const clonadorGrupos = clonadorGruposComDestinoIds(item);
  if (clonadorGrupos) {
    const destinosAutorizadosIds = normalizarDestinosAutorizadosIds(clonadorGrupos.destinoIds);
    return {
      aplica: true,
      destinosAutorizadosIds,
      motivo: destinosAutorizadosIds.length ? "metadata_legada" : "clonador_destinos_snapshot_vazio",
      fonte: "metadata_legada"
    };
  }

  return {
    aplica: true,
    destinosAutorizadosIds: [],
    motivo: "clonador_destinos_snapshot_ausente",
    fonte: "ausente"
  };
}

function filtrarDestinosAutorizadosClonador(destinos = [], item = {}, resolverDestinoId = null) {
  const lista = Array.isArray(destinos) ? destinos : [];
  const restricao = resolverRestricaoDestinosClonador(item);
  if (!restricao.aplica) {
    return { destinos: lista, restricao, rejeitadosForaSnapshot: [] };
  }

  const autorizados = new Set(restricao.destinosAutorizadosIds);
  const obterId = typeof resolverDestinoId === "function"
    ? resolverDestinoId
    : destino => texto(destino?.id || destino?.destinoId || destino?.destino_id);
  const destinosFiltrados = [];
  const rejeitadosForaSnapshot = [];

  for (const destino of lista) {
    const destinoId = texto(obterId(destino));
    if (destinoId && autorizados.has(destinoId)) {
      destinosFiltrados.push(destino);
    } else {
      rejeitadosForaSnapshot.push(destinoId);
    }
  }

  return { destinos: destinosFiltrados, restricao, rejeitadosForaSnapshot };
}

module.exports = {
  normalizarDestinosAutorizadosIds,
  resolverRestricaoDestinosClonador,
  filtrarDestinosAutorizadosClonador
};
