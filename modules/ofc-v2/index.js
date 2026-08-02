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
const {
  WORKSPACE_D1EGOPC_OFICIAL,
  CONFIGURACAO_ESPELHO_PILOTO,
  obterConfiguracaoEspelhoPiloto,
  selecionarTemplateEspelhoPiloto,
  selecionarImagemEspelhoPiloto
} = require("./espelho-piloto");

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
  selecionarImagemComercial,
  WORKSPACE_D1EGOPC_OFICIAL,
  CONFIGURACAO_ESPELHO_PILOTO,
  obterConfiguracaoEspelhoPiloto,
  selecionarTemplateEspelhoPiloto,
  selecionarImagemEspelhoPiloto
};
