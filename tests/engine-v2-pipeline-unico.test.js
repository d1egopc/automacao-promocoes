const assert = require("assert");
const fs = require("fs");
const path = require("path");

const arquivosPipeline = [
  "index.js",
  path.join("marketplaces", "kabum", "index.js"),
  path.join("marketplaces", "inteligencia", "index.js")
];

const fontesPipeline = new Map(
  arquivosPipeline.map(arquivo => [
    arquivo,
    fs.readFileSync(path.join(__dirname, "..", arquivo), "utf8")
  ])
);

const indexFonte = fontesPipeline.get("index.js");
const flagLegada = ["DESATIVAR", "FAREJADORES", "AUTO"].join("_");
const bootMlLegado = ["__", "optimus", "Ml", "Boot", "Timeout", "Registrado"].join("");
const intervaloLegado = ["__", "optimus", "Orquestrador", "Marketplaces", "Interval", "Registrado"].join("");
const runnerLegado = ["rodar", "Proximo", "Marketplace"].join("");
const origemBootMl = ["boot", "mercadolivre"].join("_");

function corpoFuncao(nome) {
  const inicio = indexFonte.indexOf(`function ${nome}`);
  assert(inicio >= 0, `${nome} deve existir`);
  const abre = indexFonte.indexOf("{", inicio);
  let profundidade = 0;

  for (let i = abre; i < indexFonte.length; i += 1) {
    if (indexFonte[i] === "{") profundidade += 1;
    if (indexFonte[i] === "}") profundidade -= 1;
    if (profundidade === 0) return indexFonte.slice(abre + 1, i);
  }

  throw new Error(`corpo_nao_encontrado:${nome}`);
}

const corpoFarejadoresDesativados = corpoFuncao("farejadoresAutoDesativados");
const farejadoresAutoDesativados = new Function(corpoFarejadoresDesativados);

for (const [arquivo, fonte] of fontesPipeline.entries()) {
  assert(!fonte.includes(flagLegada), `${arquivo}: flag legada nao pode reativar produtores automaticos`);
  assert(!fonte.includes(bootMlLegado), `${arquivo}: boot automatico ML legado nao deve existir`);
  assert(!fonte.includes(intervaloLegado), `${arquivo}: intervalo do orquestrador legado nao deve existir`);
  assert(!fonte.includes(runnerLegado), `${arquivo}: runner automatico legado nao deve existir`);
  assert(!fonte.includes(origemBootMl), `${arquivo}: origem de boot ML legado nao deve existir`);
  assert(!fonte.includes("orquestrador_intervalo"), `${arquivo}: origem de intervalo legado nao deve existir`);

  assert(!/setTimeout\s*\([\s\S]{0,240}rodarMarketplaceEspecifico/.test(fonte), `${arquivo}: startup nao pode agendar farejador legado por timeout`);
  assert(!/setInterval\s*\([\s\S]{0,360}rodarMarketplaceEspecifico/.test(fonte), `${arquivo}: startup nao pode agendar farejador legado por interval`);
  assert(!/setInterval\s*\([\s\S]{0,360}farejar(?:MercadoLivre|Shopee|Amazon|AliExpress|Kabum)/i.test(fonte), `${arquivo}: startup nao pode agendar farejador legado diretamente`);
}

assert(/return\s+true\s*;/.test(corpoFarejadoresDesativados), "produtores legados devem permanecer desligados de forma irreversivel");
assert(!/process\.env/.test(corpoFarejadoresDesativados), "desligamento legado nao pode depender de env");
for (const valor of ["false", "0", "off", "nao", "no"]) {
  process.env[flagLegada] = valor;
  assert.strictEqual(farejadoresAutoDesativados(), true, `${valor} nao pode reativar farejador legado`);
}
assert(indexFonte.includes("[ENGINE-V2-PIPELINE-AUTOMATICO-UNICO]"), "startup deve declarar pipeline automatico unico");
assert(indexFonte.includes("iniciarOrquestradorEngine({"), "Engine V2 deve continuar inicializando");

for (const rota of [
  'app.post("/fila"',
  'app.post("/enviar-manual"',
  'app.post("/fila/inteligencia/abastecer"',
  'app.post("/importar-produto"',
  'app.post("/radar/adicionar-fila"'
]) {
  assert(indexFonte.includes(rota), `rota manual preservada: ${rota}`);
}

console.log("engine-v2-pipeline-unico.test.js OK");
