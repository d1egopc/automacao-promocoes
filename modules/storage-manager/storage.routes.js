"use strict";

const express = require("express");
const storageService = require("./storage.service");
const { POLITICAS_RETENCAO_PADRAO } = require("./storage.types");
const repository = require("./storage.repository");

const DEFAULT_TIMEOUT_MS = 8000;
const MAX_TIMEOUT_MS = 30000;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const CONFIRMACAO_LIMPEZA_FILA_BAK = "REMOVER_FILA_JSON_BAK_VALIDADO";
let auditoriaEmExecucao = false;
const escoposEmExecucao = new Set();
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

function limitarTexto(valor, padrao = "") {
  return String(valor || padrao || "").trim();
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
  const logger = deps.logger || console;
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
      topFiles: limitarNumero(req.query?.topFiles ?? req.body?.topFiles, 10, 1, 20),
      limit: limitarNumero(req.query?.limit ?? req.body?.limit, DEFAULT_LIMIT, 1, MAX_LIMIT),
      cursor: limitarTexto(req.query?.cursor ?? req.body?.cursor),
      maxFiles: limitarNumero(req.query?.maxFiles ?? req.body?.maxFiles, 2000, 1, 10000),
      recentMinutes: limitarNumero(req.query?.recentMinutes ?? req.body?.recentMinutes, 30, 1, 1440),
      timeoutMs: limitarNumero(req.query?.timeoutMs ?? req.body?.timeoutMs, timeoutPadraoMs, 1000, MAX_TIMEOUT_MS)
    };
  }

  async function executarEscopo(req, res, escopo, fn) {
    if (!exigirAdminMaster(req, res)) return;
    if (escoposEmExecucao.has(escopo)) {
      return res.status(409).json({
        ok: false,
        erro: "auditoria_storage_em_execucao",
        escopo
      });
    }

    escoposEmExecucao.add(escopo);
    auditoriaEmExecucao = escoposEmExecucao.size > 0;
    try {
      const resultado = await fn();
      ultimaAuditoria = {
        geradoEm: new Date().toISOString(),
        escopo,
        duracaoMs: resultado?.duracaoMs,
        timeoutMs: resultado?.timeoutMs,
        parcial: resultado?.parcial,
        timeoutAtingido: resultado?.timeoutAtingido
      };
      return res.json(resultado);
    } catch (erro) {
      ultimaAuditoria = {
        ok: false,
        geradoEm: new Date().toISOString(),
        escopo,
        erro: erro.codigo || erro.message || "storage_manager_erro"
      };
      return res.status(statusErro(erro)).json(payloadErro(erro));
    } finally {
      escoposEmExecucao.delete(escopo);
      auditoriaEmExecucao = escoposEmExecucao.size > 0;
    }
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
    return res.json({
      ok: true,
      modo: "somente_leitura",
      aplicouMudancas: false,
      auditoriaMonoliticaDesativada: true,
      motivo: "auditoria_incremental_obrigatoria",
      rotasIncrementais: [
        "GET /admin/storage/health",
        "GET /admin/storage/diretorios",
        "GET /admin/storage/workspaces",
        "GET /admin/storage/workspaces/:workspaceId",
        "GET /admin/storage/filas",
        "GET /admin/storage/filas/compactacao",
        "GET /admin/storage/categoria/:categoria"
      ],
      rotaExecucaoControlada: "POST /admin/storage/limpeza-emergencial/fila-bak"
    });
  });

  router.get("/diretorios", (req, res) => {
    return executarEscopo(req, res, "diretorios", () => storageService.diagnosticarDiretorios(opcoesConsulta(req)));
  });

  router.get("/workspaces", (req, res) => {
    return executarEscopo(req, res, "workspaces", () => storageService.diagnosticarWorkspaces(opcoesConsulta(req)));
  });

  router.get("/workspaces/:workspaceId", (req, res) => {
    const workspaceId = String(req.params.workspaceId || "");
    return executarEscopo(req, res, `workspace:${workspaceId}`, () => storageService.diagnosticarWorkspace(workspaceId, opcoesConsulta(req)));
  });

  router.get("/filas", (req, res) => {
    return executarEscopo(req, res, "filas", () => storageService.diagnosticarFilas(opcoesConsulta(req)));
  });

  router.get("/filas/compactacao", (req, res) => {
    const workspaceId = limitarTexto(req.query?.workspaceId ?? req.body?.workspaceId);
    return executarEscopo(req, res, `filas:compactacao:${workspaceId || "pagina"}`, () => storageService.diagnosticarCompactacaoFilas({
      ...opcoesConsulta(req),
      workspaceId
    }));
  });

  router.get("/categoria/:categoria", (req, res) => {
    const categoria = String(req.params.categoria || "");
    return executarEscopo(req, res, `categoria:${categoria}`, () => storageService.diagnosticarCategoria(categoria, opcoesConsulta(req)));
  });

  router.post("/limpeza-emergencial/fila-bak", (req, res) => {
    if (!exigirAdminMaster(req, res)) return;

    const confirmacao = String(req.body?.confirmacao || "").trim();
    if (confirmacao !== CONFIRMACAO_LIMPEZA_FILA_BAK) {
      return res.status(400).json({
        ok: false,
        erro: "confirmacao_limpeza_invalida",
        confirmacaoEsperada: CONFIRMACAO_LIMPEZA_FILA_BAK
      });
    }

    const arquivos = Array.isArray(req.body?.arquivos) ? req.body.arquivos : [];
    if (!arquivos.length) {
      return res.status(400).json({ ok: false, erro: "arquivos_obrigatorios" });
    }

    return executarEscopo(req, res, "limpeza:fila-bak", () => storageService.executarLimpezaEmergencialFilaBak({
      dataDir,
      arquivos,
      limite: arquivos.length,
      dryRun: Boolean(req.body?.dryRun),
      logger
    }));
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
criarRotasStorageManager._setEscopoEmExecucaoParaTeste = (escopo, valor) => {
  if (valor) escoposEmExecucao.add(escopo);
  else escoposEmExecucao.delete(escopo);
  auditoriaEmExecucao = escoposEmExecucao.size > 0;
};
criarRotasStorageManager._resetEstadoParaTeste = () => {
  auditoriaEmExecucao = false;
  escoposEmExecucao.clear();
  ultimaAuditoria = null;
};

module.exports = criarRotasStorageManager;
