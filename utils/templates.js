const { analisarValorMonetario } = require("./moeda");
const fidelidadeObs = require("../modules/fidelidade/observabilidade-v1");
function cortarTitulo(titulo = "", limite = 120) {
  const texto = String(titulo || "Oferta").replace(/\s+/g, " ").trim();

  if (texto.length <= limite) return texto;

  return texto.slice(0, limite - 3).trim() + "...";
}

function analisarPrecoTemplate(valor) {
  const valorOriginal = valor;
  const tipoPreco = valor === null ? "null" : typeof valor;

  if (valor == null || valor === "") {
    return {
      numero: 0,
      valorOriginal,
      tipoPreco,
      normalizadorAplicado: "vazio"
    };
  }

  if (typeof valor === "number") {
    return {
      numero: Number.isFinite(valor) ? valor : 0,
      valorOriginal,
      tipoPreco,
      normalizadorAplicado: "numero_direto"
    };
  }

  let normalizado = String(valor)
    .replace("R$", "")
    .replace(/[^\d.]/g, "")
    .trim();

  const bruto = String(valor)
    .replace(/R\$/gi, "")
    .replace(/\s+/g, "")
    .replace(/[^\d.,-]/g, "")
    .trim();

  const negativo = bruto.startsWith("-");
  let texto = bruto.replace(/-/g, "");

  if (texto.includes(",") && texto.includes(".")) {
    texto = texto.replace(/\./g, "").replace(",", ".");
    normalizado = texto;
  } else if (texto.includes(",")) {
    normalizado = texto.replace(",", ".");
  } else if (texto.includes(".")) {
    const partes = texto.split(".");
    const ultimo = partes[partes.length - 1] || "";
    const formatoMilhar = /^\d{1,3}(?:\.\d{3})+$/.test(texto);
    normalizado = formatoMilhar && ultimo.length === 3
      ? texto.replace(/\./g, "")
      : texto;
  } else {
    normalizado = texto;
  }

  if (negativo && normalizado) normalizado = `-${normalizado}`;

  const numero = Number(normalizado);
  return {
    numero: Number.isFinite(numero) ? numero : 0,
    valorOriginal,
    tipoPreco,
    normalizadorAplicado: "template_moeda_ptbr_decimal_seguro"
  };
}

function normalizarPreco(valor) {
  return analisarPrecoTemplate(valor).numero;
}

function logTemplatePrecoAuditoria({ precoFila = "", precoTemplate = "", tipoPreco = "", valorOriginal = "", valorFormatado = "", normalizadorAplicado = "" } = {}) {
  try {
    console.log("[TEMPLATE-PRECO-AUDITORIA]", JSON.stringify({
      precoFila,
      precoTemplate,
      tipoPreco,
      valorOriginal,
      valorFormatado,
      normalizadorAplicado
    }));
  } catch {}
}

function formatarPreco(valor) {
  if (typeof valor === "number" && Number.isFinite(valor)) {
    const formatado = `R$ ${valor.toLocaleString("pt-BR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })}`;
    logTemplatePrecoAuditoria({
      precoFila: valor,
      precoTemplate: formatado,
      tipoPreco: typeof valor,
      valorOriginal: valor,
      valorFormatado: formatado,
      normalizadorAplicado: "numero_direto"
    });
    return formatado;
  }

  const texto = String(valor || "").trim();
  if (!texto) return "";

  if (/^R\$\s*/i.test(texto)) {
    const formatado = texto.replace(/^R\$\s*/i, "R$ ");
    logTemplatePrecoAuditoria({
      precoFila: valor,
      precoTemplate: formatado,
      tipoPreco: typeof valor,
      valorOriginal: valor,
      valorFormatado: formatado,
      normalizadorAplicado: "ja_formatado_com_rs"
    });
    return formatado;
  }

  const analise = analisarPrecoTemplate(texto);
  const numero = analise.numero;

  if (numero > 0) {
    const formatado = `R$ ${numero.toLocaleString("pt-BR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })}`;
    logTemplatePrecoAuditoria({
      precoFila: valor,
      precoTemplate: formatado,
      tipoPreco: analise.tipoPreco,
      valorOriginal: valor,
      valorFormatado: formatado,
      normalizadorAplicado: analise.normalizadorAplicado
    });
    return formatado;
  }

  const formatado = `R$ ${texto}`;
  logTemplatePrecoAuditoria({
    precoFila: valor,
    precoTemplate: formatado,
    tipoPreco: typeof valor,
    valorOriginal: valor,
    valorFormatado: formatado,
    normalizadorAplicado: "fallback_texto"
  });
  return formatado;
}

function montarLinhaCupom(oferta = {}) {
  const cupom = String(oferta.cupom || "").trim();
  const avisoCupom = String(oferta.avisoCupom || "").trim();
  const iconeCupom = "\uD83C\uDF9F\uFE0F";

  if (cupom) return `${iconeCupom} Cupom: ${cupom}`;
  if (avisoCupom) return avisoCupom.startsWith(iconeCupom) ? avisoCupom : `${iconeCupom} ${avisoCupom}`;

  return "";
}

function montarLinhaParcelamento(oferta = {}) {
  const parcelamento = String(oferta.parcelamento || "").trim();
  const iconeParcelamento = "\uD83D\uDCB3";

  if (!parcelamento) return "";

  return parcelamento.startsWith(iconeParcelamento) ? parcelamento : `${iconeParcelamento} ${parcelamento}`;
}

function montarLinhaDesconto(oferta = {}) {
  const descontoManual =
    oferta.desconto ||
    oferta.percentualDesconto ||
    oferta.descontoPercentual ||
    "";

  if (descontoManual) {
    const texto = String(descontoManual).trim();
    return texto.includes("%") ? `${texto} OFF` : `${texto}% OFF`;
  }

  const precoAtual = normalizarPreco(oferta.precoAtual || oferta.preco);
  const precoAntigo = normalizarPreco(oferta.precoAntigo);

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

function removerLinhasVazias(linhas = [], separador = "\n\n") {
  return linhas.filter(Boolean).join(separador);
}

function montarLinkCompra(oferta = {}) {
  const link = oferta.linkAfiliado || oferta.link || oferta.linkOriginal || "";

  return link ? `\uD83D\uDD17 Confira aqui:\n${link}` : "";
}

function planoPermiteTemplatePersonalizado(plano = {}) {
  return plano?.recursos?.templatePersonalizado === true;
}

function obterConfigMensagemOferta(destino = {}) {
  const config = destino?.mensagemOferta;

  if (!config || typeof config !== "object") {
    return {
      modo: "padrao",
      template: ""
    };
  }

  return {
    modo: String(config.modo || "padrao").toLowerCase(),
    template: String(config.template || "").trim()
  };
}

function deveUsarTemplatePersonalizado(opcoes = {}) {
  const { plano = {}, destino = {}, oferta = {} } = opcoes || {};

  if (!planoPermiteTemplatePersonalizado(plano)) return false;

  const mensagemOferta = obterConfigMensagemOferta(destino);

  if (mensagemOferta.modo !== "personalizado") return false;
  if (!mensagemOferta.template) return false;
  if (templatePersonalizadoLegadoIncompleto(mensagemOferta.template, oferta)) return false;

  return true;
}

function templateTemPlaceholder(template = "", nomes = []) {
  const placeholders = new Set(
    [...String(template || "").matchAll(/\{([^{}]+)\}/g)]
      .map(match => String(match[1] || "").trim())
      .filter(Boolean)
  );
  return nomes.some(nome => placeholders.has(nome));
}

function temValorOferta(valor) {
  return valor !== null && valor !== undefined && String(valor).trim() !== "";
}

function templatePersonalizadoLegadoIncompleto(template = "", oferta = {}) {
  const precoAtual = normalizarPreco(oferta.precoAtual ?? oferta.precoPor ?? oferta.preco);
  const precoAntigo = normalizarPreco(oferta.precoOriginal ?? oferta.precoAntigo ?? oferta.precoDe);
  const temPrecoDe = precoAntigo > 0 && precoAtual > 0 && precoAntigo > precoAtual;
  const temCupom = temValorOferta(oferta.cupom) ||
    (Array.isArray(oferta.cupons) && oferta.cupons.length > 0) ||
    (Array.isArray(oferta.codigosCupom) && oferta.codigosCupom.length > 0);
  const temInstrucao = temValorOferta(oferta.instrucaoCupom || oferta.condicaoCupom || oferta.condicaoComercial || oferta.avisoCupom);
  const temPix = temValorOferta(oferta.condicaoPix || oferta.precoPix);
  const temParcelamento = temValorOferta(oferta.parcelamento);

  if (temPrecoDe && !templateTemPlaceholder(template, ["precoAntigo", "preco_antigo", "precoOriginal", "preco_original", "precoDe", "preco_de"])) return true;
  if (temCupom && !templateTemPlaceholder(template, ["cupom", "codigoCupom", "codigo_cupom", "codigosCupom", "codigos_cupom", "cupons"])) return true;
  if (temInstrucao && !templateTemPlaceholder(template, ["instrucaoCupom", "instrucao_cupom", "avisoCupom", "aviso_cupom", "condicaoCupom", "condicao_cupom", "condicaoComercial", "condicao_comercial"])) return true;
  if (temPix && !templateTemPlaceholder(template, ["condicaoPix", "condicao_pix", "precoPix", "preco_pix"])) return true;
  if (temParcelamento && !templateTemPlaceholder(template, ["parcelamento"])) return true;

  return false;
}

function montarDadosTemplateOferta(oferta = {}) {
  const titulo = cortarTitulo(oferta.titulo || oferta.nome || "Oferta", 120);
  const preco = formatarPreco(oferta.precoAtual || oferta.preco);
  const precoAntigo = formatarPreco(oferta.precoOriginal ?? oferta.precoAntigo);
  const desconto = montarLinhaDesconto(oferta);
  const cupom = montarLinhaCupom(oferta);
  const parcelamento = montarLinhaParcelamento(oferta);
  const link = oferta.linkAfiliado || oferta.link || oferta.linkOriginal || "";
  const codigosCupom = Array.isArray(oferta.codigosCupom)
    ? oferta.codigosCupom.join(" ou ")
    : (Array.isArray(oferta.cupons) ? oferta.cupons.join(" ou ") : String(oferta.codigoCupom || oferta.cupom || "").trim());
  const instrucaoCupom = String(oferta.instrucaoCupom || oferta.condicaoCupom || oferta.condicaoComercial || oferta.avisoCupom || "").trim();
  const condicaoPix = String(oferta.condicaoPix || oferta.precoPix || "").trim();

  return {
    titulo,
    titulo_curto: titulo,
    preco,
    precoAtual: preco,
    preco_atual: preco,
    precoAntigo,
    preco_antigo: precoAntigo,
    desconto,
    cupom,
    codigoCupom: codigosCupom,
    codigo_cupom: codigosCupom,
    codigosCupom,
    codigos_cupom: codigosCupom,
    cupons: codigosCupom,
    avisoCupom: String(oferta.avisoCupom || "").trim(),
    aviso_cupom: String(oferta.avisoCupom || "").trim(),
    instrucaoCupom,
    instrucao_cupom: instrucaoCupom,
    condicaoCupom: String(oferta.condicaoCupom || "").trim(),
    condicao_cupom: String(oferta.condicaoCupom || "").trim(),
    condicaoComercial: String(oferta.condicaoComercial || "").trim(),
    condicao_comercial: String(oferta.condicaoComercial || "").trim(),
    condicaoPix,
    condicao_pix: condicaoPix,
    precoPix: condicaoPix,
    preco_pix: condicaoPix,
    precoUnitario: String(oferta.precoUnitario || oferta.unitarioCapturado || "").trim(),
    preco_unitario: String(oferta.precoUnitario || oferta.unitarioCapturado || "").trim(),
    parcelamento,
    link,
    linkAfiliado: link,
    link_afiliado: link
  };
}

function substituirPlaceholders(template = "", dados = {}) {
  return String(template || "").replace(/\{([^{}]+)\}/g, (_, chave) => {
    const nome = String(chave || "").trim();
    return dados[nome] == null ? "" : String(dados[nome]);
  });
}

function montarMensagemTemplatePersonalizado(oferta = {}, destino = {}) {
  const mensagemOferta = obterConfigMensagemOferta(destino);

  if (!mensagemOferta.template) return "";

  fidelidadeObs.registrarTemplate("template_personalizado_legado_entrada", {
    oferta,
    destinoId: destino.id || destino.destinoId || "",
    templateTipo: "personalizado_legado"
  });
  const mensagem = substituirPlaceholders(
    mensagemOferta.template,
    montarDadosTemplateOferta(oferta)
  ).trim();
  fidelidadeObs.registrarTemplate("template_personalizado_legado_saida", {
    oferta,
    destinoId: destino.id || destino.destinoId || "",
    templateTipo: "personalizado_legado",
    mensagem
  });
  return mensagem;
}

module.exports = {
  cortarTitulo,
  formatarPreco,
  normalizarPreco,
  montarLinhaCupom,
  montarLinhaParcelamento,
  montarLinhaDesconto,
  removerLinhasVazias,
  montarLinkCompra,
  substituirPlaceholders,
  planoPermiteTemplatePersonalizado,
  obterConfigMensagemOferta,
  deveUsarTemplatePersonalizado,
  templatePersonalizadoLegadoIncompleto,
  montarDadosTemplateOferta,
  montarMensagemTemplatePersonalizado
};
