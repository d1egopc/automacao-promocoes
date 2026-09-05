(function publicarAdapterShopee(global) {
  const contrato = global.OptimusCaptureContract || require("../core/product-contract");

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

  function tituloHtml(html) {
    return limparTexto((String(html || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "")
      .replace(/\s*\|\s*Shopee.*$/i, "");
  }

  function primeiroSeletorTexto(raiz, seletores = []) {
    if (!raiz?.querySelector) return "";
    for (const seletor of seletores) {
      const valor = limparTexto(raiz.querySelector(seletor)?.textContent || "");
      if (valor) return valor;
    }
    return "";
  }

  function tituloFallbackMain(documento, html) {
    const main = documento?.querySelector?.('div[role="main"], main') || documento?.body || null;
    const estrutural = primeiroSeletorTexto(main, [
      "h1",
      '[data-testid="pdp-product-title"]',
      '[aria-label*="nome do produto" i]'
    ]);
    if (estrutural) return estrutural;

    const candidatos = Array.from(main?.querySelectorAll?.("h1, h2, [role='heading'], [class*='title' i], span, div") || [])
      .map((no) => limparTexto(no?.textContent || no?.innerText || ""))
      .filter((valor) => valor.length >= 12 && valor.length <= 180)
      .filter((valor) => /[a-zA-ZÀ-ÿ]/.test(valor))
      .filter((valor) => !/(R\$|\d+x|pix|cupom|frete|parcel|vendido|avalia|estoque|sem cupom)/i.test(valor));
    if (candidatos.length) return candidatos[0];

    const porLinha = linhasVisiveis(main)
      .filter((valor) => valor.length >= 12 && valor.length <= 180)
      .filter((valor) => /[a-zA-ZÀ-ÿ]/.test(valor))
      .filter((valor) => !/(R\$|\d+x|pix|cupom|frete|parcel|vendido|avalia|estoque|sem cupom|^-\d+%$)/i.test(valor));
    if (porLinha.length) return porLinha[0];

    const og = meta(html, "og:title");
    if (og) return og.replace(/\s*\|\s*Shopee.*$/i, "").trim();
    return tituloHtml(html);
  }

  function imagemHero(documento, html) {
    const img = documento?.querySelector?.('img[elementtiming="shopee:heroComponentPaint"]');
    const src = contrato.urlHttp(img?.currentSrc || img?.src || img?.getAttribute?.("src") || "");
    if (src) return src;
    return contrato.urlHttp(meta(html, "og:image"));
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

  function extrairPrimeiroPreco(textoEntrada = "") {
    const re = /R\$\s*([0-9]{1,3}(?:\.[0-9]{3})*,[0-9]{2}|[0-9]+(?:[.,][0-9]{2})?)/i;
    const match = texto(textoEntrada).match(re);
    return contrato.precoNumero(match?.[1] || "");
  }

  function linhasPrecoPrincipal(documento) {
    const main = documento?.querySelector?.('div[role="main"], main') || documento?.body || null;
    return linhasVisiveis(main)
      .filter((linha) => /R\$/i.test(linha))
      .filter((linha) => !/(\d+\s*x|parcela|parcelamento|frete|envio|cashback)/i.test(linha));
  }

  function blocoPrecoPrincipal(documento) {
    const main = documento?.querySelector?.('div[role="main"], main') || documento?.body || null;
    if (!main?.querySelector) return null;
    return main.querySelector('section[aria-live="polite"]') || null;
  }

  function precoAtualShopee(documento, html) {
    const bloco = blocoPrecoPrincipal(documento);
    const precoBloco = extrairPrimeiroPreco(textoVisivel(bloco));
    if (precoBloco) return precoBloco;
    const htmlBloco = (String(html || "").match(/<section\b(?=[^>]*aria-live=["']polite["'])[^>]*>([\s\S]*?)<\/section>/i) || [])[1] || "";
    const precoHtml = extrairPrimeiroPreco(textoHtmlFragmento(htmlBloco));
    if (precoHtml) return precoHtml;
    const [linhaPrincipal] = linhasPrecoPrincipal(documento);
    return extrairPrimeiroPreco(linhaPrincipal);
  }

  function precoAnteriorEstrutural(documento, precoAtual) {
    const main = documento?.querySelector?.('div[role="main"], main') || documento?.body || null;
    const candidatos = main?.querySelectorAll?.('s, del, [aria-label*="antes" i], [class*="original" i], [class*="previous" i]') || [];
    for (const no of candidatos) {
      const numero = extrairPrimeiroPreco(textoVisivel(no) || no.getAttribute?.("aria-label") || "");
      if (numero && precoAtual && numero > precoAtual) return numero;
    }
    return null;
  }

  function capturarShopeeDeHtml(html, urlOriginal) {
    const documento = typeof DOMParser !== "undefined"
      ? new DOMParser().parseFromString(String(html || ""), "text/html")
      : null;
    return capturarShopeeDaPagina(documento, { href: urlOriginal }, html);
  }

  function capturarShopeeDaPagina(documento, locationObjeto, htmlOverride) {
    const url = locationObjeto?.href || documento?.location?.href || "";
    const html = htmlOverride || documento?.documentElement?.outerHTML || "";
    const precoAtual = precoAtualShopee(documento, html);
    const precoAnterior = precoAnteriorEstrutural(documento, precoAtual);

    return contrato.normalizarProdutoCapturado({
      marketplace: "shopee",
      urlOriginal: url,
      titulo: tituloFallbackMain(documento, html),
      precoAtual,
      precoAnterior: precoAnterior && precoAtual && precoAnterior > precoAtual ? precoAnterior : "",
      imagem: imagemHero(documento, html),
      cupom: "",
      fonte: "dom_shopee_v1",
      warnings: []
    });
  }

  const api = {
    capturarShopeeDaPagina,
    capturarShopeeDeHtml,
    precoAtualShopee,
    precoAnteriorEstrutural
  };
  global.OptimusCaptureShopee = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
