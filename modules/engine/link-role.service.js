const PAPEL_LINK = Object.freeze({
  PRODUTO: "produto",
  CUPOM: "cupom",
  CAMPANHA: "campanha",
  MOEDAS: "moedas",
  LOJA: "loja",
  CATEGORIA: "categoria",
  DESCONHECIDO: "desconhecido"
});

function texto(valor = "") {
  return String(valor || "").trim();
}

function minusculo(valor = "") {
  return texto(valor).toLowerCase();
}

function semAcentos(valor = "") {
  return minusculo(valor).normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function textoEvento(evento = {}) {
  return texto(evento.texto_original || evento.textoOriginal || evento.texto || "");
}

function metadataLink(link = {}) {
  return link && typeof link.metadata === "object" && !Array.isArray(link.metadata)
    ? link.metadata
    : {};
}

function urlSemPontuacaoFinal(url = "") {
  return texto(url).replace(/[),.;\]\s]+$/g, "");
}

function urlsCandidato(candidato = {}) {
  const link = candidato.link && typeof candidato.link === "object" ? candidato.link : candidato;
  return [
    candidato.url,
    link.url_original,
    link.url_normalizada,
    link.url_expandida,
    metadataLink(link).linkOriginalCapturado,
    metadataLink(link).linkResolvido
  ].map(urlSemPontuacaoFinal).filter(Boolean);
}

function contextoDoLink(evento = {}, candidato = {}) {
  const fonte = textoEvento(evento);
  if (!fonte) return { antes: "", antesProximo: "", depois: "", trecho: "" };

  for (const url of urlsCandidato(candidato)) {
    const idx = fonte.indexOf(url);
    if (idx < 0) continue;
    const antes = fonte.slice(Math.max(0, idx - 120), idx).toLowerCase();
    const depois = fonte.slice(idx + url.length, Math.min(fonte.length, idx + url.length + 40)).toLowerCase();
    const partesAntes = antes.split(/(?:\r?\n|https?:\/\/\S+)/i);
    const antesProximo = partesAntes[partesAntes.length - 1] || antes;
    return { antes, antesProximo, depois, trecho: `${antesProximo} ${depois}` };
  }

  return { antes: "", antesProximo: "", depois: "", trecho: "" };
}

function urlEstrutural(candidato = {}) {
  const link = candidato.link && typeof candidato.link === "object" ? candidato.link : candidato;
  return minusculo(candidato.url || link.url_expandida || link.url_normalizada || link.url_original || "");
}

function decodificarUrlAte3x(valor = "") {
  let atual = texto(valor);
  for (let i = 0; i < 3; i += 1) {
    try {
      const proximo = decodeURIComponent(atual);
      if (proximo === atual) break;
      atual = proximo;
    } catch {
      break;
    }
  }
  return atual;
}

function extrairUrlKabumDeAwin(url = "") {
  try {
    const parsed = new URL(texto(url));
    for (const chave of ["ued", "url", "u", "destination", "dest"]) {
      const valor = parsed.searchParams.get(chave);
      if (!valor) continue;
      const decodificado = decodificarUrlAte3x(valor);
      if (/kabum\.com\.br/i.test(decodificado)) return decodificado;
    }
  } catch {}

  return "";
}

function classificarPorContexto(marketplace = "", contexto = {}) {
  const antes = semAcentos(contexto.antesProximo || contexto.antes || "");
  const trecho = semAcentos(contexto.trecho || "");
  const mp = minusculo(marketplace);

  if (mp === "shopee" && /\b(link\s+(?:do\s+)?produto|produto|confira|comprar|oferta aqui)\s*:?\s*$/.test(antes)) {
    return { papelLink: PAPEL_LINK.PRODUTO, motivo: "contexto_link_produto_shopee" };
  }

  if (mp === "aliexpress" && /\b(?:app|pc|site|link)\s*:?\s*$/.test(antes)) {
    return { papelLink: PAPEL_LINK.PRODUTO, motivo: "contexto_app_pc_aliexpress" };
  }

  if (/\b(moedas?|coins?)\b/.test(antes)) return { papelLink: PAPEL_LINK.MOEDAS, motivo: "contexto_moedas" };
  if (/\b(resgate|cupom|cupons|voucher|coupon|codigo)\b/.test(antes)) return { papelLink: PAPEL_LINK.CUPOM, motivo: "contexto_cupom" };
  if (/\b(loja oficial|loja|store)\b/.test(antes)) return { papelLink: PAPEL_LINK.LOJA, motivo: "contexto_loja" };
  if (/\b(categoria|category|busca|search)\b/.test(antes)) return { papelLink: PAPEL_LINK.CATEGORIA, motivo: "contexto_categoria" };
  if (/\b(campanha|promocao|promocional|pagina|page)\b/.test(antes)) return { papelLink: PAPEL_LINK.CAMPANHA, motivo: "contexto_campanha" };

  if (mp === "aliexpress" && /\blink\s*:?\s*$/.test(antes)) {
    return { papelLink: PAPEL_LINK.PRODUTO, motivo: "contexto_link_produto_aliexpress" };
  }

  if (/\b(link do produto|produto aqui|produto|comprar|oferta aqui)\b/.test(trecho)) {
    return { papelLink: PAPEL_LINK.PRODUTO, motivo: "contexto_produto" };
  }

  return null;
}

function classificarShopee(candidato = {}, evento = {}) {
  const url = urlEstrutural(candidato);
  const contexto = contextoDoLink(evento, candidato);

  if (/(?:\/product\/\d+\/\d+|-i\.\d+\.\d+|\/opaanlp\/\d+\/\d+)/i.test(url)) {
    return { papelLink: PAPEL_LINK.PRODUTO, motivo: "shopee_id_produto_url", confianca: "alta" };
  }

  if (/\/shop\/|\/universal-link\/shop/i.test(url)) {
    return { papelLink: PAPEL_LINK.LOJA, motivo: "shopee_url_loja", confianca: "alta" };
  }

  if (/cupom|voucher|coupon/i.test(url)) {
    return { papelLink: PAPEL_LINK.CUPOM, motivo: "shopee_url_cupom", confianca: "alta" };
  }

  if (/\/m\/|promotion|promo|campanha|campaign/i.test(url)) {
    return { papelLink: PAPEL_LINK.CAMPANHA, motivo: "shopee_url_campanha", confianca: "alta" };
  }

  if (/category|cat\.|search/i.test(url)) {
    return { papelLink: PAPEL_LINK.CATEGORIA, motivo: "shopee_url_categoria", confianca: "alta" };
  }

  const porContexto = classificarPorContexto("shopee", contexto);
  if (porContexto) return { ...porContexto, confianca: "media" };

  return { papelLink: PAPEL_LINK.DESCONHECIDO, motivo: "shopee_sem_papel_confirmado", confianca: "baixa" };
}

function classificarAliExpress(candidato = {}, evento = {}) {
  const url = urlEstrutural(candidato);
  const contexto = contextoDoLink(evento, candidato);

  if (/\/item\/\d+\.html|\/i\/\d+\.html|product_id=\d+/i.test(url)) {
    return { papelLink: PAPEL_LINK.PRODUTO, motivo: "aliexpress_id_produto_url", confianca: "alta" };
  }

  if (/coin|moeda/i.test(url)) {
    return { papelLink: PAPEL_LINK.MOEDAS, motivo: "aliexpress_url_moedas", confianca: "alta" };
  }

  if (/coupon|cupom|voucher/i.test(url)) {
    return { papelLink: PAPEL_LINK.CUPOM, motivo: "aliexpress_url_cupom", confianca: "alta" };
  }

  if (/store/i.test(url)) {
    return { papelLink: PAPEL_LINK.LOJA, motivo: "aliexpress_url_loja", confianca: "alta" };
  }

  if (/category|catId|wholesale/i.test(url)) {
    return { papelLink: PAPEL_LINK.CATEGORIA, motivo: "aliexpress_url_categoria", confianca: "alta" };
  }

  if (/promotion|promo|campaign|sale|choice|\/e\//i.test(url) && !/a\.aliexpress\.com\/_/i.test(url)) {
    return { papelLink: PAPEL_LINK.CAMPANHA, motivo: "aliexpress_url_campanha", confianca: "media" };
  }

  const porContexto = classificarPorContexto("aliexpress", contexto);
  if (porContexto) return { ...porContexto, confianca: "media" };

  return { papelLink: PAPEL_LINK.DESCONHECIDO, motivo: "aliexpress_sem_papel_confirmado", confianca: "baixa" };
}

function classificarAwinKabum(candidato = {}, evento = {}) {
  const url = urlEstrutural(candidato);
  const urlKabum = extrairUrlKabumDeAwin(url) || url;
  const contexto = contextoDoLink(evento, candidato);

  if (/kabum\.com\.br\/produto\/\d+/i.test(urlKabum)) {
    return { papelLink: PAPEL_LINK.PRODUTO, motivo: "kabum_id_produto_url", confianca: "alta", urlProduto: urlKabum };
  }

  if (/kabum\.com\.br\/(?:busca|categoria|departamento)/i.test(urlKabum)) {
    return { papelLink: PAPEL_LINK.CATEGORIA, motivo: "kabum_url_categoria", confianca: "alta", urlProduto: urlKabum };
  }

  if (/awin1?\.com|awin\.com|kabum\.com\.br/i.test(url)) {
    const porContexto = classificarPorContexto("kabum", contexto);
    if (porContexto) return { ...porContexto, confianca: "media", urlProduto: urlKabum };
  }

  return { papelLink: PAPEL_LINK.DESCONHECIDO, motivo: "awin_kabum_sem_produto_confirmado", confianca: "baixa", urlProduto: urlKabum };
}

function classificarLinkEngine({ marketplace = "", evento = {}, link = {}, url = "", campo = "" } = {}) {
  const candidato = { url, campo, link };
  const mp = minusculo(marketplace || link.marketplace_detectado || "");
  const metadata = metadataLink(link);
  if (metadata.papelLink) {
    return {
      papelLink: metadata.papelLink,
      motivo: metadata.papelLinkMotivo || "metadata_papel_link",
      confianca: metadata.papelLinkConfianca || "media",
      urlProduto: metadata.urlProduto || ""
    };
  }

  if (mp === "shopee") return classificarShopee(candidato, evento);
  if (mp === "aliexpress") return classificarAliExpress(candidato, evento);
  if (mp === "awin" || mp === "kabum") return classificarAwinKabum(candidato, evento);

  return { papelLink: PAPEL_LINK.DESCONHECIDO, motivo: "marketplace_sem_classificador", confianca: "baixa" };
}

function candidatoEhProduto(candidato = {}) {
  return candidato.papelLink === PAPEL_LINK.PRODUTO;
}

function candidatoBloqueadoParaProduto(candidato = {}) {
  return [
    PAPEL_LINK.CUPOM,
    PAPEL_LINK.CAMPANHA,
    PAPEL_LINK.MOEDAS,
    PAPEL_LINK.LOJA,
    PAPEL_LINK.CATEGORIA
  ].includes(candidato.papelLink);
}

function scoreCandidatoProduto(candidato = {}) {
  let score = 0;
  if (candidatoEhProduto(candidato)) score += 1000;
  if (candidato.campo === "url_expandida") score += 60;
  if (candidato.campo === "url_normalizada") score += 40;
  if (candidato.campo === "url_original") score += 30;
  if (/\/produto\/\d+|\/item\/\d+\.html|\/product\/\d+\/\d+|-i\.\d+\.\d+|\/opaanlp\/\d+\/\d+/i.test(candidato.url || "")) score += 100;
  if (candidato.papelLinkConfianca === "alta") score += 20;
  return score;
}

function classificarCandidatosLinks(candidatos = [], marketplace = "", evento = {}) {
  return (Array.isArray(candidatos) ? candidatos : [])
    .map(candidato => {
      const classificacao = classificarLinkEngine({
        marketplace,
        evento,
        link: candidato.link || {},
        url: candidato.url || "",
        campo: candidato.campo || ""
      });
      return {
        ...candidato,
        papelLink: classificacao.papelLink,
        papelLinkMotivo: classificacao.motivo,
        papelLinkConfianca: classificacao.confianca,
        urlProduto: classificacao.urlProduto || ""
      };
    });
}

function escolherProdutoPrincipal(candidatos = [], marketplace = "", evento = {}) {
  const classificados = classificarCandidatosLinks(candidatos, marketplace, evento)
    .filter(candidato => texto(candidato.url));
  const produtos = classificados
    .filter(candidatoEhProduto)
    .sort((a, b) => scoreCandidatoProduto(b) - scoreCandidatoProduto(a));

  return produtos[0] || {
    url: "",
    link: null,
    campo: "",
    papelLink: PAPEL_LINK.DESCONHECIDO,
    papelLinkMotivo: classificados.some(candidatoBloqueadoParaProduto)
      ? "sem_link_produto_entre_links_auxiliares"
      : "sem_link_produto_confirmado",
    linksClassificados: classificados
  };
}

function resumoLinksClassificados(links = [], evento = {}, marketplace = "") {
  return (Array.isArray(links) ? links : []).map(link => {
    const classificacao = classificarLinkEngine({ marketplace, evento, link });
    return {
      id: link.id || null,
      urlOriginal: link.url_original || "",
      urlExpandida: link.url_expandida || "",
      marketplace: link.marketplace_detectado || marketplace || "",
      papelLink: classificacao.papelLink,
      papelLinkMotivo: classificacao.motivo,
      papelLinkConfianca: classificacao.confianca,
      urlProduto: classificacao.urlProduto || ""
    };
  });
}

module.exports = {
  PAPEL_LINK,
  classificarLinkEngine,
  classificarCandidatosLinks,
  escolherProdutoPrincipal,
  resumoLinksClassificados,
  extrairUrlKabumDeAwin
};
