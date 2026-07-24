const { normalizarNumeroMoeda } = require("../../../../utils/moeda");
const { importarAliExpress } = require("../../../../marketplaces/aliexpress/importar");

function texto(valor = "") {
  return String(valor || "").trim();
}

function valorPresente(valor) {
  return valor !== null && valor !== undefined && texto(valor) !== "";
}

function primeiroValor(...valores) {
  for (const valor of valores) {
    if (valorPresente(valor)) return valor;
  }
  return "";
}

function numeroPreco(valor = "") {
  return normalizarNumeroMoeda(valor);
}

function escolherLinkAliExpress(links = [], evento = {}) {
  const candidatos = [];

  for (const link of Array.isArray(links) ? links : []) {
    candidatos.push({ url: link.url_expandida, link, campo: "url_expandida" });
    candidatos.push({ url: link.url_normalizada, link, campo: "url_normalizada" });
    candidatos.push({ url: link.url_original, link, campo: "url_original" });
  }

  if (Array.isArray(evento.links_extraidos)) {
    for (const url of evento.links_extraidos) {
      candidatos.push({ url, link: null, campo: "links_extraidos" });
    }
  }

  return candidatos
    .map(candidato => ({
      ...candidato,
      url: texto(candidato.url)
    }))
    .find(candidato => /aliexpress\./i.test(candidato.url)) || { url: "", link: null, campo: "" };
}

function calcularEconomia(precoAtual, precoOriginal) {
  const atual = numeroPreco(precoAtual);
  const original = numeroPreco(precoOriginal);

  if (atual === null || original === null || original <= atual) {
    return { economia: "", percentual: "" };
  }

  const economia = Number((original - atual).toFixed(2));
  const percentual = Math.round((economia / original) * 100);
  return { economia, percentual };
}

function textoOriginalEvento(evento = {}) {
  return texto(evento.texto_original || evento.textoOriginal || evento.texto || "");
}

function normalizarCupomAliExpress(cupom = "") {
  const codigo = texto(cupom)
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9_-]/g, "")
    .trim();

  const bloqueados = new Set([
    "ALIEXPRESS",
    "CUPOM",
    "CUPONS",
    "CODIGO",
    "PROMOCAO",
    "DESCONTO",
    "MOEDAS",
    "MOEDA",
    "APP",
    "SITE",
    "BRASIL",
    "LINK"
  ]);

  if (!codigo || codigo.length < 4 || codigo.length > 30) return "";
  if (bloqueados.has(codigo)) return "";
  if (!/[A-Z]/.test(codigo)) return "";
  return codigo;
}

function extrairCupomTextoAliExpress(textoRadar = "") {
  const fonte = String(textoRadar || "");
  const match =
    fonte.match(/(?:cupom|use o cupom|aplique o cupom|codigo|c[oó]digo|coupon|promo\s*code)\s*:?\s*([A-Z0-9_-]{4,30})/i) ||
    fonte.match(/\b([A-Z]{3,}[A-Z0-9_-]{1,27})\b\s*(?:no aliexpress|ali|aliexpress|no carrinho|com cupom)/i);

  return normalizarCupomAliExpress(match?.[1] || "");
}

function extrairBeneficioTextoAliExpress(produto = {}, evento = {}) {
  return primeiroValor(
    produto.beneficioComercial,
    produto.beneficioTexto,
    produto.beneficioExtra,
    produto.avisoCupom,
    produto.aviso,
    produto.cashback,
    produto.descontoPix,
    produto.descontoApp,
    produto.freteGratis === true ? "Frete gratis" : "",
    /moedas/i.test(textoOriginalEvento(evento)) ? "Confira desconto com moedas na pagina." : "",
    /cashback/i.test(textoOriginalEvento(evento)) ? "Cashback informado na mensagem." : ""
  );
}

function logAliExpressAdapter(evento, payload = {}) {
  console.log(evento, JSON.stringify(payload));
}

async function importarAliExpressEngine({ job = {}, evento = {}, links = [], deps = {} } = {}) {
  const clienteId = texto(job.cliente_id || job.clienteId || "");
  const linkEscolhido = escolherLinkAliExpress(links, evento);
  const urlOriginalEngine = linkEscolhido.url;

  if (!clienteId) {
    return { ok: false, marketplace: "aliexpress", motivo: "cliente_invalido" };
  }

  if (!urlOriginalEngine) {
    return { ok: false, marketplace: "aliexpress", motivo: "link_aliexpress_nao_encontrado" };
  }

  if (typeof deps.getIntegracaoCliente !== "function") {
    return { ok: false, marketplace: "aliexpress", motivo: "get_integracao_indisponivel", linkOriginal: urlOriginalEngine };
  }

  const integracao = deps.getIntegracaoCliente(clienteId, "aliexpress");
  if (!integracao) {
    return { ok: false, marketplace: "aliexpress", motivo: "integracao_ausente", linkOriginal: urlOriginalEngine };
  }

  const credenciais = integracao?.credenciais || {};
  if (!credenciais.appKey || !(credenciais.secret || credenciais.appSecret) || !credenciais.trackingId) {
    return { ok: false, marketplace: "aliexpress", motivo: "credenciais_incompletas", linkOriginal: urlOriginalEngine };
  }

  logAliExpressAdapter("[ENGINE-ALIEXPRESS-IMPORTADOR-CHAMADA]", {
    jobId: job.id,
    eventoId: job.evento_id,
    clienteId,
    urlUsada: urlOriginalEngine,
    campoLink: linkEscolhido.campo || "",
    temAppKey: Boolean(credenciais.appKey),
    temSecret: Boolean(credenciais.secret || credenciais.appSecret),
    temTrackingId: Boolean(credenciais.trackingId)
  });

  const importarLegado = typeof deps.importarAliExpress === "function"
    ? deps.importarAliExpress
    : importarAliExpress;

  let produto;
  try {
    produto = await importarLegado(urlOriginalEngine, {
      ...integracao,
      credenciais,
      clienteId,
      textoOriginal: textoOriginalEvento(evento),
      contextoEngine: {
        jobId: job.id,
        eventoId: job.evento_id,
        clienteId
      }
    });
  } catch (e) {
    logAliExpressAdapter("[ENGINE-ALIEXPRESS-IMPORTADOR-ERRO]", {
      jobId: job.id,
      eventoId: job.evento_id,
      clienteId,
      motivo: "erro_importador_aliexpress",
      erro: e.message
    });

    return {
      ok: false,
      marketplace: "aliexpress",
      motivo: "erro_importador_aliexpress",
      erro: e.message,
      linkOriginal: urlOriginalEngine
    };
  }

  if (!produto || produto.ok === false) {
    return {
      ok: false,
      marketplace: "aliexpress",
      motivo: produto?.motivo || "importador_sem_retorno",
      linkOriginal: urlOriginalEngine
    };
  }

  const precoAtual = primeiroValor(produto.precoAtual, produto.preco);
  const precoOriginal = primeiroValor(produto.precoOriginal, produto.precoAntigo);
  const precoNumerico = numeroPreco(precoAtual);
  const economiaCalculada = calcularEconomia(precoAtual, precoOriginal);
  const cupomTexto = extrairCupomTextoAliExpress(textoOriginalEvento(evento));
  const cupom = primeiroValor(produto.cupom, cupomTexto);
  const cupomTipo = primeiroValor(produto.tipoCupom, produto.cupomTipo, cupom ? "texto_radar" : "");
  const beneficioComercial = extrairBeneficioTextoAliExpress(produto, evento);
  const linkAfiliado = primeiroValor(produto.linkAfiliado, produto.linkFinal, produto.link);

  logAliExpressAdapter("[ENGINE-ALIEXPRESS-IMPORTADOR-RETORNO]", {
    jobId: job.id,
    eventoId: job.evento_id,
    clienteId,
    ok: true,
    titulo: produto.titulo || produto.nome || "",
    precoAtual,
    precoOriginal,
    cupom,
    beneficioComercial,
    linkAfiliado,
    imagem: produto.imagem || "",
    categoria: produto.categoria || produto.categoriaProduto || "",
    camposRetorno: Object.keys(produto || {})
  });

  if (!produto.titulo && !produto.nome) {
    return { ok: false, marketplace: "aliexpress", motivo: "titulo_indisponivel", linkOriginal: urlOriginalEngine };
  }

  if (precoNumerico === null) {
    return { ok: false, marketplace: "aliexpress", motivo: "preco_indisponivel", linkOriginal: urlOriginalEngine };
  }

  if (!linkAfiliado) {
    return { ok: false, marketplace: "aliexpress", motivo: "link_afiliado_vazio", linkOriginal: urlOriginalEngine };
  }

  return {
    ok: true,
    marketplace: "aliexpress",
    titulo: produto.titulo || produto.nome || "",
    preco: precoNumerico,
    precoAtual: precoNumerico,
    precoOriginal,
    precoAntigo: precoOriginal,
    economia: primeiroValor(produto.economia, economiaCalculada.economia),
    percentual: primeiroValor(produto.percentual, produto.descontoPercentual, economiaCalculada.percentual),
    descontoPercentual: primeiroValor(produto.descontoPercentual, produto.percentual, economiaCalculada.percentual),
    imagem: produto.imagem || "",
    linkOriginal: produto.linkOriginal || urlOriginalEngine,
    linkExpandido: primeiroValor(produto.linkExpandido, produto.linkOriginal, urlOriginalEngine),
    linkAfiliado,
    categoria: produto.categoria || produto.categoriaProduto || "",
    cupom,
    cupomTipo,
    tipoCupom: cupomTipo,
    avisoCupom: produto.avisoCupom || "",
    beneficioComercial,
    beneficioTexto: beneficioComercial,
    beneficioExtra: beneficioComercial,
    valorEfetivo: primeiroValor(produto.valorEfetivo, produto.precoFinalConfirmado),
    valorEfetivoOrigem: primeiroValor(produto.valorEfetivoOrigem, produto.precoFinalConfirmadoOrigem),
    cashback: produto.cashback || "",
    freteGratis: produto.freteGratis === true,
    origem: "engine_importer_aliexpress",
    clienteId,
    metadata: {
      adapter: "aliexpress",
      jobId: job.id,
      eventoId: job.evento_id,
      clienteId,
      linkOriginalEngine: urlOriginalEngine,
      campoLinkEscolhido: linkEscolhido.campo || "",
      textoRadarTemCupom: Boolean(cupomTexto),
      camposProduto: Object.keys(produto || {}),
      produto
    }
  };
}

module.exports = {
  importarAliExpressEngine
};
