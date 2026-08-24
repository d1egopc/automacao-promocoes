const service = require("./service");
const storage = require("./storage");
const programacoesScheduler = require("./programacoes.scheduler");
const gerenteService = require("./gerente.service");

module.exports = {
  ...service,
  ...storage,
  ...programacoesScheduler,
  ...gerenteService
};
