"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const express = require("express");
const {
  caminhosOperacao,
  filaPath,
  executarDryRunResetEsteiras,
  executarPreflightResetEsteiras,
  executarResetEsteiras,
  executarRollbackResetEsteiras
} = require("./reset.runner");

const WORKSPACE_PERMITIDO = "user_9hqs434h";
const LOTE_TAMANHO_FIXO = 100;
const TIMEOUT_MS = 30000;
const RATE_LIMIT_MS = 10000;
const CONFIRMACAO_DRY_RUN = "DRY_RUN_USER_9HQS434H";
const CONFIRMACAO_EXECUTE = "EXECUTAR_RESET_USER_9HQS434H";
const CONFIRMACAO_ROLLBACK = "ROLLBACK_RESET_USER_9HQS434H";
const PARAMETROS_PROIBIDOS = new Set(["mode", "modo", "dataDir", "path", "caminho"]);

let resetEmExecucao = false;
let ultimaChamadaMs = 0;

function statusErro(erro) {
  return erro.statusCode || 500;
}

function respostaErro(erro) {
  return {
    ok: false,
    erro: erro.codigo || erro.message || "preflight_reset_esteira_erro"
  };
}

function criarErro(codigo, statusCode = 400) {
  const erro = new Error(codigo);
  erro.codigo = codigo;
  erro.statusCode = statusCode;
  return erro;
}

function readJson(file, fallback = null) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (_) {
    return fallback;
  }
}

function listarArquivosJson(dir) {
  try {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter(nome => nome.endsWith(".json"))
      .sort();
  } catch (_) {
    return [];
  }
}

function tamanhoDirBytes(dir) {
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    const atual = stack.pop();
    let stats;
    try {
      stats = fs.lstatSync(atual);
    } catch (_) {
      continue;
    }
    if (stats.isDirectory()) {
      let filhos = [];
      try {
        filhos = fs.readdirSync(atual);
      } catch (_) {
        filhos = [];
      }
      for (const nome of filhos) stack.push(path.join(atual, nome));
    } else if (stats.isFile()) {
      total += stats.size;
    }
  }
  return total;
}

function hashArquivo(file) {
  try {
    const hash = crypto.createHash("sha256");
    hash.update(fs.readFileSync(file));
    return hash.digest("hex");
  } catch (_) {
    return null;
  }
}

function obterEspacoVolume(dataDir = "/data") {
  try {
    const stats = fs.statfsSync(dataDir);
    const total = Number(stats.blocks || 0) * Number(stats.bsize || 0);
    const livre = Number(stats.bavail || 0) * Number(stats.bsize || 0);
    return {
      espacoTotal: total,
      espacoLivre: livre,
      espacoUsado: Math.max(0, total - livre)
    };
  } catch (_) {
    return {
      espacoTotal: null,
      espacoLivre: null,
      espacoUsado: null
    };
  }
}

function megabytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n)) return null;
  return Math.round((n / 1024 / 1024) * 100) / 100;
}

function finaisDoPreflight(resultado = {}) {
  const porBucket = resultado.estatisticas?.porBucket || {};
  return Number(porBucket.erro_final || 0) +
    Number(porBucket.cancelado || 0) +
    Number(porBucket.expirado || 0);
}

function montarRespostaSanitizada(resultado = {}, espaco = {}, duracaoMs = 0) {
  return {
    workspaceId: resultado.workspaceId || WORKSPACE_PERMITIDO,
    tamanhoFilaBytes: resultado.filaJsonBytes ?? null,
    tamanhoFilaMB: megabytes(resultado.filaJsonBytes),
    totalItens: resultado.totalItens ?? 0,
    elegiveisExpiracao: resultado.grupos?.expirar ?? 0,
    processandoPreservados: resultado.estatisticas?.processandoProtegido ?? 0,
    semTimestamp: resultado.estatisticas?.semTimestamp ?? 0,
    enviadosHistorico: resultado.estatisticas?.enviadosHistorico ?? 0,
    finais: finaisDoPreflight(resultado),
    tamanhoBrutoElegiveis: resultado.estimativa?.payloadElegivelBytes ?? null,
    persistenteEstimado: resultado.estimativa?.persistenteEstimadoBytes ?? null,
    temporarioAtomic: resultado.estimativa?.temporariosEscritaAtomicaBytes ?? null,
    margemApp: resultado.estimativa?.margemAppBytes ?? null,
    espacoMinimoNecessario: resultado.espaco?.minimoNecessarioBytes ?? null,
    espacoTotal: espaco.espacoTotal,
    espacoUsado: espaco.espacoUsado,
    espacoLivre: espaco.espacoLivre,
    preflightAprovado: resultado.preflightAprovado === true,
    motivo: resultado.motivo || "estimativa_indisponivel",
    duracaoMs,
    aplicouMudancasOperacionais: resultado.aplicouMudancasOperacionais === true,
    snapshotCriado: resultado.snapshotCriado === true,
    lotesCriados: resultado.lotesCriados === true,
    rollbackCriado: resultado.rollbackCriado === true,
    filaAlterada: resultado.filaAlterada === true
  };
}

function timeoutErro() {
  const erro = new Error("preflight_reset_esteira_timeout");
  erro.codigo = "preflight_reset_esteira_timeout";
  erro.statusCode = 503;
  return erro;
}

function comTimeout(promessa, timeoutMs = TIMEOUT_MS) {
  return Promise.race([
    promessa,
    new Promise((_, reject) => {
      const timer = setTimeout(() => reject(timeoutErro()), timeoutMs);
      timer.unref?.();
    })
  ]);
}

function validarBodySemParametrosLivres(body = {}) {
  for (const chave of Object.keys(body || {})) {
    if (PARAMETROS_PROIBIDOS.has(chave)) throw criarErro("parametro_nao_permitido", 400);
  }
}

function validarWorkspace(workspaceId = "") {
  const workspace = String(workspaceId || WORKSPACE_PERMITIDO).trim();
  if (workspace !== WORKSPACE_PERMITIDO) throw criarErro("workspace_reset_nao_autorizado", 403);
  return workspace;
}

function validarConfirmacaoTexto(recebida = "", esperada = "") {
  if (String(recebida || "") !== esperada) throw criarErro("confirmacao_incorreta", 400);
}

function validarOperationId(operationId = "") {
  const texto = String(operationId || "").trim();
  if (!texto || texto.includes("..") || texto.includes("/") || texto.includes("\\") || !/^[a-zA-Z0-9_.-]+$/.test(texto)) {
    throw criarErro("operation_id_invalido", 400);
  }
  return texto;
}

function carregarOperacaoRestrita(operationId = "", dataDir = "/data") {
  const opId = validarOperationId(operationId);
  const caminhos = caminhosOperacao(opId, { dataDir });
  const manifest = readJson(caminhos.manifest, null);
  if (!manifest) throw criarErro("operation_id_nao_encontrado", 404);
  const workspaces = Object.keys(manifest.porWorkspace || {});
  if (!workspaces.includes(WORKSPACE_PERMITIDO) || workspaces.some(workspace => workspace !== WORKSPACE_PERMITIDO)) {
    throw criarErro("operation_id_workspace_nao_autorizado", 403);
  }
  return { operationId: opId, caminhos, manifest };
}

function totalRemovidosExecute(caminhos) {
  let removidos = 0;
  let pulados = 0;
  for (const arquivo of listarArquivosJson(caminhos.execute)) {
    const resultado = readJson(path.join(caminhos.execute, arquivo), {});
    removidos += Array.isArray(resultado.removidos) ? resultado.removidos.length : 0;
    pulados += Array.isArray(resultado.pulados) ? resultado.pulados.length : 0;
  }
  return { removidos, pulados };
}

function montarStatusOperacao({ operationId, caminhos, manifest }) {
  const lotes = listarArquivosJson(caminhos.lotes);
  const executados = listarArquivosJson(caminhos.execute);
  const totais = manifest.totais || {};
  const workspace = manifest.porWorkspace?.[WORKSPACE_PERMITIDO] || {};
  const exec = totalRemovidosExecute(caminhos);
  const status = executados.length > 0
    ? (executados.length >= lotes.length ? "execute_concluido_ou_retomavel" : "execute_parcial")
    : "dry_run_concluido";

  return {
    operationId,
    status,
    workspaceId: WORKSPACE_PERMITIDO,
    lotes: {
      total: lotes.length,
      executados: executados.length
    },
    totais: {
      totalLido: totais.totalFila ?? workspace.totalFila ?? null,
      elegiveis: totais.expirar ?? workspace.expirar ?? null,
      protegidos: Number(totais.preservarHistorico || 0) + Number(totais.preservarAtivo || 0),
      auditados: totais.auditar ?? workspace.auditar ?? null,
      removidos: exec.removidos,
      pulados: exec.pulados
    },
    erros: [],
    snapshotDisponivel: fs.existsSync(caminhos.snapshot),
    executePermitido: status === "dry_run_concluido",
    rollbackDisponivel: executados.length > 0,
    iniciadoEm: manifest.operationStartedAt || null,
    finalizadoEm: null
  };
}

function montarRespostaDryRun(resultado = {}, dataDir = "/data", duracaoMs = 0, contexto = {}) {
  const caminhos = caminhosOperacao(resultado.operationId, { dataDir });
  const workspace = resultado.porWorkspace?.[WORKSPACE_PERMITIDO] || {};
  const totais = resultado.totais || {};
  const filaHashAntes = contexto.filaHashAntes || null;
  const filaHashDepois = contexto.filaHashDepois || null;
  return {
    ok: resultado.ok === true,
    operationId: resultado.operationId,
    status: "dry_run_concluido",
    workspaceId: WORKSPACE_PERMITIDO,
    cutoffCongelado: resultado.cutoffCongelado || null,
    criterioHash: resultado.criterioHash || null,
    totalLido: totais.totalFila ?? workspace.totalFila ?? 0,
    elegiveis: totais.expirar ?? workspace.expirar ?? 0,
    protegidos: Number(totais.preservarHistorico || 0) + Number(totais.preservarAtivo || 0),
    auditados: totais.auditar ?? workspace.auditar ?? 0,
    lotes: resultado.quantidadeLotes ?? 0,
    tamanhoSnapshotBytes: tamanhoDirBytes(caminhos.base),
    espacoLivreAntes: contexto.espacoLivreAntes ?? null,
    espacoLivreDepois: contexto.espacoLivreDepois ?? null,
    hashes: resultado.hashes?.[WORKSPACE_PERMITIDO] || null,
    filaHashAntes,
    filaHashDepois,
    filaAlterada: filaHashAntes !== null && filaHashDepois !== null ? filaHashAntes !== filaHashDepois : null,
    rollbackDisponivel: fs.existsSync(caminhos.rollback),
    duracaoMs,
    aplicouMudancasOperacionais: resultado.aplicouMudancasOperacionais === true
  };
}

function montarRespostaExecute(resultado = {}, dataDir = "/data", duracaoMs = 0, contexto = {}) {
  return {
    ok: resultado.ok === true,
    status: "execute_concluido_ou_retomavel",
    workspaceId: WORKSPACE_PERMITIDO,
    operationId: resultado.operationId,
    lotesProcessados: resultado.lotesProcessados ?? 0,
    removidos: resultado.removidos ?? 0,
    pulados: resultado.pulados ?? 0,
    filaHashAntes: contexto.filaHashAntes || null,
    filaHashDepois: contexto.filaHashDepois || null,
    filaAlterada: contexto.filaHashAntes && contexto.filaHashDepois ? contexto.filaHashAntes !== contexto.filaHashDepois : null,
    duracaoMs,
    aplicouMudancasOperacionais: resultado.aplicouMudancasOperacionais === true
  };
}

function montarRespostaRollback(resultado = {}, duracaoMs = 0) {
  return {
    ok: resultado.ok === true,
    status: "rollback_concluido_ou_retomavel",
    workspaceId: WORKSPACE_PERMITIDO,
    operationId: resultado.operationId,
    restaurados: resultado.restaurados ?? 0,
    pulados: resultado.pulados ?? 0,
    duracaoMs
  };
}

function criarRotasResetEsteirasPreflight(deps = {}) {
  const router = express.Router();
  const isAdminMaster = typeof deps.isAdminMaster === "function"
    ? deps.isAdminMaster
    : (req) => req.usuario?.papel === "admin_master";
  const dataDir = deps.dataDir || process.env.DATA_DIR || "/data";
  const preflightFn = typeof deps.executarPreflight === "function"
    ? deps.executarPreflight
    : executarPreflightResetEsteiras;
  const dryRunFn = typeof deps.executarDryRun === "function"
    ? deps.executarDryRun
    : executarDryRunResetEsteiras;
  const executeFn = typeof deps.executarExecute === "function"
    ? deps.executarExecute
    : executarResetEsteiras;
  const rollbackFn = typeof deps.executarRollback === "function"
    ? deps.executarRollback
    : executarRollbackResetEsteiras;
  const timeoutMs = Number(deps.timeoutMs === undefined ? TIMEOUT_MS : deps.timeoutMs);
  const rateLimitMs = Number(deps.rateLimitMs === undefined ? RATE_LIMIT_MS : deps.rateLimitMs);

  function exigirAdminMaster(req, res) {
    if (!req.usuario) {
      res.status(401).json({ ok: false, erro: "nao_autenticado" });
      return false;
    }
    if (isAdminMaster(req)) return true;
    res.status(403).json({ ok: false, erro: "acesso_restrito_admin_master" });
    return false;
  }

  async function executarComProtecao(req, res, handler) {
    if (!exigirAdminMaster(req, res)) return;
    try {
      validarBodySemParametrosLivres(req.body || {});
    } catch (erro) {
      return res.status(statusErro(erro)).json(respostaErro(erro));
    }

    if (resetEmExecucao) {
      return res.status(409).json({ ok: false, erro: "reset_esteira_em_execucao" });
    }

    const agora = Date.now();
    if (ultimaChamadaMs && agora - ultimaChamadaMs < rateLimitMs) {
      return res.status(429).json({ ok: false, erro: "reset_esteira_rate_limit" });
    }

    resetEmExecucao = true;
    ultimaChamadaMs = agora;
    const inicio = Date.now();
    try {
      return await handler(inicio);
    } catch (erro) {
      return res.status(statusErro(erro)).json(respostaErro(erro));
    } finally {
      resetEmExecucao = false;
    }
  }

  router.post("/preflight", async (req, res) => {
    if (!exigirAdminMaster(req, res)) return;

    const workspaceId = String(req.body?.workspaceId || req.query?.workspaceId || WORKSPACE_PERMITIDO).trim();
    if (workspaceId !== WORKSPACE_PERMITIDO) {
      return res.status(403).json({
        ok: false,
        erro: "workspace_nao_permitido",
        workspacePermitido: WORKSPACE_PERMITIDO
      });
    }

    if (resetEmExecucao) {
      return res.status(409).json({ ok: false, erro: "preflight_reset_esteira_em_execucao" });
    }

    const agora = Date.now();
    if (ultimaChamadaMs && agora - ultimaChamadaMs < rateLimitMs) {
      return res.status(429).json({ ok: false, erro: "preflight_reset_esteira_rate_limit" });
    }

    resetEmExecucao = true;
    ultimaChamadaMs = agora;
    const inicio = Date.now();
    try {
      const resultado = await comTimeout(Promise.resolve(preflightFn({
        mode: "preflight",
        workspaceId: WORKSPACE_PERMITIDO,
        loteTamanho: LOTE_TAMANHO_FIXO,
        dataDir
      })), timeoutMs);
      const espaco = obterEspacoVolume(dataDir);
      return res.json(montarRespostaSanitizada(resultado, espaco, Date.now() - inicio));
    } catch (erro) {
      return res.status(statusErro(erro)).json(respostaErro(erro));
    } finally {
      resetEmExecucao = false;
    }
  });

  // TEMPORARIA, ADMIN_MASTER, WORKSPACE UNICO, SEM EXECUCAO AUTOMATICA.
  router.post("/dry-run", async (req, res) => executarComProtecao(req, res, async (inicio) => {
    validarWorkspace(req.body?.workspaceId);
    validarConfirmacaoTexto(req.body?.confirmacao, CONFIRMACAO_DRY_RUN);
    const fila = filaPath(WORKSPACE_PERMITIDO, { dataDir });
    const filaHashAntes = hashArquivo(fila);
    const espacoAntes = obterEspacoVolume(dataDir);
    const resultado = await comTimeout(Promise.resolve(dryRunFn({
      mode: "dry-run",
      workspaceId: WORKSPACE_PERMITIDO,
      loteTamanho: LOTE_TAMANHO_FIXO,
      dataDir
    })), timeoutMs);
    const filaHashDepois = hashArquivo(fila);
    const espacoDepois = obterEspacoVolume(dataDir);
    return res.json(montarRespostaDryRun(resultado, dataDir, Date.now() - inicio, {
      filaHashAntes,
      filaHashDepois,
      espacoLivreAntes: espacoAntes.espacoLivre,
      espacoLivreDepois: espacoDepois.espacoLivre
    }));
  }));

  // TEMPORARIA, ADMIN_MASTER, WORKSPACE UNICO, SEM EXECUCAO AUTOMATICA.
  router.get("/operacoes/:operationId", async (req, res) => {
    if (!exigirAdminMaster(req, res)) return;
    try {
      const operacao = carregarOperacaoRestrita(req.params.operationId, dataDir);
      return res.json({ ok: true, ...montarStatusOperacao(operacao) });
    } catch (erro) {
      return res.status(statusErro(erro)).json(respostaErro(erro));
    }
  });

  // TEMPORARIA, ADMIN_MASTER, WORKSPACE UNICO, SEM EXECUCAO AUTOMATICA.
  router.post("/execute", async (req, res) => executarComProtecao(req, res, async (inicio) => {
    validarWorkspace(req.body?.workspaceId);
    validarConfirmacaoTexto(req.body?.confirmacao, CONFIRMACAO_EXECUTE);
    const operationId = validarOperationId(req.body?.operationId);
    if (operationId !== String(req.body?.confirmOperationId || "")) {
      throw criarErro("confirm_operation_id_divergente", 400);
    }
    const operacao = carregarOperacaoRestrita(operationId, dataDir);
    const status = montarStatusOperacao(operacao);
    if (status.status !== "dry_run_concluido") throw criarErro("operation_id_sem_dry_run_valido", 409);
    const fila = filaPath(WORKSPACE_PERMITIDO, { dataDir });
    const filaHashAntes = hashArquivo(fila);
    const resultado = await comTimeout(Promise.resolve(executeFn({
      mode: "execute",
      operationId,
      confirmOperationId: operationId,
      workspaceId: WORKSPACE_PERMITIDO,
      loteTamanho: LOTE_TAMANHO_FIXO,
      dataDir
    })), timeoutMs);
    const filaHashDepois = hashArquivo(fila);
    return res.json(montarRespostaExecute(resultado, dataDir, Date.now() - inicio, {
      filaHashAntes,
      filaHashDepois
    }));
  }));

  // TEMPORARIA, ADMIN_MASTER, WORKSPACE UNICO, SEM EXECUCAO AUTOMATICA.
  router.post("/rollback", async (req, res) => executarComProtecao(req, res, async (inicio) => {
    validarWorkspace(req.body?.workspaceId);
    validarConfirmacaoTexto(req.body?.confirmacao, CONFIRMACAO_ROLLBACK);
    const operationId = validarOperationId(req.body?.operationId);
    if (operationId !== String(req.body?.confirmOperationId || "")) {
      throw criarErro("confirm_operation_id_divergente", 400);
    }
    carregarOperacaoRestrita(operationId, dataDir);
    const resultado = await comTimeout(Promise.resolve(rollbackFn({
      mode: "rollback",
      operationId,
      confirmOperationId: operationId,
      workspaceId: WORKSPACE_PERMITIDO,
      loteTamanho: LOTE_TAMANHO_FIXO,
      dataDir
    })), timeoutMs);
    return res.json(montarRespostaRollback(resultado, Date.now() - inicio));
  }));

  return router;
}

criarRotasResetEsteirasPreflight._resetEstadoParaTeste = () => {
  resetEmExecucao = false;
  ultimaChamadaMs = 0;
};
criarRotasResetEsteirasPreflight._setEmExecucaoParaTeste = (valor) => {
  resetEmExecucao = Boolean(valor);
};

module.exports = criarRotasResetEsteirasPreflight;
