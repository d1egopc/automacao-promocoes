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
const {
  construirEspelhoComercialV24,
  construirEspelhoComercialV24FailOpen,
  resumoEspelhoComercialLog,
  selecionarImagemComercial
} = require("./espelho-comercial");

module.exports = {
  MOEDA_PADRAO,
  normalizarMarketplace,
  analisarPrecoComercial,
  normalizarParcelamento,
  normalizarDadosComerciais,
  calcularUTOOferta,
  medirWorkspaceOperacional,
  auditarLogicaFixaOfc,
  criarAuditoriaOfcV24Shadow,
  construirEspelhoComercialV24,
  construirEspelhoComercialV24FailOpen,
  resumoEspelhoComercialLog,
  selecionarImagemComercial
};
