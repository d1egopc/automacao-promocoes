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
const { resolverTemplateMensagem } = require("../modules/templates-clientes/resolver");
const { prepararDadosOficiaisTemplate } = require("../modules/templates-clientes/dados-oficiais");
const fidelidadeObs = require("../modules/fidelidade/observabilidade-v1");
const { selecionarTemplateEspelhoPiloto } = require("../modules/ofc-v2/espelho-piloto");

function normalizarTextoLocal(valor = "") {
  return String(valor || "").trim();
}

function normalizarComparacaoLocal(valor = "") {
  return normalizarTextoLocal(valor)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/^cupom\s*:?\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function instrucaoCupomRedundanteLocal(instrucao = "", cupom = "") {
  const textoInstrucao = normalizarComparacaoLocal(instrucao);
  const textoCupom = normalizarComparacaoLocal(cupom);
  return Boolean(textoInstrucao && textoCupom && textoInstrucao === textoCupom);
}

function normalizarEngineV2Modo() {
  const modo = normalizarTextoLocal(process.env.ENGINE_V2_MODO || "full").toLowerCase();
  return modo === "shadow" ? "shadow" : "full";
}

function templateUniversalOficialAtivo() {
  return normalizarEngineV2Modo() === "full";
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
  return prepararDadosOficiaisTemplate(oferta, { modo: "universal" });
}

function montarOfertaRenderizacaoOficial(oferta = {}) {
  const dadosUniversal = prepararDadosOficiaisTemplate(oferta, { modo: "universal" });
  const dadosPersonalizado = prepararDadosOficiaisTemplate(oferta, { modo: "personalizado" });
  const precoAtual = dadosUniversal.precoAtual ?? dadosPersonalizado.precoAtual ?? oferta.precoAtual ?? oferta.preco;
  const precoOriginal = dadosUniversal.precoOriginal ?? dadosPersonalizado.precoOriginal ?? oferta.precoOriginal ?? oferta.precoAntigo;
  const linkAfiliado = dadosUniversal.linkAfiliado || dadosPersonalizado.linkAfiliado || oferta.linkAfiliado || oferta.linkFinal || oferta.link || "";
  const cupom = dadosUniversal.cupom || dadosPersonalizado.cupom || oferta.cupom || "";

  return {
    ...oferta,
    ...dadosPersonalizado,
    ...dadosUniversal,
    precoAtual,
    preco: precoAtual,
    precoPor: precoAtual,
    precoOriginal,
    precoAntigo: precoOriginal,
    precoDe: precoOriginal,
    cupom,
    cupomTexto: dadosUniversal.cupomTexto || dadosPersonalizado.cupomTexto || cupom,
    codigoCupom: dadosUniversal.codigoCupom || dadosPersonalizado.codigoCupom || cupom,
    codigosCupom: Array.isArray(dadosUniversal.codigosCupom) ? dadosUniversal.codigosCupom : [],
    cupons: Array.isArray(dadosUniversal.cupons) ? dadosUniversal.cupons : [],
    linkAfiliado,
    linkFinal: oferta.linkFinal || linkAfiliado,
    link: oferta.link || linkAfiliado,
    fonteDadosMensagem: "dados_oficiais_template"
  };
}

function tentarTemplateUniversalOficial(oferta = {}, opcoes = {}) {
  const clienteId = opcoes.clienteId || oferta.clienteId || "admin";

  if (!templateUniversalOficialAtivo()) return "";

  const resumo = {
    clienteId,
    marketplace: oferta.marketplace || "",
    titulo: cortarTitulo(oferta.titulo || oferta.nome || "", 80)
  };

  try {
    const entradaUniversal = opcoes.dadosOficiaisUniversal || montarEntradaTemplateUniversalOficial(oferta);
    console.log("[TEMPLATE-UNIVERSAL-OFICIAL]", JSON.stringify({
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
      templateVersao: "v2-universal-oficial",
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
  const precoAntigo = formatarPreco(oferta.precoOriginal ?? oferta.precoAntigo);
  const desconto = montarLinhaDesconto(oferta);
  const parcelamento = montarLinhaParcelamento(oferta);
  const cupom = montarLinhaCupom(oferta);
  const aplicarCupom = montarLinhaAplicarCupom(oferta);
  const instrucaoCupom = normalizarTextoLocal(oferta.instrucaoCupom || oferta.condicaoCupom || oferta.condicaoComercial);
  const condicaoPix = normalizarTextoLocal(oferta.condicaoPix || oferta.precoPix);
  const precoUnitario = normalizarTextoLocal(oferta.precoUnitario || oferta.unitarioCapturado);
  const blocoPreco = montarBlocoPreco({ precoAtual, precoAntigo });

  return removerLinhasVazias([
    `\uD83D\uDD25 ${titulo}`,
    blocoPreco,
    condicaoPix ? `\u26A1 ${condicaoPix}` : "",
    precoUnitario ? `\u2139\uFE0F Pre\u00E7o unit\u00E1rio: ${precoUnitario}` : "",
    desconto ? `\uD83D\uDD25 ${desconto}` : "",
    parcelamento,
    cupom,
    instrucaoCupom && !instrucaoCupomRedundanteLocal(instrucaoCupom, oferta.cupom) ? `\u26A1 ${instrucaoCupom}` : "",
    montarLinkCompra(oferta),
    aplicarCupom && !instrucaoCupom ? aplicarCupom : ""
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
  const clienteId = opcoes.clienteId || oferta.clienteId || "admin";
  const destino = opcoes.destino || {};
  let resolucaoTemplate = null;
  const ofertaOficial = montarOfertaRenderizacaoOficial({
    ...oferta,
    clienteId
  });
  const fidelidadeTraceIdPrincipal = fidelidadeObs.flagAtiva()
    ? fidelidadeObs.resolverFidelidadeTraceId(oferta, oferta.metadata, ofertaOficial, ofertaOficial.metadata)
    : "";
  const contextoFidelidadeTemplate = fidelidadeTraceIdPrincipal
    ? { fidelidadeTraceId: fidelidadeTraceIdPrincipal }
    : {};
  const registrarTemplate = (templateTipo, mensagem) => {
    fidelidadeObs.registrarTemplate("template_saida", {
      ...contextoFidelidadeTemplate,
      clienteId,
      destinoId: destino.id || destino.destinoId || "",
      canal: opcoes.canal || destino.canal || destino.tipo || "",
      oferta: ofertaOficial,
      templateTipo,
      mensagem
    });
    return mensagem;
  };
  fidelidadeObs.registrarTemplate("template_entrada", {
    ...contextoFidelidadeTemplate,
    clienteId,
    destinoId: destino.id || destino.destinoId || "",
    canal: opcoes.canal || destino.canal || destino.tipo || "",
    oferta: ofertaOficial,
    templateTipo: "resolver_mensagem_oferta"
  });

  const espelhoPiloto = selecionarTemplateEspelhoPiloto({
    workspaceId: clienteId,
    oferta: ofertaOficial,
    destino,
    canal: opcoes.canal || destino.canal || destino.tipo
  });
  if (espelhoPiloto.usarEspelho && espelhoPiloto.mensagem) {
    return registrarTemplate("ofc_v24_espelho_piloto", espelhoPiloto.mensagem);
  }

  const dadosOficiaisUniversal = montarEntradaTemplateUniversalOficial(ofertaOficial);

  try {
    resolucaoTemplate = resolverTemplateMensagem({
      clienteId,
      destino,
      oferta: ofertaOficial,
      canal: opcoes.canal || destino.canal || destino.tipo,
      templatePersonalizadoHabilitado: opcoes.plano ? opcoes.plano?.recursos?.templatePersonalizado === true : true
    });
  } catch (erro) {
    console.warn("[TEMPLATE-ERRO-FALLBACK-UNIVERSAL]", {
      clienteId,
      destinoId: destino.id || null,
      templateId: destino.templateId || null,
      erro: String(erro?.message || erro || "erro_desconhecido").slice(0, 200)
    });
  }

  if (resolucaoTemplate?.ok && resolucaoTemplate.mensagem) {
    return registrarTemplate("personalizado_resolver", resolucaoTemplate.mensagem);
  }

  const mensagemUniversalOficial = tentarTemplateUniversalOficial(ofertaOficial, {
    ...opcoes,
    dadosOficiaisUniversal
  });
  if (mensagemUniversalOficial) return registrarTemplate("universal_oficial", mensagemUniversalOficial);

  if (deveUsarTemplatePersonalizado({ ...opcoes, oferta: ofertaOficial })) {
    const mensagemPersonalizada = montarMensagemTemplatePersonalizado(
      ofertaOficial,
      opcoes.destino
    );

    if (mensagemPersonalizada) return registrarTemplate("personalizado_legado", mensagemPersonalizada);
  }

  const marketplace = String(ofertaOficial.marketplace || "").toLowerCase();

  if (marketplace === "amazon") {
    const mensagemAmazon = formatarOfertaUniversal({
      ...ofertaOficial,
      precoOriginal: ofertaOficial.precoOriginal ?? ofertaOficial.precoAntigo,
      beneficioTexto: ofertaOficial.beneficioTexto || ofertaOficial.beneficioExtra || ofertaOficial.avisoCupom || ""
    }) || montarLegendaOferta(ofertaOficial);
    return registrarTemplate("fallback_amazon", mensagemAmazon);
  }

  if (marketplace === "shopee") {
    return registrarTemplate("fallback_shopee", montarLegendaShopee(ofertaOficial));
  }

  if (marketplace === "mercadolivre" || marketplace === "mercado_livre") {
    const mensagemMl = formatarOfertaUniversal({
      ...ofertaOficial,
      precoOriginal: ofertaOficial.precoOriginal ?? ofertaOficial.precoAntigo,
      beneficioTexto: ofertaOficial.beneficioTexto || ofertaOficial.beneficioExtra || ofertaOficial.avisoCupom || ""
    }) || montarLegendaOferta(ofertaOficial);
    return registrarTemplate("fallback_mercadolivre", mensagemMl);
  }

  return registrarTemplate("fallback_padrao", montarLegendaOferta(ofertaOficial) || ofertaOficial.mensagem || ofertaOficial.texto || "");
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
