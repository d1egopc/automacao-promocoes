"use strict";

const assert = require("assert");

function limparModulo(relativo) {
  delete require.cache[require.resolve(relativo)];
}

async function testarFluxoVivoUsaLeasePersistido() {
  const databasePath = require.resolve("../modules/engine/database");
  const repositoryPath = require.resolve("../modules/engine/ofc/live-flow.repository");
  const database = require(databasePath);
  const queryOriginal = database.queryEngine;
  const chamadas = [];

  try {
    database.queryEngine = async (sql, params = []) => {
      chamadas.push({ sql, params });
      if (/GROUP BY status/i.test(sql)) {
        return { ok: true, resultado: { rows: [{ status: "importando", total: 1, idade_maxima_ms: 40 * 60 * 1000, suspeitos_lock: 1 }] } };
      }
      if (/LIMIT \$2/i.test(sql) && /SELECT id,\s+cliente_id/i.test(sql)) {
        return { ok: true, resultado: { rows: [] } };
      }
      return { ok: true, resultado: { rows: [{ total: 0, idade_media_ms: 0 }] } };
    };

    delete require.cache[repositoryPath];
    const { consultarFluxoVivoOfc } = require(repositoryPath);
    const resumo = await consultarFluxoVivoOfc({ janelaMinutos: 15 });

    assert.strictEqual(resumo.ok, true);
    assert.strictEqual(resumo.leaseJobsAtivosMinutos, 30);

    const consultaVivos = chamadas.find(chamada =>
      /status = ANY\(\$1::text\[\]\)/i.test(chamada.sql) &&
      /status <> ALL\(\$2::text\[\]\)/i.test(chamada.sql)
    );
    assert.ok(consultaVivos, "fluxo vivo deve separar circulaveis de jobs em lease");
    assert.deepStrictEqual(consultaVivos.params[0], ["pendente", "pronto_para_importar", "processando", "importando"]);
    assert.deepStrictEqual(consultaVivos.params[1], ["processando", "importando"]);
    assert.strictEqual(consultaVivos.params[2], 30);
    assert.ok(
      consultaVivos.sql.includes("COALESCE(atualizado_em, criado_em) >= NOW() - ($3::int * INTERVAL '1 minute')"),
      "job vencido pelo lease nao continua contando como capacidade viva"
    );

    const consultaEmCurso = chamadas.find(chamada =>
      chamada.params?.[0]?.includes?.("processando") &&
      chamada.params?.[0]?.includes?.("importando") &&
      chamada.params?.[1] === 30 &&
      /COALESCE\(atualizado_em, criado_em\) >= NOW\(\)/i.test(chamada.sql)
    );
    assert.ok(consultaEmCurso, "emCursoProtegidos deve contar somente processando/importando frescos");
  } finally {
    database.queryEngine = queryOriginal;
    delete require.cache[repositoryPath];
  }
}

async function testarHeartbeatRenovaSomenteJobAtivo() {
  const databasePath = require.resolve("../modules/engine/database");
  const processorPath = require.resolve("../modules/engine/processor.service");
  const database = require(databasePath);
  const queryOriginal = database.queryEngine;
  const chamadas = [];

  try {
    database.queryEngine = async (sql, params = []) => {
      chamadas.push({ sql, params });
      if (/INSERT INTO engine_processamentos/i.test(sql)) {
        return { ok: true, resultado: { rows: [{ id: 1 }], rowCount: 1 } };
      }
      if (/UPDATE engine_jobs_cliente/i.test(sql) && /SET atualizado_em = NOW\(\)/i.test(sql)) {
        return { ok: true, resultado: { rows: [{ id: params[0], status: "importando" }], rowCount: 1 } };
      }
      throw new Error(`query inesperada: ${sql}`);
    };

    limparModulo("../modules/engine/processor.service");
    const { registrarProcessamento } = require(processorPath);
    await registrarProcessamento(77, "importador_executado", "ok", "importador_ok", { clienteId: "user_a" });

    assert.strictEqual(chamadas.length, 2);
    assert.ok(/INSERT INTO engine_processamentos/i.test(chamadas[0].sql), "checkpoint existente deve continuar registrando processamento");
    assert.ok(/UPDATE engine_jobs_cliente/i.test(chamadas[1].sql), "checkpoint legitimo deve renovar heartbeat");
    assert.ok(chamadas[1].sql.includes("AND status = ANY($2::text[])"), "heartbeat so renova job ainda ativo");
    assert.deepStrictEqual(chamadas[1].params[1], ["processando", "importando"]);
  } finally {
    database.queryEngine = queryOriginal;
    limparModulo("../modules/engine/processor.service");
  }
}

async function testarImporterAntigoNaoRessuscitaExpirado() {
  const databasePath = require.resolve("../modules/engine/database");
  const processorPath = require.resolve("../modules/engine/processor.service");
  const importerPath = require.resolve("../modules/engine/importer/importer.service");
  const database = require(databasePath);
  const queryOriginal = database.queryEngine;
  const chamadas = [];

  try {
    database.queryEngine = async (sql, params = []) => {
      chamadas.push({ sql, params });
      if (/SET status = 'oferta_criada'/i.test(sql)) {
        assert.ok(sql.includes("WHERE id = $1 AND status = 'importando'"));
        return { ok: true, resultado: { rows: [], rowCount: 0 } };
      }
      throw new Error(`query inesperada: ${sql}`);
    };

    limparModulo("../modules/engine/processor.service");
    limparModulo("../modules/engine/importer/importer.service");
    const { marcarJobOfertaCriada } = require(importerPath);
    const resultado = await marcarJobOfertaCriada(88, 501);

    assert.strictEqual(resultado.ok, false);
    assert.strictEqual(resultado.ignorado, true);
    assert.strictEqual(resultado.motivo, "job_nao_importando");
    assert.strictEqual(chamadas.length, 1, "nao cria retry, job, fan-out ou envio");
  } finally {
    database.queryEngine = queryOriginal;
    limparModulo("../modules/engine/processor.service");
    limparModulo("../modules/engine/importer/importer.service");
  }
}

async function testarUpdateFinalNormalContinuaParaJobAtivo() {
  const databasePath = require.resolve("../modules/engine/database");
  const processorPath = require.resolve("../modules/engine/processor.service");
  const importerPath = require.resolve("../modules/engine/importer/importer.service");
  const database = require(databasePath);
  const queryOriginal = database.queryEngine;

  try {
    database.queryEngine = async (sql, params = []) => {
      if (/SET status = 'oferta_criada'/i.test(sql)) {
        assert.ok(sql.includes("WHERE id = $1 AND status = 'importando'"));
        return { ok: true, resultado: { rows: [{ id: params[0], status: "oferta_criada", oferta_id: params[1] }], rowCount: 1 } };
      }
      throw new Error(`query inesperada: ${sql}`);
    };

    limparModulo("../modules/engine/processor.service");
    limparModulo("../modules/engine/importer/importer.service");
    const { marcarJobOfertaCriada } = require(importerPath);
    const resultado = await marcarJobOfertaCriada(89, 502);

    assert.strictEqual(resultado.ok, true);
    assert.strictEqual(resultado.resultado.rowCount, 1);
  } finally {
    database.queryEngine = queryOriginal;
    limparModulo("../modules/engine/processor.service");
    limparModulo("../modules/engine/importer/importer.service");
  }
}

(async () => {
  await testarFluxoVivoUsaLeasePersistido();
  await testarHeartbeatRenovaSomenteJobAtivo();
  await testarImporterAntigoNaoRessuscitaExpirado();
  await testarUpdateFinalNormalContinuaParaJobAtivo();
  console.log("job-lease-operacional.test.js OK");
})().catch(erro => {
  console.error(erro);
  process.exit(1);
});
