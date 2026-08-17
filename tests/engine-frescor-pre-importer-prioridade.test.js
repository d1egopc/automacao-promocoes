const assert = require("assert");

const {
  calcularCotasFrescorPreImporter,
  avaliarFrescorPreImporter,
  expirarJobPreImporterSeNecessario,
  MOTIVO_FRESCOR_PRE_IMPORTER,
  STATUS_FINAL_FRESCOR_PRE_IMPORTER
} = require("../modules/engine/frescor-pre-importer.service");

const AGORA = Date.parse("2026-08-17T15:00:00.000Z");

function job(id, minutosAtras, extras = {}) {
  const capturado = new Date(AGORA - minutosAtras * 60 * 1000).toISOString();
  return {
    id,
    evento_id: 1000 + id,
    cliente_id: extras.cliente_id || "workspace_generico",
    marketplace: extras.marketplace || "mercadolivre",
    status: extras.status || "pendente",
    prioridade: extras.prioridade ?? 0,
    criado_em: extras.criado_em || capturado,
    atualizado_em: extras.atualizado_em || capturado,
    evento_capturado_em: extras.evento_capturado_em || capturado,
    evento_origem: extras.evento_origem || "radar",
    evento_origem_tipo: extras.evento_origem_tipo || "whatsapp",
    metadata: extras.metadata || {},
    evento_metadata: extras.evento_metadata || {}
  };
}

function ordenarComoPreImporter(jobs, limite) {
  const cotas = calcularCotasFrescorPreImporter(limite);
  const avaliados = jobs.map(item => ({
    job: item,
    frescor: avaliarFrescorPreImporter(item, { agoraMs: AGORA })
  }));

  const frescos = avaliados
    .filter(item => !item.frescor.expirada)
    .sort((a, b) =>
      Number(b.job.prioridade || 0) - Number(a.job.prioridade || 0) ||
      Date.parse(a.job.evento_capturado_em || a.job.criado_em) - Date.parse(b.job.evento_capturado_em || b.job.criado_em) ||
      a.job.id - b.job.id
    )
    .slice(0, cotas.frescos);

  const limpeza = avaliados
    .filter(item => item.frescor.expirada)
    .sort((a, b) =>
      Date.parse(a.job.evento_capturado_em || a.job.criado_em) - Date.parse(b.job.evento_capturado_em || b.job.criado_em) ||
      a.job.id - b.job.id
    )
    .slice(0, cotas.limpeza);

  return [...frescos, ...limpeza].map(item => item.job);
}

async function testarBacklogNaoMonopolizaAguaNova() {
  const antigos = Array.from({ length: 300 }, (_, indice) => job(indice + 1, 120 + indice));
  const novos = Array.from({ length: 20 }, (_, indice) => job(1000 + indice, 5 + indice, {
    prioridade: indice === 0 ? 10 : 0
  }));
  const selecionados = ordenarComoPreImporter([...antigos, ...novos], 30);

  assert.strictEqual(selecionados.length, 26);
  assert.strictEqual(selecionados.filter(item => item.id >= 1000).length, 20, "todos os novos devem entrar no batch antes do backlog morto");
  assert.strictEqual(selecionados.filter(item => item.id < 1000).length, 6, "20% do batch fica para limpeza de backlog");
  assert.strictEqual(selecionados[0].id, 1000, "prioridade/turbo deve vencer dentro dos frescos");
}

async function testarExpiracaoAntesDoProcessorValidatorImporter() {
  const chamadas = {
    processamentos: [],
    status: []
  };
  const expirado = job(501, 60, { status: "pendente" });

  const resultado = await expirarJobPreImporterSeNecessario(expirado, {
    agoraMs: AGORA,
    statusEsperado: "pendente",
    registrarProcessamento: async (...args) => {
      chamadas.processamentos.push(args);
      return { ok: true };
    },
    marcarJobStatus: async (...args) => {
      chamadas.status.push(args);
      return { ok: true };
    }
  });

  assert.strictEqual(resultado.expirou, true);
  assert.strictEqual(chamadas.processamentos.length, 1);
  assert.strictEqual(chamadas.processamentos[0][1], "frescor_pre_importer");
  assert.strictEqual(chamadas.processamentos[0][3], MOTIVO_FRESCOR_PRE_IMPORTER);
  assert.strictEqual(chamadas.status.length, 1);
  assert.strictEqual(chamadas.status[0][1], STATUS_FINAL_FRESCOR_PRE_IMPORTER);
  assert.strictEqual(chamadas.status[0][2], MOTIVO_FRESCOR_PRE_IMPORTER);
  assert.deepStrictEqual(chamadas.status[0][3], { statusEsperado: "pendente" });
}

function testarTtlsComumTurboDentroEFora() {
  const comumVelho = avaliarFrescorPreImporter(job(601, 31), { agoraMs: AGORA });
  const comumFresco = avaliarFrescorPreImporter(job(602, 29), { agoraMs: AGORA });
  const turboVelho = avaliarFrescorPreImporter(job(603, 11, {
    metadata: { cupomTurbo: true, tipoFluxo: "cupom_turbo" }
  }), { agoraMs: AGORA });
  const turboFresco = avaliarFrescorPreImporter(job(604, 9, {
    metadata: { cupomTurbo: true, tipoFluxo: "cupom_turbo" }
  }), { agoraMs: AGORA });

  assert.strictEqual(comumVelho.expirada, true);
  assert.strictEqual(comumFresco.expirada, false);
  assert.strictEqual(turboVelho.expirada, true);
  assert.strictEqual(turboVelho.ttlMs, 10 * 60 * 1000);
  assert.strictEqual(turboFresco.expirada, false);
}

async function testarVelhoDiagnosticadoEProntoNaoImporta() {
  for (const status of ["diagnosticado", "pronto_para_importar"]) {
    let chamouTrabalhoPesado = false;
    const resultado = await expirarJobPreImporterSeNecessario(job(700, 90, { status }), {
      agoraMs: AGORA,
      statusEsperado: status,
      registrarProcessamento: async () => ({ ok: true }),
      marcarJobStatus: async () => ({ ok: true })
    });

    if (!resultado.expirou) chamouTrabalhoPesado = true;
    assert.strictEqual(chamouTrabalhoPesado, false, `${status} velho nao deve chegar ao trabalho pesado`);
    assert.strictEqual(resultado.motivo, MOTIVO_FRESCOR_PRE_IMPORTER);
  }
}

function testarManualV2Intacto() {
  const manual = avaliarFrescorPreImporter(job(801, 300, {
    evento_origem: "manual_v2",
    metadata: { manualV2: true }
  }), { agoraMs: AGORA });

  assert.strictEqual(manual.expirada, false);
  assert.strictEqual(manual.manualV2, true);
  assert.strictEqual(manual.motivo, "manual_v2_preservado");
}

function testarSqlsPriorizamFrescosComCota() {
  const fs = require("fs");
  const path = require("path");
  for (const arquivo of [
    path.join(__dirname, "..", "modules", "engine", "processor.service.js"),
    path.join(__dirname, "..", "modules", "engine", "validator.service.js"),
    path.join(__dirname, "..", "modules", "engine", "importer", "importer.service.js")
  ]) {
    const fonte = fs.readFileSync(arquivo, "utf8");
    assert(fonte.includes("bucket_frescor_pre_importer"), `${arquivo} deve separar fresco/backlog`);
    assert(fonte.includes("UNION ALL"), `${arquivo} deve unir cota fresca e cota de limpeza`);
    assert(fonte.includes("origem_comercial_pre_importer"), `${arquivo} deve ordenar por origem comercial`);
  }
}

(async () => {
  await testarBacklogNaoMonopolizaAguaNova();
  await testarExpiracaoAntesDoProcessorValidatorImporter();
  testarTtlsComumTurboDentroEFora();
  await testarVelhoDiagnosticadoEProntoNaoImporta();
  testarManualV2Intacto();
  testarSqlsPriorizamFrescosComCota();
  console.log("engine-frescor-pre-importer-prioridade.test.js OK");
})().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
