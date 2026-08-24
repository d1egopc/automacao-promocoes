const { CATEGORIAS_OPTIMUS } = require("../../marketplaces/inteligencia/categorias-globais");

const FAMILIA_OPORTUNIDADE_V2 = "oportunidade";

const CATEGORIA_PARA_FAMILIA_V2 = Object.freeze({
  "Alimentos e Mercearia": "mercado",
  "Bebidas": "bebidas",
  "Audio TV": "audio_tv",
  "Automotivo": "automotivo",
  "Bebês e Acessórios": "bebe",
  "Celulares e Smartphones": "celulares",
  "Computadores e Notebook": "computadores",
  "Brinquedos e Artigos Infantis": "brinquedos",
  "Casa, Móveis e Decoração": "casa",
  "Eletrodomésticos": "casa_eletro",
  "Eletroportáteis": "cozinha_pratica",
  "Ferramentas": "ferramentas",
  "Limpeza": "limpeza",
  "Eletrônicos": "eletronicos",
  "Periféricos": "perifericos",
  "Roupas e Moda Feminina": "moda",
  "Roupas e Moda Masculina": "moda",
  "Tênis e Chinelos": "calcados",
  "Gamer e Hardware": "gamer",
  "Roupas e Calçados Infantil": "infantil",
  "Pet Shop e Fazendinha": "pet",
  "Perfumaria, Farmácia e Beleza": "beleza",
  "Esporte e Suplementos": "esporte",
  "Pesca e Camping": "pesca_camping",
  "Games e Console": "games",
  "Climatização e Ventilação": "climatizacao",
  "Iluminação e Elétrica": "iluminacao",
  "Diversos": FAMILIA_OPORTUNIDADE_V2
});

function familiaDaCategoriaCopyV2(categoria = "") {
  return CATEGORIA_PARA_FAMILIA_V2[categoria] || FAMILIA_OPORTUNIDADE_V2;
}

function categoriasSemFamiliaCopyV2() {
  return CATEGORIAS_OPTIMUS.filter(categoria => !CATEGORIA_PARA_FAMILIA_V2[categoria]);
}

module.exports = {
  FAMILIA_OPORTUNIDADE_V2,
  CATEGORIA_PARA_FAMILIA_V2,
  familiaDaCategoriaCopyV2,
  categoriasSemFamiliaCopyV2
};
