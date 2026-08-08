const {
  cortarTitulo,
  formatarPreco,
  normalizarPreco,
  montarLinhaCupom,
  montarLinhaParcelamento,
  montarLinhaDesconto,
  removerLinhasVazias,
  montarLinkCompra
} = require("./templates");
const { gerarTemplateUniversal } = require("../modules/template-universal");
const { resolverTemplateMensagem } = require("../modules/templates-clientes/resolver");
const { prepararDadosOficiaisTemplate } = require("../modules/templates-clientes/dados-oficiais");
const fidelidadeObs = require("../modules/fidelidade/observabilidade-v1");
const { selecionarTemplateEspelhoPiloto } = require("../modules/ofc-v2/espelho-piloto");

function normalizarTextoLocal(valor = "") {
  return String(valor || "").trim();
}

function textoMensagemExistenteLocal(valor = "") {
  if (valor === null || valor === undefined) return "";
  if (typeof valor === "object" || typeof valor === "function") return "";
  const texto = String(valor).trim();
  if (!texto || ["undefined", "null", "nan"].includes(texto.toLowerCase())) return "";
  return texto;
}

function resolverMensagemExistente(oferta = {}, opcoes = {}, ofertaOficial = {}) {
  const metadata = oferta.metadata && typeof oferta.metadata === "object" ? oferta.metadata : {};
  const metadataOficial = ofertaOficial.metadata && typeof ofertaOficial.metadata === "object" ? ofertaOficial.metadata : {};
  const radarMirror = metadata.radarMirror && typeof metadata.radarMirror === "object" ? metadata.radarMirror : {};
  const radarMirrorOficial = metadataOficial.radarMirror && typeof metadataOficial.radarMirror === "object" ? metadataOficial.radarMirror : {};
  const candidatos = [
    opcoes.mensagemAtual,
    opcoes.mensagemExistente,
    opcoes.mensagemOriginal,
    opcoes.textoOriginal,
    oferta.mensagemRenderizada,
    oferta.mensagemFinal,
    oferta.mensagem,
    oferta.legenda,
    oferta.texto,
    oferta.textoOriginal,
    oferta.mensagemOriginalRadar,
    oferta.textoComercialOriginal,
    metadata.mensagemOriginalRadar,
    metadata.textoOriginal,
    radarMirror.texto?.original,
    radarMirror.evento?.texto_original,
    ofertaOficial.mensagemRenderizada,
    ofertaOficial.mensagemFinal,
    ofertaOficial.mensagem,
    ofertaOficial.legenda,
    ofertaOficial.texto,
    ofertaOficial.textoOriginal,
    ofertaOficial.mensagemOriginalRadar,
    ofertaOficial.textoComercialOriginal,
    metadataOficial.mensagemOriginalRadar,
    metadataOficial.textoOriginal,
    radarMirrorOficial.texto?.original,
    radarMirrorOficial.evento?.texto_original
  ];

  for (const candidato of candidatos) {
    const mensagem = textoMensagemExistenteLocal(candidato);
    if (mensagem) return mensagem;
  }

  return "Oferta recebida. Renderizacao oficial indisponivel no momento.";
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

function templateUniversalOficialAtivo() {
  return true;
}

function rioOficialAtivo(oferta = {}, opcoes = {}) {
  const arquitetura = opcoes.arquiteturaComercial && typeof opcoes.arquiteturaComercial === "object"
    ? opcoes.arquiteturaComercial
    : {};
  const metadata = oferta.metadata && typeof oferta.metadata === "object" ? oferta.metadata : {};
  const arquiteturaOferta = metadata.arquiteturaComercial && typeof metadata.arquiteturaComercial === "object"
    ? metadata.arquiteturaComercial
    : {};

  return opcoes.rioOficialAtivo !== false &&
    arquitetura.rioOficial !== false &&
    arquiteturaOferta.rioOficial !== false &&
    oferta.rioOficial !== false;
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
      avaliacao: entradaUniversal.avaliacao ?? "",
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
  let espelhoPilotoResultado = null;
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
  const renderersFinaisValidos = new Set([
    "ofc_v25_documento_canonico",
    "ofc_v25_espelho",
    "renderer_oficial",
    "template_personalizado",
    "template_universal",
    "template_legado",
    "fallback_marketplace",
    "fallback_generico"
  ]);
  const valorLogCurto = (valor, fallback = "") => {
    if (valor === null || valor === undefined) return fallback;
    return String(valor).replace(/[\u0000-\u001F\u007F]/g, "").slice(0, 120) || fallback;
  };
  const rendererFinalSeguro = (renderer) => {
    const normalizado = valorLogCurto(renderer, "fallback_generico");
    return renderersFinaisValidos.has(normalizado) ? normalizado : "fallback_generico";
  };
  const registrarRendererFinal = (templateTipo = "", decisao = {}) => {
    const metadata = ofertaOficial.metadata && typeof ofertaOficial.metadata === "object" ? ofertaOficial.metadata : {};
    const ofcV24 = metadata.ofcV24 && typeof metadata.ofcV24 === "object" ? metadata.ofcV24 : {};
    const rendererEscolhido = rendererFinalSeguro(decisao.rendererEscolhido || ({
      ofc_v24_espelho_piloto: ofcV24.documentoComercialCanonico ? "ofc_v25_documento_canonico" : "ofc_v25_espelho",
      personalizado_resolver: "template_personalizado",
      universal_oficial: "template_universal",
      mensagem_existente_sem_reconstrucao: "renderer_oficial",
      personalizado_legado: "template_legado",
      fallback_amazon: "fallback_marketplace",
      fallback_shopee: "fallback_marketplace",
      fallback_mercadolivre: "fallback_marketplace",
      fallback_padrao: "fallback_generico"
    }[templateTipo] || "fallback_generico"));
    const fallbackUtilizado = decisao.fallbackUtilizado === true ||
      rendererEscolhido === "renderer_oficial" ||
      rendererEscolhido === "template_legado" ||
      rendererEscolhido === "fallback_marketplace" ||
      rendererEscolhido === "fallback_generico";
    const payload = {
      workspaceId: valorLogCurto(clienteId),
      ofertaId: valorLogCurto(ofertaOficial.engineOfertaId || ofertaOficial.id || ofertaOficial.ofertaId || ""),
      marketplace: valorLogCurto(ofertaOficial.marketplace || ""),
      rendererEscolhido,
      motivo: valorLogCurto(decisao.motivo || espelhoPilotoResultado?.motivo || templateTipo || "renderer_oficial", "renderer_oficial"),
      temOfcV24: Boolean(Object.keys(ofcV24).length),
      temDocumentoCanonico: Boolean(ofcV24.documentoComercialCanonico),
      temEspelho: Boolean(ofcV24.espelhoComercial),
      temTemplateEspelho: Boolean(ofcV24.templateEspelhoShadow || ofcV24.templateEspelho),
      templatePersonalizado: rendererEscolhido === "template_personalizado" || rendererEscolhido === "template_legado",
      templateUniversal: rendererEscolhido === "template_universal",
      fallbackUtilizado,
      pilotoAtivo: espelhoPilotoResultado?.ativo === true
    };

    try {
      console.log("[OFC-V2.5-RENDERER-FINAL]", JSON.stringify(payload));
      if (fallbackUtilizado) {
        console.log("[OFC-V2.5-RENDERER-FALLBACK]", JSON.stringify({
          rendererOrigem: decisao.rendererOrigem || (payload.temDocumentoCanonico ? "ofc_v25_documento_canonico" : payload.temEspelho ? "ofc_v25_espelho" : "template_universal"),
          rendererDestino: rendererEscolhido,
          motivo: payload.motivo
        }));
      }
    } catch (_) {
      // Observabilidade do renderer nao pode interferir no envio.
    }
  };
  const motivoRendererOficial = (motivoPadrao = "renderer_oficial") => {
    const motivoPiloto = espelhoPilotoResultado?.motivo || "";
    if (motivoPiloto === "workspace_fora_do_piloto") return "workspace_fora_piloto";
    if (espelhoPilotoResultado?.ativo === true && espelhoPilotoResultado?.usarEspelho !== true) {
      if (motivoPiloto === "template_espelho_indisponivel") return "documento_ausente";
      if (motivoPiloto === "template_espelho_invalido") return "template_invalido";
      return motivoPiloto || motivoPadrao;
    }
    return motivoPadrao;
  };
  const registrarTemplate = (templateTipo, mensagem, decisao = {}) => {
    fidelidadeObs.registrarTemplate("template_saida", {
      ...contextoFidelidadeTemplate,
      clienteId,
      destinoId: destino.id || destino.destinoId || "",
      canal: opcoes.canal || destino.canal || destino.tipo || "",
      oferta: ofertaOficial,
      templateTipo,
      mensagem
    });
    registrarRendererFinal(templateTipo, decisao);
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

  const mensagemExistente = resolverMensagemExistente(oferta, opcoes, ofertaOficial);

  espelhoPilotoResultado = selecionarTemplateEspelhoPiloto({
    workspaceId: clienteId,
    oferta: ofertaOficial,
    mensagemAtual: mensagemExistente,
    destino,
    canal: opcoes.canal || destino.canal || destino.tipo,
    rioOficialAtivo: rioOficialAtivo(ofertaOficial, opcoes)
  });
  if (espelhoPilotoResultado.usarEspelho && espelhoPilotoResultado.mensagem) {
    return registrarTemplate("ofc_v24_espelho_piloto", espelhoPilotoResultado.mensagem, {
      rendererEscolhido: espelhoPilotoResultado.motivo === "documento_canonico_adaptativo_valido" ? "ofc_v25_documento_canonico" : "ofc_v25_espelho",
      motivo: espelhoPilotoResultado.motivo || "documento_canonico"
    });
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
    return registrarTemplate("personalizado_resolver", resolucaoTemplate.mensagem, {
      rendererEscolhido: "template_personalizado",
      motivo: motivoRendererOficial("renderer_oficial")
    });
  }

  const mensagemUniversalOficial = tentarTemplateUniversalOficial(ofertaOficial, {
    ...opcoes,
    dadosOficiaisUniversal
  });
  if (mensagemUniversalOficial) return registrarTemplate("universal_oficial", mensagemUniversalOficial, {
    rendererEscolhido: "template_universal",
    motivo: motivoRendererOficial("renderer_oficial")
  });

  return registrarTemplate("mensagem_existente_sem_reconstrucao", mensagemExistente, {
    rendererEscolhido: "renderer_oficial",
    motivo: "mensagem_existente_sem_reconstrucao",
    fallbackUtilizado: true,
    rendererOrigem: "template_universal"
  });
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
