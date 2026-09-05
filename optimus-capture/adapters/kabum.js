(function publicarAdapterKabum(global) {
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

  function meta(html, propriedade) {
    const alvo = propriedade.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`<meta\\b(?=[^>]*(?:property|name)=["']${alvo}["'])(?=[^>]*content=["']([^"']+)["'])[^>]*>`, "i");
    return limparTexto((String(html || "").match(re) || [])[1] || "");
  }

  function textoVisivel(no) {
    return limparTexto(no?.innerText || no?.textContent || "");
  }

  function mainProduto(documento) {
    return documento?.querySelector?.("main, [role='main']") || documento?.body || null;
  }

  function tituloValido(valor = "") {
    const titulo = limparTexto(valor);
    if (titulo.length < 8 || titulo.length > 240) return "";
    if (!/[a-zA-ZÀ-ÿ]/.test(titulo)) return "";
    if (/^(kabum|br kabum|loja kabum)$/i.test(titulo)) return "";
    if (/(R\$|\d+x|pix|cupom|frete|parcel|desconto|economia|prime|^-\d+%$)/i.test(titulo)) return "";
    return titulo.replace(/\s*(?:\||-)\s*(?:KaBuM!?|Kabum BR|BR Kabum)\s*$/i, "").trim();
  }

  function tituloKabum(documento, html) {
    const main = mainProduto(documento);
    const h1s = Array.from(main?.querySelectorAll?.("h1") || []);
    for (const h1 of h1s) {
      const titulo = tituloValido(h1?.textContent || h1?.innerText || "");
      if (titulo) return titulo;
    }

    const og = tituloValido(meta(html, "og:title"));
    if (og) return og;

    return tituloValido((String(html || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "");
  }

  function valorMonetarioUnico(valor = "") {
    const bruto = texto(valor);
    if (!bruto) return null;
    if (/(\d+\s*x|parcela|parcelamento|frete|envio|economia|prime|cashback|cupom|desconto\s+de\s+\d+\s*%)/i.test(bruto)) {
      return null;
    }
    const matches = bruto.match(/R\$\s*[0-9]{1,3}(?:\.[0-9]{3})*,[0-9]{2}|R\$\s*[0-9]+(?:[.,][0-9]{2})?/gi) || [];
    if (matches.length !== 1) return null;
    return contrato.precoNumero(matches[0]);
  }

  function temPix(no) {
    return /(?:^|[\s:;-])(?:a|à)\s+vista\s+no\s+pix\b/i.test(textoVisivel(no));
  }

  function candidatosH4Pix(raiz) {
    const h4s = Array.from(raiz?.querySelectorAll?.("h4") || []);
    const candidatos = [];
    for (const h4 of h4s) {
      const preco = valorMonetarioUnico(textoVisivel(h4));
      if (!preco) continue;
      let atual = h4;
      for (let nivel = 0; atual && nivel < 6; nivel += 1) {
        if (temPix(atual)) {
          candidatos.push({ h4, bloco: atual, preco });
          break;
        }
        atual = atual.parentElement || null;
      }
    }
    return candidatos;
  }

  function blocosPixComH4(raiz) {
    const blocos = Array.from(raiz?.querySelectorAll?.("section, article, div") || [])
      .filter(temPix)
      .filter((bloco) => Array.from(bloco.querySelectorAll?.("h4") || []).some(h4 => valorMonetarioUnico(textoVisivel(h4))));
    return blocos;
  }

  function blocoPrecoPix(documento) {
    const raiz = mainProduto(documento);
    const [porH4] = candidatosH4Pix(raiz);
    if (porH4) return porH4;

    for (const bloco of blocosPixComH4(raiz)) {
      const h4 = Array.from(bloco.querySelectorAll?.("h4") || [])
        .find(no => valorMonetarioUnico(textoVisivel(no)));
      const preco = valorMonetarioUnico(textoVisivel(h4));
      if (h4 && preco) return { h4, bloco, preco };
    }

    return null;
  }

  function temLineThrough(no) {
    const tag = texto(no?.tagName).toLowerCase();
    if (tag === "s" || tag === "del") return true;
    const styleTexto = texto(no?.getAttribute?.("style") || no?.style?.textDecoration || no?.style?.textDecorationLine).toLowerCase();
    if (styleTexto.includes("line-through")) return true;
    try {
      const computed = typeof global.getComputedStyle === "function" ? global.getComputedStyle(no) : null;
      return texto(computed?.textDecorationLine || computed?.textDecoration).toLowerCase().includes("line-through");
    } catch {
      return false;
    }
  }

  function precoAnteriorKabum(bloco, precoAtual) {
    const candidatos = Array.from(bloco?.querySelectorAll?.("s, del, span, p") || []);
    for (const no of candidatos) {
      if (!temLineThrough(no)) continue;
      const numero = valorMonetarioUnico(textoVisivel(no));
      if (numero && precoAtual && numero > precoAtual) return numero;
    }
    return null;
  }

  function imagemKabum(documento, html) {
    const og = contrato.urlHttp(meta(html, "og:image"));
    if (og) return og;

    const main = mainProduto(documento);
    const imagens = Array.from(main?.querySelectorAll?.("img") || []);
    for (const img of imagens) {
      const src = contrato.urlHttp(img?.currentSrc || img?.src || img?.getAttribute?.("src") || "");
      if (/images\.kabum\.com\.br|static\.kabum\.com\.br/i.test(src)) return src;
    }
    return "";
  }

  function produtoIdKabum(urlOriginal = "") {
    try {
      return detector.produtoIdKabum(new URL(texto(urlOriginal)));
    } catch {
      return "";
    }
  }

  function capturarKabumDeHtml(html, urlOriginal) {
    const documento = typeof DOMParser !== "undefined"
      ? new DOMParser().parseFromString(String(html || ""), "text/html")
      : null;
    return capturarKabumDaPagina(documento, { href: urlOriginal }, html);
  }

  function capturarKabumDaPagina(documento, locationObjeto, htmlOverride) {
    const url = locationObjeto?.href || documento?.location?.href || "";
    const html = htmlOverride || documento?.documentElement?.outerHTML || "";
    const bloco = blocoPrecoPix(documento);
    const precoAtual = bloco?.preco || null;
    const precoAnterior = precoAnteriorKabum(bloco?.bloco, precoAtual);
    const produtoId = produtoIdKabum(url);
    const warnings = [];
    if (!produtoId) warnings.push("produto_id_kabum_ausente");
    if (!bloco) warnings.push("preco_kabum_sem_bloco_pix_h4");

    const produto = contrato.normalizarProdutoCapturado({
      marketplace: "kabum",
      urlOriginal: url,
      titulo: tituloKabum(documento, html),
      precoAtual,
      precoAnterior: precoAnterior && precoAtual && precoAnterior > precoAtual ? precoAnterior : "",
      condicaoPrecoPor: bloco ? "pix" : "",
      imagem: imagemKabum(documento, html),
      cupom: "",
      fonte: "dom_kabum_v1",
      warnings
    });
    produto.produtoId = produtoId;
    return produto;
  }

  const api = {
    capturarKabumDaPagina,
    capturarKabumDeHtml,
    blocoPrecoPix,
    precoAnteriorKabum,
    produtoIdKabum
  };
  global.OptimusCaptureKabum = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
