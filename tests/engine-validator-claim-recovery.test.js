"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

function limpar(relativo) {
  const resolvido = require.resolve(relativo);
  delete require.cache[resolvido];
  return resolvido;
}

function mock(relativo, exports) {
  const resolvido = limpar(relativo);
  require.cache[resolvido] = { id: resolvido, filename: resolvido, loaded: true, exports };
  return resolvido;
}

function restaurar(resolvido, original) {
  delete require.cache[resolvido];
  if (original) require.cache[resolvido] = original;
}

async function testarClaimERecoveryComCas() {
  const databasePath = require.resolve("../modules/engine/database");
  const processorPath = require.resolve("../modules/engine/processor.service");
  const jobsPath = require.resolve("../modules/engine/jobs.service");
  const validatorPath = require.resolve("../modules/engine/validator.service");
  const originais = {
    database: require.cache[databasePath],
    processor: require.cache[processorPath],
    jobs: require.cache[jobsPath],
    validator: require.cache[validatorPath]
  };
  const chamadas = [];
  let claims = 0;

  try {
    mock("../modules/engine/database", {
      queryEngine: async (sql, params = []) => {
        chamadas.push({ sql, params });
        if (/SET status = 'validando'/i.test(sql)) {
          claims += 1;
          return { ok: true, resultado: { rows: claims === 1 ? [{ id: 701, status: "validando" }] : [], rowCount: claims === 1 ? 1 : 0 } };
        }
        if (/WITH candidatos AS/i.test(sql)) {
          return { ok: true, resultado: { rows: [{ recuperados: "1", ids: [702] }], rowCount: 1 } };
        }
        throw new Error(`query inesperada: ${sql}`);
      }
    });
    mock("../modules/engine/processor.service", {
      limitarJobs: valor => Math.min(Number(valor) || 20, 100),
      marcarJobStatus: async () => ({ ok: true, resultado: { rows: [{ id: 701 }] } }),
      registrarProcessamento: async () => ({ ok: true })
    });
    mock("../modules/engine/jobs.service", { minutosLeaseJobsAtivos: () => 30 });
    limpar("../modules/engine/validator.service");
    const validator = require("../modules/engine/validator.service");

    const primeiro = await validator.tentarMarcarValidando(701);
    const segundo = await validator.tentarMarcarValidando(701);
    assert.strictEqual(primeiro.claimed, true, "primeiro CAS deve obter o job");
    assert.strictEqual(segundo.claimed, false, "segundo CAS deve perder o job");
    assert.ok(chamadas[0].sql.includes("status = 'diagnosticado'"));

    const recovery = await validator.recuperarJobsValidandoStale(9);
    assert.strictEqual(recovery.recuperados, 1);
    assert.deepStrictEqual(recovery.ids, [702]);
    const recoveryCall = chamadas.find(chamada => /WITH candidatos AS/i.test(chamada.sql));
    assert.ok(recoveryCall.sql.includes("FOR UPDATE SKIP LOCKED"));
    assert.deepStrictEqual(recoveryCall.params, [30, 9]);
    assert.ok(recoveryCall.sql.includes("status = 'diagnosticado'"));
    assert.ok(recoveryCall.sql.includes("validacao_lease_recuperado"));
  } finally {
    restaurar(databasePath, originais.database);
    restaurar(processorPath, originais.processor);
    restaurar(jobsPath, originais.jobs);
    restaurar(validatorPath, originais.validator);
  }
}

async function testarConclusaoEcatchExigemValidando() {
  const databasePath = require.resolve("../modules/engine/database");
  const processorPath = require.resolve("../modules/engine/processor.service");
  const jobsPath = require.resolve("../modules/engine/jobs.service");
  const validatorPath = require.resolve("../modules/engine/validator.service");
  const originais = {
    database: require.cache[databasePath],
    processor: require.cache[processorPath],
    jobs: require.cache[jobsPath],
    validator: require.cache[validatorPath]
  };
  const marcacoes = [];

  try {
    mock("../modules/engine/database", { queryEngine: async () => ({ ok: true, resultado: { rows: [] } }) });
    mock("../modules/engine/processor.service", {
      limitarJobs: valor => Number(valor || 20),
      marcarJobStatus: async (_id, status, _motivo, extras) => {
        marcacoes.push({ status, extras });
        return { ok: true, resultado: { rows: [{ id: 703, status }], rowCount: 1 } };
      },
      registrarProcessamento: async () => ({ ok: true })
    });
    mock("../modules/engine/jobs.service", { minutosLeaseJobsAtivos: () => 30 });
    limpar("../modules/engine/validator.service");
    const validator = require("../modules/engine/validator.service");
    const resultado = await validator.finalizarValidacaoJob({ id: 703 }, "pronto_para_importar", "validacao_ok");
    assert.strictEqual(resultado.status, "pronto_para_importar");
    assert.deepStrictEqual(marcacoes[0].extras, { statusEsperado: "validando" });

    marcacoes.length = 0;
    mock("../modules/engine/processor.service", {
      limitarJobs: valor => Number(valor || 20),
      marcarJobStatus: async (_id, status, _motivo, extras) => {
        marcacoes.push({ status, extras });
        return { ok: false, ignorado: true, motivo: "status_origem_incompativel" };
      },
      registrarProcessamento: async () => ({ ok: true })
    });
    limpar("../modules/engine/validator.service");
    const validatorAposRecovery = require("../modules/engine/validator.service");
    const antigo = await validatorAposRecovery.finalizarValidacaoJob({ id: 703 }, "pronto_para_importar", "validacao_ok");
    assert.strictEqual(antigo.ignorado, true, "execucao antiga nao pode sobrescrever job recuperado");
    assert.deepStrictEqual(marcacoes[0].extras, { statusEsperado: "validando" });
  } finally {
    restaurar(databasePath, originais.database);
    restaurar(processorPath, originais.processor);
    restaurar(jobsPath, originais.jobs);
    restaurar(validatorPath, originais.validator);
  }
}

async function testarRunnerNaoValidaSemClaimECatchProtegido() {
  const validatorPath = require.resolve("../modules/engine/validator.service");
  const processorPath = require.resolve("../modules/engine/processor.service");
  const frescorPath = require.resolve("../modules/engine/frescor-pre-importer.service");
  const loggerPath = require.resolve("../modules/engine/logger");
  const runnerPath = require.resolve("../modules/engine/validator.runner");
  const originais = {
    validator: require.cache[validatorPath],
    processor: require.cache[processorPath],
    frescor: require.cache[frescorPath],
    logger: require.cache[loggerPath],
    runner: require.cache[runnerPath]
  };
  const marcacoes = [];
  let validacoes = 0;

  try {
    mock("../modules/engine/validator.service", {
      recuperarJobsValidandoStale: async () => ({ ok: true, recuperados: 0 }),
      buscarJobsDiagnosticados: async () => ({ ok: true, jobs: [{ id: 704, evento_id: 1, cliente_id: "workspace" }] }),
      tentarMarcarValidando: async () => ({ ok: true, claimed: true }),
      validarJobDiagnosticadoEngine: async () => {
        validacoes += 1;
        throw new Error("falha controlada");
      }
    });
    mock("../modules/engine/processor.service", {
      limitarJobs: valor => Number(valor || 20),
      marcarJobStatus: async (_id, status, _motivo, extras) => {
        marcacoes.push({ status, extras });
        return { ok: true };
      },
      registrarProcessamento: async () => ({ ok: true })
    });
    mock("../modules/engine/frescor-pre-importer.service", {
      expirarJobPreImporterSeNecessario: async () => ({ expirou: false }),
      resumirSelecaoFrescorPreImporter: () => ({ frescosSelecionados: 1, expiradosCandidatos: 0, idadeMediaJobsSelecionadosMs: 0 })
    });
    mock("../modules/engine/logger", {
      logEngineProcessadorInicio: () => {},
      logEngineProcessadorJob: () => {},
      logEngineProcessadorErro: () => {},
      logEngineProcessadorFim: () => {}
    });
    limpar("../modules/engine/validator.runner");
    const { validarJobsDiagnosticadosEngine } = require("../modules/engine/validator.runner");
    const resumo = await validarJobsDiagnosticadosEngine({ limite: 1 });
    assert.strictEqual(validacoes, 1);
    assert.strictEqual(resumo.erro_validacao, 1);
    assert.deepStrictEqual(marcacoes[0], { status: "erro_validacao", extras: { statusEsperado: "validando" } });

    validacoes = 0;
    marcacoes.length = 0;
    mock("../modules/engine/validator.service", {
      recuperarJobsValidandoStale: async () => ({ ok: true, recuperados: 0 }),
      buscarJobsDiagnosticados: async () => ({ ok: true, jobs: [{ id: 705, evento_id: 1, cliente_id: "workspace" }] }),
      tentarMarcarValidando: async () => ({ ok: true, claimed: false }),
      validarJobDiagnosticadoEngine: async () => { validacoes += 1; return { status: "pronto_para_importar" }; }
    });
    limpar("../modules/engine/validator.runner");
    const { validarJobsDiagnosticadosEngine: executarSemClaim } = require("../modules/engine/validator.runner");
    const semClaim = await executarSemClaim({ limite: 1 });
    assert.strictEqual(validacoes, 0, "job sem claim nao pode ser validado");
    assert.strictEqual(semClaim.processados, 0);
    assert.strictEqual(semClaim.claimsPerdidos, 1);
    assert.strictEqual(marcacoes.length, 0);
  } finally {
    restaurar(validatorPath, originais.validator);
    restaurar(processorPath, originais.processor);
    restaurar(frescorPath, originais.frescor);
    restaurar(loggerPath, originais.logger);
    restaurar(runnerPath, originais.runner);
  }
}

function testarReconhecimentoOperacional() {
  const jobs = require("../modules/engine/jobs.service");
  const autoClean = require("../modules/engine/auto-clean/auto-clean.service");
  const reset = require("../modules/engine/reset-operacional/criterios.service");
  const live = require("../modules/engine/ofc/live-flow.repository");
  const stuckFonte = fs.readFileSync(path.join(__dirname, "..", "modules", "engine", "ofc", "stuck-jobs.repository.js"), "utf8");
  const metricsFonte = fs.readFileSync(path.join(__dirname, "..", "modules", "engine", "ofc", "metrics.repository.js"), "utf8");

  assert.ok(jobs.STATUS_JOBS_ATIVOS_RETENCAO.includes("validando"));
  assert.ok(!jobs.STATUS_JOBS_ATIVOS_COM_LEASE.includes("validando"), "recovery do Validator nao pode cair na expiracao generica");
  assert.strictEqual(autoClean.MATRIZ_STATUS_AUTO_CLEAN.validando.decisao, "preservar_ativo_recuperar_pelo_validator");
  assert.strictEqual(reset.classificarJobReset({ status: "validando" }, "2026-01-01T00:00:00.000Z").acao, "preservar");
  assert.ok(live.STATUS_VIVOS_FLUXO.includes("validando"));
  assert.ok(live.STATUS_EM_CURSO_PROTEGIDOS_FLUXO.includes("validando"));
  assert.ok(stuckFonte.includes("j.status IN ('validando', 'processando', 'importando')"));
  assert.ok(metricsFonte.includes("'diagnosticado', 'validando', 'pronto_para_importar'"));
}

(async () => {
  await testarClaimERecoveryComCas();
  await testarConclusaoEcatchExigemValidando();
  await testarRunnerNaoValidaSemClaimECatchProtegido();
  testarReconhecimentoOperacional();
  console.log("engine-validator-claim-recovery.test.js OK");
})().catch(erro => {
  console.error(erro);
  process.exit(1);
});
