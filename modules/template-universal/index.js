function normalizarTexto(valor) {
  if (valor == null) return "";
  return String(valor).trim();
}

function normalizarNumero(valor) {
  if (valor == null || valor === "") return null;
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : null;

  const texto = String(valor)
    .replace(/R\$/gi, "")
    .replace(/%/g, "")
    .replace(/\s/g, "")
    .trim();

  if (!texto) return null;

  const temVirgula = texto.includes(",");
  const temPonto = texto.includes(".");

  let normalizado = texto;

  if (temVirgula && temPonto) {
    normalizado = texto.replace(/\./g, "").replace(",", ".");
  } else if (temVirgula) {
    normalizado = texto.replace(",", ".");
  }

  const numero = Number(normalizado);
  return Number.isFinite(numero) ? numero : null;
}

function formatarMoeda(valor) {
  const numero = normalizarNumero(valor);
  if (numero == null) return "";

  return numero.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL"
  });
}

function normalizarBeneficios(beneficios) {
  if (!Array.isArray(beneficios)) return [];

  return beneficios
    .map(normalizarTexto)
    .filter(beneficioComercialSeguro)
    .filter(Boolean)
    .slice(0, 3);
}

function beneficioComercialSeguro(valor = "") {
  const texto = normalizarTexto(valor);
  if (!texto) return false;

  const normalizado = texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  if (/^[a-z0-9_:-]+$/.test(normalizado)) return false;

  return [
    "cupom",
    "pix",
    "frete",
    "variacao",
    "variação",
    "cashback",
    "desconto",
    "parcel",
    "app"
  ].some(termo => normalizado.includes(termo));
}

function marketplaceBonito(valor = "") {
  const texto = normalizarTexto(valor);
  const chave = texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

  const nomes = {
    mercadolivre: "Mercado Livre",
    mercadolivrebr: "Mercado Livre",
    mercadoLivre: "Mercado Livre",
    meli: "Mercado Livre",
    amazon: "Amazon",
    amazonbr: "Amazon",
    shopee: "Shopee",
    aliexpress: "AliExpress",
    aliexpressbr: "AliExpress",
    kabum: "KaBuM",
    awin: "AWIN"
  };

  return nomes[chave] || texto;
}

function apresentarScore(score) {
  const numero = normalizarNumero(score);
  if (numero == null) return null;

  const valor = Math.max(0, Math.min(100, Math.round(numero)));

  if (valor <= 19) return { valor, estrelas: "☆☆☆☆☆" };
  if (valor <= 39) return { valor, estrelas: "⭐☆☆☆☆" };
  if (valor <= 59) return { valor, estrelas: "⭐⭐☆☆☆" };
  if (valor <= 79) return { valor, estrelas: "⭐⭐⭐☆☆" };
  if (valor <= 94) return { valor, estrelas: "⭐⭐⭐⭐☆" };
  return { valor, estrelas: "⭐⭐⭐⭐⭐" };
}

function selecionarCamposUniversais(oferta = {}) {
  return {
    titulo: normalizarTexto(oferta.titulo),
    marketplace: normalizarTexto(oferta.marketplace),
    precoAtual: oferta.precoAtual,
    precoOriginal: oferta.precoOriginal,
    economia: oferta.economia,
    descontoPercentual: oferta.descontoPercentual,
    categoria: normalizarTexto(oferta.categoria),
    cupom: normalizarTexto(oferta.cupom),
    cupomTipo: normalizarTexto(oferta.cupomTipo),
    beneficios: normalizarBeneficios(oferta.beneficios),
    valorEfetivo: oferta.valorEfetivo,
    valorEfetivoOrigem: normalizarTexto(oferta.valorEfetivoOrigem),
    score: oferta.score,
    prioridade: oferta.prioridade,
    linkAfiliado: normalizarTexto(oferta.linkAfiliado),
    imagem: normalizarTexto(oferta.imagem)
  };
}

function gerarTemplateUniversal(oferta = {}) {
  const campos = selecionarCamposUniversais(oferta);
  const linhas = [];

  if (campos.titulo) linhas.push(`🔥 ${campos.titulo}`);
  linhas.push("");
  if (campos.marketplace) linhas.push(`🏬 ${marketplaceBonito(campos.marketplace)}`);
  if (campos.categoria) linhas.push(`📂 ${campos.categoria}`);

  const precoAtual = formatarMoeda(campos.precoAtual);
  const precoOriginal = formatarMoeda(campos.precoOriginal);
  const economia = formatarMoeda(campos.economia);
  const descontoPercentual = normalizarNumero(campos.descontoPercentual);
  const score = apresentarScore(campos.score);

  if (precoOriginal) linhas.push(`❌ De: ${precoOriginal}`);
  if (precoAtual) linhas.push(`✅ Por: ${precoAtual}`);

  if (campos.cupom) {
    linhas.push("");
    linhas.push(`🎟️ Cupom: ${campos.cupom}`);
  }

  const economiaDesconto = [];
  if (economia) economiaDesconto.push(economia);
  if (descontoPercentual != null && descontoPercentual > 0) {
    economiaDesconto.push(`${descontoPercentual.toFixed(0)}% OFF`);
  }

  if (economiaDesconto.length) {
    linhas.push(`💸 Economia: ${economiaDesconto.join(" | ")}`);
  }

  if (campos.beneficios.length > 0) {
    linhas.push("");
    campos.beneficios.forEach(beneficio => {
      linhas.push(`💡 ${beneficio}`);
    });
  }

  if (score != null) {
    linhas.push("");
    linhas.push("⭐ Avaliação:");
    linhas.push(`${score.estrelas} (${score.valor}/100)`);
  }

  if (campos.linkAfiliado) {
    linhas.push("");
    linhas.push("🔗 Confira aqui:");
    linhas.push(campos.linkAfiliado);
  }

  linhas.push("");
  linhas.push("⚡ Oferta sujeita à alteração de preço.");

  return linhas.filter(Boolean).join("\n");
}

module.exports = {
  gerarTemplateUniversal
};
