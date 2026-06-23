function limparLinkRadar(link = "") {
  return String(link || "")
    .trim()
    .replace(/[)\].,;!?]+$/g, "");
}

function extrairLinksRadar(texto = "") {
  const encontrados = String(texto || "").match(/\b(?:https?:\/\/|www\.)[^\s<>"']+/gi) || [];
  const unicos = new Set();

  for (const link of encontrados) {
    const limpo = limparLinkRadar(link);
    if (!limpo) continue;

    unicos.add(limpo.startsWith("www.") ? `https://${limpo}` : limpo);
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
  const fonte = String(texto || "");
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
  const cupom = extrairCupomTextoRadarGenerico(texto);
  const linksResgate = [];
  const beneficiosPorLink = {};

  for (const link of links) {
    const trecho = trechoProximoLinkRadar(texto, link);
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
  const beneficioExtra = beneficioResgate || (normalizarTextoCupomRadar(texto).includes("fretegratis") ? "Frete gratis" : "");

  return {
    cupom,
    cupomOrigem: cupom ? "texto_grupo" : "",
    cupomDetectadoTexto: Boolean(cupom),
    tipoCupom: cupom ? "texto" : (beneficioResgate ? "resgate" : ""),
    beneficioExtra,
    avisoCupom: cupom ? `Cupom detectado na mensagem: ${cupom}` : (beneficioResgate ? "Link de resgate de cupom detectado na mensagem" : ""),
    linkResgateCupom: beneficioResgate,
    linksResgate,
    beneficiosPorLink
  };
}

module.exports = {
  limparLinkRadar,
  extrairLinksRadar,
  normalizarCupomMensagemRadar,
  extrairCupomTextoRadar: extrairCupomTextoRadarGenerico,
  trechoProximoLinkRadar,
  textoIndicaResgateCupomRadar,
  linkPareceResgateCupomRadar,
  textoIndicaPaginaResgateCupomRadar,
  analisarBeneficiosMensagemRadar
};
