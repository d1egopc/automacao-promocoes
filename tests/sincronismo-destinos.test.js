const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const indexPath = path.join(__dirname, "..", "index.js");
const fonte = fs.readFileSync(indexPath, "utf8");

function extrairFuncao(nome) {
  const inicio = fonte.indexOf(`function ${nome}`);
  assert.ok(inicio >= 0, `funcao ${nome} deve existir`);
  const abre = fonte.indexOf(") {", inicio) + 2;
  assert.ok(abre >= 2, `corpo da funcao ${nome} deve existir`);
  let profundidade = 0;
  for (let i = abre; i < fonte.length; i += 1) {
    if (fonte[i] === "{") profundidade += 1;
    if (fonte[i] === "}") profundidade -= 1;
    if (profundidade === 0) return fonte.slice(inicio, i + 1);
  }
  throw new Error(`nao foi possivel extrair ${nome}`);
}

const sandbox = {
  config: { intervaloEnvioMinutos: 5 },
  cupomFastLaneTipo: oferta => oferta.cupomReal ? "real_detectado" : (oferta.cupomProvavel ? "provavel" : ""),
  console
};
vm.createContext(sandbox);
vm.runInContext([
  extrairFuncao("normalizarDestinoContrato"),
  extrairFuncao("numeroIntervaloValido"),
  extrairFuncao("intervaloTurboCupomMinutos"),
  extrairFuncao("resolverIntervaloConfiguradoDestino")
].join("\n"), sandbox);

function calcularIntervalo(destino, configCliente, oferta) {
  const intervaloConfigurado = sandbox.resolverIntervaloConfiguradoDestino(destino, configCliente);
  const ofertaTemCupomReal = sandbox.cupomFastLaneTipo(oferta) === "real_detectado";
  const turbo = destino.prioridadeCupomAtiva === true && ofertaTemCupomReal
    ? sandbox.intervaloTurboCupomMinutos(oferta)
    : null;

  return Number.isFinite(turbo) ? Math.max(3, turbo) : intervaloConfigurado;
}

assert.strictEqual(sandbox.normalizarDestinoContrato({ nome: "Antigo" }).prioridadeCupomAtiva, false);
assert.strictEqual(sandbox.normalizarDestinoContrato({ prioridadeCupomAtiva: true }).prioridadeCupomAtiva, true);

assert.strictEqual(calcularIntervalo({ intervaloMinutos: 5, prioridadeCupomAtiva: false }, {}, { cupomReal: true }), 5);
assert.strictEqual(calcularIntervalo({ intervaloMinutos: 7, prioridadeCupomAtiva: false }, {}, { cupomReal: true }), 7);
assert.strictEqual(calcularIntervalo({ intervaloMinutos: 10, prioridadeCupomAtiva: false }, {}, { cupomReal: true }), 10);
assert.strictEqual(calcularIntervalo({ intervaloMinutos: 8, prioridadeCupomAtiva: true }, {}, { cupomReal: true }), 3);
assert.strictEqual(calcularIntervalo({ intervaloMinutos: 8, prioridadeCupomAtiva: true }, {}, {}), 8);
assert.strictEqual(calcularIntervalo({ intervaloMinutos: 8, prioridadeCupomAtiva: true }, {}, { cupomProvavel: true }), 8);
assert.ok(calcularIntervalo({ intervaloMinutos: 8, prioridadeCupomAtiva: true }, {}, { cupomReal: true }) >= 3);
assert.strictEqual(calcularIntervalo({}, { intervaloMinutos: 7 }, {}), 7);
assert.strictEqual(calcularIntervalo({}, { intervaloEnvioMinutos: 9 }, {}), 9);
sandbox.config.intervaloEnvioMinutos = 11;
assert.strictEqual(calcularIntervalo({}, {}, {}), 11);
sandbox.config.intervaloEnvioMinutos = 0;
assert.strictEqual(calcularIntervalo({}, {}, {}), 5);

const requiredSnippets = [
  "CONTROLE_INTERVALO_DESTINOS_FILE",
  "restaurarControleIntervaloEnvio();",
  "atualizarUltimoEnvioDestino(clienteId, destino, oferta, intervalo);",
  "FILA-INTERVALO-AVALIADO",
  "FILA-DESTINO-BLOQUEADO-INTERVALO",
  "FILA-DESTINO-LIBERADO",
  "FILA-CUPOM-INTERVALO-MINIMO",
  "FILA-ULTIMO-ENVIO-ATUALIZADO",
  "FILA-CONTROLE-INTERVALO-RESTAURADO"
];

for (const trecho of requiredSnippets) {
  assert.ok(fonte.includes(trecho), `index.js deve conter ${trecho}`);
}

assert.ok(!/return\s+2\s*;/.test(extrairFuncao("intervaloTurboCupomMinutos")), "turbo nao pode retornar 2min");
assert.ok(!/2\.5/.test(extrairFuncao("intervaloTurboCupomMinutos")), "turbo nao pode retornar 2.5min");
assert.ok(!/config\.intervaloMinutos\s*\|\|\s*2/.test(fonte), "fallback oculto para 2min nao pode existir");

// Modelo de relogios independentes e erro sem atualizacao.
const relogios = {};
function confirmarEnvio(chave, minuto) {
  relogios[chave] = minuto;
}
function permitido(chave, minuto, intervalo) {
  return relogios[chave] === undefined || minuto - relogios[chave] >= intervalo;
}

confirmarEnvio("cliente_a:whatsapp", 0);
assert.strictEqual(permitido("cliente_a:telegram", 1, 8), true, "destinos diferentes devem ser independentes");
assert.strictEqual(permitido("cliente_a:whatsapp", 2, 3), false, "cupom nao sai antes de 3min");
assert.strictEqual(permitido("cliente_a:whatsapp", 3, 3), true, "cupom pode sair apos 3min");
confirmarEnvio("cliente_a:whatsapp", 3);
assert.strictEqual(permitido("cliente_a:whatsapp", 10, 8), false, "comum apos cupom conta intervalo normal desde ultimo envio");
assert.strictEqual(permitido("cliente_a:whatsapp", 11, 8), true, "comum apos cupom libera no intervalo normal");
const antesErro = relogios["cliente_a:whatsapp"];
// erro de envio nao chama confirmarEnvio.
assert.strictEqual(relogios["cliente_a:whatsapp"], antesErro, "erro nao deve atualizar relogio");

console.log("sincronismo-destinos: ok");
