const { readClienteJson, writeClienteJson, normalizarClienteId } = require("../../utils/storage");

const ARQUIVO_TEMPLATES_OFERTAS = "templates-ofertas.json";
const STORAGE_VERSION = 1;

function criarStoragePadrao() {
  return { schemaVersion: STORAGE_VERSION, templates: [], atualizadoEm: "" };
}

function normalizarStorage(dados = {}) {
  return {
    schemaVersion: STORAGE_VERSION,
    templates: Array.isArray(dados.templates) ? dados.templates : [],
    atualizadoEm: String(dados.atualizadoEm || "")
  };
}

function lerStorageTemplates(clienteId) {
  const clienteSeguro = normalizarClienteId(clienteId || "admin");
  return normalizarStorage(readClienteJson(clienteSeguro, ARQUIVO_TEMPLATES_OFERTAS, criarStoragePadrao()));
}

function salvarStorageTemplates(clienteId, dados = {}) {
  const clienteSeguro = normalizarClienteId(clienteId || "admin");
  const payload = normalizarStorage({ ...dados, atualizadoEm: new Date().toISOString() });
  writeClienteJson(clienteSeguro, ARQUIVO_TEMPLATES_OFERTAS, payload);
  return payload;
}

function listarTemplatesCliente(clienteId) {
  return lerStorageTemplates(clienteId).templates;
}

function salvarTemplatesCliente(clienteId, templates = []) {
  return salvarStorageTemplates(clienteId, { templates: Array.isArray(templates) ? templates : [] });
}

module.exports = {
  ARQUIVO_TEMPLATES_OFERTAS,
  criarStoragePadrao,
  lerStorageTemplates,
  salvarStorageTemplates,
  listarTemplatesCliente,
  salvarTemplatesCliente
};
