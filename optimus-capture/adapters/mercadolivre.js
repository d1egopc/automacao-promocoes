(function publicarAdapterMercadoLivre(global) {
  const contrato = global.OptimusCaptureContract || require("../core/product-contract");

  function texto(valor) {
    return contrato.texto(valor);
  }

  function limparTexto(valor) {
    return texto(valor).replace(/\s+/g, " ").trim();
  }

  function extrairScriptsJsonLd(html) {
    const scripts = [];
    const re = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let match;
    while ((match = re.exec(String(html || "")))) {
      const conteudo = match[1].trim();
      if (!conteudo) continue;
      try {
        scripts.push(JSON.parse(conteudo));
      } catch {
        scripts.push(null);
      }
    }
    return scripts.filter(Boolean);
  }

  function caminharJson(valor, callback) {
    if (!valor || typeof valor !== "object") return;
    callback(valor);
    if (Array.isArray(valor)) {
      valor.forEach(item => caminharJson(item, callback));
      return;
    }
    Object.values(valor).forEach(item => caminharJson(item, callback));
  }

  function tipoProdutoJsonLd(no) {
    const tipo = no?.["@type"];
    if (Array.isArray(tipo)) return tipo.some(item => texto(item).toLowerCase() === "product");
    return texto(tipo).toLowerCase() === "product";
  }

  function primeiroProdutoJsonLd(jsonLd) {
    let produto = null;
    for (const raiz of jsonLd) {
      caminharJson(raiz, (no) => {
        if (!produto && tipoProdutoJsonLd(no)) produto = no;
      });
      if (produto) break;
    }
    return produto;
  }

  function meta(html, propriedade) {
    const alvo = propriedade.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`<meta\\b(?=[^>]*(?:property|name)=["']${alvo}["'])(?=[^>]*content=["']([^"']+)["'])[^>]*>`, "i");
    return limparTexto((String(html || "").match(re) || [])[1] || "");
  }

  function metaItemprop(html, propriedade) {
    const alvo = propriedade.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`<meta\\b(?=[^>]*itemprop=["']${alvo}["'])(?=[^>]*content=["']([^"']+)["'])[^>]*>`, "i");
    return limparTexto((String(html || "").match(re) || [])[1] || "");
  }

  function tituloHtml(html) {
    return limparTexto((String(html || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "")
      .replace(/\s*\|\s*Mercado Livre.*$/i, "");
  }

  function imagemJsonLd(produto) {
    const imagem = produto?.image;
    if (Array.isArray(imagem)) return texto(imagem[0]);
    if (imagem && typeof imagem === "object") return texto(imagem.url || imagem.contentUrl);
    return texto(imagem);
  }

  function precoJsonLd(produto) {
    const offers = Array.isArray(produto?.offers) ? produto.offers[0] : produto?.offers;
    return contrato.precoNumero(offers?.price || offers?.lowPrice || offers?.highPrice);
  }

  function precoAnteriorJsonLd(produto, precoAtual) {
    const offers = Array.isArray(produto?.offers) ? produto.offers[0] : produto?.offers;
    const specs = Array.isArray(offers?.priceSpecification)
      ? offers.priceSpecification
      : [offers?.priceSpecification].filter(Boolean);
    const candidatos = [
      offers?.listPrice,
      offers?.originalPrice,
      offers?.regularPrice,
      ...specs.map(spec => spec?.listPrice || spec?.originalPrice || spec?.maxPrice || spec?.price)
    ]
      .map(contrato.precoNumero)
      .filter(numero => numero && (!precoAtual || numero > precoAtual));
    return candidatos[0] || null;
  }

  function textoHtmlFragmento(html = "") {
    return limparTexto(String(html || "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&"));
  }

  function valorMoneyAmountAndes(html = "") {
    const textoEntrada = String(html || "");
    const fracao = textoHtmlFragmento(
      (textoEntrada.match(/<span\b(?=[^>]*data-andes-money-amount-fraction=["']true["'])[^>]*>([\s\S]*?)<\/span>/i) || [])[1] || ""
    );
    if (!fracao) return null;

    const centavos = textoHtmlFragmento(
      (textoEntrada.match(/<span\b(?=[^>]*data-andes-money-amount-cents=["']true["'])[^>]*>([\s\S]*?)<\/span>/i) || [])[1] || ""
    );
    const inteiro = fracao.replace(/[^\d]/g, "");
    if (!inteiro) return null;
    const centavosNormalizados = centavos
      ? centavos.replace(/[^\d]/g, "").padEnd(2, "0").slice(0, 2)
      : "00";
    const numero = Number(`${inteiro}.${centavosNormalizados || "00"}`);
    return Number.isFinite(numero) && numero > 0 ? numero : null;
  }

  function precoAnteriorDomMercadoLivre(html, precoAtual) {
    const textoEntrada = String(html || "");
    if (!textoEntrada.includes("ui-pdp-price") || !textoEntrada.includes("ui-pdp-price__original-value")) {
      return null;
    }

    const candidatos = [];
    const re = /<([a-z0-9]+)\b(?=[^>]*class=["'][^"']*\bui-pdp-price__original-value\b)[^>]*>([\s\S]*?)<\/\1>/gi;
    let match;
    while ((match = re.exec(textoEntrada))) {
      const numero = valorMoneyAmountAndes(match[2] || "");
      if (numero && (!precoAtual || numero > precoAtual)) candidatos.push(numero);
    }

    return candidatos[0] || null;
  }

  function textoVisivelDeHtml(html) {
    return String(html || "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/\s+/g, " ")
      .trim();
  }

  function valoresPrecoNoTexto(textoPagina) {
    const candidatos = [];
    const re = /R\$\s*([0-9]{1,3}(?:\.[0-9]{3})*,[0-9]{2}|[0-9]+(?:[.,][0-9]{2})?)/gi;
    let match;
    while ((match = re.exec(textoPagina))) {
      const numero = contrato.precoNumero(match[1]);
      if (numero && !candidatos.includes(numero)) candidatos.push(numero);
    }
    return candidatos;
  }

  function precoAnteriorNoTexto(textoPagina, precoAtual) {
    const re = /\b(?:de|antes|preco\s+anterior|valor\s+anterior)\s*:?\s*R\$\s*([0-9]{1,3}(?:\.[0-9]{3})*,[0-9]{2}|[0-9]+(?:[.,][0-9]{2})?)/i;
    const numero = contrato.precoNumero((textoPagina.match(re) || [])[1] || "");
    return numero && (!precoAtual || numero > precoAtual) ? numero : null;
  }

  function detectarWall(html, url) {
    const alvo = `${url || ""} ${textoVisivelDeHtml(html)}`.toLowerCase();
    return /captcha\/wall|account-verification|just a moment|security check|seguridad\s+[-\u2014]\s+mercado libre|verificacao de seguranca/.test(alvo);
  }

  function extrairCupomExplicito(textoPagina) {
    const re = /\b(?:cupom|codigo|c[o\u00f3]digo|use\s+o\s+cupom|aplique\s+o\s+cupom|resgate\s+o\s+cupom|ative\s+o\s+cupom)\s*:?\s*([A-Z0-9][A-Z0-9_-]{2,40})\b/i;
    const match = textoPagina.match(re);
    return match ? texto(match[1]).toUpperCase() : "";
  }

  function idsEncontrados(valor) {
    const textoEntrada = String(valor || "");
    return {
      mlb: [...new Set((textoEntrada.match(/\bMLB-?\d+\b/gi) || []).map(id => id.toUpperCase().replace("MLB-", "MLB")))],
      mlbu: [...new Set((textoEntrada.match(/\bMLBU-?\d+\b/gi) || []).map(id => id.toUpperCase().replace("MLBU-", "MLBU")))]
    };
  }

  function capturarMercadoLivreDeHtml(html, urlOriginal) {
    const htmlTexto = String(html || "");
    const url = texto(urlOriginal);
    const jsonLd = extrairScriptsJsonLd(htmlTexto);
    const produtoJson = primeiroProdutoJsonLd(jsonLd);
    const textoPagina = textoVisivelDeHtml(htmlTexto);
    const ogTitle = meta(htmlTexto, "og:title");
    const ogImage = meta(htmlTexto, "og:image");
    const titulo = limparTexto(produtoJson?.name || ogTitle || tituloHtml(htmlTexto));
    const precoJson = precoJsonLd(produtoJson);
    const precoMeta = contrato.precoNumero(metaItemprop(htmlTexto, "price"));
    const precoEstruturado = precoJson || precoMeta;
    const precosTexto = precoEstruturado ? [] : valoresPrecoNoTexto(textoPagina);
    const precoAmbiguo = !precoEstruturado && precosTexto.length > 1;
    const precoAtual = precoEstruturado || (precosTexto.length === 1 ? precosTexto[0] : null);
    const precoAnterior = precoAnteriorDomMercadoLivre(htmlTexto, precoAtual) ||
      precoAnteriorJsonLd(produtoJson, precoAtual) ||
      precoAnteriorNoTexto(textoPagina, precoAtual);
    const imagem = contrato.urlHttp(imagemJsonLd(produtoJson) || ogImage);
    const fonte = produtoJson ? "json_ld" : (ogTitle || ogImage ? "og_meta" : "dom_visivel");
    const warnings = [];
    if (detectarWall(htmlTexto, url)) warnings.push("wall_captcha_detectado");
    if (precoAmbiguo) warnings.push("preco_ambiguo");

    return contrato.normalizarProdutoCapturado({
      marketplace: "mercadolivre",
      urlOriginal: url,
      titulo,
      precoAtual,
      precoAnterior,
      imagem,
      cupom: extrairCupomExplicito(textoPagina),
      fonte,
      precoAmbiguo,
      warnings,
      ids: idsEncontrados(`${url} ${htmlTexto}`)
    });
  }

  function capturarMercadoLivreDaPagina(documento, locationObjeto) {
    const url = locationObjeto?.href || documento?.location?.href || "";
    const html = documento?.documentElement?.outerHTML || "";
    return capturarMercadoLivreDeHtml(html, url);
  }

  const api = {
    capturarMercadoLivreDaPagina,
    capturarMercadoLivreDeHtml,
    detectarWall,
    extrairScriptsJsonLd,
    idsEncontrados
  };
  global.OptimusCaptureMercadoLivre = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
