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
    if (/(R\$|\b\d+\s*x(?:\s+de)?\s+R\$|pix|cupom|frete|parcel|desconto|economia|prime|^-\d+%$)/i.test(titulo)) return "";
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

  function urlImagemProdutoKabum(src = "", produtoId = "") {
    const url = contrato.urlHttp(src);
    if (!url || !produtoId) return null;
    try {
      const parsed = new URL(url);
      const host = texto(parsed.hostname).toLowerCase();
      if (host !== "images.kabum.com.br" && host !== "static.kabum.com.br") return null;
      if (!parsed.pathname.startsWith(`/produtos/fotos/${produtoId}/`)) return null;
      return url;
    } catch {
      return null;
    }
  }

  function numeroPositivo(valor) {
    const numero = Number(valor || 0);
    return Number.isFinite(numero) && numero > 0 ? numero : 0;
  }

  function candidatosSrcset(valor = "") {
    return texto(valor)
      .split(",")
      .map(item => item.trim())
      .filter(Boolean)
      .map((item) => {
        const partes = item.split(/\s+/).filter(Boolean);
        const src = partes.shift() || "";
        const descritor = partes[0] || "";
        const largura = descritor.match(/^(\d+)w$/i);
        const densidade = descritor.match(/^([0-9]+(?:\.[0-9]+)?)x$/i);
        return {
          src,
          larguraDescriptor: largura ? Number(largura[1]) : 0,
          densidadeDescriptor: densidade ? Number(densidade[1]) : 0
        };
      });
  }

  function atributosUrlImagem(img) {
    return [
      img?.currentSrc,
      img?.src,
      img?.getAttribute?.("src"),
      img?.getAttribute?.("data-src"),
      img?.getAttribute?.("data-original"),
      img?.getAttribute?.("data-lazy"),
      img?.getAttribute?.("data-lazy-src")
    ];
  }

  function atributosSrcsetImagem(no) {
    return [
      no?.getAttribute?.("srcset"),
      no?.getAttribute?.("data-srcset"),
      no?.getAttribute?.("data-lazy-srcset")
    ];
  }

  function sourcesPictureImagem(img) {
    const picture = texto(img?.parentElement?.tagName).toLowerCase() === "picture"
      ? img.parentElement
      : img?.closest?.("picture");
    return Array.from(picture?.querySelectorAll?.("source") || []);
  }

  function dimensoesImagemProduto(img, candidato = {}) {
    const naturalWidth = Number(img?.naturalWidth || 0);
    const naturalHeight = Number(img?.naturalHeight || 0);
    const clientWidth = Number(img?.clientWidth || img?.width || 0);
    const clientHeight = Number(img?.clientHeight || img?.height || 0);
    const larguraDescriptor = numeroPositivo(candidato.larguraDescriptor);
    const densidadeDescriptor = numeroPositivo(candidato.densidadeDescriptor);
    const larguraPorDensidade = densidadeDescriptor && clientWidth
      ? clientWidth * densidadeDescriptor
      : 0;
    const alturaPorDensidade = densidadeDescriptor && clientHeight
      ? clientHeight * densidadeDescriptor
      : 0;
    const larguraEvidencia = Math.max(naturalWidth, larguraDescriptor, larguraPorDensidade);
    const alturaEvidencia = Math.max(naturalHeight, larguraDescriptor, alturaPorDensidade);
    if (larguraEvidencia < 300 || alturaEvidencia < 300) return null;

    const proporcoes = [
      naturalWidth && naturalHeight ? naturalWidth / naturalHeight : 0,
      clientWidth && clientHeight ? clientWidth / clientHeight : 0
    ].filter(Number.isFinite).filter(Boolean);
    if (proporcoes.some(proporcao => proporcao < 0.45 || proporcao > 2.2)) return null;

    const areaDescriptor = larguraDescriptor
      ? larguraDescriptor * larguraDescriptor
      : (larguraPorDensidade * alturaPorDensidade);
    return {
      areaRenderizada: Math.max(0, clientWidth) * Math.max(0, clientHeight),
      areaNatural: naturalWidth * naturalHeight,
      areaDescriptor,
      larguraDescriptor,
      densidadeDescriptor
    };
  }

  function candidatosImagemProduto(img, indice, produtoId) {
    const candidatos = [];
    const adicionar = (src, extra = {}) => {
      const url = urlImagemProdutoKabum(src, produtoId);
      if (!url) return;
      const dimensoes = dimensoesImagemProduto(img, extra);
      if (!dimensoes) return;
      candidatos.push({ src: url, indice, ...dimensoes });
    };

    atributosUrlImagem(img).forEach(src => adicionar(src));
    atributosSrcsetImagem(img).forEach((srcset) => {
      candidatosSrcset(srcset).forEach(candidato => adicionar(candidato.src, candidato));
    });
    sourcesPictureImagem(img).forEach((source) => {
      atributosSrcsetImagem(source).forEach((srcset) => {
        candidatosSrcset(srcset).forEach(candidato => adicionar(candidato.src, candidato));
      });
    });

    return candidatos;
  }

  function qualidadeImagemProduto(candidata = {}) {
    return Math.max(candidata.areaNatural || 0, candidata.areaDescriptor || 0);
  }

  function melhorImagemProduto(atual, candidata) {
    if (!atual) return candidata;
    const qualidadeAtual = qualidadeImagemProduto(atual);
    const qualidadeCandidata = qualidadeImagemProduto(candidata);
    if (candidata.areaRenderizada > atual.areaRenderizada) return candidata;
    if (candidata.areaRenderizada < atual.areaRenderizada) return atual;
    if (qualidadeCandidata > qualidadeAtual) return candidata;
    if (qualidadeCandidata < qualidadeAtual) return atual;
    if ((candidata.larguraDescriptor || 0) > (atual.larguraDescriptor || 0)) return candidata;
    if ((candidata.larguraDescriptor || 0) < (atual.larguraDescriptor || 0)) return atual;
    if ((candidata.densidadeDescriptor || 0) > (atual.densidadeDescriptor || 0)) return candidata;
    if ((candidata.densidadeDescriptor || 0) < (atual.densidadeDescriptor || 0)) return atual;
    return candidata.indice < atual.indice ? candidata : atual;
  }

  function imagemKabum(documento, html, produtoId = "") {
    const candidatas = Array.from(documento?.images || []);
    let melhor = null;
    candidatas.forEach((img, indice) => {
      candidatosImagemProduto(img, indice, produtoId).forEach((candidata) => {
        melhor = melhorImagemProduto(melhor, candidata);
      });
    });
    if (melhor?.src) return melhor.src;

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
      imagem: imagemKabum(documento, html, produtoId),
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
