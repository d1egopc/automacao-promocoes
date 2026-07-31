#!/usr/bin/env node
"use strict";

const { executarResetOperacionalCli } = require("../modules/engine/reset-operacional");

function parseArgs(argv = []) {
  const opcoes = {};
  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;
    const [chave, ...partesValor] = arg.slice(2).split("=");
    const valor = partesValor.length ? partesValor.join("=") : "true";
    const chaveNormalizada = chave.replace(/-([a-z])/g, (_, letra) => letra.toUpperCase());
    opcoes[chaveNormalizada] = valor;
  }

  return {
    mode: opcoes.mode || "",
    operationId: opcoes.operationId || "",
    confirmOperationId: opcoes.confirmOperationId || "",
    loteTamanho: opcoes.loteTamanho || opcoes.batchSize || "",
    maxLotes: opcoes.maxLotes || "",
    cutoffCongelado: opcoes.cutoffCongelado || "",
    operationStartedAt: opcoes.operationStartedAt || ""
  };
}

async function main() {
  const opcoes = parseArgs(process.argv.slice(2));
  const resultado = await executarResetOperacionalCli(opcoes);
  console.log(JSON.stringify(resultado, null, 2));
}

main().catch((erro) => {
  console.error(JSON.stringify({
    ok: false,
    erro: erro.message,
    codigo: erro.codigo || "erro"
  }, null, 2));
  process.exit(1);
});
