"use strict";

const { normalizarNumeroMoeda } = require("../../../../utils/moeda");
const {
  produtoIdPorUrl
} = require("../../../marketplaces/magalu/magalu-parser");
const {
  resolverFatosMagalu
} = require("../../../marketplaces/magalu/magalu-factual-resolver");
const {
  criarProvaAfiliacaoWorkspaceMagalu
} = require("../../../marketplaces/magalu/afiliacao-workspace");
const {
  escolherProdutoPrincipal,
  resumoLinksClassificados
} = require("../../link-role.service");

const POLITICA_MAGALU_ENGINE = Object.freeze({
  timeoutMs: 2500,
  retries: 0,
  retryDelayMs: 0
});

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

function textoOriginalEvento(evento = {}) {
  return texto(evento.texto_original || evento.textoOriginal || evento.texto || "");
}

function objetosPrecoRadarEvento(evento = {}) {
  const candidatos = [
    evento,
    evento.metadata,
    evento.radarMirror,
    evento.metadata?.radarMirror,
    evento.metadata?.radarEspelhoComercial,
    evento.metadata?.ofcV24?.comercialNormalizado,
    evento.metadata?.ofcV24?.documentoComercialCanonico
  ];

  return candidatos.filter(item => item && typeof item === "object" && !Array.isArray(item));
}

function campoValorPrecoRadar(campo) {
  if (campo && typeof campo === "object" && !Array.isArray(campo)) {
    return primeiroValor(campo.valor, campo.atualCapturado, campo.precoAtual, campo.texto, campo.raw);
  }
  return campo;
}

function extrairPrecoEstruturadoRadarMagalu(evento = {}) {
  const chavesDiretas = ["precoAtual", "preco", "precoOferta", "precoPor", "valorEfetivo"];

  for (const origem of objetosPrecoRadarEvento(evento)) {
    for (const chave of chavesDiretas) {
      const valor = campoValorPrecoRadar(origem[chave]);
      if (numeroPreco(valor) !== null) return valor;
    }

    const preco = origem.preco && typeof origem.preco === "object" ? origem.preco : null;
    if (preco) {
      for (const chave of ["atualCapturado", "atual", "precoAtual", "valor"]) {
        const valor = campoValorPrecoRadar(preco[chave]);
        if (numeroPreco(valor) !== null) return valor;
      }
    }

    const comercial = origem.comercial && typeof origem.comercial === "object" ? origem.comercial : null;
    if (comercial) {
      for (const chave of chavesDiretas) {
        const valor = campoValorPrecoRadar(comercial[chave]);
        if (numeroPreco(valor) !== null) return valor;
      }
    }
  }

  return "";
}

function extrairPrecoTextoRadarMagalu(textoRadar = "") {
  const ofertaComercial = extrairOfertaComercialTextoRadarMagalu(textoRadar);
  if (numeroPreco(ofertaComercial.precoAtual) !== null) return ofertaComercial.precoAtual;

  const linhas = String(textoRadar || "")
    .split(/\r?\n/)
    .map(linha => linha.trim())
    .filter(Boolean);

  for (const linha of linhas) {
    const normalizada = linha.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    if (!/r\$\s*\d/i.test(linha)) continue;
    if (/\b(cupom|off|desconto|cashback|frete|economia|voucher|sku|codigo|quantidade|qtd|parcela|parcelamento)\b/i.test(normalizada)) continue;
    if (/\b\d{1,2}\s*x\s+de\b/i.test(normalizada)) continue;
    if (/^\s*de\b/i.test(normalizada) && !/\bpor\b/i.test(normalizada)) continue;
    const match = linha.match(/R\$\s*\d{1,3}(?:[\.\s]?\d{3})*(?:,\d{2})?|R\$\s*\d+(?:,\d{2})?/i);
    if (match) return match[0].replace(/\s+/g, " ").trim();
  }

  return "";
}

function extrairOfertaComercialTextoRadarMagalu(textoRadar = "") {
  const texto = String(textoRadar || "").replace(/\r/g, "");
  const valorMonetario = "(\\d{1,3}(?:\\.\\d{3})*,\\d{2}|\\d+,\\d{2})";
  const capturar = rotulo => {
    const padrao = new RegExp(
      `(?:^|[|;\\n])\\s*${rotulo}\\s*:?\\s*(?:R\\$\\s*)?${valorMonetario}(?=\\s*(?:$|[|;\\n]))`,
      "i"
    );
    return texto.match(padrao)?.[1] || "";
  };

  return {
    precoAtual: capturar("por"),
    precoAnterior: capturar("de")
  };
}

function extrairPrecoRadarSeguroMagalu(evento = {}) {
  return primeiroValor(
    extrairPrecoTextoRadarMagalu(textoOriginalEvento(evento)),
    extrairPrecoEstruturadoRadarMagalu(evento)
  );
}

function extrairPrecoAnteriorRadarSeguroMagalu(evento = {}) {
  const precoAnteriorTexto = extrairOfertaComercialTextoRadarMagalu(textoOriginalEvento(evento)).precoAnterior;
  if (numeroPreco(precoAnteriorTexto) !== null) return precoAnteriorTexto;

  const chaves = ["precoAnterior", "precoOriginal", "precoDe", "precoAntes"];
  for (const origem of objetosPrecoRadarEvento(evento)) {
    for (const chave of chaves) {
      const valor = campoValorPrecoRadar(origem[chave]);
      if (numeroPreco(valor) !== null) return valor;
    }
    const preco = origem.preco && typeof origem.preco === "object" ? origem.preco : null;
    if (preco) {
      for (const chave of chaves) {
        const valor = campoValorPrecoRadar(preco[chave]);
        if (numeroPreco(valor) !== null) return valor;
      }
    }
  }
  return "";
}

function extrairCupomRadarSeguroMagalu(evento = {}) {
  const candidatos = [
    evento.cupom,
    evento.codigoCupom,
    evento.metadata?.cupom,
    evento.metadata?.codigoCupom,
    evento.radarMirror?.cupom,
    evento.metadata?.radarMirror?.cupom,
    evento.metadata?.ofcV24?.comercialNormalizado?.cupom
  ];
  for (const candidato of candidatos) {
    const valor = texto(candidato && typeof candidato === "object"
      ? primeiroValor(candidato.codigo, candidato.valor, candidato.texto)
      : candidato);
    if (valor) return valor;
  }
  return "";
}

function normalizarTextoComparacaoMagalu(valor = "") {
  return texto(valor)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function tituloRadarSeguroMagalu(valor = "") {
  if (valor && typeof valor === "object") return "";
  const titulo = texto(valor).replace(/\s+/g, " ");
  if (titulo.length < 4) return "";
  if (/https?:\/\//i.test(titulo)) return "";
  if (/r\$\s*\d/i.test(titulo)) return "";

  const normalizado = normalizarTextoComparacaoMagalu(titulo);
  if (/\b(captcha|complete o captcha|nao e possivel acessar a pagina)\b/i.test(normalizado)) return "";
  if (/^(?:oferta|promocao|promo|produto|achadinho)\s*(?:magalu|magazine luiza)?$/i.test(normalizado)) return "";
  if (/^(?:por|de|pix|preco|valor|parcel|cupom|codigo|cod|frete|desconto|economia|off|link)\b/i.test(normalizado)) return "";

  return titulo;
}

function extrairTituloTextoRadarMagalu(textoRadar = "") {
  const linhas = String(textoRadar || "")
    .split(/\r?\n/)
    .map(linha => linha.trim())
    .filter(Boolean);

  for (const linha of linhas) {
    const titulo = tituloRadarSeguroMagalu(linha);
    if (titulo) return titulo;
  }

  return "";
}

function extrairTituloRadarSeguroMagalu(evento = {}) {
  const candidatos = [
    evento.titulo,
    evento.nome,
    evento.produto,
    evento.metadata?.titulo,
    evento.metadata?.nome,
    evento.metadata?.produto?.titulo,
    evento.radarMirror?.produto?.tituloCapturado,
    evento.metadata?.radarMirror?.produto?.tituloCapturado,
    evento.metadata?.radarEspelhoComercial?.titulo,
    evento.metadata?.ofcV24?.comercialNormalizado?.titulo,
    evento.metadata?.ofcV24?.documentoComercialCanonico?.titulo,
    evento.metadata?.ofcV24?.documentoComercialCanonico?.tituloOriginal
  ];

  for (const candidato of candidatos) {
    const titulo = tituloRadarSeguroMagalu(candidato);
    if (titulo) return titulo;
  }

  return extrairTituloTextoRadarMagalu(textoOriginalEvento(evento));
}

function escolherLinkMagalu(links = [], evento = {}) {
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

  const validos = candidatos
    .map(candidato => ({ ...candidato, url: texto(candidato.url) }))
    .filter(candidato => /magazineluiza\.com\.br|magazinevoce\.com\.br|magalu\.com|magazineluiza\.onelink\.me/i.test(candidato.url));

  if (!validos.length) return { url: "", link: null, campo: "" };
  return escolherProdutoPrincipal(validos, "magalu", evento);
}

function credencialPromoterIdMagalu(integracao = {}) {
  return texto(integracao?.credenciais?.promoterId || integracao?.promoterId);
}

function adicionarAvisoMagalu(avisos = [], aviso = "") {
  if (aviso && !avisos.includes(aviso)) avisos.push(aviso);
}

function avisosProdutoBloqueiamFallbackRadarMagalu(avisos = []) {
  const bloqueadores = [
    "magalu_canonica_produto_divergente_ignorada",
    "magalu_og_url_produto_divergente_ignorada",
    "magalu_response_url_produto_divergente_ignorada",
    "magalu_jsonld_produto_divergente_ignorado",
    "magalu_conteudo_produto_divergente_ignorado",
    "magalu_link_produto_divergente_ignorado",
    "magalu_link_loja_divergente"
  ];

  return bloqueadores.some(aviso => avisos.includes(aviso));
}

function logMagaluAdapter(evento, payload = {}) {
  console.log(evento, JSON.stringify(payload));
}

async function importarProdutoMagaluEngine({ job = {}, evento = {}, links = [], deps = {} } = {}) {
  const clienteId = texto(job.cliente_id || job.clienteId || "");
  const linkEscolhido = escolherLinkMagalu(links, evento);
  const urlOriginalEngine = linkEscolhido.url;
  const linksClassificados = resumoLinksClassificados(links, evento, "magalu");

  if (!clienteId) {
    return { ok: false, marketplace: "magalu", motivo: "cliente_invalido" };
  }

  if (!urlOriginalEngine) {
    return {
      ok: false,
      marketplace: "magalu",
      motivo: linkEscolhido.papelLinkMotivo || "link_produto_magalu_nao_confirmado",
      metadata: {
        adapter: "magalu",
        linksClassificados
      }
    };
  }

  if (typeof deps.getIntegracaoCliente !== "function") {
    return { ok: false, marketplace: "magalu", motivo: "get_integracao_indisponivel", linkOriginal: urlOriginalEngine };
  }

  const integracao = deps.getIntegracaoCliente(clienteId, "magalu");
  const promoterId = credencialPromoterIdMagalu(integracao);
  if (!integracao || !promoterId) {
    return { ok: false, marketplace: "magalu", motivo: "integracao_ausente", linkOriginal: urlOriginalEngine };
  }

  const resolverMagalu = typeof deps.resolverFatosMagalu === "function"
    ? deps.resolverFatosMagalu
    : resolverFatosMagalu;
  logMagaluAdapter("[ENGINE-MAGALU-IMPORTADOR-CHAMADA]", {
    jobId: job.id,
    eventoId: job.evento_id,
    clienteId,
    urlUsada: urlOriginalEngine,
    campoLink: linkEscolhido.campo || "",
    papelLink: linkEscolhido.papelLink || "",
    papelLinkMotivo: linkEscolhido.papelLinkMotivo || "",
    temPromoterId: Boolean(promoterId)
  });

  let produto;
  let erroResolver = null;
  try {
    const resolucao = await resolverMagalu(
      { urlOriginal: urlOriginalEngine, promoterId },
      {
        consultarProdutoMagalu: deps.consultarProdutoMagalu,
        parserOptions: {
          ...POLITICA_MAGALU_ENGINE,
          ...(deps.magaluParserOptions || {}),
          contextoEngine: {
            jobId: job.id,
            eventoId: job.evento_id,
            clienteId
          }
        }
      }
    );
    produto = {
      ...(resolucao?.fatos || {}),
      sellerIdOriginal: resolucao?.sellerIdOriginal || "",
      fonteWorkspaceValidada: resolucao?.fonteUsada || "",
      magaluWorkspaceValidado: resolucao?.fatos?.magaluWorkspaceValidado === true,
      metadata: {
        ...(resolucao?.fatos?.metadata || {}),
        factualResolver: {
          fonteUsada: resolucao?.fonteUsada || "",
          tentativas: Array.isArray(resolucao?.tentativas) ? resolucao.tentativas : []
        }
      },
      avisos: [...new Set([...(resolucao?.avisos || []), ...(resolucao?.fatos?.avisos || [])])]
    };
  } catch (e) {
    erroResolver = e;
    logMagaluAdapter("[ENGINE-MAGALU-IMPORTADOR-ERRO]", {
      jobId: job.id,
      eventoId: job.evento_id,
      clienteId,
      motivo: "erro_parser_magalu",
      erro: e.message
    });
    produto = {
      ok: false,
      motivo: "erro_parser_magalu",
      avisos: ["magalu_resolver_factual_falhou"],
      metadata: {
        factualResolver: {
          fonteUsada: "",
          tentativas: [],
          erro: e.message
        }
      }
    };
  }

  const avisosProduto = Array.isArray(produto.avisos) ? produto.avisos : [];
  if (!produto || produto.ok === false) {
    adicionarAvisoMagalu(avisosProduto, produto?.motivo || "parser_sem_retorno");
  }

  const produtoIdRadar = produtoIdPorUrl(urlOriginalEngine);
  const urlWorkspaceValidada = produto.magaluWorkspaceValidado === true
    ? texto(produto.urlAfiliavelComprovada)
    : "";
  const provaAfiliado = criarProvaAfiliacaoWorkspaceMagalu({
    clienteId,
    promoterId,
    productId: produtoIdRadar,
    seller: produto.sellerIdOriginal || "",
    urlOriginal: urlOriginalEngine,
    urlAfiliadaWorkspace: urlWorkspaceValidada,
    paginaValidada: produto.magaluWorkspaceValidado === true
  });
  const urlCanonica = primeiroValor(urlWorkspaceValidada, produto.urlOriginal, urlOriginalEngine);
  const linkAfiliado = provaAfiliado.conversaoStatus === "convertida" ? texto(provaAfiliado.urlAfiliadaWorkspace) : "";
  const tituloRadarSeguro = extrairTituloRadarSeguroMagalu(evento);
  const tituloFinal = primeiroValor(tituloRadarSeguro, produto.titulo);
  const precoRadarSeguro = extrairPrecoRadarSeguroMagalu(evento);
  const radarDefiniuPreco = numeroPreco(precoRadarSeguro) !== null;
  const precoAtual = radarDefiniuPreco ? precoRadarSeguro : "";
  const precoNumerico = numeroPreco(precoAtual);
  const precoPagina = primeiroValor(produto.precoAtual, produto.preco);
  const precoPaginaNumerico = numeroPreco(precoPagina);
  const precoOriginal = extrairPrecoAnteriorRadarSeguroMagalu(evento);
  const economiaCalculada = { economia: "", percentual: "" };
  const imagemOficial = /^https:\/\/(?:[a-z0-9-]+\.)?mlcdn\.com\.br\//i.test(texto(produto.imagem)) ? texto(produto.imagem) : "";

  const payloadRetornoMagalu = {
    jobId: job.id,
    eventoId: job.evento_id,
    clienteId,
    titulo: tituloFinal,
    precoAtual,
    precoPagina,
    precoOriginal,
    precoOrigem: radarDefiniuPreco ? "texto_radar" : "radar_ausente",
    linkAfiliado,
    imagem: imagemOficial,
    categoria: produto.categoria || "",
    camposRetorno: Object.keys(produto || {})
  };

  if (avisosProdutoBloqueiamFallbackRadarMagalu(avisosProduto)) {
    return {
      ok: false,
      marketplace: "magalu",
      motivo: "identidade_produto_insegura",
      linkOriginal: urlOriginalEngine,
      metadata: {
        adapter: "magalu",
        linksClassificados,
        avisos: avisosProduto
      }
    };
  }

  if (!texto(tituloFinal)) {
    return { ok: false, marketplace: "magalu", motivo: "titulo_indisponivel", linkOriginal: urlOriginalEngine };
  }

  if (precoNumerico === null) {
    return { ok: false, marketplace: "magalu", motivo: "preco_indisponivel", linkOriginal: urlOriginalEngine };
  }

  if (!linkAfiliado) {
    return {
      ok: false,
      marketplace: "magalu",
      motivo: "afiliacao_workspace_incompleta",
      linkOriginal: urlOriginalEngine,
      metadata: {
        adapter: "magalu",
        linksClassificados,
        provaAfiliado: {
          slugLoja: provaAfiliado.slugLoja || "",
          productId: provaAfiliado.productId || "",
          conversaoStatus: provaAfiliado.conversaoStatus || "",
          motivoConversao: provaAfiliado.motivoConversao || ""
        }
      }
    };
  }

  logMagaluAdapter("[ENGINE-MAGALU-IMPORTADOR-RETORNO]", {
    ...payloadRetornoMagalu,
    ok: true
  });

  return {
    ok: true,
    marketplace: "magalu",
    titulo: tituloFinal,
    preco: precoNumerico,
    precoAtual: precoNumerico,
    precoPagina: precoPaginaNumerico,
    precoOriginal: numeroPreco(precoOriginal) !== null ? precoOriginal : "",
    precoAntigo: precoOriginal,
    economia: economiaCalculada.economia,
    percentual: economiaCalculada.percentual,
    descontoPercentual: economiaCalculada.percentual,
    imagem: imagemOficial,
    imagemOriginalOficial: imagemOficial,
    origemImagemOficial: imagemOficial ? "magazinevoce_pagina_validada" : "",
    dominioImagem: imagemOficial ? new URL(imagemOficial).hostname : "",
    dimensoesImagem: produto.metadata?.imagemOficial?.dimensoes || null,
    imagemEnviavel: Boolean(imagemOficial),
    linkOriginal: primeiroValor(produto.urlOriginal, urlOriginalEngine),
    linkExpandido: urlCanonica,
    linkAfiliado,
    categoria: produto.categoria || "",
    seller: produto.seller || "",
    produtoId: produto.produtoId || produto.codigo || "",
    produtoIdDetectado: produto.produtoId || produto.codigo || "",
    cupom: extrairCupomRadarSeguroMagalu(evento),
    cupomTipo: "",
    tipoCupom: "",
    avisoCupom: "",
    beneficioTexto: "",
    beneficioExtra: "",
    parcelamento: "",
    valorEfetivo: "",
    valorEfetivoOrigem: "",
    precoOrigem: radarDefiniuPreco ? "texto_radar" : "radar_ausente",
    origem: "engine_importer_magalu",
    clienteId,
    metadata: {
      adapter: "magalu",
      jobId: job.id,
      eventoId: job.evento_id,
      clienteId,
      linkOriginalEngine: urlOriginalEngine,
      campoLinkEscolhido: linkEscolhido.campo || "",
      papelLinkEscolhido: linkEscolhido.papelLink || "",
      papelLinkMotivo: linkEscolhido.papelLinkMotivo || "",
      linksClassificados,
      linksComerciais: linksClassificados.map(item => ({
        ...item,
        papel: item.papelLink,
        tipo: item.papelLink,
        urlAfiliada: item.urlOriginal === urlOriginalEngine ? linkAfiliado : "",
        urlAfiliadaWorkspace: item.urlOriginal === urlOriginalEngine ? linkAfiliado : "",
        renderizavel: item.urlOriginal === urlOriginalEngine && provaAfiliado.conversaoStatus === "convertida",
        convertidoWorkspace: item.urlOriginal === urlOriginalEngine && provaAfiliado.conversaoStatus === "convertida",
        conversaoStatus: item.urlOriginal === urlOriginalEngine
          ? provaAfiliado.conversaoStatus
          : "nao_aplicavel",
        motivoConversao: item.urlOriginal === urlOriginalEngine
          ? provaAfiliado.motivoConversao
          : "link_nao_principal"
      })),
      provaAfiliado: {
        slugLoja: provaAfiliado.slugLoja || "",
        productId: provaAfiliado.productId || "",
        conversaoStatus: provaAfiliado.conversaoStatus || "",
        motivoConversao: provaAfiliado.motivoConversao || ""
      },
      afiliacaoWorkspace: provaAfiliado,
      fallbackRadar: {
        usado: !texto(produto.titulo) || erroResolver !== null || produto.ok === false,
        tituloRadarUsado: !texto(produto.titulo) && Boolean(tituloRadarSeguro),
        resolverFalhou: erroResolver !== null,
        motivoResolver: produto?.motivo || "",
        avisos: avisosProduto
      },
      precoRadarUsado: radarDefiniuPreco,
        precoOrigem: radarDefiniuPreco ? "texto_radar" : "",
      precoAuditoria: {
        precoRadar: numeroPreco(precoRadarSeguro),
        precoPagina: precoPaginaNumerico,
        precoEscolhido: precoNumerico,
        origemPreco: radarDefiniuPreco ? "texto_radar" : "radar_ausente",
        motivoEscolhaPreco: radarDefiniuPreco ? "preco_radar_explicito_confiavel" : "preco_radar_ausente_nao_publicavel"
      },
      camposProduto: Object.keys(produto || {}),
      produto
    }
  };
}

module.exports = {
  importarProdutoMagaluEngine,
  escolherLinkMagalu,
  extrairPrecoRadarSeguroMagalu
};
