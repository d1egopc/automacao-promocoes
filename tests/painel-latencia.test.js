"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { EventEmitter } = require("node:events");
const painel = require("../utils/painel-latencia");

function capturarRequest(path, method, clienteId, lento = false) {
  const req = { path, method, originalUrl: `${path}?token=nao-registrar` };
  const res = new EventEmitter();
  res.statusCode = 200;
  painel.iniciar(req);
  if (lento && req.painelLatencia) req.painelLatencia.inicio -= BigInt(lento === true ? 600 : lento) * 1000000n;
  const saidas = [];
  const logOriginal = console.log;
  console.log = (...args) => saidas.push(args);
  try {
    painel.anexar(req, res, () => {
      painel.marcarEntradaHandler(req);
      painel.registrarArquivo("readFileSync", "/segredo/fila.json", 12, 300);
      painel.registrarArquivo("JSON.parse", "/segredo/fila.json", 8, 300);
      painel.registrarDb(3, 5);
      painel.registrarEtapa("validacao", 2);
      res.emit("finish");
      res.emit("close");
    }, () => clienteId);
  } finally {
    console.log = logOriginal;
  }
  return { req, res, saidas };
}

test("rota normal gera resumo único sem detalhes nem dados sensíveis", () => {
  const { saidas } = capturarRequest("/destinos", "GET", "workspace-teste");
  assert.equal(saidas.length, 1);
  const linha = saidas[0].join(" ");
  assert.ok(linha.startsWith("[PERF PAINEL REQUEST]"));
  assert.ok(!linha.includes("workspace-teste"));
  assert.ok(!linha.includes("nao-registrar"));
  assert.ok(!linha.includes("/segredo"));
  const dado = JSON.parse(saidas[0][1]);
  assert.equal(dado.rota, "GET /destinos");
  assert.equal(dado.nivel, "normal");
  assert.equal(dado.encerramento, "finish");
  assert.ok(Number.isFinite(dado.ateHandlerMs));
  assert.equal(dado.etapas, undefined);
  assert.ok(dado.requestId);
  assert.ok(dado.workspaceHash);
});

test("request lento agrega arquivo, parse, DB/pool e etapa sem payload", () => {
  const { saidas } = capturarRequest("/destinos", "POST", "workspace-teste", true);
  assert.equal(saidas.length, 1);
  const dado = JSON.parse(saidas[0][1]);
  assert.equal(dado.rota, "POST /destinos");
  assert.equal(dado.nivel, "lento");
  assert.equal(dado.etapas["arquivo:readFileSync:fila.json"].bytes, 300);
  assert.equal(dado.etapas["arquivo:JSON.parse:fila.json"].totalMs, 8);
  assert.equal(dado.etapas["db:pool_wait"].totalMs, 3);
  assert.equal(dado.etapas["db:sql"].totalMs, 5);
  assert.equal(dado.etapas["handler:validacao"].totalMs, 2);
});

test("rotas fora do escopo não recebem contexto", () => {
  const { req, saidas } = capturarRequest("/health", "GET", "workspace-teste");
  assert.equal(req.painelLatencia, undefined);
  assert.deepEqual(saidas, []);
});

test("rota dinâmica é rotulada sem identificador e >1000 ms recebe nível crítico", () => {
  const { saidas } = capturarRequest("/integracoes/mercadolivre", "POST", "workspace-teste", 1100);
  const dado = JSON.parse(saidas[0][1]);
  assert.equal(dado.rota, "POST /integracoes/:marketplace");
  assert.equal(dado.nivel, "critico");
  assert.ok(!saidas[0][1].includes("mercadolivre"));
});

test("centenas de requests não acumulam listeners nem contextos", () => {
  const rssAntes = process.memoryUsage().rss;
  let totalLogs = 0;
  for (let i = 0; i < 300; i += 1) {
    const { res, saidas } = capturarRequest("/destinos", "GET", `workspace-${i}`);
    totalLogs += saidas.length;
    assert.equal(res.listenerCount("finish"), 0);
    assert.equal(res.listenerCount("close"), 0);
  }
  const rssDepois = process.memoryUsage().rss;
  assert.equal(totalLogs, 300);
  assert.ok(rssDepois - rssAntes < 64 * 1024 * 1024);
});
