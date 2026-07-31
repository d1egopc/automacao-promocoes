"use strict";

const assert = require("assert");
const {
  classificarJobReset,
  GRUPOS_RESET,
  STATUS_EXPIRADO_OPERACIONAL
} = require("../modules/engine/reset-operacional/criterios.service");
const {
  executarDryRunResetOperacional,
  executarResetOperacional,
  executarRollbackResetOperacional
} = require("../modules/engine/reset-operacional/reset.runner");

const cutoff = "2026-07-31T21:12:46.952Z";

function criarDepsBase({ dryRun = {}, lotes = [], validarTotal = null, rollbackResultado = null, idsHashAtual = null } = {}) {
  const chamadas = [];
  const repo = {
    chamadas,
    async comTransacao(fn) {
      chamadas.push("BEGIN");
      const client = { mock: true };
      try {
        const resultado = await fn(client);
        chamadas.push("COMMIT");
        return resultado;
      } catch (erro) {
        chamadas.push("ROLLBACK");
        throw erro;
      }
    },
    async inicializarSchemaReset() { chamadas.push("schema"); },
    async adquirirLockReset() { chamadas.push("lock"); return true; },
    async inserirOperacao() { chamadas.push("inserirOperacao"); },
    async atualizarOperacao(_client, _operationId, campos = {}) { chamadas.push(`atualizarOperacao:${campos.status || "sem_status"}`); },
    async carregarOperacao() {
      chamadas.push("carregarOperacao");
      return {
        operation_id: "op1",
        status: "dry_run_concluido",
        cutoff_congelado: cutoff,
        criterio_hash: "criterio",
        ids_hash_por_grupo: {
          [GRUPOS_RESET.EXPIRAR]: { total: 1, idsHash: "hash-expirar-execute" },
          [GRUPOS_RESET.ARQUIVAR]: { total: 1, idsHash: "hash-arquivar-execute" }
        }
      };
    },
    async buscarProximoLotePendente() {
      chamadas.push("buscarProximoLote");
      return lotes.shift() || null;
    },
    async marcarLoteInicio(_client, lote) { chamadas.push(`loteInicio:${lote.loteNumero}`); },
    async marcarLoteFim(_client, dados) { chamadas.push(`loteFim:${dados.loteNumero}:${dados.status}`); },
    async listarLotesRollback() {
      chamadas.push("listarRollback");
      return [
        { operation_id: "op1", lote_numero: 2, grupo_acao: GRUPOS_RESET.ARQUIVAR, status: "concluido", total_snapshot: 1 },
        { operation_id: "op1", lote_numero: 1, grupo_acao: GRUPOS_RESET.EXPIRAR, status: "concluido", total_snapshot: 1 }
      ];
    }
  };

  const snapshot = {
    async consultarDryRunReset() {
      chamadas.push("consultarDryRun");
      return dryRun;
    },
    async materializarSnapshotReset() {
      chamadas.push("materializarSnapshot");
      return { totalSnapshot: 2, lotes: { 1: 1, 2: 1 } };
    },
    async calcularIdsHashSnapshot() {
      chamadas.push("calcularIdsHash");
      return idsHashAtual || {
        [GRUPOS_RESET.EXPIRAR]: { total: 1, idsHash: "hash-expirar-execute" },
        [GRUPOS_RESET.ARQUIVAR]: { total: 1, idsHash: "hash-arquivar-execute" }
      };
    },
    async carregarSnapshotLote(_client, lote) {
      chamadas.push(`carregarSnapshot:${lote.loteNumero}`);
      return [{ job_id: 10 + lote.loteNumero }];
    },
    async validarSnapshotContraJobsAtuais(_client, lote) {
      chamadas.push(`validarSnapshot:${lote.loteNumero}`);
      return validarTotal === null ? 1 : validarTotal;
    },
    async expirarLoteSnapshot(_client, lote) {
      chamadas.push(`expirar:${lote.loteNumero}`);
      return 1;
    },
    async contarProcessamentosOriginaisLote(_client, lote) {
      chamadas.push(`contarProcessamentos:${lote.loteNumero}`);
      return 2;
    },
    async arquivarProcessamentosLote(_client, lote) {
      chamadas.push(`arquivarProcessamentos:${lote.loteNumero}`);
      return 2;
    },
    async arquivarJobsLote(_client, lote) {
      chamadas.push(`arquivarJobs:${lote.loteNumero}`);
      return 1;
    },
    async removerJobsArquivadosLote(_client, lote) {
      chamadas.push(`removerJobs:${lote.loteNumero}`);
      return 1;
    }
  };

  async function rollbackLote(_client, lote) {
    chamadas.push(`rollbackLote:${lote.lote_numero}`);
    return rollbackResultado || { restaurados: 1, pulados: 0 };
  }

  return { repo, snapshot, rollbackLote, chamadas };
}

function dryRunSemNaoClassificados() {
  return {
    totais: [
      { grupo: GRUPOS_RESET.PRESERVAR, total: 4 },
      { grupo: GRUPOS_RESET.EXPIRAR, total: 2 },
      { grupo: GRUPOS_RESET.ARQUIVAR, total: 3 }
    ],
    idsHash: [
      { grupo: GRUPOS_RESET.EXPIRAR, total: 2, ids_hash: "hash-expirar" },
      { grupo: GRUPOS_RESET.ARQUIVAR, total: 3, ids_hash: "hash-arquivar" }
    ],
    naoClassificados: []
  };
}

assert.strictEqual(
  classificarJobReset({ status: "pendente", criado_em: "2026-07-31T21:12:47.000Z" }, cutoff).grupoAcao,
  GRUPOS_RESET.PRESERVAR,
  "job novo deve ser preservado pelo cutoff congelado"
);

assert.strictEqual(
  classificarJobReset({ status: "processando", criado_em: "2026-07-01T00:00:00.000Z" }, cutoff).grupoAcao,
  GRUPOS_RESET.PRESERVAR,
  "processando deve ser preservado"
);

assert.strictEqual(
  classificarJobReset({ status: "importando", criado_em: "2026-07-01T00:00:00.000Z" }, cutoff).grupoAcao,
  GRUPOS_RESET.PRESERVAR,
  "importando deve ser preservado"
);

assert.strictEqual(
  classificarJobReset({ status: "oferta_criada", criado_em: "2026-07-01T00:00:00.000Z" }, cutoff).grupoAcao,
  GRUPOS_RESET.PRESERVAR,
  "oferta_criada deve ser preservada como historico"
);

assert.strictEqual(
  classificarJobReset({ status: "pendente", criado_em: "2026-07-30T00:00:00.000Z" }, cutoff).statusFinal,
  STATUS_EXPIRADO_OPERACIONAL,
  "pendente antigo deve expirar operacionalmente"
);

assert.strictEqual(
  classificarJobReset({ status: "erro_importacao", criado_em: "2026-07-30T00:00:00.000Z" }, cutoff).grupoAcao,
  GRUPOS_RESET.ARQUIVAR,
  "terminal antigo deve ir para arquivo"
);

assert.strictEqual(
  classificarJobReset({ status: "misterioso", criado_em: "2026-07-30T00:00:00.000Z" }, cutoff).grupoAcao,
  GRUPOS_RESET.NAO_CLASSIFICADO,
  "status desconhecido deve bloquear"
);

(async () => {
  {
    const deps = criarDepsBase({ dryRun: dryRunSemNaoClassificados() });
    const resultado = await executarDryRunResetOperacional({
      operationId: "op1",
      operationStartedAt: "2026-07-31T21:42:46.952Z",
      loteTamanho: 1000
    }, deps);
    assert.strictEqual(resultado.ok, true);
    assert.strictEqual(resultado.cutoffCongelado, cutoff);
    assert(deps.chamadas.includes("materializarSnapshot"), "dry-run deve materializar snapshot oficial");
    assert(!deps.chamadas.some(item => /^expirar:|^removerJobs:/.test(item)), "dry-run nao deve executar UPDATE/DELETE operacional");
  }

  {
    const deps = criarDepsBase({
      dryRun: {
        ...dryRunSemNaoClassificados(),
        totais: [{ grupo: GRUPOS_RESET.NAO_CLASSIFICADO, total: 1 }]
      }
    });
    await assert.rejects(
      () => executarDryRunResetOperacional({ operationId: "op1", operationStartedAt: "2026-07-31T21:42:46.952Z" }, deps),
      /reset_operacional_status_nao_classificado/
    );
    assert(deps.chamadas.includes("ROLLBACK"), "status desconhecido deve abortar transacao");
  }

  {
    const deps = criarDepsBase();
    await assert.rejects(
      () => executarResetOperacional({ operationId: "op1" }, deps),
      /execute_exige_confirm_operation_id/
    );
  }

  {
    const deps = criarDepsBase({
      lotes: [
        { operation_id: "op1", lote_numero: 1, grupo_acao: GRUPOS_RESET.EXPIRAR, status: "pendente", total_snapshot: 1 },
        { operation_id: "op1", lote_numero: 2, grupo_acao: GRUPOS_RESET.ARQUIVAR, status: "pendente", total_snapshot: 1 }
      ]
    });
    const resultado = await executarResetOperacional({ operationId: "op1", confirmOperationId: "op1" }, deps);
    assert.strictEqual(resultado.alterados, 2);
    const ordemArquivo = deps.chamadas.join(">");
    assert(
      ordemArquivo.indexOf("arquivarProcessamentos:2") < ordemArquivo.indexOf("removerJobs:2"),
      "processamentos devem ser arquivados antes do delete do job"
    );
  }

  {
    const deps = criarDepsBase({
      lotes: [{ operation_id: "op1", lote_numero: 37, grupo_acao: GRUPOS_RESET.EXPIRAR, status: "em_execucao", total_snapshot: 1 }]
    });
    const resultado = await executarResetOperacional({ operationId: "op1", confirmOperationId: "op1", maxLotes: 1 }, deps);
    assert.strictEqual(resultado.lotes, 1, "lote em_execucao deve poder ser retomado");
  }

  {
    const deps = criarDepsBase({
      lotes: [{ operation_id: "op1", lote_numero: 1, grupo_acao: GRUPOS_RESET.EXPIRAR, status: "pendente", total_snapshot: 1 }],
      idsHashAtual: {
        [GRUPOS_RESET.EXPIRAR]: { total: 1, idsHash: "hash-diferente" },
        [GRUPOS_RESET.ARQUIVAR]: { total: 1, idsHash: "hash-arquivar-execute" }
      }
    });
    await assert.rejects(
      () => executarResetOperacional({ operationId: "op1", confirmOperationId: "op1" }, deps),
      /snapshot_ids_hash_divergente/
    );
    assert(!deps.chamadas.some(item => item.startsWith("loteInicio")), "hash divergente deve bloquear antes dos lotes");
  }

  {
    const deps = criarDepsBase({
      lotes: [{ operation_id: "op1", lote_numero: 1, grupo_acao: GRUPOS_RESET.EXPIRAR, status: "pendente", total_snapshot: 1 }],
      validarTotal: 0
    });
    await assert.rejects(
      () => executarResetOperacional({ operationId: "op1", confirmOperationId: "op1" }, deps),
      /snapshot_nao_confere_com_jobs_atuais/
    );
    assert(deps.chamadas.includes("ROLLBACK"), "concorrencia deve abortar lote atomicamente");
  }

  {
    const deps = criarDepsBase({ rollbackResultado: { restaurados: 1, pulados: 1 } });
    const resultado = await executarRollbackResetOperacional({ operationId: "op1" }, deps);
    assert.strictEqual(resultado.lotes, 2);
    assert.strictEqual(resultado.pulados, 2);
    assert(
      deps.chamadas.indexOf("rollbackLote:2") < deps.chamadas.indexOf("rollbackLote:1"),
      "rollback deve processar lotes em ordem reversa"
    );
  }

  console.log("engine-reset-operacional.test.js OK");
})().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
