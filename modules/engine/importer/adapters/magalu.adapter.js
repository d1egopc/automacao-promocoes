"use strict";

const { normalizarNumeroMoeda } = require("../../../../utils/moeda");
const {
  produtoIdPorUrl
} = require("../../../marketplaces/magalu/magalu-parser");
const {
  resolverFatosMagalu
} = require("../../../marketplaces/magalu/magalu-factual-resolver");
const {
  PROOF_TYPE_PAGE_VALIDATED,
  PROOF_TYPE_DETERMINISTIC_WORKSPACE,
  criarProvaAfiliacaoWorkspaceMagalu
} = require("../../../marketplaces/magalu/afiliacao-workspace");
const {
  construirUrlDeterministicaWorkspaceMagalu,
  normalizarPromoterIdMagalu
} = require("../../../marketplaces/magalu/magalu-affiliate-link");
const {
  resolverImagemMagazineVoce,
  hostnameMlcdnSeguro,
  urlImagemResumo
} = require("../../../marketplaces/magalu/magalu-image-resolver");
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

function motivoAfiliacaoMagalu({ produto = {}, prova = {}, erroResolver = null } = {}) {
  const avisos = Array.isArray(produto.avisos) ? produto.avisos : [];
  if (avisos.includes("magalu_http_403")) return "magalu_http_403";
  if (avisos.includes("magalu_captcha_detectado")) return "magalu_captcha_detectado";
  if (avisos.includes("magalu_pagina_indisponivel") || avisos.includes("magalu_http_404")) return "magalu_pagina_indisponivel";
  if (avisos.some(aviso => /(?:canonica|canonical)/i.test(aviso))) return "magalu_canonical_invalido";
  if (avisos.some(aviso => /produto.*divergente|divergente.*produto|seller_divergente/i.test(aviso))) return "magalu_produto_divergente";
  if (erroResolver) return "erro_parser_magalu";
  if (produto.magaluWorkspaceValidado !== true) return "magalu_workspace_nao_confirmado";
  if (!texto(produto.urlAfiliavelComprovada)) return "magalu_prova_afiliacao_ausente";
  return texto(prova.motivoConversao) || texto(produto.motivo) || "outro_motivo_magalu";
}

function tipoUrlMagaluObservabilidade(url = "") {
  try {
    const parsed = new URL(texto(url));
    const caminho = parsed.pathname.toLowerCase();
    if (caminho.includes("/divulgador/oferta/")) return "divulgador_oferta";
    if (parsed.hostname.toLowerCase().includes("magazinevoce.com.br")) return "magazinevoce_produto";
    if (caminho.includes("/p/")) return "pdp_produto";
    return "magalu_url";
  } catch (_) {
    return "desconhecida";
  }
}

function montarDiagnosticoAfiliacaoMagalu({ job = {}, clienteId = "", promoterId = "", urlOriginal = "", produto = {}, prova = {}, erroResolver = null } = {}) {
  const tentativas = Array.isArray(produto.metadata?.factualResolver?.tentativas)
    ? produto.metadata.factualResolver.tentativas
    : [];
  const ultima = tentativas[tentativas.length - 1] || {};
  const motivoInterno = motivoAfiliacaoMagalu({ produto, prova, erroResolver });
  return {
    clienteId,
    jobId: job.id || null,
    eventoId: job.evento_id || null,
    productIdEsperado: produtoIdPorUrl(urlOriginal),
    promoterIdEsperado: promoterId,
    slugEsperado: texto(prova.slugLoja),
    fonteTentada: texto(ultima.fonte || produto.metadata?.factualResolver?.fonteUsada),
    candidatasTentadas: tentativas.map(item => ({
      fonte: texto(item.fonte),
      statusFactual: texto(item.statusFactual),
      motivo: texto(item.motivo),
      statusHttp: Number(item.statusHttp || 0),
      urlFinalTipo: texto(item.urlFinalTipo) || tipoUrlMagaluObservabilidade(urlOriginal),
      canonicalValida: item.canonicalValida === true,
      productIdObservado: texto(item.productIdObservado),
      avisos: Array.isArray(item.avisos) ? item.avisos.map(texto).filter(Boolean) : [],
      avisosBloqueantes: Array.isArray(item.avisosBloqueantes) ? item.avisosBloqueantes.map(texto).filter(Boolean) : [],
      evidenciasAvisosBloqueantes: Array.isArray(item.evidenciasAvisosBloqueantes) ? item.evidenciasAvisosBloqueantes : [],
      canonicalObservada: texto(item.canonicalObservada),
      canonicalOrigem: texto(item.canonicalOrigem),
      ogUrlObservada: texto(item.ogUrlObservada),
      urlFinalObservada: texto(item.urlFinalObservada),
      productIdsSkusJsonLd: Array.isArray(item.productIdsSkusJsonLd) ? item.productIdsSkusJsonLd.map(texto).filter(Boolean) : []
    })),
    statusHttp: Number(ultima.statusHttp || 0),
    urlFinalTipo: texto(ultima.urlFinalTipo) || tipoUrlMagaluObservabilidade(urlOriginal),
    motivoInterno,
    motivoResolver: texto(produto.motivo) || texto(ultima.motivo) || motivoInterno,
    canonicalValida: Boolean(
      texto(produto.urlCanonica) &&
      produtoIdPorUrl(produto.urlCanonica) === produtoIdPorUrl(urlOriginal)
    ),
    productIdObservado: texto(produto.produtoId || produto.codigo),
    workspaceLojaValidada: produto.magaluWorkspaceValidado === true,
    workspaceDeterministicoValidado: prova.proofType === PROOF_TYPE_DETERMINISTIC_WORKSPACE && prova.conversaoStatus === "convertida",
    proofType: texto(prova.proofType),
    paginaValidada: prova.paginaValidada === true,
    conversaoStatus: texto(prova.conversaoStatus),
    urlAfiliavelComprovadaExiste: Boolean(texto(produto.urlAfiliavelComprovada)),
    provaAfiliacaoExiste: Boolean(prova.conversaoStatus === "convertida" && texto(prova.assinatura)),
    avisos: [...new Set((Array.isArray(produto.avisos) ? produto.avisos : []).map(texto).filter(Boolean))],
    avisosBloqueantes: [...new Set(tentativas.flatMap(item => Array.isArray(item.avisosBloqueantes) ? item.avisosBloqueantes : []))]
  };
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

function falhaLeituraPermiteAfiliacaoDeterministicaMagalu(produto = {}) {
  const avisos = Array.isArray(produto.avisos) ? produto.avisos : [];
  const tentativas = Array.isArray(produto.metadata?.factualResolver?.tentativas)
    ? produto.metadata.factualResolver.tentativas
    : [];
  const sinais = [produto.motivo, ...avisos, ...tentativas.flatMap(item => [item.motivo, ...(item.avisos || [])])]
    .map(texto)
    .filter(Boolean);
  return sinais.some(sinal => /magalu_(?:captcha_detectado|http_403)|challenge/i.test(sinal));
}

function logMagaluAdapter(evento, payload = {}) {
  console.log(evento, JSON.stringify(payload));
}

function imagemMlcdnValidaMagalu(url = "") {
  return /^https:\/\//i.test(texto(url)) && hostnameMlcdnSeguro(url);
}

function registrarBuscaImagemMagazineVoce({ job = {}, clienteId = "", productId = "", resultado = {} } = {}) {
  logMagaluAdapter("[ENGINE-MAGALU-IMAGEM-BUSCA]", {
    jobId: job.id || null,
    eventoId: job.evento_id || null,
    clienteId,
    productId,
    fonte: "magazinevoce_busca",
    statusHttp: Number(resultado.statusHttp || 0),
    skuConfirmado: resultado.skuConfirmado === true,
    hrefConfirmado: resultado.hrefConfirmado === true,
    candidatos: Array.isArray(resultado.candidatos)
      ? resultado.candidatos.map(item => ({
        origem: texto(item.origem),
        imagem: urlImagemResumo(item.imagem || ""),
        largura: Number(item.largura || 0),
        altura: Number(item.altura || 0)
      }))
      : [],
    imagemSelecionada: urlImagemResumo(resultado.imagem || ""),
    motivoFinal: texto(resultado.motivoFinal)
  });
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

  const produtoIdRadar = produtoIdPorUrl(urlOriginalEngine);
  let imagemCacheLocal = null;
  let taskLocalWorker = null;
  if (typeof deps.obterImagemCacheLocalWorker === "function" && texto(produtoIdRadar)) {
    try {
      const cache = await deps.obterImagemCacheLocalWorker({ marketplace: "magalu", productId: produtoIdRadar });
      if (cache?.source === "local_first_party" && texto(cache.imageUrl) && imagemMlcdnValidaMagalu(cache.imageUrl)) {
        imagemCacheLocal = texto(cache.imageUrl);
      }
    } catch (erro) {
      logMagaluAdapter("[ENGINE-MAGALU-LOCAL-WORKER-CACHE-ERRO]", {
        jobId: job.id || null,
        eventoId: job.evento_id || null,
        clienteId,
        productId: produtoIdRadar,
        motivo: "cache_consulta_falhou",
        erro: texto(erro?.message).slice(0, 180)
      });
    }
  }
  if (!imagemCacheLocal && typeof deps.obterTaskImagemMagaluLocalWorker === "function" && texto(produtoIdRadar)) {
    try {
      taskLocalWorker = await deps.obterTaskImagemMagaluLocalWorker({ productId: produtoIdRadar });
    } catch (erro) {
      logMagaluAdapter("[ENGINE-MAGALU-LOCAL-WORKER-STATUS-ERRO]", {
        jobId: job.id || null,
        eventoId: job.evento_id || null,
        clienteId,
        productId: produtoIdRadar,
        motivo: "task_local_worker_status_falhou",
        erro: texto(erro?.message).slice(0, 180)
      });
    }
  }
  if (!imagemCacheLocal && ["pending", "leased"].includes(texto(taskLocalWorker?.task?.status))) {
    return {
      ok: false,
      marketplace: "magalu",
      motivo: "sem_imagem",
      retriavel: Boolean(taskLocalWorker?.ok),
      linkOriginal: urlOriginalEngine,
      imagemEnviavel: false,
      metadata: {
        adapter: "magalu",
        localWorker: {
          taskId: taskLocalWorker.task.id || null,
          status: taskLocalWorker.task.status || "",
          capability: taskLocalWorker.task.capability || ""
        }
      }
    };
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

  const identidadeOrigemSegura = !avisosProdutoBloqueiamFallbackRadarMagalu(avisosProduto);
  const paginaValidada = Boolean(
    identidadeOrigemSegura &&
    produto.magaluWorkspaceValidado === true &&
    texto(produto.urlAfiliavelComprovada)
  );
  const fallbackDeterministicoPermitido = Boolean(
    !paginaValidada &&
    identidadeOrigemSegura &&
    falhaLeituraPermiteAfiliacaoDeterministicaMagalu(produto)
  );
  const urlDeterministica = fallbackDeterministicoPermitido
    ? construirUrlDeterministicaWorkspaceMagalu(urlOriginalEngine, promoterId, normalizarPromoterIdMagalu(promoterId))
    : { aliasLoja: "", url: "" };
  const urlWorkspaceValidada = paginaValidada
    ? texto(produto.urlAfiliavelComprovada)
    : texto(urlDeterministica.url);
  const proofType = paginaValidada
    ? PROOF_TYPE_PAGE_VALIDATED
    : (urlWorkspaceValidada ? PROOF_TYPE_DETERMINISTIC_WORKSPACE : "");
  const provaAfiliado = criarProvaAfiliacaoWorkspaceMagalu({
    clienteId,
    promoterId,
    productId: produtoIdRadar,
    seller: produto.sellerIdOriginal || "",
    urlOriginal: urlOriginalEngine,
    urlAfiliadaWorkspace: urlWorkspaceValidada,
    paginaValidada,
    proofType,
    papelLink: linkEscolhido.papelLink || "",
    urlConstruidaPor: proofType === PROOF_TYPE_DETERMINISTIC_WORKSPACE ? "magalu_deterministic_builder_v1" : ""
  });
  const diagnosticoAfiliacao = montarDiagnosticoAfiliacaoMagalu({
    job,
    clienteId,
    promoterId,
    urlOriginal: urlOriginalEngine,
    produto,
    prova: provaAfiliado,
    erroResolver
  });
  const urlCanonica = primeiroValor(urlWorkspaceValidada, produto.urlOriginal, urlOriginalEngine);
  const linkAfiliado = provaAfiliado.conversaoStatus === "convertida" ? texto(provaAfiliado.urlAfiliadaWorkspace) : "";
  const tituloRadarSeguro = extrairTituloRadarSeguroMagalu(evento);
  const tituloFinal = tituloRadarSeguro;
  const precoRadarSeguro = extrairPrecoRadarSeguroMagalu(evento);
  const radarDefiniuPreco = numeroPreco(precoRadarSeguro) !== null;
  const precoAtual = radarDefiniuPreco ? precoRadarSeguro : "";
  const precoNumerico = numeroPreco(precoAtual);
  const precoPagina = primeiroValor(produto.precoAtual, produto.preco);
  const precoPaginaNumerico = numeroPreco(precoPagina);
  const precoOriginal = extrairPrecoAnteriorRadarSeguroMagalu(evento);
  const economiaCalculada = { economia: "", percentual: "" };
  let imagemSecundaria = null;
  let imagemAtualValida = imagemMlcdnValidaMagalu(produto.imagem);
  if (!imagemAtualValida && imagemCacheLocal) {
    produto.imagem = imagemCacheLocal;
    imagemAtualValida = true;
    produto.metadata = {
      ...(produto.metadata || {}),
      imagemOficial: {
        origem: "local_first_party",
        url: imagemCacheLocal,
        dimensoes: null,
        variantes: []
      },
      imagemLocalWorker: {
        fonte: "local_first_party",
        productId: produtoIdRadar
      }
    };
  }
  if (!imagemAtualValida && typeof deps.consultarProdutoMagalu === "function") {
    const resolverImagem = typeof deps.resolverImagemMagazineVoce === "function"
      ? deps.resolverImagemMagazineVoce
      : resolverImagemMagazineVoce;
    try {
      imagemSecundaria = await resolverImagem({
        productId: produtoIdRadar,
        promoterId,
        slugWorkspace: normalizarPromoterIdMagalu(promoterId),
        ...(deps.magaluImageResolverOptions || {})
      });
    } catch (erro) {
      imagemSecundaria = {
        ok: false,
        productId: produtoIdRadar,
        statusHttp: 0,
        candidatos: [],
        motivoFinal: "magalu_imagem_busca_fetch_falhou",
        erro: erro.message
      };
    }
    registrarBuscaImagemMagazineVoce({ job, clienteId, productId: produtoIdRadar, resultado: imagemSecundaria });

    const imagemSecundariaValida = Boolean(
      imagemSecundaria?.ok === true &&
      texto(imagemSecundaria.productId) === texto(produtoIdRadar) &&
      imagemMlcdnValidaMagalu(imagemSecundaria.imagem) &&
      imagemSecundaria.skuConfirmado === true &&
      imagemSecundaria.hrefConfirmado === true &&
      imagemSecundaria.validacaoHttp?.ok === true
    );
    if (imagemSecundariaValida) {
      produto.imagem = texto(imagemSecundaria.imagem);
      const imagemSelecionada = Array.isArray(imagemSecundaria.candidatos)
        ? imagemSecundaria.candidatos.find(item => item.imagem === produto.imagem)
        : null;
      produto.metadata = {
        ...(produto.metadata || {}),
        imagemOficial: {
          origem: "magazinevoce_busca",
          url: produto.imagem,
          dimensoes: imagemSelecionada
            ? { largura: imagemSelecionada.largura || 0, altura: imagemSelecionada.altura || 0 }
            : null,
          variantes: Array.isArray(imagemSecundaria.candidatos) ? imagemSecundaria.candidatos : []
        },
        imagemSecundaria: {
          fonte: "magazinevoce_busca",
          statusHttp: Number(imagemSecundaria.statusHttp || 0),
          productId: imagemSecundaria.productId,
          skuConfirmado: true,
          hrefConfirmado: true
        }
      };
    }
  }

  const imagemOficial = imagemMlcdnValidaMagalu(produto.imagem) ? texto(produto.imagem) : "";

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
    logMagaluAdapter("[ENGINE-MAGALU-AFILIACAO-DIAGNOSTICO]", diagnosticoAfiliacao);
    return {
      ok: false,
      marketplace: "magalu",
      motivo: "identidade_produto_insegura",
      linkOriginal: urlOriginalEngine,
      metadata: {
        adapter: "magalu",
        linksClassificados,
        avisos: avisosProduto,
        afiliacaoWorkspaceDiagnostico: diagnosticoAfiliacao
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
    logMagaluAdapter("[ENGINE-MAGALU-AFILIACAO-DIAGNOSTICO]", diagnosticoAfiliacao);
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
          proofType: provaAfiliado.proofType || "",
          paginaValidada: provaAfiliado.paginaValidada === true,
          conversaoStatus: provaAfiliado.conversaoStatus || "",
          motivoConversao: provaAfiliado.motivoConversao || ""
        },
        afiliacaoWorkspaceDiagnostico: diagnosticoAfiliacao
      }
    };
  }

  if (!imagemOficial) {
    if (!taskLocalWorker?.task && typeof deps.garantirImagemMagaluLocalWorker === "function" && texto(produtoIdRadar)) {
      try {
        taskLocalWorker = await deps.garantirImagemMagaluLocalWorker({
          productId: produtoIdRadar,
          sourceUrl: urlOriginalEngine
        });
      } catch (erro) {
        logMagaluAdapter("[ENGINE-MAGALU-LOCAL-WORKER-TASK-ERRO]", {
          jobId: job.id || null,
          eventoId: job.evento_id || null,
          clienteId,
          productId: produtoIdRadar,
          motivo: "task_local_worker_falhou",
          erro: texto(erro?.message).slice(0, 180)
        });
      }
    }
    logMagaluAdapter("[ENGINE-MAGALU-AFILIACAO-DIAGNOSTICO]", diagnosticoAfiliacao);
    return {
      ok: false,
      marketplace: "magalu",
      motivo: "sem_imagem",
      retriavel: Boolean(taskLocalWorker?.ok),
      linkOriginal: urlOriginalEngine,
      imagemEnviavel: false,
      metadata: {
        adapter: "magalu",
        linksClassificados,
        papelLinkEscolhido: linkEscolhido.papelLink || "",
        provaAfiliado: {
          slugLoja: provaAfiliado.slugLoja || "",
          productId: provaAfiliado.productId || "",
          proofType: provaAfiliado.proofType || "",
          paginaValidada: provaAfiliado.paginaValidada === true,
          conversaoStatus: provaAfiliado.conversaoStatus || "",
          motivoConversao: provaAfiliado.motivoConversao || ""
        },
        afiliacaoWorkspace: provaAfiliado,
        afiliacaoWorkspaceDiagnostico: diagnosticoAfiliacao,
        imagemAusenteMotivo: "magalu_sem_imagem_oficial_mlcdn",
        localWorker: taskLocalWorker?.task
          ? { taskId: taskLocalWorker.task.id, status: taskLocalWorker.task.status, capability: taskLocalWorker.task.capability }
          : null
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
    origemImagemOficial: imagemOficial
      ? (produto.metadata?.imagemSecundaria?.fonte || "magazinevoce_pagina_validada")
      : "",
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
        proofType: provaAfiliado.proofType || "",
        paginaValidada: provaAfiliado.paginaValidada === true,
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
