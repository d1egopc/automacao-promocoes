const OFERTA_PREVIEW_OFICIAL = Object.freeze({
  id: "preview_oficial_templates_v1",
  ofertaUniversal: true,
  versaoOfertaUniversal: "v2-preview-template-cliente",
  titulo: "Kit 4 Caixas Sabonetes Natura Tododia",
  nome: "Kit 4 Caixas Sabonetes Natura Tododia",
  marketplace: "Amazon",
  loja: "Amazon",
  categoria: "Beleza e cuidados pessoais",
  precoOriginal: 79.9,
  precoAntigo: 79.9,
  precoAtual: 49.9,
  preco: 49.9,
  valorEfetivo: 44.9,
  valorEfetivoOrigem: "cupom",
  economia: 30,
  economiaValor: 30,
  descontoPercentual: 38,
  desconto: 38,
  cupom: "PROMO10",
  cupomCodigo: "PROMO10",
  avisoCupom: "Cupom disponivel na pagina. Resgate antes de finalizar.",
  beneficioTexto: "Frete gratis para membros Prime",
  beneficioExtra: "Frete gratis para membros Prime",
  beneficios: ["Frete gratis para membros Prime"],
  descricaoAdicional: "Oferta demonstrativa para preview da biblioteca de templates.",
  parcelamento: "Ou 3x de R$ 16,63 sem juros",
  freteGratis: true,
  freteTexto: "Frete gratis",
  avaliacao: "4,8/5",
  quantidadeAvaliacoes: 1240,
  vendas: 5200,
  score: 92,
  avisoPreco: "Preco promocional por tempo limitado.",
  avisoAlteracao: "Oferta sujeita a alteracao de preco.",
  aviso: "Oferta sujeita a alteracao de preco.",
  ctaPublico: "Confira aqui:",
  linkAfiliado: "https://optimuspromo.com.br/oferta/preview-template",
  linkFinal: "https://optimuspromo.com.br/oferta/preview-template",
  imagem: "https://optimuspromo.com.br/assets/preview-template.jpg"
});

function obterOfertaPreviewOficial() {
  return JSON.parse(JSON.stringify(OFERTA_PREVIEW_OFICIAL));
}

module.exports = {
  OFERTA_PREVIEW_OFICIAL,
  obterOfertaPreviewOficial
};
