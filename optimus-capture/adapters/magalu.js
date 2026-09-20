(function publicarAdapterMagalu(global) {
  const contrato = global.OptimusCaptureContract || require("../core/product-contract");
  const detector = global.OptimusCaptureDetector || require("../core/marketplace-detector");

  function texto(valor = "") {
    return contrato.texto(valor);
  }

  function limparTexto(valor = "") {
    return texto(valor)
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function extrairScriptsJsonLd(html = "") {
    const scripts = [];
    const re = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let match;
    while ((match = re.exec(String(html || "")))) {
      try {
        const valor = JSON.parse(match[1].trim());
        if (valor && typeof valor === "object") scripts.push(valor);
      } catch (_) {
        // JSON-LD parcial nao deve impedir a captura de outros sinais confiaveis.
      }
    }
    return scripts;
  }

  function caminhar(valor, callback) {
    if (!valor || typeof valor !== "object") return;
    callback(valor);
    if (Array.isArray(valor)) {
      valor.forEach((item) => caminhar(item, callback));
      return;
    }
    Object.values(valor).forEach((item) => caminhar(item, callback));
  }

  function tipoProduto(no = {}) {
    const tipo = no["@type"];
    return Array.isArray(tipo)
      ? tipo.some((item) => texto(item).toLowerCase() === "product")
      : texto(tipo).toLowerCase() === "product";
  }

  function primeiroProduto(jsonLd = []) {
    let produto = null;
    for (const raiz of jsonLd) {
      caminhar(raiz, (no) => {
        if (!produto && tipoProduto(no)) produto = no;
      });
      if (produto) break;
    }
    return produto || {};
  }

  function meta(html = "", nome = "") {
    const alvo = String(nome).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`<meta\\b(?=[^>]*(?:property|name)=["']${alvo}["'])(?=[^>]*content=["']([^"']+)["'])[^>]*>`, "i");
    return limparTexto((String(html || "").match(re) || [])[1] || "");
  }

  function textoVisivel(html = "") {
    return String(html || "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/\s+/g, " ")
      .trim();
  }

  function primeiroNumero(...valores) {
    for (const valor of valores) {
      const numero = contrato.precoNumero(valor);
      if (numero) return numero;
    }
    return null;
  }

  function ofertaJsonLd(produto = {}) {
    return Array.isArray(produto.offers) ? produto.offers[0] || {} : (produto.offers || {});
  }

  function valorMonetarioTexto(valor = "") {
    const textoValor = limparTexto(valor);
    const match = textoValor.match(/(?:R\$\s*)?([0-9]{1,3}(?:\.[0-9]{3})*,[0-9]{2}|[0-9]+(?:[.,][0-9]{2})?)/);
    return match ? contrato.precoNumero(match[1]) : null;
  }

  function blocosSemanticos(html = "", padrao) {
    const blocos = [];
    const re = /<([a-z][\w:-]*)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi;
    let match;
    while ((match = re.exec(String(html || "")))) {
      const atributos = String(match[2] || "");
      if (!padrao.test(atributos)) continue;
      const textoBloco = textoVisivel(match[3] || "");
      if (!textoBloco) continue;
      blocos.push({ atributos, texto: textoBloco, tamanho: textoBloco.length });
    }
    blocos.sort((a, b) => a.tamanho - b.tamanho);
    const unicos = [];
    for (const bloco of blocos) {
      if (unicos.some((item) => item.texto === bloco.texto || item.texto.includes(bloco.texto))) continue;
      unicos.push(bloco);
    }
    return unicos;
  }

  function valorPixEstruturado(produto = {}, html = "") {
    const oferta = ofertaJsonLd(produto);
    const especificacoes = Array.isArray(oferta.priceSpecification)
      ? oferta.priceSpecification
      : (oferta.priceSpecification && typeof oferta.priceSpecification === "object" ? [oferta.priceSpecification] : []);
    for (const especificacao of especificacoes) {
      const semantica = [
        especificacao?.name,
        especificacao?.description,
        especificacao?.paymentMethod,
        especificacao?.paymentMethodId
      ].map(texto).join(" ");
      if (/\bpix\b|a[ -]?vista|avista/i.test(semantica)) {
        const valor = valorMonetarioTexto(especificacao?.price ?? especificacao?.value ?? especificacao?.priceValue);
        if (valor) return valor;
      }
    }
    const blocos = blocosSemanticos(html, /pix|a[ -_]?vista|pre[cç]o[ -_]?pix|price[ -_]?pix/i);
    for (const bloco of blocos) {
      const valor = valorMonetarioTexto(bloco.texto);
      if (valor) return valor;
    }
    return null;
  }

  function faixaPrecoEstruturada(produto = {}, html = "") {
    const oferta = ofertaJsonLd(produto);
    const especificacoes = Array.isArray(oferta.priceSpecification) ? oferta.priceSpecification : [];
    const minimo = valorMonetarioTexto(oferta.lowPrice ?? oferta.minPrice ?? oferta.priceRange?.minPrice) ||
      especificacoes.map((item) => valorMonetarioTexto(item?.minPrice)).find(Boolean) || null;
    const maximo = valorMonetarioTexto(oferta.highPrice ?? oferta.maxPrice ?? oferta.priceRange?.maxPrice) ||
      especificacoes.map((item) => valorMonetarioTexto(item?.maxPrice)).find(Boolean) || null;
    if (minimo && maximo && maximo > minimo) return { precoMin: minimo, precoMax: maximo };

    const blocos = blocosSemanticos(html, /a[ -_]?partir|starting[ -_]?price|price[ -_]?min|price[ -_]?max|pre[cç]o[ -_]?min|pre[cç]o[ -_]?max/i);
    const valoresSemanticos = blocos.flatMap((bloco) => [...bloco.texto.matchAll(/(?:R\$\s*)?([0-9]{1,3}(?:\.[0-9]{3})*,[0-9]{2}|[0-9]+(?:[.,][0-9]{2})?)/g)]
      .map((item) => contrato.precoNumero(item[1]))
      .filter((item) => item));
    const unicosSemanticos = [...new Set(valoresSemanticos)].sort((a, b) => a - b);
    if (unicosSemanticos.length >= 2 && unicosSemanticos[1] > unicosSemanticos[0]) {
      return { precoMin: unicosSemanticos[0], precoMax: unicosSemanticos[1] };
    }
    for (const bloco of blocos) {
      const valores = [...bloco.texto.matchAll(/(?:R\$\s*)?([0-9]{1,3}(?:\.[0-9]{3})*,[0-9]{2}|[0-9]+(?:[.,][0-9]{2})?)/g)]
        .map((item) => contrato.precoNumero(item[1]))
        .filter((item) => item);
      const unicos = [...new Set(valores)].sort((a, b) => a - b);
      if (unicos.length >= 2 && unicos[1] > unicos[0]) return { precoMin: unicos[0], precoMax: unicos[1] };
    }
    return null;
  }

  function parcelamentoEstruturado(html = "") {
    const blocos = blocosSemanticos(html, /parcel|installment|payment/i);
    for (const bloco of blocos) {
      const match = bloco.texto.match(/\b\d{1,2}x\s+(?:de\s+)?R\$\s*[0-9.]+,[0-9]{2}[^.]{0,80}/i);
      if (match) return limparTexto(match[0]);
    }
    return "";
  }

  function imagemOficial(valor = "") {
    const candidato = contrato.urlHttp(valor);
    if (!candidato) return "";
    try {
      const url = new URL(candidato);
      const host = url.hostname.toLowerCase();
      return url.protocol === "https:" && (host === "mlcdn.com.br" || host.endsWith(".mlcdn.com.br")) ? candidato : "";
    } catch (_) {
      return "";
    }
  }

  function imagemProduto(produto, html) {
    const imagem = produto?.image;
    const candidataJson = Array.isArray(imagem)
      ? imagem.find((item) => imagemOficial(item))
      : (imagem && typeof imagem === "object" ? (imagem.url || imagem.contentUrl) : imagem);
    return imagemOficial(candidataJson) || imagemOficial(meta(html, "og:image"));
  }

  function precoAnterior(produto, atual) {
    const oferta = ofertaJsonLd(produto);
    return primeiroNumero(
      oferta.listPrice,
      oferta.originalPrice,
      oferta.regularPrice,
      ...(Array.isArray(oferta.priceSpecification)
        ? oferta.priceSpecification.map((item) => item?.listPrice || item?.originalPrice)
        : [])
    ) > (atual || 0)
      ? primeiroNumero(
        oferta.listPrice,
        oferta.originalPrice,
        oferta.regularPrice,
        ...(Array.isArray(oferta.priceSpecification)
          ? oferta.priceSpecification.map((item) => item?.listPrice || item?.originalPrice)
          : [])
      )
      : null;
  }

  function precoNoTexto(textoPagina, atual) {
    const candidatos = [];
    const re = /\b(?:de|antes|pre[cç]o\s+anterior|valor\s+anterior)\s*:?(?:\s*R\$)?\s*([0-9]{1,3}(?:\.[0-9]{3})*,[0-9]{2}|[0-9]+(?:[.,][0-9]{2})?)/gi;
    let match;
    while ((match = re.exec(textoPagina))) {
      const numero = contrato.precoNumero(match[1]);
      if (numero && numero > (atual || 0) && !candidatos.includes(numero)) candidatos.push(numero);
    }
    return candidatos[0] || null;
  }

  function cupomNoTexto(textoPagina) {
    const match = textoPagina.match(/\b(?:cupom|c[oó]digo)\s*:?[ \t]*([A-Z0-9][A-Z0-9_-]{2,40})\b/i);
    return match ? texto(match[1]).toUpperCase() : "";
  }

  function capturarMagaluDeHtml(html = "", urlOriginal = "") {
    const htmlTexto = String(html || "");
    const jsonLd = extrairScriptsJsonLd(htmlTexto);
    const produto = primeiroProduto(jsonLd);
    const oferta = ofertaJsonLd(produto);
    const textoPagina = textoVisivel(htmlTexto);
    const titulo = limparTexto((produto.name || meta(htmlTexto, "og:title") ||
      (htmlTexto.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] ||
      (htmlTexto.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "")
      .replace(/\s*\|\s*(?:Magazine Luiza|Magalu).*$/i, ""));
    const faixaPreco = faixaPrecoEstruturada(produto, htmlTexto);
    const precoAtual = faixaPreco
      ? null
      : primeiroNumero(oferta.price, oferta.lowPrice, oferta.highPrice, meta(htmlTexto, "product:price:amount"));
    const precoAntigo = precoAnterior(produto, precoAtual) || precoNoTexto(textoPagina, precoAtual);
    let produtoIdUrl = "";
    try {
      produtoIdUrl = detector.produtoIdMagalu?.(new URL(urlOriginal)) || "";
    } catch (_) {
      produtoIdUrl = "";
    }
    const productId = texto(produtoIdUrl || produto.sku || produto.productID || produto.mpn);
    const seller = texto(oferta.seller?.name || produto.seller?.name || produto.brand?.name);
    const imagem = imagemProduto(produto, htmlTexto);
    const categoria = texto(produto.category);
    const precoPix = valorPixEstruturado(produto, htmlTexto);
    const parcelamento = parcelamentoEstruturado(htmlTexto);
    const warnings = [];
    if (!productId) warnings.push("produto_id_ausente");
    if (!imagem) warnings.push("imagem_oficial_ausente");

    return contrato.normalizarProdutoCapturado({
      marketplace: "magalu",
      urlOriginal: texto(urlOriginal),
      titulo,
      precoAtual,
      precoAnterior: precoAntigo,
      precoMin: faixaPreco?.precoMin || null,
      precoMax: faixaPreco?.precoMax || null,
      temVariacaoPreco: Boolean(faixaPreco),
      precoPix: precoPix || "",
      parcelamento,
      imagem,
      categoria,
      seller,
      cupom: cupomNoTexto(textoPagina),
      produtoId: productId,
      sku: texto(produto.sku),
      fonte: "dom_magalu_v1",
      warnings
    });
  }

  function capturarMagaluDaPagina(documento, locationObjeto) {
    const url = locationObjeto?.href || documento?.location?.href || "";
    return capturarMagaluDeHtml(documento?.documentElement?.outerHTML || "", url);
  }

  const api = {
    capturarMagaluDaPagina,
    capturarMagaluDeHtml,
    extrairScriptsJsonLd,
    imagemOficial
  };
  global.OptimusCaptureMagalu = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
