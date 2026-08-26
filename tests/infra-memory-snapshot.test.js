"use strict";

const assert = require("assert");
const { EventEmitter } = require("events");
const infra = require("../modules/telemetria/infra-memory-snapshot");

function socketFake() {
  const ev = new EventEmitter();
  ev.on("messages.upsert", () => {});
  ev.on("messages.upsert", () => {});
  ev.on("group-participants.update", () => {});
  ev.on("creds.update", () => {});
  return { ev };
}

const sock = socketFake();
const cacheTeste = new Map([["551199999999@s.whatsapp.net", { token: "segredo" }]]);
const fila = [
  { status: "pendente", titulo: "Produto secreto", jid: "551188888888@s.whatsapp.net" },
  { status: "enviado", telefone: "+551177777777" },
  { status: "erro", token: "abc" }
];
const usuarios = [
  { id: "cliente_551199999999", ativo: true, telefone: "+551199999999" },
  { id: "cliente_inativo", ativo: false, senha: "abc" }
];
const fontes = {
  sessoes: { "551199999999@s.whatsapp.net": sock },
  statusSessao: {
    "551199999999@s.whatsapp.net": "open",
    "sessao_logged_out": "logged_out"
  },
  sessoesMeta: {
    "551199999999@s.whatsapp.net": { status: "open", jid: "551199999999@s.whatsapp.net" },
    "sessao_logged_out": { status: "logged_out" }
  },
  fila,
  usuarios,
  configsPorCliente: { cliente_551199999999: { token: "segredo" } },
  destinosPorCliente: { cliente_551199999999: [{ grupo: "grupo-secreto" }] },
  integracoesPorCliente: { cliente_551199999999: { cookies: "segredo" } },
  estruturas: {
    cacheTeste,
    arrayTeste: ["telefone", "token", "payload"],
    objetoTeste: { senha: "abc", jid: "551199999999@s.whatsapp.net" },
    funcaoTamanho: () => 7
  },
  timers: {
    filaGlobal: { ativo: true, intervaloMs: 10000 },
    socialScheduler: { ativo: false }
  }
};

const tamanhoCacheAntes = cacheTeste.size;
const filaAntes = fila.length;
const usuariosAntes = usuarios.length;

const snapshot = infra.criarInfraMemorySnapshot(fontes, {
  agoraMs: Date.parse("2026-08-26T12:00:00.000Z"),
  memoria: {
    rss: 10 * 1024 * 1024,
    heapUsed: 4 * 1024 * 1024,
    heapTotal: 8 * 1024 * 1024,
    external: 2 * 1024 * 1024,
    arrayBuffers: 1024 * 1024
  },
  cpu: { user: 1500, system: 2500 },
  cpuDelta: { user: 500, system: 700 }
});

assert.strictEqual(snapshot.versao, 1);
assert.strictEqual(snapshot.coletadoEm, "2026-08-26T12:00:00.000Z");
assert.strictEqual(snapshot.memoria.rss, 10 * 1024 * 1024);
assert.strictEqual(snapshot.memoria.rssMb, 10);
assert.strictEqual(snapshot.cpu.totalMs, 5);
assert.strictEqual(snapshot.cpu.totalMsDelta, 2);
assert.strictEqual(snapshot.whatsapp.sessoes.total, 2);
assert.strictEqual(snapshot.whatsapp.sessoes.open, 1);
assert.strictEqual(snapshot.whatsapp.sessoes.closedLoggedOut, 1);
assert.strictEqual(snapshot.whatsapp.sockets.vivosConhecidos, 1);
assert.strictEqual(snapshot.whatsapp.sockets.listeners["messages.upsert"].total, 2);
assert.strictEqual(snapshot.whatsapp.sockets.listeners["group-participants.update"].total, 1);
assert.strictEqual(snapshot.whatsapp.sockets.listeners["creds.update"].total, 1);
assert.deepStrictEqual(snapshot.fila, { total: 3, pendentes: 1, enviados: 1, erro: 1 });
assert.strictEqual(snapshot.clientes.usuariosTotal, 2);
assert.strictEqual(snapshot.clientes.usuariosAtivos, 1);
assert.strictEqual(snapshot.clientes.workspacesConhecidos, 2);
assert.strictEqual(snapshot.estruturas.cacheTeste, 1);
assert.strictEqual(snapshot.estruturas.arrayTeste, 3);
assert.strictEqual(snapshot.estruturas.objetoTeste, 2);
assert.strictEqual(snapshot.estruturas.funcaoTamanho, 7);
assert.strictEqual(snapshot.timers.conhecidos, 2);
assert.strictEqual(snapshot.timers.ativos, 1);

const serializado = JSON.stringify(snapshot);
for (const sensivel of [
  "551199999999",
  "551188888888",
  "@s.whatsapp.net",
  "Produto secreto",
  "grupo-secreto",
  "segredo",
  "+551177777777"
]) {
  assert.strictEqual(serializado.includes(sensivel), false, `snapshot nao deve conter ${sensivel}`);
}

assert.strictEqual(cacheTeste.size, tamanhoCacheAntes, "coleta nao deve alterar Map");
assert.strictEqual(fila.length, filaAntes, "coleta nao deve alterar fila");
assert.strictEqual(usuarios.length, usuariosAntes, "coleta nao deve alterar usuarios");
assert.doesNotThrow(() => infra.criarInfraMemorySnapshot());

let callbackIntervalo = null;
let intervaloRegistrado = 0;
let limpou = false;
const logs = [];
const inicio = infra.iniciarInfraMemoryTelemetry({
  fontes,
  intervaloMs: 60000,
  logger: (tag, payload) => logs.push({ tag, payload }),
  setIntervalFn: (fn, intervaloMs) => {
    callbackIntervalo = fn;
    intervaloRegistrado = intervaloMs;
    return { unref() {} };
  }
});

assert.strictEqual(inicio.ok, true);
assert.strictEqual(inicio.iniciado, true);
assert.strictEqual(intervaloRegistrado, 60000);
callbackIntervalo();
assert.strictEqual(logs.length, 1);
assert.strictEqual(logs[0].tag, infra.TAG_INFRA_MEMORY_SNAPSHOT);
assert.strictEqual(JSON.stringify(logs[0]).includes("551199999999"), false);
assert.strictEqual(infra.pararInfraMemoryTelemetry(() => { limpou = true; }), true);
assert.strictEqual(limpou, true);

console.log("infra-memory-snapshot.test.js OK");
