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

function scoreUniversal(valor) {
  if (valor && typeof valor === "object") {
    return valor.score ?? valor.valor ?? valor.total ?? null;
  }
  return valor ?? null;
}

function beneficiosUniversais(oferta = {}, v2 = {}) {
  const logs = Array.isArray(v2.logs) ? v2.logs : [];
  const beneficios = [];

  if (Array.isArray(oferta.beneficios)) beneficios.push(...oferta.beneficios);
  if (Array.isArray(v2.beneficios)) beneficios.push(...v2.beneficios);
  if (oferta.beneficioTexto) beneficios.push(oferta.beneficioTexto);
  if (oferta.avisoCupom) beneficios.push(oferta.avisoCupom);
  if (oferta.aviso) beneficios.push(oferta.aviso);
  if (oferta.ofertaRelampago === true) beneficios.push("Oferta Relampago");
  if (oferta.validade) beneficios.push(oferta.validade);
  if (Array.isArray(oferta.condicoes)) beneficios.push(...oferta.condicoes);
  if (Array.isArray(oferta.observacoes)) beneficios.push(...oferta.observacoes);
  if (Array.isArray(oferta.variantes)) beneficios.push(...oferta.variantes);
  if (Array.isArray(oferta.tamanhos) && oferta.tamanhos.length) beneficios.push(`Tamanhos: ${oferta.tamanhos.join(", ")}`);
  if (Array.isArray(oferta.cores) && oferta.cores.length) beneficios.push(`Cores: ${oferta.cores.join(", ")}`);
  if (oferta.voltagem) beneficios.push(`Voltagem: ${oferta.voltagem}`);
  if (oferta.cashback) beneficios.push(oferta.cashback);

  logs.forEach(item => {
    if (typeof item === "string") beneficios.push(item);
    else if (item?.mensagem) beneficios.push(item.mensagem);
    else if (item?.motivo) beneficios.push(item.motivo);
  });

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
    const cupom = texto(candidato);
    if (cupom && !cupomBloqueado(cupom)) return cupom;
  }

  const cupom = texto(oferta.cupom);
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
  const vistos = new Set();

  for (const valor of Array.isArray(valores) ? valores : []) {
    if (!valor || typeof valor !== "object") continue;
    const chave = texto(valor.original || valor.resolvido || valor.afiliado || valor.link || valor.url || "");
    if (!chave || vistos.has(chave)) continue;
    vistos.add(chave);
    resultado.push({ ...valor });
  }

  return resultado;
}

function cuponsOficiais(oferta = {}) {
  const multiplos = listaTextoUnica([
    ...(Array.isArray(oferta.cupons) ? oferta.cupons : []),
    ...(Array.isArray(oferta.codigosCupom) ? oferta.codigosCupom : [])
  ]);
  if (multiplos.length) return multiplos;

  return listaTextoUnica([
    oferta.cupom || "",
    oferta.codigoCupom || "",
    oferta.cupomCodigo || ""
  ]);
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
  const cupons = cuponsOficiais(oferta);
  const radarEspelho = ofertaRadarEspelhoComercial(oferta);
  const cupom = radarEspelho && cupons.length
    ? cupons.join(" ou ")
    : (oferta.cupom || oferta.cupomCodigo || oferta.codigoCupom || "");

  const dados = {
    titulo: oferta.titulo || oferta.nome || "",
    marketplace: oferta.marketplace || "",
    precoAtual: oferta.precoAtual ?? oferta.preco,
    precoOriginal: oferta.precoOriginal ?? oferta.precoAntigo,
    economia: oferta.economia ?? oferta.economiaValor ?? oferta.valorEconomia,
    descontoPercentual: oferta.descontoPercentual ?? oferta.desconto,
    categoria: v2.categoria || oferta.categoria || "",
    cupom,
    cupomTipo: oferta.cupomTipo || oferta.tipoCupom || "",
    beneficios: beneficiosUniversais(oferta, v2),
    valorEfetivo: v2.valorEfetivo ?? oferta.valorEfetivo,
    valorEfetivoOrigem: v2.valorEfetivoOrigem || oferta.valorEfetivoOrigem || "",
    prioridade: v2.prioridade ?? oferta.prioridadeEnvio ?? oferta.prioridadeFila ?? oferta.prioridade,
    score: scoreUniversal(v2.score),
    linkAfiliado: oferta.linkAfiliado || oferta.linkFinal || oferta.link || "",
    imagem: oferta.imagem || ""
  };

  if (!radarEspelho) return dados;

  return {
    ...dados,
    cupomTexto: oferta.cupomTexto || cupom,
    codigoCupom: cupom,
    codigosCupom: cupons,
    cupons,
    instrucaoCupom: oferta.instrucaoCupom || "",
    beneficioExtra: oferta.beneficioExtra || "",
    condicoes: listaTextoUnica(oferta.condicoes),
    observacoes: listaTextoUnica(oferta.observacoes),
    precoPix: oferta.precoPix || v2.precoPix || "",
    condicaoPix: oferta.condicaoPix || oferta.precoPix || v2.precoPix || "",
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
    textoComercialOriginal: oferta.textoComercialOriginal || "",
    linksComerciais: listaObjetosUnica(oferta.linksComerciais),
    linksProduto: listaObjetosUnica(oferta.linksProduto),
    linksResgate: listaObjetosUnica(oferta.linksResgate),
    avaliacao: oferta.avaliacao || oferta.rating || oferta.nota || "",
    rating: oferta.rating,
    nota: oferta.nota
  };
}

function prepararDadosPersonalizadosTemplate(oferta = {}) {
  const v2 = oferta.inteligenciaUniversalV2 || {};
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
    ctaPublico: oferta.ctaPublico || oferta.cta || "Confira aqui:",
    cta: oferta.cta || "",
    avisoPreco: oferta.avisoPreco || oferta.avisoPagamento || oferta.avisoVariacaoPreco || "",
    avisoPagamento: oferta.avisoPagamento || "",
    avisoVariacaoPreco: oferta.avisoVariacaoPreco || "",
    avisoAlteracao: oferta.avisoAlteracao || oferta.aviso || "",
    aviso: oferta.aviso || "",
    descontoPix: oferta.descontoPix || v2.descontoPix || "",
    precoPix: oferta.precoPix || v2.precoPix || "",
    condicaoPix: oferta.condicaoPix || oferta.precoPix || v2.precoPix || "",
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
    textoComercialOriginal: oferta.textoComercialOriginal || "",
    linksComerciais: listaObjetosUnica(oferta.linksComerciais),
    linksProduto: listaObjetosUnica(oferta.linksProduto),
    linksResgate: listaObjetosUnica(oferta.linksResgate),
    beneficioExtraShopee: oferta.beneficioExtraShopee || ""
  };

  dados.precoExibido = dados.precoAtual;
  dados.fontePrecoExibido = "preco_atual";
  return dados;
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
