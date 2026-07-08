function normalizarTexto(valor) {
  if (valor == null) return "";
  return String(valor).trim();
}

function normalizarNumero(valor) {
  if (valor == null || valor === "") return null;
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : null;

  const texto = String(valor)
    .replace(/R\$/gi, "")
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
    categoria: normalizarTexto(oferta.categoria),
    cupom: normalizarTexto(oferta.cupom),
    cupomTipo: normalizarTexto(oferta.cupomTipo),
    beneficios: normalizarBeneficios(oferta.beneficios),
    valorEfetivo: oferta.valorEfetivo,
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

  if (precoOriginal) linhas.push(`De: ${precoOriginal}`);
  if (precoAtual) linhas.push(`Preco: ${precoAtual}`);
  if (valorEfetivo) linhas.push(`Valor efetivo: ${valorEfetivo}`);

  if (campos.cupom) {
    const tipo = campos.cupomTipo ? ` (${campos.cupomTipo})` : "";
    linhas.push(`Cupom: ${campos.cupom}${tipo}`);
  }

  if (campos.beneficios.length > 0) {
    linhas.push("Beneficios:");
    campos.beneficios.forEach(beneficio => {
      linhas.push(`- ${beneficio}`);
    });
  }

  if (campos.linkAfiliado) linhas.push(campos.linkAfiliado);

  return linhas.filter(Boolean).join("\n");
}

module.exports = {
  gerarTemplateUniversal
};
