#!/usr/bin/env node
"use strict";

const { executarResetEsteirasCli } = require("../modules/engine/reset-esteiras");

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
    operationStartedAt: opcoes.operationStartedAt || "",
    dataDir: opcoes.dataDir || ""
  };
}

function resumirResultadoCli(resultado = {}) {
  if (!resultado || typeof resultado !== "object") return resultado;
  if (resultado.modo === "dry-run") return resultado;
  if (resultado.modo === "execute") {
    return {
      ok: resultado.ok,
      modo: resultado.modo,
      operationId: resultado.operationId,
      lotesProcessados: resultado.lotesProcessados,
      removidos: resultado.removidos,
      pulados: resultado.pulados,
      aplicouMudancasOperacionais: resultado.aplicouMudancasOperacionais,
      resultados: (resultado.resultados || []).map(item => ({
        workspaceId: item.workspaceId,
        lote: item.lote,
        antes: item.antes,
        depois: item.depois,
        removidos: Array.isArray(item.removidos) ? item.removidos.length : 0,
        pulados: Array.isArray(item.pulados) ? item.pulados.length : 0
      }))
    };
  }
  if (resultado.modo === "rollback") {
    return {
      ok: resultado.ok,
      modo: resultado.modo,
      operationId: resultado.operationId,
      restaurados: resultado.restaurados,
      pulados: resultado.pulados,
      resultados: (resultado.resultados || []).map(item => ({
        workspaceId: item.workspaceId,
        restaurados: item.restaurados,
        pulados: item.pulados
      }))
    };
  }
  return resultado;
}

async function main() {
  const opcoes = parseArgs(process.argv.slice(2));
  const resultado = await executarResetEsteirasCli(opcoes);
  console.log(JSON.stringify(resumirResultadoCli(resultado), null, 2));
}

main().catch((erro) => {
  console.error(JSON.stringify({
    ok: false,
    erro: erro.message,
    codigo: erro.codigo || "erro"
  }, null, 2));
  process.exit(1);
});
