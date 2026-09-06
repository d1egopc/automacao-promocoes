"use strict";

const criarRotasClonadorGrupos = require("./routes");
const { criarRepositorioClonadorGrupos } = require("./repository");
const {
  MAX_FONTES_ATIVAS,
  criarServicoClonadorGrupos,
  destinoIdOficial,
  grupoIdOficial
} = require("./service");

module.exports = {
  criarRotasClonadorGrupos,
  criarRepositorioClonadorGrupos,
  criarServicoClonadorGrupos,
  destinoIdOficial,
  grupoIdOficial,
  MAX_FONTES_ATIVAS
};
