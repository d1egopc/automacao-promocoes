const CANAIS_PERMITIDOS = ["whatsapp", "telegram", "social"];

function bloco({
  tipo,
  nomeVisual,
  descricaoVisual,
  campoOrigem,
  ordemPadrao,
  ativoPorPadrao = true,
  emojiPadrao = "",
  regraVazio = "ocultar_sem_dados",
  dependencias = [],
  aceitaVazio = false,
  canais = CANAIS_PERMITIDOS
}) {
  return {
    tipo,
    nome: nomeVisual,
    nomeVisual,
    descricaoVisual,
    campo: campoOrigem,
    campoOrigem,
    aceitaVazio,
    ordemPadrao,
    ativoPorPadrao,
    emojiPadrao,
    regraVazio,
    dependencias,
    canais,
    canaisCompativeis: canais
  };
}

const CATALOGO_BLOCOS = Object.freeze({
  titulo: bloco({
    tipo: "titulo",
    nomeVisual: "Titulo",
    descricaoVisual: "Nome principal da oferta.",
    campoOrigem: "titulo|nome",
    ordemPadrao: 10,
    emojiPadrao: "🔥"
  }),
  marketplace: bloco({
    tipo: "marketplace",
    nomeVisual: "Marketplace",
    descricaoVisual: "Loja ou marketplace da oferta.",
    campoOrigem: "marketplace|loja",
    ordemPadrao: 20,
    emojiPadrao: "🛍️"
  }),
  categoria: bloco({
    tipo: "categoria",
    nomeVisual: "Categoria",
    descricaoVisual: "Categoria classificada para a oferta.",
    campoOrigem: "categoria",
    ordemPadrao: 30,
    emojiPadrao: "📂"
  }),
  preco_de: bloco({
    tipo: "preco_de",
    nomeVisual: "Preco de",
    descricaoVisual: "Preco original quando ja informado pela oferta.",
    campoOrigem: "precoOriginal|precoDe|precoAntigo",
    ordemPadrao: 40,
    emojiPadrao: "❌"
  }),
  preco_por: bloco({
    tipo: "preco_por",
    nomeVisual: "Preco por",
    descricaoVisual: "Preco atual, preco por ou valor efetivo ja preparado.",
    campoOrigem: "valorEfetivo|precoAtual|precoPor|preco",
    ordemPadrao: 50,
    emojiPadrao: "✅"
  }),
  desconto_percentual: bloco({
    tipo: "desconto_percentual",
    nomeVisual: "Desconto percentual",
    descricaoVisual: "Percentual de desconto ja presente na oferta.",
    campoOrigem: "descontoPercentual|desconto",
    ordemPadrao: 60,
    emojiPadrao: "📉"
  }),
  economia: bloco({
    tipo: "economia",
    nomeVisual: "Economia",
    descricaoVisual: "Valor oficial de economia ja calculado no fluxo da oferta.",
    campoOrigem: "economia|valorEconomia|economiaValor",
    ordemPadrao: 70,
    ativoPorPadrao: false,
    emojiPadrao: "💸",
    regraVazio: "ocultar_se_ausente_invalido_ou_zero"
  }),
  cupom: bloco({
    tipo: "cupom",
    nomeVisual: "Cupom",
    descricaoVisual: "Codigo de cupom validado ou detectado.",
    campoOrigem: "cupom|codigoCupom|cupomCodigo",
    ordemPadrao: 80,
    emojiPadrao: "🎟️"
  }),
  frase_cupom: bloco({
    tipo: "frase_cupom",
    nomeVisual: "Frase de cupom",
    descricaoVisual: "Instrucao curta para aplicar o cupom.",
    campoOrigem: "cupom",
    ordemPadrao: 90,
    emojiPadrao: "⚡",
    dependencias: ["cupom"]
  }),
  beneficio: bloco({
    tipo: "beneficio",
    nomeVisual: "Beneficio",
    descricaoVisual: "Beneficio comercial ja preparado, como PIX, app, cashback ou cupom de pagina.",
    campoOrigem: "beneficioTexto|beneficioExtra|avisoCupom|beneficios",
    ordemPadrao: 100,
    emojiPadrao: "⚡"
  }),
  descricao_adicional: bloco({
    tipo: "descricao_adicional",
    nomeVisual: "Descricao adicional",
    descricaoVisual: "Descricao curta ja existente na oferta.",
    campoOrigem: "descricao|descricaoAdicional|textoResumo",
    ordemPadrao: 110,
    ativoPorPadrao: false,
    emojiPadrao: "📝"
  }),
  parcelamento: bloco({
    tipo: "parcelamento",
    nomeVisual: "Parcelamento",
    descricaoVisual: "Texto oficial de parcelamento retornado pelo marketplace.",
    campoOrigem: "parcelamento",
    ordemPadrao: 120,
    emojiPadrao: "💳"
  }),
  frete: bloco({
    tipo: "frete",
    nomeVisual: "Frete",
    descricaoVisual: "Frete gratis ou texto de frete ja informado.",
    campoOrigem: "frete|freteTexto|freteGratis",
    ordemPadrao: 130,
    emojiPadrao: "🚚"
  }),
  avaliacao: bloco({
    tipo: "avaliacao",
    nomeVisual: "Avaliação",
    descricaoVisual: "Avaliação calculada a partir do score oficial da oferta.",
    campoOrigem: "score|inteligenciaUniversalV2.score",
    ordemPadrao: 90,
    ativoPorPadrao: true,
    emojiPadrao: "✰"
  }),
  quantidade_avaliacoes: bloco({
    tipo: "quantidade_avaliacoes",
    nomeVisual: "Quantidade de avaliacoes",
    descricaoVisual: "Quantidade de avaliacoes quando retornada pelo marketplace.",
    campoOrigem: "quantidadeAvaliacoes|avaliacoes|reviews",
    ordemPadrao: 150,
    ativoPorPadrao: false,
    emojiPadrao: "👥",
    dependencias: ["quantidadeAvaliacoes"]
  }),
  vendas: bloco({
    tipo: "vendas",
    nomeVisual: "Vendas",
    descricaoVisual: "Quantidade de vendas ja informada pelo marketplace.",
    campoOrigem: "vendas|sales|vendasShopee",
    ordemPadrao: 160,
    ativoPorPadrao: false,
    emojiPadrao: "🛒"
  }),
  cta: bloco({
    tipo: "cta",
    nomeVisual: "Chamada",
    descricaoVisual: "Chamada para o clique antes do link.",
    campoOrigem: "ctaPublico|cta",
    ordemPadrao: 170,
    aceitaVazio: true,
    emojiPadrao: "🔗"
  }),
  link: bloco({
    tipo: "link",
    nomeVisual: "Link",
    descricaoVisual: "Link afiliado, final ou URL da oferta.",
    campoOrigem: "linkAfiliado|linkFinal|link|url",
    ordemPadrao: 180,
    emojiPadrao: ""
  }),
  aviso_preco: bloco({
    tipo: "aviso_preco",
    nomeVisual: "Aviso de preco",
    descricaoVisual: "Aviso oficial sobre preco, variacao ou pagamento.",
    campoOrigem: "avisoPreco|avisoPagamento|avisoVariacaoPreco",
    ordemPadrao: 190,
    emojiPadrao: "⚠️"
  }),
  aviso_alteracao: bloco({
    tipo: "aviso_alteracao",
    nomeVisual: "Aviso de alteracao",
    descricaoVisual: "Aviso oficial de alteracao de preco ou disponibilidade.",
    campoOrigem: "avisoAlteracao|aviso",
    ordemPadrao: 200,
    emojiPadrao: "⚠️"
  })
});

function serializarCatalogo(item) {
  return {
    tipo: item.tipo,
    nome: item.nome,
    nomeVisual: item.nomeVisual,
    descricaoVisual: item.descricaoVisual,
    campo: item.campo,
    campoOrigem: item.campoOrigem,
    aceitaVazio: item.aceitaVazio,
    ordemPadrao: item.ordemPadrao,
    ativoPorPadrao: item.ativoPorPadrao,
    emojiPadrao: item.emojiPadrao,
    regraVazio: item.regraVazio,
    dependencias: [...item.dependencias],
    canais: [...item.canais],
    canaisCompativeis: [...item.canaisCompativeis]
  };
}

function listarCatalogoBlocos() {
  return Object.values(CATALOGO_BLOCOS).map(serializarCatalogo);
}

function getBlocoCatalogo(tipo = "") {
  return CATALOGO_BLOCOS[String(tipo || "").trim()] || null;
}

function tiposBlocosOficiais() {
  return Object.keys(CATALOGO_BLOCOS);
}

module.exports = {
  CANAIS_PERMITIDOS,
  CATALOGO_BLOCOS,
  listarCatalogoBlocos,
  getBlocoCatalogo,
  tiposBlocosOficiais
};
