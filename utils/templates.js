function cortarTitulo(titulo = "", limite = 120) {
  const texto = String(titulo || "Oferta").replace(/\s+/g, " ").trim();

  if (texto.length <= limite) return texto;

  return texto.slice(0, limite - 3).trim() + "...";
}

function normalizarPreco(valor) {
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

  const numero = normalizarPreco(texto);

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

  return link ? `🛒 Comprar:\n${link}` : "";
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
  const { plano = {}, destino = {} } = opcoes || {};

  if (!planoPermiteTemplatePersonalizado(plano)) return false;

  const mensagemOferta = obterConfigMensagemOferta(destino);

  if (mensagemOferta.modo !== "personalizado") return false;
  if (!mensagemOferta.template) return false;

  return true;
}

function montarDadosTemplateOferta(oferta = {}) {
  const titulo = cortarTitulo(oferta.titulo || oferta.nome || "Oferta", 120);
  const preco = formatarPreco(oferta.precoAtual || oferta.preco);
  const precoAntigo = formatarPreco(oferta.precoAntigo);
  const desconto = montarLinhaDesconto(oferta);
  const cupom = montarLinhaCupom(oferta);
  const parcelamento = montarLinhaParcelamento(oferta);
  const link = oferta.linkAfiliado || oferta.link || oferta.linkOriginal || "";

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
    avisoCupom: String(oferta.avisoCupom || "").trim(),
    aviso_cupom: String(oferta.avisoCupom || "").trim(),
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

  return substituirPlaceholders(
    mensagemOferta.template,
    montarDadosTemplateOferta(oferta)
  ).trim();
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
  montarDadosTemplateOferta,
  montarMensagemTemplatePersonalizado
};
