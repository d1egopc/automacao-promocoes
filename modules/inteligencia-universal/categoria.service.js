const { classificarCategoriaOferta, categoriaPorNaturezaExplicita } = require("../../marketplaces/inteligencia/classificador-categorias");
const { categoriaExiste } = require("../../marketplaces/inteligencia/categorias-globais");
const { texto } = require("./normalizacao.service");

function categoriaGenerica(categoria = "") {
  const valor = texto(categoria)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();

  return !valor ||
    valor === "mercadolivre" ||
    valor === "ml" ||
    valor === "marketplace" ||
    valor === "geral" ||
    valor === "generica" ||
    valor === "diversos" ||
    valor === "aliexpress" ||
    valor === "amazon" ||
    valor === "shopee" ||
    valor === "awin" ||
    valor === "kabum" ||
    valor === "magalu" ||
    valor === "computadoreescritorio" ||
    valor === "computadoresescritorio";
}

function categoriaOficialAutoritativa(categoria = "") {
  const valor = texto(categoria);
  return Boolean(valor) && categoriaExiste(valor) && !categoriaGenerica(valor);
}

function classificarCategoriaUniversal(ofertaUniversal = {}, contexto = {}) {
  const logs = [];
  const categoriaAtual = texto(ofertaUniversal.categoria);

  // Exceção factual restrita: uma oficina explicitamente de brinquedo não é ferramenta real.
  const categoriaNatureza = categoriaAtual === "Ferramentas"
    ? categoriaPorNaturezaExplicita(ofertaUniversal, contexto.termo || "") : "";
  if (categoriaNatureza) {
    const categoria = classificarCategoriaOferta(ofertaUniversal,
      contexto.termo || ofertaUniversal.titulo || ofertaUniversal.nome || "");
    logs.push({ etapa: "categoria", status: "corrigida", motivo: "natureza_produto_explicita",
      categoriaOriginal: categoriaAtual, categoria });
    return { categoria, origem: "classificador_legado", logs };
  }

  if (categoriaOficialAutoritativa(categoriaAtual)) {
    logs.push({ etapa: "categoria", status: "mantida", motivo: "categoria_declarada_valida", categoria: categoriaAtual });
    return { categoria: categoriaAtual, origem: "declarada", logs };
  }

  if (categoriaAtual) {
    logs.push({
      etapa: "categoria",
      status: "reavaliada",
      motivo: categoriaExiste(categoriaAtual) ? "categoria_declarada_generica" : "categoria_declarada_nao_oficial",
      categoriaOriginal: categoriaAtual
    });
  }

  const categoria = classificarCategoriaOferta(ofertaUniversal, contexto.termo || ofertaUniversal.titulo || "");
  logs.push({ etapa: "categoria", status: "classificada", motivo: "classificador_legado", categoria });

  return { categoria, origem: "classificador_legado", logs };
}

module.exports = {
  classificarCategoriaUniversal,
  categoriaOficialAutoritativa,
  categoriaGenerica
};
