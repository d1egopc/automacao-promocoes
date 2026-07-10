function logRadarSeguro(evento, payload = {}) {
  console.log(evento, JSON.stringify(payload));
}

function limparUnicodeInvisivelRadar(texto = "") {
  const original = String(texto || "");
  const limpo = original
    .replace(/[\u200B\u200C\u200D\u2060\uFEFF]/g, "")
    .replace(/\u00A0/g, " ");

  if (limpo !== original) {
    logRadarSeguro("[RADAR-UNICODE-INVISIVEL-LIMPO]", {
      tamanhoAntes: original.length,
      tamanhoDepois: limpo.length
    });
  }

  return limpo;
}

function limparLinkRadar(link = "") {
  return limparUnicodeInvisivelRadar(link)
    .trim()
    .replace(/[)\].,;!?]+$/g, "");
}

function normalizarLinkExtraidoRadar(link = "") {
  const limpo = limparLinkRadar(link);
  return limpo.startsWith("www.") ? `https://${limpo}` : limpo;
}

function dominioLinkRadar(link = "") {
  try {
    return new URL(link).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function logLinkReconhecidoRadar(link = "") {
  const host = dominioLinkRadar(link);
  if (host === "a.aliexpress.com" || host === "s.click.aliexpress.com") {
    logRadarSeguro("[RADAR-ALIEXPRESS-LINK-RECONHECIDO]", {
      host,
      tipo: host === "a.aliexpress.com" ? "app" : "redirect"
    });
  }
}

function extrairLinksRadar(texto = "") {
  const fonte = limparUnicodeInvisivelRadar(texto);
  const encontrados = fonte.match(/(?:https?:\/\/|www\.)[^\s<>"']+/gi) || [];
  const unicos = new Set();

  for (const link of encontrados) {
    const limpo = normalizarLinkExtraidoRadar(link);
    if (!limpo) continue;

    if (unicos.has(limpo)) {
      logRadarSeguro("[RADAR-LINK-REPETIDO-IGNORADO]", {
        host: dominioLinkRadar(limpo)
      });
      continue;
    }

    logLinkReconhecidoRadar(limpo);
    unicos.add(limpo);
  }

  return [...unicos];
}

function normalizarTextoCupomRadar(texto = "") {
  return String(texto || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, "e")
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

function normalizarCupomMensagemRadar(cupom = "") {
  const original = String(cupom || "").trim();
  const originalLower = original.toLowerCase();

  if (!original) return "";
  if (/https?:\/\//i.test(original) || /^www\./i.test(original)) return "";
  if (/[/?#=&]/.test(original)) return "";
  if (/(utm_|awinaffid|linkcode|creative|camp|ref=|tag=)/i.test(original)) return "";

  const codigo = original
    .replace(/[.,;:!?)\]}]+$/g, "")
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9_-]/g, "")
    .trim();

  const bloqueados = new Set([
    "CUPOM",
    "CUPONS",
    "CODIGO",
    "PROMOCAO",
    "PROMO",
    "DESCONTO",
    "PRODUTO",
    "TODOS",
    "TODAS",
    "DESTA",
    "DESSE",
    "DESSA",
    "PAGINA",
    "LOJA",
    "OFICIAL",
    "LINK",
    "LINKS",
    "APP",
    "SITE",
    "RESGATE",
    "RESGATAR",
    "SHOPEE",
    "AMAZON",
    "MERCADOLIVRE",
    "MERCADOLIVRECOMBR",
    "D1EGOPCOFF-20",
    "WOLFZERA08-20"
  ]);

  if (!codigo || codigo.length < 4 || codigo.length > 30) return "";
  if (bloqueados.has(codigo)) return "";
  if (/^(HTTP|HTTPS|WWW|TAG|UTM|AWINAFFID|LINKCODE|CREATIVE|CAMP|REF)$/i.test(codigo)) return "";
  if (originalLower.includes("tag=") || originalLower.includes("utm_")) return "";

  return codigo;
}

function extrairCupomTextoRadar(texto = "") {
  const fonte = String(texto || "");
  const padroes = [
    /(?:use\s+o\s+cupom|use\s+cupom|use|cupom|resgate\s+o\s+cupom|resgate\s+cupom|resgate|aplique\s+o\s+cupom|aplique\s+cupom|aplique|com\s+o\s+cupom|com\s+cupom|usando\s+o\s+cupom|utilize\s+o\s+cupom)\s*[:\-]?\s*([A-Z0-9][A-Z0-9_-]{3,29})/gi,
    /(?:resgate\s+os\s+cupons|cupons)\s*[:\-]\s*([A-Z0-9][A-Z0-9_-]{3,29})/gi,
    /(?:codigo|c[oó]digo|coupon)\s*[:\-]?\s*([A-Z0-9][A-Z0-9_-]{3,29})/gi
  ];

  for (const regex of padroes) {
    let match;
    while ((match = regex.exec(fonte))) {
      const cupom = normalizarCupomMensagemRadar(match[1]);
      if (cupom) return cupom;
    }
  }

  return "";
}

function extrairCupomTextoRadarGenerico(texto = "") {
  const fonte = limparUnicodeInvisivelRadar(texto);
  const padroes = [
    /(?:use\s+o\s+cupom|use\s+cupom|use|cupom|resgate\s+o\s+cupom|resgate\s+cupom|resgate|aplique\s+o\s+cupom|aplique\s+cupom|aplique|com\s+o\s+cupom|com\s+cupom|usando\s+o\s+cupom|utilize\s+o\s+cupom)\s*[:\-]?\s*([A-Z0-9][A-Z0-9_-]{3,29})/gi,
    /(?:resgate\s+os\s+cupons|cupons)\s*[:\-]\s*([A-Z0-9][A-Z0-9_-]{3,29})/gi,
    /(?:codigo|c[oó]digo|promocode|promo\s*code|coupon)\s*[:\-]?\s*([A-Z0-9][A-Z0-9_-]{3,29})/gi
  ];

  for (const regex of padroes) {
    let match;
    while ((match = regex.exec(fonte))) {
      const cupom = normalizarCupomMensagemRadar(match[1]);
      if (cupom) return cupom;
    }
  }

  return "";
}

function extrairCuponsMultiplosRadar(texto = "") {
  const fonte = limparUnicodeInvisivelRadar(texto);
  const resultados = [];
  let modoCupom = "";
  const padroes = [
    /(?:cupons?|cupom|use|aplique|resgate|codigo|c[oó]digo)\s*[:\-]?\s*([A-Z0-9][A-Z0-9_+\-,\s]{3,120})/gi
  ];

  for (const padrao of padroes) {
    let match;
    while ((match = padrao.exec(fonte))) {
      const trecho = String(match[1] || "")
        .split(/\s+(?:no|na|em|para|por|pelo|pela|link|site|app)\b/i)[0];
      const temOu = /\bou\b/i.test(trecho);
      const temCombinado = /[+,]|(?:\s+e\s+)/i.test(trecho);
      const partes = trecho.split(/\s+ou\s+|[+,]|\s+e\s+/i);

      if (temOu) modoCupom = modoCupom || "alternativo";
      if (temCombinado) modoCupom = modoCupom || "combinado";

      for (const parte of partes) {
        const cupom = normalizarCupomMensagemRadar(parte);
        if (cupom && !resultados.includes(cupom)) resultados.push(cupom);
      }
    }
  }

  if (resultados.length > 1) {
    logRadarSeguro("[RADAR-CUPONS-MULTIPLOS-EXTRAIDOS]", {
      total: resultados.length,
      modoCupom: modoCupom || "multiplo"
    });
  }

  return {
    cupons: resultados,
    modoCupom: resultados.length > 1 ? (modoCupom || "multiplo") : ""
  };
}

function extrairQuantidadeMoedasRadar(texto = "") {
  const fonte = limparUnicodeInvisivelRadar(texto);
  const match = fonte.match(/(\d{1,6})\s*(?:moedas?|coins?)/i);
  return match ? Number(match[1]) : null;
}

function analisarEnriquecimentoTextoRadar(texto = "") {
  const fonte = limparUnicodeInvisivelRadar(texto);
  const normalizado = normalizarTextoCupomRadar(fonte);
  const cupons = extrairCuponsMultiplosRadar(fonte);
  const exigeMoedas = /\bmoedas?\b/i.test(fonte);
  const quantidadeMoedas = extrairQuantidadeMoedasRadar(fonte);

  return {
    ...cupons,
    exigeApp: /\b(?:use\s+o\s+app|pelo\s+app|no\s+app|valor\s+no\s+app|app)\b/i.test(fonte),
    exigeMoedas,
    quantidadeMoedas: quantidadeMoedas || null,
    estoqueBrasil: normalizado.includes("estoquenobrasil") || normalizado.includes("estoquebrasil"),
    freteInformado: /frete\s+(?:gr[aá]tis|varia|por\s+estado)/i.test(fonte)
  };
}

function trechoProximoLinkRadar(texto = "", link = "") {
  const fonte = String(texto || "");
  const alvo = String(link || "");
  const linhas = fonte.split(/\r?\n/);

  for (let i = 0; i < linhas.length; i++) {
    if (linhas[i].includes(alvo)) {
      return [
        linhas[Math.max(0, i - 1)] || "",
        linhas[i] || "",
        linhas[Math.min(linhas.length - 1, i + 1)] || ""
      ].join(" ");
    }
  }

  const indice = fonte.indexOf(alvo);
  if (indice < 0) return fonte.slice(0, 500);

  return fonte.slice(Math.max(0, indice - 180), Math.min(fonte.length, indice + alvo.length + 180));
}

function textoIndicaResgateCupomRadar(texto = "") {
  const normalizado = normalizarTextoCupomRadar(texto);

  return (
    normalizado.includes("resgate") ||
    normalizado.includes("resgatar") ||
    normalizado.includes("pegarcupom") ||
    normalizado.includes("coletarcupom") ||
    normalizado.includes("cupomdapagina") ||
    normalizado.includes("cuponsdestapagina") ||
    normalizado.includes("todososcupons") ||
    normalizado.includes("paginadecupons")
  );
}

function linkPareceResgateCupomRadar(link = "") {
  const url = String(link || "").toLowerCase();

  if (!url) return false;

  return (
    url.includes("/voucher") ||
    url.includes("/coupon") ||
    url.includes("/cupom") ||
    url.includes("coupon") ||
    url.includes("voucher") ||
    url.includes("cupon") ||
    url.includes("cupons")
  );
}

function textoIndicaPaginaResgateCupomRadar(texto = "") {
  const normalizado = normalizarTextoCupomRadar(texto);

  return (
    normalizado.includes("resgatetodososcupons") ||
    normalizado.includes("resgatartodososcupons") ||
    normalizado.includes("resgateoscuponsdestapagina") ||
    normalizado.includes("resgatetodososcuponsdestapagina") ||
    normalizado.includes("todososcuponsdestapagina") ||
    normalizado.includes("paginadecupons") ||
    normalizado.includes("linkderesgatedecupom") ||
    normalizado.includes("resgatedecupom")
  );
}

function analisarBeneficiosMensagemRadar(texto = "", links = []) {
  const fonte = limparUnicodeInvisivelRadar(texto);
  const cupom = extrairCupomTextoRadarGenerico(fonte);
  const enriquecimento = analisarEnriquecimentoTextoRadar(fonte);
  const linksResgate = [];
  const beneficiosPorLink = {};

  for (const link of links) {
    const trecho = trechoProximoLinkRadar(fonte, link);
    const cupomTrecho = extrairCupomTextoRadarGenerico(trecho);
    const resgate =
      linkPareceResgateCupomRadar(link) &&
      textoIndicaPaginaResgateCupomRadar(trecho);

    if (cupomTrecho) {
      beneficiosPorLink[link] = {
        ...(beneficiosPorLink[link] || {}),
        cupom: cupomTrecho,
        cupomOrigem: "texto_grupo",
        cupomDetectadoTexto: true,
        tipoCupom: "texto",
        avisoCupom: `Cupom detectado na mensagem: ${cupomTrecho}`
      };
    }

    if (resgate) {
      linksResgate.push(link);
      beneficiosPorLink[link] = {
        ...(beneficiosPorLink[link] || {}),
        tipoCupom: "resgate",
        beneficioExtra: link,
        avisoCupom: "Link de resgate de cupom detectado na mensagem",
        linkResgateCupom: link
      };
    }
  }

  const beneficioResgate = linksResgate[0] || "";
  const beneficioExtra = beneficioResgate || (normalizarTextoCupomRadar(fonte).includes("fretegratis") ? "Frete gratis" : "");

  return {
    cupom,
    cupons: enriquecimento.cupons,
    modoCupom: enriquecimento.modoCupom,
    cupomOrigem: cupom ? "texto_grupo" : "",
    cupomDetectadoTexto: Boolean(cupom),
    tipoCupom: cupom ? "texto" : (beneficioResgate ? "resgate" : ""),
    exigeApp: enriquecimento.exigeApp,
    exigeMoedas: enriquecimento.exigeMoedas,
    quantidadeMoedas: enriquecimento.quantidadeMoedas,
    estoqueBrasil: enriquecimento.estoqueBrasil,
    freteInformado: enriquecimento.freteInformado,
    beneficioExtra,
    avisoCupom: cupom ? `Cupom detectado na mensagem: ${cupom}` : (beneficioResgate ? "Link de resgate de cupom detectado na mensagem" : ""),
    linkResgateCupom: beneficioResgate,
    linksResgate,
    beneficiosPorLink
  };
}

module.exports = {
  limparUnicodeInvisivelRadar,
  limparLinkRadar,
  extrairLinksRadar,
  extrairCuponsMultiplosRadar,
  normalizarCupomMensagemRadar,
  extrairCupomTextoRadar: extrairCupomTextoRadarGenerico,
  trechoProximoLinkRadar,
  textoIndicaResgateCupomRadar,
  linkPareceResgateCupomRadar,
  textoIndicaPaginaResgateCupomRadar,
  analisarBeneficiosMensagemRadar
};
