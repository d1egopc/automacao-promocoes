const { registrarRadarCupons } = require("../cupons/radar");

let ultimoTotalCuponsAmazon = 0;

function normalizarTextoAmazon(html = "") {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#x?([0-9a-f]+);/gi, " ")
    .replace(/\\u00a0/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function limparBeneficioAmazon(texto = "") {
  return String(texto || "")
    .replace(/\s+/g, " ")
    .replace(/[.,;:]+$/g, "")
    .trim();
}

function pareceCupomRealAmazon(texto = "") {
  const cupom = String(texto || "")
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "")
    .trim();

  if (cupom.length < 5 || cupom.length > 40) return false;
  if (!/[A-Z]/.test(cupom)) return false;

  const bloqueados = new Set([
    "AMAZON",
    "CUPOM",
    "CUPONS",
    "PRIME",
    "APLICAR",
    "ECONOMIZE",
    "DESCONTO",
    "FINALIZAR",
    "GANHE",
    "HTML",
    "JSON",
    "SCRIPT",
    "STYLE",
    "HTTPS"
  ]);

  if (bloqueados.has(cupom)) return false;

  return /[A-Z]{3,}\d{1,}/.test(cupom) || /\d{1,}[A-Z]{3,}/.test(cupom);
}

function extrairCuponsAmazonDoHtml(html = "") {
  const texto = normalizarTextoAmazon(html);
  const candidatos = [];

  function adicionar(codigo, origem, trecho = "") {
    const cupom = String(codigo || "")
      .toUpperCase()
      .replace(/[^A-Z0-9_-]/g, "")
      .trim();

    if (!pareceCupomRealAmazon(cupom)) return;

    candidatos.push({
      cupom,
      tipoCupom: "confirmado_amazon",
      origem,
      trecho: limparBeneficioAmazon(trecho).slice(0, 180)
    });
  }

  const regexContextuais = [
    /(?:use|aplique|aplicar|cupom|codigo|c[oó]digo)\s*:?-?\s*([A-Z0-9_-]{5,40})/gi,
    /"(?:couponCode|coupon_code|promoCode|promotionCode|code)"\s*:\s*"([A-Z0-9_-]{5,40})"/gi
  ];

  for (const regex of regexContextuais) {
    let match;

    while ((match = regex.exec(texto)) !== null) {
      const inicio = Math.max(0, match.index - 120);
      const fim = Math.min(texto.length, match.index + 220);
      adicionar(match[1], "html_amazon", texto.slice(inicio, fim));
    }
  }

  const unicos = Array.from(
    new Map(candidatos.map(item => [item.cupom, item])).values()
  );

  ultimoTotalCuponsAmazon = unicos.length;

  return unicos;
}

function detectarBeneficioAmazon(html = "") {
  const texto = normalizarTextoAmazon(html);
  const textoLower = texto.toLowerCase();

  const cupomValor =
    texto.match(/cupom\s+de\s+R\$\s*\d{1,4}(?:[.,]\d{1,2})?/i)?.[0] ||
    texto.match(/R\$\s*\d{1,4}(?:[.,]\d{1,2})?\s*(?:de\s*)?cupom/i)?.[0] ||
    "";

  if (cupomValor) {
    const beneficio = limparBeneficioAmazon(cupomValor);
    return {
      beneficioDetectado: beneficio,
      avisoCupom: `Cupom disponivel na pagina: ${beneficio}. Aplique antes de finalizar.`
    };
  }

  const economia =
    texto.match(/economize\s+R\$\s*\d{1,4}(?:[.,]\d{1,2})?/i)?.[0] ||
    texto.match(/ganhe\s+R\$\s*\d{1,4}(?:[.,]\d{1,2})?/i)?.[0] ||
    "";

  if (economia) {
    const beneficio = limparBeneficioAmazon(economia);
    return {
      beneficioDetectado: beneficio,
      avisoCupom: `Beneficio disponivel na pagina: ${beneficio}. Confira antes de finalizar.`
    };
  }

  if (/aplicar\s+cupom/i.test(texto) || textoLower.includes("aplicar cupom")) {
    return {
      beneficioDetectado: "aplicar_cupom",
      avisoCupom: "Cupom disponivel na pagina. Aplique antes de finalizar."
    };
  }

  if (/desconto\s+ao\s+finalizar/i.test(texto) || textoLower.includes("desconto ao finalizar")) {
    return {
      beneficioDetectado: "desconto_ao_finalizar",
      avisoCupom: "Desconto disponivel ao finalizar a compra. Confira antes de pagar."
    };
  }

  if (/\bcupom\b/i.test(texto)) {
    return {
      beneficioDetectado: "cupom",
      avisoCupom: "Cupom disponivel na pagina. Confira antes de finalizar."
    };
  }

  if (/\bprime\b/i.test(texto)) {
    return {
      beneficioDetectado: "prime",
      avisoCupom: "Beneficio Prime pode estar disponivel na pagina. Confira antes de finalizar."
    };
  }

  return {
    beneficioDetectado: "",
    avisoCupom: ""
  };
}

function detectarAvisoCupomAmazon(html = "") {
  const beneficio = detectarBeneficioAmazon(html);
  const aviso = beneficio.avisoCupom
    ? {
        cupom: "",
        tipoCupom: "resgate_pagina_amazon",
        avisoCupom: beneficio.avisoCupom,
        beneficioDetectado: beneficio.beneficioDetectado || ""
      }
    : null;

  console.log("[AMZ-CUPOM]", {
    cuponsEncontrados: ultimoTotalCuponsAmazon,
    beneficioDetectado: beneficio.beneficioDetectado || "",
    temAvisoCupom: Boolean(aviso)
  });

  return aviso;
}

function escolherCupomParaOfertaAmazon(oferta = {}, dados = []) {
  const lista = Array.isArray(dados)
    ? dados
    : dados
      ? [dados]
      : [];

  const confirmado = lista.find(item =>
    item?.cupom && pareceCupomRealAmazon(item.cupom)
  );

  if (confirmado) {
    const cupom = String(confirmado.cupom).toUpperCase().trim();
    const resultado = {
      cupom,
      tipoCupom: "confirmado_amazon",
      avisoCupom: `Use o cupom ${cupom} antes de finalizar a compra.`
    };

    console.log("[AMZ-CUPOM-OFERTA]", {
      titulo: oferta.titulo || oferta.nome || "",
      tipoCupom: resultado.tipoCupom,
      cupom: resultado.cupom
    });

    registrarRadarCupons("amazon", { confirmados: 1 });

    return resultado;
  }

  const aviso = lista.find(item =>
    item?.tipoCupom === "resgate_pagina_amazon" || item?.avisoCupom
  );

  if (aviso) {
    const resultado = {
      cupom: "",
      tipoCupom: "resgate_pagina_amazon",
      avisoCupom: aviso.avisoCupom || "Cupom disponivel na pagina. Confira antes de finalizar."
    };

    console.log("[AMZ-CUPOM-OFERTA]", {
      titulo: oferta.titulo || oferta.nome || "",
      tipoCupom: resultado.tipoCupom,
      cupom: ""
    });

    registrarRadarCupons("amazon", { avisos: 1 });

    return resultado;
  }

  return null;
}

module.exports = {
  extrairCuponsAmazonDoHtml,
  pareceCupomRealAmazon,
  detectarAvisoCupomAmazon,
  escolherCupomParaOfertaAmazon
};


