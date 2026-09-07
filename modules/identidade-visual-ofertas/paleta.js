"use strict";

const PALETA_IDENTIDADE_VISUAL = Object.freeze({
  preto: { chave: "preto", label: "Preto", hex: "#111827" },
  azul: { chave: "azul", label: "Azul", hex: "#005BFF" },
  vermelho: { chave: "vermelho", label: "Vermelho", hex: "#E11D2E" },
  rosa: { chave: "rosa", label: "Rosa", hex: "#DB2777" },
  laranja: { chave: "laranja", label: "Laranja", hex: "#F97316" },
  verde: { chave: "verde", label: "Verde", hex: "#16A34A" }
});

const CORES_VALIDAS_IDENTIDADE = new Set(Object.keys(PALETA_IDENTIDADE_VISUAL));

function texto(valor = "") {
  return String(valor ?? "").trim();
}

function normalizarHex(valor = "") {
  const cor = texto(valor);
  return /^#[0-9a-fA-F]{6}$/.test(cor) ? cor.toUpperCase() : "";
}

function hexParaRgb(hex = "") {
  const cor = normalizarHex(hex);
  if (!cor) return null;
  return {
    r: parseInt(cor.slice(1, 3), 16),
    g: parseInt(cor.slice(3, 5), 16),
    b: parseInt(cor.slice(5, 7), 16)
  };
}

function luminancia(hex = "") {
  const rgb = hexParaRgb(hex);
  if (!rgb) return 0;
  const canal = (valor) => {
    const normalizado = valor / 255;
    return normalizado <= 0.03928
      ? normalizado / 12.92
      : Math.pow((normalizado + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * canal(rgb.r) + 0.7152 * canal(rgb.g) + 0.0722 * canal(rgb.b);
}

function contrasteTextoAutomatico(hex = "") {
  return luminancia(hex) > 0.45 ? "#111827" : "#FFFFFF";
}

function distanciaRgb(a, b) {
  return Math.pow(a.r - b.r, 2) + Math.pow(a.g - b.g, 2) + Math.pow(a.b - b.b, 2);
}

function normalizarCorIdentidade(valor = "", fallback = "") {
  const cor = texto(valor).toLowerCase();
  if (CORES_VALIDAS_IDENTIDADE.has(cor)) return cor;
  return CORES_VALIDAS_IDENTIDADE.has(texto(fallback).toLowerCase()) ? texto(fallback).toLowerCase() : "";
}

function normalizarCorLegadaParaIdentidade(valor = "") {
  const rgb = hexParaRgb(valor);
  if (!rgb) return "";

  let melhor = "";
  let menorDistancia = Number.POSITIVE_INFINITY;
  for (const [chave, item] of Object.entries(PALETA_IDENTIDADE_VISUAL)) {
    const paletaRgb = hexParaRgb(item.hex);
    const distancia = paletaRgb ? distanciaRgb(rgb, paletaRgb) : Number.POSITIVE_INFINITY;
    if (distancia < menorDistancia) {
      menorDistancia = distancia;
      melhor = chave;
    }
  }
  return melhor;
}

function corHexIdentidade(chave = "azul") {
  const normalizada = normalizarCorIdentidade(chave, "azul") || "azul";
  return PALETA_IDENTIDADE_VISUAL[normalizada].hex;
}

function listarPaletaIdentidadeVisual() {
  return Object.values(PALETA_IDENTIDADE_VISUAL).map((item) => ({
    chave: item.chave,
    label: item.label,
    hex: item.hex,
    corTexto: contrasteTextoAutomatico(item.hex)
  }));
}

module.exports = {
  PALETA_IDENTIDADE_VISUAL,
  CORES_VALIDAS_IDENTIDADE,
  normalizarHex,
  normalizarCorIdentidade,
  normalizarCorLegadaParaIdentidade,
  corHexIdentidade,
  contrasteTextoAutomatico,
  listarPaletaIdentidadeVisual
};
