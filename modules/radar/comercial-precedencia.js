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
  return normalizarCupons(valor)[0] || null;
}

function normalizarCupons(valor = "") {
  const entradas = Array.isArray(valor) ? valor : [valor];
  const bloqueados = new Set(["CUPOM", "CODIGO", "CODE", "APLICAR", "RESGATE", "DESCONTO", "OFERTA", "PROMOCAO", "GRATIS", "FRETE", "CARRINHO", "OU", "E", "OR"]);
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

function textoCupons(cupons = []) {
  return Array.isArray(cupons) && cupons.length ? cupons.join(" ou ") : "";
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
    { nome: "precoAtual", valor: radarMirror?.preco?.atualCapturado, confianca: radarMirror?.preco?.confianca, campo: comercial.precoAtual || {}, tipo: comercial.precoAtual?.tipo || radarMirror?.preco?.tipoCapturado || "atual" }
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
  let origemPreco = "ausente";
  let precoPublicacao = null;
  let statusComparacaoPreco = "sem_radar";
  let motivo = "radar_ausente";

  if (precoRadar !== null) {
    const divergenciaExtrema = divergenciaPercentual !== null && divergenciaPercentual >= DIVERGENCIA_PERCENTUAL_SUSPEITA;
    if (radar.confianca === "alta" || (radar.confianca === "media" && radar.marcadorExplicito)) {
      const evidenciaSemanticaForte = radar.nivelEvidencia === "alta" || radar.nivelEvidencia === "ausente" || !radar.nivelEvidencia;
      const evidenciaAceita = radar.confianca === "media" || evidenciaSemanticaForte || radar.marcadorExplicito;
      if (evidenciaAceita) {
        origemPreco = "radar";
        precoPublicacao = precoRadar;
        statusComparacaoPreco = divergenciaPercentual !== null && divergenciaPercentual >= 0.01 ? "divergente" : "coerente";
        motivo = divergenciaExtrema
          ? (cupomRadarConfirmado ? "divergencia_extrema_com_cupom_confirmado" : "divergencia_extrema_radar_fiel")
          : (radar.confianca === "alta" ? "radar_alta_confianca" : "radar_media_com_marcador");
      } else {
        statusComparacaoPreco = "revisao_semantica";
        motivo = "radar_evidencia_fraca";
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
  const cupomComercial = radarMirror?.comercial?.cupom || {};
  const cupomProvavel = cupomComercial.provavel === true;
  const cuponsRadar = normalizarCupons([
    ...(Array.isArray(radarMirror?.cupom?.codigosCapturados) ? radarMirror.cupom.codigosCapturados : []),
    ...(Array.isArray(cupomComercial?.codigos) ? cupomComercial.codigos : []),
    ...(Array.isArray(cupomComercial?.cupons) ? cupomComercial.cupons : []),
    radarMirror?.cupom?.codigoCapturado || "",
    cupomComercial?.codigo || "",
    cupomProvavel ? "" : (radarMirror?.cupom?.textoCapturado || ""),
    cupomProvavel ? "" : (radarMirror?.cupom?.condicaoCapturada || ""),
    cupomProvavel ? "" : (cupomComercial?.texto || ""),
    cupomProvavel ? "" : (cupomComercial?.instrucao || ""),
    cupomProvavel ? "" : (cupomComercial?.evidencia || "")
  ]);
  const cupomRadar = cuponsRadar[0] || null;
  const cupomPublicacao = textoCupons(cuponsRadar);
  const cupomImportador = normalizarCupom(ofertaImportador.cupom || ofertaImportador.codigoCupom || "");
  const confiancaCupomRadar = confianca(radarMirror?.cupom?.confianca || radarMirror?.comercial?.cupom?.confianca || "ausente");
  const textoCupomRadar = textoOuNull(radarMirror?.cupom?.textoCapturado || radarMirror?.comercial?.cupom?.texto || "");
  const instrucaoCupom = textoOuNull(radarMirror?.comercial?.cupom?.instrucao || radarMirror?.cupom?.condicaoCapturada || "");

  if (cupomRadar && !cupomProvavel && ["alta", "media"].includes(confiancaCupomRadar)) {
    return {
      cupomPublicacao,
      origemCupom: "radar",
      cupomRadar,
      cuponsRadar,
      cupomImportador,
      confiancaCupomRadar,
      textoCupomRadar,
      instrucaoCupom,
      cupomProvavel
    };
  }

  return {
    cupomPublicacao: null,
    origemCupom: "ausente",
    cupomRadar,
    cuponsRadar,
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
      confianca: confianca(comercial.parcelamento?.confianca || "ausente"),
      evidencia: textoOuNull(comercial.parcelamento?.evidencia || "")
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

function valorCondicaoTexto(condicao = {}, fallback = "") {
  if (!condicao || typeof condicao !== "object") return "";
  const valor = condicao.valor;
  if (valor === null || valor === undefined || valor === "" || valor === false) return "";
  return texto(condicao.evidencia || fallback || valor);
}

function formatarMoedaBRL(valor) {
  const numero = precoValido(valor);
  if (numero === null) return "";
  return numero.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function textoParcelamentoRadar(parcelamento = {}) {
  if (!parcelamento || typeof parcelamento !== "object") return "";
  const evidencia = texto(parcelamento.evidencia || "");
  if (evidencia) return evidencia;
  const quantidade = Number(parcelamento.quantidade || 0);
  const valorParcela = formatarMoedaBRL(parcelamento.valorParcela);
  if (!quantidade || !valorParcela) return "";
  return `${valorParcela} em ate ${quantidade}x${parcelamento.semJuros ? " sem juros" : ""}`;
}

function limparCamposComerciaisImportador(oferta = {}) {
  const proxima = { ...oferta };
  for (const campo of [
    "titulo",
    "nome",
    "descricao",
    "preco",
    "preco_atual",
    "precoAtual",
    "precoPublicacao",
    "preco_publicacao",
    "precoOriginal",
    "preco_original",
    "precoAnterior",
    "preco_anterior",
    "precoAntigo",
    "preco_antigo",
    "precoDe",
    "preco_de",
    "valor",
    "cupom",
    "codigoCupom",
    "codigo_cupom",
    "avisoCupom",
    "aviso_cupom",
    "tipoCupom",
    "cupomTipo",
    "cupom_tipo",
    "valorCupom",
    "cupomValor",
    "valor_cupom",
    "cupom_valor",
    "percentualCupom",
    "cupomPercentual",
    "percentual_cupom",
    "cupom_percentual",
    "beneficioExtra",
    "beneficioTexto",
    "descricaoBeneficio",
    "descontoPix",
    "descontoApp",
    "precoPix",
    "precoBoleto",
    "precoCartao",
    "cashback",
    "cashbackValor",
    "cashbackPercentual"
  ]) {
    delete proxima[campo];
  }
  proxima.freteGratis = false;
  proxima.cupomConfirmado = false;
  proxima.possivelCupom = false;
  return proxima;
}

function aplicarRadarMirrorFiel(oferta = {}, resolucao = {}) {
  const proxima = { ...oferta };
  const condicoes = resolucao.condicoesComerciais || {};

  if (resolucao.tituloRadar) {
    proxima.titulo = resolucao.tituloRadar;
    proxima.nome = resolucao.tituloRadar;
  }

  if (resolucao.origemPreco === "radar" && resolucao.precoPublicacao !== null) {
    proxima.preco = resolucao.precoPublicacao;
    proxima.precoAtual = resolucao.precoPublicacao;
    proxima.preco_atual = resolucao.precoPublicacao;
    proxima.precoPublicacao = resolucao.precoPublicacao;
    proxima.origemPreco = "radar";
    const precoAnteriorRadar = precoValido(resolucao.precoAnteriorRadar);
    if (precoAnteriorRadar !== null && precoAnteriorRadar > resolucao.precoPublicacao) {
      proxima.precoOriginal = precoAnteriorRadar;
      proxima.precoAnterior = precoAnteriorRadar;
      proxima.preco_original = precoAnteriorRadar;
    }
  }

  if (resolucao.origemCupom === "radar" && resolucao.cupomPublicacao) {
    proxima.cupom = resolucao.cupomPublicacao;
    proxima.codigoCupom = resolucao.cupomPublicacao;
    proxima.codigo_cupom = resolucao.cupomPublicacao;
    proxima.cupons = Array.isArray(resolucao.cuponsRadar) ? [...resolucao.cuponsRadar] : [];
    proxima.codigosCupom = Array.isArray(resolucao.cuponsRadar) ? [...resolucao.cuponsRadar] : [];
    proxima.cupomTexto = resolucao.textoCupomRadar || resolucao.cupomPublicacao;
    proxima.instrucaoCupom = resolucao.instrucaoCupom || resolucao.textoCupomRadar || "";
    proxima.origemCupom = "radar";
    proxima.cupomOrigem = proxima.cupomOrigem || "radar_comercial";
    proxima.cupomDetectadoTexto = true;
    proxima.cupomConfirmado = true;
    proxima.possivelCupom = false;
    proxima.avisoCupom = resolucao.instrucaoCupom || resolucao.textoCupomRadar || "";
  } else {
    proxima.origemCupom = "ausente";
    proxima.cupomConfirmado = false;
    proxima.possivelCupom = false;
  }

  const precoPix = valorCondicaoTexto(condicoes.pix, "Preco PIX");
  const precoBoleto = valorCondicaoTexto(condicoes.boleto, "Preco boleto");
  const precoCartao = valorCondicaoTexto(condicoes.cartao, "Preco cartao");
  const parcelamento = textoParcelamentoRadar(condicoes.parcelamento);
  const cashback = valorCondicaoTexto(condicoes.cashback, "Cashback");
  const freteGratis = condicoes.freteGratis?.valor === true;
  const desconto = valorCondicaoTexto(condicoes.descontoPercentual, "Desconto");

  if (precoPix) proxima.precoPix = precoPix;
  if (precoPix) proxima.condicaoPix = precoPix;
  if (precoBoleto) proxima.precoBoleto = precoBoleto;
  if (precoCartao) proxima.precoCartao = precoCartao;
  if (parcelamento) proxima.parcelamento = parcelamento;
  if (cashback) proxima.cashback = cashback;
  if (freteGratis) proxima.freteGratis = true;
  if (desconto) proxima.descontoRadar = desconto;

  if (resolucao.linkProdutoOriginal) proxima.linkProdutoOriginal = resolucao.linkProdutoOriginal;
  if (resolucao.linkResgateCupom) proxima.linkResgateCupom = resolucao.linkResgateCupom;
  proxima.condicoesComerciais = resolucao.condicoesComerciais;
  proxima.confiancaComercial = resolucao.confiancaComercial;
  proxima.fonteComercial = "radar_mirror";
  proxima.textoComercialOriginal = resolucao.textoComercialOriginal || proxima.textoComercialOriginal;
  return proxima;
}

function resolverPrecedenciaComercialRadar({ ofertaImportador = {}, radarMirror = null, metadata = {}, clienteId = "", marketplace = "" } = {}) {
  const mirror = radarMirror || metadata?.radarMirror || null;
  const metadataBase = metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata : {};
  const ativa = Boolean(mirror && typeof mirror === "object");

  if (!mirror || typeof mirror !== "object") {
    return {
      aplicavel: false,
      ativa: false,
      modo: "inaplicavel",
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
    modo: "radar_mirror_fiel",
    ativa,
    fonteComercial: "radar_mirror",
    clienteId: texto(clienteId || mirror?.origem?.clienteId || ""),
    marketplace: texto(marketplace || ofertaImportador.marketplace || mirror?.comparacaoImportador?.marketplace || ""),
    tituloRadar: textoOuNull(mirror?.produto?.tituloCapturado || ""),
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
    cuponsRadar: cupom.cuponsRadar,
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
    textoComercialOriginal: textoOuNull(mirror?.texto?.original || ""),
    aplicadoEm: new Date().toISOString()
  };

  const metadataResolvida = {
    ...metadataBase,
    fonteComercial: "radar_mirror",
    precedenciaComercial: resolucao
  };

  const ofertaBase = limparCamposComerciaisImportador({
    ...ofertaImportador,
    metadata: metadataResolvida
  });

  return {
    aplicavel: true,
    ativa,
    modo: resolucao.modo,
    resolucao,
    metadata: metadataResolvida,
    oferta: aplicarRadarMirrorFiel(ofertaBase, resolucao)
  };
}

function resumirPrecedenciaComercialLog(resultado = {}) {
  const resolucao = resultado.resolucao || {};
  return {
    versao: resolucao.versao || VERSAO_PRECEDENCIA_COMERCIAL,
    modo: resolucao.modo || (resultado.ativa ? "radar_mirror_fiel" : "inaplicavel"),
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
  resolverPrecedenciaComercialRadar,
  resumirPrecedenciaComercialLog,
  deveLogarDivergenciaComercial,
  deveLogarPrecoSuspeito,
  emitirLogRadarPrecoSuspeito,
  resolverPreco,
  resolverCupom
};
