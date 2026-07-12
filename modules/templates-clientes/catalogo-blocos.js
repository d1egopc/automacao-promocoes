const CANAIS_PERMITIDOS = ["whatsapp", "telegram", "social"];

const CATALOGO_BLOCOS = Object.freeze({
  titulo: { tipo: "titulo", nome: "Titulo", campo: "titulo", aceitaVazio: false, ordemPadrao: 10, canais: CANAIS_PERMITIDOS },
  preco_de: { tipo: "preco_de", nome: "Preco de", campo: "precoOriginal", aceitaVazio: false, ordemPadrao: 20, canais: CANAIS_PERMITIDOS },
  preco_por: { tipo: "preco_por", nome: "Preco por", campo: "precoAtual", aceitaVazio: false, ordemPadrao: 30, canais: CANAIS_PERMITIDOS },
  cupom: { tipo: "cupom", nome: "Cupom", campo: "cupom", aceitaVazio: false, ordemPadrao: 40, canais: CANAIS_PERMITIDOS },
  economia: { tipo: "economia", nome: "Economia", campo: "economia", aceitaVazio: false, ordemPadrao: 50, canais: CANAIS_PERMITIDOS },
  cta: { tipo: "cta", nome: "Chamada", campo: "ctaPublico", aceitaVazio: true, ordemPadrao: 60, canais: CANAIS_PERMITIDOS },
  link: { tipo: "link", nome: "Link", campo: "linkAfiliado", aceitaVazio: false, ordemPadrao: 70, canais: CANAIS_PERMITIDOS },
  categoria: { tipo: "categoria", nome: "Categoria", campo: "categoria", aceitaVazio: false, ordemPadrao: 80, canais: CANAIS_PERMITIDOS },
  marketplace: { tipo: "marketplace", nome: "Marketplace", campo: "marketplace", aceitaVazio: false, ordemPadrao: 90, canais: CANAIS_PERMITIDOS }
});

function listarCatalogoBlocos() {
  return Object.values(CATALOGO_BLOCOS).map(item => ({
    tipo: item.tipo,
    nome: item.nome,
    campo: item.campo,
    aceitaVazio: item.aceitaVazio,
    ordemPadrao: item.ordemPadrao,
    canais: [...item.canais]
  }));
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
