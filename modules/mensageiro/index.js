const service = require("./service");
const storage = require("./storage");
const programacoesScheduler = require("./programacoes.scheduler");

module.exports = {
  ...service,
  ...storage,
  ...programacoesScheduler
};
