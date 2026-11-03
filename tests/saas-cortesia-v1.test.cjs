"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const {
  calcularJanelaCortesia,
  registrarCicloCortesia,
  desativarCortesiaPendente,
  criarAgendadorCortesia
} = require("../modules/financeiro/cortesia.service");
const {
  projetarLedgerEmUsuario
} = require("../modules/financeiro/financeiro.service");

const planoPro = { id: "pro", nome: "Pro", creditosModelo: "ciclo",
  creditosPorCiclo: 300, cicloDias: 17, renovacaoCreditos: "pagamento" };

function repositorioMemoria() {
  const ledgers = [];
  let fila = Promise.resolve();
  const transacao = fn => {
    const executar = async () => fn({
      bloquearChave: async () => {},
      buscarCicloCortesiaMaisRecente: async workspaceId => ledgers
        .filter(item => item.cliente_id === workspaceId &&
          item.metadata.origin === "admin_courtesy" &&
          ["pending", "projected"].includes(item.projection_status))
        .sort((a, b) => String(b.cycle_start).localeCompare(String(a.cycle_start)))[0] || null,
      buscarLedgerPorIdempotencyKey: async key => ledgers.find(item =>
        item.idempotency_key === key) || null,
      reativarLedgerCortesiaIgnorado: async ledgerId => {
        const item = ledgers.find(candidate => candidate.id === ledgerId &&
          candidate.projection_status === "ignored" &&
          candidate.metadata?.origin === "admin_courtesy");
        if (!item) return null;
        item.projection_status = "pending";
        return item;
      },
      ignorarCiclosCortesiaPendentes: async (workspaceId, planId = "") => {
        let ignored = 0;
        for (const item of ledgers) {
          const itemPlan = item.metadata?.planSnapshot?.planoId || "";
          if (item.cliente_id === workspaceId &&
              item.metadata?.origin === "admin_courtesy" &&
              item.projection_status === "pending" &&
              (!planId || itemPlan !== planId)) {
            item.projection_status = "ignored";
            ignored += 1;
          }
        }
        return ignored;
      },
      inserirLedger: async input => {
        if (ledgers.some(item => item.idempotency_key === input.idempotencyKey)) {
          return null;
        }
        const row = { id: `ledger-${ledgers.length + 1}`,
          cliente_id: input.clienteId, ledger_type: input.ledgerType,
          amount: input.amount, balance_policy: input.balancePolicy,
          cycle_start: input.cycleStart, cycle_end: input.cycleEnd,
          idempotency_key: input.idempotencyKey,
          projection_status: "pending", metadata: input.metadata };
        ledgers.push(row);
        return row;
      }
    });
    const atual = fila.then(executar, executar);
    fila = atual.catch(() => {});
    return atual;
  };
  return { transacao, ledgers };
}

test("ativacao vencida abre um unico ciclo com periodicidade do plano", async () => {
  const repo = repositorioMemoria();
  const usuario = { id: "ws-a", plano: "pro", cortesiaAutomatica: true,
    cicloAtualFim: "2026-10-01T00:00:00.000Z" };
  const agora = new Date("2026-11-03T10:00:00.000Z");
  const primeira = await registrarCicloCortesia({ repositorio: repo, usuario,
    plano: planoPro, agora, operador: "admin-fixture" });
  assert.equal(primeira.created, true);
  assert.equal(primeira.amount, 300);
  assert.equal(primeira.cycleStart, "2026-11-03T10:00:00.000Z");
  assert.equal(primeira.cycleEnd, "2026-11-20T10:00:00.000Z");
  assert.equal(repo.ledgers[0].balance_policy, "replace_cycle");
  assert.equal(repo.ledgers[0].metadata.origin, "admin_courtesy");

  const concorrentes = await Promise.all(Array.from({ length: 8 }, () =>
    registrarCicloCortesia({ repositorio: repo, usuario, plano: planoPro,
      agora, operador: "scheduler" })));
  assert.equal(repo.ledgers.length, 1);
  assert.ok(concorrentes.every(item => item.created === false));
});

test("scheduler abre somente o ciclo atual seguinte sem acumular vencidos", async () => {
  const repo = repositorioMemoria();
  repo.ledgers.push({ id: "old", cliente_id: "ws-a",
    ledger_type: "cycle_credit", amount: 300, balance_policy: "replace_cycle",
    cycle_start: "2026-09-01T00:00:00.000Z",
    cycle_end: "2026-09-18T00:00:00.000Z",
    idempotency_key: "old", projection_status: "projected",
    metadata: { origin: "admin_courtesy",
      planSnapshot: { planoId: "pro" } } });
  const resultado = await registrarCicloCortesia({ repositorio: repo,
    usuario: { id: "ws-a", plano: "pro", cortesiaAutomatica: true },
    plano: planoPro, agora: new Date("2026-11-03T00:00:00.000Z") });
  assert.equal(resultado.created, true);
  assert.equal(resultado.cycleStart, "2026-10-22T00:00:00.000Z");
  assert.equal(resultado.cycleEnd, "2026-11-08T00:00:00.000Z");
  assert.equal(repo.ledgers.length, 2, "nao cria um ledger por ciclo perdido");
});

test("OFF, Free Beta e ciclo vigente preservam a politica normal", async () => {
  const repo = repositorioMemoria();
  const off = await registrarCicloCortesia({ repositorio: repo,
    usuario: { id: "paid", cortesiaAutomatica: false }, plano: planoPro });
  assert.equal(off.reason, "courtesy_disabled");
  const beta = calcularJanelaCortesia({
    usuario: { id: "beta", cortesiaAutomatica: true },
    plano: { ...planoPro, id: "free_beta", entradaBeta: true },
    agora: "2026-11-03T00:00:00.000Z"
  });
  assert.equal(beta.ok, false);
  assert.equal(beta.reason, "courtesy_plan_not_cyclic");
  const vigente = calcularJanelaCortesia({
    usuario: { id: "paid", cicloAtualFim: "2026-11-10T00:00:00.000Z" },
    plano: planoPro, agora: "2026-11-03T00:00:00.000Z"
  });
  assert.equal(vigente.due, false);
  assert.equal(vigente.reason, "existing_cycle_current");
});

test("desativar ignora somente cortesia pendente e nao revoga ciclo projetado", async () => {
  const repo = repositorioMemoria();
  repo.ledgers.push(
    { id: "pending", cliente_id: "ws-a", ledger_type: "cycle_credit",
      cycle_start: "2026-11-03T00:00:00.000Z", projection_status: "pending",
      metadata: { origin: "admin_courtesy", planSnapshot: { planoId: "pro" } } },
    { id: "projected", cliente_id: "ws-a", ledger_type: "cycle_credit",
      cycle_start: "2026-10-01T00:00:00.000Z", projection_status: "projected",
      metadata: { origin: "admin_courtesy", planSnapshot: { planoId: "pro" } } }
  );
  const resultado = await desativarCortesiaPendente({ repositorio: repo,
    workspaceId: "ws-a" });
  assert.equal(resultado.ignored, 1);
  assert.equal(repo.ledgers[0].projection_status, "ignored");
  assert.equal(repo.ledgers[1].projection_status, "projected");
});

test("reativar depois de cancelar pendencia pode abrir o ciclo uma vez", async () => {
  const repo = repositorioMemoria();
  const usuario = { id: "ws-a", plano: "pro", cortesiaAutomatica: true,
    cicloAtualFim: "2026-10-01T00:00:00.000Z" };
  await registrarCicloCortesia({ repositorio: repo, usuario,
    plano: planoPro, agora: "2026-11-03T00:00:00.000Z" });
  await desativarCortesiaPendente({ repositorio: repo, workspaceId: "ws-a" });
  const resultado = await registrarCicloCortesia({ repositorio: repo, usuario,
    plano: planoPro, agora: "2026-11-03T00:00:00.000Z" });
  assert.equal(resultado.reactivated, true);
  assert.equal(repo.ledgers.length, 1);
  assert.equal(repo.ledgers[0].projection_status, "pending");
});

test("mudanca de plano cria uma unica janela do novo plano e isola workspaces", async () => {
  const repo = repositorioMemoria();
  repo.ledgers.push({ id: "pending-old-plan", cliente_id: "ws-a",
    ledger_type: "cycle_credit", cycle_start: "2026-11-01T00:00:00.000Z",
    cycle_end: "2026-11-18T00:00:00.000Z", projection_status: "pending",
    metadata: { origin: "admin_courtesy",
      planSnapshot: { planoId: "pro" } } });
  const planoUltimate = { ...planoPro, id: "ultimate", nome: "Ultimate",
    creditosPorCiclo: 900, cicloDias: 41 };
  const [a, b] = await Promise.all([
    registrarCicloCortesia({ repositorio: repo,
      usuario: { id: "ws-a", plano: "ultimate", cortesiaAutomatica: true },
      plano: planoUltimate, agora: "2026-11-03T00:00:00.000Z",
      forcarNovoPlano: true }),
    registrarCicloCortesia({ repositorio: repo,
      usuario: { id: "ws-b", plano: "pro", cortesiaAutomatica: true },
      plano: planoPro, agora: "2026-11-03T00:00:00.000Z" })
  ]);
  assert.equal(a.amount, 900);
  assert.equal(a.cycleEnd, "2026-12-14T00:00:00.000Z");
  assert.equal(b.amount, 300);
  assert.equal(repo.ledgers[0].projection_status, "ignored",
    "ciclo pendente do plano anterior nao pode ser projetado depois");
  assert.deepEqual(new Set(repo.ledgers.map(item => item.cliente_id)),
    new Set(["ws-a", "ws-b"]));
});

test("projecao de cortesia preserva identidade do ultimo pagamento", () => {
  const usuario = { id: "ws-a", creditos: 12, plano: "pro",
    pagamentoUltimoId: "payment-preservado",
    pagamentoUltimoStatus: "approved",
    ultimoCicloCreditoId: "payment-cycle-preservado" };
  const resultado = projetarLedgerEmUsuario(usuario, {
    id: "courtesy-ledger", ledger_type: "cycle_credit", amount: 300,
    cycle_start: "2026-11-03T00:00:00.000Z",
    cycle_end: "2026-11-20T00:00:00.000Z",
    idempotency_key: "courtesy-cycle:key",
    metadata: { origin: "admin_courtesy",
      planSnapshot: { planoId: "pro" } }
  });
  assert.equal(resultado.ok, true);
  assert.equal(usuario.creditos, 300);
  assert.equal(usuario.assinaturaStatus, "cortesia_ativa");
  assert.equal(usuario.pagamentoUltimoId, "payment-preservado");
  assert.equal(usuario.pagamentoUltimoStatus, "approved");
  assert.equal(usuario.ultimoCicloCreditoId, "payment-cycle-preservado");
  assert.equal(usuario.cortesiaUltimoCicloLedgerId, "courtesy-ledger");
});

test("agendador impede sobreposicao", async () => {
  let resolver;
  let chamadas = 0;
  const bloqueio = new Promise(resolve => { resolver = resolve; });
  const scheduler = criarAgendadorCortesia({ intervaloMs: 60_000,
    executar: async () => { chamadas += 1; await bloqueio; return { ok: true }; },
    logger: { error() {} } });
  const primeira = scheduler.run();
  const segunda = await scheduler.run();
  assert.equal(segunda.skipped, true);
  resolver();
  await primeira;
  scheduler.stop();
  assert.equal(chamadas, 1);
});

test("contratos impedem cortesia em login, me e preflight", () => {
  const index = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  for (const [inicio, fim] of [
    ["app.post(\"/auth/google\"", "app.post(\"/auth/recuperar-senha\""],
    ["app.get(\"/me\"", "app.get(\"/planos\""],
    ["async function creditoDisponivelParaEnvio", "async function saldoCreditosParaExibicao"]
  ]) {
    const trecho = index.slice(index.indexOf(inicio), index.indexOf(fim,
      index.indexOf(inicio)));
    assert.ok(trecho.length > 0);
    assert.ok(!trecho.includes("processarCortesiaUsuario"));
    assert.ok(!trecho.includes("registrarCicloCortesia"));
  }
  const credits = fs.readFileSync(path.join(__dirname, "..", "modules",
    "engine", "universal-credits.repository.js"), "utf8");
  assert.ok(credits.includes("Number(row.reserved) > 0"),
    "replace de ciclo continua bloqueado enquanto houver holds");
});
