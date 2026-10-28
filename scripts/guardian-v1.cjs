#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const crypto = require("node:crypto");

const SHA_RE = /^[0-9a-f]{40}$/;
const SAFE_PATH_RE = /^[A-Za-z0-9._/-]+$/;
const WINDOWS_BACKEND = "C:\\Users\\Liva D1EGOPC\\Documents\\BACKEND-OFICIAL-2026";

const NON_RUNTIME_EXACT = new Set([
  "AGENTS.md",
  "scripts/deploy-backend-vps-manual.sh",
  "scripts/guardian-v1.cjs",
  "scripts/benchmark-gerente-observability-v2.cjs",
  // Artefatos da extensão: testados no CI, nunca transportados no overlay Docker.
  "optimus-capture/adapters/magalu.js",
  "optimus-capture/local-worker/magalu-identity.js"
]);
const NON_RUNTIME_PREFIXES = ["docs/", "tests/", ".github/"];
const RUNTIME_ROOTS = new Set([
  "modules", "utils", "marketplaces", "templates", "bootstrap", "campanhas", "assets"
]);
const FULL_BUILD_PATHS = new Set(["Dockerfile", ".dockerignore", "package.json", "package-lock.json"]);
// One reviewed dependency repair, never a general RUN/npm/build exception.
const BAILEYS_BUFFER_PROFILE = {
  "baseSha": "f50e8a294f839249e5427619e500e37332423363",
  "hotfixSha": "83b9f556a069b728650afcfc8c3d765618207369",
  "runtimeHashes": {
    "index.js": "a7c575ade563e93c41b49c7abbcd4c7527f0773f0a3946d4c83f47ab2bc6a469",
    "modules/whatsapp/baileys-buffer-hotfix.service.js": "0c2df86656ea45707a3fffe94e581aabdfd84b8901335f1eafd3c093802d37ac",
    "modules/whatsapp/baileys-buffer-recovery.service.js": "bfe0f1178b379186f149cded8c1f1f9ad3e7e174d85a49328f02ae6ccb9d3bc0"
  },
  "unchangedBuildHashes": {
    "Dockerfile": "d65f01c5c989274571ef8689c04b90900adb65db76be5ce1e7251a78116ed413",
    "scripts/apply-baileys-retry-hotfix.cjs": "110f9a3be98132f472a5e2e6c91291661daabd2f6b71792bddc62ce796a8e874",
    "package.json": "652ac4577ceea12b785a0ab2cd78058dcc6978d9e7f7063aa84498acbcfcec9b",
    "package-lock.json": "1b61cdd9a6538e2c0650c5c92382ff551febf84cf58d2d3450c0eb3ec661dbca",
    ".dockerignore": "93375c6a4e819eacf9abc319c4194b88ffddb798606aafecddec9cffb4eca36a"
  },
  "dependencies": {
    "lib/Socket/socket.js": {
      "before": "2d16ab13464a155a3441f497ae7625d1760a0654659ae422a361e0c99fb1cc0c",
      "after": "b0b8d041b930c4f0264766e8de06ffce78398ecb4d27ef58482de75484f23443"
    },
    "lib/Socket/messages-recv.js": {
      "before": "2a754ae09c8ad053486ae3b9743db6868e60f2e77e8fa695c4138e9667a76dd5",
      "after": "2dd660356f4f469a6dfe1be895720acbf3f02794c5273bb83c1a867c409ab299"
    },
    "lib/Socket/chats.js": {
      "before": "9eef48356529d9078e0a09ae94d443e29c2795a0c86c64f3d47580994884add4",
      "after": "30457f342ac27afa8a211cbfddd1bd428b00a41175acf187aaff7ab8d376d776"
    }
  }
};

function contentHash(repo, sha, file) {
  // index.js exceeds spawnSync's default 1 MiB buffer. Hash bounded binary
  // bytes, not truncated/decoded output; an incomplete read fails closed.
  const result = spawnSync("git", ["-C", repo, "show", `${sha}:${file}`], {
    encoding: null, windowsHide: true, timeout: 15000, maxBuffer: 4 * 1024 * 1024
  });
  if (result.error || result.status !== 0) throw new Error("hotfix_content_unreadable");
  return crypto.createHash("sha256").update(result.stdout).digest("hex");
}

function validateBufferProfile(repo, base, source, runtimeFiles) {
  const p = BAILEYS_BUFFER_PROFILE, failures = [];
  const reject = (file, cause) => failures.push({ file, stage: "baileys_buffer_profile", cause });
  if (base !== p.baseSha) reject("BASE_SHA", "unapproved_hotfix_base");
  if (git(repo, ["merge-base", "--is-ancestor", p.hotfixSha, source], { allowFailure: true }).status !== 0)
    reject("SOURCE_SHA", "hotfix_ancestry_required");
  if (JSON.stringify(runtimeFiles.slice().sort()) !== JSON.stringify(Object.keys(p.runtimeHashes).sort()))
    reject("runtime_files", "exact_hotfix_runtime_set_required");
  for (const [file, hash] of Object.entries({ ...p.runtimeHashes, ...p.unchangedBuildHashes })) {
    try {
      if (contentHash(repo, source, file) !== hash) reject(file, "unapproved_hotfix_content");
    } catch { reject(file, "unapproved_hotfix_content"); }
  }
  return failures;
}

function renderDockerfile(plan, baseTag) {
  if (plan.validation !== "PASS" || plan.blocked.length ||
      !/^local\/optimus-deploy-base:[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(baseTag))
    throw new Error("unapproved_image_build");
  if (!["overlay", "baileys_buffer_patch"].includes(plan.deployMode)) throw new Error("unapproved_build_mode");
  const special = plan.deployMode === "baileys_buffer_patch";
  if (special && (plan.baseSha !== BAILEYS_BUFFER_PROFILE.baseSha ||
      JSON.stringify(plan.runtimeFiles) !== JSON.stringify(Object.keys(BAILEYS_BUFFER_PROFILE.runtimeHashes).sort())))
    throw new Error("exact_hotfix_runtime_set_required");
  if (!special && plan.runtimeFiles.includes("modules/whatsapp/baileys-buffer-hotfix.service.js"))
    throw new Error("dependency_patch_mode_required");
  return [`FROM ${baseTag}`, "USER root",
    ...plan.runtimeFiles.map(file => `COPY --chown=node:node ${normalizeRuntimePath(file)} /app/${normalizeRuntimePath(file)}`),
    ...(special ? ["RUN node -e \"require('/app/modules/whatsapp/baileys-buffer-hotfix.service.js').applyPatch({rootDir:'/app'})\""] : []),
    "USER node", ""].join("\n");
}

function parseArgs(argv) {
  const result = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) {
      result._.push(value);
      continue;
    }
    const key = value.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      result[key] = next;
      index += 1;
    } else {
      result[key] = true;
    }
  }
  return result;
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env || process.env,
    encoding: "utf8",
    windowsHide: true,
    timeout: options.timeout || 10 * 60 * 1000
  });
}

function commandText(result) {
  return `${result.stdout || ""}${result.stderr || ""}`.trim();
}

function git(repo, args, { allowFailure = false } = {}) {
  const result = run("git", ["-C", repo, ...args]);
  if (!allowFailure && result.status !== 0) {
    throw new Error(`git_${args[0]}_failed:${commandText(result).split(/\r?\n/).slice(-1)[0] || result.status}`);
  }
  return result;
}

function resolveRepo(explicit = "") {
  const candidates = [];
  if (explicit) candidates.push(path.resolve(explicit));
  if (process.env.OPTIMUS_BACKEND_ROOT) candidates.push(path.resolve(process.env.OPTIMUS_BACKEND_ROOT));
  candidates.push(process.cwd());
  if (process.platform === "win32") candidates.push(WINDOWS_BACKEND);
  for (const candidate of [...new Set(candidates)]) {
    const result = run("git", ["-C", candidate, "rev-parse", "--show-toplevel"]);
    if (result.status === 0) return result.stdout.trim();
  }
  throw new Error("backend_repository_not_found");
}

function toolState(name, args = ["--version"]) {
  if (process.platform === "win32" && name !== process.execPath) {
    const located = run("where.exe", [name], { timeout: 5000 });
    return located.status === 0 ? "PASS" : "BLOCKED";
  }
  const result = run(resolveCommand(name), args, { timeout: 15000 });
  return result.status === 0 ? "PASS" : "BLOCKED";
}

function resolveCommand(name) {
  if (process.platform !== "win32") return name;
  const located = run("where.exe", [name], { timeout: 5000 });
  const options = located.status === 0 ? located.stdout.split(/\r?\n/).filter(Boolean) : [];
  const first = options.find(value => /\.(?:cmd|exe)$/i.test(value)) || options[0] || "";
  return first || name;
}

function normalizeRuntimePath(value) {
  const normalized = String(value || "").replaceAll("\\", "/");
  const segments = normalized.split("/");
  if (!normalized || !SAFE_PATH_RE.test(normalized) || normalized.startsWith("/") ||
      segments.includes(".") || segments.includes("..") || normalized.includes("//")) {
    throw new Error(`unsafe_path:${normalized || "<empty>"}`);
  }
  return normalized;
}

function isNonRuntime(file) {
  return NON_RUNTIME_EXACT.has(file) || NON_RUNTIME_PREFIXES.some(prefix => file.startsWith(prefix));
}

function isOverlayRuntime(file) {
  if (file === "index.js") return true;
  const root = file.split("/", 1)[0];
  return RUNTIME_ROOTS.has(root) && file.includes("/");
}

function parseDiff(repo, base, source) {
  if (!SHA_RE.test(base) || !SHA_RE.test(source)) throw new Error("invalid_sha");
  git(repo, ["cat-file", "-e", `${base}^{commit}`]);
  git(repo, ["cat-file", "-e", `${source}^{commit}`]);
  git(repo, ["merge-base", "--is-ancestor", base, source]);
  git(repo, ["diff", "--check", base, source]);
  const raw = git(repo, ["diff", "--name-status", "--no-renames", base, source]).stdout.trim();
  if (!raw) return [];
  return raw.split(/\r?\n/).map(line => {
    const [status, rawFile, ...extra] = line.split("\t");
    if (!status || !rawFile || extra.length) throw new Error(`unparseable_diff:${line}`);
    return { status, file: normalizeRuntimePath(rawFile) };
  });
}

function buildPlan(repo, base, source) {
  const head = git(repo, ["rev-parse", "HEAD"]).stdout.trim();
  if (head !== source) throw new Error(`source_checkout_mismatch:${head}`);
  const dirt = git(repo, ["status", "--porcelain=v1"]).stdout.trim();
  if (dirt) throw new Error("source_checkout_not_clean");
  const changes = parseDiff(repo, base, source);
  const runtimeFiles = [];
  const ignoredFiles = [];
  const blocked = [];
  for (const change of changes) {
    const { status, file } = change;
    if (status === "D") {
      blocked.push({ file, stage: "classify", cause: "deleted_file_not_supported" });
      continue;
    }
    if (status !== "A" && status !== "M") {
      blocked.push({ file, stage: "classify", cause: `unsupported_change_type:${status}` });
      continue;
    }
    if (isNonRuntime(file)) {
      ignoredFiles.push(file);
      continue;
    }
    if (FULL_BUILD_PATHS.has(file)) {
      blocked.push({ file, stage: "classify", cause: "full_image_build_not_supported_by_guardian_v1" });
      continue;
    }
    if (!isOverlayRuntime(file)) {
      blocked.push({ file, stage: "classify", cause: "unknown_or_disallowed_runtime_path" });
      continue;
    }
    const absolute = path.resolve(repo, ...file.split("/"));
    const relative = path.relative(repo, absolute);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      blocked.push({ file, stage: "classify", cause: "path_escape" });
      continue;
    }
    let stat;
    try { stat = fs.lstatSync(absolute); } catch {
      blocked.push({ file, stage: "classify", cause: "candidate_file_missing" });
      continue;
    }
    if (!stat.isFile() || stat.isSymbolicLink()) {
      blocked.push({ file, stage: "classify", cause: "candidate_not_regular_file" });
      continue;
    }
    runtimeFiles.push(file);
  }
  runtimeFiles.sort();
  const bufferProfile = changes.some(change => change.file === "modules/whatsapp/baileys-buffer-hotfix.service.js");
  if (bufferProfile) blocked.push(...validateBufferProfile(repo, base, source, runtimeFiles));
  ignoredFiles.sort();
  blocked.sort((a, b) => a.file.localeCompare(b.file));
  return {
    sourceSha: source,
    baseSha: base,
    validation: blocked.length ? "BLOCKED" : "PASS",
    deployMode: bufferProfile ? "baileys_buffer_patch" : runtimeFiles.length ? "overlay" : "none",
    runtimeFiles,
    ignoredFiles,
    blocked
  };
}

function bashCommand() {
  if (process.platform !== "win32") return "bash";
  const candidate = "C:\\Program Files\\Git\\bin\\bash.exe";
  return fs.existsSync(candidate) ? candidate : "bash";
}

function testMatrix(plan) {
  const specs = new Map();
  const add = (id, file, command, args, compareBaseline = true, requiresBash = false) =>
    specs.set(id, { id, file, command, args, compareBaseline, requiresBash });
  add("syntax:index", "index.js", process.execPath, ["--check", "index.js"]);
  add("encoding", "scripts/audit-encoding.cjs", process.execPath, ["scripts/audit-encoding.cjs"]);
  // Permanent release/CI gates only. Never imported by a commercial motor.
  add("telemetria:contrato-permanente", "tests/telemetria-permanent-contract.test.cjs", process.execPath,
    ["--test", "tests/telemetria-permanent-contract.test.cjs"], false);
  add("telemetria:autorizacao-readonly", "tests/telemetria-operacional.test.cjs", process.execPath,
    ["--test", "tests/telemetria-operacional.test.cjs", "tests/telemetria-prepared-input.test.cjs"], false);

  if (plan.runtimeFiles.length) {
    add("contract:rio", "tests/universal-flow-queue-executor.test.js", process.execPath, ["tests/universal-flow-queue-executor.test.js"]);
    add("contract:radar", "tests/radar-cobertura-v1.test.js", process.execPath, ["tests/radar-cobertura-v1.test.js"]);
    add("contract:teleradar", "tests/teleradar-handoff.test.js", process.execPath, ["tests/teleradar-handoff.test.js"]);
    add("contract:clonador", "tests/clonador-grupos-foundation.test.js", process.execPath, ["tests/clonador-grupos-foundation.test.js"]);
    add("contract:fila-viva", "tests/fila-viva-runtime-wiring.test.js", process.execPath, ["tests/fila-viva-runtime-wiring.test.js"]);
  }
  if (plan.runtimeFiles.some(file => file === "index.js" || file.startsWith("modules/mensageiro"))) {
    add("mensageiro:gerente", "tests/mensageiro-gerente-grupo.test.cjs", process.execPath, ["tests/mensageiro-gerente-grupo.test.cjs"]);
    add("mensageiro:comandos", "tests/mensageiro-bot-comandos.test.cjs", process.execPath, ["tests/mensageiro-bot-comandos.test.cjs"]);
    add("mensageiro:programadas", "tests/mensageiro-programacoes.test.cjs", process.execPath, ["tests/mensageiro-programacoes.test.cjs"]);
  }
  if (plan.runtimeFiles.some(file => file.startsWith("modules/engine") || file.startsWith("modules/executor") || file.startsWith("modules/fila"))) {
    add("engine:claim-recovery", "tests/engine-validator-claim-recovery.test.js", process.execPath, ["tests/engine-validator-claim-recovery.test.js"]);
  }
  if (plan.runtimeFiles.some(file => file.includes("classificador-categorias") || file.startsWith("modules/inteligencia-universal/") || file === "marketplaces/aliexpress/importar.js" || file.includes("magalu-parser.js"))) {
    add("categorias:v3-evidencias", "tests/classificador-universal-v3.test.cjs", process.execPath,
      ["--test", "tests/classificador-universal-v3.test.cjs", "tests/classificador-v3-evidencia-marketplace.test.cjs", "tests/classificador-v3-magalu-evidencia.test.cjs", "tests/classificador-v3-legacy-parity.test.cjs"], false);
    for (const name of ["classificador-universal-v2-categorias", "categorias-reducao-diversos", "inteligencia-universal-decisao",
      "aliexpress-manual-importador", "aliexpress-moedas-productdetail-engine", "aliexpress-afiliacao-workspace",
      "magalu-parser", "magalu-factual-resolver", "magalu-engine-importer", "magalu-v2-golden-path",
      "engine-v2-marketplaces-fidelidade", "link-conversao-ocorrencia-marketplaces", "contrato-comercial-final-universal",
      "imagem-link-contrato-universal", "template-universal-visual-contract", "dynamic-link-resolvers", "redirect-resolver-shortlinks-seguros",
      "manual-v2-import-aliexpress", "manual-v2-import-mercadolivre", "manual-v2-import-shopee", "manual-v2-import-amazon", "manual-v2-import-magalu", "manual-v2-import-kabum",
      "destino-geral-distributor", "destinos-compatibilidade-kabum-awin", "local-worker", "local-worker-idempotency", "mercadolivre-work-backend-order"])
      add(`categorias:${name}`, `tests/${name}.test.js`, process.execPath, [`tests/${name}.test.js`]);
    add("categorias:worker-platform", "tests/local-worker-platform-architecture.test.cjs", process.execPath, ["--test", "tests/local-worker-platform-architecture.test.cjs"], false);
  }
  if (plan.runtimeFiles.includes("modules/engine/importer/importer.service.js")) {
    add("magalu:identity-image-retry", "tests/magalu-recovery-retry.test.cjs", process.execPath, ["--test", "tests/magalu-recovery-retry.test.cjs"], false);
    add("magalu:platform-worker-architecture", "tests/local-worker-platform-architecture.test.cjs", process.execPath, ["--test", "tests/local-worker-platform-architecture.test.cjs"], false);
    for (const name of [
      "magalu-engine-importer", "magalu-identity-engine-importer", "magalu-local-worker-identity",
      "magalu-image-resolver", "magalu-factual-resolver", "magalu-affiliate-link", "magalu-parser",
      "magalu-v2-golden-path", "local-worker", "manual-v2-import-magalu", "optimus-capture-magalu",
      "radar-engine-v2-magalu-route", "shopee-importer-retry", "engine-frescor-pre-importer-prioridade",
      "engine-v2-marketplaces-fidelidade", "contrato-comercial-final-universal",
      "imagem-link-contrato-universal", "template-universal-visual-contract"
    ]) add(`magalu:${name}`, `tests/${name}.test.js`, process.execPath, [`tests/${name}.test.js`]);
  }
  if (plan.ignoredFiles.some(file => file === "scripts/guardian-v1.cjs" || file === "scripts/deploy-backend-vps-manual.sh" || file.startsWith(".github/"))) {
    add("guardian:v1", "tests/guardian-v1.test.cjs", process.execPath, ["tests/guardian-v1.test.cjs"], false);
    add("deploy:syntax", "scripts/deploy-backend-vps-manual.sh", bashCommand(), ["-n", "scripts/deploy-backend-vps-manual.sh"], false, true);
    for (const file of [
      "tests/deploy-backend-v2-overlay-validation.test.cjs",
      "tests/deploy-backend-compose-image-validation.test.cjs",
      "tests/deploy-backend-manual-diagnostics.test.cjs"
    ]) add(`deploy:${path.basename(file)}`, file, process.execPath, [file], false, true);
  }
  if (plan.deployMode === "baileys_buffer_patch") {
    add("baileys:buffer", "tests/baileys-initial-buffer-recovery.test.cjs", process.execPath, ["--test", "tests/baileys-initial-buffer-recovery.test.cjs"], false);
    add("baileys:packaging", "tests/guardian-baileys-buffer-packaging.test.cjs", process.execPath, ["--test", "tests/guardian-baileys-buffer-packaging.test.cjs"], false);
  }
  return [...specs.values()];
}

function causeFrom(result) {
  const text = commandText(result).split(/\r?\n/).filter(Boolean);
  return text.slice(-3).join(" | ").slice(0, 1200) || `exit_code_${result.status ?? "spawn_failed"}`;
}

function environmentBlocked(result) {
  if (!Number.isInteger(result?.status)) return true;
  const output = commandText(result);
  return /NtCreateDirectoryObject.*0xC0000022|spawn .* ENOENT|command not found/i.test(output);
}

function classifyTestOutcome(candidateStatus, baselineStatus) {
  if (candidateStatus === 0) return "PASS";
  if (!Number.isInteger(candidateStatus)) return "BLOCKED";
  if (!Number.isInteger(baselineStatus)) return "BLOCKED";
  return baselineStatus === 0 ? "FAIL" : "BASELINE_DEBT";
}

function summarizeResults(results) {
  if (results.some(item => item.status === "FAIL")) return "FAIL";
  if (results.some(item => item.status === "BLOCKED")) return "BLOCKED";
  if (results.some(item => item.status === "BASELINE_DEBT")) return "BASELINE_DEBT";
  return "PASS";
}

function extractBaseline(repo, base) {
  const temporaryRoot = path.join(repo, "tmp", "guardian-v1");
  fs.mkdirSync(temporaryRoot, { recursive: true });
  const directory = fs.mkdtempSync(path.join(temporaryRoot, "baseline-"));
  const archive = path.join(directory, "baseline.tar");
  const tree = path.join(directory, "tree");
  fs.mkdirSync(tree);
  const archived = run("git", ["-C", repo, "archive", "--format=tar", `--output=${archive}`, base]);
  if (archived.status !== 0) throw new Error(`baseline_archive_failed:${causeFrom(archived)}`);
  const extracted = run("tar", ["-xf", archive, "-C", tree]);
  if (extracted.status !== 0) throw new Error(`baseline_extract_failed:${causeFrom(extracted)}`);
  return { directory, tree };
}

function executeSpec(spec, cwd, repoNodeModules) {
  const env = { ...process.env };
  if (repoNodeModules) env.NODE_PATH = [repoNodeModules, env.NODE_PATH].filter(Boolean).join(path.delimiter);
  return run(spec.command, spec.args, { cwd, env });
}

function validate(repo, base, source) {
  const plan = buildPlan(repo, base, source);
  if (plan.blocked.length) return { ...plan, result: "BLOCKED", tests: [] };
  const specs = testMatrix(plan);
  const results = [];
  let baselineFixture = null;
  let bashProbe = null;
  try {
    for (const spec of specs) {
      if (!fs.existsSync(path.join(repo, spec.file))) {
        results.push({ id: spec.id, file: spec.file, status: "BLOCKED", stage: "candidate", cause: "test_file_missing" });
        continue;
      }
      if (spec.requiresBash) {
        bashProbe ||= run(bashCommand(), ["-lc", "exit 0"], { cwd: repo });
        if (bashProbe.status !== 0) {
          results.push({ id: spec.id, file: spec.file, status: "BLOCKED", stage: "environment", cause: causeFrom(bashProbe) });
          continue;
        }
      }
      const candidate = executeSpec(spec, repo);
      if (candidate.status === 0) {
        results.push({ id: spec.id, file: spec.file, status: "PASS", stage: "candidate", cause: "" });
        continue;
      }
      if (environmentBlocked(candidate)) {
        results.push({ id: spec.id, file: spec.file, status: "BLOCKED", stage: "environment", cause: causeFrom(candidate) });
        continue;
      }
      if (!spec.compareBaseline) {
        results.push({ id: spec.id, file: spec.file, status: "FAIL", stage: "candidate", cause: causeFrom(candidate) });
        continue;
      }
      try {
        baselineFixture ||= extractBaseline(repo, base);
        const baselineFile = path.join(baselineFixture.tree, ...spec.file.split("/"));
        if (!fs.existsSync(baselineFile)) {
          results.push({ id: spec.id, file: spec.file, status: "FAIL", stage: "candidate", cause: causeFrom(candidate) });
          continue;
        }
        const baseline = executeSpec(spec, baselineFixture.tree, path.join(repo, "node_modules"));
        results.push({
          id: spec.id,
          file: spec.file,
          status: classifyTestOutcome(candidate.status, baseline.status),
          stage: baseline.status === 0 ? "candidate" : "baseline_and_candidate",
          cause: causeFrom(candidate)
        });
      } catch (error) {
        results.push({ id: spec.id, file: spec.file, status: "BLOCKED", stage: "baseline_compare", cause: error.message });
      }
    }
  } finally {
    if (baselineFixture) fs.rmSync(baselineFixture.directory, { recursive: true, force: true });
  }
  return { ...plan, result: summarizeResults(results), tests: results };
}

function printBootstrap(repo) {
  const head = git(repo, ["rev-parse", "HEAD"]).stdout.trim();
  const branch = git(repo, ["branch", "--show-current"]).stdout.trim() || "DETACHED";
  const main = git(repo, ["rev-parse", "origin/main"], { allowFailure: true });
  const status = git(repo, ["status", "--porcelain=v1"], { allowFailure: true });
  const values = {
    REPOSITORY: repo,
    BRANCH: branch,
    HEAD: head,
    ORIGIN_MAIN: main.status === 0 ? main.stdout.trim() : "BLOCKED",
    LOCAL_CHANGES: status.status === 0 ? (status.stdout.trim() ? "PRESENT" : "NONE") : "BLOCKED",
    GIT: toolState("git"),
    NODE: toolState(process.execPath),
    NPM: toolState("npm"),
    DOCKER: toolState("docker"),
    GH: toolState("gh")
  };
  for (const [key, value] of Object.entries(values)) console.log(`${key}=${value}`);
}

function writeGithubOutput(file, plan) {
  if (!file) throw new Error("github_output_required");
  fs.appendFileSync(file, [
    `source_sha=${plan.sourceSha}`,
    `base_sha=${plan.baseSha}`,
    `validation=${plan.validation}`,
    `deploy_mode=${plan.deployMode}`,
    `runtime_files=${plan.runtimeFiles.join(",")}`
  ].join("\n") + "\n");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0] || "bootstrap";
  if (args.help || command === "help") {
    console.log([
      "Guardian Optimus V1",
      "  node scripts/guardian-v1.cjs bootstrap [--repo PATH]",
      "  node scripts/guardian-v1.cjs prepare --base SHA --source SHA [--format json|value]",
      "  node scripts/guardian-v1.cjs validate --base SHA --source SHA [--report FILE]",
      "Publicação continua exclusiva do workflow manual deploy-backend-vps.yml."
    ].join("\n"));
    return;
  }
  const repo = resolveRepo(args.repo || "");
  if (command === "bootstrap") return printBootstrap(repo);
  const source = args.source === "HEAD" || !args.source ? git(repo, ["rev-parse", "HEAD"]).stdout.trim() : args.source;
  const base = args.base;
  if (command === "prepare") {
    const plan = buildPlan(repo, base, source);
    if (args["github-output"]) writeGithubOutput(args["github-output"], plan);
    if (args.format === "value") console.log(plan.runtimeFiles.join(","));
    else if (args.format === "mode") console.log(plan.deployMode);
    else if (["dependencies-before", "dependencies-after"].includes(args.format)) {
      if (plan.validation !== "PASS" || plan.deployMode !== "baileys_buffer_patch") throw new Error("dependency_profile_required");
      const key = args.format.endsWith("before") ? "before" : "after";
      for (const [file, hashes] of Object.entries(BAILEYS_BUFFER_PROFILE.dependencies)) console.log(`${file}\t${hashes[key]}`);
    }
    else console.log(JSON.stringify(plan, null, 2));
    if (plan.blocked.length) process.exitCode = 2;
    return;
  }
  if (command === "build-dockerfile") {
    process.stdout.write(renderDockerfile(buildPlan(repo, base, source), args["base-tag"] || ""));
    return;
  }
  if (command === "validate") {
    const report = validate(repo, base, source);
    if (args.report) fs.writeFileSync(args.report, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report, null, 2));
    if (report.result === "FAIL" || report.result === "BLOCKED") process.exitCode = 1;
    return;
  }
  throw new Error(`unknown_command:${command}`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`GUARDIAN_ERROR stage=bootstrap_or_plan cause=${String(error?.message || error)}`);
    process.exitCode = 1;
  }
}

module.exports = {
  BAILEYS_BUFFER_PROFILE,
  renderDockerfile,
  buildPlan,
  isNonRuntime,
  isOverlayRuntime,
  normalizeRuntimePath,
  testMatrix,
  classifyTestOutcome,
  environmentBlocked,
  summarizeResults
};
