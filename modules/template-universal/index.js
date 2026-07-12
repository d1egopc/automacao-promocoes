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

  if (["pix", "app", "cashback"].includes(normalizado)) return true;

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

function categoriaConfiavel(campos = {}) {
  const categoria = normalizarTexto(campos.categoria);
  if (!categoria) return false;

  const categoriaNormalizada = normalizarComparacao(categoria);
  const marketplaceNormalizado = normalizarComparacao(campos.marketplace);
  const categoriasFracas = [
    "diversos",
    "shopee",
    "mercado livre",
    "mercadolivre",
    "amazon"
  ];

  if (categoriasFracas.includes(categoriaNormalizada)) return false;
  if (marketplaceNormalizado && categoriaNormalizada === marketplaceNormalizado) return false;

  if (
    campos.categoriaGenerica === true ||
    campos.categoriaBaixaConfianca === true ||
    campos.baixaConfiancaCategoria === true
  ) {
    return false;
  }

  const confiancaCategoria = normalizarNumero(campos.categoriaConfianca ?? campos.confiancaCategoria);
  if (confiancaCategoria != null && confiancaCategoria < 0.5) return false;

  const score = normalizarNumero(campos.score);
  const prioridade = normalizarNumero(campos.prioridade);
  if (score != null && score < 45) return false;
  if (prioridade != null && prioridade < 45) return false;

  return true;
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
    valorEfetivo: oferta.valorEfetivo,
    valorEfetivoOrigem: normalizarTexto(oferta.valorEfetivoOrigem),
    valorEfetivoDetalhes: oferta.valorEfetivoDetalhes || {},
    economia: oferta.economia,
    descontoPercentual: oferta.descontoPercentual,
    categoria: normalizarTexto(oferta.categoria),
    categoriaConfianca: oferta.categoriaConfianca,
    confiancaCategoria: oferta.confiancaCategoria,
    categoriaGenerica: oferta.categoriaGenerica,
    categoriaBaixaConfianca: oferta.categoriaBaixaConfianca,
    baixaConfiancaCategoria: oferta.baixaConfiancaCategoria,
    cupom: normalizarTexto(oferta.cupom),
    beneficios: normalizarBeneficios(oferta.beneficios),
    score: oferta.score,
    prioridade: oferta.prioridade,
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

function extrairValoresMonetarios(texto = "") {
  const matches = String(texto || "").match(/(?:R\$\s*)?\d{1,3}(?:\.\d{3})*,\d{2}|(?:R\$\s*)?\d+(?:\.\d{2})|R\$\s*\d+/g) || [];
  return matches
    .map(valor => normalizarNumero(valor))
    .filter(valor => valor != null);
}

function beneficioComercialValidoParaTemplate(beneficio = "", campos = {}) {
  const texto = normalizarTexto(beneficio);
  if (!texto || !beneficioComercialSeguro(texto)) return false;
  if (!beneficioDiferenteDoCupom(texto, campos.cupom)) return false;

  const normalizado = normalizarComparacao(texto);
  const precoAtual = normalizarNumero(campos.precoAtual);
  const valores = extrairValoresMonetarios(texto);

  if (normalizado.includes("pix")) {
    if (valorEfetivoConfirmado(campos) != null) return true;
    if (precoAtual == null || !valores.length) return false;
    return valores.some(valor => valor < precoAtual);
  }

  if (precoAtual != null && valores.some(valor => valor >= precoAtual)) return false;

  return true;
}

function origemValorEfetivoComercial(origem = "") {
  const normalizado = normalizarComparacao(origem);

  return [
    "cupom",
    "pix",
    "app",
    "cashback",
    "frete_gratis",
    "desconto"
  ].some(termo => normalizado.includes(termo));
}

function valorEfetivoConfirmado(campos = {}) {
  const valorEfetivo = normalizarNumero(campos.valorEfetivo);
  const precoAtual = normalizarNumero(campos.precoAtual);

  if (valorEfetivo == null || precoAtual == null || valorEfetivo >= precoAtual) return null;
  if (!origemValorEfetivoComercial(campos.valorEfetivoOrigem)) return null;

  return valorEfetivo;
}

function nomeBeneficioInstrucao(campos = {}, beneficioComercial = "") {
  const origem = normalizarComparacao(campos.valorEfetivoOrigem);
  const beneficio = normalizarComparacao(beneficioComercial);

  if (origem.includes("pix") || beneficio.includes("pix")) return "PIX";
  if (origem.includes("app") || beneficio.includes("app")) return "app";
  if (origem.includes("cashback") || beneficio.includes("cashback")) return "cashback";
  if (origem.includes("frete") || beneficio.includes("frete")) return "frete gratis";
  if (origem.includes("cupom") || beneficio.includes("cupom")) return "cupom";

  return "";
}

function montarInstrucaoPrecoFinal(campos = {}, beneficioComercial = "", precoFinal = "") {
  const beneficio = nomeBeneficioInstrucao(campos, beneficioComercial);

  if (campos.cupom && precoFinal && beneficio && beneficio !== "cupom") {
    return `Aplique o cupom ${campos.cupom} + ${beneficio} para pagar ${precoFinal}.`;
  }

  if (!campos.cupom && precoFinal && beneficio && beneficio !== "cupom") {
    return `Use ${beneficio} para pagar ${precoFinal}.`;
  }

  return "";
}

function beneficioSugereCupomGenerico(beneficio = "") {
  const texto = normalizarComparacao(beneficio);
  return texto.includes("cupom") || texto.includes("carrinho") || texto.includes("app");
}

function montarInstrucaoComercial(campos = {}, beneficioComercial = "", precoFinal = "") {
  const instrucaoPrecoFinal = precoFinal
    ? montarInstrucaoPrecoFinal(campos, beneficioComercial, precoFinal)
    : "";

  if (instrucaoPrecoFinal) return instrucaoPrecoFinal;

  if (campos.cupom) {
    return `Aplique o cupom ${campos.cupom} para obter o desconto.`;
  }

  if (!precoFinal && beneficioSugereCupomGenerico(beneficioComercial)) {
    const marketplace = marketplaceBonito(campos.marketplace);
    return `Pode haver benefício disponível na página/app${marketplace ? ` do ${marketplace}` : ""}. Confira antes de finalizar.`;
  }

  return beneficioComercial;
}

function adicionarBloco(blocos, linhas = []) {
  const bloco = linhas.map(normalizarTexto).filter(Boolean);
  if (bloco.length) blocos.push(bloco);
}

function gerarTemplateUniversal(oferta = {}) {
  const campos = selecionarCamposUniversais(oferta);
  const blocos = [];
  const precoFinalConfirmado = valorEfetivoConfirmado(campos);
  const precoAtualExibido = precoFinalConfirmado ?? campos.precoAtual;
  const precoAtualNumero = normalizarNumero(precoAtualExibido);
  const precoOriginalNumero = normalizarNumero(campos.precoOriginal);
  const precoAtual = formatarMoeda(precoAtualExibido) || normalizarTexto(precoAtualExibido);
  const precoOriginal = precoOriginalNumero != null &&
    precoAtualNumero != null &&
    precoOriginalNumero > precoAtualNumero
      ? formatarMoeda(campos.precoOriginal)
      : "";
  const economiaNumero = economiaReal(campos.precoOriginal, precoAtualExibido, campos.economia);
  const descontoPercentual = descontoReal(campos.precoOriginal, precoAtualExibido, campos.descontoPercentual);
  const economia = economiaNumero != null && economiaNumero > 0
    ? formatarMoeda(economiaNumero)
    : "";
  const score = apresentarScore(campos.score);
  let beneficioComercial = campos.beneficios.find(beneficio =>
    beneficioComercialValidoParaTemplate(beneficio, campos)
  );
  beneficioComercial = montarInstrucaoComercial(
    campos,
    beneficioComercial,
    precoFinalConfirmado != null ? precoAtual : ""
  );

  adicionarBloco(blocos, [`🔥 *${campos.titulo || "Oferta"}*`]);
  adicionarBloco(blocos, [
    campos.marketplace ? `🛍️ ${marketplaceBonito(campos.marketplace)}` : "",
    categoriaConfiavel(campos) ? `📂 ${campos.categoria}` : ""
  ]);
  adicionarBloco(blocos, [
    precoOriginal ? `❌ De: *${precoOriginal}*` : "",
    `✅ Por: *${precoAtual}*`,
    economia ? `💸 Economia: *${economia}${descontoPercentual != null && descontoPercentual > 0 ? ` (${descontoPercentual.toFixed(0)}%)` : ""}*` : ""
  ]);
  adicionarBloco(blocos, [
    campos.cupom ? `🎟️ Cupom: *${campos.cupom}*` : ""
  ]);
  adicionarBloco(blocos, [
    score ? "✰ Avaliação" : "",
    score
  ]);
  adicionarBloco(blocos, [
    "🔗 *Confira aqui:*",
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
