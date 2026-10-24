#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const SHA_RE = /^[0-9a-f]{40}$/;
const SAFE_PATH_RE = /^[A-Za-z0-9._/-]+$/;
const WINDOWS_BACKEND = "C:\\Users\\Liva D1EGOPC\\Documents\\BACKEND-OFICIAL-2026";

const NON_RUNTIME_EXACT = new Set([
  "AGENTS.md",
  "scripts/deploy-backend-vps-manual.sh",
  "scripts/guardian-v1.cjs",
  "scripts/benchmark-gerente-observability-v2.cjs"
]);
const NON_RUNTIME_PREFIXES = ["docs/", "tests/", ".github/"];
const RUNTIME_ROOTS = new Set([
  "modules", "utils", "marketplaces", "templates", "bootstrap", "campanhas", "assets"
]);
const FULL_BUILD_PATHS = new Set(["Dockerfile", ".dockerignore", "package.json", "package-lock.json"]);

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
  ignoredFiles.sort();
  blocked.sort((a, b) => a.file.localeCompare(b.file));
  return {
    sourceSha: source,
    baseSha: base,
    validation: blocked.length ? "BLOCKED" : "PASS",
    deployMode: runtimeFiles.length ? "overlay" : "none",
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
  if (plan.ignoredFiles.some(file => file === "scripts/guardian-v1.cjs" || file === "scripts/deploy-backend-vps-manual.sh" || file.startsWith(".github/"))) {
    add("guardian:v1", "tests/guardian-v1.test.cjs", process.execPath, ["tests/guardian-v1.test.cjs"], false);
    add("deploy:syntax", "scripts/deploy-backend-vps-manual.sh", bashCommand(), ["-n", "scripts/deploy-backend-vps-manual.sh"], false, true);
    for (const file of [
      "tests/deploy-backend-v2-overlay-validation.test.cjs",
      "tests/deploy-backend-compose-image-validation.test.cjs",
      "tests/deploy-backend-manual-diagnostics.test.cjs"
    ]) add(`deploy:${path.basename(file)}`, file, process.execPath, [file], false, true);
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
    else console.log(JSON.stringify(plan, null, 2));
    if (plan.blocked.length) process.exitCode = 2;
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
  buildPlan,
  isNonRuntime,
  isOverlayRuntime,
  normalizeRuntimePath,
  testMatrix,
  classifyTestOutcome,
  environmentBlocked,
  summarizeResults
};
