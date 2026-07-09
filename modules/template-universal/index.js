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

function normalizarComparacao(valor = "") {
  return normalizarTexto(valor)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function beneficioComercialSeguro(valor = "") {
  const texto = normalizarTexto(valor);
  if (!texto) return false;

  const normalizado = normalizarComparacao(texto);

  if (/^[a-z0-9_:-]+$/.test(normalizado)) return false;

  return [
    "cupom",
    "pix",
    "frete",
    "variacao",
    "cashback",
    "desconto",
    "parcel",
    "app",
    "relampago",
    "oferta",
    "pagina"
  ].some(termo => normalizado.includes(termo));
}

function normalizarBeneficios(beneficios) {
  if (!Array.isArray(beneficios)) return [];

  return beneficios
    .map(normalizarTexto)
    .filter(beneficioComercialSeguro)
    .filter(Boolean)
    .slice(0, 3);
}

function marketplaceBonito(valor = "") {
  const texto = normalizarTexto(valor);
  if (!texto) return "";

  const chave = texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  const nomes = {
    mercadolivre: "Mercado Livre",
    shopee: "Shopee",
    amazon: "Amazon",
    aliexpress: "AliExpress",
    kabum: "KaBuM",
    awin: "AWIN"
  };

  if (nomes[chave]) return nomes[chave];

  return texto
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map(parte => parte.length <= 4
      ? parte.toUpperCase()
      : parte.charAt(0).toUpperCase() + parte.slice(1).toLowerCase())
    .join(" ");
}

function apresentarScore(score) {
  const numero = normalizarNumero(score);
  if (numero == null) return "";

  const valor = Math.max(0, Math.min(100, Math.round(numero)));

  if (valor <= 24) return "⭐☆☆☆☆";
  if (valor <= 44) return "⭐⭐☆☆☆";
  if (valor <= 64) return "⭐⭐⭐☆☆";
  if (valor <= 84) return "⭐⭐⭐⭐☆";
  return "⭐⭐⭐⭐⭐";
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
    beneficios: normalizarBeneficios(oferta.beneficios),
    score: oferta.score,
    linkAfiliado: normalizarTexto(oferta.linkAfiliado)
  };
}

function economiaReal(precoOriginal, precoAtual, economia) {
  const economiaInformada = normalizarNumero(economia);
  if (economiaInformada != null && economiaInformada > 0) return economiaInformada;

  const original = normalizarNumero(precoOriginal);
  const atual = normalizarNumero(precoAtual);

  if (original != null && atual != null && original > atual) {
    return original - atual;
  }

  return null;
}

function descontoReal(precoOriginal, precoAtual, descontoPercentual) {
  const descontoInformado = normalizarNumero(descontoPercentual);
  if (descontoInformado != null && descontoInformado > 0) return descontoInformado;

  const original = normalizarNumero(precoOriginal);
  const atual = normalizarNumero(precoAtual);

  if (original != null && atual != null && original > atual) {
    return ((original - atual) / original) * 100;
  }

  return null;
}

function beneficioDiferenteDoCupom(beneficio = "", cupom = "") {
  const texto = normalizarComparacao(beneficio);
  const codigo = normalizarComparacao(cupom);

  return !codigo || !texto.includes(codigo);
}

function adicionarBloco(blocos, linhas = []) {
  const bloco = linhas.map(normalizarTexto).filter(Boolean);
  if (bloco.length) blocos.push(bloco);
}

function gerarTemplateUniversal(oferta = {}) {
  const campos = selecionarCamposUniversais(oferta);
  const blocos = [];
  const precoAtualNumero = normalizarNumero(campos.precoAtual);
  const precoOriginalNumero = normalizarNumero(campos.precoOriginal);
  const precoAtual = formatarMoeda(campos.precoAtual) || normalizarTexto(campos.precoAtual);
  const precoOriginal = precoOriginalNumero != null &&
    precoAtualNumero != null &&
    precoOriginalNumero > precoAtualNumero
      ? formatarMoeda(campos.precoOriginal)
      : "";
  const economiaNumero = economiaReal(campos.precoOriginal, campos.precoAtual, campos.economia);
  const descontoPercentual = descontoReal(campos.precoOriginal, campos.precoAtual, campos.descontoPercentual);
  const economia = economiaNumero != null && economiaNumero > 0
    ? formatarMoeda(economiaNumero)
    : "";
  const score = apresentarScore(campos.score);
  const beneficioComercial = campos.beneficios.find(beneficio =>
    beneficioDiferenteDoCupom(beneficio, campos.cupom)
  );

  adicionarBloco(blocos, [`🔥 ${campos.titulo || "Oferta"}`]);
  adicionarBloco(blocos, [
    campos.marketplace ? `🛍️ ${marketplaceBonito(campos.marketplace)}` : "",
    campos.categoria ? `📂 ${campos.categoria}` : ""
  ]);
  adicionarBloco(blocos, [
    precoOriginal ? `❌ De: ${precoOriginal}` : "",
    `✅ Por: ${precoAtual}`,
    economia ? `💸 Economia: ${economia}${descontoPercentual != null && descontoPercentual > 0 ? ` (${descontoPercentual.toFixed(0)}%)` : ""}` : ""
  ]);
  adicionarBloco(blocos, [
    campos.cupom ? `🎟️ Cupom: ${campos.cupom}` : ""
  ]);
  adicionarBloco(blocos, [
    score ? "⭐ Avaliação" : "",
    score
  ]);
  adicionarBloco(blocos, [
    "🔗 Confira aqui:",
    campos.linkAfiliado
  ]);
  adicionarBloco(blocos, [
    beneficioComercial ? `⚡ ${beneficioComercial}` : "",
    "⚠️ Oferta sujeita à alteração de preço."
  ]);

  return blocos.map(bloco => bloco.join("\n")).join("\n\n");
}

module.exports = {
  gerarTemplateUniversal
};
