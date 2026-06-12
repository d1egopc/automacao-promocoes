// ================= SCORE DE OFERTA V1 =================

function precoParaNumero(valor = "") {
  return Number(
    String(valor)
      .replace(/[^\d,.-]/g, "")
      .replace(/\./g, "")
      .replace(",", ".")
  ) || 0;
}

function calcularDescontoPercentual(precoAntigo, precoAtual) {
  const antigo = precoParaNumero(precoAntigo);
  const atual = precoParaNumero(precoAtual);

  if (!antigo || !atual || atual >= antigo) return 0;

  return Math.round(((antigo - atual) / antigo) * 100);
}

function nivelScore(score) {
  if (score >= 80) return "premium";
  if (score >= 60) return "forte";
  if (score >= 30) return "boa";
  return "comum";
}

function calcularScoreOferta(oferta = {}) {
  let score = 0;
  const motivos = [];

  const precoAtual = precoParaNumero(oferta.precoAtual || oferta.preco);
  const desconto = calcularDescontoPercentual(
    oferta.precoAntigo,
    oferta.precoAtual || oferta.preco
  );

  // preço baixo
  if (precoAtual > 0 && precoAtual <= 30) {
    score += 10;
    motivos.push("preço até R$30");
  } else if (precoAtual <= 50) {
    score += 8;
    motivos.push("preço até R$50");
  } else if (precoAtual <= 100) {
    score += 5;
    motivos.push("preço até R$100");
  }

  // desconto
  if (desconto >= 50) {
    score += 40;
    motivos.push("desconto acima de 50%");
  } else if (desconto >= 30) {
    score += 30;
    motivos.push("desconto acima de 30%");
  } else if (desconto >= 20) {
    score += 20;
    motivos.push("desconto acima de 20%");
  } else if (desconto >= 10) {
    score += 10;
    motivos.push("desconto acima de 10%");
  }

  // cupom
  if (oferta.cupom || oferta.avisoCupom) {
    score += 15;
    motivos.push("tem cupom/aviso");
  }

  // categoria quente
  const categoria = String(oferta.categoria || "").toLowerCase();

  if (
    categoria.includes("gamer") ||
    categoria.includes("hardware") ||
    categoria.includes("celulares")
  ) {
    score += 15;
    motivos.push("categoria quente");
  } else if (
    categoria.includes("perfumaria") ||
    categoria.includes("tênis") ||
    categoria.includes("tenis")
  ) {
    score += 10;
    motivos.push("categoria boa");
  }

  // marketplace
  const marketplace = String(oferta.marketplace || "").toLowerCase();

  if (marketplace.includes("kabum")) {
    score += 8;
    motivos.push("marketplace forte: KaBuM");
  } else if (
    marketplace.includes("mercadolivre") ||
    marketplace.includes("amazon")
  ) {
    score += 5;
    motivos.push("marketplace forte");
  }

  score = Math.max(0, Math.min(100, score));

  return {
    score,
    nivel: nivelScore(score),
    desconto,
    motivos
  };
}

module.exports = {
  calcularScoreOferta,
  precoParaNumero,
  calcularDescontoPercentual
};