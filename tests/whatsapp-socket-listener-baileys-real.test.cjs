"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { pathToFileURL } = require("node:url");
const EventEmitter = require("node:events");
const {
  listenerCountSeguro,
  marcarSocketAtual,
  registrarListenerUnicoSocket,
  socketEhAtual,
  diagnosticarEntradaUpsert
} = require("../modules/whatsapp/socket-listener-lifecycle.service.js");
const { contarSocketsWhatsapp } = require("../modules/telemetria/infra-memory-snapshot.js");

async function main() {
  const baileysRoot = path.join(__dirname, "..", "node_modules", "@whiskeysockets", "baileys", "lib");
  await import(pathToFileURL(path.join(baileysRoot, "index.js")).href);
  const { makeEventBuffer } = await import(pathToFileURL(path.join(baileysRoot, "Utils", "event-buffer.js")).href);
  const logger = { log() {}, debug() {}, trace() {} };
  const sessoes = {};
  const geracoes = {};
  const id = "user_k3phmbkf_ClaroTeste";
  const criarSocket = () => ({ ev: makeEventBuffer(logger) });
  const primeiro = criarSocket();

  assert.equal(typeof primeiro.ev.listenerCount, "undefined");
  assert.equal(typeof primeiro.ev.listeners, "undefined");
  assert.equal(listenerCountSeguro(primeiro.ev, "messages.upsert"), null);
  const geracao1 = marcarSocketAtual({ sessoes, geracoes, sessaoId: id, sock: primeiro, logger }).socketGeracao;
  let chamadas1 = 0;
  const handler1 = () => { if (socketEhAtual(sessoes, id, primeiro)) chamadas1++; };
  const args1 = { sock: primeiro, evento: "messages.upsert", chave: "messages.upsert", handler: handler1, sessaoId: id, socketGeracao: geracao1, logger };
  assert.equal(registrarListenerUnicoSocket(args1).registrado, true);
  assert.equal(registrarListenerUnicoSocket(args1).registrado, true,
    "sem introspeccao, off/on reinstala apenas o callback proprio");
  primeiro.ev.emit("messages.upsert", { type: "notify", messages: [{ key: { remoteJid: "fixture@g.us" } }] });
  assert.equal(chamadas1, 1, "registro repetido nao duplica callback");

  primeiro.ev.removeAllListeners("messages.upsert");
  primeiro.ev.emit("messages.upsert", { type: "notify", messages: [] });
  assert.equal(chamadas1, 1, "emissor real confirma a remocao");
  assert.equal(registrarListenerUnicoSocket(args1).registrado, true);
  primeiro.ev.emit("messages.upsert", { type: "notify", messages: [] });
  assert.equal(chamadas1, 2, "registro repetido restaura listener removido");
  registrarListenerUnicoSocket(args1);
  primeiro.ev.emit("messages.upsert", { type: "notify", messages: [] });
  assert.equal(chamadas1, 3, "restauracao nao duplica listener");

  const emissorSubstituido = primeiro.ev;
  primeiro.ev = makeEventBuffer(logger);
  emissorSubstituido.emit("messages.upsert", { type: "notify", messages: [] });
  assert.equal(chamadas1, 3, "emissor antigo fica inerte imediatamente apos a troca");
  assert.equal(registrarListenerUnicoSocket(args1).registrado, true);
  emissorSubstituido.emit("messages.upsert", { type: "notify", messages: [] });
  assert.equal(chamadas1, 3, "emissor substituido nao alcanca handler atual");
  primeiro.ev.emit("messages.upsert", { type: "notify", messages: [] });
  assert.equal(chamadas1, 4, "novo emissor do mesmo socket recebe evento");
  registrarListenerUnicoSocket(args1);
  primeiro.ev.emit("messages.upsert", { type: "notify", messages: [] });
  assert.equal(chamadas1, 5, "novo emissor nao duplica callback em registro repetido");
  let handlerNovo = 0;
  registrarListenerUnicoSocket({ ...args1, handler: () => { if (socketEhAtual(sessoes, id, primeiro)) handlerNovo++; } });
  primeiro.ev.emit("messages.upsert", { type: "notify", messages: [] });
  assert.equal(chamadas1, 5, "callback anterior foi substituido");
  assert.equal(handlerNovo, 1, "callback mais recente recebe uma unica vez");

  const segundo = criarSocket();
  const geracao2 = marcarSocketAtual({ sessoes, geracoes, sessaoId: id, sock: segundo, logger }).socketGeracao;
  assert.equal(geracao2, geracao1 + 1);
  let chamadas2 = 0;
  assert.equal(registrarListenerUnicoSocket({ ...args1, sock: segundo, socketGeracao: geracao2,
    handler: () => { if (socketEhAtual(sessoes, id, segundo)) chamadas2++; } }).registrado, true);
  primeiro.ev.emit("messages.upsert", { type: "notify", messages: [{ key: { remoteJid: "fixture@g.us" } }] });
  segundo.ev.emit("messages.upsert", { type: "notify", messages: [{ key: { remoteJid: "fixture@g.us" } }] });
  assert.equal(chamadas1, 5, "socket antigo nao processa apos reconexao");
  assert.equal(handlerNovo, 1, "callback atual do socket antigo nao processa apos reconexao");
  assert.equal(chamadas2, 1, "nova geracao recebe evento");

  let participantes = 0;
  segundo.ev.on("group-participants.update", () => { participantes++; });
  segundo.ev.emit("group-participants.update", { id: "fixture@g.us", action: "add", participants: ["fixture@lid"] });
  assert.equal(participantes, 1, "evento de participantes usa listener separado");
  const snapshot = contarSocketsWhatsapp(sessoes);
  assert.equal(snapshot.listeners["messages.upsert"].total, null);
  assert.equal(snapshot.listeners["messages.upsert"].socketsSemContagem, 1);

  const nodeSock = { ev: new EventEmitter() };
  assert.equal(registrarListenerUnicoSocket({ sock: nodeSock, evento: "messages.upsert", handler: handler1, logger }).registrado, true);
  nodeSock.ev.removeAllListeners("messages.upsert");
  assert.equal(registrarListenerUnicoSocket({ sock: nodeSock, evento: "messages.upsert", handler: handler1, logger }).registrado, true);

  const semRemocao = { ev: { on() {} } };
  assert.equal(registrarListenerUnicoSocket({ sock: semRemocao, evento: "messages.upsert", handler: handler1, logger }).registrado, true);
  assert.equal(registrarListenerUnicoSocket({ sock: semRemocao, evento: "messages.upsert", handler: handler1, logger }).motivo,
    "remocao_listener_indisponivel", "sem off e sem introspeccao deve falhar fechado");

  const fonte = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  const inicio = fonte.indexOf('registrarListenerUnicoSocket({\n  sock,\n  evento: "messages.upsert"');
  const fim = fonte.indexOf('registrarListenerUnicoSocket({\n  sock,\n  evento: "messages.update"', inicio);
  assert.ok(inicio >= 0 && fim > inicio, "callback produtivo deve ser encontrado");
  const callbackProdutivo = fonte.slice(inicio, fim);
  assert.ok(callbackProdutivo.indexOf("diagnosticarEntradaUpsert({") < callbackProdutivo.indexOf("if (!socketEhAtual"),
    "trace deve preceder guarda de socket");
  assert.ok(callbackProdutivo.indexOf("diagnosticarEntradaUpsert({") < callbackProdutivo.indexOf("for (let indiceMensagem"),
    "trace deve preceder filtros e handlers");

  const logs = [];
  const ordem = [];
  const sessaoTrace = "fixture_Claro";
  const grupo = "fixture@g.us";
  const sessaoProdutiva = {};
  const sock = criarSocket();
  const socketGeracao = marcarSocketAtual({ sessoes: sessaoProdutiva, geracoes: {}, sessaoId: sessaoTrace, sock, logger }).socketGeracao;
  const ambiente = {
    OPTIMUS_MENSAGEIRO_V3_DIAGNOSTIC_WORKSPACE: "fixture_workspace",
    OPTIMUS_MENSAGEIRO_V3_DIAGNOSTIC_SESSION: sessaoTrace
  };
  const registro = {
    sock, id: sessaoTrace, socketGeracao, sessoes: sessaoProdutiva, force: false,
    clienteIdMensageiro: "fixture_workspace", registrarListenerUnicoSocket, socketEhAtual,
    diagnosticarEntradaUpsert: args => diagnosticarEntradaUpsert({ ...args, env: ambiente,
      logger: { warn: (tag, payload) => { ordem.push("trace"); logs.push({ tag, payload: JSON.parse(payload) }); } } }),
    diagnosticoMensageiroV3() {},
    coberturaRadar: { flagAtiva: () => false, registrar() {}, criarCoberturaTraceId: () => "fixture",
      extrairFidelidadeTraceId: () => "", extrairMensagemId: () => "" },
    gerenteTraceEnabled: () => false,
    usuarioAtivoOperacional: () => true,
    obterNomeGrupoRadar: () => "",
    executarConsumidorMensagemIsolado: async ({ consumidor, executar }) => {
      const resultado = await executar();
      if (consumidor === "mensageiro_gerente" || consumidor === "mensageiro_comando") ordem.push(consumidor);
      return { ok: true, resultado };
    },
    processarMensagemRadarAutomatica: async () => ({}),
    dispatchMensageiroV3Ingress: async ({ card }) => ({ card }),
    clienteTemRecursoMensageiro: () => true,
    resolverClienteClonePorSessao: () => ({ valido: false, motivo: "fixture" }),
    clonadorGruposService: {},
    console: { log() {} }
  };
  vm.runInNewContext(callbackProdutivo, registro, { filename: "index.js:messages.upsert" });
  sock.ev.emit("messages.upsert", { type: "notify", messages: [{ key: { remoteJid: grupo, fromMe: false }, message: { conversation: "SEGREDO_NAO_LOGAR" } }] });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(ordem.slice(0, 3), ["trace", "mensageiro_gerente", "mensageiro_comando"]);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].payload.fromMe, false);
  assert.equal(logs[0].payload.tipoEvento, "notify");
  assert.equal(logs[0].payload.groupHash.length, 12);
  assert.ok(!JSON.stringify(logs).includes(grupo));
  assert.ok(!JSON.stringify(logs).includes("SEGREDO_NAO_LOGAR"));
  const novoSocket = criarSocket();
  marcarSocketAtual({ sessoes: sessaoProdutiva, geracoes: { [sessaoTrace]: socketGeracao },
    sessaoId: sessaoTrace, sock: novoSocket, logger });
  sock.ev.emit("messages.upsert", { type: "notify", messages: [{ key: { remoteJid: grupo, fromMe: true } }] });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(logs.length, 2, "trace deve registrar ingresso antes da rejeicao do socket antigo");
  assert.equal(logs[1].payload.fromMe, true);
  assert.equal(ordem.filter(item => item === "mensageiro_gerente").length, 1,
    "socket antigo nao alcanca Gerente depois da troca de geracao");
  assert.equal(ordem.filter(item => item === "mensageiro_comando").length, 1,
    "socket antigo nao alcanca Comandos depois da troca de geracao");
  assert.equal(diagnosticarEntradaUpsert({ workspaceId: "fixture_workspace", sessaoId: sessaoTrace,
    messages: [{ key: { remoteJid: grupo } }], env: {}, logger: { warn() { throw new Error("nao deveria logar"); } } }), 0);
  assert.doesNotThrow(() => diagnosticarEntradaUpsert({ workspaceId: "fixture_workspace", sessaoId: sessaoTrace,
    messages: [{ key: { remoteJid: grupo } }], env: ambiente,
    logger: { warn() { throw new Error("logger_indisponivel"); } } }),
  "falha do logger nao pode bloquear os handlers");

  console.log(`PASS ${process.version}: Baileys 6.7.22, dedup, reconexao, trace inicial e handlers V3`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
