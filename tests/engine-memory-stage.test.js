"use strict";

const assert = require("assert");
const {
  TAG_ENGINE_MEMORY_STAGE,
  NAO_MEDIDO,
  criarMedidorEngineMemoryStage,
  logEngineMemoryStage,
  medirBytesJsonSeguro,
  resumirFilaPorStatus,
  sanearPayload
} = require("../modules/telemetria/engine-memory-stage");

const logs = [];
const logger = {
  log: (...args) => logs.push(args)
};

const antes = { heapUsed: 1000, rss: 5000 };
const depois = { heapUsed: 1800, rss: 6200 };
const payload = logEngineMemoryStage("teste_stage", antes, depois, {
  jobId: 123,
  marketplace: "shopee",
  duracaoMs: 7,
  titulo: "Produto secreto",
  telefone: "+5511999999999",
  jid: "5511999999999@s.whatsapp.net",
  token: "segredo",
  linkOriginal: "https://example.com/produto",
  metadata: { token: "segredo" },
  erroEtapa: "falha com token segredo"
}, { logger });

assert.strictEqual(logs.length, 1);
assert.strictEqual(logs[0][0], TAG_ENGINE_MEMORY_STAGE);
assert.strictEqual(payload.etapa, "teste_stage");
assert.strictEqual(payload.heapUsedAntes, 1000);
assert.strictEqual(payload.heapUsedDepois, 1800);
assert.strictEqual(payload.heapUsedDelta, 800);
assert.strictEqual(payload.rssDelta, 1200);
assert.strictEqual(payload.duracaoMs, 7);
assert.strictEqual(payload.jobId, 123);
assert.strictEqual(payload.erroEtapa, "[redacted]");

const serializado = JSON.stringify(logs);
for (const sensivel of [
  "Produto secreto",
  "+5511999999999",
  "@s.whatsapp.net",
  "segredo",
  "https://example.com",
  "linkOriginal",
  "metadata"
]) {
  assert.strictEqual(serializado.includes(sensivel), false, `log nao deve conter ${sensivel}`);
}

const payloadSanitizado = sanearPayload({
  etapa: "fila",
  filaPorStatus: { pendente: 2, enviado: 1 },
  jobsPorEtapa: { processados: 4, token: "segredo" },
  titulo: "Produto"
});
assert.deepStrictEqual(payloadSanitizado.filaPorStatus, { pendente: 2, enviado: 1 });
assert.deepStrictEqual(payloadSanitizado.jobsPorEtapa, { processados: 4 });
assert.strictEqual(Object.prototype.hasOwnProperty.call(payloadSanitizado, "titulo"), false);
assert.strictEqual(JSON.stringify(payloadSanitizado).includes("segredo"), false);

assert.strictEqual(medirBytesJsonSeguro("abc"), 3);
assert.strictEqual(medirBytesJsonSeguro({ a: 1 }), NAO_MEDIDO);
assert.ok(medirBytesJsonSeguro({ a: 1 }, { permitirSerializar: true }) > 0);
assert.strictEqual(
  medirBytesJsonSeguro(new Array(301).fill({ a: 1 }), { permitirSerializar: true, maxItens: 300 }),
  NAO_MEDIDO
);

const fila = [
  { status: "pendente", titulo: "Produto A" },
  { status: "enviado", jid: "5511999999999@s.whatsapp.net" },
  { status: "erro", token: "abc" },
  {}
];
const filaAntes = JSON.stringify(fila);
assert.deepStrictEqual(resumirFilaPorStatus(fila), {
  filaTotal: 4,
  filaPendentes: 2,
  filaEnviados: 1,
  filaErro: 1,
  filaPorStatus: { pendente: 2, enviado: 1, erro: 1 }
});
assert.strictEqual(JSON.stringify(fila), filaAntes, "resumo nao deve alterar fila");
assert.doesNotThrow(() => resumirFilaPorStatus());

const logsMedidor = [];
const medidor = criarMedidorEngineMemoryStage("medidor_stage", {
  ofertaId: 99,
  titulo: "Nao pode sair"
}, {
  logger: { log: (...args) => logsMedidor.push(args) }
});
medidor.fim({ ok: true });
medidor.fim({ ok: false });
assert.strictEqual(logsMedidor.length, 1, "medidor deve finalizar uma vez");
assert.strictEqual(JSON.stringify(logsMedidor).includes("Nao pode sair"), false);

console.log("engine-memory-stage.test.js OK");
