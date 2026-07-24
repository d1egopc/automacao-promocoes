const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-anti-repeticao-"));

const { adicionarOfertaFila } = require("../utils/fila-ofertas");
const {
  identidadeAntiRepeticaoAutomatica
} = require("../marketplaces/inteligencia/memoria-ofertas");
const {
  readGlobalJson,
  writeGlobalJson
} = require("../utils/storage");

function oferta(overrides = {}) {
  return {
    clienteId: "cliente_a",
    origem: "radar",
    marketplace: "mercadolivre",
    titulo: "Produto Gamer RTX 5060 8GB",
    preco: 1999.9,
    precoAtual: 1999.9,
    linkOriginal: "https://www.mercadolivre.com.br/produto/MLB123456789?utm_source=x",
    linkAfiliado: "https://afiliado.exemplo.com/produto/MLB123456789?a=1",
    status: "pendente",
    ...overrides
  };
}

function resetMemoria() {
  writeGlobalJson("ofertas_vistas.json", []);
}

function adicionar(fila, entrada, origem = "radar") {
  return adicionarOfertaFila(fila, entrada, { origem, logger: { log() {}, error() {} } });
}

{
  resetMemoria();
  const fila = [];
  assert.strictEqual(adicionar(fila, oferta()), true, "primeira oferta radar entra");
  assert.strictEqual(adicionar(fila, oferta()), false, "mesma oferta radar deve bloquear por 2h");
  assert.strictEqual(fila.length, 1);
}

{
  resetMemoria();
  const fila = [];
  assert.strictEqual(adicionar(fila, oferta({ tipoCupom: "provavel" })), true);
  assert.strictEqual(adicionar(fila, oferta({ tipoCupom: "provavel" })), false, "cupom provavel nao libera repeticao");
}

{
  resetMemoria();
  const fila = [];
  assert.strictEqual(adicionar(fila, oferta({ avisoCupom: "Cupom disponivel no carrinho" })), true);
  assert.strictEqual(adicionar(fila, oferta({ avisoCupom: "Cupom disponivel no carrinho" })), false, "avisoCupom sem valor mensuravel nao libera");
}

{
  resetMemoria();
  const fila = [];
  assert.strictEqual(adicionar(fila, oferta({ score: 95 })), true);
  assert.strictEqual(adicionar(fila, oferta({ score: 99 })), false, "score alto sem melhoria financeira nao libera");
}

{
  resetMemoria();
  const fila = [];
  assert.strictEqual(adicionar(fila, oferta({ linkOriginal: "https://www.mercadolivre.com.br/produto/MLB123456789?utm_source=a&gclid=1" })), true);
  assert.strictEqual(adicionar(fila, oferta({ linkOriginal: "https://www.mercadolivre.com.br/produto/MLB123456789?utm_source=b&gclid=2" })), false, "parametros de URL nao tornam oferta nova");
}

{
  resetMemoria();
  const fila = [];
  assert.strictEqual(adicionar(fila, oferta({ titulo: "🔥 PRODUTO Gamer RTX 5060 8GB" })), true);
  assert.strictEqual(adicionar(fila, oferta({ titulo: "produto gamer rtx 5060 8gb" })), false, "emoji, caixa e acento nao tornam oferta nova");
}

{
  resetMemoria();
  const fila = [];
  assert.strictEqual(adicionar(fila, oferta({ preco: 1999.9, precoAtual: 1999.9 })), true);
  assert.strictEqual(adicionar(fila, oferta({ preco: 1899.9, precoAtual: 1899.9 })), true, "queda real de preco libera");
}

{
  resetMemoria();
  const fila = [];
  assert.strictEqual(adicionar(fila, oferta({ cupom: "GANHE10", valorCupom: 10 })), true);
  assert.strictEqual(adicionar(fila, oferta({ cupom: "GANHE20", valorCupom: 20 })), true, "cupom real novo e melhor libera");
}

{
  resetMemoria();
  const fila = [];
  assert.strictEqual(adicionar(fila, oferta({ avisoCupom: "Use cupom da pagina" })), true);
  assert.strictEqual(adicionar(fila, oferta({ avisoCupom: "Cupom no app" })), false, "texto de cupom sem valor mensuravel bloqueia");
}

{
  resetMemoria();
  const entrada = oferta();
  const identidade = identidadeAntiRepeticaoAutomatica(entrada);
  writeGlobalJson("ofertas_vistas.json", [{
    tipoMemoria: "anti_repeticao_automatica_2h",
    identidadeBaseAntiRepeticao2h: identidade.identidadeBase,
    identidadeAntiRepeticao2h: identidade.identidade,
    clienteId: entrada.clienteId,
    marketplace: entrada.marketplace,
    titulo: entrada.titulo,
    preco: entrada.preco,
    precoAtual: entrada.precoAtual,
    vistoEm: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString()
  }]);
  const fila = [];
  assert.strictEqual(adicionar(fila, entrada), true, "fora da janela de 2h libera");
}

{
  resetMemoria();
  const fila = [];
  const manual = oferta({ origem: "manual", manual: true });
  assert.strictEqual(adicionar(fila, manual, "manual"), true);
  assert.strictEqual(adicionar(fila, manual, "manual"), true, "oferta manual preserva comportamento atual");
}

for (const origemManual of ["manual-kabum-awin", "manual-magalu", "importacao_manual", "magalu_manual"]) {
  resetMemoria();
  const fila = [];
  const entrada = oferta({ origem: origemManual });
  assert.strictEqual(adicionar(fila, entrada, origemManual), true, `${origemManual} deve entrar na primeira vez`);
  assert.strictEqual(adicionar(fila, entrada, origemManual), true, `${origemManual} deve preservar fluxo manual`);
}

{
  resetMemoria();
  const fila = [];
  const entrada = oferta();
  const primeira = adicionar(fila, entrada);
  const segunda = adicionar(fila, entrada);
  assert.strictEqual(primeira, true);
  assert.strictEqual(segunda, false, "duas entradas sequenciais reservam apenas uma");
  assert.strictEqual(fila.length, 1);
}

{
  resetMemoria();
  const filaA = [];
  const filaB = [];
  assert.strictEqual(adicionar(filaA, oferta({ clienteId: "cliente_a" })), true);
  assert.strictEqual(adicionar(filaB, oferta({ clienteId: "cliente_b" })), true, "clientes diferentes tem memoria isolada");
}

{
  resetMemoria();
  const fila = [];
  assert.strictEqual(adicionar(fila, oferta({ linkOriginal: "", linkAfiliado: "", titulo: "SSD Kingston 1TB NVMe" })), true);
  assert.strictEqual(adicionar(fila, oferta({ linkOriginal: "", linkAfiliado: "", titulo: "SSD Kingston 2TB NVMe" })), true, "capacidade diferente nao deve ser unida");
}

const registros = readGlobalJson("ofertas_vistas.json", []);
assert(Array.isArray(registros), "memoria deve continuar em JSON global");

console.log("anti-repeticao-automatica ok");
