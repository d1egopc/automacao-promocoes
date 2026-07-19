function extrairCuponsDoHtmlProdutoML(html = "") {
  const candidatos = [];
  const texto = String(html || "");

  function adicionar(cupom, origem, prioridade = 1000, trecho = "") {
    cupom = String(cupom || "")
      .toUpperCase()
      .replace(/[^A-Z0-9_-]/g, "")
      .trim();

    if (!cupom) return;
    if (cupom.length < 5 || cupom.length > 40) return;

    candidatos.push({
      cupom,
      tipoCupom: "produto",
      origem,
      prioridade,
      trecho
    });
  }

  const regexDiretos = [
    /\b(?:CUPOM|MELI|ESQUENTA|COMPRA|GANHA|OFERTA|APP|PIX)[A-Z0-9_-]{3,35}\b/g,
    /\b[A-Z]{3,20}\d{1,10}[A-Z0-9_-]{0,20}\b/g
  ];

  for (const regex of regexDiretos) {
    const encontrados = texto.match(regex) || [];

    for (const cupom of encontrados) {
      const idx = texto.indexOf(cupom);
      const trecho = texto.slice(
        Math.max(0, idx - 250),
        Math.min(texto.length, idx + 350)
      );

      adicionar(cupom, "html_produto_ml", 1000, trecho);
    }
  }

  const regexJson = [
    /"(?:code|coupon_code|couponCode|voucherCode|voucher_code|couponId|coupon_id)"\s*:\s*"([A-Z0-9_-]{5,40})"/gi,
    /"(?:label|title|subtitle|description|text)"\s*:\s*"([^"]{0,120}(?:cupom|coupon|pix|off|desconto)[^"]{0,120})"/gi
  ];

  for (const regex of regexJson) {
    let match;

    while ((match = regex.exec(texto)) !== null) {
      const bruto = String(match[1] || "");

      const codigos =
        bruto.match(/\b(?:CUPOM|MELI|ESQUENTA|COMPRA|GANHA|OFERTA|APP|PIX)[A-Z0-9_-]{3,35}\b/gi) ||
        bruto.match(/\b[A-Z]{3,20}\d{1,10}[A-Z0-9_-]{0,20}\b/g) ||
        [];

      for (const codigo of codigos) {
        adicionar(codigo, "json_produto_ml", 1200, bruto);
      }
    }
  }

  const trechosCupom =
    texto.match(/.{0,250}(cupom|coupon|desconto adicional|economize|pix).{0,350}/gi) || [];

  for (const trecho of trechosCupom) {
    const codigos =
      trecho.match(/\b(?:CUPOM|MELI|ESQUENTA|COMPRA|GANHA|OFERTA|APP|PIX)[A-Z0-9_-]{3,35}\b/gi) ||
      trecho.match(/\b[A-Z]{3,20}\d{1,10}[A-Z0-9_-]{0,20}\b/g) ||
      [];

    for (const codigo of codigos) {
      adicionar(codigo, "trecho_proximo_cupom_ml", 1300, trecho);
    }
  }

  const bloqueados = new Set([
    "HTML", "JSON", "HTTP", "HTTPS", "DOCTYPE",
    "MERCADOLIVRE", "MERCADOPAGO",
    "MLB", "MLA", "MLM",
    "CUPOM", "CUPONS", "COUPON",
    "INATIVO", "ATIVO", "VALIDO", "VÁLIDO"
  ]);

  return Array.from(
    new Map(
      candidatos
        .filter(c => !bloqueados.has(c.cupom))
        .map(c => [c.cupom, c])
    ).values()
  );
}
