"use strict";

const { createHash } = require("node:crypto");
const { politicaCreditosPlano } = require("../../utils/saas-fundacao");

const ORIGEM_CORTESIA = "admin_courtesy";

function texto(valor = "") {
  return String(valor ?? "").trim();
}

function dataValida(valor = "") {
  const data = new Date(valor || "");
  return Number.isFinite(data.getTime()) ? data : null;
}

function adicionarDias(data, dias) {
  const proxima = new Date(data);
  proxima.setUTCDate(proxima.getUTCDate() + Math.max(1, Number(dias) || 30));
  return proxima;
}

function identidadePlano(plano = {}, fallback = "") {
  return texto(plano.id || plano.planoId || plano.chaveOriginal ||
    plano.nome || fallback);
}

function fingerprintCiclo({ workspaceId, planId, cycleStart }) {
  return createHash("sha256").update(JSON.stringify([
    ORIGEM_CORTESIA, texto(workspaceId), texto(planId),
    new Date(cycleStart).toISOString()
  ])).digest("hex");
}

function calcularJanelaCortesia({ usuario = {}, plano = {}, ultimoCiclo = null,
  agora = new Date(), forcarNovoPlano = false } = {}) {
  const politica = politicaCreditosPlano(plano);
  if (plano.entradaBeta === true || politica.creditosModelo !== "ciclo" ||
      politica.creditosPorCiclo <= 0) {
    return { ok: false, reason: "courtesy_plan_not_cyclic" };
  }
  const agoraData = new Date(agora);
  if (!Number.isFinite(agoraData.getTime())) {
    return { ok: false, reason: "courtesy_clock_invalid" };
  }

  const planId = identidadePlano(plano, usuario.plano);
  if (!planId) return { ok: false, reason: "courtesy_plan_missing" };
  const ultimoPlanId = texto(ultimoCiclo?.metadata?.planSnapshot?.planoId ||
    ultimoCiclo?.metadata?.planoId);
  const ultimoFim = dataValida(ultimoCiclo?.cycle_end || ultimoCiclo?.cycleEnd);
  const ultimoPendente = ultimoCiclo &&
    texto(ultimoCiclo.projection_status || ultimoCiclo.projectionStatus) === "pending";

  if (ultimoPendente && ultimoPlanId === planId) {
    return { ok: true, due: false, pending: true,
      ledgerId: ultimoCiclo.id || null, reason: "courtesy_projection_pending" };
  }
  if (!forcarNovoPlano && ultimoFim && ultimoFim > agoraData &&
      ultimoPlanId === planId) {
    return { ok: true, due: false, reason: "courtesy_cycle_current",
      cycleEnd: ultimoFim.toISOString() };
  }

  const cicloUsuarioFim = dataValida(usuario.cicloAtualFim ||
    usuario.proximaRenovacao);
  if (!ultimoCiclo && !forcarNovoPlano && cicloUsuarioFim &&
      cicloUsuarioFim > agoraData) {
    return { ok: true, due: false, reason: "existing_cycle_current",
      cycleEnd: cicloUsuarioFim.toISOString() };
  }

  let inicio = ultimoFim && ultimoPlanId === planId && !forcarNovoPlano
    ? new Date(ultimoFim) : new Date(agoraData);
  let fim = adicionarDias(inicio, politica.cicloDias);
  while (fim <= agoraData) {
    inicio = fim;
    fim = adicionarDias(inicio, politica.cicloDias);
  }
  const cycleStart = inicio.toISOString();
  const cycleEnd = fim.toISOString();
  return {
    ok: true,
    due: true,
    planId,
    amount: politica.creditosPorCiclo,
    cycleStart,
    cycleEnd,
    idempotencyKey: `courtesy-cycle:${fingerprintCiclo({
      workspaceId: usuario.id, planId, cycleStart
    })}`
  };
}

async function registrarCicloCortesia({ repositorio, usuario, plano,
  operador = "scheduler", agora = new Date(), forcarNovoPlano = false } = {}) {
  if (!repositorio || typeof repositorio.transacao !== "function") {
    throw new Error("courtesy_repository_required");
  }
  if (!usuario?.id || usuario.cortesiaAutomatica !== true) {
    return { ok: true, created: false, reason: "courtesy_disabled" };
  }

  return repositorio.transacao(async tx => {
    await tx.bloquearChave(`courtesy:${usuario.id}`);
    // Um ciclo pendente de outro plano nunca pode ser projetado depois da
    // troca. A limpeza é idempotente e ocorre sob o mesmo advisory lock.
    await tx.ignorarCiclosCortesiaPendentes(usuario.id,
      identidadePlano(plano, usuario.plano));
    const ultimoCiclo = await tx.buscarCicloCortesiaMaisRecente(usuario.id);
    const janela = calcularJanelaCortesia({ usuario, plano, ultimoCiclo,
      agora, forcarNovoPlano });
    if (!janela.ok || !janela.due) {
      return { ...janela, created: false };
    }
    const existente = await tx.buscarLedgerPorIdempotencyKey(
      janela.idempotencyKey);
    if (existente) {
      const estado = texto(existente.projection_status ||
        existente.projectionStatus);
      if (estado === "ignored" &&
          typeof tx.reativarLedgerCortesiaIgnorado === "function") {
        const reativado = await tx.reativarLedgerCortesiaIgnorado(existente.id);
        if (reativado) {
          return { ok: true, created: false, reactivated: true,
            ledgerId: reativado.id, ...janela };
        }
      }
      return { ok: true, created: false, duplicate: true,
        ledgerId: existente.id, reason: "courtesy_cycle_duplicate" };
    }
    const ledger = await tx.inserirLedger({
      clienteId: usuario.id,
      ledgerType: "cycle_credit",
      amount: janela.amount,
      balancePolicy: "replace_cycle",
      cycleStart: janela.cycleStart,
      cycleEnd: janela.cycleEnd,
      reason: "admin_courtesy_cycle",
      idempotencyKey: janela.idempotencyKey,
      metadata: {
        authority: "postgresql_universal",
        origin: ORIGEM_CORTESIA,
        operador: texto(operador),
        planSnapshot: {
          planoId: janela.planId,
          creditosPorCiclo: janela.amount,
          cicloDias: politicaCreditosPlano(plano).cicloDias
        }
      }
    });
    return { ok: true, created: Boolean(ledger),
      duplicate: !ledger, ledgerId: ledger?.id || null, ...janela };
  });
}

async function desativarCortesiaPendente({ repositorio, workspaceId } = {}) {
  if (!repositorio || typeof repositorio.transacao !== "function") {
    throw new Error("courtesy_repository_required");
  }
  const workspace = texto(workspaceId);
  if (!workspace) throw new Error("courtesy_workspace_required");
  return repositorio.transacao(async tx => {
    await tx.bloquearChave(`courtesy:${workspace}`);
    const ignored = await tx.ignorarCiclosCortesiaPendentes(workspace);
    return { ok: true, ignored };
  });
}

function criarAgendadorCortesia({ executar, intervaloMs = 5 * 60 * 1000,
  logger = console } = {}) {
  if (typeof executar !== "function") {
    throw new Error("courtesy_scheduler_execute_required");
  }
  let rodando = false;
  const run = async () => {
    if (rodando) return { ok: false, skipped: true, reason: "already_running" };
    rodando = true;
    try { return await executar(); }
    catch (erro) {
      logger.error?.("[COURTESY-SCHEDULER]", {
        codigo: texto(erro?.codigo || erro?.message || "courtesy_scheduler_failed")
      });
      return { ok: false, reason: "courtesy_scheduler_failed" };
    } finally { rodando = false; }
  };
  const timer = setInterval(() => { void run(); }, Math.max(60_000,
    Number(intervaloMs) || 5 * 60 * 1000));
  timer.unref?.();
  return { run, stop: () => clearInterval(timer) };
}

module.exports = {
  ORIGEM_CORTESIA,
  calcularJanelaCortesia,
  registrarCicloCortesia,
  desativarCortesiaPendente,
  criarAgendadorCortesia
};
