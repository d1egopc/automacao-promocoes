"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const saasFundacao = require("../utils/saas-fundacao");
const universalCreditEligibility = require("../modules/engine/universal-credit-eligibility.service");

const source = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
function extract(name) {
  const begin = source.indexOf(`function ${name}(`);
  assert.ok(begin >= 0, `${name} must exist`);
  const rest = source.slice(begin + 1);
  const next = rest.search(/\n(?:async )?function [A-Za-z]/);
  return source.slice(begin, next < 0 ? undefined : begin + 1 + next);
}
function fixture(user) {
  let renewals = 0, saves = 0;
  const context = vm.createContext({
    modoMotorReal: "LEGACY", usuarioAtivoOperacional: () => true,
    obterUsuario: () => user, obterPlanoUsuarioObjeto: () => ({
      nome: "Pro", creditosModelo: "ciclo", renovacaoCreditos: "pagamento",
      creditosPorCiclo: 100, cicloDias: 30
    }),
    renovarCreditosSeNecessario: () => { renewals++; },
    salvarUsuarios: () => { saves++; },
    universalCreditEligibility, saasFundacao,
    console: { log() {} }
  });
  vm.runInContext([
    extract("usuarioTemCreditos"), extract("debitarCreditos"),
    extract("reservarCreditoEnvioManualV2"),
    extract("confirmarCreditoEnvioManualV2")
  ].join("\n"), context);
  return { context, counters: () => ({ renewals, saves }) };
}
const validUser = () => ({ creditos: 2, assinaturaStatus: "ativa",
  pagamentoUltimoStatus: "aprovado", ultimoCicloCreditoId: "fixture-paid",
  cicloAtualFim: "2099-01-01T00:00:00.000Z" });

test("LEGACY Manual V2 checks current entitlement and debits without renewal", async () => {
  const user = validUser();
  const { context, counters } = fixture(user);
  const hold = await context.reservarCreditoEnvioManualV2({ clienteId: "fixture" });
  assert.equal(hold.ok, true);
  assert.equal((await context.confirmarCreditoEnvioManualV2(hold)).ok, true);
  assert.equal(user.creditos, 1);
  assert.deepEqual(counters(), { renewals: 0, saves: 1 });
});
test("expired or insufficient LEGACY cycle cannot send or mutate", async () => {
  for (const user of [
    { ...validUser(), cicloAtualFim: "2020-01-01T00:00:00.000Z" },
    { ...validUser(), creditos: 0 }
  ]) {
    const { context, counters } = fixture(user);
    const hold = await context.reservarCreditoEnvioManualV2({ clienteId: "fixture" });
    assert.equal(hold.ok, false);
    assert.equal((await context.confirmarCreditoEnvioManualV2({
      legacy: true, clienteId: "fixture" })).ok, false);
    assert.deepEqual(counters(), { renewals: 0, saves: 0 });
  }
});
test("LEGACY renewal remains available outside Manual V2", () => {
  const { context, counters } = fixture(validUser());
  assert.equal(context.usuarioTemCreditos("fixture", 1), true);
  assert.equal(counters().renewals, 1);
});
