"use strict";

// Contrato puro de fronteira entre a preparacao por origem e o evento Engine.
// Nao resolve URL, nao classifica papel, nao remove duplicatas e nao muta
// nenhum dos arrays recebidos: cada politica continua dona desses comportamentos.
function listaPreservada(valor) {
  return Array.isArray(valor) ? [...valor] : [];
}

function criarContratoPreparacaoLinks({
  linksOriginais = [],
  linksPreparados = [],
  redirects = [],
  identidadesCanonicas = []
} = {}) {
  return {
    linksOriginais: listaPreservada(linksOriginais),
    linksPreparados: listaPreservada(linksPreparados),
    redirects: listaPreservada(redirects),
    identidadesCanonicas: listaPreservada(identidadesCanonicas)
  };
}

module.exports = {
  criarContratoPreparacaoLinks
};
