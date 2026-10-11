"use strict";

// PostgreSQL jsonb rejects escaped orphan surrogates and U+0000. Keep all
// valid Unicode (including surrogate pairs) unchanged at the JSONB boundary.
function sanitizarTextoJsonb(valor) {
  let saida = "";
  for (let indice = 0; indice < valor.length; indice += 1) {
    const codigo = valor.charCodeAt(indice);
    if (codigo >= 0xD800 && codigo <= 0xDBFF) {
      const proximo = valor.charCodeAt(indice + 1);
      if (proximo >= 0xDC00 && proximo <= 0xDFFF) {
        saida += valor[indice] + valor[++indice];
      } else {
        saida += "\uFFFD";
      }
    } else if (codigo >= 0xDC00 && codigo <= 0xDFFF) {
      saida += "\uFFFD";
    } else if (codigo !== 0) {
      saida += valor[indice];
    }
  }
  return saida;
}

function sanitizarValorJsonb(valor) {
  if (typeof valor === "string") return sanitizarTextoJsonb(valor);
  if (Array.isArray(valor)) return valor.map(sanitizarValorJsonb);
  if (valor && typeof valor === "object") {
    if (typeof valor.toJSON === "function") {
      return sanitizarValorJsonb(valor.toJSON());
    }
    const saida = {};
    for (const [chave, item] of Object.entries(valor)) {
      Object.defineProperty(saida, sanitizarTextoJsonb(chave), {
        value: sanitizarValorJsonb(item), enumerable: true, writable: true,
        configurable: true
      });
    }
    return saida;
  }
  return valor;
}

function serializarJsonbSeguro(valor, fallback) {
  const base = sanitizarValorJsonb(valor === undefined ? fallback : valor);
  const serializado = JSON.stringify(base);
  return serializado === undefined ? JSON.stringify(fallback) : serializado;
}

module.exports = { sanitizarValorJsonb, serializarJsonbSeguro };
