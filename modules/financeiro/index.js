"use strict";

module.exports = {
  ...require("./financeiro.schema"),
  ...require("./financeiro.repository"),
  ...require("./financeiro.service"),
  ...require("./simulado.adapter")
};
