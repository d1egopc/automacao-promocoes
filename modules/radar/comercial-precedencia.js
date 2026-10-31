const { normalizarNumeroMoeda } = require("../../utils/moeda");
const { resolverPrecoSemantico } = require("./preco-semantico");
const {
  normalizarCodigoCupomSemantico,
  normalizarCuponsSemanticos
} = require("./cupom-semantico");

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

function normalizarPapelComercial(valor = "") {
  return texto(valor)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tituloComercialUniversalValido(titulo = "", contexto = {}) {
  const limpo = texto(titulo);
  if (!limpo) return false;
  if (/^\d{1,3}\s*%$/.test(limpo)) return false;
  const n = normalizarPapelComercial(limpo);
  if (!n) return false;
  const semPrefixoDeEtapa = n.replace(/^(?:\d+\s+)+/, "");
  if (/^(?:abra|abrir|acesse|clique|toque|selecione|resgate|ative|siga|participe)\b/.test(semPrefixoDeEtapa) ||
      /^(?:no|na|nos|nas)\b.*\b(?:canto|rodape|aba|menu|opcoes|tela)\b/.test(semPrefixoDeEtapa)) return false;
  // Publicidade de terceiros/administradores não constitui identidade do produto.
  if (/^(?:o cara das ofertas|a equipe de ofertas|o admin(?:istrador)? do grupo|a admin(?:istradora)? do grupo)\b.*\b(?:achou|encontrou|separou|trouxe)\b/.test(semPrefixoDeEtapa)) return false;
  if (
    /^(?:vendido por marketplaces?|vendido por loja oficial (?:no|do) ml|produto amazon|confira na loja|veja o produto)$/.test(n) ||
    /^clique em inicio no rodape do app$/.test(semPrefixoDeEtapa) ||
    /^quem nao resgatar nao consegue usar(?: \d{1,2} \d{2})?$/.test(n) ||
    /^valido no site quase todo(?: poucas lojas nao aceitam)?$/.test(n) ||
    /^caso nao aparece a aba de cupons relampagos procurem pelo banner acima$/.test(n)
  ) return false;
  const compacto = n.replace(/\s+/g, "");
  const marketplace = normalizarPapelComercial(
    typeof contexto === "string" ? contexto : (contexto.marketplace || "")
  );
  const cuponsContexto = new Set((Array.isArray(contexto?.cupons) ? contexto.cupons : [contexto?.cupom])
    .map(normalizarPapelComercial)
    .map(valor => valor.replace(/\s+/g, ""))
    .filter(Boolean));
  const marketplaceCompacto = marketplace.replace(/\s+/g, "");
  const marketplaces = new Set([
    "amazon",
    "mercado livre",
    "mercadolivre",
    "shopee",
    "aliexpress",
    "ali express",
    "kabum",
    "awin"
  ]);
  const marketplaceDuplicado = n.split(/\s+/).length === 2
    && n.split(/\s+/)[0] === n.split(/\s+/)[1]
    && marketplaces.has(n.split(/\s+/)[0]);
  const tituloBruto = limpo.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const linhaPromocionalCupom = /\b(?:r\$\s*)?\d{1,5}(?:[.,]\d{1,2})?\s*(?:off|de\s+desconto)|\b\d{1,3}\s*%\s*off\b/.test(tituloBruto) &&
    (/\b(?:cupom|voucher|codigo|cod|use|aplique|resgate|a\s+partir\s+de|acima\s+de|compras)\b/.test(tituloBruto) ||
      /^(?:r\$\s*)?\d{1,5}(?:[.,]\d{1,2})?\s*(?:off|de\s+desconto)|^\d{1,3}\s*%\s*off\b/.test(tituloBruto));

  if (marketplaces.has(n) || (marketplaceCompacto && compacto === marketplaceCompacto)) return false;
  if (cuponsContexto.has(compacto)) return false;
  if (marketplaceDuplicado) return false;
  if (linhaPromocionalCupom) return false;
  if (/^(?:amazon|mercado\s*livre|mercadolivre|shopee|ali\s*express|aliexpress)\s+(?:amazon|mercado\s*livre|mercadolivre|shopee|ali\s*express|aliexpress)$/.test(n)) return false;
  if (/^\d{1,3}$/.test(n) && /%/.test(limpo)) return false;
  if (/^(?:cupom|codigo|cod|voucher|resgate|link|links|carrinho|frete|gratis|cashback|score|prioridade|motivo|erro|falha|debug|log|interno)\b/.test(n)) return false;
  if (/^(?:por|de|pix|parcel|avaliacao|beneficio|oferta|desconto)\b/.test(n) && !/\b(?:kit|smart|tenis|produto|tv|fone|monitor|notebook|perfume|whey)\b/.test(n)) return false;
  if (/^[A-Z0-9_-]{4,24}$/.test(limpo) && /[A-Z]/.test(limpo) && /\d/.test(limpo)) return false;
  if (!/[\p{L}\p{N}]/u.test(limpo)) return false;
  return true;
}

function primeiroValorDefinido(...valores) {
  for (const valor of valores) {
    if (valor !== null && valor !== undefined && valor !== "") return valor;
  }
  return null;
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
  return normalizarCodigoCupomSemantico(valor) || normalizarCuponsSemanticos(valor)[0] || null;
}

function normalizarCupons(valor = "") {
  return normalizarCuponsSemanticos(valor);

  const entradas = Array.isArray(valor) ? valor : [valor];
  const bloqueados = new Set(["CUPOM", "CODIGO", "CODE", "APLICAR", "RESGATE", "DESCONTO", "OFERTA", "PROMOCAO", "GRATIS", "FRETE", "CARRINHO", "ANUNCIO", "MENSAGEM", "DETECTADO", "HTTP", "HTTPS", "OU", "E", "OR"]);
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
      if (/(?:^|_)O?CUPOMDE\d/i.test(parte)) continue;
      if (/(ANUNCIO|MENSAGEM|DETECTADO|HTTPS?)/i.test(parte)) continue;
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
  let precoAnteriorComprovado = null;

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
      origemPreco = "radar";
      precoPublicacao = precoRadar;
      statusComparacaoPreco = divergenciaPercentual !== null && divergenciaPercentual >= 0.01 ? "divergente" : "coerente";
      motivo = divergenciaExtrema
        ? (cupomRadarConfirmado ? "divergencia_extrema_com_cupom_confirmado" : "divergencia_extrema_radar_fiel")
        : "radar_media_preco_explicito";
    } else {
      statusComparacaoPreco = "radar_baixa_confianca";
      motivo = "radar_baixa_confianca";
    }
  } else if (radar.invalido || radar.nome !== "ausente") {
    statusComparacaoPreco = "radar_invalido";
    motivo = "radar_preco_invalido";
  }

  // Revalidate the captured evidence, never replace it with a marketplace value.
  const original = texto(radarMirror?.texto?.original || radarMirror?.texto?.limpo || "");
  if (original && precoPublicacao !== null) {
    const semanticaOriginal = original.length <= 20000 ? resolverPrecoSemantico(original) : null;
    const comprovado = semanticaOriginal?.precoAtual || null;
    precoAnteriorComprovado = precoValido(semanticaOriginal?.precoAntigo?.valor);
    if (!comprovado || Math.abs(Number(comprovado.valor) - precoPublicacao) > 0.005) {
      origemPreco = "ausente";
      precoPublicacao = null;
      precoAnteriorComprovado = null;
      statusComparacaoPreco = "radar_invalido";
      motivo = "radar_preco_nao_comprovado_no_original";
    }
  }

  return {
    precoPublicacao,
    origemPreco,
    precoRadar,
    precoImportador,
    precoAnteriorComprovado,
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
  const textoOriginal = texto(radarMirror?.texto?.original || radarMirror?.texto?.limpo || "");
  const cuponsPresentesNoOriginal = new Set(normalizarCuponsSemanticos(textoOriginal));
  const cuponsExplicitosRadar = normalizarCupons([
    ...(Array.isArray(radarMirror?.cupom?.codigosCapturados) ? radarMirror.cupom.codigosCapturados : []),
    ...(Array.isArray(cupomComercial?.codigos) ? cupomComercial.codigos : []),
    ...(Array.isArray(cupomComercial?.cupons) ? cupomComercial.cupons : []),
    radarMirror?.cupom?.codigoCapturado || "",
    cupomComercial?.codigo || ""
  ]).filter(codigo => !textoOriginal || cuponsPresentesNoOriginal.has(codigo));
  const cuponsTextoRadar = cuponsExplicitosRadar.length ? [] : normalizarCupons([
    cupomProvavel ? "" : textoOriginal
  ]);
  const cuponsRadar = [...cuponsExplicitosRadar, ...cuponsTextoRadar];
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

function campoCondicaoProtegido(campo = {}) {
  const condicao = campoCondicao(campo);
  return ["alta", "media"].includes(condicao.confianca) && condicao.valor !== null && condicao.valor !== "";
}

function parcelamentoProtegido(parcelamento = {}) {
  if (!parcelamento || typeof parcelamento !== "object") return false;
  return ["alta", "media"].includes(confianca(parcelamento.confianca || "ausente")) && Boolean(
    texto(parcelamento.evidencia || "") ||
    Number(parcelamento.quantidade || 0) > 0 ||
    precoValido(parcelamento.valorParcela) !== null
  );
}

function montarCondicoesComerciais(radarMirror = {}) {
  const comercial = radarMirror?.comercial || {};
  const cupom = comercial.cupom || {};
  const originalBruto = texto(radarMirror?.texto?.original || radarMirror?.texto?.limpo || "");
  const original = originalBruto.length <= 20000 ? originalBruto : "";
  const semantica = original ? resolverPrecoSemantico(original) : null;
  const normalizarEvidencia = valor => texto(valor)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  const evidencias = Array.isArray(semantica?.candidatos) ? semantica.candidatos : [];
  const numeroNaFonte = valor => {
    const numero = precoValido(valor);
    return numero !== null && evidencias.some(item => {
      const candidato = precoValido(item.valor);
      return candidato !== null && Math.abs(candidato - numero) <= 0.005;
    });
  };
  const textoNaFonte = valor => {
    const trecho = normalizarEvidencia(valor);
    const fonte = normalizarEvidencia(original);
    return Boolean(trecho && fonte.includes(trecho));
  };
  const condicaoValidada = (campo, tipo) => {
    const resultado = campoCondicao(campo);
    if (resultado.valor === null || resultado.valor === "") return resultado;
    const evidencia = texto(campo?.evidencia || "");
    if (textoNaFonte(evidencia)) return resultado;
    let confirmada = false;
    if (tipo === "pix") confirmada = numeroNaFonte(resultado.valor) && /\bpix\b/i.test(original);
    else if (tipo === "boleto") confirmada = numeroNaFonte(resultado.valor) && /\bboleto\b/i.test(original);
    else if (tipo === "cartao") confirmada = numeroNaFonte(resultado.valor) && /\b(?:cart[aã]o|cr[eé]dito)\b/i.test(original);
    else if (tipo === "unitario") confirmada = numeroNaFonte(resultado.valor) && /\b(?:cada|unidade|unit[aá]rio|\/\s*un)\b/i.test(original);
    else if (tipo === "cashback") confirmada = numeroNaFonte(resultado.valor) && /\bcashback\b/i.test(original);
    else if (tipo === "desconto") confirmada = numeroNaFonte(resultado.valor) && /\b(?:off|desconto)\b/i.test(original);
    else if (tipo === "freteGratis") confirmada = resultado.valor === true && /frete\s+gr[aá]tis/i.test(original);
    else if (tipo === "moedas") confirmada = textoNaFonte(evidencia || resultado.valor);
    if (confirmada) return resultado;
    return { ...resultado, valor: null, confianca: "ausente", evidencia: null };
  };
  const parcelamento = comercial.parcelamento || {};
  const parcelaValorComprovado = !parcelamento.valorParcela ||
    (numeroNaFonte(parcelamento.valorParcela) && /\b\d{1,2}\s*x\b|\bparcel/i.test(original));
  const quantidadeParcelasComprovada = !parcelamento.quantidade ||
    new RegExp(`\\b${Number(parcelamento.quantidade)}\\s*x\\b`, "i").test(original);
  const parcelamentoComprovado = textoNaFonte(parcelamento.evidencia || "") ||
    (parcelaValorComprovado && quantidadeParcelasComprovada && Number(parcelamento.quantidade) > 0);
  const condicoesEspeciais = Array.isArray(comercial.condicoesEspeciais)
    ? comercial.condicoesEspeciais.filter(item => textoNaFonte(item)).slice(0, 20)
    : [];
  const brindes = Array.isArray(comercial.brindes)
    ? comercial.brindes.filter(item => textoNaFonte(item)).slice(0, 10)
    : [];
  const instrucaoCupom = texto(cupom.instrucao || radarMirror?.cupom?.condicaoCapturada || "");
  return {
    pix: condicaoValidada(comercial.precoPix, "pix"),
    boleto: condicaoValidada(comercial.precoBoleto, "boleto"),
    cartao: condicaoValidada(comercial.precoCartao, "cartao"),
    unitario: condicaoValidada(comercial.precoUnitario, "unitario"),
    parcelamento: {
      quantidade: parcelamentoComprovado ? (parcelamento.quantidade ?? null) : null,
      valorParcela: parcelamentoComprovado ? (precoValido(parcelamento.valorParcela) ?? null) : null,
      semJuros: parcelamentoComprovado && parcelamento.semJuros === true,
      confianca: parcelamentoComprovado ? confianca(parcelamento.confianca || "ausente") : "ausente",
      evidencia: parcelamentoComprovado ? textoOuNull(parcelamento.evidencia || "") : null
    },
    cashback: condicaoValidada(comercial.cashback, "cashback"),
    freteGratis: condicaoValidada(comercial.freteGratis, "freteGratis"),
    moedas: condicaoValidada(comercial.moedasShopee, "moedas"),
    brindes,
    descontoPercentual: condicaoValidada(comercial.descontoPercentual, "desconto"),
    instrucaoCupom: instrucaoCupom && textoNaFonte(instrucaoCupom) ? instrucaoCupom : null,
    condicoesEspeciais
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
    "precoPor",
    "preco_por",
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
    "cupomTexto",
    "cupomCodigo",
    "cupons",
    "codigosCupom",
    "instrucaoCupom",
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
    "precoUnitario",
    "precoBoleto",
    "precoCartao",
    "cashback",
    "cashbackValor",
    "cashbackPercentual",
    "parcelamento", "quantidadeParcelas", "valorParcela", "frete", "condicaoPix", "descontoPercentual", "descontoPercentualOrigem"
  ]) {
    delete proxima[campo];
  }
  proxima.freteGratis = false;
  proxima.cupomConfirmado = false;
  proxima.possivelCupom = false;
  return proxima;
}

function aplicarRadarMirrorFiel(oferta = {}, resolucao = {}) {
  const proxima = limparCamposComerciaisImportador(oferta);
  // Technical enrichment remains usable; commercial fields are rebuilt only from Radar.
  if (tituloComercialUniversalValido(oferta.titulo || oferta.nome || "")) {
    proxima.titulo = oferta.titulo || oferta.nome;
    proxima.nome = proxima.titulo;
  }
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
  const precoUnitario = valorCondicaoTexto(condicoes.unitario, "Preco unitario");
  const precoBoleto = valorCondicaoTexto(condicoes.boleto, "Preco boleto");
  const precoCartao = valorCondicaoTexto(condicoes.cartao, "Preco cartao");
  const parcelamento = textoParcelamentoRadar(condicoes.parcelamento);
  const cashback = valorCondicaoTexto(condicoes.cashback, "Cashback");
  const freteGratis = condicoes.freteGratis?.valor === true;
  const desconto = valorCondicaoTexto(condicoes.descontoPercentual, "Desconto");
  const frete = valorCondicaoTexto(condicoes.frete, "Frete");
  const moedas = valorCondicaoTexto(condicoes.moedas, "Moedas");

  if (precoPix && resolucao.camposProtegidos?.precoPix) proxima.precoPix = precoPix;
  if (precoPix && resolucao.camposProtegidos?.precoPix) proxima.condicaoPix = precoPix;
  if (precoUnitario && resolucao.camposProtegidos?.precoUnitario) proxima.precoUnitario = precoUnitario;
  if (precoBoleto && resolucao.camposProtegidos?.precoBoleto) proxima.precoBoleto = precoBoleto;
  if (precoCartao && resolucao.camposProtegidos?.precoCartao) proxima.precoCartao = precoCartao;
  if (parcelamento && resolucao.camposProtegidos?.parcelamento) proxima.parcelamento = parcelamento;
  if (cashback && resolucao.camposProtegidos?.cashback) proxima.cashback = cashback;
  if (freteGratis && resolucao.camposProtegidos?.freteGratis) proxima.freteGratis = true;
  if (frete && resolucao.camposProtegidos?.frete) proxima.frete = frete;
  if (moedas && resolucao.camposProtegidos?.moedas) {
    proxima.moedas = moedas;
    proxima.moedasTexto = moedas;
  }
  if (desconto && resolucao.camposProtegidos?.descontoPercentual) proxima.descontoRadar = desconto;

  if (resolucao.linkProdutoOriginal) proxima.linkProdutoOriginal = resolucao.linkProdutoOriginal;
  if (resolucao.linkResgateCupom) proxima.linkResgateCupom = resolucao.linkResgateCupom;
  proxima.condicoesComerciais = resolucao.condicoesComerciais;
  proxima.confiancaComercial = resolucao.confiancaComercial;
  proxima.fonteComercial = "radar_mirror";
  proxima.textoComercialOriginal = resolucao.textoComercialOriginal || proxima.textoComercialOriginal;
  return proxima;
}

function extrairRadarMirrorFidelidade(oferta = {}, metadata = {}) {
  const metadataOferta = oferta.metadata && typeof oferta.metadata === "object" ? oferta.metadata : {};
  const fontes = [metadata, metadataOferta, oferta].filter(item => item && typeof item === "object");
  for (const fonte of fontes) {
    if (fonte.radarMirror && typeof fonte.radarMirror === "object") return fonte.radarMirror;
    if (fonte.radarEspelhoComercial?.radarMirror && typeof fonte.radarEspelhoComercial.radarMirror === "object") {
      return fonte.radarEspelhoComercial.radarMirror;
    }
  }
  return null;
}

function identidadeOficialRadarConfirmada(oferta = {}, metadata = {}) {
  const metadataOferta = oferta.metadata && typeof oferta.metadata === "object" ? oferta.metadata : {};
  const fontes = [metadata, metadataOferta, oferta].filter(item => item && typeof item === "object");
  for (const fonte of fontes) {
    const ml = fonte.identidadeCanonicaMl || fonte.revalidacaoMeliLa;
    if (ml?.status === "consistente" && (
      (ml.mlbForteConfirmado === true && Boolean(ml.mlbProduto) && ml.mlbProduto === ml.mlbRevalidado) ||
      (ml.transporteShowProductConfirmado === true && Boolean(ml.urlCanonicaRevalidada))
    )) return true;

    const shopee = fonte.identidadeProdutoValidada || fonte.produto?.identidadeProdutoValidada;
    if (shopee?.fonte === "api.productOfferV2" && String(shopee.shopId || "").trim() && String(shopee.itemId || "").trim()) {
      return true;
    }
  }
  return false;
}

function validarFidelidadeComercialRadar(oferta = {}, metadata = oferta.metadata || {}) {
  const metadataOferta = oferta.metadata && typeof oferta.metadata === "object" ? oferta.metadata : {};
  const metadados = metadata && typeof metadata === "object" ? { ...metadataOferta, ...metadata } : metadataOferta;
  const mirror = extrairRadarMirrorFidelidade(oferta, metadados);
  const origem = texto(metadados?.origemFluxo || oferta.origemFluxo || oferta.origem).toLowerCase();
  const fonteComercial = texto(metadados?.fonteComercial || oferta.fonteComercial).toLowerCase();
  const origemMirror = texto(metadados?.radarEspelhoComercial?.origem || oferta.metadata?.radarEspelhoComercial?.origem).toLowerCase();
  const sinalRadar = Boolean(
    oferta.radar === true || metadados.radar === true ||
    ["radar", "teleradar", "radar_whatsapp", "radar_telegram"].includes(origem) ||
    ["radar_mirror", "radar_espelho_comercial"].includes(fonteComercial) ||
    origemMirror === "radar_mirror"
  );
  if (!mirror && !sinalRadar) {
    return { aplicavel: false, ok: true, motivos: [] };
  }
  const motivos = [];
  if (!mirror || typeof mirror !== "object") return { aplicavel: true, ok: false, motivos: ["radar_contrato_original_ausente"] };
  const identidadeOficialConfirmada = identidadeOficialRadarConfirmada(oferta, metadados);
  const preco = resolverPreco({ radarMirror: mirror });
  const cupom = resolverCupom({ radarMirror: mirror });
  if (preco.origemPreco !== "radar" || preco.precoPublicacao === null) motivos.push("radar_preco_original_nao_comprovado");
  else {
    for (const campo of ["preco", "precoAtual", "preco_atual", "precoPor", "precoPublicacao", "valor"]) {
      if (oferta[campo] == null || oferta[campo] === "") continue;
      const atual = precoValido(oferta[campo]);
      if (atual === null || Math.abs(atual - preco.precoPublicacao) > 0.005) motivos.push("radar_preco_divergente");
    }
    if (precoValido(oferta.precoAtual ?? oferta.preco) === null) motivos.push("radar_preco_publicacao_ausente");
  }
  const anterior = preco.precoAnteriorComprovado;
  for (const campo of ["precoOriginal", "preco_original", "precoAnterior", "precoAntigo", "precoDe"]) {
    if (oferta[campo] == null || oferta[campo] === "") continue;
    const valor = precoValido(oferta[campo]);
    if (anterior === null) motivos.push("radar_preco_anterior_nao_comprovado");
    else if (valor === null || Math.abs(valor - anterior) > 0.005) motivos.push("radar_preco_anterior_divergente");
  }
  const esperados = normalizarCupons(cupom.cupomPublicacao || "").sort();
  const publicados = normalizarCupons([
    oferta.cupom,
    oferta.codigoCupom,
    oferta.codigo_cupom,
    ...(Array.isArray(oferta.cupons) ? oferta.cupons : []),
    ...(Array.isArray(oferta.codigosCupom) ? oferta.codigosCupom : [])
  ].filter(Boolean));
  if (JSON.stringify([...new Set(publicados)].sort()) !== JSON.stringify(esperados)) motivos.push("radar_cupom_divergente");
  const textoOriginal = texto(mirror.texto?.original || mirror.texto?.limpo || "");
  const textoOriginalNormalizado = normalizarPapelComercial(textoOriginal);
  const instrucaoCupom = texto(oferta.instrucaoCupom || oferta.avisoCupom || oferta.cupomTexto || "");
  if (instrucaoCupom && !textoOriginalNormalizado.includes(normalizarPapelComercial(instrucaoCupom))) {
    motivos.push("radar_instrucao_cupom_divergente");
  }
  const condicoesComerciais = montarCondicoesComerciais(mirror);
  const verificarCondicaoTextual = (campos, esperado) => {
    for (const campo of campos) {
      if (oferta[campo] == null || oferta[campo] === "") continue;
      if (!esperado || normalizarPapelComercial(oferta[campo]) !== normalizarPapelComercial(esperado)) {
        motivos.push("radar_condicao_comercial_divergente");
        return;
      }
    }
  };
  const pixEsperado = condicoesComerciais.pix;
  const pixEsperadoNumero = precoValido(pixEsperado?.valor);
  const fonteTemPix = /\bpix\b/i.test(textoOriginal) && pixEsperadoNumero !== null;
  const verificarPrecoPix = () => {
    const valor = oferta.precoPix;
    if (valor == null || valor === "") return;
    const numero = precoValido(valor);
    const normalizado = normalizarPapelComercial(valor);
    const marcadorPagamentoDivergente = /\b(?:boleto|cartao|credito|debito|parcelad[oa])\b/.test(normalizado);
    if (!fonteTemPix || numero === null || Math.abs(numero - pixEsperadoNumero) > 0.005 || marcadorPagamentoDivergente) {
      motivos.push("radar_condicao_comercial_divergente");
    }
  };
  const verificarRotuloPix = () => {
    const valor = oferta.condicaoPix;
    if (valor == null || valor === "") return;
    const normalizado = normalizarPapelComercial(valor);
    const marcadorPix = /\bpix\b/.test(normalizado);
    const marcadorPagamentoDivergente = /\b(?:boleto|cartao|credito|debito|parcelad[oa])\b/.test(normalizado);
    const numero = precoValido(valor);
    if (!fonteTemPix || !marcadorPix || marcadorPagamentoDivergente ||
        (numero !== null && Math.abs(numero - pixEsperadoNumero) > 0.005)) {
      motivos.push("radar_condicao_comercial_divergente");
    }
  };
  verificarPrecoPix();
  verificarRotuloPix();
  verificarCondicaoTextual(["precoBoleto"], valorCondicaoTexto(condicoesComerciais.boleto, "Preco boleto"));
  verificarCondicaoTextual(["precoCartao"], valorCondicaoTexto(condicoesComerciais.cartao, "Preco cartao"));
  verificarCondicaoTextual(["precoUnitario"], valorCondicaoTexto(condicoesComerciais.unitario, "Preco unitario"));
  verificarCondicaoTextual(["parcelamento"], textoParcelamentoRadar(condicoesComerciais.parcelamento));
  verificarCondicaoTextual(["cashback"], valorCondicaoTexto(condicoesComerciais.cashback, "Cashback"));
  verificarCondicaoTextual(["descontoRadar"], valorCondicaoTexto(condicoesComerciais.descontoPercentual, "Desconto"));
  verificarCondicaoTextual(["moedas", "moedasTexto"], valorCondicaoTexto(condicoesComerciais.moedas, ""));
  if (oferta.freteGratis === true && condicoesComerciais.freteGratis?.valor !== true) {
    motivos.push("radar_condicao_comercial_divergente");
  }
  const condicoesOferta = oferta.condicoesComerciais;
  if (condicoesOferta && typeof condicoesOferta === "object") {
    for (const campo of ["pix", "boleto", "cartao", "unitario", "parcelamento", "cashback", "freteGratis", "moedas", "descontoPercentual"]) {
      const atual = condicoesOferta[campo];
      if (!atual || typeof atual !== "object") continue;
      const esperado = condicoesComerciais[campo];
      if (campo !== "parcelamento" && (atual.valor == null || atual.valor === "")) continue;
      const mesmoValor = campo === "parcelamento"
        ? Boolean(esperado && atual.quantidade === esperado.quantidade &&
          precoValido(atual.valorParcela) === precoValido(esperado.valorParcela) &&
          atual.semJuros === esperado.semJuros)
        : Boolean(esperado && atual.valor === esperado.valor);
      if (!esperado || !mesmoValor ||
          normalizarPapelComercial(atual.evidencia || "") !== normalizarPapelComercial(esperado.evidencia || "")) {
        motivos.push("radar_condicao_comercial_divergente");
        break;
      }
    }
  }
  const tituloOferta = texto(oferta.titulo || oferta.nome || "");
  const tituloRadar = texto(mirror.produto?.tituloCapturado || "");
  if (!tituloComercialUniversalValido(tituloOferta, { cupons: esperados, marketplace: oferta.marketplace })) {
    motivos.push("radar_titulo_operacional_ou_ausente");
  } else if (!tituloComercialUniversalValido(tituloRadar, { cupons: esperados, marketplace: oferta.marketplace }) && !identidadeOficialConfirmada) {
    motivos.push("radar_identidade_titulo_nao_confirmada");
  } else if (tituloComercialUniversalValido(tituloRadar, { cupons: esperados, marketplace: oferta.marketplace }) &&
      normalizarPapelComercial(tituloOferta) !== normalizarPapelComercial(tituloRadar) && !identidadeOficialConfirmada) {
    motivos.push("radar_titulo_divergente_sem_identidade");
  }
  // A cart/checkout is not proof of the product that appeared in the captured message.
  const expandido = texto(oferta.linkExpandido || oferta.link_expandido || metadata.url_expandida || "");
  try {
    if (/^\/(?:cart|checkout)(?:\/|$)/i.test(new URL(expandido).pathname)) motivos.push("radar_identidade_destino_nao_produto");
  } catch { /* Absence is handled by existing marketplace identity gates. */ }
  return { aplicavel: true, ok: motivos.length === 0, motivos: [...new Set(motivos)] };
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
  const precoAnteriorCapturado = precoValido(mirror?.preco?.anteriorCapturado ?? mirror?.comercial?.precoAntigo?.valor);
  const precoAnteriorRadar = precoAnteriorCapturado !== null && preco.precoAnteriorComprovado !== null &&
    Math.abs(precoAnteriorCapturado - preco.precoAnteriorComprovado) <= 0.005
    ? precoAnteriorCapturado
    : null;
  const camposProtegidos = {
    preco: preco.origemPreco === "radar" && preco.precoPublicacao !== null,
    precoAnterior: precoAnteriorRadar !== null,
    cupom: cupom.origemCupom === "radar" && Boolean(cupom.cupomPublicacao),
    instrucaoCupom: Boolean(cupom.instrucaoCupom),
    precoPix: campoCondicaoProtegido(condicoesComerciais.pix),
    precoUnitario: campoCondicaoProtegido(condicoesComerciais.unitario),
    precoBoleto: campoCondicaoProtegido(condicoesComerciais.boleto),
    precoCartao: campoCondicaoProtegido(condicoesComerciais.cartao),
    parcelamento: parcelamentoProtegido(condicoesComerciais.parcelamento),
    cashback: campoCondicaoProtegido(condicoesComerciais.cashback),
    freteGratis: campoCondicaoProtegido(condicoesComerciais.freteGratis),
    frete: campoCondicaoProtegido(condicoesComerciais.freteGratis),
    moedas: campoCondicaoProtegido(condicoesComerciais.moedas),
    descontoPercentual: campoCondicaoProtegido(condicoesComerciais.descontoPercentual)
  };
  const precoReferenciaApi = camposProtegidos.preco
    ? precoValido(primeiroValorDefinido(
      ofertaImportador.precoAtual,
      ofertaImportador.preco,
      ofertaImportador.valor,
      ofertaImportador.metadata?.produto?.precoAtual,
      ofertaImportador.metadata?.produto?.preco
    ))
    : null;
  const parcelamentoReferenciaApi = camposProtegidos.parcelamento
    ? textoOuNull(primeiroValorDefinido(
      ofertaImportador.parcelamento,
      ofertaImportador.metadata?.produto?.parcelamento
    ))
    : null;

  const tituloRadarBruto = textoOuNull(mirror?.produto?.tituloCapturado || "");
  const marketplaceResolucao = texto(marketplace || ofertaImportador.marketplace || mirror?.comparacaoImportador?.marketplace || "");
  const tituloRadar = tituloComercialUniversalValido(tituloRadarBruto || "", { marketplace: marketplaceResolucao, cupons: cupom.cuponsRadar })
    ? tituloRadarBruto
    : null;

  const resolucao = {
    versao: VERSAO_PRECEDENCIA_COMERCIAL,
    modo: "radar_mirror_fiel",
    politicaAutoridade: "radar_comercial_explicito_maior_que_api",
    ativa,
    fonteComercial: "radar_mirror",
    clienteId: texto(clienteId || mirror?.origem?.clienteId || ""),
    marketplace: marketplaceResolucao,
    tituloRadar,
    tituloRadarRejeitado: tituloRadar ? null : tituloRadarBruto,
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
    camposProtegidos,
    referenciasImportador: {
      precoReferenciaApi,
      parcelamentoReferenciaApi,
      cupomReferenciaApi: camposProtegidos.cupom ? cupom.cupomImportador : null
    },
    textoComercialOriginal: textoOuNull(mirror?.texto?.original || ""),
    aplicadoEm: new Date().toISOString()
  };

  const metadataResolvida = {
    ...metadataBase,
    fonteComercial: "radar_mirror",
    precedenciaComercial: resolucao,
    ...(precoReferenciaApi !== null ? { precoReferenciaApi } : {}),
    ...(parcelamentoReferenciaApi ? { parcelamentoReferenciaApi } : {})
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
  resolverCupom,
  extrairRadarMirrorFidelidade,
  validarFidelidadeComercialRadar,
  tituloComercialUniversalValido
};
