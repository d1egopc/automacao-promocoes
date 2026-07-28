const REGEX_LINK_COMERCIAL = /https?:\/\/[^\s<>()\]"']+|www\.[^\s<>()\]"']+/gi;

function texto(valor = "") {
  return String(valor ?? "").trim();
}

function normalizarTextoComparacao(valor = "") {
  return texto(valor)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizarUrlComercial(url = "") {
  return texto(url).replace(/[.,;!?)\]]+$/g, "");
}

function linksUnicos(links = []) {
  const resultado = [];
  const vistos = new Set();
  for (const link of Array.isArray(links) ? links : []) {
    const valor = normalizarUrlComercial(link);
    if (!valor || vistos.has(valor)) continue;
    vistos.add(valor);
    resultado.push(valor);
  }
  return resultado;
}

function extrairLinksTextoComercial(valor = "") {
  const fonte = texto(valor);
  const links = [];
  let match;
  REGEX_LINK_COMERCIAL.lastIndex = 0;
  while ((match = REGEX_LINK_COMERCIAL.exec(fonte))) {
    const link = normalizarUrlComercial(match[0]);
    if (link && !links.includes(link)) links.push(link);
  }
  return links;
}

function linkPareceImagemComercial(url = "") {
  return /\.(?:jpe?g|png|webp|gif)(?:[?#].*)?$/i.test(texto(url));
}

function dominio(url = "") {
  try {
    const normalizada = texto(url).startsWith("www.") ? `https://${texto(url)}` : texto(url);
    return new URL(normalizada).hostname.toLowerCase().replace(/^www\./, "");
  } catch (_) {
    return "";
  }
}

function contextoTextual({ linhaAtual = "", linhaAnterior = "", linhaPosterior = "", contexto = "" } = {}) {
  return normalizarTextoComparacao([
    linhaAnterior,
    linhaAtual,
    contexto
  ].filter(Boolean).join(" ").replace(REGEX_LINK_COMERCIAL, " "));
}

function contextoInequivocoResgate(chave = "") {
  return /\b(?:resgate|resgatar|voucher|pegue\s+o\s+cupom|pegar\s+cupom|ative\s+o\s+cupom|ativar\s+cupom|colete\s+o\s+cupom|coletar\s+cupom|clique\s+para\s+obter\s+o\s+cupom|pagina\s+de\s+cupons|cupons?\s+aqui|link\s+do\s+cupom)\b/.test(chave);
}

function contextoInequivocoProduto(chave = "") {
  return /\b(?:produto|compre\s+o\s+produto|comprar\s+produto|confira\s+o\s+produto|acesse\s+o\s+produto|veja\s+o\s+produto|link\s+(?:da|de)\s+oferta|link\s+do\s+produto)\b/.test(chave) ||
    /\b(?:compre|comprar|confira|aproveite|oferta)\b/.test(chave);
}

function linkParecePaginaCupons(url = "") {
  const host = dominio(url);
  if (host === "meli.la") return false;
  const valor = texto(url).toLowerCase();
  return /(?:cupom|cupons|coupon|vouchers?|promocoes|promos|campaign|campanha|resgate)/.test(valor);
}

function linkPareceAfiliado(url = "") {
  const host = dominio(url);
  const valor = texto(url).toLowerCase();
  return Boolean(
    /divulgador\.net|promozone\.ai|awin1\.com|aoferta\.net|amzn\.to|s\.click\.aliexpress\.com/.test(host) ||
    /[?&](?:tag|affid|aff_fcid|aff_platform|utm_|clickref|ascsubtag)=/i.test(valor)
  );
}

function linkPareceEncurtadorComercial(url = "") {
  const host = dominio(url);
  return ["meli.la", "amzn.to", "s.shopee.com.br", "a.aliexpress.com", "bit.ly", "tinyurl.com"].includes(host);
}

function linkPareceLandingComercial(url = "") {
  const valor = texto(url).toLowerCase();
  return /promo|campanha|landing|ofertas?|collection|search|lista|loja/.test(valor);
}

function linkPareceProdutoPorDominio(url = "") {
  const valor = texto(url).toLowerCase();
  return Boolean(
    /meli\.la/.test(valor) ||
    /mercadolivre\.com\.br\/(?:[^\s?#]+\/p\/|p\/|produto\/|MLB-?\d+|.*[?&]item_id=MLB\d+)/i.test(valor) ||
    /(?:amazon\.com\.br|amzn\.to)\/(?:dp\/|gp\/product\/|[^\s?#]*\/dp\/|[A-Z0-9]{10})(?:[/?#]|$)/i.test(valor) ||
    /(?:shopee\.com\.br|s\.shopee\.com\.br)\//i.test(valor) ||
    /aliexpress\.[^/]+\/item\//i.test(valor) ||
    /s\.click\.aliexpress\.com/i.test(valor) ||
    /kabum\.com\.br\/produto\//i.test(valor) ||
    /magalu|magazineluiza|nike\.divulgador\.net|go\.promozone\.ai/.test(valor)
  );
}

function normalizarTipoSugerido(tipo = "") {
  const chave = normalizarTextoComparacao(tipo);
  if (["produto", "product"].includes(chave)) return "produto";
  if (["resgate", "cupom", "coupon"].includes(chave)) return "resgate";
  if (["imagem", "image"].includes(chave)) return "imagem";
  if (["afiliado", "affiliate"].includes(chave)) return "afiliado";
  if (["landing", "campanha"].includes(chave)) return "landing";
  if (["encurtador", "shortener"].includes(chave)) return "encurtador";
  return "";
}

function classificarLinkComercial({
  url = "",
  linhaAtual = "",
  linhaAnterior = "",
  linhaPosterior = "",
  contexto = "",
  marketplace = "",
  tipoSugerido = ""
} = {}) {
  const link = normalizarUrlComercial(url);
  const chaveContexto = contextoTextual({ linhaAtual, linhaAnterior, linhaPosterior, contexto });
  const sugestao = normalizarTipoSugerido(tipoSugerido);
  const evidencias = [];
  let tipo = "outros";
  let confianca = "baixa";
  let origem = "fallback_outros";

  if (!link) {
    return { url: "", tipo: "outros", confianca: "ausente", origem: "url_ausente", contexto: chaveContexto, evidencias: [] };
  }

  if (linkPareceImagemComercial(link)) {
    tipo = "imagem";
    confianca = "alta";
    origem = "padrao_imagem";
    evidencias.push("padrao_imagem");
  } else if (contextoInequivocoResgate(chaveContexto)) {
    tipo = "resgate";
    confianca = "alta";
    origem = "contexto_resgate";
    evidencias.push("contexto_resgate");
  } else if (contextoInequivocoProduto(chaveContexto)) {
    tipo = "produto";
    confianca = "alta";
    origem = "contexto_produto";
    evidencias.push("contexto_produto");
  } else if (linkParecePaginaCupons(link)) {
    tipo = "resgate";
    confianca = "media";
    origem = "padrao_pagina_cupons";
    evidencias.push("padrao_pagina_cupons");
  } else if (linkPareceProdutoPorDominio(link)) {
    tipo = linkPareceAfiliado(link) ? "afiliado" : "produto";
    confianca = "media";
    origem = linkPareceAfiliado(link) ? "dominio_afiliado_produto" : "dominio_produto";
    evidencias.push(origem);
    if (linkPareceEncurtadorComercial(link)) evidencias.push("dominio_encurtador");
  } else if (linkPareceAfiliado(link)) {
    tipo = "afiliado";
    confianca = "media";
    origem = "dominio_afiliado";
    evidencias.push(origem);
    if (linkPareceEncurtadorComercial(link)) evidencias.push("dominio_encurtador");
  } else if (linkPareceEncurtadorComercial(link)) {
    tipo = "encurtador";
    confianca = "baixa";
    origem = "dominio_encurtador";
    evidencias.push(origem);
  } else if (linkPareceLandingComercial(link)) {
    tipo = "landing";
    confianca = "baixa";
    origem = "padrao_landing";
    evidencias.push(origem);
  } else if (sugestao) {
    tipo = sugestao;
    confianca = "baixa";
    origem = "tipo_sugerido";
    evidencias.push("tipo_sugerido");
  }

  if (sugestao && sugestao !== tipo) {
    evidencias.push(`divergencia_tipo_sugerido_${sugestao}_para_${tipo}`);
  }
  if (marketplace) evidencias.push(`marketplace_${normalizarTextoComparacao(marketplace)}`);

  return {
    url: link,
    tipo,
    confianca,
    origem,
    contexto: chaveContexto,
    evidencias
  };
}

function sugestoesPorLink(linksConhecidos = {}) {
  const mapa = new Map();

  function registrar(url = "", tipo = "", origem = "sugerido") {
    const link = normalizarUrlComercial(url);
    const tipoNormalizado = normalizarTipoSugerido(tipo);
    if (!link || !tipoNormalizado) return;
    if (!mapa.has(link)) mapa.set(link, []);
    mapa.get(link).push({ tipo: tipoNormalizado, origem });
  }

  if (Array.isArray(linksConhecidos)) {
    for (const item of linksConhecidos) {
      if (typeof item === "string") registrar(item, "", "lista");
      else registrar(item?.link || item?.url, item?.tipo, item?.origem || "lista");
    }
    return mapa;
  }

  registrar(linksConhecidos.produtoOriginal, "produto", "mirror_produtoOriginal");
  registrar(linksConhecidos.produto, "produto", "comercial_produto");
  registrar(linksConhecidos.resgateCupom, "resgate", "mirror_resgateCupom");
  registrar(linksConhecidos.resgate, "resgate", "comercial_resgate");
  registrar(linksConhecidos.cupom, "resgate", "comercial_cupom");

  for (const item of Array.isArray(linksConhecidos.classificados) ? linksConhecidos.classificados : []) {
    registrar(item?.link || item?.url, item?.tipo, item?.origem || "classificados");
  }
  for (const item of Array.isArray(linksConhecidos.linksClassificados) ? linksConhecidos.linksClassificados : []) {
    registrar(item?.link || item?.url, item?.tipo, item?.origem || "linksClassificados");
  }

  return mapa;
}

function primeiraSugestao(mapa = new Map(), url = "") {
  const sugestoes = mapa.get(normalizarUrlComercial(url)) || [];
  return sugestoes[0]?.tipo || "";
}

function classificarLinksComerciais({
  texto: textoFonte = "",
  linhas = null,
  marketplace = "",
  linksConhecidos = {}
} = {}) {
  const linhasBase = Array.isArray(linhas)
    ? linhas.map(texto)
    : String(textoFonte || "").replace(/\r/g, "\n").split("\n").map(texto);
  const sugestoes = sugestoesPorLink(linksConhecidos);
  const classificados = [];
  const grupos = {
    produto: [],
    resgate: [],
    afiliado: [],
    landing: [],
    encurtador: [],
    imagem: [],
    outros: []
  };
  const vistos = new Set();

  linhasBase.forEach((linhaAtual, indice) => {
    for (const url of extrairLinksTextoComercial(linhaAtual)) {
      const contextoAnteriorExtra = contextoInequivocoResgate(normalizarTextoComparacao(linhasBase[indice - 2] || ""))
        ? linhasBase[indice - 2]
        : "";
      const classificado = classificarLinkComercial({
        url,
        linhaAtual,
        linhaAnterior: linhasBase[indice - 1] || "",
        linhaPosterior: linhasBase[indice + 1] || "",
        contexto: contextoAnteriorExtra,
        marketplace,
        tipoSugerido: primeiraSugestao(sugestoes, url)
      });
      const chave = `${classificado.url}|${classificado.tipo}`;
      if (vistos.has(chave)) continue;
      vistos.add(chave);
      const item = {
        ...classificado,
        linha: indice
      };
      classificados.push(item);
      const destino = grupos[item.tipo] ? item.tipo : "outros";
      if (!grupos[destino].includes(item.url)) grupos[destino].push(item.url);
    }
  });

  const produtoOriginal = grupos.produto[0] || grupos.afiliado[0] || "";
  const resgateCupom = grupos.resgate[0] || "";
  const encontrados = linksUnicos([
    ...grupos.produto,
    ...grupos.resgate,
    ...grupos.afiliado,
    ...grupos.landing,
    ...grupos.encurtador,
    ...grupos.imagem,
    ...grupos.outros
  ]);

  return {
    ...grupos,
    classificados,
    encontrados,
    produtoOriginal,
    resgateCupom,
    adicionais: encontrados.filter(link => link !== produtoOriginal && link !== resgateCupom),
    quantidadeEncontrada: encontrados.length
  };
}

module.exports = {
  classificarLinkComercial,
  classificarLinksComerciais,
  extrairLinksTextoComercial,
  linksUnicos,
  normalizarTextoComparacao,
  normalizarUrlComercial
};
