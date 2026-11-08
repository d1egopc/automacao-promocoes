"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const { listarUsuariosAdminSomenteLeitura } = require("../modules/saas/admin-users-read-model");
const { projetarSaldoCreditos } = require("../modules/saas/credit-balance.service");

test("Admin Master UNIVERSAL lista somente créditos disponíveis", async () => {
  const usuarios = [
    { id: "admin", papel: "admin_master" },
    { id: "user_pss60lus", papel: "cliente" }
  ];
  const resposta = await listarUsuariosAdminSomenteLeitura({
    usuarios,
    mode: "UNIVERSAL",
    sanitizar: usuario => ({ id: usuario.id, papel: usuario.papel }),
    lerSaldo: async id => id === "user_pss60lus" ? 0 : null
  });
  assert.equal(resposta[0].creditos, null);
  assert.equal(resposta[1].creditos, 0);
});

test("projeção UNIVERSAL separa total de disponível e LEGACY permanece igual", () => {
  const universal = projetarSaldoCreditos({
    mode: "UNIVERSAL",
    saldo: { balance: 15436, available: 0, reserved: 9, legacySegregated: 15408 }
  });
  assert.equal(universal.total, 15436);
  assert.equal(universal.disponivel, 0);
  assert.equal(universal.historicoBloqueado, 15408);

  const legacy = projetarSaldoCreditos({ mode: "LEGACY", usuario: { creditos: 123 } });
  assert.equal(legacy.total, 123);
  assert.equal(legacy.disponivel, 123);
});

test("rotas administrativas usam disponível sem alterar o ledger", () => {
  const source = fs.readFileSync(require.resolve("../index.js"), "utf8");
  assert.match(source, /lerSaldo:\s*saldoCreditosAdminSomenteLeitura/);
  assert.match(source, /creditos:\s*await saldoCreditosAdminSomenteLeitura\(id, usuario\)/);
  assert.match(source, /creditos:\s*movimento\.available/);
});

test("Dashboard, perfil, Google e telemetria usam a mesma projeção disponível", () => {
  const source = fs.readFileSync(require.resolve("../index.js"), "utf8");
  const status = source.slice(source.indexOf('app.get("/automacao/status"'));
  const me = source.slice(source.indexOf('app.get("/me"'));
  assert.match(status, /const saldoCreditos = projecaoCreditos\.disponivel/);
  assert.match(me, /saldoCreditos = creditosFinanceiros\.disponivel/);
  assert.match(source, /async function saldoCreditosGoogleSomenteLeitura[\s\S]*?return projecao\.disponivel/);
  assert.match(source, /source: "projecaoCreditosSomenteLeitura"[\s\S]*?creditosFinanceiros: projecao/);
});
