const crypto = require("crypto");

const LIMITE_TEXTO = 500;
const LIMITE_JSON = 8000;
const PREFIXOS = {
  trace: "[FIDELIDADE-V1-TRACE]",
  snapshot: "[FIDELIDADE-V1-SNAPSHOT]",
  links: "[FIDELIDADE-V1-LINKS]",
  imagem: "[FIDELIDADE-V1-IMAGEM]",
  identidade: "[FIDELIDADE-V1-IDENTIDADE]",
  preco: "[FIDELIDADE-V1-PRECO]",
  cupom: "[FIDELIDADE-V1-CUPOM]",
  template: "[FIDELIDADE-V1-TEMPLATE]",
  executor: "[FIDELIDADE-V1-EXECUTOR]"
};

function flagAtiva() {
  return ["1", "true", "sim", "yes", "on"].includes(
    String(process.env.FIDELIDADE_OBSERVABILIDADE_ENABLED || "").trim().toLowerCase()
  );
}

function texto(valor = "") {
  if (valor === null || valor === undefined) return "";
  return String(valor).trim();
}

function textoLimitado(valor = "", limite = LIMITE_TEXTO) {
  const base = texto(valor).replace(/\s+/g, " ");
  return base.length > limite ? `${base.slice(0, limite)}...` : base;
}

function hashCurto(valor = "") {
  return crypto.createHash("sha1").update(String(valor || "")).digest("hex").slice(0, 16);
}

function objeto(valor = {}) {
  return valor && typeof valor === "object" && !Array.isArray(valor) ? valor : {};
}

function primeiroTexto(...valores) {
  for (const valor of valores) {
    const item = texto(valor);
    if (item) return item;
  }
  return "";
}

function lista(valor) {
  if (!valor) return [];
  return Array.isArray(valor) ? valor : [valor];
}

function dominioUrl(url = "") {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch (_) {
    return "";
  }
}

function sanitizarUrl(url = "") {
  const valor = texto(url);
  if (!valor) return "";
  if (/^data:/i.test(valor)) return `[data-uri:${hashCurto(valor)}]`;
  if (/^blob:/i.test(valor)) return `[blob-uri:${hashCurto(valor)}]`;
  try {
    const parsed = new URL(valor);
    parsed.search = parsed.search ? "?[params]" : "";
    parsed.hash = parsed.hash ? "#[hash]" : "";
    return parsed.toString();
  } catch (_) {
    return textoLimitado(valor, 220);
  }
}

function infoImagem(valor) {
  if (!valor) return { presente: false, tipo: "ausente" };
  if (Buffer.isBuffer(valor)) {
    return { presente: true, tipo: "buffer", bytes: valor.length, hash: hashCurto(valor.toString("base64")) };
  }
  if (valor instanceof Uint8Array) {
    return { presente: true, tipo: "uint8array", bytes: valor.length, hash: hashCurto(Buffer.from(valor).toString("base64")) };
  }

  const bruto = texto(valor);
  if (!bruto) return { presente: false, tipo: "ausente" };
  if (/^data:image\//i.test(bruto)) {
    const mime = bruto.match(/^data:([^;]+);/i)?.[1] || "data:image";
    const payload = bruto.includes(",") ? bruto.slice(bruto.indexOf(",") + 1) : bruto;
    return {
      presente: true,
      tipo: "data_uri",
      mime,
      tamanhoAproximado: payload.length,
      hash: hashCurto(bruto)
    };
  }
  if (/^https?:\/\//i.test(bruto)) {
    return { presente: true, tipo: "url_http", url: sanitizarUrl(bruto), dominio: dominioUrl(bruto) };
  }
  if (/^blob:/i.test(bruto)) {
    return { presente: true, tipo: "blob_uri", hash: hashCurto(bruto) };
  }
  return { presente: true, tipo: "referencia", valor: textoLimitado(bruto, 160), hash: hashCurto(bruto) };
}

function imagemDaOferta(oferta = {}) {
  return primeiroTexto(
    oferta.imagem,
    oferta.imagemUrl,
    oferta.image,
    oferta.imageUrl,
    oferta.thumbnail,
    oferta.thumbnailUrl,
    oferta.foto,
    oferta.urlImagem,
    oferta.metadata?.produto?.imagem,
    oferta.metadata?.produto?.image,
    oferta.metadata?.produto?.imagemUrl,
    oferta.metadata?.produto?.thumbnail
  );
}

function linksDaOferta(oferta = {}) {
  const candidatos = [
    ...lista(oferta.linksOriginais),
    ...lista(oferta.linksEncontrados),
    ...lista(oferta.linksExtraidos),
    ...lista(oferta.links),
    ...lista(oferta.linksComerciais).map(item => item?.original || item?.resolvido || item?.url || ""),
    oferta.linkProdutoOriginal,
    oferta.linkProduto,
    oferta.linkOriginal,
    oferta.link,
    oferta.linkAfiliado,
    oferta.linkFinal,
    oferta.linkResgate,
    oferta.linkResgateOriginal,
    oferta.linkResgateCupom
  ].filter(Boolean);

  const vistos = new Set();
  return candidatos
    .map(item => typeof item === "string" ? item : item?.url || item?.original || item?.link || "")
    .map(texto)
    .filter(Boolean)
    .filter(item => {
      const chave = item.toLowerCase();
      if (vistos.has(chave)) return false;
      vistos.add(chave);
      return true;
    })
    .map((url, indice) => ({
      ordem: indice + 1,
      url: sanitizarUrl(url),
      dominio: dominioUrl(url)
    }));
}

function resolverFidelidadeTraceId(...fontes) {
  const candidatos = [];
  for (const fonte of fontes) {
    const item = objeto(fonte);
    candidatos.push(
      item.fidelidadeTraceId,
      item.traceId,
      item.correlationId,
      item.uuid,
      item.ofertaUuid,
      item.engineOfertaUuid,
      item.mensagemId,
      item.messageId,
      item.id ? `id:${item.id}` : "",
      item.ofertaId ? `oferta:${item.ofertaId}` : "",
      item.engineOfertaId ? `engine_oferta:${item.engineOfertaId}` : "",
      item.jobId ? `job:${item.jobId}` : "",
      item.engineJobId ? `job:${item.engineJobId}` : "",
      item.metadata?.fidelidadeTraceId,
      item.metadata?.radarMirror?.fidelidadeTraceId,
      item.metadata?.radarEspelhoComercial?.fidelidadeTraceId,
      item.key?.id ? `mensagem:${item.key.id}` : ""
    );
  }
  const explicito = candidatos.map(texto).find(Boolean);
  if (explicito) return explicito.startsWith("fid_") ? explicito : `fid_${hashCurto(explicito)}`;

  const base = fontes.map(fonte => {
    const item = objeto(fonte);
    return [
      item.clienteId || item.cliente_id,
      item.origemTipo || item.origem_tipo,
      item.grupoId || item.grupo_id,
      item.grupoNome || item.grupo_nome,
      item.capturadaEm || item.capturado_em,
      item.textoOriginal || item.texto_original || item.mensagemOriginalRadar,
      JSON.stringify(lista(item.linksExtraidos || item.linksOriginais || item.links))
    ].filter(Boolean).join("|");
  }).filter(Boolean).join("||");

  return `fid_${hashCurto(base || Date.now().toString())}`;
}

function detectarProdutoId(oferta = {}) {
  return primeiroTexto(
    oferta.produtoId,
    oferta.produtoIdOriginal,
    oferta.produtoIdConfirmado,
    oferta.produtoIdDetectado,
    oferta.itemId,
    oferta.asin,
    oferta.sku,
    oferta.shopId && oferta.itemId ? `${oferta.shopId}/${oferta.itemId}` : "",
    oferta.metadata?.produto?.produtoId,
    oferta.metadata?.produto?.itemId,
    oferta.metadata?.inteligenciaUniversalV2?.produtoIdDetectado
  );
}

function suspeitaCupomContaminado(cupom = "") {
  const valor = texto(cupom);
  if (!valor) return false;
  const normalizado = valor.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
  if (normalizado.includes("ABAIXODOPRECODOPRODUTO")) return true;
  if (/\s{2,}|\b(PRECO DO PRODUTO|RESGATE|CONFIRA|APROVEITE|ABAIXO)\b/.test(normalizado)) return true;
  return normalizado.length > 32 && !/[0-9]/.test(normalizado);
}

function montarSnapshot(etapa = "", dados = {}) {
  const oferta = objeto(dados.oferta || dados.itemFila || dados.resultado || dados);
  const imagemInfo = infoImagem(dados.imagem ?? imagemDaOferta(oferta));
  const links = Array.isArray(dados.linksEncontrados)
    ? dados.linksEncontrados.map((url, indice) => ({ ordem: indice + 1, url: sanitizarUrl(url), dominio: dominioUrl(url) }))
    : linksDaOferta(oferta);

  return {
    fidelidadeTraceId: resolverFidelidadeTraceId(dados, oferta, dados.evento, dados.job, dados.raw),
    etapa,
    ofertaId: primeiroTexto(dados.ofertaId, oferta.id, oferta.ofertaId, oferta.engineOfertaId),
    mensagemId: primeiroTexto(dados.mensagemId, dados.raw?.key?.id, oferta.mensagemId),
    clienteId: primeiroTexto(dados.clienteId, oferta.clienteId, oferta.cliente_id),
    marketplace: primeiroTexto(dados.marketplace, oferta.marketplace, oferta.mercado, oferta.loja),
    titulo: textoLimitado(primeiroTexto(dados.titulo, oferta.titulo, oferta.nome), 220),
    preco: primeiroTexto(dados.preco, oferta.preco),
    precoOriginal: primeiroTexto(dados.precoOriginal, oferta.precoOriginal, oferta.precoAntigo, oferta.precoDe),
    precoAtual: primeiroTexto(dados.precoAtual, oferta.precoAtual, oferta.precoPor),
    cupom: primeiroTexto(dados.cupom, oferta.cupom, oferta.codigoCupom),
    linksEncontrados: links,
    linkProduto: sanitizarUrl(primeiroTexto(dados.linkProduto, oferta.linkProduto, oferta.linkProdutoOriginal, oferta.linkOriginal, oferta.link)),
    linkAfiliado: sanitizarUrl(primeiroTexto(dados.linkAfiliado, oferta.linkAfiliado, oferta.linkFinal)),
    linkResgate: sanitizarUrl(primeiroTexto(dados.linkResgate, oferta.linkResgate, oferta.linkResgateOriginal, oferta.linkResgateCupom)),
    imagemPresente: imagemInfo.presente,
    imagemTipo: imagemInfo.tipo,
    imagemOrigem: primeiroTexto(dados.imagemOrigem, oferta.imagemOrigem, oferta.origemImagem),
    produtoId: primeiroTexto(dados.produtoId, detectarProdutoId(oferta)),
    identidadeStatusObservado: primeiroTexto(dados.identidadeStatusObservado, oferta.identidadeStatus, oferta.metadata?.inteligenciaUniversalV2?.status),
    observacoes: textoLimitado(dados.observacoes || dados.motivo || ""),
    registradoEm: new Date().toISOString()
  };
}

function sanitizarValor(valor, profundidade = 0, visitados = new WeakSet()) {
  if (valor === null || valor === undefined) return valor;
  if (profundidade > 4) return "[limite_profundidade]";
  if (Buffer.isBuffer(valor) || valor instanceof Uint8Array) return infoImagem(valor);
  if (typeof valor === "string") {
    if (/^data:image\//i.test(valor) || /^blob:/i.test(valor)) return infoImagem(valor);
    if (/https?:\/\//i.test(valor)) return sanitizarUrl(valor);
    return textoLimitado(valor);
  }
  if (Array.isArray(valor)) return valor.slice(0, 30).map(item => sanitizarValor(item, profundidade + 1, visitados));
  if (typeof valor === "object") {
    if (visitados.has(valor)) return "[circular]";
    visitados.add(valor);
    const saida = {};
    for (const [chave, item] of Object.entries(valor).slice(0, 80)) {
      if (/token|secret|senha|password|authorization|cookie/i.test(chave)) {
        saida[chave] = "[redigido]";
        continue;
      }
      saida[chave] = sanitizarValor(item, profundidade + 1, visitados);
    }
    return saida;
  }
  return valor;
}

function emitir(tipo, payload = {}) {
  if (!flagAtiva()) return false;
  try {
    const prefixo = PREFIXOS[tipo] || PREFIXOS.snapshot;
    const sanitizado = sanitizarValor(payload);
    let json = JSON.stringify(sanitizado);
    if (json.length > LIMITE_JSON) {
      json = JSON.stringify({
        fidelidadeTraceId: sanitizado.fidelidadeTraceId,
        etapa: sanitizado.etapa,
        truncado: true,
        tamanhoOriginal: json.length,
        resumo: textoLimitado(json, LIMITE_JSON - 400)
      });
    }
    console.log(prefixo, json);
    return true;
  } catch (erro) {
    try {
      console.log(PREFIXOS.trace, JSON.stringify({
        etapa: "observabilidade_erro",
        erro: textoLimitado(erro?.message || erro || "erro_observabilidade")
      }));
    } catch (_) {}
    return false;
  }
}

function registrarSnapshot(etapa, dados = {}) {
  if (!flagAtiva()) return false;
  return emitir("snapshot", montarSnapshot(etapa, dados));
}

function registrarTrace(etapa, dados = {}) {
  if (!flagAtiva()) return false;
  return emitir("trace", {
    ...montarSnapshot(etapa, dados),
    evento: "trace"
  });
}

function registrarLinks(etapa, dados = {}) {
  if (!flagAtiva()) return false;
  const oferta = objeto(dados.oferta || dados);
  const links = linksDaOferta({ ...oferta, linksExtraidos: dados.links || oferta.linksExtraidos });
  return emitir("links", {
    fidelidadeTraceId: resolverFidelidadeTraceId(dados, oferta),
    etapa,
    totalLinks: links.length,
    links,
    linkProduto: sanitizarUrl(primeiroTexto(dados.linkProduto, oferta.linkProduto, oferta.linkProdutoOriginal, oferta.linkOriginal, oferta.link)),
    linkAfiliado: sanitizarUrl(primeiroTexto(dados.linkAfiliado, oferta.linkAfiliado, oferta.linkFinal)),
    linkResgate: sanitizarUrl(primeiroTexto(dados.linkResgate, oferta.linkResgate, oferta.linkResgateOriginal, oferta.linkResgateCupom)),
    descartado: textoLimitado(dados.descartado || ""),
    motivoDescarte: textoLimitado(dados.motivoDescarte || ""),
    registradoEm: new Date().toISOString()
  });
}

function registrarImagem(etapa, dados = {}) {
  if (!flagAtiva()) return false;
  const oferta = objeto(dados.oferta || dados);
  const imagemInfo = infoImagem(dados.imagem ?? imagemDaOferta(oferta));
  const status = dados.status || (
    imagemInfo.tipo === "data_uri" ? "data_uri_presente" :
      imagemInfo.tipo === "url_http" ? "URL_http_presente" :
        imagemInfo.presente ? "presente_na_origem" : "motivo_nao_determinado"
  );
  return emitir("imagem", {
    fidelidadeTraceId: resolverFidelidadeTraceId(dados, oferta),
    etapa,
    status,
    imagem: imagemInfo,
    imagemOrigem: primeiroTexto(dados.imagemOrigem, oferta.imagemOrigem, oferta.origemImagem),
    jpegThumbnailPresente: dados.jpegThumbnailPresente === true,
    caiuParaTexto: dados.caiuParaTexto === true,
    motivo: textoLimitado(dados.motivo || ""),
    registradoEm: new Date().toISOString()
  });
}

function registrarIdentidade(etapa, dados = {}) {
  if (!flagAtiva()) return false;
  const oferta = objeto(dados.oferta || dados);
  const marketplaceInicial = primeiroTexto(dados.marketplaceInicial, oferta.marketplaceDetectado, oferta.marketplaceOriginalRadar);
  const marketplaceFinal = primeiroTexto(dados.marketplaceFinal, oferta.marketplace, oferta.mercado);
  const produtoIdOriginal = primeiroTexto(dados.produtoIdOriginal, oferta.produtoIdOriginal, oferta.produtoIdDetectado);
  const produtoIdImportado = primeiroTexto(dados.produtoIdImportado, detectarProdutoId(oferta));
  return emitir("identidade", {
    fidelidadeTraceId: resolverFidelidadeTraceId(dados, oferta),
    etapa,
    marketplaceInicial,
    marketplaceImportador: primeiroTexto(dados.marketplaceImportador, oferta.marketplaceImportador),
    marketplaceFinal,
    urlOriginal: sanitizarUrl(primeiroTexto(dados.urlOriginal, oferta.linkOriginal, oferta.urlOriginal)),
    produtoIdOriginal,
    produtoIdImportado,
    divergenciaObservada: Boolean(
      (marketplaceInicial && marketplaceFinal && marketplaceInicial !== marketplaceFinal) ||
      (produtoIdOriginal && produtoIdImportado && produtoIdOriginal !== produtoIdImportado)
    ),
    buscaTituloUtilizada: dados.buscaTituloUtilizada === true,
    conversaoUrlUtilizada: dados.conversaoUrlUtilizada === true,
    registradoEm: new Date().toISOString()
  });
}

function registrarPreco(etapa, dados = {}) {
  if (!flagAtiva()) return false;
  const oferta = objeto(dados.oferta || dados);
  return emitir("preco", {
    fidelidadeTraceId: resolverFidelidadeTraceId(dados, oferta),
    etapa,
    textoComercial: textoLimitado(primeiroTexto(dados.textoComercial, oferta.textoComercialOriginal, oferta.mensagemOriginalRadar), 500),
    precoDe: primeiroTexto(dados.precoDe, oferta.precoDe, oferta.precoOriginal, oferta.precoAntigo),
    precoPor: primeiroTexto(dados.precoPor, oferta.precoPor, oferta.precoAtual, oferta.preco),
    pix: primeiroTexto(dados.pix, oferta.condicaoPix, oferta.precoPix),
    parcelamento: primeiroTexto(dados.parcelamento, oferta.parcelamento),
    quantidadeParcelas: primeiroTexto(dados.quantidadeParcelas, oferta.quantidadeParcelas),
    valorParcela: primeiroTexto(dados.valorParcela, oferta.valorParcela),
    precoImportador: primeiroTexto(dados.precoImportador),
    precoTemplate: primeiroTexto(dados.precoTemplate),
    registradoEm: new Date().toISOString()
  });
}

function registrarCupom(etapa, dados = {}) {
  if (!flagAtiva()) return false;
  const oferta = objeto(dados.oferta || dados);
  const cupom = primeiroTexto(dados.cupom, oferta.cupom, oferta.codigoCupom);
  return emitir("cupom", {
    fidelidadeTraceId: resolverFidelidadeTraceId(dados, oferta),
    etapa,
    textoOriginal: textoLimitado(primeiroTexto(dados.textoOriginal, oferta.mensagemOriginalRadar, oferta.textoComercialOriginal), 500),
    candidatoCodigo: cupom,
    instrucao: primeiroTexto(dados.instrucao, oferta.instrucaoCupom, oferta.condicaoCupom, oferta.condicaoComercial, oferta.avisoCupom),
    desconto: primeiroTexto(dados.desconto, oferta.descontoTexto, oferta.descontoCupom, oferta.beneficioExtra),
    linkResgate: sanitizarUrl(primeiroTexto(dados.linkResgate, oferta.linkResgate, oferta.linkResgateOriginal, oferta.linkResgateCupom)),
    possivelContaminacao: suspeitaCupomContaminado(cupom),
    produzidoPor: textoLimitado(dados.produzidoPor || ""),
    registradoEm: new Date().toISOString()
  });
}

function registrarTemplate(etapa, dados = {}) {
  if (!flagAtiva()) return false;
  const oferta = objeto(dados.oferta || dados);
  return emitir("template", {
    ...montarSnapshot(etapa, dados),
    templateTipo: dados.templateTipo || "",
    camposDisponiveis: Object.keys(oferta).slice(0, 80),
    numeroLinks: linksDaOferta(oferta).length,
    saidaTexto: textoLimitado(dados.saidaTexto || dados.mensagem || "", 1000)
  });
}

function registrarExecutor(etapa, dados = {}) {
  if (!flagAtiva()) return false;
  const oferta = objeto(dados.oferta || dados);
  const imagemInfo = infoImagem(dados.imagem ?? imagemDaOferta(oferta));
  return emitir("executor", {
    ...montarSnapshot(etapa, dados),
    canal: dados.canal || "",
    destino: textoLimitado(dados.destino || ""),
    tipoMidia: dados.tipoMidia || "",
    imagemRecebida: imagemInfo,
    tentativaImagem: dados.tentativaImagem === true,
    caiuParaTexto: dados.caiuParaTexto === true,
    motivoTecnico: textoLimitado(dados.motivoTecnico || ""),
    erro: textoLimitado(dados.erro || ""),
    resultado: textoLimitado(dados.resultado || "")
  });
}

module.exports = {
  flagAtiva,
  resolverFidelidadeTraceId,
  montarSnapshot,
  infoImagem,
  linksDaOferta,
  suspeitaCupomContaminado,
  registrarTrace,
  registrarSnapshot,
  registrarLinks,
  registrarImagem,
  registrarIdentidade,
  registrarPreco,
  registrarCupom,
  registrarTemplate,
  registrarExecutor
};
