(function publicarContrato(global) {
  function texto(valor) {
    return String(valor ?? "").trim();
  }

  function precoNumero(valor) {
    if (typeof valor === "number") {
      return Number.isFinite(valor) && valor > 0 ? valor : null;
    }
    const bruto = texto(valor);
    if (!bruto) return null;
    const semMoeda = bruto
      .replace(/R\$/gi, "")
      .replace(/\s+/g, "");
    const limpo = semMoeda.includes(",")
      ? semMoeda.replace(/\./g, "").replace(",", ".")
      : semMoeda;
    const numero = Number(limpo);
    return Number.isFinite(numero) && numero > 0 ? numero : null;
  }

  function urlHttp(valor) {
    const entrada = texto(valor);
    if (!entrada) return "";
    try {
      const url = new URL(entrada);
      return ["http:", "https:"].includes(url.protocol) ? url.toString() : "";
    } catch {
      return "";
    }
  }

  function descontoPercentual(precoAtual, precoAnterior) {
    const atual = precoNumero(precoAtual);
    const anterior = precoNumero(precoAnterior);
    if (!atual || !anterior || anterior <= atual) return null;
    return Math.round(((anterior - atual) / anterior) * 100);
  }

  function temFaixaRealPreco(precoMin, precoMax) {
    const min = precoNumero(precoMin);
    const max = precoNumero(precoMax);
    return min && max && max > min ? { precoMin: min, precoMax: max } : null;
  }

  function normalizarProdutoCapturado(entrada) {
    const bruto = entrada && typeof entrada === "object" ? entrada : {};
    const faixa = temFaixaRealPreco(bruto.precoMin, bruto.precoMax);
    const temVariacaoPreco = bruto.temVariacaoPreco === true && Boolean(faixa);
    const precoAtual = temVariacaoPreco ? null : precoNumero(bruto.precoAtual);
    const precoAnterior = precoNumero(bruto.precoAnterior);
    const warnings = Array.isArray(bruto.warnings) ? bruto.warnings.map(texto).filter(Boolean) : [];
    const condicaoPrecoPor = texto(bruto.condicaoPrecoPor).toLowerCase() === "pix" ? "pix" : "";
    const produto = {
      marketplace: texto(bruto.marketplace || "mercadolivre").toLowerCase(),
      urlOriginal: urlHttp(bruto.urlOriginal || bruto.url),
      titulo: texto(bruto.titulo),
      precoAtual,
      precoAnterior,
      precoMin: faixa?.precoMin || null,
      precoMax: faixa?.precoMax || null,
      temVariacaoPreco,
      condicaoPrecoPor,
      precoPix: bruto.precoPix ?? bruto.precoAVista ?? bruto.valorPix ?? "",
      taxa: bruto.taxa ?? bruto.imposto ?? bruto.tributo ?? bruto.valorAdicional ?? "",
      frete: texto(bruto.frete || bruto.freteTexto),
      freteValor: bruto.freteValor ?? bruto.valorFrete ?? "",
      linkApp: urlHttp(bruto.linkApp || bruto.urlApp),
      linkPC: urlHttp(bruto.linkPC || bruto.urlPC),
      linkMoedas: urlHttp(bruto.linkMoedas || bruto.urlMoedas),
      linkResgate: urlHttp(bruto.linkResgate || bruto.linkResgateCupom || bruto.urlResgate),
      produtoId: texto(bruto.produtoId || bruto.productId || bruto.itemId),
      ean: texto(bruto.ean || bruto.EAN || bruto.codigoEan),
      sku: texto(bruto.sku || bruto.SKU),
      parcelamento: texto(bruto.parcelamento || bruto.parcelas),
      imagem: urlHttp(bruto.imagem),
      cupom: texto(bruto.cupom).toUpperCase(),
      observacoes: texto(bruto.observacoes),
      origem: "optimus_capture_v1",
      fonte: texto(bruto.fonte),
      precoAmbiguo: bruto.precoAmbiguo === true,
      warnings
    };

    for (const campo of ["precoPix", "taxa", "frete", "freteValor", "linkApp", "linkPC", "linkMoedas", "linkResgate", "produtoId", "ean", "sku", "parcelamento"]) {
      if (produto[campo] === "" || produto[campo] === null || produto[campo] === undefined) delete produto[campo];
    }

    if (!produto.urlOriginal) warnings.push("url_original_invalida");
    if (!produto.titulo) warnings.push("titulo_ausente");
    if (!produto.precoAtual && !produto.precoMin) warnings.push(produto.precoAmbiguo ? "preco_ambiguo" : "preco_atual_ausente");
    if (!produto.imagem) warnings.push("imagem_ausente");

    produto.descontoPercentual = descontoPercentual(produto.precoAtual, produto.precoAnterior);
    produto.completo = Boolean(produto.urlOriginal && produto.titulo && (produto.precoAtual || produto.precoMin));
    produto.requerConferencia = produto.precoAmbiguo === true || !produto.completo;
    return produto;
  }

  function payloadPreview(produto) {
    const normalizado = normalizarProdutoCapturado(produto);
    const payload = {
      marketplace: normalizado.marketplace,
      urlOriginal: normalizado.urlOriginal,
      titulo: normalizado.titulo,
      precoAtual: normalizado.temVariacaoPreco ? "" : normalizado.precoAtual,
      precoAnterior: normalizado.precoAnterior || "",
      precoMin: normalizado.precoMin || "",
      precoMax: normalizado.precoMax || "",
      temVariacaoPreco: normalizado.temVariacaoPreco,
      condicaoPrecoPor: normalizado.condicaoPrecoPor,
      imagem: normalizado.imagem,
      cupom: normalizado.cupom,
      observacoes: normalizado.observacoes,
      origem: normalizado.origem
    };
    for (const campo of ["precoPix", "taxa", "frete", "freteValor", "linkApp", "linkPC", "linkMoedas", "linkResgate", "produtoId", "ean", "sku", "parcelamento"]) {
      if (normalizado[campo] !== "" && normalizado[campo] !== null && normalizado[campo] !== undefined) payload[campo] = normalizado[campo];
    }
    return payload;
  }

  const api = {
    texto,
    precoNumero,
    urlHttp,
    descontoPercentual,
    temFaixaRealPreco,
    normalizarProdutoCapturado,
    payloadPreview
  };
  global.OptimusCaptureContract = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
