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
  for (const link of Array.isArray(links) ? links : []) {
    const valor = normalizarUrlComercial(link);
    if (!valor) continue;
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
    if (link) links.push(link);
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
  return /\b(?:voucher|resgat(?:e|em|a|ar)(?:\s+(?:o|a|os|as|seu|sua|seus|suas))?\s+cupo(?:m|ns)|peg(?:ue|ar)(?:\s+(?:o|a|os|as|seu|sua|seus|suas))?\s+cupo(?:m|ns)|colet(?:e|ar)(?:\s+(?:o|a|os|as|seu|sua|seus|suas))?\s+cupo(?:m|ns)|ativ(?:e|ar)(?:\s+(?:o|a|os|as|seu|sua|seus|suas))?\s+cupo(?:m|ns)|clique\s+para\s+obter\s+(?:o\s+)?cupom|pagina\s+de\s+cupons|cupons?\s+aqui|link\s+do\s+cupom|cupom\s+(?:disponivel|liberado|resgatavel))\b/.test(chave);
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

function marketplaceAliExpress(marketplace = "", url = "") {
  const mp = normalizarTextoComparacao(marketplace).replace(/[^a-z0-9]+/g, "");
  const valor = texto(url).toLowerCase();
  return mp === "aliexpress" || /(^|\/\/|\.)(?:a|s\.click|pt|www)?\.?aliexpress\./i.test(valor);
}

function linhaSemLinks(linha = "") {
  return normalizarTextoComparacao(texto(linha).replace(REGEX_LINK_COMERCIAL, " "));
}

function marcadorAppAliExpress(linha = "") {
  const chave = linhaSemLinks(linha);
  return /\b(?:app|aplicativo|celular|mobile)\b/.test(chave);
}

function marcadorPcAliExpress(linha = "") {
  const chave = linhaSemLinks(linha);
  return /\b(?:pc|no\s+pc|pelo\s+pc|computador|desktop|site)\b/.test(chave);
}

function marcadorMoedasAliExpress(linha = "") {
  const chave = linhaSemLinks(linha);
  return /\b(?:moeda|moedas|coins?)\b/.test(chave);
}

function marketplaceShopee(marketplace = "", url = "") {
  const mp = normalizarTextoComparacao(marketplace).replace(/[^a-z0-9]+/g, "");
  const valor = texto(url).toLowerCase();
  return mp === "shopee" || /(^|\/\/|\.)(?:s\.)?shopee\.com\.br/i.test(valor);
}

function classificarPapelAliExpress({ link = "", linhaAtual = "", linhaAnterior = "", linhaPosterior = "", marketplace = "" } = {}) {
  if (!marketplaceAliExpress(marketplace, link)) return null;

  if (marcadorMoedasAliExpress(linhaAtual)) {
    return { tipo: "app", origem: "aliexpress_contexto_app_moedas", evidencia: "contexto_app_moedas" };
  }

  if (marcadorAppAliExpress(linhaAtual)) {
    return { tipo: "app", origem: "aliexpress_contexto_app", evidencia: "contexto_app" };
  }

  if (marcadorPcAliExpress(linhaAtual)) {
    return { tipo: "pc", origem: "aliexpress_contexto_pc", evidencia: "contexto_pc" };
  }

  if (marcadorMoedasAliExpress(linhaAnterior)) {
    return { tipo: "app", origem: "aliexpress_contexto_app_moedas", evidencia: "contexto_app_moedas" };
  }

  if (marcadorAppAliExpress(linhaAnterior)) {
    return { tipo: "app", origem: "aliexpress_contexto_app", evidencia: "contexto_app" };
  }

  if (marcadorPcAliExpress(linhaAnterior)) {
    return { tipo: "pc", origem: "aliexpress_contexto_pc", evidencia: "contexto_pc" };
  }

  if (!marcadorAppAliExpress(linhaAtual) && !marcadorPcAliExpress(linhaAtual) && marcadorPcAliExpress(linhaPosterior)) {
    return { tipo: "app", origem: "aliexpress_posicao_antes_pc", evidencia: "posicao_antes_pc" };
  }

  return null;
}

function classificarPapelShopee({ link = "", linhaAtual = "", linhaAnterior = "", contexto = "", marketplace = "" } = {}) {
  if (!marketplaceShopee(marketplace, link)) return null;
  const chave = contextoTextual({ linhaAtual, linhaAnterior, contexto });
  const valor = texto(link).toLowerCase();

  if (contextoInequivocoProduto(chave) && !contextoInequivocoResgate(chave)) {
    return { tipo: "produto", origem: "shopee_contexto_produto", evidencia: "contexto_produto" };
  }
  if (contextoInequivocoResgate(chave) || linkParecePaginaCupons(link)) {
    return { tipo: "resgate", origem: "shopee_contexto_resgate", evidencia: "contexto_resgate" };
  }
  if (/(?:shopee\.com\.br\/product\/\d+\/\d+|-i\.\d+\.\d+|\/opaanlp\/\d+\/\d+)/i.test(valor)) {
    return { tipo: "produto", origem: "shopee_url_produto", evidencia: "url_produto" };
  }
  return null;
}

function normalizarTipoSugerido(tipo = "") {
  const chave = normalizarTextoComparacao(tipo);
  if (["produto", "product"].includes(chave)) return "produto";
  if (["resgate", "cupom", "coupon"].includes(chave)) return "resgate";
  if (["app", "aplicativo", "celular", "mobile", "link_app"].includes(chave)) return "app";
  if (["pc", "site", "desktop", "computador", "link_pc"].includes(chave)) return "pc";
  if (["moedas", "moeda", "coins", "coin", "link_moedas"].includes(chave)) return "moedas";
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

  const papelAliExpress = classificarPapelAliExpress({ link, linhaAtual, linhaAnterior, linhaPosterior, marketplace });
  const papelShopee = classificarPapelShopee({ link, linhaAtual, linhaAnterior, contexto, marketplace });

  if (linkPareceImagemComercial(link)) {
    tipo = "imagem";
    confianca = "alta";
    origem = "padrao_imagem";
    evidencias.push("padrao_imagem");
  } else if (papelAliExpress) {
    tipo = papelAliExpress.tipo;
    confianca = "alta";
    origem = papelAliExpress.origem;
    evidencias.push(papelAliExpress.evidencia);
  } else if (papelShopee) {
    tipo = papelShopee.tipo;
    confianca = "alta";
    origem = papelShopee.origem;
    evidencias.push(papelShopee.evidencia);
  } else if (contextoInequivocoResgate(chaveContexto)) {
    tipo = "resgate";
    confianca = "alta";
    origem = "contexto_resgate";
    evidencias.push("contexto_resgate");
  } else if (linkParecePaginaCupons(link)) {
    tipo = "resgate";
    confianca = "media";
    origem = "padrao_pagina_cupons";
    evidencias.push("padrao_pagina_cupons");
  } else if (contextoInequivocoProduto(chaveContexto)) {
    tipo = "produto";
    confianca = "alta";
    origem = "contexto_produto";
    evidencias.push("contexto_produto");
  } else {
    if (linkPareceProdutoPorDominio(link)) {
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
  }

  if (tipo === "outros" && sugestao) {
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
    app: [],
    pc: [],
    moedas: [],
    afiliado: [],
    landing: [],
    encurtador: [],
    imagem: [],
    outros: []
  };
  let ordemCaptura = 0;

  linhasBase.forEach((linhaAtual, indice) => {
    for (const url of extrairLinksTextoComercial(linhaAtual)) {
      const linhaAnteriorTemLink = extrairLinksTextoComercial(linhasBase[indice - 1] || "").length > 0;
      const contextoAnteriorExtra = !linhaAnteriorTemLink && contextoInequivocoResgate(normalizarTextoComparacao(linhasBase[indice - 2] || ""))
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
      ordemCaptura += 1;
      const item = {
        ...classificado,
        link: classificado.url,
        ocorrenciaId: `radar:${classificado.tipo}:${ordemCaptura}`,
        ordemCaptura,
        linha: indice
      };
      classificados.push(item);
      const destino = grupos[item.tipo] ? item.tipo : "outros";
      grupos[destino].push(item.url);
    }
  });

  const produtoOriginal = grupos.produto[0] || grupos.pc[0] || grupos.afiliado[0] || "";
  const resgateCupom = grupos.resgate[0] || "";
  const encontrados = linksUnicos([
    ...grupos.produto,
    ...grupos.resgate,
    ...grupos.app,
    ...grupos.pc,
    ...grupos.moedas,
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
