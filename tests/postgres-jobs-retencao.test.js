"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  classificarStatusRetencaoJobsPostgres,
  executarPreflightRetencaoJobsPostgres,
  executarRetencaoJobsPostgres,
  CONFIRMACAO_RETENCAO_JOBS_POSTGRES,
  STATUS_JOBS_ATIVOS_RETENCAO,
  STATUS_JOBS_FINAIS_RETENCAO
} = require("../modules/engine/jobs.service");

async function testarClassificacaoConservadora() {
  assert.strictEqual(classificarStatusRetencaoJobsPostgres("pendente"), "protegido_ativo");
  assert.strictEqual(classificarStatusRetencaoJobsPostgres("processando"), "protegido_ativo");
  assert.strictEqual(classificarStatusRetencaoJobsPostgres("retry"), "protegido_ativo");
  assert.strictEqual(classificarStatusRetencaoJobsPostgres("claimed"), "protegido_ativo");
  assert.strictEqual(classificarStatusRetencaoJobsPostgres("concluido"), "final_elegivel_por_idade");
  assert.strictEqual(classificarStatusRetencaoJobsPostgres("erro_final"), "final_elegivel_por_idade");
  assert.strictEqual(classificarStatusRetencaoJobsPostgres("cancelado"), "final_elegivel_por_idade");
  assert.strictEqual(classificarStatusRetencaoJobsPostgres("duplicado_final"), "final_elegivel_por_idade");
  assert.strictEqual(classificarStatusRetencaoJobsPostgres("erro"), "protegido_status_desconhecido");
  assert.strictEqual(classificarStatusRetencaoJobsPostgres(""), "protegido_status_ausente");
}

async function testarPreflightDryRun() {
  const chamadas = [];
  const queryEngine = async (sql, params) => {
    chamadas.push({ sql, params });
    if (/COUNT\(\*\)::bigint AS total_jobs/i.test(sql)) {
      return { ok: true, resultado: { rows: [{ total_jobs: "10", bytes_jobs: "1000" }] } };
    }
    if (/GROUP BY COALESCE/i.test(sql)) {
      return { ok: true, resultado: { rows: [{ status: "concluido", total: "4" }, { status: "pendente", total: "6" }] } };
    }
    if (/ativos_protegidos/i.test(sql)) {
      return {
        ok: true,
        resultado: {
          rows: [{
            ativos_protegidos: "6",
            recentes_12h: "3",
            sem_timestamp_confiavel: "0",
            status_desconhecido_protegido: "0"
          }]
        }
      };
    }
    if (/jobs_elegiveis_lote/i.test(sql)) {
      return {
        ok: true,
        resultado: {
          rows: [{
            jobs_elegiveis_lote: "3",
            bytes_jobs_lote: "300",
            id_min: "1",
            id_max: "3",
            criado_min: "2026-08-05T00:00:00.000Z",
            criado_max: "2026-08-05T01:00:00.000Z"
          }]
        }
      };
    }
    if (/engine_processamentos/i.test(sql) && /UNION ALL/i.test(sql)) {
      return {
        ok: true,
        resultado: {
          rows: [
            { tabela: "engine_processamentos", registros: "9", bytes_estimados: "900" },
            { tabela: "engine_eventos_comerciais", registros: "5", bytes_estimados: "500" }
          ]
        }
      };
    }
    if (/pg_total_relation_size/i.test(sql)) {
      return {
        ok: true,
        resultado: {
          rows: [
            { tabela: "engine_jobs_cliente", bytes: "10000" },
            { tabela: "engine_processamentos", bytes: "8000" },
            { tabela: "engine_eventos_comerciais", bytes: "6000" }
          ]
        }
      };
    }
    throw new Error(`consulta inesperada: ${sql}`);
  };

  const preflight = await executarPreflightRetencaoJobsPostgres({
    loteLimite: 5000,
    deps: { queryEngine }
  });

  assert.strictEqual(preflight.ok, true);
  assert.strictEqual(preflight.aplicouMudancas, false);
  assert.strictEqual(preflight.tabelaJobs, "engine_jobs_cliente");
  assert.strictEqual(preflight.totalJobs, 10);
  assert.strictEqual(preflight.ativosProtegidos, 6);
  assert.strictEqual(preflight.recentesMenos12hProtegidos, 3);
  assert.strictEqual(preflight.finaisMais12hElegiveisLote, 3);
  assert.strictEqual(preflight.espacoLogicoEstimadoRecuperavelBytes, 1700);
  assert.ok(preflight.tabelasPreservadasPorContrato.includes("engine_ofertas"));
  assert.ok(chamadas.some(chamada => chamada.params?.[0] === STATUS_JOBS_ATIVOS_RETENCAO));
  assert.ok(chamadas.some(chamada => chamada.params?.[0] === STATUS_JOBS_FINAIS_RETENCAO));

  chamadas.length = 0;
  const emergencial = await executarPreflightRetencaoJobsPostgres({
    emergenciaVolumeCheio: true,
    deps: { queryEngine }
  });
  assert.strictEqual(emergencial.politica.emergenciaVolumeCheio, true);
  assert.strictEqual(emergencial.politica.loteLimite, 50);
  assert.strictEqual(emergencial.politica.loteMaximo, 200);
  assert.strictEqual(emergencial.politica.vacuumExecutado, false);
  assert.ok(chamadas.some(chamada => chamada.params?.[2] === 50));
}

async function testarConfirmacaoObrigatoria() {
  const resultado = await executarRetencaoJobsPostgres({ dryRun: false, confirmacao: "ERRADA" });
  assert.strictEqual(resultado.ok, false);
  assert.strictEqual(resultado.aplicouMudancas, false);
  assert.strictEqual(resultado.confirmacaoEsperada, CONFIRMACAO_RETENCAO_JOBS_POSTGRES);
}

function testarRotaAdminPublicadaNoCodigo() {
  const fonte = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  assert.ok(fonte.includes('app.post("/admin/postgres/jobs-retencao"'));
  assert.ok(fonte.includes("exigirAdminMasterEngine(req, res)"));
  assert.ok(fonte.includes("dryRun: req.body?.dryRun !== false"));
  assert.ok(fonte.includes("emergenciaVolumeCheio: req.body?.emergenciaVolumeCheio === true"));
}

(async () => {
  await testarClassificacaoConservadora();
  await testarPreflightDryRun();
  await testarConfirmacaoObrigatoria();
  testarRotaAdminPublicadaNoCodigo();
  console.log("postgres-jobs-retencao.test.js OK");
})();
