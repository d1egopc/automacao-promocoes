"use strict";

function texto(valor = "") {
  return String(valor ?? "").trim();
}

function lista(valor) {
  return Array.isArray(valor) ? valor : [];
}

function normalizar(valor = "") {
  return texto(valor).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function normalizarMarketplace(valor = "") {
  const n = normalizar(valor).replace(/[^a-z0-9]+/g, "");
  if (n === "ml" || n === "mercadolivre") return "mercadolivre";
  if (n === "shopee") return "shopee";
  if (n === "aliexpress" || n === "ali") return "aliexpress";
  if (n === "amazon") return "amazon";
  if (n === "kabum" || n === "awin" || n === "kabumawin") return "kabum-awin";
  return n || "desconhecido";
}

function dominioUrl(url = "") {
  try {
    return new URL(texto(url)).hostname.replace(/^www\./i, "").toLowerCase();
  } catch (_) {
    return "";
  }
}

function dedupeUrl(url = "") {
  const valor = texto(url);
  if (!valor) return "";
  try {
    const parsed = new URL(valor);
    parsed.hash = "";
    return `${parsed.hostname.replace(/^www\./i, "").toLowerCase()}${parsed.pathname}`.replace(/\/+$/, "");
  } catch (_) {
    return valor.replace(/#.*$/, "").replace(/\/+$/, "");
  }
}

function contextoLink(link = {}) {
  return normalizar(`${link.contexto || ""} ${link.tipo || ""}`);
}

function contextoExplicitoProduto(link = {}) {
  return /\b(?:link\s+(?:do\s+)?produto|link|produto|confira\s+aqui|compre|comprar|oferta)\b/.test(contextoLink(link));
}

function contextoExplicitoResgate(link = {}) {
  const contexto = contextoLink(link);
  return /\b(?:resgate|resgatar|cupom|cupons|voucher|vouchers|campanha|pagina\s+de\s+cupons)\b/.test(contexto)
    && !contextoExplicitoProduto(link);
}

function contextoApp(link = {}) {
  return texto(link.tipo) === "link_app" || /\bapp\b/.test(contextoLink(link));
}

function contextoPc(link = {}) {
  return texto(link.tipo) === "link_pc" || /\b(?:pc|site|desktop)\b/.test(contextoLink(link));
}

function contextoMoedas(link = {}) {
  return texto(link.tipo) === "link_moedas" || /\b(?:moeda|moedas|coins?)\b/.test(contextoLink(link));
}

function urlMercadoLivre(url = "") {
  const host = dominioUrl(url);
  return host === "meli.la" || /(^|\.)mercadolivre\.com(\.br)?$/i.test(host);
}

function urlFonteOuSocial(url = "") {
  const host = dominioUrl(url);
  return /(whatsapp|telegram|t\.me|youtube|youtu\.be|instagram|facebook|twitter|x\.com)$/i.test(host);
}

function urlAliExpress(url = "") {
  const host = dominioUrl(url);
  return /(^|\.)aliexpress\.com$/i.test(host)
    || host === "s.click.aliexpress.com"
    || host === "a.aliexpress.com";
}

function urlPossuiAfiliacaoExterna(url = "") {
  const valor = texto(url);
  return /[?&](?:aff|affiliate|tag|tracking|utm_|pid|subid|ascsubtag|src|lp=aff)=?/i.test(valor)
    || dominioUrl(valor) === "s.click.aliexpress.com";
}

function linkOficialOuNeutro(link = {}) {
  const contexto = normalizar(`${link.origem || ""} ${link.contexto || ""} ${link.confianca || ""} ${link.tipo || ""}`);
  return /\b(?:oficial|neutro|sem\s+afiliacao|sem\s+afiliacao\s+externa|marketplace\s+oficial)\b/.test(contexto);
}

function linkConvertidoParaWorkspace(link = {}, entrada = {}) {
  const url = texto(link.url);
  const afiliado = texto(entrada.linkAfiliado);
  if (url && afiliado && dedupeUrl(url) === dedupeUrl(afiliado)) return true;
  return link.convertidoWorkspace === true
    || link.afiliadoConvertido === true
    || link.workspaceConvertido === true
    || link.linkAfiliadoWorkspace === true;
}

function urlOriginalAliExpressComprovada(link = {}) {
  return [
    link.urlOriginal,
    link.original,
    link.url_original,
    link.urlOriginalRadar,
    link.sourceValuesUsado,
    link.url
  ].some(urlAliExpress);
}

function urlAfiliadaAliExpressComprovada(link = {}) {
  const url = texto(link.urlOptimus || link.urlAfiliadaWorkspace || link.urlAfiliada || link.linkAfiliado || link.afiliado || "");
  return url && urlAliExpress(url) ? url : "";
}

function ocorrenciaImporterComprovada(link = {}) {
  return Boolean(texto(link.ocorrenciaId || link.idOcorrencia || link.radarOcorrenciaId))
    || Number(link.ordemCaptura || link.ordem || 0) > 0
    || /\b(?:importer|importador|adapter|linksclassificados|radar)\b/.test(normalizar(`${link.origem || ""} ${link.confianca || ""}`));
}

function linkAliExpressConvertidoPorImporter(link = {}, papel = "") {
  const status = normalizar(link.conversaoStatus || "");
  return ["link_app", "link_pc"].includes(papel)
    && link.renderizavel === true
    && status !== "falhou"
    && Boolean(urlAfiliadaAliExpressComprovada(link))
    && urlOriginalAliExpressComprovada(link)
    && ocorrenciaImporterComprovada(link);
}

function linkAlternativoSeguroAliExpress(link = {}, entrada = {}, papel = "") {
  if (linkAliExpressConvertidoPorImporter(link, papel)) return true;
  if (linkConvertidoParaWorkspace(link, entrada)) return true;
  return linkOficialOuNeutro(link) && !urlPossuiAfiliacaoExterna(link.url);
}

function urlAmazon(url = "") {
  const host = dominioUrl(url);
  return /(^|\.)amazon\./i.test(host) || host === "amzn.to";
}

function urlKabumAwin(url = "") {
  const host = dominioUrl(url);
  return host === "kabum.com.br" || host === "awin1.com";
}

function linkBase(link = {}, papel = "link_produto", extras = {}) {
  const url = texto(link.url || link.urlOriginal || "");
  const ordemCaptura = Number(extras.ordemCaptura || link.ordemCaptura || link.ordem || link.linha || 0) || 0;
  const chaveOrdem = ordemCaptura > 0 ? `${ordemCaptura}:` : "";
  const urlAfiliada = texto(extras.urlAfiliada || link.urlAfiliadaWorkspace || link.urlAfiliada || link.linkAfiliado || "");
  return {
    papel,
    ordemCaptura,
    ocorrenciaId: texto(extras.ocorrenciaId || link.ocorrenciaId || link.idOcorrencia || ""),
    radarOcorrenciaId: texto(extras.radarOcorrenciaId || link.radarOcorrenciaId || ""),
    urlOriginal: url,
    urlAfiliada,
    urlAfiliadaWorkspace: texto(extras.urlAfiliadaWorkspace || link.urlAfiliadaWorkspace || urlAfiliada),
    urlOptimus: texto(extras.urlOptimus || link.urlOptimus || ""),
    renderizavel: extras.renderizavel !== false,
    origem: texto(link.origem || link.contexto || "captura"),
    confianca: texto(extras.confianca || link.confianca || "media"),
    conversaoStatus: texto(extras.conversaoStatus || link.conversaoStatus || (extras.renderizavel === false ? "falhou" : "")),
    motivoConversao: texto(extras.motivoConversao || link.motivoConversao || link.conversaoWorkspace?.motivo || ""),
    dedupeKey: texto(extras.dedupeKey || `${papel}:${chaveOrdem}${dedupeUrl(url)}`),
    avisos: [...new Set(lista(extras.avisos).map(texto).filter(Boolean))]
  };
}

function saidaBase(marketplace, contrato) {
  return {
    marketplace,
    contrato,
    valido: true,
    campos: {},
    links: [],
    cupons: [],
    requisitos: [],
    beneficios: [],
    avisos: [],
    violacoes: [],
    dedupes: [],
    descartes: [],
    houveAmbiguidade: false,
    houveConversaoAfiliada: false,
    modoFielSeguro: false,
    linkProdutoOriginal: "",
    linkResgateOriginal: "",
    produtosAmbiguos: false
  };
}

function adicionarLink(saida, link) {
  if (!link.urlOriginal && !link.urlAfiliada) return false;
  saida.links.push(link);
  return true;
}

function urlPrincipalEntrada(entrada = {}) {
  return texto(
    entrada.linkOriginal
    || entrada.oferta?.linkOriginal
    || entrada.oferta?.link_original
    || entrada.ofertaEntrada?.linkOriginal
    || entrada.ofertaEntrada?.link_original
    || entrada.ofertaEntrada?.metadata?.linkOriginalEngine
    || ""
  );
}

function afiliadoGlobalCorrelacionado(link = {}, entrada = {}) {
  const urlOriginal = texto(link.url || link.urlOriginal || "");
  const urlPrincipal = urlPrincipalEntrada(entrada);
  if (!texto(entrada.linkAfiliado) || !urlOriginal) return false;
  if (!urlPrincipal) {
    const urlsUnicas = [...new Set(lista(entrada.links).map(item => dedupeUrl(texto(item?.url || item?.urlOriginal || ""))).filter(Boolean))];
    return urlsUnicas.length <= 1;
  }
  return dedupeUrl(urlOriginal) === dedupeUrl(urlPrincipal);
}

function urlAfiliadaOcorrencia(link = {}, entrada = {}, opcoes = {}) {
  const direta = texto(link.urlOptimus || link.urlAfiliadaWorkspace || link.urlAfiliada || link.linkAfiliado || link.afiliado || "");
  if (direta) return direta;
  if (opcoes.exigirCorrelacaoAfiliadoGlobal && !afiliadoGlobalCorrelacionado(link, entrada)) return "";
  if (!opcoes.exigirCorrelacaoAfiliadoGlobal) return "";
  return texto(entrada.linkAfiliado || "");
}

function linkProdutoConvertidoPorOcorrencia(link = {}, entrada = {}, extras = {}) {
  const urlAfiliada = urlAfiliadaOcorrencia(link, entrada, { exigirCorrelacaoAfiliadoGlobal: true });
  return linkBase(link, "link_produto", {
    ...extras,
    urlAfiliada,
    renderizavel: Boolean(urlAfiliada),
    confianca: urlAfiliada ? texto(extras.confianca || "alta") : "baixa",
    conversaoStatus: urlAfiliada ? texto(extras.conversaoStatus || link.conversaoStatus || "convertida") : texto(extras.conversaoStatus || link.conversaoStatus || "falhou"),
    motivoConversao: texto(extras.motivoConversao || link.motivoConversao || link.conversaoWorkspace?.motivo || (urlAfiliada ? "cta_workspace_convertido" : "produto_sem_conversao_workspace")),
    avisos: urlAfiliada ? lista(extras.avisos) : [...lista(extras.avisos), "link_sem_conversao_workspace"]
  });
}

function contratoMercadoLivre(entrada) {
  const saida = saidaBase("mercadolivre", "mercadolivre");
  const produtos = lista(entrada.links).filter(link => texto(link.url)
    && !contextoExplicitoResgate(link)
    && (urlMercadoLivre(link.url) || texto(link.tipo) === "produto"));
  const afiliado = texto(entrada.linkAfiliado);
  saida.linkProdutoOriginal = produtos[0]?.url || "";
  if (afiliado) saida.houveConversaoAfiliada = true;

  for (const link of lista(entrada.links)) {
    if (!texto(link.url)) continue;
    if (contextoExplicitoResgate(link) || texto(link.tipo) === "resgate") {
      const urlAfiliada = urlAfiliadaOcorrencia(link, entrada, { exigirCorrelacaoAfiliadoGlobal: true });
      adicionarLink(saida, linkBase(link, "link_resgate", {
        urlAfiliada,
        renderizavel: Boolean(urlAfiliada),
        conversaoStatus: urlAfiliada ? "convertida" : "falhou",
        motivoConversao: urlAfiliada ? "resgate_workspace_convertido" : "resgate_sem_conversao_workspace",
        avisos: urlAfiliada ? [] : ["link_sem_conversao_workspace"]
      }));
      continue;
    }
    if (urlFonteOuSocial(link.url)) {
      adicionarLink(saida, linkProdutoConvertidoPorOcorrencia(link, entrada));
      continue;
    }
    if (urlMercadoLivre(link.url) || texto(link.tipo) === "produto") {
      adicionarLink(saida, linkProdutoConvertidoPorOcorrencia(link, entrada));
      continue;
    }
    adicionarLink(saida, linkProdutoConvertidoPorOcorrencia(link, entrada));
  }
  return saida;
}

function contratoShopee(entrada) {
  const saida = saidaBase("shopee", "shopee");
  const produtos = [];
  const resgates = [];

  for (const link of lista(entrada.links)) {
    if (!texto(link.url)) continue;
    const tipo = texto(link.tipo);
    if (contextoExplicitoResgate(link) || (tipo === "resgate" && !contextoExplicitoProduto(link))) {
      resgates.push(link);
      continue;
    }
    if (urlFonteOuSocial(link.url)) {
      saida.descartes.push({ papel: "link_auxiliar", motivo: "link_fonte_proibido_shopee" });
      continue;
    }
    produtos.push(link);
  }

  const produtosOcorrencias = produtos.map((link, indice) => ({
    ...link,
    ordemCaptura: Number(link.ordemCaptura || link.linha || indice + 1) || (indice + 1)
  }));

  const resgatesOcorrencias = resgates.map((link, indice) => ({
    ...link,
    ordemCaptura: Number(link.ordemCaptura || link.linha || indice + 1) || (indice + 1)
  }));

  saida.linkProdutoOriginal = produtosOcorrencias[0]?.url || "";
  saida.linkResgateOriginal = resgatesOcorrencias[0]?.url || "";
  for (const link of resgatesOcorrencias) adicionarLink(saida, linkBase(link, "link_resgate"));

  for (const link of produtosOcorrencias) {
    adicionarLink(saida, linkProdutoConvertidoPorOcorrencia(link, entrada));
  }
  if (texto(entrada.linkAfiliado)) saida.houveConversaoAfiliada = true;
  return saida;
}

function contratoAliExpress(entrada) {
  const saida = saidaBase("aliexpress", "aliexpress");
  const produtos = [];

  for (const [indice, linkBruto] of lista(entrada.links).entries()) {
    const link = { ...linkBruto, ordemCaptura: Number(linkBruto.ordemCaptura || linkBruto.linha || indice + 1) || (indice + 1) };
    if (!texto(link.url)) continue;
    let papel = "link_produto";
    if (contextoMoedas(link) || ["moedas", "link_moedas"].includes(texto(link.tipo))) papel = "link_moedas";
    else if (contextoApp(link) || ["app", "link_app"].includes(texto(link.tipo))) papel = "link_app";
    else if (contextoPc(link) || ["pc", "link_pc"].includes(texto(link.tipo))) papel = "link_pc";
    else if (texto(link.tipo) === "resgate") papel = "link_produto";

    if (papel === "link_produto") {
      produtos.push(link);
      continue;
    }
    if (["link_app", "link_pc", "link_moedas"].includes(papel)) {
      const seguro = linkAlternativoSeguroAliExpress(link, entrada, papel);
      if (!seguro) saida.avisos.push("link_aliexpress_sem_conversao_segura");
      adicionarLink(saida, linkBase(link, papel, {
        urlAfiliada: texto(link.urlOptimus || link.urlAfiliadaWorkspace || link.urlAfiliada || link.linkAfiliado || ""),
        urlAfiliadaWorkspace: texto(link.urlAfiliadaWorkspace || ""),
        urlOptimus: texto(link.urlOptimus || ""),
        ocorrenciaId: texto(link.ocorrenciaId || link.idOcorrencia || ""),
        radarOcorrenciaId: texto(link.radarOcorrenciaId || ""),
        ordemCaptura: link.ordemCaptura,
        renderizavel: seguro,
        confianca: seguro ? "alta" : "baixa",
        avisos: seguro ? [] : ["link_sem_conversao_workspace"],
        conversaoStatus: seguro ? (texto(link.conversaoStatus) || "convertida") : (texto(link.conversaoStatus) || "falhou"),
        motivoConversao: texto(link.motivoConversao || link.conversaoWorkspace?.motivo || (seguro ? "cta_workspace_convertido" : "link_sem_conversao_workspace")),
        dedupeKey: `${papel}:${link.ordemCaptura}:${dedupeUrl(link.url)}`
      }));
    }
  }

  const temAppPcRenderizavel = saida.links.some(link => ["link_app", "link_pc"].includes(link.papel) && link.renderizavel !== false);
  const produtosOcorrencias = produtos.filter(link => texto(link.url) && (!temAppPcRenderizavel || contextoExplicitoProduto(link)));

  saida.linkProdutoOriginal = produtosOcorrencias[0]?.url || "";
  for (const link of produtosOcorrencias) {
    adicionarLink(saida, linkProdutoConvertidoPorOcorrencia(link, entrada, {
      motivoConversao: texto(link.motivoConversao || link.conversaoWorkspace?.motivo || "cta_produto_workspace_convertido")
    }));
  }
  if (!saida.linkProdutoOriginal && texto(entrada.linkAfiliado)) saida.linkProdutoOriginal = texto(entrada.linkAfiliado);
  if (texto(entrada.linkAfiliado)) saida.houveConversaoAfiliada = true;
  if (!saida.links.length && lista(entrada.links).some(link => urlAliExpress(link.url))) saida.avisos.push("links_aliexpress_sem_papel_explicito");
  return saida;
}

function contratoAmazon(entrada) {
  const saida = saidaBase("amazon", "amazon");
  const produtos = [];

  for (const link of lista(entrada.links)) {
    if (!texto(link.url)) continue;
    const contexto = contextoLink(link);
    if (/\bprime\b/.test(contexto) && !urlAmazon(link.url)) {
      saida.descartes.push({ papel: "link_programa_prime", motivo: "prime_sem_conversao_segura" });
      continue;
    }
    if (texto(link.tipo) === "resgate" || texto(link.tipo) === "link_resgate") {
      const urlAfiliada = urlAfiliadaOcorrencia(link, entrada, { exigirCorrelacaoAfiliadoGlobal: true });
      adicionarLink(saida, linkBase(link, "link_resgate", {
        urlAfiliada,
        renderizavel: Boolean(urlAfiliada),
        conversaoStatus: urlAfiliada ? "convertida" : "falhou",
        motivoConversao: urlAfiliada ? "resgate_workspace_convertido" : "resgate_sem_conversao_workspace",
        avisos: urlAfiliada ? [] : ["link_sem_conversao_workspace"]
      }));
      continue;
    }
    if (urlAmazon(link.url) || texto(link.tipo) === "produto") produtos.push(link);
    else adicionarLink(saida, linkProdutoConvertidoPorOcorrencia(link, entrada));
  }

  saida.linkProdutoOriginal = produtos[0]?.url || "";
  for (const link of produtos) adicionarLink(saida, linkProdutoConvertidoPorOcorrencia(link, entrada));
  if (texto(entrada.linkAfiliado)) saida.houveConversaoAfiliada = true;
  return saida;
}

function contratoKabumAwin(entrada) {
  const saida = saidaBase("kabum-awin", "kabum-awin");
  const produtos = [];

  for (const link of lista(entrada.links)) {
    if (!texto(link.url)) continue;
    if (urlKabumAwin(link.url) || texto(link.tipo) === "produto") {
      produtos.push(link);
      continue;
    }
    saida.descartes.push({ papel: "link_auxiliar", motivo: "link_auxiliar_nao_renderizavel_kabum_awin" });
  }

  if (texto(entrada.linkAfiliado)) {
    saida.linkProdutoOriginal = produtos[0]?.url || "";
    for (const link of produtos) adicionarLink(saida, linkProdutoConvertidoPorOcorrencia(link, entrada));
  } else if (produtos.length) {
    saida.descartes.push({ papel: "link_produto", motivo: "kabum_awin_sem_conversao_workspace" });
  }
  if (texto(entrada.linkAfiliado)) saida.houveConversaoAfiliada = true;
  return saida;
}

const MATRIZ_CAPACIDADES = Object.freeze({
  mercadolivre: { ctaProduto: 1, resgate: false, app: false, pc: false, linkMoedas: false, multiplosCupons: true, pix: "sim", prime: false, garantia: "opcional", preVenda: "opcional", linkAuxiliar: "nao_renderizar" },
  shopee: { ctaProduto: 1, resgate: true, app: false, pc: false, linkMoedas: false, multiplosCupons: true, pix: "se_explicito", prime: false, garantia: "opcional", preVenda: "opcional", linkAuxiliar: "restrito" },
  aliexpress: { ctaProduto: "1_ou_alternativas", resgate: false, app: true, pc: true, linkMoedas: true, multiplosCupons: true, pix: "se_explicito", prime: false, garantia: "opcional", preVenda: "opcional", linkAuxiliar: "restrito" },
  amazon: { ctaProduto: 1, resgate: "nao_como_link", app: false, pc: false, linkMoedas: false, multiplosCupons: true, pix: "sim", prime: true, garantia: "opcional", preVenda: "opcional", linkAuxiliar: "restrito" },
  "kabum-awin": { ctaProduto: 1, resgate: false, app: false, pc: false, linkMoedas: false, multiplosCupons: true, pix: "se_explicito", prime: false, garantia: true, preVenda: true, linkAuxiliar: "restrito" }
});

function contratoGenerico(entrada) {
  const saida = saidaBase(normalizarMarketplace(entrada.marketplace), "generico");
  const produto = lista(entrada.links).find(link => texto(link.url));
  if (produto) saida.descartes.push({ papel: "link_produto", motivo: "contrato_desconhecido_nao_renderiza_link_capturado" });
  if (texto(entrada.linkAfiliado)) saida.houveConversaoAfiliada = true;
  saida.avisos.push("contrato_generico_fiel_seguro");
  saida.modoFielSeguro = true;
  return saida;
}

function aplicarContratoMarketplace(entrada = {}) {
  const marketplace = normalizarMarketplace(entrada.marketplace);
  const payload = { ...entrada, marketplace, links: lista(entrada.links).filter(link => texto(link?.url)) };
  let saida;
  if (marketplace === "mercadolivre") saida = contratoMercadoLivre(payload);
  else if (marketplace === "shopee") saida = contratoShopee(payload);
  else if (marketplace === "aliexpress") saida = contratoAliExpress(payload);
  else if (marketplace === "amazon") saida = contratoAmazon(payload);
  else if (marketplace === "kabum-awin") saida = contratoKabumAwin(payload);
  else saida = contratoGenerico(payload);

  return {
    ...saida,
    totalLinksEntrada: payload.links.length,
    totalLinksSaida: saida.links.filter(link => link.renderizavel !== false).length || (!saida.links.length && texto(entrada.linkAfiliado) ? 1 : 0),
    papeisDetectados: [...new Set([...payload.links.map(link => texto(link.tipo || "produto")).filter(Boolean), ...saida.links.map(link => link.papel)])],
    papeisRenderizaveis: [...new Set([...(saida.links.length ? [] : (texto(entrada.linkAfiliado) ? ["link_afiliado"] : [])), ...saida.links.filter(link => link.renderizavel !== false).map(link => link.papel)])],
    linksDescartados: saida.descartes.length,
    aplicouMudancasOperacionais: false
  };
}

module.exports = {
  MATRIZ_CAPACIDADES,
  aplicarContratoMarketplace,
  normalizarMarketplace
};
