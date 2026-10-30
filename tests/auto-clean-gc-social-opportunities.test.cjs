"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { buildOrLoadReferenceIndex } = require("../modules/engine/auto-clean/gc-reference-index-builder");
const { inventariarReferenciasVivas, REFERENCE_REASON } = require("../modules/engine/auto-clean/gc-reference-index");

const NOW = Date.parse("2026-10-30T12:00:00.000Z");
const HASH = "a".repeat(64);
const WORKSPACE = "user_gc_social";
const render = workspace => `https://go.optimuspromo.com.br/identidade-visual-ofertas/public/clientes/${workspace}/renderizados/${HASH}.png`;

async function verify(dataDir, expectedComplete, expectedHash, expectedReason) {
  const indexed = await buildOrLoadReferenceIndex({ dataDir, workspaceId: WORKSPACE, nowMs: NOW,
    logger: { log() {} } });
  const legacy = await inventariarReferenciasVivas({ dataDir, workspaceId: WORKSPACE, nowMs: NOW });
  assert.equal(indexed.complete, expectedComplete);
  assert.equal(legacy.complete, expectedComplete);
  if (expectedComplete) {
    assert.equal(indexed.refs.has(HASH), expectedHash);
    assert.equal(legacy.refs.has(HASH), expectedHash);
  } else {
    assert.equal(indexed.reasonCode, expectedReason);
    assert.equal(legacy.reasonCode, expectedReason);
  }
}

async function scenario(value, expectedComplete, expectedHash, expectedReason, shared = false) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-gc-social-"));
  try {
    const root = path.join(dataDir, "clientes", WORKSPACE);
    fs.mkdirSync(root, { recursive: true });
    if (value !== undefined) fs.writeFileSync(path.join(root, "social-oportunidades.json"), JSON.stringify(value));
    if (shared) fs.writeFileSync(path.join(root, "social-rascunhos.json"), JSON.stringify([{ imagem: render(WORKSPACE) }]));
    await verify(dataDir, expectedComplete, expectedHash, expectedReason);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

async function main() {
  await scenario(undefined, true, false); // fonte ausente
  await scenario({ clienteId: WORKSPACE, ocultas: { oferta: { imagem: render(WORKSPACE) } },
    atualizadoEm: new Date(NOW).toISOString() }, true, true); // fonte oficial
  await scenario({ clienteId: WORKSPACE, ocultas: {}, atualizadoEm: "" }, true, true,
    undefined, true); // referência compartilhada por outra fonte
  await scenario({ clienteId: "outro_tenant", ocultas: {}, atualizadoEm: "" }, false, false,
    REFERENCE_REASON.FORMAT_INVALID); // nunca atravessar workspace
  await scenario({ clienteId: WORKSPACE, ocultas: [], atualizadoEm: "" }, false, false,
    REFERENCE_REASON.FORMAT_INVALID); // formato inválido falha fechado
  await scenario([{ imagem: render(WORKSPACE) }], true, true); // legado preservado
  console.log("AUTO_CLEAN_GC_SOCIAL_OPPORTUNITIES_PASS");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
