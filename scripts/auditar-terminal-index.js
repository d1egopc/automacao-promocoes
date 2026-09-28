"use strict";

// Read-only, standalone audit. It deliberately does not call the Shadow
// validator or the Persistence Worker; only the canonical identity/status
// helpers are shared with the production model.
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { normalizarEntradasViva, identidadePrimariaExataFilaV2, rankStatusFilaV2 } = require("../modules/fila/fila-operacional-v2");

const DATA_DIR = process.env.DATA_DIR || "/data";

function argumento(nome, padrao = "") {
  const indice = process.argv.indexOf(nome);
  return indice >= 0 ? String(process.argv[indice + 1] || padrao) : padrao;
}

function clienteSeguro(valor) {
  const cliente = String(valor || "").trim();
  if (!/^[A-Za-z0-9._-]{1,160}$/.test(cliente)) throw new Error("workspace_invalido");
  return cliente;
}

function hash(valor) {
  return crypto.createHash("sha256").update(String(valor)).digest("hex").slice(0, 12);
}

function caminhos(dataDir, cliente) {
  const raiz = path.resolve(dataDir);
  const clientes = path.resolve(raiz, "clientes");
  const diretorio = path.resolve(clientes, cliente);
  if (!diretorio.startsWith(`${clientes}${path.sep}`)) throw new Error("workspace_path_invalido");
  return {
    diretorio,
    legacy: path.join(diretorio, "fila-historico.json"),
    incremental: path.join(diretorio, "fila-historico-incremental"),
    index: path.join(diretorio, "fila-terminal-index.json"),
    proof: path.join(diretorio, "fila-terminal-index.proof.json")
  };
}

function adicionar(map, item, origem, agoraMs, contadores) {
  const bruto = item?.item && typeof item.item === "object" ? item.item : item;
  const entrada = normalizarEntradasViva([bruto], agoraMs)[0];
  if (!entrada || entrada.bucket !== "historico") return;
  const identidade = identidadePrimariaExataFilaV2(bruto);
  if (!identidade) return;
  const status = String(entrada.status || bruto?.status || bruto?.estado || "").trim().toLowerCase();
  const atual = map.get(identidade);
  contadores.records += 1;
  if (!atual) {
    map.set(identidade, { status, origem });
    if (status === "retida") contadores.retida += 1;
    return;
  }
  contadores.duplicados += 1;
  if (rankStatusFilaV2(status) > rankStatusFilaV2(atual.status)) {
    if (atual.status === "retida") contadores.retida = Math.max(0, contadores.retida - 1);
    atual.status = status;
    if (status === "retida") contadores.retida += 1;
  }
}

async function auditar(clienteId, dataDir) {
  const p = caminhos(dataDir, clienteId);
  const agoraMs = Date.now();
  const auditados = new Map();
  const contadores = { records: 0, duplicados: 0, retida: 0, legacyRecords: 0, incrementalRecords: 0 };

  if (fs.existsSync(p.legacy)) {
    const { lerArrayJsonIncremental } = require("../modules/fila/json-array-incremental");
    const fd = fs.openSync(p.legacy, "r");
    try {
      lerArrayJsonIncremental(fd, {
        onItem: item => {
          contadores.legacyRecords += 1;
          adicionar(auditados, item, "legacy", agoraMs, contadores);
        }
      });
    } finally {
      fs.closeSync(fd);
    }
  }

  const arquivos = fs.existsSync(p.incremental)
    ? fs.readdirSync(p.incremental).filter(nome => nome.endsWith(".jsonl")).sort()
    : [];
  for (const nome of arquivos) {
    const stream = fs.createReadStream(path.join(p.incremental, nome), { encoding: "utf8" });
    const linhas = readline.createInterface({ input: stream, crlfDelay: Infinity });
    try {
      for await (const linha of linhas) {
        if (!linha.trim()) continue;
        const registro = JSON.parse(linha);
        contadores.incrementalRecords += 1;
        adicionar(auditados, registro, "incremental", agoraMs, contadores);
      }
    } finally {
      linhas.close();
      stream.destroy();
    }
  }

  let indice = null;
  let proof = null;
  try { indice = JSON.parse(fs.readFileSync(p.index, "utf8")); } catch {}
  try { proof = JSON.parse(fs.readFileSync(p.proof, "utf8")); } catch {}
  const indexed = new Map(Object.entries(indice?.entries || {}).map(([identity, value]) => [identity, {
    status: Array.isArray(value) ? String(value[0] || "").toLowerCase() : "",
    sourceMask: Array.isArray(value) ? value[1] : null
  }]));
  const missing = [];
  const extra = [];
  const statusMismatch = [];
  for (const [identity, valor] of auditados) {
    if (!indexed.has(identity)) missing.push(identity);
    else if (indexed.get(identity).status !== valor.status) statusMismatch.push(identity);
  }
  for (const identity of indexed.keys()) if (!auditados.has(identity)) extra.push(identity);
  const divergencias = [...missing, ...extra, ...statusMismatch];
  const resultado = {
    ok: divergencias.length === 0 && indexed.size === auditados.size,
    workspaceKey: hash(clienteId),
    source: {
      legacyBytes: fs.existsSync(p.legacy) ? fs.statSync(p.legacy).size : 0,
      incrementalFiles: arquivos.length,
      indexBytes: fs.existsSync(p.index) ? fs.statSync(p.index).size : 0,
      proofBytes: fs.existsSync(p.proof) ? fs.statSync(p.proof).size : 0
    },
    records: contadores.records,
    legacyTerminals: contadores.legacyRecords,
    incrementalTerminals: contadores.incrementalRecords,
    legacyRecords: contadores.legacyRecords,
    incrementalRecords: contadores.incrementalRecords,
    unionIdentities: auditados.size,
    indexed: indexed.size,
    duplicateRecords: contadores.duplicados,
    retida: contadores.retida,
    missing: missing.length,
    extra: extra.length,
    statusMismatch: statusMismatch.length,
    concordancePercent: auditados.size === 0 ? 100 : Math.round(((auditados.size - divergencias.length) / auditados.size) * 10000) / 100,
    sourceRevision: proof?.sourceRevision || null,
    generation: indice?.generation ?? null,
    proofComplete: proof?.complete === true,
    proofAuthorityEligible: proof?.authorityEligible ?? null,
    divergentIdentityHashes: divergencias.slice(0, 20).map(hash)
  };
  process.stdout.write(`${JSON.stringify(resultado)}\n`);
  return resultado;
}

async function main() {
  const cliente = clienteSeguro(argumento("--workspace"));
  const dataDir = argumento("--data-dir", DATA_DIR);
  const resultado = await auditar(cliente, dataDir);
  process.exitCode = resultado.ok ? 0 : 2;
}

main().catch(erro => {
  process.stderr.write(`${JSON.stringify({ ok: false, motivo: erro?.message || "auditoria_falhou" })}\n`);
  process.exitCode = 1;
});
