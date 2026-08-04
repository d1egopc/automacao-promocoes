const { normalizarNumeroMoeda } = require("../../../../utils/moeda");
const { importarAliExpress } = require("../../../../marketplaces/aliexpress/importar");
const {
  escolherProdutoPrincipal,
  classificarCandidatosLinks,
  resumoLinksClassificados
} = require("../../link-role.service");

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

function prioridadeCampoLinkAliExpress(candidato = {}) {
  if (candidato.campo === "url_expandida") return 3;
  if (candidato.campo === "url_normalizada") return 2;
  if (candidato.campo === "url_original") return 1;
  return 0;
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

  const validos = candidatos
    .map(candidato => ({
      ...candidato,
      url: texto(candidato.url)
    }))
    .filter(candidato => /aliexpress\./i.test(candidato.url));

  if (!validos.length) return { url: "", link: null, campo: "" };

  const classificados = classificarCandidatosLinks(validos, "aliexpress", evento);
  const linkPc = classificados
    .filter(candidato => candidato.papelLink === "link_pc" && texto(candidato.url))
    .sort((a, b) => prioridadeCampoLinkAliExpress(b) - prioridadeCampoLinkAliExpress(a))[0];
  if (linkPc) return linkPc;

  return escolherProdutoPrincipal(validos, "aliexpress", evento);
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

function extrairPrecoEstruturadoRadarAliExpress(evento = {}) {
  const chavesDiretas = [
    "precoAtual",
    "preco",
    "precoOferta",
    "precoPor",
    "valorEfetivo"
  ];

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

function extrairPrecoTextoRadarAliExpress(textoRadar = "") {
  const linhas = String(textoRadar || "")
    .split(/\r?\n/)
    .map(linha => linha.trim())
    .filter(Boolean);

  for (const linha of linhas) {
    const normalizada = linha.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    if (!/r\$\s*\d/i.test(linha)) continue;
    if (/\b(cupom|off|desconto|cashback|frete|limite|voucher|coupon)\b/i.test(normalizada)) continue;
    const match = linha.match(/R\$\s*\d{1,3}(?:[\.\s]?\d{3})*(?:,\d{2})?|R\$\s*\d+(?:,\d{2})?/i);
    if (match) return match[0].replace(/\s+/g, " ").trim();
  }

  return "";
}

function extrairPrecoRadarSeguroAliExpress(evento = {}) {
  return primeiroValor(
    extrairPrecoTextoRadarAliExpress(textoOriginalEvento(evento)),
    extrairPrecoEstruturadoRadarAliExpress(evento)
  );
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

function logAliExpressTravessiaV272(payload = {}) {
  try {
    console.log("[OFC-V2.7.2-ALIEXPRESS-TRAVESSIA]", JSON.stringify({
      workspaceId: payload.clienteId || payload.workspaceId || "",
      eventoId: payload.eventoId || null,
      jobId: payload.jobId || null,
      ofertaId: payload.ofertaId || null,
      marketplace: "aliexpress",
      adapter: "aliexpress.adapter",
      contrato: "aliexpress",
      totalLinksEntrada: payload.totalLinksEntrada || 0,
      papeisDetectados: Array.isArray(payload.papeisDetectados) ? payload.papeisDetectados.slice(0, 12) : [],
      totalLinksSeguros: payload.totalLinksSeguros || 0,
      houveConversao: payload.houveConversao === true,
      statusEtapa: payload.statusEtapa || "",
      motivo: payload.motivo || "",
      aplicouMudancasOperacionais: false
    }));
  } catch (_) {
    // Observabilidade V2.7.2 nunca interfere no importador.
  }
}

function urlAliExpressConvertidaSegura(urlConvertida = "", urlOriginal = "") {
  const convertida = texto(urlConvertida);
  const original = texto(urlOriginal);
  if (!convertida) return false;
  if (original && convertida === original) return false;
  try {
    const host = new URL(convertida).hostname.replace(/^www\./i, "").toLowerCase();
    return host === "s.click.aliexpress.com"
      || host === "a.aliexpress.com"
      || host.endsWith(".aliexpress.com");
  } catch {
    return false;
  }
}

function extrairIdProdutoAliExpressValor(valor = "") {
  const bruto = texto(valor);
  if (!bruto) return "";

  const direto = bruto.match(/\b(\d{12,20})\b/);
  if (!/^https?:\/\//i.test(bruto)) return direto?.[1] || "";

  try {
    const url = new URL(bruto);
    const caminho = `${url.pathname || ""}${url.search || ""}`;
    const itemPath = caminho.match(/\/item\/(\d{12,20})(?:\.html)?/i);
    if (itemPath) return itemPath[1];
    for (const chave of ["productId", "product_id", "itemId", "item_id", "id"]) {
      const id = url.searchParams.get(chave);
      if (/^\d{12,20}$/.test(id || "")) return id;
    }
    return direto?.[1] || "";
  } catch (_) {
    return direto?.[1] || "";
  }
}

function resolverProdutoCanonicoAliExpress(produto = {}, urlFallback = "") {
  const candidatos = [
    produto?.produtoId,
    produto?.productId,
    produto?.idProduto,
    produto?.itemId,
    produto?.item_id,
    produto?.product_id,
    produto?.metadata?.produtoId,
    produto?.metadata?.productId,
    produto?.metadata?.itemId,
    produto?.linkExpandido,
    produto?.linkOriginal,
    produto?.urlProduto,
    produto?.urlCanonical,
    produto?.canonicalUrl,
    urlFallback
  ];

  for (const candidato of candidatos) {
    const id = extrairIdProdutoAliExpressValor(candidato);
    if (id) {
      return {
        produtoId: id,
        origem: candidato === urlFallback ? "url_original" : "produto_api"
      };
    }
  }

  return { produtoId: "", origem: "indisponivel" };
}

function validarProdutoCanonicoAliExpress({ papelLink = "", principal = {}, convertido = {}, urlOriginal = "" } = {}) {
  const papel = texto(papelLink);
  const produtoPrincipal = resolverProdutoCanonicoAliExpress(principal.produto || principal, principal.urlOriginal || "");
  const produtoConvertido = resolverProdutoCanonicoAliExpress(convertido.produto || convertido, urlOriginal);

  if (papel === "link_app") {
    if (!produtoPrincipal.produtoId) {
      return {
        ok: false,
        motivo: "produto_canonico_pc_indisponivel",
        produtoCanonico: produtoConvertido.produtoId,
        produtoCanonicoPrincipal: ""
      };
    }
    if (!produtoConvertido.produtoId) {
      return {
        ok: false,
        motivo: "produto_canonico_app_indisponivel",
        produtoCanonico: "",
        produtoCanonicoPrincipal: produtoPrincipal.produtoId
      };
    }
    if (produtoPrincipal.produtoId !== produtoConvertido.produtoId) {
      return {
        ok: false,
        motivo: "produto_canonico_divergente",
        produtoCanonico: produtoConvertido.produtoId,
        produtoCanonicoPrincipal: produtoPrincipal.produtoId
      };
    }
  }

  if (papel === "link_pc" && produtoPrincipal.produtoId && produtoConvertido.produtoId && produtoPrincipal.produtoId !== produtoConvertido.produtoId) {
    return {
      ok: false,
      motivo: "produto_canonico_divergente",
      produtoCanonico: produtoConvertido.produtoId,
      produtoCanonicoPrincipal: produtoPrincipal.produtoId
    };
  }

  return {
    ok: true,
    motivo: "produto_canonico_confirmado",
    produtoCanonico: produtoConvertido.produtoId || produtoPrincipal.produtoId || "",
    produtoCanonicoPrincipal: produtoPrincipal.produtoId || ""
  };
}
function valorBooleanoProfundo(objeto = {}, chaves = []) {
  const pilha = [objeto];
  const visitados = new Set();
  while (pilha.length) {
    const atual = pilha.pop();
    if (!atual || typeof atual !== "object" || visitados.has(atual)) continue;
    visitados.add(atual);
    for (const chave of chaves) {
      if (atual[chave] === true) return true;
    }
    for (const valor of Object.values(atual)) {
      if (valor && typeof valor === "object") pilha.push(valor);
    }
  }
  return false;
}

function conversaoAppAliExpressComprovada(produtoConvertido = {}) {
  const marcador = texto(primeiroValor(
    produtoConvertido?.tipoLinkAfiliado,
    produtoConvertido?.tipoLink,
    produtoConvertido?.papelLink,
    produtoConvertido?.conversaoPapel,
    produtoConvertido?.metadata?.tipoLinkAfiliado,
    produtoConvertido?.metadata?.papelLink,
    produtoConvertido?.metadata?.conversaoPapel
  )).toLowerCase();

  if (["app", "link_app", "deep_link_app", "app_produto", "aliexpress_app"].includes(marcador)) return true;

  return valorBooleanoProfundo(produtoConvertido, [
    "linkAppSeguro",
    "destinoAppValidado",
    "conversaoAppValidada",
    "appProdutoValidado",
    "deepLinkAppValidado"
  ]);
}

function avaliarConversaoAliExpressPorPapel({ papelLink = "", urlAfiliada = "", urlOriginal = "", produtoConvertido = {}, produtoPrincipal = {}, urlPrincipal = "" } = {}) {
  const produtoCanonico = validarProdutoCanonicoAliExpress({
    papelLink,
    principal: { produto: produtoPrincipal, urlOriginal: urlPrincipal },
    convertido: produtoConvertido,
    urlOriginal
  });

  if (!urlAliExpressConvertidaSegura(urlAfiliada, urlOriginal)) {
    return { ...produtoCanonico, renderizavel: false, motivo: "link_aliexpress_sem_conversao_segura", appValidado: false };
  }

  if (!produtoCanonico.ok) {
    return { ...produtoCanonico, renderizavel: false, motivo: produtoCanonico.motivo, appValidado: false };
  }

  if (papelLink === "link_app" && !conversaoAppAliExpressComprovada(produtoConvertido)) {
    return { ...produtoCanonico, renderizavel: false, motivo: "link_app_sem_validacao_destino_produto", appValidado: false };
  }

  return {
    ...produtoCanonico,
    renderizavel: true,
    motivo: papelLink === "link_app" ? "cta_app_workspace_convertido" : "cta_workspace_convertido",
    appValidado: papelLink === "link_app"
  };
}

function urlLinkClassificado(link = {}) {
  return primeiroValor(link.urlOriginal, link.urlExpandida, link.urlNormalizada, link.url);
}

function papelAlternativoAliExpress(papel = "") {
  return ["link_app", "link_pc"].includes(texto(papel));
}

async function converterLinksAlternativosAliExpress({
  linksClassificados = [],
  importarLegado,
  integracao = {},
  credenciais = {},
  clienteId = "",
  evento = {},
  job = {},
  urlPrincipal = "",
  linkAfiliadoPrincipal = "",
  produtoPrincipal = {}
} = {}) {
  const convertidos = new Map();

  async function converter(url = "", papelLink = "") {
    const alvo = texto(url);
    const papel = texto(papelLink);
    if (!alvo) return { urlAfiliada: "", renderizavel: false, motivo: "link_vazio", appValidado: false, produtoCanonico: "", produtoCanonicoPrincipal: "" };

    if (texto(urlPrincipal) && alvo === texto(urlPrincipal) && texto(linkAfiliadoPrincipal)) {
      const avaliacaoPrincipal = avaliarConversaoAliExpressPorPapel({
        papelLink: papel,
        urlAfiliada: linkAfiliadoPrincipal,
        urlOriginal: alvo,
        produtoConvertido: produtoPrincipal,
        produtoPrincipal,
        urlPrincipal: alvo
      });
      return {
        urlAfiliada: avaliacaoPrincipal.renderizavel ? linkAfiliadoPrincipal : "",
        renderizavel: avaliacaoPrincipal.renderizavel,
        motivo: avaliacaoPrincipal.motivo,
        appValidado: avaliacaoPrincipal.appValidado,
        produtoCanonico: avaliacaoPrincipal.produtoCanonico || "",
        produtoCanonicoPrincipal: avaliacaoPrincipal.produtoCanonicoPrincipal || ""
      };
    }

    const chaveCache = `${papel}:${alvo}`;
    if (convertidos.has(chaveCache)) return convertidos.get(chaveCache);

    try {
      const produtoConvertido = await importarLegado(alvo, {
        ...integracao,
        credenciais,
        clienteId,
        textoOriginal: textoOriginalEvento(evento),
        contextoEngine: {
          jobId: job.id,
          eventoId: job.evento_id,
          clienteId,
          conversaoLinkAlternativo: true,
          papelLink: papel
        }
      });
      const urlAfiliada = primeiroValor(produtoConvertido?.linkAfiliado, produtoConvertido?.linkFinal, produtoConvertido?.link);
      const avaliacao = avaliarConversaoAliExpressPorPapel({
        papelLink: papel,
        urlAfiliada,
        urlOriginal: alvo,
        produtoConvertido,
        produtoPrincipal,
        urlPrincipal
      });
      const resultado = {
        urlAfiliada: avaliacao.renderizavel ? urlAfiliada : "",
        renderizavel: avaliacao.renderizavel,
        motivo: avaliacao.motivo,
        appValidado: avaliacao.appValidado,
        produtoCanonico: avaliacao.produtoCanonico || "",
        produtoCanonicoPrincipal: avaliacao.produtoCanonicoPrincipal || ""
      };
      convertidos.set(chaveCache, resultado);
      return resultado;
    } catch (_) {
      const resultado = { urlAfiliada: "", renderizavel: false, motivo: "falha_tecnica_conversao_link", appValidado: false, produtoCanonico: "", produtoCanonicoPrincipal: "" };
      convertidos.set(chaveCache, resultado);
      return resultado;
    }
  }

  const saida = [];
  const vistosPapelUrl = new Set();
  for (const link of linksClassificados) {
    const papelLink = texto(link.papelLink || "");
    const urlOriginal = urlLinkClassificado(link);
    const chave = `${papelLink}:${urlOriginal}`;
    if (!papelAlternativoAliExpress(papelLink) || !urlOriginal || vistosPapelUrl.has(chave)) {
      saida.push(link);
      continue;
    }
    vistosPapelUrl.add(chave);
    const conversao = await converter(urlOriginal, papelLink);
    saida.push({
      ...link,
      urlAfiliada: conversao.urlAfiliada,
      renderizavel: conversao.renderizavel,
      seguro: conversao.renderizavel,
      convertidoWorkspace: conversao.renderizavel,
      conversaoWorkspace: {
        papel: papelLink,
        renderizavel: conversao.renderizavel,
        motivo: conversao.motivo,
        appValidado: conversao.appValidado === true,
        produtoCanonico: conversao.produtoCanonico || "",
        produtoCanonicoPrincipal: conversao.produtoCanonicoPrincipal || "",
        aplicouMudancasOperacionais: false
      }
    });
  }
  return saida;
}
async function importarAliExpressEngine({ job = {}, evento = {}, links = [], deps = {} } = {}) {
  const clienteId = texto(job.cliente_id || job.clienteId || "");
  const linkEscolhido = escolherLinkAliExpress(links, evento);
  const urlOriginalEngine = linkEscolhido.url;
  const linksClassificados = resumoLinksClassificados(links, evento, "aliexpress");
  const papeisDetectados = [...new Set(linksClassificados.map(item => item.papelLink).filter(Boolean))];

  if (!clienteId) {
    return { ok: false, marketplace: "aliexpress", motivo: "cliente_invalido" };
  }

  if (!urlOriginalEngine) {
    logAliExpressTravessiaV272({
      jobId: job.id,
      eventoId: job.evento_id,
      clienteId,
      totalLinksEntrada: linksClassificados.length,
      papeisDetectados,
      statusEtapa: "adapter_link_produto_indisponivel",
      motivo: linkEscolhido.papelLinkMotivo || "link_produto_aliexpress_nao_confirmado"
    });
    return {
      ok: false,
      marketplace: "aliexpress",
      motivo: linkEscolhido.papelLinkMotivo || "link_produto_aliexpress_nao_confirmado",
      metadata: {
        adapter: "aliexpress",
        linksClassificados
      }
    };
  }

  if (typeof deps.getIntegracaoCliente !== "function") {
    return { ok: false, marketplace: "aliexpress", motivo: "get_integracao_indisponivel", linkOriginal: urlOriginalEngine };
  }

  const integracao = deps.getIntegracaoCliente(clienteId, "aliexpress");
  if (!integracao) {
    logAliExpressTravessiaV272({
      jobId: job.id,
      eventoId: job.evento_id,
      clienteId,
      totalLinksEntrada: linksClassificados.length,
      papeisDetectados,
      statusEtapa: "integracao_indisponivel",
      motivo: "integracao_ausente"
    });
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
    papelLink: linkEscolhido.papelLink || "",
    papelLinkMotivo: linkEscolhido.papelLinkMotivo || "",
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

  const precoRadarSeguro = extrairPrecoRadarSeguroAliExpress(evento);
  const precoAtual = primeiroValor(produto.precoAtual, produto.preco, precoRadarSeguro);
  const precoOrigem = valorPresente(produto.precoAtual) || valorPresente(produto.preco) ? primeiroValor(produto.precoOrigem, "adapter") : (precoRadarSeguro ? "texto_radar" : "");
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
    precoOrigem,
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
    logAliExpressTravessiaV272({
      jobId: job.id,
      eventoId: job.evento_id,
      clienteId,
      totalLinksEntrada: linksClassificados.length,
      papeisDetectados,
      statusEtapa: "adapter_retorno_invalido",
      motivo: "preco_indisponivel"
    });
    return { ok: false, marketplace: "aliexpress", motivo: "preco_indisponivel", linkOriginal: urlOriginalEngine };
  }

  if (!linkAfiliado) {
    logAliExpressTravessiaV272({
      jobId: job.id,
      eventoId: job.evento_id,
      clienteId,
      totalLinksEntrada: linksClassificados.length,
      papeisDetectados,
      statusEtapa: "cta_seguro_indisponivel",
      motivo: "link_afiliado_vazio"
    });
    return { ok: false, marketplace: "aliexpress", motivo: "link_afiliado_vazio", linkOriginal: urlOriginalEngine };
  }

  logAliExpressTravessiaV272({
    jobId: job.id,
    eventoId: job.evento_id,
    clienteId,
    totalLinksEntrada: linksClassificados.length,
    papeisDetectados,
    totalLinksSeguros: 1,
    houveConversao: true,
    statusEtapa: "adapter_convertido",
    motivo: linkEscolhido.papelLink ? `link_${linkEscolhido.papelLink}_convertido` : "cta_workspace_convertido"
  });

  const linksClassificadosComConversao = await converterLinksAlternativosAliExpress({
    linksClassificados,
    importarLegado,
    integracao,
    credenciais,
    clienteId,
    evento,
    job,
    urlPrincipal: urlOriginalEngine,
    linkAfiliadoPrincipal: linkAfiliado,
    produtoPrincipal: produto
  });

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
    valorEfetivoOrigem: primeiroValor(produto.valorEfetivoOrigem, produto.precoFinalConfirmadoOrigem, precoOrigem),
    precoOrigem,
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
      papelLinkEscolhido: linkEscolhido.papelLink || "",
      papelLinkMotivo: linkEscolhido.papelLinkMotivo || "",
      linksClassificados: linksClassificadosComConversao,
      textoRadarTemCupom: Boolean(cupomTexto),
      precoRadarUsado: precoOrigem === "texto_radar",
      camposProduto: Object.keys(produto || {}),
      produto,
      produtoCanonico: resolverProdutoCanonicoAliExpress(produto, urlOriginalEngine)
    }
  };
}

module.exports = {
  importarAliExpressEngine
};
