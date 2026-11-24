"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const { hash, requireOk } = require("./deployment.cjs");

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
}
const fingerprint = value => hash(JSON.stringify(canonical(value)));

function atomicWrite(file, contents) {
  const dir = path.dirname(file);
  const tmp = path.join(dir, "." + randomUUID());
  try {
    const fd = fs.openSync(tmp, "wx", 0o600);
    try { fs.writeFileSync(fd, contents); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, file);
    const parent = fs.openSync(dir, "r");
    try { fs.fsyncSync(parent); } finally { fs.closeSync(parent); }
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

function createDockerHost({ directory, project, backend, postgres, httpPort, controlImage, controlNetwork, fenceDbUrlFile }) {
  const composeFile = path.join(directory, "compose.yml");
  const override = path.join(directory, "backend-release.yml");
  const paths = [composeFile, override];
  const core = ["compose", "--project-directory", directory, "-p", project];
  const compose = files => [...core, ...files.flatMap(file => ["-f", file])];
  const docker = (args, input, timeout = 15000) => {
    const result = spawnSync("/usr/bin/docker", args, {
      input, encoding: "utf8", cwd: directory, timeout, maxBuffer: 8 * 1024 * 1024,
      env: { PATH: "/usr/bin:/bin", HOME: "/root", DOCKER_HOST: "unix:///var/run/docker.sock" }
    });
    requireOk(result.status === 0, result.error?.code === "ETIMEDOUT" ? "docker_timeout" : "docker_operation_failed");
    return result.stdout.trim();
  };
  const object = (...args) => JSON.parse(docker(args))[0];
  const config = (files, input) => JSON.parse(docker([...compose(files), "config", "--format", "json"], input));
  const readOverride = () => fs.readFileSync(override, "utf8");
  const oneBackend = () => {
    const container = object("inspect", backend);
    const ids = docker(["ps", "--no-trunc", "--quiet", "--filter", "label=com.docker.compose.project=" + project,
      "--filter", "label=com.docker.compose.service=backend"]).split(/\s+/);
    requireOk(ids.length === 1 && ids[0] === container.Id, "backend_not_unique");
    return container;
  };
  const releaseConfigHash = model => {
    const copy = structuredClone(model);
    delete copy.services.backend.image;
    return fingerprint(copy);
  };
  const snapshot = (app, db, model) => ({
    postgres: db.Id,
    mounts: fingerprint([...app.Mounts].sort((a, b) => a.Destination.localeCompare(b.Destination))),
    env: fingerprint([...app.Config.Env].sort()),
    compose: releaseConfigHash(model)
  });
  function checkSelection(target, model) {
    requireOk(model.services.backend.image === target.ref && model.services.backend.pull_policy === "never",
      "compose_image_not_pinned");
  }
  function health(target, baseline) {
    const app = oneBackend();
    const db = object("inspect", postgres);
    const model = config(paths);
    checkSelection(target, model);
    requireOk(app.Image === target.imageId && app.State.Running && !app.State.OOMKilled && app.RestartCount === 0 &&
      db.State.Running && db.State.Health?.Status === "healthy" &&
      fingerprint(snapshot(app, db, model)) === fingerprint(baseline), "backend_or_postgres_unhealthy");
    const probe = spawnSync("/usr/bin/curl", ["--silent", "--show-error", "--output", "/dev/null",
      "--write-out", "%{http_code}", "--max-time", "4", "http://127.0.0.1:" + httpPort + "/"],
    { encoding: "utf8", timeout: 5000, env: { PATH: "/usr/bin:/bin" } });
    requireOk(probe.status === 0 && probe.stdout === "200", "backend_http_unhealthy");
  }
  function probe(args, input) {
    const records = docker(args, JSON.stringify(input)).split("\n")
      .filter(line => line.startsWith("OP_MAINTENANCE_RESULT "));
    requireOk(records.length === 1, "fence_invalid_response");
    return JSON.parse(records[0].slice("OP_MAINTENANCE_RESULT ".length));
  }
  const fenceCli = ["/usr/local/bin/node", "/app/ops/maintenance/fence.cjs"];
  function fence(action, op) {
    requireOk(/^sha256:[a-f0-9]{64}$/.test(controlImage), "invalid_control_image");
    const result = probe(["run", "--rm", "-i", "--network", controlNetwork, "--read-only", "--pull", "never",
      "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--entrypoint", fenceCli[0], controlImage, fenceCli[1]], {
      action, databaseUrl: fs.readFileSync(fenceDbUrlFile, "utf8").trim(),
      ...(op ? { operation: op.id, epoch: op.epoch, generation: op.generation } : {})
    });
    requireOk(result.ok === true && Number.isSafeInteger(result.claimed) && result.claimed >= 0 &&
      Number.isSafeInteger(result.sendStarted) && result.sendStarted >= 0, "fence_rejected");
    return result;
  }
  function checkArtifacts(release) {
    for (const artifact of [release.base, release.candidate]) {
      requireOk(object("image", "inspect", artifact.ref).Id === artifact.imageId, "artifact_digest_mismatch");
      const version = probe(["run", "--rm", "-i", "--network", "none", "--read-only", "--pull", "never",
        "--entrypoint", fenceCli[0], artifact.ref, fenceCli[1]], { action: "version" });
      requireOk(version.protocol === 1, "fence_protocol_unavailable");
    }
  }
  function checkComposePair(release, original, candidate) {
    const a = config([composeFile, "-"], original);
    const b = config([composeFile, "-"], candidate);
    checkSelection(release.base, a);
    checkSelection(release.candidate, b);
    b.services.backend.image = a.services.backend.image;
    requireOk(fingerprint(a) === fingerprint(b), "compose_delta_outside_backend_image");
  }
  return {
    fence,
    health,
    preflight(release) {
      const app = oneBackend();
      const db = object("inspect", postgres);
      const baseline = snapshot(app, db, config(paths));
      const originalOverride = readOverride();
      const imageLine = /^    image:[^\n]*$/gm;
      requireOk([...originalOverride.matchAll(imageLine)].length === 1, "unexpected_release_override");
      const candidateOverride = originalOverride.replace(imageLine, "    image: " + release.candidate.ref);
      const labels = app.Config.Labels;
      requireOk(labels["com.docker.compose.project.config_files"] === paths.join(",") &&
        docker([...compose(paths), "config", "--hash", "backend"]).split(/\s+/).at(-1) ===
          labels["com.docker.compose.config-hash"], "running_compose_drift");
      checkArtifacts(release);
      checkComposePair(release, originalOverride, candidateOverride);
      health(release.base, baseline);
      requireOk(readOverride() === originalOverride, "release_override_changed");
      return { baseline, originalOverride, candidateOverride };
    },
    recoveryPreflight(op) {
      const ids = docker(["ps", "-a", "--no-trunc", "--quiet", "--filter", "label=com.docker.compose.project=" + project,
        "--filter", "label=com.docker.compose.service=backend"]).split(/\s+/).filter(Boolean);
      requireOk(ids.length <= 1 && (!ids.length || [op.release.base.imageId, op.release.candidate.imageId]
        .includes(object("inspect", ids[0]).Image)), "unknown_active_image");
      requireOk([op.originalOverride, op.candidateOverride].includes(readOverride()), "release_override_changed");
      requireOk(releaseConfigHash(config(paths)) === op.baseline.compose, "compose_changed_during_operation");
      checkArtifacts(op.release);
      checkComposePair(op.release, op.originalOverride, op.candidateOverride);
    },
    switchImage(op, target) {
      const s = fence("status", op);
      requireOk(s.state === "DRAINED" && s.epoch === op.epoch && s.fenceEpoch === op.epoch &&
        s.owner === "maintenance:" + op.id && s.generation === op.generation && s.claimed === 0 &&
        s.sendStarted === 0, "fence_not_drained");
      requireOk([op.originalOverride, op.candidateOverride].includes(readOverride()), "release_override_changed");
      requireOk(releaseConfigHash(config(paths)) === op.baseline.compose, "compose_changed_during_operation");
      const selected = target.digest === op.release.base.digest ? op.originalOverride : op.candidateOverride;
      atomicWrite(override, selected);
      docker([...compose(paths), "up", "-d", "--no-deps", "--no-build", "--force-recreate", "backend"], undefined, 75000);
    }
  };
}

module.exports = { atomicWrite, createDockerHost, fingerprint };
