const CAMPOS_OFERTA_UNIVERSAL_SOCIAL = [
  "titulo",
  "marketplace",
  "categoria",
  "precoAtual",
  "precoOriginal",
  "valorEfetivo",
  "cupom",
  "score",
  "prioridade",
  "linkAfiliado",
  "imagem"
];

function payloadTemplateSocialPadrao() {
  return {
    nome: "",
    rede: "instagram",
    formato: "post",
    conteudo: "",
    camposOfertaUniversal: CAMPOS_OFERTA_UNIVERSAL_SOCIAL
  };
}

module.exports = {
  CAMPOS_OFERTA_UNIVERSAL_SOCIAL,
  payloadTemplateSocialPadrao
};
