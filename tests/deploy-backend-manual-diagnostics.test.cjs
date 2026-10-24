"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const scriptPath = path.join(root, "scripts/deploy-backend-vps-manual.sh");
const sourceScript = fs.readFileSync(scriptPath, "utf8").replace(/\r\n/g, "\n");
const bash = process.platform === "win32" ? "C:\\Program Files\\Git\\bin\\bash.exe" : "bash";
const baseImage = `sha256:${"a".repeat(64)}`;
const candidateImage = `sha256:${"b".repeat(64)}`;
const baseComposeImage = "local/optimus-backend:fixture-base";
const secretSentinel = "fixture-secret-must-not-be-logged";

function toShellPath(value) {
  if (process.platform !== "win32") return value;
  const normalized = path.resolve(value).replace(/\\/g, "/");
  return normalized.replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  assert.ifError(result.error);
  assert.equal(result.status, 0, `${command} ${args.join(" ")} failed:\n${result.stderr}`);
  return (result.stdout || "").trim();
}

function diagnosticOutput(result) {
  return `${result.stdout || ""}${result.stderr || ""}`;
}

function assertDiagnostic(result, stage, code, resultCode = "command_failed") {
  const output = diagnosticOutput(result);
  assert.equal(result.status, code, `exit code must remain ${code}:\n${output}`);
  assert.match(
    output,
    new RegExp(`deploy_failure stage=${stage} line=\\d+ exit_code=${code} result=${resultCode}`),
    `stage, source line, and exit code must be logged:\n${output}`
  );
  assert.doesNotMatch(output, /BASH_COMMAND|fixture-secret-must-not-be-logged|authorization\s*[:=]|password\s*[:=]|token\s*[:=]/i);
}

function makeFixture(scenario, { activeMismatch = false, switched = false } = {}) {
  const parent = path.join(root, "tmp", "test-tmp");
  fs.mkdirSync(parent, { recursive: true });
  const dir = fs.mkdtempSync(path.join(parent, "deploy-manual-diagnostics-"));
  const workspace = path.join(dir, "workspace");
  const source = path.join(workspace, "release-source");
  const infra = path.join(dir, "infra");
  const temp = path.join(dir, "tmp");
  fs.mkdirSync(source, { recursive: true });
  fs.mkdirSync(infra, { recursive: true });
  fs.mkdirSync(temp, { recursive: true });
  fs.writeFileSync(path.join(infra, "compose.yml"), "fixture compose; never parsed by Docker\n");
  fs.writeFileSync(path.join(source, "index.js"), "base fixture bytes\n");
  run("git", ["-C", source, "init", "-q"]);
  run("git", ["-C", source, "config", "user.email", "fixture@example.invalid"]);
  run("git", ["-C", source, "config", "user.name", "Deploy fixture"]);
  run("git", ["-C", source, "add", "index.js"]);
  run("git", ["-C", source, "commit", "-qm", "fixture base"]);
  const baseSha = run("git", ["-C", source, "rev-parse", "HEAD"]);
  const baseHash = crypto.createHash("sha256").update("base fixture bytes\n").digest("hex");
  fs.writeFileSync(path.join(source, "index.js"), "candidate fixture bytes\n");
  run("git", ["-C", source, "add", "index.js"]);
  run("git", ["-C", source, "commit", "-qm", "fixture candidate"]);
  const sourceSha = run("git", ["-C", source, "rev-parse", "HEAD"]);

  const fixtureScript = path.join(dir, "deploy-backend-vps-manual.sh");
  const replaced = sourceScript.replace(/^infra=\/opt\/optimus\/infra$/m, 'infra="${DEPLOY_FIXTURE_INFRA}"');
  assert.notEqual(replaced, sourceScript, "fixture must redirect the hard-coded production path");
  fs.writeFileSync(fixtureScript, replaced);

  const activeImageFile = path.join(dir, "active-image.txt");
  const rollbackMarker = path.join(dir, "rollback-calls.txt");
  fs.writeFileSync(activeImageFile, activeMismatch ? `sha256:${"c".repeat(64)}` : baseImage);
  if (switched) fs.writeFileSync(path.join(infra, "backend-release.yml"), `services:\n  backend:\n    image: local/optimus-backend:${sourceSha}-fixture-1\n`);

  return {
    dir,
    workspace,
    source,
    infra,
    fixtureScript,
    activeImageFile,
    rollbackMarker,
    baseSha,
    sourceSha,
    baseHash,
    env: {
      ...process.env,
      SOURCE_SHA: sourceSha,
      BASE_SHA: baseSha,
      BASE_IMAGE: baseImage,
      GITHUB_EVENT_NAME: "workflow_dispatch",
      GITHUB_REF: "refs/heads/main",
      GITHUB_SHA: sourceSha,
      GITHUB_WORKSPACE: toShellPath(workspace),
      GITHUB_RUN_ID: "fixture-run",
      GITHUB_RUN_ATTEMPT: "1",
      RUNTIME_FILES: "index.js",
      DEPLOY_FIXTURE_INFRA: toShellPath(infra),
      DEPLOY_FIXTURE_ACTIVE_IMAGE: toShellPath(activeImageFile),
      DEPLOY_FIXTURE_ROLLBACK_MARKER: toShellPath(rollbackMarker),
      DEPLOY_FIXTURE_BASE_IMAGE: baseImage,
      DEPLOY_FIXTURE_CANDIDATE_IMAGE: candidateImage,
      DEPLOY_FIXTURE_BASE_COMPOSE_IMAGE: baseComposeImage,
      DEPLOY_FIXTURE_IMAGE_HASH: scenario === "hash" ? "f".repeat(64) : baseHash,
      DEPLOY_FIXTURE_SCENARIO: scenario,
      DEPLOY_FIXTURE_SECRET_SENTINEL: secretSentinel,
      DEPLOY_FIXTURE_PYTHON: process.platform === "win32" ? "/c/Python314/python.exe" : "python3",
      TMPDIR: toShellPath(temp)
    }
  };
}

const fixtureFunctions = String.raw`
flock() { return 0; }
sleep() { return 0; }
python3() { command "$DEPLOY_FIXTURE_PYTHON" "$@"; }
curl() {
  local arg active
  local wants_status=0
  for arg in "$@"; do
    [[ "$arg" == -w ]] && wants_status=1
  done
  active="$(cat "$DEPLOY_FIXTURE_ACTIVE_IMAGE")"
  if [[ "$DEPLOY_FIXTURE_SCENARIO" == after_swap && "$active" == "$DEPLOY_FIXTURE_CANDIDATE_IMAGE" ]]; then
    if [[ "$wants_status" == 1 ]]; then printf 503; return 0; else return 22; fi
  fi
  if [[ "$wants_status" == 1 ]]; then printf 200; fi
  return 0
}
docker() {
  local action="BASH_PARAM{1:-}" format="BASH_PARAM{3:-}" reference="BASH_PARAM{5:-}" file="" image="" previous=0 arg
  if [[ "$action" == exec && "$2" == optimus-backend ]]; then
    if [[ "BASH_PARAM{3:-}" == sh ]]; then printf file; return 0; fi
    if [[ "BASH_PARAM{3:-}" == sha256sum ]]; then printf '%s  %s\n' "$DEPLOY_FIXTURE_IMAGE_HASH" "BASH_PARAM{4:-/app/index.js}"; return 0; fi
    return 90
  fi
  if [[ "$action" == image && "$2" == inspect ]]; then
    reference="BASH_PARAM{@: -1}"
    case "$reference" in
      "$DEPLOY_FIXTURE_BASE_IMAGE"|local/optimus-deploy-base:*|local/optimus-backend-recovery:*) printf '%s\n' "$DEPLOY_FIXTURE_BASE_IMAGE" ;;
      "$DEPLOY_FIXTURE_BASE_COMPOSE_IMAGE")
        if [[ "$DEPLOY_FIXTURE_SCENARIO" == compose_image ]]; then printf 'sha256:%064d\n' 0; else printf '%s\n' "$DEPLOY_FIXTURE_BASE_IMAGE"; fi
        ;;
      local/optimus-backend:"$SOURCE_SHA"-*) printf '%s\n' "$DEPLOY_FIXTURE_CANDIDATE_IMAGE" ;;
      *) return 91 ;;
    esac
    return 0
  fi
  if [[ "$action" == inspect ]]; then
    case "$format" in
      '{{.Image}}') cat "$DEPLOY_FIXTURE_ACTIVE_IMAGE" ;;
      '{{.State.Health.Status}}') printf healthy ;;
      '{{.State.Status}}') printf running ;;
      '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Type}}{{end}}{{end}}') printf bind ;;
      '{{json .Config.Env}}') printf '["FIXTURE=value"]' ;;
      '{{json .Mounts}}') printf '[{"Type":"bind","Source":"/fixture/data","Destination":"/data","RW":true}]' ;;
      '{{json .HostConfig.Ulimits}}') printf '[{"Name":"core","Soft":0,"Hard":0}]' ;;
      *) return 92 ;;
    esac
    return 0
  fi
  case "$action" in
    tag) return 0 ;;
    build)
      if [[ "$DEPLOY_FIXTURE_SCENARIO" == build ]]; then return 37; fi
      return 0
      ;;
    run) return 0 ;;
    compose)
      if [[ " $* " == *" ps -q postgres "* ]]; then printf 'fixture-postgres-id\n'; return 0; fi
      if [[ " $* " == *" config --format json "* ]]; then
        previous=0
        for arg in "$@"; do
          if [[ "$previous" == 1 ]]; then file="$arg"; previous=0; elif [[ "$arg" == -f ]]; then previous=1; fi
        done
        image="$DEPLOY_FIXTURE_BASE_COMPOSE_IMAGE"
        if [[ "$file" != "$DEPLOY_FIXTURE_INFRA/compose.yml" ]]; then image="$(awk '$1 == "image:" { print $2 }' "$file")"; fi
        if [[ "$DEPLOY_FIXTURE_SCENARIO" == before_swap && "$file" != "$DEPLOY_FIXTURE_INFRA/compose.yml" ]]; then
          printf '{"services":{"backend":{"image":"%s","environment":{"FIXTURE":"same","unexpected":"different"},"volumes":[]},"postgres":{"image":"postgres"}}}\n' "$image"
        else
          printf '{"services":{"backend":{"image":"%s","environment":{"FIXTURE":"same"},"volumes":[]},"postgres":{"image":"postgres"}}}\n' "$image"
        fi
        return 0
      fi
      if [[ " $* " == *" up -d "* ]]; then
        file=""
        previous=0
        for arg in "$@"; do
          if [[ "$previous" == 1 ]]; then file="$arg"; previous=0; elif [[ "$arg" == -f ]]; then previous=1; fi
        done
        if [[ -n "$file" && "$file" != "$DEPLOY_FIXTURE_INFRA/compose.yml" && -f "$file" ]]; then
          image="$(awk '$1 == "image:" { print $2 }' "$file")"
        else
          image="$DEPLOY_FIXTURE_BASE_COMPOSE_IMAGE"
        fi
        if [[ "$image" == local/optimus-backend:* && "$image" == *"$SOURCE_SHA"* ]]; then
          printf '%s' "$DEPLOY_FIXTURE_CANDIDATE_IMAGE" > "$DEPLOY_FIXTURE_ACTIVE_IMAGE"
        else
          printf '%s' "$DEPLOY_FIXTURE_BASE_IMAGE" > "$DEPLOY_FIXTURE_ACTIVE_IMAGE"
        fi
        printf 'compose_up\n' >> "$DEPLOY_FIXTURE_ROLLBACK_MARKER"
        return 0
      fi
      return 93
      ;;
    *) return 94 ;;
  esac
}
`.replaceAll("BASH_PARAM", "$" );

function executeFixture(fixture) {
  const wrapper = `${fixtureFunctions}\nsource "$DEPLOY_SCRIPT_FIXTURE"`;
  return spawnSync(bash, ["-c", wrapper], {
    cwd: root,
    encoding: "utf8",
    env: { ...fixture.env, DEPLOY_SCRIPT_FIXTURE: toShellPath(fixture.fixtureScript) }
  });
}

function withFixture(scenario, options, callback) {
  const fixture = makeFixture(scenario, options);
  try {
    callback(fixture);
  } finally {
    fs.rmSync(fixture.dir, { recursive: true, force: true });
  }
}

test("handler cobre falha na primeira validação, antes do trap antigo", () => {
  const output = spawnSync(bash, [scriptPath], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      SOURCE_SHA: "invalid-source-sentinel",
      BASE_SHA: "a".repeat(40),
      BASE_IMAGE: baseImage,
      GITHUB_EVENT_NAME: "workflow_dispatch",
      GITHUB_REF: "refs/heads/main",
      DEPLOY_DIAGNOSTIC_SECRET_SENTINEL: secretSentinel
    }
  });
  assert.equal(output.status, 1, diagnosticOutput(output));
  assert.match(diagnosticOutput(output), /deploy_failure stage=validate_inputs line=\d+ exit_code=1 result=command_failed/);
  assert.doesNotMatch(diagnosticOutput(output), /invalid-source-sentinel|fixture-secret-must-not-be-logged|BASH_COMMAND/);
});

test("falha de hash informa etapa e preserva exit code", () => {
  withFixture("hash", {}, (fixture) => {
    const result = executeFixture(fixture);
    assertDiagnostic(result, "validate_runtime_hashes", 1);
    assert.match(diagnosticOutput(result), /Base image content\/hash mismatch: index\.js/);
    assert.equal(fs.existsSync(fixture.rollbackMarker), false);
  });
});

test("falha de identidade da imagem informa etapa e preserva exit code", () => {
  withFixture("image", { activeMismatch: true }, (fixture) => {
    const result = executeFixture(fixture);
    assertDiagnostic(result, "validate_production_baseline", 1);
    assert.equal(fs.readFileSync(fixture.activeImageFile, "utf8"), `sha256:${"c".repeat(64)}`);
    assert.equal(fs.existsSync(fixture.rollbackMarker), false);
  });
});

test("imagem Compose resolvida para ID incorreto informa mismatch sanitizado", () => {
  withFixture("compose_image", {}, (fixture) => {
    const result = executeFixture(fixture);
    assertDiagnostic(result, "validate_compose_baseline", 1, "compose_image_mismatch");
    assert.match(diagnosticOutput(result), /Compose backend image does not resolve to the running rollback image/);
    assert.equal(fs.readFileSync(fixture.activeImageFile, "utf8"), baseImage);
    assert.equal(fs.existsSync(fixture.rollbackMarker), false);
  });
});

test("falha do build informa etapa e preserva exit code original", () => {
  withFixture("build", {}, (fixture) => {
    const result = executeFixture(fixture);
    assertDiagnostic(result, "build_candidate_image", 37);
    assert.equal(fs.readFileSync(fixture.activeImageFile, "utf8"), baseImage);
    assert.equal(fs.existsSync(fixture.rollbackMarker), false);
  });
});

test("falha antes da troca informa etapa sem iniciar rollback", () => {
  withFixture("before_swap", {}, (fixture) => {
    const result = executeFixture(fixture);
    assertDiagnostic(result, "validate_compose_overlay", 1);
    assert.match(diagnosticOutput(result), /Effective Compose changed beyond backend image/);
    assert.equal(fs.readFileSync(fixture.activeImageFile, "utf8"), baseImage);
    assert.equal(fs.existsSync(fixture.rollbackMarker), false);
    assert.equal(fs.existsSync(path.join(fixture.infra, "backend-release.yml")), false);
  });
});

test("falha depois da troca informa etapa, restaura base e preserva exit code", () => {
  withFixture("after_swap", {}, (fixture) => {
    const result = executeFixture(fixture);
    assertDiagnostic(result, "post_deploy_readiness", 1);
    assert.equal(fs.readFileSync(fixture.activeImageFile, "utf8"), baseImage);
    assert.equal(fs.readFileSync(fixture.rollbackMarker, "utf8").trim().split(/\r?\n/).length, 2);
    assert.equal(fs.existsSync(path.join(fixture.infra, "backend-release.yml")), false);
  });
});

test("fixture de sucesso percorre overlay e termina sem acionar diagnóstico", () => {
  withFixture("success", {}, (fixture) => {
    const result = executeFixture(fixture);
    assert.equal(result.status, 0, diagnosticOutput(result));
    assert.match(diagnosticOutput(result), /Published source=/);
    assert.doesNotMatch(diagnosticOutput(result), /deploy_failure/);
    assert.equal(fs.readFileSync(fixture.activeImageFile, "utf8"), candidateImage);
  });
});

test("diagnóstico não inclui comandos, valores secretos ou dados de ambiente", () => {
  const diagnosticStart = sourceScript.indexOf("# BEGIN deploy failure diagnostics");
  const diagnosticEnd = sourceScript.indexOf("# END deploy failure diagnostics", diagnosticStart);
  assert.ok(diagnosticStart >= 0 && diagnosticEnd > diagnosticStart);
  const diagnosticBlock = sourceScript.slice(diagnosticStart, diagnosticEnd);
  assert.match(diagnosticBlock, /BASH_LINENO/);
  assert.match(diagnosticBlock, /exit_code=%s/);
  assert.doesNotMatch(diagnosticBlock, /BASH_COMMAND|set -x/);
  assert.ok(sourceScript.indexOf("trap report_deploy_failure ERR") < sourceScript.indexOf("[[ \"$SOURCE_SHA\""));
});
