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

function ofertaMagalu(parcial = {}) {
  const fonteImportacao = {
    marketplaceDetectado: "magalu",
    adapter: "magalu.manual.adapter",
    parseOnly: true,
    tentativas: [],
    avisos: [],
    camposConfiaveis: [],
    camposAusentes: ["urlAfiliada"],
    ...(parcial.fonteImportacao || {})
  };
  return {
    marketplace: "magalu",
    urlOriginal: urlMagalu,
    urlAfiliada: "",
    titulo: "",
    precoAtual: "",
    imagem: "",
    ...parcial,
    fonteImportacao
  };
}

async function iniciarEConsultar({ id, clienteId = "cliente_a", importarManual, importOptions, deps = {} }) {
  const inicio = iniciarImportacaoMagaluManualV2Async({
    clienteId,
    urlOriginal: urlMagalu,
    importOptions,
    importarManual
  }, {
    idFactory: () => id,
    now: () => isoApos(0),
    ...deps
  });
  assert.strictEqual(inicio.assinc, true);
  await esperar(20);
  return buscarImportacaoMagaluManualV2(inicio.job.jobId, clienteId);
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
const vazio = await iniciarEConsultar({
  id: "job_magalu_vazio",
  importOptions,
  importarManual: async () => ofertaMagalu({
    fonteImportacao: {
      camposConfiaveis: ["urlOriginal"]
    }
  })
});
assert.strictEqual(vazio.status, "erro", "oferta vazia nao deve virar concluido");
assert.strictEqual(vazio.ok, false);
assert.strictEqual(vazio.motivo, "magalu_sem_dados_fatuais_uteis");
assert.strictEqual(vazio.oferta, null);
assert.strictEqual(vazio.interfaceResolucao.polling, false);
let metricasVazio = metricasImportacaoMagaluManualV2();
assert.strictEqual(metricasVazio.erros, 1);
assert.strictEqual(metricasVazio.concluidos, 0);
assert.strictEqual(metricasVazio.taxaSucessoHttp, 0, "vazio nao conta como sucesso HTTP");
const depoisErro = iniciarImportacaoMagaluManualV2Async({
  clienteId: "cliente_a",
  urlOriginal: urlMagalu,
  importOptions,
  importarManual: async () => ofertaMagalu({ titulo: "Smart TV Teste" })
}, {
  idFactory: () => "job_magalu_depois_erro",
  now: () => isoApos(1000)
});
assert.strictEqual(depoisErro.job.jobId, "job_magalu_depois_erro", "erro deve liberar dedupe");
await esperar(20);

resetImportacoesMagaluManualV2();
const somenteTitulo = await iniciarEConsultar({
  id: "job_magalu_titulo",
  importOptions,
  importarManual: async () => ofertaMagalu({
    titulo: "Smartphone Teste",
    fonteImportacao: { camposConfiaveis: ["titulo"] }
  })
});
assert.strictEqual(somenteTitulo.status, "concluido", "titulo valido e evidencia comercial util");

resetImportacoesMagaluManualV2();
const somentePreco = await iniciarEConsultar({
  id: "job_magalu_preco",
  importOptions,
  importarManual: async () => ofertaMagalu({
    precoAtual: "R$ 129,90",
    fonteImportacao: { camposConfiaveis: ["precoAtual"] }
  })
});
assert.strictEqual(somentePreco.status, "concluido", "preco valido e evidencia comercial util");

resetImportacoesMagaluManualV2();
const somenteLink = await iniciarEConsultar({
  id: "job_magalu_link",
  importOptions,
  importarManual: async () => ofertaMagalu({
    urlAfiliada: "https://www.magazinevoce.com.br/magazined1egopc/smart-tv-teste/p/abc123/et/elit/",
    fonteImportacao: {
      camposConfiaveis: ["urlAfiliada"],
      camposAusentes: []
    }
  })
});
assert.strictEqual(somenteLink.status, "concluido", "link afiliado comprovado e evidencia comercial util");

resetImportacoesMagaluManualV2();
const erro403 = await iniciarEConsultar({
  id: "job_magalu_403",
  importOptions,
  importarManual: async () => ofertaMagalu({
    fonteImportacao: {
      avisos: ["magalu_http_403"],
      camposConfiaveis: ["urlOriginal"]
    }
  })
});
assert.strictEqual(erro403.status, "erro");
assert.strictEqual(erro403.motivo, "magalu_http_403", "403 deve preservar motivo factual");
assert.strictEqual(erro403.medidas.exigiriaBrowser, true);

resetImportacoesMagaluManualV2();
const erroCaptcha = await iniciarEConsultar({
  id: "job_magalu_captcha",
  importOptions,
  importarManual: async () => ofertaMagalu({
    fonteImportacao: {
      avisos: ["magalu_captcha_detectado"],
      camposConfiaveis: ["urlOriginal"]
    }
  })
});
assert.strictEqual(erroCaptcha.status, "erro");
assert.strictEqual(erroCaptcha.motivo, "magalu_captcha_detectado", "CAPTCHA deve preservar motivo factual");
assert.strictEqual(erroCaptcha.medidas.exigiriaBrowser, true);

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
