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

function montarLinhaAplicarCupom(oferta = {}) {
  const cupom = String(oferta.cupom || "").trim();

  return cupom ? `\uD83C\uDFAB Aplique o cupom ${cupom} no carrinho.` : "";
}

function montarBlocoPreco({ precoAtual = "", precoAntigo = "", variacao = false } = {}) {
  return [
    precoAntigo ? `\u274C De: ${precoAntigo}` : "",
    variacao ? `\u2705 Pre\u00E7o com varia\u00E7\u00E3o: ${precoAtual}` : precoAtual ? `\u2705 Por: ${precoAtual}` : ""
  ].filter(Boolean).join("\n");
}

function montarLegendaOferta(oferta = {}) {
  const titulo = cortarTitulo(oferta.titulo || oferta.nome || "Oferta", 120);
  const precoAtual = formatarPreco(oferta.precoAtual || oferta.preco);
  const precoAntigo = formatarPreco(oferta.precoAntigo);
  const desconto = montarLinhaDesconto(oferta);
  const parcelamento = montarLinhaParcelamento(oferta);
  const cupom = montarLinhaCupom(oferta);
  const aplicarCupom = montarLinhaAplicarCupom(oferta);
  const blocoPreco = montarBlocoPreco({ precoAtual, precoAntigo });

  return removerLinhasVazias([
    `\uD83D\uDD25 ${titulo}`,
    blocoPreco,
    desconto ? `\uD83D\uDD25 ${desconto}` : "",
    parcelamento,
    cupom,
    montarLinkCompra(oferta),
    aplicarCupom
  ]);
}


function montarPrecoVariacaoShopee(oferta = {}) {
  const aviso = String(oferta.avisoVariacaoPreco || "").trim();
  if (aviso) return aviso;

  const precoMin = formatarPreco(oferta.precoMin || oferta.precoAtual || oferta.preco);
  const precoMax = formatarPreco(oferta.precoMax);

  if (precoMin && precoMax && precoMin !== precoMax) {
    return `${precoMin} a ${precoMax}`;
  }

  return precoMin || formatarPreco(oferta.precoAtual || oferta.preco);
}
function montarLegendaShopee(oferta = {}) {
  const titulo = cortarTitulo(oferta.titulo || oferta.nome || "Oferta", 120);
  const precoBruto = oferta.precoAtual || oferta.preco;
  const temVariacaoAuxiliar = oferta.temVariacaoPreco === true;
  const temVariacao = temVariacaoAuxiliar || precoTemVariacao(precoBruto);
  const precoAtual = temVariacaoAuxiliar
    ? montarPrecoVariacaoShopee(oferta)
    : temVariacao
      ? formatarFaixaPreco(precoBruto)
      : formatarPreco(precoBruto);
  const precoAntigo = temVariacao ? "" : formatarPreco(oferta.precoAntigo);
  const desconto = temVariacao ? "" : montarLinhaDesconto(oferta);
  const parcelamento = montarLinhaParcelamento(oferta);
  const cupom = montarLinhaCupom(oferta);
  const aplicarCupom = montarLinhaAplicarCupom(oferta);
  const blocoPreco = temVariacaoAuxiliar
    ? (precoAtual ? `✅ ${precoAtual}` : "")
    : montarBlocoPreco({
        precoAtual,
        precoAntigo,
        variacao: temVariacao
      });

  return removerLinhasVazias([
    `\uD83D\uDD25 ${titulo}`,
    blocoPreco,
    temVariacao ? "\u2139\uFE0F O valor pode mudar conforme cor, tamanho ou varia\u00E7\u00E3o escolhida na Shopee." : "",
    desconto ? `\uD83D\uDD25 ${desconto}` : "",
    parcelamento,
    cupom,
    montarLinkCompra(oferta),
    aplicarCupom
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

  return oferta.mensagem || oferta.texto || montarLegendaOferta(oferta);
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
