const { normalizarNumeroMoeda } = require("../../utils/moeda");
const { registrarRadarCupons } = require("../cupons/radar");

let ultimoTotalCuponsAmazon = 0;

function normalizarTextoAmazon(html = "") {
  return corrigirMojibakeAmazon(String(html || ""))
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : " ";
    })
    .replace(/&#([0-9]+);/gi, (_, dec) => {
      const code = parseInt(dec, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : " ";
    })
    .replace(/\\u00a0/gi, " ")
    .replace(/\\u([0-9a-f]{4})/gi, (_, hex) => {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCharCode(code) : " ";
    })
    .replace(/\s+/g, " ")
    .trim();
}

function corrigirMojibakeAmazon(texto = "") {
  return String(texto || "")
    .replace(/H\u00c3\u00a1/g, "Há")
    .replace(/h\u00c3\u00a1/g, "há")
    .replace(/p\u00c3\u00a1gina/g, "página")
    .replace(/dispon\u00c3\u00advel/g, "disponível")
    .replace(/c\u00c3\u00b3digo/g, "código")
    .replace(/n\u00c3\u00a3o/g, "não")
    .replace(/\u00c3\u00a3/g, "ã")
    .replace(/\u00c3\u00a1/g, "á")
    .replace(/\u00c3\u00a9/g, "é")
    .replace(/\u00c3\u00ad/g, "í")
    .replace(/\u00c3\u00b3/g, "ó")
    .replace(/\u00c3\u00ba/g, "ú")
    .replace(/\u00c3\u00a7/g, "ç");
}

function limparBeneficioAmazon(texto = "") {
  return String(texto || "")
    .replace(/\s+/g, " ")
    .replace(/[.,;:]+$/g, "")
    .trim();
}

function formatarValorCupomAmazon(texto = "") {
  const match = String(texto || "").match(/R\$\s*\d{1,5}(?:[.,]\d{1,2})?/i);
  return match ? match[0].replace(/\s+/g, " ").trim().toUpperCase() : "";
}

function formatarPercentualCupomAmazon(texto = "") {
  const match = String(texto || "").match(/\d{1,3}\s*%/);
  return match ? match[0].replace(/\s+/g, "").trim() : "";
}

function numeroMoedaAmazon(valor = "") {
  const numero = normalizarNumeroMoeda(valor);
  return numero !== null ? numero : 0;
}

function validarCupomMonetarioAmazon(oferta = {}, item = {}) {
  const preco = numeroMoedaAmazon(oferta.precoAtual || oferta.preco || oferta.valor || "");
  const valorCupom = numeroMoedaAmazon(
    item.cupomValor ||
    item.valorCupom ||
    item.avisoCupom ||
    item.beneficioExtra ||
    item.beneficioDetectado ||
    ""
  );

  if (!preco || !valorCupom) {
    return { ok: true, suspeito: false, preco, valorCupom };
  }

  if (valorCupom > preco) {
    return {
      ok: false,
      suspeito: true,
      motivo: "cupom_monetario_incompativel_com_preco",
      preco,
      valorCupom
    };
  }

  if (valorCupom >= preco * 0.7) {
    return {
      ok: true,
      suspeito: true,
      motivo: "cupom_monetario_suspeito_70_pct_preco",
      preco,
      valorCupom
    };
  }

  return { ok: true, suspeito: false, preco, valorCupom };
}

function montarBeneficioAmazon({ tipoCupom, valorCupom = "", percentualCupom = "" } = {}) {
  if (valorCupom) {
    return {
      tipoCupom: tipoCupom || "valor_amazon",
      cupomValor: valorCupom,
      avisoCupom: `${valorCupom} OFF no cupom/pagina`,
      beneficioExtra: `${valorCupom} OFF no cupom/pagina`,
      beneficioDetectado: valorCupom
    };
  }

  if (percentualCupom) {
    return {
      tipoCupom: tipoCupom || "percentual_amazon",
      cupomPercentual: percentualCupom,
      avisoCupom: `${percentualCupom} OFF no cupom/pagina`,
      beneficioExtra: `${percentualCupom} OFF no cupom/pagina`,
      beneficioDetectado: percentualCupom
    };
  }

  return null;
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
    "HTTPS",
    "CLIENTE",
    "PARA"
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

  const cupomValor = formatarValorCupomAmazon(
    texto.match(/cupom\s+(?:de\s+)?R\$\s*\d{1,5}(?:[.,]\d{1,2})?/i)?.[0] ||
    texto.match(/R\$\s*\d{1,5}(?:[.,]\d{1,2})?\s*(?:de\s*)?(?:cupom|off|desconto)/i)?.[0] ||
    texto.match(/(?:economize|ganhe|desconto)\s+R\$\s*\d{1,5}(?:[.,]\d{1,2})?/i)?.[0] ||
    ""
  );

  if (cupomValor) {
    return montarBeneficioAmazon({
      tipoCupom: "valor_amazon",
      valorCupom: cupomValor
    });
  }

  const cupomPercentual = formatarPercentualCupomAmazon(
    texto.match(/cupom\s+(?:de\s+)?\d{1,3}\s*%/i)?.[0] ||
    texto.match(/\d{1,3}\s*%\s*(?:off|de desconto|adicional|no cupom|com cupom)/i)?.[0] ||
    ""
  );

  if (cupomPercentual) {
    return montarBeneficioAmazon({
      tipoCupom: "percentual_amazon",
      percentualCupom: cupomPercentual
    });
  }

  if (/\b(app|aplicativo)\b/i.test(texto) && /(exclusiv|oferta|desconto)/i.test(texto)) {
    return {
      beneficioDetectado: "app",
      tipoCupom: "desconto_app_amazon",
      descontoApp: "Oferta exclusiva App",
      beneficioExtra: "Oferta exclusiva App",
      avisoCupom: "Oferta exclusiva App"
    };
  }

  if (/\bpix\b/i.test(texto) && /(desconto|economize|off|pagando)/i.test(texto)) {
    return {
      beneficioDetectado: "pix",
      tipoCupom: "desconto_pix_amazon",
      descontoPix: "Desconto PIX disponível",
      beneficioExtra: "Desconto PIX disponível",
      avisoCupom: "Desconto PIX disponível"
    };
  }

  if (/aplicar\s+cupom/i.test(texto) || textoLower.includes("aplicar cupom")) {
    return {
      beneficioDetectado: "cupom_disponivel",
      tipoCupom: "resgate_pagina_amazon",
      beneficioExtra: "Cupom disponível na página",
      avisoCupom: "Cupom disponível na página"
    };
  }

  if (/desconto\s+ao\s+finalizar/i.test(texto) || textoLower.includes("desconto ao finalizar")) {
    return {
      beneficioDetectado: "desconto_ao_finalizar",
      tipoCupom: "desconto_finalizacao_amazon",
      beneficioExtra: "Desconto ao finalizar",
      avisoCupom: "Desconto ao finalizar"
    };
  }

  if (/\bcupom\b/i.test(texto)) {
    return {
      beneficioDetectado: "cupom_disponivel",
      tipoCupom: "resgate_pagina_amazon",
      beneficioExtra: "Cupom disponível na página",
      avisoCupom: "Cupom disponível na página"
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
        tipoCupom: beneficio.tipoCupom || "resgate_pagina_amazon",
        avisoCupom: beneficio.avisoCupom,
        beneficioDetectado: beneficio.beneficioDetectado || "",
        beneficioExtra: beneficio.beneficioExtra || "",
        descontoPix: beneficio.descontoPix || "",
        descontoApp: beneficio.descontoApp || "",
        cupomValor: beneficio.cupomValor || "",
        cupomPercentual: beneficio.cupomPercentual || ""
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
      avisoCupom: `Cupom: ${cupom}`,
      beneficioExtra: `Cupom: ${cupom}`
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
    const validacaoMonetaria = validarCupomMonetarioAmazon(oferta, aviso);

    if (!validacaoMonetaria.ok) {
      console.log("[AMZ-CUPOM-OFERTA] monetario incompativel", {
        titulo: oferta.titulo || oferta.nome || "",
        preco: validacaoMonetaria.preco,
        valorCupom: validacaoMonetaria.valorCupom,
        motivo: validacaoMonetaria.motivo
      });

      return null;
    }

    const resultado = {
      cupom: "",
      tipoCupom: aviso.tipoCupom || "resgate_pagina_amazon",
      avisoCupom: aviso.avisoCupom || "Cupom disponível na página",
      beneficioExtra: aviso.beneficioExtra || aviso.avisoCupom || "Cupom disponível na página",
      descontoPix: aviso.descontoPix || "",
      descontoApp: aviso.descontoApp || "",
      cupomValor: aviso.cupomValor || "",
      cupomPercentual: aviso.cupomPercentual || "",
      cupomSuspeito: validacaoMonetaria.suspeito === true,
      avisosInternos: validacaoMonetaria.motivo ? [validacaoMonetaria.motivo] : []
    };

    console.log("[AMZ-CUPOM-OFERTA]", {
      titulo: oferta.titulo || oferta.nome || "",
      tipoCupom: resultado.tipoCupom,
      cupom: "",
      cupomSuspeito: resultado.cupomSuspeito === true
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



