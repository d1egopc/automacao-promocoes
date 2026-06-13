function cortarTitulo(titulo = "", limite = 120) {
  const texto = String(titulo || "Oferta").replace(/\s+/g, " ").trim();

  if (texto.length <= limite) return texto;

  return texto.slice(0, limite - 3).trim() + "...";
}

function parsePreco(valor) {
  if (valor == null || valor === "") return 0;

  if (typeof valor === "number") {
    return Number.isFinite(valor) ? valor : 0;
  }

  const normalizado = String(valor)
    .replace("R$", "")
    .replace(/\./g, "")
    .replace(",", ".")
    .replace(/[^\d.]/g, "")
    .trim();

  const numero = Number(normalizado);
  return Number.isFinite(numero) ? numero : 0;
}

function formatarPreco(valor) {
  if (typeof valor === "number" && Number.isFinite(valor)) {
    return `R$ ${valor.toLocaleString("pt-BR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })}`;
  }

  const texto = String(valor || "").trim();
  if (!texto) return "";

  if (/^R\$\s*/i.test(texto)) {
    return texto.replace(/^R\$\s*/i, "R$ ");
  }

  const numero = parsePreco(texto);

  if (numero > 0) {
    return `R$ ${numero.toLocaleString("pt-BR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })}`;
  }

  return `R$ ${texto}`;
}

function montarLinhaCupom(oferta = {}) {
  const cupom = String(oferta.cupom || "").trim();
  const avisoCupom = String(oferta.avisoCupom || "").trim();

  if (cupom) return `🎟️ Cupom: ${cupom}`;
  if (avisoCupom) return avisoCupom.startsWith("🎟️") ? avisoCupom : `🎟️ ${avisoCupom}`;

  return "";
}

function montarLinhaParcelamento(oferta = {}) {
  const parcelamento = String(oferta.parcelamento || "").trim();

  if (!parcelamento) return "";

  return parcelamento.startsWith("💳") ? parcelamento : `💳 ${parcelamento}`;
}

function formatarDesconto(oferta = {}) {
  const descontoManual =
    oferta.desconto ||
    oferta.percentualDesconto ||
    oferta.descontoPercentual ||
    "";

  if (descontoManual) {
    const texto = String(descontoManual).trim();
    return texto.includes("%") ? `${texto} OFF` : `${texto}% OFF`;
  }

  const precoAtual = parsePreco(oferta.precoAtual || oferta.preco);
  const precoAntigo = parsePreco(oferta.precoAntigo);

  if (precoAtual > 0 && precoAntigo > precoAtual) {
    const percentual = Math.round(((precoAntigo - precoAtual) / precoAntigo) * 100);
    const economia = precoAntigo - precoAtual;

    return `${percentual}% OFF | Economia de ${formatarPreco(economia)}`;
  }

  if (oferta.economia) {
    return `Economia de ${formatarPreco(oferta.economia)}`;
  }

  return "";
}

function precoTemVariacao(valor = "") {
  return /\d[\d.,]*\s+a\s+\d[\d.,]*/i.test(String(valor || ""));
}

function formatarFaixaPreco(valor = "") {
  const texto = String(valor || "").replace(/\s+/g, " ").trim();
  const partes = texto.split(/\s+a\s+/i).map(formatarPreco).filter(Boolean);

  if (partes.length >= 2) {
    return `${partes[0]} a ${partes[1]}`;
  }

  return formatarPreco(texto);
}

function montarLegendaOferta(oferta = {}) {
  const titulo = cortarTitulo(oferta.titulo || oferta.nome || "Oferta", 120);
  const precoAtual = formatarPreco(oferta.precoAtual || oferta.preco);
  const precoAntigo = formatarPreco(oferta.precoAntigo);
  const desconto = formatarDesconto(oferta);
  const parcelamento = montarLinhaParcelamento(oferta);
  const cupom = montarLinhaCupom(oferta);
  const link = oferta.linkAfiliado || oferta.link || oferta.linkOriginal || "";

  return [
    `🛍️ ${titulo}`,
    precoAtual ? `✅ Por: ${precoAtual}` : "",
    precoAntigo ? `💰 De: ${precoAntigo}` : "",
    desconto ? `🔥 ${desconto}` : "",
    parcelamento,
    cupom,
    link ? `🛒 Comprar:\n${link}` : ""
  ].filter(Boolean).join("\n\n");
}

function montarLegendaShopee(oferta = {}) {
  const titulo = cortarTitulo(oferta.titulo || oferta.nome || "Oferta", 120);
  const precoBruto = oferta.precoAtual || oferta.preco;
  const temVariacao = precoTemVariacao(precoBruto);
  const precoAtual = temVariacao
    ? formatarFaixaPreco(precoBruto)
    : formatarPreco(precoBruto);
  const precoAntigo = temVariacao ? "" : formatarPreco(oferta.precoAntigo);
  const desconto = temVariacao ? "" : formatarDesconto(oferta);
  const parcelamento = montarLinhaParcelamento(oferta);
  const cupom = montarLinhaCupom(oferta);
  const link = oferta.linkAfiliado || oferta.link || oferta.linkOriginal || "";

  return [
    `🛍️ ${titulo}`,
    precoAntigo ? `💰 De: ${precoAntigo}` : "",
    temVariacao
      ? `✅ Preço com variação: ${precoAtual}`
      : precoAtual
        ? `✅ Por: ${precoAtual}`
        : "",
    temVariacao ? "ℹ️ O valor pode mudar conforme cor, tamanho ou variação escolhida na Shopee." : "",
    desconto ? `🔥 ${desconto}` : "",
    parcelamento,
    cupom,
    link ? `🛒 Comprar:\n${link}` : ""
  ].filter(Boolean).join("\n\n");
}

function montarMensagemOferta(oferta = {}) {
  const marketplace = String(oferta.marketplace || "").toLowerCase();

  if (marketplace === "amazon") {
    return montarLegendaOferta(oferta);
  }

  if (marketplace === "shopee") {
    return montarLegendaShopee(oferta);
  }

  if (marketplace === "mercadolivre" || marketplace === "mercado_livre") {
    return montarLegendaOferta(oferta);
  }

  return oferta.mensagem || oferta.texto || [
    oferta.titulo || oferta.nome || "Oferta",
    oferta.precoAtual || oferta.preco ? `Preço: ${oferta.precoAtual || oferta.preco}` : "",
    oferta.precoAntigo ? `De: ${oferta.precoAntigo}` : "",
    oferta.linkAfiliado || oferta.link || ""
  ].filter(Boolean).join("\n");
}

module.exports = {
  montarMensagemOferta,
  formatarPreco,
  cortarTitulo,
  montarLinhaCupom,
  montarLinhaParcelamento,
  montarLegendaOferta,
  montarLegendaShopee,
  parsePreco,
  formatarDesconto,
  precoTemVariacao,
  formatarFaixaPreco
};
