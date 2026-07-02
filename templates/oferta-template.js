function textoLimpo(valor) {
  return String(valor || "").trim();
}

function temValor(valor) {
  return valor !== null && valor !== undefined && textoLimpo(valor) !== "";
}

function normalizarNumero(valor) {
  if (!temValor(valor)) return null;
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : null;

  let texto = textoLimpo(valor)
    .replace(/R\$/gi, "")
    .replace(/\s+/g, "")
    .replace(/[^\d.,-]/g, "");

  if (!texto) return null;

  const negativo = texto.startsWith("-");
  texto = texto.replace(/-/g, "");

  const temVirgula = texto.includes(",");
  const temPonto = texto.includes(".");

  if (temVirgula && temPonto) {
    texto = texto.replace(/\./g, "").replace(",", ".");
  } else if (temVirgula) {
    texto = texto.replace(",", ".");
  } else if (temPonto) {
    const partes = texto.split(".");
    const ultimo = partes[partes.length - 1] || "";
    const milhares = /^\d{1,3}(?:\.\d{3})+$/.test(texto);
    texto = milhares && ultimo.length === 3 ? texto.replace(/\./g, "") : texto;
  }

  const numero = Number(`${negativo ? "-" : ""}${texto}`);
  return Number.isFinite(numero) ? numero : null;
}

function formatarMoeda(valor) {
  const numero = normalizarNumero(valor);
  if (numero === null) return "";

  return numero.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL"
  });
}

function formatarPercentual(valor) {
  if (!temValor(valor)) return "";
  const numero = normalizarNumero(valor);
  if (numero === null) return textoLimpo(valor);
  return `${Math.round(numero)}%`;
}

function temAvisoCupom(cupomTipo = "", beneficioTexto = "") {
  const texto = `${cupomTipo} ${beneficioTexto}`
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  return /cupom/.test(texto) && /(possivel|disponivel|confira|pode|aviso)/.test(texto);
}

function formatarOfertaUniversal(oferta = {}) {
  const titulo = textoLimpo(oferta.titulo || oferta.nome || "Produto");
  const linhas = [`\u{1F525} ${titulo}`];

  const precoOriginal = formatarMoeda(oferta.precoOriginal);
  const precoAtual = formatarMoeda(oferta.precoAtual ?? oferta.preco);

  if (precoOriginal) linhas.push("", `\u274C De: ${precoOriginal}`);
  if (precoAtual) {
    if (!precoOriginal) linhas.push("");
    linhas.push(`\u2705 Por: ${precoAtual}`);
  }

  const desconto = formatarPercentual(oferta.descontoPercentual);
  const economia = formatarMoeda(oferta.economia);
  const partesDesconto = [];
  if (desconto) partesDesconto.push(`${desconto} OFF`);
  if (economia) partesDesconto.push(`Economia de ${economia}`);
  if (partesDesconto.length) linhas.push("", `\u{1F525} ${partesDesconto.join(" | ")}`);

  const parcelamento = textoLimpo(oferta.parcelamento);
  if (parcelamento) linhas.push("", `\u{1F4B3} ${parcelamento}`);

  const cupom = textoLimpo(oferta.cupom).toUpperCase();
  const beneficioTexto = textoLimpo(oferta.beneficioTexto || oferta.beneficioExtra || oferta.avisoCupom);
  if (cupom) {
    linhas.push("", `\u{1F39F}\uFE0F Cupom: ${cupom}`);
  } else if (temAvisoCupom(oferta.cupomTipo || oferta.tipoCupom, beneficioTexto)) {
    linhas.push("", "\u26A0\uFE0F Pode haver cupom disponivel");
  }

  if (oferta.freteGratis === true) linhas.push("", "\u{1F69A} Frete gratis");

  const linkAfiliado = textoLimpo(oferta.linkAfiliado || oferta.linkFinal || oferta.link);
  if (linkAfiliado) linhas.push("", "\u{1F517} Confira aqui:", linkAfiliado);

  return linhas.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

module.exports = {
  formatarOfertaUniversal
};