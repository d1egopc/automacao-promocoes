const banco = require("./banco-frases.v1");
const bancoAssociativoV2 = require("./banco-associativo.v2");
const familiasV2 = require("./familias-v2");
const intencao = require("./resolver-intencao");
const cache = require("./cache");
const service = require("./copy-inteligente.service");
const serviceLocalV2 = require("./copy-local-v2.service");
const contextoV2 = require("./contexto-v2");
const validatorV2 = require("./validator-v2");
const providerClient = require("./provider-client");
const circuitBreakerV2 = require("./circuit-breaker-v2");
const cacheV2 = require("./cache-v2");
const quotaV2 = require("./quota-v2");
const observabilidadeV2 = require("./observabilidade-v2");
const serviceV2 = require("./copy-v2.service");
const serviceC3 = require("./copy-c3.service");

module.exports = {
  ...banco,
  ...bancoAssociativoV2,
  ...familiasV2,
  ...intencao,
  ...cache,
  ...service,
  ...serviceLocalV2,
  ...contextoV2,
  ...validatorV2,
  ...providerClient,
  ...circuitBreakerV2,
  ...cacheV2,
  ...quotaV2,
  ...observabilidadeV2,
  ...serviceV2,
  ...serviceC3
};
