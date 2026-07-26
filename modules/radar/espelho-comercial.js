const {
  resolverPrecedenciaComercialRadar,
  resumirPrecedenciaComercialLog
} = require("./comercial-precedencia");
const {
  mergeRadarMirrorMetadata
} = require("./radar-mirror");

function texto(valor = "") {
  return String(valor ?? "").trim();
}

function objeto(valor = {}) {
  return valor && typeof valor === "object" && !Array.isArray(valor) ? valor : {};
}

function primeiroTexto(...valores) {
  for (const valor of valores) {
    const limpo = texto(valor);
    if (limpo) return limpo;
  }
  return "";
}

function copiarCampoSePresente(destino, origem, campo, alias = campo) {
  const valor = origem?.[campo];
  if (valor === null || valor === undefined || valor === "") return;
  destino[alias] = valor;
}

function listaTextoUnica(valores = []) {
  const resultado = [];
  const vistos = new Set();

  for (const valor of Array.isArray(valores) ? valores : []) {
    const item = texto(valor);
    if (!item || vistos.has(item)) continue;
    vistos.add(item);
    resultado.push(item);
  }

  return resultado;
}

function adicionarLinkComercial(lista, entrada = {}) {
  const original = primeiroTexto(entrada.original, entrada.link, entrada.url);
  const resolvido = primeiroTexto(entrada.resolvido, entrada.urlResolvida, original);
  const afiliado = primeiroTexto(entrada.afiliado, entrada.linkAfiliado);
  if (!original && !resolvido && !afiliado) return;

  const chave = `${texto(entrada.tipo || "produto")}|${original || resolvido || afiliado}`;
  if (lista.some(item => `${item.tipo}|${item.original || item.resolvido || item.afiliado}` === chave)) return;

  lista.push({
    tipo: texto(entrada.tipo || "produto"),
    original: original || resolvido || afiliado,
    resolvido: resolvido || original || afiliado,
    afiliado,
    marketplace: texto(entrada.marketplace || ""),
    status: texto(entrada.status || (afiliado ? "convertido" : "pendente_conversao"))
  });
}

function montarLinksComerciaisEspelho(radarMirror = {}, resolucao = {}, tecnicaImportador = {}, marketplace = "") {
  const links = [];
  const mp = texto(marketplace || tecnicaImportador.marketplace || "");
  const mirrorLinks = radarMirror?.links || {};
  const comerciais = radarMirror?.comercial?.links || {};

  adicionarLinkComercial(links, {
    tipo: "produto",
    original: mirrorLinks.produtoOriginal || comerciais.produto || resolucao.urlCapturada || resolucao.linkOriginalRadar,
    resolvido: resolucao.linkOriginalLimpo || resolucao.linkResolvido || resolucao.urlResolvida || tecnicaImportador.linkResolvido,
    marketplace: mp
  });

  adicionarLinkComercial(links, {
    tipo: "resgate",
    original: mirrorLinks.resgateCupom || comerciais.resgate || comerciais.cupom,
    marketplace: mp
  });

  const classificados = [
    ...(Array.isArray(comerciais.classificados) ? comerciais.classificados : []),
    ...(Array.isArray(mirrorLinks.classificados) ? mirrorLinks.classificados : [])
  ];

  for (const item of classificados) {
    adicionarLinkComercial(links, {
      tipo: item.tipo || "produto",
      original: item.link,
      resolvido: item.resolvido,
      afiliado: item.afiliado,
      marketplace: item.marketplace || mp,
      status: item.status
    });
  }

  for (const link of Array.isArray(mirrorLinks.adicionais) ? mirrorLinks.adicionais : []) {
    adicionarLinkComercial(links, { tipo: "adicional", original: link, marketplace: mp });
  }

  return links;
}

function camposComerciaisEspelho({ radarMirror = {}, resultadoPrecedencia = {}, resolucao = {}, tecnicaImportador = {}, marketplace = "" } = {}) {
  const oferta = objeto(resultadoPrecedencia.oferta);
  const comercial = objeto(radarMirror?.comercial);
  const produto = objeto(radarMirror?.produto);
  const condicoes = objeto(resultadoPrecedencia.resolucao?.condicoesComerciais);
  const textoCanonico = documentoComercialCanonico(radarMirror);
  const linksComerciais = montarLinksComerciaisEspelho(radarMirror, resolucao, tecnicaImportador, marketplace);
  const cupons = Array.isArray(oferta.codigosCupom)
    ? oferta.codigosCupom
    : (Array.isArray(resultadoPrecedencia.resolucao?.cuponsRadar) ? resultadoPrecedencia.resolucao.cuponsRadar : []);
  const condicoesEspeciais = listaTextoUnica([
    ...(Array.isArray(comercial.condicoesEspeciais) ? comercial.condicoesEspeciais : []),
    radarMirror?.preco?.condicaoTexto,
    condicoes.pix?.evidencia,
    condicoes.parcelamento?.evidencia
  ]);
  const observacoes = listaTextoUnica([
    ...(Array.isArray(comercial.observacoes) ? comercial.observacoes : []),
    produto.variacaoCapturada,
    produto.quantidadeCapturada
  ]);

  return {
    textoComercialCanonico: textoCanonico,
    documentoComercialCanonico: textoCanonico,
    textoComercialOriginal: texto(radarMirror?.texto?.original || textoCanonico),
    titulo: oferta.titulo || produto.tituloCapturado || "",
    nome: oferta.nome || oferta.titulo || produto.tituloCapturado || "",
    descricao: texto(comercial.descricao?.valor || radarMirror?.texto?.limpo || ""),
    preco: oferta.preco,
    precoAtual: oferta.precoAtual,
    precoAnterior: oferta.precoAnterior ?? oferta.precoOriginal,
    precoOriginal: oferta.precoOriginal ?? oferta.precoAnterior,
    precoPix: oferta.precoPix || "",
    condicaoPix: oferta.condicaoPix || oferta.precoPix || "",
    precoUnitario: oferta.precoUnitario || "",
    quantidade: produto.quantidadeCapturada || comercial.quantidade?.valor || "",
    parcelamento: oferta.parcelamento || "",
    quantidadeParcelas: condicoes.parcelamento?.quantidade || "",
    valorParcela: condicoes.parcelamento?.valorParcela || "",
    cupom: oferta.cupom || "",
    codigoCupom: oferta.codigoCupom || oferta.cupom || "",
    cupons: Array.isArray(cupons) ? [...cupons] : [],
    codigosCupom: Array.isArray(cupons) ? [...cupons] : [],
    instrucaoCupom: oferta.instrucaoCupom ||
      resultadoPrecedencia.resolucao?.instrucaoCupom ||
      radarMirror?.comercial?.cupom?.instrucao ||
      radarMirror?.cupom?.condicaoCapturada ||
      "",
    beneficioExtra: oferta.beneficioExtra || "",
    beneficios: listaTextoUnica([
      ...(Array.isArray(oferta.beneficios) ? oferta.beneficios : []),
      ...(Array.isArray(comercial.beneficios) ? comercial.beneficios : []),
      ...(Array.isArray(comercial.brindes) ? comercial.brindes : []),
      oferta.beneficioExtra,
      oferta.avisoCupom
    ]),
    condicoes: condicoesEspeciais,
    observacoes,
    cashback: oferta.cashback || condicoes.cashback?.evidencia || "",
    frete: oferta.frete || "",
    freteGratis: oferta.freteGratis === true || condicoes.freteGratis?.valor === true,
    variantes: listaTextoUnica([
      ...(Array.isArray(comercial.variantes) ? comercial.variantes : []),
      produto.variacaoCapturada
    ]),
    tamanhos: listaTextoUnica(Array.isArray(comercial.tamanhos) ? comercial.tamanhos : []),
    cores: listaTextoUnica(Array.isArray(comercial.cores) ? comercial.cores : []),
    voltagem: texto(comercial.voltagem?.valor || comercial.voltagem || ""),
    ofertaRelampago: comercial.ofertaRelampago?.valor === true || radarMirror?.texto?.limpo?.toLowerCase().includes("oferta relampago") === true,
    validade: texto(comercial.validade?.evidencia || comercial.validade?.valor || ""),
    linksComerciais,
    linksProduto: linksComerciais.filter(item => item.tipo === "produto"),
    linksResgate: linksComerciais.filter(item => ["resgate", "cupom"].includes(item.tipo)),
    marketplace: oferta.marketplace || marketplace || tecnicaImportador.marketplace || "",
    produtoId: oferta.produtoId || tecnicaImportador.produtoId || tecnicaImportador.idProduto || tecnicaImportador.itemId || "",
    categoria: oferta.categoria || tecnicaImportador.categoria || ""
  };
}

function aplicarContratoComercialRadar(oferta = {}, contrato = null) {
  const origem = contrato || oferta.metadata?.radarEspelhoComercial?.contratoComercial || {};
  if (!origem || typeof origem !== "object") return oferta;
  const proxima = { ...oferta };

  for (const [campo, valor] of Object.entries(origem)) {
    if (valor === null || valor === undefined || valor === "") continue;
    if (Array.isArray(valor)) {
      proxima[campo] = valor.map(item => item && typeof item === "object" ? { ...item } : item);
      continue;
    }
    if (valor && typeof valor === "object") {
      proxima[campo] = { ...valor };
      continue;
    }
    proxima[campo] = valor;
  }

  proxima.metadata = {
    ...(oferta.metadata && typeof oferta.metadata === "object" ? oferta.metadata : {}),
    radarEspelhoComercial: {
      ...(oferta.metadata?.radarEspelhoComercial || {}),
      contratoComercial: {
        ...(origem || {})
      }
    }
  };

  return proxima;
}

function aplicarAfiliadoLinkComercialRadar(oferta = {}, { original = "", resolvido = "", afiliado = "", status = "convertido" } = {}) {
  const alvoOriginal = texto(original);
  const alvoResolvido = texto(resolvido || original);
  const linkAfiliado = texto(afiliado);
  if (!linkAfiliado || !Array.isArray(oferta.linksComerciais)) return oferta;

  const linksComerciais = oferta.linksComerciais.map(item => {
    const linkOriginal = texto(item.original);
    const linkResolvido = texto(item.resolvido);
    const mesmoLink = [linkOriginal, linkResolvido].filter(Boolean).some(link =>
      link === alvoOriginal || link === alvoResolvido
    );
    return mesmoLink
      ? { ...item, afiliado: linkAfiliado, status }
      : { ...item };
  });

  const proxima = {
    ...oferta,
    linksComerciais,
    linksProduto: linksComerciais.filter(item => item.tipo === "produto"),
    linksResgate: linksComerciais.filter(item => ["resgate", "cupom"].includes(item.tipo))
  };

  return aplicarContratoComercialRadar(proxima, {
    ...(proxima.metadata?.radarEspelhoComercial?.contratoComercial || {}),
    linksComerciais: proxima.linksComerciais,
    linksProduto: proxima.linksProduto,
    linksResgate: proxima.linksResgate
  });
}

function metadataProdutoTecnica(metadata = {}) {
  const produto = objeto(metadata.produto);
  const tecnico = {};

  for (const campo of [
    "produtoId",
    "idProduto",
    "itemId",
    "asin",
    "sku",
    "shopId",
    "sellerId",
    "permalink",
    "urlFinal",
    "imagemCandidatos"
  ]) {
    copiarCampoSePresente(tecnico, produto, campo);
  }

  return Object.keys(tecnico).length ? { produto: tecnico } : {};
}

function extrairDadosTecnicosImportador(ofertaImportador = {}) {
  const origem = objeto(ofertaImportador);
  const metadataTecnica = metadataProdutoTecnica(objeto(origem.metadata));
  const tecnico = {
    metadata: metadataTecnica
  };

  for (const campo of [
    "marketplace",
    "marketplaceOriginalRadar",
    "categoria",
    "categoriaProduto",
    "produtoId",
    "idProduto",
    "itemId",
    "asin",
    "sku",
    "shopId",
    "sellerId",
    "permalink",
    "urlFinal",
    "linkResolvido",
    "linkResolvidoRadar",
    "produtoIdDetectado",
    "imagem",
    "imagemUrl",
    "image",
    "imageUrl",
    "thumbnail",
    "thumbnailUrl",
    "pictures",
    "images",
    "imagens",
    "imagemOrigem",
    "imagemStatus",
    "imagemConfianca"
  ]) {
    copiarCampoSePresente(tecnico, origem, campo);
  }

  return tecnico;
}

function documentoComercialCanonico(radarMirror = {}) {
  return primeiroTexto(
    radarMirror?.texto?.limpo,
    radarMirror?.texto?.original
  );
}

function radarMirrorPossuiTitulo(radarMirror = {}) {
  return Boolean(texto(radarMirror?.produto?.tituloCapturado));
}

function radarMirrorPossuiPreco(radarMirror = {}) {
  return radarMirror?.preco?.atualCapturado !== null &&
    radarMirror?.preco?.atualCapturado !== undefined &&
    radarMirror?.preco?.atualCapturado !== "";
}

function espelhoComercialRadarSuficiente(radarMirror = {}) {
  return radarMirrorPossuiTitulo(radarMirror) && radarMirrorPossuiPreco(radarMirror);
}

function motivoImportadorIgnoravelPeloEspelho(motivo = "", radarMirror = {}) {
  const chave = texto(motivo);
  if (!chave) return true;
  if (!espelhoComercialRadarSuficiente(radarMirror)) return false;

  return [
    "importacao_sem_titulo",
    "importacao_sem_preco",
    "importacao_sem_categoria",
    "importacao_incompleta"
  ].includes(chave);
}

function montarOfertaRadarEspelhoComercial({
  radarMirror = null,
  ofertaImportador = {},
  metadata = {},
  clienteId = "",
  marketplace = "",
  resolucao = {},
  contexto = {}
} = {}) {
  const mirror = radarMirror || metadata?.radarMirror || null;
  const tecnicaImportador = extrairDadosTecnicosImportador(ofertaImportador);
  const metadataEntrada = objeto(metadata);
  const metadataPermitida = {
    ...objeto(tecnicaImportador.metadata)
  };
  if (metadataEntrada.radarMirror && typeof metadataEntrada.radarMirror === "object") {
    metadataPermitida.radarMirror = metadataEntrada.radarMirror;
  }
  const metadataBase = mergeRadarMirrorMetadata({
    ...metadataPermitida
  }, mirror);

  const resultadoPrecedencia = resolverPrecedenciaComercialRadar({
    ofertaImportador: {
      ...tecnicaImportador,
      marketplace: tecnicaImportador.marketplace || marketplace
    },
    radarMirror: mirror,
    metadata: metadataBase,
    clienteId,
    marketplace: marketplace || tecnicaImportador.marketplace || ""
  });

  const linkOriginal = primeiroTexto(
    resolucao.linkOriginalLimpo,
    resolucao.linkResolvido,
    resolucao.urlResolvida,
    tecnicaImportador.linkResolvido,
    tecnicaImportador.urlFinal,
    contexto.linkOriginal
  );
  const textoOriginal = documentoComercialCanonico(mirror || {});
  const contratoComercial = camposComerciaisEspelho({
    radarMirror: mirror || {},
    resultadoPrecedencia,
    resolucao,
    tecnicaImportador,
    marketplace
  });
  const ofertaEspelhoBase = {
    ...(resultadoPrecedencia.oferta || {}),
    correlationId: contexto.correlationId || "",
    marketplace: (resultadoPrecedencia.oferta || {}).marketplace || marketplace || tecnicaImportador.marketplace || "",
    linkOriginal,
    linkCapturado: resolucao.urlCapturada || contexto.linkCapturado || "",
    linkOriginalRadar: resolucao.linkOriginalRadar || resolucao.urlCapturada || contexto.linkOriginalRadar || linkOriginal,
    linkResolvido: resolucao.linkResolvido || resolucao.linkOriginalLimpo || resolucao.urlResolvida || linkOriginal,
    linkResolvidoRadar: resolucao.urlResolvida || resolucao.linkResolvido || linkOriginal,
    link: linkOriginal,
    linkAfiliado: "",
    linkFinal: "",
    origem: "radar",
    radar: true,
    status: "rascunho",
    tipoLinkRadar: resolucao.tipoLinkRadar || "produto",
    fonteComercial: "radar_espelho_comercial",
    textoComercialOriginal: textoOriginal,
    textoComercialCanonico: textoOriginal,
    documentoComercialCanonico: textoOriginal,
    metadata: {
      ...(resultadoPrecedencia.metadata || metadataBase),
      fonteComercial: "radar_espelho_comercial",
      radarEspelhoComercial: {
        versao: "radar_espelho_comercial_v1",
        origem: "radar_mirror",
        importadorUsadoComo: "enriquecimento_tecnico",
        camposTecnicosImportador: Object.keys(tecnicaImportador).filter(campo => campo !== "metadata"),
        contratoComercial,
        resumoPrecedencia: resumirPrecedenciaComercialLog(resultadoPrecedencia)
      }
    }
  };
  const ofertaEspelho = aplicarContratoComercialRadar(ofertaEspelhoBase, contratoComercial);

  return {
    ok: true,
    oferta: ofertaEspelho,
    dadosTecnicosImportador: tecnicaImportador,
    resultadoPrecedencia
  };
}

module.exports = {
  aplicarAfiliadoLinkComercialRadar,
  aplicarContratoComercialRadar,
  camposComerciaisEspelho,
  documentoComercialCanonico,
  espelhoComercialRadarSuficiente,
  extrairDadosTecnicosImportador,
  motivoImportadorIgnoravelPeloEspelho,
  montarOfertaRadarEspelhoComercial
};
