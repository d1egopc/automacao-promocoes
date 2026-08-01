"use strict";

const fs = require("fs");
const express = require("express");
const { executarPreflightResetEsteiras } = require("./reset.runner");

const WORKSPACE_PERMITIDO = "user_9hqs434h";
const LOTE_TAMANHO_FIXO = 100;
const TIMEOUT_MS = 30000;
const RATE_LIMIT_MS = 10000;

let preflightEmExecucao = false;
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

function criarRotasResetEsteirasPreflight(deps = {}) {
  const router = express.Router();
  const isAdminMaster = typeof deps.isAdminMaster === "function"
    ? deps.isAdminMaster
    : (req) => req.usuario?.papel === "admin_master";
  const dataDir = deps.dataDir || process.env.DATA_DIR || "/data";
  const preflightFn = typeof deps.executarPreflight === "function"
    ? deps.executarPreflight
    : executarPreflightResetEsteiras;
  const timeoutMs = Number(deps.timeoutMs || TIMEOUT_MS);
  const rateLimitMs = Number(deps.rateLimitMs || RATE_LIMIT_MS);

  function exigirAdminMaster(req, res) {
    if (!req.usuario) {
      res.status(401).json({ ok: false, erro: "nao_autenticado" });
      return false;
    }
    if (isAdminMaster(req)) return true;
    res.status(403).json({ ok: false, erro: "acesso_restrito_admin_master" });
    return false;
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

    if (preflightEmExecucao) {
      return res.status(409).json({ ok: false, erro: "preflight_reset_esteira_em_execucao" });
    }

    const agora = Date.now();
    if (ultimaChamadaMs && agora - ultimaChamadaMs < rateLimitMs) {
      return res.status(429).json({ ok: false, erro: "preflight_reset_esteira_rate_limit" });
    }

    preflightEmExecucao = true;
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
      preflightEmExecucao = false;
    }
  });

  return router;
}

criarRotasResetEsteirasPreflight._resetEstadoParaTeste = () => {
  preflightEmExecucao = false;
  ultimaChamadaMs = 0;
};
criarRotasResetEsteirasPreflight._setEmExecucaoParaTeste = (valor) => {
  preflightEmExecucao = Boolean(valor);
};

module.exports = criarRotasResetEsteirasPreflight;
