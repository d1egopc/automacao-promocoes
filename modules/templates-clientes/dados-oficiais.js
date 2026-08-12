const {
  normalizarApresentacaoComercial
} = require("./normalizador-apresentacao-comercial");
const {
  normalizarCuponsSemanticos
} = require("../radar/cupom-semantico");
const {
  chaveValorPix,
  numeroMonetarioEmTexto,
  resolverPrecedenciaPrecoPix
} = require("../radar/preco-pix-precedencia");
const {
  resolverContratoComercialFinal
} = require("./contrato-comercial-final");

function texto(valor = "") {
  return String(valor ?? "").trim();
}

function normalizarComparacao(valor = "") {
  return texto(valor)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function normalizarNumero(valor) {
  if (valor == null || valor === "") return null;
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : null;

  const entrada = texto(valor)
    .replace(/R\$/gi, "")
    .replace(/%/g, "")
    .replace(/\s/g, "");
  if (!entrada) return null;

  const temVirgula = entrada.includes(",");
  const temPonto = entrada.includes(".");
  const normalizado = temVirgula && temPonto
    ? entrada.replace(/\./g, "").replace(",", ".")
    : temVirgula
      ? entrada.replace(",", ".")
      : entrada;
  const numero = Number(normalizado);
  return Number.isFinite(numero) ? numero : null;
}

function precoAtualReferencia(oferta = {}, v2 = {}) {
  return numeroMonetarioEmTexto(
    oferta.precoAtual ??
    oferta.precoPor ??
    oferta.preco ??
    v2.precoAtual ??
    v2.precoPor ??
    v2.preco
  );
}

function coletarPixRadarMirror(...fontes) {
  const candidatos = [];
  for (const fonte of fontes) {
    if (!fonte || typeof fonte !== "object") continue;
    const pix = fonte.comercial?.precoPix || fonte.precoPix || fonte.pix || {};
    for (const valor of [
      pix.evidencia,
      pix.texto,
      pix.valorFormatado,
      pix.valor != null ? pix.evidencia || pix.valor : ""
    ]) {
      if (!valor) continue;
      candidatos.push({
        valor,
        evidencia: pix.evidencia || pix.texto || "",
        campo: "radar_mirror.precoPix",
        origem: "radar_mirror",
        papel: "preco_pix",
        papelPixConfiavel: true
      });
    }
  }
  return candidatos;
}

function candidatoPixPublicavel(valor, campo = "", origem = "") {
  return {
    valor,
    campo,
    origem,
    papel: "preco_pix",
    papelPixConfiavel: /\bpix\b/i.test(texto(valor))
  };
}

function textoOriginalComercialOferta(oferta = {}) {
  const metadata = oferta.metadata && typeof oferta.metadata === "object" ? oferta.metadata : {};
  const radarMirror = metadata.radarMirror && typeof metadata.radarMirror === "object" ? metadata.radarMirror : {};
  return texto(
    oferta.textoComercialOriginal ||
    oferta.textoOriginal ||
    metadata.textoComercialOriginal ||
    metadata.textoOriginal ||
    radarMirror.texto?.original ||
    radarMirror.textoOriginal ||
    metadata.radarEspelhoComercial?.radarMirror?.texto?.original ||
    ""
  );
}

function ofertaInformaPixRadar(oferta = {}) {
  if (/\bpix\b/i.test(textoOriginalComercialOferta(oferta))) return true;
  const metadata = oferta.metadata && typeof oferta.metadata === "object" ? oferta.metadata : {};
  const precedencia = metadata.precedenciaComercial || {};
  if (precedencia.camposProtegidos?.precoPix === true) return true;
  return ofertaRadarEspelhoComercial(oferta) &&
    ["alta", "media"].includes(normalizarComparacao(oferta.confiancaComercial?.precoPix || ""));
}

function camposPixPublicaveis(oferta = {}, v2 = {}) {
  const metadata = oferta.metadata || {};
  const precedencia = metadata.precedenciaComercial || {};
  const radarInformaPix = ofertaInformaPixRadar(oferta);
  const radarPixProtegido = precedencia.camposProtegidos?.precoPix === true ||
    (ofertaRadarEspelhoComercial(oferta) && ["alta", "media"].includes(normalizarComparacao(oferta.confiancaComercial?.precoPix || "")));
  const radar = radarPixProtegido
    ? [
      oferta.condicaoPix,
      oferta.precoPix,
      ...coletarPixRadarMirror(oferta.radarMirror, metadata.radarMirror, metadata.radarEspelhoComercial?.radarMirror)
    ]
    : coletarPixRadarMirror(oferta.radarMirror, metadata.radarMirror, metadata.radarEspelhoComercial?.radarMirror);
  const api = radarInformaPix ? [
    candidatoPixPublicavel(v2.condicaoPix, "inteligenciaUniversalV2.condicaoPix", "inteligencia_universal"),
    candidatoPixPublicavel(v2.precoPix, "inteligenciaUniversalV2.precoPix", "inteligencia_universal"),
    candidatoPixPublicavel(oferta.precoPixReferenciaApi, "oferta.precoPixReferenciaApi", "api_referencia"),
    candidatoPixPublicavel(oferta.metadata?.precoPixReferenciaApi, "metadata.precoPixReferenciaApi", "api_referencia"),
    ...(!radarPixProtegido ? [
      candidatoPixPublicavel(oferta.condicaoPix, "oferta.condicaoPix", "oferta"),
      candidatoPixPublicavel(oferta.precoPix, "oferta.precoPix", "oferta")
    ] : [])
  ] : [];
  const resolucao = resolverPrecedenciaPrecoPix({ radar, api });
  const pix = resolucao.precoPix;
  if (!pix) {
    const condicaoSemValor = texto(oferta.condicaoPix || oferta.condicaoPrecoPor || v2.condicaoPix || "");
    if (radarInformaPix && /\bpix\b/i.test(condicaoSemValor) && numeroMonetarioEmTexto(condicaoSemValor) == null && !/desconto/i.test(condicaoSemValor)) {
      return { precoPix: "", condicaoPix: condicaoSemValor, precoPixOrigem: "condicao_preco_por", precoPixAuditoria: resolucao.auditoria };
    }
    return { precoPix: "", condicaoPix: "", precoPixOrigem: resolucao.origem, precoPixAuditoria: resolucao.auditoria };
  }
  const precoAtual = precoAtualReferencia(oferta, v2);
  const mesmoPreco = precoAtual != null && chaveValorPix(pix) === precoAtual.toFixed(2);
  return {
    precoPix: mesmoPreco ? "" : pix,
    condicaoPix: pix,
    precoPixOrigem: resolucao.origem,
    precoPixAuditoria: resolucao.auditoria
  };
}

function scoreUniversal(valor) {
  if (valor && typeof valor === "object") {
    return valor.score ?? valor.valor ?? valor.total ?? null;
  }
  return valor ?? null;
}

function beneficiosUniversais(oferta = {}, v2 = {}) {
  const beneficios = [];

  if (Array.isArray(oferta.beneficios)) beneficios.push(...oferta.beneficios);
  if (Array.isArray(v2.beneficios)) beneficios.push(...v2.beneficios);
  if (oferta.beneficioTexto) beneficios.push(oferta.beneficioTexto);
  if (oferta.avisoCupom) beneficios.push(oferta.avisoCupom);
  if (oferta.ofertaRelampago === true) beneficios.push("Oferta Relampago");
  if (oferta.validade) beneficios.push(oferta.validade);
  if (Array.isArray(oferta.condicoes)) beneficios.push(...oferta.condicoes);
  if (Array.isArray(oferta.observacoes)) beneficios.push(...oferta.observacoes);
  if (Array.isArray(oferta.variantes)) beneficios.push(...oferta.variantes);
  if (Array.isArray(oferta.tamanhos) && oferta.tamanhos.length) beneficios.push(`Tamanhos: ${oferta.tamanhos.join(", ")}`);
  if (Array.isArray(oferta.cores) && oferta.cores.length) beneficios.push(`Cores: ${oferta.cores.join(", ")}`);
  if (oferta.voltagem) beneficios.push(`Voltagem: ${oferta.voltagem}`);
  if (oferta.cashback) beneficios.push(oferta.cashback);

  return [...new Set(beneficios.map(texto).filter(Boolean))].slice(0, 5);
}

function origemValorEfetivoComercial(origem = "") {
  const normalizado = normalizarComparacao(origem);
  return ["cupom", "pix", "app", "cashback", "frete_gratis", "desconto"].some(termo => normalizado.includes(termo));
}

function valorEfetivoConfirmado(campos = {}) {
  const valorEfetivo = normalizarNumero(campos.valorEfetivo);
  const precoAtual = normalizarNumero(campos.precoAtual);

  if (valorEfetivo == null || precoAtual == null || valorEfetivo >= precoAtual) return null;
  if (!origemValorEfetivoComercial(campos.valorEfetivoOrigem)) return null;

  return valorEfetivo;
}

function precoDeOficial(oferta = {}, v2 = {}) {
  const candidatos = [
    oferta.preco_de,
    oferta.precoDe,
    oferta.precoOriginal,
    oferta.precoAntigo,
    oferta.preco_original,
    v2.preco_de,
    v2.precoDe,
    v2.precoOriginal,
    v2.precoAntigo,
    v2.templateInput?.preco_de,
    v2.templateInput?.precoDe,
    v2.templateInput?.precoOriginal,
    v2.templateInput?.precoAntigo,
    oferta.ofertaUniversal?.preco_de,
    oferta.ofertaUniversal?.precoDe,
    oferta.ofertaUniversal?.precoOriginal,
    oferta.ofertaUniversal?.precoAntigo,
    oferta.ofertaUniversal?.comercial?.precoAnterior,
    oferta.comercial?.precoAnterior
  ];

  for (const candidato of candidatos) {
    const numero = normalizarNumero(candidato);
    if (numero != null && numero > 0) return candidato;
  }

  return undefined;
}

function cupomBloqueado(valor = "") {
  const normalizado = normalizarComparacao(valor).replace(/[^a-z0-9]/g, "");
  return [
    "excelente",
    "otimo",
    "bom",
    "boa",
    "regular",
    "medio",
    "media",
    "ruim",
    "baixo",
    "baixa",
    "alto",
    "alta",
    "copiado",
    "cupomcopiado",
    "semcupom",
    "undefined",
    "null",
    "nan"
  ].includes(normalizado);
}

function cupomOficial(oferta = {}, v2 = {}) {
  const candidatosOficiais = [
    v2.cupom,
    v2.cupomCodigo,
    v2.codigoCupom,
    oferta.cupomCodigo,
    oferta.codigoCupom,
    oferta.cupomInfo?.cupom
  ];

  for (const candidato of candidatosOficiais) {
    const cupom = normalizarCuponsSemanticos(candidato)[0] || "";
    if (cupom && !cupomBloqueado(cupom)) return cupom;
  }

  const cupom = normalizarCuponsSemanticos(oferta.cupom)[0] || "";
  if (!cupom || cupomBloqueado(cupom)) return "";

  return cupom;
}

function listaTextoUnica(valores = []) {
  const resultado = [];
  const vistos = new Set();
  for (const valor of Array.isArray(valores) ? valores : []) {
    const item = texto(valor);
    if (!item || cupomBloqueado(item) || vistos.has(item)) continue;
    vistos.add(item);
    resultado.push(item);
  }
  return resultado;
}

function listaObjetosUnica(valores = []) {
  const resultado = [];

  for (const [indice, valor] of (Array.isArray(valores) ? valores : []).entries()) {
    if (!valor || typeof valor !== "object") continue;
    const ordem = Number(valor.ordemCaptura || valor.ordem || indice + 1) || (indice + 1);
    resultado.push({
      ...valor,
      ordemCaptura: ordem,
      ocorrenciaId: texto(valor.ocorrenciaId || valor.idOcorrencia || `link:${ordem}:${indice + 1}`)
    });
  }

  return resultado;
}

function cuponsOficiais(oferta = {}) {
  const multiplos = listaTextoUnica(normalizarCuponsSemanticos([
    ...(Array.isArray(oferta.cupons) ? oferta.cupons : []),
    ...(Array.isArray(oferta.codigosCupom) ? oferta.codigosCupom : [])
  ]));
  if (multiplos.length) return multiplos;

  return listaTextoUnica(normalizarCuponsSemanticos([
    oferta.cupom || "",
    oferta.codigoCupom || "",
    oferta.cupomCodigo || ""
  ]));
}

function ofertaRadarEspelhoComercial(oferta = {}) {
  return oferta.origem === "radar" ||
    oferta.radar === true ||
    oferta.fonteComercial === "radar_espelho_comercial" ||
    oferta.fonteComercial === "radar_mirror" ||
    oferta.metadata?.fonteComercial === "radar_espelho_comercial" ||
    oferta.metadata?.fonteComercial === "radar_mirror" ||
    oferta.metadata?.radarEspelhoComercial?.origem === "radar_mirror" ||
    Boolean(oferta.metadata?.radarEspelhoComercial?.contratoComercial);
}

function prepararDadosUniversaisTemplate(oferta = {}) {
  const v2 = oferta.inteligenciaUniversalV2 || {};
  const pix = camposPixPublicaveis(oferta, v2);
  const precoOriginal = precoDeOficial(oferta, v2);
  const cupons = cuponsOficiais(oferta);
  const radarEspelho = ofertaRadarEspelhoComercial(oferta);
  const cupom = radarEspelho && cupons.length
    ? cupons.join(" ou ")
    : (oferta.cupom || oferta.cupomCodigo || oferta.codigoCupom || "");

  const dados = {
    titulo: oferta.titulo || oferta.nome || "",
    marketplace: oferta.marketplace || "",
    precoAtual: oferta.precoAtual ?? oferta.preco,
    precoOriginal,
    economia: oferta.economia ?? oferta.economiaValor ?? oferta.valorEconomia,
    descontoPercentual: oferta.descontoPercentual ?? oferta.desconto,
    categoria: v2.categoria || oferta.categoria || "",
    cupom,
    cupomTipo: oferta.cupomTipo || oferta.tipoCupom || "",
    instrucaoCupom: oferta.instrucaoCupom || oferta.condicaoCupom || oferta.condicaoComercial || "",
    precoPix: pix.precoPix,
    condicaoPix: pix.condicaoPix,
    precoUnitario: oferta.precoUnitario || oferta.unitarioCapturado || "",
    quantidade: oferta.quantidade || "",
    parcelamento: oferta.parcelamento || "",
    quantidadeParcelas: oferta.quantidadeParcelas || "",
    valorParcela: oferta.valorParcela || "",
    cashback: oferta.cashback || "",
    frete: oferta.frete || oferta.freteTexto || "",
    freteGratis: oferta.freteGratis === true,
    condicoes: listaTextoUnica(oferta.condicoes),
    observacoes: listaTextoUnica(oferta.observacoes),
    variantes: listaTextoUnica(oferta.variantes),
    tamanhos: listaTextoUnica(oferta.tamanhos),
    cores: listaTextoUnica(oferta.cores),
    voltagem: oferta.voltagem || "",
    ofertaRelampago: oferta.ofertaRelampago === true,
    validade: oferta.validade || "",
    beneficios: beneficiosUniversais(oferta, v2),
    oportunidadeVisual: oferta.oportunidadeVisual || v2.oportunidadeVisual || "",
    avaliacao: oferta.avaliacao || oferta.rating || oferta.nota || "",
    rating: oferta.rating,
    nota: oferta.nota,
    quantidadeAvaliacoes: oferta.quantidadeAvaliacoes ?? oferta.totalAvaliacoes ?? oferta.avaliacoes ?? oferta.reviews ?? oferta.reviewCount,
    valorEfetivo: v2.valorEfetivo ?? oferta.valorEfetivo,
    valorEfetivoOrigem: v2.valorEfetivoOrigem || oferta.valorEfetivoOrigem || "",
    prioridade: v2.prioridade ?? oferta.prioridadeEnvio ?? oferta.prioridadeFila ?? oferta.prioridade,
    score: scoreUniversal(v2.score),
    linkAfiliado: oferta.linkAfiliado || oferta.linkFinal || oferta.link || "",
    avisoFinal: oferta.avisoFinal || oferta.avisoAlteracao || oferta.aviso || "",
    imagem: oferta.imagem || "",
    textoComercialOriginal: oferta.textoComercialOriginal || oferta.textoOriginal || "",
    textoComercialCanonico: oferta.textoComercialCanonico || oferta.documentoComercialCanonico || ""
  };

  if (!radarEspelho) return resolverContratoComercialFinal(normalizarApresentacaoComercial(dados, oferta));

  return resolverContratoComercialFinal(normalizarApresentacaoComercial({
    ...dados,
    cupomTexto: oferta.cupomTexto || cupom,
    codigoCupom: cupom,
    codigosCupom: cupons,
    cupons,
    instrucaoCupom: oferta.instrucaoCupom || "",
    beneficioExtra: oferta.beneficioExtra || "",
    condicoes: listaTextoUnica(oferta.condicoes),
    observacoes: listaTextoUnica(oferta.observacoes),
    precoPix: pix.precoPix,
    condicaoPix: pix.condicaoPix,
    precoUnitario: oferta.precoUnitario || oferta.unitarioCapturado || "",
    quantidade: oferta.quantidade || "",
    parcelamento: oferta.parcelamento || "",
    quantidadeParcelas: oferta.quantidadeParcelas || "",
    valorParcela: oferta.valorParcela || "",
    cashback: oferta.cashback || "",
    frete: oferta.frete || oferta.freteTexto || "",
    freteGratis: oferta.freteGratis === true,
    variantes: listaTextoUnica(oferta.variantes),
    tamanhos: listaTextoUnica(oferta.tamanhos),
    cores: listaTextoUnica(oferta.cores),
    voltagem: oferta.voltagem || "",
    ofertaRelampago: oferta.ofertaRelampago === true,
    validade: oferta.validade || "",
    textoComercialCanonico: oferta.textoComercialCanonico || oferta.documentoComercialCanonico || "",
    textoComercialOriginal: oferta.textoComercialOriginal || oferta.textoOriginal || "",
    linksComerciais: listaObjetosUnica(oferta.linksComerciais),
    linksProduto: listaObjetosUnica(oferta.linksProduto),
    linksResgate: listaObjetosUnica(oferta.linksResgate),
    avaliacao: oferta.avaliacao || oferta.rating || oferta.nota || "",
    rating: oferta.rating,
    nota: oferta.nota
  }, oferta));
}

function prepararDadosPersonalizadosTemplate(oferta = {}) {
  const v2 = oferta.inteligenciaUniversalV2 || {};
  const pix = camposPixPublicaveis(oferta, v2);
  const dados = {
    ...prepararDadosUniversaisTemplate(oferta),
    precoAtual: oferta.precoAtual ?? oferta.precoPor ?? oferta.preco,
    precoPor: oferta.precoPor ?? oferta.precoAtual ?? oferta.preco,
    preco: oferta.preco,
    categoriaConfianca: v2.categoriaConfianca ?? oferta.categoriaConfianca,
    confiancaCategoria: v2.confiancaCategoria ?? oferta.confiancaCategoria,
    categoriaGenerica: v2.categoriaGenerica ?? oferta.categoriaGenerica,
    categoriaBaixaConfianca: v2.categoriaBaixaConfianca ?? oferta.categoriaBaixaConfianca,
    baixaConfiancaCategoria: v2.baixaConfiancaCategoria ?? oferta.baixaConfiancaCategoria,
    cupom: cupomOficial(oferta, v2),
    tipoCupom: oferta.tipoCupom || oferta.cupomTipo || "",
    beneficioTexto: oferta.beneficioTexto || "",
    beneficioExtra: oferta.beneficioExtra || "",
    beneficioDetectado: oferta.beneficioDetectado || "",
    avisoCupom: oferta.avisoCupom || "",
    valorEfetivoDetalhes: v2.valorEfetivoDetalhes || oferta.valorEfetivoDetalhes || {},
    score: scoreUniversal(v2.score ?? oferta.score),
    linkFinal: oferta.linkFinal || oferta.linkAfiliado || oferta.link || "",
    link: oferta.link || oferta.linkAfiliado || oferta.linkFinal || "",
    descricaoAdicional: oferta.descricaoAdicional || oferta.descricao || oferta.textoResumo || oferta.mensagemResumo || "",
    descricao: oferta.descricao || "",
    textoResumo: oferta.textoResumo || "",
    mensagemResumo: oferta.mensagemResumo || "",
    parcelamento: oferta.parcelamento || "",
    precoUnitario: oferta.precoUnitario || oferta.unitarioCapturado || "",
    quantidade: oferta.quantidade || "",
    quantidadeParcelas: oferta.quantidadeParcelas || "",
    valorParcela: oferta.valorParcela || "",
    frete: oferta.frete || "",
    freteTexto: oferta.freteTexto || "",
    avisoFrete: oferta.avisoFrete || "",
    freteGratis: oferta.freteGratis === true,
    avaliacao: oferta.avaliacao || oferta.rating || oferta.nota || "",
    rating: oferta.rating,
    nota: oferta.nota,
    quantidadeAvaliacoes: oferta.quantidadeAvaliacoes ?? oferta.totalAvaliacoes ?? oferta.avaliacoes ?? oferta.reviews ?? oferta.reviewCount,
    vendas: oferta.vendas ?? oferta.sales ?? oferta.vendasShopee ?? oferta.totalVendas,
    oportunidadeVisual: oferta.oportunidadeVisual || v2.oportunidadeVisual || "",
    ctaPublico: oferta.ctaPublico || oferta.cta || "Confira aqui:",
    cta: oferta.cta || "",
    avisoPreco: oferta.avisoPreco || oferta.avisoPagamento || oferta.avisoVariacaoPreco || "",
    avisoPagamento: oferta.avisoPagamento || "",
    avisoVariacaoPreco: oferta.avisoVariacaoPreco || "",
    avisoAlteracao: oferta.avisoAlteracao || oferta.aviso || "",
    avisoFinal: oferta.avisoFinal || oferta.avisoAlteracao || oferta.aviso || "",
    aviso: oferta.aviso || "",
    descontoPix: "",
    precoPix: pix.precoPix,
    condicaoPix: pix.condicaoPix,
    condicoes: listaTextoUnica(oferta.condicoes),
    observacoes: listaTextoUnica(oferta.observacoes),
    cashback: oferta.cashback || "",
    variantes: listaTextoUnica(oferta.variantes),
    tamanhos: listaTextoUnica(oferta.tamanhos),
    cores: listaTextoUnica(oferta.cores),
    voltagem: oferta.voltagem || "",
    ofertaRelampago: oferta.ofertaRelampago === true,
    validade: oferta.validade || "",
    textoComercialCanonico: oferta.textoComercialCanonico || oferta.documentoComercialCanonico || "",
    textoComercialOriginal: oferta.textoComercialOriginal || oferta.textoOriginal || "",
    linksComerciais: listaObjetosUnica(oferta.linksComerciais),
    linksProduto: listaObjetosUnica(oferta.linksProduto),
    linksResgate: listaObjetosUnica(oferta.linksResgate),
    beneficioExtraShopee: oferta.beneficioExtraShopee || ""
  };

  dados.precoExibido = dados.precoAtual;
  dados.fontePrecoExibido = "preco_atual";
  return resolverContratoComercialFinal(normalizarApresentacaoComercial(dados, oferta));
}

function prepararDadosOficiaisTemplate(oferta = {}, opcoes = {}) {
  const modo = texto(opcoes.modo);
  if (modo === "universal") return prepararDadosUniversaisTemplate(oferta);
  if (modo === "personalizado") return prepararDadosPersonalizadosTemplate(oferta);

  throw new Error("modo_template_invalido");
}

function diagnosticoDadosOficiaisTemplate(dados = {}) {
  return {
    marketplace: dados.marketplace || "",
    precoOriginal: dados.precoOriginal ?? "",
    precoAtual: dados.precoAtual ?? "",
    valorEfetivo: dados.valorEfetivo ?? "",
    valorEfetivoOrigem: dados.valorEfetivoOrigem || "",
    temCupom: Boolean(dados.cupom),
    fontePrecoExibido: dados.fontePrecoExibido || ""
  };
}

module.exports = {
  prepararDadosOficiaisTemplate,
  diagnosticoDadosOficiaisTemplate,
  valorEfetivoConfirmado
};
