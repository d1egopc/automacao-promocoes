"use strict";

const {
  normalizarOfertaManualV2
} = require("../manual-offers.contract");
const {
  consultarProdutoMagalu
} = require("../../marketplaces/magalu/magalu-parser");
const {
  gerarLinkAfiliadoMagaluSeguro
} = require("../../marketplaces/magalu/magalu-affiliate-link");

const ADAPTER_MAGALU_MANUAL_V2 = "magalu.manual.adapter";

function texto(valor = "") {
  return String(valor ?? "").trim();
}

function primeiroTexto(...valores) {
  for (const valor of valores) {
    const atual = texto(valor);
    if (atual) return atual;
  }
  return "";
}

function listaUnicaTexto(valores = []) {
  return [...new Set((Array.isArray(valores) ? valores : [])
    .map(texto)
    .filter(Boolean))];
}

function camposConfiaveisMagalu(oferta = {}) {
  return [
    ["urlOriginal", oferta.urlOriginal],
    ["urlAfiliada", oferta.urlAfiliada],
    ["titulo", oferta.titulo],
    ["precoAtual", oferta.precoAtual],
    ["precoAnterior", oferta.precoAnterior],
    ["imagem", oferta.imagem],
    ["categoria", oferta.categoria],
    ["seller", oferta.seller],
    ["cupom", oferta.cupom],
    ["parcelamento", oferta.parcelamento]
  ]
    .filter(([, valor]) => texto(valor))
    .map(([campo]) => campo);
}

function observacoesMagalu(avisos = []) {
  return listaUnicaTexto(avisos).join(" | ");
}

async function importarProdutoMagaluManualV2(urlManual = "", opcoes = {}) {
  const urlOriginal = texto(urlManual);
  if (!urlOriginal) {
    throw new Error("url_manual_obrigatoria");
  }

  const clienteId = texto(opcoes.clienteId) || "admin";
  const parserMagalu = typeof opcoes.consultarProdutoMagalu === "function"
    ? opcoes.consultarProdutoMagalu
    : consultarProdutoMagalu;
  const gerarLinkSeguro = typeof opcoes.gerarLinkAfiliadoMagaluSeguro === "function"
    ? opcoes.gerarLinkAfiliadoMagaluSeguro
    : gerarLinkAfiliadoMagaluSeguro;
  const integracao = typeof opcoes.getIntegracaoCliente === "function"
    ? opcoes.getIntegracaoCliente(clienteId, "magalu")
    : null;
  const promoterId = texto(integracao?.credenciais?.promoterId || integracao?.promoterId);

  const fatos = await parserMagalu(urlOriginal, opcoes.parserOptions || {});
  const dados = fatos && typeof fatos === "object" ? fatos : {};
  const avisos = listaUnicaTexto(dados.avisos || []);

  if (!promoterId) {
    avisos.push("magalu_integracao_nao_configurada_url_afiliada_vazia");
  }

  const provaLink = promoterId
    ? gerarLinkSeguro(primeiroTexto(dados.urlCanonica, dados.urlOriginal, urlOriginal), promoterId)
    : { urlAfiliada: "", comprovado: false, avisos: [] };

  if (provaLink?.avisos?.length) {
    avisos.push(...provaLink.avisos);
  }

  const urlAfiliada = provaLink?.comprovado === true
    ? texto(provaLink.urlAfiliada)
    : "";

  if (!urlAfiliada) {
    avisos.push("magalu_url_afiliada_vazia_sem_prova");
  }

  const oferta = normalizarOfertaManualV2(
    {
      marketplace: "magalu",
      urlOriginal: primeiroTexto(dados.urlOriginal, urlOriginal),
      urlAfiliada,
      titulo: primeiroTexto(dados.titulo),
      precoAtual: primeiroTexto(dados.precoAtual),
      precoAnterior: primeiroTexto(dados.precoAnterior),
      imagem: primeiroTexto(dados.imagem),
      categoria: primeiroTexto(dados.categoria),
      seller: primeiroTexto(dados.seller),
      cupom: primeiroTexto(dados.cupom),
      parcelamento: primeiroTexto(dados.parcelamento),
      observacoes: observacoesMagalu(avisos),
      fonteImportacao: {
        marketplaceDetectado: "magalu",
        adapter: ADAPTER_MAGALU_MANUAL_V2,
        parseOnly: true,
        avisos
      }
    },
    {
      clienteId,
      now: opcoes.now,
      idFactory: opcoes.idFactory
    }
  );

  if (!urlAfiliada) {
    oferta.urlAfiliada = "";
    if (!oferta.fonteImportacao.camposAusentes.includes("urlAfiliada")) {
      oferta.fonteImportacao.camposAusentes.push("urlAfiliada");
    }
  }

  oferta.fonteImportacao.camposConfiaveis = camposConfiaveisMagalu(oferta);

  return oferta;
}

module.exports = {
  ADAPTER_MAGALU_MANUAL_V2,
  importarProdutoMagaluManualV2,
  camposConfiaveisMagalu
};
