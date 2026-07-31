"use strict";

const crypto = require("crypto");
const {
  DEFAULT_LOTE_TAMANHO,
  GRUPOS_RESET,
  criterioResetFluxoVivo,
  validarSemNaoClassificados
} = require("./criterios.service");
const repositorioPadrao = require("./reset.repository");
const snapshotPadrao = require("./snapshot.repository");
const { rollbackLoteReset } = require("./rollback.service");
const {
  logResetInicio,
  logResetDryRun,
  logResetSnapshot,
  logResetLoteInicio,
  logResetLoteFim,
  logResetRetomada,
  logResetConcorrenciaBloqueada,
  logResetResumo,
  logResetFinalizado,
  logResetErro
} = require("./logs.service");

function gerarOperationId() {
  return `engine-reset-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${crypto.randomUUID().slice(0, 8)}`;
}

function limitarLote(valor = DEFAULT_LOTE_TAMANHO) {
  const numero = Number(valor || DEFAULT_LOTE_TAMANHO);
  if (!Number.isFinite(numero) || numero <= 0) return DEFAULT_LOTE_TAMANHO;
  return Math.max(1, Math.min(1000, Math.floor(numero)));
}

function somarGrupo(totais = [], grupo) {
  return Number((totais || []).find(item => item.grupo === grupo)?.total || 0);
}

function resumoTotais(dryRun = {}) {
  return {
    preservarIntactos: somarGrupo(dryRun.totais, GRUPOS_RESET.PRESERVAR),
    expirarOperacionalmente: somarGrupo(dryRun.totais, GRUPOS_RESET.EXPIRAR),
    arquivarForaOperacional: somarGrupo(dryRun.totais, GRUPOS_RESET.ARQUIVAR),
    naoClassificados: somarGrupo(dryRun.totais, GRUPOS_RESET.NAO_CLASSIFICADO)
  };
}

function idsHashPorGrupo(dryRun = {}) {
  return (dryRun.idsHash || []).reduce((acc, item) => {
    acc[item.grupo] = {
      total: Number(item.total || 0),
      idsHash: item.ids_hash || ""
    };
    return acc;
  }, {});
}

function normalizarIdsHashOperacao(valor = {}) {
  if (!valor || typeof valor !== "object") return {};
  return Object.entries(valor).reduce((acc, [grupo, dados]) => {
    acc[grupo] = {
      total: Number(dados?.total || 0),
      idsHash: dados?.idsHash || dados?.ids_hash || ""
    };
    return acc;
  }, {});
}

function validarIdsHashSnapshot(esperado = {}, atual = {}) {
  const grupos = new Set([...Object.keys(esperado || {}), ...Object.keys(atual || {})]);
  for (const grupo of grupos) {
    const e = esperado[grupo] || {};
    const a = atual[grupo] || {};
    if (Number(e.total || 0) !== Number(a.total || 0) || String(e.idsHash || "") !== String(a.idsHash || "")) {
      throw erroOperacional("ids_hash_divergente", "snapshot_ids_hash_divergente", { grupo });
    }
  }
  return true;
}

function erroOperacional(codigo, mensagem = codigo, extras = {}) {
  const erro = new Error(mensagem);
  erro.codigo = codigo;
  Object.assign(erro, extras);
  return erro;
}

function dependencias(deps = {}) {
  return {
    repo: deps.repo || repositorioPadrao,
    snapshot: deps.snapshot || snapshotPadrao,
    rollbackLote: deps.rollbackLote || rollbackLoteReset
  };
}

async function executarDryRunResetOperacional(opcoes = {}, deps = {}) {
  const { repo, snapshot } = dependencias(deps);
  const loteTamanho = limitarLote(opcoes.loteTamanho);
  const operationStartedAt = opcoes.operationStartedAt ? new Date(opcoes.operationStartedAt) : new Date();
  const cutoffCongelado = opcoes.cutoffCongelado
    ? new Date(opcoes.cutoffCongelado)
    : new Date(operationStartedAt.getTime() - 30 * 60 * 1000);
  const operationId = opcoes.operationId || gerarOperationId();
  const criterio = criterioResetFluxoVivo({ cutoffCongelado, loteTamanho });

  logResetInicio({
    operationId,
    modo: "dry-run",
    operationStartedAt: operationStartedAt.toISOString(),
    cutoffCongelado: cutoffCongelado.toISOString(),
    loteTamanho,
    criterioHash: criterio.criterioHash
  });

  return repo.comTransacao(async (client) => {
    await repo.inicializarSchemaReset(client);
    const lock = await repo.adquirirLockReset(client);
    if (!lock) {
      logResetConcorrenciaBloqueada({ operationId, modo: "dry-run", motivo: "reset_em_execucao" });
      throw erroOperacional("reset_concorrente", "reset_operacional_em_execucao");
    }

    const dryRun = await snapshot.consultarDryRunReset(client, { cutoffCongelado });
    const totais = resumoTotais(dryRun);
    validarSemNaoClassificados(totais);
    const idsHash = idsHashPorGrupo(dryRun);

    await repo.inserirOperacao(client, {
      operationId,
      modo: "dry-run",
      status: "dry_run_iniciado",
      operationStartedAt,
      cutoffCongelado,
      criterioHash: criterio.criterioHash,
      loteTamanho,
      totais,
      idsHashPorGrupo: idsHash
    });

    const materializacao = await snapshot.materializarSnapshotReset(client, {
      operationId,
      cutoffCongelado,
      criterioHash: criterio.criterioHash,
      loteTamanho
    });

    await repo.atualizarOperacao(client, operationId, {
      status: "dry_run_concluido",
      totais,
      idsHashPorGrupo: idsHash
    });

    logResetDryRun({
      operationId,
      cutoffCongelado: cutoffCongelado.toISOString(),
      totais,
      idsHashPorGrupo: idsHash,
      lotes: Object.keys(materializacao.lotes || {}).length,
      totalSnapshot: materializacao.totalSnapshot
    });
    logResetSnapshot({
      operationId,
      totalSnapshot: materializacao.totalSnapshot,
      loteTamanho
    });
    logResetFinalizado({ operationId, modo: "dry-run", aplicouMudancasOperacionais: false });

    return {
      ok: true,
      modo: "dry-run",
      operationId,
      operationStartedAt: operationStartedAt.toISOString(),
      cutoffCongelado: cutoffCongelado.toISOString(),
      criterioHash: criterio.criterioHash,
      loteTamanho,
      totais,
      idsHashPorGrupo: idsHash,
      totalSnapshot: materializacao.totalSnapshot,
      aplicouMudancasOperacionais: false
    };
  });
}

async function validarOperacaoParaExecucao(client, repo, operationId, confirmOperationId) {
  if (!operationId || !confirmOperationId || operationId !== confirmOperationId) {
    throw erroOperacional("confirmacao_explicita_ausente", "execute_exige_confirm_operation_id");
  }
  const operacao = await repo.carregarOperacao(client, operationId);
  if (!operacao) throw erroOperacional("operacao_nao_encontrada", "operation_id_nao_encontrado");
  if (!["dry_run_concluido", "execute_em_execucao", "execute_interrompido"].includes(operacao.status)) {
    throw erroOperacional("status_operacao_invalido", "operacao_nao_pronta_para_execute", { status: operacao.status });
  }
  return operacao;
}

async function executarLoteReset(client, { repo, snapshot, operacao, lote }) {
  const operationId = operacao.operation_id;
  const loteNumero = lote.lote_numero;
  const grupoAcao = lote.grupo_acao;
  const inicio = Date.now();

  logResetLoteInicio({ operationId, loteNumero, grupoAcao, totalSnapshot: lote.total_snapshot });
  await repo.marcarLoteInicio(client, { operationId, loteNumero, grupoAcao });

  const linhasSnapshot = await snapshot.carregarSnapshotLote(client, { operationId, loteNumero, grupoAcao });
  if (linhasSnapshot.length !== Number(lote.total_snapshot || 0)) {
    throw erroOperacional("snapshot_lote_incompativel", "snapshot_lote_total_incompativel", {
      loteNumero,
      esperado: lote.total_snapshot,
      encontrado: linhasSnapshot.length
    });
  }

  const totalValidos = await snapshot.validarSnapshotContraJobsAtuais(client, {
    operationId,
    loteNumero,
    grupoAcao,
    cutoffCongelado: operacao.cutoff_congelado
  });
  const totalPuladosConcorrencia = Math.max(0, linhasSnapshot.length - totalValidos);
  if (totalPuladosConcorrencia > 0) {
    await snapshot.marcarSnapshotConcorrenciaLote(client, { operationId, loteNumero, grupoAcao });
    logResetConcorrenciaBloqueada({
      operationId,
      loteNumero,
      grupoAcao,
      totalSnapshot: linhasSnapshot.length,
      totalValidos,
      totalPuladosConcorrencia,
      decisao: "pular_jobs_alterados_por_concorrencia"
    });
  }

  let totalAlterado = 0;
  let totalArquivado = 0;
  let totalProcessamentosArquivados = 0;

  if (grupoAcao === GRUPOS_RESET.EXPIRAR) {
    totalAlterado = await snapshot.expirarLoteSnapshot(client, { operationId, loteNumero, grupoAcao });
  } else if (grupoAcao === GRUPOS_RESET.ARQUIVAR) {
    const totalProcessamentosOriginais = await snapshot.contarProcessamentosOriginaisLote(client, { operationId, loteNumero, grupoAcao });
    totalProcessamentosArquivados = await snapshot.arquivarProcessamentosLote(client, { operationId, loteNumero, grupoAcao });
    if (totalProcessamentosArquivados !== totalProcessamentosOriginais) {
      throw erroOperacional("arquivo_processamentos_incompativel", "arquivamento_processamentos_total_incompativel", {
        loteNumero,
        esperado: totalProcessamentosOriginais,
        arquivado: totalProcessamentosArquivados
      });
    }

    totalArquivado = await snapshot.arquivarJobsLote(client, { operationId, loteNumero, grupoAcao });
    if (totalArquivado !== linhasSnapshot.length) {
      throw erroOperacional("arquivo_jobs_incompativel", "arquivamento_jobs_total_incompativel", {
        loteNumero,
        esperado: linhasSnapshot.length,
        arquivado: totalArquivado
      });
    }
    totalAlterado = await snapshot.removerJobsArquivadosLote(client, { operationId, loteNumero, grupoAcao });
  } else {
    throw erroOperacional("grupo_acao_nao_executavel", "grupo_acao_nao_executavel", { grupoAcao });
  }

  if (totalAlterado !== totalValidos) {
    throw erroOperacional("alteracao_lote_incompativel", "alteracao_lote_total_incompativel", {
      loteNumero,
      esperado: totalValidos,
      alterado: totalAlterado
    });
  }

  await repo.marcarLoteFim(client, {
    operationId,
    loteNumero,
    grupoAcao,
    status: "concluido",
    totalAlterado,
    totalArquivado,
    totalProcessamentosArquivados,
    totalPuladosConcorrencia
  });

  const duracaoMs = Date.now() - inicio;
  logResetLoteFim({
    operationId,
    loteNumero,
    grupoAcao,
    totalAlterado,
    totalArquivado,
    totalProcessamentosArquivados,
    totalPuladosConcorrencia,
    duracaoMs
  });

  return { loteNumero, grupoAcao, totalAlterado, totalArquivado, totalProcessamentosArquivados, totalPuladosConcorrencia, duracaoMs };
}

async function executarResetOperacional(opcoes = {}, deps = {}) {
  const { repo, snapshot } = dependencias(deps);
  const operationId = opcoes.operationId;
  const confirmOperationId = opcoes.confirmOperationId;
  const maxLotes = Number(opcoes.maxLotes || 0);
  const resumo = { ok: true, modo: "execute", operationId, lotes: 0, alterados: 0, arquivados: 0, processamentosArquivados: 0 };
  resumo.puladosConcorrencia = 0;

  let operacaoInicial = null;
  await repo.comTransacao(async (client) => {
    await repo.inicializarSchemaReset(client);
    const lock = await repo.adquirirLockReset(client);
    if (!lock) {
      logResetConcorrenciaBloqueada({ operationId, modo: "execute", motivo: "reset_em_execucao" });
      throw erroOperacional("reset_concorrente", "reset_operacional_em_execucao");
    }
    operacaoInicial = await validarOperacaoParaExecucao(client, repo, operationId, confirmOperationId);
    const idsHashAtual = await snapshot.calcularIdsHashSnapshot(client, operationId);
    validarIdsHashSnapshot(normalizarIdsHashOperacao(operacaoInicial.ids_hash_por_grupo), idsHashAtual);
    await repo.atualizarOperacao(client, operationId, { status: "execute_em_execucao" });
    logResetInicio({ operationId, modo: "execute", cutoffCongelado: operacaoInicial.cutoff_congelado, criterioHash: operacaoInicial.criterio_hash });
  });

  while (true) {
    if (maxLotes > 0 && resumo.lotes >= maxLotes) break;
    const resultadoLote = await repo.comTransacao(async (client) => {
      const lock = await repo.adquirirLockReset(client);
      if (!lock) throw erroOperacional("reset_concorrente", "reset_operacional_em_execucao");
      const operacao = await repo.carregarOperacao(client, operationId);
      const lote = await repo.buscarProximoLotePendente(client, operationId);
      if (!lote) return null;
      if (lote.status === "em_execucao") {
        logResetRetomada({ operationId, loteNumero: lote.lote_numero, motivo: "lote_retomado" });
      }
      return executarLoteReset(client, { repo, snapshot, operacao, lote });
    });

    if (!resultadoLote) break;
    resumo.lotes += 1;
    resumo.alterados += resultadoLote.totalAlterado || 0;
    resumo.arquivados += resultadoLote.totalArquivado || 0;
    resumo.processamentosArquivados += resultadoLote.totalProcessamentosArquivados || 0;
    resumo.puladosConcorrencia += resultadoLote.totalPuladosConcorrencia || 0;
  }

  await repo.comTransacao(async (client) => {
    const proximo = await repo.buscarProximoLotePendente(client, operationId);
    await repo.atualizarOperacao(client, operationId, { status: proximo ? "execute_interrompido" : "execute_concluido" });
    resumo.status = proximo ? "execute_interrompido" : "execute_concluido";
  });

  logResetResumo(resumo);
  logResetFinalizado(resumo);
  return resumo;
}

async function executarRollbackResetOperacional(opcoes = {}, deps = {}) {
  const { repo, rollbackLote } = dependencias(deps);
  const operationId = opcoes.operationId;
  if (!operationId) throw erroOperacional("operation_id_obrigatorio", "rollback_exige_operation_id");
  const resumo = { ok: true, modo: "rollback", operationId, lotes: 0, restaurados: 0, pulados: 0 };

  const lotes = await repo.comTransacao(async (client) => {
    await repo.inicializarSchemaReset(client);
    const lock = await repo.adquirirLockReset(client);
    if (!lock) {
      logResetConcorrenciaBloqueada({ operationId, modo: "rollback", motivo: "reset_em_execucao" });
      throw erroOperacional("reset_concorrente", "reset_operacional_em_execucao");
    }
    const operacao = await repo.carregarOperacao(client, operationId);
    if (!operacao) throw erroOperacional("operacao_nao_encontrada", "operation_id_nao_encontrado");
    await repo.atualizarOperacao(client, operationId, { status: "rollback_em_execucao" });
    return repo.listarLotesRollback(client, operationId);
  });

  for (const lote of lotes) {
    const resultado = await repo.comTransacao(async (client) => {
      const lock = await repo.adquirirLockReset(client);
      if (!lock) throw erroOperacional("reset_concorrente", "reset_operacional_em_execucao");
      return rollbackLote(client, lote);
    });
    resumo.lotes += 1;
    resumo.restaurados += resultado.restaurados || 0;
    resumo.pulados += resultado.pulados || 0;
  }

  await repo.comTransacao(async (client) => {
    await repo.atualizarOperacao(client, operationId, { status: resumo.pulados > 0 ? "rollback_parcial" : "rollback_concluido" });
  });

  logResetResumo(resumo);
  logResetFinalizado(resumo);
  return resumo;
}

async function executarResetOperacionalCli(opcoes = {}, deps = {}) {
  try {
    if (opcoes.mode === "dry-run") return await executarDryRunResetOperacional(opcoes, deps);
    if (opcoes.mode === "execute") return await executarResetOperacional(opcoes, deps);
    if (opcoes.mode === "rollback") return await executarRollbackResetOperacional(opcoes, deps);
    throw erroOperacional("modo_invalido", "modo_deve_ser_dry_run_execute_ou_rollback");
  } catch (erro) {
    logResetErro({
      mode: opcoes.mode || "",
      operationId: opcoes.operationId || "",
      codigo: erro.codigo || "erro",
      mensagem: erro.message
    });
    throw erro;
  }
}

module.exports = {
  executarDryRunResetOperacional,
  executarResetOperacional,
  executarResetOperacionalCli,
  executarRollbackResetOperacional,
  gerarOperationId,
  limitarLote,
  resumoTotais
};
