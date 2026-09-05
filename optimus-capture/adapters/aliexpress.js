(function publicarAdapterAliExpress(global) {
  const contrato = global.OptimusCaptureContract || require("../core/product-contract");
  const detector = global.OptimusCaptureDetector || require("../core/marketplace-detector");

  function texto(valor) {
    return contrato.texto(valor);
  }

  function limparTexto(valor) {
    return texto(valor)
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/\s+/g, " ")
      .trim();
  }

  function textoHtmlFragmento(html = "") {
    return limparTexto(String(html || "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "));
  }

  function meta(html, propriedade) {
    const alvo = propriedade.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`<meta\\b(?=[^>]*(?:property|name)=["']${alvo}["'])(?=[^>]*content=["']([^"']+)["'])[^>]*>`, "i");
    return limparTexto((String(html || "").match(re) || [])[1] || "");
  }

  function extrairScriptsJsonLd(html) {
    const scripts = [];
    const re = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let match;
    while ((match = re.exec(String(html || "")))) {
      const conteudo = texto(match[1]);
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

  function itemIdAliExpress(urlOriginal = "") {
    try {
      return detector.itemIdProdutoAliExpress(new URL(texto(urlOriginal)));
    } catch {
      return "";
    }
  }

  function urlCanonicaAliExpress(urlOriginal = "") {
    try {
      const url = new URL(texto(urlOriginal));
      const itemId = detector.itemIdProdutoAliExpress(url);
      if (!itemId) return url.toString();
      return `https://${url.hostname.toLowerCase()}/item/${itemId}.html`;
    } catch {
      return texto(urlOriginal);
    }
  }

  function imagemJsonLd(produto) {
    const imagem = produto?.image;
    if (Array.isArray(imagem)) return texto(imagem[0]);
    if (imagem && typeof imagem === "object") return texto(imagem.url || imagem.contentUrl);
    return texto(imagem);
  }

  function listaOffers(produto) {
    const offers = produto?.offers;
    if (Array.isArray(offers)) return offers.filter(Boolean);
    return offers ? [offers] : [];
  }

  function moedaBRL(offer = {}) {
    const moeda = texto(offer.priceCurrency || offer.priceSpecification?.priceCurrency).toUpperCase();
    return moeda === "BRL";
  }

  function precosJsonLd(produto) {
    for (const offer of listaOffers(produto)) {
      if (!moedaBRL(offer)) continue;
      const min = contrato.precoNumero(offer.lowPrice || offer.minPrice);
      const max = contrato.precoNumero(offer.highPrice || offer.maxPrice);
      if (min && max && max > min) {
        return { precoAtual: null, precoMin: min, precoMax: max, temVariacaoPreco: true };
      }
      const preco = contrato.precoNumero(offer.price || offer.salePrice);
      if (preco) {
        return { precoAtual: preco, precoMin: null, precoMax: null, temVariacaoPreco: false };
      }
    }
    return { precoAtual: null, precoMin: null, precoMax: null, temVariacaoPreco: false };
  }

  function extrairPrimeiroPreco(textoEntrada = "") {
    const bruto = texto(textoEntrada);
    if (!bruto || /(^|\s)-?\d{1,3}\s*%(\s|$)/.test(bruto)) return null;
    const re = /R\$\s*([0-9]{1,3}(?:\.[0-9]{3})*,[0-9]{2}|[0-9]+(?:[.,][0-9]{2})?)/i;
    const match = bruto.match(re);
    return contrato.precoNumero(match?.[1] || "");
  }

  function extrairFaixaPreco(textoEntrada = "") {
    const valor = texto(textoEntrada);
    if (!valor) return null;
    const moeda = "(R\\$\\s*[0-9]{1,3}(?:\\.[0-9]{3})*,[0-9]{2}|R\\$\\s*[0-9]+(?:[.,][0-9]{2})?)";
    const re = new RegExp(`${moeda}\\s*(?:-|a|ate|até)\\s*${moeda}`, "i");
    const match = valor.match(re);
    if (!match) return null;
    const min = contrato.precoNumero(match[1]);
    const max = contrato.precoNumero(match[2]);
    if (!min || !max || max <= min) return null;
    return { precoAtual: null, precoMin: min, precoMax: max, temVariacaoPreco: true };
  }

  function textoVisivel(no) {
    return limparTexto(no?.innerText || no?.textContent || "");
  }

  function linhasVisiveis(no) {
    return String(no?.innerText || no?.textContent || "")
      .split(/\n+/)
      .map(limparTexto)
      .filter(Boolean);
  }

  function linhaPrecoConfiavel(linha = "") {
    return /R\$/i.test(linha) &&
      !/(\d+\s*x|x\s*\d+|parcela|parcelamento|frete|envio|imposto|taxa|econom|poupe|moeda|coin|cashback|cupom|avali|vendid|estoque|stern)/i.test(linha);
  }

  function blocoPrincipal(documento) {
    return documento?.querySelector?.('div[role="main"], main') || documento?.body || null;
  }

  function blocosPreco(documento) {
    const main = blocoPrincipal(documento);
    if (!main?.querySelectorAll) return [];
    return Array.from(main.querySelectorAll(
      '[data-pl="product-price" i], [data-pl="product-price-current" i], [data-pl="product-price-main" i]'
    ) || []);
  }

  function precosVisuais(documento) {
    for (const bloco of blocosPreco(documento)) {
      const candidatos = [textoVisivel(bloco), ...linhasVisiveis(bloco)]
        .filter(linhaPrecoConfiavel);
      for (const candidato of candidatos) {
        const faixa = extrairFaixaPreco(candidato);
        if (faixa) return faixa;
        const preco = extrairPrimeiroPreco(candidato);
        if (preco) return { precoAtual: preco, precoMin: null, precoMax: null, temVariacaoPreco: false };
      }
    }

    return { precoAtual: null, precoMin: null, precoMax: null, temVariacaoPreco: false };
  }

  function tituloCandidatoValido(valor = "") {
    const titulo = limparTexto(valor);
    if (titulo.length < 12 || titulo.length > 220) return "";
    if (!/[a-zA-ZÀ-ÿ]/.test(titulo)) return "";
    if (/^(aliexpress|resumo do item com ia)$/i.test(titulo)) return "";
    if (/(R\$|\d+x|pix|cupom|frete|parcel|vendido|avalia|estoque|^-\d+%$)/i.test(titulo)) return "";
    return titulo;
  }

  function tituloVisual(documento) {
    const main = blocoPrincipal(documento);
    const candidatos = Array.from(main?.querySelectorAll?.("h1, [role='heading'], [data-pl*='title' i], [class*='title' i]") || [])
      .map(no => tituloCandidatoValido(no?.textContent || no?.innerText || ""))
      .filter(Boolean);
    return candidatos[0] || "";
  }

  function precoAnteriorVisual(documento, precoAtual) {
    const base = precoAtual || null;
    const main = blocoPrincipal(documento);
    const candidatos = main?.querySelectorAll?.('s, del, [aria-label*="antes" i], [class*="original" i], [class*="old" i], [class*="previous" i]') || [];
    for (const no of candidatos) {
      const textoNo = textoVisivel(no) || no.getAttribute?.("aria-label") || "";
      if (!linhaPrecoConfiavel(textoNo)) continue;
      const numero = extrairPrimeiroPreco(textoNo);
      if (numero && base && numero > base) return numero;
    }
    return null;
  }

  function precoAnteriorJsonLd(produto, precoAtual) {
    const base = precoAtual || null;
    for (const offer of listaOffers(produto)) {
      if (!moedaBRL(offer)) continue;
      const specs = Array.isArray(offer.priceSpecification)
        ? offer.priceSpecification
        : [offer.priceSpecification].filter(Boolean);
      const candidatos = [
        offer.listPrice,
        offer.originalPrice,
        offer.regularPrice,
        ...specs.map(spec => spec?.listPrice || spec?.originalPrice || spec?.maxPrice || spec?.price)
      ].map(contrato.precoNumero).filter(Boolean);
      const anterior = candidatos.find(numero => base && numero > base);
      if (anterior) return anterior;
    }
    return null;
  }

  function imagemPrincipal(documento, html, produtoJson) {
    const json = contrato.urlHttp(imagemJsonLd(produtoJson));
    if (json) return json;
    return contrato.urlHttp(meta(html, "og:image"));
  }

  function capturarAliExpressDeHtml(html, urlOriginal) {
    const documento = typeof DOMParser !== "undefined"
      ? new DOMParser().parseFromString(String(html || ""), "text/html")
      : null;
    return capturarAliExpressDaPagina(documento, { href: urlOriginal }, html);
  }

  function capturarAliExpressDaPagina(documento, locationObjeto, htmlOverride) {
    const url = locationObjeto?.href || documento?.location?.href || "";
    const html = htmlOverride || documento?.documentElement?.outerHTML || "";
    const jsonLd = extrairScriptsJsonLd(html);
    const produtoJson = primeiroProdutoJsonLd(jsonLd);
    const precosVisual = precosVisuais(documento);
    const precosJson = precosJsonLd(produtoJson);
    const precos = precosVisual.precoAtual || precosVisual.precoMin ? precosVisual : precosJson;
    const baseAnterior = precos.temVariacaoPreco ? precos.precoMin : precos.precoAtual;
    const precoAnterior = precoAnteriorVisual(documento, baseAnterior) || precoAnteriorJsonLd(produtoJson, baseAnterior);
    const itemId = itemIdAliExpress(url);
    const warnings = [];
    if (!itemId) warnings.push("item_id_ausente");

    return contrato.normalizarProdutoCapturado({
      marketplace: "aliexpress",
      urlOriginal: urlCanonicaAliExpress(url),
      titulo: tituloVisual(documento) || limparTexto(produtoJson?.name || meta(html, "og:title")),
      precoAtual: precos.temVariacaoPreco ? "" : precos.precoAtual,
      precoMin: precos.precoMin,
      precoMax: precos.precoMax,
      temVariacaoPreco: precos.temVariacaoPreco,
      precoAnterior: precoAnterior && baseAnterior && precoAnterior > baseAnterior ? precoAnterior : "",
      imagem: imagemPrincipal(documento, html, produtoJson),
      cupom: "",
      fonte: precosVisual.precoAtual || precosVisual.precoMin ? "dom_aliexpress_v1" : "json_ld_aliexpress_v1",
      warnings
    });
  }

  const api = {
    capturarAliExpressDaPagina,
    capturarAliExpressDeHtml,
    extrairScriptsJsonLd,
    primeiroProdutoJsonLd,
    precosJsonLd,
    precosVisuais,
    itemIdAliExpress
  };
  global.OptimusCaptureAliExpress = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
