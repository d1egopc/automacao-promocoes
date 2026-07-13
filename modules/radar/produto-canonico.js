function texto(valor = "") {
  return String(valor || "").trim();
}

function normalizarProdutoIdCanonico(valor = "") {
  const produtoId = texto(valor).match(/\d{3,20}/)?.[0] || "";
  return produtoId || "";
}

function hostnameSeguro(url = "") {
  try {
    return new URL(texto(url)).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function decodificarParametroUrl(valor = "") {
  let resultado = texto(valor);
  for (let tentativa = 0; tentativa < 3 && /%[0-9a-f]{2}/i.test(resultado); tentativa += 1) {
    try {
      const decodificado = decodeURIComponent(resultado);
      if (decodificado === resultado) break;
      resultado = decodificado;
    } catch {
      break;
    }
  }
  return resultado;
}

function extrairProdutoIdKabumUrl(url = "") {
  try {
    const parsed = new URL(texto(url));
    const host = hostnameSeguro(parsed.toString());

    if (host === "awin1.com" || host.endsWith(".awin1.com") || host === "awin.com" || host.endsWith(".awin.com")) {
      return extrairProdutoIdKabumUrl(decodificarParametroUrl(parsed.searchParams.get("ued") || ""));
    }

    if (!host.endsWith("kabum.com.br")) return "";
    return normalizarProdutoIdCanonico(parsed.pathname.match(/\/produto\/(\d+)/i)?.[1] || "");
  } catch {
    return "";
  }
}

function identidadePorProdutoId(produtoId = "", origemDominio = "") {
  const produtoIdCanonico = normalizarProdutoIdCanonico(produtoId);
  if (!produtoIdCanonico) return null;

  return {
    marketplaceCanonico: "kabum",
    marketplaceProduto: "kabum",
    produtoIdCanonico,
    produtoId: produtoIdCanonico,
    chaveCanonica: `kabum:${produtoIdCanonico}`,
    origemDominio: origemDominio || ""
  };
}

function resolverIdentidadeCanonicaOferta(entrada = {}) {
  const chaveEntrada = texto(entrada.chaveCanonica);
  const produtoEntradaChave = chaveEntrada.match(/^kabum:(\d{3,20})$/i)?.[1] || "";
  if (produtoEntradaChave) {
    return identidadePorProdutoId(produtoEntradaChave, entrada.origemDominio || hostnameSeguro(entrada.urlFinal || entrada.urlOriginal || ""));
  }

  const diagnostico = entrada.diagnosticoRedirect || entrada.diagnosticoAwinKabum || entrada.identidadeCanonica || {};
  const chaveDiagnostico = texto(diagnostico.chaveCanonica);
  const produtoDiagnostico = normalizarProdutoIdCanonico(diagnostico.produtoIdCanonico || diagnostico.produtoId);

  if (produtoDiagnostico && chaveDiagnostico === `kabum:${produtoDiagnostico}`) {
    return identidadePorProdutoId(produtoDiagnostico, diagnostico.origemDominio || hostnameSeguro(diagnostico.urlDestino || ""));
  }

  const produtoDireto = normalizarProdutoIdCanonico(
    entrada.produtoIdCanonico ||
    entrada.produtoId ||
    entrada.idProdutoKabum ||
    entrada.kabumProdutoId
  );
  if (produtoDireto) {
    return identidadePorProdutoId(produtoDireto, hostnameSeguro(entrada.urlFinal || entrada.urlOriginal || ""));
  }

  const urls = [
    entrada.urlFinal,
    entrada.urlResolvida,
    entrada.linkResolvido,
    entrada.linkOriginal,
    entrada.urlOriginal,
    entrada.linkOriginalRadar,
    entrada.linkCapturado,
    entrada.linkAfiliado,
    entrada.linkFinal,
    entrada.link
  ].filter(Boolean);

  for (const url of urls) {
    const produtoId = extrairProdutoIdKabumUrl(url);
    if (produtoId) {
      return identidadePorProdutoId(produtoId, hostnameSeguro(url));
    }
  }

  return {
    marketplaceCanonico: "",
    marketplaceProduto: "",
    produtoIdCanonico: "",
    produtoId: "",
    chaveCanonica: "",
    origemDominio: ""
  };
}

function camposIdentidadeCanonicaOferta(entrada = {}) {
  const identidade = entrada.chaveCanonica ? entrada : resolverIdentidadeCanonicaOferta(entrada);
  if (!identidade?.chaveCanonica) return {};

  return {
    chaveCanonica: identidade.chaveCanonica,
    produtoId: identidade.produtoIdCanonico,
    produtoIdCanonico: identidade.produtoIdCanonico,
    marketplaceCanonico: identidade.marketplaceCanonico,
    marketplaceProduto: identidade.marketplaceProduto,
    identidadeCanonica: {
      marketplaceCanonico: identidade.marketplaceCanonico,
      marketplaceProduto: identidade.marketplaceProduto,
      produtoIdCanonico: identidade.produtoIdCanonico,
      chaveCanonica: identidade.chaveCanonica
    }
  };
}

function compararIdentidadeCanonicaOfertas(ofertaNova = {}, ofertaExistente = {}) {
  const nova = resolverIdentidadeCanonicaOferta(ofertaNova);
  const existente = resolverIdentidadeCanonicaOferta(ofertaExistente);

  if (!nova.chaveCanonica || !existente.chaveCanonica) {
    return {
      duplicada: false,
      motivo: "",
      ambasCanonicas: false,
      chaveNova: nova.chaveCanonica || "",
      chaveExistente: existente.chaveCanonica || ""
    };
  }

  if (nova.chaveCanonica === existente.chaveCanonica) {
    return {
      duplicada: true,
      motivo: "mesma_chave_canonica",
      ambasCanonicas: true,
      chaveCanonica: nova.chaveCanonica,
      chaveNova: nova.chaveCanonica,
      chaveExistente: existente.chaveCanonica
    };
  }

  return {
    duplicada: false,
    motivo: "chave_canonica_diferente",
    ambasCanonicas: true,
    chaveNova: nova.chaveCanonica,
    chaveExistente: existente.chaveCanonica
  };
}

function origemDominioCanonicoOferta(oferta = {}) {
  return hostnameSeguro(
    oferta.urlOriginal ||
    oferta.linkOriginalRadar ||
    oferta.linkCapturado ||
    oferta.linkOriginal ||
    oferta.urlFinal ||
    oferta.urlResolvida ||
    oferta.linkResolvido ||
    oferta.linkAfiliado ||
    oferta.linkFinal ||
    oferta.link ||
    ""
  );
}

module.exports = {
  camposIdentidadeCanonicaOferta,
  compararIdentidadeCanonicaOfertas,
  extrairProdutoIdKabumUrl,
  hostnameSeguro,
  normalizarProdutoIdCanonico,
  origemDominioCanonicoOferta,
  resolverIdentidadeCanonicaOferta
};
