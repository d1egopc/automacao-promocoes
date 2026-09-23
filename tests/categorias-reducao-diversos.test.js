const assert = require("assert");
const { CATEGORIAS_OPTIMUS } = require("../marketplaces/inteligencia/categorias-globais");
const { CATEGORIAS_DESTINOS } = require("../marketplaces/inteligencia/categorias-destinos");
const { classificarCategoriaOferta } = require("../marketplaces/inteligencia/classificador-categorias");
const { classificarCategoriaUniversal } = require("../modules/inteligencia-universal/categoria.service");
const { montarOfertaUniversalEngine } = require("../modules/engine/oferta-universal.contract");
const {
  categoriaPermitidaNoDestino,
  destinoAceitaTodasCategorias
} = require("../utils/destinos");

const casos = [
  ["Truss Illuminate Oil | Óleo Capilar Finalizador para Controle de Frizz e Brilho | 60ml", "amazon", "Perfumaria, Farmácia e Beleza"],
  ["KIT 30/20/10/5 Unidades Adesivos Protetores de Ralo Tela Descartável Anti Entupimento e Insetos", "shopee", "Casa, Móveis e Decoração"],
  ["Hidrográfica com 24 Cores Estojo Cartão, Faber-Castell", "amazon", "Papelaria e Livros"],
  ["Kit 5 Formas De Pastel Fogazza Risole Conjunto Keita Salgados", "shopee", "Casa, Móveis e Decoração"],
  ["Puff Gigante Redondo", "shopee", "Casa, Móveis e Decoração"],
  ["Glade Difusor de Ambiente Toque de Maciez", "amazon", "Limpeza"],
  ["Maca Peruana 120 Cápsulas", "mercadolivre", "Esporte e Suplementos"],
  ["Perfume Paco Rabanne One Million", "magalu", "Perfumaria, Farmácia e Beleza"],
  ["Conjunto de 6 Canecas", "mercadolivre", "Casa, Móveis e Decoração"],
  ["Pack Energy Gel Atlhetica Nutrition", "amazon", "Esporte e Suplementos"],
  ["Murdoku: 80 mistérios para resolver usando a lógica", "amazon", "Papelaria e Livros"],
  ["Kit 3 Banquetas Altas Tolix", "mercadolivre", "Casa, Móveis e Decoração"],
  ["Mala de 10kg Bordo com Frasqueira", "mercadolivre", "Casa, Móveis e Decoração"],
  ["Máscara de Tratamento Dove Bond Intense Repair", "magalu", "Perfumaria, Farmácia e Beleza"],
  ["Camiseta Calvin Klein", "mercadolivre", "Roupas e Moda Masculina"],
  ["Papel Higiênico Softys", "magalu", "Limpeza"],
  ["3 Calças de Treino", "mercadolivre", "Diversos"],
  ["Smartwatch Digital Pro Series", "magalu", "Eletrônicos"],
  ["Sebastian Professional Dark Oil Óleo Capilar", "mercadolivre", "Perfumaria, Farmácia e Beleza"],
  ["Lupo Dry camiseta masculina", "mercadolivre", "Roupas e Moda Masculina"],
  ["Under Armour Tribase Cross 2 SE", "mercadolivre", "Tênis e Chinelos"],
  ["Kit 3 Luminárias de Emergência", "mercadolivre", "Iluminação e Elétrica"],
  ["Kit 4 Bermudas", "mercadolivre", "Diversos"],
  ["Conjunto short feminino academia", "mercadolivre", "Roupas e Moda Feminina"],
  ["Fechadura eletrônica", "mercadolivre", "Casa, Móveis e Decoração"],
  ["Camiseta Dark Lab", "mercadolivre", "Roupas e Moda Masculina"],
  ["Palatinose 100% pura", "mercadolivre", "Esporte e Suplementos"],
  ["YoPRO Bebida Láctea", "amazon", "Alimentos e Mercearia"],
  ["Kit Maçarico Portátil com gás butano", "mercadolivre", "Diversos"],
  ["Suporte Articulado a Gás para 2 Monitores", "shopee", "Periféricos"]
];

const logOriginal = console.log;
try {
  console.log = () => {};
  for (const [titulo, marketplace, esperada] of casos) {
    const oferta = {
      titulo, marketplace, categoria: "Diversos",
      precoAtual: 1379, precoAnterior: 2199, cupom: "TESTE",
      linkAfiliado: "https://example.test/workspace", workspaceId: "workspace-a"
    };
    const antes = structuredClone(oferta);
    assert.strictEqual(classificarCategoriaOferta(oferta, titulo), esperada, titulo);
    assert.deepStrictEqual(oferta, antes, "classificação não pode alterar a oferta ou verdade comercial");
  }

  for (const titulo of [
    "THERMO FLAME POR 28 REAIS",
    "Loja Oficial Polo Wear no ML",
    "Loja Oficial Dark Lab no ML",
    "Vendido por Loja Oficial no ML"
  ]) {
    assert.strictEqual(classificarCategoriaOferta({ titulo }, titulo), "Diversos", titulo);
  }
  assert.strictEqual(classificarCategoriaOferta({ titulo: "Murdoku e conjunto de canecas" }), "Diversos",
    "identidades conflitantes não devem escolher categoria por prioridade arbitrária");

  assert.strictEqual(
    classificarCategoriaUniversal({
      titulo: "Suporte Articulado a Gás para 2 Monitores",
      categoria: "Perfumaria, Farmácia e Beleza"
    }).categoria,
    "Perfumaria, Farmácia e Beleza",
    "categoria canônica declarada deve vencer fallback de título"
  );
  assert.strictEqual(classificarCategoriaUniversal({
    titulo: "Hidrográfica com 24 Cores Estojo Cartão, Faber-Castell",
    categoria: "Amazon"
  }).categoria, "Papelaria e Livros");
  assert.strictEqual(classificarCategoriaOferta({
    titulo: "Hidrográfica com 24 Cores Estojo Cartão, Faber-Castell",
    categoria: "Casa, Móveis e Decoração"
  }, "Hidrográfica com 24 Cores Estojo Cartão, Faber-Castell"), "Casa, Móveis e Decoração");
  assert.ok(CATEGORIAS_OPTIMUS.includes("Papelaria e Livros"));
  assert.ok(!Object.values(CATEGORIAS_DESTINOS).some(item => item.nome === "Papelaria e Livros"),
    "snapshot antigo de todas as categorias deve conservar sua semântica");

  const ofertaNovaCategoria = { categoria: "Papelaria e Livros" };
  const snapshotAntigo = { categorias: Object.values(CATEGORIAS_DESTINOS).map(item => item.nome) };
  assert.strictEqual(destinoAceitaTodasCategorias(snapshotAntigo), true);
  assert.strictEqual(categoriaPermitidaNoDestino(ofertaNovaCategoria, snapshotAntigo), true);
  assert.strictEqual(categoriaPermitidaNoDestino(ofertaNovaCategoria, { categorias: ["Papelaria e Livros"] }), true);
  assert.strictEqual(categoriaPermitidaNoDestino(ofertaNovaCategoria, { categorias: ["Diversos"] }), false);

  const universal = montarOfertaUniversalEngine({
    oferta: {
      id: 1, marketplace: "amazon", titulo: "Hidrográfica com 24 Cores",
      categoria: "Papelaria e Livros", preco: 1379, precoOriginal: 2199,
      cupom: "TESTE", linkOriginal: "https://example.test/original",
      linkAfiliado: "https://example.test/workspace"
    },
    ofertaEntrada: { categoria: "Amazon" },
    job: { id: 2, workspaceId: "workspace-a" }
  });
  assert.strictEqual(universal.produto.categoriaOrigem, "Amazon");
  assert.strictEqual(universal.produto.categoriaNormalizada, "Papelaria e Livros");
  assert.strictEqual(universal.comercial.precoAtual, 1379);
  assert.strictEqual(universal.comercial.precoAnterior, 2199);
  assert.strictEqual(universal.comercial.cupom, "TESTE");
  assert.strictEqual(universal.afiliacao.urlAfiliada, "https://example.test/workspace");
  assert.strictEqual(universal.workspaceId, "workspace-a");
} finally {
  console.log = logOriginal;
}

assert.strictEqual(casos.filter(([, , categoria]) => categoria === "Diversos").length, 3);
console.log("categorias-reducao-diversos: ok (30 casos, 3 ambiguos em Diversos)");
