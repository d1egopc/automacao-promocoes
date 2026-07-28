const {
  resolverPrecedenciaComercialRadar,
  resumirPrecedenciaComercialLog
} = require("./comercial-precedencia");
const {
  mergeRadarMirrorMetadata
} = require("./radar-mirror");
const { normalizarNumeroMoeda } = require("../../utils/moeda");
const {
  normalizarCodigoCupomSemantico,
  normalizarCuponsSemanticos
} = require("./cupom-semantico");
const {
  resolverBlocoComercialCanonico
} = require("./bloco-comercial-canonico");

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

function normalizarCupomComparacao(valor = "") {
  return texto(valor)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\b(cupom|codigo|cod|use|utilize|aplique|aplicar|no|na|o|a|ou|e)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizarTextoComparacao(valor = "") {
  return texto(valor)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function textosEquivalentes(a = "", b = "") {
  const chaveA = normalizarTextoComparacao(a);
  const chaveB = normalizarTextoComparacao(b);
  return Boolean(chaveA && chaveB && chaveA === chaveB);
}

function normalizarCodigoCupomContrato(valor = "") {
  return normalizarCodigoCupomSemantico(valor);
}

function cuponsContratoUnicos(valores = []) {
  const resultado = [];
  const vistos = new Set();

  for (const valor of Array.isArray(valores) ? valores : []) {
    for (const codigo of normalizarCuponsSemanticos(valor)) {
      const chave = normalizarCupomComparacao(codigo);
      if (!chave || vistos.has(chave)) continue;
      vistos.add(chave);
      resultado.push(codigo);
    }
  }

  return resultado;
}

function adicionarCodigoCupomFechado(resultado, vistos, valor = "") {
  const codigo = normalizarCodigoCupomContrato(valor);
  const chave = normalizarCupomComparacao(codigo);
  if (!codigo || !chave || vistos.has(chave)) return;
  vistos.add(chave);
  resultado.push(codigo);
}

function fecharCodigosCupomContrato({ oferta = {}, resultadoPrecedencia = {}, radarMirror = {} } = {}) {
  const resultado = [];
  const vistos = new Set();
  const resolucao = resultadoPrecedencia.resolucao || {};
  const comercialCupom = radarMirror?.comercial?.cupom || {};
  const mirrorCupom = radarMirror?.cupom || {};
  const fontesPrimarias = [
    ...(Array.isArray(oferta.codigosCupom) ? oferta.codigosCupom : []),
    ...(Array.isArray(oferta.cupons) ? oferta.cupons : []),
    ...(Array.isArray(resolucao.cuponsRadar) ? resolucao.cuponsRadar : []),
    ...(Array.isArray(comercialCupom.codigos) ? comercialCupom.codigos : []),
    ...(Array.isArray(comercialCupom.cupons) ? comercialCupom.cupons : []),
    ...(Array.isArray(mirrorCupom.codigosCapturados) ? mirrorCupom.codigosCapturados : []),
    comercialCupom.codigo || "",
    mirrorCupom.codigoCapturado || "",
    resolucao.cupomRadar || ""
  ];

  for (const valor of fontesPrimarias) {
    adicionarCodigoCupomFechado(resultado, vistos, valor);
  }

  return resultado;
}

function textoTecnicoInternoContrato(valor = "") {
  const chave = normalizarTextoComparacao(valor);
  return Boolean(
    /\b(?:cupom|codigo|token)\s+(?:detectado|encontrado|identificado)\b/.test(chave) ||
    /\b(?:extraido|detectado)\s+(?:da|de|automaticamente|mensagem)\b/.test(chave) ||
    /\b(?:mensagem|diagnostico|interno)\b.*\b(?:detectado|extraido|identificado)\b/.test(chave) ||
    /\b(?:sshopeecombr|https|http|combr)\b/.test(chave)
  );
}

function limparTextoComercialRenderizavel(valor = "") {
  const original = texto(valor);
  if (!original) return "";

  const linhas = original
    .split(/\r?\n/)
    .map(linha => linha.trim())
    .filter(linha => linha && !textoTecnicoInternoContrato(linha));

  return linhas
    .join(" ")
    .replace(/\b(?:cupom|codigo|token)\s+(?:detectado|encontrado|identificado)(?:\s+(?:na|no|da|do|de)\s+(?:mensagem|texto))?\s*:?\s*[A-Z0-9_-]{4,30}/ig, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function gerarInstrucaoCupomPadrao(cupons = []) {
  const lista = Array.isArray(cupons) ? cupons.filter(Boolean) : [];
  if (lista.length === 1) return `Aplique o cupom ${lista[0]} para obter o desconto.`;
  if (lista.length > 1) return `Aplique um dos cupons ${lista.join(" ou ")} para obter o desconto.`;
  return "";
}

function instrucaoCupomUtilContrato(instrucao = "", cupons = []) {
  const original = texto(instrucao);
  if (!original) return "";
  if (textoTecnicoInternoContrato(original)) return "";

  let normalizado = normalizarCupomComparacao(original);
  if (!normalizado) return "";

  const chavesCupom = cupons.map(normalizarCupomComparacao).filter(Boolean);
  if (chavesCupom.includes(normalizado)) return "";

  for (const chave of chavesCupom) {
    const escapada = chave.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    normalizado = normalizado
      .replace(new RegExp(`(^|\\s)${escapada}(?=\\s|$)`, "g"), " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  if (!normalizado || ["cupom", "codigo", "cod", "desconto"].includes(normalizado)) return "";

  return original;
}

function formatarMoedaBRLContrato(valor, opcoes = {}) {
  const numero = normalizarNumeroMoeda(valor);
  if (numero === null || !Number.isFinite(numero)) return "";
  return numero.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: opcoes.semCentavos ? 0 : 2,
    maximumFractionDigits: 2
  }).replace(/\u00A0/g, " ");
}

function normalizarPrecoUnitarioContrato(...valores) {
  for (const valor of valores) {
    const fonte = texto(valor?.evidencia || valor?.texto || valor?.valor || valor);
    if (!fonte) continue;

    const padraoUnitario = /(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*,\d{2}|\d+(?:[,.]\d{2})?)(?:\s*(?:\/\s*un|por\s+un\.?|por\s+unidade|cada\s+um|cada|unidade)(?:\s+[A-Za-zÀ-ÿ0-9]{2,24})?)/ig;
    let match;
    while ((match = padraoUnitario.exec(fonte))) {
      if (!/R\$/i.test(match[0]) && !/[,.]\d{2}\b/.test(match[1])) continue;

      const trecho = match[0].replace(/\s+/g, " ").trim();
      const unidade = (trecho.match(/(?:\/\s*un|por\s+un\.?|por\s+unidade|cada\s+um|cada|unidade)(?:\s+[A-Za-zÀ-ÿ0-9]{2,24})?/i) || [])[0] || "cada";
      const unidadeNormalizada = unidade.replace(/^\/\s*un$/i, "por unidade").replace(/\s+/g, " ").trim();
      const moeda = formatarMoedaBRLContrato(match[1], { semCentavos: !/[,.]\d{2}\b/.test(match[1]) });
      if (!moeda) continue;
      return `${moeda} ${unidadeNormalizada}`;
    }
  }

  return "";
}

function filtrarTextosSemDuplicarInstrucao(valores = [], instrucaoCupom = "") {
  return listaTextoUnica(valores).filter(item => !textosEquivalentes(item, instrucaoCupom));
}

function textoDuplicadoDeCampoClassificado(item = "", { instrucaoCupom = "", precoUnitario = "", cupons = [] } = {}) {
  const chaveItem = normalizarTextoComparacao(item);
  if (!chaveItem) return true;
  if (textoTecnicoInternoContrato(item)) return true;
  if (instrucaoCupom && textosEquivalentes(item, instrucaoCupom)) return true;

  const chaveInstrucao = normalizarTextoComparacao(instrucaoCupom);
  if (chaveInstrucao && chaveItem.includes(chaveInstrucao)) return true;

  const chaveUnitario = normalizarTextoComparacao(precoUnitario);
  if (chaveUnitario && (chaveItem === chaveUnitario || (/\bcada\b|\bunidade\b|\bunitario\b/i.test(item) && chaveItem.includes(chaveUnitario)))) return true;

  const chavesCupom = (Array.isArray(cupons) ? cupons : []).map(normalizarCupomComparacao).filter(Boolean);
  if (chavesCupom.includes(normalizarCupomComparacao(item))) return true;

  return false;
}

function filtrarTextosSemDuplicarCampos(valores = [], campos = {}) {
  return listaTextoUnica(valores).filter(item => !textoDuplicadoDeCampoClassificado(item, campos));
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

function normalizarLinkComparacao(link = "") {
  return texto(link).replace(/\/+$/g, "");
}

function linksEquivalentes(a = "", b = "") {
  const chaveA = normalizarLinkComparacao(a);
  const chaveB = normalizarLinkComparacao(b);
  return Boolean(chaveA && chaveB && chaveA === chaveB);
}

function montarLinksComerciaisEspelho(radarMirror = {}, resolucao = {}, tecnicaImportador = {}, marketplace = "", blocoCanonico = null) {
  const links = [];
  const mp = texto(marketplace || tecnicaImportador.marketplace || "");
  const produtoOriginal = primeiroTexto(
    ...(Array.isArray(blocoCanonico?.links?.produto) ? blocoCanonico.links.produto : []),
    ...(Array.isArray(blocoCanonico?.links?.afiliado) ? blocoCanonico.links.afiliado : [])
  );
  const resgateOriginal = primeiroTexto(
    ...(Array.isArray(blocoCanonico?.links?.resgate) ? blocoCanonico.links.resgate : [])
  );
  const linkCapturadoResolucao = primeiroTexto(resolucao.urlCapturada, resolucao.linkOriginalRadar);
  const resolucaoEhDoProduto = !produtoOriginal || !linkCapturadoResolucao || linksEquivalentes(linkCapturadoResolucao, produtoOriginal);
  const produtoResolvido = resolucaoEhDoProduto
    ? primeiroTexto(resolucao.linkOriginalLimpo, resolucao.linkResolvido, resolucao.urlResolvida, tecnicaImportador.linkResolvido, tecnicaImportador.permalink, produtoOriginal)
    : primeiroTexto(tecnicaImportador.linkResolvido, tecnicaImportador.permalink, tecnicaImportador.urlFinal, produtoOriginal);

  adicionarLinkComercial(links, {
    tipo: "produto",
    original: produtoOriginal,
    resolvido: produtoResolvido,
    marketplace: mp
  });

  adicionarLinkComercial(links, {
    tipo: "resgate",
    original: resgateOriginal,
    marketplace: mp
  });

  for (const link of Array.isArray(blocoCanonico?.links?.afiliado) ? blocoCanonico.links.afiliado : []) {
    adicionarLinkComercial(links, { tipo: "afiliado", original: link, marketplace: mp });
  }
  for (const link of Array.isArray(blocoCanonico?.links?.imagem) ? blocoCanonico.links.imagem : []) {
    adicionarLinkComercial(links, { tipo: "imagem", original: link, marketplace: mp });
  }
  for (const link of Array.isArray(blocoCanonico?.links?.outros) ? blocoCanonico.links.outros : []) {
    adicionarLinkComercial(links, { tipo: "adicional", original: link, marketplace: mp });
  }

  return links;
}

function camposComerciaisEspelho({ radarMirror = {}, resultadoPrecedencia = {}, resolucao = {}, tecnicaImportador = {}, marketplace = "", blocoCanonico = null, coerenciaComercial = null } = {}) {
  const oferta = objeto(resultadoPrecedencia.oferta);
  const comercial = objeto(radarMirror?.comercial);
  const produto = objeto(radarMirror?.produto);
  const condicoes = objeto(resultadoPrecedencia.resolucao?.condicoesComerciais);
  const blocoCoerente = blocoCanonico || null;
  const coerencia = coerenciaComercial || { ok: Boolean(blocoCoerente), motivo: blocoCoerente ? "bloco_comercial_canonico" : "bloco_comercial_ausente" };
  const textoCanonico = blocoCoerente ? limparTextoComercialRenderizavel(blocoCoerente.texto) : "";
  const linksComerciais = montarLinksComerciaisEspelho(radarMirror, resolucao, tecnicaImportador, marketplace, blocoCoerente);
  const cupons = blocoCoerente?.cupons?.length
    ? blocoCoerente.cupons
    : fecharCodigosCupomContrato({ oferta, resultadoPrecedencia, radarMirror });
  const cupomPublicacao = cupons.join(" ou ");
  const instrucaoCupomOriginal = instrucaoCupomUtilContrato(
    oferta.instrucaoCupom ||
      resultadoPrecedencia.resolucao?.instrucaoCupom ||
      radarMirror?.comercial?.cupom?.instrucao ||
    radarMirror?.cupom?.condicaoCapturada ||
      "",
    cupons
  );
  const instrucaoCupom = instrucaoCupomOriginal || gerarInstrucaoCupomPadrao(cupons);
  const precoUnitario = normalizarPrecoUnitarioContrato(
    blocoCoerente?.condicoes?.precoUnitario,
    oferta.precoUnitario,
    condicoes.unitario,
    comercial.precoUnitario,
    blocoCoerente?.texto
  );
  const beneficioExtra = textosEquivalentes(oferta.beneficioExtra, instrucaoCupom) || textoTecnicoInternoContrato(oferta.beneficioExtra)
    ? ""
    : texto(oferta.beneficioExtra || "");
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
    textoComercialOriginal: textoCanonico,
    titulo: blocoCoerente?.titulo || "",
    nome: blocoCoerente?.titulo || "",
    descricao: textoCanonico,
    preco: blocoCoerente?.precoAtual,
    precoAtual: blocoCoerente?.precoAtual,
    precoAnterior: blocoCoerente?.precoAnterior,
    precoOriginal: blocoCoerente?.precoAnterior,
    precoPix: oferta.precoPix || blocoCoerente?.condicoes?.pix || "",
    condicaoPix: oferta.condicaoPix || blocoCoerente?.condicoes?.pix || oferta.precoPix || "",
    precoUnitario,
    quantidade: produto.quantidadeCapturada || comercial.quantidade?.valor || "",
    parcelamento: oferta.parcelamento || blocoCoerente?.condicoes?.parcelamento || "",
    quantidadeParcelas: condicoes.parcelamento?.quantidade || blocoCoerente?.precos?.parcelado?.quantidade || "",
    valorParcela: condicoes.parcelamento?.valorParcela || blocoCoerente?.precos?.parcelado?.valorParcela || blocoCoerente?.precos?.parcelado?.valor || "",
    cupom: cupomPublicacao,
    codigoCupom: cupomPublicacao,
    codigo_cupom: cupomPublicacao,
    cupomTexto: cupomPublicacao,
    cupons,
    codigosCupom: [...cupons],
    instrucaoCupom,
    avisoCupom: "",
    beneficioExtra,
    beneficios: filtrarTextosSemDuplicarCampos([
      ...(Array.isArray(oferta.beneficios) ? oferta.beneficios : []),
      ...(Array.isArray(comercial.beneficios) ? comercial.beneficios : []),
      ...(Array.isArray(comercial.brindes) ? comercial.brindes : []),
      oferta.beneficioExtra,
      oferta.avisoCupom
    ], { instrucaoCupom, precoUnitario, cupons }),
    condicoes: filtrarTextosSemDuplicarCampos(condicoesEspeciais, { instrucaoCupom, precoUnitario, cupons }),
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
    categoria: oferta.categoria || tecnicaImportador.categoria || "",
    coerenciaComercial: {
      ok: coerencia.ok,
      motivo: coerencia.motivo,
      blocoSelecionado: blocoCoerente?.indice ?? null
    }
  };
}

function aplicarContratoComercialRadar(oferta = {}, contrato = null) {
  const origem = contrato || oferta.metadata?.radarEspelhoComercial?.contratoComercial || {};
  if (!origem || typeof origem !== "object") return oferta;
  const proxima = { ...oferta };
  const camposLimpaveis = new Set([
    "cupom",
    "codigoCupom",
    "codigo_cupom",
    "cupomTexto",
    "instrucaoCupom",
    "avisoCupom",
    "beneficioExtra",
    "precoUnitario"
  ]);

  for (const [campo, valor] of Object.entries(origem)) {
    if (valor === null || valor === undefined || (valor === "" && !camposLimpaveis.has(campo))) continue;
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
    limparTextoComercialRenderizavel(radarMirror?.texto?.original),
    limparTextoComercialRenderizavel(radarMirror?.texto?.limpo)
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
  const coerenciaComercial = resolverBlocoComercialCanonico(mirror || {});

  if (!coerenciaComercial.ok) {
    return {
      ok: false,
      motivo: "radar_contrato_comercial_ambiguo",
      motivoTecnico: coerenciaComercial.motivo || "radar_contrato_comercial_ambiguo",
      coerenciaComercial
    };
  }

  const blocoCanonico = coerenciaComercial.bloco || null;

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
  const textoOriginal = limparTextoComercialRenderizavel(blocoCanonico?.texto || "");
  const contratoComercial = camposComerciaisEspelho({
    radarMirror: mirror || {},
    resultadoPrecedencia,
    resolucao,
    tecnicaImportador,
    marketplace,
    blocoCanonico,
    coerenciaComercial
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
        blocoComercialCanonico: {
          indice: blocoCanonico?.indice ?? null,
          motivo: coerenciaComercial.motivo || "",
          evidencias: blocoCanonico?.evidencias || {}
        },
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
