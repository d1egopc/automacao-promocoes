const OFERTA_PREVIEW_OFICIAL = Object.freeze({
  id: "preview_oficial_templates_v1",
  ofertaUniversal: true,
  versaoOfertaUniversal: "v2-preview-template-cliente",
  titulo: "Kit 4 Caixas Sabonetes Natura Tododia",
  marketplace: "Amazon",
  categoria: "Beleza e cuidados pessoais",
  precoOriginal: 79.9,
  precoAtual: 49.9,
  economia: 30,
  descontoPercentual: 38,
  cupom: "PROMO10",
  ctaPublico: "Confira aqui:",
  linkAfiliado: "https://optimuspromo.com.br/oferta/preview-template",
  imagem: "https://optimuspromo.com.br/assets/preview-template.jpg"
});

function obterOfertaPreviewOficial() {
  return JSON.parse(JSON.stringify(OFERTA_PREVIEW_OFICIAL));
}

module.exports = {
  OFERTA_PREVIEW_OFICIAL,
  obterOfertaPreviewOficial
};
