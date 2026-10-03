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

  function descontoPercentual(valor) {
    const bruto = texto(valor).replace("%", "").replace(",", ".");
    const numero = Number(bruto);
    return Number.isFinite(numero) && numero > 0 && numero <= 100 ? numero : null;
  }

  function descontoPercentualOrigem(valor) {
    const origem = texto(valor).toLowerCase();
    return ["marketplace", "manual"].includes(origem) ? origem : "";
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
    const origemDesconto = descontoPercentualOrigem(bruto.descontoPercentualOrigem);
    const desconto = origemDesconto ? descontoPercentual(bruto.descontoPercentual) : null;
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
      observacoes: texto(bruto.observacoes || bruto.opcao),
      descontoPercentual: desconto,
      descontoPercentualOrigem: desconto ? origemDesconto : "",
      origem: "optimus_capture_v1",
      fonte: texto(bruto.fonte),
      precoAmbiguo: bruto.precoAmbiguo === true,
      warnings
    };

    if (produto.marketplace === "magalu") {
      if (normalizadoOpcional(bruto.categoria || bruto.categoriaProduto)) produto.categoria = texto(bruto.categoria || bruto.categoriaProduto);
      if (normalizadoOpcional(bruto.seller || bruto.vendedor || bruto.loja || bruto.store)) produto.seller = texto(bruto.seller || bruto.vendedor || bruto.loja || bruto.store);
      if (normalizadoOpcional(bruto.avaliacao ?? bruto.rating)) produto.avaliacao = bruto.avaliacao ?? bruto.rating;
      if (normalizadoOpcional(bruto.quantidadeAvaliacoes ?? bruto.avaliacoes ?? bruto.reviewCount)) produto.quantidadeAvaliacoes = bruto.quantidadeAvaliacoes ?? bruto.avaliacoes ?? bruto.reviewCount;
      if (normalizadoOpcional(bruto.vendidos ?? bruto.quantidadeVendida ?? bruto.soldCount)) produto.vendidos = bruto.vendidos ?? bruto.quantidadeVendida ?? bruto.soldCount;
      if (normalizadoOpcional(bruto.condicaoPix)) produto.condicaoPix = texto(bruto.condicaoPix);
      if (normalizadoOpcional(bruto.imposto)) produto.imposto = bruto.imposto;
      if (normalizadoOpcional(bruto.moedas || bruto.coins)) produto.moedas = texto(bruto.moedas || bruto.coins);
      if (normalizadoOpcional(bruto.instrucaoCupom || bruto.cupomInstrucao || bruto.avisoCupom)) produto.instrucaoCupom = texto(bruto.instrucaoCupom || bruto.cupomInstrucao || bruto.avisoCupom);
      if (normalizadoOpcional(bruto.beneficioTexto || bruto.beneficio)) produto.beneficioTexto = texto(bruto.beneficioTexto || bruto.beneficio);
    }

    for (const campo of ["precoPix", "taxa", "frete", "freteValor", "linkApp", "linkPC", "linkMoedas", "linkResgate", "produtoId", "ean", "sku", "parcelamento"]) {
      if (produto[campo] === "" || produto[campo] === null || produto[campo] === undefined) delete produto[campo];
    }

    if (!produto.urlOriginal) warnings.push("url_original_invalida");
    if (!produto.titulo) warnings.push("titulo_ausente");
    if (!produto.precoAtual && !produto.precoMin) warnings.push(produto.precoAmbiguo ? "preco_ambiguo" : "preco_atual_ausente");
    if (!produto.imagem) warnings.push("imagem_ausente");

    produto.completo = Boolean(produto.urlOriginal && produto.titulo && (produto.precoAtual || produto.precoMin));
    produto.requerConferencia = produto.precoAmbiguo === true || !produto.completo;
    return produto;
  }

  function normalizadoOpcional(valor) {
    return valor !== "" && valor !== null && valor !== undefined;
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
    for (const campo of ["precoPix", "taxa", "frete", "freteValor", "linkApp", "linkPC", "linkMoedas", "linkResgate", "produtoId", "ean", "sku", "parcelamento", "descontoPercentual", "descontoPercentualOrigem"]) {
      if (normalizado[campo] !== "" && normalizado[campo] !== null && normalizado[campo] !== undefined) payload[campo] = normalizado[campo];
    }
    if (normalizado.marketplace === "magalu") {
      for (const campo of ["categoria", "seller", "avaliacao", "quantidadeAvaliacoes", "vendidos", "condicaoPix", "imposto", "moedas", "instrucaoCupom", "beneficioTexto"]) {
        if (normalizado[campo] !== "" && normalizado[campo] !== null && normalizado[campo] !== undefined) payload[campo] = normalizado[campo];
      }
    }
    return payload;
  }

  const api = {
    texto,
    precoNumero,
    urlHttp,
    descontoPercentual,
    descontoPercentualOrigem,
    temFaixaRealPreco,
    normalizarProdutoCapturado,
    payloadPreview
  };
  global.OptimusCaptureContract = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
