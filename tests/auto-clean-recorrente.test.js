"use strict";

const assert = require("assert");
const {
  autoCleanRecorrenteAtivo,
  executarAutoCleanPostgresRecorrenteSeguro,
  executarOrfaosPostgresAutoClean
} = require("../modules/engine/auto-clean/auto-clean.service");

async function main() {
  const flagAnterior = process.env.OPTIMUS_AUTO_CLEAN_RECURRING;
  try {
    delete process.env.OPTIMUS_AUTO_CLEAN_RECURRING;
    assert.strictEqual(autoCleanRecorrenteAtivo(), false, "recorrencia fica desligada por padrao");

    const chamadas = [];
    const resumo = await executarAutoCleanPostgresRecorrenteSeguro({
      recorrente: true,
      intervaloRecorrenteMinutos: 5,
      executarEstagio: async (stage, opcoes) => {
        chamadas.push({ stage, opcoes });
        return { ok: true, jobsRemovidos: 1, leasesPulados: true };
      },
      logger: { log() {} }
    });
    assert.strictEqual(resumo.ok, true);
    assert.strictEqual(resumo.stage, "jobs");
    assert.strictEqual(resumo.mutacoes, 1);
    assert.strictEqual(resumo.leasesPulados, true);
    assert.strictEqual(resumo.arquivosExecutados, false);
    assert.strictEqual(resumo.filaJsonRegravada, false);
    assert.strictEqual(chamadas.length, 1);
    assert.strictEqual(chamadas[0].opcoes.canarioPostgres, true);
    assert.strictEqual(chamadas[0].opcoes.pularExpiracaoLeases, true);
    assert.strictEqual(chamadas[0].opcoes.execute, false);
    assert.strictEqual(chamadas[0].opcoes.loteLimite, 1);
    assert.strictEqual(chamadas[0].opcoes.lotesDbPorCiclo, 1);
    assert.strictEqual(chamadas[0].opcoes.incluirArquivos, false);
    assert.strictEqual(chamadas[0].opcoes.limiteTotalMutacoes, 32);

    const segundo = await executarAutoCleanPostgresRecorrenteSeguro({
      recorrente: true,
      intervaloRecorrenteMinutos: 5,
      executarEstagio: async () => ({ ok: true }),
      logger: { log() {} }
    });
    assert.strictEqual(segundo.pulado, true, "um ciclo nao sobrepoe a janela configurada");

    const semBanco = await executarOrfaosPostgresAutoClean({
      tipoOrfaos: "processamentos",
      pool: null,
      canarioPostgres: true,
      pularExpiracaoLeases: true
    });
    assert.strictEqual(semBanco.ok, false);
    assert.strictEqual(semBanco.motivo, "banco_indisponivel");

    console.log("AUTO_CLEAN_RECORRENTE_PASS");
  } finally {
    if (flagAnterior === undefined) delete process.env.OPTIMUS_AUTO_CLEAN_RECURRING;
    else process.env.OPTIMUS_AUTO_CLEAN_RECURRING = flagAnterior;
  }
}

main().catch((erro) => {
  console.error(erro);
  process.exitCode = 1;
});
