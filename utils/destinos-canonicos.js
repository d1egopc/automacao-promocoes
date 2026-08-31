"use strict";

function lista(valor) {
  return Array.isArray(valor) ? valor : [];
}

function normalizarItem(destino, normalizarDestino) {
  return typeof normalizarDestino === "function" ? normalizarDestino(destino) : destino;
}

function destinoValido(destino) {
  return Boolean(destino && typeof destino === "object" && !Array.isArray(destino));
}

function idDestino(destino = {}, fallback = "") {
  return String(destino.id || destino.destinoId || fallback || "").trim();
}

function listarDestinosCanonicosWorkspace(origem, opcoes = {}) {
  const { normalizarDestino } = opcoes;
  const destinos = [];
  const vistos = new Set();

  function adicionar(destino, chave = "") {
    if (!destinoValido(destino)) return;
    const normalizado = normalizarItem(destino, normalizarDestino);
    if (!destinoValido(normalizado)) return;
    const id = idDestino(normalizado, chave);
    if (!id || vistos.has(id)) return;
    vistos.add(id);
    destinos.push(normalizado);
  }

  if (Array.isArray(origem)) {
    origem.forEach((destino, indice) => adicionar(destino, String(indice)));
    return destinos;
  }

  if (origem && typeof origem === "object") {
    for (const [chave, valor] of Object.entries(origem)) {
      if (Array.isArray(valor)) {
        valor.forEach((destino, indice) => adicionar(destino, `${chave}:${indice}`));
      } else {
        adicionar(valor, chave);
      }
    }
  }

  return destinos;
}

function atualizarDestinosCanonicosWorkspace(origem, destinosAtualizados, opcoes = {}) {
  const { normalizarDestino } = opcoes;
  const atuais = listarDestinosCanonicosWorkspace(origem, { normalizarDestino });
  const atualizados = lista(destinosAtualizados)
    .map((destino) => normalizarItem(destino, normalizarDestino))
    .filter(destinoValido);
  const porId = new Map();

  for (const destino of atualizados) {
    const id = idDestino(destino);
    if (id) porId.set(id, destino);
  }

  const usados = new Set();
  const resultado = atuais.map((destino) => {
    const id = idDestino(destino);
    if (id && porId.has(id)) {
      usados.add(id);
      return porId.get(id);
    }
    return destino;
  });

  for (const destino of atualizados) {
    const id = idDestino(destino);
    if (id) {
      if (usados.has(id)) continue;
      usados.add(id);
    }
    resultado.push(destino);
  }

  return resultado;
}

module.exports = {
  idDestino,
  listarDestinosCanonicosWorkspace,
  atualizarDestinosCanonicosWorkspace
};
