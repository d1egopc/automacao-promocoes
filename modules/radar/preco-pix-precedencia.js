"use strict";

function texto(valor = "") {
  return String(valor ?? "").trim();
}

function normalizarNumero(valor) {
  if (valor == null || valor === "") return null;
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : null;
  const bruto = texto(valor);
  if (/(^|[^\d])-+\s*(?:R\$)?\s*\d/i.test(bruto)) return null;
  const entrada = bruto
    .replace(/R\$/gi, "")
    .replace(/%/g, "")
    .replace(/\s/g, "");
  if (!entrada) return null;
  const temVirgula = entrada.includes(",");
  const temPonto = entrada.includes(".");
  const normalizado = temVirgula && temPonto
    ? entrada.replace(/\./g, "").replace(",", ".")
    : temVirgula
      ? entrada.replace(",", ".")
      : entrada;
  const numero = Number(normalizado);
  return Number.isFinite(numero) ? numero : null;
}

function numeroMonetarioEmTexto(valor) {
  const direto = normalizarNumero(valor);
  if (direto != null) return direto;
  const bruto = texto(valor);
  if (/(^|[^\d])-+\s*(?:R\$)?\s*\d/i.test(bruto)) return null;
  const match = bruto.match(/(?:R\$\s*)?\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?|(?:R\$\s*)?\d+(?:[,.]\d{1,2})?/);
  return match ? normalizarNumero(match[0]) : null;
}

function chaveValorPix(valor = "") {
  const numero = numeroMonetarioEmTexto(valor);
  return numero == null ? "" : numero.toFixed(2);
}

function textoPixValido(valor = "") {
  const original = texto(valor);
  if (!original) return "";
  if (/[A-Za-zÀ-ÿ]/.test(original) && !/\bpix\b/i.test(original) && !/(?:R\$|US\$|USD|U\$|\$)/i.test(original)) return "";
  const numero = numeroMonetarioEmTexto(original);
  if (numero == null || numero <= 0) return "";
  return original;
}

function valorCandidatoPix(candidato) {
  return typeof candidato === "object" && candidato !== null
    ? texto(candidato.valor ?? candidato.texto ?? candidato.evidencia ?? candidato.precoPix ?? candidato.condicaoPix)
    : texto(candidato);
}

function contextoCandidatoPix(candidato) {
  if (!candidato || typeof candidato !== "object") return valorCandidatoPix(candidato);
  return [
    candidato.valor,
    candidato.texto,
    candidato.evidencia,
    candidato.condicaoPix,
    candidato.papel,
    candidato.tipo,
    candidato.campo,
    candidato.origem,
    candidato.fonte,
    candidato.autoridade,
    candidato.motivo
  ].map(texto).filter(Boolean).join(" ");
}

function candidatoPixInequivoco(candidato) {
  if (!candidato || typeof candidato !== "object") {
    return /\bpix\b/i.test(valorCandidatoPix(candidato));
  }
  if (candidato.papelPixConfiavel === true || candidato.fontePixOficial === true) return true;
  return /\bpix\b/i.test(contextoCandidatoPix(candidato));
}

function primeiroPixValido(candidatos = []) {
  for (const candidato of Array.isArray(candidatos) ? candidatos : [candidatos]) {
    if (!candidatoPixInequivoco(candidato)) continue;
    const valor = valorCandidatoPix(candidato);
    const pix = textoPixValido(valor);
    if (pix) return pix;
  }
  return "";
}

function resolverPrecedenciaPrecoPix({ radar = [], api = [], outras = [] } = {}) {
  const pixRadar = primeiroPixValido(radar);
  const pixApi = primeiroPixValido(api);
  const pixOutro = primeiroPixValido(outras);

  if (pixRadar) {
    const divergenteApi = pixApi && chaveValorPix(pixApi) !== chaveValorPix(pixRadar);
    return {
      precoPix: pixRadar,
      origem: "radar",
      autoridade: "radar_pix_explicito",
      auditoria: divergenteApi
        ? { precoPixReferenciaApi: pixApi, divergenciaApi: true }
        : (pixApi ? { precoPixReferenciaApi: pixApi, divergenciaApi: false } : {})
    };
  }

  if (pixApi) {
    return {
      precoPix: pixApi,
      origem: "api",
      autoridade: "api_pix_oficial_sem_radar",
      auditoria: {}
    };
  }

  if (pixOutro) {
    return {
      precoPix: pixOutro,
      origem: "campos_estruturados",
      autoridade: "pix_estruturado_sem_radar",
      auditoria: {}
    };
  }

  return {
    precoPix: "",
    origem: "ausente",
    autoridade: "sem_pix_publicavel",
    auditoria: {}
  };
}

module.exports = {
  chaveValorPix,
  numeroMonetarioEmTexto,
  resolverPrecedenciaPrecoPix,
  textoPixValido
};
