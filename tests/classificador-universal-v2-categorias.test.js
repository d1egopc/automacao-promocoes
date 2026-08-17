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
assertCategoria("SSD Kootion 1TB NVMe", "Gamer e Hardware");
assertCategoria("Memoria RAM JUHOR DDR4 8GB 3200MHz", "Gamer e Hardware");
assertCategoria("Memoria RAM Gudga DDR4 8GB 3200MHz", "Gamer e Hardware");
assertCategoria("Ryzen 7 5700X", "Gamer e Hardware");
assertCategoria("Ventoinha Jungle Leopard ARGB 120mm", "Gamer e Hardware");

assertCategoriaEm("Teclado AULA HERO 68HE magnetico", ["Periféricos", "Gamer e Hardware"]);
assertCategoriaEm("Mouse ATK A9 Air Ultimate", ["Periféricos", "Games e Console"]);
assertCategoriaEm("MCHOSE G3 V2 Sensor PAW 3311", ["Periféricos", "Games e Console"]);
assertCategoriaEm("Controle Sem Fio Gamesir T4 Nova Lite Hall Effect", ["Games e Console", "Periféricos"]);
assertCategoriaEm("Controle 8BitDo Ultimate 2 Wireless", ["Games e Console", "Periféricos"]);
assertCategoriaEm("Controle Sem Fio Machenike G1 Hall Effect", ["Games e Console", "Periféricos"]);

assertCategoriaEm("TV Stick Android 13 Pro 4K", ["Audio TV", "Eletrônicos"]);
assertCategoria("Limpador Facial Antioleosidade 300ml CREAMY", "Perfumaria, Farmácia e Beleza");

assertCategoria("Vara de pesca com molinete e isca artificial", "Pesca e Camping");
assertCategoria("Caixa térmica Coleman para camping", "Pesca e Camping");
assertCategoria("Barraca camping com saco de dormir", "Pesca e Camping");
assertNuncaPesca("Lanterna led USB para escritorio");

assertCategoria("Cupom IFPC5HAQ ou BRGM1 moedas no APP abra o produto no link", "Diversos");

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
