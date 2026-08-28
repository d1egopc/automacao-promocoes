const assert = require("assert");

const { classificarCategoriaOferta } = require("../marketplaces/inteligencia/classificador-categorias");
const {
  classificarCategoriaUniversal,
  categoriaOficialAutoritativa,
  categoriaGenerica
} = require("../modules/inteligencia-universal/categoria.service");

function classificarTitulo(titulo, extras = {}) {
  return classificarCategoriaOferta({
    titulo,
    nome: titulo,
    categoria: extras.categoria || "",
    marketplace: extras.marketplace || "aliexpress"
  }, titulo);
}

function assertCategoria(titulo, esperada, extras = {}) {
  assert.strictEqual(classificarTitulo(titulo, extras), esperada, titulo);
}

function assertCategoriaEm(titulo, esperadas, extras = {}) {
  const categoria = classificarTitulo(titulo, extras);
  assert.ok(
    esperadas.includes(categoria),
    `${titulo} deveria estar em ${esperadas.join(" ou ")}, recebeu ${categoria}`
  );
}

function assertNaoCategoria(titulo, categoriaProibida, extras = {}) {
  assert.notStrictEqual(classificarTitulo(titulo, extras), categoriaProibida, titulo);
}

function assertNuncaPesca(titulo, extras = {}) {
  assert.notStrictEqual(classificarTitulo(titulo, extras), "Pesca e Camping", titulo);
}

assert.strictEqual(categoriaOficialAutoritativa("Periféricos"), true);
assert.strictEqual(categoriaOficialAutoritativa("Computador e escritório"), false);
assert.strictEqual(categoriaOficialAutoritativa("Diversos"), false);
assert.strictEqual(categoriaGenerica("Diversos"), true);

assertCategoria("Water Cooler Kalkan Aura 360mm ARGB Intel AMD", "Gamer e Hardware");
assertNuncaPesca("Cooler Kalkan Aura 360mm ARGB");
assertCategoriaEm("Cooler Kalkan Aura 360mm ARGB", ["Gamer e Hardware", "Diversos"]);
assertCategoria("Air Cooler DeepCool AG400", "Gamer e Hardware");
assertCategoria("Airfryer WAP 4,5L", "Eletroportáteis", {
  categoria: "Casa, Móveis e Decoração"
});
assertCategoria("Aspirador de Pó e Água Wap GTW Inox 12 1400W com Bocal de Sopro", "Eletroportáteis");
assertCategoria("Air Fryer Philco 6,5L Visor Glass e Redstone 1700W - 127v", "Eletroportáteis");
assertCategoria("SSD Kootion 1TB NVMe", "Gamer e Hardware");
assertCategoria("Memoria RAM JUHOR DDR4 8GB 3200MHz", "Gamer e Hardware");
assertCategoria("Memoria RAM Gudga DDR4 8GB 3200MHz", "Gamer e Hardware");
assertCategoria("Ryzen 7 5700X", "Gamer e Hardware");
assertCategoria("Ventoinha Jungle Leopard ARGB 120mm", "Gamer e Hardware");

assertCategoria("SHORT VIRGULADO", "Roupas e Moda Masculina", {
  categoria: "Tênis e Chinelos"
});
assertCategoria("short masculino", "Roupas e Moda Masculina");
assertCategoria("short Adidas masculino", "Roupas e Moda Masculina");
assertCategoria("camisa Adidas masculina", "Roupas e Moda Masculina");
assertCategoria("camiseta Nike masculina", "Roupas e Moda Masculina");
for (const marca of ["Nike", "Adidas", "Puma"]) {
  assertCategoria(`camiseta masculina ${marca}`, "Roupas e Moda Masculina", {
    categoria: "Tênis e Chinelos"
  });
}
assertCategoria("polo masculina", "Roupas e Moda Masculina", {
  categoria: "Tênis e Chinelos"
});
assertCategoria("polo Puma masculina", "Roupas e Moda Masculina");
assertCategoria("camisa Adidas masculina", "Roupas e Moda Masculina");
assertCategoria("Tênis Nike masculino", "Tênis e Chinelos");
assertCategoria("Tênis Adidas", "Tênis e Chinelos");
assertCategoria("Chinelo Puma", "Tênis e Chinelos");
assertCategoria("chuteira Puma masculina", "Tênis e Chinelos");
assertCategoria("chinelo Nike masculino", "Tênis e Chinelos");
assertCategoria("kit tênis + camiseta", "Tênis e Chinelos");
assertCategoria("Kit 2 Camisetas Masculinas Dry Wolf Alpha", "Roupas e Moda Masculina");

assertCategoriaEm("Teclado AULA HERO 68HE magnetico", ["Periféricos", "Gamer e Hardware"]);
assertCategoriaEm("Mouse ATK A9 Air Ultimate", ["Periféricos", "Games e Console"]);
assertCategoriaEm("MCHOSE G3 V2 Sensor PAW 3311", ["Periféricos", "Games e Console"]);
assertCategoriaEm("Controle Sem Fio Gamesir T4 Nova Lite Hall Effect", ["Games e Console", "Periféricos"]);
assertCategoriaEm("Controle 8BitDo Ultimate 2 Wireless", ["Games e Console", "Periféricos"]);
assertCategoriaEm("Controle Sem Fio Machenike G1 Hall Effect", ["Games e Console", "Periféricos"]);

assertCategoriaEm("TV Stick Android 13 Pro 4K", ["Audio TV", "Eletrônicos"]);
assertCategoria("Limpador Facial Antioleosidade 300ml CREAMY", "Perfumaria, Farmácia e Beleza");
assertCategoria("creme renovador para os pés", "Perfumaria, Farmácia e Beleza");
assertCategoria("reconstrutor capilar", "Perfumaria, Farmácia e Beleza");
assertCategoria("gloss", "Perfumaria, Farmácia e Beleza");
assertCategoria("batom", "Perfumaria, Farmácia e Beleza");

assertCategoria("Vara de pesca com molinete e isca artificial", "Pesca e Camping");
assertCategoria("Caixa térmica Coleman para camping", "Pesca e Camping");
assertCategoria("Barraca camping com saco de dormir", "Pesca e Camping");
assertNuncaPesca("Lanterna led USB para escritorio");
assertCategoria("whey protein", "Esporte e Suplementos");
assertCategoria("Eletrólitos Ocean Drop Sódio Potássio Magnésio 180g", "Esporte e Suplementos");
assertCategoria("suplemento de eletrólitos", "Esporte e Suplementos");
assertCategoria("eletrólitos para hidratação", "Esporte e Suplementos");
assertCategoria("bebida isotônica", "Esporte e Suplementos");
assertCategoria("repositor eletrolítico", "Esporte e Suplementos");
assertCategoria("isotonico", "Esporte e Suplementos");
assertCategoria("isotônico", "Esporte e Suplementos");
assertCategoria("snack proteico high protein", "Esporte e Suplementos");
assertNaoCategoria("eletrólitos em contexto culinário", "Esporte e Suplementos");
assertNaoCategoria("solução eletrolítica industrial", "Esporte e Suplementos");
assertNaoCategoria("eletrólitos para bateria", "Esporte e Suplementos");
assertCategoria("pneus aro 14", "Automotivo");
assertCategoria("cama box queen", "Casa, Móveis e Decoração");
assertCategoria("colchão casal", "Casa, Móveis e Decoração");
assertCategoria("conjunto bistrô varanda sacada área gourmet", "Casa, Móveis e Decoração");
assertCategoria("arara para roupas", "Casa, Móveis e Decoração");
assertCategoria("Lorenzetti Maxi Ducha Ultra Branco 127v", "Iluminação e Elétrica");
assertCategoria("Chuveiro Eletrônico Lorenzetti Acqua Duo Ultra", "Iluminação e Elétrica");
assertCategoria("Ducha Higiênica 1/4 Volta 304 Inox", "Casa, Móveis e Decoração");
assertCategoria("Kit Motor Rossi Portão Dz Nano Turbo 600kg", "Casa, Móveis e Decoração");
assertCategoria("Conjunto Sala de Jantar Mesa 4 Cadeiras", "Casa, Móveis e Decoração");
assertCategoria("Maquina Assentar Pisos Porcelanatos Ceramicas", "Ferramentas");

assertCategoria("Cupom IFPC5HAQ ou BRGM1 moedas no APP abra o produto no link", "Diversos");
assertCategoria("Kit 2 Camisetas Dry Wolf Alpha", "Diversos");

{
  const resultado = classificarCategoriaUniversal({
    titulo: "B450m Soyo White Placa Mãe DDR4 AM4 AMD Ryzen Branca",
    nome: "B450m Soyo White Placa Mãe DDR4 AM4 AMD Ryzen Branca",
    marketplace: "aliexpress",
    categoria: "Computador e escritório"
  }, { termo: "B450m Soyo White Placa Mãe DDR4 AM4 AMD Ryzen Branca" });

  assert.strictEqual(resultado.categoria, "Gamer e Hardware");
  assert.strictEqual(resultado.origem, "classificador_legado");
  assert.ok(resultado.logs.some(log => log.motivo === "categoria_declarada_nao_oficial"));
}

{
  const resultado = classificarCategoriaUniversal({
    titulo: "Headset Gamer Fantech Harmony PRO",
    marketplace: "aliexpress",
    categoria: "Periféricos"
  }, {});

  assert.strictEqual(resultado.categoria, "Periféricos");
  assert.strictEqual(resultado.origem, "declarada");
}

console.log("classificador-universal-v2-categorias: ok");
