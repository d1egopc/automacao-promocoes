let ultimoTotalCuponsShopee = 0;

function normalizarHtml(html = "") {
  return String(html || "").replace(/\s+/g, " ");
}

function pareceCupomRealShopee(codigo = "") {
  const cupom = String(codigo || "")
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "")
    .trim();

  if (cupom.length < 5 || cupom.length > 40) return false;
  if (!/[A-Z]/.test(cupom)) return false;

  const bloqueados = new Set([
    "HTML",
    "JSON",
    "HTTP",
    "HTTPS",
    "DOCTYPE",
    "SCRIPT",
    "STYLE",
    "SHOPEE",
    "CUPOM",
    "CUPONS",
    "COUPON",
    "VOUCHER",
    "RESGATAR",
    "APLICAR",
    "VALIDO",
    "VALIDADE"
  ]);

  if (bloqueados.has(cupom)) return false;

  const palavrasFortes = [
    "SHOPEE",
    "SHOP",
    "CUPOM",
    "OFF",
    "APP",
    "FRETE",
    "DESCONTO",
    "GANHA",
    "COMPRA",
    "PROMO",
    "PIX"
  ];

  if (palavrasFortes.some(palavra => cupom.includes(palavra))) {
    return true;
  }

  return /[A-Z]{3,}\d{1,}/.test(cupom);
}

function extrairCupomUrlShopee(texto = "") {
  const match =
    texto.match(/https?:\/\/(?:shopee\.com\.br|s\.shopee\.com\.br)\/[^\s"'<>]*(?:cupom|voucher|promotion|promo)[^\s"'<>]*/i) ||
    texto.match(/"(\/[^"]*(?:cupom|voucher|promotion|promo)[^"]*)"/i);

  if (!match) return "";

  const url = String(match[1] || "").trim();
  if (!url) return "";

  if (url.startsWith("http")) return url;
  if (url.startsWith("/")) return `https://shopee.com.br${url}`;

  return "";
}

function limparBeneficioShopee(texto = "") {
  return String(texto || "")
    .replace(/\\u002F/g, "/")
    .replace(/\\u00a0/gi, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extrairBeneficioCupomShopee(html = "") {
  const texto = limparBeneficioShopee(normalizarHtml(html));
  const textoLower = texto.toLowerCase();

  const valorOff =
    texto.match(/R\$\s*\d{1,4}(?:[.,]\d{1,2})?\s*OFF/i)?.[0] ||
    texto.match(/R\$\s*\d{1,4}(?:[.,]\d{1,2})?\s*(?:de\s*)?desconto/i)?.[0] ||
    "";

  if (valorOff) {
    const beneficio = limparBeneficioShopee(valorOff).replace(/\s+/g, " ");
    return {
      beneficioDetectado: beneficio,
      avisoCupom: `Cupom disponivel na pagina: ${beneficio}. Resgate antes de finalizar.`
    };
  }

  if (/pre[cç]o\s+no\s+pix\s+com\s+cupom/i.test(texto) || textoLower.includes("no pix com cupom")) {
    return {
      beneficioDetectado: "preco_no_pix_com_cupom",
      avisoCupom: "Preco no Pix com cupom disponivel na pagina. Resgate antes de finalizar."
    };
  }

  if (/cupons?\s+de\s+loja/i.test(texto)) {
    return {
      beneficioDetectado: "cupons_de_loja",
      avisoCupom: "Cupons de loja disponiveis na pagina. Resgate antes de finalizar."
    };
  }

  if (/\bcom\s+cupom\b/i.test(texto)) {
    return {
      beneficioDetectado: "com_cupom",
      avisoCupom: "Cupom disponivel na pagina. Resgate antes de finalizar."
    };
  }

  return {
    beneficioDetectado: "",
    avisoCupom: ""
  };
}

function extrairCuponsShopeeDoHtml(html = "") {
  const texto = normalizarHtml(html);
  const candidatos = [];

  function adicionar(codigo, origem, trecho = "") {
    const cupom = String(codigo || "")
      .toUpperCase()
      .replace(/[^A-Z0-9_-]/g, "")
      .trim();

    if (!pareceCupomRealShopee(cupom)) return;

    candidatos.push({
      cupom,
      tipoCupom: "confirmado_shopee",
      origem,
      trecho
    });
  }

  const regexContextuais = [
    /(?:cupom|voucher|c[o\u00f3]digo|codigo|use|aplique)\s*:?\s*([A-Z0-9_-]{5,40})/gi,
    /"(?:code|voucherCode|voucher_code|couponCode|coupon_code)"\s*:\s*"([A-Z0-9_-]{5,40})"/gi
  ];

  for (const regex of regexContextuais) {
    let match;

    while ((match = regex.exec(texto)) !== null) {
      const idx = Math.max(0, match.index - 120);
      const trecho = texto.slice(idx, Math.min(texto.length, match.index + 220));
      adicionar(match[1], "html_shopee", trecho);
    }
  }

  const trechosCupom =
    texto.match(/.{0,180}(cupom|voucher|resgat|desconto|frete gratis|frete gr[a\u00e1]tis).{0,260}/gi) || [];

  for (const trecho of trechosCupom) {
    const codigos =
      trecho.match(/\b(?:SHOPEE|SHOP|CUPOM|OFF|APP|FRETE|PROMO|PIX)[A-Z0-9_-]{3,35}\b/gi) ||
      trecho.match(/\b[A-Z]{3,20}\d{1,10}[A-Z0-9_-]{0,20}\b/g) ||
      [];

    for (const codigo of codigos) {
      adicionar(codigo, "trecho_cupom_shopee", trecho);
    }
  }

  const unicos = Array.from(
    new Map(candidatos.map(item => [item.cupom, item])).values()
  );

  ultimoTotalCuponsShopee = unicos.length;

  return unicos;
}

function detectarAvisoCupomShopee(html = "", oferta = {}) {
  const texto = normalizarHtml(html).toLowerCase();
  const cupomUrl = extrairCupomUrlShopee(html);
  const beneficio = extrairBeneficioCupomShopee(html);

  const temAvisoCupom =
    Boolean(beneficio.avisoCupom) ||
    texto.includes("cupom") ||
    texto.includes("voucher") ||
    texto.includes("resgatar") ||
    texto.includes("resgate") ||
    texto.includes("frete gratis") ||
    texto.includes("frete gr\u00e1tis") ||
    texto.includes("desconto") ||
    texto.includes("aplicar");

  const aviso = temAvisoCupom
    ? {
        cupom: "",
        tipoCupom: "resgate_pagina_shopee",
        avisoCupom: beneficio.avisoCupom || "Ha cupom disponivel na pagina. Resgate antes de comprar.",
        beneficioDetectado: beneficio.beneficioDetectado || "",
        cupomUrl
      }
    : null;

  console.log("[SHOPEE-CUPOM]", {
    cuponsEncontrados: ultimoTotalCuponsShopee,
    beneficioDetectado: beneficio.beneficioDetectado || "",
    temAvisoCupom
  });

  return aviso;
}

function escolherCupomParaOfertaShopee(oferta = {}, cuponsOuAvisos = []) {
  const lista = Array.isArray(cuponsOuAvisos)
    ? cuponsOuAvisos
    : cuponsOuAvisos
      ? [cuponsOuAvisos]
      : [];

  const confirmado = lista.find(item =>
    item?.cupom && pareceCupomRealShopee(item.cupom)
  );

  if (confirmado) {
    const resultado = {
      cupom: String(confirmado.cupom).toUpperCase().trim(),
      tipoCupom: "confirmado_shopee",
      avisoCupom: `Use o cupom ${String(confirmado.cupom).toUpperCase().trim()} antes de finalizar a compra.`
    };

    if (confirmado.cupomUrl) resultado.cupomUrl = confirmado.cupomUrl;

    console.log("[SHOPEE-CUPOM-OFERTA]", {
      titulo: oferta.titulo || oferta.nome || "",
      tipoCupom: resultado.tipoCupom,
      cupom: resultado.cupom
    });

    return resultado;
  }

  const aviso = lista.find(item =>
    item?.tipoCupom === "resgate_pagina_shopee" ||
    item?.avisoCupom
  );

  if (aviso) {
    const resultado = {
      cupom: "",
      tipoCupom: "resgate_pagina_shopee",
      avisoCupom: aviso.avisoCupom || "Ha cupom disponivel na pagina. Resgate antes de comprar."
    };

    if (aviso.cupomUrl) resultado.cupomUrl = aviso.cupomUrl;

    console.log("[SHOPEE-CUPOM-OFERTA]", {
      titulo: oferta.titulo || oferta.nome || "",
      tipoCupom: resultado.tipoCupom,
      cupom: ""
    });

    return resultado;
  }

  return null;
}

module.exports = {
  extrairCuponsShopeeDoHtml,
  pareceCupomRealShopee,
  detectarAvisoCupomShopee,
  escolherCupomParaOfertaShopee
};


