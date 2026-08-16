"use strict";

const assert = require("assert");

const {
  normalizarOfertaManualV2
} = require("../modules/manual-v2/manual-offers.contract");
const {
  iniciarImportacaoMagaluManualV2Async,
  buscarImportacaoMagaluManualV2,
  metricasImportacaoMagaluManualV2,
  resetImportacoesMagaluManualV2
} = require("../modules/manual-v2/magalu-factual-jobs.service");

const urlMagalu = "https://www.magazineluiza.com.br/smart-tv-teste/p/abc123/et/elit/";
const BASE_MS = Date.now();

function esperar(ms = 0) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isoApos(ms = 0) {
  return new Date(BASE_MS + ms).toISOString();
}

(async function main() {
resetImportacoesMagaluManualV2();
const chamadas = [];
let seq = 0;
const importOptions = {
  getIntegracaoCliente(clienteId, marketplace) {
    assert.strictEqual(clienteId, "cliente_a");
    assert.strictEqual(marketplace, "magalu");
    return { credenciais: { promoterId: "d1egopc" } };
  }
};
const importarManual = async (url, opcoes = {}) => {
  chamadas.push({ url, clienteId: opcoes.clienteId, parserOptions: opcoes.parserOptions });
  await esperar(20);
  return normalizarOfertaManualV2({
    marketplace: "magalu",
    urlOriginal: url,
    urlAfiliada: "https://www.magazinevoce.com.br/magazined1egopc/smart-tv-teste/p/abc123/et/elit/",
    titulo: "Smart TV Teste",
    precoAtual: "99,90",
    fonteImportacao: {
      marketplaceDetectado: "magalu",
      adapter: "magalu.manual.adapter",
      parseOnly: true,
      tentativas: [
        { fonte: "pdp_www", statusFactual: "aceita", motivo: "aceito" }
      ],
      avisos: [],
      camposConfiaveis: ["urlAfiliada", "titulo", "precoAtual"]
    }
  }, {
    clienteId: opcoes.clienteId,
    now: isoApos(0),
    idFactory: () => "manual_v2_magalu_async"
  });
};

const primeiro = iniciarImportacaoMagaluManualV2Async({
  clienteId: "cliente_a",
  urlOriginal: urlMagalu,
  importOptions,
  importarManual
}, {
  idFactory: () => `job_magalu_${++seq}`,
  now: () => isoApos(0)
});
const segundo = iniciarImportacaoMagaluManualV2Async({
  clienteId: "cliente_a",
  urlOriginal: urlMagalu,
  importOptions,
  importarManual
}, {
  idFactory: () => `job_magalu_${++seq}`,
  now: () => isoApos(1000)
});

assert.strictEqual(primeiro.assinc, true);
assert.strictEqual(segundo.assinc, true);
assert.strictEqual(segundo.job.jobId, primeiro.job.jobId, "job em andamento deve ser deduplicado");
assert.strictEqual(segundo.job.deduplicado, true);

await esperar(40);
const status = buscarImportacaoMagaluManualV2(primeiro.job.jobId, "cliente_a");
assert.strictEqual(status.status, "concluido");
assert.strictEqual(status.oferta.marketplace, "magalu");
assert.strictEqual(status.oferta.urlAfiliada.includes("magazined1egopc"), true);
assert.strictEqual(chamadas.length, 1, "adapter manual deve rodar uma unica vez para produto deduplicado");
assert.strictEqual(chamadas[0].parserOptions.retries, 2, "Manual assincrono deve usar politica tolerante");
assert.strictEqual(chamadas[0].parserOptions.timeoutMs, 5000);
assert.strictEqual(buscarImportacaoMagaluManualV2(primeiro.job.jobId, "cliente_b"), null);

const metricas = metricasImportacaoMagaluManualV2();
assert.strictEqual(metricas.total, 1);
assert.strictEqual(metricas.concluidos, 1);
assert.strictEqual(metricas.exigiriamBrowser, 0);
assert.ok(metricas.tempoMedioMs >= 0);

resetImportacoesMagaluManualV2();
let chamadasTravadas = 0;
const travado = iniciarImportacaoMagaluManualV2Async({
  clienteId: "cliente_a",
  urlOriginal: urlMagalu,
  importOptions,
  importarManual: async () => {
    chamadasTravadas += 1;
    return new Promise(() => {});
  }
}, {
  idFactory: () => "job_magalu_travado",
  now: () => isoApos(10 * 60 * 1000),
  hardTimeoutMs: 20
});
assert.strictEqual(travado.assinc, true);
await esperar(45);
const expirado = buscarImportacaoMagaluManualV2("job_magalu_travado", "cliente_a");
assert.strictEqual(expirado.status, "expirado", "job travado deve virar expirado");
assert.strictEqual(expirado.ok, false);
assert.strictEqual(expirado.motivo, "magalu_resolucao_expirada");
assert.strictEqual(expirado.interfaceResolucao.polling, false, "polling de expirado deve encerrar");

const depoisExpirado = iniciarImportacaoMagaluManualV2Async({
  clienteId: "cliente_a",
  urlOriginal: urlMagalu,
  importOptions,
  importarManual
}, {
  idFactory: () => "job_magalu_depois_expirado",
  now: () => isoApos((10 * 60 * 1000) + 1000),
  hardTimeoutMs: 1000
});
assert.strictEqual(depoisExpirado.job.jobId, "job_magalu_depois_expirado", "expirado deve sair do dedupe");
assert.strictEqual(chamadasTravadas, 1);
await esperar(40);

resetImportacoesMagaluManualV2();
const antigo = iniciarImportacaoMagaluManualV2Async({
  clienteId: "cliente_a",
  urlOriginal: urlMagalu,
  importOptions,
  importarManual
}, {
  idFactory: () => "job_magalu_antigo",
  now: () => isoApos(0)
});
await esperar(40);
assert.strictEqual(buscarImportacaoMagaluManualV2(antigo.job.jobId, "cliente_a").status, "concluido");
iniciarImportacaoMagaluManualV2Async({
  clienteId: "cliente_a",
  urlOriginal: "https://www.magazineluiza.com.br/outro/p/abc124/et/elit/",
  importOptions,
  importarManual
}, {
  idFactory: () => "job_magalu_limpeza",
  now: () => isoApos((20 * 60 * 1000) + 30000)
});
assert.strictEqual(buscarImportacaoMagaluManualV2(antigo.job.jobId, "cliente_a"), null, "jobs concluidos antigos devem ser removidos");

resetImportacoesMagaluManualV2();
for (let i = 0; i < 205; i += 1) {
  iniciarImportacaoMagaluManualV2Async({
    clienteId: "cliente_a",
    urlOriginal: `https://www.magazineluiza.com.br/produto-${i}/p/m${i}/et/elit/`,
    importOptions,
    importarManual
  }, {
    idFactory: () => `job_metricas_${i}`,
    now: () => isoApos(60 * 60 * 1000)
  });
}
await esperar(80);
const metricasLimitadas = metricasImportacaoMagaluManualV2();
assert.strictEqual(metricasLimitadas.total, 200, "metricas devem manter janela limitada");
assert.strictEqual(metricasLimitadas.janelaMaxima, 200);

console.log("manual-v2-magalu-async.test.js ok");
})().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
