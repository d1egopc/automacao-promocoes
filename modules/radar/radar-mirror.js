const { normalizarNumeroMoeda } = require("../../utils/moeda");

const RADAR_MIRROR_VERSAO = 1;
const CONFIANCA_VALORES = new Set(["alta", "media", "baixa", "ausente"]);

function textoOuNull(valor) {
  if (valor === null || valor === undefined) return null;
  const texto = String(valor).trim();
  return texto ? texto : null;
}

function texto(valor = "") {
  return String(valor || "").trim();
}

function textoLimpo(valor = "") {
  const limpo = String(valor || "")
    .replace(/[\u200B\u200C\u200D\u2060\uFEFF]/g, "")
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return limpo || null;
}

function numeroOuNull(valor) {
  const numero = normalizarNumeroMoeda(valor);
  return numero === null ? null : numero;
}

function confianca(valor = "") {
  const normalizada = texto(valor).toLowerCase();
  return CONFIANCA_VALORES.has(normalizada) ? normalizada : "ausente";
}

function normalizarCupom(valor = "") {
  const cupom = normalizarCupons(valor)[0] || null;
  return cupom;
}

function normalizarCupons(valor = "") {
  const entradas = Array.isArray(valor) ? valor : [valor];
  const bloqueados = new Set(["CUPOM", "CODIGO", "CODIGO:", "APLICAR", "RESGATE", "DESCONTO", "OFERTA", "PROMOCAO", "GRATIS", "FRETE", "CARRINHO", "OU", "E", "OR"]);
  const resultado = [];
  const vistos = new Set();

  for (const entrada of entradas) {
    const base = texto(entrada)
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
      .replace(/\b(CUPOM|CODIGO|CODE|USE|UTILIZE|APLIQUE|RESGATE)\b\s*:?\s*/g, " ")
    .trim();
    const partes = base.match(/\b[A-Z0-9][A-Z0-9_-]{3,39}\b/g) || [];
    for (const parte of partes) {
      if (bloqueados.has(parte) || vistos.has(parte)) continue;
      vistos.add(parte);
      resultado.push(parte);
    }
  }

  return resultado;
}

function normalizarTituloComparacao(valor = "") {
  return texto(valor)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function linksUnicos(links = []) {
  const resultado = [];
  const vistos = new Set();
  for (const link of Array.isArray(links) ? links : []) {
    const valor = texto(link);
    if (!valor || vistos.has(valor)) continue;
    vistos.add(valor);
    resultado.push(valor);
  }
  return resultado;
}

function linkPareceProdutoRadar(link = "") {
  const valor = texto(link).toLowerCase();
  if (!valor) return false;
  return Boolean(
    /mercadolivre\.com\.br\/(?:[^\s?#]+\/p\/|p\/|produto\/|MLB-?\d+|.*[?&]item_id=MLB\d+)/i.test(valor) ||
    /(?:amazon\.com\.br|amzn\.to)\/(?:dp\/|gp\/product\/|[^\s?#]*\/dp\/|[A-Z0-9]{10})(?:[/?#]|$)/i.test(valor) ||
    /(?:shopee\.com\.br|s\.shopee\.com\.br)\//i.test(valor) ||
    /aliexpress\.[^/]+\/item\//i.test(valor) ||
    /kabum\.com\.br\/produto\//i.test(valor)
  );
}

function classificarLinksRadar(links = [], beneficios = {}) {
  const encontrados = linksUnicos(links);
  const linksResgate = linksUnicos([
    beneficios.linkResgateCupom,
    ...(Array.isArray(beneficios.linksResgate) ? beneficios.linksResgate : [])
  ]);
  const resgateCupom = linksResgate.find(link => encontrados.includes(link)) || linksResgate[0] || null;
  const candidatosProduto = encontrados.filter(link => link !== resgateCupom);
  const produtoPorPadrao = candidatosProduto.find(linkPareceProdutoRadar) || null;
  const produtoOriginal = produtoPorPadrao || (
    resgateCupom && candidatosProduto.length === 1 ? candidatosProduto[0] : null
  );
  const adicionais = encontrados.filter(link => link !== produtoOriginal && link !== resgateCupom);

  return {
    encontrados,
    produtoOriginal,
    resgateCupom,
    adicionais,
    quantidadeEncontrada: encontrados.length
  };
}

function imagemOriginalRadar(extracao = {}, raw = {}) {
  const referencia = textoOuNull(extracao?.imagemMensagem?.referenciaInterna);
  if (referencia) return { imagemOriginal: referencia, imagemOrigem: "mensagem" };

  const candidatos = [
    raw?.image,
    raw?.photo,
    raw?.media?.url,
    raw?.message?.imageMessage?.url,
    raw?.message?.imageMessage?.directPath,
    raw?.message?.extendedTextMessage?.jpegThumbnail ? "thumbnail:extendedTextMessage" : "",
    raw?.message?.imageMessage?.jpegThumbnail ? "thumbnail:imageMessage" : ""
  ];

  for (const candidato of candidatos) {
    const valor = textoOuNull(candidato);
    if (valor) {
      return {
        imagemOriginal: valor,
        imagemOrigem: String(valor).startsWith("thumbnail:") ? "thumbnail" : "mensagem"
      };
    }
  }

  if (extracao?.imagemMensagem?.presente) {
    return { imagemOriginal: null, imagemOrigem: "mensagem" };
  }

  return { imagemOriginal: null, imagemOrigem: "ausente" };
}

function condicaoPrecoRadar(extracao = {}, beneficios = {}) {
  const textos = [
    extracao?.precoAtual?.metadados?.tipo,
    extracao?.precoAtual?.evidencia,
    beneficios.beneficioExtra,
    beneficios.avisoCupom,
    extracao?.cupom?.beneficioTexto
  ].map(texto).filter(Boolean);
  const condicaoTexto = textos.find(item => /app|pix|moeda|cupom|cashback|frete|boleto|cartao|cart[aã]o/i.test(item)) || null;

  return {
    condicionado: Boolean(condicaoTexto),
    condicaoTexto
  };
}

function campoComercial(campo = {}) {
  if (!campo || typeof campo !== "object") return { valor: null, confianca: "ausente", evidencia: null };
  return {
    valor: campo.valor ?? null,
    confianca: confianca(campo.confianca || "ausente"),
    evidencia: textoOuNull(campo.evidencia || ""),
    tipo: textoOuNull(campo.tipo || ""),
    tipoCandidato: textoOuNull(campo.tipoCandidato || ""),
    marcadorAnterior: textoOuNull(campo.marcadorAnterior || ""),
    marcadorPosterior: textoOuNull(campo.marcadorPosterior || ""),
    possuiCifrao: campo.possuiCifrao === true,
    possuiMoeda: campo.possuiMoeda === true,
    nivelEvidencia: textoOuNull(campo.nivelEvidencia || ""),
    motivos: Array.isArray(campo.motivos) ? campo.motivos.filter(Boolean).slice(0, 12) : []
  };
}

function resumirLinksComerciais(comercial = {}) {
  const links = comercial?.links || {};
  return {
    encontrados: linksUnicos(links.encontrados || []),
    produto: textoOuNull(links.produto),
    resgate: textoOuNull(links.resgate),
    cupom: textoOuNull(links.cupom),
    landing: linksUnicos(links.landing || []),
    encurtadores: linksUnicos(links.encurtadores || []),
    redirecionadores: linksUnicos(links.redirecionadores || []),
    afiliados: linksUnicos(links.afiliados || []),
    adicionais: linksUnicos(links.adicionais || []),
    classificados: Array.isArray(links.classificados)
      ? links.classificados.slice(0, 30).map(item => ({ link: textoOuNull(item.link), tipo: textoOuNull(item.tipo) })).filter(item => item.link)
      : []
  };
}

function resumirComercialRadar(extracao = {}) {
  const comercial = extracao?.comercial && typeof extracao.comercial === "object" ? extracao.comercial : {};
  return {
    versao: comercial.versao || null,
    precoAtual: campoComercial(comercial.precoAtual),
    precoAntigo: campoComercial(comercial.precoAntigo),
    precoPix: campoComercial(comercial.precoPix),
    precoBoleto: campoComercial(comercial.precoBoleto),
    precoCartao: campoComercial(comercial.precoCartao),
    precoParcelado: campoComercial(comercial.precoParcelado),
    parcelamento: {
      quantidade: comercial.parcelamento?.quantidade ?? null,
      valorParcela: comercial.parcelamento?.valorParcela ?? null,
      semJuros: comercial.parcelamento?.semJuros === true,
      confianca: confianca(comercial.parcelamento?.confianca || "ausente"),
      evidencia: textoOuNull(comercial.parcelamento?.evidencia || "")
    },
    descontoPercentual: campoComercial(comercial.descontoPercentual),
    valorEconomia: campoComercial(comercial.valorEconomia),
    cupom: {
      codigo: normalizarCupom(comercial.cupom?.codigo || comercial.cupom?.texto || ""),
      codigos: normalizarCupons([
        ...(Array.isArray(comercial.cupom?.codigos) ? comercial.cupom.codigos : []),
        ...(Array.isArray(comercial.cupom?.cupons) ? comercial.cupom.cupons : []),
        comercial.cupom?.codigo || "",
        comercial.cupom?.texto || "",
        comercial.cupom?.instrucao || "",
        comercial.cupom?.evidencia || ""
      ]),
      texto: textoOuNull(comercial.cupom?.texto || ""),
      instrucao: textoOuNull(comercial.cupom?.instrucao || ""),
      valor: comercial.cupom?.valor ?? null,
      percentual: comercial.cupom?.percentual ?? null,
      confianca: confianca(comercial.cupom?.confianca || "ausente"),
      evidencia: textoOuNull(comercial.cupom?.evidencia || ""),
      provavel: comercial.cupom?.provavel === true
    },
    cashback: campoComercial(comercial.cashback),
    freteGratis: campoComercial(comercial.freteGratis),
    marketplace: campoComercial(comercial.marketplace),
    categoria: campoComercial(comercial.categoria),
    avaliacao: campoComercial(comercial.avaliacao),
    quantidadeVendida: campoComercial(comercial.quantidadeVendida),
    estoque: campoComercial(comercial.estoque),
    seloOficial: campoComercial(comercial.seloOficial),
    moedasShopee: campoComercial(comercial.moedasShopee),
    brindes: Array.isArray(comercial.brindes) ? comercial.brindes.filter(Boolean).slice(0, 10) : [],
    condicoesEspeciais: Array.isArray(comercial.condicoesEspeciais) ? comercial.condicoesEspeciais.filter(Boolean).slice(0, 20) : [],
    links: resumirLinksComerciais(comercial),
    resolucaoPreco: comercial.resolucaoPreco && typeof comercial.resolucaoPreco === "object" ? {
      versao: textoOuNull(comercial.resolucaoPreco.versao || ""),
      quantidadeCandidatosPreco: Number(comercial.resolucaoPreco.quantidadeCandidatosPreco || 0),
      tipoCandidatoEscolhido: textoOuNull(comercial.resolucaoPreco.tipoCandidatoEscolhido || ""),
      marcadorPrecoEscolhido: textoOuNull(comercial.resolucaoPreco.marcadorPrecoEscolhido || ""),
      possuiCifraoPrecoEscolhido: comercial.resolucaoPreco.possuiCifraoPrecoEscolhido === true,
      motivosConfiancaPreco: Array.isArray(comercial.resolucaoPreco.motivosConfiancaPreco) ? comercial.resolucaoPreco.motivosConfiancaPreco.filter(Boolean).slice(0, 12) : [],
      candidatosRejeitadosPorTipo: comercial.resolucaoPreco.candidatosRejeitadosPorTipo && typeof comercial.resolucaoPreco.candidatosRejeitadosPorTipo === "object" ? comercial.resolucaoPreco.candidatosRejeitadosPorTipo : {}
    } : null,
    camposEncontrados: Array.isArray(comercial.camposEncontrados) ? comercial.camposEncontrados.slice(0, 40) : [],
    camposAusentes: Array.isArray(comercial.camposAusentes) ? comercial.camposAusentes.slice(0, 40) : [],
    tiposReconhecidos: Array.isArray(comercial.tiposReconhecidos) ? comercial.tiposReconhecidos.slice(0, 40) : []
  };
}

function criarRadarMirror({
  origemTipo = null,
  clienteId = null,
  sessaoId = null,
  grupoId = null,
  grupoNome = null,
  capturadaEm = null,
  textoOriginal = "",
  links = [],
  extracaoRadarLocal = {},
  beneficiosMensagem = {},
  raw = null,
  marketplace = ""
} = {}) {
  const precoAtual = numeroOuNull(extracaoRadarLocal?.precoAtual?.valor);
  const precoAnterior = numeroOuNull(extracaoRadarLocal?.precoAnterior?.valor);
  const cupomCodigos = normalizarCupons([
    ...(Array.isArray(extracaoRadarLocal?.cupom?.codigos) ? extracaoRadarLocal.cupom.codigos : []),
    ...(Array.isArray(beneficiosMensagem.cupons) ? beneficiosMensagem.cupons : []),
    extracaoRadarLocal?.cupom?.codigo || "",
    extracaoRadarLocal?.cupom?.beneficioTexto || "",
    extracaoRadarLocal?.cupom?.evidencia || "",
    beneficiosMensagem.cupom || "",
    beneficiosMensagem.beneficioExtra || "",
    beneficiosMensagem.avisoCupom || ""
  ]);
  const cupomCodigo = cupomCodigos[0] || null;
  const linksClassificados = classificarLinksRadar(links, beneficiosMensagem);
  const midia = imagemOriginalRadar(extracaoRadarLocal, raw || {});
  const condicao = condicaoPrecoRadar(extracaoRadarLocal, beneficiosMensagem);
  const comercial = resumirComercialRadar(extracaoRadarLocal);

  return {
    versao: RADAR_MIRROR_VERSAO,
    criadoEm: new Date().toISOString(),
    origem: {
      tipo: textoOuNull(origemTipo),
      clienteId: textoOuNull(clienteId),
      sessaoId: textoOuNull(sessaoId),
      grupoId: textoOuNull(grupoId),
      grupoNome: textoOuNull(grupoNome),
      capturadaEm: textoOuNull(capturadaEm)
    },
    texto: {
      original: textoOuNull(textoOriginal),
      limpo: textoLimpo(textoOriginal)
    },
    produto: {
      tituloCapturado: textoOuNull(extracaoRadarLocal?.titulo?.valor),
      variacaoCapturada: null,
      quantidadeCapturada: null
    },
    preco: {
      atualCapturado: precoAtual,
      anteriorCapturado: precoAnterior,
      origem: precoAtual !== null || precoAnterior !== null ? "texto_radar" : "ausente",
      confianca: precoAtual !== null ? confianca(extracaoRadarLocal?.precoAtual?.confianca) : "ausente",
      condicionado: condicao.condicionado,
      condicaoTexto: condicao.condicaoTexto,
      tipoCapturado: textoOuNull(extracaoRadarLocal?.precoAtual?.tipo || extracaoRadarLocal?.precoAtual?.metadados?.tipo || comercial.precoAtual?.tipo),
      evidenciaCapturada: textoOuNull(extracaoRadarLocal?.precoAtual?.evidencia || comercial.precoAtual?.evidencia),
      marcadorComercial: textoOuNull(comercial.precoAtual?.tipo || comercial.precoPix?.evidencia || comercial.cupom?.instrucao)
    },
    cupom: {
      codigoCapturado: cupomCodigo,
      codigosCapturados: cupomCodigos,
      textoCapturado: textoOuNull(extracaoRadarLocal?.cupom?.beneficioTexto || beneficiosMensagem.beneficioExtra || beneficiosMensagem.avisoCupom),
      condicaoCapturada: textoOuNull(extracaoRadarLocal?.cupom?.evidencia || beneficiosMensagem.tipoCupom),
      confianca: cupomCodigo ? confianca(extracaoRadarLocal?.cupom?.confianca || (beneficiosMensagem.cupom ? "media" : "ausente")) : "ausente"
    },
    links: linksClassificados,
    comercial,
    midia,
    evidencias: {
      possuiPreco: precoAtual !== null,
      possuiPrecoAnterior: precoAnterior !== null,
      possuiCupom: Boolean(cupomCodigo),
      possuiDoisLinks: linksClassificados.quantidadeEncontrada >= 2,
      possuiLinkResgate: Boolean(linksClassificados.resgateCupom),
      possuiImagem: midia.imagemOrigem !== "ausente"
    },
    comparacaoImportador: criarComparacaoImportador(null, { marketplace })
  };
}

function criarComparacaoImportador(radarMirror = {}, ofertaImportador = {}) {
  const precoRadar = radarMirror?.preco?.atualCapturado ?? null;
  const precoAnteriorRadar = radarMirror?.preco?.anteriorCapturado ?? null;
  const cupomRadar = normalizarCupom(radarMirror?.cupom?.codigoCapturado || "");
  const tituloRadar = radarMirror?.produto?.tituloCapturado || "";

  const tituloImportador = textoOuNull(ofertaImportador?.titulo || ofertaImportador?.nome || "");
  const precoImportador = numeroOuNull(ofertaImportador?.precoAtual ?? ofertaImportador?.preco ?? ofertaImportador?.valor);
  const precoAnteriorImportador = numeroOuNull(ofertaImportador?.precoOriginal ?? ofertaImportador?.precoAntigo ?? ofertaImportador?.precoDe);
  const cupomImportador = normalizarCupom(ofertaImportador?.cupom || ofertaImportador?.codigoCupom || "");
  const imagemImportador = textoOuNull(ofertaImportador?.imagem || ofertaImportador?.image || ofertaImportador?.imagemUrl || ofertaImportador?.thumbnail || "");
  const imagemRadar = textoOuNull(radarMirror?.midia?.imagemOriginal || "");

  const tituloRadarNorm = normalizarTituloComparacao(tituloRadar);
  const tituloImportadorNorm = normalizarTituloComparacao(tituloImportador || "");
  const divergenciaTitulo = Boolean(
    tituloRadarNorm &&
    tituloImportadorNorm &&
    tituloRadarNorm !== tituloImportadorNorm &&
    !tituloRadarNorm.includes(tituloImportadorNorm) &&
    !tituloImportadorNorm.includes(tituloRadarNorm)
  );

  return {
    tituloImportador,
    precoImportador,
    precoAnteriorImportador,
    cupomImportador,
    imagemImportador,
    divergenciaTitulo,
    divergenciaPreco: precoRadar !== null && precoImportador !== null && Math.abs(precoRadar - precoImportador) >= 0.01,
    divergenciaPrecoAnterior: precoAnteriorRadar !== null && precoAnteriorImportador !== null && Math.abs(precoAnteriorRadar - precoAnteriorImportador) >= 0.01,
    divergenciaCupom: Boolean(cupomRadar && cupomImportador && cupomRadar !== cupomImportador),
    divergenciaImagem: Boolean(imagemRadar && imagemImportador && imagemRadar !== imagemImportador)
  };
}

function compararRadarMirrorComImportador(radarMirror = {}, ofertaImportador = {}) {
  if (!radarMirror || typeof radarMirror !== "object") return radarMirror;
  return {
    ...radarMirror,
    comparacaoImportador: criarComparacaoImportador(radarMirror, ofertaImportador)
  };
}

function mergeRadarMirrorMetadata(metadata = {}, radarMirror = null) {
  const base = metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata : {};
  const existente = base.radarMirror && typeof base.radarMirror === "object" ? base.radarMirror : null;
  const mirror = existente || radarMirror;
  if (!mirror || typeof mirror !== "object") return { ...base };

  return {
    ...base,
    radarMirror: {
      ...mirror,
      comparacaoImportador: radarMirror?.comparacaoImportador || mirror.comparacaoImportador || criarComparacaoImportador(mirror, {})
    }
  };
}

function resumirRadarMirrorLog(radarMirror = {}, extras = {}) {
  return {
    clienteId: extras.clienteId || radarMirror?.origem?.clienteId || "",
    marketplace: extras.marketplace || "",
    grupoId: radarMirror?.origem?.grupoId || "",
    quantidadeLinks: radarMirror?.links?.quantidadeEncontrada || 0,
    possuiPreco: radarMirror?.evidencias?.possuiPreco === true,
    possuiCupom: radarMirror?.evidencias?.possuiCupom === true,
    possuiLinkResgate: radarMirror?.evidencias?.possuiLinkResgate === true,
    confiancaPreco: radarMirror?.preco?.confianca || "ausente"
  };
}

module.exports = {
  RADAR_MIRROR_VERSAO,
  criarRadarMirror,
  compararRadarMirrorComImportador,
  criarComparacaoImportador,
  mergeRadarMirrorMetadata,
  resumirRadarMirrorLog,
  normalizarTituloComparacao
};
