"use strict";

// CI-only regression evidence. A missing dependency/environment is BLOCKED;
// baseline debt requires the same assertion and first test location, not just exit 1.
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const baseline = path.resolve(process.argv[2] || "");
if (!process.argv[2] || !fs.existsSync(path.join(baseline, "index.js"))) throw Error("EXACT_BASELINE_REQUIRED");
const suites = ["admin-link-discovery-v23.test.cjs", "links-v23-layered-resolution.test.cjs", "links-v23-real-resolution-manifest.test.cjs", "dynamic-link-resolvers.test.js",
  "safe-redirect-http-lifecycle.test.js", "redirect-resolver-shortlinks-seguros.test.js",
  "amazon-rio-captcha-guard.test.js",
  "engine-v2-marketplaces-fidelidade.test.js", "link-conversao-ocorrencia-marketplaces.test.js",
  "contrato-comercial-final-universal.test.js", "imagem-link-contrato-universal.test.js",
  "template-universal-visual-contract.test.js", "categorias-reducao-diversos.test.js",
  "mercadolivre-identidade-canonica.test.js", "mercadolivre-imagem-oficial-fallback.test.js",
  "mercadolivre-work-backend-order.test.js", "manual-v2-import-mercadolivre.test.js",
  "amazon-shortlink-afiliacao.test.js", "manual-v2-import-amazon.test.js",
  "shopee-resgate-ocorrencias.test.js", "shopee-rio-titulo-beneficio.test.js",
  "shopee-afiliacao-workspace.test.js", "manual-v2-import-shopee.test.js",
  "aliexpress-app-moedas-contrato.test.js", "aliexpress-moedas-productdetail-engine.test.js",
  "aliexpress-afiliacao-workspace.test.js", "manual-v2-import-aliexpress.test.js",
  "magalu-v2-golden-path.test.js", "magalu-identity-engine-importer.test.js", "magalu-image-resolver.test.js",
  "manual-v2-import-magalu.test.js", "magalu-local-worker-identity.test.js",
  "kabum-hotfix.test.js", "destinos-compatibilidade-kabum-awin.test.js", "manual-v2-import-kabum.test.js",
  "optimus-capture-extension.test.js", "optimus-capture-local-worker-ml-image.test.js",
  "optimus-capture-magalu.test.js", "optimus-capture-launcher.test.js"];
function environmentBlocked(result, output) {
  if (result.error || !Number.isInteger(result.status)) return true;
  if (result.status === 0 || /AssertionError/.test(output)) return false;
  return /Error: Cannot find module|Error[^\n]*(?:EACCES|EPERM|ENOENT)|command not found/.test(output);
}
assert.equal(environmentBlocked({ status: 0 }, "expected fixture ENOENT MODULE_NOT_FOUND"), false);
assert.equal(environmentBlocked({ status: 1 }, "Error: Cannot find module 'fixture'"), true);
assert.equal(environmentBlocked({ status: 1 }, "expected fixture ENOENT\nAssertionError [ERR_ASSERTION]"), false);
function execute(cwd, file) {
  const r = spawnSync(process.execPath, ["tests/" + file], { cwd, encoding: "utf8", timeout: 90000,
    maxBuffer: 8 * 1024 * 1024, env: { ...process.env, NODE_PATH: path.join(root, "node_modules") } });
  const output = String(r.stdout || "") + String(r.stderr || "");
  const blocked = environmentBlocked(r, output);
  const assertion = output.match(/AssertionError[^\n]*\n[\s\S]*?(?=\n\s+at )/)?.[0]?.trim() || "";
  const location = output.match(/tests[\\/]([^\s()]+:\d+:\d+)/)?.[1] || "";
  return { exit: r.status, blocked: Boolean(blocked), assertion, location };
}
const rows = [];
for (const file of suites) {
  const current = execute(root, file);
  let status = current.blocked ? "BLOCKED" : current.exit === 0 ? "PASS" : "FAIL";
  let previous = null;
  if (status === "FAIL" && fs.existsSync(path.join(baseline, "tests", file))) {
    previous = execute(baseline, file);
    if (previous.blocked) status = "BLOCKED";
    else if (previous.exit !== 0 && current.assertion && current.location &&
        current.assertion === previous.assertion && current.location === previous.location) status = "BASELINE_DEBT";
  }
  rows.push({ file, status, exitCode: current.exit, baselineExitCode: previous?.exit ?? null,
    failureStage: status === "PASS" ? null : current.location || "environment_or_process",
    cause: status === "PASS" ? null : current.assertion || "environment_or_process_failure" });
}
console.log(JSON.stringify({ node: process.version, baseline, results: rows }, null, 2));
if (rows.some(row => ["FAIL", "BLOCKED"].includes(row.status))) process.exitCode = 1;
