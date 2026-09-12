const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  identidadeAntiRepeticaoPorDestino,
  melhoriaFinanceiraComprovada
} = require("../marketplaces/inteligencia/memoria-ofertas");
const {
  consultarEnvioRecenteExecutor2h,
  avaliarDuplicidadeAntesProcessarFila
} = require("../utils/fila-ofertas");

const AGORA = Date.parse("2026-09-12T15:00:00.000Z");
function oferta(extra = {}) {
  return {
    id: `oferta_${Math.random().toString(36).slice(2)}`,
    clienteId: "workspace_a",
    marketplace: "amazon",
    asin: "B0DESTINO1",
    titulo: "Produto de memoria por destino",
    preco: "100.00",
    precoAtual: "100.00",
    origemFluxo: "optimus",
    status: "pendente",
    ...extra
  };
}
function enviada(destinoId, extra = {}) {
  return oferta({
    status: "processando",
    destinosEstado: [{
      id: destinoId,
      destinoId,
      estado: "enviado",
      enviadoEm: new Date(AGORA - 5 * 60 * 1000).toISOString()
    }],
    ...extra
  });
}
function consulta(anterior, atual, destinoId) {
  return consultarEnvioRecenteExecutor2h([anterior, atual], atual, {
    agora: AGORA,
    destinoId,
    obterItens: () => [anterior, atual]
  });
}

{
  const radar = enviada("grupo_1", { origemFluxo: "optimus" });
  const clone = oferta({ origemFluxo: "clonador_grupos" });
  assert.strictEqual(consulta(radar, clone, "grupo_1").bloqueada, true, "Radar e Clone compartilham Grupo 1");
  assert.strictEqual(consulta(radar, clone, "grupo_2").bloqueada, false, "Grupo 2 nao herda memoria do Grupo 1");
}
{
  const clone = enviada("grupo_1", { origemFluxo: "clonador_grupos" });
  const radar = oferta({ origemFluxo: "optimus" });
  assert.strictEqual(consulta(clone, radar, "grupo_1").bloqueada, true, "Clone e Radar compartilham Grupo 1");
}
{
  const cloneX = enviada("grupo_1", { origemFluxo: "clonador_grupos" });
  const cloneY = oferta({ origemFluxo: "clonador_grupos" });
  assert.strictEqual(consulta(cloneX, cloneY, "grupo_1").bloqueada, true, "duas fontes Clone bloqueiam no mesmo destino");
  const outroWorkspace = oferta({ clienteId: "workspace_b" });
  assert.strictEqual(consulta(cloneX, outroWorkspace, "grupo_1").bloqueada, false, "workspaces permanecem isolados");
}
{
  const semConfirmacao = oferta({ status: "erro", destinosEstado: [{ id: "grupo_1", destinoId: "grupo_1", estado: "erro_definitivo" }] });
  assert.strictEqual(consulta(semConfirmacao, oferta(), "grupo_1").bloqueada, false, "falha nao cria memoria");
  const legado = oferta({ status: "enviado", enviadoEm: new Date(AGORA - 5 * 60 * 1000).toISOString() });
  assert.strictEqual(consulta(legado, oferta(), "grupo_1").bloqueada, false, "legado sem destino nao bloqueia novo destino");
}
{
  for (const destinoId of ["wa_interno", "telegram_interno", "discord_interno"]) {
    assert.strictEqual(consulta(enviada(destinoId), oferta(), destinoId).bloqueada, true, `${destinoId} usa ID interno`);
  }
}
{
  const anterior = enviada("grupo_1", { preco: "100.00", precoAtual: "100.00" });
  assert.strictEqual(consulta(anterior, oferta({ preco: "90.00", precoAtual: "90.00" }), "grupo_1").bloqueada, false, "preco menor preserva melhoria");
  assert.strictEqual(consulta(anterior, oferta({ cupom: "NOVO10", valorCupom: 10 }), "grupo_1").bloqueada, false, "cupom mensuravel melhor preserva melhoria");
  assert.strictEqual(consulta(anterior, oferta({ cupom: "TALVEZ", cupomTipo: "provavel" }), "grupo_1").bloqueada, true, "cupom provavel nao libera");
  assert.strictEqual(melhoriaFinanceiraComprovada(oferta({ preco: "110.00" }), anterior).ok, false, "preco maior nao melhora");
  const antiga = enviada("grupo_1", { destinosEstado: [{ id: "grupo_1", destinoId: "grupo_1", estado: "enviado", enviadoEm: new Date(AGORA - 3 * 60 * 60 * 1000).toISOString() }] });
  assert.strictEqual(consulta(antiga, oferta(), "grupo_1").bloqueada, false, ">2h libera");
}
{
  const pendenteA = oferta({ status: "pendente", destinosAutorizadosIds: ["grupo_1"] });
  const atual = oferta();
  assert.strictEqual(avaliarDuplicidadeAntesProcessarFila([pendenteA, atual], atual, { agora: AGORA, destinoId: "grupo_1" }).bloquear, true, "pendente cobre o mesmo destino");
  assert.strictEqual(avaliarDuplicidadeAntesProcessarFila([pendenteA, atual], atual, { agora: AGORA, destinoId: "grupo_2" }).bloquear, false, "pendente Grupo 1 nao mata Grupo 2");
}
{
  const base = oferta();
  const chaveA = identidadeAntiRepeticaoPorDestino(base, "grupo_1").identidade;
  const chaveB = identidadeAntiRepeticaoPorDestino(base, "grupo_2").identidade;
  assert.notStrictEqual(chaveA, chaveB, "identidade operacional inclui destino");
  assert(!chaveA.includes("optimus") && !chaveA.includes("clonador_grupos"), "origem nao entra na chave");
}
{
  const fonteFila = fs.readFileSync(path.join(__dirname, "..", "utils", "fila-ofertas.js"), "utf8");
  const inicio = fonteFila.indexOf("function adicionarOfertaFila");
  const fim = fonteFila.indexOf("function adicionarOfertaInicioFila", inicio);
  assert(!fonteFila.slice(inicio, fim).includes("reservarOfertaAutomatica2h"), "entrada automatica nao reserva memoria global");
  const fonteIndex = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  assert(fonteIndex.includes("const destinoIdMemoria = String(destino?.id || destino?.destinoId || \"\").trim()"), "Executor usa ID interno no loop real");
  assert(fonteIndex.includes("filaStore.candidatosEnvioRecente2h(oferta, {"), "Executor reutiliza FilaStore");
}

console.log("p0-3-memoria-destino.test.js OK");
