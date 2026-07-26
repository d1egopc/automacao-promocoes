const { normalizarNumeroMoeda } = require("../../utils/moeda");

const VERSAO_PRECEDENCIA_COMERCIAL = "radar_precedencia_comercial_v1";
const DIVERGENCIA_PERCENTUAL_LOG = 20;
const DIVERGENCIA_PERCENTUAL_SUSPEITA = 80;
const CONFIANCAS_VALIDAS = new Set(["alta", "media", "baixa", "ausente"]);

function texto(valor = "") {
  return String(valor ?? "").trim();
}

function textoOuNull(valor) {
  const limpo = texto(valor);
  return limpo ? limpo : null;
}

function confianca(valor = "") {
  const normalizada = texto(valor).toLowerCase();
  return CONFIANCAS_VALIDAS.has(normalizada) ? normalizada : "ausente";
}

function precoValido(valor) {
  const numero = normalizarNumeroMoeda(valor);
  if (numero === null || !Number.isFinite(numero)) return null;
  if (numero <= 0) return null;
  return numero;
}

function normalizarCupom(valor = "") {
  const cupom = texto(valor)
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9_-]/g, "")
    .trim();
  const bloqueados = new Set(["CUPOM", "CODIGO", "APLICAR", "RESGATE", "DESCONTO", "OFERTA", "PROMOCAO", "GRATIS", "FRETE"]);
  if (!cupom || cupom.length < 4 || bloqueados.has(cupom)) return null;
  return cupom;
}

function campoValor(campo = {}) {
  if (!campo || typeof campo !== "object") return null;
  return campo.valor ?? null;
}

function campoConfianca(campo = {}) {
  if (!campo || typeof campo !== "object") return "ausente";
  return confianca(campo.confianca || "ausente");
}

function campoEvidencia(campo = {}) {
  if (!campo || typeof campo !== "object") return "";
  return texto(campo.evidencia || campo.tipo || "");
}

function temMarcadorPrecoExplicito(radarMirror = {}, campo = {}) {
  const fonte = [
    radarMirror?.preco?.condicaoTexto,
    radarMirror?.preco?.marcadorComercial,
    radarMirror?.preco?.tipoCapturado,
    radarMirror?.preco?.evidenciaCapturada,
    campo?.tipo,
    campo?.evidencia
  ].map(texto).join(" ").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return /\b(por|agora|sai por|saindo por|no pix|pix|com cupom|preco final|preco|apenas|fica por|leva por)\b/.test(fonte);
}

function selecionarPrecoRadar(radarMirror = {}) {
  const comercial = radarMirror?.comercial || {};
  const candidatos = [
    { nome: "precoAtual", valor: radarMirror?.preco?.atualCapturado, confianca: radarMirror?.preco?.confianca, campo: comercial.precoAtual || {}, tipo: comercial.precoAtual?.tipo || radarMirror?.preco?.tipoCapturado || "atual" },
    { nome: "precoPix", valor: campoValor(comercial.precoPix), confianca: campoConfianca(comercial.precoPix), campo: comercial.precoPix || {}, tipo: "pix" },
    { nome: "precoBoleto", valor: campoValor(comercial.precoBoleto), confianca: campoConfianca(comercial.precoBoleto), campo: comercial.precoBoleto || {}, tipo: "boleto" },
    { nome: "precoCartao", valor: campoValor(comercial.precoCartao), confianca: campoConfianca(comercial.precoCartao), campo: comercial.precoCartao || {}, tipo: "cartao" }
  ];

  let invalido = null;
  for (const candidato of candidatos) {
    const brutoPresente = candidato.valor !== null && candidato.valor !== undefined && candidato.valor !== "";
    const valor = precoValido(candidato.valor);
    if (valor === null) {
      if (brutoPresente && !invalido) {
        invalido = {
          ...candidato,
          valor: null,
          confianca: confianca(candidato.confianca || candidato.campo?.confianca || "ausente"),
          marcadorExplicito: temMarcadorPrecoExplicito(radarMirror, candidato.campo),
          tipoCandidato: texto(candidato.campo?.tipoCandidato || ""),
          marcadorPrecoEscolhido: texto(candidato.campo?.marcadorAnterior || candidato.campo?.marcadorPosterior || ""),
          possuiCifrao: candidato.campo?.possuiCifrao === true,
          nivelEvidencia: texto(candidato.campo?.nivelEvidencia || "ausente"),
          motivos: Array.isArray(candidato.campo?.motivos) ? candidato.campo.motivos.filter(Boolean).slice(0, 12) : [],
          invalido: true
        };
      }
      continue;
    }
    return {
      ...candidato,
      valor,
      confianca: confianca(candidato.confianca || candidato.campo?.confianca || "ausente"),
      marcadorExplicito: temMarcadorPrecoExplicito(radarMirror, candidato.campo),
      tipoCandidato: texto(candidato.campo?.tipoCandidato || ""),
      marcadorPrecoEscolhido: texto(candidato.campo?.marcadorAnterior || candidato.campo?.marcadorPosterior || ""),
      possuiCifrao: candidato.campo?.possuiCifrao === true,
      nivelEvidencia: texto(candidato.campo?.nivelEvidencia || "ausente"),
      motivos: Array.isArray(candidato.campo?.motivos) ? candidato.campo.motivos.filter(Boolean).slice(0, 12) : [],
      invalido: false
    };
  }
  return invalido || { nome: "ausente", valor: null, confianca: "ausente", campo: {}, tipo: "ausente", tipoCandidato: "ausente", marcadorPrecoEscolhido: "", possuiCifrao: false, nivelEvidencia: "ausente", motivos: [], marcadorExplicito: false, invalido: false };
}

function calcularDivergenciaPercentual(precoRadar, precoImportador) {
  if (precoRadar === null || precoImportador === null || precoImportador <= 0) return null;
  return Number(((Math.abs(precoRadar - precoImportador) / precoImportador) * 100).toFixed(2));
}

function resolverPreco({ ofertaImportador = {}, radarMirror = {}, cupomRadarConfirmado = false } = {}) {
  const radar = selecionarPrecoRadar(radarMirror);
  const precoImportador = precoValido(ofertaImportador.precoAtual ?? ofertaImportador.preco ?? ofertaImportador.valor);
  const precoRadar = radar.valor;
  const divergenciaPercentual = calcularDivergenciaPercentual(precoRadar, precoImportador);
  let origemPreco = precoImportador !== null ? "importador" : "ausente";
  let precoPublicacao = precoImportador;
  let statusComparacaoPreco = "sem_radar";
  let motivo = "radar_ausente";

  if (precoRadar !== null) {
    const divergenciaExtrema = divergenciaPercentual !== null && divergenciaPercentual >= DIVERGENCIA_PERCENTUAL_SUSPEITA;
    if (radar.confianca === "alta" || (radar.confianca === "media" && radar.marcadorExplicito)) {
      const evidenciaSemanticaForte = radar.nivelEvidencia === "alta" || radar.nivelEvidencia === "ausente" || !radar.nivelEvidencia;
      const evidenciaForte = radar.confianca === "alta" && evidenciaSemanticaForte && radar.marcadorExplicito;
      if (divergenciaExtrema && !cupomRadarConfirmado) {
        statusComparacaoPreco = "revisao_divergencia_extrema";
        motivo = "divergencia_extrema_sem_cupom_confirmado";
      } else if (divergenciaExtrema && !evidenciaForte) {
        statusComparacaoPreco = "revisao_semantica";
        motivo = "divergencia_alta_com_evidencia_fraca";
      } else {
        origemPreco = "radar";
        precoPublicacao = precoRadar;
        statusComparacaoPreco = divergenciaPercentual !== null && divergenciaPercentual >= 0.01 ? "divergente" : "coerente";
        motivo = divergenciaExtrema
          ? "divergencia_extrema_com_cupom_confirmado"
          : (radar.confianca === "alta" ? "radar_alta_confianca" : "radar_media_com_marcador");
      }
    } else if (radar.confianca === "media") {
      statusComparacaoPreco = "radar_media_sem_marcador";
      motivo = "radar_media_sem_marcador";
    } else {
      statusComparacaoPreco = "radar_baixa_confianca";
      motivo = "radar_baixa_confianca";
    }
  } else if (radar.invalido || radar.nome !== "ausente") {
    statusComparacaoPreco = "radar_invalido";
    motivo = "radar_preco_invalido";
  }

  return {
    precoPublicacao,
    origemPreco,
    precoRadar,
    precoImportador,
    confiancaPrecoRadar: radar.confianca,
    divergenciaPercentual,
    statusComparacaoPreco,
    tipoPrecoRadar: radar.tipo,
    campoPrecoRadar: radar.nome,
    marcadorPrecoExplicito: radar.marcadorExplicito,
    tipoCandidato: radar.tipoCandidato,
    marcadorPrecoEscolhido: radar.marcadorPrecoEscolhido,
    possuiCifrao: radar.possuiCifrao === true,
    nivelEvidencia: radar.nivelEvidencia,
    motivos: Array.isArray(radar.motivos) ? radar.motivos : [],
    motivo
  };
}

function resolverCupom({ ofertaImportador = {}, radarMirror = {} } = {}) {
  const cupomRadar = normalizarCupom(radarMirror?.cupom?.codigoCapturado || radarMirror?.comercial?.cupom?.codigo || "");
  const cupomImportador = normalizarCupom(ofertaImportador.cupom || ofertaImportador.codigoCupom || "");
  const confiancaCupomRadar = confianca(radarMirror?.cupom?.confianca || radarMirror?.comercial?.cupom?.confianca || "ausente");
  const textoCupomRadar = textoOuNull(radarMirror?.cupom?.textoCapturado || radarMirror?.comercial?.cupom?.texto || "");
  const instrucaoCupom = textoOuNull(radarMirror?.comercial?.cupom?.instrucao || radarMirror?.cupom?.condicaoCapturada || "");
  const cupomProvavel = radarMirror?.comercial?.cupom?.provavel === true && !cupomRadar;

  if (cupomRadar && ["alta", "media"].includes(confiancaCupomRadar)) {
    return {
      cupomPublicacao: cupomRadar,
      origemCupom: "radar",
      cupomRadar,
      cupomImportador,
      confiancaCupomRadar,
      textoCupomRadar,
      instrucaoCupom,
      cupomProvavel
    };
  }

  return {
    cupomPublicacao: cupomImportador,
    origemCupom: cupomImportador ? "importador" : "ausente",
    cupomRadar,
    cupomImportador,
    confiancaCupomRadar,
    textoCupomRadar,
    instrucaoCupom,
    cupomProvavel
  };
}

function campoCondicao(campo = {}) {
  if (!campo || typeof campo !== "object") return { valor: null, confianca: "ausente" };
  return {
    valor: campo.valor ?? null,
    confianca: campoConfianca(campo),
    evidencia: textoOuNull(campo.evidencia || "")
  };
}

function montarCondicoesComerciais(radarMirror = {}) {
  const comercial = radarMirror?.comercial || {};
  const cupom = comercial.cupom || {};
  return {
    pix: campoCondicao(comercial.precoPix),
    boleto: campoCondicao(comercial.precoBoleto),
    cartao: campoCondicao(comercial.precoCartao),
    parcelamento: {
      quantidade: comercial.parcelamento?.quantidade ?? null,
      valorParcela: precoValido(comercial.parcelamento?.valorParcela) ?? null,
      semJuros: comercial.parcelamento?.semJuros === true,
      confianca: confianca(comercial.parcelamento?.confianca || "ausente")
    },
    cashback: campoCondicao(comercial.cashback),
    freteGratis: campoCondicao(comercial.freteGratis),
    moedas: campoCondicao(comercial.moedasShopee),
    brindes: Array.isArray(comercial.brindes) ? comercial.brindes.filter(Boolean).slice(0, 10) : [],
    descontoPercentual: campoCondicao(comercial.descontoPercentual),
    instrucaoCupom: textoOuNull(cupom.instrucao || radarMirror?.cupom?.condicaoCapturada || ""),
    condicoesEspeciais: Array.isArray(comercial.condicoesEspeciais) ? comercial.condicoesEspeciais.filter(Boolean).slice(0, 20) : []
  };
}

function montarConfiancaComercial(radarMirror = {}, preco = {}, cupom = {}) {
  const comercial = radarMirror?.comercial || {};
  return {
    preco: preco.confiancaPrecoRadar || "ausente",
    cupom: cupom.confiancaCupomRadar || "ausente",
    precoPix: campoConfianca(comercial.precoPix),
    precoBoleto: campoConfianca(comercial.precoBoleto),
    precoCartao: campoConfianca(comercial.precoCartao),
    cashback: campoConfianca(comercial.cashback),
    freteGratis: campoConfianca(comercial.freteGratis),
    marketplace: campoConfianca(comercial.marketplace),
    categoria: campoConfianca(comercial.categoria)
  };
}

function hostSeguro(link = "") {
  try {
    const url = new URL(link);
    return url.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function resumirLinks(radarMirror = {}, ofertaImportador = {}) {
  const links = radarMirror?.links || {};
  const comercialLinks = radarMirror?.comercial?.links || {};
  const produto = links.produtoOriginal || comercialLinks.produto || ofertaImportador.linkOriginal || ofertaImportador.link || null;
  const resgate = links.resgateCupom || comercialLinks.resgate || comercialLinks.cupom || ofertaImportador.linkResgateCupom || null;
  const afiliado = ofertaImportador.linkAfiliado || ofertaImportador.linkFinal || ofertaImportador.linkAfiliadoCliente || null;
  return {
    linkProdutoOriginal: produto,
    linkAfiliado: afiliado,
    linkResgateCupom: resgate,
    classificacao: {
      produtoHost: produto ? hostSeguro(produto) : "",
      resgateHost: resgate ? hostSeguro(resgate) : "",
      afiliadoHost: afiliado ? hostSeguro(afiliado) : "",
      totalEncontrados: Array.isArray(links.encontrados) ? links.encontrados.length : 0,
      adicionais: Array.isArray(links.adicionais) ? links.adicionais.length : 0,
      incertos: Array.isArray(comercialLinks.classificados) ? comercialLinks.classificados.filter(item => item.tipo === "desconhecido").length : 0
    }
  };
}

function precedenciaComercialAtiva(env = process.env) {
  return texto(env?.RADAR_PRECEDENCIA_COMERCIAL_ATIVA).toLowerCase() === "true";
}

function aplicarCamposAtivos(oferta = {}, resolucao = {}) {
  const proxima = { ...oferta };
  if (resolucao.origemPreco === "radar" && resolucao.precoPublicacao !== null) {
    proxima.preco = resolucao.precoPublicacao;
    proxima.precoAtual = resolucao.precoPublicacao;
    proxima.precoPublicacao = resolucao.precoPublicacao;
    proxima.origemPreco = "radar";
    const precoAnteriorRadar = precoValido(resolucao.precoAnteriorRadar);
    if (precoAnteriorRadar !== null) {
      proxima.precoOriginal = precoAnteriorRadar;
      proxima.precoAnterior = precoAnteriorRadar;
    }
  }
  if (resolucao.origemCupom === "radar" && resolucao.cupomPublicacao) {
    proxima.cupom = resolucao.cupomPublicacao;
    proxima.codigoCupom = resolucao.cupomPublicacao;
    proxima.origemCupom = "radar";
    proxima.cupomOrigem = proxima.cupomOrigem || "radar_comercial";
    proxima.cupomDetectadoTexto = true;
  }
  if (resolucao.linkProdutoOriginal) proxima.linkProdutoOriginal = resolucao.linkProdutoOriginal;
  if (resolucao.linkResgateCupom) proxima.linkResgateCupom = proxima.linkResgateCupom || resolucao.linkResgateCupom;
  proxima.condicoesComerciais = resolucao.condicoesComerciais;
  proxima.confiancaComercial = resolucao.confiancaComercial;
  return proxima;
}

function resolverPrecedenciaComercialRadar({ ofertaImportador = {}, radarMirror = null, metadata = {}, clienteId = "", marketplace = "", env = process.env } = {}) {
  const mirror = radarMirror || metadata?.radarMirror || null;
  const metadataBase = metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata : {};
  const ativa = precedenciaComercialAtiva(env);

  if (!mirror || typeof mirror !== "object") {
    return {
      aplicavel: false,
      ativa,
      modo: ativa ? "ativo" : "simulacao",
      oferta: { ...ofertaImportador },
      metadata: { ...metadataBase }
    };
  }

  const cupom = resolverCupom({ ofertaImportador, radarMirror: mirror });
  const cupomRadarConfirmado = cupom.origemCupom === "radar" && Boolean(cupom.cupomRadar) && ["alta", "media"].includes(cupom.confiancaCupomRadar);
  const preco = resolverPreco({ ofertaImportador, radarMirror: mirror, cupomRadarConfirmado });
  const links = resumirLinks(mirror, ofertaImportador);
  const condicoesComerciais = montarCondicoesComerciais(mirror);
  const confiancaComercial = montarConfiancaComercial(mirror, preco, cupom);
  const resolucaoPrecoComercial = mirror?.comercial?.resolucaoPreco || {};
  const precoAnteriorRadar = precoValido(mirror?.preco?.anteriorCapturado ?? mirror?.comercial?.precoAntigo?.valor);

  const resolucao = {
    versao: VERSAO_PRECEDENCIA_COMERCIAL,
    modo: ativa ? "ativo" : "simulacao",
    ativa,
    clienteId: texto(clienteId || mirror?.origem?.clienteId || ""),
    marketplace: texto(marketplace || ofertaImportador.marketplace || mirror?.comparacaoImportador?.marketplace || ""),
    precoPublicacao: preco.precoPublicacao,
    origemPreco: preco.origemPreco,
    precoRadar: preco.precoRadar,
    precoImportador: preco.precoImportador,
    precoAnteriorRadar,
    confiancaPrecoRadar: preco.confiancaPrecoRadar,
    divergenciaPercentual: preco.divergenciaPercentual,
    statusComparacaoPreco: preco.statusComparacaoPreco,
    tipoPrecoRadar: preco.tipoPrecoRadar,
    campoPrecoRadar: preco.campoPrecoRadar,
    marcadorPrecoExplicito: preco.marcadorPrecoExplicito,
    tipoCandidatoEscolhido: texto(preco.tipoCandidato || resolucaoPrecoComercial.tipoCandidatoEscolhido || ""),
    marcadorPrecoEscolhido: texto(preco.marcadorPrecoEscolhido || resolucaoPrecoComercial.marcadorPrecoEscolhido || ""),
    possuiCifraoPrecoEscolhido: preco.possuiCifrao === true || resolucaoPrecoComercial.possuiCifraoPrecoEscolhido === true,
    motivosConfiancaPreco: Array.isArray(preco.motivos) && preco.motivos.length ? preco.motivos.slice(0, 12) : (Array.isArray(resolucaoPrecoComercial.motivosConfiancaPreco) ? resolucaoPrecoComercial.motivosConfiancaPreco.slice(0, 12) : []),
    quantidadeCandidatosPreco: Number(resolucaoPrecoComercial.quantidadeCandidatosPreco || 0),
    candidatosRejeitadosPorTipo: resolucaoPrecoComercial.candidatosRejeitadosPorTipo && typeof resolucaoPrecoComercial.candidatosRejeitadosPorTipo === "object" ? resolucaoPrecoComercial.candidatosRejeitadosPorTipo : {},
    motivoPreco: preco.motivo,
    cupomPublicacao: cupom.cupomPublicacao,
    origemCupom: cupom.origemCupom,
    cupomRadar: cupom.cupomRadar,
    cupomImportador: cupom.cupomImportador,
    confiancaCupomRadar: cupom.confiancaCupomRadar,
    textoCupomRadar: cupom.textoCupomRadar,
    instrucaoCupom: cupom.instrucaoCupom,
    cupomProvavel: cupom.cupomProvavel,
    condicoesComerciais,
    confiancaComercial,
    linkProdutoOriginal: links.linkProdutoOriginal,
    linkAfiliado: links.linkAfiliado,
    linkResgateCupom: links.linkResgateCupom,
    linksClassificados: links.classificacao,
    aplicadoEm: new Date().toISOString()
  };

  const metadataResolvida = {
    ...metadataBase,
    precedenciaComercial: resolucao
  };

  const ofertaBase = {
    ...ofertaImportador,
    metadata: metadataResolvida
  };

  return {
    aplicavel: true,
    ativa,
    modo: resolucao.modo,
    resolucao,
    metadata: metadataResolvida,
    oferta: ativa ? aplicarCamposAtivos(ofertaBase, resolucao) : ofertaBase
  };
}

function resumirPrecedenciaComercialLog(resultado = {}) {
  const resolucao = resultado.resolucao || {};
  return {
    versao: resolucao.versao || VERSAO_PRECEDENCIA_COMERCIAL,
    modo: resolucao.modo || (resultado.ativa ? "ativo" : "simulacao"),
    clienteId: resolucao.clienteId || "",
    marketplace: resolucao.marketplace || "",
    origemPreco: resolucao.origemPreco || "ausente",
    precoRadar: resolucao.precoRadar ?? null,
    precoImportador: resolucao.precoImportador ?? null,
    precoPublicacao: resolucao.precoPublicacao ?? null,
    confiancaPrecoRadar: resolucao.confiancaPrecoRadar || "ausente",
    divergenciaPercentual: resolucao.divergenciaPercentual ?? null,
    statusComparacaoPreco: resolucao.statusComparacaoPreco || "",
    origemCupom: resolucao.origemCupom || "ausente",
    cupomRadarPresente: Boolean(resolucao.cupomRadar),
    cupomImportadorPresente: Boolean(resolucao.cupomImportador),
    linkProdutoHost: resolucao.linksClassificados?.produtoHost || "",
    linkResgateHost: resolucao.linksClassificados?.resgateHost || "",
    linkAfiliadoHost: resolucao.linksClassificados?.afiliadoHost || "",
    quantidadeCandidatosPreco: Number(resolucao.quantidadeCandidatosPreco || 0),
    tipoCandidatoEscolhido: resolucao.tipoCandidatoEscolhido || "",
    marcadorPrecoEscolhido: resolucao.marcadorPrecoEscolhido || "",
    possuiCifraoPrecoEscolhido: resolucao.possuiCifraoPrecoEscolhido === true,
    motivosConfiancaPreco: Array.isArray(resolucao.motivosConfiancaPreco) ? resolucao.motivosConfiancaPreco.slice(0, 12) : [],
    candidatosRejeitadosPorTipo: resolucao.candidatosRejeitadosPorTipo && typeof resolucao.candidatosRejeitadosPorTipo === "object" ? resolucao.candidatosRejeitadosPorTipo : {}
  };
}

function deveLogarResumoPrecoSuspeito(resumo = {}) {
  const divergencia = Number(resumo.divergenciaPercentual);
  return Boolean(
    resumo.statusComparacaoPreco === "revisao_semantica" ||
    resumo.statusComparacaoPreco === "radar_invalido" ||
    (Number.isFinite(divergencia) && divergencia >= DIVERGENCIA_PERCENTUAL_SUSPEITA)
  );
}

function deveLogarPrecoSuspeito(resultado = {}) {
  return deveLogarResumoPrecoSuspeito(resumirPrecedenciaComercialLog(resultado));
}

function emitirLogRadarPrecoSuspeito(resultado = {}, etapa = "") {
  const resumo = {
    ...resumirPrecedenciaComercialLog(resultado),
    etapa: texto(etapa || "")
  };
  if (!deveLogarResumoPrecoSuspeito(resumo)) return false;
  console.log("[RADAR-PRECO-SUSPEITO]", JSON.stringify({
    ...resumo,
    motivos: resumo.motivosConfiancaPreco || []
  }));
  return true;
}

function deveLogarDivergenciaComercial(resultado = {}) {
  const resolucao = resultado.resolucao || {};
  return Boolean(
    resolucao.statusComparacaoPreco === "divergente" ||
    (typeof resolucao.divergenciaPercentual === "number" && resolucao.divergenciaPercentual >= DIVERGENCIA_PERCENTUAL_LOG) ||
    (resolucao.cupomRadar && resolucao.cupomImportador && resolucao.cupomRadar !== resolucao.cupomImportador)
  );
}

module.exports = {
  VERSAO_PRECEDENCIA_COMERCIAL,
  precedenciaComercialAtiva,
  resolverPrecedenciaComercialRadar,
  resumirPrecedenciaComercialLog,
  deveLogarDivergenciaComercial,
  deveLogarPrecoSuspeito,
  emitirLogRadarPrecoSuspeito,
  resolverPreco,
  resolverCupom
};
