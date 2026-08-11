const {
  extrairCodigosCupomSemanticos,
  normalizarCodigoCupomSemantico
} = require("../modules/radar/cupom-semantico");
const {
  classificarLinkComercial,
  classificarLinksComerciais
} = require("../modules/radar/links-comerciais");

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
  const links = [];

  for (const link of encontrados) {
    const limpo = normalizarLinkExtraidoRadar(link);
    if (!limpo) continue;

    if (links.includes(limpo)) {
      logRadarSeguro("[RADAR-LINK-REPETIDO-PRESERVADO]", {
        host: dominioLinkRadar(limpo)
      });
    }

    logLinkReconhecidoRadar(limpo);
    links.push(limpo);
  }

  return links;
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
  return normalizarCodigoCupomSemantico(cupom);

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
    "ANUNCIO",
    "MENSAGEM",
    "DETECTADO",
    "HTTP",
    "HTTPS",
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
  if (/\b\d{1,2}\s*%/.test(original) && /\b(?:cupom|desconto)\s+de\b/i.test(original)) return "";
  if (/(?:^|_)O?CUPOMDE\d/i.test(codigo)) return "";
  if (/(ANUNCIO|MENSAGEM|DETECTADO|HTTPS?)/i.test(codigo)) return "";
  if (/^(HTTP|HTTPS|WWW|TAG|UTM|AWINAFFID|LINKCODE|CREATIVE|CAMP|REF)$/i.test(codigo)) return "";
  if (originalLower.includes("tag=") || originalLower.includes("utm_")) return "";

  return codigo;
}

function extrairCupomTextoRadar(texto = "") {
  return extrairCodigosCupomSemanticos(texto)[0] || "";

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
  return extrairCodigosCupomSemanticos(limparUnicodeInvisivelRadar(texto))[0] || "";

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
  const fonteSemantica = limparUnicodeInvisivelRadar(texto);
  const resultadosSemanticos = extrairCodigosCupomSemanticos(fonteSemantica);
  const modoSemantico = resultadosSemanticos.length > 1
    ? (/\bou\b/i.test(fonteSemantica) ? "alternativo" : ((/[+,;]/.test(fonteSemantica) || /\s+e\s+/i.test(fonteSemantica)) ? "combinado" : "multiplo"))
    : "";

  if (resultadosSemanticos.length > 1) {
    logRadarSeguro("[RADAR-CUPONS-MULTIPLOS-EXTRAIDOS]", {
      total: resultadosSemanticos.length,
      modoCupom: modoSemantico || "multiplo"
    });
  }

  return {
    cupons: resultadosSemanticos,
    modoCupom: resultadosSemanticos.length > 1 ? (modoSemantico || "multiplo") : ""
  };

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
      if (/\b\d{1,2}\s*%/.test(trecho) && /\b(?:cupom|desconto)\s+de\b/i.test(trecho)) continue;
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
  return classificarLinkComercial({ url: link }).tipo === "resgate";
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

function linkShopeeRadar(link = "") {
  const host = dominioLinkRadar(link);
  return host === "shopee.com.br" ||
    host.endsWith(".shopee.com.br") ||
    host === "s.shopee.com.br" ||
    host.endsWith(".s.shopee.com.br");
}

function textoResumoResgateRadar(trecho = "") {
  const linhas = String(trecho || "")
    .split(/\r?\n| {2,}/)
    .map(linha => linha.replace(/https?:\/\/\S+/gi, "").replace(/^[-:•\s]+/, "").trim())
    .filter(Boolean)
    .filter(linha => /cupom|voucher|resgat|pegue|pegar|colet|apli|off/i.test(linha));

  return (linhas[0] || "").slice(0, 160);
}

function enriquecerLinksResgateShopeeRadar(texto = "", links = [], estado = {}) {
  const linksShopee = links.filter(linkShopeeRadar);
  if (linksShopee.length < 2) return estado;
  const classificacoes = new Map(
    (classificarLinksComerciais({ texto }).classificados || []).map(item => [item.url, item])
  );

  const candidatosResgate = linksShopee
    .map(link => {
      const trecho = trechoProximoLinkRadar(texto, link);
      const classificacao = classificacoes.get(link) || classificarLinkComercial({
        url: link,
        linhaAtual: trecho,
        contexto: trecho
      });
      return {
        link,
        trecho,
        tipo: classificacao.tipo,
        textoResgate: textoResumoResgateRadar(trecho)
      };
    })
    .filter(item => item.tipo === "resgate");

  if (!candidatosResgate.length) return estado;

  const linksResgateSet = new Set(estado.linksResgate || []);
  const candidatosProduto = linksShopee.filter(link =>
    !linksResgateSet.has(link) &&
    !candidatosResgate.some(item => item.link === link)
  );

  if (!candidatosProduto.length) return estado;

  const beneficiosPorLink = { ...(estado.beneficiosPorLink || {}) };
  const linksResgate = [...(estado.linksResgate || [])];

  for (const item of candidatosResgate) {
    if (!linksResgate.includes(item.link)) linksResgate.push(item.link);
    beneficiosPorLink[item.link] = {
      ...(beneficiosPorLink[item.link] || {}),
      tipoCupom: "resgate",
      beneficioExtra: item.textoResgate || item.link,
      avisoCupom: item.textoResgate || "Resgate os cupons pelo link da oferta.",
      linkResgateCupom: item.link,
      resgateShopeeSemantico: true
    };
  }

  const principal = candidatosResgate[0];
  return {
    ...estado,
    linksResgate,
    beneficiosPorLink,
    tipoCupom: estado.tipoCupom || "resgate",
    beneficioExtra: estado.beneficioExtra || principal.textoResgate || principal.link,
    avisoCupom: estado.avisoCupom || principal.textoResgate || "Resgate os cupons pelo link da oferta.",
    linkResgateCupom: estado.linkResgateCupom || principal.link,
    resgateShopeeSemantico: true
  };
}

function analisarBeneficiosMensagemRadar(texto = "", links = []) {
  const fonte = limparUnicodeInvisivelRadar(texto);
  const cupom = extrairCupomTextoRadarGenerico(fonte);
  const enriquecimento = analisarEnriquecimentoTextoRadar(fonte);
  const linksResgate = [];
  const beneficiosPorLink = {};
  const classificacoes = new Map(
    (classificarLinksComerciais({ texto: fonte }).classificados || []).map(item => [item.url, item])
  );

  for (const link of links) {
    const trecho = trechoProximoLinkRadar(fonte, link);
    const cupomTrecho = extrairCupomTextoRadarGenerico(trecho);
    const classificacaoLink = classificacoes.get(link) || classificarLinkComercial({
      url: link,
      linhaAtual: trecho,
      contexto: trecho
    });
    const resgate =
      classificacaoLink.tipo === "resgate" &&
      textoIndicaPaginaResgateCupomRadar(trecho);

    if (cupomTrecho) {
      beneficiosPorLink[link] = {
        ...(beneficiosPorLink[link] || {}),
        cupom: cupomTrecho,
        cupomOrigem: "texto_grupo",
        cupomDetectadoTexto: true,
        tipoCupom: "texto",
        avisoCupom: ""
      };
    }

    if (resgate) {
      linksResgate.push(link);
      beneficiosPorLink[link] = {
        ...(beneficiosPorLink[link] || {}),
        tipoCupom: "resgate",
        beneficioExtra: link,
        avisoCupom: "Resgate os cupons pelo link da oferta.",
        linkResgateCupom: link
      };
    }
  }

  const beneficioResgate = linksResgate[0] || "";
  const beneficioExtra = beneficioResgate || (normalizarTextoCupomRadar(fonte).includes("fretegratis") ? "Frete gratis" : "");

  return enriquecerLinksResgateShopeeRadar(fonte, links, {
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
    avisoCupom: beneficioResgate ? "Resgate os cupons pelo link da oferta." : "",
    linkResgateCupom: beneficioResgate,
    linksResgate,
    beneficiosPorLink
  });
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
  enriquecerLinksResgateShopeeRadar,
  analisarBeneficiosMensagemRadar
};
