"use strict";

const { normalizarNumeroMoeda } = require("../../../../utils/moeda");
const {
  produtoIdPorUrl
} = require("../../../marketplaces/magalu/magalu-parser");
const {
  resolverFatosMagalu
} = require("../../../marketplaces/magalu/magalu-factual-resolver");
const {
  gerarLinkAfiliadoMagaluSeguro
} = require("../../../marketplaces/magalu/magalu-affiliate-link");
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
  const linhas = String(textoRadar || "")
    .split(/\r?\n/)
    .map(linha => linha.trim())
    .filter(Boolean);

  for (const linha of linhas) {
    const normalizada = linha.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    if (!/r\$\s*\d/i.test(linha)) continue;
    if (/\b(cupom|off|desconto|cashback|frete|economia|voucher)\b/i.test(normalizada)) continue;
    const match = linha.match(/R\$\s*\d{1,3}(?:[\.\s]?\d{3})*(?:,\d{2})?|R\$\s*\d+(?:,\d{2})?/i);
    if (match) return match[0].replace(/\s+/g, " ").trim();
  }

  return "";
}

function extrairPrecoRadarSeguroMagalu(evento = {}) {
  return primeiroValor(
    extrairPrecoTextoRadarMagalu(textoOriginalEvento(evento)),
    extrairPrecoEstruturadoRadarMagalu(evento)
  );
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

function calcularEconomia(precoAtual, precoOriginal) {
  const atual = numeroPreco(precoAtual);
  const original = numeroPreco(precoOriginal);

  if (atual === null || original === null || original <= 0 || atual <= 0 || original <= atual) {
    return { economia: "", percentual: "" };
  }

  const economia = Number((original - atual).toFixed(2));
  const percentual = Math.round((economia / original) * 100);
  return { economia, percentual };
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

function urlDivulgadorOfertaMagalu(url = "") {
  try {
    return /\/divulgador\/oferta\/[^/?#]+/i.test(new URL(url).pathname);
  } catch (_) {
    return false;
  }
}

function urlAfiliavelMesmoProdutoMagalu(produto = {}, urlOriginal = "", avisos = []) {
  if (avisos.includes("magalu_captcha_detectado")) {
    return "";
  }
  if (avisos.includes("magalu_pagina_indisponivel")) {
    return "";
  }
  if (avisos.includes("magalu_link_loja_divergente")) {
    return "";
  }

  const produtoIdOriginal = produtoIdPorUrl(urlOriginal);
  const candidatas = urlDivulgadorOfertaMagalu(urlOriginal)
    ? [produto.urlAfiliavelComprovada, produto.urlCanonica, produto.urlOriginal, urlOriginal]
    : [urlOriginal, produto.urlCanonica, produto.urlOriginal];

  for (const candidata of candidatas) {
    const url = primeiroValor(candidata);
    if (!url) continue;

    const produtoIdCandidato = produtoIdPorUrl(url);
    if (produtoIdOriginal) {
      if (produtoIdCandidato && produtoIdCandidato !== produtoIdOriginal) {
        adicionarAvisoMagalu(avisos, "magalu_link_produto_divergente_ignorado");
        continue;
      }

      if (!produtoIdCandidato) {
        continue;
      }
    }

    return url;
  }

  return "";
}

function gerarProvaAfiliadoMagaluEngine({ produto = {}, urlOriginal = "", avisos = [], gerarLinkSeguro, promoterId = "" } = {}) {
  const provaVazia = (avisosExtras = []) => ({
    urlAfiliada: "",
    tipoLink: "produto_sem_prova",
    proveniencia: "",
    comprovado: false,
    avisos: avisosExtras.length ? avisosExtras : ["magalu_link_produto_sem_prova"]
  });

  if (typeof gerarLinkSeguro !== "function") return provaVazia(["magalu_gerador_afiliado_indisponivel"]);
  if (avisosProdutoBloqueiamFallbackRadarMagalu(avisos)) return provaVazia(["magalu_identidade_produto_insegura"]);

  const urlAfiliavel = urlAfiliavelMesmoProdutoMagalu(produto, urlOriginal, avisos);
  if (urlAfiliavel) {
    return {
      urlBaseUsada: urlAfiliavel,
      ...gerarLinkSeguro(urlAfiliavel, promoterId)
    };
  }

  const produtoIdOriginal = produtoIdPorUrl(urlOriginal);
  if (!produtoIdOriginal) return provaVazia(["magalu_link_produto_sem_prova"]);

  return {
    urlBaseUsada: urlOriginal,
    ...gerarLinkSeguro(urlOriginal, promoterId)
  };
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
  const gerarLinkSeguro = typeof deps.gerarLinkAfiliadoMagaluSeguro === "function"
    ? deps.gerarLinkAfiliadoMagaluSeguro
    : gerarLinkAfiliadoMagaluSeguro;

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

  const provaAfiliado = gerarProvaAfiliadoMagaluEngine({
    produto,
    urlOriginal: urlOriginalEngine,
    avisos: avisosProduto,
    gerarLinkSeguro,
    promoterId
  });
  const urlCanonica = primeiroValor(provaAfiliado?.urlBaseUsada, produto.urlOriginal, urlOriginalEngine);
  const linkAfiliado = provaAfiliado?.comprovado === true ? texto(provaAfiliado.urlAfiliada) : "";
  const tituloRadarSeguro = extrairTituloRadarSeguroMagalu(evento);
  const tituloFinal = primeiroValor(produto.titulo, tituloRadarSeguro);
  const precoRadarSeguro = extrairPrecoRadarSeguroMagalu(evento);
  const precoPagina = primeiroValor(produto.precoAtual, produto.preco);
  const radarDefiniuPreco = numeroPreco(precoRadarSeguro) !== null;
  const precoAtual = radarDefiniuPreco ? precoRadarSeguro : precoPagina;
  const precoNumerico = numeroPreco(precoAtual);
  const precoPaginaNumerico = numeroPreco(precoPagina);
  const precoOriginal = primeiroValor(produto.precoAnterior, produto.precoOriginal, produto.precoAntigo);
  const economiaCalculada = radarDefiniuPreco ? { economia: "", percentual: "" } : calcularEconomia(precoAtual, precoOriginal);

  const payloadRetornoMagalu = {
    jobId: job.id,
    eventoId: job.evento_id,
    clienteId,
    titulo: tituloFinal,
    precoAtual,
    precoPagina,
    precoOriginal,
    precoOrigem: radarDefiniuPreco ? "texto_radar" : "pagina_magalu",
    linkAfiliado,
    imagem: produto.imagem || "",
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
      motivo: "link_afiliado_vazio",
      linkOriginal: urlOriginalEngine,
      metadata: {
        adapter: "magalu",
        linksClassificados,
        provaAfiliado: {
          tipoLink: provaAfiliado?.tipoLink || "",
          proveniencia: provaAfiliado?.proveniencia || "",
          comprovado: provaAfiliado?.comprovado === true,
          avisos: Array.isArray(provaAfiliado?.avisos) ? provaAfiliado.avisos : []
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
    precoOriginal,
    precoAntigo: precoOriginal,
    economia: economiaCalculada.economia,
    percentual: economiaCalculada.percentual,
    descontoPercentual: economiaCalculada.percentual,
    imagem: produto.imagem || "",
    linkOriginal: primeiroValor(produto.urlOriginal, urlOriginalEngine),
    linkExpandido: urlCanonica,
    linkAfiliado,
    categoria: produto.categoria || "",
    seller: produto.seller || "",
    produtoId: produto.produtoId || produto.codigo || "",
    produtoIdDetectado: produto.produtoId || produto.codigo || "",
    cupom: produto.cupom || "",
    cupomTipo: produto.cupom ? "pagina_magalu" : "",
    tipoCupom: produto.cupom ? "pagina_magalu" : "",
    avisoCupom: produto.cupom || "",
    beneficioTexto: produto.cupom || "",
    beneficioExtra: produto.cupom || "",
    parcelamento: produto.parcelamento || "",
    valorEfetivo: "",
    valorEfetivoOrigem: "",
    precoOrigem: radarDefiniuPreco ? "texto_radar" : "pagina_magalu",
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
        renderizavel: item.urlOriginal === urlOriginalEngine,
        convertidoWorkspace: item.urlOriginal === urlOriginalEngine,
        conversaoStatus: item.urlOriginal === urlOriginalEngine ? "convertida" : "nao_aplicavel",
        motivoConversao: item.urlOriginal === urlOriginalEngine ? "magalu_workspace_convertido" : "link_nao_principal"
      })),
      provaAfiliado: {
        tipoLink: provaAfiliado?.tipoLink || "",
        proveniencia: provaAfiliado?.proveniencia || "",
        comprovado: provaAfiliado?.comprovado === true,
        avisos: Array.isArray(provaAfiliado?.avisos) ? provaAfiliado.avisos : []
      },
      fallbackRadar: {
        usado: !texto(produto.titulo) || erroResolver !== null || produto.ok === false,
        tituloRadarUsado: !texto(produto.titulo) && Boolean(tituloRadarSeguro),
        resolverFalhou: erroResolver !== null,
        motivoResolver: produto?.motivo || "",
        avisos: avisosProduto
      },
      precoRadarUsado: radarDefiniuPreco,
      precoOrigem: radarDefiniuPreco ? "texto_radar" : "pagina_magalu",
      precoAuditoria: {
        precoRadar: numeroPreco(precoRadarSeguro),
        precoPagina: precoPaginaNumerico,
        precoEscolhido: precoNumerico,
        origemPreco: radarDefiniuPreco ? "texto_radar" : "pagina_magalu",
        motivoEscolhaPreco: radarDefiniuPreco ? "preco_radar_explicito_confiavel" : "preco_pagina_sem_preco_radar"
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
