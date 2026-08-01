"use strict";

const express = require("express");
const storageService = require("./storage.service");
const { POLITICAS_RETENCAO_PADRAO } = require("./storage.types");
const repository = require("./storage.repository");

const DEFAULT_TIMEOUT_MS = 30000;
const MAX_TIMEOUT_MS = 120000;
let auditoriaEmExecucao = false;
let ultimaAuditoria = null;

function statusErro(erro) {
  return erro.statusCode || (erro.codigo === "auditoria_storage_timeout" ? 503 : 500);
}

function payloadErro(erro) {
  return {
    ok: false,
    erro: erro.codigo || erro.message || "storage_manager_erro"
  };
}

function limitarNumero(valor, padrao, min, max) {
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return padrao;
  return Math.max(min, Math.min(max, Math.floor(numero)));
}

function resumirUltimaAuditoria(auditoria) {
  if (!auditoria) return null;
  return {
    geradoEm: auditoria.geradoEm,
    duracaoMs: auditoria.duracaoMs,
    timeoutMs: auditoria.timeoutMs,
    health: auditoria.health,
    resumo: auditoria.resumo,
    espaco: auditoria.espaco
  };
}

function criarRotasStorageManager(deps = {}) {
  const router = express.Router();
  const isAdminMaster = typeof deps.isAdminMaster === "function"
    ? deps.isAdminMaster
    : (req) => req.usuario?.papel === "admin_master";
  const dataDir = deps.dataDir || process.env.DATA_DIR || "/data";
  const timeoutPadraoMs = limitarNumero(deps.timeoutMs || process.env.OSM_AUDITORIA_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 1000, MAX_TIMEOUT_MS);

  function exigirAdminMaster(req, res) {
    if (isAdminMaster(req)) return true;
    res.status(403).json({ ok: false, erro: "acesso_restrito_admin_master" });
    return false;
  }

  function opcoesConsulta(req) {
    return {
      dataDir,
      top: limitarNumero(req.query?.top ?? req.body?.top, 50, 1, 100),
      recentMinutes: limitarNumero(req.query?.recentMinutes ?? req.body?.recentMinutes, 30, 1, 1440),
      timeoutMs: limitarNumero(req.query?.timeoutMs ?? req.body?.timeoutMs, timeoutPadraoMs, 1000, MAX_TIMEOUT_MS)
    };
  }

  router.get("/health", (req, res) => {
    try {
      if (!exigirAdminMaster(req, res)) return;
      const espaco = repository.obterEspacoVolume(dataDir);
      return res.json({
        ok: true,
        modo: "somente_leitura",
        aplicouMudancas: false,
        auditoriaEmExecucao,
        espaco,
        ultimaAuditoria: resumirUltimaAuditoria(ultimaAuditoria),
        politicasRetencao: POLITICAS_RETENCAO_PADRAO
      });
    } catch (erro) {
      return res.status(statusErro(erro)).json(payloadErro(erro));
    }
  });

  router.post("/auditar", (req, res) => {
    if (!exigirAdminMaster(req, res)) return;
    if (auditoriaEmExecucao) {
      return res.status(409).json({
        ok: false,
        erro: "auditoria_storage_em_execucao"
      });
    }

    auditoriaEmExecucao = true;
    try {
      const diagnostico = storageService.gerarDiagnosticoStorage(opcoesConsulta(req));
      ultimaAuditoria = diagnostico;
      return res.json(diagnostico);
    } catch (erro) {
      ultimaAuditoria = {
        ok: false,
        geradoEm: new Date().toISOString(),
        erro: erro.codigo || erro.message || "storage_manager_erro"
      };
      return res.status(statusErro(erro)).json(payloadErro(erro));
    } finally {
      auditoriaEmExecucao = false;
    }
  });

  router.get("/politicas-retencao", (req, res) => {
    try {
      if (!exigirAdminMaster(req, res)) return;
      return res.json({
        ok: true,
        aplicouMudancas: false,
        politicasRetencao: POLITICAS_RETENCAO_PADRAO,
        observacao: "politicas_apenas_calculadas_na_fase_1"
      });
    } catch (erro) {
      return res.status(statusErro(erro)).json(payloadErro(erro));
    }
  });

  return router;
}

criarRotasStorageManager._estadoParaTeste = () => ({ auditoriaEmExecucao, ultimaAuditoria });
criarRotasStorageManager._setAuditoriaEmExecucaoParaTeste = (valor) => {
  auditoriaEmExecucao = Boolean(valor);
};
criarRotasStorageManager._resetEstadoParaTeste = () => {
  auditoriaEmExecucao = false;
  ultimaAuditoria = null;
};

module.exports = criarRotasStorageManager;