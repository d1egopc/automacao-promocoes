"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const fonte = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");

function trechoEntre(inicio, fim) {
  const a = fonte.indexOf(inicio);
  assert.ok(a >= 0, `trecho inicial ausente: ${inicio}`);
  const b = fonte.indexOf(fim, a + inicio.length);
  assert.ok(b > a, `trecho final ausente: ${fim}`);
  return fonte.slice(a, b);
}

const transicao = trechoEntre(
  "function transicaoCadastroCreditosUniversal()",
  "async function usuarioAdminComSaldoOperacional"
);
assert.match(transicao, /modoMotorReal !== "UNIVERSAL"/);
assert.match(transicao, /prepararAberturaCadastroUniversal/);
assert.match(transicao, /reconciliarAberturaCadastroUniversal/);
assert.match(transicao, /openingBalance: usuario\.creditos/);

for (const [nome, fim] of [
  ["executarCadastroPublicoAtomico", "async function executarCadastroGooglePublicoAtomico"],
  ["executarCadastroGooglePublicoAtomico", "async function executarCadastroInternoAdminAtomico"],
  ["executarCadastroInternoAdminAtomico", "async function executarPagamentoSimuladoAssinaturaAdmin"]
]) {
  const bloco = trechoEntre(`async function ${nome}`, fim);
  assert.match(bloco, /\.\.\.transicaoCadastroCreditosUniversal\(\)/,
    `${nome} deve usar a transição financeira UNIVERSAL`);
}

const rotaAdmin = trechoEntre(
  'app.post("/admin/usuarios"',
  'app.put("/admin/usuarios/:id"'
);
assert.match(rotaAdmin, /transicaoCadastroCreditosUniversal\(\)/);
assert.match(rotaAdmin, /antesDePersistir/);
assert.match(rotaAdmin, /depoisDePersistir/);

console.log("novos-cadastros-universal-focal.test.cjs OK");
