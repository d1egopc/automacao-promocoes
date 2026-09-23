"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-ofertas-v2-races-"));

const { writeClienteJson } = require("../utils/storage");
const storage = require("../modules/manual-v2/manual-offers.storage");
const listas = require("../modules/manual-v2/ofertas-v2-listas");
const { enviarOfertaManualV2 } = require("../modules/manual-v2/manual-dispatcher");
const { criarCoordenadorEnvioProdutoDestino } = require("../modules/manual-v2/ofertas-v2-envio-claim");
const { processarEnvioAutomaticoDestino } = require("../modules/fila/processar-envio-automatico-destino");
const fonteExecutor = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
const inicioProcessarFila = fonteExecutor.indexOf("async function processarFilaInterna(");
const fimProcessarFila = fonteExecutor.indexOf("async function processarFila(", inicioProcessarFila);
const corpoProcessarFila = fonteExecutor.slice(inicioProcessarFila, fimProcessarFila);
assert.ok(inicioProcessarFila >= 0 && fimProcessarFila > inicioProcessarFila);
assert.ok(fonteExecutor.includes('require("./modules/fila/processar-envio-automatico-destino")'));
assert.ok(corpoProcessarFila.includes("await processarEnvioAutomaticoDestino({"),
  "o executor de producao chama o boundary testado");
assert.ok(!corpoProcessarFila.includes("const claimProdutoDestino = await coordenadorEnvioProdutoDestino.adquirir"),
  "nao resta caminho inline duplicado para claim do Automatico");

const workspace = "user_race_real";
const destino = { id: "wa_race", nome: "WA controlado", tipo: "whatsapp", ativo: true,
  utilizavel: true, conexaoId: "sessao_race", gruposWhatsapp: ["grupo-teste@g.us"], tipoMidia: "texto" };
const locks = new Set();
const reservas = new Set();
let clientsRetidos = 0;
function criarCoordenadorTeste() { return criarCoordenadorEnvioProdutoDestino({
  advisory: {
    adquirir: async ({ clienteId, oferta }) => {
      const key = `${clienteId}:${oferta.id}`;
      if (locks.has(key)) return { resultado: "ocupado" };
      locks.add(key);
      clientsRetidos += 1;
      return { resultado: "adquirido", handle: { key, client: { release() { clientsRetidos -= 1; } } } };
    },
    finalizar: async (estado) => {
      locks.delete(estado.handle.key);
      estado.handle.client.release();
      return { liberado: true };
    }
  },
  reserva: {
    consultar: async (_, clienteId, key) => reservas.has(`${clienteId}:${key}`),
    preparar: async (_, clienteId, key) => { reservas.add(`${clienteId}:${key}`); return "token"; },
    descartar: async (_, clienteId, key) => { reservas.delete(`${clienteId}:${key}`); }
  }
}); }
const coordenador = criarCoordenadorTeste();

function criarOferta(produtoId) {
  return storage.criarOfertaManualV2(workspace, { marketplace: "amazon", produtoId,
    titulo: `Produto ${produtoId}`, precoAtual: 99,
    urlOriginal: `https://amazon.com.br/dp/${produtoId}`,
    urlAfiliada: `https://amzn.to/${produtoId}` });
}
function deps(transporte, coordenadorLocal = coordenador) {
  return {
    now: () => Date.now(),
    getDestinosPorCliente: () => ({ [workspace]: [destino] }),
    sessoes: { sessao_race: {} }, statusSessao: { sessao_race: "open" },
    resolverPlanoManualV2: () => ({ recursos: { whatsapp: true } }),
    usuarioTemCreditos: () => true, debitarCreditos: () => true,
    montarMensagemOferta: (oferta) => {
      assert.strictEqual(locks.size, 0, "render Manual nao segura advisory");
      assert.strictEqual(clientsRetidos, 0, "render Manual nao segura client PG");
      return `Oferta ${oferta.urlAfiliada}`;
    },
    enviarWhatsApp: transporte,
    coordenadorEnvioProdutoDestino: coordenadorLocal,
    verificarEnvioRecenteProdutoDestino: () => false
  };
}

function automatico(oferta, transporte, coordenadorLocal = criarCoordenadorTeste()) {
  const chave = coordenadorLocal.chaveClaimProdutoDestino({ clienteId: workspace,
    oferta, destinoId: destino.id }).replace("ofertas-v2-par:", "ofertas-v2-duravel:");
  return processarEnvioAutomaticoDestino({
    clienteId: workspace, oferta, destinoId: destino.id, coordenador: coordenadorLocal,
    revalidar: () => ({ ok: true, bloqueada: false }),
    liberarAdvisoryFila: () => true,
    prepararMensagem: () => {
      assert.strictEqual(locks.size, 0, "Automático renderiza apos advisory unlock");
      assert.strictEqual(clientsRetidos, 0, "Automático nao segura client durante render");
      return { mensagem: "Oferta controlada" };
    },
    enviar: transporte,
    processarResultado: async (resultado) => {
      assert.strictEqual(reservas.has(`${workspace}:${chave}`), true,
        "reserva protege tambem a persistencia apos o transporte");
      assert.strictEqual(resultado.enviado, true);
    },
    aoBloqueio: () => {}
  });
}

(async () => {
  const original = criarOferta("B0RACE0003");
  const lista = listas.criarLista(workspace, "Lista real");
  await listas.adicionarItem(workspace, lista.id, { origem: "ofertas", ofertaId: original.id });
  await listas.reservarDestinos(workspace, lista.id, [destino.id], 240000,
    { listarDestinosManuaisV2Async: async () => [destino] });
  let iniciar;
  const iniciou = new Promise((resolve) => { iniciar = resolve; });
  let liberar;
  const pendente = new Promise((resolve) => { liberar = resolve; });
  let envios = 0;
  const dependencias = deps(async () => { envios += 1; iniciar(); await pendente; });
  const envioLista = listas.processarLista(workspace, lista.id, dependencias);
  await iniciou;
  const manualConcorrente = await enviarOfertaManualV2({ clienteId: workspace,
    ofertaId: original.id, destinosIds: [destino.id] }, dependencias);
  liberar();
  const listaConcluida = await envioLista;
  assert.strictEqual(envios, 1, "Lista x Manual atravessam boundaries reais com um transporte");
  assert.strictEqual(manualConcorrente.ignorados, 1);
  assert.strictEqual(listaConcluida.resultado.enviados, 1);

  // Duas instancias do modulo simulam processos sem memoria de reserva comum;
  // o fixture persiste ambas elegiveis como apos uma corrida de RMW.
  const outra = criarOferta("B0RACE0004");
  const listaA = listas.criarLista(workspace, "Lista A");
  const listaB = listas.criarLista(workspace, "Lista B");
  await listas.adicionarItem(workspace, listaA.id, { origem: "ofertas", ofertaId: outra.id });
  await listas.adicionarItem(workspace, listaB.id, { origem: "ofertas", ofertaId: outra.id });
  const estado = listas.lerListas(workspace);
  for (const item of estado.filter((item) => [listaA.id, listaB.id].includes(item.id))) {
    item.status = "enviando";
    item.destinosIds = [destino.id];
    item.proximoEm = 0;
  }
  writeClienteJson(workspace, listas.ARQUIVO_LISTAS, estado);
  let iniciou2;
  const inicio2 = new Promise((resolve) => { iniciou2 = resolve; });
  let liberar2;
  const pendente2 = new Promise((resolve) => { liberar2 = resolve; });
  let envios2 = 0;
  const deps2 = deps(async () => { envios2 += 1; iniciou2(); await pendente2; });
  const primeiro = listas.processarLista(workspace, listaA.id, deps2);
  await inicio2;
  delete require.cache[require.resolve("../modules/manual-v2/ofertas-v2-listas")];
  const segundaInstancia = require("../modules/manual-v2/ofertas-v2-listas");
  const segundo = await segundaInstancia.processarLista(workspace, listaB.id, deps2);
  liberar2();
  await primeiro;
  assert.strictEqual(envios2, 1, "Lista x Lista em instancias distintas faz um transporte");
  assert.strictEqual(segundo.resultado?.ignorados, 1);

  const pendurada = criarOferta("B0RACE0005");
  const independente = criarOferta("B0RACE0006");
  let entrouPendente;
  const transportePendenteIniciado = new Promise((resolve) => { entrouPendente = resolve; });
  const envioPendente = enviarOfertaManualV2({ clienteId: workspace,
    ofertaId: pendurada.id, destinosIds: [destino.id] }, deps(async () => {
    entrouPendente();
    return new Promise(() => {});
  }));
  await transportePendenteIniciado;
  assert.strictEqual(locks.size, 0, "advisory e client devolvidos antes da espera de rede");
  assert.strictEqual(clientsRetidos, 0, "nenhuma conexao PG fica retida pelo transporte pendente");
  const mesmoPar = await enviarOfertaManualV2({ clienteId: workspace,
    ofertaId: pendurada.id, destinosIds: [destino.id] }, deps(async () => {
    throw new Error("transporte duplicado");
  }));
  assert.strictEqual(mesmoPar.ignorados, 1, "reserva persistente protege a Promise inconclusiva");
  let enviadosIndependentes = 0;
  const outroPar = await enviarOfertaManualV2({ clienteId: workspace,
    ofertaId: independente.id, destinosIds: [destino.id] }, deps(async () => { enviadosIndependentes += 1; }));
  assert.strictEqual(outroPar.enviados, 1, "outro par nao espera pelo transporte pendente");
  assert.strictEqual(enviadosIndependentes, 1);
  assert.strictEqual(locks.size, 0);
  assert.ok(envioPendente instanceof Promise);

  const preEnvio = criarOferta("B0RACE0007");
  const depsFalhaRender = deps(async () => { throw new Error("nao deve enviar"); });
  depsFalhaRender.montarMensagemOferta = () => { throw new Error("falha antes do transporte"); };
  const primeiraTentativa = await enviarOfertaManualV2({ clienteId: workspace,
    ofertaId: preEnvio.id, destinosIds: [destino.id] }, depsFalhaRender);
  assert.strictEqual(primeiraTentativa.erros, 1);
  const novaTentativa = await enviarOfertaManualV2({ clienteId: workspace,
    ofertaId: preEnvio.id, destinosIds: [destino.id] }, deps(async () => {}));
  assert.strictEqual(novaTentativa.enviados, 1, "falha comprovada pre-envio libera reserva");

  // A Lista usa processarLista -> dispatcher reais. O Automático usa o mesmo
  // boundary invocado por processarFilaInterna, com apenas transporte final fake.
  const listaPrimeiraOferta = criarOferta("B0RACE0008");
  const listaPrimeira = listas.criarLista(workspace, "Lista vence Automatico");
  await listas.adicionarItem(workspace, listaPrimeira.id, { origem: "ofertas", ofertaId: listaPrimeiraOferta.id });
  assert.strictEqual(listas.preflightLista(workspace, listaPrimeira.id, [destino.id]).paresPulados, 0);
  await listas.reservarDestinos(workspace, listaPrimeira.id, [destino.id], 240000,
    { listarDestinosManuaisV2Async: async () => [destino] });
  const autoPrimeiroCoordenador = criarCoordenadorTeste();
  const autoMesmoProduto = { ...listaPrimeiraOferta, id: "fila-auto-race-8" };
  assert.strictEqual(coordenador.chaveClaimProdutoDestino({ clienteId: workspace, oferta: listaPrimeiraOferta,
    destinoId: destino.id }), autoPrimeiroCoordenador.chaveClaimProdutoDestino({ clienteId: workspace,
    oferta: autoMesmoProduto, destinoId: destino.id }));
  let listaEntrou;
  const listaEntrouPromise = new Promise(resolve => { listaEntrou = resolve; });
  let soltarLista;
  const listaEmRede = new Promise(resolve => { soltarLista = resolve; });
  let transportesListaVence = 0;
  const execLista = listas.processarLista(workspace, listaPrimeira.id, deps(async () => {
    transportesListaVence += 1;
    listaEntrou();
    await listaEmRede;
  }));
  await listaEntrouPromise;
  const autoBloqueado = await automatico(autoMesmoProduto, async () => { transportesListaVence += 1; });
  assert.strictEqual(autoBloqueado.resultado, "ocupado");
  soltarLista();
  const resultadoListaPrimeira = await execLista;
  assert.strictEqual(resultadoListaPrimeira.resultado.enviados, 1);
  assert.strictEqual(transportesListaVence, 1, "Lista vence Automatico: um transporte final");

  const autoPrimeiraOferta = criarOferta("B0RACE0009");
  const listaSegunda = listas.criarLista(workspace, "Automatico vence Lista");
  await listas.adicionarItem(workspace, listaSegunda.id, { origem: "ofertas", ofertaId: autoPrimeiraOferta.id });
  assert.strictEqual(listas.preflightLista(workspace, listaSegunda.id, [destino.id]).paresPulados, 0);
  await listas.reservarDestinos(workspace, listaSegunda.id, [destino.id], 240000,
    { listarDestinosManuaisV2Async: async () => [destino] });
  let autoEntrou;
  const autoEntrouPromise = new Promise(resolve => { autoEntrou = resolve; });
  let soltarAuto;
  const autoEmRede = new Promise(resolve => { soltarAuto = resolve; });
  let transportesAutoVence = 0;
  const execAuto = automatico({ ...autoPrimeiraOferta, id: "fila-auto-race-9" }, async () => {
    transportesAutoVence += 1;
    autoEntrou();
    await autoEmRede;
    return { enviado: true, tentouEnvio: true };
  });
  await autoEntrouPromise;
  const listaBloqueada = await listas.processarLista(workspace, listaSegunda.id,
    deps(async () => { transportesAutoVence += 1; }));
  assert.strictEqual(listaBloqueada.resultado?.ignorados, 1);
  soltarAuto();
  const autoConcluido = await execAuto;
  assert.strictEqual(autoConcluido.resultado, "enviado");
  assert.strictEqual(transportesAutoVence, 1, "Automatico vence Lista: um transporte final");
  console.log("ofertas-v2-races-reais.test.js ok");
})().catch((erro) => { console.error(erro); process.exitCode = 1; });
