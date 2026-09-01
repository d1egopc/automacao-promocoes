"use strict";

const criarRotasPlatformVariables = require("./platform-variables.routes");
const {
  criarPlatformVariablesService,
  platformVariablesServicePadrao,
  getPlatformVariable
} = require("./platform-variables.service");
const {
  criarPlatformVariablesRepository,
  prepararSchemaPlatformVariables
} = require("./platform-variables.repository");

module.exports = {
  criarRotasPlatformVariables,
  criarPlatformVariablesService,
  platformVariablesServicePadrao,
  getPlatformVariable,
  criarPlatformVariablesRepository,
  prepararSchemaPlatformVariables
};
