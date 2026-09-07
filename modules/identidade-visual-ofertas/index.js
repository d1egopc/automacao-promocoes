"use strict";

const criarRotasIdentidadeVisualOfertas = require("./routes");
const {
  criarRepositorioIdentidadeVisualOfertas,
  normalizarConfigIdentidadeVisual
} = require("./repository");
const {
  criarServicoIdentidadeVisualOfertas,
  aplicarIdentidadeVisualOferta,
  resolverConfigIdentidadeVisualOferta,
  atualizarConfigIdentidadeVisualOferta,
  CONFIG_PADRAO_IDENTIDADE_VISUAL_OFERTAS
} = require("./service");
const {
  POLITICAS_IDENTIDADE_VISUAL_OFERTAS,
  normalizarPoliticaIdentidadeVisual,
  resolverPermissoesPoliticaIdentidadeVisual,
  normalizarRecursoPlanoIdentidadeVisual,
  resolverPoliticaIdentidadeVisualPlano
} = require("./politica");

module.exports = {
  criarRotasIdentidadeVisualOfertas,
  criarRepositorioIdentidadeVisualOfertas,
  criarServicoIdentidadeVisualOfertas,
  aplicarIdentidadeVisualOferta,
  resolverConfigIdentidadeVisualOferta,
  atualizarConfigIdentidadeVisualOferta,
  CONFIG_PADRAO_IDENTIDADE_VISUAL_OFERTAS,
  normalizarConfigIdentidadeVisual,
  POLITICAS_IDENTIDADE_VISUAL_OFERTAS,
  normalizarPoliticaIdentidadeVisual,
  resolverPermissoesPoliticaIdentidadeVisual,
  normalizarRecursoPlanoIdentidadeVisual,
  resolverPoliticaIdentidadeVisualPlano
};
