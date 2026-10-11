"use strict";

const { extrairComercialUniversal } = require("../radar/extrator-comercial-universal");

const CONFIANCAS_ACEITAS = new Set(["alta", "media"]);

function texto(valor = "") {
  return String(valor ?? "").trim();
}

function listaLinks(links = []) {
  const vistos = new Set();
  const saida = [];
  for (const link of Array.isArray(links) ? links : []) {
    const valor = texto(link);
    if (!valor || vistos.has(valor)) continue;
    vistos.add(valor);
    saida.push(valor);
  }
  return saida;
}

function numero(valor) {
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

function confiavel(campo = {}) {
  return CONFIANCAS_ACEITAS.has(texto(campo.confianca).toLowerCase());
}

function limparEvidenciaComercial(valor = "") {
  return texto(valor)
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([:;,.])/g, "$1")
    .trim();
}

function textoSemAcentos(valor = "") {
  return texto(valor).normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function limparLinhaTituloClonador(linha = "") {
  return texto(linha)
    .replace(/[`*_~]/g, "")
    .replace(/^[^\p{L}\p{N}]+/u, "")
    .replace(/\s+/g, " ")
    .trim();
}

function linhaPromocionalTituloClonador(linha = "") {
  const limpa = limparLinhaTituloClonador(linha);
  const normalizada = textoSemAcentos(limpa).toLowerCase();
  if (!normalizada) return true;
  if (/^https?:\/\//i.test(limpa)) return true;
  if (/\b(?:mercadolivre\.com|meli\.la|amzn\.to|s\.shopee\.com|shopee\.com|aliexpress\.com|kabum\.com)\b/i.test(limpa)) return true;
  if (/^(?:preco|precinho|promo|promocao|oferta|ofertao|corre|janela|imperdivel|baratinho|achadinho)\b/i.test(normalizada)) return true;
  if (/\b(?:nao vai durar|leva \d+|so hoje|ultimas unidades)\b/i.test(normalizada)) return true;
  if (/\bantes que acabe\b/i.test(normalizada)) return true;
  if (/^(?:compre|aproveite|garanta)\b/i.test(normalizada) && /\b(?:ja|agora|hoje|logo)\b/i.test(normalizada)) return true;
  if (/^(?:de|por|cupom|codigo|confira|aplique|resgate|use)\b/i.test(normalizada)) return true;
  if (/\b(?:r\$|off|desconto|cupom|pix|cashback|frete gratis|a partir de|acima de)\b/i.test(normalizada)) return true;
  return false;
}

function pontuarTituloClonador(linha = "") {
  const limpa = limparLinhaTituloClonador(linha);
  const palavras = limpa.split(/\s+/).filter(Boolean);
  if (palavras.length < 2 || limpa.length < 8) return 0;
  const normalizada = textoSemAcentos(limpa).toLowerCase();
  let pontos = Math.min(palavras.length, 8);
  if (/[a-z]/i.test(limpa) && /\b\d+\b/.test(limpa)) pontos += 1;
  if (/\b(?:kit|bermuda|tenis|perfume|camiseta|calca|short|jeans|social|brim|sarja|fone|headset|mouse|teclado|monitor|notebook|smartphone|celular|garrafa|panela|camera|controle|cadeira|mesa|mochila|relogio)\b/i.test(normalizada)) pontos += 3;
  if (linhaPromocionalTituloClonador(limpa)) pontos -= 20;
  return pontos;
}

function extrairTituloCapturadoClonador(textoOriginal = "", links = []) {
  const linksIgnorados = new Set(listaLinks(links));
  const candidatos = texto(textoOriginal)
    .split(/\r?\n/)
    .map(limparLinhaTituloClonador)
    .filter(Boolean)
    .filter(linha => !linksIgnorados.has(linha))
    .filter(linha => !linhaPromocionalTituloClonador(linha))
    .map(linha => ({ linha, pontos: pontuarTituloClonador(linha) }))
    .filter(candidato => candidato.pontos >= 3)
    .sort((a, b) => b.pontos - a.pontos || b.linha.length - a.linha.length);
  return candidatos[0]?.linha || "";
}

function textoComCondicaoComercial(valor = "") {
  return /\b(?:pix|a partir de|acima de|no app|boleto|cartao|frete|resgate|aplique|para chegar|valor final)\b/i.test(textoSemAcentos(valor));
}

function textoBeneficioComercial(comercial = {}) {
  const cupom = comercial.cupom || {};
  const textoCupom = confiavel(cupom) ? texto(cupom.texto) : "";
  const evidenciaCupom = confiavel(cupom) ? texto(cupom.evidencia) : "";
  const instrucaoCupom = confiavel(cupom) ? texto(cupom.instrucao) : "";
  const instrucaoCompleta = instrucaoCupom && textoComCondicaoComercial(instrucaoCupom) &&
    instrucaoCupom.length > Math.max(textoCupom.length, evidenciaCupom.length) ? instrucaoCupom : "";
  const candidatos = [instrucaoCompleta, textoCupom, evidenciaCupom,
    /off|desconto|cupom/i.test(comercial.valorCupom?.evidencia || "") ? comercial.valorCupom.evidencia : "",
    confiavel(comercial.descontoPercentual) ? comercial.descontoPercentual.evidencia : "",
    ...(Array.isArray(comercial.condicoesEspeciais) ? comercial.condicoesEspeciais : [])];
  return limparEvidenciaComercial(candidatos.find(Boolean) || "");
}

function montarComercialCapturado({ textoOriginal = "", links = [], marketplaceDetectado = "",
  linksComerciais = [], extrairComercial = extrairComercialUniversal } = {}) {
  if (typeof extrairComercial !== "function") return null;
  const comercial = extrairComercial({ textoOriginal, links, marketplaceDetectado });
  const precoAtual = confiavel(comercial.precoAtual) ? numero(comercial.precoAtual.valor) : null;
  const precoAnterior = precoAtual !== null && confiavel(comercial.precoAntigo)
    ? numero(comercial.precoAntigo.valor) : null;
  const cupom = confiavel(comercial.cupom) ? texto(comercial.cupom.codigo) : "";
  const beneficio = textoBeneficioComercial(comercial);
  const tituloCapturado = extrairTituloCapturadoClonador(textoOriginal, links);
  const contrato = {
    versao: "clonador_comercial_capturado_v1",
    origem: "clonador_grupos",
    marketplaceDetectado: texto(marketplaceDetectado).toLowerCase(),
    campos: {}, evidencias: {},
    parser: { versao: comercial.versao || "",
      camposEncontrados: Array.isArray(comercial.camposEncontrados) ? comercial.camposEncontrados : [] }
  };
  if (tituloCapturado) {
    contrato.tituloCapturado = tituloCapturado;
    contrato.campos.titulo = true;
    contrato.evidencias.titulo = tituloCapturado;
  }
  if (precoAtual !== null) {
    contrato.precoAtual = precoAtual;
    contrato.campos.precoAtual = true;
    contrato.evidencias.precoAtual = comercial.precoAtual?.evidencia || "";
  }
  if (precoAnterior !== null && precoAnterior > precoAtual) {
    contrato.precoAnterior = precoAnterior;
    contrato.campos.precoAnterior = true;
    contrato.evidencias.precoAnterior = comercial.precoAntigo?.evidencia || "";
  }
  if (cupom) {
    contrato.cupom = cupom;
    contrato.campos.cupom = true;
    contrato.evidencias.cupom = comercial.cupom?.evidencia || comercial.cupom?.texto || "";
  }
  if (beneficio) {
    contrato.beneficioTexto = beneficio;
    contrato.beneficioExtra = beneficio;
    contrato.campos.beneficio = true;
    contrato.evidencias.beneficio = beneficio;
  }
  const linksFactuais = (Array.isArray(linksComerciais) ? linksComerciais : [])
    .filter(item => item && typeof item === "object" && !Array.isArray(item));
  if (linksFactuais.length) contrato.linksComerciais = linksFactuais;
  return Object.keys(contrato.campos).length || linksFactuais.length ? contrato : null;
}

module.exports = { montarComercialCapturado, extrairTituloCapturadoClonador };
