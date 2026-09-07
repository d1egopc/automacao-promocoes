"use strict";

const {
  readClienteJson,
  writeClienteJson,
  normalizarClienteId
} = require("../../utils/storage");
const {
  normalizarCorIdentidade,
  normalizarCorLegadaParaIdentidade
} = require("./paleta");

const ARQUIVO_CONFIG_IDENTIDADE_VISUAL = "identidade-visual-ofertas.json";

function texto(valor = "") {
  return String(valor ?? "").trim();
}

function clonar(valor) {
  return JSON.parse(JSON.stringify(valor));
}

function normalizarLogoRef(valor = "") {
  const logo = texto(valor);
  if (!logo) return "";
  if (logo === "optimus_oficial") return "optimus_oficial";
  const match = logo.match(/^cliente:([a-f0-9]{32,64})$/i);
  return match ? `cliente:${match[1].toLowerCase()}` : "";
}

function normalizarConfigIdentidadeVisual(config = {}) {
  const fonte = config && typeof config === "object" ? config : {};
  const saida = {};

  if (Object.prototype.hasOwnProperty.call(fonte, "ativo")) {
    saida.ativo = fonte.ativo !== false;
  }

  const logo = normalizarLogoRef(fonte.logo || fonte.logoAsset);
  if (logo) saida.logo = logo;

  const frase = texto(fonte.frase || fonte.texto || fonte.slogan);
  if (frase) saida.frase = frase.slice(0, 80);

  const corIdentidade =
    normalizarCorIdentidade(fonte.corIdentidade) ||
    normalizarCorLegadaParaIdentidade(fonte.corFaixa);
  if (corIdentidade) saida.corIdentidade = corIdentidade;

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
  normalizarLogoRef,
  criarRepositorioIdentidadeVisualOfertas
};
