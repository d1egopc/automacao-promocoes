"use strict";

const criarRotasIdentidadeVisualOfertas = require("./routes");
const {
  criarRepositorioIdentidadeVisualOfertas,
  normalizarConfigIdentidadeVisual,
  normalizarLogoRef
} = require("./repository");
const {
  criarServicoIdentidadeVisualOfertas,
  aplicarIdentidadeVisualOferta,
  resolverConfigIdentidadeVisualOferta,
  atualizarConfigIdentidadeVisualOferta,
  uploadLogoIdentidadeVisualOferta,
  CONFIG_PADRAO_IDENTIDADE_VISUAL_OFERTAS,
  LAYOUT_IDENTIDADE_VISUAL_OFERTAS
} = require("./service");
const storageIdentidadeVisualOfertas = require("./storage");
const renderer = require("./renderer");
const paleta = require("./paleta");
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
  uploadLogoIdentidadeVisualOferta,
  CONFIG_PADRAO_IDENTIDADE_VISUAL_OFERTAS,
  LAYOUT_IDENTIDADE_VISUAL_OFERTAS,
  normalizarConfigIdentidadeVisual,
  normalizarLogoRef,
  storageIdentidadeVisualOfertas,
  POLITICAS_IDENTIDADE_VISUAL_OFERTAS,
  normalizarPoliticaIdentidadeVisual,
  resolverPermissoesPoliticaIdentidadeVisual,
  normalizarRecursoPlanoIdentidadeVisual,
  resolverPoliticaIdentidadeVisualPlano,
  ...renderer,
  ...paleta
};
