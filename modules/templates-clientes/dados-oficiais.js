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

function prepararDadosUniversaisTemplate(oferta = {}) {
  const v2 = oferta.inteligenciaUniversalV2 || {};

  return {
    titulo: oferta.titulo || oferta.nome || "",
    marketplace: oferta.marketplace || "",
    precoAtual: oferta.precoAtual ?? oferta.preco,
    precoOriginal: oferta.precoOriginal ?? oferta.precoAntigo,
    economia: oferta.economia ?? oferta.economiaValor ?? oferta.valorEconomia,
    descontoPercentual: oferta.descontoPercentual ?? oferta.desconto,
    categoria: v2.categoria || oferta.categoria || "",
    cupom: oferta.cupom || oferta.cupomCodigo || "",
    cupomTipo: oferta.cupomTipo || oferta.tipoCupom || "",
    beneficios: beneficiosUniversais(oferta, v2),
    valorEfetivo: v2.valorEfetivo ?? oferta.valorEfetivo,
    valorEfetivoOrigem: v2.valorEfetivoOrigem || oferta.valorEfetivoOrigem || "",
    prioridade: v2.prioridade ?? oferta.prioridadeEnvio ?? oferta.prioridadeFila ?? oferta.prioridade,
    score: scoreUniversal(v2.score),
    linkAfiliado: oferta.linkAfiliado || oferta.linkFinal || oferta.link || "",
    imagem: oferta.imagem || ""
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
    beneficioExtraShopee: oferta.beneficioExtraShopee || ""
  };

  const precoFinalConfirmado = valorEfetivoConfirmado(dados);
  dados.precoExibido = precoFinalConfirmado ?? dados.precoAtual;
  dados.fontePrecoExibido = precoFinalConfirmado != null ? "valor_efetivo" : "preco_atual";
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
