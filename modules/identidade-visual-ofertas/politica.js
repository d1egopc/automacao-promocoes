"use strict";

const POLITICAS_IDENTIDADE_VISUAL_OFERTAS = Object.freeze({
  OBRIGATORIA: "obrigatoria",
  OBRIGATORIA_EDITAVEL: "obrigatoria_editavel",
  OPCIONAL_EDITAVEL: "opcional_editavel",
  DESABILITADA: "desabilitada"
});

const POLITICAS_VALIDAS = new Set(Object.values(POLITICAS_IDENTIDADE_VISUAL_OFERTAS));

function texto(valor = "") {
  return String(valor ?? "").trim();
}

function normalizarPoliticaIdentidadeVisual(valor) {
  const politica = texto(valor).toLowerCase();
  return POLITICAS_VALIDAS.has(politica)
    ? politica
    : POLITICAS_IDENTIDADE_VISUAL_OFERTAS.DESABILITADA;
}

function resolverPermissoesPoliticaIdentidadeVisual(valor) {
  const politica = normalizarPoliticaIdentidadeVisual(valor);

  if (politica === POLITICAS_IDENTIDADE_VISUAL_OFERTAS.OBRIGATORIA) {
    return {
      politica,
      habilitada: true,
      obrigatoria: true,
      editavel: false,
      podeDesligar: false
    };
  }

  if (politica === POLITICAS_IDENTIDADE_VISUAL_OFERTAS.OBRIGATORIA_EDITAVEL) {
    return {
      politica,
      habilitada: true,
      obrigatoria: true,
      editavel: true,
      podeDesligar: false
    };
  }

  if (politica === POLITICAS_IDENTIDADE_VISUAL_OFERTAS.OPCIONAL_EDITAVEL) {
    return {
      politica,
      habilitada: true,
      obrigatoria: false,
      editavel: true,
      podeDesligar: true
    };
  }

  return {
    politica: POLITICAS_IDENTIDADE_VISUAL_OFERTAS.DESABILITADA,
    habilitada: false,
    obrigatoria: false,
    editavel: false,
    podeDesligar: false
  };
}

function normalizarRecursoPlanoIdentidadeVisual(recursos = {}) {
  if (!recursos || typeof recursos !== "object") {
    return POLITICAS_IDENTIDADE_VISUAL_OFERTAS.DESABILITADA;
  }

  return normalizarPoliticaIdentidadeVisual(recursos.identidade_visual_ofertas);
}

function resolverPoliticaIdentidadeVisualPlano(plano = {}) {
  return resolverPermissoesPoliticaIdentidadeVisual(
    normalizarRecursoPlanoIdentidadeVisual(plano?.recursos || {})
  );
}

module.exports = {
  POLITICAS_IDENTIDADE_VISUAL_OFERTAS,
  normalizarPoliticaIdentidadeVisual,
  resolverPermissoesPoliticaIdentidadeVisual,
  normalizarRecursoPlanoIdentidadeVisual,
  resolverPoliticaIdentidadeVisualPlano
};
