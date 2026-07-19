const { classificarCategoriaOferta } = require("../../marketplaces/inteligencia/classificador-categorias");
const { texto } = require("./normalizacao.service");

function categoriaGenerica(categoria = "") {
  const valor = texto(categoria)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();

  return !valor || valor === "mercadolivre" || valor === "ml" || valor === "marketplace" || valor === "geral" || valor === "generica";
}

function classificarCategoriaUniversal(ofertaUniversal = {}, contexto = {}) {
  const logs = [];
  const categoriaAtual = texto(ofertaUniversal.categoria);

  if (!categoriaGenerica(categoriaAtual)) {
    logs.push({ etapa: "categoria", status: "mantida", motivo: "categoria_declarada_valida", categoria: categoriaAtual });
    return { categoria: categoriaAtual, origem: "declarada", logs };
  }

  const categoria = classificarCategoriaOferta(ofertaUniversal, contexto.termo || ofertaUniversal.titulo || "");
  logs.push({ etapa: "categoria", status: "classificada", motivo: "classificador_legado", categoria });

  return { categoria, origem: "classificador_legado", logs };
}

module.exports = {
  classificarCategoriaUniversal,
  categoriaGenerica
};
