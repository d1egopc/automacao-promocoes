(function publicarAdapterAmazon(global) {
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

  function meta(html, propriedade) {
    const alvo = propriedade.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`<meta\\b(?=[^>]*(?:property|name)=["']${alvo}["'])(?=[^>]*content=["']([^"']+)["'])[^>]*>`, "i");
    return limparTexto((String(html || "").match(re) || [])[1] || "");
  }

  function textoHtmlFragmento(html = "") {
    return limparTexto(String(html || "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "));
  }

  function tituloAmazon(documento, html) {
    const titulo = limparTexto(documento?.querySelector?.("#productTitle")?.textContent || "");
    if (titulo) return titulo;
    const og = meta(html, "og:title");
    if (og) return og.replace(/\s*:\s*Amazon\.com\.br.*$/i, "");
    return limparTexto((String(html || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "");
  }

  function imagemAmazon(documento, html) {
    const img = documento?.querySelector?.("#landingImage");
    const oldHires = contrato.urlHttp(img?.getAttribute?.("data-old-hires") || "");
    if (oldHires) return oldHires;
    const src = contrato.urlHttp(img?.src || img?.currentSrc || img?.getAttribute?.("src") || "");
    if (src) return src;
    return contrato.urlHttp(meta(html, "og:image"));
  }

  function blocoPrecoPrincipal(documento) {
    return documento?.querySelector?.("#corePriceDisplay_desktop_feature_div") || null;
  }

  function valorAmazonPrice(no) {
    if (!no?.querySelector) return null;
    const whole = limparTexto(no.querySelector(".a-price-whole")?.textContent || "");
    const fraction = limparTexto(no.querySelector(".a-price-fraction")?.textContent || "");
    const inteiro = whole.replace(/[^\d]/g, "");
    if (inteiro) {
      const centavos = fraction ? fraction.replace(/[^\d]/g, "").padEnd(2, "0").slice(0, 2) : "00";
      const numero = Number(`${inteiro}.${centavos || "00"}`);
      return Number.isFinite(numero) && numero > 0 ? numero : null;
    }

    const offscreen = limparTexto(no.querySelector(".a-offscreen")?.textContent || "");
    return contrato.precoNumero(offscreen);
  }

  function precoAtualAmazon(documento) {
    const bloco = blocoPrecoPrincipal(documento);
    if (!bloco?.querySelector) return null;
    const priceToPay = bloco.querySelector(".priceToPay");
    const preco = valorAmazonPrice(priceToPay);
    if (preco) return preco;
    const offscreen = limparTexto(priceToPay?.querySelector?.(".a-offscreen")?.textContent || "");
    return contrato.precoNumero(offscreen);
  }

  function precoAnteriorAmazon(documento, precoAtual) {
    const bloco = blocoPrecoPrincipal(documento);
    if (!bloco?.querySelector) return null;
    const candidatos = bloco.querySelectorAll(".apex-basisprice-value.a-text-price, .apex-basisprice-value .a-text-price, .apex-basisprice-value");
    for (const no of candidatos || []) {
      const numero = contrato.precoNumero(no.querySelector?.(".a-offscreen")?.textContent || no.textContent || "");
      if (numero && precoAtual && numero > precoAtual) return numero;
    }
    return null;
  }

  function descontoAmazon(documento) {
    const bloco = blocoPrecoPrincipal(documento);
    const textoDesconto = limparTexto(bloco?.querySelector?.(".savingsPercentage")?.textContent || "");
    const match = textoDesconto.match(/-?\s*(\d{1,2})\s*%/);
    const numero = Number(match?.[1] || 0);
    return Number.isFinite(numero) && numero > 0 ? numero : null;
  }

  function capturarAmazonDeHtml(html, urlOriginal) {
    const documento = typeof DOMParser !== "undefined"
      ? new DOMParser().parseFromString(String(html || ""), "text/html")
      : null;
    return capturarAmazonDaPagina(documento, { href: urlOriginal }, html);
  }

  function capturarAmazonDaPagina(documento, locationObjeto, htmlOverride) {
    const url = locationObjeto?.href || documento?.location?.href || "";
    const html = htmlOverride || documento?.documentElement?.outerHTML || "";
    const precoAtual = precoAtualAmazon(documento);
    const precoAnterior = precoAnteriorAmazon(documento, precoAtual);
    const desconto = descontoAmazon(documento);
    const warnings = [];
    if (!blocoPrecoPrincipal(documento)) warnings.push("preco_amazon_sem_bloco_principal");

    const produto = contrato.normalizarProdutoCapturado({
      marketplace: "amazon",
      urlOriginal: url,
      titulo: tituloAmazon(documento, html),
      precoAtual,
      precoAnterior: precoAnterior && precoAtual && precoAnterior > precoAtual ? precoAnterior : "",
      imagem: imagemAmazon(documento, html),
      cupom: "",
      fonte: "dom_amazon_v1",
      warnings
    });

    if (!produto.descontoPercentual && desconto) {
      produto.descontoPercentual = desconto;
    }
    return produto;
  }

  const api = {
    capturarAmazonDaPagina,
    capturarAmazonDeHtml,
    precoAtualAmazon,
    precoAnteriorAmazon,
    descontoAmazon
  };
  global.OptimusCaptureAmazon = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
