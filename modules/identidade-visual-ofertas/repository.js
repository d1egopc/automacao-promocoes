"use strict";

const {
  readClienteJson,
  writeClienteJson,
  normalizarClienteId
} = require("../../utils/storage");

const ARQUIVO_CONFIG_IDENTIDADE_VISUAL = "identidade-visual-ofertas.json";

function texto(valor = "") {
  return String(valor ?? "").trim();
}

function clonar(valor) {
  return JSON.parse(JSON.stringify(valor));
}

function normalizarCor(valor = "") {
  const cor = texto(valor);
  return /^#[0-9a-fA-F]{6}$/.test(cor) ? cor.toUpperCase() : "";
}

function normalizarConfigIdentidadeVisual(config = {}) {
  const fonte = config && typeof config === "object" ? config : {};
  const saida = {};

  if (Object.prototype.hasOwnProperty.call(fonte, "ativo")) {
    saida.ativo = fonte.ativo !== false;
  }

  const logo = texto(fonte.logo || fonte.logoUrl || fonte.logoAsset);
  if (logo) saida.logo = logo;

  const frase = texto(fonte.frase || fonte.texto || fonte.slogan);
  if (frase) saida.frase = frase.slice(0, 120);

  const corFaixa = normalizarCor(fonte.corFaixa);
  if (corFaixa) saida.corFaixa = corFaixa;

  const corTexto = normalizarCor(fonte.corTexto);
  if (corTexto) saida.corTexto = corTexto;

  return saida;
}

function criarRepositorioIdentidadeVisualOfertas(deps = {}) {
  const leitor = typeof deps.readClienteJson === "function" ? deps.readClienteJson : readClienteJson;
  const escritor = typeof deps.writeClienteJson === "function" ? deps.writeClienteJson : writeClienteJson;

  function lerConfig(clienteId = "admin") {
    const cliente = normalizarClienteId(clienteId || "admin");
    try {
      const dados = leitor(cliente, ARQUIVO_CONFIG_IDENTIDADE_VISUAL, {});
      return normalizarConfigIdentidadeVisual(dados || {});
    } catch {
      return {};
    }
  }

  function salvarConfig(clienteId = "admin", config = {}) {
    const cliente = normalizarClienteId(clienteId || "admin");
    const normalizada = normalizarConfigIdentidadeVisual(config);
    escritor(cliente, ARQUIVO_CONFIG_IDENTIDADE_VISUAL, normalizada);
    return clonar(normalizada);
  }

  function atualizarConfig(clienteId = "admin", patch = {}) {
    const atual = lerConfig(clienteId);
    return salvarConfig(clienteId, {
      ...atual,
      ...(patch && typeof patch === "object" ? patch : {})
    });
  }

  return {
    lerConfig,
    salvarConfig,
    atualizarConfig
  };
}

module.exports = {
  ARQUIVO_CONFIG_IDENTIDADE_VISUAL,
  normalizarConfigIdentidadeVisual,
  criarRepositorioIdentidadeVisualOfertas
};
