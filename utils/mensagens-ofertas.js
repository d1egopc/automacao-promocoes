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
const { formatarOfertaUniversal } = require("../templates/oferta-template");
const { gerarTemplateUniversal } = require("../modules/template-universal");

function normalizarTextoLocal(valor = "") {
  return String(valor || "").trim();
}

function normalizarEngineV2Modo() {
  const modo = normalizarTextoLocal(process.env.ENGINE_V2_MODO || "shadow").toLowerCase();
  return ["shadow", "pilot", "full"].includes(modo) ? modo : "shadow";
}

function clientesPilotoEngineV2() {
  return String(process.env.ENGINE_V2_CLIENTES_PILOTO || "user_yxquab4z")
    .split(/[,\s;]+/)
    .map(item => item.trim())
    .filter(Boolean);
}

function clienteTemplateUniversalPilot(clienteId = "") {
  if (normalizarEngineV2Modo() !== "pilot") return false;
  const id = String(clienteId || "").trim();
  return clientesPilotoEngineV2().some(item => String(item) === id);
}

function scoreUniversal(valor) {
  if (valor && typeof valor === "object") {
    return valor.score ?? valor.valor ?? valor.total ?? null;
  }

  return valor ?? null;
}

function beneficiosUniversais(oferta = {}, v2 = {}) {
  const logs = Array.isArray(v2.logs) ? v2.logs : [];
  const beneficios = [];

  if (Array.isArray(oferta.beneficios)) beneficios.push(...oferta.beneficios);
  if (Array.isArray(v2.beneficios)) beneficios.push(...v2.beneficios);
  if (oferta.beneficioTexto) beneficios.push(oferta.beneficioTexto);
  if (oferta.avisoCupom) beneficios.push(oferta.avisoCupom);
  if (oferta.aviso) beneficios.push(oferta.aviso);

  logs.forEach(item => {
    if (typeof item === "string") beneficios.push(item);
    else if (item?.mensagem) beneficios.push(item.mensagem);
    else if (item?.motivo) beneficios.push(item.motivo);
  });

  return [...new Set(beneficios.map(normalizarTextoLocal).filter(Boolean))].slice(0, 5);
}

function montarEntradaTemplateUniversalOficial(oferta = {}) {
  const v2 = oferta.inteligenciaUniversalV2 || {};

  return {
    titulo: oferta.titulo || oferta.nome || "",
    marketplace: oferta.marketplace || "",
    precoAtual: oferta.precoAtual ?? oferta.preco,
    precoOriginal: oferta.precoOriginal ?? oferta.precoAntigo,
    economia: oferta.economia ?? oferta.economiaValor ?? oferta.valorEconomia,
    descontoPercentual: oferta.descontoPercentual ?? oferta.desconto,
    categoria: v2.categoria || oferta.categoria || "",
    cupom: oferta.cupom || oferta.cupomCodigo || "",
    cupomTipo: oferta.cupomTipo || oferta.tipoCupom || "",
    beneficios: beneficiosUniversais(oferta, v2),
    valorEfetivo: v2.valorEfetivo ?? oferta.valorEfetivo,
    valorEfetivoOrigem: v2.valorEfetivoOrigem || oferta.valorEfetivoOrigem || "",
    prioridade: v2.prioridade ?? oferta.prioridadeEnvio ?? oferta.prioridadeFila ?? oferta.prioridade,
    score: scoreUniversal(v2.score),
    linkAfiliado: oferta.linkAfiliado || oferta.linkFinal || oferta.link || "",
    imagem: oferta.imagem || ""
  };
}

function tentarTemplateUniversalPilot(oferta = {}, opcoes = {}) {
  const clienteId = opcoes.clienteId || oferta.clienteId || "admin";

  if (!clienteTemplateUniversalPilot(clienteId)) return "";

  const resumo = {
    clienteId,
    marketplace: oferta.marketplace || "",
    titulo: cortarTitulo(oferta.titulo || oferta.nome || "", 80)
  };

  try {
    const entradaUniversal = montarEntradaTemplateUniversalOficial(oferta);
    console.log("[TEMPLATE-UNIVERSAL-PILOT]", JSON.stringify({
      ...resumo,
      score: entradaUniversal.score ?? "",
      prioridade: entradaUniversal.prioridade ?? ""
    }));

    const texto = gerarTemplateUniversal(entradaUniversal);
    if (!texto) throw new Error("template_universal_vazio");

    console.log("[TEMPLATE-UNIVERSAL-OFICIAL-ENVIADO]", JSON.stringify({
      ...resumo,
      categoria: entradaUniversal.categoria || "",
      precoAtual: entradaUniversal.precoAtual ?? "",
      precoAntigo: entradaUniversal.precoOriginal ?? "",
      economia: entradaUniversal.economia ?? "",
      cupom: entradaUniversal.cupom || "",
      avaliacao: entradaUniversal.score ?? "",
      origem: opcoes.origem || oferta.origem || "",
      templateVersao: "v2-universal-oficial-pilot",
      tamanhoTexto: texto.length,
      temCupom: Boolean(entradaUniversal.cupom),
      temLinkAfiliado: Boolean(entradaUniversal.linkAfiliado)
    }));

    return texto;
  } catch (e) {
    console.log("[TEMPLATE-UNIVERSAL-FALLBACK-V1]", JSON.stringify({
      ...resumo,
      erro: e.message
    }));
    return "";
  }
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
    ? (precoAtual ? `âœ… ${precoAtual}` : "")
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
  const mensagemUniversalPilot = tentarTemplateUniversalPilot(oferta, opcoes);
  if (mensagemUniversalPilot) return mensagemUniversalPilot;

  if (deveUsarTemplatePersonalizado(opcoes)) {
    const mensagemPersonalizada = montarMensagemTemplatePersonalizado(
      oferta,
      opcoes.destino
    );

    if (mensagemPersonalizada) return mensagemPersonalizada;
  }

  const marketplace = String(oferta.marketplace || "").toLowerCase();

  if (marketplace === "amazon") {
    return formatarOfertaUniversal({
      ...oferta,
      precoOriginal: oferta.precoOriginal ?? oferta.precoAntigo,
      beneficioTexto: oferta.beneficioTexto || oferta.beneficioExtra || oferta.avisoCupom || ""
    }) || montarLegendaOferta(oferta);
  }

  if (marketplace === "shopee") {
    return montarLegendaShopee(oferta);
  }

  if (marketplace === "mercadolivre" || marketplace === "mercado_livre") {
    return formatarOfertaUniversal({
      ...oferta,
      precoOriginal: oferta.precoOriginal ?? oferta.precoAntigo,
      beneficioTexto: oferta.beneficioTexto || oferta.beneficioExtra || oferta.avisoCupom || ""
    }) || montarLegendaOferta(oferta);
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
