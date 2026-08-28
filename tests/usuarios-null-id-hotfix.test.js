"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const fonteIndex = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
const match = fonteIndex.match(/function buscarUsuarioPorIdSeguro[\s\S]*?\n}/);

assert(match, "helper buscarUsuarioPorIdSeguro deve existir");

const buscarUsuarioPorIdSeguro = vm.runInNewContext(`(${match[0]})`);

{
  const usuarioValido = { id: "user_valido", ativo: true };
  const outroUsuario = { id: "user_outro", ativo: true };
  const usuarios = [usuarioValido, null, undefined, outroUsuario];

  assert.doesNotThrow(() => buscarUsuarioPorIdSeguro(usuarios, "user_valido"));
  assert.strictEqual(buscarUsuarioPorIdSeguro(usuarios, "user_valido"), usuarioValido);
}

{
  const usuarios = [null, undefined, { id: "user_existente" }];

  assert.doesNotThrow(() => buscarUsuarioPorIdSeguro(usuarios, "user_inexistente"));
  assert.strictEqual(buscarUsuarioPorIdSeguro(usuarios, "user_inexistente"), null);
}

{
  const inicioProcessarFila = fonteIndex.indexOf("async function processarFila");
  const fimProcessarFila = fonteIndex.indexOf("@whiskeysockets/baileys", inicioProcessarFila);
  const trechoProcessarFila = fonteIndex.slice(
    inicioProcessarFila,
    fimProcessarFila > inicioProcessarFila ? fimProcessarFila : fonteIndex.length
  );

  assert(!trechoProcessarFila.includes("String(u.id)"), "processarFila nao deve acessar u.id sem guarda");
  assert(trechoProcessarFila.includes("fase: \"inicio\""), "resumo do executor deve carregar fase inicial");
  assert(trechoProcessarFila.includes("resumoFila.fase = \"selecionar_oferta\""), "executor deve registrar fase de selecao");
}

console.log("usuarios-null-id-hotfix.test.js OK");
