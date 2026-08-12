"use strict";

const assert = require("assert");
const EventEmitter = require("events");

const {
  marcarSocketAtual,
  registrarListenerUnicoSocket,
  socketEhAtual
} = require("../modules/whatsapp/socket-listener-lifecycle.service");

function criarSocketFake() {
  return { ev: new EventEmitter() };
}

const logs = [];
const logger = {
  log: (...args) => logs.push(args)
};

const sessoes = {};
const geracoes = {};
const sessaoId = "admin_Zoio";

const socketInicial = criarSocketFake();
const registroInicial = marcarSocketAtual({
  sessoes,
  geracoes,
  sessaoId,
  sock: socketInicial,
  logger,
  motivo: "boot"
});

assert.strictEqual(registroInicial.socketGeracao, 1, "socket inicial deve receber geracao 1");
assert.strictEqual(socketEhAtual(sessoes, sessaoId, socketInicial), true, "socket inicial deve ser atual");

let chamadasProcessador = 0;
const handlerInicial = () => {
  if (!socketEhAtual(sessoes, sessaoId, socketInicial)) return;
  chamadasProcessador += 1;
};

const listenerInicial = registrarListenerUnicoSocket({
  sock: socketInicial,
  evento: "messages.upsert",
  chave: "messages.upsert",
  handler: handlerInicial,
  logger,
  sessaoId,
  socketGeracao: registroInicial.socketGeracao,
  motivoRegistro: "boot"
});

assert.strictEqual(listenerInicial.registrado, true, "boot deve registrar messages.upsert");
assert.strictEqual(socketInicial.ev.listenerCount("messages.upsert"), 1, "listener inicial deve existir uma vez");

const listenerDuplicado = registrarListenerUnicoSocket({
  sock: socketInicial,
  evento: "messages.upsert",
  chave: "messages.upsert",
  handler: handlerInicial,
  logger,
  sessaoId,
  socketGeracao: registroInicial.socketGeracao,
  motivoRegistro: "boot_repetido"
});

assert.strictEqual(listenerDuplicado.registrado, false, "mesmo socket nao pode duplicar listener");
assert.strictEqual(socketInicial.ev.listenerCount("messages.upsert"), 1, "listener duplicado nao deve ser anexado");

socketInicial.ev.emit("messages.upsert", { messages: [{ key: { remoteJid: "120363408782037034@g.us" } }] });
assert.strictEqual(chamadasProcessador, 1, "mensagem do socket atual deve chegar ao processador");

const socketReconectado = criarSocketFake();
const registroReconectado = marcarSocketAtual({
  sessoes,
  geracoes,
  sessaoId,
  sock: socketReconectado,
  logger,
  motivo: "reconnect"
});

assert.strictEqual(registroReconectado.socketGeracao, 2, "reconnect deve criar nova geracao");
assert.strictEqual(socketEhAtual(sessoes, sessaoId, socketInicial), false, "socket antigo nao pode continuar operacional");
assert.strictEqual(socketEhAtual(sessoes, sessaoId, socketReconectado), true, "socket reconectado deve ser atual");

let chamadasNovoSocket = 0;
const handlerReconectado = () => {
  if (!socketEhAtual(sessoes, sessaoId, socketReconectado)) return;
  chamadasNovoSocket += 1;
};

const listenerReconectado = registrarListenerUnicoSocket({
  sock: socketReconectado,
  evento: "messages.upsert",
  chave: "messages.upsert",
  handler: handlerReconectado,
  logger,
  sessaoId,
  socketGeracao: registroReconectado.socketGeracao,
  motivoRegistro: "reconnect"
});

assert.strictEqual(listenerReconectado.registrado, true, "socket reconectado deve registrar messages.upsert");
assert.strictEqual(socketReconectado.ev.listenerCount("messages.upsert"), 1, "reconnect deve anexar exatamente um listener");

socketInicial.ev.emit("messages.upsert", { messages: [{ key: { remoteJid: "120363164512544247@g.us" } }] });
assert.strictEqual(chamadasProcessador, 1, "socket antigo nao deve processar depois do reconnect");

socketReconectado.ev.emit("messages.upsert", { messages: [{ key: { remoteJid: "120363164512544247@g.us" } }] });
assert.strictEqual(chamadasNovoSocket, 1, "mensagem de grupo depois do reconnect deve chegar ao processador atual");

const eventosRegistro = logs
  .map(args => String(args[0] || ""))
  .filter(linha => linha === "[WHATSAPP-LISTENER-UPSERT]");

assert.ok(eventosRegistro.length >= 3, "registro/nao-duplicacao do listener deve ser observavel");

console.log("whatsapp-socket-listener-lifecycle.test.js OK");
