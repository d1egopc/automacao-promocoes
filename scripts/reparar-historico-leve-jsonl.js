#!/usr/bin/env node
"use strict";

const { repararHistoricoLeveJsonl } = require("./reparar-historico-leve-jsonl-core");

function parseArgs(argv = process.argv.slice(2)) {
  const opcoes = { clientes: [], arquivos: [], apply: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--apply") {
      opcoes.apply = true;
      continue;
    }
    if (arg === "--dry-run") {
      opcoes.apply = false;
      continue;
    }
    if (arg === "--data-dir") {
      opcoes.dataDir = argv[++i];
      continue;
    }
    if (arg.startsWith("--data-dir=")) {
      opcoes.dataDir = arg.slice("--data-dir=".length);
      continue;
    }
    if (arg === "--cliente") {
      opcoes.clientes.push(argv[++i]);
      continue;
    }
    if (arg.startsWith("--cliente=")) {
      opcoes.clientes.push(arg.slice("--cliente=".length));
      continue;
    }
    if (arg === "--arquivo") {
      opcoes.arquivos.push(argv[++i]);
      continue;
    }
    if (arg.startsWith("--arquivo=")) {
      opcoes.arquivos.push(arg.slice("--arquivo=".length));
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      opcoes.help = true;
      continue;
    }
    throw new Error(`argumento_desconhecido:${arg}`);
  }
  return opcoes;
}

function ajuda() {
  return [
    "Uso:",
    "  node scripts/reparar-historico-leve-jsonl.js --data-dir /data",
    "  node scripts/reparar-historico-leve-jsonl.js --data-dir /data --cliente user_pss60lus --arquivo 2026-09-15",
    "  node scripts/reparar-historico-leve-jsonl.js --data-dir /data --apply",
    "",
    "Dry-run e o default. --apply e obrigatorio para escrever.",
    "Alvos default: user_zbbk3fdr 2026-09-07/08 e user_pss60lus 2026-09-15.",
    "Nao le fila-historico.json, fila.json, fila-viva.json nem projecao leve."
  ].join("\n");
}

function main() {
  try {
    const opcoes = parseArgs();
    if (opcoes.help) {
      console.log(ajuda());
      return;
    }
    const resultado = repararHistoricoLeveJsonl(opcoes);
    console.log(JSON.stringify(resultado, null, 2));
    if (!resultado.ok) process.exitCode = 1;
  } catch (erro) {
    console.error(JSON.stringify({ ok: false, erro: erro?.message || "erro_reparo_historico_leve_jsonl" }, null, 2));
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { parseArgs, ajuda };
