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
    .filter(Boolean)
    .slice(0, 5);
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

  if (campos.titulo) linhas.push(campos.titulo);
  if (campos.marketplace) linhas.push(`Marketplace: ${campos.marketplace}`);
  if (campos.categoria) linhas.push(`Categoria: ${campos.categoria}`);

  const precoAtual = formatarMoeda(campos.precoAtual);
  const precoOriginal = formatarMoeda(campos.precoOriginal);
  const valorEfetivo = formatarMoeda(campos.valorEfetivo);
  const economia = formatarMoeda(campos.economia);
  const descontoPercentual = normalizarNumero(campos.descontoPercentual);
  const score = normalizarNumero(campos.score);
  const prioridade = normalizarNumero(campos.prioridade);

  if (precoOriginal) linhas.push(`De: ${precoOriginal}`);
  if (precoAtual) linhas.push(`Preço: ${precoAtual}`);
  if (economia) linhas.push(`Economia: ${economia}`);
  if (descontoPercentual != null && descontoPercentual > 0) {
    linhas.push(`Desconto: ${descontoPercentual.toFixed(0)}%`);
  }
  if (valorEfetivo) linhas.push(`Valor efetivo: ${valorEfetivo}`);
  if (campos.valorEfetivoOrigem) linhas.push(`Base do valor efetivo: ${campos.valorEfetivoOrigem}`);

  if (campos.cupom) {
    const tipo = campos.cupomTipo ? ` (${campos.cupomTipo})` : "";
    linhas.push(`Cupom: ${campos.cupom}${tipo}`);
  }

  if (campos.beneficios.length > 0) {
    linhas.push("Benefícios:");
    campos.beneficios.forEach(beneficio => {
      linhas.push(`- ${beneficio}`);
    });
  }

  if (score != null || prioridade != null) {
    const partes = [];
    if (score != null) partes.push(`score ${score}`);
    if (prioridade != null) partes.push(`prioridade ${prioridade}`);
    linhas.push(`Inteligência: ${partes.join(" | ")}`);
  }

  if (campos.linkAfiliado) linhas.push(campos.linkAfiliado);

  return linhas.filter(Boolean).join("\n");
}

module.exports = {
  gerarTemplateUniversal
};
