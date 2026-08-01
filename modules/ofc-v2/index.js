"use strict";

const {
  MOEDA_PADRAO,
  normalizarMarketplace,
  analisarPrecoComercial,
  normalizarParcelamento,
  normalizarDadosComerciais
} = require("./normalizador-comercial");
const {
  calcularUTOOferta,
  medirWorkspaceOperacional
} = require("./medidor-operacional");
const {
  auditarLogicaFixaOfc,
  criarAuditoriaOfcV24Shadow
} = require("./auditoria-ofc");

module.exports = {
  MOEDA_PADRAO,
  normalizarMarketplace,
  analisarPrecoComercial,
  normalizarParcelamento,
  normalizarDadosComerciais,
  calcularUTOOferta,
  medirWorkspaceOperacional,
  auditarLogicaFixaOfc,
  criarAuditoriaOfcV24Shadow
};
