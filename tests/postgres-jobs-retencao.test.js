"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  classificarStatusRetencaoJobsPostgres,
  expirarJobsAtivosPorLease,
  jobAtivoDentroLease,
  minutosLeaseJobsAtivos,
  executarPreflightRetencaoJobsPostgres,
  executarRetencaoJobsPostgres,
  CONFIRMACAO_RETENCAO_JOBS_POSTGRES,
  STATUS_JOBS_ATIVOS_COM_LEASE,
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

async function testarLeaseJobsAtivosFrescoEAntigo() {
  const agoraMs = Date.parse("2026-08-13T12:00:00.000Z");
  assert.strictEqual(minutosLeaseJobsAtivos(), 30);
  assert.strictEqual(jobAtivoDentroLease({
    status: "processando",
    atualizado_em: "2026-08-13T11:45:00.000Z"
  }, { agoraMs, leaseMinutos: 30 }), true, "processando fresco permanece vivo");
  assert.strictEqual(jobAtivoDentroLease({
    status: "importando",
    atualizado_em: "2026-08-13T11:45:00.000Z"
  }, { agoraMs, leaseMinutos: 30 }), true, "importando fresco permanece vivo");
  assert.strictEqual(jobAtivoDentroLease({
    status: "processando",
    atualizado_em: "2026-08-13T11:20:00.000Z"
  }, { agoraMs, leaseMinutos: 30 }), false, "processando antigo vence lease");
  assert.strictEqual(jobAtivoDentroLease({
    status: "importando",
    atualizado_em: "2026-08-13T11:20:00.000Z"
  }, { agoraMs, leaseMinutos: 30 }), false, "importando antigo vence lease");
  assert.strictEqual(jobAtivoDentroLease({
    status: "pendente",
    atualizado_em: "2026-08-13T00:00:00.000Z"
  }, { agoraMs, leaseMinutos: 30 }), true, "Fase A nao altera outros status ativos");
}

async function testarExpiracaoLeaseSemDeleteNemFanout() {
  const chamadas = [];
  const queryEngine = async (sql, params) => {
    chamadas.push({ sql, params });
    assert.ok(/UPDATE engine_jobs_cliente/i.test(sql), "lease deve transicionar status do job");
    assert.ok(/INSERT INTO engine_processamentos/i.test(sql), "lease deve registrar auditoria operacional");
    assert.ok(!/\bDELETE\b/i.test(sql), "lease nao apaga job nem dependencias");
    assert.ok(!/INSERT INTO engine_jobs_cliente/i.test(sql), "lease nao cria job nem duplica fan-out");
    assert.strictEqual(params[0], STATUS_JOBS_ATIVOS_COM_LEASE);
    assert.strictEqual(params[1], 30);
    return {
      ok: true,
      resultado: {
        rows: [{
          jobs_expirados: "2",
          processando_expirados: "1",
          importando_expirados: "1",
          id_min: "10",
          id_max: "20",
          lease_referencia_min: "2026-08-13T10:00:00.000Z",
          por_cliente: { user_a: 1, user_b: 1 }
        }]
      }
    };
  };

  const resultado = await expirarJobsAtivosPorLease({
    leaseMinutos: 30,
    loteLimite: 50,
    deps: { queryEngine }
  });

  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(resultado.aplicouMudancas, true);
  assert.strictEqual(resultado.jobsExpirados, 2);
  assert.strictEqual(resultado.processandoExpirados, 1);
  assert.strictEqual(resultado.importandoExpirados, 1);
  assert.strictEqual(resultado.novoStatus, "expirada_operacional");
  assert.strictEqual(resultado.motivoFinal, "lease_expirado_operacional");
  assert.deepStrictEqual(resultado.porCliente, { user_a: 1, user_b: 1 });
  assert.ok(chamadas[0].sql.includes("FOR UPDATE SKIP LOCKED"), "restart/deploy nao deve disputar o mesmo job em paralelo");
  assert.ok(chamadas[0].sql.includes("COALESCE(atualizado_em, criado_em)"), "lease sobrevive restart usando timestamp persistido");
  assert.ok(chamadas[0].sql.includes("cliente_id"), "auditoria por workspace deve ser preservada");
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
  await testarLeaseJobsAtivosFrescoEAntigo();
  await testarExpiracaoLeaseSemDeleteNemFanout();
  await testarPreflightDryRun();
  await testarConfirmacaoObrigatoria();
  testarRotaAdminPublicadaNoCodigo();
  console.log("postgres-jobs-retencao.test.js OK");
})();
