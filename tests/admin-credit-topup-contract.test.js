"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const index = fs.readFileSync(path.join(root, "index.js"), "utf8");
const repository = fs.readFileSync(path.join(root, "modules", "engine",
  "universal-credits.repository.js"), "utf8");

assert.match(index, /app\.put\("\/admin\/usuarios\/:id"/,
  "ajuste absoluto existente deve permanecer");
assert.match(index, /app\.post\("\/admin\/usuarios\/:id\/creditos\/topup"/,
  "recarga aditiva deve possuir endpoint separado");
assert.match(index, /body\.quantidade/,
  "recarga aditiva deve usar quantidade explícita");
assert.match(index, /idempotencyKey/,
  "recarga aditiva deve exigir idempotência");
assert.match(index, /adicionarSaldoAdminUniversal/,
  "rota deve usar o repository Universal aditivo");
assert.match(repository, /SELECT balance,reserved,revision[\s\S]*?FOR UPDATE/,
  "o repository deve bloquear a linha de saldo com reserved preservado");
assert.match(repository, /const current = Number\(balance\.balance\);\s*const next = current \+ delta/,
  "o repository deve calcular recarga como incremento");
assert.match(repository, /SET balance=\$3,revision=\$4/,
  "o repository deve alterar balance e revision sem alterar reserved");
assert.match(repository, /balance_policy[\s\S]*?'add'/,
  "o movimento aditivo deve ser registrado como add");
assert.match(repository, /universal_movement_type[\s\S]*?\x27FINANCIAL_MOVEMENT\x27/,
  "o movimento deve permanecer compatível com o ledger Universal");
assert.match(repository, /universal_admin_credit_holds_open/,
  "o ajuste absoluto deve manter o guard de holds");

console.log("admin-credit-topup-contract.test.js OK");
