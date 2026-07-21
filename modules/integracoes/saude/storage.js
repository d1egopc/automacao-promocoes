const { readClienteJson, writeClienteJson } = require("../../../utils/storage");

const ARQUIVO_SAUDE_INTEGRACOES = "saude-integracoes.json";

function normalizarMapa(valor = {}) {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) return {};
  const saida = { ...valor };
  delete saida.clienteId;
  return saida;
}

function lerSaudeIntegracoes(clienteId = "admin") {
  return normalizarMapa(readClienteJson(clienteId, ARQUIVO_SAUDE_INTEGRACOES, {}));
}

function salvarSaudeIntegracoes(clienteId = "admin", dados = {}) {
  const payload = normalizarMapa(dados);
  writeClienteJson(clienteId, ARQUIVO_SAUDE_INTEGRACOES, payload);
  return payload;
}

function lerSaudeMarketplace(clienteId = "admin", marketplace = "") {
  const mp = String(marketplace || "").trim().toLowerCase();
  const dados = lerSaudeIntegracoes(clienteId);
  return dados[mp] || null;
}

function salvarSaudeMarketplace(clienteId = "admin", marketplace = "", registro = {}) {
  const mp = String(marketplace || "").trim().toLowerCase();
  if (!mp) return null;
  const dados = lerSaudeIntegracoes(clienteId);
  dados[mp] = registro;
  salvarSaudeIntegracoes(clienteId, dados);
  return dados[mp];
}

module.exports = {
  ARQUIVO_SAUDE_INTEGRACOES,
  lerSaudeIntegracoes,
  salvarSaudeIntegracoes,
  lerSaudeMarketplace,
  salvarSaudeMarketplace
};
