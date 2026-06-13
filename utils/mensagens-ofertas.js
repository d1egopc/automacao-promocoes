const {
  cortarTitulo,
  formatarPreco,
  normalizarPreco,
  montarLinhaCupom,
  montarLinhaParcelamento,
  montarLinhaDesconto,
  removerLinhasVazias,
  montarLinkCompra,
  deveUsarTemplatePersonalizado,
  montarMensagemTemplatePersonalizado
} = require("./templates");

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
  const desconto = montarLinhaDesconto(oferta);
  const parcelamento = montarLinhaParcelamento(oferta);
  const cupom = montarLinhaCupom(oferta);

  return removerLinhasVazias([
    `🛍️ ${titulo}`,
    precoAtual ? `✅ Por: ${precoAtual}` : "",
    precoAntigo ? `💰 De: ${precoAntigo}` : "",
    desconto ? `🔥 ${desconto}` : "",
    parcelamento,
    cupom,
    montarLinkCompra(oferta)
  ]);
}

function montarLegendaShopee(oferta = {}) {
  const titulo = cortarTitulo(oferta.titulo || oferta.nome || "Oferta", 120);
  const precoBruto = oferta.precoAtual || oferta.preco;
  const temVariacao = precoTemVariacao(precoBruto);
  const precoAtual = temVariacao
    ? formatarFaixaPreco(precoBruto)
    : formatarPreco(precoBruto);
  const precoAntigo = temVariacao ? "" : formatarPreco(oferta.precoAntigo);
  const desconto = temVariacao ? "" : montarLinhaDesconto(oferta);
  const parcelamento = montarLinhaParcelamento(oferta);
  const cupom = montarLinhaCupom(oferta);

  return removerLinhasVazias([
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
    montarLinkCompra(oferta)
  ]);
}

function montarMensagemOferta(oferta = {}, opcoes = {}) {
  if (deveUsarTemplatePersonalizado(opcoes)) {
    const mensagemPersonalizada = montarMensagemTemplatePersonalizado(
      oferta,
      opcoes.destino
    );

    if (mensagemPersonalizada) return mensagemPersonalizada;
  }

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
  parsePreco: normalizarPreco,
  formatarDesconto: montarLinhaDesconto,
  precoTemVariacao,
  formatarFaixaPreco
};
