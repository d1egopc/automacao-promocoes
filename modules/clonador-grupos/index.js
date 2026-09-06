"use strict";

const criarRotasClonadorGrupos = require("./routes");
const { criarRepositorioClonadorGrupos } = require("./repository");
const {
  criarBridgeClonadorGrupos,
  montarComercialCapturado,
  resolverLinksClonador
} = require("./bridge");
const {
  MAX_FONTES_ATIVAS,
  criarServicoClonadorGrupos,
  destinoIdOficial,
  grupoIdOficial
} = require("./service");

module.exports = {
  criarRotasClonadorGrupos,
  criarRepositorioClonadorGrupos,
  criarBridgeClonadorGrupos,
  montarComercialCapturado,
  resolverLinksClonador,
  criarServicoClonadorGrupos,
  destinoIdOficial,
  grupoIdOficial,
  MAX_FONTES_ATIVAS
};
