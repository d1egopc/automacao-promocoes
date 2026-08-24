const banco = require("./banco-frases.v1");
const intencao = require("./resolver-intencao");
const cache = require("./cache");
const service = require("./copy-inteligente.service");

module.exports = {
  ...banco,
  ...intencao,
  ...cache,
  ...service
};
