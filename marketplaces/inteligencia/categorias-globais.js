const CATEGORIAS_OPTIMUS = [
  "Alimentos e Mercearia",
  "Audio TV",
  "Automotivo",
  "Bebês e Acessórios",
  "Bebidas",
  "Celulares e Smartphones",
  "Computadores e Notebook",
  "Brinquedos e Artigos Infantis",
  "Casa, Móveis e Decoração",
  "Eletrodomésticos",
  "Eletroportáteis",
  "Ferramentas",
  "Limpeza",
  "Eletrônicos",
  "Periféricos",
  "Roupas e Moda Feminina",
  "Roupas e Moda Masculina",
  "Tênis e Chinelos",
  "Gamer e Hardware",
  "Roupas e Calçados Infantil",
  "Pet Shop e Fazendinha",
  "Perfumaria, Farmácia e Beleza",
  "Esporte e Suplementos",
  "Pesca e Camping",
  "Games e Console",
  "Climatização e Ventilação",
  "Iluminação e Elétrica",
  "Diversos"
];

function categoriaExiste(nome) {
  return CATEGORIAS_OPTIMUS.includes(nome);
}

function categoriaSegura(nome, fallback = "Diversos") {
  return categoriaExiste(nome) ? nome : fallback;
}

module.exports = {
  CATEGORIAS_OPTIMUS,
  categoriaExiste,
  categoriaSegura
};